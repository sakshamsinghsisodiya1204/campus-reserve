/* ═══════════════════════════════════════════════════════════════════════════
   CampusReserve — Frontend Application Core
   Cosmic Obsidian SaaS Interface & Allocation Engine
   ═══════════════════════════════════════════════════════════════════════════ */

const state = {
  user: null,
  token: localStorage.getItem("cr_token") || null,
  activeTab: "tab-reserve",
  overrideEmail: null,
  pendingRejectId: null,
  calDate: new Date(),
  calEvents: [],
  calFilter: "ALL"
};

/* ── API Client ──────────────────────────────────────────────────────────── */
async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...(options.headers || {})
  };
  try {
    const res = await fetch(path, { credentials: "same-origin", ...options, headers });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, ...data };
  } catch (err) {
    console.error(`[API Error] ${path}:`, err);
    return { ok: false, error: "Network error. Is the server running?" };
  }
}

/* ── Toast notifications ─────────────────────────────────────────────────── */
function toast(msg, type = "info", icon) {
  const icons = {
    success: "fa-circle-check",
    error: "fa-circle-xmark",
    warning: "fa-triangle-exclamation",
    info: "fa-circle-info"
  };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icon || icons[type]} toast-icon"></i><span class="toast-msg">${msg}</span>`;
  const container = document.getElementById("toastContainer");
  if (container) {
    container.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }
}

/* ── Tab Switcher ────────────────────────────────────────────────────────── */
function switchTab(id) {
  state.activeTab = id;
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === id));
  document.querySelectorAll(".sidebar-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  if (id === "tab-my-bookings") loadMyBookings();
  if (id === "tab-approvals")   loadApprovals();
  if (id === "tab-email-ledger") loadEmailLogs();
  if (id === "tab-calendar")    loadCalendar();
  if (id === "tab-admin")       loadAdminDashboard();
}

/* ── Sync UI from state.user ─────────────────────────────────────────────── */
function syncUI() {
  const u = state.user;
  const initEl   = document.getElementById("userInitials");
  const nameEl   = document.getElementById("userNameLabel");
  const emailEl  = document.getElementById("userEmailLabel");
  const roleEl   = document.getElementById("userRoleBadge");
  const recipEl  = document.getElementById("currentRecipientDisplay");
  const approBtn = document.getElementById("approvalsTabBtn");
  const adminBtn = document.getElementById("adminDashTabBtn");

  // Update demo role pills
  document.querySelectorAll(".demo-role-pill").forEach(p => p.classList.remove("active"));
  if (u) {
    if (u.role === "STUDENT") document.getElementById("demoStudentPill")?.classList.add("active");
    if (u.role === "FACULTY") document.getElementById("demoFacultyPill")?.classList.add("active");
    if (u.role === "ADMIN")   document.getElementById("demoAdminPill")?.classList.add("active");

    const initials = u.full_name ? u.full_name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase() : "U";
    if (initEl) initEl.textContent = initials;
    if (nameEl) nameEl.textContent = u.full_name;
    const heroNameEl = document.getElementById("heroUserName");
    if (heroNameEl) heroNameEl.textContent = u.full_name.split(" ")[0];
    if (emailEl) emailEl.textContent = u.email;
    if (roleEl) roleEl.textContent = u.role;
    if (recipEl) recipEl.textContent = state.overrideEmail || u.email;
    
    const isStaff = u.role === "FACULTY" || u.role === "ADMIN";
    approBtn?.classList.toggle("hidden", !isStaff);
    adminBtn?.classList.toggle("hidden", u.role !== "ADMIN");

    if (state.activeTab === "tab-approvals" && !isStaff) switchTab("tab-reserve");
    if (state.activeTab === "tab-admin" && u.role !== "ADMIN") switchTab("tab-reserve");
  } else {
    if (initEl) initEl.textContent = "?";
    if (nameEl) nameEl.textContent = "Not Signed In";
    const heroNameEl = document.getElementById("heroUserName");
    if (heroNameEl) heroNameEl.textContent = "Guest";
    if (emailEl) emailEl.textContent = "—";
    if (roleEl) roleEl.textContent = "GUEST";
    if (recipEl) recipEl.textContent = "—";
    approBtn?.classList.add("hidden");
    adminBtn?.classList.add("hidden");
  }
  refreshMetrics();
}

function logout() {
  state.user = null;
  state.token = null;
  localStorage.removeItem("cr_token");
  syncUI();
  switchTab("tab-reserve");
}

