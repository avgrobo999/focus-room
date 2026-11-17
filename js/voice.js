/**
 * Voice chat for the study room: a direct audio link between every pair of
 * people who have joined voice (a small mesh — fine for up to four).
 *
 * Security: the WebRTC offers, answers and ICE candidates travel only inside
 * the room's encrypted, Google-verified channel (room.send), never through the
 * PeerJS broker. Each SDP carries the browser's DTLS fingerprint, so because
 * the SDP itself is authenticated end to end, nobody outside the room can
 * slip into the middle of the audio. Audio is DTLS-SRTP encrypted in transit.
 *
 * Messages (inside the room channel):
 *   {t:'voice', on, muted, deaf}          my call state, to everyone
 *   {t:'rtc', cid, k:'offer'|'answer', sdp}  to one person
 *   {t:'rtc', cid, k:'ice', c}             to one person
 */
import { Emitter, netLog, pathOf } from './util.js?v=20261117c';
import { b64u, randomBytes } from './crypto.js?v=20261117c';

const MAX_SDP = 20000;
const CONNECT_TIMEOUT_MS = 20000;
const BLIP_GRACE_MS = 4000;     // a link that was up and goes "disconnected" gets this long to come back by itself
const RESTART_CHECK_MS = 10000; // then an ICE restart (same call, new network path) gets this long
const MAX_RESTARTS = 3;         // …before we hang up that link and dial again from scratch
const ORPHAN_GRACE_MS = 20000; // keep audio up while the room re-forms after its anchor drops
const SPEAK_LEVEL = 0.018;
const SPEAK_HOLD_MS = 350;
const DEFAULT_ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export const voiceSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);
/** can this browser send call audio to a chosen speaker? (not Safari / most phones) */
export const outputSupported = () => 'setSinkId' in HTMLMediaElement.prototype;

/*
 * Keep voice light so the monthly relay (TURN) quota lasts: the SDP we send asks the
 * other side to encode Opus at ~24 kbps (still clear for speech; browsers default to
 * ~32–40) with DTX, which sends almost nothing while you're silent. Both sides do this,
 * so both directions are capped.
 */
const OPUS_MAX_BITRATE = 24000;
function tuneOpus(sdp) {
  const lines = sdp.split('\r\n');
  const pts = lines.map((l) => l.match(/^a=rtpmap:(\d+) opus\/48000/i)?.[1]).filter(Boolean);
  for (const pt of pts) {
    const want = { maxaveragebitrate: String(OPUS_MAX_BITRATE), usedtx: '1' };
    const i = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `));
    if (i < 0) {
      const r = lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `));
      lines.splice(r + 1, 0, `a=fmtp:${pt} ${Object.entries(want).map(([k, v]) => `${k}=${v}`).join(';')}`);
      continue;
    }
    const params = lines[i].slice(`a=fmtp:${pt} `.length).split(';').map((s) => s.trim()).filter(Boolean)
      .filter((s) => !Object.hasOwn(want, s.split('=')[0].toLowerCase()));
    Object.entries(want).forEach(([k, v]) => params.push(`${k}=${v}`));
    lines[i] = `a=fmtp:${pt} ${params.join(';')}`;
  }
  return lines.join('\r\n');
}

function cleanCandidate(c) {
  if (!c || typeof c !== 'object' || typeof c.candidate !== 'string' || c.candidate.length > 1000) return null;
  const out = { candidate: c.candidate };
  if (typeof c.sdpMid === 'string' && c.sdpMid.length <= 32) out.sdpMid = c.sdpMid;
  if (Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex < 16) out.sdpMLineIndex = c.sdpMLineIndex;
  if (typeof c.usernameFragment === 'string' && c.usernameFragment.length <= 64) out.usernameFragment = c.usernameFragment;
  if (out.sdpMid === undefined && out.sdpMLineIndex === undefined) return null;
  return out;
}

/**
 * events:
 *  change ()                 anything about the call changed (re-render)
 *  speaking (mid, on)        someone started/stopped talking ('me' for you)
 *  error (code, message)     mic-denied | mic-missing | mic-error
 */
