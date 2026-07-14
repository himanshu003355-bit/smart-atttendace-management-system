/* ==========================================================
   Smart Attendance Register — client-side logic
   Data now lives in a shared MySQL database via the /api/*
   endpoints in server.js, instead of this browser's localStorage.
   After every action we re-fetch the full state from the server
   so everyone viewing the page sees the same data.
   Data model (unchanged): each student stores `marks`, keyed
   first by date, then by lecture number (1-8) -> "present" | "absent".
   ========================================================== */

const DEFAULTER_THRESHOLD = 75;
const LECTURES_PER_DAY = 8;

let students = [];
let cancelledByDate = {};

// ---------- server sync ----------
async function fetchState() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('Bad response from server');
    const data = await res.json();
    students = data.students || [];
    cancelledByDate = data.cancelled || {};
  } catch (e) {
    console.error('Could not load attendance data from server:', e);
  }
}

function isCancelled(date, lecture) {
  return !!(cancelledByDate[date] && cancelledByDate[date].includes(lecture));
}

// Toggle a lecture cancelled/not-cancelled for the whole class on this date.
async function toggleCancelled(date, lecture) {
  await fetch('/api/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, lecture })
  });
  await fetchState();
  render();
}

// ---------- derived numbers ----------
function totalClasses(student) {
  let total = 0;
  for (const date in student.marks) {
    total += Object.keys(student.marks[date]).length;
  }
  return total;
}

function presentCount(student) {
  let count = 0;
  for (const date in student.marks) {
    count += Object.values(student.marks[date]).filter(s => s === 'present').length;
  }
  return count;
}

function percentage(student) {
  const total = totalClasses(student);
  if (total === 0) return 0;
  return (presentCount(student) / total) * 100;
}

function selectedDate() {
  return document.getElementById('attendance-date').value || todayISO();
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// ---------- actions ----------
async function addStudent(roll, name) {
  const res = await fetch('/api/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roll, name })
  });
  if (res.status === 409) {
    alert('A student with this roll number is already on the register.');
    return false;
  }
  if (!res.ok) {
    alert('Could not add student. Please try again.');
    return false;
  }
  await fetchState();
  return true;
}

async function deleteStudent(roll) {
  await fetch(`/api/students/${encodeURIComponent(roll)}`, { method: 'DELETE' });
  await fetchState();
  render();
}

// Cycle a single lecture slot: unmarked -> present -> absent -> unmarked
async function cycleLecture(roll, lecture) {
  const date = selectedDate();
  if (isCancelled(date, lecture)) return; // cancelled lectures can't be marked

  await fetch('/api/mark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roll, date, lecture })
  });
  await fetchState();
  render();
}

async function resetToday() {
  const date = selectedDate();
  await fetch('/api/reset-today', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date })
  });
  await fetchState();
  render();
}

// ---------- rendering ----------
function render() {
  renderCancelChips();
  renderStats();
  renderLedger();
  renderDefaulters();
  drawChart();
}

function renderCancelChips() {
  const container = document.getElementById('cancel-chips');
  const date = selectedDate();
  container.innerHTML = '';

  for (let l = 1; l <= LECTURES_PER_DAY; l++) {
    const cancelled = isCancelled(date, l);
    const btn = document.createElement('button');
    btn.className = 'cancel-chip' + (cancelled ? ' active' : '');
    btn.textContent = 'L' + l;
    btn.title = cancelled ? `Lecture ${l} is cancelled — click to undo` : `Mark lecture ${l} as cancelled`;
    btn.addEventListener('click', () => toggleCancelled(date, l));
    container.appendChild(btn);
  }
}

function renderStats() {
  const date = selectedDate();
  const total = students.length;

  let markedToday = 0;
  let presentToday = 0;
  students.forEach(s => {
    const dayMarks = s.marks[date];
    if (!dayMarks) return;
    const statuses = Object.values(dayMarks);
    markedToday += statuses.length;
    presentToday += statuses.filter(v => v === 'present').length;
  });

  const avg = total === 0
    ? 0
    : students.reduce((sum, s) => sum + percentage(s), 0) / total;
  const defaulters = students.filter(s => totalClasses(s) > 0 && percentage(s) < DEFAULTER_THRESHOLD).length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-present').textContent =
    markedToday === 0 ? '—' : Math.round((presentToday / markedToday) * 100) + '%';
  document.getElementById('stat-avg').textContent = Math.round(avg) + '%';
  document.getElementById('stat-defaulters').textContent = defaulters;
}

