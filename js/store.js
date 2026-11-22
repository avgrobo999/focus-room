import { dayKey, uid } from './util.js?v=20261121e';

const PREFIX = 'focusroom:v1:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function save(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
  catch (e) { console.warn('save failed', key, e); return false; }
}

export const DEFAULT_SETTINGS = {
  name: '',
  clock24: false,
  showSeconds: false,
  showQuote: true,
  bigQuote: false, // quote shown large above the clock / timer
  timerType: 'pomodoro', // pomodoro | countdown | stopwatch
  preset: 'classic',
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  countdownMin: 45,
  autoBreaks: true,
  autoFocus: false,
  tally: 'dot', // dot | tomato | star | heart
  alert: 'chime',
  alertVolume: 0.7,
  notify: false,
  autoHide: true,
  autoPopout: true, // timer pops out into its own window when you switch tabs
  scene: 'dusk',
  customScenes: [], // {id, name, url}
  mode: 'home',
  masterVolume: 0.8,
  sounds: {}, // id -> volume (0..1) of active sounds
  music: null, // {kind, id, title}
  musicVolume: 80, // 0..100, YouTube player
  musicMuted: false,
  musicShuffle: false,
  roomSyncDefault: true,
  roomThemeSync: false, // in a study room, send my theme changes and take friends' automatically
  musicSide: false, // music player docked as a sidebar
  navOpen: true, // the menu on the left is open (on a phone it starts closed)
  pinOnStart: null, // pop the timer out (always on top) when it starts; null = on when installed as an app
  buddyCheer: true, // the little girl runs in to cheer when a focus session ends
  waterRemind: true, // ...and brings a glass of water every 15–20 minutes
  buddyStay: false, // she stays on screen between visits
  buddyPos: null, // where she stands: {x, y} as fractions of the window (her feet)
};

export const PRESETS = {
  classic: { label: 'Classic 25 / 5', focusMin: 25, shortMin: 5, longMin: 15 },
  deep: { label: 'Deep work 50 / 10', focusMin: 50, shortMin: 10, longMin: 20 },
  animedoro: { label: 'Animedoro 40 / 20', focusMin: 40, shortMin: 20, longMin: 30 },
  sprint: { label: 'Sprint 15 / 3', focusMin: 15, shortMin: 3, longMin: 10 },
  custom: { label: 'Custom' },
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...load('settings', {}) };
}

export function clientId() {
  let id = load('clientId', null);
  if (!id) { id = uid(12); save('clientId', id); }
  return id;
}

/* ---------- water today ---------- */
// 'water': {day, n, ml}: n = times you told your buddy you drank, ml = bottles ticked off (500 ml each)
export const WATER_GOAL_ML = 3000;
export const BOTTLE_ML = 500;
export const waterEvents = new EventTarget(); // 'change' when today's water changes

// 'water' also carries at (when it last changed), so your devices can tell whose count is newer
export function cleanWater(w) {
  if (!w || typeof w !== 'object' || typeof w.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w.day)) return null;
  const num = (v, hi) => (Number.isFinite(v) && v > 0 ? Math.min(hi, Math.round(v)) : 0);
  return { day: w.day, n: num(w.n, 999), ml: num(w.ml, 20000), at: num(w.at, Date.now() + 864e5) };
}
/** today's record as stored here ({day, n, ml, at}), or null if nothing yet today */
export function waterRecord() {
  const w = cleanWater(load('water', null));
  return w?.day === dayKey() ? w : null;
}
export function waterToday() {
  const w = waterRecord();
  return w ? { n: w.n, ml: w.ml } : { n: 0, ml: 0 };
}
function setWater(patch) {
  const w = { day: dayKey(), ...waterToday(), ...patch, at: Math.max(Date.now(), (waterRecord()?.at || 0) + 1) };
  save('water', w);
  waterEvents.dispatchEvent(new CustomEvent('change', { detail: { local: true } }));
  return w;
}
/** today's water from another of your devices: taken if it changed more recently than ours */
export function applyWater(rec) {
  const w = cleanWater(rec), mine = waterRecord();
  if (!w || w.day !== dayKey() || (mine && mine.at >= w.at)) return false;
  save('water', w);
  waterEvents.dispatchEvent(new CustomEvent('change', { detail: { local: false } }));
  return true;
}
/** set how much you've drunk today; returns the new total in ml */
export function setWaterMl(ml) { return setWater({ ml: Math.max(0, Math.min(20000, Math.round(ml))) }).ml; }
/** one more "I drank water"; returns today's count */
export function countSip() { return setWater({ n: waterToday().n + 1 }).n; }
export const fmtLitres = (ml) => String(+(ml / 1000).toFixed(2));

