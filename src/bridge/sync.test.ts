// The bridge under test: in-memory browsers on one side, the real server store
// on the other, and a stand-in for Vivaldi Sync carrying changes between two
// browsers the way the real one does (same bookmark, different local ids).

import { beforeEach, describe, expect, it } from 'vitest';
import { BookmarkError, BookmarkStore } from '../../server/src/bookmarks.js';
import { openDb } from '../../server/src/db.js';
import { createMockBookmarks, type MockBookmarks, type MockSpec } from '../lib/mock-chrome';
import { encodeSettingsUrl, DEFAULT_SETTINGS } from '../lib/settings';
import { SETTINGS_FOLDER_TITLE, type BNode } from '../lib/tree';
import { StaleError, emptyState, mergeOrder, sync, type LocalApi, type RemoteApi, type RemoteOp, type SyncNode, type SyncOptions, type SyncState } from './sync';

const tick = () => new Promise((r) => setTimeout(r, 0));

const SEED: MockSpec = {
  title: '',
  children: [
    {
      title: 'Bookmarks',
      children: [
        { title: 'Gmail', url: 'https://mail.google.com/' },
        { title: 'GitHub', url: 'https://github.com/' },
        { title: 'Work', children: [{ title: 'Outlook', url: 'https://outlook.office.com/' }, { title: 'Teams', url: 'https://teams.microsoft.com/' }] },
        { title: 'Dev', children: [{ title: 'MDN', url: 'https://developer.mozilla.org/' }, { title: 'Tools', children: [{ title: 'Squoosh', url: 'https://squoosh.app/' }] }] },
      ],
    },
    { title: 'Other bookmarks', children: [{ title: 'Example', url: 'https://example.com/' }] },
    { title: 'Trash', children: [{ title: 'Old thing', url: 'https://example.org/' }] },
  ],
};

type Shape = string | [string, Shape[]];
const shape = (n: SyncNode): Shape => (n.url === undefined ? [n.title, (n.children ?? []).map(shape)] : `${n.title} <${n.url}>`);
/** The browser's tree as the site should see it: everything but the Trash. */
const localShape = (root: SyncNode): Shape[] => (root.children ?? []).filter((c) => c.title !== 'Trash').map(shape);
const remoteShape = (root: SyncNode): Shape[] => (root.children ?? []).map(shape);
const titles = (n: SyncNode | undefined) => (n?.children ?? []).map((c) => c.title);

function remoteApi(store: BookmarkStore, origin?: number): RemoteApi & { beforeBatch?: () => void } {
  const api: RemoteApi & { beforeBatch?: () => void } = {
    async getTree() {
      return { rev: store.rev, tree: store.getTree() as SyncNode };
    },
    async batch(ops: RemoteOp[], baseRev: number, reason: string) {
      api.beforeBatch?.();
      try {
        return store.batch(ops, { baseRev, snapshot: reason, origin });
      } catch (e) {
        if (e instanceof BookmarkError && e.status === 409) throw new StaleError(e.message);
        throw e;
      }
    },
  };
  return api;
}

/** One browser with the bridge installed: its bookmarks, and what the bridge remembers. */
class Machine {
  bm: MockBookmarks;
  state: SyncState = emptyState();
  /** `id` is this browser's bridge key on the server, when the test cares who made what. */
  constructor(
    public name: string,
    private remote: RemoteApi,
    spec: MockSpec = SEED,
    public id?: number,
  ) {
    this.bm = createMockBookmarks(structuredClone(spec));
  }
  async run(opts: Partial<SyncOptions> = {}) {
    const r = await sync(this.bm as unknown as LocalApi, this.remote, this.state, { pull: 'all', name: this.name, self: this.id, linked: [1, 2], ...opts });
    this.state = r.state;
    await tick();
    return r;
  }
  async tree(): Promise<BNode> {
    return (await this.bm.getTree())[0];
  }
  async find(...path: string[]): Promise<BNode> {
    let cur = await this.tree();
    for (const t of path) {
      const next = cur.children?.find((c) => c.title === t);
      if (!next) throw new Error(`${this.name}: no "${t}" under "${cur.title}"`);
      cur = next;
    }
    return cur;
  }
}

