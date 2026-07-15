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

// Premium Illustrated Avatars (DiceBear API + Emojis fallback)
const AVATARS = [
  '👨‍🍳', '👩‍🍳', '🧑‍🍳',
  '🍳', '🥘', '🧁',
  '🍕', '🍔', '🍜',
  '🍣', '🌮', '🥐',
  '🧑‍💻', '😎', '🍩',
  '🥗', '🍰', '🍪',
  '🍟', '🍕'
];

// Color palette for chart lines
const COLOR_PALETTE = [
  '#6c5ce7', // Purple (Felix)
  '#00cec9', // Teal (Shervin)
  '#ffd32a', // Gold
  '#ff6b6b', // Red
  '#1dd1a1', // Emerald
  '#54a0ff', // Blue
  '#ff9ff3', // Pink
  '#576574'  // Dark slate
];

function getPersonColor(name, index) {
  if (name.toLowerCase() === 'felix') return '#6c5ce7';
  if (name.toLowerCase() === 'shervin') return '#00cec9';
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

// ===== STATE =====
let contestants = [];
let selectedPerson = '';
let selectedCategory = 'Asiatisch';
let selectedModalAvatar = '👨‍🍳';
let allExpenses = [];
let chartInstance = null;

// ===== DOM ELEMENTS =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const form = $('#expense-form');
const dateInput = $('#expense-date');
const amountInput = $('#expense-amount');
const catBtns = $$('.cat-btn');
const submitBtn = $('#submit-btn');
const entriesList = $('#entries-list');
const breakdownBody = $('#breakdown-body');

// Dynamic Containers
const scoreboardContainer = $('#scoreboard-container');
const personToggleContainer = $('#person-toggle-container');
const statsGrid = $('#stats-grid');

// Modal Elements
const btnManageContestants = $('#btn-manage-contestants');
const contestantModalOverlay = $('#contestant-modal-overlay');
const contestantForm = $('#contestant-form');
const contestantIdInput = $('#contestant-id');
const contestantNameInput = $('#contestant-name');
const modalAvatarGrid = $('#modal-avatar-grid');
const btnContestantClose = $('#btn-contestant-close');
const btnContestantClear = $('#btn-contestant-clear');
const contestantListContainer = $('#contestant-list');

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  setDefaultDate();
  setupCategoryToggle();
  setupContestantsModal();
  form.addEventListener('submit', handleSubmit);
  
  // SMS Reminder and Tab Navigation Setup
  setupTabSystem();
  setupSMSReminderFeature();
  
  // Initial load
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
    // 1. Load Contestants
    const contestantsRes = await fetch(`${API_BASE}/contestants`);
    contestants = await contestantsRes.json();

    // Render form selectors and manage list
    renderContestantSelectors();
    renderContestantsModalList();

    // 2. Load Expenses & Summary
    const [expensesRes, summaryRes] = await Promise.all([
      fetch(`${API_BASE}/expenses`),
      fetch(`${API_BASE}/summary`)
    ]);

    allExpenses = await expensesRes.json();
    const summary = await summaryRes.json();

    // Render stats & graphics
    renderScoreboard(summary);
    renderFavoriteFoods(allExpenses);
    renderEntries(allExpenses);
    renderBreakdown(allExpenses);
    renderProgressionChart(allExpenses);

  } catch (err) {
    console.error('Fehler beim Laden:', err);
    showToast('Verbindung zum Server fehlgeschlagen', 'error');
  }
}

