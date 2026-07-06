// ===== CONFIG =====
const API_BASE = window.location.origin + '/api';

// ===== STATE =====
let selectedPerson = 'Felix';
let allExpenses = [];

// ===== DOM ELEMENTS =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const form = $('#expense-form');
const dateInput = $('#expense-date');
const amountInput = $('#expense-amount');
const personBtns = $$('.person-btn');
const submitBtn = $('#submit-btn');
const entriesList = $('#entries-list');
const breakdownBody = $('#breakdown-body');

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  setDefaultDate();
  setupPersonToggle();
  form.addEventListener('submit', handleSubmit);
  loadData();
});

function setDefaultDate() {
  const today = new Date().toISOString().split('T')[0];
  dateInput.value = today;
  // Limit to July 2026 weekdays
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
    showToast('❌ Verbindung zum Server fehlgeschlagen', 'error');
  }
}

async function handleSubmit(e) {
  e.preventDefault();

  const date = dateInput.value;
  const amount = parseFloat(amountInput.value);

  if (!date || isNaN(amount) || amount < 0) {
    showToast('⚠️ Bitte Datum und Betrag eingeben', 'error');
    return;
  }

  // Check if weekday
  const dayOfWeek = new Date(date).getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    showToast('⚠️ Nur Wochentage (Mo-Fr) erlaubt!', 'error');
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
        amount
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }

    amountInput.value = '';
    showToast(`✅ ${amount.toFixed(2)} € für ${selectedPerson} eingetragen!`, 'success');
    await loadData();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
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
    const strA = typeof a.date === 'string' ? a.date.split('T')[0] : (a.date ? new Date(a.date).toISOString().split('T')[0] : '');
    const strB = typeof b.date === 'string' ? b.date.split('T')[0] : (b.date ? new Date(b.date).toISOString().split('T')[0] : '');
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

    return `
      <div class="entry-item ${personClass}">
        <div class="entry-person">${emoji}</div>
        <div class="entry-details">
          <div class="entry-name">${entry.person}</div>
          <div class="entry-date">${dateFormatted}</div>
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
    const dateKey = typeof e.date === 'string' ? e.date.split('T')[0] : new Date(e.date).toISOString().split('T')[0];
    if (!dateKey || dateKey === 'Invalid Date') continue;
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

function formatEuro(amount) {
  const num = parseFloat(amount || 0);
  let str;
  if (num % 1 === 0) {
    // Whole number: 9€
    str = num.toString();
  } else {
    // Has decimals: remove trailing zeros (9,50 → 9,5)
    str = num.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    str = str.replace('.', ',');
  }
  return str + '€';
}

function formatDate(dateVal) {
  if (!dateVal) return '—';
  try {
    const str = typeof dateVal === 'string' ? dateVal : new Date(dateVal).toISOString();
    const dateOnly = str.split('T')[0];
    const parts = dateOnly.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        const d = new Date(year, month, day);
        return d.toLocaleDateString('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit'
        });
      }
    }
  } catch (err) {
    console.error('Error formatting date:', dateVal, err);
  }
  return String(dateVal);
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
