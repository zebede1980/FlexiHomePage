// What the Server tab's Updates tile says about the last automatic update run:
// a word or two, and whether it needs looking at.

import type { UpdateRun } from './monitor.svelte';

export type UpdateVerdict = 'ok' | 'running' | 'failed' | 'stuck' | 'overdue';

const HOUR = 3_600_000;
/** A run still going after this long has probably hung. */
export const STUCK_AFTER = 3 * HOUR;
/** Grace past the due time before a run counts as missed (the machine may have been restarting, or the timer jittered). */
export const GRACE = 12 * HOUR;
/** With no due time given, a weekly job that hasn't run for this long has been missed. */
export const OVERDUE_AFTER = 8 * 24 * HOUR;

export function updateVerdict(u: UpdateRun, now: number): UpdateVerdict {
  if (u.state === 'running') return now - u.started > STUCK_AFTER ? 'stuck' : 'running';
  const missed = u.next !== null ? now > u.next + GRACE : now - (u.finished ?? u.started) > OVERDUE_AFTER;
  if (missed) return 'overdue';
  return u.ok ? 'ok' : 'failed';
}

export const VERDICTS: Record<UpdateVerdict, { label: string; problem: boolean }> = {
  ok: { label: 'All good', problem: false },
  running: { label: 'Running now', problem: false },
  failed: { label: 'Failed', problem: true },
  stuck: { label: 'Stuck?', problem: true },
  overdue: { label: 'Overdue', problem: true },
};
