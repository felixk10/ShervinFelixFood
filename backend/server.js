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

// Auto-create table if it doesn't exist + migrate category column
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      person TEXT NOT NULL CHECK (person IN ('Felix', 'Shervin')),
      date DATE NOT NULL,
      amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
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
  if (!['Felix', 'Shervin'].includes(person)) {
    return res.status(400).json({ error: 'Person muss Felix oder Shervin sein.' });
  }
  if (typeof amount !== 'number' || amount < 0) {
    return res.status(400).json({ error: 'amount muss eine positive Zahl sein.' });
  }

  const cat = CATEGORIES.includes(category) ? category : 'Sonstiges';

  try {
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

// Summary
app.get('/api/summary', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses');
    const expenses = result.rows;

    const summary = {
      Felix: { total: 0, days: new Set() },
      Shervin: { total: 0, days: new Set() }
    };

    for (const e of expenses) {
      summary[e.person].total += parseFloat(e.amount);
      // date is already a 'YYYY-MM-DD' string thanks to type parser
      const dateStr = String(e.date || '').split('T')[0];
      summary[e.person].days.add(dateStr);
    }

    const felixTotal = Math.round(summary.Felix.total * 100) / 100;
    const shervinTotal = Math.round(summary.Shervin.total * 100) / 100;
    const diff = Math.abs(felixTotal - shervinTotal);

    let leader;
    if (felixTotal < shervinTotal) leader = 'Felix';
    else if (shervinTotal < felixTotal) leader = 'Shervin';
    else leader = 'Gleichstand';

    res.json({
      Felix: { total: felixTotal, days: summary.Felix.days.size },
      Shervin: { total: shervinTotal, days: summary.Shervin.days.size },
      leader,
      difference: Math.round(diff * 100) / 100
    });
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
