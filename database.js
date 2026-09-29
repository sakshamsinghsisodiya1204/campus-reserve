const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'campus_reserve.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to connect to database:', err.message);
  } else {
    console.log('Connected to SQLite database at campus_reserve.db');
  }
});

// Enable Foreign Key enforcement
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON;', (err) => {
    if (err) {
      console.error('Failed to enable PRAGMA foreign_keys:', err.message);
    }
  });

  // 1. users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      department TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('STUDENT', 'FACULTY', 'ADMIN')),
      email_notifications_enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. resources table
  db.run(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('Laboratory', 'Seminar Hall', 'Specialized Hardware', 'Classroom')),
      capacity INTEGER NOT NULL,
      location TEXT NOT NULL,
      requires_approval INTEGER DEFAULT 0,
      is_under_maintenance INTEGER DEFAULT 0
    )
  `);

  // 3. reservations table
  db.run(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_code TEXT NOT NULL UNIQUE,
      resource_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      booking_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'CHECKED_IN', 'COMPLETED')),
      rejection_reason TEXT,
      checked_in_at DATETIME,
      checked_out_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 4. notifications table
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      booking_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 5. email_logs table
  db.run(`
    CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      recipient_email TEXT NOT NULL,
      event_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SENT', 'FAILED', 'SIMULATED')),
      preview_url TEXT,
      error_message TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed demo data if tables are empty
  seedDatabase();
});

function seedDatabase() {
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err) {
      console.error('Error checking users count:', err.message);
      return;
    }

    if (row.count === 0) {
      console.log('Seeding initial demo users...');
      const users = [
        {
          full_name: 'Saksham Sisodiya',
          email: 'student@mitwpu.edu.in',
          password: 'student123',
          role: 'STUDENT',
          department: 'CSE'
        },
        {
          full_name: 'Prof. Yogini Mukherjee',
          email: 'faculty@mitwpu.edu.in',
          password: 'faculty123',
          role: 'FACULTY',
          department: 'CSE'
        },
        {
          full_name: 'Facility Manager',
          email: 'admin@mitwpu.edu.in',
          password: 'admin123',
          role: 'ADMIN',
          department: 'Campus Ops'
        }
      ];

      const stmt = db.prepare(`
        INSERT INTO users (full_name, email, password_hash, department, role)
        VALUES (?, ?, ?, ?, ?)
      `);

      users.forEach((u) => {
        const hash = bcrypt.hashSync(u.password, 10);
        stmt.run(u.full_name, u.email, hash, u.department, u.role);
      });

      stmt.finalize(() => {
        console.log('Users seeded successfully.');
      });
    }
  });

  db.get('SELECT COUNT(*) as count FROM resources', (err, row) => {
    if (err) {
      console.error('Error checking resources count:', err.message);
      return;
    }

    if (row.count === 0) {
      console.log('Seeding initial demo resources...');
      const resources = [
        {
          name: 'AI & Robotics Lab',
          category: 'Laboratory',
          capacity: 40,
          location: 'B-Block Room 302',
          requires_approval: 1
        },
        {
          name: 'Aryabhata Seminar Hall',
          category: 'Seminar Hall',
          capacity: 250,
          location: 'Central Quad',
          requires_approval: 1
        },
        {
          name: 'Meta Quest 3 VR Kit',
          category: 'Specialized Hardware',
          capacity: 1,
          location: 'AR/VR Studio',
          requires_approval: 0
        },
        {
          name: 'Creality K1 High-Speed 3D Printer',
          category: 'Specialized Hardware',
          capacity: 1,
          location: 'Maker Space',
          requires_approval: 1
        }
      ];

      const stmt = db.prepare(`
        INSERT INTO resources (name, category, capacity, location, requires_approval, is_under_maintenance)
        VALUES (?, ?, ?, ?, ?, 0)
      `);

      resources.forEach((r) => {
        stmt.run(r.name, r.category, r.capacity, r.location, r.requires_approval);
      });

      stmt.finalize(() => {
        console.log('Resources seeded successfully.');
      });
    }
  });
}

module.exports = db;
