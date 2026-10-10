// Favicons and link opening, with fallbacks for the dev server (no extension APIs).

import { mode } from './backend.svelte';
import { hostOf } from './tree';

const inExtension = mode === 'extension';

/**
 * Chromium's built-in favicon cache in the extension (needs the "favicon"
 * permission); the server's own icon cache on the hosted site; a public
 * service under `npm run dev`.
 */
export function faviconUrl(pageUrl: string, size = 32): string {
  if (inExtension) {
    const u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', String(size));
    return u.toString();
  }
  const host = encodeURIComponent(hostOf(pageUrl));
  return mode === 'hosted' ? `/api/favicon?host=${host}&sz=${size}` : `https://www.google.com/s2/favicons?domain=${host}&sz=${size}`;
}

/** Stable pleasant colour for a letter tile when no favicon is available. */
export function tileColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `oklch(0.62 0.13 ${h % 360})`;
}

export async function openInBackgroundTabs(urls: string[]) {
  for (const url of urls) {
    if (inExtension) await chrome.tabs.create({ url, active: false });
    else window.open(url, '_blank', 'noopener');
  }
}