function renderLedger() {
  const body = document.getElementById('ledger-body');
  const emptyState = document.getElementById('empty-state');
  const date = selectedDate();
  body.innerHTML = '';

  if (students.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  students
    .slice()
    .sort((a, b) => a.roll - b.roll)
    .forEach(student => {
      const pct = percentage(student);
      const dayMarks = student.marks[date] || {};
      const tr = document.createElement('tr');

      let lectureButtons = '';
      for (let l = 1; l <= LECTURES_PER_DAY; l++) {
        if (isCancelled(date, l)) {
          lectureButtons += `<button class="lecture-dot cancelled" disabled title="Lecture ${l} cancelled">C</button>`;
          continue;
        }
        const status = dayMarks[l]; // undefined | "present" | "absent"
        const cls = status === 'present' ? 'present active' : status === 'absent' ? 'absent active' : '';
        lectureButtons += `<button class="lecture-dot ${cls}" data-roll="${student.roll}" data-lecture="${l}" title="Lecture ${l}">${l}</button>`;
      }

      tr.innerHTML = `
        <td>${student.roll}</td>
        <td>${escapeHtml(student.name)}</td>
        <td><div class="lecture-row">${lectureButtons}</div></td>
        <td>${presentCount(student)} / ${totalClasses(student)}</td>
        <td>
          <div class="pct-bar-wrap">
            <div class="pct-bar"><div class="pct-bar-fill ${pct < DEFAULTER_THRESHOLD ? 'low' : ''}" style="width:${pct}%"></div></div>
            <span class="pct-text">${pct.toFixed(0)}%</span>
          </div>
        </td>
        <td><button class="row-delete" title="Remove student" data-roll="${student.roll}">&times;</button></td>
      `;
      body.appendChild(tr);
    });
}

function renderDefaulters() {
  const list = document.getElementById('defaulters-list');
  const defaulters = students
    .filter(s => totalClasses(s) > 0 && percentage(s) < DEFAULTER_THRESHOLD)
    .sort((a, b) => percentage(a) - percentage(b));

  list.innerHTML = '';
  if (defaulters.length === 0) {
    list.innerHTML = '<li class="empty-state">No defaulters yet.</li>';
    return;
  }
  defaulters.forEach(s => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="d-name">${escapeHtml(s.name)} (Roll ${s.roll})</span><span class="d-pct">${percentage(s).toFixed(0)}%</span>`;
    list.appendChild(li);
  });
}

function drawChart() {
  const canvas = document.getElementById('chart-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (students.length === 0) {
    ctx.fillStyle = '#c9d6ce';
    ctx.font = '14px "IBM Plex Sans"';
    ctx.fillText('Add students to see the chart.', 16, h / 2);
    return;
  }

  const sorted = students.slice().sort((a, b) => a.roll - b.roll);
  const padding = 28;
  const chartH = h - padding - 20;
  const barGap = 10;
  const barW = Math.max(14, (w - padding - 10) / sorted.length - barGap);

  const thresholdY = padding + chartH * (1 - DEFAULTER_THRESHOLD / 100);
  ctx.strokeStyle = 'rgba(226,112,90,0.6)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padding - 8, thresholdY);
  ctx.lineTo(w - 4, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(226,112,90,0.8)';
  ctx.font = '10px "IBM Plex Mono"';
  ctx.fillText('75%', w - 28, thresholdY - 4);

  sorted.forEach((s, i) => {
    const pct = percentage(s);
    const barH = chartH * (pct / 100);
    const x = padding + i * (barW + barGap);
    const y = padding + chartH - barH;

    ctx.fillStyle = pct < DEFAULTER_THRESHOLD ? '#e2705a' : '#e8c468';
    ctx.fillRect(x, y, barW, barH);

    ctx.fillStyle = '#c9d6ce';
    ctx.font = '9px "IBM Plex Mono"';
    ctx.textAlign = 'center';
    ctx.fillText(String(s.roll), x + barW / 2, padding + chartH + 12);
  });
  ctx.textAlign = 'left';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- wire up events ----------
document.addEventListener('DOMContentLoaded', async () => {
  const dateInput = document.getElementById('attendance-date');
  dateInput.value = todayISO();

  document.getElementById('today-chip').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  document.getElementById('add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const rollInput = document.getElementById('input-roll');
    const nameInput = document.getElementById('input-name');
    const roll = rollInput.value.trim();
    const name = nameInput.value.trim();
    if (!roll || !name) return;

    if (await addStudent(roll, name)) {
      rollInput.value = '';
      nameInput.value = '';
      render();
    }
  });

  document.getElementById('ledger-body').addEventListener('click', e => {
    const lectureBtn = e.target.closest('.lecture-dot');
    if (lectureBtn) {
      cycleLecture(lectureBtn.dataset.roll, Number(lectureBtn.dataset.lecture));
      return;
    }
    const delBtn = e.target.closest('.row-delete');
    if (delBtn) {
      deleteStudent(delBtn.dataset.roll);
    }
  });

  dateInput.addEventListener('change', render);
  document.getElementById('reset-today').addEventListener('click', resetToday);

  await fetchState();
  render();
});