async function handleSubmit(e) {
  e.preventDefault();

  const date = dateInput.value;
  const amount = parseFloat(amountInput.value);

  if (!selectedPerson) {
    showToast('Bitte wähle einen Mitbewerber aus', 'error');
    return;
  }
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

// ===== CONTESTANTS CRUD FUNCTIONS =====

function setupContestantsModal() {
  // Open modal
  if (btnManageContestants) {
    btnManageContestants.addEventListener('click', () => {
      resetContestantForm();
      renderModalAvatarGrid();
      if (contestantModalOverlay) contestantModalOverlay.classList.add('show');
    });
  }

  // Close modal
  if (btnContestantClose) {
    btnContestantClose.addEventListener('click', () => {
      if (contestantModalOverlay) contestantModalOverlay.classList.remove('show');
    });
  }

  if (contestantModalOverlay) {
    contestantModalOverlay.addEventListener('click', (e) => {
      if (e.target === contestantModalOverlay) {
        contestantModalOverlay.classList.remove('show');
      }
    });
  }

  // Reset form / cancel edit
  if (btnContestantClear) {
    btnContestantClear.addEventListener('click', resetContestantForm);
  }

  // Submit form (Create / Update)
  if (contestantForm) {
    contestantForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = contestantIdInput ? contestantIdInput.value : '';
      const name = contestantNameInput ? contestantNameInput.value.trim() : '';
      const avatar = selectedModalAvatar;

      if (!name || !avatar) {
        showToast('Name und Avatar eingeben', 'error');
        return;
      }

      const isEdit = !!id;
      const url = isEdit ? `${API_BASE}/contestants/${id}` : `${API_BASE}/contestants`;
      const method = isEdit ? 'PUT' : 'POST';

      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, avatar })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');

        showToast(isEdit ? 'Mitbewerber aktualisiert!' : 'Mitbewerber hinzugefügt!', 'success');
        resetContestantForm();
        await loadData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
}

function renderModalAvatarGrid() {
  modalAvatarGrid.innerHTML = AVATARS.map(emoji => `
    <button type="button" class="avatar-option ${emoji === selectedModalAvatar ? 'selected' : ''}" data-emoji="${emoji}">${emoji}</button>
  `).join('');

  modalAvatarGrid.querySelectorAll('.avatar-option').forEach(btn => {
    btn.addEventListener('click', () => {
      modalAvatarGrid.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedModalAvatar = btn.dataset.emoji;
    });
  });
}

function resetContestantForm() {
  contestantIdInput.value = '';
  contestantNameInput.value = '';
  selectedModalAvatar = '👨‍🍳';
  btnContestantClear.style.display = 'none';
  $('#btn-contestant-save').textContent = 'Hinzufügen';
  $('#contestant-modal-title').textContent = 'Mitbewerber verwalten';
  renderModalAvatarGrid();
}

function renderContestantSelectors() {
  if (contestants.length === 0) {
    personToggleContainer.innerHTML = '<p style="color:var(--text-muted);">Erstelle zuerst einen Mitbewerber!</p>';
    selectedPerson = '';
    return;
  }

  // Retain selection if valid, else pick first
  const currentSelectedIsValid = contestants.some(c => c.name === selectedPerson);
  if (!currentSelectedIsValid) {
    selectedPerson = contestants[0].name;
  }

  personToggleContainer.innerHTML = contestants.map(c => `
    <button type="button" class="person-btn ${c.name === selectedPerson ? 'active' : ''}" data-person="${c.name}">
      ${c.avatar} ${c.name}
    </button>
  `).join('');

  personToggleContainer.querySelectorAll('.person-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      personToggleContainer.querySelectorAll('.person-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPerson = btn.dataset.person;
    });
  });
}

function renderContestantsModalList() {
  if (contestants.length === 0) {
    contestantListContainer.innerHTML = '<div style="color:var(--text-muted); padding:10px; font-size:0.85rem;">Keine Mitbewerber vorhanden.</div>';
    return;
  }

  contestantListContainer.innerHTML = contestants.map(c => `
    <div class="contestant-item">
      <div class="contestant-info">
        <span class="contestant-item-avatar">${c.avatar}</span>
        <span class="contestant-item-name">${c.name}</span>
      </div>
      <div class="contestant-item-actions">
        <button type="button" class="action-btn-sm" onclick="editContestant('${c.id}', '${c.name}', '${c.avatar}')" title="Bearbeiten">✏️</button>
        <button type="button" class="action-btn-sm delete" onclick="deleteContestant('${c.id}', '${c.name}')" title="Löschen">🗑️</button>
      </div>
    </div>
  `).join('');
}

window.editContestant = function(id, name, avatar) {
  contestantIdInput.value = id;
  contestantNameInput.value = name;
  selectedModalAvatar = avatar;
  btnContestantClear.style.display = 'inline-block';
  $('#btn-contestant-save').textContent = 'Speichern';
  $('#contestant-modal-title').textContent = `Bearbeiten: ${name}`;
  renderModalAvatarGrid();
  // Scroll form into view inside modal
  contestantNameInput.focus();
};

