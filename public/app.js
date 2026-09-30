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
  calFilter: "ALL",
  catFilter: "ALL",
  resourcesList: []
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
function switchTab(id, _fromMetricCard = false) {
  state.activeTab = id;
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === id));
  document.querySelectorAll(".sidebar-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === id));

  // When navigating manually (not from a metric card click), clear metric filter state
  if (!_fromMetricCard && state.metricFilter) {
    state.metricFilter = null;
    document.querySelectorAll(".metric-card--clickable").forEach(el => el.classList.remove("metric-active"));
    const banner = document.getElementById("metricFilterBanner");
    if (banner) banner.remove();
  }

  if (id === "tab-reserve") {
    populateResourceSelect();
    // If triggered by Active Bookings card, filter APPROVED only
    const approvedFilter = (state.metricFilter === "metCard-active") ? "APPROVED" : null;
    loadScheduleTimeline(approvedFilter);
  }
  if (id === "tab-resources")    loadResourcesCatalog();
  if (id === "tab-my-bookings") {
    // If triggered by Queue card (student), show only PENDING
    const pendingFilter = (state.metricFilter === "metCard-queue") ? "PENDING" : null;
    loadMyBookings(pendingFilter);
  }
  if (id === "tab-approvals")    loadApprovals();
  if (id === "tab-email-ledger") loadEmailLogs();
  if (id === "tab-calendar")     loadCalendar();
  if (id === "tab-admin")        loadAdminDashboard();
  if (id === "tab-notifications") loadNotifications();
}

/* ── Remembered Accounts Storage ─────────────────────────────────────────── */
function getSavedAccounts() {
  const defaultSeeds = [
    {
      full_name: "Saksham Sisodiya",
      email: "student@mitwpu.edu.in",
      role: "STUDENT",
      department: "CSE",
      is_seed: true
    },
    {
      full_name: "Prof. Yogini Mukherjee",
      email: "faculty@mitwpu.edu.in",
      role: "FACULTY",
      department: "CSE",
      is_seed: true
    },
    {
      full_name: "Facility Manager",
      email: "admin@mitwpu.edu.in",
      role: "ADMIN",
      department: "Campus Ops",
      is_seed: true
    }
  ];

  try {
    const raw = localStorage.getItem("cr_saved_accounts");
    if (!raw) return defaultSeeds;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultSeeds;
    return parsed;
  } catch {
    return defaultSeeds;
  }
}

function saveAccountHistory(u) {
  if (!u || !u.email) return;
  try {
    let accounts = getSavedAccounts();
    // Remove if already exists to push to front
    accounts = accounts.filter(a => a.email.toLowerCase() !== u.email.toLowerCase());
    accounts.unshift({
      full_name: u.full_name,
      email: u.email.toLowerCase(),
      role: u.role,
      department: u.department || "General",
      last_login: Date.now()
    });
    // Keep top 6
    accounts = accounts.slice(0, 6);
    localStorage.setItem("cr_saved_accounts", JSON.stringify(accounts));
    renderSavedAccounts();
  } catch (err) {
    console.warn("[saveAccountHistory error]", err);
  }
}

function clearSavedAccounts() {
  localStorage.removeItem("cr_saved_accounts");
  renderSavedAccounts();
  toast("Recent account history cleared.", "info");
}

function renderSavedAccounts() {
  const container = document.getElementById("savedAccountsList");
  if (!container) return;
  const accounts = getSavedAccounts();
  if (!accounts.length) {
    container.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);padding:6px 0">No recent accounts saved.</div>';
    return;
  }

  container.innerHTML = accounts.map(a => {
    const initials = a.full_name ? a.full_name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase() : "U";
    const roleLower = (a.role || "student").toLowerCase();
    return `
      <div class="saved-account-card" onclick="selectSavedAccount('${a.email}','${a.role}')">
        <div class="saved-account-avatar ${roleLower}">${initials}</div>
        <div class="saved-account-info">
          <div class="saved-account-name">${a.full_name}</div>
          <div class="saved-account-email">${a.email}</div>
          <span class="saved-account-role ${roleLower}">${a.role}</span>
        </div>
      </div>
    `;
  }).join("");
}

function selectSavedAccount(email, role) {
  const emailInput = document.getElementById("loginEmail");
  const passInput  = document.getElementById("loginPassword");
  if (emailInput) {
    emailInput.value = email;
  }
  // Autofill demo password if standard demo account
  if (passInput) {
    if (email === "student@mitwpu.edu.in") passInput.value = "student123";
    else if (email === "faculty@mitwpu.edu.in") passInput.value = "faculty123";
    else if (email === "admin@mitwpu.edu.in") passInput.value = "admin123";
    else passInput.value = "";
    passInput.focus();
  }
  toast(`Selected account: ${email}`, "info");
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
  const addResBtn = document.getElementById("openAddResourceBtn");

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
    addResBtn?.classList.toggle("hidden", !isStaff);

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
    addResBtn?.classList.add("hidden");
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
  if (btn) { btn.textContent = "Sign In to Portal →"; btn.disabled = false; }
  if (res.ok && res.token) {
    state.token = res.token;
    state.user  = res.user;
    localStorage.setItem("cr_token", res.token);
    saveAccountHistory(res.user);
    closeAuthModal();
    syncUI();
    populateResourceSelect();
    loadScheduleTimeline();
    loadNotifications();
    toast(`Welcome back, ${res.user.full_name}! (${res.user.role})`, "success");
    return true;
  } else {
    toast(res.error || "Login failed. Check credentials.", "error");
    return false;
  }
}

