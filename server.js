require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./database');
const { authenticateToken, requireRole } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const reservationsRouter = require('./routes/reservations');
const resourcesRouter = require('./routes/resources');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Global Middleware ─────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Database Async Helpers ───────────────────────────────────────────────────
function dbGet(query, params) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function dbRun(query, params) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
function dbAll(query, params) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

// ── Mount Sub-Routers ────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/api/resources', resourcesRouter);

// ── Notifications Routes ──────────────────────────────────────────────────────

// GET /api/notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notifications = await dbAll(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    const unread = notifications.filter((n) => n.is_read === 0).length;
    res.json({ notifications, unread_count: unread, total: notifications.length });
  } catch (err) {
    console.error('[GET /notifications]', err);
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

// PATCH /api/notifications/read-all
app.patch('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    await dbRun(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [req.user.id]);
    res.json({ message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('[PATCH /notifications/read-all]', err);
    res.status(500).json({ error: 'Failed to mark notifications as read.' });
  }
});

// PATCH /api/notifications/:id/read
app.patch('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await dbGet('SELECT * FROM notifications WHERE id = ?', [id]);
    if (!notification) return res.status(404).json({ error: 'Notification not found.' });
    if (notification.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    await dbRun(`UPDATE notifications SET is_read = 1 WHERE id = ?`, [id]);
    res.json({ message: 'Notification marked as read.' });
  } catch (err) {
    console.error('[PATCH /notifications/:id/read]', err);
    res.status(500).json({ error: 'Failed to update notification.' });
  }
});

// ── Email Logs & Audit Routes ─────────────────────────────────────────────────

// GET /api/admin/email-logs
app.get('/api/admin/email-logs', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT el.*, u.full_name, u.email AS user_email
      FROM email_logs el
      LEFT JOIN users u ON el.user_id = u.id
    `;
    let params = [];

    // Students only see their own emails, Faculty and Admin see institutional ledger
    if (req.user.role === 'STUDENT') {
      query += ` WHERE el.recipient_email = ? OR el.user_id = ?`;
      params.push(req.user.email, req.user.id);
    }

    query += ` ORDER BY el.sent_at DESC LIMIT 150`;

    const logs = await dbAll(query, params);
    res.json({ logs, count: logs.length });
  } catch (err) {
    console.error('[GET /admin/email-logs]', err);
    res.status(500).json({ error: 'Failed to fetch email logs.' });
  }
});

// ── Admin Dashboard Stats Route ────────────────────────────────────────────
// GET /api/admin/stats (ADMIN only)
app.get('/api/admin/stats', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const [totalUsers, totalResources, totalReservations, pendingCount, approvedToday, rejectedCount] = await Promise.all([
      dbGet('SELECT COUNT(*) as count FROM users', []),
      dbGet('SELECT COUNT(*) as count FROM resources WHERE is_under_maintenance = 0', []),
      dbGet('SELECT COUNT(*) as count FROM reservations', []),
      dbGet("SELECT COUNT(*) as count FROM reservations WHERE status = 'PENDING'", []),
      dbGet("SELECT COUNT(*) as count FROM reservations WHERE status = 'APPROVED' AND booking_date = date('now')", []),
      dbGet("SELECT COUNT(*) as count FROM reservations WHERE status = 'REJECTED'", [])
    ]);
    const recentActivity = await dbAll(`
      SELECT r.booking_code, r.status, r.booking_date, r.start_time, r.end_time,
             u.full_name, u.role, res.name as resource_name
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      JOIN resources res ON r.resource_id = res.id
      ORDER BY r.created_at DESC LIMIT 10
    `, []);
    const resourceUtilization = await dbAll(`
      SELECT res.name, res.category, COUNT(r.id) as total_bookings,
             SUM(CASE WHEN r.status = 'APPROVED' THEN 1 ELSE 0 END) as approved,
             SUM(CASE WHEN r.status = 'PENDING' THEN 1 ELSE 0 END) as pending
      FROM resources res
      LEFT JOIN reservations r ON res.id = r.resource_id
      GROUP BY res.id ORDER BY total_bookings DESC
    `, []);
    const usersByRole = await dbAll('SELECT role, COUNT(*) as count FROM users GROUP BY role', []);
    res.json({
      summary: {
        total_users: totalUsers.count,
        active_resources: totalResources.count,
        total_reservations: totalReservations.count,
        pending_approvals: pendingCount.count,
        approved_today: approvedToday.count,
        rejected: rejectedCount.count
      },
      recent_activity: recentActivity,
      resource_utilization: resourceUtilization,
      users_by_role: usersByRole
    });
  } catch (err) {
    console.error('[GET /admin/stats]', err);
    res.status(500).json({ error: 'Failed to fetch admin stats.' });
  }
});

// GET /api/calendar?month=YYYY-MM
app.get('/api/calendar', authenticateToken, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'A valid month parameter (YYYY-MM) is required.' });
    }
    const startDate = month + '-01';
    const [year, mon] = month.split('-').map(Number);
    const lastDay = new Date(year, mon, 0).getDate();
    const endDate = month + '-' + String(lastDay).padStart(2, '0');
    let query, params;
    if (req.user.role === 'ADMIN' || req.user.role === 'FACULTY') {
      query = `SELECT r.id, r.booking_code, r.booking_date, r.start_time, r.end_time,
               r.status, r.purpose, u.full_name, u.role as user_role, res.name as resource_name, res.category
        FROM reservations r JOIN users u ON r.user_id = u.id JOIN resources res ON r.resource_id = res.id
        WHERE r.booking_date BETWEEN ? AND ? ORDER BY r.booking_date, r.start_time`;
      params = [startDate, endDate];
    } else {
      query = `SELECT r.id, r.booking_code, r.booking_date, r.start_time, r.end_time,
               r.status, r.purpose, u.full_name, u.role as user_role, res.name as resource_name, res.category
        FROM reservations r JOIN users u ON r.user_id = u.id JOIN resources res ON r.resource_id = res.id
        WHERE r.booking_date BETWEEN ? AND ? AND r.user_id = ? ORDER BY r.booking_date, r.start_time`;
      params = [startDate, endDate, req.user.id];
    }
    const events = await dbAll(query, params);
    res.json({ month, events, count: events.length });
  } catch (err) {
    console.error('[GET /calendar]', err);
    res.status(500).json({ error: 'Failed to fetch calendar data.' });
  }
});

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CampusReserve API',
    version: '2.4.0',
    timestamp: new Date().toISOString()
  });
});

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[GlobalError]', err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n============================================================`);
  console.log(`🏛️  CampusReserve Academic System running on http://localhost:${PORT}`);
  console.log(`   • Register / Login: /api/auth/register & /api/auth/login`);
  console.log(`   • Resources:        /api/resources`);
  console.log(`   • Reservations:     /api/reservations`);
  console.log(`   • Notifications:    /api/notifications`);
  console.log(`   • Email Telemetry:  /api/admin/email-logs`);
  console.log(`============================================================\n`);
});

module.exports = app;