window.deleteContestant = async function(id, name) {
  const confirmed = await showConfirm();
  if (!confirmed) return;

  try {
    const res = await fetch(`${API_BASE}/contestants/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Löschen fehlgeschlagen');
    showToast(`${name} gelöscht`, 'success');
    resetContestantForm();
    await loadData();
  } catch (err) {
    showToast(`${err.message}`, 'error');
  }
};

window.deleteExpense = async function(id) {
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
};

// ===== RENDER STATS & WIDGETS =====

function renderScoreboard(summary) {
  if (!scoreboardContainer) return;

  if (contestants.length === 0) {
    scoreboardContainer.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 20px; color:var(--text-muted);">Noch keine Mitbewerber angelegt.</div>';
    const leaderBanner = $('#leader-banner');
    if (leaderBanner) leaderBanner.style.display = 'none';
    return;
  }
  const leaderBanner = $('#leader-banner');
  if (leaderBanner) leaderBanner.style.display = 'block';

  // Build grid of scorecards
  let cardsHTML = '';
  
  // Sort players by total ascending to identify the ranking
  const sortedPlayers = Object.keys(summary.contestants).map(name => ({
    name,
    ...summary.contestants[name]
  })).sort((a, b) => a.total - b.total);

  sortedPlayers.forEach((player, idx) => {
    const isLeader = player.name === summary.leader;
    const cls = isLeader ? 'leading' : '';
    const specificCls = player.name.toLowerCase() === 'felix' ? 'felix' : (player.name.toLowerCase() === 'shervin' ? 'shervin' : '');
    
    // Auto-crown top player if they have logged expenses
    const crownTag = (isLeader && player.total > 0) ? '<span class="leader-crown-badge">👑</span>' : '';

    cardsHTML += `
      <div class="score-card ${specificCls} ${cls}" data-person="${player.name}">
        ${crownTag}
        <div class="score-avatar">${player.avatar}</div>
        <h2>${player.name}</h2>
        <div class="score-amount">${formatEuro(player.total)}</div>
        <div class="score-days">${player.days} Tage</div>
      </div>
    `;
  });

  scoreboardContainer.innerHTML = cardsHTML;

  // Leader banner text
  const banner = $('#leader-banner');
  if (banner) {
    banner.className = 'leader-banner';

    if (summary.leader && summary.contestants[summary.leader]) {
      const leaderData = summary.contestants[summary.leader];
      const isFelix = summary.leader.toLowerCase() === 'felix';
      const isShervin = summary.leader.toLowerCase() === 'shervin';

      if (isFelix) banner.classList.add('felix-leads');
      else if (isShervin) banner.classList.add('shervin-leads');

      const vsDiffEl = $('#vs-diff');
      if (summary.difference > 0) {
        banner.innerHTML = `<span id="leader-text">${leaderData.avatar} <strong>${summary.leader}</strong> spart am meisten! (${formatEuro(summary.difference)} weniger als Platz 2)</span>`;
        if (vsDiffEl) vsDiffEl.textContent = `${formatEuro(summary.difference)}`;
      } else {
        banner.innerHTML = `<span id="leader-text">${leaderData.avatar} <strong>${summary.leader}</strong> spart am meisten!</span>`;
        if (vsDiffEl) vsDiffEl.textContent = '';
      }
    } else {
      banner.innerHTML = '<span id="leader-text">🤝 Gleichstand oder noch keine Daten eingetragen!</span>';
      const vsDiffEl = $('#vs-diff');
      if (vsDiffEl) vsDiffEl.textContent = '';
    }
  }
}

function renderFavoriteFoods(expenses) {
  if (!statsGrid) return;
  if (expenses.length === 0 || contestants.length === 0) {
    statsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color:var(--text-muted);">Noch keine Essenstatistiken verfügbar</div>';
    return;
  }

  // Count category frequency per person
  const stats = {};
  contestants.forEach(c => {
    stats[c.name] = {};
  });

  expenses.forEach(e => {
    if (stats[e.person]) {
      const cat = e.category || 'Sonstiges';
      stats[e.person][cat] = (stats[e.person][cat] || 0) + 1;
    }
  });

  const cards = contestants.map(c => {
    const personStats = stats[c.name];
    let topCat = 'Keine';
    let topCount = 0;
    
    Object.keys(personStats).forEach(cat => {
      if (personStats[cat] > topCount) {
        topCount = personStats[cat];
        topCat = cat;
      }
    });

    const displayVal = topCount > 0 ? `${CAT_EMOJI[topCat] || '🍽️'} ${topCat} (${topCount}x)` : 'Noch keine';

    return `
      <div class="stats-card">
        <span class="stats-avatar">${c.avatar}</span>
        <div class="stats-info">
          <span class="stats-name">${c.name}</span>
          <span class="stats-value" title="${displayVal}">${displayVal}</span>
        </div>
      </div>
    `;
  }).join('');

  statsGrid.innerHTML = cards;
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
    const c = contestants.find(player => player.name === entry.person);
    const avatar = c ? c.avatar : '👨‍🍳';
    const personClass = entry.person.toLowerCase() === 'felix' ? 'felix-entry' : (entry.person.toLowerCase() === 'shervin' ? 'shervin-entry' : '');
    const dateFormatted = formatDate(entry.date);
    const catEmoji = CAT_EMOJI[entry.category] || '🍽️';
    const catName = entry.category || 'Sonstiges';

    return `
      <div class="entry-item ${personClass}">
        <div class="entry-person">${avatar}</div>
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
  const headRow = $('#breakdown-head');
  if (contestants.length === 0) {
    headRow.innerHTML = '<tr><th>Datum</th><th>👑</th></tr>';
    breakdownBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text-muted);padding:20px;">Keine Mitbewerber</td></tr>';
    return;
  }

  // Update dynamic headers
  const contestantHeaders = contestants.map(c => `<th>${c.name}</th>`).join('');
  headRow.innerHTML = `
    <tr>
      <th>Datum</th>
      ${contestantHeaders}
      <th>👑</th>
    </tr>
  `;

  // Group by date
  const byDate = {};
  for (const e of expenses) {
    if (!e.date) continue;
    const dateKey = toDateKey(e.date);
    if (!dateKey) continue;
    if (!byDate[dateKey]) {
      byDate[dateKey] = {};
      contestants.forEach(c => {
        byDate[dateKey][c.name] = 0;
      });
    }
    if (byDate[dateKey].hasOwnProperty(e.person)) {
      byDate[dateKey][e.person] += parseFloat(e.amount || 0);
    }
  }

  const dates = Object.keys(byDate).sort();

  if (dates.length === 0) {
    breakdownBody.innerHTML = `<tr><td colspan="${contestants.length + 2}" style="text-align:center;color:var(--text-muted);padding:20px;">Noch keine Daten</td></tr>`;
    return;
  }

  breakdownBody.innerHTML = dates.map(date => {
    // Find min non-zero value to crown (the one spending least on that day)
    let minVal = Infinity;
    let minPerson = null;
    let hasExpenses = false;
    let tie = false;

    contestants.forEach(c => {
      const val = byDate[date][c.name];
      if (val > 0) {
        hasExpenses = true;
        if (val < minVal) {
          minVal = val;
          minPerson = c.name;
          tie = false;
        } else if (val === minVal) {
          tie = true;
        }
      }
    });

    let crown = '—';
    if (hasExpenses) {
      if (tie) crown = '🤝';
      else {
        const leader = contestants.find(c => c.name === minPerson);
        crown = leader ? leader.avatar : '👑';
      }
    }

    const cols = contestants.map(c => {
      const val = byDate[date][c.name];
      const cls = c.name.toLowerCase() === 'felix' ? 'felix-val' : (c.name.toLowerCase() === 'shervin' ? 'shervin-val' : '');
      return `<td class="${cls}">${val > 0 ? formatEuro(val) : '—'}</td>`;
    }).join('');

    return `
      <tr>
        <td>${formatDate(date)}</td>
        ${cols}
        <td class="crown-cell">${crown}</td>
      </tr>
    `;
  }).join('');
}

// ===== NEW FEATURE: PROGRESSION CHART =====

function renderProgressionChart(expenses) {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js is not loaded. Skipping chart rendering.');
    return;
  }

  const chartCanvas = document.getElementById('progression-chart');
  if (!chartCanvas) return;
  const ctx = chartCanvas.getContext('2d');
  
  if (chartInstance) {
    chartInstance.destroy();
  }

  if (contestants.length === 0 || expenses.length === 0) {
    return;
  }

  // Days in July 2026: 1 to 31
  const labels = [];
  const daysInMonth = 31;
  const datasets = contestants.map((c, idx) => ({
    label: c.name,
    data: new Array(daysInMonth).fill(0),
    borderColor: getPersonColor(c.name, idx),
    backgroundColor: getPersonColor(c.name, idx) + '15',
    borderWidth: 3,
    tension: 0.35,
    fill: true,
    pointRadius: 2,
    pointHoverRadius: 6
  }));

  // Daily totals map
  const dailySpend = {};
  contestants.forEach(c => {
    dailySpend[c.name] = new Array(daysInMonth + 1).fill(0);
  });

  // Aggregate daily expenses
  expenses.forEach(e => {
    if (!e.date) return;
    const key = toDateKey(e.date);
    if (!key.startsWith('2026-07-')) return; // Limit only to July 2026
    const day = parseInt(key.split('-')[2], 10);
    if (day >= 1 && day <= daysInMonth && dailySpend[e.person]) {
      dailySpend[e.person][day] += parseFloat(e.amount || 0);
    }
  });

  // Labels e.g., '01.', '02.', ...
  for (let d = 1; d <= daysInMonth; d++) {
    labels.push(String(d).padStart(2, '0') + '.07.');
  }

  // Calculate cumulative datasets
  contestants.forEach((c, idx) => {
    let sum = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      sum += dailySpend[c.name][d];
      datasets[idx].data[d - 1] = Math.round(sum * 100) / 100;
    }
  });

  // Chart options
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#e8e8f0',
            font: { family: 'Inter', weight: 'bold', size: 11 },
            usePointStyle: true,
            boxWidth: 8
          }
        },
        tooltip: {
          backgroundColor: 'rgba(22, 22, 35, 0.95)',
          titleColor: '#ffd32a',
          bodyColor: '#e8e8f0',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 12,
          usePointStyle: true,
          callbacks: {
            label: function(context) {
              return ` ${context.dataset.label}: ${context.raw}€`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.03)' },
          ticks: {
            color: '#8888a0',
            font: { family: 'Inter', size: 9 },
            maxTicksLimit: 10
          }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#8888a0',
            font: { family: 'Inter', size: 10 },
            callback: function(value) {
              return value + '€';
            }
          }
        }
      }
    }
  });
}

