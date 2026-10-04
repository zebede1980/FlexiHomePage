// Aurora background: big soft colour fields drifting on slow Lissajous paths.
// Moving the pointer is like dragging a finger through wet paint: it smears
// dabs of colour along its path (carried forward and pushed out to the sides,
// spreading as they settle), sends faint rings out like ripples, and shoves the
// colour fields along before they drift back. Clicking the background flicks
// a small splash.
//
// Drawn at 1/3 resolution and upscaled by the browser: everything here is soft,
// so the upscale costs nothing visible and keeps each frame cheap.

import { isBackgroundClick, runLoop, type FxEngine } from './loop';

const SCALE = 1 / 3;
const BG = '#070618';

/** Screen px of pointer travel between paint dabs, and between rings. */
const DAB_SPACING = 9;
const RING_SPACING = 170;
/** Screen px of travel before the stroke moves on to the next palette colour. */
const COLOUR_RUN = 140;
const MAX_DABS = 260;
const MAX_RINGS = 24;

// Easing time constants (ms), applied by elapsed time so the feel doesn't
// change with frame rate.
const BLOB_TAU = 600;
const BLOB_RETURN_TAU = 2500;
const DAB_DRAG_TAU = 300;

type RGB = [number, number, number];

interface Blob {
  x: number;
  y: number;
  /** Radius as a fraction of the longer screen side. */
  r: number;
  c: RGB;
  speed: number;
  phase: number;
  cx: number;
  cy: number;
  /** Displacement from being pushed by the pointer; decays back to 0. */
  ox: number;
  oy: number;
}

/** A soft dab of paint, in screen px; velocity in px/ms. */
interface Dab {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r0: number;
  r1: number;
  alpha: number;
  colour: number;
  age: number;
  life: number;
}

