// Settings state, cached in localStorage for an instant first paint and synced
// between machines through a bookmark. Vivaldi Sync carries bookmarks reliably
// but not extension storage, so a bookmark whose URL is a data: payload is the
// transport.

import {
  DEFAULT_SETTINGS,
  decodeSettingsUrl,
  encodeSettingsUrl,
  normalizeSettings,
  type Settings,
} from './settings';
import { SETTINGS_FOLDER_TITLE, isFolder, otherBookmarksId, type BNode } from './tree';

const LS_SETTINGS = 'flexihome:settings';
/** Tiny snapshot read by public/boot.js before any CSS loads, to avoid a theme flash. */
const LS_BOOT = 'flexihome:boot';
const SETTINGS_BOOKMARK_TITLE = 'settings';
const PUSH_DELAY_MS = 800;

export type SyncStatus = 'idle' | 'pending' | 'saving' | 'synced' | 'error';

function readLocal(): Settings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeLocal(s: Settings) {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
    localStorage.setItem(LS_BOOT, JSON.stringify({ theme: s.theme, style: s.style }));
  } catch {
    // Storage full or blocked: the bookmark copy still holds the settings.
  }
}

interface Found {
  folder: BNode;
  bookmark: BNode | undefined;
  settings: Settings | null;
}

/** Every FlexiHome settings folder in the tree; more than one appears when two machines created one before syncing. */
export function findSettingsFolders(root: BNode): Found[] {
  const out: Found[] = [];
  const walk = (n: BNode) => {
    for (const c of n.children ?? []) {
      if (!isFolder(c)) continue;
      if (c.title === SETTINGS_FOLDER_TITLE) {
        const bookmark = c.children?.find((b) => !isFolder(b) && b.title === SETTINGS_BOOKMARK_TITLE);
        out.push({ folder: c, bookmark, settings: decodeSettingsUrl(bookmark?.url) });
      } else {
        walk(c);
      }
    }
  };
  walk(root);
  return out;
}

export class SettingsStore {
  value = $state<Settings>(readLocal());
  status = $state<SyncStatus>('idle');
  lastSynced = $state<number | null>(null);
  error = $state<string | null>(null);

  #bookmarkId: string | null = null;
  #lastWrittenUrl = '';
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pulling = false;

  /** Apply a change from the UI. Saved locally now, pushed to the bookmark shortly after. */
  update(patch: Partial<Settings>) {
    this.value = { ...this.value, ...patch, updatedAt: Date.now() };
    writeLocal(this.value);
    this.status = 'pending';
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.push(), PUSH_DELAY_MS);
  }

  reset() {
    this.update({ ...DEFAULT_SETTINGS });
  }

  /** Reconcile with the synced bookmark. Called at start-up and whenever bookmarks change. */
  async pull(root: BNode) {
    if (this.#pulling || this.status === 'pending' || this.status === 'saving') return;
    this.#pulling = true;
    try {
      const found = findSettingsFolders(root);
      const newest = found
        .filter((f) => f.settings)
        .sort((a, b) => b.settings!.updatedAt - a.settings!.updatedAt)[0];

      // Duplicates come from two machines saving before sync caught up; keep the newest.
      if (newest) {
        for (const f of found) {
          if (f !== newest) await chrome.bookmarks.removeTree(f.folder.id).catch(() => {});
        }
      }

      if (!newest) {
        this.#bookmarkId = null;
        // Nothing synced yet. Only publish if the user has actually changed something,
        // otherwise a fresh machine would race its defaults against a real config.
        if (this.value.updatedAt > 0) await this.push();
        return;
      }

      this.#bookmarkId = newest.bookmark!.id;
      const remote = newest.settings!;
      if (remote.updatedAt > this.value.updatedAt) {
        this.value = remote;
        writeLocal(remote);
      } else if (remote.updatedAt < this.value.updatedAt) {
        await this.push();
        return;
      }
      this.#lastWrittenUrl = newest.bookmark!.url!;
      this.status = 'synced';
      this.lastSynced = Date.now();
      this.error = null;
    } finally {
      this.#pulling = false;
    }
  }

  async push() {
    clearTimeout(this.#timer);
    const url = encodeSettingsUrl($state.snapshot(this.value) as Settings);
    this.status = 'saving';
    try {
      if (this.#bookmarkId && url !== this.#lastWrittenUrl) {
        try {
          await chrome.bookmarks.update(this.#bookmarkId, { url });
        } catch {
          this.#bookmarkId = null; // deleted under us; recreate below
        }
      }
      if (!this.#bookmarkId) {
        const [root] = await chrome.bookmarks.getTree();
        const existing = findSettingsFolders(root)[0];
        const folder =
          existing?.folder ??
          (await chrome.bookmarks.create({ parentId: otherBookmarksId(root), title: SETTINGS_FOLDER_TITLE }));
        const bookmark = existing?.bookmark
          ? await chrome.bookmarks.update(existing.bookmark.id, { url })
          : await chrome.bookmarks.create({ parentId: folder.id, title: SETTINGS_BOOKMARK_TITLE, url });
        this.#bookmarkId = bookmark.id;
      }
      this.#lastWrittenUrl = url;
      this.status = 'synced';
      this.lastSynced = Date.now();
      this.error = null;
    } catch (e) {
      this.status = 'error';
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
}

export const settings = new SettingsStore();
