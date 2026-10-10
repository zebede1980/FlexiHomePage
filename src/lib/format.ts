// Number and time wording shared by the Server tab. Pure, so it stays unit-testable.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536 → "1.5 KB". Whole numbers below 10 keep one decimal so small values don't all read the same. */
export function bytes(n: number, perSecond = false): string {
  let v = Math.max(0, n);
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  const text = u === 0 ? String(Math.round(v)) : v < 10 ? v.toFixed(1) : String(Math.round(v));
  return `${text} ${UNITS[u]}${perSecond ? '/s' : ''}`;
}

/** 0.0731 → "7%". Under 10% keeps a decimal, since that is where most readings sit. */
export function percent(share: number): string {
  const p = share * 100;
  if (p > 0 && p < 0.05) return '<0.1%';
  return `${p < 10 ? p.toFixed(1).replace(/\.0$/, '') : Math.round(p)}%`;
}

/** Uptime share: never rounds a real outage up to "100%". */
export function uptimeShare(share: number | null): string {
  if (share === null) return '–';
  if (share >= 1) return '100%';
  const p = share * 100;
  return `${p >= 99.95 ? '99.9' : p >= 10 ? p.toFixed(1) : p.toFixed(0)}%`;
}

/** 533247 s → "6 days 4 hours". The two largest units, which is as exact as anyone reads. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const parts: [number, string][] = [
    [Math.floor(s / 86_400), 'day'],
    [Math.floor((s % 86_400) / 3600), 'hour'],
    [Math.floor((s % 3600) / 60), 'minute'],
  ];
  const shown = parts.filter(([n]) => n > 0).slice(0, 2);
  if (!shown.length) return 'less than a minute';
  return shown.map(([n, unit]) => `${n} ${unit}${n === 1 ? '' : 's'}`).join(' ');
}

/** A past moment relative to now: "just now", "5 minutes ago", "3 days ago". */
export function ago(then: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 45) return 'just now';
  const steps: [number, string][] = [
    [86_400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, unit] of steps) {
    if (s >= size) {
      const n = Math.floor(s / size);
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  return '1 minute ago';
}

/** Clock time for chart tooltips; adds the day once the range goes past today. */
export function clockTime(ts: number, withDay: boolean): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return withDay ? `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}` : time;
}
