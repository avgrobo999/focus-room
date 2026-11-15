/**
 * Two-person study room over WebRTC (PeerJS), end-to-end encrypted and
 * signed in with Google.
 *
 *  1. The invite link carries a room code (?) and a 128-bit secret in the
 *     #fragment. The code picks the meeting point on the PeerJS broker; the
 *     secret never leaves the two browsers.
 *  2. Every message is an AES-GCM envelope keyed from the secret. A
 *     challenge/response handshake proves the other side holds the key and
 *     is live (not a replay). Sequence numbers block replays inside a session.
 *  3. Both sides then swap Google ID tokens and verify each other's token in
 *     the browser (see auth.js). Only after both checks pass do timer, status
 *     and chat messages flow.
 *
 * Whoever arrives first anchors the room; the other connects to them. A third
 * connection is refused while two people are connected.
 */
import { Emitter, uid } from './util.js?v=20261115b';
import { deriveRoomKey, seal, unseal, b64u, randomBytes, sha256hex } from './crypto.js?v=20261115b';

const ID_PREFIX = 'focusroom-v3-'; // + hash(code, secret): the visible code alone can't find or squat the room
const HEARTBEAT_MS = 4000;
const DEAD_AFTER_MS = 15000;
const HANDSHAKE_MS = 20000;
const MAX_ENVELOPE = 120000; // chars of ciphertext
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

export const newRoom = () => ({ code: uid(10), secret: b64u(randomBytes(16)) });