interface Ring {
  x: number;
  y: number;
  maxR: number;
  alpha: number;
  colour: number;
  age: number;
  life: number;
}

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(n) ? [124, 108, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A soft round dab in one colour, drawn once and stamped with drawImage (far cheaper than a gradient per dab). */
function dabSprite([R, G, B]: RGB): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${R},${G},${B},1)`);
  grad.addColorStop(0.5, `rgba(${R},${G},${B},0.45)`);
  grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const aurora: FxEngine = (canvas, { animate, accent }) => {
  const ctx = canvas.getContext('2d')!;
  const main = hexToRgb(accent);
  const deep: RGB = [Math.round(main[0] * 0.6), Math.round(main[1] * 0.4), Math.round(main[2] * 0.8)];
  const palette: RGB[] = [main, [40, 190, 240], [220, 70, 200], [60, 90, 255]];
  const sprites = palette.map(dabSprite);

  const blobs: Blob[] = (
    [
      { x: 0.15, y: 0.15, r: 0.55, c: main, speed: 0.00011, phase: 0 },
      { x: 0.85, y: 0.12, r: 0.45, c: palette[1], speed: 0.00014, phase: 2 },
      { x: 0.6, y: 0.95, r: 0.6, c: palette[2], speed: 0.00009, phase: 4 },
      { x: 0.1, y: 0.85, r: 0.4, c: palette[3], speed: 0.00013, phase: 1 },
      { x: 0.5, y: 0.45, r: 0.35, c: deep, speed: 0.00017, phase: 3 },
    ] as Omit<Blob, 'cx' | 'cy' | 'ox' | 'oy'>[]
  ).map((b) => ({ ...b, cx: b.x, cy: b.y, ox: 0, oy: 0 }));

  const dabs: Dab[] = [];
  const rings: Ring[] = [];
  /** Last pointer sample, and distance travelled since the last dab/ring. */
  const last = { x: 0, y: 0, t: 0, seen: false };
  let travelled = 0;
  let sinceDab = 0;
  let sinceRing = 0;

  function resize() {
    canvas.width = Math.ceil(innerWidth * SCALE);
    canvas.height = Math.ceil(innerHeight * SCALE);
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); // draw in screen px from here on
    if (!animate) draw(0, 0);
  }

  function addDab(x: number, y: number, vx: number, vy: number, strength: number) {
    const speed = Math.hypot(vx, vy);
    // Mostly carried along with the stroke, plus a push out to one side: a wake.
    const side = Math.atan2(vy, vx) + (Math.random() < 0.5 ? 1 : -1) * Math.PI * 0.5;
    const push = speed * (0.06 + Math.random() * 0.12);
    const r0 = 10 + 14 * strength;
    dabs.push({
      x,
      y,
      vx: vx * 0.2 + Math.cos(side) * push,
      vy: vy * 0.2 + Math.sin(side) * push,
      r0,
      r1: r0 * (2.5 + Math.random()),
      alpha: 0.08 + 0.1 * strength,
      colour: Math.floor(travelled / COLOUR_RUN) % palette.length,
      age: 0,
      life: 1100 + 900 * Math.random(),
    });
    if (dabs.length > MAX_DABS) dabs.splice(0, dabs.length - MAX_DABS);
  }

  function addRing(x: number, y: number, strength: number, colour = Math.floor(travelled / COLOUR_RUN) % palette.length) {
    rings.push({ x, y, maxR: 90 + 110 * strength, alpha: 0.06 * strength, colour, age: 0, life: 1600 });
    if (rings.length > MAX_RINGS) rings.shift();
  }

  function draw(t: number, dt: number) {
    const W = innerWidth;
    const H = innerHeight;
    const M = Math.max(W, H);
    const ease = (tau: number) => (animate ? 1 - Math.exp(-dt / tau) : 1);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // Colour fields, displaced by the pointer and drifting back.
    const settle = 1 - ease(BLOB_RETURN_TAU);
    for (const b of blobs) {
      b.ox *= settle;
      b.oy *= settle;
      const tx = b.x + Math.sin(t * b.speed * 7 + b.phase) * 0.12;
      const ty = b.y + Math.cos(t * b.speed * 5 + b.phase * 1.3) * 0.1;
      b.cx += (tx - b.cx) * ease(BLOB_TAU);
      b.cy += (ty - b.cy) * ease(BLOB_TAU);
      const x = (b.cx + b.ox) * W;
      const y = (b.cy + b.oy) * H;
      const r = b.r * M * (1 + Math.sin(t * 0.0004 + b.phase) * 0.08);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const [R, G, B] = b.c;
      g.addColorStop(0, `rgba(${R},${G},${B},0.42)`);
      g.addColorStop(1, `rgba(${R},${G},${B},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Paint dabs: carried by their velocity, which drags to a stop, spreading as they settle.
    // A moving dab is stretched along its direction of travel, so the trail reads as a
    // smear rather than a string of dots, and rounds out as it comes to rest.
    const drag = 1 - ease(DAB_DRAG_TAU);
    for (let i = dabs.length - 1; i >= 0; i--) {
      const d = dabs[i];
      d.age += dt;
      const p = d.age / d.life;
      if (p >= 1) {
        dabs.splice(i, 1);
        continue;
      }
      d.vx *= drag;
      d.vy *= drag;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const r = d.r0 + (d.r1 - d.r0) * (1 - (1 - p) ** 2);
      const speed = Math.hypot(d.vx, d.vy);
      const stretch = 1 + Math.min(2.2, speed * 6);
      const cos = speed ? d.vx / speed : 1;
      const sin = speed ? d.vy / speed : 0;
      ctx.setTransform(SCALE * cos * stretch, SCALE * sin * stretch, -SCALE * sin, SCALE * cos, SCALE * d.x, SCALE * d.y);
      ctx.globalAlpha = d.alpha * (1 - p) ** 1.4 * Math.min(1, d.age / 80);
      ctx.drawImage(sprites[d.colour], -r, -r, r * 2, r * 2);
    }
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

    // Ripple rings, easing out as they fade.
    ctx.lineWidth = 2.5;
    for (let i = rings.length - 1; i >= 0; i--) {
      const rg = rings[i];
      rg.age += dt;
      const p = rg.age / rg.life;
      if (p >= 1) {
        rings.splice(i, 1);
        continue;
      }
      const [R, G, B] = palette[rg.colour];
      ctx.globalAlpha = rg.alpha * (1 - p);
      ctx.strokeStyle = `rgb(${R},${G},${B})`;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.maxR * (1 - (1 - p) ** 2.5), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const onMove = (e: PointerEvent) => {
    const { clientX: x, clientY: y, timeStamp: t } = e;
    if (!last.seen) {
      Object.assign(last, { x, y, t, seen: true });
      return;
    }
    const dx = x - last.x;
    const dy = y - last.y;
    const dist = Math.hypot(dx, dy);
    const elapsed = Math.max(8, t - last.t);
    Object.assign(last, { x, y, t });
    if (dist < 0.5) return;

    const vx = dx / elapsed; // px/ms
    const vy = dy / elapsed;
    const strength = clamp(Math.hypot(vx, vy) / 1.2, 0.25, 1); // slow strokes barely disturb it

    // Shove the colour fields that sit under the stroke.
    for (const b of blobs) {
      const bx = (b.cx + b.ox) * innerWidth;
      const by = (b.cy + b.oy) * innerHeight;
      const reach = b.r * Math.max(innerWidth, innerHeight);
      const influence = Math.exp(-(((x - bx) ** 2 + (y - by) ** 2) / (reach * reach)));
      b.ox = clamp(b.ox + (dx / innerWidth) * influence * 0.35, -0.25, 0.25);
      b.oy = clamp(b.oy + (dy / innerHeight) * influence * 0.35, -0.25, 0.25);
    }

    // Lay paint along the whole segment, not just at the sample, so fast strokes stay continuous.
    for (let s = DAB_SPACING - sinceDab, n = 0; s <= dist && n < 14; s += DAB_SPACING, n++) {
      const k = s / dist;
      addDab(x - dx + dx * k, y - dy + dy * k, vx, vy, strength);
    }
    sinceDab = (sinceDab + dist) % DAB_SPACING;

    sinceRing += dist;
    if (sinceRing >= RING_SPACING) {
      sinceRing = 0;
      addRing(x, y, strength);
    }
    travelled += dist;
  };

  const onLeave = () => {
    last.seen = false;
  };

  const onDown = (e: PointerEvent) => {
    if (!isBackgroundClick(e)) return;
    addRing(e.clientX, e.clientY, 1.4, 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      const v = 0.25 + Math.random() * 0.25;
      addDab(e.clientX, e.clientY, Math.cos(a) * v, Math.sin(a) * v, 0.8);
      dabs[dabs.length - 1].colour = i % palette.length;
    }
  };

  resize();
  addEventListener('resize', resize);
  let stop = () => {};
  if (animate) {
    addEventListener('pointermove', onMove);
    addEventListener('pointerdown', onDown);
    document.documentElement.addEventListener('pointerleave', onLeave);
    stop = runLoop(draw);
  }

  return () => {
    stop();
    removeEventListener('resize', resize);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerdown', onDown);
    document.documentElement.removeEventListener('pointerleave', onLeave);
  };
};
