/**
 * Backgrounds: hand-built animated canvas scenes + live nature videos + user uploads.
 */
import { seeded, rand } from './util.js?v=20261117d';

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

/* ---------------- scene implementations ---------------- */
const IMPL = {
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
];

/* Live nature themes: clips hot-linked from Mixkit (Mixkit Stock Video Free License).
   Every clip here is shot from a still camera, and each one plays only the stretch [from, to)
   picked by frame analysis so that the frames around `to` match the frames around `from`.
   The loop crossfades between those matching moments, so the restart can't be seen. */
const MIX = 'https://assets.mixkit.co/videos';
export const VIDEO_SCENES = [
  // waterfalls and rivers
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
  // beaches and sea
  [50155, 'Beach hut sunset', 0, 9.927, { tone: 'light' }],
  [11359, 'Sunset bay', 2, 9.2, { tone: 'light' }],
  [1170, 'Palm silhouettes', 3.712, 22.564],
  [44500, 'Sunset terrace', 1.877, 9.885],
  [44499, 'Palm at dusk', 2.252, 8.467],
  [1191, 'Palm at sunset', 8.583, 16.958],
  [1566, 'Calm sea at dawn', 6.173, 14.181, { tone: 'light' }],
  // snow, rain and night
  [25106, 'Snowfall in the pines', 0, 8, { tone: 'light' }],
  [2716, 'Rain on the eaves', 1.418, 8.926],
  [2206, 'Rain in the pines', 4.504, 12.93],
  [22729, 'Misty forest', 3.25, 10.042],
  // this one drifts, so it stays still and the shooting stars are what move
  [19239, 'Snowy starry night', 0, 0, { meteors: true, still: true }],
].map(([vid, name, from, to, extra = {}]) => ({
  id: `v${vid}`, name, kind: extra.still ? 'photo' : 'video',
  video: `${MIX}/${vid}/${vid}-720.mp4`, loop: [from, to],
  poster: `${MIX}/${vid}/${vid}-thumb-720-0.jpg`,
  url: extra.still ? `${MIX}/${vid}/${vid}-thumb-720-0.jpg` : undefined,
  thumb: `${MIX}/${vid}/${vid}-thumb-360-0.jpg`,
  ...extra,
}));

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
          this.fxImpl = def.meteors ? METEORS : null;
          this.fx.classList.toggle('show', !!def.meteors);
          this._resize();
        },
        // the clip couldn't load: show its still frame instead
        onFail: () => { if (seq === this.seq) this.set({ ...def, kind: 'photo', url: def.poster }); },
      });
      return;
    }
    this.video.stop();
    this.vid.classList.remove('show');
    this.fxImpl = def.meteors ? METEORS : null; // shooting stars can cross a still sky too
    this.fx.classList.toggle('show', !!def.meteors);
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