// ===== HELPERS =====

function toDateKey(dateVal) {
  if (!dateVal) return '';
  const s = String(dateVal);
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

  void toast.offsetHeight;

  toast.classList.add('show', type);

  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ===== CUSTOM CONFIRM DIALOG DICTIONARY =====
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

// ==========================================
// --- E-Mail Debt Reminder Logic ---
// ==========================================

let activeTab = 'food-tracker';
let debts = [];
let settings = {};
let reminderLogs = [];

// Setup Tab Navigation
function setupTabSystem() {
  const tabBtns = document.querySelectorAll('.tab-nav .tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      
      // Update buttons
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update visibility
      tabContents.forEach(c => {
        if (c.id === `tab-${targetTab}`) {
          c.classList.add('active');
        } else {
          c.classList.remove('active');
        }
      });

      activeTab = targetTab;
      if (activeTab === 'sms-reminders') {
        loadReminderFeatureData();
      }
    });
  });
}

// Setup Event Listeners for the E-Mail reminder page
function setupSMSReminderFeature() {
  const debtForm = document.getElementById('debt-form');
  const settingsForm = document.getElementById('settings-form');
  const mockModeCheckbox = document.getElementById('settings-mock-mode');
  const smtpFields = document.getElementById('twilio-fields-container');
  const btnClearDebt = document.getElementById('btn-debt-clear');
  const logsFilter = document.getElementById('logs-filter-debtor');

  // Toggle SMTP credential fields based on Mock Mode checkbox
  mockModeCheckbox.addEventListener('change', () => {
    if (mockModeCheckbox.checked) {
      smtpFields.classList.add('hidden');
    } else {
      smtpFields.classList.remove('hidden');
    }
  });

  // Debt Form submit
  debtForm.addEventListener('submit', handleDebtSubmit);

  // Clear / Cancel Edit button
  btnClearDebt.addEventListener('click', clearDebtForm);

  // Settings Form submit
  settingsForm.addEventListener('submit', handleSettingsSubmit);

  // Logs filter change
  logsFilter.addEventListener('change', (e) => {
    renderLogs(e.target.value);
  });
}

