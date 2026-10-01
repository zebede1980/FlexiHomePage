// User actions that combine the bookmark store with UI feedback.

import { bookmarks } from './bookmarks.svelte';
import { containsNode, countLinks, isFolder, type BNode } from './tree';
import { drag, endDrag, externalUrl, openDialog, toast } from './ui.svelte';

const inExtension = typeof location !== 'undefined' && location.protocol === 'chrome-extension:';

/** Drop whatever is being dragged (or a URL dragged in from outside) into `parentId` at `index`. */
export async function dropInto(e: DragEvent, parentId: string, index?: number) {
  const item = drag.item;
  const ext = item ? null : externalUrl(e);
  endDrag();
  try {
    if (item) {
      const unchanged = item.parentId === parentId && (index === item.index || index === item.index + 1);
      if (unchanged) return;
      const node = bookmarks.get(item.id);
      if (node && isFolder(node) && containsNode(node, parentId)) {
        toast("A folder can't go inside itself.");
        return;
      }
      await bookmarks.move(item.id, parentId, index);
    } else if (ext) {
      await bookmarks.createLink(parentId, ext.title, ext.url, index);
      toast(`Added ${ext.title}`);
    }
  } catch (err) {
    toast(`Couldn't move that: ${err instanceof Error ? err.message : err}`);
  }
}

/** Links delete straight away with an undo; folders with contents ask first. */
export async function requestDelete(node: BNode) {
  if (isFolder(node) && (node.children?.length ?? 0) > 0) {
    openDialog({ kind: 'confirm-delete', node, linkCount: countLinks(node) });
    return;
  }
  const { parentId, index, title, url } = node;
  try {
    await bookmarks.remove(node);
  } catch (err) {
    toast(`Couldn't delete: ${err instanceof Error ? err.message : err}`);
    return;
  }
  toast(`Deleted "${title || url}"`, {
    label: 'Undo',
    run: async () => {
      if (url === undefined) await bookmarks.createFolder(parentId!, title, index);
      else await bookmarks.createLink(parentId!, title, url, index);
    },
  }, 10_000);
}

/** Pages can't link to browser-internal URLs, so those go through the tabs API. */
export function isInternalUrl(url: string): boolean {
  return !/^(https?|ftp|file|data|mailto):/i.test(url);
}

export function navigate(url: string, newTab: boolean) {
  if (inExtension && isInternalUrl(url)) {
    if (newTab) void chrome.tabs.create({ url });
    else void chrome.tabs.update({ url });
    return;
  }
  if (newTab) window.open(url, '_blank', 'noopener');
  else location.href = url;
}
