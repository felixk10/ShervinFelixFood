// ===== CONFIG =====
const API_BASE = window.location.origin + '/api';

// Category emoji map
const CAT_EMOJI = {
  'Asiatisch': '🍜',
  'Mediterran': '🥗',
  'Fast Food': '🍔',
  'Selbst gekocht': '🏠',
  'Sonstiges': '🍽️'
};

// ===== STATE =====
let selectedPerson = 'Felix';
let selectedCategory = 'Asiatisch';
let allExpenses = [];

// ===== DOM ELEMENTS =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const form = $('#expense-form');
const dateInput = $('#expense-date');
const amountInput = $('#expense-amount');
const personBtns = $$('.person-btn');
const catBtns = $$('.cat-btn');
const submitBtn = $('#submit-btn');
const entriesList = $('#entries-list');
const breakdownBody = $('#breakdown-body');

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  setDefaultDate();
  setupPersonToggle();
  setupCategoryToggle();
  form.addEventListener('submit', handleSubmit);
  loadData();
});

function setDefaultDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  dateInput.value = `${y}-${m}-${d}`;
  dateInput.min = '2026-07-01';
  dateInput.max = '2026-07-31';
}

function setupPersonToggle() {
  personBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      personBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPerson = btn.dataset.person;
    });
  });
}

function setupCategoryToggle() {
  catBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      catBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedCategory = btn.dataset.cat;
    });
  });
}

// ===== API CALLS =====
async function loadData() {
  try {
    const [expensesRes, summaryRes] = await Promise.all([
      fetch(`${API_BASE}/expenses`),
      fetch(`${API_BASE}/summary`)
    ]);

    allExpenses = await expensesRes.json();
    const summary = await summaryRes.json();

    renderScoreboard(summary);
    renderEntries(allExpenses);
    renderBreakdown(allExpenses);
  } catch (err) {
    console.error('Fehler beim Laden:', err);
    showToast('Verbindung zum Server fehlgeschlagen', 'error');
  }
}

async function handleSubmit(e) {
  e.preventDefault();

  const date = dateInput.value;
  const amount = parseFloat(amountInput.value);

  if (!date || isNaN(amount) || amount < 0) {
    showToast('Bitte Datum und Betrag eingeben', 'error');
    return;
  }

  // Check if weekday
  const parts = date.split('-');
  const checkDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const dayOfWeek = checkDate.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    showToast('Nur Wochentage (Mo-Fr) erlaubt!', 'error');
    return;
  }

  submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person: selectedPerson,
        date,
        amount,
        category: selectedCategory
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }

    amountInput.value = '';
    showToast(`${formatEuro(amount)} für ${selectedPerson} eingetragen!`, 'success');
    await loadData();
  } catch (err) {
    showToast(`${err.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

// Custom confirm dialog
function showConfirm() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-overlay');
    const cancelBtn = document.getElementById('confirm-cancel');
    const deleteBtn = document.getElementById('confirm-delete');

    overlay.classList.add('show');

    function cleanup() {
      overlay.classList.remove('show');
      cancelBtn.removeEventListener('click', onCancel);
      deleteBtn.removeEventListener('click', onDelete);
      overlay.removeEventListener('click', onOverlay);
    }

    function onCancel() { cleanup(); resolve(false); }
    function onDelete() { cleanup(); resolve(true); }
    function onOverlay(e) {
      if (e.target === overlay) { cleanup(); resolve(false); }
    }

    cancelBtn.addEventListener('click', onCancel);
    deleteBtn.addEventListener('click', onDelete);
    overlay.addEventListener('click', onOverlay);
  });
}

async function deleteExpense(id) {
  const confirmed = await showConfirm();
  if (!confirmed) return;

  try {
    const res = await fetch(`${API_BASE}/expenses/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Löschen fehlgeschlagen');
    showToast('Eintrag gelöscht', 'success');
    await loadData();
  } catch (err) {
    showToast(`${err.message}`, 'error');
  }
}

// ===== RENDER FUNCTIONS =====

function renderScoreboard(summary) {
  // Totals
  $('#total-felix').textContent = formatEuro(summary.Felix.total);
  $('#total-shervin').textContent = formatEuro(summary.Shervin.total);
  $('#days-felix').textContent = `${summary.Felix.days} Tage`;
  $('#days-shervin').textContent = `${summary.Shervin.days} Tage`;

  // Leading indicator
  const felixCard = $('#card-felix');
  const shervinCard = $('#card-shervin');
  felixCard.classList.remove('leading');
  shervinCard.classList.remove('leading');

  const banner = $('#leader-banner');
  banner.classList.remove('felix-leads', 'shervin-leads');

  if (summary.leader === 'Felix') {
    felixCard.classList.add('leading');
    banner.classList.add('felix-leads');
    $('#leader-text').textContent = `🧑‍💻 Felix spart mehr! (${formatEuro(summary.difference)} weniger)`;
  } else if (summary.leader === 'Shervin') {
    shervinCard.classList.add('leading');
    banner.classList.add('shervin-leads');
    $('#leader-text').textContent = `😎 Shervin spart mehr! (${formatEuro(summary.difference)} weniger)`;
  } else {
    $('#leader-text').textContent = summary.Felix.total === 0 && summary.Shervin.total === 0
      ? '🤝 Noch keine Daten — wer gibt weniger aus?'
      : '🤝 Gleichstand! Exakt gleich viel ausgegeben.';
  }

  // VS difference
  if (summary.difference > 0) {
    $('#vs-diff').textContent = `${formatEuro(summary.difference)}`;
  } else {
    $('#vs-diff').textContent = '';
  }
}

