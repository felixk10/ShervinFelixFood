const dns = require('dns');
// Force IPv4 DNS resolution — Render free tier blocks IPv6 outbound
dns.setDefaultResultOrder('ipv4first');

// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool, types } = require('pg');
const path = require('path');
const nodemailer = require('nodemailer');

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

  // Create system_settings table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Seed default settings if empty
  const settingsCount = await pool.query('SELECT COUNT(*) FROM system_settings');
  if (parseInt(settingsCount.rows[0].count, 10) === 0) {
    await pool.query(`
      INSERT INTO system_settings (key, value) VALUES
      ('email_mock_mode', 'true'),
      ('smtp_host', 'smtp.gmail.com'),
      ('smtp_port', '465'),
      ('smtp_user', ''),
      ('smtp_pass', ''),
      ('email_subject', 'Freundliche Zahlungserinnerung'),
      ('email_template', 'Hallo {name},\n\ndies ist eine freundliche Erinnerung, dass du mir noch {amount} € für "{reason}" schuldest.\n\nBitte überweise den Betrag zeitnah.\n\nLiebe Grüße!')
    `);
  } else {
    // Seed new E-Mail settings individually if they don't exist yet
    const seedSettings = {
      'email_mock_mode': 'true',
      'smtp_host': 'smtp.gmail.com',
      'smtp_port': '465',
      'smtp_user': '',
      'smtp_pass': '',
      'email_subject': 'Freundliche Zahlungserinnerung',
      'email_template': 'Hallo {name},\n\ndies ist eine freundliche Erinnerung, dass du mir noch {amount} € für "{reason}" schuldest.\n\nBitte überweise den Betrag zeitnah.\n\nLiebe Grüße!'
    };
    for (const [k, v] of Object.entries(seedSettings)) {
      await pool.query('INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [k, v]);
    }
  }

  // Create debts table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS debts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
      reason TEXT NOT NULL,
      frequency_days INTEGER NOT NULL DEFAULT 1 CHECK (frequency_days >= 1),
      next_reminder_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Migration: Add email column if not exists, and drop phone_number if it exists
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'debts' AND column_name = 'email'
      ) THEN
        ALTER TABLE debts ADD COLUMN email TEXT NOT NULL DEFAULT '';
      END IF;
      
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'debts' AND column_name = 'phone_number'
      ) THEN
        ALTER TABLE debts DROP COLUMN phone_number;
      END IF;
    END $$;
  `);

  // Drop old sms_logs table and create general reminder_logs table
  await pool.query('DROP TABLE IF EXISTS sms_logs CASCADE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminder_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      debt_id UUID REFERENCES debts(id) ON DELETE SET NULL,
      recipient_name TEXT NOT NULL,
      email TEXT NOT NULL,
      message_body TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'mocked')),
      error_message TEXT,
      sent_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log('✅ Datenbank bereit (inklusive E-Mail-Erinnerungs-Tabellen)');
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

// ==========================================
// --- E-Mail Debt Reminder Feature APIs ---
// ==========================================

// Helper: Send E-Mail (SMTP or Mock)
async function sendEmail({ name, email, amount, reason, debtId }) {
  try {
    // 1. Get system settings
    const settingsRes = await pool.query('SELECT * FROM system_settings');
    const settings = {};
    settingsRes.rows.forEach(row => {
      settings[row.key] = row.value;
    });

    const mockMode = settings.email_mock_mode !== 'false'; // Default to true unless 'false'
    const subject = settings.email_subject || 'Freundliche Zahlungserinnerung';
    const template = settings.email_template || 'Hallo {name},\n\ndies ist eine freundliche Erinnerung, dass du mir noch {amount} € für "{reason}" schuldest.\n\nBitte überweise den Betrag zeitnah.\n\nLiebe Grüße!';
    
    // Replace placeholders
    const messageBody = template
      .replace(/{name}/g, name)
      .replace(/{amount}/g, amount)
      .replace(/{reason}/g, reason);

    if (mockMode) {
      // Mock mode: log to DB only
      await pool.query(
        `INSERT INTO reminder_logs (debt_id, recipient_name, email, message_body, status, sent_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [debtId, name, email, messageBody, 'mocked']
      );
      return { success: true, status: 'mocked', body: messageBody };
    } else {
      // Real SMTP mode
      const host = settings.smtp_host || 'smtp.gmail.com';
      const port = parseInt(settings.smtp_port, 10) || 465;
      const user = settings.smtp_user;
      const pass = settings.smtp_pass;
      const fromName = settings.smtp_from_name || 'Zahlungserinnerung';

      if (!user || !pass) {
        throw new Error('SMTP Zugangsdaten (E-Mail und App-Passwort) unvollständig in den Einstellungen');
      }

      const transporter = nodemailer.createTransport({
        host: host,
        port: port,
        secure: port === 465, // true for 465, false for other ports
        auth: {
          user: user,
          pass: pass
        }
      });

      const mailOptions = {
        from: `"${fromName}" <${user}>`,
        to: email,
        subject: subject,
        text: messageBody
      };

      await transporter.sendMail(mailOptions);

      await pool.query(
        `INSERT INTO reminder_logs (debt_id, recipient_name, email, message_body, status, sent_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [debtId, name, email, messageBody, 'sent']
      );
      return { success: true, status: 'sent', body: messageBody };
    }
  } catch (err) {
    console.error('Fehler in sendEmail:', err);
    await pool.query(
      `INSERT INTO reminder_logs (debt_id, recipient_name, email, message_body, status, error_message, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [debtId, name, email, `[Fehler beim Senden] ${err.message}`, 'failed', err.message]
    );
    return { success: false, status: 'failed', error: err.message };
  }
}