// Load all data related to E-Mail Reminders
async function loadReminderFeatureData() {
  try {
    await Promise.all([
      fetchSettings(),
      fetchDebts(),
      fetchLogs('all')
    ]);
  } catch (err) {
    console.error('Error loading Email features:', err);
    showToast('Fehler beim Laden der E-Mail-Daten', 'error');
  }
}

// Fetch global SMTP settings
async function fetchSettings() {
  const res = await fetch(`${API_BASE}/settings`);
  settings = await res.json();

  // Populate settings form
  const subjectInput = document.getElementById('settings-subject');
  const templateArea = document.getElementById('settings-template');
  const mockCheckbox = document.getElementById('settings-mock-mode');
  const smtpHost = document.getElementById('settings-smtp-host');
  const smtpPort = document.getElementById('settings-smtp-port');
  const smtpUser = document.getElementById('settings-smtp-user');
  const smtpPass = document.getElementById('settings-smtp-pass');
  const smtpFields = document.getElementById('twilio-fields-container');

  subjectInput.value = settings.email_subject || 'Zahlungserinnerung';
  templateArea.value = settings.email_template || '';
  mockCheckbox.checked = settings.email_mock_mode !== 'false';

  // Toggle field visibility
  if (mockCheckbox.checked) {
    smtpFields.classList.add('hidden');
  } else {
    smtpFields.classList.remove('hidden');
  }

  smtpHost.value = settings.smtp_host || 'smtp.gmail.com';
  smtpPort.value = settings.smtp_port || '465';
  smtpUser.value = settings.smtp_user || '';
  smtpPass.value = settings.smtp_pass || '';
}

