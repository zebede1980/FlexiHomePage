// Turns the probe's raw view of the machine into what the Server tab shows:
// the host's vital signs with some history, and one row per app saying whether
// it is live and, if not, why.

import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { TLSSocket } from 'node:tls';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { Machines, cleanReport, type LocalCheck, type MachineHost, type MachineReport } from './machines.js';
import type { ContainerInfo, HostInfo, ProxyHost, Snapshot } from './probe.js';

const POLL_MS = 10_000;
/** How often each app's public address is tried. Each try is a line in the proxy's access log, so not too often. */
const CHECK_MS = 120_000;
/** A failing address is retried sooner, so one dropped request doesn't count as an outage but a real one shows quickly. */
const RECHECK_MS = 20_000;
const CHECK_TIMEOUT_MS = 8_000;
const FAILS_BEFORE_DOWN = 2;
const RECENT_KEPT = 360; // an hour at one sample per 10 s
const SAMPLE_DAYS = 8;
const UPTIME_DAYS = 31;
/** A machine that reports in counts as off once this many of its reports in a row have gone missing. */
const MISSED_REPORTS = 4.5;
const OFFLINE_MIN_MS = 45_000;

/** 'off' is an app on a machine that has stopped reporting: nobody can say how it is. */
export type AppState = 'up' | 'degraded' | 'down' | 'off';

export interface HttpCheck {
  ok: boolean;
  /** HTTP status, or null when no answer came back at all. */
  status: number | null;
  ms: number;
  error: string;
  checkedAt: number;
  /** Days until the address's certificate expires, when it has one. */
  certDays: number | null;
}

export interface AppView {
  key: string;
  name: string;
  state: AppState;
  /** Plain sentences saying what is wrong; empty when all is well. */
  issues: string[];
  hidden: boolean;
  url: string;
  domains: string[];
  container: ContainerInfo | null;
  http: HttpCheck | null;
  /** Share of checks passed, 0–1, or null before there is any history. */
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  /** Share of checks passed in each of the last 24 hours, oldest first; null where nothing was recorded. */
  hours: (number | null)[];
  /** The same for each of the last 30 days. */
  days: (number | null)[];
  /** When the current problem started. */
  downSince: number | null;
}

export interface MonitorView {
  available: boolean;
  /** The site's own machine is being read (its probe is set up); false when only other machines report in. */
  probe: boolean;
  ts: number;
  /** The probe hasn't answered recently, so the numbers are old. */
  stale: boolean;
  errors: string[];
  host: HostInfo | null;
  apps: AppView[];
  /** Other machines that report in through the agent. */
  machines: MachineView[];
}

export interface MachineView {
  id: number;
  name: string;
  /** When its last report arrived; 0 before the first. */
  ts: number;
  /** Heard from recently. When false, everything below is the last it said. */
  online: boolean;
  agent: { version: string; interval: number } | null;
  host: MachineHost | null;
  docker: { available: boolean; error: string };
  errors: string[];
  apps: AppView[];
  /** Share of the time the machine itself was on and reporting, in the same shape as an app's uptime. */
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  hours: (number | null)[];
  days: (number | null)[];
}

export type Sample = [ts: number, cpu: number, mem: number, rx: number, tx: number, load: number];
/** The same, plus the first graphics card: how busy it is, how full its memory is (both 0–1), and its temperature. */
export type MachineSample = [...Sample, gpu: number | null, vram: number | null, gpuTemp: number | null];

interface Prefs {
  label: string | null;
  url: string | null;
  hidden: boolean;
}

interface AppDef {
  key: string;
  name: string;
  container: ContainerInfo | null;
  hosts: ProxyHost[];
  /** A proxy host that names a container which doesn't exist. */
  missing: string;
  /** An address the machine's own agent tries, instead of one tried from here. */
  check?: LocalCheck;
}

const isAddress = (host: string) => /^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost';