/* ---------- tasks ---------- */
// Like the focus log, signed in to sync the list belongs to that Google account ('tasks:<email>',
// a local copy of what's in its Drive); signed out it's this browser's own list ('tasks').
// Each task carries u (when its text, done or estimate last changed); 'taskMeta' keeps
// {deleted: {id: when}, orderAt: when the order last changed}, so devices can merge their lists.
export const taskEvents = new EventTarget(); // 'saved' ({detail: {edit}}) when this device changes them; 'reload' when they change under the app
const taskKey = (acct = logAccount()) => (acct?.email ? `tasks:${acct.email}` : 'tasks');
const taskMetaKey = (acct = logAccount()) => (acct?.email ? `taskMeta:${acct.email}` : 'taskMeta');
const TOMBSTONE_MS = 90 * 864e5;

const int = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
// a clean copy of one task, or null if it isn't one (data from Drive or a backup file is untrusted)
export function cleanTask(t) {
  if (!t || typeof t !== 'object') return null;
  if (typeof t.id !== 'string' || !/^[\w-]{1,24}$/.test(t.id)) return null;
  const text = typeof t.text === 'string' ? t.text.trim().slice(0, 200) : '';
  if (!text) return null;
  return {
    id: t.id, text, done: t.done === true,
    est: int(t.est, 1, 99, 1), spent: int(t.spent, 0, 9999, 0), ms: int(t.ms, 0, 1e11, 0),
    u: int(t.u, 0, Date.now() + 864e5, 0),
  };
}
const cleanTasks = (list) => {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(cleanTask).filter((t) => t && !seen.has(t.id) && seen.add(t.id));
};
function cleanMeta(m) {
  const cutoff = Date.now() - TOMBSTONE_MS;
  const deleted = {};
  for (const [id, at] of Object.entries(m?.deleted && typeof m.deleted === 'object' ? m.deleted : {})) {
    if (/^[\w-]{1,24}$/.test(id) && Number.isFinite(at) && at >= cutoff) deleted[id] = at;
  }
  return { deleted, orderAt: int(m?.orderAt, 0, Date.now() + 864e5, 0) };
}

export function loadTasks() { return cleanTasks(load(taskKey(), [])); }

/** the whole list as it goes to Drive: {tasks, deleted, orderAt} */
export function getTaskState() { return { tasks: loadTasks(), ...cleanMeta(load(taskMetaKey(), {})) }; }

const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const shown = (list) => JSON.stringify(list.map(({ u, ...t }) => t));

/** keep a merged list (from sync); tells the app if what it shows has changed */
export function setTaskState(st) {
  const before = loadTasks();
  save(taskKey(), cleanTasks(st.tasks));
  save(taskMetaKey(), cleanMeta(st));
  if (shown(before) !== shown(loadTasks())) taskEvents.dispatchEvent(new Event('reload'));
}

/**
 * Save the app's list. Works out what changed since the last save, so each edited task is
 * stamped with the time, deleted ones leave a note behind, and a new order is dated.
 * Stamps u on the app's own task objects too.
 */