/* ── Auth ────────────────────────────────────────────────────────────────── */
async function login(email, password) {
  const btn = document.getElementById("loginSubmitBtn");
  if (btn) { btn.textContent = "Signing in…"; btn.disabled = true; }
  const res = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  if (btn) { btn.textContent = "Sign In to Portal"; btn.disabled = false; }
  if (res.ok && res.token) {
    state.token = res.token;
    state.user  = res.user;
    localStorage.setItem("cr_token", res.token);
    closeAuthModal();
    syncUI();
    populateResourceSelect();
    loadScheduleTimeline();
    loadNotifications();
    toast(`Welcome, ${res.user.full_name}! (${res.user.role})`, "success");
    return true;
  } else {
    toast(res.error || "Login failed. Check credentials.", "error");
    return false;
  }
}

async function register(data) {
  const btn = document.getElementById("registerSubmitBtn");
  if (btn) { btn.textContent = "Creating…"; btn.disabled = true; }
  const res = await api("/api/auth/register", { method: "POST", body: JSON.stringify(data) });
  if (btn) { btn.textContent = "Create Account & Send Welcome Email"; btn.disabled = false; }
  if (res.ok) {
    toast("Account created! Check your email for the welcome message.", "success");
    document.getElementById("tabLoginBtn")?.click();
    const emailInput = document.getElementById("loginEmail");
    if (emailInput) emailInput.value = data.email;
  } else {
    toast(res.error || "Registration failed.", "error");
  }
}

/* ── One-Click Demo Role Switcher ────────────────────────────────────────── */
async function quickFillDemo(role) {
  const creds = {
    student: { email: "student@mitwpu.edu.in", password: "student123" },
    faculty: { email: "faculty@mitwpu.edu.in", password: "faculty123" },
    admin:   { email: "admin@mitwpu.edu.in",   password: "admin123" }
  };
  const target = creds[role];
  if (!target) return;

  const emailField = document.getElementById("loginEmail");
  const passField  = document.getElementById("loginPassword");
  if (emailField) emailField.value = target.email;
  if (passField)  passField.value  = target.password;

  const success = await login(target.email, target.password);
  if (success) {
    if (role === "faculty" || role === "admin") {
      switchTab("tab-approvals");
    } else {
      switchTab("tab-reserve");
    }
  }
}

/* ── Auth Modal ──────────────────────────────────────────────────────────── */
function openAuthModal()  { document.getElementById("authModal")?.classList.remove("hidden"); }
function closeAuthModal() { document.getElementById("authModal")?.classList.add("hidden"); }
function setAuthMode(mode) {
  const isLogin = mode === "login";
  document.getElementById("loginForm")?.classList.toggle("hidden", !isLogin);
  document.getElementById("registerForm")?.classList.toggle("hidden", isLogin);
  document.getElementById("tabLoginBtn")?.classList.toggle("active", isLogin);
  document.getElementById("tabRegisterBtn")?.classList.toggle("active", !isLogin);
}

/* ── Metrics Bar ─────────────────────────────────────────────────────────── */
async function refreshMetrics() {
  if (!state.user) {
    ["metUpcoming","metCatalog","metQueue","metMyTotal"].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = "—";
    });
    return;
  }
  try {
    const [rRes, bRes] = await Promise.all([
      api("/api/resources"),
      api("/api/reservations/my")
    ]);
    const resources = rRes.resources || [];
    const bookings  = bRes.reservations || bRes.bookings || [];
    const active    = bookings.filter(b => ["APPROVED","PENDING","CHECKED_IN"].includes(b.status) && b.booking_date >= new Date().toISOString().split("T")[0]);
    const pending   = bookings.filter(b => b.status === "PENDING");
    
    const metUpcoming = document.getElementById("metUpcoming");
    const metCatalog  = document.getElementById("metCatalog");
    const metQueue    = document.getElementById("metQueue");
    const metMyTotal  = document.getElementById("metMyTotal");
    const myBookingsPill = document.getElementById("myBookingsPill");

    if (metUpcoming) metUpcoming.textContent = active.length;
    if (metCatalog)  metCatalog.textContent  = resources.length;
    if (metQueue)    metQueue.textContent    = pending.length;
    if (metMyTotal)  metMyTotal.textContent  = bookings.length;
    if (myBookingsPill) myBookingsPill.textContent = bookings.length;

    // Update approval badge count for Faculty/Admin
    if (state.user.role === "FACULTY" || state.user.role === "ADMIN") {
      const aRes = await api("/api/reservations/pending");
      const cnt  = (aRes.reservations || aRes.bookings || []).length;
      const countEl = document.getElementById("pendingApprovalsCount");
      if (countEl) countEl.textContent = cnt;
    }
  } catch (err) {
    console.warn("[refreshMetrics error]", err);
  }
}

