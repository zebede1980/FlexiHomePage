// Life Tracker on the to-do card: its open to-dos and anything recurring that's late,
// due or coming up, with add, tick-off and undo. It talks straight to Life Tracker's
// token API (/api/ext/), which allows any origin, so the extension needs no host
// permission. The address and token are kept in this browser only (localStorage),
// never in the synced settings bookmark: each machine links once.

export type Horizon = 'short' | 'medium' | 'long';

export interface LtTask {
  id: number;
  name: string;
  emoji: string;
  kind: 'interval' | 'target' | 'schedule' | 'deadline' | 'todo' | 'log';
  horizon: Horizon | null;
  state: 'overdue' | 'due' | 'soon' | 'ok' | 'done' | 'none';
  label: string;
  dueDate: string | null;
  snoozed: boolean;
  url: string;
}

interface Link {
  url: string;
  token: string;
}

interface Listing {
  tasks: LtTask[];
}

const LS_KEY = 'flexihome:lifetracker';
const REFRESH_MS = 5 * 60_000;

function readLink(): Link | null {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
    return v && typeof v.url === 'string' && typeof v.token === 'string' ? v : null;
  } catch {
    return null;
  }
}

export const lt = $state({
  link: readLink(),
  tasks: [] as LtTask[],
  loaded: false,
  error: '',
});

/** "life.example.com" or "https://life.example.com/anything" → "https://life.example.com". */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  try {
    const u = new URL(hasScheme ? s : `${/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(s) ? 'http' : 'https'}://${s}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

export class LtError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(link: Link, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(link.url + path, {
      method,
      headers: { authorization: `Bearer ${link.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new LtError(`Couldn't reach Life Tracker at ${link.url}`, 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new LtError('Life Tracker didn’t accept the token. Make a new one in its Settings and link again.', 401);
  if (!res.ok) throw new LtError((data as { message?: string }).message ?? `Life Tracker said ${res.status}`, res.status);
  return data as T;
}

function take(r: Listing) {
  lt.tasks = r.tasks;
  lt.loaded = true;
  lt.error = '';
}

export async function refresh(): Promise<void> {
  if (!lt.link) return;
  try {
    take(await call<Listing>(lt.link, 'GET', '/api/ext/tasks'));
  } catch (err) {
    lt.error = (err as Error).message;
  }
}

/** Checks the address and token work before keeping them. */
export async function link(rawUrl: string, token: string): Promise<void> {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new LtError('That doesn’t look like a web address', 0);
  const next = { url, token: token.trim() };
  take(await call<Listing>(next, 'GET', '/api/ext/tasks'));
  lt.link = next;
  localStorage.setItem(LS_KEY, JSON.stringify(next));
}

export function unlink(): void {
  lt.link = null;
  lt.tasks = [];
  lt.loaded = false;
  lt.error = '';
  localStorage.removeItem(LS_KEY);
}

function need(): Link {
  if (!lt.link) throw new LtError('Not linked to Life Tracker', 0);
  return lt.link;
}

/** Adds a to-do; returns its id, for Undo. */
export async function addTask(name: string, horizon: Horizon): Promise<number> {
  const r = await call<Listing & { id: number }>(need(), 'POST', '/api/ext/todos', { name, horizon });
  take(r);
  return r.id;
}

export async function takeBack(id: number): Promise<void> {
  take(await call<Listing>(need(), 'POST', `/api/ext/todos/${id}/archive`, {}));
}

/** Ticks it off; returns the log id, for Undo. */
export async function done(task: LtTask): Promise<number> {
  const r = await call<Listing & { logId: number }>(need(), 'POST', `/api/ext/tasks/${task.id}/done`, {});
  take(r);
  return r.logId;
}

export async function undoDone(logId: number): Promise<void> {
  take(await call<Listing>(need(), 'POST', `/api/ext/logs/${logId}/undo`, {}));
}

/** Keeps the list fresh while a page shows it: now, on coming back to the tab, and every few minutes. */
export function keepFresh(): () => void {
  void refresh();
  const onVisible = () => document.visibilityState === 'visible' && void refresh();
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => document.visibilityState === 'visible' && void refresh(), REFRESH_MS);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}

/** Matches Life Tracker's own order: what needs doing first. */
export const NEEDS_YOU = (t: LtTask) => t.state === 'overdue' || t.state === 'due';
