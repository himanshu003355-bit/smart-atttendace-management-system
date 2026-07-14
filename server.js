require('dotenv').config();
const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'Public')));
// Explicit fallback route to serve index.html on the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Public', 'index.html'));
});

// ---------- MySQL connection pool ----------
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  // Most hosted MySQL providers require SSL. Set DB_SSL=false to disable locally.
  ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false }
});

const LECTURES_PER_DAY = 8;

// ---------- helpers ----------
function toDateStr(d) {
  // MySQL DATE columns come back as JS Date objects; normalize to YYYY-MM-DD
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return d;
}

async function buildState() {
  const [studentRows] = await pool.query('SELECT roll, name FROM students ORDER BY roll');
  const [markRows] = await pool.query('SELECT roll, date, lecture, status FROM marks');
  const [cancelRows] = await pool.query('SELECT date, lecture FROM cancelled_lectures');

  const students = studentRows.map(s => ({ roll: s.roll, name: s.name, marks: {} }));
  const byRoll = Object.fromEntries(students.map(s => [s.roll, s]));

  markRows.forEach(m => {
    const s = byRoll[m.roll];
    if (!s) return;
    const date = toDateStr(m.date);
    if (!s.marks[date]) s.marks[date] = {};
    s.marks[date][m.lecture] = m.status;
  });

  const cancelled = {};
  cancelRows.forEach(c => {
    const date = toDateStr(c.date);
    if (!cancelled[date]) cancelled[date] = [];
    cancelled[date].push(c.lecture);
  });

  return { students, cancelled };
}

// ---------- routes ----------

// Full snapshot — the frontend calls this after every action to stay in sync
app.get('/api/state', async (req, res) => {
  try {
    res.json(await buildState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load data' });
  }
});

// Add a student
app.post('/api/students', async (req, res) => {
  const { roll, name } = req.body;
  if (!roll || !name) return res.status(400).json({ error: 'roll and name are required' });
  try {
    await pool.query('INSERT INTO students (roll, name) VALUES (?, ?)', [roll, name]);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A student with this roll number is already on the register.' });
    }
    console.error(e);
    res.status(500).json({ error: 'Could not add student' });
  }
});

// Delete a student (marks are removed automatically via ON DELETE CASCADE)
app.delete('/api/students/:roll', async (req, res) => {
  try {
    await pool.query('DELETE FROM students WHERE roll = ?', [req.params.roll]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not delete student' });
  }
});

// Cycle a single lecture slot: unmarked -> present -> absent -> unmarked
app.post('/api/mark', async (req, res) => {
  const { roll, date, lecture } = req.body;
  if (!roll || !date || !lecture) return res.status(400).json({ error: 'roll, date and lecture are required' });

  try {
    const [[cancelled]] = await pool.query(
      'SELECT 1 FROM cancelled_lectures WHERE date = ? AND lecture = ?',
      [date, lecture]
    );
    if (cancelled) return res.json({ ok: true }); // cancelled lectures can't be marked

    const [[existing]] = await pool.query(
      'SELECT status FROM marks WHERE roll = ? AND date = ? AND lecture = ?',
      [roll, date, lecture]
    );

    if (!existing) {
      await pool.query(
        'INSERT INTO marks (roll, date, lecture, status) VALUES (?, ?, ?, "present")',
        [roll, date, lecture]
      );
    } else if (existing.status === 'present') {
      await pool.query(
        'UPDATE marks SET status = "absent" WHERE roll = ? AND date = ? AND lecture = ?',
        [roll, date, lecture]
      );
    } else {
      await pool.query(
        'DELETE FROM marks WHERE roll = ? AND date = ? AND lecture = ?',
        [roll, date, lecture]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update mark' });
  }
});

// Reset all lectures for a given date
app.post('/api/reset-today', async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });
  try {
    await pool.query('DELETE FROM marks WHERE date = ?', [date]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not reset date' });
  }
});

// Toggle a lecture cancelled/not-cancelled for the whole class on a date.
// Cancelling also clears any marks already made for that lecture.
app.post('/api/cancel', async (req, res) => {
  const { date, lecture } = req.body;
  if (!date || !lecture) return res.status(400).json({ error: 'date and lecture are required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[existing]] = await conn.query(
      'SELECT 1 FROM cancelled_lectures WHERE date = ? AND lecture = ?',
      [date, lecture]
    );

    if (!existing) {
      await conn.query('INSERT INTO cancelled_lectures (date, lecture) VALUES (?, ?)', [date, lecture]);
      await conn.query('DELETE FROM marks WHERE date = ? AND lecture = ?', [date, lecture]);
    } else {
      await conn.query('DELETE FROM cancelled_lectures WHERE date = ? AND lecture = ?', [date, lecture]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Could not toggle cancellation' });
  } finally {
    conn.release();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Smart Attendance Register listening on port ${PORT}`));