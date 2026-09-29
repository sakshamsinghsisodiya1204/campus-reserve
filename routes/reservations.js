const express = require("express");
const router = express.Router();
const db = require("../database");
const { authenticateToken, requireRole } = require("../middleware/auth");
const { notifyUser } = require("../services/notificationService");
const emailService = require("../services/emailService");

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateBookingCode() {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `CR-2026-${digits}`;
}

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

// ── POST /api/reservations ────────────────────────────────────────────────────
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { resource_id, booking_date, start_time, end_time, purpose, notification_email } = req.body;

    // ── Validation ─────────────────────────────────────────────────────────
    if (!resource_id || !booking_date || !start_time || !end_time || !purpose) {
      return res.status(400).json({ error: "Missing required fields: resource_id, booking_date, start_time, end_time, purpose." });
    }

    // Date not in the past
    const today = new Date().toISOString().split("T")[0];
    if (booking_date < today) {
      return res.status(400).json({ error: "Booking date cannot be in the past." });
    }

    // start_time < end_time
    if (start_time >= end_time) {
      return res.status(400).json({ error: "start_time must be before end_time." });
    }

    // ── Resource Verification ──────────────────────────────────────────────
    const resource = await dbGet("SELECT * FROM resources WHERE id = ?", [resource_id]);
    if (!resource) {
      return res.status(404).json({ error: "Resource not found." });
    }
    if (resource.is_under_maintenance === 1) {
      return res.status(400).json({ error: `"${resource.name}" is currently under maintenance and cannot be booked.` });
    }

    // ── Collision Check (serialized) ───────────────────────────────────────
    const conflict = await dbGet(
      `SELECT id, booking_code FROM reservations
       WHERE resource_id = ?
         AND booking_date = ?
         AND status IN ('PENDING', 'APPROVED', 'CHECKED_IN')
         AND (start_time < ? AND end_time > ?)`,
      [resource_id, booking_date, end_time, start_time]
    );

    if (conflict) {
      return res.status(409).json({
        error: `Time slot conflict. "${resource.name}" is already booked (Booking: ${conflict.booking_code}) for the overlapping time window on ${booking_date}.`,
        conflicting_booking_code: conflict.booking_code
      });
    }

    // ── Policy Evaluation ──────────────────────────────────────────────────
    let status = "APPROVED";
    if (resource.requires_approval === 1 && req.user.role !== "FACULTY" && req.user.role !== "ADMIN") {
      status = "PENDING";
    }

    // ── Unique Booking Code ────────────────────────────────────────────────
    let booking_code = generateBookingCode();
    const existing = await dbGet("SELECT id FROM reservations WHERE booking_code = ?", [booking_code]);
    if (existing) booking_code = generateBookingCode();

    // ── Insert ─────────────────────────────────────────────────────────────
    const { lastID } = await dbRun(
      `INSERT INTO reservations (booking_code, resource_id, user_id, booking_date, start_time, end_time, purpose, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [booking_code, resource_id, req.user.id, booking_date, start_time, end_time, purpose, status]
    );

    const booking = await dbGet("SELECT * FROM reservations WHERE id = ?", [lastID]);

    // ── Notification ───────────────────────────────────────────────────────
    const isPending = status === "PENDING";
    const bookerUser = { ...req.user, email: notification_email || req.user.email };

    notifyUser({
      userId: req.user.id,
      bookingId: lastID,
      type: "BOOKING_CREATED",
      title: isPending ? "⏳ Booking Pending Approval" : "✅ Booking Confirmed",
      message: isPending
        ? `Your booking (${booking_code}) for "${resource.name}" on ${booking_date} is pending approval.`
        : `Your booking (${booking_code}) for "${resource.name}" on ${booking_date} from ${start_time}–${end_time} is confirmed.`,
      emailAction: emailService.sendBookingCreatedEmail,
      emailArgs: [bookerUser, booking, resource]
    }).catch((e) => console.error("[Reservation] Notify error:", e.message));

    return res.status(201).json({
      message: isPending ? "Booking submitted and pending approval." : "Booking confirmed.",
      booking,
      resource: { id: resource.id, name: resource.name, location: resource.location }
    });
  } catch (err) {
    console.error("[POST /reservations]", err);
    res.status(500).json({ error: "Failed to create reservation." });
  }
});

// ── GET /api/reservations/pending & /api/reservations/pending-approvals ───────
const getPendingApprovals = async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT r.*,
              res.name AS resource_name, res.name AS name, res.category AS resource_category,
              res.location AS resource_location, res.location AS location, res.capacity AS resource_capacity,
              u.full_name AS full_name, u.full_name AS student_name, u.full_name AS user_name,
              u.email AS email, u.email AS student_email, u.email AS user_email,
              u.role AS user_role, u.department AS user_department
       FROM reservations r
       JOIN resources res ON r.resource_id = res.id
       JOIN users u ON r.user_id = u.id
       WHERE r.status = 'PENDING'
       ORDER BY r.created_at ASC`,
      []
    );
    res.json({ success: true, reservations: rows, bookings: rows, count: rows.length });
  } catch (err) {
    console.error("[GET /reservations/pending]", err);
    res.status(500).json({ success: false, error: "Failed to fetch pending reservations." });
  }
};

