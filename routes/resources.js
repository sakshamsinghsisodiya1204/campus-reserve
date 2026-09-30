const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');

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

function normalizeCategory(cat) {
  if (!cat) return 'Laboratory';
  const c = String(cat).trim().toUpperCase();
  if (c === 'LAB' || c === 'LABORATORY') return 'Laboratory';
  if (c === 'HALL' || c === 'SEMINAR HALL' || c === 'SEMINAR') return 'Seminar Hall';
  if (c === 'EQUIPMENT' || c === 'HARDWARE' || c === 'SPECIALIZED HARDWARE') return 'Specialized Hardware';
  if (c === 'CLASSROOM' || c === 'CLASS') return 'Classroom';
  // If already standard casing, return it
  if (['Laboratory', 'Seminar Hall', 'Specialized Hardware', 'Classroom'].includes(cat)) {
    return cat;
  }
  return 'Laboratory';
}

// ── GET /api/resources ────────────────────────────────────────────────────────
// Public/Authenticated: lists all resources with category and maintenance flags
router.get('/', async (req, res) => {
  try {
    const { category, active_only } = req.query;
    let query = 'SELECT * FROM resources';
    const params = [];
    const conditions = [];

    if (category && category !== 'ALL') {
      conditions.push('category = ?');
      params.push(normalizeCategory(category));
    }

    if (active_only === 'true' || active_only === '1') {
      conditions.push('is_under_maintenance = 0');
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY category, name';

    const resources = await dbAll(query, params);
    res.json({ resources, count: resources.length });
  } catch (err) {
    console.error('[GET /api/resources]', err);
    res.status(500).json({ error: 'Failed to fetch resources.' });
  }
});

// ── GET /api/resources/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const resource = await dbGet('SELECT * FROM resources WHERE id = ?', [id]);
    if (!resource) return res.status(404).json({ error: 'Resource not found.' });
    res.json({ resource });
  } catch (err) {
    console.error('[GET /api/resources/:id]', err);
    res.status(500).json({ error: 'Failed to fetch resource.' });
  }
});

// ── GET /api/resources/:id/availability ───────────────────────────────────────
router.get('/:id/availability', async (req, res) => {
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
      resource: {
        id: resource.id,
        name: resource.name,
        location: resource.location,
        capacity: resource.capacity,
        requires_approval: resource.requires_approval
      },
      date,
      is_under_maintenance: resource.is_under_maintenance === 1,
      is_active: resource.is_under_maintenance === 0,
      booked_slots: bookings,
      slots_count: bookings.length
    });
  } catch (err) {
    console.error('[GET /api/resources/:id/availability]', err);
    res.status(500).json({ error: 'Failed to fetch availability.' });
  }
});

