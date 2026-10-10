// What the bridge's background worker and its page both need to know.

import type { SyncState, SyncSummary } from './sync';

export interface Link {
  /** The site's origin, e.g. https://home.example.com */
  url: string;
  token: string;
  /** This bridge's id on the server. */
  id: number;
  name: string;
  /** False until the first sync has been looked over and approved. */
  ready: boolean;
  /** The site had no bookmarks of its own when this browser linked, so this browser's settings are the real ones. */
  firstImport: boolean;
}

export interface Prefs {
  /** Open the hosted site on new tabs instead of the page built into the extension. */
  newTabSite: boolean;
  /** This browser shares bookmarks with no other linked browser (no Vivaldi Sync between them). */
  solo: boolean;
}

export const DEFAULT_PREFS: Prefs = { newTabSite: true, solo: false };

export type Phase = 'idle' | 'syncing' | 'confirm' | 'error';

export interface Status {
  phase: Phase;
  /** When the last run finished. */
  at: number;
  /** When the site last answered at all. */
  seenAt: number;
  message: string;
  summary: SyncSummary | null;
  /** This browser holds the job of adding site-made bookmarks. */
  primary: boolean;
  /** Name of the browser that does, when it isn't this one. */
  holder: string;
}

export const DEFAULT_STATUS: Status = { phase: 'idle', at: 0, seenAt: 0, message: '', summary: null, primary: false, holder: '' };

export interface Stored {
  link?: Link;
  prefs?: Prefs;
  status?: Status;
  state?: SyncState;
  /** Bookmarks changed in this browser since the last run. */
  dirty?: boolean;
  /** Last server revision this browser is in step with. */
  rev?: number;
  /** Read by the new-tab page: where to go instead, and whether it's worth going. */
  redirect?: { url: string; up: boolean } | null;
}

export type Request =
  | { type: 'link'; url: string; password: string; name: string }
  | { type: 'preview' }
  | { type: 'sync'; force?: boolean }
  | { type: 'approve' }
  | { type: 'unlink' }
  | { type: 'prefs'; prefs: Prefs };

export type Reply = { ok: true; summary?: SyncSummary; site?: { links: number; folders: number } } | { ok: false; error: string };

export const send = (req: Request): Promise<Reply> => chrome.runtime.sendMessage(req);
