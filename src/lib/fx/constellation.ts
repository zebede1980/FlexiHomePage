// Constellation background: drifting stars joined by faint lines, in front of
// a deep sky of nebula, a Milky Way band and faint dust stars. Stars shy away
// from the pointer and wire themselves to it, the field shifts slightly against
// the pointer for depth, shooting stars streak across now and then, and
// clicking the background sends a shockwave that makes the stars flare.
// Every minute or so a real constellation is traced out in a clear patch of
// sky and named, and every few minutes a comet drifts slowly across.
//
// Everything soft is drawn once: the deep sky is rendered to an offscreen
// canvas per resize, and each star is a pre-rendered glow sprite, so a frame is
// one blit plus a few hundred small drawImage calls.

import { isBackgroundClick, runLoop, type FxEngine } from './loop';
import { CHARTS, type Chart } from './star-charts';

type RGB = [number, number, number];

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Depth 0.3–1: nearer stars are bigger, faster and move more with parallax. */
  z: number;
  /** Displacement from the pointer, decays back to 0. */
  ox: number;
  oy: number;
  twinkle: number;
  /** Index into TINTS. */
  tint: number;
  /** Bright stars get diffraction spikes. */
  bright: boolean;
  /** Brief flare from a passing shockwave, decays to 0. */
  flash: number;
  rx: number;
  ry: number;
}