async function register(data) {
  const btn = document.getElementById("registerSubmitBtn");
  if (btn) { btn.textContent = "Creating profile…"; btn.disabled = true; }
  const res = await api("/api/auth/register", { method: "POST", body: JSON.stringify(data) });
  if (btn) { btn.textContent = "Create Account & Send Welcome Email"; btn.disabled = false; }
  if (res.ok && res.token) {
    state.token = res.token;
    state.user  = res.user;
    localStorage.setItem("cr_token", res.token);
    saveAccountHistory(res.user);
    closeAuthModal();
    syncUI();
    populateResourceSelect();
    loadScheduleTimeline();
    loadNotifications();
    toast(`Account registered! 📧 Welcome email dispatched to ${res.user.email}`, "success");
    return true;
  } else {
    toast(res.error || "Registration failed.", "error");
    return false;
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
function openAuthModal()  {
  renderSavedAccounts();
  document.getElementById("authModal")?.classList.remove("hidden");
}
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
    const todayStr  = new Date().toISOString().split("T")[0];
    const active    = bookings.filter(b => ["APPROVED","PENDING","CHECKED_IN"].includes(b.status) && b.booking_date >= todayStr);
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

/* ── Metric Card Drill-Down Controller ───────────────────────────────────── */
function setMetricFilter(cardKey) {
  const all = ["metCard-active", "metCard-resources", "metCard-queue", "metCard-mine"];

  // If clicking the already-active card, clear the filter (toggle off)
  if (state.metricFilter === cardKey) {
    clearMetricFilter();
    return;
  }

  state.metricFilter = cardKey;

  // Update visual state on cards
  all.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("metric-active", id === cardKey);
  });

  // Route to correct tab and apply filter
  if (cardKey === "metCard-active") {
    // → Schedule/Feed tab, filter APPROVED only
    if (state.activeTab !== "tab-reserve") switchTab("tab-reserve");
    else { populateResourceSelect(); loadScheduleTimeline("APPROVED"); }
    // Inject filter banner
    showFilterBanner("Showing approved active bookings only");

  } else if (cardKey === "metCard-resources") {
    // → Resource Catalog tab
    switchTab("tab-resources");
    // No status filter needed — catalog shows all
    showFilterBanner("Showing full campus resource catalog");

  } else if (cardKey === "metCard-queue") {
    if (!state.user) { toast("Please sign in to view the review queue.", "warning"); return; }
    const isStaff = state.user.role === "ADMIN" || state.user.role === "FACULTY";
    if (isStaff) {
      // → Approvals Desk directly
      switchTab("tab-approvals");
      showFilterBanner("Review Queue: pending faculty/admin approvals");
    } else {
      // → My Bookings, filter PENDING
      switchTab("tab-my-bookings");
      // Tiny delay for tab render, then apply filter
      setTimeout(() => {
        loadMyBookings("PENDING");
        showFilterBanner("Showing your pending reservations awaiting clearance");
      }, 80);
    }

  } else if (cardKey === "metCard-mine") {
    // → My Bookings, no filter (all statuses)
    switchTab("tab-my-bookings");
    showFilterBanner("Showing all your reservations");
  }
}

function clearMetricFilter() {
  state.metricFilter = null;
  // Remove active class from all metric cards
  document.querySelectorAll(".metric-card--clickable").forEach(el => el.classList.remove("metric-active"));
  // Remove any filter banner
  const banner = document.getElementById("metricFilterBanner");
  if (banner) banner.remove();
  // Reload the current tab without filters
  switchTab(state.activeTab || "tab-reserve");
}

function showFilterBanner(text) {
  // Remove old banner if any
  const old = document.getElementById("metricFilterBanner");
  if (old) old.remove();

  const workspace = document.getElementById("mainWorkspace");
  if (!workspace) return;

  // Insert immediately after the metrics bar
  const metricsBar = document.getElementById("metricsBar");
  if (!metricsBar) return;

  const banner = document.createElement("div");
  banner.id = "metricFilterBanner";
  banner.className = "metric-filter-banner";
  banner.innerHTML = `
    <i class="fa-solid fa-filter"></i>
    <span>${text}</span>
    <button class="metric-filter-clear" onclick="clearMetricFilter()" aria-label="Clear filter">
      <i class="fa-solid fa-xmark"></i> Clear
    </button>
  `;
  metricsBar.insertAdjacentElement("afterend", banner);
}