export function saveTasks(list) {
  const now = Date.now();
  const prev = loadTasks();
  const meta = cleanMeta(load(taskMetaKey(), {}));
  const prevById = new Map(prev.map((t) => [t.id, t]));
  let edit = false;
  const out = [];
  for (const t of list) {
    const c = cleanTask({ ...t, u: 0 });
    if (!c) continue;
    const p = prevById.get(c.id);
    const changed = !p || p.text !== c.text || p.done !== c.done || p.est !== c.est || p.spent !== c.spent;
    c.u = changed || !p.u ? Math.max(now, (p?.u || 0) + 1) : p.u; // an edit always comes after the version it changed
    if (changed) edit = true;
    t.u = c.u;
    delete meta.deleted[c.id];
    out.push(c);
  }
  const ids = new Set(out.map((t) => t.id));
  for (const p of prev) if (!ids.has(p.id)) { meta.deleted[p.id] = now; edit = true; }
  // same order as before, apart from new tasks? (adding at the bottom isn't a reorder; at the top it is)
  const expected = [...prev.filter((p) => ids.has(p.id)).map((p) => p.id), ...out.filter((t) => !prevById.has(t.id)).map((t) => t.id)];
  if (!sameIds(out.map((t) => t.id), expected)) { meta.orderAt = Math.max(now, meta.orderAt + 1); edit = true; }
  const timeOnly = !edit && JSON.stringify(out) !== JSON.stringify(prev);
  save(taskKey(), out);
  save(taskMetaKey(), meta);
  if (edit || timeOnly) taskEvents.dispatchEvent(new CustomEvent('saved', { detail: { edit } }));
}

/**
 * Merge two task lists (each {tasks, deleted, orderAt}). Per task the latest edit wins and the
 * focus time and sessions done never go down; a task deleted after its last edit stays deleted;
 * the order comes from whichever list was reordered last, with the other's new tasks after.
 */
export function mergeTasks(a, b) {
  const A = { tasks: cleanTasks(a?.tasks), ...cleanMeta(a) };
  const B = { tasks: cleanTasks(b?.tasks), ...cleanMeta(b) };
  const deleted = { ...A.deleted };
  for (const [id, at] of Object.entries(B.deleted)) deleted[id] = Math.max(deleted[id] || 0, at);
  const byId = new Map();
  for (const t of [...A.tasks, ...B.tasks]) {
    const o = byId.get(t.id);
    if (!o) { byId.set(t.id, t); continue; }
    const w = t.u >= o.u ? t : o; // a tie goes to b (this device, when syncing)
    byId.set(t.id, { ...w, ms: Math.max(t.ms, o.ms), spent: Math.max(t.spent, o.spent) });
  }
  const [first, second] = B.orderAt > A.orderAt ? [B, A] : [A, B]; // never reordered: a's order, b's new tasks after
  const order = [...new Set([...first.tasks, ...second.tasks].map((t) => t.id))];
  const tasks = order.map((id) => byId.get(id)).filter((t) => !(deleted[t.id] >= t.u));
  for (const t of tasks) delete deleted[t.id];
  return {
    tasks: [...tasks.filter((t) => !t.done), ...tasks.filter((t) => t.done)],
    deleted, orderAt: Math.max(A.orderAt, B.orderAt),
  };
}

/* ---------- focus stats ---------- */
// log: [{ts, day, min, task}]
// Signed in to sync, the log belongs to that Google account ('log:<email>', a local copy of
// what's in the account's Drive); signed out it's this browser's own log ('log').
export const logEvents = new EventTarget(); // 'added' when a session is saved

export function logAccount() { return load('account', null); } // {email, name, picture} or null
const logKey = (acct = logAccount()) => (acct?.email ? `log:${acct.email}` : 'log');
export function getLog() { return load(logKey(), []); }

// keep a year of history
const prune = (log) => { const cutoff = Date.now() - 400 * 864e5; return log.filter((s) => s.ts >= cutoff); };
export function setLog(log) { save(logKey(), prune(log)); }

// a clean copy of one entry, or null if it isn't one (data from Drive or a backup file is untrusted)
export function cleanEntry(s) {
  if (!s || typeof s !== 'object') return null;
  const { ts, day, min, task } = s;
  if (!Number.isFinite(ts) || ts < 1.5e12 || ts > Date.now() + 864e5) return null;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (!Number.isFinite(min) || min <= 0 || min > 24 * 60) return null;
  const e = { ts, day, min, task: typeof task === 'string' ? task.slice(0, 200) : '' };
  if (typeof s.sid === 'string' && /^[\w-]{4,40}$/.test(s.sid)) e.sid = s.sid;
  return e;
}

