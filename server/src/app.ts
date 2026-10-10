// HTTP routes. Everything under /api needs a signed-in browser or a bridge key,
// apart from the few routes needed to sign in.

import { existsSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Auth, MIN_PASSWORD } from './auth.js';
import { BookmarkError, BookmarkStore, type BatchOp } from './bookmarks.js';
import type { Config } from './config.js';
import { getMeta, setMeta, type Db } from './db.js';
import { Favicons, isHostname } from './favicons.js';
import { Monitor } from './monitor.js';

const COOKIE = 'fh_session';
const COOKIE_MAX_AGE = 400 * 24 * 3600;
/** How long the bridge that applies new bookmarks to the browser keeps that job without checking in. */
const LEASE_MS = 24 * 3600_000;
const MAX_MACHINES = 20;
const MIN_REPORT_GAP_MS = 2_000;

declare module 'fastify' {
  interface FastifyRequest {
    /** 'session' for a signed-in browser, or the id of the bridge key used. */
    who: 'session' | number | null;
  }
}

export interface App {
  server: FastifyInstance;
  store: BookmarkStore;
  auth: Auth;
  monitor: Monitor;
}

export async function buildApp(db: Db, config: Config, opts: { logger?: boolean } = {}): Promise<App> {
  const server = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 8 * 1024 * 1024 });
  const store = new BookmarkStore(db);
  const auth = new Auth(db);
  const monitor = new Monitor(db, config);
  const favicons = new Favicons(config.dataDir);

  await server.register(cookie);

  server.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof BookmarkError) return reply.code(err.status).send({ error: err.message });
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) server.log.error(err);
    return reply.code(status).send({ error: status === 500 ? 'Something went wrong on the server.' : err.message });
  });

  // ---- who is asking ----

  // The last one is open here because it answers to a machine's key, checked by the route itself.
  const OPEN = new Set(['/api/health', '/api/auth/state', '/api/auth/login', '/api/auth/setup', '/api/auth/logout', '/api/bridge/link', '/api/agent/report']);

  server.decorateRequest('who', null);
  server.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;

    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (bearer) {
      req.who = auth.checkToken(bearer);
    } else if (auth.checkSession(req.cookies[COOKIE])) {
      req.who = 'session';
      // A page on another site can make a browser send our cookie, but it can't add this header.
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-flexihome'] !== '1') {
        return reply.code(403).send({ error: 'Missing request header.' });
      }
    }
    if (req.who === null && !OPEN.has(path)) return reply.code(401).send({ error: 'Sign in first.' });
  });

  const setCookie = (req: FastifyRequest, reply: FastifyReply, value: string, maxAge: number) =>
    reply.setCookie(COOKIE, value, { path: '/', httpOnly: true, sameSite: 'lax', secure: req.protocol === 'https', maxAge });

  const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '');
  const body = (req: FastifyRequest) => (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {});

  /** Checks a password with the per-address slow-down applied. Sends the refusal itself. */
  async function passwordOk(req: FastifyRequest, reply: FastifyReply, password: string): Promise<boolean> {
    const wait = auth.limiter.waitFor(req.ip);
    if (wait > 0) {
      void reply.code(429).send({ error: `Too many wrong tries. Wait ${wait} second${wait === 1 ? '' : 's'} and try again.`, wait });
      return false;
    }
    if (!(await auth.checkPassword(password))) {
      auth.limiter.fail(req.ip);
      void reply.code(401).send({ error: auth.hasPassword ? 'Wrong password.' : 'No password has been set yet.' });
      return false;
    }
    auth.limiter.clear(req.ip);
    return true;
  }

  // ---- signing in ----

  server.get('/api/health', async () => ({ ok: true }));

  server.get('/api/auth/state', async (req) => ({
    signedIn: req.who !== null,
    needsSetup: !auth.hasPassword,
    monitor: monitor.available,
  }));

  server.post('/api/auth/setup', async (req, reply) => {
    const b = body(req);
    const password = str(b.password, 1000);
    if (password.length < MIN_PASSWORD) return reply.code(400).send({ error: `Use at least ${MIN_PASSWORD} characters.` });
    const wait = auth.limiter.waitFor(req.ip);
    if (wait > 0) return reply.code(429).send({ error: `Too many wrong tries. Wait ${wait} seconds and try again.`, wait });
    if (!(await auth.setPasswordWithCode(str(b.code), password))) {
      auth.limiter.fail(req.ip);
      return reply.code(403).send({ error: 'That set-up link has been used or has expired. Ask for a new one on the server.' });
    }
    setCookie(req, reply, auth.createSession(str(req.headers['user-agent'])), COOKIE_MAX_AGE);
    return { ok: true };
  });

  server.post('/api/auth/login', async (req, reply) => {
    if (!(await passwordOk(req, reply, str(body(req).password, 1000)))) return reply;
    setCookie(req, reply, auth.createSession(str(req.headers['user-agent'])), COOKIE_MAX_AGE);
    return { ok: true };
  });

  server.post('/api/auth/logout', async (req, reply) => {
    auth.endSession(req.cookies[COOKIE]);
    setCookie(req, reply, '', 0);
    return { ok: true };
  });

  server.post('/api/auth/password', async (req, reply) => {
    const b = body(req);
    const next = str(b.next, 1000);
    if (next.length < MIN_PASSWORD) return reply.code(400).send({ error: `Use at least ${MIN_PASSWORD} characters.` });
    if (!(await passwordOk(req, reply, str(b.current, 1000)))) return reply;
    await auth.setPassword(next);
    setCookie(req, reply, auth.createSession(str(req.headers['user-agent'])), COOKIE_MAX_AGE);
    return { ok: true };
  });

  // ---- bookmarks ----

  server.get('/api/tree', async (req, reply) => {
    const rev = store.rev;
    const known = Number((req.query as { rev?: string }).rev);
    if (known === rev) return reply.code(304).send();
    return { rev, tree: store.getTree() };
  });

  server.post('/api/bookmarks', async (req) => {
    const b = body(req) as { parentId?: string; title?: string; url?: string; index?: number };
    return store.create(b, typeof req.who === 'number' ? req.who : undefined);
  });

  server.patch('/api/bookmarks/:id', async (req) => {
    const b = body(req) as { title?: string; url?: string };
    return store.update((req.params as { id: string }).id, b);
  });

  server.post('/api/bookmarks/:id/move', async (req) => {
    const b = body(req) as { parentId?: string; index?: number };
    return store.move((req.params as { id: string }).id, b);
  });

  server.delete('/api/bookmarks/:id', async (req) => {
    const recursive = (req.query as { recursive?: string }).recursive === '1';
    // Deleting a whole folder is the one change on the page that can't be undone from a toast.
    if (recursive) store.snapshotIfDue('before deleting a folder', 0);
    store.remove((req.params as { id: string }).id, recursive);
    return { ok: true };
  });

  server.post('/api/batch', async (req) => {
    const b = body(req) as { ops?: BatchOp[]; baseRev?: number; reason?: string };
    const ops = Array.isArray(b.ops) ? b.ops : [];
    const risky = ops.some((o) => o?.op === 'remove') || ops.length > 20;
    return store.batch(ops, {
      baseRev: typeof b.baseRev === 'number' ? b.baseRev : undefined,
      snapshot: risky ? str(b.reason, 120) || 'before a sync' : undefined,
      origin: typeof req.who === 'number' ? req.who : undefined,
    });
  });

  // ---- live updates ----

  const streams = new Set<ServerResponse>();
  store.onChange((rev) => {
    for (const s of streams) s.write(`event: rev\ndata: ${rev}\n\n`);
  });
  const heartbeat = setInterval(() => {
    for (const s of streams) s.write(': keep-alive\n\n');
  }, 25_000);
  server.addHook('onClose', async () => {
    clearInterval(heartbeat);
    monitor.stop();
    for (const s of streams) s.end();
  });

  server.get('/api/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Tells nginx to pass each event on as it is written rather than batching them.
      'x-accel-buffering': 'no',
    });
    res.write(`retry: 4000\nevent: rev\ndata: ${store.rev}\n\n`);
    streams.add(res);
    req.raw.on('close', () => streams.delete(res));
  });

  // ---- site icons ----

  server.get('/api/favicon', async (req, reply) => {
    const q = req.query as { host?: string; sz?: string };
    const host = str(q.host, 260);
    if (!isHostname(host)) return reply.code(400).send({ error: 'Not a site name.' });
    const icon = await favicons.get(host, Math.min(64, Math.max(16, Number(q.sz) || 32)));
    reply.header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'");
    if (!icon) return reply.code(404).header('cache-control', 'private, max-age=86400').send();
    return reply.header('content-type', icon.type).header('cache-control', 'private, max-age=1209600').send(icon.body);
  });

  // ---- backups ----

  server.get('/api/snapshots', async () => ({ snapshots: store.listSnapshots() }));

  server.post('/api/snapshots', async () => {
    store.snapshot('saved by hand');
    return { snapshots: store.listSnapshots() };
  });

  server.post('/api/snapshots/:id/restore', async (req) => {
    store.restoreSnapshot(Number((req.params as { id: string }).id));
    return { ok: true, rev: store.rev };
  });

  server.get('/api/export', async (_req, reply) => {
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-disposition', `attachment; filename="flexihome-${stamp}.json"`)
      .send({ exportedAt: Date.now(), rev: store.rev, tree: store.getTree() });
  });

  // ---- browser bridges ----

  /** Trades the password for a key the bridge keeps, so the password itself is never stored in the browser. */
  server.post('/api/bridge/link', async (req, reply) => {
    const b = body(req);
    if (!(await passwordOk(req, reply, str(b.password, 1000)))) return reply;
    const made = auth.createToken(str(b.name, 80));
    return { ...made, ...store.count(), rev: store.rev };
  });

  server.get('/api/bridges', async () => {
    const lease = readLease();
    return { bridges: auth.listTokens().map((t) => ({ ...t, primary: lease?.id === t.id })) };
  });

  server.delete('/api/bridges/:id', async (req) => {
    auth.revokeToken(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  const readLease = (): { id: number; at: number } | null => {
    const raw = getMeta(db, 'lease');
    if (!raw) return null;
    const lease = JSON.parse(raw) as { id: number; at: number };
    // A key that was revoked can't still be holding the job.
    return auth.listTokens().some((t) => t.id === lease.id) ? lease : null;
  };

  /**
   * Browsers that share bookmarks through their own sync (Vivaldi Sync) must
   * not each add the same new bookmark, or the browser's sync delivers both
   * copies everywhere. So one bridge at a time holds the job of adding new
   * bookmarks to the browser; the others wait for the browser's sync to bring
   * them. The job passes on if its holder hasn't checked in for a day.
   */
  server.post('/api/bridge/lease', async (req, reply) => {
    if (typeof req.who !== 'number') return reply.code(403).send({ error: 'Only a bridge can ask for this.' });
    const now = Date.now();
    const lease = readLease();
    const mine = !lease || lease.id === req.who || now - lease.at > LEASE_MS;
    if (mine) setMeta(db, 'lease', JSON.stringify({ id: req.who, at: now }));
    const holder = mine ? req.who : lease!.id;
    const all = auth.listTokens();
    return { primary: mine, holder: all.find((t) => t.id === holder)?.name ?? '', self: req.who, linked: all.map((t) => t.id) };
  });

  // ---- server tab ----

  server.get('/api/monitor', async () => monitor.view());

  server.get('/api/monitor/history', async (req) => {
    const q = req.query as { range?: string; machine?: string };
    return monitor.history(str(q.range) || '1h', q.machine ? Number(q.machine) : undefined);
  });

  server.put('/api/monitor/apps/:key', async (req) => {
    const b = body(req) as { label?: string | null; url?: string | null; hidden?: boolean };
    monitor.setPrefs((req.params as { key: string }).key, {
      label: b.label === null ? null : typeof b.label === 'string' ? b.label : undefined,
      url: b.url === null ? null : typeof b.url === 'string' ? b.url : undefined,
      hidden: typeof b.hidden === 'boolean' ? b.hidden : undefined,
    });
    return monitor.view();
  });

  // ---- other machines that report in ----

  /** A machine's key is created, and the machine forgotten, only by the owner at the site: never by a bridge. */
  const ownerOnly = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.who === 'session') return true;
    void reply.code(403).send({ error: 'Sign in at the site to do this.' });
    return false;
  };

  server.get('/api/machines', async (req, reply) => {
    if (!ownerOnly(req, reply)) return reply;
    return { machines: monitor.machines.list() };
  });

  server.post('/api/machines', async (req, reply) => {
    if (!ownerOnly(req, reply)) return reply;
    if (monitor.machines.list().length >= MAX_MACHINES) return reply.code(400).send({ error: `No more than ${MAX_MACHINES} machines can report in.` });
    return monitor.machines.create(str(body(req).name, 60));
  });

  server.patch('/api/machines/:id', async (req, reply) => {
    if (!ownerOnly(req, reply)) return reply;
    monitor.machines.rename(Number((req.params as { id: string }).id), str(body(req).name, 60));
    return { machines: monitor.machines.list() };
  });

  server.delete('/api/machines/:id', async (req, reply) => {
    if (!ownerOnly(req, reply)) return reply;
    monitor.removeMachine(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  /** Where a machine's agent sends its summary. The key says which machine; it opens nothing else. */
  const lastReport = new Map<number, number>();
  server.post('/api/agent/report', { bodyLimit: 512 * 1024 }, async (req, reply) => {
    const key = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const id = monitor.machines.check(key);
    if (id === null) {
      // Wrong keys slow down like wrong passwords. A right key is never held up by it: the machine may share an
      // address with someone who has just mistyped the password a few times.
      const wait = auth.limiter.waitFor(req.ip);
      if (wait > 0) return reply.code(429).send({ error: `Too many wrong tries. Wait ${wait} seconds.`, wait });
      auth.limiter.fail(req.ip);
      return reply.code(401).send({ error: "That key isn't one of this site's." });
    }
    // More often than this is a misconfigured agent, and every report is a write to the database.
    const now = Date.now();
    if (now - (lastReport.get(id) ?? 0) < MIN_REPORT_GAP_MS) return reply.code(429).send({ error: 'Reporting too often.' });
    lastReport.set(id, now);
    monitor.acceptReport(id, req.body);
    return { ok: true };
  });

  // ---- the page itself ----

  if (existsSync(config.webDir)) {
    await server.register(fastifyStatic, {
      root: config.webDir,
      setHeaders(res, path) {
        // Built assets carry a content hash in their name, so they never change; everything else is re-checked.
        res.header('cache-control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
        res.header('x-content-type-options', 'nosniff');
        res.header('referrer-policy', 'no-referrer');
        if (path.endsWith('.html')) {
          res.header('x-frame-options', 'DENY');
          res.header(
            'content-security-policy',
            "default-src 'self'; img-src * data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          );
        }
      },
    });
  }

  server.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'No such route.' });
    return reply.code(404).type('text/plain').send('Not found');
  });

  return { server, store, auth, monitor };
}
