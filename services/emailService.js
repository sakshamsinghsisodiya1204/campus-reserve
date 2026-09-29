const db = require('../database');

// ─── HTML Email Template Helper ────────────────────────────────────────────────
function buildEmailTemplate({ title, subtitle, bodyHtml, color = '#4f46e5' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,${color} 0%,#7c3aed 100%);padding:36px 40px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">🎓 CampusReserve</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:4px;letter-spacing:2px;text-transform:uppercase;">MIT-WPU Facility Booking</div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 8px;font-size:22px;color:#1e293b;">${title}</h2>
            <p style="margin:0 0 24px;color:#64748b;font-size:14px;">${subtitle}</p>
            ${bodyHtml}
            <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8;">
              This is an automated notification from the CampusReserve system.<br>
              MIT-WPU, Pune | Campus Operations
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function infoRow(label, value) {
  return `<tr>
    <td style="padding:8px 12px;background:#f8fafc;border-radius:6px;font-size:13px;color:#64748b;font-weight:600;width:140px;">${label}</td>
    <td style="padding:8px 12px;font-size:13px;color:#1e293b;">${value}</td>
  </tr>`;
}

function bookingTable(booking, resource) {
  return `<table width="100%" cellpadding="0" cellspacing="6" style="background:#f8fafc;border-radius:10px;padding:16px;margin:16px 0;">
    ${infoRow('📋 Booking Code', `<strong>${booking.booking_code}</strong>`)}
    ${infoRow('🏛️ Resource', resource ? resource.name : booking.resource_name || '—')}
    ${infoRow('📍 Location', resource ? resource.location : booking.location || '—')}
    ${infoRow('📅 Date', booking.booking_date)}
    ${infoRow('⏰ Time', `${booking.start_time} – ${booking.end_time}`)}
    ${infoRow('🎯 Purpose', booking.purpose)}
    ${infoRow('📊 Status', booking.status || '—')}
  </table>`;
}

// ─── Templates ─────────────────────────────────────────────────────────────────

function getRegistrationTemplate(user) {
  return {
    subject: '🎉 Welcome to CampusReserve, MIT-WPU!',
    html: buildEmailTemplate({
      title: `Welcome, ${user.full_name}!`,
      subtitle: 'Your CampusReserve account has been created successfully.',
      color: '#059669',
      bodyHtml: `
        <p style="color:#475569;line-height:1.7;">You now have access to book facilities and equipment across the MIT-WPU campus.</p>
        <table width="100%" cellpadding="0" cellspacing="6" style="background:#f0fdf4;border-radius:10px;padding:16px;margin:16px 0;border:1px solid #bbf7d0;">
          ${infoRow('👤 Name', user.full_name)}
          ${infoRow('📧 Email', user.email)}
          ${infoRow('🏢 Department', user.department)}
          ${infoRow('🔑 Role', user.role)}
        </table>
        <p style="color:#475569;line-height:1.7;">Log in to start exploring available labs, seminar halls, and specialized equipment.</p>
      `
    })
  };
}

function getBookingCreatedTemplate(user, booking, resource) {
  const isPending = booking.status === 'PENDING';
  return {
    subject: `📬 Booking ${isPending ? 'Submitted' : 'Confirmed'} – ${booking.booking_code}`,
    html: buildEmailTemplate({
      title: isPending ? '⏳ Booking Awaiting Approval' : '✅ Booking Confirmed',
      subtitle: isPending
        ? 'Your request has been submitted and is pending approval from a faculty/admin.'
        : 'Your booking has been automatically approved!',
      color: isPending ? '#d97706' : '#059669',
      bodyHtml: `
        <p style="color:#475569;">Hi ${user.full_name}, here are your booking details:</p>
        ${bookingTable(booking, resource)}
        ${isPending ? `<p style="color:#d97706;background:#fef3c7;padding:12px 16px;border-radius:8px;border-left:4px solid #d97706;">⏳ This booking requires approval. You'll receive another email once a decision is made.</p>` : ''}
      `
    })
  };
}

function getBookingApprovedTemplate(user, booking, resource) {
  return {
    subject: `✅ Booking Approved – ${booking.booking_code}`,
    html: buildEmailTemplate({
      title: '🎉 Booking Approved!',
      subtitle: 'Great news! Your facility booking has been approved.',
      color: '#059669',
      bodyHtml: `
        <p style="color:#475569;">Hi ${user.full_name}, your booking has been reviewed and approved.</p>
        ${bookingTable(booking, resource)}
        <p style="color:#059669;background:#f0fdf4;padding:12px 16px;border-radius:8px;border-left:4px solid #059669;">✅ Please remember to check in on time. Bookings not checked in within 15 minutes may be forfeited.</p>
      `
    })
  };
}

function getBookingRejectedTemplate(user, booking, resource, reason) {
  return {
    subject: `❌ Booking Rejected – ${booking.booking_code}`,
    html: buildEmailTemplate({
      title: '❌ Booking Rejected',
      subtitle: 'Unfortunately, your booking request could not be approved.',
      color: '#dc2626',
      bodyHtml: `
        <p style="color:#475569;">Hi ${user.full_name}, your booking has been reviewed and rejected.</p>
        ${bookingTable(booking, resource)}
        <div style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:8px;padding:16px;margin:16px 0;">
          <strong style="color:#dc2626;">Reason for Rejection:</strong>
          <p style="margin:8px 0 0;color:#7f1d1d;">${reason || 'No reason provided.'}</p>
        </div>
        <p style="color:#475569;">You can submit a new booking request with revised details through CampusReserve.</p>
      `
    })
  };
}

function getBookingCancelledTemplate(user, booking, resource) {
  return {
    subject: `🚫 Booking Cancelled – ${booking.booking_code}`,
    html: buildEmailTemplate({
      title: '🚫 Booking Cancelled',
      subtitle: 'Your booking has been cancelled.',
      color: '#6b7280',
      bodyHtml: `
        <p style="color:#475569;">Hi ${user.full_name}, the following booking has been cancelled:</p>
        ${bookingTable(booking, resource)}
        <p style="color:#475569;">If this was a mistake or you need the facility, please create a new booking through CampusReserve.</p>
      `
    })
  };
}

function getCheckInTemplate(user, booking, resource) {
  return {
    subject: `📍 Checked In – ${booking.booking_code}`,
    html: buildEmailTemplate({
      title: '📍 Check-In Confirmed',
      subtitle: 'Your check-in has been recorded. Enjoy your session!',
      color: '#0891b2',
      bodyHtml: `
        <p style="color:#475569;">Hi ${user.full_name}, you have successfully checked in.</p>
        ${bookingTable(booking, resource)}
        <p style="color:#0891b2;background:#f0f9ff;padding:12px 16px;border-radius:8px;border-left:4px solid #0891b2;">📍 Check-in time: ${booking.checked_in_at || new Date().toISOString()}</p>
      `
    })
  };
}

function getCheckOutTemplate(user, booking, resource) {
  return {
    subject: `🏁 Session Completed – ${booking.booking_code}`,
    html: buildEmailTemplate({
      title: '🏁 Session Completed',
      subtitle: 'Your session has ended and the facility has been released.',
      color: '#7c3aed',
      bodyHtml: `
        <p style="color:#475569;">Hi ${user.full_name}, thank you for using CampusReserve facilities responsibly.</p>
        ${bookingTable(booking, resource)}
        <p style="color:#7c3aed;background:#f5f3ff;padding:12px 16px;border-radius:8px;border-left:4px solid #7c3aed;">🏁 Check-out time: ${booking.checked_out_at || new Date().toISOString()}</p>
      `
    })
  };
}

// ─── Core Dispatch Engine ───────────────────────────────────────────────────────

let transporterPromise = null;

async function getTransporter() {
  const nodemailer = require('nodemailer');
  if (!process.env.SMTP_HOST) {
    // Create one-time Ethereal test account
    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass }
    });
    console.log(`[EmailService] Using Ethereal test account: ${testAccount.user}`);
    return { transporter, ethereal: true };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return { transporter, ethereal: false };
}

async function dispatchEmail({ userId, recipientEmail, eventType, subject, html }) {
  let status = 'SIMULATED';
  let previewUrl = null;
  let errorMessage = null;

  try {
    // Mode 1: Resend SDK
    if (process.env.EMAIL_PROVIDER === 'resend' && process.env.RESEND_API_KEY) {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.FROM_EMAIL || 'CampusReserve <noreply@campusreserve.edu>',
        to: recipientEmail,
        subject,
        html
      });
      status = 'SENT';
      console.log(`[EmailService] Resend ✅ → ${recipientEmail} | ${eventType}`);
    } else {
      // Mode 2: Nodemailer / Ethereal
      if (!transporterPromise) {
        transporterPromise = getTransporter();
      }
      const { transporter, ethereal } = await transporterPromise;
      const info = await transporter.sendMail({
        from: process.env.FROM_EMAIL || '"CampusReserve" <noreply@campusreserve.edu>',
        to: recipientEmail,
        subject,
        html
      });
      status = 'SENT';
      if (ethereal) {
        const nodemailer = require('nodemailer');
        previewUrl = nodemailer.getTestMessageUrl(info);
        console.log(`[EmailService] Ethereal ✅ → ${recipientEmail} | ${eventType}`);
        console.log(`[EmailService] 🔍 Preview: ${previewUrl}`);
      } else {
        console.log(`[EmailService] SMTP ✅ → ${recipientEmail} | ${eventType}`);
      }
    }
  } catch (err) {
    // FALLBACK: Simulate & log to console — never fail HTTP request
    status = 'SIMULATED';
    errorMessage = err.message;
    console.warn(`[EmailService] ⚠️  Delivery failed (${err.message}), simulating.`);
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📧 SIMULATED EMAIL → ${recipientEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(`Event:   ${eventType}`);
    console.log(`${'─'.repeat(60)}\n`);
  }

  // Always log to DB (fire & forget — don't await at call site)
  db.run(
    `INSERT INTO email_logs (user_id, recipient_email, event_type, subject, status, preview_url, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId || null, recipientEmail, eventType, subject, status, previewUrl, errorMessage],
    (dbErr) => { if (dbErr) console.error('[EmailService] Log DB error:', dbErr.message); }
  );

  return { status, previewUrl };
}

// ─── Public API ─────────────────────────────────────────────────────────────────

async function sendRegistrationEmail(user) {
  const { subject, html } = getRegistrationTemplate(user);
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'REGISTRATION', subject, html });
}

async function sendBookingCreatedEmail(user, booking, resource) {
  const { subject, html } = getBookingCreatedTemplate(user, booking, resource);
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'BOOKING_CREATED', subject, html });
}

