// Dev-only stand-in for the extension APIs so the page runs under `npm run dev`
// in an ordinary tab. Persists to localStorage and mimics Chrome's quirks that
// matter to us (move-index semantics, folder vs link removal, events).

import type { BNode } from './tree';

const LS_KEY = 'flexihome:mock-tree';

type Listener = (...args: unknown[]) => void;

function makeEvent() {
  const listeners = new Set<Listener>();
  return {
    addListener: (l: Listener) => listeners.add(l),
    removeListener: (l: Listener) => listeners.delete(l),
    hasListener: (l: Listener) => listeners.has(l),
    fire: (...args: unknown[]) => queueMicrotask(() => listeners.forEach((l) => l(...args))),
  };
}

let nextId = 1000;

function seed(): BNode {
  const l = (title: string, url: string) => ({ title, url });
  const f = (title: string, children: object[]) => ({ title, children });
  const spec = {
    title: '',
    children: [
      f('Bookmarks', [
        l('Gmail', 'https://mail.google.com/'),
        l('Calendar', 'https://calendar.google.com/'),
        l('GitHub', 'https://github.com/'),
        l('YouTube', 'https://www.youtube.com/'),
        l('Reddit', 'https://www.reddit.com/'),
        l('Gemini', 'https://gemini.google.com/'),
        f('Work', [
          l('Outlook', 'https://outlook.office.com/mail/'),
          l('Teams', 'https://teams.microsoft.com/'),
          l('SharePoint', 'https://www.office.com/launch/sharepoint'),
          l('Azure DevOps', 'https://dev.azure.com/'),
          l('Azure Portal', 'https://portal.azure.com/'),
          f('Docs', [
            l('Microsoft Learn', 'https://learn.microsoft.com/'),
            l('Confluence', 'https://www.atlassian.com/software/confluence'),
          ]),
        ]),
        f('Dev', [
          l('MDN Web Docs', 'https://developer.mozilla.org/'),
          l('Stack Overflow', 'https://stackoverflow.com/'),
          l('Svelte', 'https://svelte.dev/docs'),
          l('Vite', 'https://vite.dev/'),
          l('Can I use', 'https://caniuse.com/'),
          l('npm', 'https://www.npmjs.com/'),
          l('Regex101', 'https://regex101.com/'),
          l('Chrome Extensions docs', 'https://developer.chrome.com/docs/extensions'),
          f('Tools', [
            l('JSON Crack', 'https://jsoncrack.com/'),
            l('Excalidraw', 'https://excalidraw.com/'),
            l('Squoosh', 'https://squoosh.app/'),
          ]),
        ]),
        f('News', [
          l('BBC News', 'https://www.bbc.co.uk/news'),
          l('The Verge', 'https://www.theverge.com/'),
          l('Hacker News', 'https://news.ycombinator.com/'),
          l('Ars Technica', 'https://arstechnica.com/'),
          l('The Guardian', 'https://www.theguardian.com/uk'),
        ]),
        f('Reading', [
          l('Vivaldi Blog', 'https://vivaldi.com/blog/'),
          l('CSS-Tricks', 'https://css-tricks.com/'),
          l('Smashing Magazine', 'https://www.smashingmagazine.com/'),
        ]),
        f('Home', [
          l('Amazon', 'https://www.amazon.co.uk/'),
          l('BBC Weather', 'https://www.bbc.co.uk/weather'),
          l('Netflix', 'https://www.netflix.com/'),
          l('Spotify', 'https://open.spotify.com/'),
          l('Google Maps', 'https://maps.google.com/'),
        ]),
      ]),
      f('Other bookmarks', [l('Example', 'https://example.com/'), f('Trash', [l('Old thing', 'https://example.org/')])]),
    ],
  };

  const build = (s: { title: string; url?: string; children?: object[] }, parentId: string | undefined, index: number, id?: string): BNode => {
    const nodeId = id ?? String(nextId++);
    const node: BNode = { id: nodeId, parentId, index, title: s.title, dateAdded: Date.now(), syncing: false } as BNode;
    if (s.url) node.url = s.url;
    if (s.children) {
      node.children = (s.children as typeof s[]).map((c, i) => build(c, nodeId, i, parentId === undefined ? String(i + 1) : undefined));
    }
    return node;
  };
  return build(spec, undefined, 0, '0');
}

