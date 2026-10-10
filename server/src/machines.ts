// Other machines that report in. Each runs the agent (agent.ts), which sends a
// summary of itself here every few seconds using a key of its own. The agent
// only ever calls out, so a PC behind a home router needs nothing opened up,
// and a machine that is switched off simply stops being heard from.
//
// A machine's key can do one thing: post that machine's report. It is not a
// sign-in and opens nothing else.

import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db.js';
import type { ContainerInfo } from './docker.js';
import type { ProxyHost } from './npm-db.js';
import type { HostInfo } from './probe.js';

export interface GpuInfo {
  name: string;
  /** 0–1. */
  util: number;
  memUsed: number;
  memTotal: number;
  /** °C */
  temp: number | null;
  /** Watts */
  power: number | null;
  /** 0–1 */
  fan: number | null;
}

export interface DiskInfo {
  /** "C:" on Windows, the mount point elsewhere. */
  name: string;
  total: number;
  used: number;
}

/** What a machine other than the site's own can add to the usual readings. */
export interface MachineHost extends HostInfo {
  /** Node's name for the system: win32, linux, darwin. */
  platform: string;
  cpuModel: string;
  /** 0–1 for each logical core. */
  perCore: number[];
  disks: DiskInfo[];
  gpus: GpuInfo[];
}

/** Something the agent was asked to try from where it is, e.g. an app on that machine that isn't a container. */
export interface LocalCheck {
  name: string;
  url: string;
  ok: boolean;
  status: number | null;
  ms: number;
  error: string;
  checkedAt: number;
  /** How many tries in a row have failed. */
  fails: number;
}

export interface MachineReport {
  /** When the site received it (the machine's own clock isn't trusted). */
  ts: number;
  agent: { version: string; interval: number };
  host: MachineHost | null;
  docker: { available: boolean; error: string };
  containers: ContainerInfo[];
  proxyHosts: ProxyHost[];
  checks: LocalCheck[];
  errors: string[];
}

// ---- reading a report that arrived over the internet ----
// The key proves which machine sent it, but what it says is still shown on the
// page and stored, so every field is checked, clipped and given a default.

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const share = (v: unknown) => num(v, 0, 1);
const maybe = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
const bool = (v: unknown) => v === true;

function cleanHost(v: unknown): MachineHost | null {
  if (!v || typeof v !== 'object') return null;
  const h = obj(v);
  const mem = obj(h.mem);
  const swap = obj(h.swap);
  const disk = obj(h.disk);
  const net = obj(h.net);
  const load = list(h.load, 3);
  return {
    hostname: text(h.hostname, 80),
    os: text(h.os, 80),
    kernel: text(h.kernel, 80),
    cores: num(h.cores, 0, 4096),
    uptime: num(h.uptime),
    load: [num(load[0], 0, 1e6), num(load[1], 0, 1e6), num(load[2], 0, 1e6)],
    cpu: share(h.cpu),
    mem: { total: num(mem.total), used: num(mem.used), available: num(mem.available) },
    swap: { total: num(swap.total), used: num(swap.used) },
    disk: { total: num(disk.total), used: num(disk.used) },
    net: { rx: num(net.rx), tx: num(net.tx) },
    rebootRequired: bool(h.rebootRequired),
    platform: text(h.platform, 20),
    cpuModel: text(h.cpuModel, 120),
    perCore: list(h.perCore, 512).map(share),
    disks: list(h.disks, 40).map((d) => {
      const o = obj(d);
      return { name: text(o.name, 60), total: num(o.total), used: num(o.used) };
    }),
    gpus: list(h.gpus, 8).map((g) => {
      const o = obj(g);
      return {
        name: text(o.name, 120),
        util: share(o.util),
        memUsed: num(o.memUsed),
        memTotal: num(o.memTotal),
        temp: maybe(o.temp, -50, 200),
        power: maybe(o.power, 0, 5000),
        fan: maybe(o.fan, 0, 1),
      };
    }),
  };
}

function cleanContainer(v: unknown): ContainerInfo {
  const c = obj(v);
  return {
    id: text(c.id, 64),
    name: text(c.name, 120),
    image: text(c.image, 200),
    project: text(c.project, 120),
    service: text(c.service, 120),
    state: text(c.state, 30),
    status: text(c.status, 120),
    health: text(c.health, 30),
    startedAt: maybe(c.startedAt, 0, Number.MAX_SAFE_INTEGER),
    finishedAt: maybe(c.finishedAt, 0, Number.MAX_SAFE_INTEGER),
    exitCode: maybe(c.exitCode, -1e6, 1e6),
    restarts: num(c.restarts, 0, 1e9),
    cpu: share(c.cpu),
    mem: num(c.mem),
    ports: list(c.ports, 100).map((p) => num(p, 0, 65535)),
    networks: list(c.networks, 30).map((n) => text(n, 120)),
  };
}

