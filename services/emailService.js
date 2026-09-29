const db = require('../database');
const nodemailer = require('nodemailer');

// ── Gmail SMTP Transporter (with Ethereal fallback) ───────────────────────────
let _transporter = null;
let _isEthereal = false;

async function getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const cleanPass = process.env.SMTP_PASS.replace(/\s+/g, '');
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.gmail.com',
      port:   Number(process.env.SMTP_PORT) || 465,
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth:   { user: process.env.SMTP_USER, pass: cleanPass }
    });
    _isEthereal = false;
    console.log('[EmailService] Gmail SMTP ready →', process.env.SMTP_USER);
  } else {
    console.log('[EmailService] No SMTP_USER — generating Ethereal test account...');
    const acc = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email', port: 587, secure: false,
      auth: { user: acc.user, pass: acc.pass }
    });
    _isEthereal = true;
    console.log('[EmailService] Ethereal test account:', acc.user);
  }
  return _transporter;
}

// ── Booking details table (shared HTML snippet) ───────────────────────────────
function renderBookingTable(booking, resource) {
  const row = (label, value) =>
    `<tr>
      <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.6px;width:130px">${label}</td>
      <td style="padding:6px 0;font-size:13px;color:#e2e8f0">${value}</td>
    </tr>`;
  return `
    <table style="width:100%;border-collapse:collapse;background:rgba(255,255,255,0.03);border:1px solid #1e2338;border-radius:6px;padding:14px;margin-top:10px" cellpadding="0" cellspacing="0">
      ${row('Booking Code', `<code style="font-family:monospace;color:#818cf8">${booking.booking_code || '—'}</code>`)}
      ${row('Resource', resource ? resource.name : '—')}
      ${row('Location', resource ? (resource.location || '—') : '—')}
      ${row('Date', booking.booking_date || '—')}
      ${row('Time Window', `${booking.start_time} – ${booking.end_time}`)}
      ${row('Status', `<span style="color:${booking.status==='APPROVED'?'#34d399':booking.status==='PENDING'?'#fbbf24':'#f87171'}">${booking.status}</span>`)}
      ${booking.purpose ? row('Purpose', booking.purpose) : ''}
    </table>`;
}

