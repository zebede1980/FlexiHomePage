// The hosted site's stand-in for chrome.bookmarks: the same calls, answered by
// the FlexiHome server. Everything written against the browser API (the
// bookmark store, settings sync, the to-do list) runs on it unchanged.

import { ApiError, api, session } from './backend.svelte';
import type { BNode } from './tree';

const LS_TREE = 'flexihome:tree';

type Listener = (...args: unknown[]) => void;

function makeEvent() {
  const listeners = new Set<Listener>();
  return {
    addListener: (l: Listener) => listeners.add(l),
    removeListener: (l: Listener) => listeners.delete(l),
    hasListener: (l: Listener) => listeners.has(l),
    fire: () => queueMicrotask(() => listeners.forEach((l) => l())),
  };
}

export function installServerChrome() {
  let cache: { rev: number; tree: BNode } | null = null;
  let stream: EventSource | null = null;

  const ev = {
    onCreated: makeEvent(),
    onRemoved: makeEvent(),
    onChanged: makeEvent(),
    onMoved: makeEvent(),
    onChildrenReordered: makeEvent(),
    onImportBegan: makeEvent(),
    onImportEnded: makeEvent(),
  };

  /** Another device (or a linked browser) changed something: the page re-reads the tree. */
  function listen() {
    if (stream) return;
    stream = new EventSource('/api/events');
    stream.addEventListener('rev', (e) => {
      session.offline = false;
      if (Number((e as MessageEvent).data) !== cache?.rev) ev.onChanged.fire();
    });
  }

  /** Runs a change, then tells the page straight away rather than waiting for the event stream. */
  async function change<T>(path: string, method: string, body?: unknown): Promise<T> {
    const out = await api<T>(path, { method, body: body ?? {} });
    ev.onChanged.fire();
    return out;
  }

  const bookmarks = {
    ...ev,
    async getTree(): Promise<BNode[]> {
      try {
        const fresh = await api<{ rev: number; tree: BNode } | undefined>(cache ? `/api/tree?rev=${cache.rev}` : '/api/tree');
        if (fresh) {
          cache = fresh;
          try {
            localStorage.setItem(LS_TREE, JSON.stringify(fresh));
          } catch {
            // Only an offline fallback; fine to go without.
          }
        }
        session.offline = false;
        listen();
      } catch (e) {
        // With the server out of reach, the last copy is better than an empty page.
        if (!(e instanceof ApiError) || e.status !== 0) throw e;
        cache ??= JSON.parse(localStorage.getItem(LS_TREE) ?? 'null');
        if (!cache) throw e;
        session.offline = true;
      }
      return [structuredClone(cache!.tree)];
    },
    create: (d: { parentId?: string; title?: string; url?: string; index?: number }) => change<BNode>('/api/bookmarks', 'POST', d),
    update: (id: string, changes: { title?: string; url?: string }) => change<BNode>(`/api/bookmarks/${id}`, 'PATCH', changes),
    move: (id: string, dest: { parentId?: string; index?: number }) => change<BNode>(`/api/bookmarks/${id}/move`, 'POST', dest),
    remove: (id: string) => change<void>(`/api/bookmarks/${id}`, 'DELETE'),
    removeTree: (id: string) => change<void>(`/api/bookmarks/${id}?recursive=1`, 'DELETE'),
  };

  const g = globalThis as unknown as { chrome?: Record<string, unknown> };
  g.chrome = {
    ...(g.chrome ?? {}),
    bookmarks,
    runtime: { id: undefined, getURL: (p: string) => p },
    tabs: { create: async ({ url }: { url: string }) => window.open(url, '_blank', 'noopener') },
  };
}
