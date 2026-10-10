// The probe: a small sidecar that can see the machine (host /proc, /sys, the
// Docker socket, the reverse proxy's host list) and hands the web server a
// read-only summary. It is the only thing holding the Docker socket, has no
// published port and offers nothing but GET /snapshot, so the internet-facing
// process never has that access itself.

import { readFile, readdir, statfs } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readContainers, type ContainerInfo } from './docker.js';
import { readProxyHosts, type ProxyHost } from './npm-db.js';

export type { ContainerInfo } from './docker.js';
export type { ProxyHost } from './npm-db.js';

const env = process.env;
const PORT = Number(env.PORT ?? 9100);
const PROC = env.HOST_PROC ?? '/proc';
const SYS = env.HOST_SYS ?? '/sys';
const ROOT = env.HOST_ROOT ?? '/';
const DOCKER_SOCK = env.DOCKER_SOCK ?? '/var/run/docker.sock';
const NPM_DB = env.NPM_DB ?? '';
const INTERVAL_MS = Number(env.PROBE_INTERVAL_MS ?? 10_000);

export interface HostInfo {
  hostname: string;
  os: string;
  kernel: string;
  cores: number;
  /** Seconds since boot. */
  uptime: number;
  load: [number, number, number];
  /** 0–1 of all cores, averaged since the previous sample. */
  cpu: number;
  mem: { total: number; used: number; available: number };
  swap: { total: number; used: number };
  disk: { total: number; used: number };
  /** Bytes per second on the machine's real network cards. */
  net: { rx: number; tx: number };
  rebootRequired: boolean;
}

export interface Snapshot {
  ts: number;
  host: HostInfo | null;
  containers: ContainerInfo[];
  proxyHosts: ProxyHost[];
  errors: string[];
}

// ---- host -------------------------------------------------------------------

const read = (path: string) => readFile(path, 'utf8');

interface CpuTimes {
  idle: number;
  total: number;
}

async function cpuTimes(): Promise<{ times: CpuTimes; cores: number }> {
  const lines = (await read(join(PROC, 'stat'))).split('\n');
  const f = lines[0].trim().split(/\s+/).slice(1).map(Number);
  // user nice system idle iowait irq softirq steal
  const idle = f[3] + (f[4] ?? 0);
  const total = f.slice(0, 8).reduce((a, b) => a + b, 0);
  return { times: { idle, total }, cores: lines.filter((l) => /^cpu\d+ /.test(l)).length || 1 };
}

async function memInfo() {
  const kv = new Map<string, number>();
  for (const line of (await read(join(PROC, 'meminfo'))).split('\n')) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) kv.set(m[1], Number(m[2]) * 1024);
  }
  const total = kv.get('MemTotal') ?? 0;
  const available = kv.get('MemAvailable') ?? 0;
  const swapTotal = kv.get('SwapTotal') ?? 0;
  return {
    mem: { total, available, used: total - available },
    swap: { total: swapTotal, used: swapTotal - (kv.get('SwapFree') ?? 0) },
  };
}

/** Totals for interfaces backed by real hardware, which leaves out loopback, bridges and container veths. */
async function netBytes(): Promise<{ rx: number; tx: number }> {
  const dir = join(SYS, 'class/net');
  let rx = 0;
  let tx = 0;
  for (const iface of await readdir(dir)) {
    if (!existsSync(join(dir, iface, 'device'))) continue;
    rx += Number(await read(join(dir, iface, 'statistics/rx_bytes')));
    tx += Number(await read(join(dir, iface, 'statistics/tx_bytes')));
  }
  return { rx, tx };
}

async function osName(): Promise<string> {
  try {
    const m = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(await read(join(ROOT, 'etc/os-release')));
    return m?.[1] ?? 'Linux';
  } catch {
    return 'Linux';
  }
}

let lastCpu: CpuTimes | null = null;
let lastNet: { rx: number; tx: number; at: number } | null = null;

async function readHost(now: number): Promise<HostInfo> {
  const [{ times, cores }, { mem, swap }, loadRaw, uptimeRaw, fs, net, os, hostname, kernel] = await Promise.all([
    cpuTimes(),
    memInfo(),
    read(join(PROC, 'loadavg')),
    read(join(PROC, 'uptime')),
    statfs(ROOT),
    netBytes().catch(() => null),
    osName(),
    read(join(ROOT, 'etc/hostname')).then((s) => s.trim()).catch(() => ''),
    read(join(PROC, 'sys/kernel/osrelease')).then((s) => s.trim()).catch(() => ''),
  ]);

  let cpu = 0;
  if (lastCpu && times.total > lastCpu.total) cpu = 1 - (times.idle - lastCpu.idle) / (times.total - lastCpu.total);
  lastCpu = times;

  let rate = { rx: 0, tx: 0 };
  if (net) {
    if (lastNet && now > lastNet.at) {
      const secs = (now - lastNet.at) / 1000;
      rate = { rx: Math.max(0, net.rx - lastNet.rx) / secs, tx: Math.max(0, net.tx - lastNet.tx) / secs };
    }
    lastNet = { ...net, at: now };
  }

  const load = loadRaw.split(' ').slice(0, 3).map(Number) as [number, number, number];
  const diskTotal = fs.blocks * fs.bsize;
  return {
    hostname,
    os,
    kernel,
    cores,
    uptime: Number(uptimeRaw.split(' ')[0]),
    load,
    cpu: Math.min(1, Math.max(0, cpu)),
    mem,
    swap,
    // "Used" the way df reports it: space that isn't free, out of what ordinary users can fill.
    disk: { total: diskTotal - (fs.bfree - fs.bavail) * fs.bsize, used: diskTotal - fs.bfree * fs.bsize },
    net: rate,
    rebootRequired: existsSync(join(ROOT, 'var/run/reboot-required')) || existsSync(join(ROOT, 'run/reboot-required')),
  };
}

// ---- loop -------------------------------------------------------------------

let latest: Snapshot = { ts: 0, host: null, containers: [], proxyHosts: [], errors: ['Starting…'] };

async function sample() {
  const now = Date.now();
  const errors: string[] = [];
  const note = (what: string) => (e: unknown) => {
    errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  };
  const host = await readHost(now).catch(note('host'));
  const containers = await readContainers(DOCKER_SOCK).catch(note('docker'));
  let proxyHosts: ProxyHost[] = latest.proxyHosts;
  try {
    proxyHosts = readProxyHosts(NPM_DB);
  } catch (e) {
    note('proxy hosts')(e);
  }
  latest = { ts: now, host, containers: containers ?? [], proxyHosts, errors };
}

async function loop() {
  for (;;) {
    const started = Date.now();
    await sample().catch(() => {});
    await new Promise((r) => setTimeout(r, Math.max(1000, INTERVAL_MS - (Date.now() - started))));
  }
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/snapshot') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(latest));
  } else if (req.method === 'GET' && req.url === '/health') {
    // Stale means the sampling loop has stopped, which a restart fixes.
    const fresh = Date.now() - latest.ts < INTERVAL_MS * 6;
    res.writeHead(fresh ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: fresh }));
  } else {
    res.writeHead(404).end();
  }
}).listen(PORT, env.HOST ?? '0.0.0.0', () => {
  console.log(`[probe] listening on ${PORT}, sampling every ${INTERVAL_MS / 1000}s`);
  void loop();
});