async function sendBookingApprovedEmail(user, booking, resource) {
  const { subject, html } = getBookingApprovedTemplate(user, booking, resource);
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'BOOKING_APPROVED', subject, html });
}

async function sendBookingRejectedEmail(user, booking, resource, reason) {
  const { subject, html } = getBookingRejectedTemplate(user, booking, resource, reason);
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'BOOKING_REJECTED', subject, html });
}

async function sendBookingCancelledEmail(user, booking, resource) {
  const { subject, html } = getBookingCancelledTemplate(user, booking, resource);
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'BOOKING_CANCELLED', subject, html });
}

async function sendCheckInEmail(user, booking, resource) {
  const { subject, html } = getCheckInTemplate(user, booking, resource);
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'CHECK_IN', subject, html });
}

async function sendCheckOutEmail(user, booking, resource) {
  const { subject, html } = getCheckOutTemplate(user, booking, resource);
  return dispatchEmail({ userId: user.id, recipientEmail: user.email, eventType: 'CHECK_OUT', subject, html });
}

module.exports = {
  sendRegistrationEmail,
  sendBookingCreatedEmail,
  sendBookingApprovedEmail,
  sendBookingRejectedEmail,
  sendBookingCancelledEmail,
  sendCheckInEmail,
  sendCheckOutEmail
};
