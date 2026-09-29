/**
 * CampusReserve Frontend Application
 * Handles authentication simulator, tab switches, dynamic slot checking,
 * interactive modals, notifications, and ledger telemetry.
 */

// ── State Management ────────────────────────────────────────────────────────
const state = {
  user: null,
  token: localStorage.getItem('cr_token') || null,
  resources: [],
  myReservations: [],
  approvals: [],
  emailLogs: [],
  notifications: [],
  selectedResourceAvail: null,
  activeTab: 'tab-reserve',
  pendingRejectId: null
};

// Demo user credentials for Role Simulator
const DEMO_USERS = {
  student: {
    email: 'student@mitwpu.edu.in',
    password: 'student123'
  },
  faculty: {
    email: 'faculty@mitwpu.edu.in',
    password: 'faculty123'
  },
  admin: {
    email: 'admin@mitwpu.edu.in',
    password: 'admin123'
  }
};

// ── Toast System ─────────────────────────────────────────────────────────────
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  toast.innerHTML = `
    <i class="fa-solid ${iconMap[type] || 'fa-bell'} toast-icon"></i>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${message}</div>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

// ── API Fetch Helper ─────────────────────────────────────────────────────────
async function api(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
  };

  try {
    const res = await fetch(endpoint, {
      ...options,
      headers: { ...headers, ...options.headers }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw { status: res.status, message: data.error || 'Request failed' };
    }
    return data;
  } catch (err) {
    if (err.status === 401 && endpoint !== '/api/auth/login') {
      console.warn('Session expired or unauthorized. Re-authenticating demo user...');
      await loginAs('student');
    }
    throw err;
  }
}

// ── Auth & Role Switcher ─────────────────────────────────────────────────────
async function loginAs(roleKey) {
  const creds = DEMO_USERS[roleKey];
  if (!creds) return;

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(creds)
    });

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('cr_token', data.token);

    updateUserBadge();
    updateTabVisibility();
    showToast('Role Switched', `Logged in as ${data.user.full_name} (${data.user.role})`, 'success');

    // Refresh application data
    await refreshAllData();
  } catch (err) {
    showToast('Login Failed', err.message, 'error');
  }
}

function updateUserBadge() {
  if (!state.user) return;
  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRoleTag');
  const avatarEl = document.getElementById('userAvatar');
  const roleSwitcher = document.getElementById('roleSwitcher');

  nameEl.textContent = state.user.full_name;
  roleEl.textContent = state.user.role;
  avatarEl.textContent = state.user.full_name.charAt(0).toUpperCase();

  // Keep dropdown in sync
  const roleKeyMap = {
    STUDENT: 'student',
    FACULTY: 'faculty',
    ADMIN: 'admin'
  };
  roleSwitcher.value = roleKeyMap[state.user.role] || 'student';
}

function updateTabVisibility() {
  const approvalsTab = document.getElementById('approvalsTabBtn');
  const auditTab = document.getElementById('auditTabBtn');

  if (!state.user) return;

  if (state.user.role === 'ADMIN' || state.user.role === 'FACULTY') {
    approvalsTab.classList.remove('hidden');
  } else {
    approvalsTab.classList.add('hidden');
    if (state.activeTab === 'tab-approvals') {
      switchTab('tab-reserve');
    }
  }

  if (state.user.role === 'ADMIN') {
    auditTab.classList.remove('hidden');
  } else {
    auditTab.classList.add('hidden');
    if (state.activeTab === 'tab-audit') {
      switchTab('tab-reserve');
    }
  }
}

// ── Notifications ────────────────────────────────────────────────────────────
async function loadNotifications() {
  if (!state.token) return;
  try {
    const data = await api('/api/notifications');
    state.notifications = data.notifications || [];

    const badge = document.getElementById('notifBadge');
    if (data.unread_count > 0) {
      badge.textContent = data.unread_count;
      badge.classList.add('active');
    } else {
      badge.classList.remove('active');
    }

    renderNotifications();
  } catch (err) {
    console.error('Failed loading notifications:', err);
  }
}

function renderNotifications() {
  const listEl = document.getElementById('notifList');
  if (state.notifications.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No notifications yet.</div>';
    return;
  }

  listEl.innerHTML = state.notifications.map(n => {
    const unreadClass = n.is_read === 0 ? 'unread' : '';
    const dateFormatted = new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let icon = 'fa-bell text-accent';
    if (n.type.includes('APPROVED')) icon = 'fa-circle-check text-success';
    if (n.type.includes('REJECTED')) icon = 'fa-circle-xmark text-danger';

    return `
      <div class="notif-item ${unreadClass}" data-id="${n.id}">
        <i class="fa-solid ${icon} notif-icon"></i>
        <div class="notif-body">
          <div class="notif-title">${escapeHtml(n.title)}</div>
          <div class="notif-message">${escapeHtml(n.message)}</div>
          <div class="notif-time">${dateFormatted}</div>
        </div>
        ${n.is_read === 0 ? `
          <div class="notif-actions">
            <button class="btn-icon-tiny mark-read-btn" title="Mark read" onclick="markNotificationRead(${n.id})">
              <i class="fa-solid fa-check"></i>
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

async function markNotificationRead(id) {
  try {
    await api(`/api/notifications/${id}/read`, { method: 'PATCH' });
    await loadNotifications();
  } catch (err) {
    showToast('Error', 'Could not mark notification read', 'error');
  }
}

async function markAllNotificationsRead() {
  try {
    await api('/api/notifications/read-all', { method: 'PATCH' });
    await loadNotifications();
    showToast('Done', 'All notifications marked as read', 'success');
  } catch (err) {
    showToast('Error', 'Could not clear notifications', 'error');
  }
}

// ── Resources & Dynamic Availability ─────────────────────────────────────────
async function loadResources() {
  try {
    const data = await api('/api/resources');
    state.resources = data.resources || [];

    // Populate Select Options
    const select = document.getElementById('resourceSelect');
    select.innerHTML = '<option value="" disabled selected>Choose university resource...</option>' +
      state.resources.map(r => `
        <option value="${r.id}" data-approval="${r.requires_approval}" data-maint="${r.is_under_maintenance}">
          ${r.name} (${r.category}) - ${r.location}
        </option>
      `).join('');

    renderCatalog();
  } catch (err) {
    console.error('Failed loading resources:', err);
  }
}

function renderCatalog(categoryFilter = 'ALL') {
  const grid = document.getElementById('catalogGrid');
  const filtered = categoryFilter === 'ALL'
    ? state.resources
    : state.resources.filter(r => r.category === categoryFilter);

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state">No resources match the selected category.</div>';
    return;
  }

  grid.innerHTML = filtered.map(r => `
    <div class="resource-card">
      <div>
        <div class="res-top">
          <span class="res-category-tag">${r.category}</span>
          ${r.requires_approval
            ? '<span class="status-badge badge-pending"><i class="fa-solid fa-stamp"></i> Approval Required</span>'
            : '<span class="status-badge badge-approved"><i class="fa-solid fa-bolt"></i> Instant Access</span>'
          }
        </div>
        <h4 class="res-card-title">${escapeHtml(r.name)}</h4>
        <div class="res-meta-list">
          <div class="res-meta-item"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(r.location)}</div>
          <div class="res-meta-item"><i class="fa-solid fa-users"></i> Capacity: ${r.capacity} Seats / Units</div>
          <div class="res-meta-item">
            <i class="fa-solid ${r.is_under_maintenance ? 'fa-wrench text-danger' : 'fa-circle-check text-success'}"></i> 
            ${r.is_under_maintenance ? '<span class="text-danger">Under Maintenance</span>' : 'Operational & Ready'}
          </div>
        </div>
      </div>
      <div class="res-bottom">
        <button class="btn btn-secondary btn-sm" onclick="selectForBooking(${r.id})">
          <i class="fa-solid fa-calendar-plus"></i> Reserve Now
        </button>
      </div>
    </div>
  `).join('');
}

window.selectForBooking = function(resourceId) {
  const select = document.getElementById('resourceSelect');
  select.value = resourceId;
  switchTab('tab-reserve');
  checkLiveAvailability();
};

async function checkLiveAvailability() {
  const resourceId = document.getElementById('resourceSelect').value;
  const bookingDate = document.getElementById('bookingDate').value;
  const startTime = document.getElementById('startTime').value;
  const endTime = document.getElementById('endTime').value;

  const resBox = document.getElementById('resSummaryBox');
  const availResName = document.getElementById('availResName');
  const availResMeta = document.getElementById('availResMeta');
  const availStatusPill = document.getElementById('availStatusPill');
  const timeline = document.getElementById('bookedSlotsTimeline');
  const conflictAlert = document.getElementById('slotConflictAlert');
  const formPolicyHint = document.getElementById('formPolicyHint');

  if (!resourceId) return;

  const resource = state.resources.find(r => r.id === parseInt(resourceId));
  if (resource) {
    availResName.textContent = resource.name;
    availResMeta.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${resource.location} | Capacity: ${resource.capacity}`;

    if (resource.requires_approval && state.user && state.user.role === 'STUDENT') {
      formPolicyHint.textContent = 'Requires Faculty/Admin Clearance';
      formPolicyHint.className = 'pill-info badge-pending';
    } else {
      formPolicyHint.textContent = 'Instant Auto-Approval';
      formPolicyHint.className = 'pill-info badge-approved';
    }
  }

  if (!bookingDate) return;

  try {
    const data = await api(`/api/resources/${resourceId}/availability?date=${bookingDate}`);
    state.selectedResourceAvail = data;

    if (data.is_under_maintenance) {
      availStatusPill.className = 'status-badge badge-rejected';
      availStatusPill.innerHTML = '<i class="fa-solid fa-wrench"></i> Under Maintenance';
      timeline.innerHTML = '<p class="empty-state-text text-danger">Resource currently undergoing maintenance.</p>';
      conflictAlert.classList.add('hidden');
      return;
    }

    // Render timeline
    if (data.booked_slots.length === 0) {
      timeline.innerHTML = '<p class="empty-state-text">No existing bookings for this date. The entire day is clear!</p>';
    } else {
      timeline.innerHTML = data.booked_slots.map(s => `
        <div class="timeline-slot-item">
          <div>
            <span class="slot-time">${s.start_time} - ${s.end_time}</span>
            <span style="margin-left: 8px; font-size: 11px; color: var(--text-dim);">(${escapeHtml(s.purpose)})</span>
          </div>
          <span class="status-badge badge-${s.status.toLowerCase().replace('_', '-')}">${s.status}</span>
        </div>
      `).join('');
    }

    // Collision calculation against currently filled start/end times
    let isConflicting = false;
    if (startTime && endTime) {
      isConflicting = data.booked_slots.some(slot => {
        return (startTime < slot.end_time && endTime > slot.start_time);
      });
    }

    if (isConflicting) {
      availStatusPill.className = 'status-badge badge-rejected';
      availStatusPill.innerHTML = '<i class="fa-solid fa-ban"></i> Slot Conflict';
      conflictAlert.classList.remove('hidden');
    } else {
      availStatusPill.className = 'status-badge badge-approved';
      availStatusPill.innerHTML = '<i class="fa-solid fa-check"></i> Slot Available';
      conflictAlert.classList.add('hidden');
    }

  } catch (err) {
    console.error('Failed availability inspection:', err);
  }
}

