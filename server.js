require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('./database');
const { authenticateToken, requireRole } = require('./middleware/auth');
const { notifyUser } = require('./services/notificationService');
const emailService = require('./services/emailService');
const reservationsRouter = require('./routes/reservations');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'academic_secret_key_2026';

// ── Global Middleware ─────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Auth Routes ───────────────────────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        department: user.department,
        email_notifications_enabled: user.email_notifications_enabled
      }
    });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// ── Resources Routes ──────────────────────────────────────────────────────────

// GET /api/resources
app.get('/api/resources', authenticateToken, async (req, res) => {
  try {
    const resources = await dbAll('SELECT * FROM resources ORDER BY category, name', []);
    res.json({ resources, count: resources.length });
  } catch (err) {
    console.error('[GET /resources]', err);
    res.status(500).json({ error: 'Failed to fetch resources.' });
  }
});

// GET /api/resources/:id/availability?date=YYYY-MM-DD
app.get('/api/resources/:id/availability', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'A valid date query parameter (YYYY-MM-DD) is required.' });
    }

    const resource = await dbGet('SELECT * FROM resources WHERE id = ?', [id]);
    if (!resource) return res.status(404).json({ error: 'Resource not found.' });

    const bookings = await dbAll(
      `SELECT booking_code, start_time, end_time, status, purpose
       FROM reservations
       WHERE resource_id = ? AND booking_date = ? AND status IN ('PENDING', 'APPROVED', 'CHECKED_IN')
       ORDER BY start_time`,
      [id, date]
    );

    res.json({
      resource: { id: resource.id, name: resource.name, location: resource.location, capacity: resource.capacity },
      date,
      is_under_maintenance: resource.is_under_maintenance === 1,
      booked_slots: bookings,
      slots_count: bookings.length
    });
  } catch (err) {
    console.error('[GET /resources/:id/availability]', err);
    res.status(500).json({ error: 'Failed to fetch availability.' });
  }
});

// ── Reservations Routes ───────────────────────────────────────────────────────
app.use('/api/reservations', reservationsRouter);

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

// PATCH /api/notifications/read-all  (must come BEFORE /:id/read)
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

// ── Admin Routes ──────────────────────────────────────────────────────────────

// GET /api/admin/email-logs
app.get('/api/admin/email-logs', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const logs = await dbAll(
      `SELECT el.*, u.full_name, u.email AS user_email
       FROM email_logs el
       LEFT JOIN users u ON el.user_id = u.id
       ORDER BY el.sent_at DESC
       LIMIT 200`,
      []
    );
    res.json({ logs, count: logs.length });
  } catch (err) {
    console.error('[GET /admin/email-logs]', err);
    res.status(500).json({ error: 'Failed to fetch email logs.' });
  }
});

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CampusReserve API',
    version: '1.0.0',
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
app.listen(PORT, () => {
  console.log(`\n🎓 CampusReserve API running on http://localhost:${PORT}`);
  console.log(`   ✅ Health: http://localhost:${PORT}/api/health`);
  console.log(`   📋 Auth:   POST /api/auth/login`);
  console.log(`   🏛️  Res:    GET  /api/resources`);
  console.log(`   📅 Book:   POST /api/reservations`);
  console.log(`   🔔 Notif:  GET  /api/notifications`);
  console.log(`   📧 Logs:   GET  /api/admin/email-logs\n`);
});

module.exports = app;