router.get("/pending", authenticateToken, requireRole(["FACULTY", "ADMIN"]), getPendingApprovals);
router.get("/pending-approvals", authenticateToken, requireRole(["FACULTY", "ADMIN"]), getPendingApprovals);

// ── GET /api/reservations/my ──────────────────────────────────────────────────
router.get("/my", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT r.*, res.name AS resource_name, res.category AS resource_category, res.location, res.capacity
       FROM reservations r
       JOIN resources res ON r.resource_id = res.id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, reservations: rows, bookings: rows, count: rows.length });
  } catch (err) {
    console.error("[GET /reservations/my]", err);
    res.status(500).json({ success: false, error: "Failed to fetch reservations." });
  }
});

// ── GET /api/reservations ─────────────────────────────────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    let rows;
    if (req.user.role === "STUDENT") {
      rows = await dbAll(
        `SELECT r.*, res.name AS resource_name, res.category, res.location, res.capacity
         FROM reservations r
         JOIN resources res ON r.resource_id = res.id
         WHERE r.user_id = ?
         ORDER BY r.created_at DESC`,
        [req.user.id]
      );
    } else {
      rows = await dbAll(
        `SELECT r.*,
                res.name AS resource_name, res.category, res.location, res.capacity,
                u.full_name AS booker_name, u.email AS booker_email, u.role AS booker_role, u.department AS booker_department
         FROM reservations r
         JOIN resources res ON r.resource_id = res.id
         JOIN users u ON r.user_id = u.id
         ORDER BY r.created_at DESC`,
        []
      );
    }
    res.json({ success: true, reservations: rows, bookings: rows, count: rows.length });
  } catch (err) {
    console.error("[GET /reservations]", err);
    res.status(500).json({ error: "Failed to fetch reservations." });
  }
});

