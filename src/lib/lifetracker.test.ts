// @vitest-environment happy-dom
// The Life Tracker link, against a fake of its token API.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addTask, done, link, lt, normalizeUrl, refresh, takeBack, undoDone, unlink, type LtTask } from './lifetracker.svelte';

const task = (o: Partial<LtTask>): LtTask => ({
  id: 1, name: 'Haircut', emoji: '✂️', kind: 'interval', horizon: null, state: 'overdue', label: '9 days overdue',
  dueDate: '2026-11-01', snoozed: false, url: 'https://life.example/i/1', ...o,
});

let calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
let tasks: LtTask[] = [];
let status = 200;

beforeEach(() => {
  localStorage.clear();
  unlink();
  calls = [];
  tasks = [task({})];
  status = 200;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const auth = new Headers(init.headers).get('authorization');
    calls.push({ url, method: init.method ?? 'GET', auth, body: init.body ? JSON.parse(init.body as string) : undefined });
    if (status !== 200) return new Response(JSON.stringify({ ok: false }), { status });
    if (url.endsWith('/api/ext/todos')) {
      tasks = [...tasks, task({ id: 2, name: 'Fix the tap', kind: 'todo', horizon: 'short', state: 'ok' })];
      return Response.json({ ok: true, id: 2, tasks });
    }
    if (url.includes('/done')) {
      tasks = tasks.filter((t) => !url.includes(`/tasks/${t.id}/`));
      return Response.json({ ok: true, logId: 9, tasks });
    }
    return Response.json({ ok: true, tasks });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('normalizeUrl', () => {
  it('turns what people paste into an origin', () => {
    expect(normalizeUrl('life.example.com')).toBe('https://life.example.com');
    expect(normalizeUrl(' https://life.example.com/settings?x=1 ')).toBe('https://life.example.com');
    expect(normalizeUrl('http://localhost:3061/')).toBe('http://localhost:3061');
    expect(normalizeUrl('localhost:3061')).toBe('http://localhost:3061');
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('ftp://x')).toBeNull();
  });
});

describe('link', () => {
  it('checks the token before keeping it, and keeps it in this browser only', async () => {
    status = 401;
    await expect(link('life.example', 'lt_bad')).rejects.toThrow(/token/);
    expect(lt.link).toBeNull();
    expect(localStorage.getItem('flexihome:lifetracker')).toBeNull();
    status = 200;
    await link('life.example', ' lt_good ');
    expect(lt.link).toEqual({ url: 'https://life.example', token: 'lt_good' });
    expect(JSON.parse(localStorage.getItem('flexihome:lifetracker')!)).toEqual(lt.link);
    expect(calls.at(-1)).toMatchObject({ url: 'https://life.example/api/ext/tasks', auth: 'Bearer lt_good' });
    expect(lt.tasks.map((t) => t.name)).toEqual(['Haircut']);
    unlink();
    expect(localStorage.getItem('flexihome:lifetracker')).toBeNull();
  });

  it('adds, ticks off and undoes through the token API', async () => {
    await link('https://life.example', 'lt_good');
    const id = await addTask('Fix the tap', 'short');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: 'https://life.example/api/ext/todos', body: { name: 'Fix the tap', horizon: 'short' } });
    expect(lt.tasks).toHaveLength(2);
    await takeBack(id);
    expect(calls.at(-1)?.url).toBe('https://life.example/api/ext/todos/2/archive');
    const logId = await done(lt.tasks[0]);
    expect(calls.at(-1)?.url).toBe('https://life.example/api/ext/tasks/1/done');
    expect(lt.tasks.map((t) => t.id)).toEqual([2]);
    await undoDone(logId);
    expect(calls.at(-1)?.url).toBe('https://life.example/api/ext/logs/9/undo');
  });

  it('shows a problem on refresh rather than throwing', async () => {
    await link('https://life.example', 'lt_good');
    status = 401;
    await refresh();
    expect(lt.error).toMatch(/token/);
    expect(lt.tasks).toHaveLength(1);
  });
});
