# CampusReserve - University Facility & Resource Allocation System

CampusReserve is an automated university facility and equipment reservation platform built for academic institutions (MIT-WPU). It streamlines reservation workflows, enforces concurrency-safe booking logic, provides role-based access control (RBAC), and integrates a decoupled dual-channel notification service (in-app alerts + email dispatches).

---

## 🏛️ Architectural Overview

CampusReserve follows a modular, layered REST architecture designed for auditability and clean separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                 Client Layer (public/)                      │
│       Vanilla JS SPA • Role Simulator • Live Timetable      │
└──────────────────────────────┬──────────────────────────────┘
                               │ JSON / Bearer JWT
┌──────────────────────────────▼──────────────────────────────┐
│                    API Gateway & Routing                    │
│     Express.js • Auth Guards • Role Middleware (RBAC)       │
└──────────────────────────────┬──────────────────────────────┘
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
┌──────────────────────────────┐       ┌──────────────────────────────┐
│      Reservation Engine      │       │     Notification Service     │
│  • Time-window validation    │       │  • Decoupled fire-and-forget │
│  • Concurrency collision     │       │  • Resend / Ethereal /       │
│    detection algorithm       │       │    Simulated fallback        │
│  • Dynamic approval policy   │       │  • Audit ledger logging      │
└──────────────┬───────────────┘       └──────────────┬───────────────┘
               │                                      │
               └───────────────────────┬──────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Data Persistence Layer                    │
│       SQLite3 (campus_reserve.db) with PRAGMA foreign_keys  │
│  [users, resources, reservations, notifications, email_logs]│
└─────────────────────────────────────────────────────────────┘
```

### Key Subsystems:

1. **Layered REST Controllers & Routing (`server.js`, `routes/reservations.js`)**:
   - Clean endpoint isolation handling authentication, catalog browsing, reservation lifecycles, notification retrieval, and audit inspection.

2. **SQLite Persistence with Strict Foreign Keys (`database.js`)**:
   - Backed by `campus_reserve.db` with `PRAGMA foreign_keys = ON;`.
   - Five interconnected tables: `users`, `resources`, `reservations`, `notifications`, and `email_logs`.
   - Strict `CHECK` constraints on user roles, resource categories, reservation statuses, and email telemetry states.

3. **Concurrency-Safe Collision Guard**:
   - Prevents race conditions and double-bookings using serialized overlap checks:
     ```sql
     WHERE resource_id = ?
       AND booking_date = ?
       AND status IN ('PENDING', 'APPROVED', 'CHECKED_IN')
       AND (start_time < ? AND end_time > ?)
     ```
   - Conflicting overlaps trigger immediate `HTTP 409 Conflict` errors with the offending booking code.

4. **Role-Based Access Control (RBAC) (`middleware/auth.js`)**:
   - Validates Bearer tokens and re-verifies active database user records.
   - Enforces role separation:
     - `STUDENT`: Self-serve reservations, automated status resolution, and personal booking history.
     - `FACULTY`: Approval bypass for restricted facilities, cross-department visibility, and approval/rejection powers.
     - `ADMIN`: Full authority across catalog, reservations, approvals desk, and email dispatch audit ledgers.

5. **Decoupled Dual-Channel Notification Engine (`services/`)**:
   - Guaranteed immediate in-app notification insertion (`notifications` table).
   - Fire-and-forget asynchronous email delivery using `emailService.js`.
   - Multi-tier delivery fallback chain: **Resend API** → **Nodemailer (Ethereal test sandbox)** → **Simulated console logging**, ensuring external delivery failures never crash or block HTTP transactions.

---

## 🚀 Quickstart Instructions

### Prerequisites
- Node.js (v18+)
- npm

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone <repo-url> campus-reserve
cd campus-reserve
npm install
```

### 2. Environment Configuration
Verify or copy the environment configuration:
```bash
cp .env.example .env
```
Default configuration values:
```env
PORT=3000
JWT_SECRET=academic_secret_key_2026
EMAIL_PROVIDER=ethereal
```

