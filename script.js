/* ═══════════════════════════════════════════════════
   TRACKO — SCRIPT.JS
   Full App Logic: Auth, Tasks, XP, Badges, Dashboard
═══════════════════════════════════════════════════ */

'use strict';

/* ════════════════════════════════════════════════
   CONSTANTS & CONFIG
════════════════════════════════════════════════ */
const XP_PER_TASK     = 25;
const XP_PER_LEVEL    = 100;
const MAX_LEVEL       = 100;
const STREAK_KEY      = 'tracko_streak';
const HISTORY_LIMIT   = 50;

const BADGES_DEF = [
  { id: 'first_task',    emoji: '🌟', name: 'First Task',      desc: 'Complete your first task',       req: (s) => s.totalDone >= 1  },
  { id: 'five_tasks',    emoji: '🔥', name: '5 Tasks Done',     desc: 'Complete 5 tasks',               req: (s) => s.totalDone >= 5  },
  { id: 'ten_tasks',     emoji: '⚡', name: '10 Tasks Done',    desc: 'Complete 10 tasks',              req: (s) => s.totalDone >= 10 },
  { id: 'twenty_five',   emoji: '💎', name: '25 Tasks Done',    desc: 'Complete 25 tasks',              req: (s) => s.totalDone >= 25 },
  { id: 'level_5',       emoji: '🚀', name: 'Level 5',          desc: 'Reach Level 5',                  req: (s) => s.level >= 5      },
  { id: 'level_10',      emoji: '👑', name: 'Level 10',         desc: 'Reach Level 10',                 req: (s) => s.level >= 10     },
  { id: 'streak_start',  emoji: '📅', name: 'Streak Starter',   desc: 'Log in 2 days in a row',        req: (s) => s.streak >= 2     },
  { id: 'streak_week',   emoji: '🗓️', name: 'Week Warrior',     desc: 'Maintain a 7-day streak',       req: (s) => s.streak >= 7     },
  { id: 'high_prio',     emoji: '🎯', name: 'High Achiever',    desc: 'Complete a high-priority task',  req: (s) => s.doneHighPrio >= 1},
  { id: 'perfect_day',   emoji: '✨', name: 'Perfect Day',      desc: 'Complete all tasks in one day',  req: (s) => s.perfectDay      },
];

/* ════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════ */
let state = {
  currentUser: null,   // { username, name, passwordHash }
  tasks: [],           // [{ id, text, priority, done, createdAt, doneAt }]
  xp: 0,
  level: 1,
  badges: [],          // array of unlocked badge ids
  totalDone: 0,
  doneHighPrio: 0,
  streak: 0,
  lastActive: null,
  perfectDay: false,
  history: [],         // [{ icon, text, time }]
  currentFilter: 'all',
  currentView: 'dashboard',
};

/* ════════════════════════════════════════════════
   STORAGE HELPERS
════════════════════════════════════════════════ */
function saveState() {
  if (!state.currentUser) return;
  const key = `tracko_${state.currentUser.username}`;
  localStorage.setItem(key, JSON.stringify({
    tasks: state.tasks,
    xp: state.xp,
    level: state.level,
    badges: state.badges,
    totalDone: state.totalDone,
    doneHighPrio: state.doneHighPrio,
    streak: state.streak,
    lastActive: state.lastActive,
    perfectDay: state.perfectDay,
    history: state.history,
  }));
}

function loadUserState(username) {
  const key = `tracko_${username}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getUsers() {
  try { return JSON.parse(localStorage.getItem('tracko_users') || '{}'); } catch { return {}; }
}

function saveUsers(users) {
  localStorage.setItem('tracko_users', JSON.stringify(users));
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h.toString(16);
}

/* ════════════════════════════════════════════════
   STREAK LOGIC
════════════════════════════════════════════════ */
function checkStreak() {
  const today = new Date().toDateString();
  if (!state.lastActive) {
    state.streak = 1;
    state.lastActive = today;
    return;
  }
  if (state.lastActive === today) return;

  const last = new Date(state.lastActive);
  const now  = new Date(today);
  const diff = Math.round((now - last) / (1000 * 60 * 60 * 24));

  if (diff === 1) {
    state.streak++;
  } else if (diff > 1) {
    state.streak = 1;
  }
  state.lastActive = today;
}

/* ════════════════════════════════════════════════
   XP & LEVEL
════════════════════════════════════════════════ */
function addXP(amount) {
  state.xp += amount;
  recalcLevel();
}

function recalcLevel() {
  const totalXP  = state.xp;
  const newLevel = Math.min(MAX_LEVEL, Math.floor(totalXP / XP_PER_LEVEL) + 1);
  if (newLevel > state.level) {
    showToast(`🎉 Level Up! You're now Level ${newLevel}!`);
    addHistory('🎉', `Reached Level ${newLevel}`);
  }
  state.level = newLevel;
}

