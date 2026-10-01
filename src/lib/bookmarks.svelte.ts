// Live view of the browser's bookmark tree plus the mutations the UI needs.
// The tree is re-read wholesale on any change: bookmark trees are small and
// this keeps us correct when Vivaldi Sync rewrites things behind our back.

import { settings } from './settings-store.svelte';
import { findById, type BNode } from './tree';

const RELOAD_DEBOUNCE_MS = 120;

class BookmarkStore {
  tree = $state.raw<BNode | null>(null);
  error = $state<string | null>(null);

  #timer: ReturnType<typeof setTimeout> | undefined;
  #listening = false;

  async load() {
    try {
      const [root] = await chrome.bookmarks.getTree();
      this.tree = root;
      this.error = null;
      await settings.pull(root);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  listen() {
    if (this.#listening) return;
    this.#listening = true;
    const schedule = () => {
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => void this.load(), RELOAD_DEBOUNCE_MS);
    };
    const b = chrome.bookmarks;
    b.onCreated.addListener(schedule);
    b.onRemoved.addListener(schedule);
    b.onChanged.addListener(schedule);
    b.onMoved.addListener(schedule);
    b.onChildrenReordered?.addListener(schedule);
    b.onImportEnded?.addListener(schedule);
    // A new tab left open for hours should still be current when you come back to it.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') schedule();
    });
  }

  get(id: string): BNode | undefined {
    return this.tree ? findById(this.tree, id) : undefined;
  }

  async createLink(parentId: string, title: string, url: string, index?: number) {
    await chrome.bookmarks.create({ parentId, title, url, index });
  }

  async createFolder(parentId: string, title: string, index?: number) {
    return chrome.bookmarks.create({ parentId, title, index });
  }

  async update(id: string, changes: { title?: string; url?: string }) {
    await chrome.bookmarks.update(id, changes);
  }

  /**
   * `index` uses Chrome's semantics: the position *before* the node is taken
   * out, so "insert before the item currently at i" is always just `i`.
   */
  async move(id: string, parentId: string, index?: number) {
    await chrome.bookmarks.move(id, index === undefined ? { parentId } : { parentId, index });
  }

  async remove(node: BNode) {
    if (node.url === undefined) await chrome.bookmarks.removeTree(node.id);
    else await chrome.bookmarks.remove(node.id);
  }
}

export const bookmarks = new BookmarkStore();
