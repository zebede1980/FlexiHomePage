// Two-way sync between a browser's bookmarks and the FlexiHome server.
//
// It works from state, not from a log of events: each run reads both trees,
// compares each with what they looked like after the last run (the "base"),
// and carries every difference to the other side. A run that is interrupted,
// or that finds something already done, just leaves less for the next one.
//
// Nodes are tied together by a stored pair of ids (the browser's and the
// server's). Nodes that aren't paired yet are matched by content (same folder,
// same title and address), which is how a browser that already has the
// bookmarks links up without creating a second copy of everything.
//
// Nothing here touches chrome.* directly, so it runs under test against the
// in-memory bookmarks and a real server store.

import { decodeSettingsUrl } from '../lib/settings';
import { SETTINGS_FOLDER_TITLE } from '../lib/tree';

export interface SyncNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  children?: SyncNode[];
  /** Browser side: Chrome's name for its fixed folders ("bookmarks-bar", "other", "mobile", "managed"). */
  folderType?: string;
  /** Server side: which fixed folder a top-level folder mirrors. */
  role?: string;
  /** Server side: the linked browser this came from; absent when it was made on the site. */
  origin?: number;
}

export type RemoteOp =
  | { op: 'top'; ref: string; role?: string; title: string }
  | { op: 'create'; ref: string; parentId: string; title: string; url?: string }
  | { op: 'update'; id: string; title?: string; url?: string }
  | { op: 'move'; id: string; parentId: string }
  | { op: 'remove'; id: string }
  | { op: 'order'; parentId: string; ids: string[] };

export interface LocalApi {
  getTree(): Promise<SyncNode[]>;
  create(d: { parentId: string; title: string; url?: string }): Promise<{ id: string }>;
  update(id: string, changes: { title?: string; url?: string }): Promise<unknown>;
  move(id: string, dest: { parentId: string; index?: number }): Promise<unknown>;
  removeTree(id: string): Promise<unknown>;
}

export interface RemoteApi {
  getTree(): Promise<{ rev: number; tree: SyncNode }>;
  /** Rejects with StaleError when the server's bookmarks changed after `baseRev` was read. */
  batch(ops: RemoteOp[], baseRev: number, reason: string): Promise<{ rev: number; refs: Record<string, string> }>;
}

export class StaleError extends Error {}

/** One linked node: the two ids, and the parent, title and address both sides had after the last run. */
export interface Pair {
  l: string;
  s: string;
  p: string;
  t: string;
  u: string | null;
}

export interface SyncState {
  v: 1;
  pairs: Pair[];
  /** Per server folder id: the order its linked children were in after the last run. */
  order: Record<string, string[]>;
}

export const emptyState = (): SyncState => ({ v: 1, pairs: [], order: {} });

export interface SyncOptions {
  /**
   * Which bookmarks that are new on the site this browser is given. Browsers
   * that also share bookmarks through their own sync (Vivaldi Sync) must not
   * each add the same one, or that sync delivers both copies everywhere:
   *  - 'all'  : this browser shares with no other; take everything.
   *  - 'site' : this browser holds the job of adding. Take what was made on
   *             the site; what another linked browser made will arrive by
   *             the browser's own sync.
   *  - 'none' : another browser holds the job; wait for the browser's own sync.
   */
  pull: 'all' | 'site' | 'none';
  /** This bridge's id on the server, and every bridge currently linked (for 'site'). */
  self?: number;
  linked?: number[];
  /** Go ahead even when the run would delete a lot. */
  force?: boolean;
  /** Work out what would happen, change nothing. */
  dryRun?: boolean;
  /** First link of a browser to a site with no settings of its own worth keeping: the browser's settings win. */
  preferLocalSettings?: boolean;
  /** Shown beside server-side backups taken before this run's changes. */
  name?: string;
}

export interface SyncSummary {
  /** Nodes linked on both sides once the run finished. */
  linked: number;
  /** Newly matched by content this run. */
  matched: number;
  toSite: { added: number; changed: number; moved: number; removed: number; reordered: number };
  toBrowser: { added: number; changed: number; moved: number; removed: number; reordered: number };
  /** New on the site, waiting for the browser's own sync to deliver them here. */
  waiting: number;
  /** Exact duplicates within one folder, left alone and not synced. */
  duplicates: number;
  errors: string[];
}

