// Page styles. A style is a palette (src/styles/<id>.css, keyed off
// html[data-style]), optional per-component flourishes (`:global([data-style=…])`
// rules inside each component) and an optional animated background (lib/fx).

import type { StyleId } from './settings';

export interface StyleDef {
  id: StyleId;
  label: string;
  description: string;
  /** Themes the style is designed for. A single entry overrides the user's theme setting. */
  themes: ('light' | 'dark')[];
  /** Fixed accent, for styles whose palette is part of the look. Otherwise the user's accent is used. */
  accent?: string;
  /** Uses the user's background preset/image (otherwise the style draws its own). */
  customBackground: boolean;
  /** Has motion the "Animated effects" switch can turn off. */
  animated: boolean;
  /** CSS for the picker swatch in settings. */
  swatch: string;
}

export const STYLES: StyleDef[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Glass cards on your choice of background.',
    themes: ['light', 'dark'],
    customBackground: true,
    animated: false,
    swatch:
      'radial-gradient(60% 70% at 20% 20%, #7c6cffaa, transparent), radial-gradient(50% 60% at 85% 20%, #7dd3fc88, transparent), radial-gradient(60% 60% at 55% 110%, #f0abfc66, transparent), #1a1c2e',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    description: 'Drifting colour that leans toward your pointer; glass that lights up as you pass.',
    themes: ['dark'],
    customBackground: false,
    animated: true,
    swatch:
      'radial-gradient(60% 70% at 18% 20%, #8b7bffcc, transparent), radial-gradient(50% 60% at 85% 15%, #28bef0aa, transparent), radial-gradient(60% 60% at 60% 105%, #dc46c8aa, transparent), #070618',
  },
  {
    id: 'constellation',
    label: 'Constellation',
    description: 'A star field that reacts to your pointer, with HUD-style panels.',
    themes: ['dark'],
    accent: '#5eead4',
    customBackground: false,
    animated: true,
    swatch:
      'radial-gradient(1.5px 1.5px at 20% 30%, #5eead4, transparent), radial-gradient(1.5px 1.5px at 62% 68%, #5eead4, transparent), radial-gradient(1.5px 1.5px at 80% 22%, #fff, transparent), radial-gradient(1.5px 1.5px at 38% 58%, #ff4fd8, transparent), radial-gradient(70% 60% at 50% 0%, #5eead433, transparent), #040814',
  },
  {
    id: 'dotfield',
    label: 'Dot Field',
    description: 'Warm and tactile: a breathing dot grid, a magnifying dock, cards that lift.',
    themes: ['light', 'dark'],
    accent: '#ff5b3a',
    customBackground: false,
    animated: true,
    swatch:
      'radial-gradient(circle, #1f1c1738 1.2px, transparent 1.7px) 0 0 / 11px 11px, radial-gradient(45% 55% at 70% 60%, #ff5b3a40, transparent), #f5f2ec',
  },
];

export function styleDef(id: StyleId): StyleDef {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}