function getXPInCurrentLevel() { return state.xp % XP_PER_LEVEL; }
function getXPToNextLevel()    { return XP_PER_LEVEL - getXPInCurrentLevel(); }
function getXPPercent()        { return (getXPInCurrentLevel() / XP_PER_LEVEL) * 100; }

/* ════════════════════════════════════════════════
   BADGES
════════════════════════════════════════════════ */
function checkBadges() {
  const snap = {
    totalDone:   state.totalDone,
    level:       state.level,
    streak:      state.streak,
    doneHighPrio:state.doneHighPrio,
    perfectDay:  state.perfectDay,
  };
  BADGES_DEF.forEach(b => {
    if (!state.badges.includes(b.id) && b.req(snap)) {
      state.badges.push(b.id);
      showBadgePopup(b);
      addHistory('🏅', `Unlocked badge: ${b.name}`);
    }
  });
}

/* ════════════════════════════════════════════════
   TASK HELPERS
════════════════════════════════════════════════ */
function createTask(text, priority) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    text,
    priority,
    done: false,
    createdAt: Date.now(),
    doneAt: null,
  };
}

function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  task.done = !task.done;

  if (task.done) {
    task.doneAt = Date.now();
    state.totalDone++;
    if (task.priority === 'high') state.doneHighPrio++;
    addXP(XP_PER_TASK);
    checkPerfectDay();
    checkBadges();
    addHistory('✓', `Completed: "${task.text.slice(0, 40)}"`);
    showToast(`+${XP_PER_TASK} XP earned! ✨`);
  } else {
    // Uncomplete
    task.doneAt = null;
    state.totalDone = Math.max(0, state.totalDone - 1);
    if (task.priority === 'high') state.doneHighPrio = Math.max(0, state.doneHighPrio - 1);
    state.xp = Math.max(0, state.xp - XP_PER_TASK);
    recalcLevel();
  }

  saveState();
  renderAll();
}

function deleteTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  state.tasks = state.tasks.filter(t => t.id !== id);
  if (task.done) {
    state.totalDone = Math.max(0, state.totalDone - 1);
    if (task.priority === 'high') state.doneHighPrio = Math.max(0, state.doneHighPrio - 1);
    state.xp = Math.max(0, state.xp - XP_PER_TASK);
    recalcLevel();
  }
  saveState();
  renderAll();
  showToast('Task removed.');
}

function checkPerfectDay() {
  if (state.tasks.length > 0 && state.tasks.every(t => t.done)) {
    if (!state.perfectDay) {
      state.perfectDay = true;
    }
  }
}

function getFilteredTasks() {
  const f = state.currentFilter;
  if (f === 'pending')   return state.tasks.filter(t => !t.done);
  if (f === 'completed') return state.tasks.filter(t => t.done);
  return state.tasks;
}

function getCompletionPercent() {
  if (!state.tasks.length) return 0;
  return Math.round((state.tasks.filter(t => t.done).length / state.tasks.length) * 100);
}

/* ════════════════════════════════════════════════
   HISTORY
════════════════════════════════════════════════ */
function addHistory(icon, text) {
  state.history.unshift({
    icon,
    text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  });
  if (state.history.length > HISTORY_LIMIT) state.history.pop();
}

/* ════════════════════════════════════════════════
   RENDER FUNCTIONS
════════════════════════════════════════════════ */
function renderAll() {
  renderTopbar();
  renderSidebar();
  renderDashboard();
  renderTasks();
  renderProgress();
  renderProfile();
}

/* ── Topbar ── */
function renderTopbar() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  document.getElementById('greeting-text').textContent = greet;
  document.getElementById('greeting-name').textContent = state.currentUser?.name || 'User';

  const pct = getXPPercent();
  document.getElementById('topbar-xp-fill').style.width = pct + '%';
  document.getElementById('topbar-xp-text').textContent =
    `${getXPInCurrentLevel()} / ${XP_PER_LEVEL}`;
}

/* ── Sidebar ── */
function renderSidebar() {
  const u = state.currentUser;
  if (!u) return;
  document.getElementById('sidebar-avatar').textContent = u.name.charAt(0).toUpperCase();
  document.getElementById('sidebar-name').textContent   = u.name;
  document.getElementById('sidebar-level').textContent  = `Level ${state.level}`;
}

