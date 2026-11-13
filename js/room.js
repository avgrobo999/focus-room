/**
 * Two-person study room over WebRTC (PeerJS). No backend of our own: the public
 * PeerJS broker only introduces the two browsers; after that, everything —
 * timer sync, status, chat — flows directly peer-to-peer.
 *
 * Symmetric design: the room code maps to a fixed peer id. Whoever arrives
 * first "claims" it and waits; the second person connects to it. If the claimer
 * leaves, the other person re-claims it, so either friend can drop and rejoin.
 * A third visitor is turned away with a "room full" message.
 */
import { Emitter, uid } from './util.js';

const ID_PREFIX = 'focusroom-v1-';
const HEARTBEAT_MS = 4000;
const DEAD_AFTER_MS = 15000;

export const newRoomCode = () => uid(6);

export function parseRoomCode(input) {
  if (!input) return '';
  let s = String(input).trim();
  try {
    if (/^https?:/i.test(s)) s = new URL(s).searchParams.get('room') || '';
  } catch { /* not a url */ }
  return s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
}

function peerOptions() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: Number(q.get('peerdebug') || 0), config: undefined };
  // Test hooks: point at a self-hosted PeerJS server, e.g. ?peerhost=localhost&peerport=9000&peerpath=/fr&peersecure=0
  if (q.get('peerhost')) {
    opts.host = q.get('peerhost');
    opts.port = Number(q.get('peerport') || 443);
    opts.path = q.get('peerpath') || '/';
    opts.secure = q.get('peersecure') !== '0';
  }
  if (q.get('ice') === 'none') opts.config = { iceServers: [] };
  if (!opts.config) delete opts.config;
  return opts;
}

export const roomSupported = () => typeof window.Peer === 'function' && 'RTCPeerConnection' in window;

/**
 * events:
 *  state (state, detail)      idle | connecting | waiting | connected | reconnecting | full | error
 *  friend (friend)            hello received / updated
 *  friend-left (reason)
 *  message (msg)              any app-level message
 */
export class Room extends Emitter {
  constructor({ clientId, hello }) {
    super();
    this.clientId = clientId;
    this.hello = hello; // () => ({name, color})
    this.state = 'idle';
    this.code = '';
    this.role = null;
    this.peer = null;
    this.conn = null;
    this.friend = null;
    this.rtt = 120;
    this.want = false;
    this._timers = new Set();
    addEventListener('pagehide', () => this._sendRaw({ t: 'bye' }));
  }

  get connected() { return this.state === 'connected' && this.conn?.open; }
  get latency() { return Math.min(1500, this.rtt / 2); }

  _setState(s, detail) {
    if (this.state === s && !detail) return;
    this.state = s;
    this.emit('state', s, detail);
  }

