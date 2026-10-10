// The extension's background worker. Two jobs: the toolbar button, and keeping
// this browser's bookmarks in step with a FlexiHome site it has been linked to.
//
// The worker is started and stopped by the browser at will, so nothing lives in
// memory between events: what it knows is in chrome.storage.local.

import { DEFAULT_PREFS, DEFAULT_STATUS, type Link, type Reply, type Request, type Status, type Stored } from './shared';
import { StaleError, emptyState, sync, type LocalApi, type RemoteApi, type RemoteOp, type SyncNode, type SyncOptions, type SyncResult } from './sync';

const TICK_ALARM = 'flexihome-tick';
/** How long after a bookmark change to wait for more before syncing. */
const SETTLE_MS = 4_000;
const LEASE_EVERY_MS = 20 * 60_000;
/** A full comparison this often even when neither side reports a change, in case a change slipped past unnoticed. */
const FULL_EVERY_MS = 15 * 60_000;

const store = {
  get: <K extends keyof Stored>(...keys: K[]) => chrome.storage.local.get(keys) as Promise<Pick<Stored, K>>,
  set: (values: Partial<Stored>) => chrome.storage.local.set(values),
};

class Unlinked extends Error {}

// ---- talking to the site ----

async function call<T>(link: Pick<Link, 'url' | 'token'>, path: string, init: { method?: string; body?: unknown } = {}): Promise<T | undefined> {
  let res: Response;
  try {
    res = await fetch(link.url + path, {
      method: init.method ?? 'GET',
      credentials: 'omit',
      cache: 'no-store',
      headers: { authorization: `Bearer ${link.token}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(`Can't reach ${new URL(link.url).host}.`);
  }
  if (res.status === 304) return undefined;
  if (res.status === 401) throw new Unlinked('This browser has been unlinked on the site.');
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 409) throw new StaleError(data.error ?? 'stale');
  if (!res.ok) throw new Error(data.error ?? `The site answered ${res.status}.`);
  return data as T;
}

const remoteFor = (link: Link): RemoteApi => ({
  getTree: async () => (await call<{ rev: number; tree: SyncNode }>(link, '/api/tree'))!,
  batch: async (ops: RemoteOp[], baseRev: number, reason: string) =>
    (await call<{ rev: number; refs: Record<string, string> }>(link, '/api/batch', { method: 'POST', body: { ops, baseRev, reason } }))!,
});

const local: LocalApi = {
  getTree: () => chrome.bookmarks.getTree() as Promise<SyncNode[]>,
  create: (d) => chrome.bookmarks.create(d),
  update: (id, changes) => chrome.bookmarks.update(id, changes),
  move: (id, dest) => chrome.bookmarks.move(id, dest),
  removeTree: (id) => chrome.bookmarks.removeTree(id),
};

// ---- running a sync ----

let running: Promise<Reply> | null = null;
/**
 * Bookmark events seen while a run was under way. Most are the run's own
 * writes, but one could be the user's, made after the run had read the tree.
 * They can't be told apart, so any at all earns one more run afterwards: it
 * finds nothing to do if they were ours, and so raises no further events.
 */
let eventsDuringRun = 0;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let leaseAt = 0;

async function setStatus(patch: Partial<Status>) {
  const { status } = await store.get('status');
  await store.set({ status: { ...DEFAULT_STATUS, ...status, ...patch } });
}

/** One run at a time; a second caller gets the result of the one in flight. */
function run(mode: { force?: boolean; dryRun?: boolean } = {}): Promise<Reply> {
  if (!running) {
    eventsDuringRun = 0;
    running = doRun(mode).finally(() => {
      running = null;
      if (eventsDuringRun && !mode.dryRun) scheduleTick();
    });
  }
  return running;
}

async function doRun(mode: { force?: boolean; dryRun?: boolean }): Promise<Reply> {
  const { link, prefs = DEFAULT_PREFS, state = emptyState() } = await store.get('link', 'prefs', 'state');
  if (!link) return { ok: false, error: 'Not linked to a site yet.' };
  if (!mode.dryRun) await setStatus({ phase: 'syncing', message: '' });
  try {
    // Which new bookmarks this browser takes from the site: see SyncOptions.pull.
    let pull: SyncOptions['pull'] = 'all';
    let lease = { primary: true, holder: '', self: link.id, linked: [link.id] };
    if (!prefs.solo) {
      lease = (await call<typeof lease>(link, '/api/bridge/lease', { method: 'POST' }))!;
      leaseAt = Date.now();
      pull = lease.primary ? 'site' : 'none';
    }

    let result: SyncResult | undefined;
    // "Stale" means the site changed between our read and our write; reading again settles it.
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await sync(local, remoteFor(link), state, {
        pull,
        self: lease.self,
        linked: lease.linked,
        name: link.name,
        force: mode.force,
        dryRun: mode.dryRun,
        preferLocalSettings: !link.ready && link.firstImport,
      });
      if (result.status !== 'stale') break;
    }
    if (!result || result.status === 'stale') throw new Error('The site kept changing while syncing; it will be tried again shortly.');
    if (mode.dryRun) return { ok: true, summary: result.summary };

    const now = Date.now();
    const problems = result.summary.errors;
    await store.set({
      state: result.state,
      rev: result.rev,
      dirty: result.status === 'confirm' || eventsDuringRun > 0,
      redirect: prefs.newTabSite ? { url: link.url, up: true } : null,
      status: {
        phase: result.status === 'confirm' ? 'confirm' : problems.length ? 'error' : 'idle',
        at: now,
        seenAt: now,
        message: problems.length ? `Some changes couldn't be made here: ${problems.slice(0, 3).join('; ')}` : '',
        summary: result.summary,
        primary: lease.primary,
        holder: lease.primary ? '' : lease.holder,
      },
    });
    return { ok: true, summary: result.summary };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof Unlinked) {
      // The key was revoked on the site. Keep the bookmarks, forget the link.
      await chrome.storage.local.remove(['link', 'state', 'rev', 'dirty']);
      await store.set({ redirect: null, status: { ...DEFAULT_STATUS, phase: 'error', at: Date.now(), message } });
    } else if (!mode.dryRun) {
      await setStatus({ phase: 'error', at: Date.now(), message });
      await markReachable(false);
    }
    return { ok: false, error: message };
  }
}

