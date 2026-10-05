// @vitest-environment happy-dom
// The to-do list lives in the same mock bookmark tree that stands in for
// Vivaldi Sync in settings-store.test.ts.

import { beforeEach, describe, expect, it } from 'vitest';
import { installMockChrome } from './mock-chrome';
import { addTodo, decodeTodo, encodeTodoUrl, findTodoFolders, listTodos, mergeTodoFolders, removeTodo, setTodoDone } from './todos';
import { TODO_FOLDER_TITLE, collectLinks, visibleChildren, type BNode } from './tree';

const tree = async () => (await chrome.bookmarks.getTree())[0];

beforeEach(() => {
  localStorage.clear();
  installMockChrome();
});

describe('to-do list in bookmarks', () => {
  it('creates no folder until the first item is added', async () => {
    expect(findTodoFolders(await tree())).toHaveLength(0);
    await addTodo('Buy milk');
    const folders = findTodoFolders(await tree());
    expect(folders).toHaveLength(1);
    expect(folders[0].parentId).toBe('2');
  });

  it('adds, ticks off and removes items in order', async () => {
    await addTodo('one');
    await addTodo('two');
    const [one, two] = listTodos(await tree());
    expect([one.text, two.text]).toEqual(['one', 'two']);

    await setTodoDone(one.id, true);
    expect(listTodos(await tree()).map((t) => t.done)).toEqual([true, false]);

    await removeTodo(two.id);
    expect(listTodos(await tree()).map((t) => t.text)).toEqual(['one']);
  });

  it('keeps its folder out of cards and search', async () => {
    await addTodo('secret errand');
    const root = await tree();
    const other = root.children!.find((c) => c.id === '2')!;
    expect(visibleChildren(other, 1).map((c) => c.title)).not.toContain(TODO_FOLDER_TITLE);
    expect(collectLinks(root).map((l) => l.node.title)).not.toContain('secret errand');
  });

  it('merges folders two machines created before syncing', async () => {
    await addTodo('from A');
    const second = await chrome.bookmarks.create({ parentId: '2', title: TODO_FOLDER_TITLE });
    await chrome.bookmarks.create({ parentId: second.id, title: 'from B', url: encodeTodoUrl(true) });
    expect(listTodos(await tree()).map((t) => t.text)).toEqual(['from A', 'from B']);

    await mergeTodoFolders(await tree());
    const after = await tree();
    expect(findTodoFolders(after)).toHaveLength(1);
    expect(listTodos(after).map((t) => [t.text, t.done])).toEqual([
      ['from A', false],
      ['from B', true],
    ]);
  });

  it('ignores stray bookmarks and survives a mangled payload', () => {
    const node = (url: string) => ({ id: '9', title: 'x', url }) as BNode;
    expect(decodeTodo(node('https://example.com/'))).toBeNull();
    expect(decodeTodo(node('data:application/json,%7Bnope'))).toEqual({ id: '9', text: 'x', done: false });
  });
});
