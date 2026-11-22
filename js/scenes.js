/**
 * Backgrounds: hand-built animated canvas scenes + live nature videos + user uploads.
 */
import { seeded, rand } from './util.js?v=20261121c';

const TAU = Math.PI * 2;

/* ---------------- helpers ---------------- */
function makeCanvas(w, h, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [c, x];
}

function vgrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

function ridge(ctx, w, h, base, amp, rng, color, rough = 1) {
  const ph = [0, 0, 0, 0, 0].map(() => rng() * TAU);
  const fq = [0.8 + rng() * 1.2, 2.2 + rng() * 2, 5 + rng() * 4, 11 + rng() * 6, 23 + rng() * 9];
  const am = [1, 0.5, 0.22 * rough, 0.09 * rough, 0.04 * rough];
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w + 4; x += 3) {
    const u = x / w;
    let y = 0;
    for (let i = 0; i < 5; i++) y += Math.sin(u * fq[i] * Math.PI + ph[i]) * am[i];
    ctx.lineTo(x, base - y * amp);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function glow(ctx, x, y, r, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

function pine(ctx, x, base, height, color) {
  const w = height * 0.36;
  ctx.fillStyle = color;
  ctx.beginPath();
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const top = base - height + (i * height) / (tiers + 0.6);
    const bot = top + height * 0.42;
    const tw = w * (0.45 + (i / tiers) * 0.65);
    ctx.moveTo(x, top);
    ctx.lineTo(x + tw, bot);
    ctx.lineTo(x - tw, bot);
    ctx.closePath();
  }
  ctx.fill();
  ctx.fillRect(x - height * 0.025, base - height * 0.12, height * 0.05, height * 0.14);
}

function makeStars(rng, w, h, n, maxY = 0.7) {
  return Array.from({ length: n }, () => ({
    x: rng() * w, y: Math.pow(rng(), 1.4) * h * maxY, r: rng() < 0.08 ? 1.4 + rng() : 0.4 + rng() * 0.8,
    p: rng() * TAU, s: 0.5 + rng() * 2,
  }));
}

function drawStars(ctx, stars, t, base = 0.7) {
  ctx.fillStyle = '#fff';
  for (const s of stars) {
    ctx.globalAlpha = Math.max(0, base * (0.55 + 0.45 * Math.sin(t * s.s + s.p)));
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function cloudSprite(dpr, tint = '255,255,255') {
  const [c, x] = makeCanvas(400, 160, dpr);
  const rng = seeded(7);
  for (let i = 0; i < 14; i++) {
    const cx = 60 + rng() * 280, cy = 70 + rng() * 40 - Math.abs(cx - 200) * 0.12, r = 30 + rng() * 45;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${tint},0.55)`); g.addColorStop(1, `rgba(${tint},0)`);
    x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  return c;
}

function makeClouds(rng, w, h, n, yMin, yMax) {
  return Array.from({ length: n }, () => ({
    x: rng() * (w + 600) - 300, y: h * (yMin + rng() * (yMax - yMin)), s: 0.5 + rng() * 1.1,
    v: 3 + rng() * 6, a: 0.35 + rng() * 0.5,
  }));
}

function drawClouds(ctx, clouds, sprite, w, t) {
  const k = Math.min(1.3, Math.max(0.25, w / 1500));
  for (const c of clouds) {
    const span = w + 700 * k;
    const x = ((c.x * k + t * c.v * k) % span + span) % span - 350 * k;
    ctx.globalAlpha = c.a;
    ctx.drawImage(sprite, x, c.y, 400 * c.s * k, 160 * c.s * k);
  }
  ctx.globalAlpha = 1;
}

/* ---- falling snow and floating dust, used by scenes and laid over still photos ---- */
function makeFlakes(rng, w, h, n) {
  return Array.from({ length: n }, () => {
    const z = Math.pow(rng(), 1.8); // 0 far … 1 near
    return { x: rng() * w, y: rng() * h, r: 0.6 + z * 2.6, v: 18 + z * 60, a: 0.35 + z * 0.5, p: rng() * TAU, sw: 0.4 + rng() * 0.9, amp: 6 + z * 22 };
  });
}
function drawFlakes(ctx, flakes, t, dt, w, h, wind = 8) {
  ctx.fillStyle = '#fff';
  for (const f of flakes) {
    f.y += f.v * dt;
    if (f.y > h + 6) { f.y = -6; f.x = Math.random() * w; }
    const x = ((f.x + Math.sin(t * f.sw + f.p) * f.amp + t * wind * (f.r / 3)) % (w + 20) + w + 20) % (w + 20) - 10;
    ctx.globalAlpha = f.a;
    ctx.beginPath(); ctx.arc(x, f.y, f.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function makeMotes(rng, n, x0, y0, x1, y1) {
  return Array.from({ length: n }, () => ({ x: x0 + rng() * (x1 - x0), y: y0 + rng() * (y1 - y0), r: 0.5 + rng() * 1.6, p: rng() * TAU, s: 0.05 + rng() * 0.15, f: 0.4 + rng() * 1.2 }));
}
function drawMotes(ctx, motes, t, color = '255,226,170') {
  for (const m of motes) {
    const x = m.x + Math.sin(t * m.s + m.p) * 40, y = m.y + Math.cos(t * m.s * 0.8 + m.p) * 30 - Math.sin(t * 0.05 + m.p) * 20;
    ctx.globalAlpha = 0.25 + 0.55 * Math.pow(Math.max(0, Math.sin(t * m.f + m.p)), 2);
    ctx.fillStyle = `rgb(${color})`;
    ctx.beginPath(); ctx.arc(x, y, m.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* A snowy range: a row of peaks, each with its right-hand face in shadow (light from the left). */
function snowRange(ctx, w, h, rng, { base, top, n = 4, lit, low, shade, haze = null }) {
  const peaks = Array.from({ length: n }, (_, i) => ({
    x: ((i + 0.15 + rng() * 0.7) / n) * w * 1.1 - w * 0.05,
    y: top + Math.pow(rng(), 1.3) * (base - top) * 0.5,
    l: 0.55 + rng() * 0.5, r: 0.6 + rng() * 0.55, // slopes, rise over run
  }));
  // crags along the skyline: a few octaves of noise, stronger on the steep upper slopes
  const ph = Array.from({ length: 4 }, () => rng() * TAU);
  const noise = (x) => Math.sin(x * 0.011 + ph[0]) * 9 + Math.sin(x * 0.029 + ph[1]) * 5 + Math.sin(x * 0.071 + ph[2]) * 2.5 + Math.sin(x * 0.17 + ph[3]) * 1.2;
  const prof = (pk, x) => pk.y + (x < pk.x ? (pk.x - x) * pk.l : (x - pk.x) * pk.r);
  const yAt = (x) => {
    let y = base;
    for (const pk of peaks) y = Math.min(y, prof(pk, x));
    return Math.min(base, y + noise(x) * Math.min(1, (y - top + 20) / 120) * (h / 900));
  };
  ctx.beginPath();
  ctx.moveTo(-10, h);
  for (let x = -10; x <= w + 10; x += 3) ctx.lineTo(x, yAt(x));
  ctx.lineTo(w + 10, h);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, top, base, [[0, lit], [1, low]]);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shade;
  for (const pk of peaks) {
    const py = yAt(pk.x), drop = base + 40 - py;
    // down the right-hand skyline, then back up a crooked gully to the summit
    ctx.beginPath();
    ctx.moveTo(pk.x, py);
    for (let x = pk.x; x <= pk.x + drop / pk.r; x += 3) ctx.lineTo(x, Math.max(prof(pk, x), yAt(x)) - 1);
    const gx = pk.x + (drop / pk.r) * (0.12 + rng() * 0.22);
    const steps = 9;
    for (let k = steps; k >= 1; k--) {
      const u = k / steps;
      ctx.lineTo(pk.x + (gx - pk.x) * u + (rng() - 0.5) * drop * 0.06 * u, py + drop * u);
    }
    ctx.closePath();
    ctx.fill();
  }
  if (haze) { ctx.fillStyle = vgrad(ctx, top, base, [[0, 'rgba(0,0,0,0)'], [1, haze]]); ctx.fillRect(0, top, w, base - top + 2); }
  ctx.restore();
}

/* Two people standing hand in hand, seen from behind. x = between them, g = ground, H = height of the taller one. */
function couple(ctx, x, g, H, color) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const gap = 0.19 * H;
  const hand = [x, g - 0.47 * H];
  const fig = (cx, Hh, she, side) => { // side: -1 the left one, +1 the right one
    const r = 0.068 * Hh, hy = g - Hh + r;
    const sy = g - 0.82 * Hh, sw = (she ? 0.095 : 0.118) * Hh;
    const wy = g - 0.55 * Hh, hipY = g - 0.45 * Hh;
    // legs
    ctx.lineWidth = (she ? 0.05 : 0.072) * Hh;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * 0.035 * Hh, hipY); ctx.lineTo(cx + s * 0.052 * Hh, g - ctx.lineWidth / 2); ctx.stroke(); }
    // torso (a coat that flares a little; hers to the knee)
    const hemY = she ? g - 0.22 * Hh : g - 0.4 * Hh, hemW = she ? 0.13 * Hh : 0.09 * Hh;
    ctx.beginPath();
    ctx.moveTo(cx - sw, sy + 0.03 * Hh);
    ctx.quadraticCurveTo(cx - sw, sy - 0.012 * Hh, cx - sw * 0.5, sy - 0.015 * Hh);
    ctx.lineTo(cx + sw * 0.5, sy - 0.015 * Hh);
    ctx.quadraticCurveTo(cx + sw, sy - 0.012 * Hh, cx + sw, sy + 0.03 * Hh);
    ctx.lineTo(cx + (she ? 0.07 : 0.085) * Hh, wy);
    ctx.lineTo(cx + hemW, hemY);
    ctx.lineTo(cx - hemW, hemY);
    ctx.lineTo(cx - (she ? 0.07 : 0.085) * Hh, wy);
    ctx.closePath(); ctx.fill();
    // neck and head
    ctx.fillRect(cx - r * 0.45, hy + r * 0.5, r * 0.9, sy - hy);
    ctx.beginPath(); ctx.arc(cx, hy, r, 0, TAU); ctx.fill();
    if (she) { // long hair falling to the shoulders
      ctx.beginPath(); ctx.ellipse(cx, hy + r * 0.9, r * 1.12, r * 1.75, 0, 0, TAU); ctx.fill();
    } else { // a woolly hat with a bobble
      ctx.beginPath(); ctx.ellipse(cx, hy - r * 0.25, r * 1.08, r * 0.95, 0, Math.PI, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, hy - r * 1.3, r * 0.38, 0, TAU); ctx.fill();
    }
    // outer arm hangs loose
    ctx.lineWidth = 0.052 * Hh;
    const os = -side;
    ctx.beginPath(); ctx.moveTo(cx + os * sw * 0.85, sy + 0.03 * Hh);
    ctx.quadraticCurveTo(cx + os * (sw + 0.035 * Hh), sy + 0.2 * Hh, cx + os * (sw + 0.012 * Hh), g - 0.47 * Hh); ctx.stroke();
    // inner arm reaches for the other's hand
    ctx.beginPath(); ctx.moveTo(cx + side * sw * 0.85, sy + 0.03 * Hh);
    ctx.quadraticCurveTo(cx + side * (sw + 0.01 * Hh), sy + 0.2 * Hh, hand[0], hand[1]); ctx.stroke();
  };
  fig(x - gap, H, false, 1);
  fig(x + gap, H * 0.93, true, -1);
  ctx.beginPath(); ctx.arc(hand[0], hand[1], 0.034 * H, 0, TAU); ctx.fill();
}
// her scarf end, lifting in the wind
function scarf(ctx, x, g, H, color, t) {
  const Hh = H * 0.93, cx = x + 0.19 * H;
  const sy = g - 0.82 * Hh;
  ctx.fillStyle = color;
  const n = 9, len = 0.2 * H;
  ctx.beginPath();
  const top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const px = cx + 0.06 * Hh + u * len, py = sy - 0.005 * Hh + u * 0.05 * H + Math.sin(t * 2.6 - u * 5) * u * 0.035 * H;
    const wdt = 0.028 * H * (1 - u * 0.55);
    top.push([px, py - wdt / 2]); bot.push([px, py + wdt / 2]);
  }
  ctx.moveTo(cx - 0.02 * Hh, sy - 0.012 * Hh);
  for (const [a, b] of top) ctx.lineTo(a, b);
  for (const [a, b] of bot.reverse()) ctx.lineTo(a, b);
  ctx.lineTo(cx - 0.02 * Hh, sy + 0.02 * Hh);
  ctx.closePath(); ctx.fill();
}

// the ledge the couple stands on: a snowy knoll on the right
function knoll(ctx, w, h, g, x0, x1, snowTop, snowLow, shadow) {
  ctx.beginPath();
  ctx.moveTo(x0 - w * 0.25, h);
  ctx.bezierCurveTo(x0 - w * 0.05, h, x0 - w * 0.02, g + 6, x0 + w * 0.04, g + 2);
  ctx.bezierCurveTo(x0 + (x1 - x0) * 0.4, g - 6, x0 + (x1 - x0) * 0.7, g - 3, x1, g + 4);
  ctx.bezierCurveTo(x1 + w * 0.06, g + 12, w + 10, g + h * 0.03, w + 10, g + h * 0.04);
  ctx.lineTo(w + 10, h);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, g - 6, h, [[0, snowTop], [1, snowLow]]);
  ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.moveTo(x0 - w * 0.25, h);
  ctx.bezierCurveTo(x0 - w * 0.05, h, x0 - w * 0.02, g + 6, x0 + w * 0.04, g + 2);
  ctx.bezierCurveTo(x0 + w * 0.03, g + h * 0.08, x0, h, x0 + w * 0.08, h);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* Eiffel Tower: x = centre, g = ground, H = height. Returns a function giving its half-width at height fraction u. */
function eiffel(ctx, x, g, H, color, lattice) {
  const hw = (u) => H * (0.17 * Math.pow(1 - u, 2.5) + 0.018 * (1 - u) + 0.005);
  const P1 = 0.17, P2 = 0.36, P3 = 0.82;
  ctx.fillStyle = color;
  ctx.beginPath();
  const N = 60;
  for (let i = 0; i <= N; i++) { const u = (i / N) * P3; ctx[i ? 'lineTo' : 'moveTo'](x - hw(u), g - u * H); }
  for (let i = N; i >= 0; i--) { const u = (i / N) * P3; ctx.lineTo(x + hw(u), g - u * H); }
  ctx.closePath();
  // the great arch between the legs
  const aw = hw(0) * 0.62;
  ctx.moveTo(x - aw, g);
  ctx.bezierCurveTo(x - aw * 0.95, g - P1 * H * 0.75, x - aw * 0.35, g - P1 * H * 0.8, x, g - P1 * H * 0.8);
  ctx.bezierCurveTo(x + aw * 0.35, g - P1 * H * 0.8, x + aw * 0.95, g - P1 * H * 0.75, x + aw, g);
  ctx.closePath();
  // the open space between the first and second floors
  const ow = hw(P1 + 0.03) * 0.55;
  ctx.moveTo(x - ow, g - (P1 + 0.025) * H);
  ctx.lineTo(x - hw(P2 - 0.02) * 0.5, g - (P2 - 0.03) * H);
  ctx.lineTo(x + hw(P2 - 0.02) * 0.5, g - (P2 - 0.03) * H);
  ctx.lineTo(x + ow, g - (P1 + 0.025) * H);
  ctx.closePath();
  ctx.fill('evenodd');
  // the floors
  for (const [u, k, th] of [[P1, 1.12, 0.022], [P2, 1.2, 0.016], [P3, 1.6, 0.01]]) ctx.fillRect(x - hw(u) * k, g - u * H - th * H, hw(u) * k * 2, th * H);
  // the spire
  ctx.beginPath();
  ctx.moveTo(x - hw(P3) * 0.8, g - P3 * H - 0.01 * H);
  ctx.lineTo(x - H * 0.006, g - 0.94 * H);
  ctx.lineTo(x - H * 0.002, g - H);
  ctx.lineTo(x + H * 0.002, g - H);
  ctx.lineTo(x + H * 0.006, g - 0.94 * H);
  ctx.lineTo(x + hw(P3) * 0.8, g - P3 * H - 0.01 * H);
  ctx.closePath(); ctx.fill();
  // cross-bracing
  if (lattice) {
    ctx.strokeStyle = lattice; ctx.lineWidth = Math.max(0.6, H * 0.0025);
    ctx.beginPath();
    for (let u = 0.02; u < P3 - 0.02; u += 0.028) {
      const u2 = u + 0.028;
      if (u < P1 * 0.8) { // only on the legs
        for (const s of [-1, 1]) {
          const a = hw(u), b = hw(u2), ia = Math.max(aw * (1 - u / (P1 * 0.8)) ** 0.5, a * 0.5), ib = Math.max(aw * (1 - u2 / (P1 * 0.8)) ** 0.5, b * 0.5);
          ctx.moveTo(x + s * a, g - u * H); ctx.lineTo(x + s * ib, g - u2 * H);
          ctx.moveTo(x + s * ia, g - u * H); ctx.lineTo(x + s * b, g - u2 * H);
        }
      } else {
        const a = hw(u), b = hw(u2);
        ctx.moveTo(x - a, g - u * H); ctx.lineTo(x + b, g - u2 * H);
        ctx.moveTo(x + a, g - u * H); ctx.lineTo(x - b, g - u2 * H);
      }
    }
    ctx.stroke();
  }
  return { hw, top: g - H, deck: g - P3 * H };
}

/* Paris rooftops: zinc mansard roofs with dormers and chimney pots, some windows lit. */
function parisRoofs(ctx, w, h, rng, top, { roof, wall, lit, lights }) {
  let x = -10;
  while (x < w + 10) {
    const bw = h * (0.12 + rng() * 0.14);
    const wallTop = top + rng() * h * 0.05;
    const rh = h * (0.035 + rng() * 0.02), inset = rh * 0.55;
    ctx.fillStyle = wall; ctx.fillRect(x, wallTop, bw + 1, h - wallTop);
    // windows on the façade
    const rows = Math.ceil((h - wallTop) / (h * 0.055));
    const cols = Math.max(2, Math.round(bw / (h * 0.03)));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (rng() < 0.42) {
        const wx = x + (c + 0.3) * (bw / cols), wy = wallTop + h * 0.015 + r * h * 0.055, ww = (bw / cols) * 0.42, wh = h * 0.028;
        ctx.fillStyle = lit[Math.floor(rng() * lit.length)];
        ctx.globalAlpha = 0.55 + rng() * 0.45; ctx.fillRect(wx, wy, ww, wh); ctx.globalAlpha = 1;
        if (lights && rng() < 0.15) lights.push({ x: wx, y: wy, w: ww, h: wh, on: true, next: rng() * 30 });
      }
    }
    // mansard roof
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x - 2, wallTop); ctx.lineTo(x + inset, wallTop - rh); ctx.lineTo(x + bw - inset, wallTop - rh); ctx.lineTo(x + bw + 2, wallTop);
    ctx.closePath(); ctx.fill();
    // dormers
    const nd = Math.max(1, Math.floor((bw - inset * 2) / (h * 0.035)));
    for (let d = 0; d < nd; d++) {
      const dx = x + inset + ((d + 0.5) * (bw - inset * 2)) / nd, dw = h * 0.012, dy = wallTop - rh * 0.55;
      ctx.fillStyle = roof;
      ctx.beginPath(); ctx.moveTo(dx - dw * 1.2, dy); ctx.lineTo(dx, dy - dw * 1.3); ctx.lineTo(dx + dw * 1.2, dy); ctx.lineTo(dx + dw, wallTop); ctx.lineTo(dx - dw, wallTop); ctx.closePath(); ctx.fill();
      if (rng() < 0.5) { ctx.fillStyle = lit[0]; ctx.globalAlpha = 0.85; ctx.fillRect(dx - dw * 0.55, dy + 1, dw * 1.1, wallTop - dy - 3); ctx.globalAlpha = 1; }
    }
    // chimney stacks with little pots
    ctx.fillStyle = roof;
    const nc = 1 + Math.floor(rng() * 2);
    for (let c = 0; c < nc; c++) {
      const cx = x + inset + rng() * (bw - inset * 2 - h * 0.03), ch = h * (0.02 + rng() * 0.02), cw = h * (0.018 + rng() * 0.02);
      ctx.fillRect(cx, wallTop - rh - ch, cw, ch + 2);
      for (let p = 0; p < Math.floor(cw / (h * 0.006)); p++) ctx.fillRect(cx + 1 + p * h * 0.006, wallTop - rh - ch - h * 0.006, h * 0.0035, h * 0.006);
    }
    x += bw + rng() * h * 0.01;
  }
}

/* An Italian stone pine: a crooked trunk under a wide flat-topped canopy. */
function stonePine(ctx, x, g, H, rng, color) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round';
  const lean = (rng() - 0.5) * H * 0.35;
  const cx = x + lean, cy = g - H * 0.82;
  ctx.lineWidth = H * 0.035;
  ctx.beginPath(); ctx.moveTo(x, g); ctx.quadraticCurveTo(x + lean * 0.2, g - H * 0.5, cx, cy + H * 0.08); ctx.stroke();
  ctx.lineWidth = H * 0.018;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx - lean * 0.1, cy + H * 0.12); ctx.quadraticCurveTo(cx + s * H * 0.1, cy + H * 0.04, cx + s * H * 0.22, cy + H * 0.02); ctx.stroke(); }
  const cw = H * (0.42 + rng() * 0.18);
  for (let i = 0; i < 14; i++) {
    const u = (i / 13 - 0.5) * 2;
    ctx.beginPath();
    ctx.ellipse(cx + u * cw * 0.85, cy - Math.abs(u) * H * -0.03 + (rng() - 0.5) * H * 0.03, cw * (0.2 + rng() * 0.12), H * (0.07 + rng() * 0.04), 0, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(cx, cy - H * 0.03, cw * 0.75, H * 0.08, 0, 0, TAU); ctx.fill();
}
function cypress(ctx, x, g, H, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, g - H);
  ctx.bezierCurveTo(x + H * 0.1, g - H * 0.7, x + H * 0.09, g - H * 0.15, x + H * 0.02, g);
  ctx.lineTo(x - H * 0.02, g);
  ctx.bezierCurveTo(x - H * 0.09, g - H * 0.15, x - H * 0.1, g - H * 0.7, x, g - H);
  ctx.fill();
}
// a dome on a drum, with a lantern on top (St Peter's and its smaller cousins)
function dome(ctx, x, g, R, color, { drum = 0.55, lantern = true, cross = true } = {}) {
  ctx.fillStyle = color;
  ctx.fillRect(x - R * 1.08, g - R * drum, R * 2.16, R * drum + 1);
  ctx.fillRect(x - R * 1.2, g - R * drum - R * 0.06, R * 2.4, R * 0.08);
  const dy = g - R * drum - R * 0.05;
  ctx.beginPath();
  ctx.moveTo(x - R, dy);
  ctx.bezierCurveTo(x - R, dy - R * 0.9, x - R * 0.35, dy - R * 1.12, x, dy - R * 1.15);
  ctx.bezierCurveTo(x + R * 0.35, dy - R * 1.12, x + R, dy - R * 0.9, x + R, dy);
  ctx.closePath(); ctx.fill();
  if (lantern) {
    const ly = dy - R * 1.12;
    ctx.fillRect(x - R * 0.13, ly - R * 0.32, R * 0.26, R * 0.34);
    ctx.beginPath(); ctx.ellipse(x, ly - R * 0.32, R * 0.15, R * 0.12, 0, Math.PI, TAU); ctx.fill();
    if (cross) { ctx.fillRect(x - R * 0.015, ly - R * 0.62, R * 0.03, R * 0.2); ctx.fillRect(x - R * 0.07, ly - R * 0.56, R * 0.14, R * 0.03); }
  }
}
function campanile(ctx, x, g, H, color) {
  ctx.fillStyle = color;
  const bw = H * 0.16;
  ctx.fillRect(x - bw / 2, g - H, bw, H);
  ctx.fillRect(x - bw * 0.6, g - H, bw * 1.2, H * 0.04);
  ctx.beginPath(); ctx.moveTo(x - bw * 0.5, g - H); ctx.lineTo(x, g - H * 1.22); ctx.lineTo(x + bw * 0.5, g - H); ctx.fill();
}

/* The Colosseum against the sky: three tiers of arches and an attic, broken down on one side. */
function colosseum(w, h, dpr, x0, x1, g, H, color) {
  const [c, x] = makeCanvas(w, h, dpr);
  const W = x1 - x0, cx = (x0 + x1) / 2;
  x.fillStyle = color;
  x.beginPath();
  x.moveTo(x0, g);
  x.lineTo(x0, g - H);
  x.lineTo(x0 + W * 0.58, g - H);
  // the ruined edge stepping down to the second tier
  x.lineTo(x0 + W * 0.62, g - H * 0.9); x.lineTo(x0 + W * 0.66, g - H * 0.86); x.lineTo(x0 + W * 0.7, g - H * 0.74);
  x.lineTo(x0 + W * 0.76, g - H * 0.7); x.lineTo(x0 + W * 0.84, g - H * 0.6); x.lineTo(x0 + W * 0.92, g - H * 0.55); x.lineTo(x1, g - H * 0.5);
  x.lineTo(x1, g);
  x.closePath(); x.fill();
  // arches, bunched toward the edges as the wall curves away
  x.globalCompositeOperation = 'destination-out';
  const tiers = [[0, 0.26], [0.26, 0.52], [0.52, 0.78]];
  const n = 13;
  tiers.forEach(([a, b], ti) => {
    for (let i = 0; i < n; i++) {
      const th = ((i + 0.5) / n - 0.5) * Math.PI * 0.86;
      const ax = cx + Math.sin(th) * W * 0.5, k = Math.cos(th);
      const aw = (W / n) * 0.55 * k * 1.25, ah = (b - a) * H * 0.7;
      const ay = g - a * H - (b - a) * H * 0.12;
      const topAt = ax > x0 + W * 0.58 ? (ax > x0 + W * 0.9 ? 0.5 : ax > x0 + W * 0.7 ? 0.68 : 0.86) : 1;
      if (b > topAt - 0.04) continue;
      x.globalAlpha = ti === 0 ? 0.55 : 0.9;
      x.beginPath();
      x.moveTo(ax - aw / 2, ay);
      x.lineTo(ax - aw / 2, ay - ah + aw / 2);
      x.arc(ax, ay - ah + aw / 2, aw / 2, Math.PI, TAU);
      x.lineTo(ax + aw / 2, ay);
      x.closePath(); x.fill();
    }
  });
  // small windows in the attic
  for (let i = 0; i < n; i++) {
    const th = ((i + 0.5) / n - 0.5) * Math.PI * 0.86;
    const ax = cx + Math.sin(th) * W * 0.5;
    if (ax > x0 + W * 0.56) continue;
    const k = Math.cos(th);
    x.globalAlpha = 0.9;
    x.fillRect(ax - (W / n) * 0.12 * k, g - H * 0.9, (W / n) * 0.24 * k, H * 0.06);
  }
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  return c;
}

/* A murmuration: a cloud of birds whose shape keeps folding and stretching. */
function makeFlock(rng, n) {
  return Array.from({ length: n }, () => {
    const a = rng() * TAU, r = Math.sqrt(rng());
    return { ox: Math.cos(a) * r, oy: Math.sin(a) * r, p: rng() * TAU, s: 0.6 + rng() * 0.8 };
  });
}
function drawFlock(ctx, flock, t, cx, cy, size, color) {
  ctx.fillStyle = color;
  const rot = Math.sin(t * 0.09) * 1.2, sx = 1 + 0.6 * Math.sin(t * 0.13), sy = 0.35 + 0.25 * Math.sin(t * 0.17 + 1);
  const bend = Math.sin(t * 0.11 + 2) * 0.8;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (const b of flock) {
    let x = b.ox * sx * size, y = (b.oy * sy + bend * b.ox * b.ox * 0.5) * size;
    x += Math.sin(t * b.s + b.p) * size * 0.04; y += Math.cos(t * b.s * 1.3 + b.p) * size * 0.03;
    const px = cx + x * cr - y * sr, py = cy + x * sr + y * cr;
    ctx.fillRect(px, py, 1.6, 1.6);
  }
}

// bookshelf full of books, between x0 and x1, from top to bottom
function bookshelf(ctx, rng, x0, x1, top, bottom, rowH, { wood, dark }) {
  ctx.fillStyle = wood;
  ctx.fillRect(x0, top, x1 - x0, bottom - top);
  const palette = ['#6b2a2a', '#7c3b25', '#2f4a3a', '#24384f', '#5a4a2a', '#4a2b45', '#8a6a3a', '#3b2a22', '#5c1f24', '#2a3b33', '#7a5a2e', '#3c3f5a'];
  for (let y = top + rowH * 0.2; y + rowH < bottom; y += rowH) {
    ctx.fillStyle = dark;
    ctx.fillRect(x0 + rowH * 0.06, y, x1 - x0 - rowH * 0.12, rowH * 0.9);
    let bx = x0 + rowH * 0.08;
    while (bx < x1 - rowH * 0.12) {
      const bw = rowH * (0.08 + rng() * 0.1);
      if (bx + bw > x1 - rowH * 0.1) break;
      if (rng() < 0.05) { bx += bw * 1.5; continue; } // a gap
      const bh = rowH * (0.62 + rng() * 0.26);
      const col = palette[Math.floor(rng() * palette.length)];
      const by = y + rowH * 0.9 - bh;
      if (rng() < 0.04) { // one leaning over
        ctx.save(); ctx.translate(bx, y + rowH * 0.9); ctx.rotate(0.28);
        ctx.fillStyle = col; ctx.fillRect(0, -bh, bw, bh); ctx.restore();
        bx += bw + bh * 0.28; continue;
      }
      ctx.fillStyle = col; ctx.fillRect(bx, by, bw - 0.6, bh);
      ctx.fillStyle = 'rgba(255,220,160,0.22)';
      ctx.fillRect(bx, by + bh * 0.14, bw - 0.6, Math.max(1, bh * 0.025));
      ctx.fillRect(bx, by + bh * 0.8, bw - 0.6, Math.max(1, bh * 0.025));
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(bx + bw * 0.7, by, bw * 0.3 - 0.6, bh);
      bx += bw;
    }
    // the shelf board
    ctx.fillStyle = wood; ctx.fillRect(x0, y + rowH * 0.9, x1 - x0, rowH * 0.1);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x0, y + rowH * 0.98, x1 - x0, rowH * 0.03);
  }
  // shade toward the top, where the lamp doesn't reach
  ctx.fillStyle = vgrad(ctx, top, bottom, [[0, 'rgba(10,5,2,0.6)'], [0.6, 'rgba(10,5,2,0.15)'], [1, 'rgba(10,5,2,0.3)']]);
  ctx.fillRect(x0, top, x1 - x0, bottom - top);
}

/* Snowy peaks with two people hand in hand; `night` swaps the dusk glow for moonlight. */
function alpine(night) {
  const P = night ? {
    sky: [[0, '#040817'], [0.45, '#0e1d42'], [0.8, '#26406e'], [1, '#3b5a8a']],
    far: { lit: '#dce8ff', low: '#5d78ab', shade: 'rgba(28,44,92,0.62)', haze: 'rgba(60,90,140,0.55)' },
    mid: { lit: '#b9cdf2', low: '#3a5282', shade: 'rgba(18,30,66,0.6)', haze: 'rgba(40,64,110,0.5)' },
    snowTop: '#c9d9f5', snowLow: '#7d97c6', snowShade: 'rgba(40,62,112,0.55)',
    person: '#060a17', mist: '120,150,200', cloud: '170,190,230',
  } : {
    sky: [[0, '#241b4d'], [0.35, '#5b3f86'], [0.62, '#d87fa0'], [0.85, '#ffc09a'], [1, '#ffe0b8']],
    far: { lit: '#ffe1e4', low: '#b89cc9', shade: 'rgba(110,86,160,0.55)', haze: 'rgba(206,160,200,0.6)' },
    mid: { lit: '#f3e2f0', low: '#8f84bb', shade: 'rgba(80,66,138,0.55)', haze: 'rgba(160,130,190,0.5)' },
    snowTop: '#fbeef4', snowLow: '#b7b1dc', snowShade: 'rgba(118,104,176,0.5)',
    person: '#1b1030', mist: '255,214,226', cloud: '255,205,215',
  };
  return {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(night ? 307 : 293);
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, 0, h * 0.75, P.sky); b.fillRect(0, 0, w, h);
      if (night) {
        glow(b, w * 0.24, h * 0.17, h * 0.42, 'rgba(170,200,255,0.16)');
        glow(b, w * 0.24, h * 0.17, h * 0.045, 'rgba(250,252,255,1)');
      } else {
        glow(b, w * 0.3, h * 0.62, h * 0.6, 'rgba(255,200,160,0.5)');
      }
      s.stars = makeStars(rng, w, h, night ? 240 : 70, night ? 0.6 : 0.3);
      s.sprite = cloudSprite(dpr, P.cloud);
      s.clouds = makeClouds(rng, w, h, night ? 3 : 6, 0.08, 0.32);
      [s.front, s.fx] = makeCanvas(w, h, dpr);
      const f = s.fx;
      snowRange(f, w, h, rng, { base: h * 0.8, top: h * 0.22, n: w < h ? 3 : 5, ...P.far });
      f.fillStyle = vgrad(f, h * 0.62, h * 0.86, [[0, `rgba(${P.mist},0)`], [0.6, `rgba(${P.mist},0.35)`], [1, `rgba(${P.mist},0)`]]);
      f.fillRect(0, h * 0.62, w, h * 0.24);
      snowRange(f, w, h, rng, { base: h * 0.95, top: h * 0.55, n: w < h ? 3 : 6, ...P.mid });
      // the pines lower down
      for (let i = 0; i < 40; i++) pine(f, rng() * w * 0.55, h * (0.9 + rng() * 0.1), h * (0.05 + rng() * 0.07), night ? '#0b1430' : '#3a2a58');
      const g = h * 0.8, H = Math.min(h * 0.16, w * 0.17);
      const cx = w * (w < h ? 0.68 : 0.74);
      knoll(f, w, h, g, cx - H * 1.1, cx + H * 1.4, P.snowTop, P.snowLow, P.snowShade);
      for (let i = 0; i < 9; i++) pine(f, rng() * w * 0.3, h * (1 + rng() * 0.04), h * (0.14 + rng() * 0.12), night ? '#050a1a' : '#24183c');
      couple(f, cx, g + 1, H, P.person);
      s.cp = { x: cx, g: g + 1, H };
      s.flakes = makeFlakes(rng, w, h, Math.round((w * h) / (night ? 14000 : 9000)));
      s.shoot = null; s.nextShoot = 4;
    },
    draw(s, ctx, t, dt) {
      const { w, h } = s;
      ctx.drawImage(s.back, 0, 0, w, h);
      drawStars(ctx, s.stars, t, night ? 0.9 : 0.4);
      if (night) {
        if (!s.shoot && t > s.nextShoot) s.shoot = { x: rand(w * 0.3, w * 0.8), y: rand(0, h * 0.25), t0: t, d: Math.random() < 0.5 ? -1 : 1 };
        if (s.shoot) {
          const k = (t - s.shoot.t0) / 0.9;
          if (k > 1) { s.shoot = null; s.nextShoot = t + rand(6, 14); } else {
            const x = s.shoot.x + k * 240 * s.shoot.d, y = s.shoot.y + k * 100;
            const g = ctx.createLinearGradient(x, y, x - 90 * s.shoot.d, y - 38);
            g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - k)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.strokeStyle = g; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 90 * s.shoot.d, y - 38); ctx.stroke();
          }
        }
      }
      drawClouds(ctx, s.clouds, s.sprite, w, t);
      ctx.drawImage(s.front, 0, 0, w, h);
      scarf(ctx, s.cp.x, s.cp.g, s.cp.H, P.person, t);
      drawFlakes(ctx, s.flakes, t, dt, w, h, night ? 4 : 10);
    },
  };
}

/* ---------------- scene implementations ---------------- */
const IMPL = {
  summit: alpine(false),
  moonpeak: alpine(true),

  library: {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(41);
      const ww = Math.min(w * 0.3, h * 0.5), cx = w / 2;
      const x0 = cx - ww / 2, x1 = cx + ww / 2, top = h * 0.07, bot = h * 0.64, ar = ww / 2;
      const win = (c) => { c.beginPath(); c.moveTo(x0, bot); c.lineTo(x0, top + ar); c.arc(cx, top + ar, ar, Math.PI, TAU); c.lineTo(x1, bot); c.closePath(); };
      s.win = { x0, top, ww, wh: bot - top };
      // what's outside: a snowy town at night
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, top, bot, [[0, '#0a1230'], [0.6, '#24345e'], [1, '#41527c']]); b.fillRect(0, 0, w, h);
      glow(b, cx + ww * 0.22, top + ar * 0.8, ww * 0.5, 'rgba(190,210,255,0.22)');
      glow(b, cx + ww * 0.22, top + ar * 0.8, ww * 0.05, 'rgba(245,248,255,1)');
      s.stars = makeStars(rng, w, h, 60, 0.4);
      parisRoofs(b, w, h, rng, bot - (bot - top) * 0.2, { roof: '#1a2546', wall: '#131b36', lit: ['#ffcf80', '#ffb860', '#ffe0a0'], lights: null });
      b.fillStyle = 'rgba(220,232,255,0.5)'; // snow lying on the roofs
      for (let i = 0; i < 40; i++) b.fillRect(x0 + rng() * ww, bot - (bot - top) * (0.12 + rng() * 0.12), 4 + rng() * 14, 1.5);
      s.flakes = makeFlakes(rng, ww, bot - top, 90);
      // the room
      [s.front, s.fx] = makeCanvas(w, h, dpr);
      const f = s.fx;
      f.fillStyle = vgrad(f, 0, h, [[0, '#1a0f09'], [0.6, '#2e1c11'], [1, '#1a0f09']]); f.fillRect(0, 0, w, h);
      f.globalCompositeOperation = 'destination-out'; win(f); f.fill(); f.globalCompositeOperation = 'source-over';
      // window frame and glazing bars
      f.strokeStyle = '#3d2615'; f.lineWidth = ww * 0.05; win(f); f.stroke();
      f.lineWidth = Math.max(2, ww * 0.016);
      f.beginPath();
      f.moveTo(cx, top); f.lineTo(cx, bot);
      for (const u of [0.42, 0.66, 0.86]) { f.moveTo(x0, top + (bot - top) * u); f.lineTo(x1, top + (bot - top) * u); }
      f.moveTo(x0, top + ar); f.lineTo(x1, top + ar);
      f.stroke();
      f.fillStyle = '#4a2e1a'; f.fillRect(x0 - ww * 0.08, bot, ww * 1.16, h * 0.02);
      // shelves either side
      const rowH = Math.max(46, h * 0.12);
      bookshelf(f, rng, -4, x0 - ww * 0.2, h * 0.02, h * 0.98, rowH, { wood: '#3b2415', dark: '#140a05' });
      bookshelf(f, rng, x1 + ww * 0.2, w + 4, h * 0.02, h * 0.98, rowH, { wood: '#3b2415', dark: '#140a05' });
      // the desk
      const dy = h * 0.76, dx0 = w * 0.1, dx1 = w * 0.9;
      f.fillStyle = vgrad(f, dy, h, [[0, '#4a2d18'], [0.05, '#2c190c'], [1, '#120904']]);
      f.fillRect(dx0, dy, dx1 - dx0, h - dy);
      f.fillStyle = '#5b3920'; f.fillRect(dx0 - 6, dy - h * 0.012, dx1 - dx0 + 12, h * 0.018);
      const sc = Math.min(w, h * 1.5) / 1000; // object scale
      // a banker's lamp
      const lx = cx - ww * 0.78, ly = dy - h * 0.012;
      f.fillStyle = '#b08a3a';
      f.beginPath(); f.ellipse(lx, ly, 70 * sc, 14 * sc, 0, 0, TAU); f.fill();
      f.fillRect(lx - 4 * sc, ly - 150 * sc, 8 * sc, 150 * sc);
      const shY = ly - 160 * sc;
      f.fillStyle = vgrad(f, shY - 30 * sc, shY + 22 * sc, [[0, '#2f8a5c'], [0.5, '#1b5c3b'], [1, '#0e3822']]);
      f.beginPath();
      f.moveTo(lx - 110 * sc, shY + 22 * sc);
      f.quadraticCurveTo(lx - 100 * sc, shY - 32 * sc, lx, shY - 34 * sc);
      f.quadraticCurveTo(lx + 100 * sc, shY - 32 * sc, lx + 110 * sc, shY + 22 * sc);
      f.closePath(); f.fill();
      f.fillStyle = '#ffe9b8'; f.fillRect(lx - 104 * sc, shY + 20 * sc, 208 * sc, 5 * sc);
      s.lamp = { x: lx, y: shY + 24 * sc, sc };
      // an open book
      const bx = cx - ww * 0.05;
      f.fillStyle = '#e7d9bb';
      f.beginPath(); f.moveTo(bx - 150 * sc, dy - 6 * sc); f.lineTo(bx - 140 * sc, dy - 26 * sc); f.quadraticCurveTo(bx - 60 * sc, dy - 34 * sc, bx, dy - 22 * sc); f.lineTo(bx, dy - 2 * sc); f.closePath(); f.fill();
      f.fillStyle = '#d8c8a6';
      f.beginPath(); f.moveTo(bx + 150 * sc, dy - 6 * sc); f.lineTo(bx + 140 * sc, dy - 26 * sc); f.quadraticCurveTo(bx + 60 * sc, dy - 34 * sc, bx, dy - 22 * sc); f.lineTo(bx, dy - 2 * sc); f.closePath(); f.fill();
      f.strokeStyle = 'rgba(80,60,40,0.35)'; f.lineWidth = 1;
      for (let i = 0; i < 6; i++) for (const sd of [-1, 1]) { const yy = dy - 22 * sc + i * 3 * sc; f.beginPath(); f.moveTo(bx + sd * 20 * sc, yy - 6 * sc); f.lineTo(bx + sd * 125 * sc, yy); f.stroke(); }
      // a stack of books
      const kx = cx + ww * 0.62;
      [['#6b2a2a', 190], ['#24384f', 170], ['#7a5a2e', 180], ['#2f4a3a', 150]].forEach(([col, bw], i) => {
        f.fillStyle = col; f.fillRect(kx - (bw * sc) / 2 + (i % 2) * 8 * sc, dy - (i + 1) * 26 * sc, bw * sc, 24 * sc);
        f.fillStyle = 'rgba(255,230,190,0.5)'; f.fillRect(kx - (bw * sc) / 2 + (i % 2) * 8 * sc + 6 * sc, dy - (i + 1) * 26 * sc + 4 * sc, bw * sc - 12 * sc, 3 * sc);
      });
      // a mug of tea
      const mx = cx + ww * 0.25, mw = 46 * sc, mh = 58 * sc;
      f.fillStyle = '#c9b49a'; f.fillRect(mx - mw / 2, dy - mh, mw, mh);
      f.beginPath(); f.ellipse(mx, dy - mh, mw / 2, 7 * sc, 0, 0, TAU); f.fillStyle = '#5a3416'; f.fill();
      f.strokeStyle = '#c9b49a'; f.lineWidth = 8 * sc;
      f.beginPath(); f.arc(mx + mw / 2, dy - mh / 2, 15 * sc, -Math.PI / 2, Math.PI / 2); f.stroke();
      s.mug = { x: mx, y: dy - mh - 6 * sc, sc };
      // lamplight on everything near it, darker toward the edges
      f.globalCompositeOperation = 'source-atop';
      const lg = f.createRadialGradient(lx, s.lamp.y + 40 * sc, 0, lx, s.lamp.y + 40 * sc, h * 0.75);
      lg.addColorStop(0, 'rgba(255,196,110,0.55)'); lg.addColorStop(0.35, 'rgba(255,170,90,0.18)'); lg.addColorStop(1, 'rgba(255,170,90,0)');
      f.fillStyle = lg; f.fillRect(0, 0, w, h);
      const vg = f.createRadialGradient(cx, h * 0.6, h * 0.25, cx, h * 0.6, Math.max(w, h) * 0.8);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      f.fillStyle = vg; f.fillRect(0, 0, w, h);
      f.globalCompositeOperation = 'source-over';
      s.motes = makeMotes(rng, 45, lx - 220 * sc, s.lamp.y - 40 * sc, lx + 380 * sc, dy - 10);
    },
    draw(s, ctx, t, dt) {
      const { w, h } = s;
      ctx.drawImage(s.back, 0, 0, w, h);
      ctx.save();
      ctx.translate(s.win.x0, s.win.top);
      drawFlakes(ctx, s.flakes, t, dt, s.win.ww, s.win.wh, 6);
      ctx.restore();
      ctx.drawImage(s.front, 0, 0, w, h);
      // the pool of light under the lamp
      const { x, y, sc } = s.lamp;
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, x, y + 60 * sc, 420 * sc, 'rgba(255,170,80,0.16)', 0.9 + 0.1 * Math.sin(t * 0.7));
      glow(ctx, x, y, 60 * sc, 'rgba(255,230,170,0.5)');
      ctx.globalCompositeOperation = 'source-over';
      // steam off the tea
      const m = s.mug;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const st = ctx.createLinearGradient(0, m.y, 0, m.y - 130 * m.sc);
        st.addColorStop(0, 'rgba(255,240,220,0)'); st.addColorStop(0.2, 'rgba(255,240,220,0.22)'); st.addColorStop(1, 'rgba(255,240,220,0)');
        ctx.strokeStyle = st; ctx.lineWidth = 5 * m.sc;
        ctx.beginPath();
        for (let k = 0; k <= 20; k++) {
          const u = k / 20, yy = m.y - u * 130 * m.sc;
          const xx = m.x + (i - 1) * 10 * m.sc + Math.sin(u * 7 - t * 1.6 + i * 2) * u * 18 * m.sc;
          ctx[k ? 'lineTo' : 'moveTo'](xx, yy);
        }
        ctx.stroke();
      }
      drawMotes(ctx, s.motes, t);
    },
  },

  paris: {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(75);
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, 0, h * 0.85, [[0, '#121a42'], [0.38, '#33326f'], [0.68, '#b5618a'], [0.88, '#f39c6c'], [1, '#ffcf96']]);
      b.fillRect(0, 0, w, h);
      glow(b, w * 0.2, h * 0.82, h * 0.55, 'rgba(255,170,120,0.45)');
      s.stars = makeStars(rng, w, h, 80, 0.35);
      s.sprite = cloudSprite(dpr, '255,180,200');
      s.clouds = makeClouds(rng, w, h, 6, 0.12, 0.5);
      // the tower, lit gold
      [s.mid, s.mx] = makeCanvas(w, h, dpr);
      const m = s.mx;
      const tx = w * (w < h ? 0.56 : 0.64), g = h * 0.86, H = Math.min(h * 0.76, w * 1.15);
      glow(m, tx, g - H * 0.35, H * 0.55, 'rgba(255,190,110,0.28)');
      ridge(m, w, h, h * 0.8, h * 0.012, rng, '#3b2f62', 1.5); // far side of the city
      const tg = vgrad(m, g - H, g, [[0, '#ffe2a0'], [0.4, '#f7b860'], [1, '#d67f34']]);
      const T = eiffel(m, tx, g, H, tg, 'rgba(110,50,15,0.5)');
      s.tower = { x: tx, g, H, top: T.top };
      // points for the sparkle, scattered over the tower
      s.sparks = [];
      while (s.sparks.length < 320) {
        const u = Math.pow(rng(), 0.8) * 0.95;
        const hw = T.hw(Math.min(u, 0.82));
        const sx = tx + (rng() * 2 - 1) * hw * (u > 0.82 ? 0.3 : 1);
        if (u < 0.14 && Math.abs(sx - tx) < hw * 0.6) continue; // not in the arch
        s.sparks.push({ x: sx, y: g - u * H, p: rng() * 100 });
      }
      // rooftops in front
      [s.front, s.fx] = makeCanvas(w, h, dpr);
      s.lights = [];
      parisRoofs(s.fx, w, h, rng, h * 0.78, { roof: '#1d1a37', wall: '#27203f', lit: ['#ffd28a', '#ffb766', '#ffe2a8'], lights: s.lights });
      s.wall = '#27203f';
    },
    draw(s, ctx, t) {
      const { w, h } = s;
      ctx.drawImage(s.back, 0, 0, w, h);
      drawStars(ctx, s.stars, t, 0.5);
      drawClouds(ctx, s.clouds, s.sprite, w, t);
      // the beacon on top sweeps round
      const { x, top, H } = s.tower;
      const by = top + H * 0.035;
      ctx.globalCompositeOperation = 'lighter';
      for (const off of [0, Math.PI]) {
        const a = t * 0.55 + off;
        const reach = Math.cos(a), depth = Math.sin(a);
        const L = w * 0.75 * Math.abs(reach) + 30, spread = 0.035 + 0.05 * Math.abs(depth);
        const ex = x + Math.sign(reach) * L, ey = by - L * 0.04;
        const bg = ctx.createLinearGradient(x, by, ex, ey);
        bg.addColorStop(0, `rgba(255,236,190,${0.32 + 0.15 * Math.abs(reach)})`); bg.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(ex, ey - L * spread); ctx.lineTo(ex, ey + L * spread); ctx.closePath(); ctx.fill();
      }
      glow(ctx, x, by, H * 0.03, 'rgba(255,240,200,0.9)');
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(s.mid, 0, 0, w, h);
      // a few minutes of sparkle, every so often (and straight away)
      const ph = t % 50;
      if (ph < 9) {
        const fade = Math.min(1, ph / 0.8, (9 - ph) / 0.8);
        ctx.fillStyle = '#fff';
        for (const p of s.sparks) {
          const k = Math.sin(t * 17 + p.p * 7.3) * Math.sin(t * 5.1 + p.p);
          if (k < 0.55) continue;
          ctx.globalAlpha = fade * (k - 0.55) * 2.2;
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.1 + (k - 0.55) * 2, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(s.front, 0, 0, w, h);
      for (const l of s.lights) {
        if (t > l.next) { l.on = !l.on; l.next = t + rand(5, 30); }
        if (!l.on) { ctx.fillStyle = s.wall; ctx.fillRect(l.x, l.y, l.w, l.h); }
      }
    },
  },

  rome: {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(64);
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, 0, h * 0.85, [[0, '#2b2454'], [0.32, '#6e4677'], [0.62, '#d77b68'], [0.84, '#ffb874'], [1, '#ffdc9c']]);
      b.fillRect(0, 0, w, h);
      glow(b, w * 0.3, h * 0.74, h * 0.6, 'rgba(255,190,120,0.5)');
      glow(b, w * 0.3, h * 0.74, h * 0.05, 'rgba(255,240,200,0.95)');
      s.stars = makeStars(rng, w, h, 40, 0.25);
      s.sprite = cloudSprite(dpr, '255,190,170');
      s.clouds = makeClouds(rng, w, h, 6, 0.1, 0.45);
      // the far city: St Peter's and its neighbours in the haze
      [s.front, s.fx] = makeCanvas(w, h, dpr);
      const f = s.fx;
      const haze = '#7c4466', city = '#62355a';
      ridge(f, w, h, h * 0.76, h * 0.02, rng, 'rgba(160,90,120,0.6)', 1.4);
      const R = Math.min(h * 0.075, w * 0.07);
      dome(f, w * 0.25, h * 0.8, R, haze);
      dome(f, w * 0.4, h * 0.8, R * 0.42, haze);
      dome(f, w * 0.06, h * 0.8, R * 0.32, haze, { cross: false });
      campanile(f, w * 0.33, h * 0.8, h * 0.11, haze);
      f.fillStyle = city;
      let x = -10;
      while (x < w) { const bw = 20 + rng() * 60, bh = h * (0.01 + rng() * 0.035); f.fillRect(x, h * 0.8 - bh, bw + 1, h); x += bw; }
      // the Colosseum, lit by the low sun from the left
      const W = w < h ? w * 0.82 : Math.min(w * 0.52, h * 1.05);
      const c0 = w * (w < h ? 0.5 : 0.67) - W / 2, cg = h * 0.88, CH = W * 0.34;
      const col = colosseum(w, h, dpr, c0, c0 + W, cg, CH, '#94573f');
      const cx = col.getContext('2d');
      cx.globalCompositeOperation = 'source-atop';
      const lit = cx.createLinearGradient(c0, 0, c0 + W, 0);
      lit.addColorStop(0, 'rgba(255,190,130,0.45)'); lit.addColorStop(0.5, 'rgba(240,150,100,0.15)'); lit.addColorStop(1, 'rgba(60,20,40,0.45)');
      cx.fillStyle = lit; cx.fillRect(0, 0, w, h);
      cx.fillStyle = vgrad(cx, cg - CH, cg, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(40,15,30,0.5)']]); cx.fillRect(0, 0, w, h);
      cx.globalCompositeOperation = 'source-over';
      f.drawImage(col, 0, 0, w, h);
      // trees and the ground in front
      f.fillStyle = '#24132a';
      ridge(f, w, h, h * 0.92, h * 0.015, rng, '#24132a', 0.8);
      const pines = w < h ? [0.08, 0.86] : [0.04, 0.12, 0.95];
      for (const px of pines) stonePine(f, w * px, h * 0.93, h * (0.24 + rng() * 0.1), rng, '#1e1024');
      for (const px of (w < h ? [0.22] : [0.38, 0.405, 0.85])) cypress(f, w * px, h * 0.93, h * (0.2 + rng() * 0.08), '#170b1d');
      f.fillStyle = '#170b1d'; f.fillRect(0, h * 0.93, w, h * 0.07);
      s.flock = makeFlock(rng, 320);
    },
    draw(s, ctx, t) {
      const { w, h } = s;
      ctx.drawImage(s.back, 0, 0, w, h);
      drawStars(ctx, s.stars, t, 0.35);
      drawClouds(ctx, s.clouds, s.sprite, w, t);
      const size = Math.min(w, h) * 0.2;
      drawFlock(ctx, s.flock, t, w * 0.42 + Math.sin(t * 0.031) * w * 0.14, h * 0.3 + Math.cos(t * 0.043) * h * 0.06, size, 'rgba(36,16,40,0.8)');
      ctx.drawImage(s.front, 0, 0, w, h);
    },
  },

  dusk: {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(11);
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, 0, h * 0.7, [[0, '#1f1540'], [0.35, '#4f2a6b'], [0.68, '#c25e7d'], [1, '#ffb88a']]);
      b.fillRect(0, 0, w, h);
      glow(b, w * 0.68, h * 0.6, h * 0.5, 'rgba(255,190,140,0.55)');
      glow(b, w * 0.68, h * 0.6, h * 0.07, 'rgba(255,236,200,1)');
      s.stars = makeStars(rng, w, h, 90, 0.35);
      [s.front, s.fx] = makeCanvas(w, h, dpr);
      const f = s.fx;
      ridge(f, w, h, h * 0.64, h * 0.06, rng, 'rgba(171,92,140,0.75)', 1.2);
      ridge(f, w, h, h * 0.7, h * 0.07, rng, '#7d3f78');
      ridge(f, w, h, h * 0.78, h * 0.08, rng, '#4f2657');
      ridge(f, w, h, h * 0.9, h * 0.06, rng, '#2a1434', 0.6);
      s.sprite = cloudSprite(dpr, '255,210,220');
      s.clouds = makeClouds(rng, w, h, 7, 0.12, 0.5);
    },
    draw(s, ctx, t) {
      ctx.drawImage(s.back, 0, 0, s.w, s.h);
      drawStars(ctx, s.stars, t, 0.45);
      drawClouds(ctx, s.clouds, s.sprite, s.w, t);
      ctx.drawImage(s.front, 0, 0, s.w, s.h);
    },
  },

  rain: {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(23);
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, 0, h, [[0, '#0b1626'], [0.6, '#16283c'], [1, '#22324a']]);
      b.fillRect(0, 0, w, h);
      const cols = ['255,190,120', '255,150,90', '140,190,255', '255,230,170', '200,140,255'];
      for (let i = 0; i < 70; i++) {
        const x = rng() * w, y = h * (0.35 + rng() * 0.6), r = 12 + rng() * 60;
        glow(b, x, y, r, `rgba(${cols[Math.floor(rng() * cols.length)]},${0.2 + rng() * 0.35})`);
      }
      b.fillStyle = 'rgba(8,14,24,0.35)'; b.fillRect(0, 0, w, h);
      s.drops = Array.from({ length: Math.round(w * h / 5000) }, () => ({ x: rng() * w, y: rng() * h, l: 10 + rng() * 22, v: 500 + rng() * 500, a: 0.08 + rng() * 0.22 }));
      s.beads = Array.from({ length: Math.round(w * h / 9000) }, () => ({ x: rng() * w, y: rng() * h, r: 0.8 + Math.pow(rng(), 3) * 5, slide: rng() < 0.12, v: 8 + rng() * 40 }));
    },
    draw(s, ctx, t, dt) {
      const { w, h } = s;
      ctx.drawImage(s.back, 0, 0, w, h);
      ctx.strokeStyle = '#cfe3ff'; ctx.lineWidth = 1;
      for (const d of s.drops) {
        d.y += d.v * dt; d.x += d.v * dt * 0.08;
        if (d.y > h) { d.y = -d.l; d.x = Math.random() * w; }
        ctx.globalAlpha = d.a;
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.08, d.y - d.l); ctx.stroke();
      }
      for (const b of s.beads) {
        if (b.slide) { b.y += b.v * dt; if (b.y > h + 10) { b.y = -10; b.x = Math.random() * w; } }
        ctx.globalAlpha = 0.35; ctx.fillStyle = '#9fb6cf';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.6; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.3, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },

  stars: {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(5);
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, 0, h, [[0, '#03040f'], [0.55, '#0e1638'], [0.8, '#29285a'], [1, '#3b2f63']]);
      b.fillRect(0, 0, w, h);
      // milky way
      b.save(); b.translate(w * 0.5, h * 0.35); b.rotate(-0.5);
      for (let i = 0; i < 1600; i++) {
        const x = (rng() - 0.5) * w * 1.6, y = (rng() + rng() + rng() - 1.5) * h * 0.12;
        b.globalAlpha = rng() * 0.5; b.fillStyle = '#e8e6ff';
        b.fillRect(x, y, 1, 1);
      }
      glow(b, 0, 0, w * 0.35, 'rgba(160,140,255,0.10)');
      b.restore();
      glow(b, w * 0.82, h * 0.18, 34, 'rgba(255,255,240,0.95)');
      glow(b, w * 0.82, h * 0.18, 160, 'rgba(200,210,255,0.18)');
      s.stars = makeStars(rng, w, h, 260, 0.8);
      [s.front, s.fx] = makeCanvas(w, h, dpr);
      ridge(s.fx, w, h, h * 0.8, h * 0.08, rng, '#1a1838', 1.3);
      ridge(s.fx, w, h, h * 0.88, h * 0.06, rng, '#0a0a1c', 0.8);
      s.shoot = null; s.nextShoot = 3;
    },
    draw(s, ctx, t) {
      const { w, h } = s;
      ctx.drawImage(s.back, 0, 0, w, h);
      drawStars(ctx, s.stars, t, 0.9);
      if (!s.shoot && t > s.nextShoot) s.shoot = { x: rand(w * 0.1, w * 0.7), y: rand(0, h * 0.3), t0: t };
      if (s.shoot) {
        const k = (t - s.shoot.t0) / 0.9;
        if (k > 1) { s.shoot = null; s.nextShoot = t + rand(5, 12); } else {
          const x = s.shoot.x + k * 260, y = s.shoot.y + k * 110;
          const g = ctx.createLinearGradient(x, y, x - 90, y - 38);
          g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - k)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 90, y - 38); ctx.stroke();
        }
      }
      ctx.drawImage(s.front, 0, 0, w, h);
    },
  },

  aurora: {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(41);
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, 0, h, [[0, '#010812'], [0.6, '#06202c'], [1, '#0c3340']]);
      b.fillRect(0, 0, w, h);
      s.stars = makeStars(rng, w, h, 200, 0.7);
      // vertical curtain strip
      const [strip, sx] = makeCanvas(4, 256, 1);
      sx.fillStyle = vgrad(sx, 0, 256, [[0, 'rgba(120,80,255,0)'], [0.45, 'rgba(90,160,255,0.35)'], [0.85, 'rgba(60,255,170,0.8)'], [1, 'rgba(60,255,170,0)']]);
      sx.fillRect(0, 0, 4, 256);
      s.strip = strip;
      s.ribbons = [0, 1, 2].map((i) => ({ base: h * (0.3 + i * 0.07), amp: h * (0.05 + rng() * 0.04), f: 1.5 + rng() * 2, sp: 0.08 + rng() * 0.08, hgt: h * (0.22 + rng() * 0.12), ph: rng() * TAU }));
      [s.front, s.fx] = makeCanvas(w, h, dpr);
      const f = s.fx;
      ridge(f, w, h, h * 0.78, h * 0.05, rng, '#1d3a4a', 0.7);
      ridge(f, w, h, h * 0.86, h * 0.03, rng, '#a9c3d3', 0.4);
      for (let i = 0; i < 46; i++) {
        const x = rng() * w, hh = h * (0.08 + rng() * 0.16);
        pine(f, x, h * (0.88 + rng() * 0.12), hh, '#03101a');
      }
    },
    draw(s, ctx, t) {
      const { w, h } = s;
      ctx.drawImage(s.back, 0, 0, w, h);
      drawStars(ctx, s.stars, t, 0.7);
      ctx.globalCompositeOperation = 'lighter';
      const step = 5;
      for (const r of s.ribbons) {
        for (let x = 0; x < w; x += step) {
          const u = x / w;
          const y = r.base + Math.sin(u * r.f * Math.PI + t * r.sp + r.ph) * r.amp + Math.sin(u * 7 - t * r.sp * 1.7) * r.amp * 0.3;
          const hh = r.hgt * (0.55 + 0.45 * Math.sin(u * 11 + t * 0.4 + r.ph));
          ctx.globalAlpha = 0.18 + 0.2 * Math.max(0, Math.sin(u * 5 + t * 0.3 + r.ph));
          ctx.drawImage(s.strip, x, y - hh, step + 1, hh);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(s.front, 0, 0, w, h);
    },
  },

  ocean: {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(77);
      const hz = h * 0.58;
      s.hz = hz;
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, 0, hz, [[0, '#3c3a78'], [0.45, '#c4708a'], [0.8, '#ffb07a'], [1, '#ffd9a0']]);
      b.fillRect(0, 0, w, hz);
      glow(b, w * 0.5, hz, h * 0.45, 'rgba(255,200,140,0.6)');
      b.save(); b.beginPath(); b.rect(0, 0, w, hz); b.clip();
      glow(b, w * 0.5, hz, h * 0.075, 'rgba(255,246,220,1)');
      b.restore();
      b.fillStyle = vgrad(b, hz, h, [[0, '#d78a7a'], [0.25, '#7a5a86'], [1, '#1c2446']]);
      b.fillRect(0, hz, w, h - hz);
      s.sprite = cloudSprite(dpr, '255,200,190');
      s.clouds = makeClouds(rng, w, h, 6, 0.08, 0.38);
      s.glints = Array.from({ length: 160 }, () => {
        const d = Math.pow(rng(), 1.6);
        return { y: hz + 4 + d * (h - hz), x: w * 0.5 + (rng() - 0.5) * (40 + d * w * 0.35), l: 6 + d * 40, p: rng() * TAU, s: 1 + rng() * 3 };
      });
      s.lines = Array.from({ length: 40 }, () => ({ y: hz + 6 + Math.pow(rng(), 1.5) * (h - hz), x: rng() * w, l: 40 + rng() * 200, v: 4 + rng() * 10 }));
      s.birds = Array.from({ length: 4 }, () => ({ x: rng() * w, y: h * (0.2 + rng() * 0.15), v: 14 + rng() * 10, p: rng() * TAU }));
    },
    draw(s, ctx, t) {
      const { w, h } = s;
      ctx.drawImage(s.back, 0, 0, w, h);
      drawClouds(ctx, s.clouds, s.sprite, w, t);
      ctx.lineWidth = 1.5;
      for (const g of s.glints) {
        ctx.globalAlpha = Math.max(0, Math.sin(t * g.s + g.p)) * 0.8;
        ctx.strokeStyle = '#ffe9c2';
        ctx.beginPath(); ctx.moveTo(g.x - g.l / 2, g.y); ctx.lineTo(g.x + g.l / 2, g.y); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,220,200,0.18)'; ctx.globalAlpha = 1;
      for (const l of s.lines) {
        const x = ((l.x + t * l.v) % (w + 300)) - 150;
        ctx.beginPath(); ctx.moveTo(x, l.y); ctx.lineTo(x + l.l, l.y); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(40,30,60,0.7)'; ctx.lineWidth = 1.6;
      for (const b of s.birds) {
        const x = ((b.x + t * b.v) % (w + 100)) - 50, y = b.y + Math.sin(t * 0.5 + b.p) * 6, f = Math.sin(t * 6 + b.p) * 4;
        ctx.beginPath(); ctx.moveTo(x - 8, y - f); ctx.quadraticCurveTo(x - 3, y - 2, x, y); ctx.quadraticCurveTo(x + 3, y - 2, x + 8, y - f); ctx.stroke();
      }
    },
  },

  fireflies: {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(97);
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, 0, h, [[0, '#030c10'], [0.5, '#0a2522'], [1, '#12352a']]);
      b.fillRect(0, 0, w, h);
      glow(b, w * 0.25, h * 0.2, h * 0.45, 'rgba(160,220,200,0.12)');
      glow(b, w * 0.25, h * 0.2, 28, 'rgba(235,255,240,0.9)');
      for (let layer = 0; layer < 3; layer++) {
        const col = ['#123a33', '#0c2b26', '#071c19'][layer];
        for (let i = 0; i < 40; i++) pine(b, rng() * w, h * (0.62 + layer * 0.07 + rng() * 0.05), h * (0.18 + layer * 0.07 + rng() * 0.1), col);
        b.fillStyle = `rgba(60,110,100,${0.12 - layer * 0.03})`;
        b.fillRect(0, h * (0.55 + layer * 0.08), w, h * 0.1);
      }
      [s.front, s.fx] = makeCanvas(w, h, dpr);
      const f = s.fx;
      ridge(f, w, h, h * 0.93, h * 0.03, rng, '#020806', 0.5);
      for (let i = 0; i < 9; i++) pine(f, rng() * w, h * 1.02, h * (0.45 + rng() * 0.25), '#020806');
      const [spr, sx] = makeCanvas(32, 32, 1);
      glow(sx, 16, 16, 16, 'rgba(230,255,140,1)');
      s.spr = spr;
      s.flies = Array.from({ length: 70 }, () => ({ x: rng() * w, y: h * (0.4 + rng() * 0.55), p: rng() * TAU, s: 0.3 + rng() * 0.8, r: 6 + rng() * 10, fp: rng() * TAU, fs: 0.8 + rng() * 2 }));
    },
    draw(s, ctx, t) {
      const { w, h } = s;
      ctx.drawImage(s.back, 0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const f of s.flies) {
        const x = f.x + Math.sin(t * f.s + f.p) * 40 + Math.sin(t * f.s * 0.37 + f.p * 2) * 60;
        const y = f.y + Math.cos(t * f.s * 0.8 + f.p) * 25;
        ctx.globalAlpha = Math.pow(Math.max(0, Math.sin(t * f.fs + f.fp)), 2);
        ctx.drawImage(s.spr, ((x % w) + w) % w - f.r, y - f.r, f.r * 2, f.r * 2);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(s.front, 0, 0, w, h);
    },
  },

  meadow: {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(131);
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, 0, h * 0.7, [[0, '#5d9ad8'], [0.55, '#a7cdf0'], [1, '#ffe7c4']]);
      b.fillRect(0, 0, w, h);
      glow(b, w * 0.8, h * 0.16, h * 0.55, 'rgba(255,240,200,0.55)');
      glow(b, w * 0.8, h * 0.16, h * 0.06, 'rgba(255,253,240,1)');
      [s.front, s.fx] = makeCanvas(w, h, dpr);
      const f = s.fx;
      ridge(f, w, h, h * 0.66, h * 0.05, rng, 'rgba(120,150,190,0.7)', 1.1);
      ridge(f, w, h, h * 0.72, h * 0.05, rng, '#8fb57a', 0.3);
      ridge(f, w, h, h * 0.78, h * 0.05, rng, '#6c9c5c', 0.3);
      ridge(f, w, h, h * 0.86, h * 0.05, rng, '#4f8248', 0.3);
      ridge(f, w, h, h * 0.95, h * 0.04, rng, '#356338', 0.3);
      for (let i = 0; i < 260; i++) {
        f.fillStyle = ['#ffd6e7', '#fff3b0', '#ffffff', '#ffb3c6'][i % 4];
        f.globalAlpha = 0.8;
        f.beginPath(); f.arc(rng() * w, h * (0.84 + rng() * 0.16), 1 + rng() * 2, 0, TAU); f.fill();
      }
      f.globalAlpha = 1;
      s.sprite = cloudSprite(dpr);
      s.clouds = makeClouds(rng, w, h, 8, 0.05, 0.45);
    },
    draw(s, ctx, t) {
      ctx.drawImage(s.back, 0, 0, s.w, s.h);
      drawClouds(ctx, s.clouds, s.sprite, s.w, t);
      ctx.drawImage(s.front, 0, 0, s.w, s.h);
    },
  },

  city: {
    setup(s) {
      const { w, h, dpr } = s; const rng = seeded(171);
      [s.back, s.bx] = makeCanvas(w, h, dpr);
      const b = s.bx;
      b.fillStyle = vgrad(b, 0, h, [[0, '#090a1d'], [0.55, '#221a44'], [0.85, '#5b2e5e'], [1, '#7a3a5c']]);
      b.fillRect(0, 0, w, h);
      glow(b, w * 0.2, h * 0.2, 30, 'rgba(255,245,230,0.95)');
      glow(b, w * 0.2, h * 0.2, 180, 'rgba(255,200,230,0.12)');
      s.stars = makeStars(rng, w, h, 70, 0.45);
      [s.front, s.fx] = makeCanvas(w, h, dpr);
      const f = s.fx;
      s.windows = [];
      for (const [layer, col, win] of [[0, '#2a2148', 0.25], [1, '#170f2c', 0.55], [2, '#0a0716', 0.8]]) {
        let x = -20;
        while (x < w + 20) {
          const bw = 30 + rng() * 70 + layer * 10;
          const bh = h * (0.18 + rng() * 0.32 - layer * 0.05);
          const top = h - bh - layer * h * 0.02 + (2 - layer) * h * -0.02;
          f.fillStyle = col; f.fillRect(x, top, bw, h - top);
          if (rng() < 0.2) f.fillRect(x + bw * 0.45, top - 18, 2, 18);
          for (let wy = top + 8; wy < h - 10; wy += 12) {
            for (let wx = x + 5; wx < x + bw - 6; wx += 9) {
              if (rng() < win * 0.45) {
                const warm = rng() < 0.75;
                const c = warm ? `rgba(255,${190 + Math.floor(rng() * 50)},120,${0.5 + rng() * 0.4})` : `rgba(160,200,255,${0.4 + rng() * 0.4})`;
                f.fillStyle = c; f.fillRect(wx, wy, 4, 6);
                if (layer === 2 && rng() < 0.08) s.windows.push({ x: wx, y: wy, c, on: true, next: rng() * 20 });
              }
            }
          }
          f.fillStyle = col;
          x += bw + rng() * 6;
        }
      }
      s.col = '#0a0716';
    },
    draw(s, ctx, t) {
      const { w, h } = s;
      ctx.drawImage(s.back, 0, 0, w, h);
      drawStars(ctx, s.stars, t, 0.6);
      ctx.drawImage(s.front, 0, 0, w, h);
      for (const win of s.windows) {
        if (t > win.next) { win.on = !win.on; win.next = t + rand(4, 25); }
        if (!win.on) { ctx.fillStyle = s.col; ctx.fillRect(win.x, win.y, 4, 6); }
      }
    },
  },
};

export const CANVAS_SCENES = [
  { id: 'dusk', name: 'Lavender dusk', kind: 'canvas', tone: 'dark' },
  { id: 'aurora', name: 'Northern lights', kind: 'canvas', tone: 'dark' },
  { id: 'rain', name: 'Rainy window', kind: 'canvas', tone: 'dark' },
  { id: 'stars', name: 'Starry night', kind: 'canvas', tone: 'dark' },
  { id: 'ocean', name: 'Golden sea', kind: 'canvas', tone: 'dark' },
  { id: 'fireflies', name: 'Firefly forest', kind: 'canvas', tone: 'dark' },
  { id: 'meadow', name: 'Meadow morning', kind: 'canvas', tone: 'light' },
  { id: 'city', name: 'Midnight city', kind: 'canvas', tone: 'dark' },
  { id: 'summit', name: 'Hand in hand', kind: 'canvas', tone: 'light' },
  { id: 'moonpeak', name: 'Moonlit summit', kind: 'canvas', tone: 'dark' },
  { id: 'library', name: 'Cozy library', kind: 'canvas', tone: 'dark' },
  { id: 'paris', name: 'Paris at dusk', kind: 'canvas', tone: 'dark' },
  { id: 'rome', name: 'Roman evening', kind: 'canvas', tone: 'dark' },
];

/* Live themes: clips hot-linked from Mixkit (Mixkit Stock Video Free License).
   Every moving clip here is shot from a still camera, and each one plays only the stretch [from, to)
   picked by frame analysis so that the frames around `to` match the frames around `from`.
   The loop crossfades between those matching moments, so the restart can't be seen.
   Clips whose camera drifts are shown as a still (`still`), with snow, dust or shooting stars
   drawn over them (`fx`) so they don't sit dead. */
const MIX = 'https://assets.mixkit.co/videos';
const LIVE = [
  ['Waterfalls and rivers', [
    [49337, 'Jungle waterfall', 0, 9.24],
    [48006, 'Hidden lagoon', 3.36, 10.28],
    [18162, 'Rocky cascade', 9.009, 23.724],
    [11060, 'Great falls', 1.567, 9.667],
    [45315, 'Jungle falls', 3.16, 11.52, { tone: 'light' }], // bright clips get a deeper shade behind the text
    [11185, 'Rainbow falls', 6.6, 15.96, { tone: 'light' }],
    [4374, 'Forest cascade', 2.24, 10.6],
    [10993, 'Turquoise falls', 2.95, 10.95, { tone: 'light' }],
    [46384, 'Thundering falls', 2.133, 7.267, { tone: 'light' }],
    [8014, 'Cave waterfall', 16.717, 28.128],
    [45610, 'Crystal stream', 5.873, 13.881, { tone: 'light' }],
  ]],
  ['Beaches and sea', [
    [50155, 'Beach hut sunset', 0, 9.927, { tone: 'light' }],
    [11359, 'Sunset bay', 2, 9.2, { tone: 'light' }],
    [1170, 'Palm silhouettes', 3.712, 22.564],
    [44500, 'Sunset terrace', 1.877, 9.885],
    [44499, 'Palm at dusk', 2.252, 8.467],
    [1191, 'Palm at sunset', 8.583, 16.958],
    [1566, 'Calm sea at dawn', 6.173, 14.181, { tone: 'light' }],
  ]],
  ['Couples', [
    [5935, 'Hand in hand at sunset', 3.136, 15.182, { tone: 'light' }],
    [18358, 'Lovers at sunset', 0, 6.567, { tone: 'light' }],
  ]],
  ['Snow and mountains', [
    [25106, 'Snowfall in the pines', 0, 8, { tone: 'light' }],
    // these drift, so they stay still and the snow or shooting stars are what move
    [19239, 'Snowy starry night', 0, 0, { fx: 'meteors', still: true }],
    [2602, 'Snowy alpine valley', 0, 0, { fx: 'snow', still: true, tone: 'light' }],
    [48108, 'Alpenglow peaks', 0, 0, { still: true, tone: 'light' }],
    [3334, 'Pines above the clouds', 0, 0, { fx: 'snow', still: true, tone: 'light' }],
    [28844, 'Snowy sunset', 0, 0, { fx: 'snow', still: true, tone: 'light' }],
  ]],
  ['Paris and Italy', [
    [4353, 'Eiffel Tower by night', 0.8, 8.933],
    [27046, 'Eiffel at sundown', 0, 0, { still: true, tone: 'light' }],
    [24206, 'Eiffel blue sky', 0, 0, { still: true, tone: 'light' }],
    [25214, 'Eiffel in blossom', 0, 0, { still: true, tone: 'light' }],
    [11309, "Tiber and St Peter's", 0.08, 10.08, { tone: 'light' }],
    [11122, 'Roman Forum', 1.04, 7.52, { tone: 'light' }],
    [11039, 'Colosseum at dusk', 0, 0, { still: true }],
    [47981, 'Colosseum in snow', 0, 0, { fx: 'snow', still: true, tone: 'light' }],
    [11194, 'Rome rooftops', 0, 0, { still: true, tone: 'light' }],
    [11124, 'Piazza del Popolo', 0, 0, { still: true, tone: 'light' }],
    [4646, 'Venice by night', 0, 0, { still: true }],
  ]],
  ['Libraries', [
    [24632, 'Old library', 0, 0, { fx: 'motes', still: true }],
    [48574, 'Library archive', 0, 0, { fx: 'motes', still: true }],
  ]],
  ['Rain and forest', [
    [2716, 'Rain on the eaves', 1.418, 8.926],
    [2206, 'Rain in the pines', 4.504, 12.93],
    [22729, 'Misty forest', 3.25, 10.042],
  ]],
];
export const VIDEO_GROUPS = LIVE.map(([g]) => g);
export const VIDEO_SCENES = LIVE.flatMap(([group, list]) => list.map(([vid, name, from, to, extra = {}]) => ({
  id: `v${vid}`, name, group, kind: extra.still ? 'photo' : 'video',
  video: `${MIX}/${vid}/${vid}-720.mp4`, loop: [from, to],
  poster: `${MIX}/${vid}/${vid}-thumb-720-0.jpg`,
  url: extra.still ? `${MIX}/${vid}/${vid}-thumb-720-0.jpg` : undefined,
  thumb: `${MIX}/${vid}/${vid}-thumb-360-0.jpg`,
  ...extra,
})));

// the old photo themes and retired clips, mapped to the closest live one so saved choices still work
export const LEGACY_SCENES = {
  u1506905925346: 'v22729', u1501785888041: 'v19239', u1470071459604: 'v25106', u1441974231531: 'v4374',
  u1507525428034: 'v50155', u1519681393784: 'v19239', u1472214103451: 'v11359', u1433086966358: 'v49337',
  u1505142468610: 'v44500', u1500530855697: 'v22729', u1418065460487: 'v25106', u1464822759023: 'v19239',
  v51592: 'v4374', v51598: 'v45610', v2186: 'v49337', v14319: 'v11060', v2213: 'v45315',
  v44498: 'v50155', v15169: 'v44500', v1086: 'v1566', v34363: 'v11359', v1925: 'v11359',
  v44482: 'v1566', v5016: 'v1566', v35574: 'v19239', v4283: 'v22729', v1704: 'v19239',
  v3306: 'v25106', v3350: 'v19239', v34788: 'v19239',
};

/* Shooting stars drawn over a video (transparent canvas on top) */
const METEORS = {
  setup(s) { s.list = []; s.next = 1.5; },
  draw(s, ctx, t, dt) {
    const { w, h } = s;
    ctx.clearRect(0, 0, w, h);
    if (t > s.next) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const a = rand(0.28, 0.62); // radians below horizontal
      const sp = rand(380, 620) * Math.min(1.4, Math.max(0.7, w / 1400));
      s.list.push({ x: dir > 0 ? rand(w * 0.05, w * 0.6) : rand(w * 0.4, w * 0.95), y: rand(h * 0.02, h * 0.3),
        vx: Math.cos(a) * sp * dir, vy: Math.sin(a) * sp, life: rand(0.7, 1.25), age: 0, len: rand(0.18, 0.3) });
      // now and then a second one close behind, like a real shower
      s.next = t + (Math.random() < 0.18 ? rand(0.6, 1.5) : rand(4, 10));
    }
    ctx.lineCap = 'round';
    s.list = s.list.filter((m) => {
      m.age += dt;
      const k = m.age / m.life;
      if (k >= 1) return false;
      const x = m.x + m.vx * m.age, y = m.y + m.vy * m.age;
      const tx = x - m.vx * m.len, ty = y - m.vy * m.len;
      const a = Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.8;
      const g = ctx.createLinearGradient(x, y, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
      g.addColorStop(0.25, `rgba(210,225,255,${0.45 * a})`);
      g.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
      glow(ctx, x, y, 7, `rgba(255,255,255,${0.9 * a})`);
      return true;
    });
  },
};

/* Snow falling over a photo */
const SNOW = {
  setup(s) { s.flakes = makeFlakes(seeded(5), s.w, s.h, Math.round((s.w * s.h) / 9000)); },
  draw(s, ctx, t, dt) { ctx.clearRect(0, 0, s.w, s.h); drawFlakes(ctx, s.flakes, t, dt, s.w, s.h, 8); },
};
/* Dust drifting in the light */
const MOTES = {
  setup(s) { s.motes = makeMotes(seeded(9), Math.round((s.w * s.h) / 22000), 0, 0, s.w, s.h); },
  draw(s, ctx, t) { ctx.clearRect(0, 0, s.w, s.h); drawMotes(ctx, s.motes, t); },
};
const FX = { meteors: METEORS, snow: SNOW, motes: MOTES };
const fxFor = (def) => FX[def.fx] || (def.meteors ? METEORS : null);

/* Plays the stretch [from, to) of a clip on a loop that doesn't show its seam.
   A second copy waits paused, already decoded at `from`. When the first reaches `to`
   the second starts and fades in on top of it; the frames either side match, so the
   blend reads as continuous motion. The first then rewinds to `from` and becomes the
   next copy in waiting. */
const FADE = 1; // seconds, the window the loop points were chosen for
class LoopVideo {
  constructor(host) {
    this.host = host;
    this.seq = 0;
    this.active = 0;
    this.fading = false;
    this.playing = false;
    this.loop = [0, 0];
    this.els = [0, 1].map(() => {
      const v = document.createElement('video');
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = false; v.preload = 'auto';
      for (const a of ['muted', 'playsinline', 'disablepictureinpicture', 'disableremoteplayback']) v.setAttribute(a, '');
      v.tabIndex = -1;
      v.style.transitionDuration = `${FADE}s`;
      v.addEventListener('timeupdate', () => this._check(v));
      v.addEventListener('ended', () => this._check(v, true));
      v.addEventListener('playing', () => this._watch(v));
      host.append(v);
      return v;
    });
    this._unblock = () => { removeEventListener('pointerdown', this._unblock); this.resume(); };
    // watchdog: if the browser pauses the clip on its own (stall, power saving), nudge it back
    setInterval(() => {
      const v = this.els[this.active];
      if (this.playing && this.src && !document.hidden && v.paused && v.readyState >= 2) this._play(v);
    }, 3000);
  }

  // the loop window for the loaded clip, kept inside its real length
  _window(v) {
    const d = isFinite(v.duration) ? v.duration : 0;
    let [a, b] = this.loop;
    if (!(b > a) || b > d - 0.05) b = Math.max(0, d - FADE - 0.1);
    if (b - a < 2) a = 0;
    return [a, b];
  }

  // rewind a paused copy to the loop start so it's decoded and ready to go
  _ready(v, seq) {
    v.ready = false;
    const [a] = this._window(v);
    const done = () => { if (seq === this.seq) v.ready = true; };
    if (Math.abs(v.currentTime - a) < 0.02 && v.readyState >= 2) return done();
    v.addEventListener('seeked', done, { once: true });
    try { v.currentTime = a; } catch { v.removeEventListener('seeked', done); }
  }

  load(src, { loop = [0, 0], onReady, onFail }) {
    this.stop();
    const seq = this.seq;
    this.src = src;
    this.loop = loop;
    const [a, b] = this.els;
    this.active = 0;
    a.style.zIndex = 1; b.style.zIndex = 0;
    a.classList.add('on'); b.classList.remove('on');
    let done = false;
    const fail = () => { if (done || seq !== this.seq) return; done = true; this.stop(); onFail(); };
    const timer = setTimeout(fail, 25000);
    a.onerror = () => { clearTimeout(timer); fail(); };
    a.onloadedmetadata = () => {
      a.onloadedmetadata = null;
      if (done || seq !== this.seq) return;
      const [from] = this._window(a);
      const show = () => {
        if (done || seq !== this.seq) return;
        done = true; clearTimeout(timer);
        a.onerror = null;
        onReady();
        this.playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (this.playing && !document.hidden) this._play(a);
        // the waiting copy loads once the first is under way, so they don't fight over bandwidth
        b.onloadedmetadata = () => { b.onloadedmetadata = null; if (seq === this.seq) this._ready(b, seq); };
        setTimeout(() => { if (seq === this.seq) { b.src = src; b.load(); } }, 1200);
      };
      if (from > 0.02) { a.addEventListener('seeked', show, { once: true }); a.currentTime = from; }
      else if (a.readyState >= 2) show();
      else a.addEventListener('loadeddata', show, { once: true });
    };
    a.src = src;
    a.load();
  }

  stop() {
    this.seq++;
    this.playing = false;
    this.fading = false;
    clearTimeout(this.fadeTimer);
    for (const v of this.els) {
      v.onloadedmetadata = v.onerror = null;
      v.ready = false;
      v.pause();
      v.classList.remove('on');
      if (v.hasAttribute('src')) { v.removeAttribute('src'); v.load(); } // drop the download
    }
    this.src = null;
  }

  pause() { for (const v of this.els) v.pause(); }

  resume() {
    if (!this.playing || !this.src) return;
    this._play(this.els[this.active]);
    if (this.fading) this._play(this.els[1 - this.active]);
  }

  _play(v) {
    const p = v.play();
    // autoplay can be refused (e.g. iPhone low-power mode): try again on the first tap
    p?.catch?.(() => addEventListener('pointerdown', this._unblock));
    return p;
  }

  // check the time on every decoded frame (timeupdate alone fires only ~4 times a second)
  _watch(v) {
    if (!v.requestVideoFrameCallback || v.watching) return;
    v.watching = true;
    const tick = () => {
      if (v.paused || v.ended) { v.watching = false; return; }
      this._check(v);
      v.requestVideoFrameCallback(tick);
    };
    v.requestVideoFrameCallback(tick);
  }

  _check(v, ended = false) {
    if (!this.playing || this.fading || v !== this.els[this.active]) return;
    const [from, to] = this._window(v);
    if (!to) return;
    if (!ended && v.currentTime < to - 0.02) return;
    const inc = this.els[1 - this.active];
    if (inc.ready) return this._swap(v, inc);
    // the other copy isn't ready yet (slow network): run on to the end, then jump back
    if (ended || v.currentTime >= v.duration - 0.1) { v.currentTime = from; this._play(v); }
  }

  _swap(out, inc) {
    this.fading = true;
    this.active = 1 - this.active;
    const seq = this.seq;
    inc.ready = false;
    inc.style.zIndex = 2; out.style.zIndex = 1;
    let started = false;
    const go = () => {
      if (started || seq !== this.seq) return;
      started = true;
      inc.classList.add('on');
      this.fadeTimer = setTimeout(() => {
        if (seq !== this.seq) return;
        out.pause();
        out.classList.remove('on');
        inc.style.zIndex = 1; out.style.zIndex = 0;
        this.fading = false;
        this._ready(out, seq);
      }, FADE * 1000 + 60);
    };
    this._play(inc)?.then?.(go, go);
  }
}

export class SceneRenderer {
  constructor(canvas, imgEl, vidEl, fxCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.img = imgEl;
    this.vid = vidEl;
    this.video = new LoopVideo(vidEl);
    this.fx = fxCanvas;
    this.fxCtx = fxCanvas.getContext('2d');
    this.fxImpl = null;
    this.seq = 0;
    this.state = null;
    this.impl = null;
    this.t0 = performance.now();
    this.last = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._frame = this._frame.bind(this);
    addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.video.pause();
      else { this.video.resume(); this._kick(); }
    });
  }

  set(def) {
    this.def = def;
    const seq = ++this.seq;
    if (def.kind === 'video') {
      // keep the current scene up until the clip can actually play
      this.video.load(def.video, {
        loop: def.loop,
        onReady: () => {
          if (seq !== this.seq) return;
          this.impl = null;
          this.canvas.classList.remove('show');
          this.img.classList.remove('show');
          this.vid.classList.add('show');
          this.fxImpl = fxFor(def);
          this.fx.classList.toggle('show', !!this.fxImpl);
          this._resize();
        },
        // the clip couldn't load: show its still frame instead
        onFail: () => { if (seq === this.seq) this.set({ ...def, kind: 'photo', url: def.poster }); },
      });
      return;
    }
    this.video.stop();
    this.vid.classList.remove('show');
    this.fxImpl = fxFor(def); // shooting stars, snow or dust can move over a still photo too
    this.fx.classList.toggle('show', !!this.fxImpl);
    if (def.kind === 'canvas') {
      this.impl = IMPL[def.id];
      this.img.classList.remove('show');
      this.canvas.classList.add('show');
      this._resize();
    } else {
      this.impl = null;
      this.canvas.classList.remove('show');
      const url = def.url;
      const probe = new Image();
      probe.onload = () => { if (seq !== this.seq) return; this.img.style.backgroundImage = `url("${url}")`; this.img.classList.add('show'); };
      probe.onerror = () => { // fall back to a canvas scene if the photo can't load
        if (seq === this.seq) this.set(CANVAS_SCENES[0]);
      };
      probe.src = url;
    }
  }

  _resize() {
    if (!this.impl && !this.fxImpl) return;
    const w = innerWidth, h = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    for (const [c, x, impl] of [[this.canvas, this.ctx, this.impl], [this.fx, this.fxCtx, this.fxImpl]]) {
      if (!impl) continue;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (this.impl) { this.state = { w, h, dpr }; this.impl.setup(this.state); }
    if (this.fxImpl) { this.fxState = { w, h, dpr }; this.fxImpl.setup(this.fxState); }
    this._kick();
  }

  _kick() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this._frame);
  }

  _frame(now) {
    this.raf = null;
    if ((!this.impl && !this.fxImpl) || document.hidden) return;
    const t = (now - this.t0) / 1000;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    if (now - (this.last || 0) >= 33 || this.reduced) { // ~30fps
      this.last = now;
      if (this.impl) this.impl.draw(this.state, this.ctx, this.reduced ? 4 : t, dt || 0.033);
      if (this.fxImpl) this.fxImpl.draw(this.fxState, this.fxCtx, this.reduced ? 0 : t, dt || 0.033);
    }
    if (!this.reduced) this._kick();
  }

  static thumbnail(def, w = 320, h = 190) {
    const impl = IMPL[def.id];
    const [c, x] = makeCanvas(w, h, 1);
    const st = { w, h, dpr: 1 };
    impl.setup(st);
    impl.draw(st, x, 4, 0.03);
    return c.toDataURL('image/jpeg', 0.8);
  }
}