// Save global SMTP settings
async function handleSettingsSubmit(e) {
  e.preventDefault();
  
  const payload = {
    email_mock_mode: document.getElementById('settings-mock-mode').checked ? 'true' : 'false',
    email_subject: document.getElementById('settings-subject').value,
    email_template: document.getElementById('settings-template').value,
    smtp_host: document.getElementById('settings-smtp-host').value,
    smtp_port: document.getElementById('settings-smtp-port').value,
    smtp_user: document.getElementById('settings-smtp-user').value,
    smtp_pass: document.getElementById('settings-smtp-pass').value
  };

  try {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'Einstellungen gespeichert');
      await fetchSettings();
    } else {
      showToast(data.error || 'Fehler beim Speichern', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Verbindungsfehler beim Speichern', 'error');
  }
}

// Fetch all debts
async function fetchDebts() {
  const res = await fetch(`${API_BASE}/debts`);
  debts = await res.json();
  renderDebts();
  updateDebtsSummary();
  populateDebtorFilterDropdown();
}

// Populate logs filter select option
function populateDebtorFilterDropdown() {
  const filterSelect = document.getElementById('logs-filter-debtor');
  const currentValue = filterSelect.value;
  
  filterSelect.innerHTML = '<option value="all">Alle Schuldner</option>';
  
  debts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    filterSelect.appendChild(opt);
  });

  if (debts.some(d => d.id === currentValue)) {
    filterSelect.value = currentValue;
  }
}

// Calculate and update top summary cards
function updateDebtsSummary() {
  const totalDebts = debts.reduce((sum, d) => sum + parseFloat(d.amount), 0);
  const totalSentReminders = debts.reduce((sum, d) => sum + parseInt(d.reminders_sent || 0), 0);

  document.getElementById('summary-total-debts').textContent = formatCurrency(totalDebts);
  document.getElementById('summary-debtors-count').textContent = debts.length;
  document.getElementById('summary-reminders-sent').textContent = totalSentReminders;
}