// ── Email HTML template ───────────────────────────────────────────────────────
function buildEmailTemplate({ title, subtitle, badgeText = 'NOTIFICATION', badgeColor = '#818cf8', bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#090810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f1f5f9">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#090810;padding:32px 16px">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:rgba(18,16,28,0.95);border:1px solid rgba(139,92,246,0.25);border-radius:10px;overflow:hidden">
        <tr><td style="height:3px;background:linear-gradient(90deg,#8b5cf6,#6366f1,#38bdf8)"></td></tr>
        <tr><td style="padding:24px 28px 16px;border-bottom:1px solid rgba(255,255,255,0.07)">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><span style="font-size:15px;font-weight:700;color:#fff">✦ CampusReserve</span>
              <span style="display:block;font-size:10px;color:#64748b;margin-top:2px;text-transform:uppercase;letter-spacing:1px">MIT World Peace University</span></td>
            <td align="right"><span style="padding:3px 9px;font-size:10px;font-weight:700;color:${badgeColor};border:1px solid ${badgeColor};border-radius:4px;font-family:monospace;background:rgba(139,92,246,0.08)">${badgeText}</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#f1f5f9;letter-spacing:-.4px">${title}</h1>
          <p style="margin:0 0 20px;font-size:13px;color:#94a3b8;line-height:1.5">${subtitle}</p>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 28px;background:rgba(0,0,0,0.3);border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:#475569;line-height:1.5">
          This is an automated dispatch from CampusReserve — MIT-WPU Academic Allocation System. Do not reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ── Core dispatch + email_logs persistence ────────────────────────────────────
async function dispatchEmail({ userId, recipientEmail, eventType, subject, html }) {
  const to = recipientEmail || process.env.SMTP_USER || 'no-reply@campusreserve.in';
  let status = 'FAILED';
  let previewUrl = null;
  let errorMessage = null;

  try {
    const transporter = await getTransporter();
    const fromAddr = process.env.EMAIL_FROM || `"CampusReserve" <${process.env.SMTP_USER || 'noreply@campusreserve.in'}>`;
    const info = await transporter.sendMail({ from: fromAddr, to, subject, html });

    if (_isEthereal) {
      previewUrl = nodemailer.getTestMessageUrl(info) || null;
      console.log(`\n============================================================`);
      console.log(`[EmailService] LIVE EMAIL DISPATCHED to: ${to}`);
      console.log(`Subject: ${subject}`);
      if (previewUrl) console.log(`Preview URL: ${previewUrl}`);
      console.log(`============================================================\n`);
    } else {
      console.log(`[EmailService] Gmail SMTP → SENT to: ${to} | Subject: ${subject}`);
    }
    status = 'SENT';
  } catch (err) {
    errorMessage = err.message;
    console.error(`[EmailService] FAILED to send to ${to}: ${err.message}`);
  }

  // Persist to email_logs (non-blocking)
  try {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO email_logs (user_id, recipient_email, event_type, subject, status, preview_url, error_message) VALUES (?,?,?,?,?,?,?)`,
        [userId || null, to, eventType, subject, status, previewUrl, errorMessage],
        (e) => (e ? reject(e) : resolve())
      );
    });
  } catch (dbErr) {
    console.error('[EmailService] DB log error:', dbErr.message);
  }

  return { status, previewUrl, to };
}

// ── Registration welcome email ─────────────────────────────────────────────────
async function sendRegistrationEmail(user) {
  const subject = `Welcome to CampusReserve, ${user.full_name}`;
  const html = buildEmailTemplate({
    title: 'Your account is ready',
    subtitle: 'You have been granted access to the MIT-WPU Academic Allocation System.',
    badgeText: 'ACCOUNT ACTIVE',
    badgeColor: '#34d399',
    bodyHtml: `
      <p style="font-size:13px;color:#cbd5e1;margin-bottom:12px">Hello <strong>${user.full_name}</strong>, your CampusReserve account has been provisioned with the following credentials:</p>
      <table style="width:100%;border-collapse:collapse" cellpadding="0" cellspacing="0">
        <tr><td style="padding:5px 0;font-size:12px;color:#64748b;width:130px">Full Name</td><td style="font-size:13px;color:#e2e8f0">${user.full_name}</td></tr>
        <tr><td style="padding:5px 0;font-size:12px;color:#64748b">Email</td><td style="font-size:13px;color:#e2e8f0;font-family:monospace">${user.email}</td></tr>
        <tr><td style="padding:5px 0;font-size:12px;color:#64748b">Role</td><td style="font-size:13px;color:#818cf8;font-weight:700">${user.role}</td></tr>
        <tr><td style="padding:5px 0;font-size:12px;color:#64748b">Department</td><td style="font-size:13px;color:#e2e8f0">${user.department || '—'}</td></tr>
      </table>
      <p style="font-size:12px;color:#64748b;margin-top:16px">You can now reserve laboratories, seminar halls, and specialized hardware at http://localhost:3000</p>
    `
  });
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'REGISTRATION', subject, html });
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

// ── Booking cancelled email ───────────────────────────────────────────────────
async function sendBookingCancelledEmail(user, booking, resource) {
  const subject = `[Cancelled] Booking ${booking.booking_code}`;
  const html = buildEmailTemplate({
    title: 'Booking Cancelled',
    subtitle: 'The facility reservation has been released.',
    badgeText: 'CANCELLED',
    badgeColor: '#94a3b8',
    bodyHtml: `
      <p style="font-size:13px;color:#cbd5e1;margin-bottom:12px">Hello <strong>${user.full_name}</strong>,</p>
      ${renderBookingTable(booking, resource)}
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
  const isApproved = status === "APPROVED";
  const isRejected = status === "REJECTED";
  const isPending  = status === "PENDING";
  const badgeColor = isApproved ? "#34d399" : isRejected ? "#f87171" : "#fbbf24";
  const badgeText  = status || "NOTIFICATION";
  const title      = isApproved ? "Facility Booking Approved ✓" : isRejected ? "Booking Request Declined" : "Reservation Status Update";
  const subtitle   = isApproved
    ? "Faculty / Facility Management has formally approved your reservation."
    : isRejected
    ? "The requested facility cannot be allocated for the specified time slot."
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
    eventType: isApproved ? "BOOKING_APPROVED" : isRejected ? "BOOKING_REJECTED" : "BOOKING_UPDATED",
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