// ── PATCH/PUT /api/reservations/:id/status ────────────────────────────────────
const updateReservationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!status || !["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ success: false, error: "Status must be either APPROVED or REJECTED." });
    }

    const booking = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    if (!booking) return res.status(404).json({ success: false, error: "Reservation not found." });
    if (booking.status !== "PENDING") {
      return res.status(400).json({ success: false, error: `Cannot update reservation with status "${booking.status}". Must be PENDING.` });
    }

    if (status === "APPROVED") {
      await dbRun(`UPDATE reservations SET status = 'APPROVED' WHERE id = ?`, [id]);
    } else {
      const rejectReason = (reason && reason.trim()) ? reason.trim() : "Institutional clearance declined.";
      await dbRun(`UPDATE reservations SET status = 'REJECTED', rejection_reason = ? WHERE id = ?`, [rejectReason, id]);
    }

    const updated = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    const resource = await dbGet("SELECT * FROM resources WHERE id = ?", [booking.resource_id]);
    const booker = await dbGet("SELECT * FROM users WHERE id = ?", [booking.user_id]);

    const isApprove = status === "APPROVED";
    notifyUser({
      userId: booking.user_id,
      bookingId: parseInt(id),
      type: isApprove ? "BOOKING_APPROVED" : "BOOKING_REJECTED",
      title: isApprove ? "✅ Booking Approved" : "❌ Booking Rejected",
      message: isApprove
        ? `Your booking (${booking.booking_code}) for "${resource ? resource.name : "Facility"}" on ${booking.booking_date} has been approved.`
        : `Your booking (${booking.booking_code}) for "${resource ? resource.name : "Facility"}" was rejected.${reason ? " Reason: " + reason : ""}`,
      emailAction: isApprove ? emailService.sendBookingApprovedEmail : emailService.sendBookingRejectedEmail,
      emailArgs: isApprove ? [booker, updated, resource] : [booker, updated, resource, reason]
    }).catch((e) => console.error("[StatusUpdate] Notify error:", e.message));

    if (emailService.sendReservationNotification && booker) {
      emailService.sendReservationNotification({
        to: booker.email,
        subject: isApprove ? `[Approved] Booking ${booking.booking_code} – ${resource?.name || "Facility"}` : `[Declined] Booking Request ${booking.booking_code}`,
        details: isApprove ? `Your booking for ${resource?.name || "Facility"} on ${booking.booking_date} (${booking.start_time}–${booking.end_time}) has been approved.` : `Your booking for ${resource?.name || "Facility"} on ${booking.booking_date} was rejected. Reason: ${reason || "Schedule conflict"}`,
        status
      }).catch((e) => console.error("[sendReservationNotification error]:", e.message));
    }

    res.json({ success: true, reservation: updated, booking: updated, message: `Reservation ${status.toLowerCase()}.` });
  } catch (err) {
    console.error("[PATCH/PUT /status]", err);
    res.status(500).json({ success: false, error: "Failed to update reservation status." });
  }
};

router.patch("/:id/status", authenticateToken, requireRole(["FACULTY", "ADMIN"]), updateReservationStatus);
router.put("/:id/status", authenticateToken, requireRole(["FACULTY", "ADMIN"]), updateReservationStatus);

// ── PATCH /api/reservations/:id/approve ──────────────────────────────────────
router.patch("/:id/approve", authenticateToken, requireRole(["FACULTY", "ADMIN"]), async (req, res) => {
  req.body = { status: "APPROVED" };
  return updateReservationStatus(req, res);
});

// ── PATCH /api/reservations/:id/reject ───────────────────────────────────────
router.patch("/:id/reject", authenticateToken, requireRole(["FACULTY", "ADMIN"]), async (req, res) => {
  req.body.status = "REJECTED";
  return updateReservationStatus(req, res);
});

