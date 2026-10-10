// What the agent can find out about the machine it runs on. Written for a
// Windows PC run natively (so the figures are the real machine's, not those of
// the virtual machine Docker Desktop lives in) and also works on Linux. Only
// Node's own modules, so the built files run with nothing installed.

import { execFile } from 'node:child_process';
import { readFile, rm, statfs, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { dockerRaw, readContainers, type ContainerInfo } from './docker.js';
import type { DiskInfo, GpuInfo, LocalCheck, MachineHost } from './machines.js';
import { readProxyHosts, type ProxyHost } from './npm-db.js';

const WINDOWS = process.platform === 'win32';
const MIB = 1024 * 1024;

const run = (cmd: string, args: string[], timeout = 5000): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * MIB }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

/** Runs `fn` at most every `ms`, handing back the last answer in between (including a failure's fallback). */
function cached<T>(ms: number, fallback: T, fn: () => Promise<T>): () => Promise<T> {
  let at = 0;
  let value = fallback;
  return async () => {
    if (Date.now() - at >= ms) {
      at = Date.now();
      value = await fn().catch(() => fallback);
    }
    return value;
  };
}

// ---- pure helpers (unit-tested) ----------------------------------------------

export interface CoreTimes {
  idle: number;
  total: number;
}

export const coreTimes = (cpus: os.CpuInfo[] = os.cpus()): CoreTimes[] =>
  cpus.map((c) => ({ idle: c.times.idle, total: c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }));

/** How busy each core, and the machine as a whole, was between two readings (0–1). */
export function cpuShares(prev: CoreTimes[] | null, cur: CoreTimes[]): { cpu: number; perCore: number[] } {
  if (!prev || prev.length !== cur.length) return { cpu: 0, perCore: cur.map(() => 0) };
  let idle = 0;
  let total = 0;
  const perCore = cur.map((c, i) => {
    const di = c.idle - prev[i].idle;
    const dt = c.total - prev[i].total;
    idle += di;
    total += dt;
    return dt > 0 ? Math.min(1, Math.max(0, 1 - di / dt)) : 0;
  });
  return { cpu: total > 0 ? Math.min(1, Math.max(0, 1 - idle / total)) : 0, perCore };
}

const field = (s: string | undefined): number | null => {
  const n = Number(s);
  return s !== undefined && s.trim() !== '' && Number.isFinite(n) ? n : null; // "[N/A]" on cards that don't report it
};

/** Lines of `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(csv: string): GpuInfo[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.split(',').map((f) => f.trim()))
    .filter((f) => f.length >= 7 && f[0])
    .map((f) => {
      const fan = field(f[6]);
      return {
        name: f[0],
        util: (field(f[1]) ?? 0) / 100,
        memUsed: (field(f[2]) ?? 0) * MIB,
        memTotal: (field(f[3]) ?? 0) * MIB,
        temp: field(f[4]),
        power: field(f[5]),
        fan: fan === null ? null : fan / 100,
      };
    });
}

/** Total bytes in and out from Windows' `netstat -e`: the first row of figures, whatever language its label is in. */
export function parseNetstat(out: string): { rx: number; tx: number } | null {
  const m = /^\S[^\r\n]*?\s(\d+)\s+(\d+)\s*$/m.exec(out);
  return m ? { rx: Number(m[1]), tx: Number(m[2]) } : null;
}

/** Total bytes in and out from Linux's /proc/net/dev, leaving out loopback and the interfaces Docker makes. */
export function parseProcNetDev(text: string): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n')) {
    const m = /^\s*([^:\s]+):\s*(.+)$/.exec(line);
    if (!m || /^(lo|docker\d*|veth.*|br-.*|virbr.*)$/.test(m[1])) continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    rx += f[0] ?? 0;
    tx += f[8] ?? 0;
  }
  return { rx, tx };
}

/** How far a counter moved, allowing for one that starts again from zero at `wrap` (netstat's are 32-bit). */
export const counterDelta = (prev: number, cur: number, wrap: number): number => (cur >= prev ? cur - prev : prev <= wrap ? cur + wrap - prev : 0);