function renderEntries(expenses) {
  if (expenses.length === 0) {
    entriesList.innerHTML = '<div class="empty-state">Noch keine Einträge vorhanden</div>';
    return;
  }

  // Sort by date descending, then by created_at descending
  const sorted = [...expenses].sort((a, b) => {
    const strA = toDateKey(a.date);
    const strB = toDateKey(b.date);
    const dateDiff = strB.localeCompare(strA);
    if (dateDiff !== 0) return dateDiff;
    const createdA = a.created_at || a.createdAt || '';
    const createdB = b.created_at || b.createdAt || '';
    return String(createdB).localeCompare(String(createdA));
  });

  entriesList.innerHTML = sorted.map(entry => {
    const personClass = entry.person === 'Felix' ? 'felix-entry' : 'shervin-entry';
    const emoji = entry.person === 'Felix' ? '🧑‍💻' : '😎';
    const dateFormatted = formatDate(entry.date);
    const catEmoji = CAT_EMOJI[entry.category] || '🍽️';
    const catName = entry.category || 'Sonstiges';

    return `
      <div class="entry-item ${personClass}">
        <div class="entry-person">${emoji}</div>
        <div class="entry-details">
          <div class="entry-name">${entry.person}</div>
          <div class="entry-meta">
            <span class="entry-date">${dateFormatted}</span>
            <span class="entry-cat">${catEmoji} ${catName}</span>
          </div>
        </div>
        <div class="entry-amount">${formatEuro(entry.amount)}</div>
        <button class="entry-delete" onclick="deleteExpense('${entry.id}')" title="Löschen">🗑️</button>
      </div>
    `;
  }).join('');
}

function renderBreakdown(expenses) {
  // Group by date
  const byDate = {};
  for (const e of expenses) {
    if (!e.date) continue;
    const dateKey = toDateKey(e.date);
    if (!dateKey) continue;
    if (!byDate[dateKey]) byDate[dateKey] = { Felix: 0, Shervin: 0 };
    byDate[dateKey][e.person] += parseFloat(e.amount || 0);
  }

  const dates = Object.keys(byDate).sort();

  if (dates.length === 0) {
    breakdownBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">Noch keine Daten</td></tr>';
    return;
  }

  breakdownBody.innerHTML = dates.map(date => {
    const f = byDate[date].Felix;
    const s = byDate[date].Shervin;
    let crown = '';
    if (f > 0 || s > 0) {
      if (f < s) crown = '🧑‍💻';
      else if (s < f) crown = '😎';
      else crown = '🤝';
    }

    return `
      <tr>
        <td>${formatDate(date)}</td>
        <td class="felix-val">${f > 0 ? formatEuro(f) : '—'}</td>
        <td class="shervin-val">${s > 0 ? formatEuro(s) : '—'}</td>
        <td class="crown-cell">${crown}</td>
      </tr>
    `;
  }).join('');
}

// ===== HELPERS =====

// Extracts a clean YYYY-MM-DD key from any date format
function toDateKey(dateVal) {
  if (!dateVal) return '';
  const s = String(dateVal);
  // Already YYYY-MM-DD or YYYY-MM-DDTHH:...
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function formatEuro(amount) {
  const num = parseFloat(amount || 0);
  let str;
  if (num % 1 === 0) {
    str = num.toString();
  } else {
    str = num.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    str = str.replace('.', ',');
  }
  return str + '€';
}

// Manual date formatting — no browser locale dependency
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function formatDate(dateVal) {
  if (!dateVal) return '—';
  const key = toDateKey(dateVal);
  if (!key) return String(dateVal);

  const parts = key.split('-');
  if (parts.length !== 3) return key;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) return key;

  const d = new Date(year, month - 1, day);
  if (isNaN(d.getTime())) return key;

  const wd = WEEKDAYS[d.getDay()];
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');

  return `${wd}., ${dd}.${mm}.`;
}

// ===== TOAST =====
let toastTimeout;

function showToast(message, type = 'success') {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }

  clearTimeout(toastTimeout);
  toast.className = 'toast';

  const icon = type === 'success' ? '✅' : '⚠️';

  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close" onclick="this.closest('.toast').classList.remove('show')">✕</button>
    </div>
    <div class="toast-progress">
      <div class="toast-progress-bar"></div>
    </div>
  `;

  // Trigger reflow for re-animation
  void toast.offsetHeight;

  toast.classList.add('show', type);

  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}
