export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function uid(len = 8) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => abc[b % abc.length]).join('');
}

/** mm:ss or h:mm:ss */
export function fmtTimer(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

/** "1h 25m" / "25m" / "0m" */
export function fmtDuration(min) {
  min = Math.round(min);
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  if (hh && mm) return `${hh}h ${mm}m`;
  if (hh) return `${hh}h`;
  return `${mm}m`;
}

export const dayKey = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Seeded PRNG (mulberry32) so procedural scenes look the same each load */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter((f) => f !== fn); }
  emit(ev, ...a) { (this._h[ev] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(e); } }); }
}

/* ---- connection log (for "Copy connection log": no names, emails or keys) ---- */
const NET_LOG = [];
export function netLog(...parts) {
  NET_LOG.push(`${new Date().toISOString().slice(11, 19)} ${parts.filter((p) => p !== '' && p != null).join(' ')}`);
  if (NET_LOG.length > 400) NET_LOG.shift();
}
export const netLogText = () => NET_LOG.join('\n');

/** how an RTCPeerConnection is actually connected, e.g. "srflx/udp → relay/udp" */
export async function pathOf(pc) {
  try {
    const stats = await pc.getStats();
    let pair = null;
    stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
    if (!pair) stats.forEach((r) => { if (!pair && r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
    if (!pair) return '?';
    const l = stats.get(pair.localCandidateId), r = stats.get(pair.remoteCandidateId);
    const rtt = pair.currentRoundTripTime != null ? ` rtt=${Math.round(pair.currentRoundTripTime * 1000)}ms` : '';
    return `${l?.candidateType}/${l?.protocol}${l?.relayProtocol ? `(${l.relayProtocol})` : ''} → ${r?.candidateType}/${r?.protocol}${rtt}`;
  } catch { return '?'; }
}
