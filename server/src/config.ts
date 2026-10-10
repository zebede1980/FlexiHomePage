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
};

export type Config = typeof config;
