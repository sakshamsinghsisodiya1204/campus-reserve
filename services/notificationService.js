const db = require('../database');
const emailService = require('./emailService');

/**
 * Insert an in-app notification and asynchronously fire email.
 *
 * @param {object} opts
 * @param {number}   opts.userId       - Target user ID
 * @param {number}   [opts.bookingId]  - Related booking ID (optional)
 * @param {string}   opts.type         - Event type e.g. 'BOOKING_CREATED'
 * @param {string}   opts.title        - Short notification title
 * @param {string}   opts.message      - Full notification message body
 * @param {Function} [opts.emailAction]- Async fn from emailService to call
 * @param {Array}    [opts.emailArgs]  - Arguments to pass to emailAction
 */
async function notifyUser({ userId, bookingId = null, type, title, message, emailAction, emailArgs = [] }) {
  // 1. Insert in-app notification (synchronous DB call inside serialize block)
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO notifications (user_id, booking_id, type, title, message, is_read)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [userId, bookingId, type, title, message],
      function (err) {
        if (err) {
          console.error('[NotificationService] Failed to insert notification:', err.message);
          return reject(err);
        }

        const notificationId = this.lastID;

        // 2. Fire-and-forget email (never block or reject the HTTP response)
        if (emailAction && typeof emailAction === 'function') {
          // Check user's email_notifications_enabled preference
          db.get(
            'SELECT email_notifications_enabled FROM users WHERE id = ?',
            [userId],
            (prefErr, userRow) => {
              if (prefErr) {
                console.warn('[NotificationService] Could not fetch user pref:', prefErr.message);
              }
              // Send only if enabled (default: 1)
              const enabled = !userRow || userRow.email_notifications_enabled !== 0;
              if (enabled) {
                Promise.resolve()
                  .then(() => emailAction(...emailArgs))
                  .catch((emailErr) => {
                    console.error('[NotificationService] Email fire-and-forget error:', emailErr.message);
                  });
              }
            }
          );
        }

        resolve({ notificationId, type, title });
      }
    );
  });
}

module.exports = { notifyUser };
