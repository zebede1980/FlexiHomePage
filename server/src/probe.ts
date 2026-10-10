// The probe: a small sidecar that can see the machine (host /proc, /sys, the
// Docker socket, the reverse proxy's host list) and hands the web server a
// read-only summary. It is the only thing holding the Docker socket, has no
// published port and offers nothing but GET /snapshot, so the internet-facing
// process never has that access itself.

import { readFile, readdir, statfs } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  /** Compose project and service, when it was started by Compose. */
  project: string;
  service: string;
  /** Docker's state word: running, exited, restarting, paused, created, dead. */
  state: string;
  /** Docker's own sentence, e.g. "Up 3 days (healthy)". */
  status: string;
  /** healthy, unhealthy, starting, or '' when the container defines no health check. */
  health: string;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  restarts: number;
  /** 0–1 of all the machine's cores. */
  cpu: number;
  mem: number;
  ports: number[];
  networks: string[];
}

export interface ProxyHost {
  id: number;
  domains: string[];
  host: string;
  port: number;
  scheme: string;
  enabled: boolean;
  ssl: boolean;
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

// ---- docker -----------------------------------------------------------------

function docker<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: DOCKER_SOCK, path, method: 'GET', timeout: 8000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode ?? 500) >= 400) return reject(new Error(`Docker said ${res.statusCode} for ${path}`));
        try {
          resolve(JSON.parse(body) as T);
        } catch (e) {
          reject(e as Error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Docker didn't answer ${path} in time`)));
    req.on('error', reject);
    req.end();
  });
}

interface DockerListItem {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Labels: Record<string, string>;
  Ports: { PrivatePort: number; PublicPort?: number }[];
  NetworkSettings?: { Networks?: Record<string, unknown> };
}

interface DockerInspect {
  RestartCount: number;
  State: { StartedAt: string; FinishedAt: string; ExitCode: number; Health?: { Status: string } };
}

interface DockerStats {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number };
  memory_stats: { usage?: number; stats?: Record<string, number> };
}

const lastUsage = new Map<string, { usage: number; system: number }>();

const when = (iso: string): number | null => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > 0 ? t : null;
};

async function readContainers(): Promise<ContainerInfo[]> {
  const list = await docker<DockerListItem[]>('/containers/json?all=1');
  const seen = new Set<string>();
  const out = await Promise.all(
    list.map(async (c): Promise<ContainerInfo> => {
      seen.add(c.Id);
      const running = c.State === 'running';
      const [inspect, stats] = await Promise.all([
        docker<DockerInspect>(`/containers/${c.Id}/json`).catch(() => null),
        running ? docker<DockerStats>(`/containers/${c.Id}/stats?stream=false&one-shot=true`).catch(() => null) : null,
      ]);

      let cpu = 0;
      let mem = 0;
      if (stats) {
        const usage = stats.cpu_stats.cpu_usage.total_usage;
        const system = stats.cpu_stats.system_cpu_usage ?? 0;
        const prev = lastUsage.get(c.Id);
        // Both counters are nanoseconds; the system one covers every core, so the ratio is already a share of the machine.
        if (prev && system > prev.system) cpu = (usage - prev.usage) / (system - prev.system);
        lastUsage.set(c.Id, { usage, system });
        // Same sum as `docker stats`: page cache that could be dropped isn't counted.
        const ms = stats.memory_stats;
        mem = Math.max(0, (ms.usage ?? 0) - (ms.stats?.inactive_file ?? ms.stats?.total_inactive_file ?? 0));
      }

      return {
        id: c.Id.slice(0, 12),
        name: (c.Names[0] ?? c.Id.slice(0, 12)).replace(/^\//, ''),
        image: c.Image,
        project: c.Labels['com.docker.compose.project'] ?? '',
        service: c.Labels['com.docker.compose.service'] ?? '',
        state: c.State,
        status: c.Status,
        health: inspect?.State.Health?.Status ?? '',
        startedAt: inspect ? when(inspect.State.StartedAt) : null,
        finishedAt: inspect && !running ? when(inspect.State.FinishedAt) : null,
        exitCode: inspect && !running ? inspect.State.ExitCode : null,
        restarts: inspect?.RestartCount ?? 0,
        cpu: Math.min(1, Math.max(0, cpu)),
        mem,
        ports: [...new Set(c.Ports.map((p) => p.PrivatePort))].sort((a, b) => a - b),
        networks: Object.keys(c.NetworkSettings?.Networks ?? {}),
      };
    }),
  );
  for (const id of lastUsage.keys()) if (!seen.has(id)) lastUsage.delete(id);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---- reverse proxy ----------------------------------------------------------

/** Nginx Proxy Manager keeps its hosts in SQLite; reading it tells us which address reaches which container. */
function readProxyHosts(): ProxyHost[] {
  // Compose mounts /dev/null here when no database was configured.
  if (!NPM_DB || !statSync(NPM_DB, { throwIfNoEntry: false })?.isFile()) return [];
  const db = new DatabaseSync(NPM_DB, { readOnly: true });
  try {
    const rows = db
      .prepare('SELECT id, domain_names, forward_scheme, forward_host, forward_port, enabled, certificate_id FROM proxy_host WHERE is_deleted = 0 ORDER BY id')
      .all() as unknown as {
      id: number;
      domain_names: string;
      forward_scheme: string;
      forward_host: string;
      forward_port: number;
      enabled: number;
      certificate_id: number | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      domains: JSON.parse(r.domain_names) as string[],
      host: r.forward_host,
      port: r.forward_port,
      scheme: r.forward_scheme,
      enabled: r.enabled === 1,
      ssl: (r.certificate_id ?? 0) > 0,
    }));
  } finally {
    db.close();
  }
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
  const containers = await readContainers().catch(note('docker'));
  let proxyHosts: ProxyHost[] = latest.proxyHosts;
  try {
    proxyHosts = readProxyHosts();
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
