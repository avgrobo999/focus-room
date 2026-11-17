import { dayKey, uid } from './util.js?v=20261116m';

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
  return { ts, day, min, task: typeof task === 'string' ? task.slice(0, 200) : '' };
}

// union of logs; a session is the same session if it ended at the same moment with the same length
export function mergeLogs(...logs) {
  const all = new Map();
  for (const log of logs) {
    for (const raw of Array.isArray(log) ? log : []) {
      const s = cleanEntry(raw);
      if (s) all.set(`${s.ts}:${s.min}`, s);
    }
  }
  return prune([...all.values()].sort((a, b) => a.ts - b.ts));
}

/** Switch whose log is shown. Signing in for the first time brings this browser's own log along. */
export function useAccount(acct) {
  if (!acct) { save('account', null); return; }
  const prev = logAccount();
  save('account', { email: acct.email, name: acct.name || acct.email, picture: acct.picture || '' });
  if (!prev?.email) {
    const guest = load('log', []);
    if (guest.length) { save(logKey(acct), mergeLogs(load(logKey(acct), []), guest)); save('log', []); }
  }
}

/** Forget an account's local copy (after it's safely in Drive). */
export function dropAccountLog(email) {
  try { localStorage.removeItem(PREFIX + `log:${email}`); } catch { /* ignore */ }
}

export function addSession(min, task) {
  if (min < 0.5) return;
  setLog([...getLog(), { ts: Date.now(), day: dayKey(), min: Math.round(min * 10) / 10, task: task || '' }]);
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
    recent: log.slice(-8).reverse(),
  };
}
