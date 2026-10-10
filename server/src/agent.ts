// The agent: run on a machine other than the site's own, it sends the site a
// summary of that machine every few seconds, which the Server tab shows beside
// the server itself. It only ever calls out to the site, so it works from
// behind a home router, and a machine that is switched off is simply not
// heard from.
//
//   node agent.js <config.json>        run until stopped
//   node agent.js <config.json> --once print one report and stop (sends nothing)
//
// The config is { "url", "key", "interval"?, "checks"?, "docker"?, "proxyHosts"?, "log"? };
// FLEXIHOME_URL and FLEXIHOME_KEY in the environment do instead of a file.

import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readDocker, readHost, runCheck } from './agent-lib.js';
import type { LocalCheck, MachineReport } from './machines.js';

const VERSION = '1';

interface AgentConfig {
  /** The site's address, e.g. https://home.example.com */
  url: string;
  /** This machine's key, from the site's Settings (or `flexihome add-machine`). */
  key: string;
  /** Seconds between reports. */
  interval: number;
  /** Addresses to try from this machine, for apps here that aren't containers. */
  checks: { name: string; url: string }[];
  /** A socket or pipe to reach Docker on, '' to look in the usual places, false to leave Docker alone. */
  docker: string | false;
  /** Read Nginx Proxy Manager's host list, when it runs here, to learn each app's public address. */
  proxyHosts: boolean;
  /** A file to note changes in, for when the agent runs with no window to print to. */
  log: string;
}

function loadConfig(path: string | undefined): AgentConfig {
  const file = path ? (JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as Partial<AgentConfig>) : {};
  const env = process.env;
  const url = (file.url ?? env.FLEXIHOME_URL ?? '').trim().replace(/\/+$/, '');
  const key = (file.key ?? env.FLEXIHOME_KEY ?? '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('No site address: set "url" in the config file, e.g. "https://home.example.com".');
  if (!key.startsWith('fhm_')) throw new Error('No key: set "key" in the config file to the one the site gave for this machine.');
  const interval = Number(file.interval ?? env.FLEXIHOME_INTERVAL ?? 10);
  return {
    url,
    key,
    interval: Number.isFinite(interval) ? Math.min(3600, Math.max(5, interval)) : 10,
    checks: (Array.isArray(file.checks) ? file.checks : []).filter((c) => c && typeof c.name === 'string' && /^https?:\/\//i.test(c.url ?? '')),
    docker: file.docker === false ? false : typeof file.docker === 'string' ? file.docker : (env.DOCKER_SOCK ?? ''),
    proxyHosts: file.proxyHosts !== false,
    log: typeof file.log === 'string' ? file.log : '',
  };
}

let logFile = '';
/** Only changes are logged (started, stopped getting through, got through again), so the file stays a few lines long. */
function log(line: string) {
  const stamped = `${new Date().toLocaleString('sv-SE')}  ${line}`; // that locale writes 2026-10-10 11:36:58, in local time
  console.log(stamped);
  if (!logFile) return;
  try {
    if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > 256 * 1024) writeFileSync(logFile, '');
    appendFileSync(logFile, stamped + '\n');
  } catch {
    // Nowhere to write is no reason to stop reporting.
  }
}

let checks: LocalCheck[] = [];
let checksAt = 0;

async function collect(config: AgentConfig): Promise<Omit<MachineReport, 'ts'>> {
  const errors: string[] = [];
  const note = (what: string) => (e: unknown) => {
    errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  };
  const [host, docker] = await Promise.all([readHost().catch(note('host')), readDocker(config.docker, config.proxyHosts)]);
  // Addresses are tried less often than the machine is read: every half minute is plenty to say "up" or "down".
  if (config.checks.length && Date.now() - checksAt >= 30_000) {
    checksAt = Date.now();
    checks = await Promise.all(config.checks.map((c) => runCheck(c)));
  }
  return {
    agent: { version: VERSION, interval: config.interval },
    host,
    docker: { available: docker.available, error: docker.error },
    containers: docker.containers,
    proxyHosts: docker.proxyHosts,
    checks,
    errors,
  };
}

/** What went wrong, in a few words; '' when the site took the report. */
async function send(config: AgentConfig, report: object): Promise<string> {
  try {
    const res = await fetch(`${config.url}/api/agent/report`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return '';
    const said = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    return res.status === 401 ? 'the site refused the key (was this machine removed there?)' : `the site answered ${res.status}${said ? `: ${said}` : ''}`;
  } catch (e) {
    return `can't reach ${new URL(config.url).host} (${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message})`;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes('--once');
  const config = loadConfig(args.find((a) => !a.startsWith('--')));

  // Processor and network figures are rates between two readings, so the first reading only sets the baseline.
  await readHost().catch(() => {});
  await sleep(1000);

  if (once) {
    console.log(JSON.stringify(await collect(config), null, 2));
    return;
  }

  logFile = config.log;
  log(`reporting to ${config.url} every ${config.interval} seconds`);
  let problem: string | null = null;
  for (;;) {
    const started = Date.now();
    const result = await send(config, await collect(config));
    // One line when things change, not one per report.
    if (result !== problem) {
      log(result ? `not getting through: ${result}` : problem === null ? 'the site is receiving reports' : 'getting through again');
      problem = result;
    }
    await sleep(Math.max(1000, config.interval * 1000 - (Date.now() - started)));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
