// Dot Field background: a grid of dots that breathes in a slow diagonal swell.
// Around the pointer the dots swell, warm to the accent and push outward like
// a lens; clicking the background sends a ripple through the grid.

import { isBackgroundClick, runLoop, type FxEngine } from './loop';

const GAP = 26;
const LENS_RADIUS = 170;
const LENS_PUSH = 16;
const RIPPLE_WIDTH = 40;

const PALETTE = {
  light: { rest: [31, 28, 23], restAlpha: 0.16, hot: [255, 91, 58], hotAlpha: 0.86 },
  dark: { rest: [242, 237, 227], restAlpha: 0.12, hot: [255, 106, 74], hotAlpha: 0.9 },
};

export const dotfield: FxEngine = (canvas, { animate, theme }) => {
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const pal = PALETTE[theme];
  const restFill = `rgba(${pal.rest.join(',')},${pal.restAlpha})`;
  let W = 0;
  let H = 0;
  let cols = 0;
  let rows = 0;
  // Smoothed pointer, so the lens glides rather than snaps.
  const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
  const ripples: { x: number; y: number; r: number }[] = [];

  function resize() {
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / GAP) + 1;
    rows = Math.ceil(H / GAP) + 1;
    if (!animate) draw(0, 0);
  }

  function draw(t: number, dt: number) {
    ctx.clearRect(0, 0, W, H);
    if (mouse.tx > -999) {
      mouse.x += (mouse.tx - mouse.x) * 0.18;
      mouse.y += (mouse.ty - mouse.y) * 0.18;
    }
    for (const rp of ripples) rp.r += dt * 0.7;
    while (ripples.length && ripples[0].r > Math.hypot(W, H)) ripples.shift();

    // Resting dots share one path and one fill; only "hot" ones are drawn individually.
    ctx.fillStyle = restFill;
    ctx.beginPath();
    const hot: number[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const gx = i * GAP;
        const gy = j * GAP;
        let x = gx;
        let y = gy;
        const wave = Math.sin(gx * 0.012 + gy * 0.009 - t * 0.0011) * 0.5 + 0.5;
        let r = 0.9 + wave * 0.6;
        let heat = 0;

        const dx = gx - mouse.x;
        const dy = gy - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < LENS_RADIUS) {
          const k = 1 - d / LENS_RADIUS;
          const e = k * k * (3 - 2 * k); // smoothstep
          x += (dx / (d || 1)) * e * LENS_PUSH;
          y += (dy / (d || 1)) * e * LENS_PUSH;
          r += e * 3.4;
          heat = e;
        }
        for (const rp of ripples) {
          const off = Math.abs(Math.hypot(gx - rp.x, gy - rp.y) - rp.r);
          if (off < RIPPLE_WIDTH) {
            const e = (1 - off / RIPPLE_WIDTH) * Math.max(0, 1 - rp.r / 900);
            r += e * 2.6;
            heat = Math.max(heat, e);
          }
        }

        if (heat > 0.02) hot.push(x, y, r, heat);
        else {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
    }
    ctx.fill();

    const [r0, g0, b0] = pal.rest;
    const [r1, g1, b1] = pal.hot;
    for (let k = 0; k < hot.length; k += 4) {
      const h = hot[k + 3];
      const mix = (a: number, b: number) => Math.round(a + (b - a) * h);
      ctx.fillStyle = `rgba(${mix(r0, r1)},${mix(g0, g1)},${mix(b0, b1)},${pal.restAlpha + (pal.hotAlpha - pal.restAlpha) * h})`;
      ctx.beginPath();
      ctx.arc(hot[k], hot[k + 1], hot[k + 2], 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const onMove = (e: PointerEvent) => {
    mouse.tx = e.clientX;
    mouse.ty = e.clientY;
    if (mouse.x < -999) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }
  };
  const onLeave = () => {
    mouse.tx = mouse.ty = mouse.x = mouse.y = -9999;
  };
  const onDown = (e: PointerEvent) => {
    if (isBackgroundClick(e)) ripples.push({ x: e.clientX, y: e.clientY, r: 0 });
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