/** The new-tab page only sends you to the site while the site is answering. */
async function markReachable(up: boolean) {
  const { redirect } = await store.get('redirect');
  if (redirect && redirect.up !== up) await store.set({ redirect: { ...redirect, up } });
}

/** The regular check: cheap when nothing has changed on either side. */
async function tick() {
  const { link, dirty, rev, status, prefs = DEFAULT_PREFS } = await store.get('link', 'dirty', 'rev', 'status', 'prefs');
  if (!link?.ready || status?.phase === 'confirm') return;
  try {
    if (!dirty && Date.now() - (status?.at ?? 0) < FULL_EVERY_MS) {
      const changed = await call<unknown>(link, `/api/tree?rev=${rev ?? -1}`);
      await markReachable(true);
      if (changed === undefined) {
        await setStatus({ seenAt: Date.now(), ...(status?.phase === 'error' ? { phase: 'idle', message: '' } : {}) });
        // Keep hold of (or keep track of) the adding job even when there is nothing to sync.
        if (!prefs.solo && Date.now() - leaseAt > LEASE_EVERY_MS) {
          const lease = await call<{ primary: boolean; holder: string }>(link, '/api/bridge/lease', { method: 'POST' });
          leaseAt = Date.now();
          if (lease) await setStatus({ primary: lease.primary, holder: lease.primary ? '' : lease.holder });
        }
        return;
      }
    }
    await run();
  } catch (e) {
    if (e instanceof Unlinked) return void run(); // lets doRun clear the link in one place
    await markReachable(false);
    await setStatus({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

function scheduleTick() {
  void store.set({ dirty: true });
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => void tick(), SETTLE_MS);
}

function onBookmarksChanged() {
  if (running) eventsDuringRun++;
  else scheduleTick();
}

// ---- linking ----

async function linkTo(req: Extract<Request, { type: 'link' }>): Promise<Reply> {
  let url: string;
  try {
    url = new URL(/^https?:\/\//i.test(req.url.trim()) ? req.url.trim() : `https://${req.url.trim()}`).origin;
  } catch {
    return { ok: false, error: "That doesn't look like a web address." };
  }
  let res: Response;
  try {
    res = await fetch(`${url}/api/bridge/link`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: req.password, name: req.name }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, error: `Can't reach ${new URL(url).host}. Check the address.` };
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; token?: string; id?: number; links?: number; folders?: number };
  if (!res.ok || !data.token || data.id === undefined) {
    return { ok: false, error: data.error ?? (res.status === 404 ? "There's no FlexiHome at that address." : `The site answered ${res.status}.`) };
  }
  await chrome.storage.local.remove(['state', 'rev', 'dirty']);
  await store.set({
    link: { url, token: data.token, id: data.id, name: req.name, ready: false, firstImport: (data.links ?? 0) === 0 },
    status: DEFAULT_STATUS,
  });
  return { ok: true, site: { links: data.links ?? 0, folders: data.folders ?? 0 } };
}

async function unlink(): Promise<Reply> {
  const { link } = await store.get('link');
  if (link) {
    // Best effort: tell the site to forget this key too.
    await call(link, `/api/bridges/${link.id}`, { method: 'DELETE' }).catch(() => {});
  }
  await chrome.storage.local.remove(['link', 'state', 'rev', 'dirty', 'status']);
  await store.set({ redirect: null });
  return { ok: true };
}

async function handle(req: Request): Promise<Reply> {
  switch (req.type) {
    case 'link':
      return linkTo(req);
    case 'preview':
      return run({ dryRun: true });
    case 'approve': {
      // The first sync, looked over and agreed to.
      const { link } = await store.get('link');
      if (!link) return { ok: false, error: 'Not linked to a site yet.' };
      const out = await run({ force: true });
      if (out.ok) await store.set({ link: { ...link, ready: true } });
      return out;
    }
    case 'sync':
      return run({ force: req.force });
    case 'unlink':
      return unlink();
    case 'prefs': {
      const { link } = await store.get('link');
      await store.set({ prefs: req.prefs, redirect: link?.ready && req.prefs.newTabSite ? { url: link.url, up: true } : null });
      return { ok: true };
    }
  }
}

// ---- events (registered at the top level, as a worker that wakes for an event must) ----

chrome.runtime.onMessage.addListener((req: Request, _sender, reply: (r: Reply) => void) => {
  handle(req).then(reply, (e) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // the reply comes later
});

const ensureAlarm = () => void chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  // Give the browser's own sync a head start, so what it delivers is recognised rather than raced.
  setTimeout(() => void tick(), 20_000);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) void tick();
});

for (const event of [chrome.bookmarks.onCreated, chrome.bookmarks.onRemoved, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved] as chrome.events.Event<() => void>[]) {
  event.addListener(onBookmarksChanged);
}
chrome.bookmarks.onChildrenReordered?.addListener(onBookmarksChanged);
chrome.bookmarks.onImportEnded?.addListener(onBookmarksChanged);

// Clicking the toolbar button opens the home page, which is handy before the
// Vivaldi "controlled by extension" new-tab setting has been switched on. Once
// new tabs already go to the linked site, it opens the link page instead, since
// that is the one thing a new tab no longer gets you to.
chrome.action.onClicked.addListener(() => {
  void store.get('redirect').then(({ redirect }) => chrome.tabs.create({ url: chrome.runtime.getURL(redirect ? 'bridge.html' : 'newtab.html') }));
});
