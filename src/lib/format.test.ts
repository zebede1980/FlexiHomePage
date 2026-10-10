import { describe, expect, it } from 'vitest';
import { ago, bytes, duration, percent, uptimeShare } from './format';

describe('format', () => {
  it('writes byte sizes compactly', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(900)).toBe('900 B');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(5.3 * 2 ** 30)).toBe('5.3 GB');
    expect(bytes(193 * 2 ** 30)).toBe('193 GB');
    expect(bytes(13_279, true)).toBe('13 KB/s');
  });

  it('writes shares as percentages', () => {
    expect(percent(0)).toBe('0%');
    expect(percent(0.0002)).toBe('<0.1%');
    expect(percent(0.0628)).toBe('6.3%');
    expect(percent(0.07)).toBe('7%');
    expect(percent(0.364)).toBe('36%');
  });

  it('never rounds an outage up to 100%', () => {
    expect(uptimeShare(null)).toBe('–');
    expect(uptimeShare(1)).toBe('100%');
    expect(uptimeShare(0.9999)).toBe('99.9%');
    expect(uptimeShare(0.984)).toBe('98.4%');
    expect(uptimeShare(0.05)).toBe('5%');
  });

  it('gives durations in their two largest units', () => {
    expect(duration(20)).toBe('less than a minute');
    expect(duration(61)).toBe('1 minute');
    expect(duration(3 * 3600 + 120)).toBe('3 hours 2 minutes');
    expect(duration(533_247)).toBe('6 days 4 hours');
    expect(duration(86_400)).toBe('1 day');
  });

  it('describes past moments', () => {
    const now = 1_000_000_000;
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 50_000, now)).toBe('1 minute ago');
    expect(ago(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(ago(now - 26 * 3600_000, now)).toBe('1 day ago');
  });
});