/* ── Dashboard ── */
function renderDashboard() {
  const total   = state.tasks.length;
  const done    = state.tasks.filter(t => t.done).length;
  const pending = total - done;
  const pct     = getCompletionPercent();

  document.getElementById('stat-total').textContent   = total;
  document.getElementById('stat-done').textContent    = done;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-level').textContent   = state.level;

  document.getElementById('dash-pct').textContent          = pct + '%';
  document.getElementById('dash-progress-fill').style.width = pct + '%';
  document.getElementById('progress-done-label').textContent = `${done} done`;
  document.getElementById('progress-total-label').textContent= `${total} total`;

  // Level & XP
  document.getElementById('level-num').textContent    = state.level;
  document.getElementById('level-orb').setAttribute('data-level', state.level);
  document.getElementById('xp-bar-fill').style.width  = getXPPercent() + '%';
  document.getElementById('xp-fraction').textContent  =
    `${getXPInCurrentLevel()} / ${XP_PER_LEVEL}`;
  document.getElementById('xp-next-label').textContent =
    state.level >= MAX_LEVEL ? 'Max Level reached! 🏆' : `${getXPToNextLevel()} XP to next level`;

  // Bar Chart (last 7 days placeholder using task priorities)
  renderBarChart();

  // Badges
  renderBadgesGrid('badges-grid', 'badge-count');
}

function renderBarChart() {
  const chart = document.getElementById('bar-chart');
  chart.innerHTML = '';

  const categories = ['Low', 'Med', 'High', 'Done', 'Left', 'XP', 'Lvl'];
  const done  = state.tasks.filter(t => t.done).length;
  const total = state.tasks.length;
  const pend  = total - done;
  const lowP  = state.tasks.filter(t => t.priority === 'low').length;
  const medP  = state.tasks.filter(t => t.priority === 'medium').length;
  const higP  = state.tasks.filter(t => t.priority === 'high').length;
  const xpPct = getXPPercent();
  const lvlPct= (state.level / MAX_LEVEL) * 100;

  const raw = [lowP, medP, higP, done, pend, xpPct, lvlPct];
  const maxVal = Math.max(...raw, 1);

  categories.forEach((cat, i) => {
    const isXP   = i >= 5;
    const val    = raw[i];
    const hPct   = Math.max(4, Math.round((val / maxVal) * 100));
    const isComp = i === 3;

    const col = document.createElement('div');
    col.className = 'bar-col';

    const fill = document.createElement('div');
    fill.className = `bar-fill ${isComp || isXP ? 'complete' : 'pending'}`;
    fill.style.height = hPct + '%';

    const lbl = document.createElement('span');
    lbl.className = 'bar-label';
    lbl.textContent = cat;

    col.appendChild(fill);
    col.appendChild(lbl);
    chart.appendChild(col);
  });
}

function renderBadgesGrid(gridId, countId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = '';

  BADGES_DEF.forEach(b => {
    const unlocked = state.badges.includes(b.id);
    const div = document.createElement('div');
    div.className = `badge-item ${unlocked ? 'unlocked' : 'locked'}`;
    div.innerHTML = `
      <span class="badge-emoji">${b.emoji}</span>
      <span class="badge-name">${b.name}</span>
    `;
    div.title = b.desc + (unlocked ? ' ✓' : ' (locked)');
    grid.appendChild(div);
  });

  if (countId) {
    const el = document.getElementById(countId);
    if (el) el.textContent = `${state.badges.length} earned`;
  }
}

/* ── Tasks ── */
function renderTasks() {
  const list      = document.getElementById('task-list');
  const empty     = document.getElementById('empty-state');
  const filtered  = getFilteredTasks();
  const pct       = getCompletionPercent();
  const done      = state.tasks.filter(t => t.done).length;

  document.getElementById('inline-bar-fill').style.width = pct + '%';
  document.getElementById('inline-pct').textContent      = pct + '%';

  // Clear existing items (keep empty state)
  Array.from(list.querySelectorAll('.task-item')).forEach(el => el.remove());

  if (filtered.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  filtered.forEach(task => {
    const item = document.createElement('div');
    item.className = `task-item ${task.done ? 'completed' : ''}`;
    item.dataset.id = task.id;

    item.innerHTML = `
      <div class="task-checkbox" role="checkbox" aria-checked="${task.done}" tabindex="0">
        ${task.done ? '✓' : ''}
      </div>
      <span class="task-text">${escHtml(task.text)}</span>
      <span class="priority-dot ${task.priority}" title="${task.priority} priority"></span>
      <button class="task-delete" title="Delete task" aria-label="Delete">✕</button>
    `;

    item.querySelector('.task-checkbox').addEventListener('click', () => toggleTask(task.id));
    item.querySelector('.task-text').addEventListener('click', () => toggleTask(task.id));
    item.querySelector('.task-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(task.id);
    });

    list.appendChild(item);
  });
}

