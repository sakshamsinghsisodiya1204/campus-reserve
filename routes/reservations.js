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

    // ── 1. Resource Collision Check (Physical Resource Availability) ──────
    const resourceConflict = await dbGet(
      `SELECT id, booking_code FROM reservations
       WHERE resource_id = ?
         AND booking_date = ?
         AND status IN ('PENDING', 'APPROVED', 'CHECKED_IN')
         AND (start_time < ? AND end_time > ?)`,
      [resource_id, booking_date, end_time, start_time]
    );

    if (resourceConflict) {
      return res.status(409).json({
        error: `Time slot conflict. "${resource.name}" is already booked (Booking: ${resourceConflict.booking_code}) for the overlapping time window on ${booking_date}.`,
        conflicting_booking_code: resourceConflict.booking_code
      });
    }

    // ── 2. User Time-Slot Overlap Guard (Cross-Resource Collision Defense) ──
    const userConflict = await dbGet(
      `SELECT id, booking_code, resource_id FROM reservations
       WHERE user_id = ?
         AND booking_date = ?
         AND status IN ('PENDING', 'APPROVED', 'CHECKED_IN')
         AND (start_time < ? AND end_time > ?)`,
      [req.user.id, booking_date, end_time, start_time]
    );

    if (userConflict) {
      return res.status(409).json({
        error: "Schedule conflict: You already have an active reservation for another resource during this time slot.",
        conflicting_booking_code: userConflict.booking_code
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

    if (emailService.sendReservationNotification && bookerUser.email) {
      emailService.sendReservationNotification({
        to: bookerUser.email,
        subject: isPending
          ? `[Pending Approval] Booking Request ${booking_code} – ${resource.name}`
          : `[Confirmed] Booking ${booking_code} – ${resource.name}`,
        details: isPending
          ? `Your booking request (${booking_code}) for ${resource.name} on ${booking_date} (${start_time}–${end_time}) requires institutional clearance.`
          : `Your booking (${booking_code}) for ${resource.name} on ${booking_date} (${start_time}–${end_time}) has been confirmed.`,
        status
      }).catch((e) => console.error("[sendReservationNotification error]:", e.message));
    }

    return res.status(201).json({
      message: isPending ? "Booking submitted and pending approval." : "Booking confirmed.",
      booking: {
        ...booking,
        resource_name: resource.name,
        resource_category: resource.category,
        location: resource.location
      }
    });
  } catch (err) {
    console.error("[POST /api/reservations]", err);
    res.status(500).json({ error: "Failed to create reservation." });
  }
});

// ── GET /api/reservations ─────────────────────────────────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { status, date, resource_id } = req.query;
    let query = `
      SELECT r.*, res.name as resource_name, res.category as resource_category,
             res.location as resource_location, u.full_name as user_name, u.email as user_email
      FROM reservations r
      JOIN resources res ON r.resource_id = res.id
      JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === "STUDENT") {
      query += " AND r.user_id = ?";
      params.push(req.user.id);
    }
    if (status) {
      query += " AND r.status = ?";
      params.push(status);
    }
    if (date) {
      query += " AND r.booking_date = ?";
      params.push(date);
    }
    if (resource_id) {
      query += " AND r.resource_id = ?";
      params.push(resource_id);
    }

    query += " ORDER BY r.booking_date DESC, r.start_time DESC LIMIT 100";

    const reservations = await dbAll(query, params);
    res.json({ reservations, count: reservations.length });
  } catch (err) {
    console.error("[GET /api/reservations]", err);
    res.status(500).json({ error: "Failed to fetch reservations." });
  }
});

// ── GET /api/reservations/pending ─────────────────────────────────────────────
router.get("/pending", authenticateToken, requireRole(["FACULTY", "ADMIN"]), async (req, res) => {
  try {
    const query = `
      SELECT r.*, res.name as resource_name, res.category as resource_category,
             res.location as resource_location, u.full_name as student_name, u.email as student_email,
             u.department as student_dept
      FROM reservations r
      JOIN resources res ON r.resource_id = res.id
      JOIN users u ON r.user_id = u.id
      WHERE r.status = 'PENDING'
      ORDER BY r.created_at ASC
    `;
    const pending = await dbAll(query, []);
    res.json({ reservations: pending, bookings: pending, count: pending.length });
  } catch (err) {
    console.error("[GET /api/reservations/pending]", err);
    res.status(500).json({ error: "Failed to fetch pending approvals." });
  }
});

// ── GET /api/reservations/my ──────────────────────────────────────────────────
router.get("/my", authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT r.*, res.name as resource_name, res.category as resource_category,
             res.location as resource_location
      FROM reservations r
      JOIN resources res ON r.resource_id = res.id
      WHERE r.user_id = ?
      ORDER BY r.booking_date DESC, r.start_time DESC
    `;
    const bookings = await dbAll(query, [req.user.id]);
    res.json({ reservations: bookings, bookings, count: bookings.length });
  } catch (err) {
    console.error("[GET /api/reservations/my]", err);
    res.status(500).json({ error: "Failed to fetch your bookings." });
  }
});

