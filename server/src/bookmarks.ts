// The bookmark tree the hosted page shows. Shaped and behaving like
// chrome.bookmarks (same node fields, same move-index quirk, same errors) so the
// page code that was written against the browser API runs on it unchanged, and
// the browser bridge can mirror one onto the other.

import { getMeta, setMeta, tx, type Db } from './db.js';

export interface TreeNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  dateAdded: number;
  /** Top-level folders only: which of the browser's fixed folders this mirrors. */
  role?: string;
  /**
   * The linked browser this came from (a bridge key's id); absent when it was
   * made on the site. A bridge uses it to tell bookmarks the browser's own sync
   * will deliver from ones it has to add itself.
   */
  origin?: number;
  children?: TreeNode[];
}

export type BatchOp =
  | { op: 'top'; ref?: string; role?: string; title: string }
  | { op: 'create'; ref?: string; parentId: string; title: string; url?: string; index?: number; dedupe?: boolean; dateAdded?: number }
  | { op: 'update'; id: string; title?: string; url?: string }
  | { op: 'move'; id: string; parentId: string; index?: number }
  | { op: 'remove'; id: string }
  | { op: 'order'; parentId: string; ids: string[] };

export class BookmarkError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

interface Row {
  id: number;
  parent_id: number | null;
  pos: number;
  title: string;
  url: string | null;
  role: string | null;
  date_added: number;
  origin: number | null;
}

const ROOT_ID = 0;
const MAX_TITLE = 2_000;
/** Settings travel as a data: URL, so this is well above any real link. */
const MAX_URL = 256_000;
const SNAPSHOTS_KEPT = 40;
const BATCH_MAX = 20_000;

const toId = (s: unknown): number => {
  if (typeof s === 'number' && Number.isInteger(s) && s >= 0) return s;
  if (typeof s === 'string' && /^\d{1,15}$/.test(s)) return Number(s);
  throw new BookmarkError(`Can't find bookmark for id ${String(s)}.`, 404);
};

export class BookmarkStore {
  #listeners = new Set<(rev: number) => void>();

  constructor(private db: Db) {
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as { c: number };
    if (c === 0) {
      tx(db, () => {
        const ins = db.prepare('INSERT INTO nodes (id, parent_id, pos, title, url, role, date_added) VALUES (?, ?, ?, ?, NULL, ?, ?)');
        const now = Date.now();
        ins.run(ROOT_ID, null, 0, '', 'root', now);
        // Ids 1 and 2 match the bookmark bar and "Other bookmarks" in every Chromium browser.
        ins.run(1, ROOT_ID, 0, 'Bookmarks', 'bar', now);
        ins.run(2, ROOT_ID, 1, 'Other bookmarks', 'other', now);
        // Leave the low ids for fixed folders; ordinary nodes start at 100.
        db.prepare("UPDATE sqlite_sequence SET seq = 99 WHERE name = 'nodes'").run();
        setMeta(db, 'rev', '1');
      });
    }
  }

  /** Goes up by at least one with every change; clients compare it to know whether to re-read. */
  get rev(): number {
    return Number(getMeta(this.db, 'rev') ?? 0);
  }