/** Pairs each container with the proxy hosts that point at it, and lists proxy hosts that point at nothing. */
export function deriveApps(snap: Pick<Snapshot, 'containers' | 'proxyHosts'>): AppDef[] {
  const apps: AppDef[] = snap.containers.map((c) => ({ key: c.name, name: c.name, container: c, hosts: [], missing: '' }));
  const byName = new Map<string, AppDef>();
  for (const a of apps) {
    byName.set(a.container!.name.toLowerCase(), a);
    // Compose also answers to the bare service name on its own network.
    if (a.container!.service && !byName.has(a.container!.service.toLowerCase())) byName.set(a.container!.service.toLowerCase(), a);
  }
  for (const h of snap.proxyHosts) {
    if (!h.enabled || h.domains.length === 0) continue;
    const target = byName.get(h.host.toLowerCase());
    if (target) {
      target.hosts.push(h);
    } else {
      // Either something running outside Docker (an address), or a container that has gone.
      apps.push({ key: `proxy:${h.domains[0]}`, name: h.domains[0], container: null, hosts: [h], missing: isAddress(h.host) ? '' : h.host });
    }
  }
  return apps;
}

const STATE_WORDS: Record<string, string> = {
  exited: 'Stopped',
  restarting: 'Keeps restarting',
  paused: 'Paused',
  created: 'Created but never started',
  dead: 'Dead (Docker could not remove it)',
  removing: 'Being removed',
  // Not one of Docker's: what a machine's containers are marked with while its Docker isn't answering.
  'docker-off': "Docker isn't running on this machine",
};

/**
 * The apps on a machine that reports in: its containers and proxy hosts, as
 * for the site's own machine, plus the addresses its agent tries locally.
 * Every key starts `m<id>/` so two machines can each have a container called
 * the same thing.
 */
export function deriveMachineApps(id: number, report: Pick<MachineReport, 'containers' | 'proxyHosts' | 'checks'>): AppDef[] {
  const prefix = `m${id}/`;
  const apps = deriveApps(report).map((a) => ({ ...a, key: prefix + a.key }));
  for (const check of report.checks) apps.push({ key: `${prefix}check:${check.name}`, name: check.name, container: null, hosts: [], missing: '', check });
  return apps;
}

const PRIVATE = new BlockList();
for (const [net, bits] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16], ['100.64.0.0', 10], ['0.0.0.0', 8]] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv4');
}
// (An IPv4 address written as IPv6 is matched against the IPv4 rules above, so it needs none of its own.)
for (const [net, bits] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) PRIVATE.addSubnet(net, bits, 'ipv6');

/** A name that could be a site on the internet: dotted, ending in letters. Not an address, not a bare container name. */
export const isPublicName = (name: string) => name.length <= 253 && /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(name);

/**
 * Name lookup for addresses another machine asked us to check. Those names
 * come from outside, so one that turns out to point back inside (this
 * machine, its containers, a private network) is refused rather than visited.
 */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  // Node asks for every address at once when it is going to try them in turn, and for one otherwise; answer in kind.
  const wantsAll = (options as { all?: boolean }).all === true;
  dnsLookup(hostname, { ...(options as object), all: true }, (err, found) => {
    if (err) return callback(err, wantsAll ? [] : '', 4);
    const open = found.filter((a) => isIP(a.address) && !PRIVATE.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'));
    if (!open.length) return callback(Object.assign(new Error('that name leads to a private address'), { code: 'EPRIVATE' }), wantsAll ? [] : '', 4);
    if (wantsAll) callback(null, open);
    else callback(null, open[0].address, open[0].family);
  });
};

export function judge(def: AppDef, http: HttpCheck | null, fails: number): { state: AppState; issues: string[] } {
  const issues: string[] = [];
  let state: AppState = 'up';
  const c = def.container;
  if (def.missing) {
    return { state: 'down', issues: [`Its address points at a container called “${def.missing}”, which doesn't exist.`] };
  }
  if (c && c.state !== 'running') {
    const word = STATE_WORDS[c.state] ?? `Not running (${c.state})`;
    const code = c.state === 'exited' && c.exitCode ? ` after an error (exit code ${c.exitCode})` : '';
    return { state: 'down', issues: [`${word}${code}.`] };
  }
  if (c?.health === 'unhealthy') {
    state = 'degraded';
    issues.push('Running, but failing its own health check.');
  }
  if (http && !http.ok && fails >= FAILS_BEFORE_DOWN) {
    state = c ? 'degraded' : 'down';
    issues.push(`Not answering at its address: ${http.error}.`);
  }
  if (http?.ok && http.certDays !== null && http.certDays <= 14) {
    issues.push(http.certDays <= 0 ? 'Its security certificate has expired.' : `Its security certificate expires in ${http.certDays} day${http.certDays === 1 ? '' : 's'}.`);
    if (http.certDays <= 0) state = 'degraded';
  }
  return { state, issues };
}