/* ── Resource Select ─────────────────────────────────────────────────────── */
async function populateResourceSelect() {
  const sel = document.getElementById("resourceSelect");
  if (!sel) return;
  const res = await api("/api/resources");
  if (!res.resources) return;
  sel.innerHTML = "<option value=\"\">— Select a resource —</option>";
  res.resources.forEach(r => {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = `${r.name} (${r.category})`;
    opt.dataset.approval = r.requires_approval;
    opt.dataset.maintenance = r.is_under_maintenance;
    opt.dataset.location = r.location || "";
    opt.dataset.capacity = r.capacity || "";
    if (r.is_under_maintenance) opt.disabled = true;
    sel.appendChild(opt);
  });
}

function onResourceChange() {
  const sel  = document.getElementById("resourceSelect");
  if (!sel) return;
  const opt  = sel.selectedOptions[0];
  const meta = document.getElementById("resourceMeta");
  const policy = document.getElementById("policyIndicator");
  if (!opt || !opt.value) { meta?.classList.add("hidden"); return; }
  if (meta) {
    meta.classList.remove("hidden");
    meta.innerHTML = `📍 ${opt.dataset.location} &nbsp;·&nbsp; Capacity: ${opt.dataset.capacity}`;
  }
  const needsApproval = opt.dataset.approval === "1";
  if (policy) {
    policy.textContent = needsApproval ? "Requires Approval" : "Instant Clearance";
    policy.style.background = needsApproval ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.12)";
    policy.style.color = needsApproval ? "#fbbf24" : "#34d399";
    policy.style.borderColor = needsApproval ? "rgba(245,158,11,0.3)" : "rgba(16,185,129,0.25)";
  }
  loadTimeSlots();
}

/* ── Time Slot Chips ─────────────────────────────────────────────────────── */
const TIME_SLOTS = [
  ["08:00","09:00"],["09:00","10:00"],["10:00","11:00"],["11:00","12:00"],
  ["12:00","13:00"],["13:00","14:00"],["14:00","15:00"],["15:00","16:00"],
  ["16:00","17:00"],["17:00","18:00"],["09:00","11:00"],["11:00","13:00"],
  ["13:00","15:00"],["14:00","16:00"],["09:00","12:00"],["14:00","17:00"]
];

async function loadTimeSlots() {
  const grid = document.getElementById("timeChipGrid");
  const resourceId = document.getElementById("resourceSelect")?.value;
  const date = document.getElementById("bookingDate")?.value;
  if (!grid) return;
  if (!resourceId || !date) {
    grid.innerHTML = '<span class="chip-loading">Select a resource and date to see slots</span>';
    return;
  }
  grid.innerHTML = '<span class="chip-loading">Loading slots…</span>';
  try {
    const res = await api(`/api/resources/${resourceId}/availability?date=${date}`);
    const booked = (res.booked_slots || []).map(s => `${s.start_time}-${s.end_time}`);
    grid.innerHTML = "";
    TIME_SLOTS.forEach(([s, e]) => {
      const isBooked = booked.some(b => {
        const [bs, be] = b.split("-");
        return s < be && e > bs;
      });
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "time-chip" + (isBooked ? " booked" : "");
      chip.innerHTML = `<span class="chip-time">${s}–${e}</span><span class="chip-sub">${isBooked ? "Reserved" : "Available"}</span>`;
      if (!isBooked) {
        chip.addEventListener("click", () => selectSlot(chip, s, e));
      }
      grid.appendChild(chip);
    });
  } catch {
    grid.innerHTML = '<span class="chip-loading">Failed to load slot availability</span>';
  }
}

function selectSlot(chip, start, end) {
  document.querySelectorAll(".time-chip").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");
  document.getElementById("startTime").value = start;
  document.getElementById("endTime").value   = end;
  const disp = document.getElementById("selectedSlotDisplay");
  const txt  = document.getElementById("selectedSlotText");
  if (disp && txt) {
    txt.textContent = `Selected: ${start} – ${end}`;
    disp.classList.remove("hidden");
  }
}

function clearSlot() {
  document.querySelectorAll(".time-chip").forEach(c => c.classList.remove("active"));
  const startEl = document.getElementById("startTime");
  const endEl   = document.getElementById("endTime");
  const disp    = document.getElementById("selectedSlotDisplay");
  if (startEl) startEl.value = "";
  if (endEl)   endEl.value   = "";
  disp?.classList.add("hidden");
}

