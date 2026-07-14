/* ==========================================================
   Smart Attendance Register — client-side logic
   Data model: each student stores `marks`, keyed first by date,
   then by lecture number (1-8) -> "present" | "absent".
   e.g. student.marks["2026-07-14"][3] = "present"
   Totals and % are always derived from this object, so nothing
   gets double-counted even if you revisit a date.
   ========================================================== */

const STORAGE_KEY = 'attendance_students_v2'; // v2: lecture-wise data model
const CANCELLED_KEY = 'attendance_cancelled_v1'; // date -> array of cancelled lecture numbers
const DEFAULTER_THRESHOLD = 75;
const LECTURES_PER_DAY = 8;

let students = [];
let cancelledByDate = {};

// ---------- persistence ----------
function loadStudents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    students = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Could not read saved attendance data:', e);
    students = [];
  }
}

function saveStudents() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(students));
  } catch (e) {
    console.error('Could not save attendance data:', e);
  }
}

function loadCancelled() {
  try {
    const raw = localStorage.getItem(CANCELLED_KEY);
    cancelledByDate = raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Could not read cancelled-lecture data:', e);
    cancelledByDate = {};
  }
}

function saveCancelled() {
  try {
    localStorage.setItem(CANCELLED_KEY, JSON.stringify(cancelledByDate));
  } catch (e) {
    console.error('Could not save cancelled-lecture data:', e);
  }
}

function isCancelled(date, lecture) {
  return !!(cancelledByDate[date] && cancelledByDate[date].includes(lecture));
}

// Toggle a lecture cancelled/not-cancelled for the whole class on this date.
// Cancelling also clears any marks already made for that lecture, so it
// never counts towards anyone's total (mirrors the C++ version's behaviour).
function toggleCancelled(date, lecture) {
  if (!cancelledByDate[date]) cancelledByDate[date] = [];
  const idx = cancelledByDate[date].indexOf(lecture);

  if (idx === -1) {
    cancelledByDate[date].push(lecture);
    students.forEach(s => {
      if (s.marks[date]) {
        delete s.marks[date][lecture];
        if (Object.keys(s.marks[date]).length === 0) delete s.marks[date];
      }
    });
    saveStudents();
  } else {
    cancelledByDate[date].splice(idx, 1);
  }
  saveCancelled();
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
function addStudent(roll, name) {
  if (students.some(s => s.roll === roll)) {
    alert('A student with this roll number is already on the register.');
    return false;
  }
  students.push({ roll, name, marks: {} });
  saveStudents();
  return true;
}

function deleteStudent(roll) {
  students = students.filter(s => s.roll !== roll);
  saveStudents();
  render();
}

// Cycle a single lecture slot: unmarked -> present -> absent -> unmarked
function cycleLecture(roll, lecture) {
  const date = selectedDate();
  if (isCancelled(date, lecture)) return; // cancelled lectures can't be marked

  const student = students.find(s => s.roll === roll);
  if (!student) return;

  if (!student.marks[date]) student.marks[date] = {};
  const current = student.marks[date][lecture];

  if (current === undefined) {
    student.marks[date][lecture] = 'present';
  } else if (current === 'present') {
    student.marks[date][lecture] = 'absent';
  } else {
    delete student.marks[date][lecture];
    if (Object.keys(student.marks[date]).length === 0) delete student.marks[date];
  }

  saveStudents();
  render();
}

function resetToday() {
  const date = selectedDate();
  students.forEach(s => delete s.marks[date]);
  saveStudents();
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

  // Flatten every lecture-mark recorded for the selected date, across all students
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

  // threshold guide line at 75%
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
document.addEventListener('DOMContentLoaded', () => {
  loadStudents();
  loadCancelled();

  const dateInput = document.getElementById('attendance-date');
  dateInput.value = todayISO();

  document.getElementById('today-chip').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  document.getElementById('add-form').addEventListener('submit', e => {
    e.preventDefault();
    const rollInput = document.getElementById('input-roll');
    const nameInput = document.getElementById('input-name');
    const roll = rollInput.value.trim();
    const name = nameInput.value.trim();
    if (!roll || !name) return;

    if (addStudent(roll, name)) {
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

  render();
});