import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, decodeSettingsUrl, encodeSettingsUrl, normalizeSettings, searchUrl } from './settings';

describe('normalizeSettings', () => {
  it('returns defaults for junk', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and drops invalid ones field by field', () => {
    const s = normalizeSettings({
      theme: 'dark',
      accent: 'red', // not a hex colour
      cardWidth: 9999, // clamped
      rootPath: ['Bookmarks', 'Home'],
      collapsed: ['ok', 3], // not all strings
      cardLayout: [['a'], 'b'], // not all columns are arrays
      searchEngine: 'https://x.test/?q=', // missing %s
      unknownFutureField: true,
    });
    expect(s.theme).toBe('dark');
    expect(s.accent).toBe(DEFAULT_SETTINGS.accent);
    expect(s.cardWidth).toBe(440);
    expect(s.rootPath).toEqual(['Bookmarks', 'Home']);
    expect(s.collapsed).toEqual([]);
    expect(s.cardLayout).toEqual([]);
    expect(s.searchEngine).toBe(DEFAULT_SETTINGS.searchEngine);
    expect(s).not.toHaveProperty('unknownFutureField');
  });

  it('accepts known styles only, so an older build never sees a style it lacks', () => {
    expect(normalizeSettings({ style: 'constellation' }).style).toBe('constellation');
    expect(normalizeSettings({ style: 'vaporwave' }).style).toBe(DEFAULT_SETTINGS.style);
    expect(normalizeSettings({ effects: false, previews: 'yes' })).toMatchObject({ effects: false, previews: true });
  });

  it('distinguishes an explicit null root (automatic) from a missing one', () => {
    expect(normalizeSettings({ rootPath: null }).rootPath).toBeNull();
    expect(normalizeSettings({ rootPath: 'x' }).rootPath).toBe(DEFAULT_SETTINGS.rootPath);
  });
});

describe('settings bookmark URL', () => {
  it('round-trips, including awkward characters', () => {
    const s = { ...DEFAULT_SETTINGS, updatedAt: 42, name: 'Jo “quotes” & 100% #hash ✨', rootPath: ['A/B', 'C?d'] };
    const url = encodeSettingsUrl(s);
    expect(url.startsWith('data:application/json,')).toBe(true);
    expect(url).not.toMatch(/[\s#"]/);
    expect(decodeSettingsUrl(url)).toEqual(s);
  });

  it('ignores URLs that are not ours or are corrupt', () => {
    expect(decodeSettingsUrl(undefined)).toBeNull();
    expect(decodeSettingsUrl('https://example.com/')).toBeNull();
    expect(decodeSettingsUrl('data:application/json,%7Bnot-json')).toBeNull();
  });
});

describe('searchUrl', () => {
  it('encodes the query into the template', () => {
    expect(searchUrl('https://duckduckgo.com/?q=%s', 'a&b c')).toBe('https://duckduckgo.com/?q=a%26b%20c');
  });
});
