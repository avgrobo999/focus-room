/**
 * Keeps the focus log in the signed-in person's Google Drive, so it follows their
 * Google account to any device rather than staying in one browser.
 *
 * The log lives in the Drive "app data" folder: a hidden folder only this app can
 * see, not the person's files (the app asks for the drive.appdata scope only).
 * There's no server of ours: the browser gets a short-lived access token from
 * Google Identity Services and talks to the Drive API itself.
 *
 * Syncing merges rather than overwrites: the account's log is the union of every
 * device's sessions, so two devices can't wipe out each other's time.
 */
import { GOOGLE_CLIENT_ID, TEST, loadGsi, authConfigured } from './auth.js?v=20261117c';
import { load, save, getLog, setLog, mergeLogs, logAccount, useAccount, dropAccountLog, logEvents } from './store.js?v=20261117c';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SCOPES = `${DRIVE_SCOPE} openid email profile`;
const FILE = 'focus-log.json';
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
let busy = null;

let rev = 0; // bumps whenever a session is saved
// per account: when it last synced, and whether this device has sessions Drive hasn't got yet
const meta = (email = logAccount()?.email) => (email ? load(`logSync:${email}`, {}) : {});
const setMeta = (email, m) => save(`logSync:${email}`, { ...meta(email), ...m });
export const lastSyncAt = () => meta().at || 0;
export const hasUnsynced = () => !!logAccount() && (!meta().at || !!meta().dirty);
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
  async find() {
    const q = encodeURIComponent(`name='${FILE}' and trashed=false`);
    const r = await (await google_(`/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)&pageSize=10`)).json();
    return r.files?.[0]?.id || null;
  },
  async read(id) { return (await google_(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`)).json(); },
  async create(body) {
    const b = `focusroom${Math.random().toString(36).slice(2)}`;
    const data = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: FILE, parents: ['appDataFolder'] })}\r\n`
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
  async find() { return this.db()[tokenEmail] ? `file-${tokenEmail}` : null; },
  async read() { return this.db()[tokenEmail]; },
  async create(body) { const d = this.db(); d[tokenEmail] = body; this.put(d); (window.__syncWrites ||= []).push(body.log.length); return `file-${tokenEmail}`; },
  async update(_id, body) { return this.create(body); },
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
  if (email !== tokenEmail) fileId = null;
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
      for (let pass = 0; pass < 2; pass++) {
        fileId ||= await drive.find();
        const raw = fileId ? (await drive.read(fileId))?.log : [];
        const remote = mergeLogs(raw);
        const startRev = rev;
        const merged = mergeLogs(remote, getLog()); // nothing awaits between reading and saving the local log
        setLog(merged);
        if (JSON.stringify(merged) !== JSON.stringify(raw)) { // new sessions, or junk to clean out
          const body = { v: 1, updated: Date.now(), log: merged };
          if (fileId) await drive.update(fileId, body);
          else fileId = await drive.create(body);
        }
        if (rev === startRev) break; // a session finished while we were uploading: go round once more
      }
      setMeta(tokenEmail, { at: Date.now(), dirty: false });
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
  if (hasUnsynced() && tokenValid()) await syncNow();
  const kept = hasUnsynced(); // never throw away sessions that haven't reached Drive yet
  if (!kept) { dropAccountLog(acct.email); try { localStorage.removeItem(`focusroom:v1:logSync:${acct.email}`); } catch { /* ignore */ } }
  token = null; tokenExp = 0; tokenEmail = null; fileId = null;
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

// signed in already: fetch Google's script now so a later click can open its pop-up straight away
if (logAccount() && !TEST && authConfigured()) loadGsi().catch(() => {});