/* ── Submit Reservation ──────────────────────────────────────────────────── */
async function submitReservation(e) {
  e.preventDefault();
  if (!state.user) { openAuthModal(); return; }
  const resourceId  = document.getElementById("resourceSelect").value;
  const bookingDate = document.getElementById("bookingDate").value;
  const startTime   = document.getElementById("startTime").value;
  const endTime     = document.getElementById("endTime").value;
  const purpose     = document.getElementById("purposeInput").value.trim();
  if (!startTime) { toast("Please select a time slot.", "warning"); return; }

  const btn = document.getElementById("submitReservationBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…'; }
  const payload = { resource_id: resourceId, booking_date: bookingDate, start_time: startTime, end_time: endTime, purpose };
  if (state.overrideEmail) payload.notification_email = state.overrideEmail;

  const res = await api("/api/reservations", { method: "POST", body: JSON.stringify(payload) });
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Confirm Reservation'; }

  if (res.status === 409) {
    toast(`⚡ Slot conflict: ${res.error}`, "error");
  } else if (res.booking) {
    const st = res.booking.status;
    toast(
      st === "PENDING"
        ? `Booking ${res.booking.booking_code} submitted — awaiting Faculty/Admin clearance.`
        : `Booking ${res.booking.booking_code} confirmed! 📧 Notification dispatched.`,
      st === "PENDING" ? "warning" : "success"
    );
    document.getElementById("reservationForm")?.reset();
    clearSlot();
    refreshMetrics();
    loadScheduleTimeline();
  } else {
    toast(res.error || "Failed to submit booking.", "error");
  }
}

/* ── Schedule Timeline ───────────────────────────────────────────────────── */
async function loadScheduleTimeline() {
  const container = document.getElementById("scheduleTimeline");
  if (!container) return;
  if (!state.user) { container.innerHTML = '<div class="empty-state-msg">Sign in to view your schedule.</div>'; return; }
  const res = await api("/api/reservations/my");
  const bookings = (res.reservations || res.bookings || []).filter(b => ["APPROVED","PENDING","CHECKED_IN"].includes(b.status)).slice(0, 8);
  if (!bookings.length) {
    container.innerHTML = '<div class="empty-state-msg">No upcoming bookings. Reserve a facility above!</div>';
    return;
  }
  container.innerHTML = bookings.map(b => `
    <div class="schedule-item">
      <div class="schedule-dot ${b.status}"></div>
      <div class="schedule-info">
        <div class="schedule-resource">${b.resource_name}</div>
        <div class="schedule-time">${b.booking_date} · ${b.start_time}–${b.end_time}</div>
      </div>
      <div class="schedule-actions">
        <span class="status-chip ${b.status}">${b.status}</span>
      </div>
    </div>
  `).join("");
}

/* ── My Bookings ─────────────────────────────────────────────────────────── */
async function loadMyBookings() {
  const tbody = document.getElementById("myReservationsTableBody");
  if (!tbody) return;
  if (!state.user) { tbody.innerHTML = '<tr><td colspan="6" class="tc">Please sign in.</td></tr>'; return; }
  tbody.innerHTML = '<tr><td colspan="6" class="tc">Loading…</td></tr>';
  const res = await api("/api/reservations/my");
  const bookings = res.reservations || res.bookings || [];
  if (!bookings.length) { tbody.innerHTML = '<tr><td colspan="6" class="tc">No bookings yet.</td></tr>'; return; }
  tbody.innerHTML = bookings.map(b => `
    <tr>
      <td><span class="mono">${b.booking_code}</span></td>
      <td>${b.resource_name}<br><span class="cat-badge">${b.resource_category || ""}</span></td>
      <td>${b.booking_date}<br><span style="font-size:.72rem;color:var(--text-3);font-family:var(--font-mono)">${b.start_time}–${b.end_time}</span></td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.purpose || "—"}</td>
      <td><span class="status-chip ${b.status}">${b.status}</span></td>
      <td style="text-align:right">
        ${["PENDING","APPROVED"].includes(b.status)
          ? `<button class="btn-cancel" onclick="cancelBooking(${b.id})">Cancel</button>` : ""}
      </td>
    </tr>
  `).join("");
}

async function cancelBooking(id) {
  if (!confirm("Cancel this booking?")) return;
  const res = await api(`/api/reservations/${id}/cancel`, { method: "PATCH" });
  if (res.ok) { toast("Booking cancelled.", "success"); loadMyBookings(); refreshMetrics(); loadScheduleTimeline(); }
  else toast(res.error || "Failed to cancel.", "error");
}

/* ── Approvals Desk ──────────────────────────────────────────────────────── */
async function loadApprovals() {
  const listEl = document.getElementById("approvals-list");
  if (!listEl) return;
  if (!state.user || (state.user.role !== "FACULTY" && state.user.role !== "ADMIN")) {
    listEl.innerHTML = `
      <div class="empty-approval-state glass-card" style="grid-column:1/-1;text-align:center;padding:48px 24px">
        <div style="font-size:2.5rem;color:var(--violet);margin-bottom:12px"><i class="fa-solid fa-lock"></i></div>
        <h3 style="font-size:1.1rem;font-weight:600;color:var(--text-1);margin-bottom:6px">Access Restricted</h3>
        <p style="font-size:0.85rem;color:var(--text-3)">Approval Desk requires Faculty or Administrator credentials.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = '<div class="glass-card tc" style="grid-column:1/-1;padding:36px;color:var(--text-2)"><i class="fa-solid fa-spinner fa-spin"></i> Loading pending requests…</div>';

  try {
    const res = await api("/api/reservations/pending");
    const bookings = res.reservations || res.bookings || [];

    // Empty state
    if (!bookings.length) {
      listEl.innerHTML = `
        <div class="empty-approval-state glass-card" style="grid-column:1/-1;text-align:center;padding:48px 24px">
          <div style="font-size:2.5rem;color:#34d399;margin-bottom:12px"><i class="fa-solid fa-clipboard-check"></i></div>
          <h3 style="font-size:1.1rem;font-weight:600;color:var(--text-1);margin-bottom:6px">No pending reservations awaiting clearance.</h3>
          <p style="font-size:0.85rem;color:var(--text-3)">All submitted facility and laboratory requests have been processed.</p>
        </div>`;
      return;
    }

    // Render cards for each pending reservation
    listEl.innerHTML = bookings.map(b => {
      const studentName = b.student_name || b.full_name || b.user_name || "Student Requester";
      const studentEmail = b.student_email || b.email || b.user_email || "—";
      const resourceName = b.resource_name || b.name || "Campus Resource";
      const location = b.resource_location || b.location || "Campus Facility";

      return `
        <div class="approval-card glass-card" id="approval-card-${b.id}">
          <div class="approval-card-head">
            <div>
              <div class="approval-resource-name">${resourceName}</div>
              <div class="approval-location"><i class="fa-solid fa-location-dot"></i> ${location}</div>
            </div>
            <span class="status-chip PENDING">PENDING</span>
          </div>

          <div class="approval-card-body">
            <div class="approval-info-row">
              <span class="approval-info-label"><i class="fa-solid fa-ticket"></i> Booking Code</span>
              <span class="approval-info-val mono" style="color:var(--violet)">${b.booking_code}</span>
            </div>
            <div class="approval-info-row">
              <span class="approval-info-label"><i class="fa-solid fa-user-graduate"></i> Student Requester</span>
              <span class="approval-info-val" style="font-weight:600;color:var(--text-1)">${studentName}</span>
            </div>
            <div class="approval-info-row">
              <span class="approval-info-label"><i class="fa-solid fa-envelope"></i> Email</span>
              <span class="approval-info-val mono" style="font-size:0.75rem">${studentEmail}</span>
            </div>
            <div class="approval-info-row">
              <span class="approval-info-label"><i class="fa-regular fa-calendar"></i> Requested Date</span>
              <span class="approval-info-val">${b.booking_date}</span>
            </div>
            <div class="approval-info-row">
              <span class="approval-info-label"><i class="fa-regular fa-clock"></i> Time Slot</span>
              <span class="approval-info-val mono" style="color:#38bdf8">${b.start_time} – ${b.end_time}</span>
            </div>
            ${b.purpose ? `
              <div class="approval-purpose-box">
                <span class="approval-info-label"><i class="fa-solid fa-bullseye"></i> Purpose</span>
                <div class="approval-purpose-text">${b.purpose}</div>
              </div>` : ""}
          </div>

          <div class="approval-card-actions">
            <button class="btn-approve" onclick="approveBooking(${b.id})">
              <i class="fa-solid fa-check"></i> ✓ Approve
            </button>
            <button class="btn-reject" onclick="openRejectModal(${b.id},'${b.booking_code}')">
              <i class="fa-solid fa-xmark"></i> ✕ Reject
            </button>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("[loadApprovals error]", err);
    listEl.innerHTML = `<div class="glass-card tc" style="grid-column:1/-1;padding:30px;color:#f87171">Failed to load approvals: ${err.message}</div>`;
  }
}

async function approveBooking(id) {
  const res = await api(`/api/reservations/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "APPROVED" })
  });
  if (res.ok && res.success !== false) {
    toast("✓ Reservation approved successfully! 📧 Email notification dispatched.", "success");
    loadApprovals();
    refreshMetrics();
  } else {
    toast(res.error || "Failed to approve reservation.", "error");
  }
}

function openRejectModal(id, code) {
  state.pendingRejectId = id;
  const codeEl = document.getElementById("rejectBookingCode");
  const reasonEl = document.getElementById("rejectionReasonInput");
  if (codeEl) codeEl.textContent = code;
  if (reasonEl) reasonEl.value = "";
  document.getElementById("rejectModal")?.classList.remove("hidden");
}

async function confirmReject() {
  const reason = document.getElementById("rejectionReasonInput")?.value.trim();
  if (!reason) { toast("Please provide a rejection reason.", "warning"); return; }
  const res = await api(`/api/reservations/${state.pendingRejectId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "REJECTED", reason })
  });
  document.getElementById("rejectModal")?.classList.add("hidden");
  if (res.ok && res.success !== false) {
    toast("✕ Reservation rejected. 📧 Email notification dispatched to student.", "info");
    loadApprovals();
    refreshMetrics();
  } else {
    toast(res.error || "Failed to reject reservation.", "error");
  }
}

