// Background presets. Each has a light and a dark rendering so it works with
// any theme; `var(--accent)` lets a preset pick up the user's accent colour.

export interface BackgroundPreset {
  id: string;
  label: string;
  light: string;
  dark: string;
}

export const BACKGROUNDS: BackgroundPreset[] = [
  {
    id: 'aurora',
    label: 'Aurora',
    light:
      'radial-gradient(55% 45% at 12% 8%, color-mix(in oklab, var(--accent) 38%, transparent), transparent 70%),' +
      'radial-gradient(45% 45% at 88% 12%, #7dd3fc66, transparent 70%),' +
      'radial-gradient(60% 55% at 55% 105%, #f0abfc55, transparent 70%), #eef1f8',
    dark:
      'radial-gradient(55% 45% at 12% 8%, color-mix(in oklab, var(--accent) 42%, transparent), transparent 70%),' +
      'radial-gradient(45% 45% at 88% 12%, #0ea5e933, transparent 70%),' +
      'radial-gradient(60% 55% at 55% 105%, #a21caf33, transparent 70%), #0b0d14',
  },
  {
    id: 'dusk',
    label: 'Dusk',
    light: 'linear-gradient(160deg, #fde2e4 0%, #fbd3c4 45%, #e9d5ff 100%)',
    dark: 'linear-gradient(160deg, #1d1533 0%, #4a1f45 50%, #8a3b3b 100%)',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    light: 'linear-gradient(160deg, #e0f2fe 0%, #cffafe 50%, #dbeafe 100%)',
    dark: 'linear-gradient(160deg, #081427 0%, #0c3a5c 55%, #11707c 100%)',
  },
  {
    id: 'forest',
    label: 'Forest',
    light: 'linear-gradient(160deg, #ecfdf5 0%, #dcfce7 50%, #fef9c3 100%)',
    dark: 'linear-gradient(160deg, #07160f 0%, #123d27 55%, #34500f 100%)',
  },
  {
    id: 'graphite',
    label: 'Graphite',
    light: 'radial-gradient(80% 60% at 50% 0%, #ffffff, transparent 70%), #eceef2',
    dark: 'radial-gradient(80% 60% at 50% 0%, #1c1f27, transparent 70%), #0e0f13',
  },
];

export const IMAGE_BACKGROUND = 'image';

export function backgroundCss(id: string, theme: 'light' | 'dark', imageUrl: string, dim: number): string {
  if (id === IMAGE_BACKGROUND && imageUrl) {
    const safe = imageUrl.replace(/["\\\n\r]/g, '');
    return `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), center / cover no-repeat url("${safe}"), #111`;
  }
  const preset = BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0];
  return preset[theme];
}