// 1. Settings Endpoints
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM system_settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler beim Laden der Einstellungen' });
  }
});

app.post('/api/settings', async (req, res) => {
  const { email_mock_mode, smtp_host, smtp_port, smtp_user, smtp_pass, email_subject, email_template } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const settingsMap = {
      email_mock_mode: String(email_mock_mode === undefined ? 'true' : email_mock_mode),
      smtp_host: String(smtp_host || 'smtp.gmail.com'),
      smtp_port: String(smtp_port || '465'),
      smtp_user: String(smtp_user || ''),
      smtp_pass: String(smtp_pass || ''),
      email_subject: String(email_subject || 'Freundliche Zahlungserinnerung'),
      email_template: String(email_template || '')
    };

    for (const [key, val] of Object.entries(settingsMap)) {
      await client.query(
        'INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, val]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Einstellungen erfolgreich gespeichert' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler beim Speichern der Einstellungen' });
  } finally {
    client.release();
  }
});

// 2. Debts CRUD Endpoints
app.get('/api/debts', async (req, res) => {
  try {
    const queryStr = `
      SELECT d.*, 
             COUNT(l.id) FILTER (WHERE l.status IN ('sent', 'mocked')) AS reminders_sent,
             MAX(l.sent_at) AS last_reminder_at
      FROM debts d
      LEFT JOIN reminder_logs l ON d.id = l.debt_id
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `;
    const result = await pool.query(queryStr);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler beim Laden der Schulden' });
  }
});

app.post('/api/debts', async (req, res) => {
  const { name, email, amount, reason, frequency_days, is_active } = req.body;
  if (!name || !email || amount === undefined || !reason) {
    return res.status(400).json({ error: 'Name, email, amount und reason sind Pflichtfelder.' });
  }
  const amtVal = parseFloat(amount);
  if (isNaN(amtVal) || amtVal < 0) {
    return res.status(400).json({ error: 'Betrag muss eine positive Zahl sein.' });
  }
  const freqVal = parseInt(frequency_days, 10) || 1;
  if (freqVal < 1) {
    return res.status(400).json({ error: 'Frequenz muss mindestens 1 Tag sein.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO debts (name, email, amount, reason, frequency_days, next_reminder_at, is_active)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       RETURNING *`,
      [name.trim(), email.trim(), amtVal, reason.trim(), freqVal, is_active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler beim Hinzufügen der Schuld' });
  }
});

app.put('/api/debts/:id', async (req, res) => {
  const { name, email, amount, reason, frequency_days, is_active, next_reminder_at } = req.body;
  if (!name || !email || amount === undefined || !reason) {
    return res.status(400).json({ error: 'Name, email, amount und reason sind Pflichtfelder.' });
  }
  const amtVal = parseFloat(amount);
  if (isNaN(amtVal) || amtVal < 0) {
    return res.status(400).json({ error: 'Betrag muss eine positive Zahl sein.' });
  }
  const freqVal = parseInt(frequency_days, 10) || 1;
  if (freqVal < 1) {
    return res.status(400).json({ error: 'Frequenz muss mindestens 1 Tag sein.' });
  }

  try {
    const checkRes = await pool.query('SELECT next_reminder_at FROM debts WHERE id = $1', [req.params.id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    }

    const nextRemDate = next_reminder_at ? new Date(next_reminder_at) : new Date(checkRes.rows[0].next_reminder_at);

    const result = await pool.query(
      `UPDATE debts 
       SET name = $1, email = $2, amount = $3, reason = $4, frequency_days = $5, is_active = $6, next_reminder_at = $7
       WHERE id = $8
       RETURNING *`,
      [name.trim(), email.trim(), amtVal, reason.trim(), freqVal, is_active !== false, nextRemDate, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler beim Bearbeiten der Schuld' });
  }
});

app.delete('/api/debts/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM debts WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    }
    res.json({ message: 'Eintrag gelöscht', deleted: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler beim Löschen der Schuld' });
  }
});

// 3. E-Mail Logs Endpoint
app.get('/api/reminder-logs', async (req, res) => {
  const { debt_id } = req.query;
  try {
    let queryStr = 'SELECT * FROM reminder_logs ORDER BY sent_at DESC LIMIT 100';
    let params = [];
    if (debt_id && debt_id !== 'all') {
      queryStr = 'SELECT * FROM reminder_logs WHERE debt_id = $1 ORDER BY sent_at DESC LIMIT 100';
      params = [debt_id];
    }
    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Datenbankfehler beim Laden der E-Mail-Logs' });
  }
});

// 4. Send E-Mail now manually
app.post('/api/debts/:id/send-now', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM debts WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Schuldner nicht gefunden.' });
    }
    const debt = result.rows[0];

    const sendRes = await sendEmail({
      name: debt.name,
      email: debt.email,
      amount: debt.amount,
      reason: debt.reason,
      debtId: debt.id
    });

    if (sendRes.success) {
      // Update next_reminder_at to NOW + frequency_days, since we just sent it
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + debt.frequency_days);
      await pool.query('UPDATE debts SET next_reminder_at = $1 WHERE id = $2', [nextDate, debt.id]);

      res.json({ success: true, message: 'Erinnerung erfolgreich gesendet/geloggt.', details: sendRes });
    } else {
      res.status(500).json({ error: 'E-Mail-Versand fehlgeschlagen.', details: sendRes });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim sofortigen E-Mail-Versand' });
  }
});

// 5. Cron-Trigger Endpoint
app.get('/api/cron/send-reminders', async (req, res) => {
  try {
    // Select all active debts that are due
    const result = await pool.query(
      `SELECT * FROM debts 
       WHERE is_active = true AND next_reminder_at <= NOW()`
    );
    
    const dueDebts = result.rows;
    const report = {
      processed: dueDebts.length,
      successes: [],
      failures: []
    };

    for (const debt of dueDebts) {
      const sendRes = await sendEmail({
        name: debt.name,
        email: debt.email,
        amount: debt.amount,
        reason: debt.reason,
        debtId: debt.id
      });

      if (sendRes.success) {
        // Update next_reminder_at
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + debt.frequency_days);
        await pool.query('UPDATE debts SET next_reminder_at = $1 WHERE id = $2', [nextDate, debt.id]);
        
        report.successes.push({ name: debt.name, status: sendRes.status });
      } else {
        report.failures.push({ name: debt.name, error: sendRes.error });
      }
    }

    res.json({ message: 'Erinnerungs-Check abgeschlossen.', report });
  } catch (err) {
    console.error('Fehler im Cron-Endpunkt:', err);
    res.status(500).json({ error: 'Cron-Job fehlgeschlagen', message: err.message });
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
