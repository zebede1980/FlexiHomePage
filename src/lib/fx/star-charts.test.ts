import { describe, expect, it } from 'vitest';
import { CHARTS } from './star-charts';

describe('star charts', () => {
  it('scales every figure so its longer side is 1, centred on 0', () => {
    for (const c of CHARTS) {
      const xs = c.stars.map((s) => s.x);
      const ys = c.stars.map((s) => s.y);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      expect(Math.max(w, h), c.name).toBeCloseTo(1, 6);
      expect(Math.max(...xs) + Math.min(...xs), c.name).toBeCloseTo(0, 6);
      expect(Math.max(...ys) + Math.min(...ys), c.name).toBeCloseTo(0, 6);
    }
  });

  it('only joins stars that exist, and uses every star', () => {
    for (const c of CHARTS) {
      const used = new Set(c.lines.flat());
      for (const i of used) expect(i < c.stars.length, c.name).toBe(true);
      expect(used.size, c.name).toBe(c.stars.length);
    }
  });

  it('draws Orion the right way up: Betelgeuse above Rigel, and east of it on screen-left', () => {
    const orion = CHARTS.find((c) => c.name === 'Orion')!;
    const betelgeuse = orion.stars[1];
    const rigel = orion.stars[7];
    expect(betelgeuse.y).toBeLessThan(rigel.y);
    expect(betelgeuse.x).toBeLessThan(rigel.x);
  });
});
