/**
 * Keeps the focus log, the task list, the timer (its settings and where it's up to) and water
 * drunk in the signed-in person's Google Drive, so they follow their Google account to any
 * device rather than staying in one browser. The same account signs them in to study rooms.
 *
 * They live in the Drive "app data" folder: a hidden folder only this app can
 * see, not the person's files (the app asks for the drive.appdata scope only).
 * There's no server of ours: the browser gets a short-lived access token from
 * Google Identity Services and talks to the Drive API itself.
 *
 * Syncing merges rather than overwrites: the account's log is the union of every
 * device's sessions, so two devices can't wipe out each other's time, and task lists are
 * merged task by task (see mergeTasks). The timer goes to whichever device you last touched
 * it on; water goes day by day to the newest count. Timer runs carry an id, so a session shown
 * on two of your devices at once is logged once.
 */
import { GOOGLE_CLIENT_ID, TEST, loadGsi, authConfigured } from './auth.js?v=20261121e';
import { load, save, getLog, setLog, mergeLogs, logAccount, useAccount, dropAccountLog, logEvents, getTaskState, setTaskState, mergeTasks, taskEvents, waterEvents, waterRecord, applyWater, cleanWater } from './store.js?v=20261121e';
import { dayKey } from './util.js?v=20261121e';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SCOPES = `${DRIVE_SCOPE} openid email profile`;
const FILE = 'focus-log.json';
const TASK_FILE = 'tasks.json'; // a file of its own, so older copies of the app that only know the log leave it alone
const STATE_FILE = 'state.json'; // the timer (its settings and where it's up to) and water drunk per day
const WATER_DAYS = 30;
const API = 'https://www.googleapis.com';

export class SyncError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

export const syncEvents = new EventTarget(); // 'change' whenever status or the log changes
export const syncStatus = { state: 'idle', error: '' }; // idle | syncing | error

let token = null;
let tokenExp = 0;
let tokenEmail = null;
let fileId = null;
let taskFileId = null;
let busy = null;

let stateFileId = null;

let rev = 0; // bumps whenever a session is saved
let taskRev = 0; // ...and whenever the tasks change
let stateRev = 0; // ...and the timer or the water

/* ---------- the timer and water, shared between your devices ---------- */
// The app tells us how to read and set its timer. 'timerAt' is when you last touched the
// timer on this device; the newest touch on any device wins.
let timerHooks = null;
/** hooks: {get: () => ({settings, state}), apply: ({settings, state}) => void} */
export function registerTimerSync(hooks) { timerHooks = hooks; }
/** call when you change the timer here (start, pause, a new length, its settings...) */
export function timerTouched() {
  save('timerAt', Math.max(Date.now(), (load('timerAt', 0) || 0) + 1));
  stateChanged();
}
function cleanDays(days) {
  const out = {};
  const cutoff = dayKey(new Date(Date.now() - WATER_DAYS * 864e5));
  for (const [day, w] of Object.entries(days && typeof days === 'object' ? days : {})) {
    const c = cleanWater({ ...w, day });
    if (c && day >= cutoff) out[day] = { n: c.n, ml: c.ml, at: c.at };
  }
  return out;
}
/** merge what Drive has with this device; returns the body Drive should hold */
function mergeState(raw) {
  const out = { v: 1 };
  // timer: the newer side wins outright
  const rt = raw?.timer && typeof raw.timer === 'object' && Number.isFinite(raw.timer.at) ? raw.timer : null;
  const localAt = load('timerAt', 0) || 0;
  if (rt && rt.at > localAt && timerHooks) {
    save('timerAt', rt.at);
    try { timerHooks.apply(rt); } catch (e) { console.warn('timer from another device', e); }
    out.timer = rt;
  } else if (rt && rt.at === localAt) out.timer = rt; // Drive has our last change already
  else if (timerHooks && localAt) out.timer = { at: localAt, ...timerHooks.get() };
  else if (rt) out.timer = rt;
  // water: day by day, the newer count wins
  const days = cleanDays(raw?.water?.days);
  const mine = waterRecord();
  const theirs = days[dayKey()];
  if (theirs && applyWater({ ...theirs, day: dayKey() })) { /* took theirs */ } else if (mine && (!theirs || mine.at > theirs.at)) days[mine.day] = { n: mine.n, ml: mine.ml, at: mine.at };
  out.water = { days };
  return out;
}
let stateTimer = 0;
function stateChanged() {
  stateRev++;
  const acct = logAccount();
  if (!acct) return;
  if (!meta(acct.email).stateDirty) setMeta(acct.email, { stateDirty: true });
  if (!tokenValid()) return;
  clearTimeout(stateTimer);
  stateTimer = setTimeout(async () => { if (busy) await busy; if (tokenValid()) syncNow(); }, 1500);
}
waterEvents.addEventListener('change', (e) => { if (e.detail?.local !== false) stateChanged(); });
// per account: when it last synced, and whether this device has sessions or task changes Drive hasn't got yet
const meta = (email = logAccount()?.email) => (email ? load(`logSync:${email}`, {}) : {});
const setMeta = (email, m) => save(`logSync:${email}`, { ...meta(email), ...m });
export const lastSyncAt = () => meta().at || 0;
// tasksDirty: 'edit' for changed tasks, 'time' when only focus time on them has gone up
// (that alone isn't worth opening Google's pop-up for; it goes up with the next sync)
export const hasUnsynced = () => !!logAccount() && (!meta().at || !!meta().dirty || meta().tasksDirty === 'edit');
const anyUnsynced = () => hasUnsynced() || (!!logAccount() && !!meta().tasksDirty);
export const syncAvailable = () => authConfigured() && typeof fetch === 'function';
const tokenValid = () => !!token && Date.now() < tokenExp - 60e3;