// union of logs; a session is the same session if it has the same id (the same timer run, shown
// on two of your devices: kept once, with the longer time), or else ended at the same moment with the same length
export function mergeLogs(...logs) {
  const all = new Map();
  for (const log of logs) {
    for (const raw of Array.isArray(log) ? log : []) {
      const s = cleanEntry(raw);
      if (!s) continue;
      const k = s.sid ? `sid:${s.sid}` : `${s.ts}:${s.min}`;
      const o = all.get(k);
      if (!o || s.min > o.min || (s.min === o.min && s.ts < o.ts)) all.set(k, s);
    }
  }
  return prune([...all.values()].sort((a, b) => a.ts - b.ts));
}

/** Switch whose log is shown. Signing in for the first time brings this browser's own log along. */
export function useAccount(acct) {
  const prev = logAccount();
  if (!acct) save('account', null);
  else {
    save('account', { email: acct.email, name: acct.name || acct.email, picture: acct.picture || '' });
    if (!prev?.email) {
      const guest = load('log', []);
      if (guest.length) { save(logKey(acct), mergeLogs(load(logKey(acct), []), guest)); save('log', []); }
      // this browser's own tasks come along too
      const guestTasks = { tasks: load('tasks', []), ...cleanMeta(load('taskMeta', {})) };
      if (cleanTasks(guestTasks.tasks).length) {
        const m = mergeTasks({ tasks: load(taskKey(acct), []), ...cleanMeta(load(taskMetaKey(acct), {})) }, guestTasks);
        save(taskKey(acct), m.tasks); save(taskMetaKey(acct), { deleted: m.deleted, orderAt: m.orderAt });
        save('tasks', []); save('taskMeta', {});
      }
    }
  }
  if ((prev?.email || '') !== (acct?.email || '')) taskEvents.dispatchEvent(new Event('reload'));
}

/** Forget an account's local copy (after it's safely in Drive). */
export function dropAccountLog(email) {
  try { ['log', 'tasks', 'taskMeta'].forEach((k) => localStorage.removeItem(PREFIX + `${k}:${email}`)); } catch { /* ignore */ }
}

export function addSession(min, task, sid) {
  if (min < 0.5) return;
  const e = { ts: Date.now(), day: dayKey(), min: Math.round(min * 10) / 10, task: task || '' };
  if (sid) e.sid = sid;
  setLog(mergeLogs(getLog(), [e]));
  logEvents.dispatchEvent(new Event('added'));
}

export function statsSummary() {
  const log = getLog();
  const today = dayKey();
  const byDay = {};
  for (const s of log) byDay[s.day] = (byDay[s.day] || 0) + s.min;
  const todaySessions = log.filter((s) => s.day === today);

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = dayKey(d);
    last7.push({ day: k, label: d.toLocaleDateString(undefined, { weekday: 'short' }), min: byDay[k] || 0 });
  }

  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = dayKey(d);
    if (byDay[k]) streak++;
    else if (i === 0) continue; // today not started yet doesn't break the streak
    else break;
    if (i > 400) break;
  }

  // focus time per task over the last 7 days (sessions with no task are left out)
  const weekKeys = new Set(last7.map((d) => d.day));
  const tasks = new Map();
  for (const s of log) {
    const name = (s.task || '').trim();
    if (!name || !weekKeys.has(s.day)) continue;
    const r = tasks.get(name.toLowerCase()) || { task: name, min: 0, n: 0 };
    r.min += s.min; r.n += 1;
    tasks.set(name.toLowerCase(), r);
  }
  const byTask = [...tasks.values()].sort((a, b) => b.min - a.min).slice(0, 8);

  const monthPrefix = today.slice(0, 7);
  const monthMin = Object.entries(byDay).filter(([k]) => k.startsWith(monthPrefix)).reduce((a, [, v]) => a + v, 0);

  return {
    todayMin: byDay[today] || 0,
    todaySessions: todaySessions.length,
    weekMin: last7.reduce((a, d) => a + d.min, 0),
    monthMin,
    totalMin: log.reduce((a, s) => a + s.min, 0),
    streak,
    last7,
    byTask,
    recent: log.slice(-8).reverse(),
  };
}