export interface SyncResult {
  /** 'confirm' = nothing was changed because the run would delete a lot; run again with `force` to go ahead. */
  status: 'ok' | 'confirm' | 'stale';
  summary: SyncSummary;
  state: SyncState;
  rev: number;
}

const TRASH_TITLE = 'Trash';
const SETTINGS_BOOKMARK_TITLE = 'settings';
const CONFIRM_MIN = 10;
const CONFIRM_SHARE = 0.2;

const isFolder = (n: SyncNode) => n.url === undefined;

function roleOf(n: SyncNode): string | undefined {
  switch (n.folderType) {
    case 'bookmarks-bar':
      return 'bar';
    case 'other':
      return 'other';
    case 'mobile':
      return 'mobile';
  }
  // Browsers that don't say: these three ids are the same in every Chromium.
  return ({ '1': 'bar', '2': 'other', '3': 'mobile' } as Record<string, string>)[n.id];
}

/** Top-level folders the browser manages itself and that must not be mirrored. */
const isSkippedTop = (n: SyncNode) => !isFolder(n) || n.title === TRASH_TITLE || n.folderType === 'managed';

/**
 * What the browser side leaves out. Vivaldi's Trash is an ordinary folder near
 * the top of the tree; leaving it out means a bookmark moved there reads as
 * deleted, and one restored from it as new.
 */
const skipLocal = (n: SyncNode, depth: number) => (depth === 1 && isSkippedTop(n)) || (depth <= 2 && isFolder(n) && n.title === TRASH_TITLE);

function findTrash(root: SyncNode): string | undefined {
  for (const top of root.children ?? []) {
    if (isFolder(top) && top.title === TRASH_TITLE) return top.id;
    const inner = (top.children ?? []).find((c) => isFolder(c) && c.title === TRASH_TITLE);
    if (inner) return inner.id;
  }
  return undefined;
}

interface Index {
  byId: Map<string, SyncNode>;
  parent: Map<string, string>;
}

