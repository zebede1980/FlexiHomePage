// The Server tab's data: polled from the FlexiHome server while the tab is on
// screen, and left alone while it isn't.

import { api } from './backend.svelte';

export interface HostInfo {
  hostname: string;
  os: string;
  kernel: string;
  cores: number;
  uptime: number;
  load: [number, number, number];
  cpu: number;
  mem: { total: number; used: number; available: number };
  swap: { total: number; used: number };
  disk: { total: number; used: number };
  net: { rx: number; tx: number };
  rebootRequired: boolean;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  project: string;
  service: string;
  state: string;
  status: string;
  health: string;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  restarts: number;
  cpu: number;
  mem: number;
  ports: number[];
  networks: string[];
}

export type AppState = 'up' | 'degraded' | 'down';

export interface AppView {
  key: string;
  name: string;
  state: AppState;
  issues: string[];
  hidden: boolean;
  url: string;
  domains: string[];
  container: ContainerInfo | null;
  http: { ok: boolean; status: number | null; ms: number; error: string; checkedAt: number; certDays: number | null } | null;
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  /** Share of checks passed in each of the last 24 hours, oldest first; null where nothing was recorded. */
  hours: (number | null)[];
  /** The same for each of the last 30 days. */
  days: (number | null)[];
  downSince: number | null;
}

export interface MonitorView {
  available: boolean;
  ts: number;
  stale: boolean;
  errors: string[];
  host: HostInfo | null;
  apps: AppView[];
}

/** [time, cpu share, memory share, bytes in per second, bytes out per second, load] */
export type Sample = [number, number, number, number, number, number];
export type Range = '1h' | '24h' | '7d';

const LIVE_MS = 5_000;

class MonitorStore {
  view = $state.raw<MonitorView | null>(null);
  samples = $state.raw<Sample[]>([]);
  range = $state<Range>('1h');
  error = $state('');

  #timers: ReturnType<typeof setInterval>[] = [];

  /** Starts polling; returns the function that stops it. */
  watch(): () => void {
    const onVisible = () => {
      if (document.visibilityState === 'visible') this.#start();
      else this.#stop();
    };
    document.addEventListener('visibilitychange', onVisible);
    onVisible();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      this.#stop();
    };
  }

  setRange(range: Range) {
    this.range = range;
    void this.#history();
  }

  async setPrefs(key: string, patch: { label?: string | null; url?: string | null; hidden?: boolean }) {
    this.view = await api<MonitorView>(`/api/monitor/apps/${encodeURIComponent(key)}`, { method: 'PUT', body: patch });
  }

  #start() {
    this.#stop();
    void this.#live();
    void this.#history();
    this.#timers = [setInterval(() => void this.#live(), LIVE_MS), setInterval(() => void this.#history(), 30_000)];
  }

  #stop() {
    this.#timers.forEach(clearInterval);
    this.#timers = [];
  }

  async #live() {
    try {
      this.view = await api<MonitorView>('/api/monitor');
      this.error = '';
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async #history() {
    const range = this.range;
    try {
      const h = await api<{ samples: Sample[] }>(`/api/monitor/history?range=${range}`);
      if (range === this.range) this.samples = h.samples;
    } catch {
      // The live poll already reports a lost connection.
    }
  }
}

export const monitor = new MonitorStore();
