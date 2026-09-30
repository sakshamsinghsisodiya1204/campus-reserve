/**
 * PBL-III Lab 07: Automated Black-Box & White-Box Test Suite
 * System: CampusReserve (MIT-WPU Smart Campus Reservation Engine)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

let passedCount = 0;
let failedCount = 0;

function logPass(id, description, details = '') {
  passedCount++;
  console.log(`  ${colors.green}[PASS]${colors.reset} ${colors.bright}${id}${colors.reset}: ${description}`);
  if (details) console.log(`         ${colors.dim}↳ ${details}${colors.reset}`);
}

function logFail(id, description, err) {
  failedCount++;
  console.log(`  ${colors.red}[FAIL]${colors.reset} ${colors.bright}${id}${colors.reset}: ${description}`);
  console.log(`         ${colors.red}↳ Error: ${err.message || err}${colors.reset}`);
}

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

async function runTestSuite() {
  console.log(`\n${colors.cyan}${colors.bright}====================================================================`);
  console.log(`  PBL-III Lab 07: CampusReserve Verification Test Suite`);
  console.log(`  Target Server: ${BASE_URL}`);
  console.log(`====================================================================${colors.reset}\n`);

  let studentToken = null;
  let facultyToken = null;
  let adminToken = null;

  // ── Phase 0: Authentication Setup ────────────────────────────────────────
  console.log(`${colors.yellow}${colors.bright}[Phase 0: Pre-Test Authentication Setup]${colors.reset}`);
  try {
    const studentRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'student@mitwpu.edu.in', password: 'student123' })
    });
    if (studentRes.status === 200 && studentRes.data.token) {
      studentToken = studentRes.data.token;
      console.log(`  ✔ Authenticated Student (${studentRes.data.user.full_name})`);
    } else {
      throw new Error(`Failed to login as student: ${JSON.stringify(studentRes.data)}`);
    }

    const facultyRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'faculty@mitwpu.edu.in', password: 'faculty123' })
    });
    if (facultyRes.status === 200 && facultyRes.data.token) {
      facultyToken = facultyRes.data.token;
      console.log(`  ✔ Authenticated Faculty (${facultyRes.data.user.full_name})`);
    } else {
      throw new Error(`Failed to login as faculty: ${JSON.stringify(facultyRes.data)}`);
    }

    const adminRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@mitwpu.edu.in', password: 'admin123' })
    });
    if (adminRes.status === 200 && adminRes.data.token) {
      adminToken = adminRes.data.token;
      console.log(`  ✔ Authenticated Administrator (${adminRes.data.user.full_name})`);
    }
  } catch (err) {
    console.error(`\n${colors.red}[FATAL] Setup failed. Ensure the server is running on ${BASE_URL}.${colors.reset}`);
    console.error(err.message);
    process.exit(1);
  }

  console.log();

  // ── Phase 1: Black-Box Test Cases ─────────────────────────────────────────
  console.log(`${colors.yellow}${colors.bright}[Phase 1: Black-Box Test Cases (Functional & Interface Testing)]${colors.reset}`);

  // BB-TC01: GET /api/resources
  try {
    const res = await request('/api/resources', {
      method: 'GET',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    if (res.status === 200 && Array.isArray(res.data.resources) && res.data.resources.length > 0) {
      logPass('BB-TC01', 'GET /api/resources returns non-empty catalog array', `Found ${res.data.resources.length} active resources`);
    } else {
      throw new Error(`Expected HTTP 200 and non-empty resources array. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('BB-TC01', 'GET /api/resources returns non-empty catalog array', err);
  }

  // BB-TC02: POST /api/reservations with missing required body fields
  try {
    const res = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ resource_id: 1 /* missing booking_date, start_time, end_time, purpose */ })
    });
    if (res.status === 400 && res.data.error) {
      logPass('BB-TC02', 'POST /api/reservations with missing fields triggers HTTP 400 validation error', `Server responded: "${res.data.error}"`);
    } else {
      throw new Error(`Expected HTTP 400. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('BB-TC02', 'POST /api/reservations with missing fields triggers HTTP 400 validation error', err);
  }

  console.log();

  // ── Phase 2: White-Box Test Cases ─────────────────────────────────────────
  console.log(`${colors.yellow}${colors.bright}[Phase 2: White-Box Test Cases (Branch Coverage & Basis Path Testing)]${colors.reset}`);

  // Generate a UNIQUE test date far in the future using a random offset (3-9 years ahead)
  const randomYearOffset = 3 + Math.floor(Math.random() * 7);
  const randomMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const randomDay = String(1 + Math.floor(Math.random() * 27)).padStart(2, '0');
  const testYear = new Date().getFullYear() + randomYearOffset;
  const testDate = `${testYear}-${randomMonth}-${randomDay}`;
  console.log(`  ${colors.dim}↳ Generated unique test date: ${testDate}${colors.reset}\n`);

  // WB-Path 1: Requires Approval = 1, Role = STUDENT -> PENDING
  try {
    const res = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        resource_id: 1, // AI & Robotics Lab (requires_approval = 1)
        booking_date: testDate,
        start_time: '09:00',
        end_time: '11:00',
        purpose: 'WB-Path 1: Autonomous Robotics Sensor Verification'
      })
    });
    if (res.status === 201 && res.data.booking && res.data.booking.status === 'PENDING') {
      logPass('WB-Path 1', 'Requires Approval = 1 & Role = STUDENT -> Status evaluates to PENDING',
        `Booking ${res.data.booking.booking_code} assigned status: ${res.data.booking.status}`);
    } else {
      throw new Error(`Expected HTTP 201 with status 'PENDING'. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('WB-Path 1', 'Requires Approval = 1 & Role = STUDENT -> Status evaluates to PENDING', err);
  }

  // WB-Path 2: Strict Collision Branch -> HTTP 409
  try {
    const res = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        resource_id: 1,
        booking_date: testDate,
        start_time: '09:00',
        end_time: '11:00',
        purpose: 'WB-Path 2: Conflicting Double-Booking Attempt'
      })
    });
    if (res.status === 409 && res.data.error) {
      logPass('WB-Path 2', 'Strict Collision Branch triggers HTTP 409 Conflict on overlapping slot',
        `Rejection confirmed: "${res.data.error}"`);
    } else {
      throw new Error(`Expected HTTP 409 Conflict. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('WB-Path 2', 'Strict Collision Branch triggers HTTP 409 Conflict on overlapping slot', err);
  }

  // WB-Path 3: Role Bypass: Requires Approval = 1, Role = FACULTY -> APPROVED (different non-overlapping slot)
  try {
    const res = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${facultyToken}` },
      body: JSON.stringify({
        resource_id: 1, // AI & Robotics Lab (requires_approval = 1)
        booking_date: testDate,
        start_time: '13:00',
        end_time: '15:00',
        purpose: 'WB-Path 3: Faculty Research Lab Session'
      })
    });
    if (res.status === 201 && res.data.booking && res.data.booking.status === 'APPROVED') {
      logPass('WB-Path 3', 'Requires Approval = 1 & Role = FACULTY -> Bypass approval to auto-APPROVED',
        `Booking ${res.data.booking.booking_code} assigned status: ${res.data.booking.status}`);
    } else {
      throw new Error(`Expected HTTP 201 with status 'APPROVED'. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('WB-Path 3', 'Requires Approval = 1 & Role = FACULTY -> Bypass approval to auto-APPROVED', err);
  }

  // WB-Path 4: Requires Approval = 0 -> Auto-Approve for Student -> APPROVED
  try {
    const res = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        resource_id: 3, // Meta Quest 3 VR Kit (requires_approval = 0)
        booking_date: testDate,
        start_time: '14:00',
        end_time: '16:00',
        purpose: 'WB-Path 4: VR Spatial Computing Simulation'
      })
    });
    if (res.status === 201 && res.data.booking && res.data.booking.status === 'APPROVED') {
      logPass('WB-Path 4', 'Requires Approval = 0 -> Auto-Approve for Student to APPROVED',
        `Booking ${res.data.booking.booking_code} assigned status: ${res.data.booking.status}`);
    } else {
      throw new Error(`Expected HTTP 201 with status 'APPROVED'. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('WB-Path 4', 'Requires Approval = 0 -> Auto-Approve for Student to APPROVED', err);
  }

  console.log();

  // ── Phase 3: Registration Guardrails & Admin Lock ─────────────────────────
  console.log(`${colors.yellow}${colors.bright}[Phase 3: Registration Guardrails & Strict Admin Lock]${colors.reset}`);

  // REG-01: Admin self-registration rejection (HTTP 403)
  try {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name: 'Unauthorized Rogue Admin',
        email: `fakeadmin_${Date.now()}@mitwpu.edu.in`,
        password: 'password123',
        department: 'Security',
        role: 'ADMIN'
      })
    });
    if (res.status === 403 && res.data.error && res.data.error.includes('Admin registration is restricted')) {
      logPass('REG-01', 'Hard-locked Admin Registration blocked with HTTP 403 Forbidden',
        `Rejection confirmed: "${res.data.error}"`);
    } else {
      throw new Error(`Expected HTTP 403 Forbidden. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('REG-01', 'Hard-locked Admin Registration blocked with HTTP 403 Forbidden', err);
  }

  // REG-02: Valid Student Registration (HTTP 201)
  const testStudentEmail = `testuser_${Date.now()}@gmail.com`;
  try {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name: 'Verified Student Tester',
        email: testStudentEmail,
        password: 'password123',
        department: 'Computer Science',
        role: 'STUDENT'
      })
    });
    if (res.status === 201 && res.data.token && res.data.user.role === 'STUDENT') {
      logPass('REG-02', 'Student Registration returns HTTP 201 & session token',
        `User ${res.data.user.email} created with role ${res.data.user.role}`);
    } else {
      throw new Error(`Expected HTTP 201. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('REG-02', 'Student Registration returns HTTP 201 & session token', err);
  }

  console.log();

  // ── Phase 4: Consecutive Repeat Booking Verification ──────────────────────
  console.log(`${colors.yellow}${colors.bright}[Phase 4: Consecutive Repeat Booking Verification]${colors.reset}`);

  // CONSEC-01: Student books slot A, then immediately books slot B on same date
  try {
    const book1 = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        resource_id: 3, // Meta Quest 3 VR Kit
        booking_date: testDate,
        start_time: '08:00',
        end_time: '09:00',
        purpose: 'Consecutive Booking Session 1'
      })
    });

    const book2 = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        resource_id: 3, // Meta Quest 3 VR Kit
        booking_date: testDate,
        start_time: '11:00',
        end_time: '12:00',
        purpose: 'Consecutive Booking Session 2'
      })
    });

    if (book1.status === 201 && book2.status === 201) {
      logPass('CONSEC-01', 'Consecutive repeat bookings on separate slots succeed seamlessly without reload',
        `Slot 1: ${book1.data.booking.booking_code} | Slot 2: ${book2.data.booking.booking_code}`);
    } else {
      throw new Error(`Expected both bookings to return 201. Received ${book1.status} and ${book2.status}`);
    }
  } catch (err) {
    logFail('CONSEC-01', 'Consecutive repeat bookings on separate slots succeed seamlessly without reload', err);
  }

  console.log();

  // ── Phase 5: Resource Inventory Management (Faculty & Admin) ──────────────
  console.log(`${colors.yellow}${colors.bright}[Phase 5: Resource Inventory Management (Faculty & Admin)]${colors.reset}`);

  let createdResourceId = null;

  // RES-01: Faculty creates new resource (POST /api/resources)
  try {
    const res = await request('/api/resources', {
      method: 'POST',
      headers: { Authorization: `Bearer ${facultyToken}` },
      body: JSON.stringify({
        name: `High-Performance Compute Node ${Date.now() % 1000}`,
        category: 'Specialized Hardware',
        capacity: 8,
        location: 'Server Room 104',
        requires_approval: 1,
        is_under_maintenance: 0
      })
    });
    if (res.status === 201 && res.data.resource && res.data.resource.id) {
      createdResourceId = res.data.resource.id;
      logPass('RES-01', 'Faculty creates new campus resource (POST /api/resources)',
        `Created resource ID ${createdResourceId}: "${res.data.resource.name}"`);
    } else {
      throw new Error(`Expected HTTP 201. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('RES-01', 'Faculty creates new campus resource (POST /api/resources)', err);
  }

  // RES-02: Faculty toggles availability to Maintenance (PATCH /api/resources/:id/availability)
  if (createdResourceId) {
    try {
      const res = await request(`/api/resources/${createdResourceId}/availability`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${facultyToken}` },
        body: JSON.stringify({ is_under_maintenance: 1 })
      });
      if (res.status === 200 && res.data.is_under_maintenance === true) {
        logPass('RES-02', 'Faculty toggles resource to Under Maintenance (PATCH /availability)',
          `Resource ${createdResourceId} status: is_under_maintenance = ${res.data.is_under_maintenance}`);
      } else {
        throw new Error(`Expected HTTP 200 with is_under_maintenance = true. Received status ${res.status}: ${JSON.stringify(res.data)}`);
      }
    } catch (err) {
      logFail('RES-02', 'Faculty toggles resource to Under Maintenance (PATCH /availability)', err);
    }

    // RES-03: Student booking rejected on maintenance resource (HTTP 400)
    try {
      const res = await request('/api/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentToken}` },
        body: JSON.stringify({
          resource_id: createdResourceId,
          booking_date: testDate,
          start_time: '16:00',
          end_time: '17:00',
          purpose: 'Attempt to book maintenance resource'
        })
      });
      if (res.status === 400 && res.data.error && res.data.error.includes('maintenance')) {
        logPass('RES-03', 'Student booking blocked on maintenance resource with HTTP 400',
          `Rejection confirmed: "${res.data.error}"`);
      } else {
        throw new Error(`Expected HTTP 400 Bad Request. Received status ${res.status}: ${JSON.stringify(res.data)}`);
      }
    } catch (err) {
      logFail('RES-03', 'Student booking blocked on maintenance resource with HTTP 400', err);
    }
  }

  // ── Phase 6: User Cross-Resource Collision Defense & Admin Revocation ─
  console.log(`${colors.yellow}${colors.bright}[Phase 6: User Cross-Resource Collision Defense & Admin Revocation]${colors.reset}`);

  // GUARD-01: User Cross-Resource Double Booking Rejection (HTTP 409)
  const overlapRandMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const overlapRandDay = String(1 + Math.floor(Math.random() * 27)).padStart(2, "0");
  const overlapTestDate = `${testYear + 2}-${overlapRandMonth}-${overlapRandDay}`;
  try {
    // 1. Student books Resource 1 from 10:00 to 12:00
    const firstBookingRes = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        resource_id: 1, // AI & Robotics Lab
        booking_date: overlapTestDate,
        start_time: '10:00',
        end_time: '12:00',
        purpose: 'AI Model Training 10:00-12:00'
      })
    });

    if (firstBookingRes.status !== 201) {
      throw new Error(`Initial booking failed with status ${firstBookingRes.status}: ${JSON.stringify(firstBookingRes.data)}`);
    }

    // 2. Same student attempts to book Resource 2 from 11:00 to 13:00 (overlapping window)
    const secondBookingConflict = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        resource_id: 2, // IoT & Embedded Systems Lab
        booking_date: overlapTestDate,
        start_time: '11:00',
        end_time: '13:00',
        purpose: 'Conflicting Cross-Resource Hardware Session 11:00-13:00'
      })
    });

    if (
      secondBookingConflict.status === 409 &&
      secondBookingConflict.data.error &&
      secondBookingConflict.data.error.includes('Schedule conflict: You already have an active reservation for another resource')
    ) {
      logPass('GUARD-01', 'User Cross-Resource Double Booking blocked with HTTP 409 Conflict',
        `Rejection confirmed: "${secondBookingConflict.data.error}"`);
    } else {
      throw new Error(`Expected HTTP 409 Conflict. Received status ${secondBookingConflict.status}: ${JSON.stringify(secondBookingConflict.data)}`);
    }
  } catch (err) {
    logFail('GUARD-01', 'User Cross-Resource Double Booking blocked with HTTP 409 Conflict', err);
  }

  // REVOKE-01: Administrative Override to Cancel an APPROVED Reservation
  const overrideRandMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const overrideRandDay = String(1 + Math.floor(Math.random() * 27)).padStart(2, "0");
  const adminOverrideDate = `${testYear + 3}-${overrideRandMonth}-${overrideRandDay}`;
  try {
    // 1. Faculty books auto-approved resource (Requires Approval = 0 or Faculty Role)
    const approvedBookingRes = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${facultyToken}` },
      body: JSON.stringify({
        resource_id: 1,
        booking_date: adminOverrideDate,
        start_time: '14:00',
        end_time: '16:00',
        purpose: 'Faculty Research Colloquium'
      })
    });

    if (approvedBookingRes.status !== 201 || approvedBookingRes.data.booking.status !== 'APPROVED') {
      throw new Error(`Setup failed: Booking not created with APPROVED status. Received ${JSON.stringify(approvedBookingRes.data)}`);
    }

    const bookingIdToRevoke = approvedBookingRes.data.booking.id;

    // 2. Admin issues revocation with justification reason
    const revokeRes = await request(`/api/reservations/${bookingIdToRevoke}/cancel`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        reason: 'Emergency departmental maintenance and institutional campus audit.'
      })
    });

    if (revokeRes.status === 200 && revokeRes.data.booking && revokeRes.data.booking.status === 'CANCELLED') {
      logPass('REVOKE-01', 'Admin successfully overrides & revokes APPROVED reservation (status -> CANCELLED)',
        `Reservation #${bookingIdToRevoke} status updated to: ${revokeRes.data.booking.status}`);
    } else {
      throw new Error(`Expected HTTP 200 with status CANCELLED. Received status ${revokeRes.status}: ${JSON.stringify(revokeRes.data)}`);
    }

    // 3. Verify that the revoked slot is now immediately freed and re-bookable by another user
    const rebookSlotRes = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        resource_id: 1,
        booking_date: adminOverrideDate,
        start_time: '14:00',
        end_time: '16:00',
        purpose: 'Student re-booking previously occupied and revoked slot'
      })
    });

    if (rebookSlotRes.status === 201) {
      logPass('REVOKE-02', 'Revoked time slot is immediately released and re-bookable by other users',
        `Re-booking confirmed: Code ${rebookSlotRes.data.booking.booking_code}`);
    } else {
      throw new Error(`Expected HTTP 201 for re-booking revoked slot. Received ${rebookSlotRes.status}: ${JSON.stringify(rebookSlotRes.data)}`);
    }
  } catch (err) {
    logFail('REVOKE-01/02', 'Administrative Override Revocation & Resource Freeing', err);
  }

  console.log();

  // ── Summary Tally ─────────────────────────────────────────────────────────
  const total = passedCount + failedCount;
  console.log(`\n${colors.cyan}--------------------------------------------------------------------${colors.reset}`);
  console.log(`${colors.bright}Test Summary Tally:${colors.reset}`);
  console.log(`  Total Executed : ${total}`);
  console.log(`  Passed         : ${colors.green}${passedCount}${colors.reset}`);
  console.log(`  Failed         : ${failedCount > 0 ? colors.red : colors.green}${failedCount}${colors.reset}`);

  if (failedCount === 0) {
    console.log(`\n${colors.green}${colors.bright}🎉 ALL VERIFICATION TEST CASES PASSED WITH 100% SUCCESS!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}${colors.bright}❌ SOME TEST CASES FAILED.${colors.reset}\n`);
    process.exit(1);
  }
}

runTestSuite();
