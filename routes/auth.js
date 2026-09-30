const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');
const emailService = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'academic_secret_key_2026';

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

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, password, department, role } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({ error: 'Full name, email, and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // ── STRICT ADMIN LOCK ─────────────────────────────────────────────────────
    // Self-registration is strictly restricted to STUDENT and FACULTY roles.
    // Hard-lock the ADMIN role: only the designated institutional admin account is authorized.
    if (role && role.toUpperCase() === 'ADMIN') {
      return res.status(403).json({
        error: 'Admin registration is restricted. Only the designated administrator account is authorized.'
      });
    }

    // Role guardrail: default to STUDENT if not FACULTY
    const cleanRole = (role && role.toUpperCase() === 'FACULTY') ? 'FACULTY' : 'STUDENT';
    const cleanDept = department ? department.trim() : 'General Studies';

    // Verify uniqueness
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing) {
      return res.status(409).json({ error: `An account with email "${cleanEmail}" already exists. Please log in.` });
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    const { lastID } = await dbRun(
      `INSERT INTO users (full_name, email, password_hash, department, role, email_notifications_enabled)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [full_name.trim(), cleanEmail, passwordHash, cleanDept, cleanRole]
    );

    const newUser = {
      id: lastID,
      full_name: full_name.trim(),
      email: cleanEmail,
      department: cleanDept,
      role: cleanRole,
      email_notifications_enabled: 1
    };

    // Trigger real welcome email to the actual user-provided email address asynchronously
    emailService.sendRegistrationEmail(newUser)
      .then(result => {
        console.log(`[Auth/Register] Welcome email dispatched to: ${cleanEmail} (Status: ${result.status})`);
      })
      .catch(err => {
        console.error(`[Auth/Register] Error sending welcome email to ${cleanEmail}:`, err.message);
      });

    // Create session token
    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role, full_name: newUser.full_name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(201).json({
      message: 'Account registered successfully. Verification email dispatched.',
      token,
      user: newUser
    });
  } catch (err) {
    console.error('[POST /api/auth/register]', err);
    res.status(500).json({ error: 'Failed to create user account.' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [cleanEmail]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
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
    console.error('[POST /api/auth/login]', err);
    res.status(500).json({ error: 'Authentication failed.' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