export class Voice extends Emitter {
  constructor(room, { getVolume = () => 1, input = '', output = '' } = {}) {
    super();
    this.room = room;
    this.getVolume = getVolume;
    this.inputId = typeof input === 'string' ? input : '';   // chosen microphone ('' = system default)
    this.outputId = typeof output === 'string' ? output : ''; // chosen speaker ('' = system default)
    this._inSeq = 0;
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.emit('devices'));
    this.live = false;
    this.joining = false;
    this.muted = false;
    this.deaf = false;
    this.mutedBeforeDeaf = false;
    this.stream = null;
    this.peers = new Map();  // mid -> link
    this.remote = new Map(); // mid -> {on, muted, deaf} as they reported it
    this.speaking = new Map();
    this.ctx = null;
    this.meters = new Map(); // mid|'me' -> {analyser, buf, last, on}
    this._meterT = null;
    this.sink = document.createElement('div');
    this.sink.hidden = true;
    document.body.append(this.sink);

    room.on('member', (m) => {
      const p = this.peers.get(m.mid);
      if (p?.orphanT) { clearTimeout(p.orphanT); p.orphanT = null; }
      if (this.live) this._announce(m.mid);
    });
    room.on('member-left', (m, reason) => {
      const p = this.peers.get(m.mid);
      if (reason === 'left' || reason === 'left-room' || reason === 'stopped' || !p) { this._drop(m.mid); this.remote.delete(m.mid); this.emit('change'); return; }
      // they may just be reconnecting through a new anchor: give the audio link a moment
      if (!p.orphanT) p.orphanT = setTimeout(() => { this._drop(m.mid); this.remote.delete(m.mid); this.emit('change'); }, ORPHAN_GRACE_MS);
    });
  }

  get inCall() { return this.live; }
  /** people (other than you) currently in voice */
  get others() { return [...this.remote].filter(([mid, r]) => r.on && this.room.members.has(mid)).map(([mid]) => mid); }
  linkState(mid) {
    const p = this.peers.get(mid);
    if (!p) return this.live && this.remote.get(mid)?.on ? 'connecting' : 'none';
    const s = p.pc.connectionState || p.pc.iceConnectionState;
    if (s === 'connected' || s === 'completed') return 'connected';
    if (p.everUp) return 'reconnecting';
    return s === 'failed' ? 'failed' : 'connecting';
  }

  /* ---------------- joining & leaving ---------------- */
  async join() {
    if (this.live || this.joining) return;
    if (!voiceSupported()) { this.emit('error', 'mic-error', 'This browser can’t do voice calls'); return; }
    this.joining = true;
    this.emit('change');
    // create the audio context while we still have the click's user activation (the mic prompt can outlast it)
    try { this.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume?.().catch(() => {}); } catch { this.ctx = null; }
    try {
      this.stream = await this._openMic(this.inputId, true);
    } catch (e) {
      this.joining = false;
      const code = e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'mic-denied' : e?.name === 'NotFoundError' ? 'mic-missing' : 'mic-error';
      this.emit('error', code, e?.message || '');
      this.emit('change');
      return;
    }
    this.joining = false;
    this.live = true;
    this.deaf = false;
    this._applyMute();
    this._watchMic(this.stream);
    this.ctx?.resume?.().catch(() => {});
    this._meter('me', this.stream);
    this._announce();
    for (const mid of this.others) this._maybeConnect(mid);
    this.emit('change');
  }

  /* ---------------- microphone & speaker choice ---------------- */
  async _openMic(id, fallback) {
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: id ? { ...base, deviceId: { exact: id } } : base, video: false });
    } catch (e) {
      // the remembered microphone is unplugged: use the system default instead
      if (!id || !fallback || !['OverconstrainedError', 'NotFoundError'].includes(e?.name)) throw e;
      return navigator.mediaDevices.getUserMedia({ audio: base, video: false });
    }
  }

  _watchMic(stream) {
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => {
      if (this.live && this.stream === stream) { this.leave(); this.emit('error', 'mic-error', 'Your microphone was disconnected'); }
    }));
  }

  /** microphones and speakers the browser knows about (names need mic permission) */
  async devices() {
    let list = [];
    try { list = await navigator.mediaDevices.enumerateDevices(); } catch { /* none */ }
    const pick = (kind, word) => list
      .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${word} ${i + 1}` }));
    return { inputs: pick('audioinput', 'Microphone'), outputs: pick('audiooutput', 'Speaker') };
  }

  /** switch microphone ('' = system default); mid-call it swaps the track on every link without redialling */
  async setInput(id) {
    id = typeof id === 'string' ? id : '';
    const prev = this.inputId;
    this.inputId = id;
    if (!this.live) return true;
    const seq = ++this._inSeq;
    let next;
    try { next = await this._openMic(id, false); } catch (e) {
      if (seq === this._inSeq) { this.inputId = prev; this.emit('error', 'mic-switch', e?.message || ''); }
      return false;
    }
    if (!this.live || seq !== this._inSeq) { next.getTracks().forEach((t) => t.stop()); return false; }
    const old = this.stream;
    const track = next.getAudioTracks()[0];
    this.stream = next;
    this._applyMute();
    this._watchMic(next);
    await Promise.all([...this.peers.values()].flatMap((p) => p.pc.getSenders()
      .filter((s) => s.track?.kind === 'audio').map((s) => s.replaceTrack(track).catch(() => {}))));
    old?.getTracks().forEach((t) => t.stop());
    this._meter('me', next);
    this.emit('change');
    return true;
  }

  /** switch speaker ('' = system default); false if the browser can't or the device refused */
  async setOutput(id) {
    if (!outputSupported()) return false;
    const prev = this.outputId;
    this.outputId = typeof id === 'string' ? id : '';
    const done = await Promise.all([...this.peers.values()].filter((p) => p.audio).map((p) => this._sink(p.audio)));
    if (done.every(Boolean)) return true;
    this.outputId = prev; // keep everyone on the speaker that works
    await Promise.all([...this.peers.values()].filter((p) => p.audio).map((p) => this._sink(p.audio)));
    return false;
  }

  _sink(audio) {
    if (!audio.setSinkId) return Promise.resolve(false);
    return audio.setSinkId(this.outputId).then(() => true, () => false);
  }

  leave() {
    if (!this.live && !this.joining) return;
    this.live = false;
    this.joining = false;
    for (const mid of [...this.peers.keys()]) this._drop(mid);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this._unmeter('me');
    if (this.room.connected) this.room.send({ t: 'voice', on: false, muted: false, deaf: false });
    this.emit('change');
  }

  /** the room itself was left: forget everyone */
  reset() {
    this.leave();
    this.remote.clear();
    this.emit('change');
  }

  setMuted(v) {
    if (!this.live) return;
    this.muted = !!v;
    if (!this.muted && this.deaf) { this.deaf = false; this._applyDeaf(); }
    this._applyMute();
    this._announce();
    this.emit('change');
  }

  toggleMute() { this.setMuted(!this.muted); }

  setDeaf(v) {
    if (!this.live) return;
    v = !!v;
    if (v === this.deaf) return;
    this.deaf = v;
    // like Discord: deafening also mutes you, and undeafening restores your old mute state
    if (v) { this.mutedBeforeDeaf = this.muted; this.muted = true; } else this.muted = this.mutedBeforeDeaf;
    this._applyMute();
    this._applyDeaf();
    this._announce();
    this.emit('change');
  }

  toggleDeaf() { this.setDeaf(!this.deaf); }

  /** per-person playback volume, 0…1 */
  setVolume(mid, v) {
    const p = this.peers.get(mid);
    if (p?.audio) p.audio.volume = Math.min(1, Math.max(0, v));
  }

  _applyMute() { this.stream?.getAudioTracks().forEach((t) => { t.enabled = !this.muted; }); }
  _applyDeaf() { this.peers.forEach((p) => { if (p.audio) p.audio.muted = this.deaf; }); }

  _announce(to) {
    if (!this.room.connected) return;
    this.room.send({ t: 'voice', on: this.live, muted: this.muted, deaf: this.deaf }, to);
  }

  /* ---------------- messages from the room ---------------- */
  handle(msg, from) {
    if (msg.t === 'voice') {
      if (typeof msg.on !== 'boolean') return;
      const prev = this.remote.get(from.mid);
      this.remote.set(from.mid, { on: msg.on, muted: msg.muted === true, deaf: msg.deaf === true });
      if (!msg.on) this._drop(from.mid);
      else if (this.live) this._maybeConnect(from.mid);
      if (!prev || prev.on !== msg.on || prev.muted !== (msg.muted === true) || prev.deaf !== (msg.deaf === true)) this.emit('change', from, prev);
      return;
    }
    if (msg.t === 'rtc') this._signal(msg, from).catch((e) => console.warn('[voice] signal', e));
  }

  /* ---------------- peer links ---------------- */
  // the person with the smaller member id always makes the offer, so two people never offer at once
  _isOfferer(mid) { return this.room.mid < mid; }

  _maybeConnect(mid) {
    if (!this.live || !this.remote.get(mid)?.on || !this.room.members.has(mid)) return;
    const p = this.peers.get(mid);
    if (p && this.linkState(mid) !== 'failed') return;
    if (!this._isOfferer(mid)) return; // they'll call us
    this._offer(mid);
  }

  _newLink(mid, cid) {
    this._drop(mid);
    const cfg = { ...(this.room.iceConfig || DEFAULT_ICE) };
    const pc = new RTCPeerConnection(cfg);
    const link = { mid, cid, pc, iceQueue: [], audio: null, orphanT: null, timeoutT: null, retries: 0, everUp: false, restarts: 0, blipT: null, restartT: null, seen: '' };
    this.peers.set(mid, link);
    this.stream.getAudioTracks().forEach((t) => pc.addTrack(t, this.stream));
    pc.onicecandidate = (e) => {
      if (e.candidate && this.peers.get(mid) === link) this.room.send({ t: 'rtc', cid, k: 'ice', c: e.candidate.toJSON() }, mid);
    };
    pc.ontrack = (e) => {
      if (e.track.kind !== 'audio' || this.peers.get(mid) !== link) return;
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (!link.audio) {
        link.audio = document.createElement('audio');
        link.audio.autoplay = true;
        this.sink.append(link.audio);
        if (this.outputId) this._sink(link.audio);
      }
      link.audio.srcObject = stream;
      link.audio.muted = this.deaf;
      link.audio.volume = Math.min(1, Math.max(0, this.getVolume(mid)));
      link.audio.play?.().catch(() => {});
      this._meter(mid, stream);
    };
    const onState = () => {
      if (this.peers.get(mid) !== link) return;
      const ice = pc.iceConnectionState, conn = pc.connectionState || '';
      if (link.seen !== `${ice}/${conn}`) { link.seen = `${ice}/${conn}`; netLog('voice', mid.slice(0, 4), ice, conn); }
      const up = ice === 'connected' || ice === 'completed' || conn === 'connected';
      if (up) {
        clearTimeout(link.timeoutT); clearTimeout(link.blipT); clearTimeout(link.restartT);
        link.blipT = link.restartT = null;
        if (!link.everUp || link.restarts) setTimeout(() => pathOf(pc).then((p) => netLog('voice path', mid.slice(0, 4), p)), 800);
        link.everUp = true; link.retries = 0; link.restarts = 0;
      } else if (link.everUp) {
        // a call that was working: ride out short blips, then restart ICE on the same call (no hang-up)
        if (ice === 'failed' || conn === 'failed') this._recover(mid, link);
        else if (!link.blipT && !link.restartT) link.blipT = setTimeout(() => { link.blipT = null; if (this.peers.get(mid) === link && this.linkState(mid) !== 'connected') this._recover(mid, link); }, BLIP_GRACE_MS);
      } else if ((ice === 'failed' || conn === 'failed') && this._isOfferer(mid)) this._redial(mid, link);
      this.emit('change');
    };
    pc.onconnectionstatechange = onState;
    pc.oniceconnectionstatechange = onState;
    link.timeoutT = setTimeout(() => {
      if (this.peers.get(mid) === link && this.linkState(mid) !== 'connected' && this._isOfferer(mid)) this._redial(mid, link);
    }, CONNECT_TIMEOUT_MS);
    return link;
  }

  _redial(mid, link) {
    const tries = link.retries + 1;
    netLog('voice', mid.slice(0, 4), 'redial', `#${tries}`);
    this._drop(mid);
    if (tries > 4) { this.emit('change'); return; }
    setTimeout(() => {
      if (!this.live || this.peers.has(mid) || !this.remote.get(mid)?.on) return;
      const l = this._offer(mid);
      if (l) l.retries = tries;
    }, 1500 * tries);
  }

  /** the network path broke mid-call: find a new one without tearing the call down */
  _recover(mid, link) {
    if (this.peers.get(mid) !== link || !this.live) return;
    clearTimeout(link.restartT);
    // keep checking from both sides: if the other person's restart never reaches us, we still notice
    link.restartT = setTimeout(() => {
      link.restartT = null;
      if (this.peers.get(mid) !== link) return;
      if (this.linkState(mid) === 'connected') link.restarts = 0; // came back (perhaps without ever looking down)
      else this._recover(mid, link);
    }, RESTART_CHECK_MS);
    if (!this._isOfferer(mid)) return; // only the offerer renegotiates, so the two sides never collide
    if (++link.restarts > MAX_RESTARTS) { netLog('voice', mid.slice(0, 4), 'restarts exhausted — redialling'); this._redial(mid, link); return; }
    netLog('voice', mid.slice(0, 4), 'ice restart', `#${link.restarts}`);
    (async () => {
      const offer = await link.pc.createOffer({ iceRestart: true });
      if (this.peers.get(mid) !== link) return;
      await link.pc.setLocalDescription(offer);
      if (this.peers.get(mid) === link) this.room.send({ t: 'rtc', cid: link.cid, k: 'offer', sdp: tuneOpus(link.pc.localDescription.sdp) }, mid);
    })().catch((e) => { console.warn('[voice] restart', e); this._redial(mid, link); });
  }

  _offer(mid) {
    const link = this._newLink(mid, b64u(randomBytes(9)));
    (async () => {
      const offer = await link.pc.createOffer();
      await link.pc.setLocalDescription(offer);
      if (this.peers.get(mid) !== link) return;
      this.room.send({ t: 'rtc', cid: link.cid, k: 'offer', sdp: tuneOpus(link.pc.localDescription.sdp) }, mid);
    })().catch((e) => { console.warn('[voice] offer', e); this._drop(mid); });
    this.emit('change');
    return link;
  }

  async _signal(msg, from) {
    const mid = from.mid;
    if (typeof msg.cid !== 'string' || msg.cid.length > 24 || !['offer', 'answer', 'ice'].includes(msg.k)) return;
    if (!this.live) return;
    let link = this.peers.get(mid);

    if (msg.k === 'offer') {
      if (this._isOfferer(mid) || typeof msg.sdp !== 'string' || msg.sdp.length > MAX_SDP) return;
      if (!link || link.cid !== msg.cid) link = this._newLink(mid, msg.cid); // a new call attempt replaces the old one
      else if (link.pc.signalingState !== 'stable') return; // (can't happen with one offerer, but don't wedge if it does)
      await link.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      await this._flushIce(link);
      const answer = await link.pc.createAnswer();
      await link.pc.setLocalDescription(answer);
      if (this.peers.get(mid) === link) this.room.send({ t: 'rtc', cid: link.cid, k: 'answer', sdp: tuneOpus(link.pc.localDescription.sdp) }, mid);
      this.emit('change');
      return;
    }
    if (!link || link.cid !== msg.cid) return; // stale attempt
    if (msg.k === 'answer') {
      if (!this._isOfferer(mid) || typeof msg.sdp !== 'string' || msg.sdp.length > MAX_SDP || link.pc.signalingState !== 'have-local-offer') return;
      await link.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      await this._flushIce(link);
      return;
    }
    const c = cleanCandidate(msg.c);
    if (!c) return;
    if (!link.pc.remoteDescription) { if (link.iceQueue.length < 60) link.iceQueue.push(c); return; }
    await link.pc.addIceCandidate(c).catch(() => {});
  }

  async _flushIce(link) {
    const q = link.iceQueue.splice(0);
    for (const c of q) await link.pc.addIceCandidate(c).catch(() => {});
  }

  _drop(mid) {
    const p = this.peers.get(mid);
    if (!p) return;
    this.peers.delete(mid);
    clearTimeout(p.orphanT);
    clearTimeout(p.timeoutT);
    clearTimeout(p.blipT);
    clearTimeout(p.restartT);
    try { p.pc.close(); } catch { /* noop */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    this._unmeter(mid);
  }

  /* ---------------- who's talking ---------------- */
  _meter(key, stream) {
    this._unmeter(key);
    if (!this.ctx) return;
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      this.meters.set(key, { src, analyser, buf: new Float32Array(analyser.fftSize), last: 0, on: false });
    } catch { return; }
    if (!this._meterT) this._meterT = setInterval(() => this._tickMeters(), 90);
  }

  _unmeter(key) {
    const m = this.meters.get(key);
    if (!m) return;
    try { m.src.disconnect(); } catch { /* noop */ }
    this.meters.delete(key);
    if (this.speaking.get(key)) { this.speaking.set(key, false); this.emit('speaking', key, false); }
    if (!this.meters.size) { clearInterval(this._meterT); this._meterT = null; }
  }

  _tickMeters() {
    const now = Date.now();
    for (const [key, m] of this.meters) {
      m.analyser.getFloatTimeDomainData(m.buf);
      let sum = 0;
      for (let i = 0; i < m.buf.length; i++) sum += m.buf[i] * m.buf[i];
      const rms = Math.sqrt(sum / m.buf.length);
      const silent = key === 'me' ? this.muted : this.deaf || this.remote.get(key)?.muted;
      if (rms > SPEAK_LEVEL && !silent) m.last = now;
      const on = now - m.last < SPEAK_HOLD_MS;
      if (on !== m.on) { m.on = on; this.speaking.set(key, on); this.emit('speaking', key, on); }
    }
  }
}