/* ── Resource Select in Booking Form ─────────────────────────────────────── */
async function populateResourceSelect() {
  const sel = document.getElementById("resourceSelect");
  if (!sel) return;
  const currentVal = sel.value;
  const res = await api("/api/resources");
  if (!res.resources) return;
  state.resourcesList = res.resources;

  sel.innerHTML = '<option value="">— Select a resource —</option>';
  res.resources.forEach(r => {
    const opt = document.createElement("option");
    opt.value = r.id;
    const maintenanceTag = r.is_under_maintenance ? " [Under Maintenance]" : "";
    opt.textContent = `${r.name} (${r.category})${maintenanceTag}`;
    opt.dataset.approval = r.requires_approval;
    opt.dataset.maintenance = r.is_under_maintenance;
    opt.dataset.location = r.location || "";
    opt.dataset.capacity = r.capacity || "";
    if (r.is_under_maintenance) opt.disabled = true;
    sel.appendChild(opt);
  });

  if (currentVal) sel.value = currentVal;
  onResourceChange();
}

function onResourceChange() {
  const sel  = document.getElementById("resourceSelect");
  if (!sel) return;
  const opt  = sel.selectedOptions[0];
  const meta = document.getElementById("resourceMeta");
  const policy = document.getElementById("policyIndicator");
  if (!opt || !opt.value) {
    meta?.classList.add("hidden");
    if (policy) {
      policy.textContent = "Instant Clearance";
      policy.style.background = "rgba(16,185,129,0.12)";
      policy.style.color = "#059669";
    }
    loadTimeSlots();
    return;
  }
  if (meta) {
    meta.classList.remove("hidden");
    meta.innerHTML = `📍 ${opt.dataset.location} &nbsp;·&nbsp; Capacity: ${opt.dataset.capacity} seats`;
  }
  const needsApproval = opt.dataset.approval === "1";
  if (policy) {
    policy.textContent = needsApproval ? "Requires Approval" : "Instant Clearance";
    policy.style.background = needsApproval ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.12)";
    policy.style.color = needsApproval ? "#d97706" : "#059669";
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
    grid.innerHTML = '<span class="chip-loading">Select a resource and date to inspect slot availability</span>';
    return;
  }
  grid.innerHTML = '<span class="chip-loading"><i class="fa-solid fa-spinner fa-spin"></i> Checking slot availability…</span>';
  try {
    const res = await api(`/api/resources/${resourceId}/availability?date=${date}`);
    const booked = (res.booked_slots || []).map(s => `${s.start_time}-${s.end_time}`);
    grid.innerHTML = "";

    const currentStart = document.getElementById("startTime")?.value;
    const currentEnd   = document.getElementById("endTime")?.value;

    TIME_SLOTS.forEach(([s, e]) => {
      const isBooked = booked.some(b => {
        const [bs, be] = b.split("-");
        return s < be && e > bs;
      });
      const chip = document.createElement("button");
      chip.type = "button";
      const isSelected = currentStart === s && currentEnd === e;
      chip.className = "time-chip" + (isBooked ? " booked" : "") + (isSelected ? " active" : "");
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
  const startEl = document.getElementById("startTime");
  const endEl   = document.getElementById("endTime");
  if (startEl) startEl.value = start;
  if (endEl)   endEl.value   = end;
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

/* ── Submit Reservation (CRITICAL BUG FIX: CONSECUTIVE BOOKINGS) ─────────── */
async function submitReservation(e) {
  e.preventDefault();
  if (!state.user) { openAuthModal(); return; }

  const resourceId  = document.getElementById("resourceSelect")?.value;
  const bookingDate = document.getElementById("bookingDate")?.value;
  const startTime   = document.getElementById("startTime")?.value;
  const endTime     = document.getElementById("endTime")?.value;
  const purpose     = document.getElementById("purposeInput")?.value?.trim();

  if (!resourceId) { toast("Please select a resource.", "warning"); return; }
  if (!bookingDate) { toast("Please select a valid booking date.", "warning"); return; }
  if (!startTime || !endTime) { toast("Please select a time slot from the grid.", "warning"); return; }
  if (!purpose) { toast("Please describe the academic purpose of your reservation.", "warning"); return; }

  const btn = document.getElementById("submitReservationBtn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Confirming Reservation…';
  }

  try {
    const payload = {
      resource_id: parseInt(resourceId, 10),
      booking_date: bookingDate,
      start_time: startTime,
      end_time: endTime,
      purpose
    };
    if (state.overrideEmail) payload.notification_email = state.overrideEmail;

    const res = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (res.status === 409) {
      toast(`⚡ Slot conflict: ${res.error}`, "error");
    } else if (res.status === 400) {
      toast(res.error || "Invalid booking specifications.", "error");
    } else if (res.booking) {
      const st = res.booking.status;
      toast(
        st === "PENDING"
          ? `Booking ${res.booking.booking_code} submitted — awaiting Faculty/Admin clearance.`
          : `Booking ${res.booking.booking_code} confirmed! 📧 Notification dispatched.`,
        st === "PENDING" ? "warning" : "success"
      );

      // Cleanly reset purpose & time slot selection, keeping resource and date ready for consecutive bookings!
      const purposeEl = document.getElementById("purposeInput");
      if (purposeEl) purposeEl.value = "";
      clearSlot();

      // Refresh slot chips so newly booked slot is immediately marked "Reserved"
      await loadTimeSlots();
      refreshMetrics();
      loadScheduleTimeline();
    } else {
      toast(res.error || "Failed to submit booking.", "error");
    }
  } catch (err) {
    console.error("[submitReservation error]", err);
    toast("An unexpected error occurred during booking.", "error");
  } finally {
    // ALWAYS re-enable submit button and restore label
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Confirm Reservation &nbsp;→';
    }
  }
}

/* ── Schedule Timeline ───────────────────────────────────────────────────── */
async function loadScheduleTimeline(statusFilter = null) {
  const container = document.getElementById("scheduleTimeline");
  if (!container) return;
  if (!state.user) { container.innerHTML = '<div class="empty-state-msg">Sign in to view your schedule.</div>'; return; }
  const isAdmin = state.user.role === "ADMIN";
  const endpoint = isAdmin ? "/api/reservations" : "/api/reservations/my";
  const res = await api(endpoint);
  // If a status filter is injected from the metric card drill-down, apply it
  const allowedStatuses = statusFilter
    ? [statusFilter]
    : ["APPROVED","PENDING","CHECKED_IN"];
  const bookings = (res.reservations || res.bookings || []).filter(b => allowedStatuses.includes(b.status)).slice(0, 20);
  if (!bookings.length) {
    container.innerHTML = '<div class="empty-state-msg">No upcoming bookings. Reserve a facility above!</div>';
    return;
  }
  container.innerHTML = bookings.map(b => `
    <div class="schedule-item">
      <div class="schedule-dot ${b.status}"></div>
      <div class="schedule-info">
        <div class="schedule-resource">${b.resource_name} ${isAdmin && (b.user_name || b.student_name) ? `<span style="font-size:0.75rem;font-weight:400;color:var(--charcoal-muted,#64748b)">(${b.user_name || b.student_name})</span>` : ""}</div>
        <div class="schedule-time">${b.booking_date} · ${b.start_time}–${b.end_time}</div>
      </div>
      <div class="schedule-actions" style="display:flex;align-items:center;gap:6px">
        <span class="status-chip ${b.status}">${b.status}</span>
        ${b.status === "APPROVED" && isAdmin ? `
          <button class="btn-revoke" onclick="openAdminRevokeModal(${b.id}, '${b.booking_code}')" title="Admin Revoke">
            Revoke
          </button>
        ` : b.status === "PENDING" && !isAdmin && b.user_id === state.user.id ? `
          <button class="btn-cancel" onclick="openAdminRevokeModal(${b.id}, '${b.booking_code}')" title="Cancel Booking">
            Cancel
          </button>
        ` : ""}
      </div>
    </div>
  `).join("");
}

/* ── Resource Catalog & Inventory Management (FACULTY & ADMIN) ───────────── */
async function loadResourcesCatalog() {
  const grid = document.getElementById("resourceCatalogGrid");
  if (!grid) return;
  grid.innerHTML = '<div class="glass-card tc" style="grid-column:1/-1;padding:36px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> Loading catalog…</div>';

  try {
    const res = await api("/api/resources");
    const resources = res.resources || [];
    state.resourcesList = resources;

    const filtered = resources.filter(r => {
      if (state.catFilter === "ALL") return true;
      return r.category === state.catFilter;
    });

    if (!filtered.length) {
      grid.innerHTML = '<div class="glass-card tc" style="grid-column:1/-1;padding:36px;color:var(--text-muted)">No resources found in this category.</div>';
      return;
    }

    const isStaff = state.user && (state.user.role === "FACULTY" || state.user.role === "ADMIN");

    grid.innerHTML = filtered.map(r => {
      const isMaint = r.is_under_maintenance === 1;
      const needsApprove = r.requires_approval === 1;

      return `
        <div class="resource-catalog-card ${isMaint ? 'maintenance-mode' : ''}" id="res-card-${r.id}">
          <div>
            <div class="res-card-top">
              <div class="res-card-title">${r.name}</div>
            </div>

            <div class="res-badge-group">
              <span class="res-badge category">${r.category}</span>
              <span class="res-badge ${needsApprove ? 'approval' : 'instant'}">
                ${needsApprove ? 'Requires Approval' : 'Instant Clearance'}
              </span>
              <span class="res-badge ${isMaint ? 'maintenance-status' : 'active-status'}">
                ${isMaint ? 'Under Maintenance' : 'Active & Available'}
              </span>
            </div>

            <div class="res-meta-rows">
              <div class="res-meta-item">
                <i class="fa-solid fa-location-dot"></i>
                <span>${r.location}</span>
              </div>
              <div class="res-meta-item">
                <i class="fa-solid fa-users"></i>
                <span>Capacity: <strong>${r.capacity}</strong> persons / units</span>
              </div>
            </div>
          </div>

          <div class="res-actions-bar">
            ${isStaff ? `
              <button class="btn-toggle-avail" onclick="toggleResourceAvailability(${r.id})">
                <i class="fa-solid ${isMaint ? 'fa-play' : 'fa-wrench'}"></i>
                <span>${isMaint ? 'Activate' : 'Set Maintenance'}</span>
              </button>
              <button class="btn-edit-res" onclick="openEditResourceModal(${r.id})">
                <i class="fa-solid fa-pen-to-square"></i> Edit
              </button>
            ` : `
              <button class="btn-book-res" ${isMaint ? 'disabled' : ''} onclick="quickSelectResourceForBooking(${r.id})">
                <i class="fa-regular fa-calendar-plus"></i>
                <span>${isMaint ? 'Unavailable' : 'Book Facility'}</span>
              </button>
            `}
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("[loadResourcesCatalog error]", err);
    grid.innerHTML = `<div class="glass-card tc" style="grid-column:1/-1;padding:36px;color:#dc2626">Failed to load resources: ${err.message}</div>`;
  }
}

function quickSelectResourceForBooking(resId) {
  switchTab("tab-reserve");
  const sel = document.getElementById("resourceSelect");
  if (sel) {
    sel.value = resId;
    onResourceChange();
  }
}

function openAddResourceModal() {
  document.getElementById("resourceModalTitle").textContent = "Add New Campus Resource";
  document.getElementById("resEditId").value = "";
  document.getElementById("resName").value = "";
  document.getElementById("resCategory").value = "Laboratory";
  document.getElementById("resCapacity").value = "40";
  document.getElementById("resLocation").value = "";
  document.getElementById("resApproval").value = "1";
  document.getElementById("resStatus").value = "0";
  document.getElementById("resourceModal")?.classList.remove("hidden");
}

function openEditResourceModal(id) {
  const r = state.resourcesList.find(item => item.id === id);
  if (!r) return;
  document.getElementById("resourceModalTitle").textContent = `Edit "${r.name}"`;
  document.getElementById("resEditId").value = r.id;
  document.getElementById("resName").value = r.name;
  document.getElementById("resCategory").value = r.category;
  document.getElementById("resCapacity").value = r.capacity;
  document.getElementById("resLocation").value = r.location;
  document.getElementById("resApproval").value = String(r.requires_approval);
  document.getElementById("resStatus").value = String(r.is_under_maintenance);
  document.getElementById("resourceModal")?.classList.remove("hidden");
}

function closeResourceModal() {
  document.getElementById("resourceModal")?.classList.add("hidden");
}

async function saveResourceForm(e) {
  e.preventDefault();
  const id = document.getElementById("resEditId").value;
  const payload = {
    name: document.getElementById("resName").value.trim(),
    category: document.getElementById("resCategory").value,
    capacity: parseInt(document.getElementById("resCapacity").value, 10),
    location: document.getElementById("resLocation").value.trim(),
    requires_approval: parseInt(document.getElementById("resApproval").value, 10),
    is_under_maintenance: parseInt(document.getElementById("resStatus").value, 10)
  };

  const isEdit = !!id;
  const url = isEdit ? `/api/resources/${id}` : "/api/resources";
  const method = isEdit ? "PUT" : "POST";

  const btn = document.getElementById("saveResourceSubmitBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  const res = await api(url, { method, body: JSON.stringify(payload) });
  if (btn) { btn.disabled = false; btn.textContent = "Save Resource Listing"; }

  if (res.ok) {
    toast(`Resource "${payload.name}" saved successfully.`, "success");
    closeResourceModal();
    loadResourcesCatalog();
    populateResourceSelect();
    refreshMetrics();
  } else {
    toast(res.error || "Failed to save resource.", "error");
  }
}

async function toggleResourceAvailability(id) {
  const res = await api(`/api/resources/${id}/availability`, {
    method: "PATCH",
    body: JSON.stringify({})
  });
  if (res.ok) {
    toast(res.message || "Availability updated.", "success");
    loadResourcesCatalog();
    populateResourceSelect();
    refreshMetrics();
  } else {
    toast(res.error || "Failed to toggle availability.", "error");
  }
}

/* ── My Bookings ─────────────────────────────────────────────────────────── */
async function loadMyBookings(statusFilter = null) {
  const tbody = document.getElementById("myReservationsTableBody");
  if (!tbody) return;
  if (!state.user) { tbody.innerHTML = '<tr><td colspan="6" class="tc">Please sign in.</td></tr>'; return; }
  tbody.innerHTML = '<tr><td colspan="6" class="tc">Loading…</td></tr>';
  const res = await api("/api/reservations/my");
  let bookings = res.reservations || res.bookings || [];
  if (statusFilter) bookings = bookings.filter(b => b.status === statusFilter);
  if (!bookings.length) { tbody.innerHTML = '<tr><td colspan="6" class="tc">No bookings yet.</td></tr>'; return; }
  tbody.innerHTML = bookings.map(b => `
    <tr>
      <td><span class="mono">${b.booking_code}</span></td>
      <td>${b.resource_name}<br><span class="cat-badge">${b.resource_category || ""}</span></td>
      <td>${b.booking_date}<br><span style="font-size:.72rem;color:var(--text-muted);font-family:var(--font-mono)">${b.start_time}–${b.end_time}</span></td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.purpose || "—"}</td>
      <td><span class="status-chip ${b.status}">${b.status}</span></td>
      <td style="text-align:right">
        ${["PENDING","APPROVED"].includes(b.status)
          ? `<button class="btn-cancel" onclick="cancelBooking(${b.id}, '${b.booking_code}')">Cancel</button>` : ""}
      </td>
    </tr>
  `).join("");
}

async function cancelBooking(id, code) {
  openAdminRevokeModal(id, code);
}


/* ── Administrative Revocation & Cancellation Modal ─────────────────────── */
function openAdminRevokeModal(id, code) {
  state.pendingRevokeId = id;
  const codeEl = document.getElementById("adminRevokeBookingCode");
  const reasonEl = document.getElementById("adminRevokeReasonInput");
  if (codeEl) codeEl.textContent = code || `#${id}`;
  if (reasonEl) reasonEl.value = "";
  document.getElementById("adminRevokeModal")?.classList.remove("hidden");
}

function closeAdminRevokeModal() {
  state.pendingRevokeId = null;
  document.getElementById("adminRevokeModal")?.classList.add("hidden");
}

async function confirmAdminRevoke() {
  if (!state.pendingRevokeId) return;
  const reason = document.getElementById("adminRevokeReasonInput")?.value.trim();
  const id = state.pendingRevokeId;
  const btn = document.getElementById("confirmAdminRevokeBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Revoking…"; }

  const isAdmin = state.user && state.user.role === "ADMIN";
  const defaultReason = isAdmin ? "Administrative revocation by campus management." : "Cancelled by user.";

  const res = await api(`/api/reservations/${id}/cancel`, {
    method: "PATCH",
    body: JSON.stringify({ reason: reason || defaultReason })
  });

  if (btn) { btn.disabled = false; btn.textContent = "Revoke & Release Slot"; }
  closeAdminRevokeModal();

  if (res.ok && res.success !== false) {
    toast(res.message || "Reservation revoked and slot released.", "success");
    loadScheduleTimeline();
    loadApprovals();
    loadMyBookings();
    refreshMetrics();
    loadTimeSlots();
    loadCalendar();
    if (state.user && state.user.role === "ADMIN") loadAdminDashboard();
  } else {
    toast(res.error || "Failed to revoke reservation.", "error");
  }
}

/* ── Approvals Desk ──────────────────────────────────────────────────────── */
async function loadApprovals() {
  const listEl = document.getElementById("approvals-list");
  if (!listEl) return;
  if (!state.user || (state.user.role !== "FACULTY" && state.user.role !== "ADMIN")) {
    listEl.innerHTML = `
      <div class="empty-approval-state glass-card" style="grid-column:1/-1;text-align:center;padding:48px 24px">
        <div style="font-size:2.5rem;color:var(--primary);margin-bottom:12px"><i class="fa-solid fa-lock"></i></div>
        <h3 style="font-size:1.1rem;font-weight:600;color:var(--charcoal);margin-bottom:6px">Access Restricted</h3>
        <p style="font-size:0.85rem;color:var(--charcoal-muted)">Approval Desk requires Faculty or Administrator credentials.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = '<div class="glass-card tc" style="grid-column:1/-1;padding:36px;color:var(--charcoal-muted)"><i class="fa-solid fa-spinner fa-spin"></i> Loading pending requests…</div>';

  try {
    const res = await api("/api/reservations/pending");
    const bookings = res.reservations || res.bookings || [];

    if (!bookings.length) {
      listEl.innerHTML = `
        <div class="empty-approval-state glass-card" style="grid-column:1/-1;text-align:center;padding:48px 24px">
          <div style="font-size:2.5rem;color:#10b981;margin-bottom:12px"><i class="fa-solid fa-clipboard-check"></i></div>
          <h3 style="font-size:1.1rem;font-weight:600;color:var(--charcoal);margin-bottom:6px">No pending reservations awaiting clearance.</h3>
          <p style="font-size:0.85rem;color:var(--charcoal-muted)">All submitted facility and laboratory requests have been processed.</p>
        </div>`;
      return;
    }

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
              <span class="approval-info-val mono" style="color:var(--primary)">${b.booking_code}</span>
            </div>
            <div class="approval-info-row">
              <span class="approval-info-label"><i class="fa-solid fa-user-graduate"></i> Student Requester</span>
              <span class="approval-info-val" style="font-weight:600;color:var(--charcoal)">${studentName}</span>
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
              <span class="approval-info-val mono" style="color:#0284c7">${b.start_time} – ${b.end_time}</span>
            </div>
            ${b.purpose ? `
              <div class="approval-purpose-box">
                <span class="approval-info-label"><i class="fa-solid fa-bullseye"></i> Purpose</span>
                <div class="approval-purpose-text">${b.purpose}</div>
              </div>` : ""}
          </div>

          <div class="approval-card-actions">
            <button class="btn-approve" onclick="approveBooking(${b.id})">
              ✓ Approve
            </button>
            <button class="btn-reject" onclick="openRejectModal(${b.id},'${b.booking_code}')">
              ✕ Reject
            </button>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("[loadApprovals error]", err);
    listEl.innerHTML = `<div class="glass-card tc" style="grid-column:1/-1;padding:30px;color:#dc2626">Failed to load approvals: ${err.message}</div>`;
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
  if (!state.pendingRejectId) return;
  const reason = document.getElementById("rejectionReasonInput")?.value.trim();
  const res = await api(`/api/reservations/${state.pendingRejectId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "REJECTED", reason: reason || "Institutional schedule conflict." })
  });
  document.getElementById("rejectModal")?.classList.add("hidden");
  if (res.ok && res.success !== false) {
    toast("Booking rejected. Notification email sent.", "info");
    state.pendingRejectId = null;
    loadApprovals();
    refreshMetrics();
  } else {
    toast(res.error || "Failed to reject booking.", "error");
  }
}

/* ── Email Logs & Audit Ledger ───────────────────────────────────────────── */
async function loadEmailLogs() {
  const tbody = document.getElementById("auditTableBody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="tc">Fetching telemetry ledger…</td></tr>';
  const res = await api("/api/admin/email-logs");
  const logs = res.logs || [];
  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="tc">No email dispatches recorded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td><span class="mono">${(l.sent_at||"").replace("T"," ").substring(0,19)}</span></td>
      <td><span class="mono" style="color:var(--charcoal)">${l.recipient_email}</span></td>
      <td><span class="cat-badge">${l.event_type}</span></td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.subject}</td>
      <td><span class="status-chip ${l.status==='SENT'?'APPROVED':'REJECTED'}">${l.status}</span></td>
      <td style="text-align:right">
        ${l.preview_url ? `<a href="${l.preview_url}" target="_blank" class="preview-link">Ethereal ↗</a>` : '<span style="font-size:0.72rem;color:var(--charcoal-muted)">Gmail SMTP</span>'}
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
let currentNotifFilter = "all";
let cachedNotifications = [];

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setNotifFilter(filter) {
  currentNotifFilter = filter;
  document.getElementById("notifFilterAllBtn")?.classList.toggle("active", filter === "all");
  document.getElementById("notifFilterUnreadBtn")?.classList.toggle("active", filter === "unread");
  renderFullNotifications();
}
window.setNotifFilter = setNotifFilter;

function renderFullNotifications() {
  const feed = document.getElementById("tabNotificationsFeed");
  if (!feed) return;

  const notifs = (currentNotifFilter === "unread")
    ? cachedNotifications.filter(n => !n.is_read)
    : cachedNotifications;

  if (!notifs.length) {
    feed.innerHTML = `
      <div class="notif-empty-state">
        <div class="notif-empty-icon"><i class="fa-regular fa-bell-slash"></i></div>
        <h3>No ${currentNotifFilter === "unread" ? "unread " : ""}notifications</h3>
        <p>You are all caught up! Real-time alerts for booking submissions, approvals, cancellations, and telemetry dispatches will appear here.</p>
      </div>
    `;
    return;
  }

  feed.innerHTML = notifs.map(n => {
    let icon = "fa-bell";
    let iconColor = "color:#0ea5e9";
    let typeLabel = "System Alert";

    if (n.type === "BOOKING_CREATED") {
      icon = "fa-hourglass-half";
      iconColor = "color:#f59e0b";
      typeLabel = "Booking Request";
    } else if (n.type === "BOOKING_APPROVED") {
      icon = "fa-circle-check";
      iconColor = "color:#10b981";
      typeLabel = "Approved";
    } else if (n.type === "BOOKING_REJECTED" || n.type === "BOOKING_CANCELLED") {
      icon = "fa-triangle-exclamation";
      iconColor = "color:#ef4444";
      typeLabel = "Cancellation / Rejection";
    } else if (n.type === "ADMIN_REVOCATION") {
      icon = "fa-shield-halved";
      iconColor = "color:#ea5b3a";
      typeLabel = "Admin Revocation";
    }

    return `
      <div class="notif-feed-card ${n.is_read ? "read" : "unread"}">
        <div class="notif-feed-icon">
          <i class="fa-solid ${icon}" style="${iconColor}"></i>
        </div>
        <div class="notif-feed-content">
          <div class="notif-feed-header">
            <span class="notif-feed-title">${escapeHtml(n.title)}</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="notif-type-tag">${typeLabel}</span>
              ${n.is_read ? '<span class="notif-read-pill">Read</span>' : '<span class="notif-unread-dot"><i class="fa-solid fa-circle" style="font-size:6px"></i> Unread</span>'}
            </div>
          </div>
          <div class="notif-feed-message">${escapeHtml(n.message)}</div>
          <div class="notif-feed-footer">
            <span class="notif-feed-time"><i class="fa-regular fa-clock"></i> ${(n.created_at||"").replace("T"," ").substring(0,16)}</span>
            ${n.booking_id ? `<span class="notif-feed-ref"><i class="fa-solid fa-hashtag"></i> Booking #${n.booking_id}</span>` : ""}
            ${!n.is_read ? `<button type="button" class="btn-mark-single-read" onclick="markNotifRead(${n.id})"><i class="fa-solid fa-check"></i> Mark read</button>` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

async function loadNotifications() {
  if (!state.user) return;
  try {
    const res = await api("/api/notifications");
    cachedNotifications = res.notifications || [];
    const notifs = cachedNotifications;
    const unread = notifs.filter(n => !n.is_read);

    // Update sidebar nav badge
    const badge = document.getElementById("notifBadge");
    if (badge) {
      badge.textContent = unread.length;
      badge.style.display = unread.length ? "inline-flex" : "none";
    }

    // Update flyout badge
    const flyoutBadge = document.getElementById("notifFlyoutBadge");
    if (flyoutBadge) {
      flyoutBadge.textContent = unread.length;
      flyoutBadge.style.display = unread.length ? "inline-flex" : "none";
    }

    // Update top bar bell badge
    const topBadge = document.getElementById("topNotifBadge");
    if (topBadge) {
      topBadge.textContent = unread.length;
      topBadge.style.display = unread.length ? "inline-flex" : "none";
    }

    // Update full tab counts
    const countAll = document.getElementById("notifCountAll");
    if (countAll) countAll.textContent = notifs.length;
    const countUnread = document.getElementById("notifCountUnread");
    if (countUnread) countUnread.textContent = unread.length;

    // Render flyout list (if open)
    const list = document.getElementById("notifList");
    if (list) {
      if (!notifs.length) {
        list.innerHTML = '<div class="empty-state">No notifications.</div>';
      } else {
        list.innerHTML = notifs.slice(0, 10).map(n => `
          <div class="notif-item ${n.is_read ? "" : "unread"}" onclick="markNotifRead(${n.id})">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            <div class="notif-msg">${escapeHtml(n.message)}</div>
            <div class="notif-time">${(n.created_at||"").replace("T"," ").substring(0,16)}</div>
          </div>
        `).join("");
      }
    }

    // Render full feed in tab-notifications
    renderFullNotifications();
  } catch (err) {
    console.error("Failed to load notifications:", err);
  }
}

async function markNotifRead(id) {
  try {
    await api(`/api/notifications/${id}/read`, { method: "PATCH" });
    await loadNotifications();
  } catch (err) {
    console.error("Failed to mark notification read:", err);
  }
}
window.markNotifRead = markNotifRead;

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
          <td style="text-align:center;color:#059669;font-family:var(--font-mono)">${r.approved||0}</td>
          <td style="text-align:center;color:#d97706;font-family:var(--font-mono)">${r.pending||0}</td>
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
            <strong>${a.full_name}</strong> booked <strong>${a.resource_name}</strong> (${a.booking_code})
            <div class="act-time">${a.booking_date} · ${a.start_time}–${a.end_time}</div>
          </div>
          <span class="status-chip ${a.status}">${a.status}</span>
        </div>`).join("") || '<div class="tc" style="padding:24px;color:var(--text-muted)">No recent activity.</div>';
    }
  } catch (err) {
    console.error("[loadAdminDashboard error]", err);
  }
}

/* ── Restore Session on Page Load ────────────────────────────────────────── */
async function restoreSession() {
  if (!state.token) {
    // Default to student demo user if no token exists yet
    await quickFillDemo("student");
    return;
  }
  const res = await api("/api/auth/me");
  if (res.ok && res.user) {
    state.user = res.user;
    saveAccountHistory(res.user);
    syncUI();
    populateResourceSelect();
    loadScheduleTimeline();
    loadNotifications();
  } else {
    state.token = null;
    localStorage.removeItem("cr_token");
    await quickFillDemo("student");
  }
}

/* ── Initialization & Event Listeners ────────────────────────────────────── */
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

  // Metric Card Drill-Down — click & keyboard (Enter/Space) routing
  ["metCard-active", "metCard-resources", "metCard-queue", "metCard-mine"].forEach(id => {
    const card = document.getElementById(id);
    if (!card) return;
    card.addEventListener("click", () => setMetricFilter(id));
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setMetricFilter(id);
      }
    });
  });

  // Auth modal
  document.getElementById("authModalToggleBtn")?.addEventListener("click", openAuthModal);
  document.getElementById("closeAuthModalBtn")?.addEventListener("click", closeAuthModal);
  document.getElementById("clearSavedAccountsBtn")?.addEventListener("click", clearSavedAccounts);
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

  // Resource Management Modal & Actions
  document.getElementById("openAddResourceBtn")?.addEventListener("click", openAddResourceModal);
  document.getElementById("closeResourceModalBtn")?.addEventListener("click", closeResourceModal);
  document.getElementById("cancelResourceModalBtn")?.addEventListener("click", closeResourceModal);
  document.getElementById("resourceForm")?.addEventListener("submit", saveResourceForm);
  document.getElementById("refreshCatalogBtn")?.addEventListener("click", loadResourcesCatalog);

  // Category filter chips in Catalog
  document.querySelectorAll("[data-cat-filter]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-cat-filter]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      state.catFilter = chip.dataset.catFilter;
      loadResourcesCatalog();
    });
  });

  // Backdrop click closes modals
  document.getElementById("authModal")?.addEventListener("click", e => {
    if (e.target === document.getElementById("authModal")) closeAuthModal();
  });
  document.getElementById("resourceModal")?.addEventListener("click", e => {
    if (e.target === document.getElementById("resourceModal")) closeResourceModal();
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

  // Notifications actions & tab switching
  document.getElementById("notifBellBtn")?.addEventListener("click", () => {
    switchTab("tab-notifications");
  });
  document.getElementById("markAllReadBtn")?.addEventListener("click", async () => {
    await api("/api/notifications/read-all", { method: "PATCH" });
    toast("All notifications marked as read.", "success");
    loadNotifications();
  });
  document.getElementById("markAllReadTabBtn")?.addEventListener("click", async () => {
    await api("/api/notifications/read-all", { method: "PATCH" });
    toast("All notifications marked as read.", "success");
    loadNotifications();
  });
  document.getElementById("refreshNotifsBtn")?.addEventListener("click", () => {
    loadNotifications();
    toast("Notifications refreshed.", "info");
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
  document.querySelectorAll(".cal-chip[data-filter]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".cal-chip[data-filter]").forEach(c => c.classList.remove("active"));
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
