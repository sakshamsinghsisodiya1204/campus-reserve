const nodemailer = require('nodemailer');
const db = require('../database');

// ── In-Memory Ethereal Cache for fallback ─────────────────────────────────────
let testAccountCache = null;
let testTransporterCache = null;

// ── Build HTML Email Template ────────────────────────────────────────────────
function buildEmailTemplate({ title, subtitle, badgeText, badgeColor, bodyHtml }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0b0f19;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f8fafc">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0b0f19;min-height:100vh;padding:40px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#131b2e;border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;box-shadow:0 20px 40px rgba(0,0,0,0.5)">
          <!-- Header -->
          <tr>
            <td style="padding:28px 32px;background:linear-gradient(135deg,rgba(59,130,246,0.12) 0%,rgba(139,92,246,0.12) 100%);border-bottom:1px solid rgba(255,255,255,0.08)">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#94a3b8;text-transform:uppercase;margin-bottom:6px">MIT World Peace University</div>
                    <div style="font-size:20px;font-weight:700;color:#ffffff;line-height:1.2">CampusReserve</div>
                    <div style="font-size:12px;color:#64748b;margin-top:2px">Smart Facility & Resource Allocation</div>
                  </td>
                  <td align="right" valign="top">
                    <span style="display:inline-block;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;background:${badgeColor}22;color:${badgeColor};border:1px solid ${badgeColor}44">
                      ${badgeText}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Title bar -->
          <tr>
            <td style="padding:24px 32px 12px 32px">
              <h1 style="margin:0 0 6px 0;font-size:18px;font-weight:600;color:#f8fafc">${title}</h1>
              <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.5">${subtitle}</p>
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td style="padding:12px 32px 28px 32px">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:#0d1424;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:#64748b;line-height:1.6">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    This is an automated academic communication from <strong>CampusReserve</strong>.<br>
                    Department of Campus Facilities & Operations · MIT-WPU Pune
                  </td>
                  <td align="right" style="font-family:monospace;color:#475569">
                    PBL-III · 2026
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// ── Render standard booking details table ─────────────────────────────────────
function renderBookingTable(booking, resource) {
  const code = booking.booking_code || 'CR-2026';
  const resourceName = resource ? resource.name : 'Allocated Facility';
  const category = resource ? resource.category : 'General Resource';
  const location = resource ? resource.location : 'Campus';
  const date = booking.booking_date || new Date().toISOString().split('T')[0];
  const time = `${booking.start_time} – ${booking.end_time}`;
  const purpose = booking.purpose || 'Academic session';

  return `
    <table role="presentation" width="100%" style="background:#0d1424;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px;margin:16px 0;font-size:13px;color:#cbd5e1">
      <tr>
        <td style="padding:6px 0;color:#64748b;width:35%">Booking Reference:</td>
        <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#38bdf8">${code}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#64748b">Facility / Resource:</td>
        <td style="padding:6px 0;font-weight:600;color:#f8fafc">${resourceName} <span style="font-size:11px;color:#94a3b8">(${category})</span></td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#64748b">Location:</td>
        <td style="padding:6px 0;color:#f8fafc">${location}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#64748b">Reservation Date:</td>
        <td style="padding:6px 0;color:#f8fafc">${date}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#64748b">Time Window:</td>
        <td style="padding:6px 0;font-weight:600;color:#38bdf8">${time}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#64748b">Stated Purpose:</td>
        <td style="padding:6px 0;color:#e2e8f0;font-style:italic">"${purpose}"</td>
      </tr>
    </table>
  `;
}

// ── Log email to DB ───────────────────────────────────────────────────────────
function logEmail({ userId, recipientEmail, eventType, subject, status, previewUrl, errorMessage }) {
  return new Promise((resolve) => {
    db.run(
      `INSERT INTO email_logs (user_id, recipient_email, event_type, subject, status, preview_url, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId || null, recipientEmail, eventType, subject, status, previewUrl || null, errorMessage || null],
      function (err) {
        if (err) console.error('[emailService] DB log failed:', err.message);
        resolve(this ? this.lastID : null);
      }
    );
  });
}

// ── Core Dispatcher ───────────────────────────────────────────────────────────
async function dispatchEmail({ userId, recipientEmail, eventType, subject, html, text }) {
  const actualTo = recipientEmail || process.env.SMTP_USER;
  const isGmailConfigured = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

  if (isGmailConfigured) {
    try {
      const cleanPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 465,
        secure: true,
        auth: {
          user: process.env.SMTP_USER,
          pass: cleanPass
        },
        tls: { rejectUnauthorized: false }
      });

      const info = await transporter.sendMail({
        from: `"CampusReserve Portal" <${process.env.SMTP_USER}>`,
        to: actualTo,
        subject,
        html,
        text: text || subject
      });

      console.log(`[EmailService] Gmail SMTP → SENT to: ${actualTo} | Subject: ${subject}`);
      await logEmail({ userId, recipientEmail: actualTo, eventType, subject, status: 'SENT' });
      return { status: 'SENT', recipient: actualTo, messageId: info.messageId };
    } catch (err) {
      console.error(`[EmailService] Gmail SMTP error for ${actualTo}:`, err.message);
      await logEmail({ userId, recipientEmail: actualTo, eventType, subject, status: 'FAILED', errorMessage: err.message });
      // Fallback to simulated delivery below
    }
  }

  // Fallback: Ethereal simulated transport
  try {
    if (!testAccountCache) {
      testAccountCache = await nodemailer.createTestAccount();
      testTransporterCache = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccountCache.user, pass: testAccountCache.pass }
      });
      console.log(`[EmailService] Ethereal fallback initialized: ${testAccountCache.user}`);
    }

    const info = await testTransporterCache.sendMail({
      from: '"CampusReserve Portal" <notifications@mitwpu.edu.in>',
      to: actualTo,
      subject,
      html,
      text: text || subject
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log(`[EmailService] Simulated dispatch to: ${actualTo}`);
    if (previewUrl) console.log(`[EmailService] Preview: ${previewUrl}`);

    await logEmail({ userId, recipientEmail: actualTo, eventType, subject, status: 'SIMULATED', previewUrl });
    return { status: 'SIMULATED', recipient: actualTo, previewUrl, messageId: info.messageId };
  } catch (simErr) {
    console.error(`[EmailService] Simulation error:`, simErr.message);
    await logEmail({ userId, recipientEmail: actualTo, eventType, subject, status: 'FAILED', errorMessage: simErr.message });
    return { status: 'FAILED', error: simErr.message };
  }
}

// ── Registration Welcome Email ────────────────────────────────────────────────
async function sendRegistrationEmail(user) {
  const subject = `Welcome to CampusReserve, ${user.full_name.split(' ')[0]}`;
  const html = buildEmailTemplate({
    title: 'Account Successfully Registered',
    subtitle: 'Your institutional portal access credentials have been provisioned.',
    badgeText: user.role || 'STUDENT',
    badgeColor: user.role === 'ADMIN' ? '#fbbf24' : user.role === 'FACULTY' ? '#60a5fa' : '#34d399',
    bodyHtml: `
      <p style="font-size:13px;color:#cbd5e1;margin-bottom:12px">Hello <strong>${user.full_name}</strong>,</p>
      <p style="font-size:13px;color:#94a3b8;line-height:1.6">
        Welcome to <strong>CampusReserve</strong> — the centralized reservation and equipment allocation engine for MIT World Peace University.
      </p>
      <table role="presentation" width="100%" style="background:#0d1424;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:14px;margin:16px 0;font-size:13px">
        <tr><td style="color:#64748b;padding:4px 0">Email:</td><td style="color:#f8fafc;font-family:monospace">${user.email}</td></tr>
        <tr><td style="color:#64748b;padding:4px 0">Department:</td><td style="color:#f8fafc">${user.department || 'General'}</td></tr>
        <tr><td style="color:#64748b;padding:4px 0">Role:</td><td style="color:#38bdf8;font-weight:600">${user.role}</td></tr>
      </table>
    `
  });
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'USER_REGISTERED', subject, html });
}

// ── Booking created email ─────────────────────────────────────────────────────
async function sendBookingCreatedEmail(user, booking, resource) {
  const isPending = booking.status === 'PENDING';
  const subject = isPending
    ? `[Pending Approval] Booking Request ${booking.booking_code} – ${resource?.name || 'Facility'}`
    : `[Confirmed] Booking ${booking.booking_code} – ${resource?.name || 'Facility'}`;
  const html = buildEmailTemplate({
    title: isPending ? 'Reservation Request Submitted' : 'Reservation Confirmed',
    subtitle: isPending
      ? 'Your request requires institutional clearance before confirmation.'
      : 'Your reservation has been automatically confirmed.',
    badgeText: isPending ? 'PENDING REVIEW' : 'CONFIRMED',
    badgeColor: isPending ? '#fbbf24' : '#34d399',
    bodyHtml: `
      <p style="font-size:13px;color:#cbd5e1;margin-bottom:12px">Hello <strong>${user.full_name}</strong>,</p>
      ${renderBookingTable(booking, resource)}
      <div style="margin-top:14px;padding:12px;border-radius:6px;border-left:3px solid ${isPending ? '#f59e0b' : '#10b981'};background:rgba(139,92,246,0.06);font-size:12px;color:${isPending ? '#fbbf24' : '#34d399'}">
        ${isPending
          ? 'ℹ️ A notification has been sent to Faculty/Admin. You will receive a status update email once reviewed.'
          : '✓ Your session is locked in. Present booking code <strong>' + booking.booking_code + '</strong> at check-in.'}
      </div>
    `
  });
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'BOOKING_CREATED', subject, html });
}

// ── Booking approved email ────────────────────────────────────────────────────
async function sendBookingApprovedEmail(user, booking, resource) {
  const subject = `[Approved] Booking ${booking.booking_code} – ${resource?.name || 'Facility'}`;
  const html = buildEmailTemplate({
    title: 'Facility Booking Approved ✓',
    subtitle: 'Faculty / Facility Management has formally approved your reservation.',
    badgeText: 'APPROVED',
    badgeColor: '#34d399',
    bodyHtml: `
      <p style="font-size:13px;color:#cbd5e1;margin-bottom:12px">Hello <strong>${user.full_name}</strong>,</p>
      ${renderBookingTable(booking, resource)}
      <div style="margin-top:14px;padding:12px;border-radius:6px;border-left:3px solid #10b981;background:rgba(16,185,129,0.06);font-size:12px;color:#34d399">
        ✓ Your access credentials are now active. Present booking code <strong>${booking.booking_code}</strong> at check-in.
      </div>
    `
  });
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'BOOKING_APPROVED', subject, html });
}

// ── Booking rejected email ────────────────────────────────────────────────────
async function sendBookingRejectedEmail(user, booking, resource, reason) {
  const subject = `[Declined] Booking Request ${booking.booking_code}`;
  const html = buildEmailTemplate({
    title: 'Booking Request Declined',
    subtitle: 'The requested facility cannot be allocated for the specified time slot.',
    badgeText: 'DECLINED',
    badgeColor: '#f87171',
    bodyHtml: `
      <p style="font-size:13px;color:#cbd5e1;margin-bottom:12px">Hello <strong>${user.full_name}</strong>,</p>
      ${renderBookingTable(booking, resource)}
      <div style="margin-top:14px;padding:12px;border-radius:6px;border-left:3px solid #ef4444;background:rgba(239,68,68,0.06)">
        <div style="font-size:11px;font-weight:700;color:#f87171;text-transform:uppercase">Rejection Reason:</div>
        <div style="font-size:13px;color:#fca5a5;margin-top:4px">${reason || 'Institutional schedule conflict.'}</div>
      </div>
      <p style="font-size:12px;color:#64748b;margin-top:14px">You may select an alternative time slot on the portal.</p>
    `
  });
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'BOOKING_REJECTED', subject, html });
}

// ── Booking cancelled / revoked email ─────────────────────────────────────────
async function sendBookingCancelledEmail(user, booking, resource, reason) {
  const subject = `[Cancelled] Booking ${booking.booking_code} – ${resource?.name || 'Facility'}`;
  const html = buildEmailTemplate({
    title: 'Booking Revoked / Cancelled',
    subtitle: 'The facility reservation has been cancelled and the slot released.',
    badgeText: 'CANCELLED',
    badgeColor: '#94a3b8',
    bodyHtml: `
      <p style="font-size:13px;color:#cbd5e1;margin-bottom:12px">Hello <strong>${user.full_name}</strong>,</p>
      ${renderBookingTable(booking, resource)}
      ${reason ? `
      <div style="margin-top:14px;padding:12px;border-radius:6px;border-left:3px solid #94a3b8;background:rgba(148,163,184,0.06)">
        <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase">Cancellation Reason:</div>
        <div style="font-size:13px;color:#cbd5e1;margin-top:4px">${reason}</div>
      </div>` : ''}
    `
  });
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'BOOKING_CANCELLED', subject, html });
}

// ── Check-in / Check-out emails ───────────────────────────────────────────────
async function sendCheckInEmail(user, booking, resource) {
  const subject = `[Check-In] ${booking.booking_code} – ${resource?.name || 'Facility'}`;
  const html = buildEmailTemplate({
    title: 'Digital Check-In Confirmed',
    subtitle: 'Arrival registered. Facility allocation is active.',
    badgeText: 'CHECKED IN',
    badgeColor: '#38bdf8',
    bodyHtml: `<p style="font-size:13px;color:#cbd5e1;margin-bottom:12px">Hello <strong>${user.full_name}</strong>,</p>${renderBookingTable(booking, resource)}`
  });
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'CHECK_IN', subject, html });
}

async function sendCheckOutEmail(user, booking, resource) {
  const subject = `[Session Completed] ${booking.booking_code} – ${resource?.name || 'Facility'}`;
  const html = buildEmailTemplate({
    title: 'Session Successfully Completed',
    subtitle: 'Equipment returned and facility released.',
    badgeText: 'COMPLETED',
    badgeColor: '#8b5cf6',
    bodyHtml: `<p style="font-size:13px;color:#cbd5e1;margin-bottom:12px">Hello <strong>${user.full_name}</strong>,</p>${renderBookingTable(booking, resource)}`
  });
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'CHECK_OUT', subject, html });
}

// ── Universal Reservation Notification Dispatcher ──────────────────────────
async function sendReservationNotification({ to, subject, details, status }) {
  const isApproved  = status === "APPROVED";
  const isRejected  = status === "REJECTED";
  const isPending   = status === "PENDING";
  const isCancelled = status === "CANCELLED";

  const badgeColor = isApproved ? "#34d399" : isRejected ? "#f87171" : isCancelled ? "#94a3b8" : "#fbbf24";
  const badgeText  = status || "NOTIFICATION";
  const title      = isApproved
    ? "Facility Booking Approved ✓"
    : isRejected
    ? "Booking Request Declined"
    : isCancelled
    ? "Facility Booking Revoked / Cancelled"
    : "Reservation Status Update";
  const subtitle   = isApproved
    ? "Faculty / Facility Management has formally approved your reservation."
    : isRejected
    ? "The requested facility cannot be allocated for the specified time slot."
    : isCancelled
    ? "Your facility allocation has been revoked or cancelled."
    : "Your reservation request status has been updated.";

  const bodyHtml = typeof details === "string" ? `<p style="font-size:13px;color:#cbd5e1;margin-bottom:12px">${details}</p>` : `
    <p style="font-size:13px;color:#cbd5e1;margin-bottom:12px">Your reservation status has been updated to <strong>${status}</strong>.</p>
  `;

  const html = buildEmailTemplate({
    title,
    subtitle,
    badgeText,
    badgeColor,
    bodyHtml
  });

  return dispatchEmail({
    recipientEmail: to,
    eventType: isApproved ? "BOOKING_APPROVED" : isRejected ? "BOOKING_REJECTED" : isCancelled ? "BOOKING_CANCELLED" : "BOOKING_UPDATED",
    subject: subject || `[${status}] CampusReserve Reservation Notification`,
    html
  });
}

module.exports = {
  sendReservationNotification,
  sendRegistrationEmail,
  sendBookingCreatedEmail,
  sendBookingApprovedEmail,
  sendBookingRejectedEmail,
  sendBookingCancelledEmail,
  sendCheckInEmail,
  sendCheckOutEmail
};