/** The first file in a tar archive, which is how Docker hands over a file copied out of a container. */
export function firstFileInTar(tar: Buffer): Buffer | null {
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) return null;
    const size = parseInt(header.subarray(124, 136).toString('latin1').replace(/\0.*$/, '').trim(), 8) || 0;
    const type = String.fromCharCode(header[156]);
    if (type === '0' || type === '\0') return tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

// ---- the machine -------------------------------------------------------------

const readGpus = (() => {
  const query = () =>
    run('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed', '--format=csv,noheader,nounits'], 4000).then(parseNvidiaSmi);
  let missingUntil = 0;
  return async (): Promise<GpuInfo[]> => {
    if (Date.now() < missingUntil) return [];
    try {
      return await query();
    } catch {
      // No NVIDIA card, or no driver: not worth asking again for a while.
      missingUntil = Date.now() + 10 * 60_000;
      return [];
    }
  };
})();

async function readDisks(): Promise<DiskInfo[]> {
  const mounts = WINDOWS ? [...'CDEFGHIJKLMNOPQRSTUVWXYZAB'].map((l) => `${l}:`) : ['/'];
  const out = await Promise.all(
    mounts.map(async (name): Promise<DiskInfo | null> => {
      try {
        // A drive that takes this long is a network share that has gone away, or an empty card reader.
        const fs = await Promise.race([statfs(WINDOWS ? `${name}\\` : name), new Promise<never>((_, no) => setTimeout(() => no(new Error('slow')), 1500))]);
        const total = fs.blocks * fs.bsize;
        return total > 0 ? { name, total, used: total - fs.bavail * fs.bsize } : null;
      } catch {
        return null;
      }
    }),
  );
  return out.filter((d): d is DiskInfo => d !== null);
}

/** Running totals of bytes in and out. On Windows these cover every adapter, so traffic through a VPN is counted on both its adapters. */
async function netTotals(): Promise<{ rx: number; tx: number; wrap: number } | null> {
  if (WINDOWS) {
    const t = parseNetstat(await run('netstat', ['-e'], 3000));
    return t && { ...t, wrap: 2 ** 32 };
  }
  if (process.platform === 'linux') return { ...parseProcNetDev(await readFile('/proc/net/dev', 'utf8')), wrap: 2 ** 64 };
  return null;
}

const osName = cached(3600_000, os.type(), async () => {
  if (WINDOWS) return os.version(); // "Windows 11 Pro"
  if (process.platform === 'linux') return /^PRETTY_NAME="?([^"\n]+)"?/m.exec(await readFile('/etc/os-release', 'utf8'))?.[1] ?? 'Linux';
  return process.platform === 'darwin' ? 'macOS' : os.type();
});

const rebootRequired = cached(10 * 60_000, false, async () => {
  if (WINDOWS) {
    // The key exists only while an installed update is waiting for a restart; `reg` fails when it doesn't.
    await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired'], 3000);
    return true;
  }
  await readFile('/var/run/reboot-required');
  return true;
});

let lastCores: CoreTimes[] | null = null;
let lastNet: { rx: number; tx: number; at: number } | null = null;

export async function readHost(now = Date.now()): Promise<MachineHost> {
  const cores = coreTimes();
  const { cpu, perCore } = cpuShares(lastCores, cores);
  lastCores = cores;

  const [gpus, disks, totals, name, reboot] = await Promise.all([readGpus(), readDisks(), netTotals().catch(() => null), osName(), rebootRequired()]);

  let net = { rx: 0, tx: 0 };
  if (totals) {
    if (lastNet && now > lastNet.at) {
      const secs = (now - lastNet.at) / 1000;
      net = { rx: counterDelta(lastNet.rx, totals.rx, totals.wrap) / secs, tx: counterDelta(lastNet.tx, totals.tx, totals.wrap) / secs };
    }
    lastNet = { rx: totals.rx, tx: totals.tx, at: now };
  }

  const total = os.totalmem();
  const available = os.freemem();
  // The drive the system is on stands for "the disk" where only one figure is shown.
  const system = disks.find((d) => d.name === (WINDOWS ? (process.env.SystemDrive ?? 'C:').toUpperCase() : '/')) ?? disks[0];
  return {
    hostname: os.hostname(),
    os: name,
    kernel: os.release(),
    cores: cores.length,
    uptime: os.uptime(),
    load: os.loadavg() as [number, number, number], // all zero on Windows, which has no such figure
    cpu,
    mem: { total, used: total - available, available },
    swap: { total: 0, used: 0 },
    disk: system ? { total: system.total, used: system.used } : { total: 0, used: 0 },
    net,
    rebootRequired: reboot,
    platform: process.platform,
    cpuModel: os.cpus()[0]?.model.trim() ?? '',
    perCore,
    disks,
    gpus,
  };
}

