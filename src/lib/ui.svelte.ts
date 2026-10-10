// Small shared UI state: the item being dragged, toasts and the active dialog.

import type { BNode } from './tree';

export const DRAG_MIME = 'application/x-flexihome-id';

export interface DragItem {
  id: string;
  parentId: string;
  index: number;
  isFolder: boolean;
  /** Top-level cards reorder among themselves rather than nesting. */
  isCard: boolean;
}

/**
 * `item` is set synchronously in dragstart so drop handlers can read it.
 * `active` drives visuals (faded source, revealed drop zones) and flips one task
 * later: Chromium cancels a drag if layout shifts inside the dragstart handler,
 * which is exactly what revealing the empty pinned drop zone does.
 */
export const drag = $state<{ item: DragItem | null; active: boolean }>({ item: null, active: false });

let activateTimer: ReturnType<typeof setTimeout> | undefined;

export function startDrag(item: DragItem) {
  drag.item = item; // stored as a reactive proxy, so later identity checks must use the id
  clearTimeout(activateTimer);
  activateTimer = setTimeout(() => {
    if (drag.item?.id === item.id) drag.active = true;
  });
}

/** True while `id` is the thing being dragged (after the drag has properly started). */
export const isDragging = (id: string) => drag.active && drag.item?.id === id;

export type DropEdge = 'before' | 'after' | 'inside';

/** Where the drop indicator is drawn. Only one target is highlighted at a time. */
export const hint = $state<{ id: string | null; edge: DropEdge | null }>({ id: null, edge: null });

export function setHint(id: string, edge: DropEdge) {
  if (hint.id !== id || hint.edge !== edge) {
    hint.id = id;
    hint.edge = edge;
  }
}

export function clearHint(id?: string) {
  if (id === undefined || hint.id === id) {
    hint.id = null;
    hint.edge = null;
  }
}

export function endDrag() {
  clearTimeout(activateTimer);
  drag.item = null;
  drag.active = false;
  clearHint();
}

/**
 * Keeps one of the page's own drags from reaching listeners on `document`.
 * Browser extensions that add drag gestures to every web page (Super Drag and
 * Go, for one) listen there and ask for a "copy" drop; our drags only allow
 * "move", so the browser shows the no-entry cursor and never fires the drop.
 * Only the hosted site meets this: extensions can't inject into another
 * extension's pages. Put it on <body>, so it runs after the page's own handlers.
 */
export function keepDragPrivate(e: DragEvent) {
  if (drag.item) e.stopPropagation();
}

/** Which half (or middle third, for folders) of `el` the pointer is over. */
export function dropEdge(e: DragEvent, el: HTMLElement, axis: 'x' | 'y' = 'y', allowInside = false): DropEdge {
  const r = el.getBoundingClientRect();
  const pos = axis === 'y' ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
  if (allowInside && pos > 0.25 && pos < 0.75) return 'inside';
  return pos < 0.5 ? 'before' : 'after';
}

/** URL dragged in from outside the page (address bar, another tab), if any. */
export function externalUrl(e: DragEvent): { url: string; title: string } | null {
  const dt = e.dataTransfer;
  if (!dt || drag.item) return null;
  const list = dt.getData('text/uri-list') || dt.getData('text/plain');
  const url = list
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  if (!url || !/^https?:\/\//i.test(url)) return null;
  let title = url;
  try {
    title = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // keep url as title
  }
  return { url, title };
}

export function acceptsDrag(e: DragEvent): boolean {
  if (drag.item) return true;
  const types = e.dataTransfer?.types ?? [];
  return types.includes('text/uri-list');
}

// ---- toasts ---------------------------------------------------------------

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void | Promise<void> };
}

export const toasts = $state<{ list: Toast[] }>({ list: [] });
let toastSeq = 0;

export function toast(message: string, action?: Toast['action'], ms = 6000) {
  const id = ++toastSeq;
  toasts.list.push({ id, message, action });
  setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number) {
  const i = toasts.list.findIndex((t) => t.id === id);
  if (i >= 0) toasts.list.splice(i, 1);
}

// ---- dialogs --------------------------------------------------------------

export type Dialog =
  | { kind: 'link'; mode: 'create'; parentId: string }
  | { kind: 'link'; mode: 'edit'; node: BNode }
  | { kind: 'folder'; mode: 'create'; parentId: string }
  | { kind: 'folder'; mode: 'edit'; node: BNode }
  | { kind: 'confirm-delete'; node: BNode; linkCount: number };

export const dialog = $state<{ current: Dialog | null }>({ current: null });

export function openDialog(d: Dialog) {
  dialog.current = d;
}

export function closeDialog() {
  dialog.current = null;
}

export const panel = $state({ settingsOpen: false });
