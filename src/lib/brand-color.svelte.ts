// A representative colour per site, sampled from its favicon, for glows and
// tints. Reading pixels needs a same-origin (or CORS) image: true for the
// extension's own /_favicon/ endpoint, usually false for the dev server's
// public favicon service, which then falls back to a hashed colour.

import { SvelteMap } from 'svelte/reactivity';
import { faviconUrl, tileColor } from './links';
import { hostOf } from './tree';

const LS_KEY = 'flexihome:brand-colors:v1';

/**
 * Weighted average of the saturated, visible pixels of RGBA data, with the
 * lightness pulled into a range that reads on both dark and light pages.
 * Null for monochrome icons (black/white/grey logos): there's no colour to find.
 */
export function dominantColor(data: Uint8ClampedArray): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.25 || max < 40) continue;
    const w = sat * sat;
    r += data[i] * w;
    g += data[i + 1] * w;
    b += data[i + 2] * w;
    total += w;
  }
  if (total < 4) return null;
  const [h, s, l] = rgbToHsl(r / total, g / total, b / total);
  return `hsl(${Math.round(h)} ${Math.round(Math.max(s, 0.55) * 100)}% ${Math.round(Math.min(0.62, Math.max(0.48, l)) * 100)}%)`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return [h, s, l];
}

function load(): [string, string][] {
  try {
    return Object.entries(JSON.parse(localStorage.getItem(LS_KEY) ?? '{}'));
  } catch {
    return [];
  }
}

/** Only sampled colours are stored, so a failed sample is retried next page load. */
const stored = new Map<string, string>(load());
const colors = new SvelteMap<string, string>(stored);
const pending = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function sample(url: string, host: string) {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = faviconUrl(url, 32);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 16, 16);
    const found = dominantColor(ctx.getImageData(0, 0, 16, 16).data); // throws on a cross-origin image
    const color = found ?? tileColor(host);
    stored.set(host, color);
    colors.set(host, color);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(stored)));
      } catch {
        // Cache only; resampling is cheap.
      }
    }, 1000);
  } catch {
    colors.set(host, tileColor(host));
  }
}

/** Reactive: returns a placeholder at first, then the sampled colour once it's ready. */
export function brandColor(url: string): string {
  const host = hostOf(url);
  if (!host) return tileColor(url);
  const hit = colors.get(host);
  if (hit) return hit;
  if (!pending.has(host)) {
    pending.add(host);
    queueMicrotask(() => void sample(url, host)); // never write state while a template is reading it
  }
  return tileColor(host);
}
