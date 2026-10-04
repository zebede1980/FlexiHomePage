// Constellation background: drifting stars joined by faint lines. Stars shy
// away from the pointer and wire themselves to it, the field shifts slightly
// against the pointer for depth, and clicking the background sends a shockwave.

import { isBackgroundClick, runLoop, type FxEngine } from './loop';

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
  rx: number;
  ry: number;
}

const LINK_DIST = 120;
const POINTER_REACH = 200;
const REPEL_RADIUS = 130;

export const constellation: FxEngine = (canvas, { animate }) => {
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  let W = 0;
  let H = 0;
  let stars: Star[] = [];
  const mouse = { x: -9999, y: -9999, sx: 0, sy: 0 };
  const shocks: { x: number; y: number; r: number }[] = [];
  let meteor: { x: number; y: number; age: number } | null = null;

  function resize() {
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(170, Math.round((W * H) / 10000));
    stars = Array.from({ length: n }, () => {
      const z = 0.3 + Math.random() * 0.7;
      const x = Math.random() * W;
      const y = Math.random() * H;
      return { x, y, vx: (Math.random() - 0.5) * 0.25 * z, vy: (Math.random() - 0.5) * 0.25 * z, z, ox: 0, oy: 0, twinkle: Math.random() * 6.28, rx: x, ry: y };
    });
    if (!animate) draw(0, 0);
  }

  function draw(t: number, dt: number) {
    ctx.clearRect(0, 0, W, H);
    const hasPointer = mouse.x > -999;
    const tx = hasPointer ? (mouse.x / W - 0.5) * -30 : 0;
    const ty = hasPointer ? (mouse.y / H - 0.5) * -20 : 0;
    mouse.sx += (tx - mouse.sx) * 0.04;
    mouse.sy += (ty - mouse.sy) * 0.04;

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
        }
      }
      p.ox *= 0.94;
      p.oy *= 0.94;
      p.rx = px + p.ox;
      p.ry = py + p.oy;
    }

    ctx.lineWidth = 1;
    for (let i = 0; i < stars.length; i++) {
      const a = stars[i];
      for (let j = i + 1; j < stars.length; j++) {
        const b = stars[j];
        const dx = a.rx - b.rx;
        const dy = a.ry - b.ry;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK_DIST * LINK_DIST) {
          ctx.strokeStyle = `rgba(94,234,212,${(1 - Math.sqrt(d2) / LINK_DIST) * 0.22 * Math.min(a.z, b.z)})`;
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

    for (const p of stars) {
      const near = Math.max(0, 1 - Math.hypot(p.rx - mouse.x, p.ry - mouse.y) / POINTER_REACH);
      const tw = 0.6 + Math.sin(t * 0.002 + p.twinkle) * 0.4;
      // Cyan → pink as a star nears the pointer.
      ctx.fillStyle =
        near > 0
          ? `rgba(${94 + 161 * near},${234 - 155 * near},${212 + 4 * near},${0.5 + near * 0.5})`
          : `rgba(180,240,255,${0.35 * tw + 0.25 * p.z})`;
      ctx.beginPath();
      ctx.arc(p.rx, p.ry, p.z * 1.6 + near * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const s of shocks) {
      ctx.strokeStyle = `rgba(94,234,212,${Math.max(0, 0.5 - s.r / 900)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (!animate) return;
    if (!meteor && Math.random() < 0.0025) meteor = { x: Math.random() * W * 0.7, y: Math.random() * H * 0.3, age: 0 };
    if (meteor) {
      meteor.age += dt;
      const p = meteor.age / 900;
      const x = meteor.x + p * 500;
      const y = meteor.y + p * 220;
      const g = ctx.createLinearGradient(x - 120, y - 53, x, y);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, `rgba(255,255,255,${0.8 * (1 - p)})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 120, y - 53);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (p >= 1) meteor = null;
    }
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
    removeEventListener('resize', resize);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerdown', onDown);
    document.documentElement.removeEventListener('pointerleave', onLeave);
  };
};