// ---- docker ------------------------------------------------------------------

const SOCKETS = WINDOWS ? ['//./pipe/docker_engine', '//./pipe/dockerDesktopLinuxEngine'] : ['/var/run/docker.sock'];

export interface DockerReading {
  available: boolean;
  error: string;
  containers: ContainerInfo[];
  proxyHosts: ProxyHost[];
}

let socket = '';
let proxyHosts: ProxyHost[] = [];
let proxyHostsAt = 0;

/**
 * Nginx Proxy Manager's host list, copied out of its container through Docker
 * (so it doesn't matter where the container keeps its data). A file read, not
 * a command run in the container.
 */
async function readProxyHostsFrom(sock: string, containers: ContainerInfo[], tmpDir: string): Promise<ProxyHost[]> {
  const npm = containers.find((c) => c.state === 'running' && /nginx-proxy-manager/i.test(c.image));
  if (!npm) return [];
  const file = firstFileInTar(await dockerRaw(sock, `/containers/${npm.id}/archive?path=/data/database.sqlite`, 20_000));
  if (!file) return [];
  const copy = join(tmpDir, `flexihome-agent-npm-${process.pid}.sqlite`);
  await writeFile(copy, file);
  try {
    return readProxyHosts(copy);
  } finally {
    await rm(copy, { force: true });
  }
}

/** `configured` is a socket path to use, '' to look in the usual places, or false to leave Docker alone. */
export async function readDocker(configured: string | false, wantProxyHosts: boolean): Promise<DockerReading> {
  if (configured === false) return { available: false, error: '', containers: [], proxyHosts: [] };
  let error = '';
  for (const candidate of socket ? [socket] : configured ? [configured] : SOCKETS) {
    try {
      const containers = await readContainers(candidate);
      socket = candidate;
      if (wantProxyHosts && Date.now() - proxyHostsAt > 5 * 60_000) {
        proxyHostsAt = Date.now();
        // A failed read keeps the last list: the hosts haven't changed just because one copy went wrong.
        proxyHosts = await readProxyHostsFrom(candidate, containers, os.tmpdir()).catch(() => proxyHosts);
      }
      return { available: true, error: '', containers, proxyHosts };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  socket = ''; // look again next time: Docker Desktop may come back on a different pipe
  const off = /ENOENT|ECONNREFUSED/.test(error);
  return { available: false, error: off ? '' : error, containers: [], proxyHosts };
}

// ---- addresses to try from here ---------------------------------------------

const fails = new Map<string, number>();

export async function runCheck(check: { name: string; url: string }, timeout = 8000): Promise<LocalCheck> {
  const started = Date.now();
  let status: number | null = null;
  let error = '';
  try {
    const res = await fetch(check.url, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'FlexiHome-agent/1 (uptime check)' } });
    status = res.status;
    await res.body?.cancel();
    // As on the site: a login prompt or a redirect is the app working; only a 5xx or silence is not.
    if (status >= 500) error = `error ${status}`;
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    error = (e as Error).name === 'TimeoutError' ? `no answer within ${timeout / 1000} seconds` : cause === 'ECONNREFUSED' ? 'nothing is listening there' : cause || (e as Error).message || 'the connection failed';
  }
  const ok = error === '';
  const count = ok ? 0 : (fails.get(check.name) ?? 0) + 1;
  fails.set(check.name, count);
  return { name: check.name, url: check.url, ok, status, ms: Date.now() - started, error, checkedAt: Date.now(), fails: count };
}