/**
 * Carries each browser's changes to the other, matching nodes by a shared
 * identity the way Vivaldi Sync does, so the same bookmark has a different
 * local id on each machine.
 */
class VivaldiSync {
  #guid = new Map<Machine, Map<string, string>>(); // local id → guid
  #queue = new Map<Machine, { guid: string; run: (to: Machine) => Promise<void> }[]>();
  #muted = new Set<Machine>();
  #n = 0;

  constructor(
    private a: Machine,
    private b: Machine,
  ) {}

  /** Both machines start with the same bookmarks, already in sync. */
  async start() {
    const [ta, tb] = [await this.a.tree(), await this.b.tree()];
    this.#guid.set(this.a, new Map());
    this.#guid.set(this.b, new Map());
    const walk = (x: BNode, y: BNode) => {
      const g = `g${++this.#n}`;
      this.#guid.get(this.a)!.set(x.id, g);
      this.#guid.get(this.b)!.set(y.id, g);
      (x.children ?? []).forEach((c, i) => walk(c, y.children![i]));
    };
    walk(ta, tb);
    for (const m of [this.a, this.b]) this.#watch(m);
  }

  #idOf(m: Machine, guid: string): string | undefined {
    for (const [id, g] of this.#guid.get(m)!) if (g === guid) return id;
    return undefined;
  }

