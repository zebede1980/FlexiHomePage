// Reading containers from the Docker API over its local socket (a Unix socket,
// or a named pipe on Windows). Used by the probe beside the site and by the
// agent on other machines; neither ever sends Docker anything but a GET.

import { request } from 'node:http';

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

/** The raw body of a GET, for the one answer that isn't JSON (a file copied out of a container). */
export function dockerRaw(socketPath: string, path: string, timeout = 8000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, method: 'GET', timeout }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) return reject(new Error(`Docker said ${res.statusCode} for ${path}`));
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Docker didn't answer ${path} in time`)));
    req.on('error', reject);
    req.end();
  });
}

export async function docker<T>(socketPath: string, path: string): Promise<T> {
  return JSON.parse((await dockerRaw(socketPath, path)).toString('utf8')) as T;
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

export async function readContainers(socketPath: string): Promise<ContainerInfo[]> {
  const list = await docker<DockerListItem[]>(socketPath, '/containers/json?all=1');
  const seen = new Set<string>();
  const out = await Promise.all(
    list.map(async (c): Promise<ContainerInfo> => {
      seen.add(c.Id);
      const running = c.State === 'running';
      const [inspect, stats] = await Promise.all([
        docker<DockerInspect>(socketPath, `/containers/${c.Id}/json`).catch(() => null),
        running ? docker<DockerStats>(socketPath, `/containers/${c.Id}/stats?stream=false&one-shot=true`).catch(() => null) : null,
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