interface Meteor {
  x: number;
  y: number;
  /** Velocity in px/ms. */
  vx: number;
  vy: number;
  len: number;
  width: number;
  age: number;
  life: number;
  delay: number;
  tint: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

/** A real constellation being traced: screen positions are fixed when it appears. */
interface Figure {
  chart: Chart;
  pts: { x: number; y: number }[];
  labelX: number;
  labelY: number;
  /** Its patch of sky, where the drifting stars' own lines step back while it shows. */
  box: [number, number, number, number];
  age: number;
}

interface Comet {
  /** Quadratic Bézier path, from off one side of the screen to off the other. */
  path: [number, number][];
  age: number;
  life: number;
  /** Unit vector the tails stream along (away from an imagined sun). */
  ax: number;
  ay: number;
  emit: number;
}

/** A puff of the comet's dust tail; velocity in px/ms. */
interface Dust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

const LINK_DIST = 120;
const POINTER_REACH = 200;
const REPEL_RADIUS = 130;

/** Star colours by temperature, weighted towards blue-white; the skin's teal is in there too. */
const TINTS: RGB[] = [
  [170, 205, 255],
  [225, 235, 255],
  [150, 240, 228],
  [255, 228, 180],
  [255, 182, 140],
];
const TINT_WEIGHTS = [0.34, 0.3, 0.18, 0.12, 0.06];
const PINK: RGB = [255, 79, 216];
const TEAL: RGB = [94, 234, 212];

/** Average gap between shooting stars, and how often one is a small shower instead. */
const METEOR_EVERY_MS = 6500;
const SHOWER_CHANCE = 0.12;

/**
 * Constellation timeline (ms): the stars light up one by one, the lines draw
 * themselves in order, the name types out, then it all fades.
 */
const FIGURE_FIRST_MS = 15000;
const FIGURE_EVERY_MS = 60000;
const FIGURE_LIFE = 14000;
const FIGURE_FADE = 2500;
const FIGURE_STAR_STAGGER = 110;
const FIGURE_LINE_START = 500;
const FIGURE_LINE_STAGGER = 200;
const FIGURE_LINE_GROW = 500;
const FIGURE_DEPTH = 0.35;

/** Comets are rare and slow: the first after a minute or two, then every few minutes. */
const COMET_FIRST_MS = 75000;
const COMET_EVERY_MS = 240000;
const COMET_CROSS_MS = 32000;
const COMET_DEPTH = 0.3;

/** The deep sky moves this much with the pointer, against 0.3–1 for the stars. */
const SKY_DEPTH = 0.18;
const SKY_MARGIN = 10;
/** The nebula is soft, so it's computed at a quarter of the screen's resolution. */
const NEBULA_SCALE = 1 / 4;

export const constellation: FxEngine = (canvas, { animate }) => {
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  let W = 0;
  let H = 0;
  let stars: Star[] = [];
  const mouse = { x: -9999, y: -9999, sx: 0, sy: 0 };
  const shocks: { x: number; y: number; r: number }[] = [];
  const meteors: Meteor[] = [];
  const sparks: Spark[] = [];
  let sky: HTMLCanvasElement | null = null;
  let skyTimer = 0;
  let figure: Figure | null = null;
  let lastChart = -1;
  let nextFigure = FIGURE_FIRST_MS * (1 + Math.random() * 0.6);
  let comet: Comet | null = null;
  const dust: Dust[] = [];
  let nextComet = COMET_FIRST_MS * (1 + Math.random() * 0.8);
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace';

  const glows = [...TINTS, PINK].map(glowSprite);
  const spikes = TINTS.map(spikeSprite);
  const PINK_GLOW = glows.length - 1;
  const dustPuff = softSprite([255, 238, 214]);
  const coma = softSprite([190, 250, 240]);

  function resize() {
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The sky takes a moment to render, so while a window is being dragged (or a
    // phone's address bar slides) the old one is stretched until resizing settles.
    clearTimeout(skyTimer);
    if (!sky) sky = renderSky(W, H, dpr, glows);
    else
      skyTimer = window.setTimeout(() => {
        sky = renderSky(W, H, dpr, glows);
        if (!animate) draw(0, 0);
      }, 250);
    const n = Math.min(170, Math.round((W * H) / 10000));
    stars = Array.from({ length: n }, () => {
      const z = 0.3 + Math.random() * 0.7;
      const x = Math.random() * W;
      const y = Math.random() * H;
      return {
        x,
        y,
        vx: (Math.random() - 0.5) * 0.25 * z,
        vy: (Math.random() - 0.5) * 0.25 * z,
        z,
        ox: 0,
        oy: 0,
        twinkle: Math.random() * 6.28,
        tint: pick(TINT_WEIGHTS, Math.random()),
        bright: z > 0.72 && Math.random() < 0.22,
        flash: 0,
        rx: x,
        ry: y,
      };
    });
    if (!animate) draw(0, 0);
  }

  function spawnMeteors() {
    // Mostly falling left-to-right, sometimes right-to-left; a shower shares one radiant.
    const dir = Math.random() < 0.7 ? 1 : -1;
    const count = Math.random() < SHOWER_CHANCE ? 3 + Math.floor(Math.random() * 3) : 1;
    const ox = dir > 0 ? Math.random() * W * 0.6 : W * (0.4 + Math.random() * 0.6);
    const oy = Math.random() * H * 0.35;
    const base = (0.18 + Math.random() * 0.4) * dir;
    for (let i = 0; i < count; i++) {
      const a = base + (count > 1 ? (Math.random() - 0.5) * 0.3 : 0);
      const speed = 0.45 + Math.random() * 0.5;
      meteors.push({
        x: ox + (count > 1 ? (Math.random() - 0.5) * 160 : 0),
        y: oy + (count > 1 ? (Math.random() - 0.5) * 80 : 0),
        vx: Math.cos(a) * speed * dir,
        vy: Math.abs(Math.sin(a)) * speed + 0.08,
        len: 110 + Math.random() * 150,
        width: 1.4 + Math.random() * 1.6,
        age: 0,
        life: 700 + Math.random() * 700,
        delay: i * (150 + Math.random() * 350),
        tint: Math.random() < 0.6 ? 1 : pick(TINT_WEIGHTS, Math.random()),
      });
    }
  }

  function draw(t: number, dt: number) {
    ctx.clearRect(0, 0, W, H);
    const hasPointer = mouse.x > -999;
    const tx = hasPointer ? (mouse.x / W - 0.5) * -30 : 0;
    const ty = hasPointer ? (mouse.y / H - 0.5) * -20 : 0;
    mouse.sx += (tx - mouse.sx) * 0.04;
    mouse.sy += (ty - mouse.sy) * 0.04;

    if (sky) ctx.drawImage(sky, -SKY_MARGIN + mouse.sx * SKY_DEPTH, -SKY_MARGIN + mouse.sy * SKY_DEPTH, W + SKY_MARGIN * 2, H + SKY_MARGIN * 2);

    if (animate) {
      // The clocks only run while the loop does, so a hidden tab doesn't save them up.
      if (!figure && (nextFigure -= dt) <= 0) nextFigure = spawnFigure() ? FIGURE_EVERY_MS * (0.7 + Math.random() * 0.6) : 8000;
      if (!comet && (nextComet -= dt) <= 0) {
        spawnComet();
        nextComet = COMET_EVERY_MS * (0.75 + Math.random() * 0.5);
      }
      ctx.globalCompositeOperation = 'lighter';
      drawComet(dt);
      drawFigure(dt);
      ctx.globalCompositeOperation = 'source-over';
    }

    for (const s of shocks) s.r += dt * 0.9;
    while (shocks.length && shocks[0].r > Math.max(W, H)) shocks.shift();

    for (const p of stars) {
      p.x += p.vx * dt * 0.06;
      p.y += p.vy * dt * 0.06;
      if (p.x < -20) p.x = W + 20;
      else if (p.x > W + 20) p.x = -20;
      if (p.y < -20) p.y = H + 20;
      else if (p.y > H + 20) p.y = -20;

      const px = p.x + mouse.sx * p.z;
      const py = p.y + mouse.sy * p.z;
      const dx = px + p.ox - mouse.x;
      const dy = py + p.oy - mouse.y;
      const d = Math.hypot(dx, dy);
      if (d < REPEL_RADIUS && d > 0) {
        const f = (1 - d / REPEL_RADIUS) * 3.2;
        p.ox += (dx / d) * f;
        p.oy += (dy / d) * f;
      }
      for (const s of shocks) {
        if (Math.abs(Math.hypot(px - s.x, py - s.y) - s.r) < 30) {
          const a = Math.atan2(py - s.y, px - s.x);
          p.ox += Math.cos(a) * 4;
          p.oy += Math.sin(a) * 4;
          p.flash = 1;
        }
      }
      p.ox *= 0.94;
      p.oy *= 0.94;
      p.flash *= 0.95;
      p.rx = px + p.ox;
      p.ry = py + p.oy;
    }

    // How much the drifting network gives way to a constellation being traced.
    const f = figure;
    const hush = f ? 0.8 * Math.min(1, f.age / 800, (FIGURE_LIFE - f.age) / FIGURE_FADE) : 0;
    const inBox = (p: Star) => !!f && p.rx > f.box[0] && p.rx < f.box[2] && p.ry > f.box[1] && p.ry < f.box[3];

    ctx.lineWidth = 1;
    for (let i = 0; i < stars.length; i++) {
      const a = stars[i];
      const aIn = hush > 0 && inBox(a);
      for (let j = i + 1; j < stars.length; j++) {
        const b = stars[j];
        const dx = a.rx - b.rx;
        const dy = a.ry - b.ry;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK_DIST * LINK_DIST) {
          const quiet = aIn || (hush > 0 && inBox(b)) ? 1 - hush : 1;
          ctx.strokeStyle = `rgba(94,234,212,${(1 - Math.sqrt(d2) / LINK_DIST) * 0.22 * Math.min(a.z, b.z) * quiet})`;
          ctx.beginPath();
          ctx.moveTo(a.rx, a.ry);
          ctx.lineTo(b.rx, b.ry);
          ctx.stroke();
        }
      }
      const md = Math.hypot(a.rx - mouse.x, a.ry - mouse.y);
      if (md < POINTER_REACH) {
        const k = 1 - md / POINTER_REACH;
        const g = ctx.createLinearGradient(a.rx, a.ry, mouse.x, mouse.y);
        g.addColorStop(0, `rgba(94,234,212,${k * 0.6})`);
        g.addColorStop(1, `rgba(255,79,216,${k * 0.5})`);
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(a.rx, a.ry);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.stroke();
      }
    }

    // Glows add up where they overlap, like light does.
    ctx.globalCompositeOperation = 'lighter';
    for (const p of stars) {
      const near = Math.max(0, 1 - Math.hypot(p.rx - mouse.x, p.ry - mouse.y) / POINTER_REACH);
      const tw = 0.6 + Math.sin(t * 0.002 + p.twinkle) * 0.4;
      const r = p.z * 1.6 + near * 1.6 + p.flash * 1.5;
      const alpha = Math.min(1, 0.35 * tw + 0.4 * p.z + near * 0.5 + p.flash * 0.6);
      // The sprite's visible core is about a tenth of its size; the rest is halo.
      const size = r * 15;
      ctx.globalAlpha = alpha * (1 - near * 0.7);
      ctx.drawImage(glows[p.tint], p.rx - size / 2, p.ry - size / 2, size, size);
      // Shift to pink as a star nears the pointer.
      if (near > 0) {
        ctx.globalAlpha = alpha * near;
        ctx.drawImage(glows[PINK_GLOW], p.rx - size / 2, p.ry - size / 2, size, size);
      }
      if (p.bright) {
        // Diffraction spikes breathe with the twinkle (a faster flicker on top).
        const sp = (14 + p.z * 22) * (0.75 + 0.25 * Math.sin(t * 0.0037 + p.twinkle * 2)) * (1 + p.flash * 0.6 + near * 0.3);
        ctx.globalAlpha = Math.min(1, 0.35 + 0.45 * tw + p.flash * 0.4);
        ctx.drawImage(spikes[p.tint], p.rx - sp / 2, p.ry - sp / 2, sp, sp);
      }
    }
    ctx.globalAlpha = 1;

    for (const s of shocks) {
      const a = Math.max(0, 0.5 - s.r / 900);
      if (!a) continue;
      // A soft wide band with a crisp leading edge, cooling from teal to pink as it spreads.
      const k = Math.min(1, s.r / 600);
      const c = mix(TEAL, PINK, k);
      ctx.strokeStyle = `rgba(${c},${a * 0.18})`;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0, s.r - 6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${c},${a * 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(230,255,250,${a * 0.8})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.lineWidth = 1;

    if (animate) {
      if (Math.random() < dt / METEOR_EVERY_MS) spawnMeteors();
      drawMeteors(dt);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawMeteors(dt: number) {
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      if (m.delay > 0) {
        m.delay -= dt;
        continue;
      }
      m.age += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const p = m.age / m.life;
      if (p >= 1) {
        meteors.splice(i, 1);
        continue;
      }
      // Flares up quickly, burns out slowly; the tail grows in as it gets going.
      const fade = Math.min(1, p / 0.12) * (1 - p) ** 1.4;
      const sp = Math.hypot(m.vx, m.vy);
      const ux = m.vx / sp;
      const uy = m.vy / sp;
      const L = m.len * Math.min(1, m.age / 250);
      const ex = m.x - ux * L;
      const ey = m.y - uy * L;
      const c = TINTS[m.tint];

      const g = ctx.createLinearGradient(ex, ey, m.x, m.y);
      g.addColorStop(0, `rgba(${c},0)`);
      g.addColorStop(0.7, `rgba(${c},${0.25 * fade})`);
      g.addColorStop(1, `rgba(255,255,255,${0.9 * fade})`);
      // Tapered tail: a thin wedge from the head back to a point, with a bright core line.
      const nx = -uy * m.width;
      const ny = ux * m.width;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(m.x + nx, m.y + ny);
      ctx.lineTo(ex, ey);
      ctx.lineTo(m.x - nx, m.y - ny);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = g;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(ex + (m.x - ex) * 0.4, ey + (m.y - ey) * 0.4);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();

      ctx.globalAlpha = fade;
      const hs = 10 + m.width * 6;
      ctx.drawImage(glows[m.tint], m.x - hs / 2, m.y - hs / 2, hs, hs);
      ctx.globalAlpha = 1;

      // Shed a few embers that drift and fade behind the head.
      if (fade > 0.3 && Math.random() < dt / 30) {
        sparks.push({
          x: m.x,
          y: m.y,
          vx: m.vx * 0.15 + (Math.random() - 0.5) * 0.05,
          vy: m.vy * 0.15 + (Math.random() - 0.5) * 0.05 + 0.01,
          age: 0,
          life: 300 + Math.random() * 500,
        });
      }
    }
    ctx.lineWidth = 1;

    ctx.fillStyle = 'rgb(255,236,210)';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += dt;
      if (s.age >= s.life) {
        sparks.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      ctx.globalAlpha = 0.7 * (1 - s.age / s.life);
      ctx.fillRect(s.x - 0.6, s.y - 0.6, 1.2, 1.2);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Boxes of everything the page actually paints over the sky: text, icons and
   * any element with a background or border. Wrappers that only lay things out
   * paint nothing, so the gaps between cards still count as open sky.
   */
  function paintedBoxes(): DOMRect[] {
    const boxes: DOMRect[] = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      // An icon counts as one box; its insides don't need looking at.
      acceptNode: (n) => (n.parentElement?.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (!n.textContent?.trim()) continue;
        range.selectNodeContents(n);
        boxes.push(range.getBoundingClientRect());
        continue;
      }
      const el = n as Element;
      if (el === canvas) continue;
      const r = el.getBoundingClientRect();
      // Full-screen layers are backdrops, not content.
      if (!r.width || !r.height || r.width * r.height > W * H * 0.6) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const painted =
        el instanceof HTMLImageElement ||
        el instanceof SVGSVGElement ||
        el.matches('input, button, textarea, select') ||
        cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
        cs.backgroundImage !== 'none' ||
        parseFloat(cs.borderTopWidth) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderBottomWidth) > 0;
      if (painted) boxes.push(r);
    }
    return boxes;
  }

  /** Finds a clear patch of sky for a constellation, biggest first; false if there's no room. */
  function spawnFigure(): boolean {
    let ci = Math.floor(Math.random() * CHARTS.length);
    if (ci === lastChart) ci = (ci + 1) % CHARTS.length;
    const chart = CHARTS[ci];
    const base = Math.min(W, H);
    const boxes = paintedBoxes();
    for (let tries = 0; tries < 120; tries++) {
      const size = Math.max(110, base * (0.42 - tries * 0.002));
      const rot = (Math.random() - 0.5) * 0.5;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const cx = size / 2 + 24 + Math.random() * Math.max(0, W - size - 48);
      const cy = size / 2 + 24 + Math.random() * Math.max(0, H - size - 80);
      const pts = chart.stars.map((p) => ({ x: cx + (p.x * cos - p.y * sin) * size, y: cy + (p.x * sin + p.y * cos) * size }));
      const x0 = Math.min(...pts.map((p) => p.x)) - 16;
      const x1 = Math.max(...pts.map((p) => p.x)) + 16;
      const y0 = Math.min(...pts.map((p) => p.y)) - 16;
      const y1 = Math.max(...pts.map((p) => p.y)) + 44;
      if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) continue;
      if (boxes.some((b) => b.left < x1 && b.right > x0 && b.top < y1 && b.bottom > y0)) continue;
      figure = { chart, pts, labelX: (x0 + x1) / 2, labelY: y1 - 22, box: [x0, y0, x1, y1], age: 0 };
      lastChart = ci;
      return true;
    }
    return false;
  }

  function drawFigure(dt: number) {
    const f = figure;
    if (!f) return;
    f.age += dt;
    if (f.age >= FIGURE_LIFE) {
      figure = null;
      return;
    }
    const out = Math.min(1, (FIGURE_LIFE - f.age) / FIGURE_FADE);
    ctx.save();
    ctx.translate(mouse.sx * FIGURE_DEPTH, mouse.sy * FIGURE_DEPTH);

    f.chart.lines.forEach(([ia, ib], k) => {
      const g = (f.age - FIGURE_LINE_START - k * FIGURE_LINE_STAGGER) / FIGURE_LINE_GROW;
      if (g <= 0) return;
      const a = f.pts[ia];
      const b = f.pts[ib];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      // Lines stop short of the stars, as on a star chart.
      const gap = 6;
      if (d < gap * 3) return;
      const ux = (b.x - a.x) / d;
      const uy = (b.y - a.y) / d;
      const e = 1 - (1 - Math.min(1, g)) ** 3;
      const sx = a.x + ux * gap;
      const sy = a.y + uy * gap;
      const ex = sx + ux * (d - gap * 2) * e;
      const ey = sy + uy * (d - gap * 2) * e;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = `rgba(94,234,212,${0.1 * out})`;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = `rgba(170,245,232,${0.5 * out})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.lineWidth = 1;

    f.chart.stars.forEach((p, i) => {
      const a = (f.age - i * FIGURE_STAR_STAGGER) / 600;
      if (a <= 0) return;
      // Each star flares as it lights, then settles.
      const bloom = a < 1.6 ? Math.sin((a / 1.6) * Math.PI) : 0;
      const bright = Math.max(0.15, Math.min(1, (4.8 - p.mag) / 4.8));
      const tw = 0.85 + 0.15 * Math.sin(f.age * 0.003 + i * 1.7);
      const size = (9 + bright * 20) * (1 + bloom * 0.6);
      const pt = f.pts[i];
      ctx.globalAlpha = Math.min(1, a) * out * (0.55 + 0.45 * bright) * tw;
      ctx.drawImage(glows[p.tint], pt.x - size / 2, pt.y - size / 2, size, size);
      if (p.mag < 1.2) {
        const sp = size * 1.9;
        ctx.globalAlpha *= 0.85;
        ctx.drawImage(spikes[p.tint], pt.x - sp / 2, pt.y - sp / 2, sp, sp);
      }
    });
    ctx.globalAlpha = 1;

    // The name types itself out once the figure is drawn.
    const labelAt = FIGURE_LINE_START + f.chart.lines.length * FIGURE_LINE_STAGGER + FIGURE_LINE_GROW;
    if (f.age > labelAt) {
      const n = Math.floor((f.age - labelAt) / 45);
      ctx.globalCompositeOperation = 'source-over';
      ctx.textBaseline = 'middle';
      ctx.font = `600 10.5px ${mono}`;
      ctx.fillStyle = `rgba(94,234,212,${0.8 * out})`;
      spacedText(f.chart.name.toUpperCase(), f.labelX, f.labelY, 3, n);
      ctx.font = `400 9.5px ${mono}`;
      ctx.fillStyle = `rgba(200,220,245,${0.45 * out})`;
      spacedText(f.chart.gloss.toUpperCase(), f.labelX, f.labelY + 15, 2.5, n - f.chart.name.length);
    }
    ctx.restore();
  }

  /** Letter-spaced text centred on x, showing only its first `shown` characters (canvas letterSpacing isn't everywhere yet). */
  function spacedText(text: string, x: number, y: number, spacing: number, shown: number) {
    if (shown <= 0) return;
    const widths = [...text].map((ch) => ctx.measureText(ch).width);
    let cx = x - (widths.reduce((s, w) => s + w, 0) + spacing * (text.length - 1)) / 2;
    for (let i = 0; i < Math.min(shown, text.length); i++) {
      ctx.fillText(text[i], cx, y);
      cx += widths[i] + spacing;
    }
  }

  function spawnComet() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const x0 = dir > 0 ? -90 : W + 90;
    const x2 = dir > 0 ? W + 90 : -90;
    const y0 = H * (0.06 + Math.random() * 0.32);
    const y2 = Math.max(H * 0.05, Math.min(H * 0.7, y0 + (Math.random() - 0.35) * H * 0.4));
    const mx = (x0 + x2) / 2;
    const my = (y0 + y2) / 2 + (Math.random() - 0.5) * H * 0.3;
    // Tails stream away from an imagined sun: back along the path, swung towards the top of the screen.
    const d = Math.hypot(x2 - x0, y2 - y0);
    const bx = (x0 - x2) / d;
    const by = (y0 - y2) / d;
    const swing = 0.45 + Math.random() * 0.45;
    const options = [swing, -swing].map((t) => [bx * Math.cos(t) - by * Math.sin(t), bx * Math.sin(t) + by * Math.cos(t)]);
    const [ax, ay] = options[0][1] < options[1][1] ? options[0] : options[1];
    comet = {
      path: [
        [x0, y0],
        [mx, my],
        [x2, y2],
      ],
      age: 0,
      life: COMET_CROSS_MS * Math.max(0.6, Math.min(1.3, W / 1440)) * (0.85 + Math.random() * 0.3),
      ax,
      ay,
      emit: 0,
    };
  }

  function drawComet(dt: number) {
    ctx.save();
    ctx.translate(mouse.sx * COMET_DEPTH, mouse.sy * COMET_DEPTH);

    let hx = 0;
    let hy = 0;
    const c = comet;
    if (c) {
      c.age += dt;
      const u = c.age / c.life;
      if (u >= 1) comet = null;
      else {
        const [[x0, y0], [x1, y1], [x2, y2]] = c.path;
        const v = 1 - u;
        hx = v * v * x0 + 2 * v * u * x1 + u * u * x2;
        hy = v * v * y0 + 2 * v * u * y1 + u * u * y2;
        // Dust left behind and pushed outwards curves naturally into the broad tail.
        c.emit += dt;
        while (c.emit > 7) {
          c.emit -= 7;
          const push = 0.01 + Math.random() * 0.022;
          dust.push({
            x: hx + (Math.random() - 0.5) * 3,
            y: hy + (Math.random() - 0.5) * 3,
            vx: c.ax * push + (Math.random() - 0.5) * 0.006,
            vy: c.ay * push + (Math.random() - 0.5) * 0.006,
            age: 0,
            life: 3000 + Math.random() * 2500,
          });
        }
      }
    }

    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i];
      d.age += dt;
      if (d.age >= d.life) {
        dust.splice(i, 1);
        continue;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const k = d.age / d.life;
      const size = 6 + k * 34;
      ctx.globalAlpha = 0.085 * (1 - k) ** 1.5 * Math.min(1, d.age / 250);
      ctx.drawImage(dustPuff, d.x - size / 2, d.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;

    if (c && comet) {
      // The ion tail: thin, straight and blue, pointing directly away from the sun.
      const flicker = 0.85 + 0.15 * Math.sin(c.age * 0.004);
      for (const [len, alpha, bend] of [
        [260, 0.32, 0],
        [180, 0.16, 0.07],
      ] as const) {
        const ax = c.ax * Math.cos(bend) - c.ay * Math.sin(bend);
        const ay = c.ax * Math.sin(bend) + c.ay * Math.cos(bend);
        const ex = hx + ax * len * flicker;
        const ey = hy + ay * len * flicker;
        const g = ctx.createLinearGradient(hx, hy, ex, ey);
        g.addColorStop(0, `rgba(160,205,255,${alpha})`);
        g.addColorStop(1, 'rgba(160,205,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(hx - ay * 2.4, hy + ax * 2.4);
        ctx.lineTo(ex, ey);
        ctx.lineTo(hx + ay * 2.4, hy - ax * 2.4);
        ctx.closePath();
        ctx.fill();
      }
      const pulse = 1 + 0.06 * Math.sin(c.age * 0.003);
      ctx.globalAlpha = 0.4;
      ctx.drawImage(coma, hx - 26 * pulse, hy - 26 * pulse, 52 * pulse, 52 * pulse);
      ctx.globalAlpha = 1;
      ctx.drawImage(glows[1], hx - 11, hy - 11, 22, 22);
    }
    ctx.restore();
  }

  const onMove = (e: PointerEvent) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  };
  const onLeave = () => {
    mouse.x = mouse.y = -9999;
  };
  const onDown = (e: PointerEvent) => {
    if (isBackgroundClick(e)) shocks.push({ x: e.clientX, y: e.clientY, r: 0 });
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
    clearTimeout(skyTimer);
    removeEventListener('resize', resize);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerdown', onDown);
    document.documentElement.removeEventListener('pointerleave', onLeave);
  };
};

/** A soft round star: white-hot core, tinted halo. */
function glowSprite([r, g, b]: RGB): HTMLCanvasElement {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const grad = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // Falls off steeply, like a real star's glow, rather than a fuzzy disc.
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.06, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.12, `rgba(${r},${g},${b},0.7)`);
  grad.addColorStop(0.22, `rgba(${r},${g},${b},0.18)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.04)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grad;
  x.fillRect(0, 0, S, S);
  return c;
}

/** An even soft blob with no bright centre, for gas and dust. */
function softSprite([r, g, b]: RGB): HTMLCanvasElement {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const grad = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.4)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grad;
  x.fillRect(0, 0, S, S);
  return c;
}

/** Four-point diffraction spikes, fading towards their tips, with a little glow. */
function spikeSprite([r, g, b]: RGB): HTMLCanvasElement {
  const S = 128;
  const h = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.globalCompositeOperation = 'lighter';
  for (const [dx, dy, w] of [
    [1, 0, 1.6],
    [0, 1, 1.6],
  ] as const) {
    const grad = x.createLinearGradient(h - h * dx, h - h * dy, h + h * dx, h + h * dy);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = grad;
    if (dx) x.fillRect(0, h - w / 2, S, w);
    else x.fillRect(h - w / 2, 0, w, S);
  }
  const glow = x.createRadialGradient(h, h, 0, h, h, h * 0.35);
  glow.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
  glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = glow;
  x.fillRect(0, 0, S, S);
  return c;
}

/**
 * The deep sky: nebula clouds along a Milky Way band, dark dust lanes through
 * it, and a scatter of faint dust stars, thicker in the band. Seeded, so a
 * resize redraws the same sky rather than a new one.
 */
function renderSky(W: number, H: number, dpr: number, glows: HTMLCanvasElement[]): HTMLCanvasElement {
  const SW = W + SKY_MARGIN * 2;
  const SH = H + SKY_MARGIN * 2;
  const out = document.createElement('canvas');
  out.width = Math.round(SW * dpr);
  out.height = Math.round(SH * dpr);
  const o = out.getContext('2d')!;
  o.scale(dpr, dpr);

  const rand = mulberry32(0x5eed);
  const cloud = valueNoise(rand);
  const hue = valueNoise(rand);
  const dust = valueNoise(rand);
  // Measured against the longer side so the sky keeps its scale on any screen.
  const L = Math.max(SW, SH);
  // The band: a gentle diagonal from lower left to upper right.
  const ang = -0.42;
  const bx = Math.cos(ang);
  const by = Math.sin(ang);
  const cx = SW * 0.5;
  const cy = SH * 0.55;

  const nw = Math.max(1, Math.round(SW * NEBULA_SCALE));
  const nh = Math.max(1, Math.round(SH * NEBULA_SCALE));
  const neb = document.createElement('canvas');
  neb.width = nw;
  neb.height = nh;
  const nctx = neb.getContext('2d')!;
  const img = nctx.createImageData(nw, nh);
  const data = img.data;
  const deep: RGB = [40, 70, 160];
  const milk: RGB = [200, 205, 255];
  const palette: RGB[] = [TEAL, [120, 110, 255], [190, 80, 230], PINK];

  const bandAt = (x: number, y: number) => {
    // Distance from the band's centre line, wobbled by noise so it isn't a ruler-straight stripe.
    const d = ((x - cx) * -by + (y - cy) * bx) / L;
    const wob = (cloud.fbm((x / L) * 1.5 + 9, (y / L) * 1.5, 3) - 0.5) * 0.18;
    return Math.exp(-(((d + wob) / 0.16) ** 2));
  };

  for (let j = 0; j < nh; j++) {
    for (let i = 0; i < nw; i++) {
      const x = (i + 0.5) / NEBULA_SCALE;
      const y = (j + 0.5) / NEBULA_SCALE;
      const u = x / L;
      const v = y / L;
      const band = bandAt(x, y);
      const n = cloud.fbm(u * 3.2, v * 3.2, 5);
      const lane = smooth(0.52, 0.7, dust.fbm(u * 6 + 3, v * 6, 4)) * band;
      // Wisps everywhere, thickest in the band; dust lanes eat into it.
      let dens = smooth(0.38, 0.85, n) * (0.25 + 0.75 * band) * (1 - 0.75 * lane);
      dens += band * 0.35 * (1 - 0.6 * lane);
      // Noise sits near 0.5, so stretch it to reach every colour in the palette.
      const hn = Math.max(0, Math.min(1, (hue.fbm(u * 2 + 5, v * 2, 3) - 0.5) * 2.6 + 0.5));
      const k = Math.min(palette.length - 1.001, hn * (palette.length - 1));
      const a = palette[Math.floor(k)];
      const b = palette[Math.floor(k) + 1];
      const f = k - Math.floor(k);
      // The band's heart is pale, like the Milky Way, and its edges lean deep blue.
      const core = band ** 3 * (1 - lane);
      const edge = band * (1 - band) * 1.5;
      const idx = (j * nw + i) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const c = a[ch] + (b[ch] - a[ch]) * f;
        data[idx + ch] = c + (milk[ch] - c) * core * 0.75 + (deep[ch] - c) * edge * 0.4;
      }
      // A little dither stops faint gradients from banding.
      data[idx + 3] = Math.max(0, Math.min(255, (dens + core * 0.25) * 48 + (rand() - 0.5) * 3));
    }
  }
  nctx.putImageData(img, 0, 0);
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = 'high';
  o.drawImage(neb, 0, 0, SW, SH);

  // Dust stars: a sprinkle everywhere, then star clouds crowding the band.
  const area = SW * SH;
  const dot = (x: number, y: number, r: number, alpha: number) => {
    o.fillStyle = `rgba(${TINTS[pick(TINT_WEIGHTS, rand())]},${alpha})`;
    o.beginPath();
    o.arc(x, y, r, 0, Math.PI * 2);
    o.fill();
  };
  for (let i = 0, n = Math.round(area / 1800); i < n; i++) {
    dot(rand() * SW, rand() * SH, 0.3 + rand() ** 3 * 0.8, 0.2 + rand() * 0.45);
  }
  for (let i = 0, n = Math.round(area / 450); i < n; i++) {
    const x = rand() * SW;
    const y = rand() * SH;
    const band = bandAt(x, y);
    if (rand() > band * band) continue;
    dot(x, y, 0.25 + rand() * 0.35, 0.12 + rand() * 0.35 * band);
  }
  // A handful of brighter fixed stars, drawn like the moving ones.
  o.globalCompositeOperation = 'lighter';
  for (let i = 0, n = Math.round(area / 50000); i < n; i++) {
    const size = 7 + rand() * 7;
    o.globalAlpha = 0.45 + rand() * 0.4;
    o.drawImage(glows[pick(TINT_WEIGHTS, rand())], rand() * SW - size / 2, rand() * SH - size / 2, size, size);
  }
  return out;
}

function pick(weights: number[], r: number): number {
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function mix(a: RGB, b: RGB, k: number): string {
  return `${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)}`;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 2D value noise on a 256-cell lattice, with fractal octaves; values in 0–1. */
function valueNoise(rand: () => number) {
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) vals[i] = rand();
  const at = (x: number, y: number) => vals[perm[(x & 255) + perm[y & 255]]];
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return {
    fbm(x: number, y: number, octaves: number) {
      let sum = 0;
      let amp = 0.5;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += noise(x, y) * amp;
        norm += amp;
        amp *= 0.5;
        x = x * 2 + 17.3;
        y = y * 2 + 9.1;
      }
      return sum / norm;
    },
  };
}
