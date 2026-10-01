// Pure helpers over the chrome.bookmarks tree. No browser APIs in here so it
// stays unit-testable.

export type BNode = chrome.bookmarks.BookmarkTreeNode;

/** Folder FlexiHome keeps its synced settings in. Hidden from the UI. */
export const SETTINGS_FOLDER_TITLE = 'FlexiHome settings (do not edit)';

/** Vivaldi exposes its bookmark trash as an ordinary folder near the top of the tree. */
const TRASH_TITLES = new Set(['Trash']);

export interface FolderEntry {
  node: BNode;
  path: string[];
  depth: number;
}

export interface LinkEntry {
  node: BNode;
  /** Titles of the folders containing the link, relative to the search root. */
  path: string[];
}

export const isFolder = (n: BNode): boolean => n.url === undefined;

/** `depth` is the depth of `n` itself: the invisible root is 0, "Bookmarks"/"Other bookmarks" are 1. */
export function isHidden(n: BNode, depth: number): boolean {
  if (!isFolder(n)) return false;
  if (n.title === SETTINGS_FOLDER_TITLE) return true;
  return depth <= 2 && TRASH_TITLES.has(n.title);
}

export function visibleChildren(n: BNode, depth: number): BNode[] {
  return (n.children ?? []).filter((c) => !isHidden(c, depth + 1));
}

export function findById(root: BNode, id: string): BNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const hit = findById(c, id);
    if (hit) return hit;
  }
  return undefined;
}

/** Titles from the top-level folder down to `id` (the invisible root contributes nothing). */
export function pathTo(root: BNode, id: string): string[] | null {
  if (root.id === id) return [];
  for (const c of root.children ?? []) {
    const sub = pathTo(c, id);
    if (sub) return [c.title, ...sub];
  }
  return null;
}

export function depthOf(root: BNode, id: string): number {
  const p = pathTo(root, id);
  return p ? p.length : -1;
}

/** Follows folder titles from the root. Bookmark IDs differ per machine, titles survive sync. */
export function findByPath(root: BNode, path: string[]): BNode | undefined {
  let cur: BNode | undefined = root;
  for (const title of path) {
    cur = cur?.children?.find((c) => isFolder(c) && c.title === title);
    if (!cur) return undefined;
  }
  return cur;
}

/** The folder shown when the user hasn't picked one: the bookmark bar, or the first non-empty top-level folder. */
export function defaultHome(root: BNode): BNode {
  const top = visibleChildren(root, 0).filter(isFolder);
  return top.find((f) => (f.children?.length ?? 0) > 0) ?? top[0] ?? root;
}

export function resolveHome(root: BNode, path: string[] | null): { node: BNode; missing: boolean } {
  if (path === null) return { node: defaultHome(root), missing: false };
  const node = findByPath(root, path);
  return node && isFolder(node) ? { node, missing: false } : { node: defaultHome(root), missing: true };
}

export function listFolders(root: BNode): FolderEntry[] {
  const out: FolderEntry[] = [];
  const walk = (n: BNode, path: string[], depth: number) => {
    for (const c of visibleChildren(n, depth)) {
      if (!isFolder(c)) continue;
      const p = [...path, c.title];
      out.push({ node: c, path: p, depth: depth + 1 });
      walk(c, p, depth + 1);
    }
  };
  walk(root, [], 0);
  return out;
}

export function collectLinks(node: BNode, nodeDepth = 0): LinkEntry[] {
  const out: LinkEntry[] = [];
  const walk = (n: BNode, path: string[], depth: number) => {
    for (const c of visibleChildren(n, depth)) {
      if (isFolder(c)) walk(c, [...path, c.title], depth + 1);
      else out.push({ node: c, path });
    }
  };
  walk(node, [], nodeDepth);
  return out;
}

export function countLinks(node: BNode): number {
  let n = 0;
  for (const c of node.children ?? []) n += isFolder(c) ? countLinks(c) : 1;
  return n;
}

/** True when `id` is `folder` or anywhere beneath it — used to stop a folder being dropped into itself. */
export function containsNode(folder: BNode, id: string): boolean {
  return findById(folder, id) !== undefined;
}

export const pathKey = (path: string[]): string => JSON.stringify(path);

export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Ranks links against a query. Every whitespace-separated term must appear in
 * the title, host or folder path; titles that start with the query rank first.
 */
export function searchLinks(links: LinkEntry[], query: string, limit = 8): LinkEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const scored: { entry: LinkEntry; score: number }[] = [];
  for (const entry of links) {
    const title = entry.node.title.toLowerCase();
    const host = hostOf(entry.node.url).toLowerCase();
    const url = (entry.node.url ?? '').toLowerCase();
    const folders = entry.path.join(' ').toLowerCase();
    const haystack = `${title} ${host} ${folders} ${url}`;
    if (!terms.every((t) => haystack.includes(t))) continue;

    let score = 0;
    if (title === q) score += 100;
    if (title.startsWith(q)) score += 50;
    if (host.startsWith(q)) score += 40;
    for (const t of terms) {
      if (title.split(/[\s\-_.|:/]+/).some((w) => w.startsWith(t))) score += 15;
      else if (title.includes(t)) score += 8;
      else if (host.includes(t)) score += 6;
      else if (folders.includes(t)) score += 3;
      else score += 1;
    }
    score -= title.length / 100; // shorter, tighter titles win ties
    scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

/** Best-effort conversion of what someone typed into a URL. Returns null for things that look like searches. */
export function toUrl(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|vivaldi|chrome|data|mailto|file):/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s)) return `http://${s}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) && /\.[a-z]{2,}(:\d+)?(\/|$)/i.test(s)) return `https://${s}`;
  return null;
}
