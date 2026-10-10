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
  // The rest only comes from a machine that reports in through the agent.
  /** win32, linux, darwin. */
  platform?: string;
  cpuModel?: string;
  /** 0–1 for each logical core. */
  perCore?: number[];
  disks?: DiskInfo[];
  gpus?: GpuInfo[];
}

export interface DiskInfo {
  name: string;
  total: number;
  used: number;
}

export interface GpuInfo {
  name: string;
  util: number;
  memUsed: number;
  memTotal: number;
  temp: number | null;
  power: number | null;
  fan: number | null;
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

/** 'off': on a machine that has stopped reporting, so nobody can say. */
export type AppState = 'up' | 'degraded' | 'down' | 'off';

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
  /** The site's own machine is being read; false when only other machines report in. */
  probe: boolean;
  ts: number;
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
  /** When it last reported; 0 if it never has. */
  ts: number;
  online: boolean;
  agent: { version: string; interval: number } | null;
  host: HostInfo | null;
  docker: { available: boolean; error: string };
  errors: string[];
  apps: AppView[];
  /** Share of the time the machine itself was on and reporting. */
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  hours: (number | null)[];
  days: (number | null)[];
}

/**
 * [time, cpu share, memory share, bytes in per second, bytes out per second, load], and for a machine that reports in,
 * its first graphics card: [..., how busy (0–1), memory in use (0–1), temperature]. Those three are null with no card.
 */
export type Sample = [number, number, number, number, number, number, (number | null)?, (number | null)?, (number | null)?];
export type Range = '1h' | '24h' | '7d';

const LIVE_MS = 5_000;

class MonitorStore {
  view = $state.raw<MonitorView | null>(null);
  samples = $state.raw<Sample[]>([]);
  range = $state<Range>('1h');
  /** Whose history samples holds: a machine that reports in, or null for the site's own. */
  machine = $state<number | null>(null);
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

  setMachine(machine: number | null) {
    if (machine === this.machine) return;
    this.machine = machine;
    this.samples = [];
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
    const machine = this.machine;
    try {
      const h = await api<{ samples: Sample[] }>(`/api/monitor/history?range=${range}${machine === null ? '' : `&machine=${machine}`}`);
      if (range === this.range && machine === this.machine) this.samples = h.samples;
    } catch {
      // The live poll already reports a lost connection.
    }
  }
}

export const monitor = new MonitorStore();
