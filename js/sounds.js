/**
 * Procedural ambient soundscapes — everything is synthesized live with the
 * Web Audio API, so there are no audio files to download or license.
 */
import { rand, pick } from './util.js?v=20261121e';

export const SOUND_LIST = [
  { id: 'rain', name: 'Rain', icon: 'cloud-rain', cat: 'Nature' },
  { id: 'thunder', name: 'Thunder', icon: 'cloud-lightning', cat: 'Nature' },
  { id: 'wind', name: 'Wind', icon: 'wind', cat: 'Nature' },
  { id: 'waves', name: 'Ocean waves', icon: 'waves', cat: 'Nature' },
  { id: 'stream', name: 'Stream', icon: 'droplets', cat: 'Nature' },
  { id: 'fire', name: 'Campfire', icon: 'flame', cat: 'Nature' },
  { id: 'birds', name: 'Birds', icon: 'bird', cat: 'Nature' },
  { id: 'crickets', name: 'Night crickets', icon: 'moon', cat: 'Nature' },
  { id: 'keyboard', name: 'Typing', icon: 'keyboard', cat: 'Spaces' },
  { id: 'clock', name: 'Clock tick', icon: 'clock', cat: 'Spaces' },
  { id: 'white', name: 'White noise', icon: 'radio', cat: 'Noise' },
  { id: 'pink', name: 'Pink noise', icon: 'radio', cat: 'Noise' },
  { id: 'brown', name: 'Brown noise', icon: 'radio', cat: 'Noise' },
  { id: 'alpha', name: 'Alpha · 10 Hz', icon: 'brain', cat: 'Binaural', beat: 10 },
  { id: 'beta', name: 'Beta · 18 Hz', icon: 'brain', cat: 'Binaural', beat: 18 },
  { id: 'gamma', name: 'Gamma · 40 Hz', icon: 'brain', cat: 'Binaural', beat: 40 },
  { id: 'theta', name: 'Theta · 6 Hz', icon: 'brain', cat: 'Binaural', beat: 6 },
  { id: 'delta', name: 'Delta · 2 Hz', icon: 'brain', cat: 'Binaural', beat: 2 },
];

export const SOUND_PRESETS = [
  { id: 'rainy', name: 'Rainy afternoon', mix: { rain: 0.65, thunder: 0.35 } },
  { id: 'camp', name: 'Campfire night', mix: { fire: 0.6, crickets: 0.3, wind: 0.15 } },
  { id: 'sea', name: 'Seaside', mix: { waves: 0.7, wind: 0.2, birds: 0.15 } },
  { id: 'forest', name: 'Forest morning', mix: { birds: 0.5, stream: 0.4, wind: 0.12 } },
  { id: 'deep', name: 'Deep work', mix: { brown: 0.5, alpha: 0.25 } },
  { id: 'late', name: 'Late-night coding', mix: { rain: 0.35, keyboard: 0.35, clock: 0.12 } },
];