// ── POST /api/resources ───────────────────────────────────────────────────────
// Role-gated to FACULTY and ADMIN: Add a new facility or hardware resource
router.post('/', authenticateToken, requireRole(['FACULTY', 'ADMIN']), async (req, res) => {
  try {
    const { name, category, capacity, location, requires_approval, is_under_maintenance, is_active } = req.body;

    if (!name || !capacity || !location) {
      return res.status(400).json({ error: 'Name, capacity, and location are required fields.' });
    }

    const validCategory = normalizeCategory(category);
    const parsedCapacity = parseInt(capacity, 10);
    if (isNaN(parsedCapacity) || parsedCapacity <= 0) {
      return res.status(400).json({ error: 'Capacity must be a positive integer.' });
    }

    const approvalFlag = (requires_approval === 1 || requires_approval === true || requires_approval === '1') ? 1 : 0;
    
    // Determine maintenance flag
    let maintenanceFlag = 0;
    if (is_under_maintenance !== undefined) {
      maintenanceFlag = (is_under_maintenance === 1 || is_under_maintenance === true || is_under_maintenance === '1') ? 1 : 0;
    } else if (is_active !== undefined) {
      maintenanceFlag = (is_active === 0 || is_active === false || is_active === '0') ? 1 : 0;
    }

    const { lastID } = await dbRun(
      `INSERT INTO resources (name, category, capacity, location, requires_approval, is_under_maintenance)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name.trim(), validCategory, parsedCapacity, location.trim(), approvalFlag, maintenanceFlag]
    );

    const created = await dbGet('SELECT * FROM resources WHERE id = ?', [lastID]);

    res.status(201).json({
      success: true,
      message: `Resource "${created.name}" created successfully.`,
      resource: created
    });
  } catch (err) {
    console.error('[POST /api/resources]', err);
    res.status(500).json({ error: 'Failed to create resource.' });
  }
});

// ── PUT /api/resources/:id ────────────────────────────────────────────────────
// Role-gated to FACULTY and ADMIN: Update resource specifications
router.put('/:id', authenticateToken, requireRole(['FACULTY', 'ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, capacity, location, requires_approval, is_under_maintenance, is_active } = req.body;

    const existing = await dbGet('SELECT * FROM resources WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Resource not found.' });

    const updatedName = name ? name.trim() : existing.name;
    const updatedCategory = category ? normalizeCategory(category) : existing.category;
    const updatedCapacity = capacity !== undefined ? parseInt(capacity, 10) : existing.capacity;
    const updatedLocation = location ? location.trim() : existing.location;
    const updatedApproval = requires_approval !== undefined 
      ? ((requires_approval === 1 || requires_approval === true || requires_approval === '1') ? 1 : 0)
      : existing.requires_approval;

    let updatedMaintenance = existing.is_under_maintenance;
    if (is_under_maintenance !== undefined) {
      updatedMaintenance = (is_under_maintenance === 1 || is_under_maintenance === true || is_under_maintenance === '1') ? 1 : 0;
    } else if (is_active !== undefined) {
      updatedMaintenance = (is_active === 0 || is_active === false || is_active === '0') ? 1 : 0;
    }

    await dbRun(
      `UPDATE resources 
       SET name = ?, category = ?, capacity = ?, location = ?, requires_approval = ?, is_under_maintenance = ?
       WHERE id = ?`,
      [updatedName, updatedCategory, updatedCapacity, updatedLocation, updatedApproval, updatedMaintenance, id]
    );

    const updated = await dbGet('SELECT * FROM resources WHERE id = ?', [id]);

    res.json({
      success: true,
      message: `Resource "${updated.name}" updated successfully.`,
      resource: updated
    });
  } catch (err) {
    console.error('[PUT /api/resources/:id]', err);
    res.status(500).json({ error: 'Failed to update resource.' });
  }
});

// ── PATCH /api/resources/:id/availability ─────────────────────────────────────
// Role-gated to FACULTY and ADMIN: Toggle availability / maintenance status
router.patch('/:id/availability', authenticateToken, requireRole(['FACULTY', 'ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active, is_under_maintenance } = req.body;

    const existing = await dbGet('SELECT * FROM resources WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Resource not found.' });

    let newMaintenance;
    if (is_under_maintenance !== undefined) {
      newMaintenance = (is_under_maintenance === 1 || is_under_maintenance === true || is_under_maintenance === '1') ? 1 : 0;
    } else if (is_active !== undefined) {
      newMaintenance = (is_active === 0 || is_active === false || is_active === '0') ? 1 : 0;
    } else {
      // Toggle current state
      newMaintenance = existing.is_under_maintenance === 1 ? 0 : 1;
    }

    await dbRun('UPDATE resources SET is_under_maintenance = ? WHERE id = ?', [newMaintenance, id]);
    const updated = await dbGet('SELECT * FROM resources WHERE id = ?', [id]);

    const statusLabel = updated.is_under_maintenance === 0 ? 'Active & Available' : 'Under Maintenance / Inactive';

    res.json({
      success: true,
      message: `Resource "${updated.name}" availability updated: ${statusLabel}.`,
      resource: updated,
      is_active: updated.is_under_maintenance === 0,
      is_under_maintenance: updated.is_under_maintenance === 1
    });
  } catch (err) {
    console.error('[PATCH /api/resources/:id/availability]', err);
    res.status(500).json({ error: 'Failed to update resource availability.' });
  }
});

// ── DELETE /api/resources/:id ─────────────────────────────────────────────────
// Role-gated to ADMIN
router.delete('/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await dbGet('SELECT * FROM resources WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Resource not found.' });

    await dbRun('DELETE FROM resources WHERE id = ?', [id]);
    res.json({ success: true, message: `Resource "${existing.name}" deleted.` });
  } catch (err) {
    console.error('[DELETE /api/resources/:id]', err);
    res.status(500).json({ error: 'Failed to delete resource.' });
  }
});

module.exports = router;