function explain(status: number | null, err: NodeJS.ErrnoException | null): string {
  if (err) {
    switch (err.code) {
      case 'CERT_HAS_EXPIRED':
        return 'its security certificate has expired';
      case 'ERR_TLS_CERT_ALTNAME_INVALID':
      case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        return "its security certificate isn't valid for this address";
      case 'ECONNREFUSED':
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return "the reverse proxy couldn't be reached";
      case 'ETIMEDOUT':
      case 'ESOCKETTIMEDOUT':
        return `no answer within ${CHECK_TIMEOUT_MS / 1000} seconds`;
      default:
        return err.message || 'the connection failed';
    }
  }
  if (status === 502) return "error 502 (the proxy can't reach the app)";
  if (status === 503) return 'error 503 (the app says it is unavailable)';
  if (status === 504) return 'error 504 (the app took too long to answer)';
  return `error ${status}`;
}

/**
 * Asks the reverse proxy for the app's front page the way a browser would,
 * but from next door, so the request never leaves the machine. Any answer
 * below 500 counts as alive: a login prompt or a redirect is the app working.
 */
export function checkAddress(proxyHost: string, domain: string, ssl: boolean, lookup?: LookupFunction): Promise<HttpCheck> {
  const started = Date.now();
  return new Promise((resolve) => {
    const done = (status: number | null, err: NodeJS.ErrnoException | null, certDays: number | null) =>
      resolve({
        ok: status !== null && status < 500,
        status,
        ms: Date.now() - started,
        error: status !== null && status < 500 ? '' : explain(status, err),
        checkedAt: Date.now(),
        certDays,
      });
    const options = {
      host: proxyHost,
      port: ssl ? 443 : 80,
      servername: domain,
      path: '/',
      method: 'GET',
      agent: false as const,
      timeout: CHECK_TIMEOUT_MS,
      ...(lookup ? { lookup } : {}),
      headers: { host: domain, 'user-agent': 'FlexiHome-monitor/1 (uptime check)', accept: '*/*' },
    };
    const req = (ssl ? httpsRequest : httpRequest)(options, (res) => {
      let certDays: number | null = null;
      if (ssl) {
        const cert = (res.socket as TLSSocket).getPeerCertificate?.();
        const until = cert?.valid_to ? Date.parse(cert.valid_to) : NaN;
        if (Number.isFinite(until)) certDays = Math.floor((until - Date.now()) / 86_400_000);
      }
      done(res.statusCode ?? null, null, certDays);
      res.destroy();
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', (e: NodeJS.ErrnoException) => done(null, e, null));
    req.end();
  });
}

interface Watch {
  http: HttpCheck | null;
  fails: number;
  nextCheck: number;
  checking: boolean;
}

/** What is held about one machine that reports in. */
interface Remote {
  report: MachineReport | null;
  views: AppView[];
  recent: MachineSample[];
  minute: MachineSample[];
  /** How it was judged last time, so the moment it goes quiet is noticed once. */
  wasOnline: boolean;
}

const machineOfKey = (key: string): number | null => {
  const m = /^m(\d+)\//.exec(key);
  return m ? Number(m[1]) : null;
};

const mean = (values: (number | null)[]): number | null => {
  const xs = values.filter((v): v is number => v !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};

export class Monitor {
  #snap: Snapshot | null = null;
  #fetchedAt = 0;
  #fetchError = '';
  #recent: Sample[] = [];
  #minute: Sample[] = [];
  #watch = new Map<string, Watch>();
  #views: AppView[] = [];
  #open = new Map<string, number>();
  #timers: ReturnType<typeof setInterval>[] = [];
  #remote = new Map<number, Remote>();
  readonly machines: Machines;

  constructor(
    private db: Db,
    private config: Config,
    machines?: Machines,
  ) {
    this.machines = machines ?? new Machines(db);
    for (const r of db.prepare('SELECT id, app FROM incidents WHERE ended_at IS NULL').all() as { id: number; app: string }[]) {
      this.#open.set(r.app, r.id);
    }
    // What each machine last said, so its readings are there straight after a restart.
    for (const [id, report] of this.machines.lastReports()) {
      this.#remote.set(id, { report, views: [], recent: [], minute: [], wasOnline: false });
      this.#evaluateMachine(id);
    }
  }

  get #hasProbe(): boolean {
    return this.config.probeUrl !== '';
  }

  /** There is something for the Server tab to show: this machine's probe, or another machine that reports in. */
  get available(): boolean {
    return this.#hasProbe || this.machines.list().length > 0;
  }

  start() {
    if (this.#hasProbe) {
      void this.#poll();
      this.#timers.push(setInterval(() => void this.#poll(), POLL_MS));
    }
    // A machine is judged each time it reports; this is what notices one that has stopped.
    this.#timers.push(
      setInterval(() => {
        const now = Date.now();
        for (const [id, r] of this.#remote) if (r.wasOnline && !this.#online(r, now)) this.#evaluateMachine(id, now);
      }, POLL_MS),
    );
    this.#timers.push(setInterval(() => this.#everyMinute(), 60_000));
  }

  stop() {
    this.#timers.forEach(clearInterval);
    this.#timers = [];
  }

  view(): MonitorView {
    const now = Date.now();
    const machines = this.machines.list();
    return {
      available: this.#hasProbe || machines.length > 0,
      probe: this.#hasProbe,
      ts: this.#snap?.ts ?? 0,
      stale: this.#hasProbe && now - this.#fetchedAt > POLL_MS * 4,
      errors: [...(this.#fetchError ? [this.#fetchError] : []), ...(this.#snap?.errors ?? [])],
      host: this.#snap?.host ?? null,
      apps: this.#views,
      machines: machines.map((m): MachineView => {
        const r = this.#remote.get(m.id);
        const report = r?.report ?? null;
        // Gone quiet since it was last judged: say so now rather than when the timer next comes round.
        if (r?.wasOnline && !this.#online(r, now)) this.#evaluateMachine(m.id, now);
        return {
          id: m.id,
          name: m.name,
          ts: report?.ts ?? 0,
          online: r ? this.#online(r, now) : false,
          agent: report?.agent ?? null,
          host: report?.host ?? null,
          docker: report?.docker ?? { available: false, error: '' },
          errors: report?.errors ?? [],
          apps: r?.views ?? [],
          ...this.#uptime(`machine:${m.id}`, now),
        };
      }),
    };
  }

  /** `machine` picks one that reports in; without it, the site's own. */
  history(range: string, machine?: number): { range: string; step: number; samples: (Sample | MachineSample)[] } {
    const days = range === '7d' ? 7 : 1;
    const bucket = range === '7d' ? 900 : 120; // seconds per point: ~670 points either way
    const since = Math.floor(Date.now() / 1000) - days * 86_400;
    const label = range === '1h' ? '1h' : days === 7 ? '7d' : '24h';

    if (machine !== undefined) {
      const r = this.#remote.get(machine);
      if (range === '1h') return { range: label, step: r?.report?.agent.interval ?? POLL_MS / 1000, samples: r?.recent ?? [] };
      const rows = this.db
        .prepare(
          `SELECT (ts / ?) * ? AS t, AVG(cpu) AS cpu, AVG(mem) AS mem, AVG(rx) AS rx, AVG(tx) AS tx, AVG(load1) AS load1,
                  AVG(gpu) AS gpu, AVG(vram) AS vram, AVG(gpu_temp) AS temp
           FROM machine_samples WHERE machine = ? AND ts >= ? GROUP BY ts / ? ORDER BY t`,
        )
        .all(bucket, bucket, machine, since, bucket) as unknown as {
        t: number;
        cpu: number;
        mem: number;
        rx: number;
        tx: number;
        load1: number;
        gpu: number | null;
        vram: number | null;
        temp: number | null;
      }[];
      return { range: label, step: bucket, samples: rows.map((r): MachineSample => [r.t * 1000, r.cpu, r.mem, r.rx, r.tx, r.load1, r.gpu, r.vram, r.temp]) };
    }

    if (range === '1h') return { range: label, step: POLL_MS / 1000, samples: this.#recent };
    const rows = this.db
      .prepare(
        `SELECT (ts / ?) * ? AS t, AVG(cpu) AS cpu, AVG(mem) AS mem, AVG(rx) AS rx, AVG(tx) AS tx, AVG(load1) AS load1
         FROM host_samples WHERE ts >= ? GROUP BY ts / ? ORDER BY t`,
      )
      .all(bucket, bucket, since, bucket) as unknown as {
      t: number;
      cpu: number;
      mem: number;
      rx: number;
      tx: number;
      load1: number;
    }[];
    return { range: label, step: bucket, samples: rows.map((r): Sample => [r.t * 1000, r.cpu, r.mem, r.rx, r.tx, r.load1]) };
  }

  setPrefs(app: string, patch: { label?: string | null; url?: string | null; hidden?: boolean }) {
    const cur = this.#prefs().get(app) ?? { label: null, url: null, hidden: false };
    const clean = (v: string | null | undefined, old: string | null) => (v === undefined ? old : v === null || v.trim() === '' ? null : v.trim().slice(0, 300));
    const next = { label: clean(patch.label, cur.label), url: clean(patch.url, cur.url), hidden: patch.hidden ?? cur.hidden };
    this.db
      .prepare(
        'INSERT INTO app_prefs (app, label, url, hidden) VALUES (?, ?, ?, ?) ON CONFLICT(app) DO UPDATE SET label = excluded.label, url = excluded.url, hidden = excluded.hidden',
      )
      .run(app, next.label, next.url, next.hidden ? 1 : 0);
    const machine = machineOfKey(app);
    if (machine === null) this.#evaluate();
    else this.#evaluateMachine(machine);
  }

  // ---- machines that report in ---------------------------------------------

  /** Takes in what a machine's agent sent. `raw` is straight off the network. */
  acceptReport(id: number, raw: unknown) {
    const now = Date.now();
    const report = cleanReport(raw, now);
    let r = this.#remote.get(id);
    if (!r) this.#remote.set(id, (r = { report: null, views: [], recent: [], minute: [], wasOnline: false }));

    if (!report.docker.available && r.report) {
      // With Docker not answering there, nothing in it is running. Keep the list of what should be, marked as stopped,
      // rather than have every app vanish from the page.
      report.containers = r.report.containers.map((c) => ({ ...c, state: 'docker-off', status: "Docker isn't running", health: '', cpu: 0, mem: 0 }));
      report.proxyHosts = r.report.proxyHosts;
    }
    r.report = report;
    this.machines.saveReport(id, report);

    const h = report.host;
    if (h) {
      const g = h.gpus[0];
      const s: MachineSample = [now, h.cpu, h.mem.total ? h.mem.used / h.mem.total : 0, h.net.rx, h.net.tx, h.load[0], g ? g.util : null, g?.memTotal ? g.memUsed / g.memTotal : null, g?.temp ?? null];
      r.recent.push(s);
      const kept = Math.max(60, Math.round(3600 / report.agent.interval));
      if (r.recent.length > kept) r.recent.splice(0, r.recent.length - kept);
      r.minute.push(s);
    }
    this.#evaluateMachine(id, now);
  }

  removeMachine(id: number) {
    this.machines.remove(id);
    this.#remote.delete(id);
    for (const key of [...this.#watch.keys()]) if (machineOfKey(key) === id) this.#watch.delete(key);
    for (const key of [...this.#open.keys()]) if (machineOfKey(key) === id) this.#open.delete(key);
  }

  #online(r: Remote, now: number): boolean {
    if (!r.report) return false;
    return now - r.report.ts < Math.max(OFFLINE_MIN_MS, r.report.agent.interval * 1000 * MISSED_REPORTS);
  }

  #evaluateMachine(id: number, now = Date.now()) {
    const r = this.#remote.get(id);
    if (!r?.report) return;
    const online = this.#online(r, now);
    r.wasOnline = online;
    r.views = this.#appViews(deriveMachineApps(id, r.report), (key) => machineOfKey(key) === id, now, {
      off: !online,
      // These addresses are the machine's public ones, so they are tried directly, from here, over the internet.
      via: (host) => (isPublicName(host.domains[0]) ? () => checkAddress(host.domains[0], host.domains[0], host.ssl, publicLookup) : null),
      again: () => this.#evaluateMachine(id),
    });
  }

  // ---- internals ----------------------------------------------------------

  #prefs(): Map<string, Prefs> {
    const out = new Map<string, Prefs>();
    for (const r of this.db.prepare('SELECT app, label, url, hidden FROM app_prefs').all() as unknown as {
      app: string;
      label: string | null;
      url: string | null;
      hidden: number;
    }[]) {
      out.set(r.app, { label: r.label, url: r.url, hidden: r.hidden === 1 });
    }
    return out;
  }

  async #poll() {
    try {
      const res = await fetch(`${this.config.probeUrl}/snapshot`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`the probe answered ${res.status}`);
      const snap = (await res.json()) as Snapshot;
      const fresh = snap.ts !== this.#snap?.ts;
      this.#snap = snap;
      this.#fetchedAt = Date.now();
      this.#fetchError = '';
      if (fresh && snap.host) {
        const h = snap.host;
        const s: Sample = [snap.ts, h.cpu, h.mem.total ? h.mem.used / h.mem.total : 0, h.net.rx, h.net.tx, h.load[0]];
        this.#recent.push(s);
        if (this.#recent.length > RECENT_KEPT) this.#recent.shift();
        this.#minute.push(s);
      }
    } catch (e) {
      this.#fetchError = `Can't reach the probe: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.#evaluate();
  }

  #evaluate() {
    if (!this.#snap) return;
    this.#views = this.#appViews(deriveApps(this.#snap), (key) => machineOfKey(key) === null, Date.now(), {
      off: false,
      via: (host) => () => checkAddress(this.config.proxyHost, host.domains[0], host.ssl),
      again: () => this.#evaluate(),
    });
  }

  /**
   * One row per app. `mine` says which keys belong to the machine being
   * judged, so tidying up after apps that have gone never touches another
   * machine's. `via` gives the way to try an app's address, or null when it
   * can't be tried from here.
   */
  #appViews(
    defs: AppDef[],
    mine: (key: string) => boolean,
    now: number,
    opts: { off: boolean; via: (host: ProxyHost) => (() => Promise<HttpCheck>) | null; again: () => void },
  ): AppView[] {
    const prefs = this.#prefs();
    const live = new Set(defs.map((d) => d.key));
    for (const key of this.#watch.keys()) if (mine(key) && !live.has(key)) this.#watch.delete(key);
    // An app that no longer exists can't still be having a problem.
    for (const key of [...this.#open.keys()]) if (mine(key) && !live.has(key)) this.#track(key, 'up', '', now);

    return defs.map((def) => {
      const p = prefs.get(def.key);
      const hidden = p?.hidden ?? false;
      const host = def.hosts[0];
      let w = this.#watch.get(def.key);
      if (!w) this.#watch.set(def.key, (w = { http: null, fails: 0, nextCheck: 0, checking: false }));

      if (def.check) {
        // The machine's own agent tried this one and counted its failures.
        const { name: _name, url: _url, fails, ...result } = def.check;
        w.http = { ...result, certDays: null };
        w.fails = fails;
      } else {
        // Only an app that is meant to be answering gets asked.
        const run = host && !def.missing && (!def.container || def.container.state === 'running') ? opts.via(host) : null;
        if (run && !opts.off && !hidden && !w.checking && now >= w.nextCheck) void this.#check(def.key, w, run, opts.again);
        if (!run) {
          w.http = null;
          w.fails = 0;
          w.nextCheck = 0;
        }
      }

      const { state, issues } = opts.off ? { state: 'off' as const, issues: [] } : judge(def, w.http, w.fails);
      const view: AppView = {
        key: def.key,
        name: p?.label ?? def.name,
        state,
        issues,
        hidden,
        url: p?.url ?? (host ? `${host.ssl ? 'https' : 'http'}://${host.domains[0]}` : ''),
        domains: def.hosts.flatMap((h) => h.domains),
        container: def.container,
        http: w.http,
        ...this.#uptime(def.key, now),
        downSince: null,
      };
      // Hiding an app says "I know, stop telling me", which ends its incident too. So does its machine going quiet:
      // what is known then is that the machine is off, not that the app broke.
      view.downSince = this.#track(def.key, hidden || state === 'off' ? 'up' : state, issues[0] ?? '', now);
      return view;
    });
  }

  async #check(key: string, w: Watch, run: () => Promise<HttpCheck>, again: () => void) {
    w.checking = true;
    try {
      const result = await run();
      w.http = result;
      w.fails = result.ok ? 0 : w.fails + 1;
      w.nextCheck = Date.now() + (result.ok ? CHECK_MS : RECHECK_MS);
    } finally {
      w.checking = false;
    }
    if (this.#watch.get(key) === w) again();
  }

  /** Opens or closes the app's incident as its state changes; returns when the current one began. */
  #track(app: string, state: AppState, reason: string, now: number): number | null {
    const openId = this.#open.get(app);
    if (state === 'up') {
      if (openId !== undefined) {
        this.db.prepare('UPDATE incidents SET ended_at = ? WHERE id = ?').run(now, openId);
        this.#open.delete(app);
      }
      return null;
    }
    if (openId === undefined) {
      const { lastInsertRowid } = this.db.prepare('INSERT INTO incidents (app, started_at, reason) VALUES (?, ?, ?)').run(app, now, reason);
      this.#open.set(app, Number(lastInsertRowid));
      return now;
    }
    const row = this.db.prepare('SELECT started_at FROM incidents WHERE id = ?').get(openId) as { started_at: number } | undefined;
    return row?.started_at ?? now;
  }

  #uptime(app: string, now: number): Pick<AppView, 'uptime24h' | 'uptime7d' | 'uptime30d' | 'hours' | 'days'> {
    const hour = Math.floor(now / 3_600_000);
    const rows = this.db.prepare('SELECT hour, ok, total FROM uptime WHERE app = ? AND hour > ? ORDER BY hour').all(app, hour - 24 * 30) as unknown as {
      hour: number;
      ok: number;
      total: number;
    }[];
    const share = (from: number, to: number) => {
      let ok = 0;
      let total = 0;
      for (const r of rows) {
        if (r.hour > from && r.hour <= to) {
          ok += r.ok;
          total += r.total;
        }
      }
      return total ? ok / total : null;
    };
    return {
      uptime24h: share(hour - 24, hour),
      uptime7d: share(hour - 24 * 7, hour),
      uptime30d: share(hour - 24 * 30, hour),
      hours: Array.from({ length: 24 }, (_, i) => share(hour - 24 + i, hour - 23 + i)),
      days: Array.from({ length: 30 }, (_, i) => share(hour - 24 * (30 - i), hour - 24 * (29 - i))),
    };
  }

  #everyMinute() {
    const now = Date.now();
    const sec = Math.floor(now / 1000);
    const hour = Math.floor(now / 3_600_000);
    const add = this.db.prepare(
      'INSERT INTO uptime (app, hour, ok, total) VALUES (?, ?, ?, 1) ON CONFLICT(app, hour) DO UPDATE SET ok = ok + excluded.ok, total = total + 1',
    );

    // One averaged row per minute keeps a week of history small.
    if (this.#minute.length) {
      const avg = (i: number) => this.#minute.reduce((a, s) => a + s[i], 0) / this.#minute.length;
      this.db.prepare('INSERT OR REPLACE INTO host_samples (ts, cpu, mem, load1, rx, tx) VALUES (?, ?, ?, ?, ?, ?)').run(sec, avg(1), avg(2), avg(5), avg(3), avg(4));
      this.#minute = [];
    }
    // Uptime only counts minutes we could actually see the machine.
    if (now - this.#fetchedAt < POLL_MS * 4) {
      for (const v of this.#views) if (!v.hidden) add.run(v.key, hour, v.state === 'up' ? 1 : 0);
    }

    for (const [id, r] of this.#remote) {
      if (!r.report) continue;
      const online = this.#online(r, now);
      if (r.minute.length) {
        const avg = (i: number) => mean(r.minute.map((s) => s[i])) ?? 0;
        const gpu = (i: number) => mean(r.minute.map((s) => s[i]));
        this.db
          .prepare('INSERT OR REPLACE INTO machine_samples (machine, ts, cpu, mem, load1, rx, tx, gpu, vram, gpu_temp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, sec, avg(1), avg(2), avg(5), avg(3), avg(4), gpu(6), gpu(7), gpu(8));
        r.minute = [];
      }
      // The machine's own row is the one place "off" counts against uptime: it records when the machine was on.
      add.run(`machine:${id}`, hour, online ? 1 : 0);
      if (online) for (const v of r.views) if (!v.hidden) add.run(v.key, hour, v.state === 'up' ? 1 : 0);
    }

    if (new Date(now).getMinutes() === 7) {
      this.db.prepare('DELETE FROM host_samples WHERE ts < ?').run(sec - SAMPLE_DAYS * 86_400);
      this.db.prepare('DELETE FROM machine_samples WHERE ts < ?').run(sec - SAMPLE_DAYS * 86_400);
      this.db.prepare('DELETE FROM uptime WHERE hour < ?').run(hour - UPTIME_DAYS * 24);
      this.db.prepare('DELETE FROM incidents WHERE ended_at IS NOT NULL AND ended_at < ?').run(now - UPTIME_DAYS * 86_400_000);
    }
  }
}
