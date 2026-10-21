import { describe, expect, it } from 'vitest';
import type { UpdateRun } from './monitor.svelte';
import { updateVerdict } from './updates';

const HOUR = 3_600_000;
const sunday = Date.parse('2026-10-18T04:03:00Z');
const run = (over: Partial<UpdateRun> = {}): UpdateRun => ({
  state: 'done',
  ok: true,
  started: sunday,
  finished: sunday + 2 * 60_000,
  upgraded: 11,
  failed: [],
  rebooted: false,
  next: Date.parse('2026-10-25T04:00:00Z'),
  ...over,
});

describe('update verdict', () => {
  it('is fine through the week after a clean run', () => {
    expect(updateVerdict(run(), sunday + 3 * 24 * HOUR)).toBe('ok');
    // Due again, with a little slack for the timer's jitter and a slow start.
    expect(updateVerdict(run(), Date.parse('2026-10-25T10:00:00Z'))).toBe('ok');
  });

  it('says a run failed', () => {
    expect(updateVerdict(run({ ok: false, failed: ['apt-get update'] }), sunday + HOUR)).toBe('failed');
  });

  it('notices the next run never came, even after a failure', () => {
    const late = Date.parse('2026-10-25T17:00:00Z');
    expect(updateVerdict(run(), late)).toBe('overdue');
    expect(updateVerdict(run({ ok: false }), late)).toBe('overdue');
  });

  it('falls back to the age of the run when it has no due time', () => {
    expect(updateVerdict(run({ next: null }), sunday + 7 * 24 * HOUR)).toBe('ok');
    expect(updateVerdict(run({ next: null }), sunday + 9 * 24 * HOUR)).toBe('overdue');
  });

  it('tells a run in progress from one that has hung', () => {
    const going = run({ state: 'running', finished: null, next: null });
    expect(updateVerdict(going, sunday + 10 * 60_000)).toBe('running');
    expect(updateVerdict(going, sunday + 4 * HOUR)).toBe('stuck');
  });
});