  onChange(fn: (rev: number) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  getTree(): TreeNode {
    const rows = this.db.prepare('SELECT * FROM nodes ORDER BY parent_id, pos').all() as unknown as Row[];
    const byId = new Map<number, TreeNode>();
    for (const r of rows) byId.set(r.id, this.#node(r));
    let root: TreeNode | undefined;
    for (const r of rows) {
      const n = byId.get(r.id)!;
      if (r.parent_id === null) root = n;
      else byId.get(r.parent_id)?.children?.push(n);
    }
    if (!root) throw new BookmarkError('The bookmark tree has no root.', 500);
    delete root.role;
    return root;
  }

  count(): { links: number; folders: number } {
    const r = this.db
      .prepare('SELECT SUM(url IS NOT NULL) AS links, SUM(url IS NULL AND role IS NULL) AS folders FROM nodes')
      .get() as { links: number | null; folders: number | null };
    return { links: r.links ?? 0, folders: r.folders ?? 0 };
  }

  create(d: { parentId?: string; title?: string; url?: string; index?: number }, origin?: number): TreeNode {
    return this.#mutate(() => this.#node(this.#create({ ...d, parentId: d.parentId ?? '2', origin })));
  }

  update(id: string, changes: { title?: string; url?: string }): TreeNode {
    return this.#mutate(() => this.#node(this.#update(id, changes)));
  }

  move(id: string, dest: { parentId?: string; index?: number }): TreeNode {
    return this.#mutate(() => this.#node(this.#move(id, dest)));
  }

  remove(id: string, recursive: boolean): void {
    this.#mutate(() => this.#remove(id, recursive));
  }

  /**
   * Applies a list of changes as one unit: all of them or none. `ref` on a
   * create names the new node so later ops in the same batch can point at it
   * as `ref:<name>`. With `baseRev`, the batch is refused if anything changed
   * since the caller read the tree, so a bridge never applies a stale diff.
   */
  batch(ops: BatchOp[], opts: { baseRev?: number; snapshot?: string; origin?: number } = {}): { rev: number; refs: Record<string, string> } {
    if (!Array.isArray(ops) || ops.length > BATCH_MAX) throw new BookmarkError('Too many changes in one batch.', 413);
    const refs: Record<string, string> = {};
    const resolve = (id: string): string => {
      if (typeof id === 'string' && id.startsWith('ref:')) {
        const hit = refs[id.slice(4)];
        if (!hit) throw new BookmarkError(`Unknown reference ${id}.`);
        return hit;
      }
      return id;
    };
    if (ops.length === 0) return { rev: this.rev, refs };
    return this.#mutate(() => {
      if (opts.baseRev !== undefined && opts.baseRev !== this.rev) {
        throw new BookmarkError('The bookmarks changed since they were read; read them again.', 409);
      }
      if (opts.snapshot) this.snapshot(opts.snapshot);
      ops.forEach((op, i) => {
        try {
          switch (op.op) {
            case 'top': {
              const row = this.#top(op.role, op.title);
              if (op.ref) refs[op.ref] = String(row.id);
              break;
            }
            case 'create': {
              const row = this.#create({ ...op, parentId: resolve(op.parentId), origin: opts.origin }, op.dedupe === true);
              if (op.ref) refs[op.ref] = String(row.id);
              break;
            }
            case 'update':
              this.#update(resolve(op.id), op);
              break;
            case 'move':
              this.#move(resolve(op.id), { parentId: resolve(op.parentId), index: op.index });
              break;
            case 'remove':
              this.#remove(resolve(op.id), true);
              break;
            case 'order':
              this.#order(resolve(op.parentId), op.ids.map(resolve));
              break;
            default:
              throw new BookmarkError('Unknown change type.');
          }
        } catch (e) {
          if (e instanceof BookmarkError) throw new BookmarkError(`Change ${i + 1} (${op.op}): ${e.message}`, e.status);
          throw e;
        }
      });
      return { rev: this.rev + 1, refs };
    });
  }

  // ---- snapshots ----------------------------------------------------------

  /** Keeps a copy of the whole tree, so a bad sync or a slip of the hand can be undone. */
  snapshot(reason: string): void {
    this.db
      .prepare('INSERT INTO snapshots (created_at, reason, rev, tree) VALUES (?, ?, ?, ?)')
      .run(Date.now(), reason, this.rev, JSON.stringify(this.getTree()));
    this.db.prepare('DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)').run(SNAPSHOTS_KEPT);
  }

  /** A snapshot unless one was already taken at this revision or within `minAgeMs`. */
  snapshotIfDue(reason: string, minAgeMs: number): void {
    const last = this.db.prepare('SELECT created_at, rev FROM snapshots ORDER BY id DESC LIMIT 1').get() as
      | { created_at: number; rev: number }
      | undefined;
    if (last && (last.rev === this.rev || Date.now() - last.created_at < minAgeMs)) return;
    this.snapshot(reason);
  }

  listSnapshots(): { id: number; createdAt: number; reason: string; rev: number }[] {
    return (
      this.db.prepare('SELECT id, created_at, reason, rev FROM snapshots ORDER BY id DESC').all() as unknown as {
        id: number;
        created_at: number;
        reason: string;
        rev: number;
      }[]
    ).map((r) => ({ id: r.id, createdAt: r.created_at, reason: r.reason, rev: r.rev }));
  }

  getSnapshot(id: number): TreeNode | null {
    const row = this.db.prepare('SELECT tree FROM snapshots WHERE id = ?').get(id) as { tree: string } | undefined;
    return row ? (JSON.parse(row.tree) as TreeNode) : null;
  }

