// The probe reads the update job's status file; anything it can't make sense of means no tile, not a wrong one.

import { describe, expect, it } from 'vitest';
import { parseUpdateRun } from '../src/updates.js';

describe('update status file', () => {
  it('reads a finished run', () => {
    const text = JSON.stringify({
      state: 'done',
      ok: true,
      started: '2026-10-18T04:03:27Z',
      finished: '2026-10-18T04:05:33Z',
      upgraded: 11,
      failed: [],
      rebooted: false,
      next: '2026-10-25T04:00:00Z',
    });
    expect(parseUpdateRun(text)).toEqual({
      state: 'done',
      ok: true,
      started: Date.parse('2026-10-18T04:03:27Z'),
      finished: Date.parse('2026-10-18T04:05:33Z'),
      upgraded: 11,
      failed: [],
      rebooted: false,
      next: Date.parse('2026-10-25T04:00:00Z'),
    });
  });

  it('reads a run that is still going', () => {
    const run = parseUpdateRun('{"state":"running","started":"2026-10-18T04:03:27Z"}');
    expect(run).toMatchObject({ state: 'running', ok: false, finished: null, upgraded: null, failed: [], next: null });
  });

  it('never calls a run with failed steps a success', () => {
    const run = parseUpdateRun('{"state":"done","ok":true,"started":"2026-10-18T04:03:27Z","failed":["apt-get update"]}');
    expect(run?.ok).toBe(false);
    expect(run?.failed).toEqual(['apt-get update']);
  });

  it('ignores what it cannot use', () => {
    for (const text of ['', 'not json', '[]', 'null', '{"state":"done"}', '{"state":"odd","started":"2026-10-18T04:03:27Z"}', '{"state":"done","started":"yesterday"}']) {
      expect(parseUpdateRun(text), text).toBeNull();
    }
    const run = parseUpdateRun('{"state":"done","started":"2026-10-18T04:03:27Z","upgraded":-3,"failed":[1,"x"],"next":"soon"}');
    expect(run).toMatchObject({ upgraded: null, failed: ['x'], next: null });
  });
});