// ── PATCH /api/reservations/:id/cancel ───────────────────────────────────────
router.patch("/:id/cancel", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    if (!booking) return res.status(404).json({ error: "Booking not found." });

    if (req.user.role !== "ADMIN" && booking.user_id !== req.user.id) {
      return res.status(403).json({ error: "You can only cancel your own bookings." });
    }

    const cancellableStatuses = ["PENDING", "APPROVED"];
    if (!cancellableStatuses.includes(booking.status)) {
      return res.status(400).json({ error: `Cannot cancel a booking with status "${booking.status}".` });
    }

    await dbRun(`UPDATE reservations SET status = 'CANCELLED' WHERE id = ?`, [id]);
    const updated = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    const resource = await dbGet("SELECT * FROM resources WHERE id = ?", [booking.resource_id]);
    const booker = await dbGet("SELECT * FROM users WHERE id = ?", [booking.user_id]);

    notifyUser({
      userId: booking.user_id,
      bookingId: parseInt(id),
      type: "BOOKING_CANCELLED",
      title: "🚫 Booking Cancelled",
      message: `Booking (${booking.booking_code}) for "${resource.name}" on ${booking.booking_date} has been cancelled.`,
      emailAction: emailService.sendBookingCancelledEmail,
      emailArgs: [booker, updated, resource]
    }).catch((e) => console.error("[Cancel] Notify error:", e.message));

    res.json({ success: true, message: "Booking cancelled.", booking: updated });
  } catch (err) {
    console.error("[PATCH /cancel]", err);
    res.status(500).json({ error: "Failed to cancel booking." });
  }
});

// ── PATCH /api/reservations/:id/check-in ─────────────────────────────────────
router.patch("/:id/check-in", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    if (!booking) return res.status(404).json({ error: "Booking not found." });

    if (req.user.role !== "ADMIN" && booking.user_id !== req.user.id) {
      return res.status(403).json({ error: "Access denied." });
    }
    if (booking.status !== "APPROVED") {
      return res.status(400).json({ error: `Cannot check in with status "${booking.status}". Must be APPROVED.` });
    }

    const now = new Date().toISOString();
    await dbRun(
      `UPDATE reservations SET status = 'CHECKED_IN', checked_in_at = ? WHERE id = ?`,
      [now, id]
    );
    const updated = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    const resource = await dbGet("SELECT * FROM resources WHERE id = ?", [booking.resource_id]);
    const booker = await dbGet("SELECT * FROM users WHERE id = ?", [booking.user_id]);

    notifyUser({
      userId: booking.user_id,
      bookingId: parseInt(id),
      type: "CHECK_IN",
      title: "📍 Checked In",
      message: `You have checked in for "${resource.name}" at ${now}.`,
      emailAction: emailService.sendCheckInEmail,
      emailArgs: [booker, updated, resource]
    }).catch((e) => console.error("[CheckIn] Notify error:", e.message));

    res.json({ success: true, message: "Checked in successfully.", booking: updated });
  } catch (err) {
    console.error("[PATCH /check-in]", err);
    res.status(500).json({ error: "Failed to check in." });
  }
});

// ── PATCH /api/reservations/:id/check-out ────────────────────────────────────
router.patch("/:id/check-out", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    if (!booking) return res.status(404).json({ error: "Booking not found." });

    if (req.user.role !== "ADMIN" && booking.user_id !== req.user.id) {
      return res.status(403).json({ error: "Access denied." });
    }
    if (booking.status !== "CHECKED_IN") {
      return res.status(400).json({ error: `Cannot check out with status "${booking.status}". Must be CHECKED_IN.` });
    }

    const now = new Date().toISOString();
    await dbRun(
      `UPDATE reservations SET status = 'COMPLETED', checked_out_at = ? WHERE id = ?`,
      [now, id]
    );
    const updated = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    const resource = await dbGet("SELECT * FROM resources WHERE id = ?", [booking.resource_id]);
    const booker = await dbGet("SELECT * FROM users WHERE id = ?", [booking.user_id]);

    notifyUser({
      userId: booking.user_id,
      bookingId: parseInt(id),
      type: "CHECK_OUT",
      title: "🏁 Session Completed",
      message: `Your session at "${resource.name}" has been completed. Thank you!`,
      emailAction: emailService.sendCheckOutEmail,
      emailArgs: [booker, updated, resource]
    }).catch((e) => console.error("[CheckOut] Notify error:", e.message));

    res.json({ success: true, message: "Checked out successfully. Session completed.", booking: updated });
  } catch (err) {
    console.error("[PATCH /check-out]", err);
    res.status(500).json({ error: "Failed to check out." });
  }
});

module.exports = router;