/* ── Email Audit Ledger ───────────────────────────────────────────────────── */
async function loadEmailLogs() {
  const tbody = document.getElementById("auditTableBody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="tc">Loading telemetry…</td></tr>';
  const res = await api("/api/admin/email-logs");
  const logs = res.logs || [];
  if (!logs.length) { tbody.innerHTML = '<tr><td colspan="6" class="tc">No email dispatches recorded yet.</td></tr>'; return; }
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td style="white-space:nowrap;font-size:0.75rem;color:var(--text-3);font-family:var(--font-mono)">${(l.sent_at||"").replace("T"," ").substring(0,19)}</td>
      <td><span class="mono" style="color:var(--text-1)">${l.recipient_email}</span></td>
      <td><span class="cat-badge">${l.event_type}</span></td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.subject}</td>
      <td><span class="status-chip ${l.status==='SENT'?'APPROVED':'REJECTED'}">${l.status}</span></td>
      <td style="text-align:right">
        ${l.preview_url ? `<a href="${l.preview_url}" target="_blank" class="preview-link">Ethereal ↗</a>` : '<span style="font-size:0.72rem;color:var(--text-3)">Gmail SMTP</span>'}
      </td>
    </tr>
  `).join("");
}

/* ── Calendar View ───────────────────────────────────────────────────────── */
async function loadCalendar() {
  const y = state.calDate.getFullYear();
  const m = String(state.calDate.getMonth() + 1).padStart(2, "0");
  const monthStr = `${y}-${m}`;
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const labelEl = document.getElementById("calMonthLabel");
  if (labelEl) labelEl.textContent = `${monthNames[state.calDate.getMonth()]} ${y}`;

  const res = await api(`/api/calendar?month=${monthStr}`);
  state.calEvents = res.events || [];
  renderCalGrid();
}

function renderCalGrid() {
  const grid = document.getElementById("calendarGrid");
  if (!grid) return;
  const y = state.calDate.getFullYear();
  const m = state.calDate.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = new Date().toISOString().split("T")[0];

  grid.innerHTML = "";

  // Leading blank cells
  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement("div");
    blank.className = "cal-cell blank";
    grid.appendChild(blank);
  }

  // Days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const dayEvents = (state.calEvents || []).filter(e => {
      const matchCat = state.calFilter === "ALL" || e.category === state.calFilter;
      return e.booking_date === dateStr && matchCat;
    });

    const cell = document.createElement("div");
    cell.className = "cal-cell" + (dateStr === todayStr ? " today" : "") + (dayEvents.length ? " has-events" : "");

    let pillsHtml = dayEvents.slice(0, 3).map(e => `
      <div class="cal-event-pill ${e.status}" title="${e.resource_name} (${e.start_time}-${e.end_time})">
        <span class="cal-pill-dot ${e.status}"></span>
        <span class="cal-pill-text">${e.resource_name}</span>
      </div>
    `).join("");

    if (dayEvents.length > 3) {
      pillsHtml += `<div class="cal-more-pill">+${dayEvents.length - 3} more</div>`;
    }

    cell.innerHTML = `<div class="cal-day-num">${d}</div><div class="cal-pills">${pillsHtml}</div>`;
    if (dayEvents.length) {
      cell.addEventListener("click", () => openCalFlyout(dateStr, dayEvents));
    }
    grid.appendChild(cell);
  }
}

function openCalFlyout(dateStr, events) {
  const flyout = document.getElementById("calEventFlyout");
  const label  = document.getElementById("flyoutDateLabel");
  const list   = document.getElementById("flyoutEventList");
  if (!flyout || !label || !list) return;

  label.textContent = `Bookings on ${dateStr}`;
  list.innerHTML = events.map(e => `
    <div class="flyout-item">
      <div class="flyout-resource">${e.resource_name} <span class="cat-badge">${e.category||""}</span></div>
      <div class="flyout-meta">${e.start_time}–${e.end_time} · ${e.full_name} · <span class="status-chip ${e.status}">${e.status}</span></div>
      ${e.purpose ? `<div class="flyout-purpose">${e.purpose}</div>` : ""}
    </div>
  `).join("");
  flyout.classList.remove("hidden");
}

/* ── Notifications ───────────────────────────────────────────────────────── */
async function loadNotifications() {
  if (!state.user) return;
  try {
    const res = await api("/api/notifications");
    const notifs = res.notifications || [];
    const unread = notifs.filter(n => !n.is_read);
    const badge = document.getElementById("notifBadge");
    if (badge) {
      badge.textContent = unread.length;
      badge.style.display = unread.length ? "inline-flex" : "none";
    }
    const list = document.getElementById("notifList");
    if (list) {
      if (!notifs.length) {
        list.innerHTML = '<div class="empty-state">No notifications.</div>';
        return;
      }
      list.innerHTML = notifs.map(n => `
        <div class="notif-item ${n.is_read ? "" : "unread"}" onclick="markNotifRead(${n.id})">
          <div class="notif-title">${n.title}</div>
          <div class="notif-msg">${n.message}</div>
          <div class="notif-time">${(n.created_at||"").replace("T"," ").substring(0,16)}</div>
        </div>
      `).join("");
    }
  } catch {}
}

async function markNotifRead(id) {
  await api(`/api/notifications/${id}/read`, { method: "PATCH" });
  loadNotifications();
}

/* ── Admin Dashboard ─────────────────────────────────────────────────────── */
async function loadAdminDashboard() {
  if (!state.user || state.user.role !== "ADMIN") return;
  try {
    const res = await api("/api/admin/stats");
    if (!res.summary) return;
    const s = res.summary;
    document.getElementById("kpiUsers").textContent     = s.total_users;
    document.getElementById("kpiResources").textContent = s.active_resources;
    document.getElementById("kpiTotal").textContent     = s.total_reservations;
    document.getElementById("kpiPending").textContent   = s.pending_approvals;
    document.getElementById("kpiToday").textContent     = s.approved_today;
    document.getElementById("kpiRejected").textContent  = s.rejected;

    // Utilization table
    const utilBody = document.getElementById("adminUtilizationBody");
    if (utilBody) {
      utilBody.innerHTML = (res.resource_utilization||[]).map(r => {
        const pct = s.total_reservations ? Math.round((r.total_bookings/s.total_reservations)*100) : 0;
        return `<tr>
          <td style="font-weight:500">${r.name}</td>
          <td><span class="cat-badge">${r.category}</span></td>
          <td style="text-align:center;font-family:var(--font-mono)">${r.total_bookings}</td>
          <td style="text-align:center;color:#34d399;font-family:var(--font-mono)">${r.approved||0}</td>
          <td style="text-align:center;color:#fbbf24;font-family:var(--font-mono)">${r.pending||0}</td>
          <td><div class="util-bar-wrap"><div class="util-bar"><div class="util-bar-fill" style="width:${pct}%"></div></div><span class="util-pct">${pct}%</span></div></td>
        </tr>`;
      }).join("") || '<tr><td colspan="6" class="tc">No data.</td></tr>';
    }

    // Role chart
    const totalU = (res.users_by_role||[]).reduce((sum,r)=>sum+r.count,0)||1;
    const roleChart = document.getElementById("adminRoleChart");
    if (roleChart) {
      roleChart.innerHTML = (res.users_by_role||[]).map(r => `
        <div class="role-row role-${r.role}">
          <span class="role-label">${r.role}</span>
          <div class="role-bar-bg"><div class="role-bar-fill" style="width:${Math.round(r.count/totalU*100)}%"></div></div>
          <span class="role-count">${r.count}</span>
        </div>`).join("");
    }

    // Activity feed
    const feed = document.getElementById("adminActivityFeed");
    if (feed) {
      feed.innerHTML = (res.recent_activity||[]).map(a => `
        <div class="activity-item">
          <div class="act-dot ${a.status}"></div>
          <div class="act-text">
            <div class="act-name">${a.full_name} → ${a.resource_name}</div>
            <div class="act-sub">${a.booking_code} · ${a.booking_date} ${a.start_time}–${a.end_time} · <span style="color:${statusColor(a.status)}">${a.status}</span></div>
          </div>
        </div>`).join("") || '<div class="tc">No activity yet.</div>';
    }
  } catch (err) { console.error("[AdminDashboard]", err); }
}

function statusColor(s) {
  return {PENDING:"#fbbf24",APPROVED:"#34d399",REJECTED:"#f87171",CHECKED_IN:"#22d3ee",CANCELLED:"#94a3b8"}[s]||"#94a3b8";
}

/* ═══════════════════════════════════════════════════════════════════════════
   SESSION RESTORE + INIT
   ═══════════════════════════════════════════════════════════════════════════ */
async function restoreSession() {
  if (!state.token) { syncUI(); return; }
  try {
    const res = await api("/api/auth/me");
    if (res.ok && res.user) {
      state.user = res.user;
      syncUI();
      populateResourceSelect();
      loadScheduleTimeline();
      loadNotifications();
    } else { logout(); }
  } catch { logout(); }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Set dynamic hero date
  const heroDateEl = document.getElementById("heroDateDisplay");
  if (heroDateEl) {
    const d = new Date();
    const dayNum = d.getDate();
    const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
    const monthName = d.toLocaleDateString("en-US", { month: "long" });
    heroDateEl.textContent = `${dayNum} ${dayName}, ${monthName}`;
  }

  // Set default booking date
  const today = new Date().toISOString().split("T")[0];
  const dateInput = document.getElementById("bookingDate");
  if (dateInput) {
    dateInput.value = today;
    dateInput.min   = today;
  }

  // Sidebar tab navigation
  document.querySelectorAll(".sidebar-btn[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Auth modal
  document.getElementById("authModalToggleBtn")?.addEventListener("click", openAuthModal);
  document.getElementById("closeAuthModalBtn")?.addEventListener("click", closeAuthModal);
  document.getElementById("tabLoginBtn")?.addEventListener("click", () => setAuthMode("login"));
  document.getElementById("tabRegisterBtn")?.addEventListener("click", () => setAuthMode("register"));
  document.getElementById("loginForm")?.addEventListener("submit", e => {
    e.preventDefault();
    login(document.getElementById("loginEmail").value, document.getElementById("loginPassword").value);
  });
  document.getElementById("registerForm")?.addEventListener("submit", e => {
    e.preventDefault();
    register({
      full_name:  document.getElementById("regFullName").value,
      email:      document.getElementById("regEmail").value,
      password:   document.getElementById("regPassword").value,
      role:       document.getElementById("regRole").value,
      department: document.getElementById("regDept").value
    });
  });

  // Backdrop click closes modal
  document.getElementById("authModal")?.addEventListener("click", e => {
    if (e.target === document.getElementById("authModal")) closeAuthModal();
  });

  // Reservation form
  document.getElementById("reservationForm")?.addEventListener("submit", submitReservation);
  document.getElementById("resourceSelect")?.addEventListener("change", onResourceChange);
  document.getElementById("bookingDate")?.addEventListener("change", loadTimeSlots);
  document.getElementById("clearSlotBtn")?.addEventListener("click", clearSlot);
  document.getElementById("refreshScheduleBtn")?.addEventListener("click", loadScheduleTimeline);

  // Bookings tab
  document.getElementById("refreshBookingsBtn")?.addEventListener("click", loadMyBookings);

  // Approvals
  document.getElementById("refreshApprovalsBtn")?.addEventListener("click", loadApprovals);
  document.getElementById("closeRejectModalBtn")?.addEventListener("click", () =>
    document.getElementById("rejectModal")?.classList.add("hidden"));
  document.getElementById("cancelRejectBtn")?.addEventListener("click", () =>
    document.getElementById("rejectModal")?.classList.add("hidden"));
  document.getElementById("confirmRejectBtn")?.addEventListener("click", confirmReject);

  // Admin refresh
  document.getElementById("refreshAdminBtn")?.addEventListener("click", loadAdminDashboard);

  // Email logs refresh
  document.getElementById("refreshAuditBtn")?.addEventListener("click", loadEmailLogs);

  // Override email
  document.getElementById("applyOverrideBtn")?.addEventListener("click", () => {
    const val = document.getElementById("overrideEmailInput").value.trim();
    if (val && val.includes("@")) {
      state.overrideEmail = val;
      document.getElementById("currentRecipientDisplay").textContent = val;
      document.getElementById("overrideEmailInput").value = "";
      toast(`Dispatch target overridden → ${val}`, "info");
    } else if (!val) {
      state.overrideEmail = null;
      document.getElementById("currentRecipientDisplay").textContent = state.user?.email || "—";
      toast("Override cleared — using account email.", "info");
    }
  });

  // Notifications bell
  document.getElementById("notifBellBtn")?.addEventListener("click", () => {
    document.getElementById("notifFlyout")?.classList.toggle("hidden");
  });
  document.getElementById("markAllReadBtn")?.addEventListener("click", async () => {
    await api("/api/notifications/read-all", { method: "PATCH" });
    loadNotifications();
  });

  // Calendar controls
  document.getElementById("calPrevBtn")?.addEventListener("click", () => {
    state.calDate.setMonth(state.calDate.getMonth()-1); loadCalendar();
  });
  document.getElementById("calNextBtn")?.addEventListener("click", () => {
    state.calDate.setMonth(state.calDate.getMonth()+1); loadCalendar();
  });
  document.getElementById("closeFlyoutBtn")?.addEventListener("click", () =>
    document.getElementById("calEventFlyout")?.classList.add("hidden"));
  document.querySelectorAll(".cal-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".cal-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      state.calFilter = chip.dataset.filter;
      renderCalGrid();
    });
  });

  // Restore session
  await restoreSession();

  // Auto-refresh notifications every 60s
  setInterval(loadNotifications, 60000);
});
