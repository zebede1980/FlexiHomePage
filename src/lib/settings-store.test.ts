// @vitest-environment happy-dom
// Simulates two machines sharing one synced bookmark tree: each "machine" is a
// fresh SettingsStore with its own (cleared) localStorage.

import { beforeEach, describe, expect, it } from 'vitest';
import { installMockChrome } from './mock-chrome';
import { SettingsStore, findSettingsFolders } from './settings-store.svelte';
import { SETTINGS_FOLDER_TITLE } from './tree';

const tree = async () => (await chrome.bookmarks.getTree())[0];

/** A new machine: same bookmarks (they sync), empty local cache. */
function machine() {
  localStorage.removeItem('flexihome:settings');
  localStorage.removeItem('flexihome:boot');
  return new SettingsStore();
}

beforeEach(() => {
  localStorage.clear();
  installMockChrome();
});

describe('settings sync via bookmarks', () => {
  it('does not create a settings folder until something is changed', async () => {
    const a = machine();
    await a.pull(await tree());
    expect(findSettingsFolders(await tree())).toHaveLength(0);
    expect(a.status).toBe('idle');
  });

  it('writes the folder under Other bookmarks on first change', async () => {
    const a = machine();
    a.update({ theme: 'dark' });
    await a.push();
    const found = findSettingsFolders(await tree());
    expect(found).toHaveLength(1);
    expect(found[0].folder.parentId).toBe('2');
    expect(found[0].settings?.theme).toBe('dark');
    expect(a.status).toBe('synced');
  });

  it('carries settings to a second machine', async () => {
    const a = machine();
    a.update({ accent: '#22c55e', rootPath: ['Bookmarks', 'Work'] });
    await a.push();

    const b = machine();
    expect(b.value.accent).not.toBe('#22c55e'); // nothing local yet
    await b.pull(await tree());
    expect(b.value.accent).toBe('#22c55e');
    expect(b.value.rootPath).toEqual(['Bookmarks', 'Work']);
    expect(JSON.parse(localStorage.getItem('flexihome:settings')!).accent).toBe('#22c55e');
  });

  it('newest change wins in both directions', async () => {
    const a = machine();
    a.update({ name: 'from A' });
    await a.push();

    const b = machine();
    await b.pull(await tree());
    expect(b.value.name).toBe('from A');
    await new Promise((r) => setTimeout(r, 5));
    b.update({ name: 'from B' });
    await b.push();

    await a.pull(await tree());
    expect(a.value.name).toBe('from B');
  });

  it('a stale local copy is not pushed over a newer synced one', async () => {
    const a = machine();
    a.update({ name: 'old' });
    await a.push();
    const stale = a.value.updatedAt;

    await new Promise((r) => setTimeout(r, 5));
    const b = machine();
    b.update({ name: 'new' });
    await b.push();

    expect(stale).toBeLessThan(b.value.updatedAt);
    await a.pull(await tree());
    expect(a.value.name).toBe('new');
    expect(findSettingsFolders(await tree())[0].settings?.name).toBe('new');
  });

  it('merges duplicate folders created before sync caught up, keeping the newest', async () => {
    const root = await tree();
    const older = await chrome.bookmarks.create({ parentId: '2', title: SETTINGS_FOLDER_TITLE });
    await chrome.bookmarks.create({
      parentId: older.id,
      title: 'settings',
      url: 'data:application/json,' + encodeURIComponent(JSON.stringify({ updatedAt: 100, name: 'older' })),
    });
    const newer = await chrome.bookmarks.create({ parentId: root.children![0].id, title: SETTINGS_FOLDER_TITLE });
    await chrome.bookmarks.create({
      parentId: newer.id,
      title: 'settings',
      url: 'data:application/json,' + encodeURIComponent(JSON.stringify({ updatedAt: 200, name: 'newer' })),
    });

    const c = machine();
    await c.pull(await tree());
    expect(c.value.name).toBe('newer');
    const left = findSettingsFolders(await tree());
    expect(left).toHaveLength(1);
    expect(left[0].folder.id).toBe(newer.id);
  });

  it('recreates the bookmark if someone deletes the folder', async () => {
    const a = machine();
    a.update({ name: 'x' });
    await a.push();
    await chrome.bookmarks.removeTree(findSettingsFolders(await tree())[0].folder.id);

    a.update({ name: 'y' });
    await a.push();
    const found = findSettingsFolders(await tree());
    expect(found).toHaveLength(1);
    expect(found[0].settings?.name).toBe('y');
  });
});
