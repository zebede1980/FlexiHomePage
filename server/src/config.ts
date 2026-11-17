// Everything the server reads from the environment, in one place.

import { resolve } from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '127.0.0.1',
  /** SQLite database, favicon cache. Bind-mounted in Docker. */
  dataDir: resolve(env.DATA_DIR ?? './data'),
  /** The built page (`npm run build:web`). */
  webDir: resolve(env.WEB_DIR ?? './dist-web'),
  /** Base URL of the probe sidecar that reads host and Docker stats. Empty = no Server tab. */
  probeUrl: (env.PROBE_URL ?? '').replace(/\/+$/, ''),
  /** Container the reverse proxy runs in, for checking apps through their public address. */
  proxyHost: env.PROXY_HOST ?? 'nginx-proxy-manager',
  /** Other origins the page may call (Life Tracker for the to-do card), space- or comma-separated. */
  connectSrc: connectOrigins(env.CONNECT_SRC ?? ''),
};

/** Only plain origins get into the page's security policy, so a stray value can't widen or break it. */
export function connectOrigins(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/).filter(Boolean)) {
    try {
      const u = new URL(part);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.origin + '/' === u.href.replace(/\/?$/, '/')) out.push(u.origin);
    } catch {
      // Not an address: left out.
    }
  }
  return [...new Set(out)];
}

export type Config = typeof config;
