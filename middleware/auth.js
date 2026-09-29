const jwt = require('jsonwebtoken');
const db = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'academic_secret_key_2026';

/**
 * Middleware: Verify JWT Bearer token and attach user to req.user
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    // Confirm user still exists in DB
    db.get(
      'SELECT id, full_name, email, role, department, email_notifications_enabled FROM users WHERE id = ?',
      [payload.id],
      (dbErr, user) => {
        if (dbErr) {
          console.error('[Auth] DB error:', dbErr.message);
          return res.status(500).json({ error: 'Internal server error during authentication.' });
        }
        if (!user) {
          return res.status(401).json({ error: 'User no longer exists.' });
        }
        req.user = user;
        next();
      }
    );
  });
}

/**
 * Middleware Factory: Restrict access to specific roles
 * @param {string[]} allowedRoles - Array of allowed roles e.g. ['ADMIN', 'FACULTY']
 */
function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access forbidden. Required roles: ${allowedRoles.join(', ')}. Your role: ${req.user.role}.`
      });
    }
    next();
  };
}

module.exports = { authenticateToken, requireRole };
