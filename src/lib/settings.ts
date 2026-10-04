// Settings schema, defaults and (de)serialisation. Settings travel between
// machines inside a bookmark URL, so everything here must be plain JSON and
// tolerant of whatever an older or newer build wrote.

export type ThemeMode = 'auto' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';
export type StyleId = 'classic' | 'constellation';

export const STYLE_IDS: StyleId[] = ['classic', 'constellation'];

export interface Settings {
  v: 1;
  /** ms epoch of the last user change; 0 means "never touched" so a synced copy always wins. */
  updatedAt: number;
  /** Folder titles from the top level down to the home folder. null = pick automatically. */
  rootPath: string[] | null;
  theme: ThemeMode;
  /** Overall look: layout flourishes, palette and background effect. See lib/styles.ts. */
  style: StyleId;
  /** Animated backgrounds and pointer effects (tilt etc.) for styles that have them. */
  effects: boolean;
  /** Rich preview card when resting the pointer on a link. */
  previews: boolean;
  accent: string;
  background: string;
  backgroundImage: string;
  /** 0–0.8 darkening applied over image backgrounds. */
  dim: number;
  name: string;
  showClock: boolean;
  clock24h: boolean;
  showGreeting: boolean;
  openInNewTab: boolean;
  /** URL template, `%s` is replaced with the encoded query. */
  searchEngine: string;
  cardWidth: number;
  density: Density;
  /** Links shown in a card before "Show more". */
  previewLimit: number;
  /** pathKey()s of top-level cards the user collapsed. */
  collapsed: string[];
  /** pathKey()s of nested folders the user expanded. */
  expanded: string[];
  /** Top-level cards by column, each a list of pathKey()s from top to bottom. */
  cardLayout: string[][];
}

export const SEARCH_ENGINES: { label: string; url: string }[] = [
  { label: 'Google', url: 'https://www.google.com/search?q=%s' },
  { label: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { label: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  { label: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s' },
];

export const ACCENTS = ['#7c6cff', '#3b82f6', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#f97316', '#f43f5e', '#ec4899', '#64748b'];

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  updatedAt: 0,
  rootPath: null,
  theme: 'auto',
  style: 'classic',
  effects: true,
  previews: true,
  accent: ACCENTS[0],
  background: 'aurora',
  backgroundImage: '',
  dim: 0.35,
  name: '',
  showClock: true,
  clock24h: true,
  showGreeting: true,
  openInNewTab: false,
  searchEngine: SEARCH_ENGINES[0].url,
  cardWidth: 280,
  density: 'comfortable',
  previewLimit: 10,
  collapsed: [],
  expanded: [],
  cardLayout: [],
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isStr = (x: unknown): x is string => typeof x === 'string';
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const strArr = (x: unknown): string[] | null => (Array.isArray(x) && x.every(isStr) ? x : null);
const strArr2 = (x: unknown): string[][] | null => (Array.isArray(x) && x.every((c) => strArr(c)) ? x : null);

/** Merges arbitrary input over the defaults, dropping anything malformed. */
export function normalizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    v: 1,
    updatedAt: isNum(r.updatedAt) ? r.updatedAt : 0,
    rootPath: r.rootPath === null ? null : (strArr(r.rootPath) ?? d.rootPath),
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'auto' ? r.theme : d.theme,
    style: STYLE_IDS.includes(r.style as StyleId) ? (r.style as StyleId) : d.style,
    effects: isBool(r.effects) ? r.effects : d.effects,
    previews: isBool(r.previews) ? r.previews : d.previews,
    accent: isStr(r.accent) && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent : d.accent,
    background: isStr(r.background) && r.background ? r.background : d.background,
    backgroundImage: isStr(r.backgroundImage) ? r.backgroundImage : d.backgroundImage,
    dim: isNum(r.dim) ? clamp(r.dim, 0, 0.8) : d.dim,
    name: isStr(r.name) ? r.name.slice(0, 60) : d.name,
    showClock: isBool(r.showClock) ? r.showClock : d.showClock,
    clock24h: isBool(r.clock24h) ? r.clock24h : d.clock24h,
    showGreeting: isBool(r.showGreeting) ? r.showGreeting : d.showGreeting,
    openInNewTab: isBool(r.openInNewTab) ? r.openInNewTab : d.openInNewTab,
    searchEngine: isStr(r.searchEngine) && r.searchEngine.includes('%s') ? r.searchEngine : d.searchEngine,
    cardWidth: isNum(r.cardWidth) ? clamp(Math.round(r.cardWidth), 220, 440) : d.cardWidth,
    density: r.density === 'compact' || r.density === 'comfortable' ? r.density : d.density,
    previewLimit: isNum(r.previewLimit) ? clamp(Math.round(r.previewLimit), 3, 100) : d.previewLimit,
    collapsed: strArr(r.collapsed) ?? d.collapsed,
    expanded: strArr(r.expanded) ?? d.expanded,
    cardLayout: strArr2(r.cardLayout) ?? d.cardLayout,
  };
}

const DATA_PREFIX = 'data:application/json,';

export function encodeSettingsUrl(s: Settings): string {
  return DATA_PREFIX + encodeURIComponent(JSON.stringify(s));
}

/** Returns null for anything that isn't a settings payload we wrote. */
export function decodeSettingsUrl(url: string | undefined): Settings | null {
  if (!url || !url.startsWith(DATA_PREFIX)) return null;
  try {
    return normalizeSettings(JSON.parse(decodeURIComponent(url.slice(DATA_PREFIX.length))));
  } catch {
    return null;
  }
}

export function searchUrl(template: string, query: string): string {
  return template.replace('%s', encodeURIComponent(query));
}