function index(root: SyncNode, skip: (n: SyncNode, depth: number) => boolean): Index {
  const byId = new Map<string, SyncNode>();
  const parent = new Map<string, string>();
  const walk = (n: SyncNode, depth: number) => {
    byId.set(n.id, n);
    for (const c of n.children ?? []) {
      if (skip(c, depth + 1)) continue;
      parent.set(c.id, n.id);
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return { byId, parent };
}

function subtreeIds(n: SyncNode, into: string[] = []): string[] {
  into.push(n.id);
  for (const c of n.children ?? []) subtreeIds(c, into);
  return into;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * `primary` with the items only `secondary` has slotted in after whichever of
 * their neighbours (in `secondary`) comes before them.
 */
export function mergeOrder(primary: string[], secondary: string[]): string[] {
  const out = [...primary];
  const have = new Set(out);
  secondary.forEach((x, i) => {
    if (have.has(x)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.indexOf(secondary[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, x);
    have.add(x);
  });
  return out;
}

export async function sync(local: LocalApi, remote: RemoteApi, prev: SyncState, opts: SyncOptions): Promise<SyncResult> {
  const [lroot] = await local.getTree();
  const { rev, tree: rroot } = await remote.getTree();

  const summary: SyncSummary = {
    linked: 0,
    matched: 0,
    toSite: { added: 0, changed: 0, moved: 0, removed: 0, reordered: 0 },
    toBrowser: { added: 0, changed: 0, moved: 0, removed: 0, reordered: 0 },
    waiting: 0,
    duplicates: 0,
    errors: [],
  };

  const L = index(lroot, skipLocal);
  const R = index(rroot, () => false);
  const trashId = findTrash(lroot);

  // Ids of nodes that don't exist yet: `ref:` will be created on the server, `new:` in the browser.
  let seq = 0;
  const l2s = new Map<string, string>();
  const s2l = new Map<string, string>();
  const base = new Map<string, Pair>(); // by server id
  const link = (l: string, s: string) => {
    l2s.set(l, s);
    s2l.set(s, l);
  };
  const unlink = (l: string, s: string) => {
    if (l2s.get(l) === s) l2s.delete(l);
    if (s2l.get(s) === l) s2l.delete(s);
    base.delete(s);
  };

  const tops: RemoteOp[] = [];
  const creates: RemoteOp[] = [];
  const updates: RemoteOp[] = [];
  const moves: RemoteOp[] = [];
  const removes: RemoteOp[] = [];
  const orders: RemoteOp[] = [];
  const localCreates: { ph: string; parent: string; title: string; url?: string; s: string }[] = [];
  const localUpdates: { id: string; changes: { title?: string; url?: string } }[] = [];
  const localMoves: { id: string; parent: string }[] = [];
  const localRemoves: string[] = [];
  const localOrders: { folder: string; ids: string[] }[] = [];

  // ---- the fixed top-level folders, matched by what they are rather than by stored ids ----
  link(lroot.id, rroot.id);
  const topPairs: [string, string][] = [];
  for (const lt of lroot.children ?? []) {
    if (isSkippedTop(lt)) continue;
    const role = roleOf(lt);
    const rt = (rroot.children ?? []).find((c) => (role ? c.role === role : !c.role && isFolder(c) && c.title === lt.title));
    if (rt && rt.title === lt.title) {
      link(lt.id, rt.id);
      topPairs.push([lt.id, rt.id]);
    } else {
      // Missing on the server, or named differently there: the browser's name is the real one.
      const ref = `ref:${++seq}`;
      tops.push({ op: 'top', ref: ref.slice(4), role, title: lt.title });
      if (rt) {
        link(lt.id, rt.id);
        topPairs.push([lt.id, rt.id]);
      } else {
        link(lt.id, ref);
      }
    }
  }

  // ---- stored pairs ----
  for (const p of prev.pairs) {
    const hasL = L.byId.has(p.l);
    const hasR = R.byId.has(p.s);
    if (!hasL && !hasR) continue;
    // A top-level folder that was once paired as an ordinary node is handled above.
    if (l2s.has(p.l) || s2l.has(p.s)) continue;
    link(p.l, p.s);
    base.set(p.s, { ...p });
  }

  const key = (n: SyncNode, parentTitle: string) =>
    !isFolder(n) && parentTitle === SETTINGS_FOLDER_TITLE && n.title === SETTINGS_BOOKMARK_TITLE
      ? 'settings' // one per folder whatever its payload, so two copies become one rather than both being kept
      : `${isFolder(n) ? 'F' : 'L'}\u0000${n.title}\u0000${n.url ?? ''}`;
  const lkey = (n: SyncNode) => key(n, L.byId.get(L.parent.get(n.id) ?? '')?.title ?? '');
  const rkey = (n: SyncNode) => key(n, R.byId.get(R.parent.get(n.id) ?? '')?.title ?? '');
  const lUnmapped = (folder: SyncNode) => (folder.children ?? []).filter((c) => L.byId.has(c.id) && !l2s.has(c.id));
  const rUnmapped = (folder: SyncNode) => (folder.children ?? []).filter((c) => !s2l.has(c.id));

  // ---- a paired node vanished, but an identical unpaired one sits where it was: it's the same bookmark ----
  // (The browser's own sync can swap one copy of a duplicate for the other.)
  for (const p of [...base.values()]) {
    const ln = L.byId.get(p.l);
    const rn = R.byId.get(p.s);
    if (!ln && rn) {
      const lparent = L.byId.get(s2l.get(R.parent.get(rn.id) ?? '') ?? '');
      const twin = lparent && lUnmapped(lparent).find((c) => lkey(c) === rkey(rn));
      if (twin) {
        unlink(p.l, p.s);
        link(twin.id, p.s);
        base.set(p.s, { ...p, l: twin.id });
      }
    } else if (ln && !rn) {
      const rparent = R.byId.get(l2s.get(L.parent.get(ln.id) ?? '') ?? '');
      const twin = rparent && rUnmapped(rparent).find((c) => rkey(c) === lkey(ln));
      if (twin) {
        unlink(p.l, p.s);
        link(p.l, twin.id);
        base.set(twin.id, { ...p, s: twin.id });
      }
    }
  }

  // ---- match unpaired nodes by content, folder by folder from the top ----
  const queue: [string, string][] = [...topPairs];
  for (const p of base.values()) {
    const ln = L.byId.get(p.l);
    if (ln && isFolder(ln) && R.byId.has(p.s)) queue.push([p.l, p.s]);
  }
  for (let i = 0; i < queue.length; i++) {
    const lf = L.byId.get(queue[i][0])!;
    const rf = R.byId.get(queue[i][1])!;
    const candidates = rUnmapped(rf);
    for (const c of lUnmapped(lf)) {
      const k = lkey(c);
      const at = candidates.findIndex((d) => rkey(d) === k);
      if (at < 0) continue;
      const [d] = candidates.splice(at, 1);
      link(c.id, d.id);
      let u = d.url ?? null;
      if (k === 'settings' && c.url !== d.url) {
        // Two copies of the settings: one has to win. Setting the base to the loser's
        // value makes the winner read as "changed", so it is carried across below.
        const lt = decodeSettingsUrl(c.url)?.updatedAt ?? 0;
        const rt = decodeSettingsUrl(d.url)?.updatedAt ?? 0;
        const localWins = opts.preferLocalSettings ? lt > 0 : lt > rt;
        u = (localWins ? d.url : c.url) ?? null;
      }
      base.set(d.id, { l: c.id, s: d.id, p: rf.id, t: d.title, u });
      summary.matched++;
      if (isFolder(c)) queue.push([c.id, d.id]);
    }
  }

  // ---- deletions ----
  const lGone = new Set<string>();
  const rGone = new Set<string>();
  const deletedLocally = (s: string) => base.has(s) && !L.byId.has(base.get(s)!.l) && R.byId.has(s);
  const deletedRemotely = (l: string) => {
    const s = l2s.get(l);
    return s !== undefined && base.has(s) && !R.byId.has(s) && L.byId.has(l);
  };

  for (const p of [...base.values()]) {
    if (deletedLocally(p.s)) {
      // Only the top of a deleted branch needs handling; the rest goes with it.
      let covered = false;
      for (let a = R.parent.get(p.s); a !== undefined; a = R.parent.get(a)) if (deletedLocally(a)) covered = true;
      if (covered) continue;
      const branch = subtreeIds(R.byId.get(p.s)!);
      if (branch.some((id) => !s2l.has(id))) {
        // Something was added inside it on the site meanwhile: keep the lot and put it back in the browser.
        for (const id of branch) if (deletedLocally(id)) unlink(base.get(id)!.l, id);
      } else {
        removes.push({ op: 'remove', id: p.s });
        summary.toSite.removed += branch.length;
        for (const id of branch) rGone.add(id);
      }
    } else if (deletedRemotely(p.l)) {
      let covered = false;
      for (let a = L.parent.get(p.l); a !== undefined; a = L.parent.get(a)) if (deletedRemotely(a)) covered = true;
      if (covered) continue;
      const branch = subtreeIds(L.byId.get(p.l)!);
      if (branch.some((id) => !l2s.has(id))) {
        for (const id of branch) if (deletedRemotely(id)) unlink(id, l2s.get(id)!);
      } else {
        localRemoves.push(p.l);
        summary.toBrowser.removed += branch.length;
        for (const id of branch) lGone.add(id);
      }
    }
  }
  for (const p of [...base.values()]) {
    if (rGone.has(p.s) || lGone.has(p.l) || (!L.byId.has(p.l) && !R.byId.has(p.s))) unlink(p.l, p.s);
  }

  // ---- additions ----
  const count = (n: SyncNode): number => 1 + (n.children ?? []).reduce((a, c) => a + count(c), 0);

  // New in the browser → the site.
  const pushNew = (lf: SyncNode) => {
    const taken = new Set((lf.children ?? []).filter((c) => l2s.has(c.id)).map(lkey));
    for (const c of lf.children ?? []) {
      if (!L.byId.has(c.id) || lGone.has(c.id)) continue;
      if (!l2s.has(c.id)) {
        const k = lkey(c);
        if (taken.has(k)) {
          summary.duplicates += count(c);
          continue;
        }
        taken.add(k);
        const ref = `ref:${++seq}`;
        creates.push({ op: 'create', ref: ref.slice(4), parentId: l2s.get(lf.id)!, title: c.title, url: c.url });
        link(c.id, ref);
        summary.toSite.added++;
      }
      if (isFolder(c)) pushNew(c);
    }
  };
  // New on the site → the browser.
  const pullNew = (rf: SyncNode) => {
    const taken = new Set((rf.children ?? []).filter((c) => s2l.has(c.id)).map(rkey));
    for (const d of rf.children ?? []) {
      if (rGone.has(d.id)) continue;
      if (!s2l.has(d.id)) {
        const k = rkey(d);
        if (taken.has(k)) {
          summary.duplicates += count(d);
          continue;
        }
        // Made by another linked browser: that browser's own sync is already bringing it here.
        const viaBrowserSync = d.origin !== undefined && d.origin !== opts.self && (opts.linked ?? []).includes(d.origin);
        if (opts.pull === 'none' || (opts.pull === 'site' && viaBrowserSync)) {
          summary.waiting += count(d);
          continue;
        }
        taken.add(k);
        const ph = `new:${++seq}`;
        localCreates.push({ ph, parent: s2l.get(rf.id)!, title: d.title, url: d.url, s: d.id });
        link(ph, d.id);
        summary.toBrowser.added++;
      }
      if (isFolder(d)) pullNew(d);
    }
  };
  for (const lt of lroot.children ?? []) if (l2s.has(lt.id) && !isSkippedTop(lt)) pushNew(lt);
  for (const rt of rroot.children ?? []) if (s2l.has(rt.id)) pullNew(rt);

  // ---- edits and moves of nodes both sides have ----
  for (const p of base.values()) {
    const ln = L.byId.get(p.l);
    const rn = R.byId.get(p.s);
    if (!ln || !rn) continue;

    const toSite: { title?: string; url?: string } = {};
    const toBrowser: { title?: string; url?: string } = {};
    // Whichever side changed since last time wins; if both did, the site does.
    if (ln.title !== rn.title) {
      if (ln.title !== p.t && rn.title === p.t) toSite.title = ln.title;
      else toBrowser.title = rn.title;
    }
    if (!isFolder(ln) && !isFolder(rn) && ln.url !== rn.url) {
      if (ln.url !== p.u && rn.url === p.u) toSite.url = ln.url;
      else toBrowser.url = rn.url;
    }
    if (Object.keys(toSite).length) {
      updates.push({ op: 'update', id: p.s, ...toSite });
      summary.toSite.changed++;
    }
    if (Object.keys(toBrowser).length) {
      localUpdates.push({ id: p.l, changes: toBrowser });
      summary.toBrowser.changed++;
    }

    const lp = l2s.get(L.parent.get(ln.id) ?? ''); // undefined: its folder here isn't synced (a duplicate, say)
    const rp = R.parent.get(rn.id)!;
    if (lp !== undefined && lp !== rp) {
      if (lp !== p.p && rp === p.p) {
        moves.push({ op: 'move', id: p.s, parentId: lp });
        summary.toSite.moved++;
      } else if (s2l.has(rp)) {
        localMoves.push({ id: p.l, parent: s2l.get(rp)! });
        summary.toBrowser.moved++;
      }
    }
  }

  // ---- order within each folder ----
  const movedAwayLocally = new Set(localMoves.map((m) => m.id));
  const movedAwayRemotely = new Set(moves.map((m) => (m as { id: string }).id));
  const folderPairs: [SyncNode, SyncNode][] = [];
  for (const [lid, sid] of l2s) {
    const lf = L.byId.get(lid);
    const rf = R.byId.get(sid);
    if (lf && rf && isFolder(lf) && isFolder(rf) && lid !== lroot.id && !lGone.has(lid) && !rGone.has(sid)) folderPairs.push([lf, rf]);
  }
  for (const [lf, rf] of folderPairs) {
    // Both sequences are written as server ids (or `ref:` for nodes the server is about to get).
    const lseq = (lf.children ?? []).filter((c) => l2s.has(c.id) && !lGone.has(c.id) && !movedAwayLocally.has(c.id)).map((c) => l2s.get(c.id)!);
    const rseq = (rf.children ?? []).filter((d) => s2l.has(d.id) && !rGone.has(d.id) && !movedAwayRemotely.has(d.id)).map((d) => d.id);
    const before = prev.order[rf.id] ?? [];
    const common = new Set(before.filter((x) => lseq.includes(x) && rseq.includes(x)));
    const only = (seq: string[]) => seq.filter((x) => common.has(x));
    const lChanged = !sameList(only(lseq), only(before));
    const rChanged = !sameList(only(rseq), only(before));
    const final = lChanged && !rChanged ? mergeOrder(lseq, rseq) : mergeOrder(rseq, lseq);

    // What each side will hold once the additions and moves above have landed at the end of the folder.
    const rAfter = [...rseq, ...final.filter((x) => !rseq.includes(x))];
    const lAfter = [...lseq, ...final.filter((x) => !lseq.includes(x))];
    if (!sameList(rAfter, final)) {
      orders.push({ op: 'order', parentId: rf.id, ids: final });
      if (!sameList(only(rseq), only(final))) summary.toSite.reordered++;
    }
    if (!sameList(lAfter, final)) {
      localOrders.push({ folder: lf.id, ids: final });
      if (!sameList(only(lseq), only(final))) summary.toBrowser.reordered++;
    }
  }
  // Folders that only exist on one side so far take the other side's order as they're created.
  for (const c of localCreates) {
    const rf = R.byId.get(c.s)!;
    if (isFolder(rf)) localOrders.push({ folder: c.ph, ids: (rf.children ?? []).filter((d) => s2l.has(d.id) && !rGone.has(d.id)).map((d) => d.id) });
  }

  summary.linked = base.size + summary.toSite.added + summary.toBrowser.added;
  const state = (): SyncState => settle(prev, lroot, L, R, l2s, base);

  // ---- look before leaping ----
  const removing = summary.toSite.removed + summary.toBrowser.removed;
  const lots = removing > Math.max(CONFIRM_MIN, Math.floor(prev.pairs.length * CONFIRM_SHARE));
  if (opts.dryRun || (lots && !opts.force)) {
    return { status: opts.dryRun ? 'ok' : 'confirm', summary, state: prev, rev };
  }

  // ---- the site first: if it has moved on since we read it, nothing has been touched yet ----
  const remoteOps = [...tops, ...creates, ...updates, ...moves, ...removes, ...orders];
  let newRev = rev;
  if (remoteOps.length) {
    let refs: Record<string, string>;
    try {
      ({ rev: newRev, refs } = await remote.batch(remoteOps, rev, `before a sync from ${opts.name ?? 'a browser'}`));
    } catch (e) {
      if (e instanceof StaleError) return { status: 'stale', summary, state: prev, rev };
      throw e;
    }
    for (const [l, s] of [...l2s]) {
      if (s.startsWith('ref:')) link(l, refs[s.slice(4)]);
    }
    for (const o of localOrders) o.ids = o.ids.map((x) => (x.startsWith('ref:') ? refs[x.slice(4)] : x));
  }

  // ---- then the browser ----
  const made = new Map<string, string>(); // placeholder → real local id
  const real = (id: string) => made.get(id) ?? id;
  const attempt = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      summary.errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  for (const c of localCreates) {
    await attempt(`adding “${c.title}”`, async () => {
      const parent = real(c.parent);
      if (parent.startsWith('new:')) throw new Error("its folder couldn't be created");
      const node = await local.create({ parentId: parent, title: c.title, url: c.url });
      made.set(c.ph, node.id);
      l2s.delete(c.ph);
      link(node.id, c.s);
    });
  }
  for (const u of localUpdates) await attempt('updating a bookmark', () => local.update(u.id, u.changes));
  for (const m of localMoves) await attempt('moving a bookmark', () => local.move(m.id, { parentId: real(m.parent) }));
  for (const id of localRemoves) {
    // Into the browser's Trash where it has one, so a deletion made on the site can still be undone here.
    await attempt('removing a bookmark', () => (trashId ? local.move(id, { parentId: trashId }) : local.removeTree(id)));
  }

  if (!remoteOps.length && !localCreates.length && !localUpdates.length && !localMoves.length && !localRemoves.length && !localOrders.length) {
    return { status: 'ok', summary, state: state(), rev: newRev };
  }

  // Order last, on the browser as it now is.
  if (localOrders.length) {
    const [now] = await local.getTree();
    const fresh = index(now, () => false);
    for (const o of localOrders) {
      const folder = fresh.byId.get(real(o.folder));
      if (!folder) continue;
      const want = o.ids.map((s) => s2l.get(s)).filter((l): l is string => l !== undefined && fresh.parent.get(l) === folder.id);
      await attempt('reordering a folder', () => arrange(local, folder, want));
    }
  }

  // ---- record what both sides actually look like now, not what we hoped ----
  const [lAfter] = await local.getTree();
  const { rev: finalRev, tree: rAfter } = await remote.getTree();
  const L2 = index(lAfter, skipLocal);
  const R2 = index(rAfter, () => false);
  return { status: 'ok', summary, state: settle(prev, lAfter, L2, R2, l2s, base), rev: finalRev };
}

/**
 * Puts the listed children of `folder` into the given relative order with as
 * few moves as it takes, leaving its other children in the slots they occupy.
 */
async function arrange(local: LocalApi, folder: SyncNode, want: string[]) {
  const current = (folder.children ?? []).map((c) => c.id);
  const listed = new Set(want);
  for (let k = 0; k < want.length; k++) {
    // The k-th slot held by a listed child. Found afresh each time, since a move shifts what lies between.
    const slot = current.map((id, i) => (listed.has(id) ? i : -1)).filter((i) => i >= 0)[k];
    if (current[slot] === want[k]) continue;
    const from = current.indexOf(want[k]);
    // Everything listed before `slot` is already right, so the node always comes from further along,
    // which is the direction where the browser's index means exactly "end up here".
    await local.move(want[k], { parentId: folder.id, index: slot });
    current.splice(from, 1);
    current.splice(slot, 0, want[k]);
  }
}

/**
 * The state to remember: for every linked node, the values the two sides agree
 * on now. Where they still differ (a change that failed, or one made while the
 * run was under way) the old base is kept, so the next run sees the same
 * difference and tries again rather than mistaking it for a new edit.
 */
function settle(prev: SyncState, lroot: SyncNode, L: Index, R: Index, l2s: Map<string, string>, base: Map<string, Pair>): SyncState {
  const pairs: Pair[] = [];
  const order: Record<string, string[]> = {};
  const topL = new Set((lroot.children ?? []).map((c) => c.id));
  for (const [l, s] of l2s) {
    if (l === lroot.id || topL.has(l) || s.startsWith('ref:') || l.startsWith('new:')) continue;
    const ln = L.byId.get(l);
    const rn = R.byId.get(s);
    const old = base.get(s);
    if (!ln || !rn) {
      // Vanished from one side mid-run: keep the link so the next run treats it as a deletion.
      if (old && (ln || rn)) pairs.push({ ...old, l, s });
      continue;
    }
    const lp = l2s.get(L.parent.get(l) ?? '');
    const rp = R.parent.get(s)!;
    pairs.push({
      l,
      s,
      p: lp === rp ? rp : (old?.p ?? rp),
      t: ln.title === rn.title ? rn.title : (old?.t ?? rn.title),
      u: (ln.url ?? null) === (rn.url ?? null) ? (rn.url ?? null) : old ? old.u : (rn.url ?? null),
    });
  }
  for (const [l, s] of l2s) {
    const lf = L.byId.get(l);
    const rf = R.byId.get(s);
    if (!lf || !rf || !isFolder(rf) || l === lroot.id) continue;
    const lseq = (lf.children ?? []).filter((c) => l2s.has(c.id) && L.byId.has(c.id)).map((c) => l2s.get(c.id)!);
    const have = new Set(lseq);
    const rseq = (rf.children ?? []).filter((d) => have.has(d.id)).map((d) => d.id);
    order[s] = sameList(lseq.filter((x) => rseq.includes(x)), rseq) ? rseq : (prev.order[s] ?? rseq);
  }
  return { v: 1, pairs, order };
}