  _later(fn, ms) {
    const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms);
    this._timers.add(t);
    return t;
  }

  _clearTimers() { this._timers.forEach(clearTimeout); this._timers.clear(); clearInterval(this._hb); }

  join(code) {
    if (!roomSupported()) { this._setState('error', 'This browser doesn’t support peer-to-peer rooms.'); return; }
    this.leave(true);
    this.code = code;
    this.want = true;
    this.friend = null;
    this._setState('connecting');
    this._claim();
  }

  leave(silent = false) {
    this.want = false;
    this._sendRaw({ t: 'bye' });
    this._clearTimers();
    try { this.conn?.close(); } catch { /* noop */ }
    this.conn = null;
    this._destroyPeer();
    this.role = null;
    if (!silent) {
      this.friend = null;
      this.code = '';
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

  /** try to become the room's anchor peer */
  _claim() {
    if (!this.want) return;
    this._destroyPeer();
    const p = new window.Peer(ID_PREFIX + this.code, peerOptions());
    this.peer = p;
    p.on('open', () => {
      if (this.peer !== p) return;
      this.role = 'host';
      if (!this.conn) this._setState('waiting');
    });
    p.on('connection', (conn) => this._incoming(conn));
    p.on('disconnected', () => {
      // lost the broker (not the friend). Reconnect so the room code stays reachable.
      if (this.peer === p && this.want && !p.destroyed) this._later(() => { try { p.reconnect(); } catch { /* noop */ } }, 1500);
    });
    p.on('error', (err) => {
      if (this.peer !== p) return;
      if (err.type === 'unavailable-id') {
        // someone (hopefully our friend) holds the room — connect to them
        this._destroyPeer();
        this._connectAsGuest();
      } else this._peerError(err);
    });
  }

  _connectAsGuest() {
    if (!this.want) return;
    const p = new window.Peer(peerOptions());
    this.peer = p;
    p.on('open', () => {
      if (this.peer !== p) return;
      const conn = p.connect(ID_PREFIX + this.code, {
        reliable: true, serialization: 'json',
        metadata: { clientId: this.clientId },
      });
      this._bind(conn, 'guest');
      this._later(() => {
        if (this.conn === conn && !conn.open) { // never opened (host unreachable)
          try { conn.close(); } catch { /* noop */ }
          this.conn = null;
          this._retry(1500);
        }
      }, 12000);
    });
    p.on('error', (err) => {
      if (this.peer !== p) return;
      if (err.type === 'peer-unavailable') this._retry(300); // room is empty now — claim it
      else this._peerError(err);
    });
  }

  _peerError(err) {
    console.warn('[room]', err.type, err.message);
    const fatal = ['browser-incompatible', 'ssl-unavailable', 'invalid-id', 'invalid-key'];
    if (fatal.includes(err.type)) { this.want = false; this._setState('error', err.message); return; }
    if (this.conn?.open) return; // broker hiccup while we're already talking directly — ignore
    this._setState(this.friend ? 'reconnecting' : 'connecting', navigator.onLine ? 'Trying again…' : 'You’re offline');
    this._retry(4000);
  }

  _retry(ms) {
    if (!this.want) return;
    this._destroyPeer();
    this._later(() => this._claim(), ms);
  }

  _incoming(conn) {
    const meta = conn.metadata || {};
    if (this.conn?.open && this.friend && meta.clientId !== this.friend.clientId) {
      conn.on('open', () => { try { conn.send({ t: 'full' }); } catch { /* noop */ } setTimeout(() => conn.close(), 800); });
      return;
    }
    if (this.conn && this.conn !== conn) { const old = this.conn; this.conn = null; try { old.close(); } catch { /* noop */ } }
    this._bind(conn, 'host');
  }

  _bind(conn, role) {
    this.conn = conn;
    conn.on('open', () => {
      if (this.conn !== conn) return;
      this.role = role;
      this.lastSeen = Date.now();
      this._sendRaw({ t: 'hello', clientId: this.clientId, v: 1, ...this.hello() });
      this._ping();
      clearInterval(this._hb);
      this._hb = setInterval(() => {
        if (this.conn !== conn) return;
        if (Date.now() - this.lastSeen > DEAD_AFTER_MS) this._lost(conn, 'timeout');
        else this._ping();
      }, HEARTBEAT_MS);
    });
    conn.on('data', (msg) => this._data(conn, msg));
    conn.on('close', () => this._lost(conn, 'closed'));
    conn.on('error', () => this._lost(conn, 'error'));
  }

  _ping() { this._sendRaw({ t: 'ping', ts: Date.now() }); }

  _data(conn, msg) {
    if (conn !== this.conn || !msg || typeof msg !== 'object') return;
    this.lastSeen = Date.now();
    switch (msg.t) {
      case 'ping': this._sendRaw({ t: 'pong', ts: msg.ts }); return;
      case 'pong': {
        const rtt = Date.now() - msg.ts;
        if (rtt >= 0 && rtt < 10000) this.rtt = this.rtt * 0.6 + rtt * 0.4;
        return;
      }
      case 'hello': {
        const first = !this.friend || this.friend.clientId !== msg.clientId;
        const color = /^(hsl\([\d.\s%,]+\)|#[0-9a-f]{3,8})$/i.test(String(msg.color)) ? msg.color : '#b9adff';
        this.friend = { clientId: String(msg.clientId).slice(0, 40), name: String(msg.name || 'Friend').trim().slice(0, 40) || 'Friend', color };
        this._setState('connected');
        this.emit('friend', this.friend, first);
        return;
      }
      case 'full':
        this.want = false;
        this._clearTimers();
        this._destroyPeer();
        this.conn = null;
        this._setState('full');
        return;
      case 'bye': this._lost(conn, 'left'); return;
      default: this.emit('message', msg);
    }
  }

  _lost(conn, reason) {
    if (conn !== this.conn) return;
    this.conn = null;
    clearInterval(this._hb);
    try { conn.close(); } catch { /* noop */ }
    if (!this.want) return;
    this.emit('friend-left', reason);
    if (this.role === 'host' && this.peer && !this.peer.destroyed) {
      this._setState('waiting');
    } else {
      this._setState('reconnecting');
      this._retry(reason === 'left' ? 400 : 1200);
    }
  }

  _sendRaw(msg) {
    if (this.conn?.open) { try { this.conn.send(msg); return true; } catch { /* noop */ } }
    return false;
  }

  send(msg) { return this.connected ? this._sendRaw(msg) : false; }

  updateHello() { this._sendRaw({ t: 'hello', clientId: this.clientId, v: 1, ...this.hello() }); }
}
