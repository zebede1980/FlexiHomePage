// The hosted bookmark store has to behave like chrome.bookmarks, because the
// page code written against the browser API runs on it unchanged. So the same
// scripted edits are run against both and the trees compared.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { BookmarkStore, type TreeNode } from '../src/bookmarks.js';
import { openDb } from '../src/db.js';
import { cleanReport } from '../src/machines.js';
import { Monitor, deriveApps, deriveMachineApps, isPublicName, judge } from '../src/monitor.js';
import { createMockBookmarks } from '../../src/lib/mock-chrome';

const config = { port: 0, host: '127.0.0.1', dataDir: ':memory:', webDir: '/nonexistent', probeUrl: '', proxyHost: 'x' };

type Shape = { title: string; url?: string; children?: Shape[] };
const shape = (n: { title: string; url?: string; children?: unknown[] }): Shape => ({
  title: n.title,
  ...(n.url !== undefined ? { url: n.url } : {}),
  ...(n.children ? { children: (n.children as Shape[]).map(shape) } : {}),
});

describe('bookmark store', () => {
  let store: BookmarkStore;
  beforeEach(() => {
    store = new BookmarkStore(openDb(':memory:'));
  });

  it('starts with the two fixed folders at the ids the page expects', () => {
    const tree = store.getTree();
    expect(tree.id).toBe('0');
    expect(tree.children!.map((c) => [c.id, c.title, c.role])).toEqual([
      ['1', 'Bookmarks', 'bar'],
      ['2', 'Other bookmarks', 'other'],
    ]);
  });

  it('matches chrome.bookmarks through a script of creates, moves and removes', async () => {
    const chrome = createMockBookmarks({ title: '', children: [{ title: 'Bookmarks', children: [] }, { title: 'Other bookmarks', children: [] }] });
    const ids = { c: new Map<string, string>(), s: new Map<string, string>() };
    const both = async (name: string, d: { parent: string; title: string; url?: string; index?: number }) => {
      const pc = ids.c.get(d.parent) ?? d.parent;
      const ps = ids.s.get(d.parent) ?? d.parent;
      ids.c.set(name, (await chrome.create({ parentId: pc, title: d.title, url: d.url, index: d.index })).id);
      ids.s.set(name, store.create({ parentId: ps, title: d.title, url: d.url, index: d.index }).id);
    };
    const move = async (name: string, parent: string, index?: number) => {
      await chrome.move(ids.c.get(name)!, { parentId: ids.c.get(parent) ?? parent, index });
      store.move(ids.s.get(name)!, { parentId: ids.s.get(parent) ?? parent, index });
    };
    const same = async () => expect(shape(store.getTree())).toEqual(shape((await chrome.getTree())[0]));

    await both('work', { parent: '1', title: 'Work' });
    await both('dev', { parent: '1', title: 'Dev' });
    for (const t of ['a', 'b', 'c', 'd', 'e']) await both(t, { parent: 'work', title: t, url: `https://${t}.example/` });
    await both('first', { parent: 'work', title: 'first', url: 'https://first.example/', index: 0 });
    await same();

    await move('a', 'work', 4); // down within a folder: lands before what was at 4
    await same();
    await move('e', 'work', 0); // up within a folder
    await same();
    await move('c', 'work', 99); // past the end
    await same();
    await move('b', 'dev'); // to another folder, appended
    await move('d', 'dev', 0);
    await same();
    await move('dev', 'work', 2); // a folder with contents
    await same();

    await chrome.update(ids.c.get('a')!, { title: 'A!', url: 'https://a.example/new' });
    store.update(ids.s.get('a')!, { title: 'A!', url: 'https://a.example/new' });
    await chrome.remove(ids.c.get('first')!);
    store.remove(ids.s.get('first')!, false);
    await chrome.removeTree(ids.c.get('dev')!);
    store.remove(ids.s.get('dev')!, true);
    await same();

    const indexes = (n: TreeNode): number[] => (n.children ?? []).map((c) => c.index!);
    expect(indexes(store.getTree().children![0].children![0])).toEqual([0, 1, 2]);
  });

  it('refuses the edits a browser refuses', () => {
    const f = store.create({ parentId: '1', title: 'F' });
    const inner = store.create({ parentId: f.id, title: 'Inner' });
    const link = store.create({ parentId: f.id, title: 'L', url: 'https://l.example/' });
    expect(() => store.move(f.id, { parentId: inner.id })).toThrow(/into itself/);
    expect(() => store.create({ parentId: link.id, title: 'x' })).toThrow(/does not specify a folder/);
    expect(() => store.remove(f.id, false)).toThrow(/non-empty/);
    expect(() => store.update(f.id, { url: 'https://x/' })).toThrow(/folder/);
    expect(() => store.remove('1', true)).toThrow(/root/);
    expect(() => store.create({ parentId: '0', title: 'top' })).toThrow(/root/);
    expect(() => store.update('999', { title: 'x' })).toThrow(/Can't find/);
  });

  it('counts every change and tells listeners', () => {
    const seen: number[] = [];
    store.onChange((r) => seen.push(r));
    const start = store.rev;
    const a = store.create({ parentId: '1', title: 'a', url: 'https://a/' });
    store.update(a.id, { title: 'b' });
    expect(store.rev).toBe(start + 2);
    expect(seen).toEqual([start + 1, start + 2]);
  });

  it('applies a batch as a unit, resolving references between its changes', () => {
    const { refs } = store.batch([
      { op: 'create', ref: 'f', parentId: '1', title: 'Folder' },
      { op: 'create', ref: 'x', parentId: 'ref:f', title: 'x', url: 'https://x/' },
      { op: 'create', ref: 'y', parentId: 'ref:f', title: 'y', url: 'https://y/' },
      { op: 'order', parentId: 'ref:f', ids: ['ref:y', 'ref:x'] },
    ]);
    const folder = store.getTree().children![0].children![0];
    expect(folder.id).toBe(refs.f);
    expect(folder.children!.map((c) => c.title)).toEqual(['y', 'x']);

    const rev = store.rev;
    expect(() =>
      store.batch([
        { op: 'remove', id: refs.x },
        { op: 'update', id: '424242', title: 'nope' },
      ]),
    ).toThrow(/Change 2/);
    expect(store.rev).toBe(rev);
    expect(store.getTree().children![0].children![0].children).toHaveLength(2); // the remove was rolled back
  });

  it('refuses a batch computed from an older tree', () => {
    const rev = store.rev;
    store.create({ parentId: '1', title: 'elsewhere', url: 'https://e/' });
    expect(() => store.batch([{ op: 'create', parentId: '1', title: 'late' }], { baseRev: rev })).toThrow(/changed since/);
  });

  it('returns the existing twin for a de-duplicated create', () => {
    const a = store.create({ parentId: '1', title: 'same', url: 'https://same/' });
    const { refs } = store.batch([{ op: 'create', ref: 'again', parentId: '1', title: 'same', url: 'https://same/', dedupe: true }]);
    expect(refs.again).toBe(a.id);
    expect(store.getTree().children![0].children).toHaveLength(1);
  });

  it('reorders listed children and leaves the others in their slots', () => {
    const made = ['a', 'b', 'c', 'd'].map((t) => store.create({ parentId: '1', title: t, url: `https://${t}/` }).id);
    store.batch([{ op: 'order', parentId: '1', ids: [made[3], made[0]] }]); // only a and d are listed
    expect(store.getTree().children![0].children!.map((c) => c.title)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('keeps top-level folders by role so a second browser finds the same ones', () => {
    const { refs } = store.batch([
      { op: 'top', ref: 'bar', role: 'bar', title: 'Bookmarks Bar' },
      { op: 'top', ref: 'mob', role: 'mobile', title: 'Mobile' },
    ]);
    expect(refs.bar).toBe('1');
    const tops = store.getTree().children!;
    expect(tops.map((t) => t.title)).toEqual(['Bookmarks Bar', 'Other bookmarks', 'Mobile']);
    expect(store.batch([{ op: 'top', ref: 'mob', role: 'mobile', title: 'Mobile' }]).refs.mob).toBe(refs.mob);
  });

  it('restores a snapshot with the same ids', () => {
    const a = store.create({ parentId: '1', title: 'keep', url: 'https://keep/' });
    store.snapshot('test');
    const snap = store.listSnapshots()[0];
    store.remove(a.id, false);
    store.create({ parentId: '2', title: 'later', url: 'https://later/' });
    store.restoreSnapshot(snap.id);
    const tree = store.getTree();
    expect(tree.children![0].children!.map((c) => [c.id, c.title])).toEqual([[a.id, 'keep']]);
    expect(tree.children![1].children).toHaveLength(0);
    // Ids are never reused, so a browser's record of "what I had" can't point at the wrong thing.
    expect(Number(store.create({ parentId: '1', title: 'new', url: 'https://new/' }).id)).toBeGreaterThan(Number(a.id) + 1);
  });
});

describe('http api', () => {
  let app: App;
  const json = { 'content-type': 'application/json', 'x-flexihome': '1' };
  beforeEach(async () => {
    app = await buildApp(openDb(':memory:'), config);
  });

  const cookieOf = (res: { cookies: { name: string; value: string }[] }) => `fh_session=${res.cookies.find((c) => c.name === 'fh_session')!.value}`;

  async function signedIn(): Promise<string> {
    const code = app.auth.issueSetupCode();
    const res = await app.server.inject({ method: 'POST', url: '/api/auth/setup', headers: json, payload: { code, password: 'correct horse battery' } });
    expect(res.statusCode).toBe(200);
    return cookieOf(res);
  }

  it('keeps everything behind sign-in', async () => {
    for (const url of ['/api/tree', '/api/monitor', '/api/export', '/api/events', '/api/favicon?host=example.com']) {
      expect((await app.server.inject({ url })).statusCode, url).toBe(401);
    }
    expect((await app.server.inject({ url: '/api/health' })).statusCode).toBe(200);
    expect((await app.server.inject({ url: '/api/auth/state' })).json()).toMatchObject({ signedIn: false, needsSetup: true });
  });

  it('lets the set-up code be used once, by whoever has it', async () => {
    const code = app.auth.issueSetupCode();
    const bad = await app.server.inject({ method: 'POST', url: '/api/auth/setup', headers: json, payload: { code: 'guess', password: 'correct horse battery' } });
    expect(bad.statusCode).toBe(403);
    const short = await app.server.inject({ method: 'POST', url: '/api/auth/setup', headers: json, payload: { code, password: 'short' } });
    expect(short.statusCode).toBe(400);
    const ok = await app.server.inject({ method: 'POST', url: '/api/auth/setup', headers: json, payload: { code, password: 'correct horse battery' } });
    expect(ok.statusCode).toBe(200);
    const again = await app.server.inject({ method: 'POST', url: '/api/auth/setup', headers: json, payload: { code, password: 'another password!' } });
    expect(again.statusCode).toBe(403);
    expect(await app.auth.checkPassword('correct horse battery')).toBe(true);
  });

  it('signs in with the password and slows down wrong guesses', async () => {
    await signedIn();
    const login = (password: string) => app.server.inject({ method: 'POST', url: '/api/auth/login', headers: json, payload: { password } });
    expect((await login('correct horse battery')).statusCode).toBe(200);
    for (let i = 0; i < 5; i++) expect((await login('wrong')).statusCode).toBe(401);
    const locked = await login('correct horse battery');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().wait).toBeGreaterThan(0);
  });

  it('serves and edits the tree for a signed-in browser, and refuses a forged cross-site post', async () => {
    const cookie = await signedIn();
    const forged = await app.server.inject({ method: 'POST', url: '/api/bookmarks', headers: { cookie, 'content-type': 'application/json' }, payload: { parentId: '1', title: 'x' } });
    expect(forged.statusCode).toBe(403);

    const made = await app.server.inject({ method: 'POST', url: '/api/bookmarks', headers: { ...json, cookie }, payload: { parentId: '1', title: 'Site', url: 'https://site.example/' } });
    expect(made.statusCode).toBe(200);
    const tree = (await app.server.inject({ url: '/api/tree', headers: { cookie } })).json();
    expect(tree.tree.children[0].children[0]).toMatchObject({ title: 'Site', url: 'https://site.example/', parentId: '1', index: 0 });
    expect((await app.server.inject({ url: `/api/tree?rev=${tree.rev}`, headers: { cookie } })).statusCode).toBe(304);

    const gone = await app.server.inject({ method: 'PATCH', url: '/api/bookmarks/9999', headers: { ...json, cookie }, payload: { title: 'x' } });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error).toMatch(/Can't find/);
  });

  it('links a bridge with the password and lets it work with its key alone', async () => {
    await signedIn();
    const wrong = await app.server.inject({ method: 'POST', url: '/api/bridge/link', headers: json, payload: { password: 'nope', name: 'Desktop' } });
    expect(wrong.statusCode).toBe(401);
    const link = await app.server.inject({ method: 'POST', url: '/api/bridge/link', headers: json, payload: { password: 'correct horse battery', name: 'Desktop' } });
    const { token } = link.json();
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const batch = await app.server.inject({ method: 'POST', url: '/api/batch', headers: auth, payload: { ops: [{ op: 'create', ref: 'a', parentId: '1', title: 'From Vivaldi', url: 'https://v.example/' }] } });
    expect(batch.statusCode).toBe(200);
    expect(batch.json().refs.a).toBeTruthy();
    // The site remembers which browser a bookmark came from; ones made on the site carry no mark.
    app.store.create({ parentId: '1', title: 'From the site', url: 'https://s.example/' });
    expect(app.store.getTree().children![0].children!.map((c) => c.origin)).toEqual([1, undefined]);
    expect((await app.server.inject({ url: '/api/tree', headers: { authorization: 'Bearer fh_wrong' } })).statusCode).toBe(401);
  });

  it('gives the job of adding new bookmarks to one bridge at a time', async () => {
    await signedIn();
    const link = async (name: string) =>
      (await app.server.inject({ method: 'POST', url: '/api/bridge/link', headers: json, payload: { password: 'correct horse battery', name } })).json().token as string;
    const lease = async (token: string) => (await app.server.inject({ method: 'POST', url: '/api/bridge/lease', headers: { authorization: `Bearer ${token}` } })).json();
    const desktop = await link('Desktop');
    const laptop = await link('Laptop');
    expect(await lease(desktop)).toMatchObject({ primary: true, holder: 'Desktop', self: 1, linked: [1, 2] });
    expect(await lease(laptop)).toMatchObject({ primary: false, holder: 'Desktop', self: 2 });
    expect(await lease(desktop)).toMatchObject({ primary: true, holder: 'Desktop' });
    // Unlinking the holder frees the job straight away.
    app.auth.revokeToken(app.auth.listTokens().find((t) => t.name === 'Desktop')!.id);
    expect(await lease(laptop)).toMatchObject({ primary: true, holder: 'Laptop', linked: [2] });
  });
});

describe('other machines', () => {
  let app: App;
  const json = { 'content-type': 'application/json', 'x-flexihome': '1' };
  beforeEach(async () => {
    app = await buildApp(openDb(':memory:'), config);
  });
  afterEach(() => vi.useRealTimers());

  async function signedIn(): Promise<string> {
    const res = await app.server.inject({ method: 'POST', url: '/api/auth/setup', headers: json, payload: { code: app.auth.issueSetupCode(), password: 'correct horse battery' } });
    return `fh_session=${res.cookies.find((c) => c.name === 'fh_session')!.value}`;
  }
  const addMachine = async (cookie: string, name = 'Desktop PC') =>
    (await app.server.inject({ method: 'POST', url: '/api/machines', headers: { ...json, cookie }, payload: { name } })).json() as { id: number; name: string; key: string };
  const send = (key: string, payload: object) =>
    app.server.inject({ method: 'POST', url: '/api/agent/report', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, payload });
  const machineView = async (cookie: string) => (await app.server.inject({ url: '/api/monitor', headers: { cookie } })).json().machines[0];

  const container = (name: string, over: object = {}) => ({
    id: name, name, image: 'img', project: '', service: '', state: 'running', status: 'Up 2 hours', health: '', startedAt: 1, finishedAt: null,
    exitCode: null, restarts: 0, cpu: 0.01, mem: 1000, ports: [], networks: [], ...over,
  });
  const host = (over: object = {}) => ({
    hostname: 'pc', os: 'Windows 11 Pro', kernel: '10.0', cores: 4, uptime: 600, load: [0, 0, 0], cpu: 0.25, mem: { total: 100, used: 40, available: 60 }, swap: { total: 0, used: 0 },
    disk: { total: 1000, used: 500 }, net: { rx: 10, tx: 20 }, rebootRequired: false, platform: 'win32', cpuModel: 'Some CPU', perCore: [0.1, 0.2, 0.3, 0.4],
    disks: [{ name: 'C:', total: 1000, used: 500 }], gpus: [{ name: 'Some GPU', util: 0.5, memUsed: 4, memTotal: 16, temp: 40, power: 100, fan: 0.3 }], ...over,
  });
  const report = (over: object = {}) => ({ agent: { version: '1', interval: 10 }, host: host(), docker: { available: true, error: '' }, containers: [container('comfy-gateway')], proxyHosts: [], checks: [], errors: [], ...over });

  it("gives a machine a key that posts its report and opens nothing else", async () => {
    const cookie = await signedIn();
    expect((await app.server.inject({ url: '/api/auth/state', headers: { cookie } })).json().monitor).toBe(false);
    const made = await addMachine(cookie);
    expect(made.key).toMatch(/^fhm_/);
    // There is now something for the Server tab to show.
    expect((await app.server.inject({ url: '/api/auth/state', headers: { cookie } })).json().monitor).toBe(true);

    expect((await send('fhm_wrong', report())).statusCode).toBe(401);
    expect((await send(made.key, report())).statusCode).toBe(200);
    expect((await app.server.inject({ url: '/api/tree', headers: { authorization: `Bearer ${made.key}` } })).statusCode).toBe(401);
    expect((await app.server.inject({ url: '/api/monitor', headers: { authorization: `Bearer ${made.key}` } })).statusCode).toBe(401);
    // Straight after one report, another is too soon.
    expect((await send(made.key, report())).statusCode).toBe(429);

    // A linked browser's key is not the owner: it can't add or remove machines.
    const { token } = (await app.server.inject({ method: 'POST', url: '/api/bridge/link', headers: json, payload: { password: 'correct horse battery', name: 'Vivaldi' } })).json();
    const bridge = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    expect((await app.server.inject({ method: 'POST', url: '/api/machines', headers: bridge, payload: { name: 'x' } })).statusCode).toBe(403);
    expect((await app.server.inject({ method: 'DELETE', url: `/api/machines/${made.id}`, headers: bridge, payload: {} })).statusCode).toBe(403);

    await app.server.inject({ method: 'DELETE', url: `/api/machines/${made.id}`, headers: { ...json, cookie }, payload: {} });
    expect((await send(made.key, report())).statusCode).toBe(401);
    expect((await app.server.inject({ url: '/api/monitor', headers: { cookie } })).json().machines).toEqual([]);
  });

  it('shows what the machine reported, with its apps kept apart from the server\'s own', async () => {
    const cookie = await signedIn();
    const made = await addMachine(cookie);
    await send(made.key, report({ checks: [{ name: 'ComfyUI', url: 'http://127.0.0.1:8188/', ok: true, status: 200, ms: 4, error: '', checkedAt: Date.now(), fails: 0 }] }));
    const m = await machineView(cookie);
    expect(m).toMatchObject({ id: made.id, name: 'Desktop PC', online: true, docker: { available: true } });
    expect(m.host).toMatchObject({ hostname: 'pc', platform: 'win32', perCore: [0.1, 0.2, 0.3, 0.4], gpus: [{ name: 'Some GPU', util: 0.5 }] });
    expect(m.apps.map((a: { key: string; state: string }) => [a.key, a.state])).toEqual([
      [`m${made.id}/comfy-gateway`, 'up'],
      [`m${made.id}/check:ComfyUI`, 'up'],
    ]);
    const history = (await app.server.inject({ url: `/api/monitor/history?range=1h&machine=${made.id}`, headers: { cookie } })).json();
    expect(history.samples).toHaveLength(1);
    expect(history.samples[0].slice(1)).toEqual([0.25, 0.4, 10, 20, 0, 0.5, 0.25, 40]);
    // The server's own history is a different question.
    expect((await app.server.inject({ url: '/api/monitor/history?range=1h', headers: { cookie } })).json().samples).toEqual([]);
  });

  it("clips and corrects a report rather than trusting it", () => {
    const r = cleanReport({
      agent: { version: 'x'.repeat(500), interval: -5 },
      host: host({ cpu: 7, hostname: 'h'.repeat(500), perCore: ['no', 2, -1], gpus: [{ name: 5, util: 'lots', temp: 'hot' }], mem: 'plenty' }),
      docker: 'yes',
      containers: [container('ok'), { name: '' }, 'nonsense'],
      checks: [{ name: 'c', url: 'http://x/', ok: 'true', fails: -3 }],
      errors: 'none',
    }, 1000);
    expect(r.ts).toBe(1000);
    expect(r.agent).toEqual({ version: 'x'.repeat(20), interval: 1 });
    expect(r.host).toMatchObject({ cpu: 1, perCore: [0, 1, 0], mem: { total: 0, used: 0, available: 0 }, gpus: [{ name: '', util: 0, temp: null }] });
    expect(r.host!.hostname).toHaveLength(80);
    expect(r.docker).toEqual({ available: false, error: '' });
    expect(r.containers.map((c) => c.name)).toEqual(['ok']);
    expect(r.checks[0]).toMatchObject({ ok: false, fails: 0, status: null });
    expect(r.errors).toEqual([]);
    expect(cleanReport(null, 5)).toMatchObject({ ts: 5, host: null, containers: [] });
  });

  it('says an app the agent could not reach twice running is down, and why', async () => {
    const cookie = await signedIn();
    const made = await addMachine(cookie);
    const check = (fails: number) => ({ name: 'ComfyUI', url: 'http://127.0.0.1:8188/', ok: false, status: null, ms: 3, error: 'nothing is listening there', checkedAt: Date.now(), fails });
    app.monitor.acceptReport(made.id, report({ containers: [], checks: [check(1)] }));
    expect((await machineView(cookie)).apps[0].state).toBe('up');
    app.monitor.acceptReport(made.id, report({ containers: [], checks: [check(2)] }));
    expect((await machineView(cookie)).apps[0]).toMatchObject({ state: 'down', issues: ['Not answering at its address: nothing is listening there.'] });
  });

  it('keeps the containers listed, as down, while Docker is not running there', async () => {
    const cookie = await signedIn();
    const made = await addMachine(cookie);
    app.monitor.acceptReport(made.id, report({ containers: [container('npm'), container('comfy-gateway')] }));
    app.monitor.acceptReport(made.id, report({ docker: { available: false, error: '' }, containers: [] }));
    const m = await machineView(cookie);
    expect(m.docker.available).toBe(false);
    expect(m.apps.map((a: { name: string; state: string; issues: string[] }) => [a.name, a.state, a.issues[0]])).toEqual([
      ['npm', 'down', "Docker isn't running on this machine."],
      ['comfy-gateway', 'down', "Docker isn't running on this machine."],
    ]);
    // Back again: they are simply up.
    app.monitor.acceptReport(made.id, report({ containers: [container('npm'), container('comfy-gateway')] }));
    expect((await machineView(cookie)).apps.map((a: { state: string }) => a.state)).toEqual(['up', 'up']);
  });

  it('calls a machine offline once its reports stop, without calling its apps broken', async () => {
    const cookie = await signedIn();
    const made = await addMachine(cookie);
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    app.monitor.acceptReport(made.id, report({ containers: [container('npm'), container('stopped', { state: 'exited', exitCode: 1 })] }));
    let m = await machineView(cookie);
    expect(m.online).toBe(true);
    expect(m.apps.map((a: { state: string }) => a.state)).toEqual(['up', 'down']);
    expect(m.apps[1].downSince).not.toBeNull();

    vi.setSystemTime(Date.now() + 30_000); // a couple of reports missed: not yet
    expect((await machineView(cookie)).online).toBe(true);
    vi.setSystemTime(Date.now() + 60_000);
    m = await machineView(cookie);
    expect(m.online).toBe(false);
    expect(m.host.hostname).toBe('pc'); // its last readings are still there to read
    expect(m.apps.map((a: { state: string; downSince: number | null }) => [a.state, a.downSince])).toEqual([['off', null], ['off', null]]);

    // What it last said survives the site restarting.
    const reopened = new Monitor((app.monitor as unknown as { db: ReturnType<typeof openDb> }).db, config);
    expect(reopened.view().machines[0]).toMatchObject({ online: false, host: { hostname: 'pc' } });
  });

  it('only tries addresses that could be on the internet', () => {
    expect(isPublicName('comfy.example.com')).toBe(true);
    for (const name of ['flexihome-probe', 'localhost', '10.0.0.5', 'nginx-proxy-manager', 'a..b.com', 'x.local1', '']) expect(isPublicName(name), name).toBe(false);
    const defs = deriveMachineApps(3, { containers: [container('npm') as never], proxyHosts: [{ id: 1, domains: ['app.example.com'], host: 'npm', port: 81, scheme: 'http', enabled: true, ssl: true }], checks: [] });
    expect(defs.map((d) => [d.key, d.hosts.map((h) => h.domains[0])])).toEqual([['m3/npm', ['app.example.com']]]);
  });
});

describe('app health', () => {
  const container = (name: string, over: object = {}) => ({
    id: name, name, image: 'img', project: '', service: '', state: 'running', status: 'Up', health: '', startedAt: 1, finishedAt: null,
    exitCode: null, restarts: 0, cpu: 0, mem: 0, ports: [], networks: [], ...over,
  });
  const host = (id: number, domain: string, to: string, over: object = {}) => ({ id, domains: [domain], host: to, port: 80, scheme: 'http', enabled: true, ssl: true, ...over });
  const http = (over: object = {}) => ({ ok: true, status: 200, ms: 5, error: '', checkedAt: 0, certDays: 60, ...over });

  it('pairs addresses with the containers they point at', () => {
    const apps = deriveApps({
      containers: [container('blog'), container('stack-db-1', { service: 'db' })],
      proxyHosts: [host(1, 'blog.example', 'BLOG'), host(2, 'old.example', 'gone-app'), host(3, 'box.example', '172.17.0.1'), host(4, 'off.example', 'blog', { enabled: false })],
    });
    expect(apps.map((a) => [a.key, a.hosts.map((h) => h.domains[0]), a.missing])).toEqual([
      ['blog', ['blog.example'], ''],
      ['stack-db-1', [], ''],
      ['proxy:old.example', ['old.example'], 'gone-app'],
      ['proxy:box.example', ['box.example'], ''],
    ]);
  });

  it('says in plain words what is wrong', () => {
    const def = (c: object | null, missing = '') => ({ key: 'k', name: 'k', container: c as never, hosts: [], missing });
    expect(judge(def(container('a')), http(), 0)).toEqual({ state: 'up', issues: [] });
    expect(judge(def(container('a', { state: 'exited', exitCode: 137 })), null, 0)).toEqual({ state: 'down', issues: ['Stopped after an error (exit code 137).'] });
    expect(judge(def(container('a', { state: 'exited', exitCode: 0 })), null, 0).issues).toEqual(['Stopped.']);
    expect(judge(def(container('a', { health: 'unhealthy' })), http(), 0).state).toBe('degraded');
    expect(judge(def(null, 'gone-app'), null, 0).state).toBe('down');
    // One failed request isn't an outage; two in a row is.
    const bad = http({ ok: false, status: 502, error: "error 502 (the proxy can't reach the app)" });
    expect(judge(def(container('a')), bad, 1).state).toBe('up');
    expect(judge(def(container('a')), bad, 2)).toEqual({ state: 'degraded', issues: ["Not answering at its address: error 502 (the proxy can't reach the app)."] });
    expect(judge(def(container('a')), http({ certDays: 3 }), 0)).toEqual({ state: 'up', issues: ['Its security certificate expires in 3 days.'] });
  });
});
