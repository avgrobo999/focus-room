/**
 * Study room for up to four people over WebRTC (PeerJS), end-to-end encrypted
 * and signed in with Google.
 *
 *  1. The invite link carries a room code (?) and a 128-bit secret in the
 *     #fragment. The code picks the meeting point on the PeerJS broker; the
 *     secret never leaves the browsers in the room.
 *  2. Every message is an AES-GCM envelope keyed from the secret. A
 *     challenge/response handshake proves the other side holds the key and
 *     is live (not a replay). Sequence numbers block replays inside a session.
 *  3. Both sides of every connection swap Google ID tokens and verify each
 *     other's token in the browser (see auth.js). Only after both checks pass
 *     do timer, status, chat and call messages flow.
 *
 * Whoever arrives first anchors the room and the others connect to them (a
 * star). The anchor verifies each person directly, tells everyone who else is
 * in the room, and forwards messages between them (re-encrypted per link).
 * If the anchor leaves, the others reconnect and one of them takes over.
 */
import { Emitter, uid, netLog, pathOf } from './util.js?v=20261116f';
import { deriveRoomKey, seal, unseal, b64u, randomBytes, sha256hex } from './crypto.js?v=20261116f';

const ID_PREFIX = 'focusroom-v3-'; // + hash(code, secret): the visible code alone can't find or squat the room
export const MAX_PEOPLE = 4;
const HEARTBEAT_MS = 4000;
const DEAD_AFTER_MS = 15000;
const HANDSHAKE_MS = 20000;
const MAX_ENVELOPE = 120000; // chars of ciphertext
const MID_RE = /^[A-Za-z0-9_-]{8,24}$/;
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

/*
 * Relay (TURN) for networks that block direct device-to-device links: Wi-Fi with
 * client isolation, routers without hairpin NAT, strict office/campus networks.
 * Fill in from your Metered dashboard (https://dashboard.metered.ca → TURN Server →
 * credentials). These are visible to anyone who opens the site — that's unavoidable on
 * a static site, so set a monthly usage limit in the dashboard. The relay only ever
 * sees end-to-end-encrypted data and DTLS-SRTP-encrypted audio.
 */
const TURN = { username: '44d43173f63965ee1fbca667', credential: 'NO395cVSy2jZ2Cq8' };

function iceServers() {
  const list = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (TURN.username && TURN.credential) {
    list.push(
      { urls: 'stun:stun.relay.metered.ca:80' },
      {
        urls: [
          'turn:global.relay.metered.ca:80',
          'turn:global.relay.metered.ca:80?transport=tcp',
          'turn:global.relay.metered.ca:443',
          'turns:global.relay.metered.ca:443?transport=tcp',
        ],
        username: TURN.username,
        credential: TURN.credential,
      },
    );
  }
  return list;
}
export const relayConfigured = () => !!(TURN.username && TURN.credential);

export const newRoom = () => ({ code: uid(10), secret: b64u(randomBytes(16)) });

