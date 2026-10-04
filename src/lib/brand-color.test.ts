import { describe, expect, it } from 'vitest';
import { dominantColor } from './brand-color.svelte';

const pixels = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat());

describe('dominantColor', () => {
  it('finds the hue of the coloured pixels and ignores transparent, white and black ones', () => {
    const red = [230, 30, 30, 255];
    const c = dominantColor(pixels(...Array(8).fill(red), [255, 255, 255, 255], [0, 0, 0, 255], [0, 200, 0, 0]));
    expect(c).toMatch(/^hsl\(0 /);
  });

  it('returns null for monochrome icons', () => {
    expect(dominantColor(pixels(...Array(16).fill([20, 20, 20, 255]), ...Array(16).fill([250, 250, 250, 255])))).toBeNull();
  });

  it('keeps lightness readable on dark and light pages', () => {
    const navy = [5, 41, 98, 255];
    const l = Number(dominantColor(pixels(...Array(16).fill(navy)))!.match(/(\d+)%\)$/)![1]);
    expect(l).toBeGreaterThanOrEqual(48);
    expect(l).toBeLessThanOrEqual(62);
  });
});