// Format date relative for debts cards
function formatNextReminder(dateVal) {
  if (!dateVal) return 'Ausstehend';
  const nextDate = new Date(dateVal);
  const now = new Date();
  
  const nextDateZero = new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
  const nowZero = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const diffTime = nextDateZero - nowZero;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Heute';
  if (diffDays === 1) return 'Morgen';
  if (diffDays < 0) return 'Sofort fällig';
  
  const dd = String(nextDate.getDate()).padStart(2, '0');
  const mm = String(nextDate.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.`;
}

// Render debts cards
function renderDebts() {
  const grid = document.getElementById('debts-grid');
  
  if (debts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #888;">
        Keine Schuldner vorhanden. Lege unten einen an!
      </div>
    `;
    return;
  }

  grid.innerHTML = '';
  debts.forEach(d => {
    const card = document.createElement('div');
    card.className = `debt-card ${d.is_active ? '' : 'inactive'}`;
    
    const statusText = d.is_active ? 'Aktiv' : 'Pausiert';
    const badgeClass = d.is_active ? 'active' : 'paused';

    const lastSentStr = d.last_reminder_at ? formatDate(d.last_reminder_at) : 'Noch nie';
    const nextRemStr = d.is_active ? formatNextReminder(d.next_reminder_at) : 'Pausiert';

    card.innerHTML = `
      <div>
        <div class="debt-header">
          <div class="debt-user">
            <span class="debt-avatar">👤</span>
            <div class="debt-name-container">
              <span class="debt-name">${d.name}</span>
              <span class="debt-phone" style="text-transform: none; letter-spacing: normal;">${d.email}</span>
            </div>
          </div>
          <span class="badge ${badgeClass}">${statusText}</span>
        </div>
        
        <div class="debt-body">
          <div class="debt-amount-row">
            <span class="debt-amount-val">${formatCurrency(d.amount)}</span>
            <span class="debt-reason-text">für ${d.reason}</span>
          </div>
          
          <div class="debt-meta">
            <div class="debt-meta-row">
              <span>E-Mail-Rhythmus:</span>
              <span>Alle ${d.frequency_days} Tag(e)</span>
            </div>
            <div class="debt-meta-row">
              <span>Bisher gesendet:</span>
              <span>${d.reminders_sent}</span>
            </div>
            <div class="debt-meta-row">
              <span>Letzter Versand:</span>
              <span>${lastSentStr}</span>
            </div>
            <div class="debt-meta-row">
              <span>Nächster Check:</span>
              <span style="${nextRemStr === 'Sofort fällig' ? 'color: var(--danger); font-weight: bold;' : ''}">${nextRemStr}</span>
            </div>
          </div>
        </div>
      </div>
      
      <div class="debt-actions">
        <button type="button" class="confirm-btn sms-now" onclick="triggerSendNow('${d.id}')" title="Triggert sofort eine E-Mail an diesen Kontakt">⚡ E-Mail Jetzt</button>
        <button type="button" class="confirm-btn edit" onclick="startEditDebt('${d.id}')">✏️ Bearbeiten</button>
        <button type="button" class="confirm-btn delete" onclick="handleDeleteDebt('${d.id}')">🗑️ Löschen</button>
      </div>
    `;
    
    grid.appendChild(card);
  });
}

// Fetch logs
async function fetchLogs(debtorId = 'all') {
  const url = `${API_BASE}/reminder-logs?debt_id=${debtorId}`;
  const res = await fetch(url);
  reminderLogs = await res.json();
  renderLogsTable();
}

function renderLogs(debtorId = 'all') {
  fetchLogs(debtorId);
}

// Render logs table
function renderLogsTable() {
  const tbody = document.getElementById('logs-table-body');
  
  if (reminderLogs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-table-state" style="text-align: center; color: #888; padding: 20px;">Keine E-Mail-Logs vorhanden</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  reminderLogs.forEach(l => {
    const tr = document.createElement('tr');
    
    let statusIcon = '📝';
    if (l.status === 'sent') statusIcon = '✅';
    if (l.status === 'mocked') statusIcon = '⚙️';
    if (l.status === 'failed') statusIcon = '❌';

    const timestamp = new Date(l.sent_at).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    tr.innerHTML = `
      <td style="font-size: 0.85rem;">${timestamp}</td>
      <td style="font-weight: 600;">${l.recipient_name}</td>
      <td style="font-size: 0.85rem; color: var(--text-muted); text-transform: none;">${l.email}</td>
      <td class="log-msg-cell" title="${l.message_body}">${l.message_body}</td>
      <td>
        <span class="badge status-${l.status}">${statusIcon} ${l.status.toUpperCase()}</span>
      </td>
    `;
    
    tbody.appendChild(tr);
  });
}