/* ── Progress ── */
function renderProgress() {
  document.getElementById('streak-num').textContent = state.streak;

  // XP Breakdown
  const breakdown = document.getElementById('xp-breakdown');
  if (breakdown) {
    const rows = [
      { label: 'Tasks Completed', val: state.totalDone * XP_PER_TASK, max: Math.max(state.totalDone * XP_PER_TASK, 100), color: '#22d3ee' },
      { label: 'Current Level XP',val: getXPInCurrentLevel(),          max: XP_PER_LEVEL,                                  color: '#a78bfa' },
      { label: 'Total XP',         val: state.xp,                      max: Math.max(state.xp, 100),                       color: '#4ade80' },
    ];
    breakdown.innerHTML = rows.map(r => `
      <div class="xp-row">
        <span class="xp-row-label">${r.label}</span>
        <div class="xp-row-bar">
          <div class="xp-row-fill" style="width:${Math.min(100, Math.round((r.val/r.max)*100))}%;background:${r.color}"></div>
        </div>
        <span class="xp-row-val">${r.val}</span>
      </div>
    `).join('');
  }

  // All badges
  renderBadgesGrid('badges-grid-progress', null);

  // History
  const histList = document.getElementById('history-list');
  if (histList) {
    if (state.history.length === 0) {
      histList.innerHTML = '<p class="empty-msg">Complete tasks to see history here.</p>';
    } else {
      histList.innerHTML = state.history.slice(0, 20).map(h => `
        <div class="history-item">
          <span class="h-icon">${h.icon}</span>
          <span class="h-text">${escHtml(h.text)}</span>
          <span class="h-time">${h.time}</span>
        </div>
      `).join('');
    }
  }
}

/* ── Profile ── */
function renderProfile() {
  const u = state.currentUser;
  if (!u) return;

  const total = state.tasks.length;
  const done  = state.tasks.filter(t => t.done).length;

  document.getElementById('profile-avatar-large').textContent = u.name.charAt(0).toUpperCase();
  document.getElementById('profile-name-display').textContent   = u.name;
  document.getElementById('profile-username-display').textContent = '@' + u.username;
  document.getElementById('profile-level-badge').textContent    = `Level ${state.level}`;
  document.getElementById('profile-total').textContent          = total;
  document.getElementById('profile-done').textContent           = done;
  document.getElementById('profile-xp').textContent             = state.xp;
  document.getElementById('profile-badges').textContent         = state.badges.length;
  document.getElementById('edit-name').value                    = u.name;
}

/* ════════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════════ */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

function showBadgePopup(badge) {
  const popup = document.getElementById('badge-popup');
  document.getElementById('badge-popup-icon').textContent = badge.emoji;
  document.getElementById('badge-popup-name').textContent = badge.name;
  popup.classList.add('show');
  setTimeout(() => popup.classList.remove('show'), 3000);
}

function switchView(name) {
  state.currentView = name;

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const viewEl = document.getElementById(`view-${name}`);
  if (viewEl) viewEl.classList.add('active');

  document.querySelectorAll(`.nav-item[data-view="${name}"]`).forEach(n => n.classList.add('active'));

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');

  renderAll();
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ════════════════════════════════════════════════
   AUTH
════════════════════════════════════════════════ */
function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  checkStreak();
  renderAll();
  switchView('dashboard');
}

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  state.currentUser = null;
}

function login(username, password) {
  const users = getUsers();
  const user  = users[username.toLowerCase()];
  if (!user) return 'User not found. Please sign up.';
  if (user.passwordHash !== simpleHash(password)) return 'Incorrect password.';

  state.currentUser = user;
  const saved = loadUserState(username.toLowerCase());
  if (saved) {
    Object.assign(state, {
      tasks:       saved.tasks        || [],
      xp:          saved.xp           || 0,
      level:       saved.level        || 1,
      badges:      saved.badges       || [],
      totalDone:   saved.totalDone    || 0,
      doneHighPrio:saved.doneHighPrio || 0,
      streak:      saved.streak       || 0,
      lastActive:  saved.lastActive   || null,
      perfectDay:  saved.perfectDay   || false,
      history:     saved.history      || [],
    });
  } else {
    // Fresh account
    Object.assign(state, {
      tasks: [], xp: 0, level: 1, badges: [],
      totalDone: 0, doneHighPrio: 0, streak: 0,
      lastActive: null, perfectDay: false, history: [],
    });
  }

  localStorage.setItem('tracko_session', username.toLowerCase());
  return null; // no error
}

