// Turns the probe's raw view of the machine into what the Server tab shows:
// the host's vital signs with some history, and one row per app saying whether
// it is live and, if not, why.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { TLSSocket } from 'node:tls';
import type { Config } from './config.js';
import type { Db } from './db.js';
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

export type AppState = 'up' | 'degraded' | 'down';

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
  ts: number;
  /** The probe hasn't answered recently, so the numbers are old. */
  stale: boolean;
  errors: string[];
  host: HostInfo | null;
  apps: AppView[];
}

export type Sample = [ts: number, cpu: number, mem: number, rx: number, tx: number, load: number];

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
export function checkAddress(proxyHost: string, domain: string, ssl: boolean): Promise<HttpCheck> {
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

  constructor(
    private db: Db,
    private config: Config,
  ) {
    for (const r of db.prepare('SELECT id, app FROM incidents WHERE ended_at IS NULL').all() as { id: number; app: string }[]) {
      this.#open.set(r.app, r.id);
    }
  }

  get available(): boolean {
    return this.config.probeUrl !== '';
  }

  start() {
    if (!this.available) return;
    void this.#poll();
    this.#timers.push(setInterval(() => void this.#poll(), POLL_MS));
    this.#timers.push(setInterval(() => this.#everyMinute(), 60_000));
  }

  stop() {
    this.#timers.forEach(clearInterval);
    this.#timers = [];
  }

  view(): MonitorView {
    return {
      available: this.available,
      ts: this.#snap?.ts ?? 0,
      stale: this.available && Date.now() - this.#fetchedAt > POLL_MS * 4,
      errors: [...(this.#fetchError ? [this.#fetchError] : []), ...(this.#snap?.errors ?? [])],
      host: this.#snap?.host ?? null,
      apps: this.#views,
    };
  }

  history(range: string): { range: string; step: number; samples: Sample[] } {
    if (range === '1h') return { range, step: POLL_MS / 1000, samples: this.#recent };
    const days = range === '7d' ? 7 : 1;
    const bucket = range === '7d' ? 900 : 120; // seconds per point: ~670 points either way
    const rows = this.db
      .prepare(
        `SELECT (ts / ?) * ? AS t, AVG(cpu) AS cpu, AVG(mem) AS mem, AVG(rx) AS rx, AVG(tx) AS tx, AVG(load1) AS load1
         FROM host_samples WHERE ts >= ? GROUP BY ts / ? ORDER BY t`,
      )
      .all(bucket, bucket, Math.floor(Date.now() / 1000) - days * 86_400, bucket) as unknown as {
      t: number;
      cpu: number;
      mem: number;
      rx: number;
      tx: number;
      load1: number;
    }[];
    return { range: days === 7 ? '7d' : '24h', step: bucket, samples: rows.map((r) => [r.t * 1000, r.cpu, r.mem, r.rx, r.tx, r.load1]) };
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
    this.#evaluate();
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
    const now = Date.now();
    const prefs = this.#prefs();
    const defs = deriveApps(this.#snap);
    const live = new Set(defs.map((d) => d.key));
    for (const key of this.#watch.keys()) if (!live.has(key)) this.#watch.delete(key);
    // An app that no longer exists can't still be having a problem.
    for (const key of [...this.#open.keys()]) if (!live.has(key)) this.#track(key, 'up', '', now);

    this.#views = defs.map((def) => {
      const p = prefs.get(def.key);
      const hidden = p?.hidden ?? false;
      const host = def.hosts[0];
      let w = this.#watch.get(def.key);
      if (!w) this.#watch.set(def.key, (w = { http: null, fails: 0, nextCheck: 0, checking: false }));

      // Only an app that is meant to be answering gets asked.
      const answerable = host && !def.missing && (!def.container || def.container.state === 'running');
      if (answerable && !hidden && !w.checking && now >= w.nextCheck) void this.#check(def.key, w, host);
      if (!answerable) {
        w.http = null;
        w.fails = 0;
        w.nextCheck = 0;
      }

      const { state, issues } = judge(def, w.http, w.fails);
      const domains = def.hosts.flatMap((h) => h.domains);
      const view: AppView = {
        key: def.key,
        name: p?.label ?? def.name,
        state,
        issues,
        hidden,
        url: p?.url ?? (host ? `${host.ssl ? 'https' : 'http'}://${host.domains[0]}` : ''),
        domains,
        container: def.container,
        http: w.http,
        ...this.#uptime(def.key, now),
        downSince: null,
      };
      // Hiding an app says "I know, stop telling me", which ends its incident too.
      view.downSince = this.#track(def.key, hidden ? 'up' : state, issues[0] ?? '', now);
      return view;
    });
  }

  async #check(key: string, w: Watch, host: ProxyHost) {
    w.checking = true;
    try {
      const result = await checkAddress(this.config.proxyHost, host.domains[0], host.ssl);
      w.http = result;
      w.fails = result.ok ? 0 : w.fails + 1;
      w.nextCheck = Date.now() + (result.ok ? CHECK_MS : RECHECK_MS);
    } finally {
      w.checking = false;
    }
    if (this.#watch.get(key) === w) this.#evaluate();
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
    // One averaged row per minute keeps a week of history small.
    if (this.#minute.length) {
      const avg = (i: number) => this.#minute.reduce((a, s) => a + s[i], 0) / this.#minute.length;
      this.db
        .prepare('INSERT OR REPLACE INTO host_samples (ts, cpu, mem, load1, rx, tx) VALUES (?, ?, ?, ?, ?, ?)')
        .run(Math.floor(now / 1000), avg(1), avg(2), avg(5), avg(3), avg(4));
      this.#minute = [];
    }
    // Uptime only counts minutes we could actually see the machine.
    if (now - this.#fetchedAt < POLL_MS * 4) {
      const hour = Math.floor(now / 3_600_000);
      const add = this.db.prepare(
        'INSERT INTO uptime (app, hour, ok, total) VALUES (?, ?, ?, 1) ON CONFLICT(app, hour) DO UPDATE SET ok = ok + excluded.ok, total = total + 1',
      );
      for (const v of this.#views) if (!v.hidden) add.run(v.key, hour, v.state === 'up' ? 1 : 0);
    }
    if (new Date(now).getMinutes() === 7) {
      this.db.prepare('DELETE FROM host_samples WHERE ts < ?').run(Math.floor(now / 1000) - SAMPLE_DAYS * 86_400);
      this.db.prepare('DELETE FROM uptime WHERE hour < ?').run(Math.floor(now / 3_600_000) - UPTIME_DAYS * 24);
      this.db.prepare('DELETE FROM incidents WHERE ended_at IS NOT NULL AND ended_at < ?').run(now - UPTIME_DAYS * 86_400_000);
    }
  }
}
