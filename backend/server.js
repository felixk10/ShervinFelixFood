const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'data', 'expenses.json');

app.use(cors());
app.use(express.json());

// Serve frontend static files from ../frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// --- Data helpers ---

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ expenses: [] }, null, 2));
  }
}

function readData() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- API Routes ---

// Get all expenses
app.get('/api/expenses', (req, res) => {
  const data = readData();
  res.json(data.expenses);
});

// Add an expense
app.post('/api/expenses', (req, res) => {
  const { person, date, amount } = req.body;

  if (!person || !date || amount === undefined) {
    return res.status(400).json({ error: 'person, date und amount sind Pflichtfelder.' });
  }

  if (!['Felix', 'Shervin'].includes(person)) {
    return res.status(400).json({ error: 'Person muss Felix oder Shervin sein.' });
  }

  if (typeof amount !== 'number' || amount < 0) {
    return res.status(400).json({ error: 'amount muss eine positive Zahl sein.' });
  }

  const data = readData();

  const entry = {
    id: crypto.randomUUID(),
    person,
    date,
    amount: Math.round(amount * 100) / 100,
    createdAt: new Date().toISOString()
  };

  data.expenses.push(entry);
  writeData(data);

  res.status(201).json(entry);
});

// Delete an expense
app.delete('/api/expenses/:id', (req, res) => {
  const data = readData();
  const idx = data.expenses.findIndex(e => e.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  }

  const removed = data.expenses.splice(idx, 1)[0];
  writeData(data);

  res.json({ deleted: removed });
});

// Get summary
app.get('/api/summary', (req, res) => {
  const data = readData();
  const expenses = data.expenses;

  const summary = {
    Felix: { total: 0, days: 0, entries: [] },
    Shervin: { total: 0, days: 0, entries: [] }
  };

  const daysSeen = { Felix: new Set(), Shervin: new Set() };

  for (const e of expenses) {
    summary[e.person].total += e.amount;
    daysSeen[e.person].add(e.date);
    summary[e.person].entries.push(e);
  }

  summary.Felix.total = Math.round(summary.Felix.total * 100) / 100;
  summary.Shervin.total = Math.round(summary.Shervin.total * 100) / 100;
  summary.Felix.days = daysSeen.Felix.size;
  summary.Shervin.days = daysSeen.Shervin.size;

  const diff = Math.abs(summary.Felix.total - summary.Shervin.total);
  let leader;
  if (summary.Felix.total < summary.Shervin.total) {
    leader = 'Felix';
  } else if (summary.Shervin.total < summary.Felix.total) {
    leader = 'Shervin';
  } else {
    leader = 'Gleichstand';
  }

  res.json({
    Felix: { total: summary.Felix.total, days: summary.Felix.days },
    Shervin: { total: summary.Shervin.total, days: summary.Shervin.days },
    leader,
    difference: Math.round(diff * 100) / 100
  });
});

// Catch-all: serve frontend for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🍔 Food Tracker Backend läuft auf http://localhost:${PORT}`);
});
