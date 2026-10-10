// Site icons, fetched once by the server and kept on disk. Serving them from
// our own address means every device gets them from one cache, and the page
// can read their pixels to pick each site's colour.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FRESH_MS = 30 * 86_400_000;
const MISSING_MS = 2 * 86_400_000;
const SIZES = [16, 32, 64];

export const isHostname = (h: string) => h.length <= 253 && /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(h);

export interface Icon {
  body: Buffer;
  type: string;
}

export class Favicons {
  #dir: string;
  #inflight = new Map<string, Promise<Icon | null>>();

  constructor(dataDir: string) {
    this.#dir = join(dataDir, 'favicons');
  }

  /** The icon for a site, or null when it has none (the page then draws a letter tile). */
  get(host: string, size: number): Promise<Icon | null> {
    const sz = SIZES.find((s) => s >= size) ?? 64;
    const key = `${host.toLowerCase()}@${sz}`;
    let p = this.#inflight.get(key);
    if (!p) {
      p = this.#load(host.toLowerCase(), sz).finally(() => this.#inflight.delete(key));
      this.#inflight.set(key, p);
    }
    return p;
  }

  async #load(host: string, size: number): Promise<Icon | null> {
    const file = join(this.#dir, `${host}@${size}`);
    const cached = await stat(file).catch(() => null);
    if (cached) {
      const age = Date.now() - cached.mtimeMs;
      if (cached.size === 0 ? age < MISSING_MS : age < FRESH_MS) return cached.size === 0 ? null : this.#read(file);
    }
    try {
      const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`, {
        signal: AbortSignal.timeout(6000),
      });
      await mkdir(this.#dir, { recursive: true });
      // A 404 still carries a generic globe; an empty file remembers "no icon" instead.
      if (!res.ok) {
        await writeFile(file, '');
        return null;
      }
      const body = Buffer.from(await res.arrayBuffer());
      await writeFile(file, body);
      return { body, type: sniff(body) };
    } catch {
      // Offline or slow: an old copy beats nothing.
      return cached && cached.size > 0 ? this.#read(file) : null;
    }
  }

  async #read(file: string): Promise<Icon> {
    const body = await readFile(file);
    return { body, type: sniff(body) };
  }
}

function sniff(b: Buffer): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF') return 'image/webp';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1) return 'image/x-icon';
  return 'image/png';
}