  #watch(m: Machine) {
    const guids = this.#guid.get(m)!;
    const q: { guid: string; run: (to: Machine) => Promise<void> }[] = [];
    this.#queue.set(m, q);
    const live = () => !this.#muted.has(m);
    m.bm.onCreated.addListener((...args) => {
      if (!live()) return;
      const node = args[1] as BNode;
      const guid = `g${++this.#n}`;
      guids.set(node.id, guid);
      const parent = guids.get(node.parentId!)!;
      q.push({
        guid,
        run: async (to) => {
          const made = await to.bm.create({ parentId: this.#idOf(to, parent)!, title: node.title, url: node.url, index: node.index });
          this.#guid.get(to)!.set(made.id, guid);
        },
      });
    });
    m.bm.onChanged.addListener((...args) => {
      if (!live()) return;
      const [id, info] = args as [string, { title: string; url?: string }];
      const guid = guids.get(id)!;
      q.push({ guid, run: async (to) => void (await to.bm.update(this.#idOf(to, guid)!, info)) });
    });
    m.bm.onMoved.addListener((...args) => {
      if (!live()) return;
      const [id, info] = args as [string, { parentId: string; index: number }];
      const guid = guids.get(id)!;
      const parent = guids.get(info.parentId)!;
      q.push({
        guid,
        run: async (to) => {
          const tid = this.#idOf(to, guid)!;
          const pid = this.#idOf(to, parent)!;
          const [node] = await to.bm.get(tid);
          // Chrome reads the index before removal: moving down within a folder needs one more.
          const index = node.parentId === pid && info.index > node.index! ? info.index + 1 : info.index;
          await to.bm.move(tid, { parentId: pid, index });
        },
      });
    });
    m.bm.onRemoved.addListener((...args) => {
      if (!live()) return;
      const [id, info] = args as [string, { node: BNode }];
      const guid = guids.get(id)!;
      const drop = (n: BNode) => {
        guids.delete(n.id);
        (n.children ?? []).forEach(drop);
      };
      drop(info.node);
      q.push({
        guid,
        run: async (to) => {
          const tid = this.#idOf(to, guid);
          if (!tid) return; // both machines deleted it
          const [root] = await to.bm.getTree();
          const gone: string[] = [];
          const collect = (n: BNode, inside: boolean) => {
            if (inside || n.id === tid) gone.push(n.id);
            (n.children ?? []).forEach((c) => collect(c, inside || n.id === tid));
          };
          collect(root, false);
          await to.bm.removeTree(tid);
          for (const g of gone) this.#guid.get(to)!.delete(g);
        },
      });
    });
  }

  /** Delivers everything waiting, in both directions. */
  async deliver() {
    await tick();
    for (const [from, to] of [
      [this.a, this.b],
      [this.b, this.a],
    ] as const) {
      const q = this.#queue.get(from)!;
      const ops = q.splice(0);
      this.#muted.add(to); // what we apply to `to` must not bounce back
      for (const op of ops) await op.run(to).catch(() => {});
      await tick();
      this.#muted.delete(to);
    }
  }
}

let store: BookmarkStore;
let remote: ReturnType<typeof remoteApi>;
const site = () => store.getTree() as SyncNode;
const siteFind = (...path: string[]): SyncNode => {
  let cur: SyncNode = site();
  for (const t of path) {
    const next = cur.children?.find((c) => c.title === t);
    if (!next) throw new Error(`site: no "${t}" under "${cur.title}"`);
    cur = next;
  }
  return cur;
};

beforeEach(() => {
  store = new BookmarkStore(openDb(':memory:'));
  remote = remoteApi(store);
});

describe('one browser and the site', () => {
  let pc: Machine;
  beforeEach(async () => {
    pc = new Machine('Desktop', remote);
    await pc.run();
  });
  const inStep = async () => expect(remoteShape(site())).toEqual(localShape(await pc.tree()));

  it('copies the whole browser to an empty site on first link, without the Trash', async () => {
    await inStep();
    expect(titles(site())).toEqual(['Bookmarks', 'Other bookmarks']);
    expect(titles(siteFind('Bookmarks'))).toEqual(['Gmail', 'GitHub', 'Work', 'Dev']);
    expect(pc.state.pairs).toHaveLength(10);
  });

  it('does nothing when nothing changed', async () => {
    const rev = store.rev;
    let events = 0;
    for (const e of [pc.bm.onCreated, pc.bm.onChanged, pc.bm.onMoved, pc.bm.onRemoved]) e.addListener(() => events++);
    const r = await pc.run();
    expect(r.status).toBe('ok');
    expect(store.rev).toBe(rev);
    expect(events).toBe(0);
    expect(r.summary).toMatchObject({ matched: 0, waiting: 0, duplicates: 0, errors: [] });
  });

  it('carries browser edits to the site', async () => {
    const work = await pc.find('Bookmarks', 'Work');
    await pc.bm.create({ parentId: work.id, title: 'Jira', url: 'https://jira.example/', index: 1 });
    await pc.bm.update((await pc.find('Bookmarks', 'Gmail')).id, { title: 'Mail', url: 'https://mail.example/' });
    await pc.bm.move((await pc.find('Bookmarks', 'Dev', 'MDN')).id, { parentId: work.id, index: 0 });
    await pc.bm.removeTree((await pc.find('Bookmarks', 'Dev', 'Tools')).id);
    const r = await pc.run();
    expect(r.summary.toSite).toMatchObject({ added: 1, changed: 1, moved: 1, removed: 2 });
    await inStep();
    expect(titles(siteFind('Bookmarks', 'Work'))).toEqual(['MDN', 'Outlook', 'Jira', 'Teams']);
    expect((await pc.run()).summary.toSite).toEqual({ added: 0, changed: 0, moved: 0, removed: 0, reordered: 0 });
  });

  it('carries site edits to the browser, binning deletions rather than destroying them', async () => {
    const work = siteFind('Bookmarks', 'Work');
    store.create({ parentId: work.id, title: 'Jira', url: 'https://jira.example/', index: 0 });
    store.update(siteFind('Bookmarks', 'GitHub').id, { title: 'Hub' });
    store.move(siteFind('Bookmarks', 'Dev', 'MDN').id, { parentId: work.id });
    store.remove(siteFind('Bookmarks', 'Dev', 'Tools').id, true);
    const phone = store.create({ parentId: '1', title: 'From phone' });
    store.create({ parentId: phone.id, title: 'Recipe', url: 'https://recipe.example/' });

    const r = await pc.run();
    expect(r.summary.toBrowser).toMatchObject({ added: 3, changed: 1, moved: 1, removed: 2 });
    expect(r.summary.errors).toEqual([]);
    await inStep();
    expect(titles(await pc.find('Bookmarks', 'Work'))).toEqual(['Jira', 'Outlook', 'Teams', 'MDN']);
    expect(titles(await pc.find('Trash'))).toEqual(['Old thing', 'Tools']);
    const rev = store.rev;
    await pc.run();
    expect(store.rev).toBe(rev); // applying the site's changes didn't echo back as new ones
  });

  it('keeps folder order in step, whichever side rearranged it', async () => {
    const bar = await pc.find('Bookmarks');
    await pc.bm.move((await pc.find('Bookmarks', 'Dev')).id, { parentId: bar.id, index: 0 });
    await pc.run();
    expect(titles(siteFind('Bookmarks'))).toEqual(['Dev', 'Gmail', 'GitHub', 'Work']);

    store.move(siteFind('Bookmarks', 'Gmail').id, { parentId: '1' }); // to the end
    store.create({ parentId: '1', title: 'New', url: 'https://new.example/', index: 1 });
    await pc.run();
    expect(titles(await pc.find('Bookmarks'))).toEqual(['Dev', 'New', 'GitHub', 'Work', 'Gmail']);
    await inStep();
  });

  it('merges additions made on both sides at once', async () => {
    const bar = await pc.find('Bookmarks');
    await pc.bm.create({ parentId: bar.id, title: 'Local', url: 'https://local.example/', index: 1 });
    store.create({ parentId: '1', title: 'Remote', url: 'https://remote.example/', index: 3 });
    await pc.run();
    await inStep();
    expect(titles(siteFind('Bookmarks'))).toEqual(['Gmail', 'Local', 'GitHub', 'Work', 'Remote', 'Dev']);
  });

  it('lets the site win when both sides edit the same thing', async () => {
    await pc.bm.update((await pc.find('Bookmarks', 'Gmail')).id, { title: 'Browser name' });
    store.update(siteFind('Bookmarks', 'Gmail').id, { title: 'Site name' });
    await pc.run();
    expect(titles(await pc.find('Bookmarks'))[0]).toBe('Site name');
    expect(titles(siteFind('Bookmarks'))[0]).toBe('Site name');
  });

  it('treats the Trash as deleted, and a restore as new', async () => {
    const gmail = await pc.find('Bookmarks', 'Gmail');
    const trash = await pc.find('Trash');
    await pc.bm.move(gmail.id, { parentId: trash.id });
    await pc.run();
    expect(titles(siteFind('Bookmarks'))).toEqual(['GitHub', 'Work', 'Dev']);

    await pc.bm.move(gmail.id, { parentId: (await pc.find('Bookmarks')).id, index: 0 });
    await pc.run();
    expect(titles(siteFind('Bookmarks'))).toEqual(['Gmail', 'GitHub', 'Work', 'Dev']);
    await inStep();
  });

  it("finds Vivaldi's trash by its flag, whatever it is called", async () => {
    // What Vivaldi 8.2 really has: the trash is titled "Deleted", and a folder the user named "Trash" is just a folder.
    const spec: MockSpec = {
      title: '',
      children: [
        { title: 'Bookmarks', children: [{ title: 'Gmail', url: 'https://mail.google.com/' }, { title: 'Trash', children: [{ title: 'Bin day', url: 'https://bins.example/' }] }] },
        { title: 'Other bookmarks', children: [] },
        { title: 'Deleted', trash: true, children: [{ title: 'Old thing', url: 'https://example.org/' }] },
      ],
    };
    store = new BookmarkStore(openDb(':memory:'));
    const viv = new Machine('Vivaldi', remoteApi(store), spec);
    await viv.run();
    expect(titles(site())).toEqual(['Bookmarks', 'Other bookmarks']);
    expect(titles(siteFind('Bookmarks', 'Trash'))).toEqual(['Bin day']);

    // Deleting in Vivaldi moves the bookmark to the trash folder: the site drops it.
    const gmail = await viv.find('Bookmarks', 'Gmail');
    await viv.bm.move(gmail.id, { parentId: (await viv.find('Deleted')).id });
    expect((await viv.run()).summary.toSite.removed).toBe(1);
    expect(titles(siteFind('Bookmarks'))).toEqual(['Trash']);

    // And a deletion on the site lands in that same folder.
    store.remove(siteFind('Bookmarks', 'Trash', 'Bin day').id, false);
    await viv.run();
    expect(titles(await viv.find('Deleted'))).toEqual(['Old thing', 'Gmail', 'Bin day']);
    expect(titles(site())).toEqual(['Bookmarks', 'Other bookmarks']);
  });

  it('follows a bookmark into a folder created in the same breath', async () => {
    const bar = await pc.find('Bookmarks');
    const made = await pc.bm.create({ parentId: bar.id, title: 'Fresh' });
    await pc.bm.move((await pc.find('Bookmarks', 'Work', 'Teams')).id, { parentId: made.id });
    await pc.run();
    expect(titles(siteFind('Bookmarks', 'Fresh'))).toEqual(['Teams']);
    expect(titles(siteFind('Bookmarks', 'Work'))).toEqual(['Outlook']);
    await inStep();
  });

  it("keeps a folder deleted in the browser if the site added to it meanwhile", async () => {
    store.create({ parentId: siteFind('Bookmarks', 'Work').id, title: 'Added on phone', url: 'https://phone.example/' });
    await pc.bm.removeTree((await pc.find('Bookmarks', 'Work')).id);
    await pc.run();
    expect(titles(siteFind('Bookmarks', 'Work'))).toEqual(['Outlook', 'Teams', 'Added on phone']);
    expect(titles(await pc.find('Bookmarks', 'Work'))).toEqual(['Outlook', 'Teams', 'Added on phone']);
    await inStep();
  });

  it('stops and asks before deleting a lot, and changes nothing until told to', async () => {
    const bar = await pc.find('Bookmarks');
    for (let i = 0; i < 30; i++) await pc.bm.create({ parentId: bar.id, title: `n${i}`, url: `https://n${i}.example/` });
    await pc.run();
    const before = remoteShape(site());
    // The browser profile was wiped (or its own sync hasn't filled it yet).
    for (const c of (await pc.find('Bookmarks')).children!) await pc.bm.removeTree(c.id);

    const r = await pc.run();
    expect(r.status).toBe('confirm');
    expect(r.summary.toSite.removed).toBe(39);
    expect(remoteShape(site())).toEqual(before);

    expect((await pc.run({ force: true })).status).toBe('ok');
    expect(titles(siteFind('Bookmarks'))).toEqual([]);
  });

  it('backs off untouched when the site changes mid-run, then catches up', async () => {
    await pc.bm.create({ parentId: (await pc.find('Bookmarks')).id, title: 'Mine', url: 'https://mine.example/' });
    remote.beforeBatch = () => {
      remote.beforeBatch = undefined;
      store.create({ parentId: '1', title: 'Sneaked in', url: 'https://sneak.example/' });
    };
    const r = await pc.run();
    expect(r.status).toBe('stale');
    expect(titles(siteFind('Bookmarks'))).not.toContain('Mine');
    await pc.run();
    await inStep();
    expect(titles(siteFind('Bookmarks'))).toEqual(['Gmail', 'GitHub', 'Work', 'Dev', 'Mine', 'Sneaked in']);
  });

  it('leaves an exact duplicate alone instead of copying it', async () => {
    await pc.bm.create({ parentId: (await pc.find('Bookmarks')).id, title: 'Gmail', url: 'https://mail.google.com/' });
    const r = await pc.run();
    expect(r.summary.duplicates).toBe(1);
    expect(titles(siteFind('Bookmarks'))).toEqual(['Gmail', 'GitHub', 'Work', 'Dev']);
  });

  it('shows what a run would do without doing it', async () => {
    store.create({ parentId: '1', title: 'Remote', url: 'https://remote.example/' });
    const rev = store.rev;
    const r = await pc.run({ dryRun: true });
    expect(r.summary.toBrowser.added).toBe(1);
    expect(store.rev).toBe(rev);
    expect(titles(await pc.find('Bookmarks'))).not.toContain('Remote');
  });
});

describe('linking a browser to a site that already has bookmarks', () => {
  it('matches what is already the same and adds only the difference', async () => {
    const pc = new Machine('Desktop', remote);
    await pc.run();
    const rev = store.rev;

    const laptopSeed = structuredClone(SEED);
    laptopSeed.children![0].children!.push({ title: 'Laptop only', url: 'https://laptop.example/' });
    const laptop = new Machine('Laptop', remote, laptopSeed);
    const preview = await laptop.run({ dryRun: true });
    expect(preview.summary).toMatchObject({ matched: 10, toSite: { added: 1 }, toBrowser: { added: 0 } });
    expect(store.rev).toBe(rev);

    const r = await laptop.run();
    expect(r.summary.matched).toBe(10);
    expect(titles(siteFind('Bookmarks'))).toEqual(['Gmail', 'GitHub', 'Work', 'Dev', 'Laptop only']);
    await pc.run();
    expect(titles(await pc.find('Bookmarks'))).toEqual(['Gmail', 'GitHub', 'Work', 'Dev', 'Laptop only']);
  });

  it('keeps one copy of the settings: the browser’s on a first import, otherwise the newest', async () => {
    const withSettings = (theme: 'light' | 'dark', updatedAt: number): MockSpec => {
      const s = structuredClone(SEED);
      s.children![1].children!.push({
        title: SETTINGS_FOLDER_TITLE,
        children: [{ title: 'settings', url: encodeSettingsUrl({ ...DEFAULT_SETTINGS, theme, updatedAt }) }],
      });
      return s;
    };
    const themeOnSite = () => decodeURIComponent(siteFind('Other bookmarks', SETTINGS_FOLDER_TITLE, 'settings').url!).match(/"theme":"(\w+)"/)![1];

    // The site was poked at during set-up (newer), but this is the first browser to link: its settings are the real ones.
    const folder = store.create({ parentId: '2', title: SETTINGS_FOLDER_TITLE });
    store.create({ parentId: folder.id, title: 'settings', url: encodeSettingsUrl({ ...DEFAULT_SETTINGS, theme: 'light', updatedAt: 9_000 }) });
    const pc = new Machine('Desktop', remote, withSettings('dark', 5_000));
    await pc.run({ preferLocalSettings: true });
    expect(themeOnSite()).toBe('dark');
    expect(siteFind('Other bookmarks', SETTINGS_FOLDER_TITLE).children).toHaveLength(1);

    // A later browser with older settings takes the site's.
    const laptop = new Machine('Laptop', remote, withSettings('light', 1_000));
    await laptop.run();
    expect(themeOnSite()).toBe('dark');
    const local = await laptop.find('Other bookmarks', SETTINGS_FOLDER_TITLE);
    expect(local.children).toHaveLength(1);
    expect(local.children![0].url).toContain('dark');
  });
});

describe('two browsers that also share bookmarks through Vivaldi Sync', () => {
  let pc: Machine;
  let laptop: Machine;
  let vivaldi: VivaldiSync;
  beforeEach(async () => {
    // The desktop holds the job of adding site-made bookmarks; the laptop waits for Vivaldi.
    pc = new Machine('Desktop', remoteApi(store, 1), SEED, 1);
    laptop = new Machine('Laptop', remoteApi(store, 2), SEED, 2);
    vivaldi = new VivaldiSync(pc, laptop);
    await vivaldi.start();
    await pc.run();
    await laptop.run();
  });
  const settled = async () => {
    expect(localShape(await pc.tree())).toEqual(remoteShape(site()));
    expect(localShape(await laptop.tree())).toEqual(remoteShape(site()));
  };

  it('the stand-in for Vivaldi Sync really does carry changes across', async () => {
    await pc.bm.create({ parentId: (await pc.find('Bookmarks')).id, title: 'Shared', url: 'https://shared.example/', index: 1 });
    await pc.bm.move((await pc.find('Bookmarks', 'Dev')).id, { parentId: (await pc.find('Bookmarks')).id, index: 0 });
    await vivaldi.deliver();
    expect(localShape(await laptop.tree())).toEqual(localShape(await pc.tree()));
    expect((await laptop.find('Bookmarks', 'Shared')).id).not.toBe((await pc.find('Bookmarks', 'Shared')).id);
  });

  it('a bookmark added in one browser reaches the site once, whichever bridge runs when', async () => {
    await pc.bm.create({ parentId: (await pc.find('Bookmarks')).id, title: 'Added', url: 'https://added.example/' });
    await pc.run({ pull: 'site' });
    await vivaldi.deliver(); // the laptop gets it from Vivaldi…
    await laptop.run({ pull: 'none' }); // …and its bridge recognises it rather than adding it again
    await pc.run({ pull: 'site' });
    expect(titles(siteFind('Bookmarks')).filter((t) => t === 'Added')).toHaveLength(1);
    await settled();

    // And the other order: both bridges see the browser change before Vivaldi has caught up.
    // The desktop must not add it: the laptop made it, so Vivaldi is already bringing it over.
    await laptop.bm.create({ parentId: (await laptop.find('Bookmarks')).id, title: 'Second', url: 'https://second.example/' });
    await laptop.run({ pull: 'none' });
    expect((await pc.run({ pull: 'site' })).summary.waiting).toBe(1);
    await pc.run({ pull: 'site' });
    await vivaldi.deliver();
    await pc.run({ pull: 'site' });
    await laptop.run({ pull: 'none' });
    expect(titles(siteFind('Bookmarks')).filter((t) => t === 'Second')).toHaveLength(1);
    for (const m of [pc, laptop]) expect(titles(await m.find('Bookmarks')).filter((t) => t === 'Second')).toHaveLength(1);
    await settled();
  });

  it('a bookmark added on the site is put in one browser; the other waits for Vivaldi to bring it', async () => {
    const folder = store.create({ parentId: '1', title: 'From phone' });
    store.create({ parentId: folder.id, title: 'Recipe', url: 'https://recipe.example/' });

    const waiting = await laptop.run({ pull: 'none' });
    expect(waiting.summary.waiting).toBe(2);
    expect(titles(await laptop.find('Bookmarks'))).not.toContain('From phone');

    await pc.run();
    await vivaldi.deliver();
    const after = await laptop.run({ pull: 'none' });
    expect(after.summary).toMatchObject({ waiting: 0, matched: 2, duplicates: 0 });
    for (const m of [pc, laptop]) expect(titles(await m.find('Bookmarks')).filter((t) => t === 'From phone')).toHaveLength(1);
    await settled();
  });

  it('edits, moves and deletions from the site can be applied by both without harm', async () => {
    store.update(siteFind('Bookmarks', 'Gmail').id, { title: 'Mail' });
    store.move(siteFind('Bookmarks', 'Work', 'Teams').id, { parentId: siteFind('Bookmarks', 'Dev').id, index: 0 });
    store.remove(siteFind('Bookmarks', 'GitHub').id, false);
    await pc.run();
    await laptop.run({ pull: 'none' });
    await vivaldi.deliver();
    const rev = store.rev;
    await pc.run();
    await laptop.run({ pull: 'none' });
    expect(store.rev).toBe(rev);
    await settled();
    expect(titles(siteFind('Bookmarks'))).toEqual(['Mail', 'Work', 'Dev']);
    expect(titles(siteFind('Bookmarks', 'Dev'))).toEqual(['Teams', 'MDN', 'Tools']);
  });

  it('if both browsers do add the same new bookmark, the doubles stay put and never multiply', async () => {
    store.create({ parentId: '1', title: 'Doubled', url: 'https://doubled.example/' });
    await pc.run();
    await laptop.run(); // both allowed to add: the mistake the lease normally prevents
    await vivaldi.deliver();
    for (let round = 0; round < 4; round++) {
      await pc.run();
      await laptop.run();
      await vivaldi.deliver();
    }
    expect(titles(siteFind('Bookmarks')).filter((t) => t === 'Doubled')).toHaveLength(1);
    for (const m of [pc, laptop]) expect(titles(await m.find('Bookmarks')).filter((t) => t === 'Doubled')).toHaveLength(2);
    expect((await pc.run()).summary.duplicates).toBe(1);

    // Deleting the spare copy in one browser removes it from both and from nowhere else.
    const spare = (await pc.find('Bookmarks')).children!.filter((c) => c.title === 'Doubled')[0];
    await pc.bm.remove(spare.id);
    await pc.run();
    await vivaldi.deliver();
    await laptop.run();
    await pc.run();
    await vivaldi.deliver();
    expect(titles(siteFind('Bookmarks')).filter((t) => t === 'Doubled')).toHaveLength(1);
    for (const m of [pc, laptop]) expect(titles(await m.find('Bookmarks')).filter((t) => t === 'Doubled')).toHaveLength(1);
    await settled();
  });

  it('stays in step through a long run of mixed edits from every direction', async () => {
    let n = 0;
    const rand = (() => {
      let x = 12345;
      return (max: number) => ((x = (x * 1103515245 + 12345) & 0x7fffffff), x % max);
    })();
    for (let round = 0; round < 40; round++) {
      const who = rand(3);
      const kind = rand(4);
      if (who === 2) {
        const bar = siteFind('Bookmarks');
        const kids = bar.children!;
        if (kind === 0 || kids.length < 3) store.create({ parentId: bar.id, title: `s${++n}`, url: `https://s${n}.example/`, index: rand(kids.length + 1) });
        else if (kind === 1) store.update(kids[rand(kids.length)].id, { title: `renamed-s${++n}` });
        else if (kind === 2) store.move(kids[rand(kids.length)].id, { parentId: bar.id, index: rand(kids.length + 1) });
        else store.remove(kids[rand(kids.length)].id, true);
      } else {
        const m = who === 0 ? pc : laptop;
        const bar = await m.find('Bookmarks');
        const kids = bar.children!;
        if (kind === 0 || kids.length < 3) await m.bm.create({ parentId: bar.id, title: `b${++n}`, url: `https://b${n}.example/`, index: rand(kids.length + 1) });
        else if (kind === 1) await m.bm.update(kids[rand(kids.length)].id, { title: `renamed-b${++n}` });
        else if (kind === 2) await m.bm.move(kids[rand(kids.length)].id, { parentId: bar.id, index: rand(kids.length + 1) });
        else await m.bm.removeTree(kids[rand(kids.length)].id);
      }
      // The desktop holds the job of adding; the laptop waits on Vivaldi. Runs and deliveries interleave.
      if (rand(2)) await vivaldi.deliver();
      await pc.run({ pull: 'site', force: true });
      if (rand(2)) await vivaldi.deliver();
      await laptop.run({ pull: 'none', force: true });
    }
    for (let i = 0; i < 4; i++) {
      await vivaldi.deliver();
      await pc.run({ pull: 'site', force: true });
      await laptop.run({ pull: 'none', force: true });
    }
    await settled();
    const all = titles(siteFind('Bookmarks'));
    expect(new Set(all).size).toBe(all.length); // nothing doubled up along the way
  });
});

describe('mergeOrder', () => {
  it('slots the other side’s extras in after their neighbours', () => {
    expect(mergeOrder(['a', 'b', 'c'], ['a', 'x', 'b', 'c', 'y'])).toEqual(['a', 'x', 'b', 'c', 'y']);
    expect(mergeOrder(['c', 'a', 'b'], ['x', 'a', 'b', 'y', 'c'])).toEqual(['x', 'c', 'a', 'b', 'y']);
    expect(mergeOrder([], ['a', 'b'])).toEqual(['a', 'b']);
  });
});