  /**
   * Puts the tree back to how a snapshot had it. Node ids are kept, so a bridge
   * sees it as ordinary edits (things reappearing, moving back) rather than as
   * a different tree.
   */
  restoreSnapshot(id: number): void {
    const tree = this.getSnapshot(id);
    if (!tree) throw new BookmarkError('No such snapshot.', 404);
    this.#mutate(() => {
      this.snapshot('before restore');
      this.db.prepare('DELETE FROM nodes').run();
      const ins = this.db.prepare('INSERT INTO nodes (id, parent_id, pos, title, url, role, date_added, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const walk = (n: TreeNode, parent: number | null, pos: number) => {
        const nid = toId(n.id);
        ins.run(nid, parent, pos, n.title, n.url ?? null, parent === null ? 'root' : (n.role ?? null), n.dateAdded ?? Date.now(), n.origin ?? null);
        (n.children ?? []).forEach((c, i) => walk(c, nid, i));
      };
      walk(tree, null, 0);
    });
  }

  // ---- internals ----------------------------------------------------------

  #mutate<T>(fn: () => T): T {
    const out = tx(this.db, () => {
      const r = fn();
      setMeta(this.db, 'rev', String(this.rev + 1));
      return r;
    });
    const rev = this.rev;
    for (const l of this.#listeners) {
      try {
        l(rev);
      } catch {
        // One broken listener mustn't fail the write that already committed.
      }
    }
    return out;
  }

  #node(r: Row): TreeNode {
    const n: TreeNode = { id: String(r.id), title: r.title, dateAdded: r.date_added };
    if (r.parent_id !== null) {
      n.parentId = String(r.parent_id);
      n.index = r.pos;
    }
    if (r.url !== null) n.url = r.url;
    else n.children = [];
    if (r.role) n.role = r.role;
    if (r.origin !== null) n.origin = r.origin;
    return n;
  }

  #row(id: string): Row {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(toId(id)) as Row | undefined;
    if (!row) throw new BookmarkError(`Can't find bookmark for id ${id}.`, 404);
    return row;
  }

  #childIds(parentId: number): number[] {
    return (this.db.prepare('SELECT id FROM nodes WHERE parent_id = ? ORDER BY pos').all(parentId) as { id: number }[]).map((r) => r.id);
  }

  #writeOrder(parentId: number, ids: number[]) {
    const set = this.db.prepare('UPDATE nodes SET parent_id = ?, pos = ? WHERE id = ?');
    ids.forEach((id, i) => set.run(parentId, i, id));
  }

  #text(value: unknown, what: string, max: number): string {
    if (typeof value !== 'string') throw new BookmarkError(`The ${what} must be text.`);
    if (value.length > max) throw new BookmarkError(`The ${what} is too long.`);
    return value;
  }

  /** The fixed top-level folder for `role` (or, with no role, the one called `title`), created if missing. */
  #top(role: string | undefined, title: unknown): Row {
    const name = this.#text(title, 'title', MAX_TITLE);
    if (role !== undefined && !/^[a-z-]{1,24}$/.test(role)) throw new BookmarkError('Bad folder role.');
    if (role === 'root') throw new BookmarkError('Bad folder role.');
    const existing = (
      role
        ? this.db.prepare('SELECT * FROM nodes WHERE parent_id = ? AND role = ?').get(ROOT_ID, role)
        : this.db.prepare('SELECT * FROM nodes WHERE parent_id = ? AND role IS NULL AND url IS NULL AND title = ?').get(ROOT_ID, name)
    ) as Row | undefined;
    if (existing) {
      if (existing.title !== name) this.db.prepare('UPDATE nodes SET title = ? WHERE id = ?').run(name, existing.id);
      return { ...existing, title: name };
    }
    const pos = this.#childIds(ROOT_ID).length;
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO nodes (parent_id, pos, title, url, role, date_added) VALUES (?, ?, ?, NULL, ?, ?)')
      .run(ROOT_ID, pos, name, role ?? null, Date.now());
    return this.#row(String(lastInsertRowid));
  }

  #create(d: { parentId: string; title?: string; url?: string; index?: number; dateAdded?: number; origin?: number }, dedupe = false): Row {
    const parent = this.#row(d.parentId);
    if (parent.url !== null) throw new BookmarkError('Parameter "parentId" does not specify a folder.');
    if (parent.role === 'root') throw new BookmarkError("Can't modify the root bookmark folders.");
    const title = this.#text(d.title ?? '', 'title', MAX_TITLE);
    const url = d.url === undefined || d.url === null ? null : this.#text(d.url, 'address', MAX_URL);
    if (url === '') throw new BookmarkError('Invalid URL.');

    if (dedupe) {
      const twin = this.db
        .prepare('SELECT * FROM nodes WHERE parent_id = ? AND title = ? AND url IS ? ORDER BY pos LIMIT 1')
        .get(parent.id, title, url) as Row | undefined;
      if (twin) return twin;
    }

    const siblings = this.#childIds(parent.id);
    const index =
      d.index === undefined || d.index === null ? siblings.length : Math.max(0, Math.min(Math.trunc(Number(d.index)) || 0, siblings.length));
    const added = typeof d.dateAdded === 'number' && Number.isFinite(d.dateAdded) ? Math.trunc(d.dateAdded) : Date.now();
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO nodes (parent_id, pos, title, url, role, date_added, origin) VALUES (?, ?, ?, ?, NULL, ?, ?)')
      .run(parent.id, siblings.length, title, url, added, d.origin ?? null);
    const id = Number(lastInsertRowid);
    siblings.splice(index, 0, id);
    this.#writeOrder(parent.id, siblings);
    return this.#row(String(id));
  }

  #update(id: string, changes: { title?: string; url?: string }): Row {
    const row = this.#row(id);
    if (row.role) throw new BookmarkError("Can't modify the root bookmark folders.");
    if (changes.title !== undefined && changes.title !== null) {
      this.db.prepare('UPDATE nodes SET title = ? WHERE id = ?').run(this.#text(changes.title, 'title', MAX_TITLE), row.id);
    }
    if (changes.url !== undefined && changes.url !== null) {
      if (row.url === null) throw new BookmarkError("Can't set URL of a bookmark folder.");
      const url = this.#text(changes.url, 'address', MAX_URL);
      if (url === '') throw new BookmarkError('Invalid URL.');
      this.db.prepare('UPDATE nodes SET url = ? WHERE id = ?').run(url, row.id);
    }
    return this.#row(id);
  }

  #move(id: string, dest: { parentId?: string; index?: number }): Row {
    const row = this.#row(id);
    if (row.role) throw new BookmarkError("Can't modify the root bookmark folders.");
    const newParent = dest.parentId === undefined || dest.parentId === null ? this.#row(String(row.parent_id)) : this.#row(dest.parentId);
    if (newParent.url !== null) throw new BookmarkError('Parameter "parentId" does not specify a folder.');
    if (newParent.role === 'root') throw new BookmarkError("Can't modify the root bookmark folders.");
    for (let p: Row | undefined = newParent; p; p = p.parent_id === null ? undefined : this.#row(String(p.parent_id))) {
      if (p.id === row.id) throw new BookmarkError("Can't move a folder into itself or one of its descendants.");
    }

    const oldParentId = row.parent_id!;
    const oldSiblings = this.#childIds(oldParentId);
    const oldIndex = oldSiblings.indexOf(row.id);
    const same = oldParentId === newParent.id;
    const target = same ? oldSiblings : this.#childIds(newParent.id);
    let index = dest.index === undefined || dest.index === null ? target.length : Math.max(0, Math.trunc(Number(dest.index)) || 0);
    // Chrome reads the index before the node is taken out, so moving down within a folder lands one earlier.
    if (same && index > oldIndex) index--;
    oldSiblings.splice(oldIndex, 1);
    target.splice(Math.min(index, target.length), 0, row.id);
    if (!same) this.#writeOrder(oldParentId, oldSiblings);
    this.#writeOrder(newParent.id, target);
    return this.#row(id);
  }

  #remove(id: string, recursive: boolean) {
    const row = this.#row(id);
    if (row.role) throw new BookmarkError("Can't modify the root bookmark folders.");
    if (!recursive && row.url === null && this.#childIds(row.id).length > 0) {
      throw new BookmarkError("Can't remove non-empty folder (use recursive to force).");
    }
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(row.id);
    this.#writeOrder(row.parent_id!, this.#childIds(row.parent_id!));
  }

  /**
   * Rearranges the listed children of a folder into the given order. Children
   * that aren't listed stay in the slots they already occupy.
   */
  #order(parentId: string, ids: string[]) {
    const parent = this.#row(parentId);
    const current = this.#childIds(parent.id);
    const wanted = [...new Set(ids.map(toId))].filter((id) => current.includes(id));
    const listed = new Set(wanted);
    let next = 0;
    this.#writeOrder(
      parent.id,
      current.map((id) => (listed.has(id) ? wanted[next++] : id)),
    );
  }
}