function emit(state, error = '') {
  syncStatus.state = state;
  syncStatus.error = error;
  syncEvents.dispatchEvent(new Event('change'));
}

/* ---------- Google: access token and who it belongs to ---------- */
function requestToken(hint) {
  if (TEST) return mock.token(hint);
  return loadGsi().then(() => new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      login_hint: hint || undefined,
      prompt: hint ? '' : 'select_account',
      callback: (r) => {
        if (r.error) return reject(new SyncError(r.error, r.error_description || 'Google didn’t allow access'));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
          return reject(new SyncError('no-drive', 'Tick the box to let focusroom keep its data in your Google Drive, then try again'));
        }
        resolve({ access_token: r.access_token, expires_in: Number(r.expires_in) || 3599 });
      },
      error_callback: (e) => reject(new SyncError(e?.type === 'popup_closed' ? 'cancelled' : (e?.type || 'popup'),
        e?.type === 'popup_failed_to_open' ? 'Your browser blocked the Google pop-up' : 'Sign-in was cancelled')),
    });
    client.requestAccessToken();
  }));
}

async function google_(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts, credentials: 'omit', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...opts.headers },
  });
  if (res.status === 401) { token = null; throw new SyncError('auth', 'Google sign-in expired, try again'); }
  if (!res.ok) {
    let reason = '';
    try { reason = (await res.json()).error?.errors?.[0]?.reason || ''; } catch { /* not json */ }
    if (reason === 'accessNotConfigured') throw new SyncError('drive-off', 'Google Drive isn’t switched on for this app yet');
    throw new SyncError('http', `Google Drive answered ${res.status}${reason ? ` (${reason})` : ''}`);
  }
  return res;
}