// ── GET /api/reservations/:id ─────────────────────────────────────────────────
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT r.*, res.name as resource_name, res.category as resource_category,
             res.location as resource_location, u.full_name as user_name, u.email as user_email
      FROM reservations r
      JOIN resources res ON r.resource_id = res.id
      JOIN users u ON r.user_id = u.id
      WHERE r.id = ?
    `;
    const booking = await dbGet(query, [id]);
    if (!booking) return res.status(404).json({ error: "Booking not found." });

    if (req.user.role === "STUDENT" && booking.user_id !== req.user.id) {
      return res.status(403).json({ error: "Access denied." });
    }

    res.json({ reservation: booking });
  } catch (err) {
    console.error("[GET /api/reservations/:id]", err);
    res.status(500).json({ error: "Failed to fetch reservation." });
  }
});

// ── Status Update Helper (Approve / Reject) ───────────────────────────────────
const updateReservationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be APPROVED or REJECTED." });
    }

    const booking = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    if (!booking) return res.status(404).json({ error: "Reservation not found." });

    if (booking.status !== "PENDING") {
      return res.status(400).json({ error: `Reservation is already in "${booking.status}" status.` });
    }

    // If approving, verify no new collision occurred in the interim
    if (status === "APPROVED") {
      const conflict = await dbGet(
        `SELECT id, booking_code FROM reservations
         WHERE resource_id = ?
           AND booking_date = ?
           AND id != ?
           AND status IN ('APPROVED', 'CHECKED_IN')
           AND (start_time < ? AND end_time > ?)`,
        [booking.resource_id, booking.booking_date, id, booking.end_time, booking.start_time]
      );
      if (conflict) {
        return res.status(409).json({
          error: `Cannot approve: Resource was already booked by another confirmed reservation (${conflict.booking_code}).`
        });
      }
    }

    await dbRun(
      `UPDATE reservations SET status = ?, rejection_reason = ? WHERE id = ?`,
      [status, reason || null, id]
    );

    const updated = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    const resource = await dbGet("SELECT * FROM resources WHERE id = ?", [booking.resource_id]);
    const booker = await dbGet("SELECT * FROM users WHERE id = ?", [booking.user_id]);

    const isApprove = status === "APPROVED";
    notifyUser({
      userId: booking.user_id,
      bookingId: parseInt(id),
      type: isApprove ? "BOOKING_APPROVED" : "BOOKING_REJECTED",
      title: isApprove ? "✅ Booking Approved" : "❌ Booking Declined",
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
router.patch("/:id/approve", authenticateToken, requireRole(["FACULTY", "ADMIN"]), async (req, res) => {
  req.body = { status: "APPROVED" };
  return updateReservationStatus(req, res);
});
router.patch("/:id/reject", authenticateToken, requireRole(["FACULTY", "ADMIN"]), async (req, res) => {
  req.body.status = "REJECTED";
  return updateReservationStatus(req, res);
});

// ── CANCELLATION & ADMINISTRATIVE REVOCATION OVERRIDE ─────────────────────────
// PATCH /api/reservations/:id/cancel & DELETE /api/reservations/:id/cancel
const cancelReservationHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const booking = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    if (!booking) return res.status(404).json({ error: "Booking not found." });

    const isAdmin = req.user.role === "ADMIN";
    const isOwner = booking.user_id === req.user.id;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: "Access denied. Only an Administrator or the reservation owner can cancel this booking." });
    }

    const cancellableStatuses = ["PENDING", "APPROVED"];
    if (!cancellableStatuses.includes(booking.status)) {
      return res.status(400).json({ error: `Cannot cancel a booking with status "${booking.status}". Must be PENDING or APPROVED.` });
    }

    const cancellationReason = reason && reason.trim() 
      ? reason.trim() 
      : (isAdmin && !isOwner ? "Administrative revocation by campus management." : "Cancelled by user.");

    await dbRun(
      `UPDATE reservations SET status = 'CANCELLED', rejection_reason = ? WHERE id = ?`,
      [cancellationReason, id]
    );

    const updated = await dbGet("SELECT * FROM reservations WHERE id = ?", [id]);
    const resource = await dbGet("SELECT * FROM resources WHERE id = ?", [booking.resource_id]);
    const booker = await dbGet("SELECT * FROM users WHERE id = ?", [booking.user_id]);

    const title = isAdmin && !isOwner ? "⚠️ Booking Revoked by Admin" : "🚫 Booking Cancelled";
    const message = isAdmin && !isOwner
      ? `Your booking (${booking.booking_code}) for "${resource.name}" on ${booking.booking_date} was revoked by administration. Reason: ${cancellationReason}`
      : `Booking (${booking.booking_code}) for "${resource.name}" on ${booking.booking_date} has been cancelled.`;

    notifyUser({
      userId: booking.user_id,
      bookingId: parseInt(id),
      type: "BOOKING_CANCELLED",
      title,
      message,
      emailAction: emailService.sendBookingCancelledEmail,
      emailArgs: [booker, updated, resource, cancellationReason]
    }).catch((e) => console.error("[Cancel] Notify error:", e.message));

    if (emailService.sendReservationNotification && booker) {
      emailService.sendReservationNotification({
        to: booker.email,
        subject: `[Cancelled] Booking ${booking.booking_code} – ${resource?.name || "Facility"}`,
        details: message,
        status: "CANCELLED"
      }).catch((e) => console.error("[Cancel sendReservationNotification error]:", e.message));
    }

    res.json({
      success: true,
      message: isAdmin && !isOwner ? "Reservation administratively revoked and slot released." : "Booking cancelled.",
      booking: updated
    });
  } catch (err) {
    console.error("[Cancel reservation error]", err);
    res.status(500).json({ error: "Failed to cancel booking." });
  }
};

router.patch("/:id/cancel", authenticateToken, cancelReservationHandler);
router.delete("/:id/cancel", authenticateToken, cancelReservationHandler);
router.delete("/:id", authenticateToken, cancelReservationHandler);

// ── Check-In / Check-Out Handlers ─────────────────────────────────────────────
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