export function installMockChrome() {
  let root: BNode;
  try {
    root = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') ?? seed();
  } catch {
    root = seed();
  }
  const ids = (n: BNode): number[] => [Number(n.id), ...(n.children ?? []).flatMap(ids)];
  nextId = Math.max(nextId, ...ids(root)) + 1;

  const save = () => localStorage.setItem(LS_KEY, JSON.stringify(root));
  const clone = <T,>(x: T): T => structuredClone(x);
  const find = (id: string, n: BNode = root): BNode | undefined =>
    n.id === id ? n : (n.children ?? []).map((c) => find(id, c)).find(Boolean);
  const reindex = (p: BNode) => p.children?.forEach((c, i) => (c.index = i));
  const must = (id: string) => {
    const n = find(id);
    if (!n) throw new Error(`Can't find bookmark for id ${id}.`);
    return n;
  };

  const ev = {
    onCreated: makeEvent(),
    onRemoved: makeEvent(),
    onChanged: makeEvent(),
    onMoved: makeEvent(),
    onChildrenReordered: makeEvent(),
    onImportBegan: makeEvent(),
    onImportEnded: makeEvent(),
  };

  const api = {
    ...ev,
    async getTree() {
      return [clone(root)];
    },
    async get(id: string) {
      const { children: _c, ...rest } = must(id);
      return [clone(rest as BNode)];
    },
    async getChildren(id: string) {
      return clone(must(id).children ?? []).map(({ children: _c, ...rest }) => rest as BNode);
    },
    async create(d: { parentId?: string; title?: string; url?: string; index?: number }) {
      const parent = must(d.parentId ?? '2');
      if (parent.url) throw new Error('Parameter "parentId" does not specify a folder.');
      const node = { id: String(nextId++), parentId: parent.id, title: d.title ?? '', dateAdded: Date.now() } as BNode;
      if (d.url !== undefined) node.url = d.url;
      else node.children = [];
      parent.children ??= [];
      const i = d.index === undefined ? parent.children.length : Math.min(d.index, parent.children.length);
      parent.children.splice(i, 0, node);
      reindex(parent);
      save();
      ev.onCreated.fire(node.id, clone(node));
      return clone(node);
    },
    async update(id: string, changes: { title?: string; url?: string }) {
      const n = must(id);
      if (changes.title !== undefined) n.title = changes.title;
      if (changes.url !== undefined) {
        if (n.url === undefined) throw new Error("Can't set URL of a bookmark folder.");
        n.url = changes.url;
      }
      save();
      ev.onChanged.fire(id, { title: n.title, url: n.url });
      return clone(n);
    },
    async move(id: string, dest: { parentId?: string; index?: number }) {
      const n = must(id);
      const oldParent = must(n.parentId!);
      const newParent = must(dest.parentId ?? n.parentId!);
      if (find(newParent.id, n)) throw new Error("Can't move a folder into itself or one of its descendants.");
      const oldIndex = oldParent.children!.indexOf(n);
      let index = dest.index ?? newParent.children!.length;
      // Chrome: the index is interpreted before removal, so moving down within a parent shifts by one.
      if (oldParent === newParent && index > oldIndex) index--;
      oldParent.children!.splice(oldIndex, 1);
      newParent.children!.splice(Math.min(index, newParent.children!.length), 0, n);
      n.parentId = newParent.id;
      reindex(oldParent);
      reindex(newParent);
      save();
      ev.onMoved.fire(id, { parentId: newParent.id, index: n.index, oldParentId: oldParent.id, oldIndex });
      return clone(n);
    },
    async remove(id: string) {
      const n = must(id);
      if (n.children?.length) throw new Error("Can't remove non-empty folder (use recursive to force).");
      return api.removeTree(id);
    },
    async removeTree(id: string) {
      const n = must(id);
      const parent = must(n.parentId!);
      parent.children!.splice(parent.children!.indexOf(n), 1);
      reindex(parent);
      save();
      ev.onRemoved.fire(id, { parentId: parent.id, index: n.index, node: clone(n) });
    },
  };

  const g = globalThis as unknown as { chrome?: Record<string, unknown> };
  g.chrome = {
    ...(g.chrome ?? {}),
    bookmarks: api,
    runtime: { id: undefined, getURL: (p: string) => p },
    tabs: { create: async ({ url }: { url: string }) => window.open(url, '_blank', 'noopener') },
  };

  // Handy while developing: `__flexihomeResetMock()` in the console restores the sample tree.
  (globalThis as Record<string, unknown>).__flexihomeResetMock = () => {
    localStorage.removeItem(LS_KEY);
    location.reload();
  };
}