function cleanProxyHost(v: unknown): ProxyHost {
  const h = obj(v);
  return {
    id: num(h.id, 0, 1e9),
    domains: list(h.domains, 20)
      .map((d) => text(d, 253).toLowerCase())
      .filter(Boolean),
    host: text(h.host, 253),
    port: num(h.port, 0, 65535),
    scheme: h.scheme === 'https' ? 'https' : 'http',
    enabled: bool(h.enabled),
    ssl: bool(h.ssl),
  };
}

function cleanCheck(v: unknown, now: number): LocalCheck {
  const c = obj(v);
  return {
    name: text(c.name, 80),
    url: text(c.url, 300),
    ok: bool(c.ok),
    status: maybe(c.status, 0, 999),
    ms: num(c.ms, 0, 600_000),
    error: text(c.error, 200),
    checkedAt: num(c.checkedAt, 0, now, now),
    fails: num(c.fails, 0, 1e6),
  };
}

export function cleanReport(raw: unknown, now = Date.now()): MachineReport {
  const r = obj(raw);
  const agent = obj(r.agent);
  const docker = obj(r.docker);
  return {
    ts: now,
    agent: { version: text(agent.version, 20), interval: num(agent.interval, 1, 3600, 10) },
    host: cleanHost(r.host),
    docker: { available: bool(docker.available), error: text(docker.error, 200) },
    containers: list(r.containers, 300)
      .map(cleanContainer)
      .filter((c) => c.name),
    proxyHosts: list(r.proxyHosts, 300).map(cleanProxyHost),
    checks: list(r.checks, 50)
      .map((c) => cleanCheck(c, now))
      .filter((c) => c.name),
    errors: list(r.errors, 10).map((e) => text(e, 200)),
  };
}

// ---- the machines themselves ----

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface MachineRow {
  id: number;
  name: string;
  createdAt: number;
  seenAt: number | null;
}

export class Machines {
  constructor(private db: Db) {}

  /** The key is shown once, here; only its hash is kept. */
  create(name: string): { id: number; name: string; key: string } {
    const key = `fhm_${randomBytes(32).toString('base64url')}`;
    const clean = name.trim().slice(0, 60) || 'Another machine';
    const { lastInsertRowid } = this.db.prepare('INSERT INTO machines (hash, name, created_at) VALUES (?, ?, ?)').run(sha(key), clean, Date.now());
    return { id: Number(lastInsertRowid), name: clean, key };
  }

  /** Which machine a key belongs to, or null if it isn't one of ours. */
  check(key: string | undefined): number | null {
    if (!key?.startsWith('fhm_')) return null;
    const row = this.db.prepare('SELECT id FROM machines WHERE hash = ?').get(sha(key)) as { id: number } | undefined;
    return row?.id ?? null;
  }

  list(): MachineRow[] {
    return (
      this.db.prepare('SELECT id, name, created_at, seen_at FROM machines ORDER BY id').all() as unknown as {
        id: number;
        name: string;
        created_at: number;
        seen_at: number | null;
      }[]
    ).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, seenAt: r.seen_at }));
  }

  rename(id: number, name: string) {
    const clean = name.trim().slice(0, 60);
    if (clean) this.db.prepare('UPDATE machines SET name = ? WHERE id = ?').run(clean, id);
  }

  /** Forgets the machine and everything recorded about it. */
  remove(id: number) {
    const like = `m${id}/%`;
    this.db.prepare('DELETE FROM machines WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM machine_samples WHERE machine = ?').run(id);
    this.db.prepare('DELETE FROM uptime WHERE app LIKE ? OR app = ?').run(like, `machine:${id}`);
    this.db.prepare('DELETE FROM incidents WHERE app LIKE ?').run(like);
    this.db.prepare('DELETE FROM app_prefs WHERE app LIKE ?').run(like);
  }

  /** Kept so the last readings are still there after the site restarts, or while the machine is off. */
  saveReport(id: number, report: MachineReport) {
    this.db.prepare('UPDATE machines SET seen_at = ?, report = ? WHERE id = ?').run(report.ts, JSON.stringify(report), id);
  }

  lastReports(): Map<number, MachineReport> {
    const out = new Map<number, MachineReport>();
    for (const r of this.db.prepare('SELECT id, report FROM machines WHERE report IS NOT NULL').all() as unknown as { id: number; report: string }[]) {
      try {
        out.set(r.id, JSON.parse(r.report) as MachineReport);
      } catch {
        // A report that can't be read back is as good as none; the next one replaces it.
      }
    }
    return out;
  }
}