function signup(name, username, password) {
  if (!name.trim())     return 'Display name is required.';
  if (!username.trim()) return 'Username is required.';
  if (username.length < 3) return 'Username must be at least 3 characters.';
  if (!password || password.length < 4) return 'Password must be at least 4 characters.';

  const users = getUsers();
  if (users[username.toLowerCase()]) return 'Username already taken.';

  const user = {
    username: username.toLowerCase(),
    name: name.trim(),
    passwordHash: simpleHash(password),
  };
  users[username.toLowerCase()] = user;
  saveUsers(users);
  return null;
}

function logout() {
  saveState();
  localStorage.removeItem('tracko_session');
  state.currentUser = null;
  showAuth();
}

function checkAutoLogin() {
  const session = localStorage.getItem('tracko_session');
  if (!session) return false;

  const users = getUsers();
  const user  = users[session];
  if (!user) return false;

  state.currentUser = user;
  const saved = loadUserState(session);
  if (saved) {
    Object.assign(state, {
      tasks:        saved.tasks        || [],
      xp:           saved.xp           || 0,
      level:        saved.level        || 1,
      badges:       saved.badges       || [],
      totalDone:    saved.totalDone    || 0,
      doneHighPrio: saved.doneHighPrio || 0,
      streak:       saved.streak       || 0,
      lastActive:   saved.lastActive   || null,
      perfectDay:   saved.perfectDay   || false,
      history:      saved.history      || [],
    });
  }
  return true;
}

/* ════════════════════════════════════════════════
   EVENT LISTENERS
════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Auto Login ── */
  if (checkAutoLogin()) {
    showApp();
  }

  /* ── Auth Tab Toggle ── */
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      document.getElementById(`${target}-form`).classList.add('active');
      document.getElementById('login-error').textContent  = '';
      document.getElementById('signup-error').textContent = '';
    });
  });

  /* ── Login ── */
  document.getElementById('btn-login').addEventListener('click', () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const err = login(username, password);
    if (err) {
      document.getElementById('login-error').textContent = err;
    } else {
      document.getElementById('login-error').textContent = '';
      showApp();
    }
  });

  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-login').click();
  });

  /* ── Signup ── */
  document.getElementById('btn-signup').addEventListener('click', () => {
    const name     = document.getElementById('signup-name').value.trim();
    const username = document.getElementById('signup-username').value.trim();
    const password = document.getElementById('signup-password').value;
    const err = signup(name, username, password);
    if (err) {
      document.getElementById('signup-error').textContent = err;
    } else {
      document.getElementById('signup-error').textContent = '';
      showToast('Account created! Please sign in.');
      // Switch to login tab
      document.querySelector('[data-tab="login"]').click();
      document.getElementById('login-username').value = username;
    }
  });

  document.getElementById('signup-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-signup').click();
  });

  /* ── Logout ── */
  document.getElementById('btn-logout').addEventListener('click', logout);

  /* ── Sidebar Nav ── */
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });

  /* ── Mobile Menu ── */
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  /* ── Add Task ── */
  document.getElementById('btn-add-task').addEventListener('click', addTaskHandler);

  document.getElementById('task-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTaskHandler();
  });

  function addTaskHandler() {
    const input    = document.getElementById('task-input');
    const priority = document.getElementById('task-priority').value;
    const text     = input.value.trim();

    if (!text) {
      input.focus();
      input.style.borderColor = 'var(--rose)';
      setTimeout(() => input.style.borderColor = '', 600);
      return;
    }

    const task = createTask(text, priority);
    state.tasks.unshift(task);
    input.value = '';
    addHistory('◻', `Added: "${text.slice(0, 40)}"`);
    saveState();
    renderAll();
    showToast('Task added!');
  }

  /* ── Filter Tabs ── */
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentFilter = tab.dataset.filter;
      renderTasks();
    });
  });

  /* ── Save Profile ── */
  document.getElementById('btn-save-profile').addEventListener('click', () => {
    const newName = document.getElementById('edit-name').value.trim();
    if (!newName) return;

    state.currentUser.name = newName;
    const users = getUsers();
    users[state.currentUser.username].name = newName;
    saveUsers(users);

    document.getElementById('profile-save-msg').textContent = 'Profile updated!';
    setTimeout(() => document.getElementById('profile-save-msg').textContent = '', 2500);

    renderAll();
  });

  /* ── Auto-save periodically ── */
  setInterval(() => {
    if (state.currentUser) saveState();
  }, 30000);

});