// ── Submit Reservation ───────────────────────────────────────────────────────
async function handleReservationSubmit(e) {
  e.preventDefault();

  const resource_id = parseInt(document.getElementById('resourceSelect').value);
  const booking_date = document.getElementById('bookingDate').value;
  const start_time = document.getElementById('startTime').value;
  const end_time = document.getElementById('endTime').value;
  const purpose = document.getElementById('bookingPurpose').value;

  if (start_time >= end_time) {
    showToast('Invalid Time Window', 'Start time must be strictly before end time.', 'warning');
    return;
  }

  const submitBtn = document.getElementById('submitBookingBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reserving...';

  try {
    const data = await api('/api/reservations', {
      method: 'POST',
      body: JSON.stringify({ resource_id, booking_date, start_time, end_time, purpose })
    });

    showToast('Reservation Created', `${data.message} (${data.booking.booking_code})`, 'success');

    // Reset Form
    document.getElementById('bookingPurpose').value = '';
    await refreshAllData();
    switchTab('tab-my-reservations');
  } catch (err) {
    if (err.status === 409) {
      showToast('Collision Detected (409)', err.message, 'error');
    } else {
      showToast('Reservation Error', err.message, 'error');
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Submit Reservation';
  }
}

// ── Reservations Table ───────────────────────────────────────────────────────
async function loadMyReservations() {
  try {
    const data = await api('/api/reservations');
    state.myReservations = data.reservations || [];
    renderMyReservations();
  } catch (err) {
    console.error('Failed loading reservations:', err);
  }
}

function renderMyReservations() {
  const tbody = document.getElementById('myReservationsTableBody');
  if (state.myReservations.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No reservations found. Create your first booking above!</td></tr>';
    return;
  }

  tbody.innerHTML = state.myReservations.map(r => {
    const statusClass = `badge-${r.status.toLowerCase().replace('_', '-')}`;
    const canCancel = ['PENDING', 'APPROVED'].includes(r.status);
    const canCheckIn = r.status === 'APPROVED';
    const canCheckOut = r.status === 'CHECKED_IN';

    return `
      <tr>
        <td><span class="booking-code">${r.booking_code}</span></td>
        <td>
          <strong>${escapeHtml(r.resource_name)}</strong>
          <div style="font-size: 11px; color: var(--text-dim);">${escapeHtml(r.location)} • ${r.category}</div>
        </td>
        <td>
          <div><i class="fa-solid fa-calendar"></i> ${r.booking_date}</div>
          <div style="font-size: 11.5px; font-family: 'JetBrains Mono'; color: var(--text-muted);">${r.start_time} - ${r.end_time}</div>
        </td>
        <td><span title="${escapeHtml(r.purpose)}">${escapeHtml(truncate(r.purpose, 35))}</span></td>
        <td>
          <span class="status-badge ${statusClass}">${r.status}</span>
          ${r.rejection_reason ? `<div style="font-size: 11px; color: var(--red); margin-top: 4px;">Reason: ${escapeHtml(r.rejection_reason)}</div>` : ''}
        </td>
        <td>
          <div class="action-btn-group">
            ${canCheckIn ? `
              <button class="btn btn-secondary btn-sm" onclick="checkInBooking(${r.id})" title="Digital Check-in">
                <i class="fa-solid fa-location-crosshairs text-accent"></i> Check In
              </button>
            ` : ''}
            ${canCheckOut ? `
              <button class="btn btn-secondary btn-sm" onclick="checkOutBooking(${r.id})" title="Digital Check-out">
                <i class="fa-solid fa-flag-checkered text-success"></i> Check Out
              </button>
            ` : ''}
            ${canCancel ? `
              <button class="btn btn-secondary btn-sm" onclick="cancelBooking(${r.id})" title="Cancel Booking">
                <i class="fa-solid fa-xmark text-danger"></i> Cancel
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Booking Actions
window.cancelBooking = async function(id) {
  if (!confirm('Are you sure you want to cancel this reservation?')) return;
  try {
    await api(`/api/reservations/${id}/cancel`, { method: 'PATCH' });
    showToast('Cancelled', 'Reservation cancelled successfully.', 'info');
    await refreshAllData();
  } catch (err) {
    showToast('Cancel Failed', err.message, 'error');
  }
};

window.checkInBooking = async function(id) {
  try {
    await api(`/api/reservations/${id}/check-in`, { method: 'PATCH' });
    showToast('Checked In', 'Recorded arrival and access timestamp.', 'success');
    await refreshAllData();
  } catch (err) {
    showToast('Check-In Failed', err.message, 'error');
  }
};

window.checkOutBooking = async function(id) {
  try {
    await api(`/api/reservations/${id}/check-out`, { method: 'PATCH' });
    showToast('Checked Out', 'Session completed and facility cleared.', 'success');
    await refreshAllData();
  } catch (err) {
    showToast('Check-Out Failed', err.message, 'error');
  }
};

// ── Approvals Desk ───────────────────────────────────────────────────────────
async function loadApprovals() {
  if (!state.user || (state.user.role !== 'FACULTY' && state.user.role !== 'ADMIN')) return;

  try {
    const data = await api('/api/reservations');
    const all = data.reservations || [];
    state.approvals = all.filter(r => r.status === 'PENDING');

    document.getElementById('pendingApprovalsCount').textContent = state.approvals.length;
    renderApprovals();
  } catch (err) {
    console.error('Failed loading approvals:', err);
  }
}

function renderApprovals() {
  const tbody = document.getElementById('approvalsTableBody');
  if (state.approvals.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No pending approval requests at this time.</td></tr>';
    return;
  }

  tbody.innerHTML = state.approvals.map(r => `
    <tr>
      <td><span class="booking-code">${r.booking_code}</span></td>
      <td>
        <strong>${escapeHtml(r.booker_name || 'Student')}</strong>
        <div style="font-size: 11px; color: var(--text-dim);">${escapeHtml(r.booker_email || '')} • ${r.booker_department || ''}</div>
      </td>
      <td>
        <strong>${escapeHtml(r.resource_name)}</strong>
        <div style="font-size: 11px; color: var(--text-dim);">${escapeHtml(r.location)}</div>
      </td>
      <td>
        <div>${r.booking_date}</div>
        <div style="font-size: 11.5px; font-family: 'JetBrains Mono'; color: var(--text-muted);">${r.start_time} - ${r.end_time}</div>
      </td>
      <td><span title="${escapeHtml(r.purpose)}">${escapeHtml(truncate(r.purpose, 35))}</span></td>
      <td>
        <div class="action-btn-group">
          <button class="btn btn-primary btn-sm" onclick="approveBooking(${r.id})" title="Approve Request">
            <i class="fa-solid fa-check"></i> Approve
          </button>
          <button class="btn btn-danger btn-sm" onclick="openRejectModal(${r.id}, '${r.booking_code}')" title="Reject Request">
            <i class="fa-solid fa-ban"></i> Reject
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.approveBooking = async function(id) {
  try {
    await api(`/api/reservations/${id}/approve`, { method: 'PATCH' });
    showToast('Approved', 'Reservation request cleared and confirmed.', 'success');
    await refreshAllData();
  } catch (err) {
    showToast('Approval Failed', err.message, 'error');
  }
};

window.openRejectModal = function(id, bookingCode) {
  state.pendingRejectId = id;
  document.getElementById('rejectBookingCode').textContent = bookingCode;
  document.getElementById('rejectionReasonInput').value = '';
  document.getElementById('rejectModal').classList.remove('hidden');
};

async function handleConfirmReject() {
  const reason = document.getElementById('rejectionReasonInput').value.trim();
  if (!reason) {
    showToast('Required', 'Please enter a rejection reason.', 'warning');
    return;
  }

  try {
    await api(`/api/reservations/${state.pendingRejectId}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ reason })
    });

    document.getElementById('rejectModal').classList.add('hidden');
    showToast('Rejected', 'Reservation marked as rejected.', 'info');
    await refreshAllData();
  } catch (err) {
    showToast('Rejection Failed', err.message, 'error');
  }
}

// ── Email & Audit Ledger ─────────────────────────────────────────────────────
async function loadEmailLogs() {
  if (!state.user || state.user.role !== 'ADMIN') return;

  try {
    const data = await api('/api/admin/email-logs');
    state.emailLogs = data.logs || [];
    renderEmailLogs();
  } catch (err) {
    console.error('Failed loading email logs:', err);
  }
}

function renderEmailLogs() {
  const tbody = document.getElementById('auditTableBody');
  if (state.emailLogs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No dispatch telemetry records found.</td></tr>';
    return;
  }

  tbody.innerHTML = state.emailLogs.map(l => {
    const time = new Date(l.sent_at).toLocaleString();
    const statusBadge = `<span class="status-badge badge-${l.status.toLowerCase()}">${l.status}</span>`;

    let inspectionLink = '—';
    if (l.preview_url) {
      inspectionLink = `<a href="${l.preview_url}" target="_blank" class="btn btn-secondary btn-sm" style="color:#60a5fa;">
        <i class="fa-solid fa-arrow-up-right-from-square"></i> Open Live Preview
      </a>`;
    } else {
      inspectionLink = `<button class="btn btn-secondary btn-sm" onclick="openSimulatedEmailModal(${l.id})">
        <i class="fa-solid fa-eye"></i> View Body
      </button>`;
    }

    return `
      <tr>
        <td style="font-size: 11.5px; font-family: 'JetBrains Mono';">${time}</td>
        <td>
          <strong>${escapeHtml(l.recipient_email)}</strong>
          ${l.full_name ? `<div style="font-size: 11px; color: var(--text-dim);">${escapeHtml(l.full_name)}</div>` : ''}
        </td>
        <td><span class="pill-info">${l.event_type}</span></td>
        <td>${escapeHtml(l.subject)}</td>
        <td>${statusBadge}</td>
        <td>${inspectionLink}</td>
      </tr>
    `;
  }).join('');
}

window.openSimulatedEmailModal = function(logId) {
  const log = state.emailLogs.find(l => l.id === logId);
  if (!log) return;

  document.getElementById('previewRecipient').textContent = log.recipient_email;
  document.getElementById('previewEvent').textContent = log.event_type;
  document.getElementById('previewSubject').textContent = log.subject;

  const htmlContainer = document.getElementById('previewHtmlContainer');
  htmlContainer.innerHTML = `
    <div style="font-family: sans-serif; padding: 12px; background: #f8fafc; border-radius: 8px;">
      <h3 style="color:#1e293b; margin-top:0;">${escapeHtml(log.subject)}</h3>
      <p style="color:#64748b; font-size:13px;">Automated campus dispatch triggered for event: <strong>${log.event_type}</strong></p>
      <hr style="border:none; border-top:1px solid #e2e8f0; margin:16px 0;" />
      <div style="color:#334155; line-height:1.6; font-size:14px;">
        Hello,<br><br>
        This is an official verification dispatch for <strong>${log.recipient_email}</strong> regarding your facility operation with subject "<em>${log.subject}</em>".
        <br><br>
        <strong>Status:</strong> ${log.status}<br>
        <strong>Timestamp:</strong> ${log.sent_at}
      </div>
    </div>
  `;

  document.getElementById('emailPreviewModal').classList.remove('hidden');
};

// ── Tab Management ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === tabId);
  });

  if (tabId === 'tab-approvals') loadApprovals();
  if (tabId === 'tab-audit') loadEmailLogs();
  if (tabId === 'tab-my-reservations') loadMyReservations();
}

