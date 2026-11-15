/**
 * Ringtones for "ring a friend": a bright two-note chime for an incoming ring
 * (with vibration on phones) and a soft ringback tone while you're calling.
 * Made with WebAudio, so there are no sound files to load.
 */
export class Ringtone {
  constructor() { this.ctx = null; this.t = null; this.kind = null; }

  _ctx() {
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { this.ctx = null; }
    return this.ctx;
  }

  /** kind: 'in' (someone is ringing you) | 'out' (you're ringing someone) */
  start(kind) {
    this.stop();
    this.kind = kind;
    const every = kind === 'in' ? 2400 : 3000;
    const tick = () => {
      this._burst(kind);
      if (kind === 'in') try { navigator.vibrate?.([350, 150, 350]); } catch { /* noop */ }
    };
    tick();
    this.t = setInterval(tick, every);
  }

  stop() {
    clearInterval(this.t);
    this.t = null;
    if (this.kind === 'in') try { navigator.vibrate?.(0); } catch { /* noop */ }
    this.kind = null;
  }

  _tone(freq, at, dur, peak) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.02);
    g.gain.setValueAtTime(peak, at + dur - 0.08);
    g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  _burst(kind) {
    const ctx = this._ctx();
    if (!ctx) return;
    const t = ctx.currentTime + 0.03;
    if (kind === 'in') {
      // two quick rising chimes
      for (const off of [0, 0.55]) { this._tone(784, t + off, 0.18, 0.22); this._tone(1175, t + off + 0.2, 0.26, 0.22); }
    } else {
      // gentle ringback: two tones together for one second
      this._tone(440, t, 1, 0.05); this._tone(480, t, 1, 0.05);
    }
  }
}