const real = {
  token: requestToken,
  async me() { return (await google_('/oauth2/v3/userinfo')).json(); },
  async find(name) {
    const q = encodeURIComponent(`name='${name}' and trashed=false`);
    const r = await (await google_(`/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)&pageSize=10`)).json();
    return r.files?.[0]?.id || null;
  },
  async read(id) { return (await google_(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`)).json(); },
  async create(name, body) {
    const b = `focusroom${Math.random().toString(36).slice(2)}`;
    const data = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n`
      + `--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}\r\n--${b}--`;
    const r = await google_('/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body: data,
    });
    return (await r.json()).id;
  },
  async update(id, body) {
    await google_(`/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  },
};

// Local automated tests only (localhost + ?authtest=1): a pretend Google account and Drive,
// kept outside the app's own storage so clearing the app's data acts like a second device.
const mock = {
  db: () => JSON.parse(localStorage.getItem('__mockDrive') || '{}'),
  put(d) { localStorage.setItem('__mockDrive', JSON.stringify(d)); },
  user: () => window.__syncTestUser || { email: 'tester@example.com', name: 'Test Person' },
  async token() {
    if (window.__syncTestFail) throw new SyncError(window.__syncTestFail, 'test failure');
    return { access_token: `mock-${this.user().email}`, expires_in: window.__syncTestTtl ?? 3599 };
  },
  async me() { return { email_verified: true, ...this.user() }; },
  async find(name) { const id = `${tokenEmail}/${name}`; return this.db()[id] ? id : null; },
  async read(id) { return this.db()[id]; },
  async create(name, body) {
    const id = `${tokenEmail}/${name}`;
    const d = this.db(); d[id] = body; this.put(d);
    (window.__syncWrites ||= []).push(name === FILE ? body.log.length : name === TASK_FILE ? `tasks:${body.tasks.length}` : `state:${body.timer?.at || 0}`);
    return id;
  },
  async update(id, body) { return this.create(id.slice(id.indexOf('/') + 1), body); },
};
const drive = TEST ? mock : real;

async function ensureToken(interactive) {
  if (tokenValid()) return true;
  if (!interactive) return false;
  const acct = logAccount();
  const r = await drive.token(acct?.email);
  token = r.access_token;
  tokenExp = Date.now() + r.expires_in * 1000;
  const me = await drive.me();
  if (!me?.email || me.email_verified === false) throw new SyncError('no-email', 'Couldn’t read your Google account’s email');
  const email = String(me.email).toLowerCase();
  if (email !== tokenEmail) { fileId = null; taskFileId = null; stateFileId = null; }
  tokenEmail = email;
  // picked a different account in the Google pop-up: switch to that account's log
  if (email !== acct?.email) useAccount({ email, name: String(me.name || email).slice(0, 60), picture: me.picture || '' });
  return true;
}

/**
 * Pull the account's log from Drive, merge it with this device's, and push back anything new.
 * interactive: allowed to open Google's pop-up (only from a click).
 * Resolves true once synced, false if it needs a click first.
 */
export function syncNow({ interactive = false } = {}) {
  if (busy) return busy;
  busy = (async () => {
    try {
      if (!syncAvailable()) throw new SyncError('unconfigured', 'Google sign-in isn’t set up for this copy of focusroom');
      if (!logAccount() && !interactive) return false;
      emit('syncing');
      if (!(await ensureToken(interactive))) { emit('idle'); return false; }
      let logDone = false, tasksDone = false, stateDone = false;
      for (let pass = 0; pass < 2 && !(logDone && tasksDone && stateDone); pass++) {
        if (!logDone) {
          fileId ||= await drive.find(FILE);
          const raw = fileId ? (await drive.read(fileId))?.log : [];
          const remote = mergeLogs(raw);
          const startRev = rev;
          const merged = mergeLogs(remote, getLog()); // nothing awaits between reading and saving the local log
          setLog(merged);
          if (JSON.stringify(merged) !== JSON.stringify(raw)) { // new sessions, or junk to clean out
            const body = { v: 1, updated: Date.now(), log: merged };
            if (fileId) await drive.update(fileId, body);
            else fileId = await drive.create(FILE, body);
          }
          logDone = rev === startRev; // a session finished while we were uploading: go round once more
        }
        if (!tasksDone) {
          taskFileId ||= await drive.find(TASK_FILE);
          const raw = taskFileId ? await drive.read(taskFileId) : null;
          const remote = mergeTasks(raw, null);
          const startRev = taskRev;
          const merged = mergeTasks(remote, getTaskState()); // again nothing awaits between reading and saving
          setTaskState(merged);
          if (!raw || JSON.stringify(merged) !== JSON.stringify(remote) || raw.v !== 1) {
            const body = { v: 1, updated: Date.now(), ...merged };
            if (taskFileId) await drive.update(taskFileId, body);
            else taskFileId = await drive.create(TASK_FILE, body);
          }
          tasksDone = taskRev === startRev;
        }
        if (!stateDone) {
          stateFileId ||= await drive.find(STATE_FILE);
          const raw = stateFileId ? await drive.read(stateFileId) : null;
          const startRev = stateRev;
          const merged = mergeState(raw); // may set the timer and water here; nothing awaits in between
          const was = raw ? JSON.stringify({ v: raw.v, timer: raw.timer, water: { days: cleanDays(raw.water?.days) } }) : '';
          if (JSON.stringify(merged) !== was) {
            const body = { ...merged, updated: Date.now() };
            if (stateFileId) await drive.update(stateFileId, body);
            else stateFileId = await drive.create(STATE_FILE, body);
          }
          stateDone = stateRev === startRev;
        }
      }
      setMeta(tokenEmail, { at: Date.now(), ...(logDone ? { dirty: false } : {}), ...(tasksDone ? { tasksDirty: false } : {}), ...(stateDone ? { stateDirty: false } : {}) });
      emit('idle');
      return true;
    } catch (e) {
      if (e?.code === 'cancelled') { emit('idle'); return false; }
      console.warn('sync failed', e);
      emit('error', e?.message || 'Sync failed');
      return false;
    } finally {
      busy = null;
    }
  })();
  return busy;
}

/** Sign in with Google to keep the focus log in that account (from a click). */
export async function signInSync() {
  const ok = await syncNow({ interactive: true });
  syncEvents.dispatchEvent(new Event('change'));
  return ok;
}

/** Stop syncing on this device. The account's log stays safe in Drive. */
export async function signOutSync() {
  const acct = logAccount();
  if (!acct) return { kept: false };
  if (anyUnsynced() && tokenValid()) await syncNow();
  const kept = anyUnsynced(); // never throw away sessions or tasks that haven't reached Drive yet
  if (!kept) { dropAccountLog(acct.email); try { localStorage.removeItem(`focusroom:v1:logSync:${acct.email}`); } catch { /* ignore */ } }
  token = null; tokenExp = 0; tokenEmail = null; fileId = null; taskFileId = null; stateFileId = null;
  useAccount(null);
  emit('idle');
  return { kept };
}

// a finished session goes up straight away while the token lasts, otherwise on the next sync
logEvents.addEventListener('added', () => {
  rev++;
  const acct = logAccount();
  if (!acct) return;
  setMeta(acct.email, { dirty: true });
  syncEvents.dispatchEvent(new Event('change'));
  if (tokenValid()) syncNow();
});

// task edits go up a moment later (so a burst of them is one upload); time ticking up on a
// task rides along with the next sync
let taskTimer = 0;
taskEvents.addEventListener('saved', (e) => {
  taskRev++;
  const acct = logAccount();
  if (!acct) return;
  const was = meta(acct.email).tasksDirty;
  const now = e.detail?.edit || was === 'edit' ? 'edit' : 'time';
  if (now !== was) { setMeta(acct.email, { tasksDirty: now }); syncEvents.dispatchEvent(new Event('change')); }
  if (!e.detail?.edit || !tokenValid()) return;
  clearTimeout(taskTimer);
  taskTimer = setTimeout(async () => { if (busy) await busy; if (tokenValid()) syncNow(); }, 2500);
});

/**
 * Signed in to a study room with Google: that account is the one everything syncs to.
 * Switching account here starts on that account's data; Drive catches up on the next sync
 * (which needs a click, as Google's room sign-in can't hand out Drive access).
 */
export function adoptAccount(profile) {
  const email = String(profile?.email || '').toLowerCase();
  if (!email || logAccount()?.email === email) return false;
  token = null; tokenExp = 0; tokenEmail = null; fileId = null; taskFileId = null; stateFileId = null;
  useAccount({ email, name: String(profile.name || email).slice(0, 60), picture: profile.picture || '' });
  emit('idle');
  return true;
}

// while Google's access lasts, look for changes from your other devices every so often,
// and as soon as you come back to this tab
const pollIfLive = () => { if (tokenValid() && logAccount() && document.visibilityState === 'visible') syncNow(); };
setInterval(pollIfLive, 45e3);
document.addEventListener('visibilitychange', pollIfLive);

// signed in already: fetch Google's script now so a later click can open its pop-up straight away
if (logAccount() && !TEST && authConfigured()) loadGsi().catch(() => {});