// ── Refresh Aggregator ───────────────────────────────────────────────────────
async function refreshAllData() {
  await Promise.allSettled([
    loadNotifications(),
    loadResources(),
    loadMyReservations(),
    loadApprovals(),
    loadEmailLogs()
  ]);
  checkLiveAvailability();
}

// ── Utilities ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[m]);
}

function truncate(str, max = 30) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '...' : str;
}

// ── Event Listeners ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize default date to today
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('bookingDate');
  dateInput.value = today;
  dateInput.min = today;

  // Role Switcher Dropdown
  document.getElementById('roleSwitcher').addEventListener('change', (e) => {
    loginAs(e.target.value);
  });

  // Tab Buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  // Slot Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('startTime').value = btn.getAttribute('data-start');
      document.getElementById('endTime').value = btn.getAttribute('data-end');
      checkLiveAvailability();
    });
  });

  // Input changes for live availability
  document.getElementById('resourceSelect').addEventListener('change', checkLiveAvailability);
  document.getElementById('bookingDate').addEventListener('change', checkLiveAvailability);
  document.getElementById('startTime').addEventListener('change', checkLiveAvailability);
  document.getElementById('endTime').addEventListener('change', checkLiveAvailability);

  // Reservation Form Submit
  document.getElementById('reservationForm').addEventListener('submit', handleReservationSubmit);

  // Catalog Category Filters
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderCatalog(chip.getAttribute('data-cat'));
    });
  });

  // Notification Bell Toggle
  const notifBellBtn = document.getElementById('notifBellBtn');
  const notifDropdown = document.getElementById('notifDropdown');

  notifBellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    notifDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!notifDropdown.contains(e.target) && !notifBellBtn.contains(e.target)) {
      notifDropdown.classList.add('hidden');
    }
  });

  document.getElementById('markAllReadBtn').addEventListener('click', markAllNotificationsRead);

  // Modal Closers
  document.getElementById('closeRejectModalBtn').addEventListener('click', () => {
    document.getElementById('rejectModal').classList.add('hidden');
  });
  document.getElementById('cancelRejectBtn').addEventListener('click', () => {
    document.getElementById('rejectModal').classList.add('hidden');
  });
  document.getElementById('confirmRejectBtn').addEventListener('click', handleConfirmReject);

  document.getElementById('closeEmailPreviewModalBtn').addEventListener('click', () => {
    document.getElementById('emailPreviewModal').classList.add('hidden');
  });
  document.getElementById('closePreviewBtn').addEventListener('click', () => {
    document.getElementById('emailPreviewModal').classList.add('hidden');
  });

  // Refresh Buttons
  document.getElementById('refreshMyBookingsBtn').addEventListener('click', loadMyReservations);
  document.getElementById('refreshApprovalsBtn').addEventListener('click', loadApprovals);
  document.getElementById('refreshAuditBtn').addEventListener('click', loadEmailLogs);

  // Initial Startup: log in as Student Saksham Sisodiya
  await loginAs('student');
});