/** accepts a full invite link or "code.secret" */
export function parseInvite(input) {
  const s = String(input || '').trim();
  const m = s.match(/[#&]r=([a-z0-9]{6,16})\.([A-Za-z0-9_-]{20,64})/) || s.match(/^([a-z0-9]{6,16})\.([A-Za-z0-9_-]{20,64})$/);
  return m ? { code: m[1], secret: m[2] } : null;
}

function peerOptions() {
  const opts = { debug: 0, config: { iceServers: iceServers() } };
  if (!IS_LOCAL) return opts; // test hooks never apply on the real site
  const q = new URLSearchParams(location.search);
  if (q.get('peerhost')) {
    opts.host = q.get('peerhost');
    opts.port = Number(q.get('peerport') || 443);
    opts.path = q.get('peerpath') || '/';
    opts.secure = q.get('peersecure') !== '0';
  }
  if (q.get('ice') === 'none') opts.config = { iceServers: [] };
  if (q.get('ice') === 'relay') opts.config = { iceServers: iceServers(), iceTransportPolicy: 'relay' };
  return opts;
}

export const roomSupported = () => typeof window.Peer === 'function' && 'RTCPeerConnection' in window && !!window.crypto?.subtle;

const cleanText = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const PICTURE_RE = /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i;

/** claims about a third person, as reported by the room's anchor */
function cleanClaims(c) {
  if (!c || typeof c !== 'object' || typeof c.sub !== 'string' || !c.sub || c.sub.length > 64) return null;
  const email = cleanText(c.email, 120);
  const picture = cleanText(c.picture, 600);
  return {
    sub: c.sub, email,
    name: cleanText(c.name, 60) || email || 'Friend',
    givenName: cleanText(c.givenName, 40) || cleanText(c.name, 40) || 'Friend',
    picture: PICTURE_RE.test(picture) ? picture : '',
  };
}

function memberId(code) {
  // stable across reloads of this tab, so a refresh replaces our old link instead of filling a seat
  const k = `focusroom:mid:${code}`;
  try {
    const v = sessionStorage.getItem(k);
    if (v && MID_RE.test(v)) return v;
  } catch { /* private mode */ }
  const v = b64u(randomBytes(9));
  try { sessionStorage.setItem(k, v); } catch { /* private mode */ }
  return v;
}

/**
 * events:
 *  state (state, detail)   idle | connecting | waiting | verifying | connected | reconnecting
 *                          | full | denied | badkey | error
 *  member (m, first)       someone is in the room: {mid, sub, email, name, givenName, picture}
 *  member-left (m, reason) they left / dropped ('left' | 'lost' | 'timeout' | …)
 *  need-token ()           our Google token expired mid-session; call setToken()
 *  rejected (reason)       we refused someone (wrong key / failed sign-in check)
 *  message (msg, from)     app-level message from member `from` (only after verification)
 *
 * Members connected to the anchor are verified by our own browser. Members
 * reached through the anchor were verified by the anchor (who we verified).
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
    this.mid = '';
    this.hostMid = '';
    this.peer = null;
    this.sessions = new Set();
    this.members = new Map(); // mid -> member
    this.seen = new Set();    // Google subs seen in this room (for "joined" vs "back")
    this.rtt = 120;
    this.want = false;
    this.fullTries = 0;
    this._hb = null;
    this._timers = new Set();
    addEventListener('pagehide', () => this._sendAll({ t: 'bye' }));
  }

  get connected() { return this.state === 'connected' && this.members.size > 0; }
  get latency() { return Math.min(1500, this.rtt / 2); }
  get friends() { return [...this.members.values()]; }
  get friend() { return this.friends[0] || null; }
  /** ICE servers PeerJS uses (STUN + TURN), for the voice call's own connections */
  get iceConfig() { return this.peer?.options?.config || null; }

  _setState(s, detail) {
    if (this.state === s && detail === undefined) return;
    this.state = s;
    this.stateDetail = detail;
    netLog('room', s, detail || '');
    this.emit('state', s, detail);
  }

  _later(fn, ms) {
    const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms);
    this._timers.add(t);
    return t;
  }

  _clearTimers() { this._timers.forEach(clearTimeout); this._timers.clear(); clearInterval(this._hb); this._hb = null; }

  _live() { return [...this.sessions].filter((s) => s.live); }

  async join(code, secret) {
    if (!roomSupported()) { this._setState('error', 'This browser doesn’t support encrypted rooms.'); return; }
    this.leave(true);
    this.code = code;
    this.secret = secret;
    this.key = await deriveRoomKey(secret, code);
    this.peerId = ID_PREFIX + (await sha256hex(`focusroom-v3-id|${code}|${secret}`)).slice(0, 40);
    this.mid = memberId(code);
    this.want = true;
    this.seen.clear();
    this.fullTries = 0;
    this.linkFails = 0;
    this._setState('connecting');
    this._claim();
  }

  leave(silent = false) {
    this.want = false;
    this._sendAll({ t: 'bye' });
    this._clearTimers();
    this._closeAll();
    this._destroyPeer();
    this.role = null;
    this._dropMembers('left-room');
    if (!silent) {
      this.code = '';
      this.secret = '';
      this.key = null;
      this._setState('idle');
    }
  }

  _closeAll() {
    const all = [...this.sessions];
    this.sessions.clear();
    all.forEach((s) => { try { s.conn.close(); } catch { /* noop */ } });
  }

  _dropMembers(reason) {
    const gone = [...this.members.values()];
    this.members.clear();
    this.hostMid = '';
    gone.forEach((m) => this.emit('member-left', m, reason));
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
      this.hostMid = this.mid;
      if (!this._live().length) this._setState('waiting');
    });
    p.on('connection', (conn) => this._incoming(conn));
    p.on('disconnected', () => {
      netLog('broker disconnected');
      if (this.peer === p && this.want && !p.destroyed) this._later(() => { try { p.reconnect(); } catch { /* noop */ } }, 1500);
    });
    p.on('error', (err) => {
      if (this.peer !== p) return;
      if (err.type === 'unavailable-id') { this._destroyPeer(); this._connectAsGuest(); } else this._peerError(err);
    });
  }

  _connectAsGuest() {
    if (!this.want) return;
    this.role = null;
    const p = new window.Peer(peerOptions());
    this.peer = p;
    p.on('open', () => {
      if (this.peer !== p) return;
      const conn = p.connect(this.peerId, { reliable: true, serialization: 'json' });
      const sess = this._bind(conn, 'guest');
      this._later(() => {
        if (this.sessions.has(sess) && !conn.open) {
          // the room is there but we can't reach it — usually the network blocks direct links
          this.linkFails = (this.linkFails || 0) + 1;
          this.emit('linkfail', this.linkFails);
          netLog('room', 'found the room but the direct link never opened', `#${this.linkFails}`);
          this.sessions.delete(sess);
          try { conn.close(); } catch { /* noop */ }
          this._retry(1500);
        }
      }, 12000);
    });
    p.on('error', (err) => {
      if (this.peer !== p) return;
      if (err.type === 'peer-unavailable') this._retry(300);
      else this._peerError(err);
    });
  }

  _peerError(err) {
    netLog('broker error', err.type);
    console.warn('[room]', err.type, err.message);
    const fatal = ['browser-incompatible', 'ssl-unavailable', 'invalid-id', 'invalid-key'];
    if (fatal.includes(err.type)) { this.want = false; this._setState('error', err.message); return; }
    if (this._live().some((s) => s.conn.open)) return; // broker hiccup while already connected directly
    this._setState(this.seen.size ? 'reconnecting' : 'connecting', navigator.onLine ? 'Trying again…' : 'You’re offline');
    this._retry(4000);
  }

  _retry(ms) {
    if (!this.want) return;
    this._closeAll();
    this._destroyPeer();
    this._later(() => this._claim(), ms);
  }

  _incoming(conn) {
    if (this.role !== 'host') { try { conn.close(); } catch { /* noop */ } return; }
    if (this.sessions.size >= MAX_PEOPLE - 1) {
      // a seat held by a link that has gone quiet (e.g. someone reloading) is freed for the newcomer;
      // a live link that has already proven it holds the key is never displaced
      const stale = [...this.sessions].find((s) => Date.now() - s.lastSeen > HEARTBEAT_MS * 2 && !(s.keyOk && s.conn.open && Date.now() - s.lastSeen < DEAD_AFTER_MS));
      if (stale) this._lost(stale, 'timeout');
    }
    if (this.sessions.size >= MAX_PEOPLE - 1) {
      // room is full — refuse politely (plaintext: the newcomer may not have the key)
      conn.on('open', () => { try { conn.send({ t: 'full' }); } catch { /* noop */ } setTimeout(() => conn.close(), 800); });
      return;
    }
    this._bind(conn, 'host');
  }

  /* ---------- per-connection secure session ---------- */
  _bind(conn, role) {
    const sess = {
      conn, role,                       // role = OUR role on this link
      me: b64u(randomBytes(12)),        // our session id (in envelope + AAD)
      challenge: b64u(randomBytes(16)), // they must echo this back to prove liveness
      out: 0, peer: null, inSeq: -1,
      keyOk: false, authed: false, ready: false, sentAuth: false, live: false, claims: null, mid: '',
      tx: Promise.resolve(), rx: Promise.resolve(),
      // the anchor forwards everyone's traffic, so its link gets a bigger allowance
      bucket: role === 'guest' ? { tokens: 240, max: 240, rate: 100, at: Date.now() } : { tokens: 120, max: 120, rate: 40, at: Date.now() },
      lastSeen: Date.now(),
    };
    this.sessions.add(sess);
    conn.on('open', () => {
      if (!this.sessions.has(sess)) return;
      if (role === 'guest') this.role = 'guest';
      sess.lastSeen = Date.now();
      if (!this.connected) this._setState('verifying');
      this._send(sess, { t: 'hello', challenge: sess.challenge });
      this._startHeartbeat();
      this._later(() => {
        if (this.sessions.has(sess) && !sess.live) this._lost(sess, 'handshake');
      }, HANDSHAKE_MS);
    });
    conn.on('data', (raw) => { sess.rx = sess.rx.then(() => this._data(sess, raw)).catch((e) => console.warn('[room] rx', e)); });
    conn.on('close', () => this._lost(sess, 'closed'));
    conn.on('error', () => this._lost(sess, 'error'));
    return sess;
  }

  _startHeartbeat() {
    if (this._hb) return;
    this._hb = setInterval(() => {
      const now = Date.now();
      for (const s of [...this.sessions]) {
        if (now - s.lastSeen > DEAD_AFTER_MS) this._lost(s, 'timeout');
        else if (s.keyOk) this._send(s, { t: 'ping', ts: now });
      }
    }, HEARTBEAT_MS);
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

  _sendAll(obj) { this.sessions.forEach((s) => { if (s.keyOk) this._send(s, obj); }); }

  _allow(sess) {
    const b = sess.bucket;
    const now = Date.now();
    b.tokens = Math.min(b.max, b.tokens + ((now - b.at) / 1000) * b.rate);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  async _data(sess, raw) {
    if (!this.sessions.has(sess) || !raw || typeof raw !== 'object') return;
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
    if (!this.sessions.has(sess) || !msg || typeof msg !== 'object') return;
    if (!sess.peer) { if (msg.t !== 'hello') return; sess.peer = raw.s; }
    sess.inSeq = raw.n;
    sess.lastSeen = Date.now();

    switch (msg.t) {
      case 'hello':
        if (typeof msg.challenge === 'string' && msg.challenge.length < 64) this._send(sess, { t: 'ack', challenge: msg.challenge });
        return;
      case 'ack':
        if (msg.challenge === sess.challenge && !sess.keyOk) { sess.keyOk = true; this._sendAuth(sess); }
        return;
      case 'auth': {
        if (sess.authed) return;
        let claims;
        try {
          if (typeof msg.mid !== 'string') throw Object.assign(new Error('old-version'), { code: 'old-version' });
          if (!MID_RE.test(msg.mid) || msg.mid === this.mid) throw Object.assign(new Error('malformed'), { code: 'malformed' });
          claims = await this.verifyPeer(msg.token);
        } catch (e) {
          if (!this.sessions.has(sess)) return;
          const code = e.code || 'auth';
          this._send(sess, { t: 'denied', reason: code });
          this.emit('rejected', code);
          if (sess.role === 'guest' && code !== 'keys-unavailable') {
            // we refused the room's anchor: stop here instead of retrying in a loop
            this._later(() => this._stop(sess, 'denied', `peer-${code}`), 600);
          } else this._later(() => this._lost(sess, 'denied'), 600);
          return;
        }
        if (!this.sessions.has(sess)) return;
        // same tab reconnecting (e.g. after a reload): its new link replaces the old one
        const dup = [...this.sessions].find((s) => s !== sess && s.mid === msg.mid);
        if (dup) {
          if (dup.claims?.sub !== claims.sub) { this._send(sess, { t: 'denied', reason: 'duplicate' }); this._later(() => this._lost(sess, 'denied'), 600); return; }
          this._lost(dup, 'replaced');
        }
        sess.claims = claims;
        sess.mid = msg.mid;
        sess.authed = true;
        this._send(sess, { t: 'ready' });
        this._maybeLive(sess);
        return;
      }
      case 'ready': sess.ready = true; this._maybeLive(sess); return;
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
      case 'roster': if (sess.live && sess.role === 'guest') this._roster(msg); return;
      case 'app': if (sess.live) this._app(sess, msg); return;
      default:
    }
  }

  _sendAuth(sess) {
    const token = this.getToken();
    if (!token) { sess.awaitingToken = true; this.emit('need-token'); return; }
    sess.sentAuth = true;
    sess.awaitingToken = false;
    this._send(sess, { t: 'auth', token, mid: this.mid });
  }

  /** provide a fresh Google token (after need-token) */
  setToken() {
    this.sessions.forEach((s) => { if (s.keyOk && (s.awaitingToken || !s.ready)) { s.sentAuth = false; this._sendAuth(s); } });
  }

  /** remove someone (e.g. after locking the room). Without `mid`, everyone we're directly linked to. */
  kick(reason = 'not-allowed', mid) {
    for (const s of [...this.sessions]) {
      if (mid && s.mid !== mid) continue;
      this._send(s, { t: 'denied', reason });
      if (s.role === 'guest') this._later(() => this._stop(s, 'denied', `peer-${reason}`), 600);
      else this._later(() => this._lost(s, 'denied'), 600);
    }
  }

  _stop(sess, state, detail) {
    this.want = false;
    this._clearTimers();
    this._closeAll();
    this._destroyPeer();
    this._dropMembers('stopped');
    this._setState(state, detail);
  }

  _member(sess) { return { mid: sess.mid, ...sess.claims }; }

  _addMember(m) {
    const first = !this.seen.has(m.sub);
    this.seen.add(m.sub);
    this.members.set(m.mid, m);
    this.emit('member', m, first);
  }

  _maybeLive(sess) {
    if (!(sess.keyOk && sess.authed && sess.ready) || sess.live) return;
    sess.live = true;
    this.fullTries = 0;
    this.linkFails = 0;
    const pc = sess.conn.peerConnection;
    if (pc) setTimeout(() => pathOf(pc).then((p) => netLog('room link up', sess.role === 'host' ? 'guest' : 'anchor', (sess.mid || '').slice(0, 4), p)), 500);
    if (sess.role === 'guest') this.hostMid = sess.mid;
    this._setState('connected');
    this._addMember(this._member(sess));
    if (this.role === 'host') this._broadcastRoster();
  }

  /** anchor → each person: everyone else in the room (except the anchor itself, whom they verified directly) */
  _broadcastRoster(left) {
    const live = this._live();
    for (const s of live) {
      const members = live.filter((o) => o !== s).map((o) => this._member(o));
      this._send(s, left ? { t: 'roster', members, left } : { t: 'roster', members });
    }
  }

  _roster(msg) {
    if (!Array.isArray(msg.members)) return;
    const next = new Map();
    for (const raw of msg.members.slice(0, MAX_PEOPLE)) {
      const c = cleanClaims(raw);
      if (!c || typeof raw.mid !== 'string' || !MID_RE.test(raw.mid) || raw.mid === this.mid || raw.mid === this.hostMid) continue;
      next.set(raw.mid, { mid: raw.mid, ...c });
    }
    const leftMid = typeof msg.left?.mid === 'string' ? msg.left.mid : '';
    const leftReason = typeof msg.left?.reason === 'string' ? msg.left.reason.slice(0, 20) : 'left';
    for (const [mid, m] of [...this.members]) {
      if (mid === this.hostMid || next.has(mid)) continue;
      this.members.delete(mid);
      this.emit('member-left', m, mid === leftMid ? leftReason : 'left');
    }
    for (const [mid, m] of next) {
      if (this.members.has(mid)) this.members.set(mid, m);
      else this._addMember(m);
    }
  }

  _app(sess, msg) {
    const m = msg.m;
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;
    const to = typeof msg.to === 'string' ? msg.to : '';
    if (sess.role === 'host') {
      // from a person linked to us; deliver locally and/or forward to the others
      const from = this.members.get(sess.mid);
      if (!from) return;
      if (!to || to === this.mid) this.emit('message', m, from);
      if (to === this.mid) return;
      for (const o of this._live()) {
        if (o === sess || (to && o.mid !== to)) continue;
        this._send(o, to ? { t: 'app', from: sess.mid, to, m } : { t: 'app', from: sess.mid, m });
      }
      return;
    }
    // from the anchor: either theirs or forwarded from someone they verified
    if (to && to !== this.mid) return;
    const fromMid = typeof msg.from === 'string' ? msg.from : '';
    const from = this.members.get(fromMid);
    if (from) this.emit('message', m, from);
  }

  _full() {
    // someone may just be reconnecting from a stale connection: retry a few times first
    this._clearTimers();
    this._closeAll();
    this._destroyPeer();
    if (++this.fullTries <= 6) { this._setState('connecting', 'Room is busy — retrying…'); this._later(() => this._claim(), 5000); return; }
    this.want = false;
    this._setState('full');
  }

  _badKey(sess) { this._stop(sess, 'badkey'); }

  _lost(sess, reason) {
    if (!this.sessions.has(sess)) return;
    netLog('room link lost', `(${sess.role === 'host' ? 'to a guest' : 'to anchor'})`, reason, sess.mid ? sess.mid.slice(0, 4) : '', sess.live ? '' : 'before-ready');
    this.sessions.delete(sess);
    try { sess.conn.close(); } catch { /* noop */ }
    if (!this.want) return;
    if (sess.role === 'host') {
      // one person dropped; the room stays open for everyone else
      if (sess.live && this.members.has(sess.mid)) {
        const m = this.members.get(sess.mid);
        this.members.delete(sess.mid);
        this.emit('member-left', m, reason);
        this._broadcastRoster({ mid: sess.mid, reason: reason === 'left' ? 'left' : 'lost' });
      }
      if (!this._live().length) {
        if (this.peer && !this.peer.destroyed) this._setState('waiting');
        else { this._setState('reconnecting'); this._retry(1200); }
      }
      return;
    }
    // we lost the anchor: everyone else was reached through them
    const anchor = this.hostMid;
    const gone = [...this.members.values()];
    this.members.clear();
    this.hostMid = '';
    gone.forEach((m) => this.emit('member-left', m, m.mid === anchor ? reason : 'lost'));
    this._setState('reconnecting');
    // a little jitter so the people left behind don't all race to become the new anchor at once
    this._retry((reason === 'left' ? 300 : 1200) + Math.random() * 700);
  }

  /** send to everyone in the room, or to one member id */
  send(msg, to) {
    if (!this.connected) return false;
    if (this.role === 'host') {
      const targets = this._live().filter((s) => !to || s.mid === to);
      targets.forEach((s) => this._send(s, to ? { t: 'app', from: this.mid, to, m: msg } : { t: 'app', from: this.mid, m: msg }));
      return targets.length > 0;
    }
    const anchor = this._live().find((s) => s.role === 'guest');
    if (!anchor) return false;
    return this._send(anchor, to ? { t: 'app', to, m: msg } : { t: 'app', m: msg });
  }
}