### 3. Start the Server
Run the application server:
```bash
node server.js
```
The application will be live at:
- **Web Portal**: [http://localhost:3000](http://localhost:3000)
- **Health Check**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

### 4. Execute the Lab 07 Test Suite
In a separate terminal (while `server.js` is running), execute the automated test runner:
```bash
node test-suite.js
```

---

## 🔑 Demo & Seeded Credentials

The database automatically seeds 3 pre-configured demonstration accounts (passwords hashed with `bcryptjs`, 10 rounds):

| Role | Full Name | Email | Password | Department | Permissions / Access |
|---|---|---|---|---|---|
| **STUDENT** | Saksham Sisodiya | `student@mitwpu.edu.in` | `student123` | CSE | Book facilities, view personal reservations, digital check-in/out |
| **FACULTY** | Prof. Yogini Mukherjee | `faculty@mitwpu.edu.in` | `faculty123` | CSE | Instant approval bypass on restricted facilities, review & reject approvals desk |
| **ADMIN** | Facility Manager | `admin@mitwpu.edu.in` | `admin123` | Campus Ops | Institutional clearance, approvals desk, audit ledgers, cancellation overrides |

*Tip: The web frontend includes a **One-Click Role Simulator** in the top navigation bar to seamlessly switch between these accounts.*

---

## 🧪 PBL-III Lab 07: Test Suite Coverage Summary

[`test-suite.js`](test-suite.js) validates both black-box functional boundaries and white-box basis paths against the live API engine:

| Test ID | Test Category | Method / Endpoint | Scenario Description | Expected Outcome |
|---|---|---|---|---|
| **`BB-TC01`** | Black-Box | `GET /api/resources` | Query resource catalog with valid authentication | `HTTP 200` with non-empty array of active resources |
| **`BB-TC02`** | Black-Box | `POST /api/reservations` | Submit reservation with missing required fields | `HTTP 400` validation failure with descriptive error |
| **`WB-Path 1`** | White-Box (Branch Coverage) | `POST /api/reservations` | Book approval-gated lab (`requires_approval = 1`) as `STUDENT` | `HTTP 201` with status evaluating to `PENDING` |
| **`WB-Path 2`** | White-Box (Basis Path) | `POST /api/reservations` | Submit booking request overlapping with existing active slot | `HTTP 409 Conflict` (collision branch executed) |
| **`WB-Path 3`** | White-Box (Role Bypass) | `POST /api/reservations` | Book approval-gated lab (`requires_approval = 1`) as `FACULTY` | `HTTP 201` bypassing approval directly to `APPROVED` |
| **`WB-Path 4`** | White-Box (Auto-Approve) | `POST /api/reservations` | Book unrestricted resource (`requires_approval = 0`) as `STUDENT` | `HTTP 201` with status evaluating to `APPROVED` |

### Sample Output:
```
====================================================================
  PBL-III Lab 07: CampusReserve Verification Test Suite
  Target Server: http://localhost:3000
====================================================================

[Phase 0: Pre-Test Authentication Setup]
  ✔ Authenticated Student (Saksham Sisodiya)
  ✔ Authenticated Faculty (Prof. Yogini Mukherjee)

[Phase 1: Black-Box Test Cases (Functional & Interface Testing)]
  [PASS] BB-TC01: GET /api/resources returns non-empty catalog array
         ↳ Found 4 active resources
  [PASS] BB-TC02: POST /api/reservations with missing fields triggers HTTP 400 validation error
         ↳ Server responded: "Missing required fields: resource_id, booking_date, start_time, end_time, purpose."

[Phase 2: White-Box Test Cases (Branch Coverage & Basis Path Testing)]
  [PASS] WB-Path 1: Requires Approval = 1 & Role = STUDENT -> Status evaluates to PENDING
         ↳ Booking CR-2026-XXXX assigned status: PENDING
  [PASS] WB-Path 2: Strict Collision Branch triggers HTTP 409 Conflict on overlapping slot
         ↳ Rejection confirmed: "Time slot conflict..."
  [PASS] WB-Path 3: Requires Approval = 1 & Role = FACULTY -> Bypass approval to auto-APPROVED
         ↳ Booking CR-2026-YYYY assigned status: APPROVED
  [PASS] WB-Path 4: Requires Approval = 0 -> Auto-Approve for Student to APPROVED
         ↳ Booking CR-2026-ZZZZ assigned status: APPROVED

--------------------------------------------------------------------
Test Summary Tally:
  Total Executed : 6
  Passed         : 6
  Failed         : 0

🎉 ALL BLACK-BOX & WHITE-BOX TEST CASES PASSED SUCCESSFULLY!
```

---

## 📁 Repository Directory Structure

```
campus-reserve/
├── .env                  # Active environment variables
├── .env.example          # Template environment file
├── .gitignore            # Git exclusion patterns
├── campus_reserve.db     # SQLite database
├── database.js           # Database connection, schemas, and demo seeders
├── middleware/
│   └── auth.js           # JWT verification and requireRole middleware
├── package.json          # Node dependencies and metadata
├── public/               # Client-side web portal
│   ├── app.js            # Frontend logic and API integration
│   ├── index.html        # Main HTML layout
│   └── style.css         # Dark-mode styling and UI components
├── README.md             # Project documentation
├── routes/
│   └── reservations.js   # Reservation lifecycle and approval endpoints
├── server.js             # Express application entrypoint
├── services/
│   ├── emailService.js   # Dual-channel email delivery and templates
│   └── notificationService.js # In-app notification dispatcher
└── test-suite.js         # Lab 07 automated black-box & white-box test suite
```
