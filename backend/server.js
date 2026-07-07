const dns = require('dns');
// Force IPv4 DNS resolution — Render free tier blocks IPv6 outbound
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const cors = require('cors');
const { Pool, types } = require('pg');
const path = require('path');

// Return DATE column as plain 'YYYY-MM-DD' string instead of JS Date object (prevents timezone shifts)
types.setTypeParser(1082, val => val);

const app = express();
const PORT = process.env.PORT || 3001;

// Valid categories
const CATEGORIES = ['Asiatisch', 'Mediterran', 'Fast Food', 'Selbst gekocht', 'Sonstiges'];

// --- Database ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Auto-create table if it doesn't exist + migrate category column & add contestants table
async function initDB() {
  // Create contestants table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contestants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT UNIQUE NOT NULL,
      avatar TEXT NOT NULL DEFAULT '👨‍🍳',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Seed default contestants if empty
  const countRes = await pool.query('SELECT COUNT(*) FROM contestants');
  if (parseInt(countRes.rows[0].count, 10) === 0) {
    await pool.query(`
      INSERT INTO contestants (name, avatar) VALUES 
      ('Felix', '🧑‍💻'), 
      ('Shervin', '😎')
    `);
  }

  // Create expenses table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      person TEXT NOT NULL,
      date DATE NOT NULL,
      amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Drop old CHECK constraint on person if it exists from previous iterations
  await pool.query(`
    ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_person_check;
  `);

  // Add category column if it doesn't exist yet (migration)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'expenses' AND column_name = 'category'
      ) THEN
        ALTER TABLE expenses ADD COLUMN category TEXT DEFAULT 'Sonstiges';
      END IF;
    END $$;
  `);

  console.log('✅ Datenbank bereit');
}

app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// --- API Routes ---

// --- Contestants CRUD ---

// Get all contestants
app.get('/api/contestants', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contestants ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Add contestant
app.post('/api/contestants', async (req, res) => {
  const { name, avatar } = req.body;
  if (!name || !avatar) {
    return res.status(400).json({ error: 'Name und Avatar sind Pflichtfelder.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO contestants (name, avatar) VALUES ($1, $2) RETURNING *',
      [name.trim(), avatar]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Dieser Name existiert bereits.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Update contestant (name/avatar) and cascade update their expenses
app.put('/api/contestants/:id', async (req, res) => {
  const { name, avatar } = req.body;
  if (!name || !avatar) {
    return res.status(400).json({ error: 'Name und Avatar sind Pflichtfelder.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get old name
    const oldRes = await client.query('SELECT name FROM contestants WHERE id = $1', [req.params.id]);
    if (oldRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Mitbewerber nicht gefunden.' });
    }
    const oldName = oldRes.rows[0].name;
    const newName = name.trim();

    // Update contestant
    const updatedRes = await client.query(
      'UPDATE contestants SET name = $1, avatar = $2 WHERE id = $3 RETURNING *',
      [newName, avatar, req.params.id]
    );

    // Cascade update expenses if name changed
    if (oldName !== newName) {
      await client.query('UPDATE expenses SET person = $1 WHERE person = $2', [newName, oldName]);
    }

    await client.query('COMMIT');
    res.json(updatedRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Dieser Name existiert bereits.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler' });
  } finally {
    client.release();
  }
});

// Delete contestant and cascade delete their expenses
app.delete('/api/contestants/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const deletedRes = await client.query('DELETE FROM contestants WHERE id = $1 RETURNING *', [req.params.id]);
    if (deletedRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Mitbewerber nicht gefunden.' });
    }
    
    const deletedName = deletedRes.rows[0].name;

    // Delete their expenses
    await client.query('DELETE FROM expenses WHERE person = $1', [deletedName]);

    await client.query('COMMIT');
    res.json({ message: 'Mitbewerber und alle zugehörigen Ausgaben gelöscht.', deleted: deletedRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler' });
  } finally {
    client.release();
  }
});

// --- Expenses CRUD ---

// Get all expenses
app.get('/api/expenses', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses ORDER BY date DESC, created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Get categories
app.get('/api/categories', (req, res) => {
  res.json(CATEGORIES);
});

// Add expense
app.post('/api/expenses', async (req, res) => {
  const { person, date, amount, category } = req.body;

  if (!person || !date || amount === undefined) {
    return res.status(400).json({ error: 'person, date und amount sind Pflichtfelder.' });
  }
  if (typeof amount !== 'number' || amount < 0) {
    return res.status(400).json({ error: 'amount muss eine positive Zahl sein.' });
  }

  const cat = CATEGORIES.includes(category) ? category : 'Sonstiges';

  try {
    // Validate that person exists in contestants
    const personCheck = await pool.query('SELECT 1 FROM contestants WHERE name = $1', [person]);
    if (personCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Ungültiger Mitbewerber.' });
    }

    const result = await pool.query(
      'INSERT INTO expenses (person, date, amount, category) VALUES ($1, $2, $3, $4) RETURNING *',
      [person, date, Math.round(amount * 100) / 100, cat]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Delete expense
app.delete('/api/expenses/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM expenses WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    }
    res.json({ deleted: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Dynamic Summary
app.get('/api/summary', async (req, res) => {
  try {
    const contestantsRes = await pool.query('SELECT * FROM contestants ORDER BY created_at ASC');
    const contestants = contestantsRes.rows;

    const expensesRes = await pool.query('SELECT * FROM expenses');
    const expenses = expensesRes.rows;

    const summary = {
      contestants: {},
      leader: null,
      difference: 0
    };

    // Initialize map
    for (const c of contestants) {
      summary.contestants[c.name] = { total: 0, days: new Set(), avatar: c.avatar };
    }

    // Populate data
    for (const e of expenses) {
      if (summary.contestants[e.person]) {
        summary.contestants[e.person].total += parseFloat(e.amount);
        const dateStr = String(e.date || '').split('T')[0];
        summary.contestants[e.person].days.add(dateStr);
      }
    }

    // Round totals and count days
    const playersList = [];
    for (const name of Object.keys(summary.contestants)) {
      const data = summary.contestants[name];
      data.total = Math.round(data.total * 100) / 100;
      data.days = data.days.size;
      playersList.push({ name, total: data.total });
    }

    // Calculate Leaderboard
    if (playersList.length > 0) {
      // Sort by total ascending (lowest spending is the leader/winner)
      playersList.sort((a, b) => a.total - b.total);
      summary.leader = playersList[0].name;

      if (playersList.length >= 2) {
        // Difference is between leader and 2nd place (runner-up)
        summary.difference = Math.round((playersList[1].total - playersList[0].total) * 100) / 100;
      } else {
        summary.difference = 0;
      }
    }

    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Catch-all → frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Start
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🍔 Food Tracker läuft auf http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('❌ DB Init fehlgeschlagen:', err);
  process.exit(1);
});