// Submit a new debt or edit an existing one
async function handleDebtSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('debt-id').value;
  const name = document.getElementById('debt-name').value;
  const email = document.getElementById('debt-email').value;
  const amount = parseFloat(document.getElementById('debt-amount').value);
  const reason = document.getElementById('debt-reason').value;
  const frequency_days = parseInt(document.getElementById('debt-frequency').value, 10);
  const is_active = document.getElementById('debt-active').checked;

  const payload = { name, email, amount, reason, frequency_days, is_active };
  
  try {
    let res;
    if (id) {
      res = await fetch(`${API_BASE}/debts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch(`${API_BASE}/debts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (res.ok) {
      showToast(id ? 'Schuldner bearbeitet' : 'Schuldner hinzugefügt');
      clearDebtForm();
      await fetchDebts();
      await fetchLogs('all');
    } else {
      showToast(data.error || 'Fehler beim Speichern', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Verbindungsfehler', 'error');
  }
}

// Edit handler
function startEditDebt(debtId) {
  const d = debts.find(x => x.id === debtId);
  if (!d) return;

  document.getElementById('debt-form-title').textContent = '✏️ Schuldner bearbeiten';
  document.getElementById('debt-id').value = d.id;
  document.getElementById('debt-name').value = d.name;
  document.getElementById('debt-email').value = d.email;
  document.getElementById('debt-amount').value = d.amount;
  document.getElementById('debt-reason').value = d.reason;
  document.getElementById('debt-frequency').value = d.frequency_days;
  document.getElementById('debt-active').checked = d.is_active;

  document.getElementById('btn-debt-clear').style.display = 'inline-block';
  document.getElementById('btn-debt-save').textContent = '💾 Aktualisieren';
  
  document.getElementById('debt-form-title').scrollIntoView({ behavior: 'smooth' });
}

// Clear form and cancel edit
function clearDebtForm() {
  document.getElementById('debt-form-title').textContent = '✏️ Schuldner hinzufügen';
  document.getElementById('debt-id').value = '';
  document.getElementById('debt-name').value = '';
  document.getElementById('debt-email').value = '';
  document.getElementById('debt-amount').value = '';
  document.getElementById('debt-reason').value = '';
  document.getElementById('debt-frequency').value = '1';
  document.getElementById('debt-active').checked = true;

  document.getElementById('btn-debt-clear').style.display = 'none';
  document.getElementById('btn-debt-save').textContent = '💾 Speichern';
}

// Trigger Manual Send Email immediately
async function triggerSendNow(debtId) {
  const d = debts.find(x => x.id === debtId);
  if (!d) return;

  try {
    showToast(`Erinnerungs-E-Mail an ${d.name} wird gesendet...`);
    const res = await fetch(`${API_BASE}/debts/${debtId}/send-now`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'E-Mail erfolgreich gesendet / geloggt');
      await fetchDebts();
      
      const filterSelect = document.getElementById('logs-filter-debtor');
      filterSelect.value = 'all';
      await fetchLogs('all');
    } else {
      showToast(data.error || 'Fehler beim Senden', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Fehler bei der Anfrage', 'error');
  }
}

// Delete debtor handler
async function handleDeleteDebt(debtId) {
  const d = debts.find(x => x.id === debtId);
  if (!d) return;

  const title = document.querySelector('.confirm-title');
  const text = document.querySelector('.confirm-text');
  
  const originalTitle = title.textContent;
  const originalText = text.textContent;

  title.textContent = 'Schuldner entfernen?';
  text.textContent = `Möchtest du ${d.name} wirklich aus der Liste entfernen? Historische Logs bleiben erhalten.`;

  const confirmed = await showConfirm();

  title.textContent = originalTitle;
  text.textContent = originalText;

  if (confirmed) {
    try {
      const res = await fetch(`${API_BASE}/debts/${debtId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showToast('Schuldner erfolgreich entfernt');
        clearDebtForm();
        await fetchDebts();
        await fetchLogs('all');
      } else {
        showToast(data.error || 'Fehler beim Löschen', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Verbindungsfehler', 'error');
    }
  }
}

// Expose handlers globally for onclick attributes
window.triggerSendNow = triggerSendNow;
window.startEditDebt = startEditDebt;
window.handleDeleteDebt = handleDeleteDebt;
