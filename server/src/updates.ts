// The outcome of the machine's last automatic update run. The probe can't ask
// apt or systemd itself, so the machine's own update job leaves a small JSON
// file behind (UPDATES_FILE, by default /var/lib/flexihome/updates.json) and
// the probe reads it. No file means no Updates tile. The format is in the
// README under "Update status".

export interface UpdateRun {
  /** "running" from the moment the job starts until it writes its outcome. */
  state: 'running' | 'done';
  /** Every step worked. */
  ok: boolean;
  started: number;
  finished: number | null;
  /** Packages upgraded or newly installed; null when the job didn't say. */
  upgraded: number | null;
  /** The steps that went wrong, in the job's own words. */
  failed: string[];
  /** The job restarted the machine to finish. */
  rebooted: boolean;
  /** When the job is next due, if it knows. */
  next: number | null;
}

const time = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(t) && t > 0 ? t : null;
};

/** The file's contents, checked; null if it isn't a run this can make sense of. */
export function parseUpdateRun(text: string): UpdateRun | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const started = time(o.started);
  if (started === null || (o.state !== 'running' && o.state !== 'done')) return null;
  const failed = Array.isArray(o.failed) ? o.failed.filter((f): f is string => typeof f === 'string').map((f) => f.slice(0, 120)).slice(0, 10) : [];
  const upgraded = typeof o.upgraded === 'number' && Number.isInteger(o.upgraded) && o.upgraded >= 0 ? o.upgraded : null;
  return {
    state: o.state,
    ok: o.ok === true && failed.length === 0,
    started,
    finished: o.state === 'done' ? time(o.finished) : null,
    upgraded,
    failed,
    rebooted: o.rebooted === true,
    next: time(o.next),
  };
}