/** accepts a full invite link or "code.secret" */
export function parseInvite(input) {
  const s = String(input || '').trim();
  const m = s.match(/[#&]r=([a-z0-9]{6,16})\.([A-Za-z0-9_-]{20,64})/) || s.match(/^([a-z0-9]{6,16})\.([A-Za-z0-9_-]{20,64})$/);
  return m ? { code: m[1], secret: m[2] } : null;
}

function peerOptions() {
  const opts = { debug: 0 };
  if (!IS_LOCAL) return opts; // test hooks never apply on the real site
  const q = new URLSearchParams(location.search);
  if (q.get('peerhost')) {
    opts.host = q.get('peerhost');
    opts.port = Number(q.get('peerport') || 443);
    opts.path = q.get('peerpath') || '/';
    opts.secure = q.get('peersecure') !== '0';
  }
  if (q.get('ice') === 'none') opts.config = { iceServers: [] };
  return opts;
}

export const roomSupported = () => typeof window.Peer === 'function' && 'RTCPeerConnection' in window && !!window.crypto?.subtle;

/**
 * events:
 *  state (state, detail)   idle | connecting | waiting | verifying | connected | reconnecting
 *                          | full | denied | badkey | error
 *  friend (friend, first)  verified friend {sub, email, name, givenName, picture}
 *  friend-left (reason)
 *  need-token ()           our Google token expired mid-session; call setToken()
 *  rejected (reason)       we refused someone (wrong key / failed sign-in check)
 *  message (msg)           app-level message (only after both sides are verified)
 */
export class Room extends Emitter {
  constructor({ verifyPeer, getToken }) {
    super();
    this.verifyPeer = verifyPeer; // async (token) => claims, throws AuthError
    this.getToken = getToken;     // () => our current ID token or null if expired
    this.state = 'idle';
    this.code = '';
    this.secret = '';
    this.key = null;
    this.role = null;
    this.peer = null;
    this.sess = null;
    this.friend = null;
    this.rtt = 120;
    this.want = false;
    this.fullTries = 0;
    this._timers = new Set();
    addEventListener('pagehide', () => this._sendNow({ t: 'bye' }));
  }

  get connected() { return this.state === 'connected' && !!this.sess?.conn?.open; }
  get latency() { return Math.min(1500, this.rtt / 2); }
  get conn() { return this.sess?.conn || null; }

  _setState(s, detail) {
    if (this.state === s && detail === undefined) return;
    this.state = s;
    this.stateDetail = detail;
    this.emit('state', s, detail);
  }

  _later(fn, ms) {
    const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms);
    this._timers.add(t);
    return t;
  }

  _clearTimers() { this._timers.forEach(clearTimeout); this._timers.clear(); clearInterval(this._hb); }

  async join(code, secret) {
    if (!roomSupported()) { this._setState('error', 'This browser doesn’t support encrypted rooms.'); return; }
    this.leave(true);
    this.code = code;
    this.secret = secret;
    this.key = await deriveRoomKey(secret, code);
    this.peerId = ID_PREFIX + (await sha256hex(`focusroom-v3-id|${code}|${secret}`)).slice(0, 40);
    this.want = true;
    this.friend = null;
    this.fullTries = 0;
    this._setState('connecting');
    this._claim();
  }

  leave(silent = false) {
    this.want = false;
    this._sendNow({ t: 'bye' });
    this._clearTimers();
    const s = this.sess;
    this.sess = null;
    try { s?.conn.close(); } catch { /* noop */ }
    this._destroyPeer();
    this.role = null;
    if (!silent) {
      this.friend = null;
      this.code = '';
      this.secret = '';
      this.key = null;
      this._setState('idle');
    }
  }

  _destroyPeer() {
    if (this.peer) {
      const p = this.peer;
      this.peer = null;
      try { p.destroy(); } catch { /* noop */ }
    }
  }

  _claim() {
    if (!this.want) return;
    this._destroyPeer();
    const p = new window.Peer(this.peerId, peerOptions());
    this.peer = p;
    p.on('open', () => {
      if (this.peer !== p) return;
      this.role = 'host';
      if (!this.sess) this._setState('waiting');
    });
    p.on('connection', (conn) => this._incoming(conn));
    p.on('disconnected', () => {
      if (this.peer === p && this.want && !p.destroyed) this._later(() => { try { p.reconnect(); } catch { /* noop */ } }, 1500);
    });
    p.on('error', (err) => {
      if (this.peer !== p) return;
      if (err.type === 'unavailable-id') { this._destroyPeer(); this._connectAsGuest(); } else this._peerError(err);
    });
  }

  _connectAsGuest() {
    if (!this.want) return;
    const p = new window.Peer(peerOptions());
    this.peer = p;
    p.on('open', () => {
      if (this.peer !== p) return;
      const conn = p.connect(this.peerId, { reliable: true, serialization: 'json' });
      this._bind(conn, 'guest');
      this._later(() => {
        if (this.sess?.conn === conn && !conn.open) { try { conn.close(); } catch { /* noop */ } this.sess = null; this._retry(1500); }
      }, 12000);
    });
    p.on('error', (err) => {
      if (this.peer !== p) return;
      if (err.type === 'peer-unavailable') this._retry(300);
      else this._peerError(err);
    });
  }

  _peerError(err) {
    console.warn('[room]', err.type, err.message);
    const fatal = ['browser-incompatible', 'ssl-unavailable', 'invalid-id', 'invalid-key'];
    if (fatal.includes(err.type)) { this.want = false; this._setState('error', err.message); return; }
    if (this.sess?.conn?.open) return; // broker hiccup while already connected directly
    this._setState(this.friend ? 'reconnecting' : 'connecting', navigator.onLine ? 'Trying again…' : 'You’re offline');
    this._retry(4000);
  }

  _retry(ms) {
    if (!this.want) return;
    this._destroyPeer();
    this._later(() => this._claim(), ms);
  }

  _incoming(conn) {
    // keep a connected friend, or one who has already proven they hold the key
    if (this.connected || (this.sess?.keyOk && this.sess.conn.open)) {
      // two people already here — refuse politely (plaintext: the newcomer may not have the key)
      conn.on('open', () => { try { conn.send({ t: 'full' }); } catch { /* noop */ } setTimeout(() => conn.close(), 800); });
      return;
    }
    if (this.sess) { const old = this.sess; this.sess = null; try { old.conn.close(); } catch { /* noop */ } }
    this._bind(conn, 'host');
  }

  /* ---------- per-connection secure session ---------- */
  _bind(conn, role) {
    const sess = {
      conn, role,
      me: b64u(randomBytes(12)),        // our session id (in envelope + AAD)
      challenge: b64u(randomBytes(16)), // they must echo this back to prove liveness
      out: 0, peer: null, inSeq: -1,
      keyOk: false, authed: false, ready: false, sentAuth: false, claims: null,
      tx: Promise.resolve(), rx: Promise.resolve(),
      bucket: { tokens: 60, at: Date.now() },
    };
    this.sess = sess;
    conn.on('open', () => {
      if (this.sess !== sess) return;
      this.role = role;
      this.lastSeen = Date.now();
      this._setState('verifying');
      this._send(sess, { t: 'hello', challenge: sess.challenge });
      clearInterval(this._hb);
      this._hb = setInterval(() => {
        if (this.sess !== sess) return;
        if (Date.now() - this.lastSeen > DEAD_AFTER_MS) this._lost(sess, 'timeout');
        else if (sess.keyOk) this._send(sess, { t: 'ping', ts: Date.now() });
      }, HEARTBEAT_MS);
      this._later(() => {
        if (this.sess === sess && this.state !== 'connected') this._lost(sess, 'handshake');
      }, HANDSHAKE_MS);
    });
    conn.on('data', (raw) => { sess.rx = sess.rx.then(() => this._data(sess, raw)).catch((e) => console.warn('[room] rx', e)); });
    conn.on('close', () => this._lost(sess, 'closed'));
    conn.on('error', () => this._lost(sess, 'error'));
  }

  _aad(sender, n) { return `${this.code}|${sender}|${n}`; }

  _send(sess, obj) {
    if (!sess?.conn?.open || !this.key) return false;
    const n = sess.out++;
    const key = this.key;
    sess.tx = sess.tx.then(async () => {
      const box = await seal(key, obj, this._aad(sess.me, n));
      if (sess.conn.open) sess.conn.send({ v: 2, s: sess.me, n, iv: box.iv, ct: box.ct });
    }).catch((e) => console.warn('[room] tx', e));
    return true;
  }

  _sendNow(obj) { if (this.sess?.keyOk) this._send(this.sess, obj); }

  _allow(sess) {
    // token bucket: ~25 msgs/s sustained, bursts of 60
    const b = sess.bucket;
    const now = Date.now();
    b.tokens = Math.min(60, b.tokens + ((now - b.at) / 1000) * 25);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  async _data(sess, raw) {
    if (this.sess !== sess || !raw || typeof raw !== 'object') return;
    // The only plaintext we ever act on: "room full", and only before the secure handshake.
    if (raw.t === 'full' && !sess.keyOk && sess.role === 'guest') { this._full(); return; }
    if (raw.t === 'nokey' && !sess.keyOk) { // only a joiner gives up; the room's anchor just drops that visitor
      if (sess.role === 'guest') this._badKey(sess); else this._lost(sess, 'badkey');
      return;
    }
    if (raw.v !== 2 || typeof raw.s !== 'string' || raw.s.length > 32 || !Number.isSafeInteger(raw.n) || raw.n < 0
      || typeof raw.iv !== 'string' || raw.iv.length > 32 || typeof raw.ct !== 'string' || raw.ct.length > MAX_ENVELOPE) return;
    if (sess.peer ? raw.s !== sess.peer : raw.n !== 0) return; // other sessions / out-of-order first message
    if (raw.n <= sess.inSeq) return;                         // replay
    if (sess.keyOk && !this._allow(sess)) return;            // flood
    let msg;
    try { msg = await unseal(this.key, raw, this._aad(raw.s, raw.n)); } catch {
      if (!sess.peer) { // first message didn't decrypt → they don't have this room's key
        try { sess.conn.send({ t: 'nokey' }); } catch { /* noop */ }
        this.emit('rejected', 'badkey');
        if (sess.role === 'guest') this._badKey(sess); else setTimeout(() => this._lost(sess, 'badkey'), 300);
      }
      return;
    }
    if (this.sess !== sess || !msg || typeof msg !== 'object') return;
    if (!sess.peer) { if (msg.t !== 'hello') return; sess.peer = raw.s; }
    sess.inSeq = raw.n;
    this.lastSeen = Date.now();

    switch (msg.t) {
      case 'hello':
        if (typeof msg.challenge === 'string' && msg.challenge.length < 64) this._send(sess, { t: 'ack', challenge: msg.challenge });
        return;
      case 'ack':
        if (msg.challenge === sess.challenge && !sess.keyOk) { sess.keyOk = true; this._sendAuth(sess); }
        return;
      case 'auth': {
        if (sess.authed) return;
        try {
          sess.claims = await this.verifyPeer(msg.token);
        } catch (e) {
          if (this.sess !== sess) return;
          const code = e.code || 'auth';
          this._send(sess, { t: 'denied', reason: code });
          this.emit('rejected', code);
          if (sess.role === 'guest' && code !== 'keys-unavailable') {
            // we refused the room's anchor: stop here instead of retrying in a loop
            this._later(() => this._stop(sess, 'denied', `peer-${code}`), 600);
          } else this._later(() => this._lost(sess, 'denied'), 600);
          return;
        }
        if (this.sess !== sess) return;
        sess.authed = true;
        this._send(sess, { t: 'ready' });
        this._maybeConnected(sess);
        return;
      }
      case 'ready': sess.ready = true; this._maybeConnected(sess); return;
      case 'denied': {
        const reason = typeof msg.reason === 'string' ? msg.reason.slice(0, 40) : 'auth';
        if (reason === 'expired') { this.emit('need-token'); return; } // re-sign-in, then setToken() resends
        if (sess.role === 'host') { this.emit('rejected', `by-peer-${reason}`); this._lost(sess, 'denied'); return; } // keep our room open
        this._stop(sess, 'denied', reason);
        return;
      }
      case 'ping': if (typeof msg.ts === 'number') this._send(sess, { t: 'pong', ts: msg.ts }); return;
      case 'pong': {
        const rtt = Date.now() - msg.ts;
        if (rtt >= 0 && rtt < 10000) this.rtt = this.rtt * 0.6 + rtt * 0.4;
        return;
      }
      case 'bye': this._lost(sess, 'left'); return;
      default:
        if (this.state === 'connected') this.emit('message', msg);
    }
  }

  _sendAuth(sess) {
    const token = this.getToken();
    if (!token) { sess.awaitingToken = true; this.emit('need-token'); return; }
    sess.sentAuth = true;
    sess.awaitingToken = false;
    this._send(sess, { t: 'auth', token });
  }

  /** provide a fresh Google token (after need-token) */
  setToken() {
    const s = this.sess;
    if (s?.keyOk && (s.awaitingToken || !s.ready)) { s.sentAuth = false; this._sendAuth(s); }
  }

  /** remove the current friend (e.g. after locking the room to someone else) */
  kick(reason = 'not-allowed') {
    const s = this.sess;
    if (!s) return;
    this._send(s, { t: 'denied', reason });
    if (s.role === 'guest') this._later(() => this._stop(s, 'denied', `peer-${reason}`), 600);
    else this._later(() => this._lost(s, 'denied'), 600);
  }

  _stop(sess, state, detail) {
    this.want = false;
    this._clearTimers();
    if (this.sess === sess) this.sess = null;
    try { sess.conn.close(); } catch { /* noop */ }
    this._destroyPeer();
    this._setState(state, detail);
  }

  _maybeConnected(sess) {
    if (!(sess.keyOk && sess.authed && sess.ready) || this.state === 'connected') return;
    const c = sess.claims;
    const first = !this.friend || this.friend.sub !== c.sub;
    this.friend = { ...c };
    this.fullTries = 0;
    this._setState('connected');
    this.emit('friend', this.friend, first);
  }

  _full() {
    // the other person may just be reconnecting from a stale connection: retry a few times first
    this._clearTimers();
    this.sess = null;
    this._destroyPeer();
    if (++this.fullTries <= 6) { this._setState('connecting', 'Room is busy — retrying…'); this._later(() => this._claim(), 5000); return; }
    this.want = false;
    this._setState('full');
  }

  _badKey(sess) { this._stop(sess, 'badkey'); }

  _lost(sess, reason) {
    if (sess !== this.sess) return;
    this.sess = null;
    clearInterval(this._hb);
    try { sess.conn.close(); } catch { /* noop */ }
    if (!this.want) return;
    if (sess.authed) this.emit('friend-left', reason);
    if (this.role === 'host' && this.peer && !this.peer.destroyed) this._setState('waiting');
    else { this._setState('reconnecting'); this._retry(reason === 'left' ? 400 : 1200); }
  }

  send(msg) { return this.connected ? this._send(this.sess, msg) : false; }
}
