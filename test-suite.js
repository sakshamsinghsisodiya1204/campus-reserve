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
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function runTestSuite() {
  console.log(`\n${colors.cyan}${colors.bright}====================================================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}  PBL-III Lab 07: CampusReserve Verification Test Suite${colors.reset}`);
  console.log(`${colors.dim}  Target Server: ${BASE_URL}${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}====================================================================${colors.reset}\n`);

  let studentToken = null;
  let facultyToken = null;

  // ── Setup & Authentication ────────────────────────────────────────────────
  console.log(`${colors.yellow}${colors.bright}[Phase 0: Pre-Test Authentication Setup]${colors.reset}`);
  
  try {
    const studentRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'student@mitwpu.edu.in', password: 'student123' })
    });

    if (studentRes.status === 200 && studentRes.data.token) {
      studentToken = studentRes.data.token;
      console.log(`  ${colors.green}✔${colors.reset} Authenticated Student (Saksham Sisodiya)`);
    } else {
      throw new Error(`Student auth failed with status ${studentRes.status}: ${JSON.stringify(studentRes.data)}`);
    }

    const facultyRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'faculty@mitwpu.edu.in', password: 'faculty123' })
    });

    if (facultyRes.status === 200 && facultyRes.data.token) {
      facultyToken = facultyRes.data.token;
      console.log(`  ${colors.green}✔${colors.reset} Authenticated Faculty (Prof. Yogini Mukherjee)\n`);
    } else {
      throw new Error(`Faculty auth failed with status ${facultyRes.status}: ${JSON.stringify(facultyRes.data)}`);
    }
  } catch (err) {
    console.error(`\n${colors.red}[FATAL] Setup failed. Ensure the server is running on ${BASE_URL}.${colors.reset}`);
    console.error(err.message);
    process.exit(1);
  }

  // ── Black-Box Test Cases ──────────────────────────────────────────────────
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
      body: JSON.stringify({
        resource_id: 1
        // missing booking_date, start_time, end_time, purpose
      })
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

  // ── White-Box Test Cases ──────────────────────────────────────────────────
  console.log(`${colors.yellow}${colors.bright}[Phase 2: White-Box Test Cases (Branch Coverage & Basis Path Testing)]${colors.reset}`);

  // WB-Path 1: Requires Approval Branch = 1, Role = STUDENT -> PENDING
  try {
    const res = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        resource_id: 1, // AI & Robotics Lab (requires_approval = 1)
        booking_date: '2026-10-15',
        start_time: '09:00',
        end_time: '11:00',
        purpose: 'WB-Path 1: Autonomous Robotics Sensor Verification'
      })
    });

    if (res.status === 201 && res.data.booking && res.data.booking.status === 'PENDING') {
      logPass(
        'WB-Path 1',
        'Requires Approval = 1 & Role = STUDENT -> Status evaluates to PENDING',
        `Booking ${res.data.booking.booking_code} assigned status: ${res.data.booking.status}`
      );
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
        booking_date: '2026-10-15',
        start_time: '09:00',
        end_time: '11:00',
        purpose: 'WB-Path 2: Conflicting Double-Booking Attempt'
      })
    });

    if (res.status === 409 && res.data.error) {
      logPass(
        'WB-Path 2',
        'Strict Collision Branch triggers HTTP 409 Conflict on overlapping slot',
        `Rejection confirmed: "${res.data.error}"`
      );
    } else {
      throw new Error(`Expected HTTP 409 Conflict. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('WB-Path 2', 'Strict Collision Branch triggers HTTP 409 Conflict on overlapping slot', err);
  }

  // WB-Path 3: Role Bypass Branch: Requires Approval = 1, Role = FACULTY -> APPROVED
  try {
    const res = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${facultyToken}` },
      body: JSON.stringify({
        resource_id: 1, // AI & Robotics Lab (requires_approval = 1)
        booking_date: '2026-10-15',
        start_time: '11:00',
        end_time: '13:00',
        purpose: 'WB-Path 3: Faculty Research Lab Session'
      })
    });

    if (res.status === 201 && res.data.booking && res.data.booking.status === 'APPROVED') {
      logPass(
        'WB-Path 3',
        'Requires Approval = 1 & Role = FACULTY -> Bypass approval to auto-APPROVED',
        `Booking ${res.data.booking.booking_code} assigned status: ${res.data.booking.status}`
      );
    } else {
      throw new Error(`Expected HTTP 201 with status 'APPROVED'. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('WB-Path 3', 'Requires Approval = 1 & Role = FACULTY -> Bypass approval to auto-APPROVED', err);
  }

  // WB-Path 4: Requires Approval Branch = 0, Auto-Approve -> APPROVED
  try {
    const res = await request('/api/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        resource_id: 3, // Meta Quest 3 VR Kit (requires_approval = 0)
        booking_date: '2026-10-15',
        start_time: '14:00',
        end_time: '16:00',
        purpose: 'WB-Path 4: VR Spatial Computing Simulation'
      })
    });

    if (res.status === 201 && res.data.booking && res.data.booking.status === 'APPROVED') {
      logPass(
        'WB-Path 4',
        'Requires Approval = 0 -> Auto-Approve for Student to APPROVED',
        `Booking ${res.data.booking.booking_code} assigned status: ${res.data.booking.status}`
      );
    } else {
      throw new Error(`Expected HTTP 201 with status 'APPROVED'. Received status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    logFail('WB-Path 4', 'Requires Approval = 0 -> Auto-Approve for Student to APPROVED', err);
  }

  // ── Summary Tally ─────────────────────────────────────────────────────────
  const total = passedCount + failedCount;
  console.log(`\n${colors.cyan}--------------------------------------------------------------------${colors.reset}`);
  console.log(`${colors.bright}Test Summary Tally:${colors.reset}`);
  console.log(`  Total Executed : ${total}`);
  console.log(`  Passed         : ${colors.green}${passedCount}${colors.reset}`);
  console.log(`  Failed         : ${failedCount > 0 ? colors.red : colors.green}${failedCount}${colors.reset}`);

  if (failedCount === 0) {
    console.log(`\n${colors.green}${colors.bright}🎉 ALL BLACK-BOX & WHITE-BOX TEST CASES PASSED SUCCESSFULLY!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}${colors.bright}❌ SOME TEST CASES FAILED.${colors.reset}\n`);
    process.exit(1);
  }
}

runTestSuite();