class Engine {
  constructor() {
    this.ctx = null;
    this.active = new Map(); // id -> { gain, stop }
    this.volumes = {};
    this.master = 0.8;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 4;
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.master;
      this.comp.connect(this.masterGain).connect(this.ctx.destination);
      this.buffers = {
        white: this._noise('white'), pink: this._noise('pink'), brown: this._noise('brown'),
      };
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _noise(kind, seconds = 6) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.5;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else {
          last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5;
        }
      }
      // crossfade the loop seam
      const fade = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        d[i] = d[i] * t + d[len - fade + i] * (1 - t);
      }
    }
    return buf;
  }

  _src(kind) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffers[kind];
    s.loop = true;
    s.loopEnd = s.buffer.duration - 0.05;
    s.start(0, rand(0, 4));
    return s;
  }

  _filter(type, freq, Q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = Q;
    return f;
  }

  _gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

  _pan(v) {
    if (this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = v; return p; }
    return this._gain(1);
  }

  _lfo(freq, depth, target, offset) {
    const o = this.ctx.createOscillator();
    o.frequency.value = freq;
    const g = this._gain(depth);
    o.connect(g).connect(target);
    if (offset != null) target.value = offset;
    o.start();
    return o;
  }

  /** short noise burst — used for drops, crackles, key clicks */
  _burst(out, t, { dur = 0.01, freq = 3000, Q = 1, type = 'bandpass', gain = 0.3, pan = 0, kind = 'white' } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.buffers[kind];
    const f = this._filter(type, freq, Q);
    const g = this._gain(0);
    const p = this._pan(pan);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.004, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(p).connect(out);
    s.start(t, rand(0, 5), dur + 0.05);
  }

  _tone(out, t, { f0, f1, dur, gain = 0.2, type = 'sine', pan = 0, attack = 0.005 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this._pan(pan);
    o.connect(g).connect(p).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** run a lookahead scheduler; fn(t) schedules events and returns seconds until next */
  _scheduler(fn) {
    let next = this.ctx.currentTime + 0.1;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      const horizon = this.ctx.currentTime + 0.5;
      let guard = 0;
      while (next < horizon && guard++ < 200) next += Math.max(0.005, fn(next));
    };
    const iv = setInterval(loop, 120);
    loop();
    return () => { alive = false; clearInterval(iv); };
  }

  _build(id, out) {
    const ctx = this.ctx;
    const nodes = [];
    const stops = [];
    const keep = (...n) => { nodes.push(...n); return n[0]; };
    const meta = SOUND_LIST.find((s) => s.id === id);

    switch (id) {
      case 'white': case 'pink': case 'brown': {
        const s = keep(this._src(id));
        const g = this._gain(id === 'white' ? 0.35 : id === 'pink' ? 0.6 : 0.7);
        s.connect(g).connect(out);
        break;
      }
      case 'rain': {
        const s = keep(this._src('pink'));
        const hp = this._filter('highpass', 500), lp = this._filter('lowpass', 8000);
        const g = this._gain(0.9);
        s.connect(hp).connect(lp).connect(g).connect(out);
        const s2 = keep(this._src('white'));
        const bp = this._filter('highpass', 3500);
        const g2 = this._gain(0.06);
        s2.connect(bp).connect(g2).connect(out);
        keep(this._lfo(0.07, 0.15, g.gain, 0.8));
        stops.push(this._scheduler((t) => {
          this._burst(out, t, { dur: rand(0.006, 0.02), freq: rand(1800, 6000), Q: rand(1, 4), gain: rand(0.05, 0.22), pan: rand(-0.9, 0.9) });
          return rand(0.01, 0.06);
        }));
        break;
      }
      case 'thunder': {
        const bed = keep(this._src('brown'));
        const bedLp = this._filter('lowpass', 180);
        const bedG = this._gain(0.25);
        bed.connect(bedLp).connect(bedG).connect(out);
        let first = true;
        stops.push(this._scheduler((t) => {
          if (!first) this._rumble(out, t);
          first = false;
          return rand(12, 32);
        }));
        // first strike soon after enabling
        this._rumble(out, ctx.currentTime + 1.2);
        break;
      }
      case 'wind': {
        for (const pan of [-0.6, 0.6]) {
          const s = keep(this._src('brown'));
          const bp = this._filter('bandpass', 500, 0.9);
          const g = this._gain(0.9);
          const p = this._pan(pan);
          s.connect(bp).connect(g).connect(p).connect(out);
          keep(this._lfo(rand(0.05, 0.12), rand(200, 350), bp.frequency, rand(450, 650)));
          keep(this._lfo(rand(0.04, 0.09), 0.45, g.gain, 0.6));
        }
        const hiss = keep(this._src('pink'));
        const hp = this._filter('bandpass', 1600, 0.5);
        const hg = this._gain(0.08);
        hiss.connect(hp).connect(hg).connect(out);
        break;
      }
      case 'waves': {
        const s = keep(this._src('brown'));
        const lp = this._filter('lowpass', 700);
        const g = this._gain(0.2);
        s.connect(lp).connect(g).connect(out);
        const foam = keep(this._src('pink'));
        const fhp = this._filter('bandpass', 1800, 0.4);
        const fg = this._gain(0.02);
        foam.connect(fhp).connect(fg).connect(out);
        stops.push(this._scheduler((t) => {
          const rise = rand(2.5, 4), fall = rand(4, 6.5), peak = rand(0.8, 1.2);
          g.gain.setTargetAtTime(peak, t, rise / 3);
          g.gain.setTargetAtTime(0.18, t + rise, fall / 3);
          fg.gain.setTargetAtTime(peak * 0.35, t + rise * 0.7, 0.6);
          fg.gain.setTargetAtTime(0.02, t + rise + 0.5, fall / 3);
          lp.frequency.setTargetAtTime(1200, t, rise / 3);
          lp.frequency.setTargetAtTime(500, t + rise, fall / 3);
          return rise + fall;
        }));
        break;
      }
      case 'stream': {
        const base = keep(this._src('pink'));
        const blp = this._filter('lowpass', 1400);
        const bg = this._gain(0.45);
        base.connect(blp).connect(bg).connect(out);
        const bands = [];
        for (let i = 0; i < 4; i++) {
          const s = keep(this._src('white'));
          const bp = this._filter('bandpass', rand(500, 1800), 9);
          const g = this._gain(0.35);
          const p = this._pan(rand(-0.7, 0.7));
          s.connect(bp).connect(g).connect(p).connect(out);
          bands.push(bp);
        }
        stops.push(this._scheduler((t) => {
          const bp = pick(bands);
          bp.frequency.setTargetAtTime(rand(350, 2200), t, 0.03);
          return rand(0.03, 0.09);
        }));
        break;
      }
      case 'fire': {
        const s = keep(this._src('brown'));
        const lp = this._filter('lowpass', 420);
        const g = this._gain(0.75);
        s.connect(lp).connect(g).connect(out);
        keep(this._lfo(0.3, 0.2, g.gain, 0.7));
        stops.push(this._scheduler((t) => {
          const pop = Math.random() < 0.06;
          this._burst(out, t, {
            dur: pop ? rand(0.02, 0.05) : rand(0.003, 0.012), freq: pop ? rand(800, 1600) : rand(2000, 6000),
            type: pop ? 'bandpass' : 'highpass', Q: 0.8, gain: pop ? rand(0.4, 0.7) : rand(0.08, 0.3), pan: rand(-0.5, 0.5),
          });
          return Math.random() < 0.3 ? rand(0.01, 0.04) : rand(0.06, 0.35);
        }));
        break;
      }
      case 'birds': {
        const air = keep(this._src('pink'));
        const ahp = this._filter('bandpass', 2500, 0.4);
        const ag = this._gain(0.025);
        air.connect(ahp).connect(ag).connect(out);
        stops.push(this._scheduler((t) => this._birdCall(out, t)));
        break;
      }
      case 'crickets': {
        const crickets = [0, 1, 2].map(() => ({ f: rand(4200, 5200), pan: rand(-0.8, 0.8), rate: rand(0.5, 0.9), pulses: 2 + Math.floor(rand(0, 3)), g: rand(0.03, 0.06) }));
        crickets.forEach((c) => {
          stops.push(this._scheduler((t) => {
            for (let i = 0; i < c.pulses; i++) this._tone(out, t + i * 0.045, { f0: c.f, dur: 0.03, gain: c.g, pan: c.pan, attack: 0.004 });
            return c.rate + rand(-0.05, 0.05);
          }));
        });
        const night = keep(this._src('brown'));
        const nlp = this._filter('lowpass', 250);
        const ng = this._gain(0.12);
        night.connect(nlp).connect(ng).connect(out);
        break;
      }
      case 'keyboard': {
        let inBurst = 0;
        stops.push(this._scheduler((t) => {
          if (inBurst <= 0) { inBurst = Math.floor(rand(6, 40)); return rand(0.6, 2.8); }
          inBurst--;
          const space = Math.random() < 0.15;
          this._burst(out, t, { dur: space ? 0.03 : rand(0.008, 0.018), freq: space ? rand(700, 1100) : rand(1800, 3400), Q: 1.5, gain: rand(0.25, 0.45), pan: rand(-0.25, 0.25) });
          this._tone(out, t, { f0: rand(110, 160), dur: 0.02, gain: 0.08 });
          return rand(0.07, 0.22);
        }));
        break;
      }
      case 'clock': {
        let tock = false;
        stops.push(this._scheduler((t) => {
          tock = !tock;
          this._burst(out, t, { dur: 0.012, freq: tock ? 2200 : 2900, Q: 6, gain: 0.5 });
          return 1;
        }));
        break;
      }
      default: {
        if (meta?.beat) {
          const carrier = 200;
          const l = ctx.createOscillator(); l.frequency.value = carrier;
          const r = ctx.createOscillator(); r.frequency.value = carrier + meta.beat;
          const merger = ctx.createChannelMerger(2);
          const g = this._gain(0.22);
          l.connect(merger, 0, 0); r.connect(merger, 0, 1);
          merger.connect(g).connect(out);
          l.start(); r.start();
          keep(l, r);
          // soft pink bed so it isn't a bare tone
          const bed = keep(this._src('pink'));
          const blp = this._filter('lowpass', 900);
          const bg = this._gain(0.08);
          bed.connect(blp).connect(bg).connect(out);
        }
      }
    }
    return () => {
      stops.forEach((s) => s());
      nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } });
    };
  }

  _rumble(out, t) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.buffers.brown;
    const lp = this._filter('lowpass', 900, 0.6);
    const g = this._gain(0);
    const dur = rand(4, 8);
    const crack = Math.random() < 0.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(crack ? 1.6 : 0.9, t + (crack ? 0.05 : rand(0.4, 1)));
    g.gain.setTargetAtTime(0.5, t + 0.5, 0.6);
    g.gain.setTargetAtTime(0.0001, t + 1.5, dur / 4);
    lp.frequency.setValueAtTime(crack ? 1600 : 700, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + dur);
    s.connect(lp).connect(g).connect(this._pan(rand(-0.5, 0.5))).connect(out);
    s.start(t, rand(0, 5), dur + 1);
  }

  _birdCall(out, t) {
    const pan = rand(-0.9, 0.9);
    const kind = Math.floor(rand(0, 4));
    const base = rand(2200, 4200);
    if (kind === 0) { // rising whistle
      this._tone(out, t, { f0: base * 0.7, f1: base * 1.3, dur: rand(0.12, 0.25), gain: 0.08, pan });
    } else if (kind === 1) { // trill
      const n = 3 + Math.floor(rand(0, 6));
      for (let i = 0; i < n; i++) this._tone(out, t + i * 0.07, { f0: base * 1.1, f1: base * 0.85, dur: 0.06, gain: 0.07, pan });
    } else if (kind === 2) { // two-note call
      this._tone(out, t, { f0: base, f1: base * 1.05, dur: 0.18, gain: 0.07, pan });
      this._tone(out, t + 0.25, { f0: base * 0.8, f1: base * 0.75, dur: 0.22, gain: 0.07, pan });
    } else { // chirp cluster
      for (let i = 0; i < 3; i++) this._tone(out, t + i * rand(0.09, 0.14), { f0: base * 1.4, f1: base * 0.9, dur: 0.05, gain: 0.06, pan });
    }
    return rand(0.6, 3.2);
  }

  isOn(id) { return this.active.has(id); }

  set(id, volume) {
    this.volumes[id] = volume;
    if (volume <= 0) { this.stop(id); return; }
    this.ensure();
    let a = this.active.get(id);
    if (!a) {
      const gain = this._gain(0);
      gain.connect(this.comp);
      const stop = this._build(id, gain);
      a = { gain, stop };
      this.active.set(id, a);
    }
    a.gain.gain.setTargetAtTime(volume * volume, this.ctx.currentTime, 0.15);
  }

  stop(id) {
    const a = this.active.get(id);
    if (!a) return;
    this.active.delete(id);
    a.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
    setTimeout(() => { a.stop(); a.gain.disconnect(); }, 700);
  }

  stopAll() { [...this.active.keys()].forEach((id) => this.stop(id)); }

  setMaster(v) {
    this.master = v;
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /* ---------- alert sounds ---------- */
  alert(kind = 'chime', volume = 0.7) {
    if (kind === 'none') return;
    const ctx = this.ensure();
    const out = this._gain(volume);
    out.connect(ctx.destination);
    const t = ctx.currentTime + 0.05;
    const bell = (time, f, len = 2.4, g = 0.25) => {
      [[1, 1], [2.76, 0.35], [5.4, 0.12], [8.93, 0.05]].forEach(([m, a]) =>
        this._tone(out, time, { f0: f * m, dur: len / Math.sqrt(m), gain: g * a, attack: 0.003 }));
    };
    switch (kind) {
      case 'chime': bell(t, 880); bell(t + 0.35, 1108.7); bell(t + 0.7, 1318.5, 3); break;
      case 'bell': bell(t, 523.25, 4, 0.35); bell(t + 1.6, 523.25, 4, 0.3); break;
      case 'marimba':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          this._tone(out, t + i * 0.16, { f0: f, dur: 0.6, gain: 0.3, type: 'triangle', attack: 0.002 });
          this._tone(out, t + i * 0.16, { f0: f * 4, dur: 0.12, gain: 0.05, attack: 0.001 });
        });
        break;
      case 'digital':
        for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++)
          this._tone(out, t + r * 0.9 + i * 0.12, { f0: 1760, dur: 0.07, gain: 0.08, type: 'square', attack: 0.001 });
        break;
      case 'birds': for (let i = 0; i < 4; i++) this._birdCall(out, t + i * 0.5); break;
      case 'gong':
        [[110, 0.5], [164.8, 0.2], [220.5, 0.15], [331, 0.08], [440.7, 0.05]].forEach(([f, a]) =>
          this._tone(out, t, { f0: f, f1: f * 0.98, dur: 5, gain: a, attack: 0.01 }));
        break;
    }
    setTimeout(() => out.disconnect(), 7000);
  }
}

export const sound = new Engine();

export const ALERTS = [
  ['chime', 'Chime'], ['bell', 'Temple bell'], ['marimba', 'Marimba'], ['digital', 'Digital watch'],
  ['birds', 'Birdsong'], ['gong', 'Soft gong'], ['none', 'Silent'],
];
