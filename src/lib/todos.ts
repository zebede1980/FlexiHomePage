// The to-do list, synced between machines through bookmarks like the settings
// are. Each item is its own bookmark (title = the text, URL = a data: payload
// with its state), so Vivaldi Sync merges items one by one: ticking an item on
// one machine and adding another elsewhere never overwrite each other.

import { TODO_FOLDER_TITLE, isFolder, otherBookmarksId, type BNode } from './tree';

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

const DATA_PREFIX = 'data:application/json,';

export function encodeTodoUrl(done: boolean): string {
  return DATA_PREFIX + encodeURIComponent(JSON.stringify({ done }));
}

/** Returns null for anything in the folder that isn't an item we wrote. */
export function decodeTodo(n: BNode): Todo | null {
  if (!n.url?.startsWith(DATA_PREFIX)) return null;
  let done = false;
  try {
    done = JSON.parse(decodeURIComponent(n.url.slice(DATA_PREFIX.length)))?.done === true;
  } catch {
    // Unreadable state: show it as still to do rather than lose it.
  }
  return { id: n.id, text: n.title, done };
}

/** Every to-do folder in the tree; more than one appears when two machines created one before syncing. */
export function findTodoFolders(root: BNode): BNode[] {
  const out: BNode[] = [];
  const walk = (n: BNode) => {
    for (const c of n.children ?? []) {
      if (!isFolder(c)) continue;
      if (c.title === TODO_FOLDER_TITLE) out.push(c);
      else walk(c);
    }
  };
  walk(root);
  return out;
}

/** All items in bookmark order, across duplicate folders until mergeTodoFolders() tidies them. */
export function listTodos(root: BNode): Todo[] {
  return findTodoFolders(root).flatMap((f) => (f.children ?? []).map(decodeTodo).filter((t) => t !== null));
}

/** The folder is only created when the first item is added, so a fresh machine adds nothing to sync. */
async function todoFolderId(): Promise<string> {
  const [root] = await chrome.bookmarks.getTree();
  const existing = findTodoFolders(root)[0];
  if (existing) return existing.id;
  return (await chrome.bookmarks.create({ parentId: otherBookmarksId(root), title: TODO_FOLDER_TITLE })).id;
}

export async function addTodo(text: string, done = false) {
  await chrome.bookmarks.create({ parentId: await todoFolderId(), title: text, url: encodeTodoUrl(done) });
}

export async function setTodoDone(id: string, done: boolean) {
  await chrome.bookmarks.update(id, { url: encodeTodoUrl(done) });
}

export async function removeTodo(id: string) {
  await chrome.bookmarks.remove(id);
}

/**
 * Folds duplicate folders into the first one. Unlike duplicate settings, both
 * copies can hold real items, so they're merged rather than the older dropped.
 */
export async function mergeTodoFolders(root: BNode) {
  const [keep, ...extras] = findTodoFolders(root);
  for (const folder of extras) {
    for (const c of folder.children ?? []) await chrome.bookmarks.move(c.id, { parentId: keep.id });
    // remove(), not removeTree(): if sync slipped another item in meanwhile, this fails and it's merged next time.
    await chrome.bookmarks.remove(folder.id).catch(() => {});
  }
}
