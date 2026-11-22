import { Emitter, uid } from './util.js?v=20261121e';

/** the id of the run that follows this one: worked out, not random, so devices agree on it */
function nextSid(sid) {
  let h = 2166136261;
  for (const c of `${sid}>`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return `${(h >>> 0).toString(36)}${String(sid).slice(0, 3)}`.replace(/[^\w-]/g, '').padEnd(6, '0').slice(0, 12);
}

/**
 * Timer engine. Time is tracked with absolute end timestamps so it survives
 * background-tab throttling and can be synced to a friend or to your other devices.
 *
 * events:
 *   'change'   ({source:'local'|'remote', action})
 *   'complete' ({phase, minutes, type, sid})
 *   'partial'  ({minutes, sid})  focus time banked when a focus session is skipped
 * sid names one run of one phase, so the log counts it once however many of your devices showed it.
 */
export class Timer extends Emitter {
  constructor(getSettings) {
    super();
    this.getSettings = getSettings;
    const s = getSettings();
    this.state = {
      type: s.timerType,
      phase: s.timerType === 'pomodoro' ? 'focus' : s.timerType,
      running: false,
      endsAt: 0,
      remainingMs: 0,
      totalMs: 0,
      cycle: 0, // completed focus sessions in the current set
      swStartedAt: 0,
      swElapsedMs: 0,
      ranMs: 0,   // time actually run on OUR clock in the current phase (used for logging)
      runAt: 0,
      sid: uid(10), // this run of this phase: your devices log it once between them, however many showed it
    };
    this.state.totalMs = this.state.remainingMs = this.phaseMs(this.state.phase);
  }

  phaseMs(phase) {
    const s = this.getSettings();
    const m = { focus: s.focusMin, short: s.shortMin, long: s.longMin, countdown: s.countdownMin, stopwatch: 0 }[phase] ?? 25;
    return Math.max(1, m) * 60000 * (phase === 'stopwatch' ? 0 : 1);
  }

  /** ms remaining (countdown types) or elapsed (stopwatch) */
  value(now = Date.now()) {
    const st = this.state;
    if (st.type === 'stopwatch') return st.swElapsedMs + (st.running ? now - st.swStartedAt : 0);
    return st.running ? Math.max(0, st.endsAt - now) : st.remainingMs;
  }

  progress(now = Date.now()) {
    const st = this.state;
    if (st.type === 'stopwatch') return 0;
    return st.totalMs ? 1 - this.value(now) / st.totalMs : 0;
  }

  get isBreak() { return this.state.phase === 'short' || this.state.phase === 'long'; }

  /** ms this phase has really been running on this device */
  ran(now = Date.now()) { const st = this.state; return st.ranMs + (st.running ? Math.max(0, now - st.runAt) : 0); }
  _resetRun(now = Date.now(), sid = uid(10)) { this.state.ranMs = 0; this.state.runAt = now; this.state.sid = sid; }

  _changed(action, source = 'local') { this.emit('change', { source, action }); }

  start() {
    const st = this.state;
    if (st.running) return;
    const now = Date.now();
    if (st.type === 'stopwatch') st.swStartedAt = now;
    else {
      if (st.remainingMs <= 0) st.remainingMs = st.totalMs;
      st.endsAt = now + st.remainingMs;
    }
    st.running = true;
    st.runAt = now;
    this._changed('start');
  }

  pause() {
    const st = this.state;
    if (!st.running) return;
    const now = Date.now();
    if (st.type === 'stopwatch') { st.swElapsedMs += now - st.swStartedAt; }
    else st.remainingMs = Math.max(0, st.endsAt - now);
    st.ranMs += Math.max(0, now - st.runAt);
    st.running = false;
    this._changed('pause');
  }

  toggle() { this.state.running ? this.pause() : this.start(); }

  /** returns stopwatch minutes that were on the clock (for logging) */
  reset() {
    const st = this.state;
    let swMin = 0;
    if (st.type === 'stopwatch') {
      swMin = Math.min(this.value(), this.ran()) / 60000;
      st.swElapsedMs = 0; st.swStartedAt = Date.now();
    } else {
      st.totalMs = st.remainingMs = this.phaseMs(st.phase);
    }
    st.running = false;
    this._resetRun();
    this._changed('reset');
    return swMin;
  }

  skip() {
    const st = this.state;
    if (st.type !== 'pomodoro') { this.reset(); return; }
    if (st.phase === 'focus') {
      const doneMin = Math.min(st.totalMs - this.value(), this.ran()) / 60000;
      if (doneMin >= 1) this.emit('partial', { minutes: doneMin, sid: st.sid });
    }
    this._advance(false);
    this._changed('skip');
  }

  setPhase(phase) {
    const st = this.state;
    if (st.type !== 'pomodoro') return;
    st.phase = phase;
    st.running = false;
    st.totalMs = st.remainingMs = this.phaseMs(phase);
    this._resetRun();
    this._changed('phase');
  }

  /** give the current session a new length (typed on the timer), optionally starting it straight away */
  setLength(ms, { start = false } = {}) {
    const st = this.state;
    if (st.type === 'stopwatch' || !(ms > 0)) return;
    const now = Date.now();
    // focus already done in this session still counts
    if (st.type === 'pomodoro' && st.phase === 'focus') {
      const doneMin = Math.min(st.totalMs - this.value(now), this.ran(now)) / 60000;
      if (doneMin >= 1) this.emit('partial', { minutes: doneMin, sid: st.sid });
    }
    st.totalMs = st.remainingMs = Math.round(ms);
    st.running = false;
    this._resetRun(now);
    if (start) { st.endsAt = now + st.remainingMs; st.running = true; }
    this._changed('length');
  }

  setType(type) {
    const st = this.state;
    st.type = type;
    st.phase = type === 'pomodoro' ? 'focus' : type;
    st.running = false;
    st.cycle = 0;
    st.swElapsedMs = 0;
    st.totalMs = st.remainingMs = this.phaseMs(st.phase);
    this._resetRun();
    this._changed('type');
  }

  /** Called when durations change in settings: refresh only if idle at full length */
  refreshDurations() {
    const st = this.state;
    if (st.type === 'stopwatch' || st.running) return;
    if (st.remainingMs === st.totalMs) {
      st.totalMs = st.remainingMs = this.phaseMs(st.phase);
      this._changed('durations');
    }
  }

  _advance(fromComplete) {
    const st = this.state;
    const s = this.getSettings();
    if (st.type !== 'pomodoro') return;
    let autoStart = false;
    if (st.phase === 'focus') {
      if (fromComplete) st.cycle += 1;
      st.phase = st.cycle > 0 && st.cycle % Math.max(1, s.longEvery) === 0 ? 'long' : 'short';
      autoStart = fromComplete && s.autoBreaks;
    } else {
      if (st.phase === 'long') st.cycle = 0;
      st.phase = 'focus';
      autoStart = fromComplete && s.autoFocus;
    }
    st.totalMs = st.remainingMs = this.phaseMs(st.phase);
    st.running = false;
    // after a natural finish every device showing this timer works out the same id for the next run
    this._resetRun(Date.now(), fromComplete ? nextSid(st.sid) : uid(10));
    if (autoStart) { st.endsAt = Date.now() + st.remainingMs; st.running = true; }
  }

  /** call frequently; handles completion */
  tick() {
    const st = this.state;
    if (!st.running || st.type === 'stopwatch') return;
    if (Date.now() >= st.endsAt) {
      const phase = st.phase, sid = st.sid;
      const minutes = Math.min(st.totalMs, this.ran()) / 60000; // only credit time that really passed here
      st.remainingMs = 0;
      if (st.type === 'countdown') {
        st.running = false;
        st.remainingMs = st.totalMs;
        this._resetRun(Date.now(), nextSid(sid));
      } else this._advance(true);
      this.emit('complete', { phase, minutes, type: st.type, sid });
      this._changed('complete');
    }
  }

  /** everything needed to pick the timer up again after the page reloads */
  persisted(now = Date.now()) { return { ...this.state, at: now }; }

  /**
   * Pick up where a reload left off. Reloaded within maxGapMs, a running timer just keeps
   * running; after a longer absence it comes back paused at the time it showed when the page went away.
   */
  restore(s, { now = Date.now(), maxGapMs = 30000 } = {}) {
    const st = this.state;
    const ok = (v) => Number.isFinite(v) && v >= 0;
    if (!s || typeof s !== 'object' || s.type !== st.type) return false;
    if (!(st.type === 'pomodoro' ? ['focus', 'short', 'long'] : [st.type]).includes(s.phase)) return false;
    if (![s.at, s.endsAt, s.remainingMs, s.totalMs, s.cycle, s.swStartedAt, s.swElapsedMs, s.ranMs, s.runAt].every(ok)) return false;
    if (s.at > now + 5000) return false; // saved "in the future": the clock changed, don't trust it
    const wasRunning = s.running === true;
    const keepRunning = wasRunning && now - s.at <= maxGapMs && (s.type === 'stopwatch' || s.endsAt > now);
    st.phase = s.phase;
    st.cycle = Math.min(12, s.cycle | 0);
    st.running = keepRunning;
    if (s.type === 'stopwatch') {
      st.swElapsedMs = s.swElapsedMs + (wasRunning && !keepRunning ? Math.max(0, s.at - s.swStartedAt) : 0);
      st.swStartedAt = keepRunning ? s.swStartedAt : now;
    } else {
      if (!(s.totalMs > 0)) return false;
      st.totalMs = s.totalMs;
      const left = wasRunning ? Math.max(0, s.endsAt - s.at) : s.remainingMs;
      st.remainingMs = Math.min(left > 0 ? left : s.totalMs, s.totalMs);
      st.endsAt = keepRunning ? s.endsAt : 0;
    }
    st.ranMs = s.ranMs + (wasRunning && !keepRunning ? Math.max(0, s.at - s.runAt) : 0);
    st.runAt = keepRunning ? s.runAt : now;
    st.sid = typeof s.sid === 'string' && /^[\w-]{4,40}$/.test(s.sid) ? s.sid : uid(10);
    return true;
  }

  /**
   * Take the timer over from another of your devices (its persisted() state). A run that
   * finished over there while this device wasn't looking finishes here on the next tick,
   * so both end up on the same next phase.
   */
  adopt(s, now = Date.now()) {
    const st = this.state;
    if (!s || !['pomodoro', 'countdown', 'stopwatch'].includes(s.type)) return false;
    const before = { ...st };
    const localRan = this.ran(now);
    st.type = s.type;
    // clocks on two devices never quite agree: don't let "saved in the future" throw it out
    if (!this.restore({ ...s, at: Math.min(Number(s.at) || 0, now) }, { now, maxGapMs: Infinity })) {
      Object.assign(st, before);
      return false;
    }
    if (s.running === true && s.type !== 'stopwatch' && s.endsAt <= now) {
      // it ran to the end (maybe with the other device shut): count it, unless that was hours ago
      const ranThere = now - s.endsAt < 6 * 3600e3 ? s.ranMs + Math.max(0, s.endsAt - s.runAt) : 0;
      st.running = true; st.endsAt = s.endsAt; st.remainingMs = 0;
      st.ranMs = Math.max(st.sid === before.sid ? localRan : 0, ranThere); st.runAt = now;
    } else if (st.sid === before.sid) { // the same run: keep whichever device saw more of it
      st.ranMs = Math.max(localRan, this.ran(now)); st.runAt = now;
    }
    this._changed('device', 'device');
    return true;
  }

  snapshot() {
    const st = this.state;
    return {
      type: st.type, phase: st.phase, running: st.running,
      remainingMs: st.type === 'stopwatch' ? 0 : this.value(),
      totalMs: st.totalMs, cycle: st.cycle,
      swElapsedMs: st.type === 'stopwatch' ? this.value() : 0,
    };
  }

  /** apply a friend's snapshot; latencyMs = estimated one-way delay */
  apply(snap, latencyMs = 0) {
    if (!snap) return;
    const st = this.state;
    const now = Date.now();
    // If our own countdown was about to finish and the friend's update already
    // moved past it, count it as finished here too (so both people log it).
    const before = { running: st.running, type: st.type, phase: st.phase, cycle: st.cycle, totalMs: st.totalMs, left: this.value(now) };
    if (before.running && before.type !== 'stopwatch' && before.left < 2500 &&
        (snap.phase !== before.phase || snap.cycle !== before.cycle || (!snap.running && snap.remainingMs >= snap.totalMs - 1000))) {
      this.emit('complete', { phase: before.phase, minutes: Math.min(before.totalMs, this.ran(now)) / 60000, type: before.type, sid: st.sid, viaSync: true });
    }
    const samePhase = snap.type === st.type && snap.phase === st.phase && snap.cycle === st.cycle;
    if (!samePhase) this._resetRun(now);
    else { st.ranMs = this.ran(now); st.runAt = now; }
    st.type = snap.type;
    st.phase = snap.phase;
    st.cycle = snap.cycle | 0;
    st.totalMs = snap.totalMs;
    st.running = !!snap.running;
    if (snap.type === 'stopwatch') {
      st.swElapsedMs = snap.swElapsedMs + (snap.running ? latencyMs : 0);
      st.swStartedAt = now;
    } else {
      const rem = Math.max(0, snap.remainingMs - (snap.running ? latencyMs : 0));
      st.remainingMs = rem;
      st.endsAt = now + rem;
    }
    this._changed('remote', 'remote');
  }
}
