import { describe, expect, it } from 'vitest';
import { outside, PANE_W, PANE_Z, type Patch } from '../src/engine/outside';

// the windows the office has, as office.ts draws them
const WINDOWS: ['N' | 'E' | 'S', number, boolean][] = [
  ['N', 28, true], ['N', 56, false], ['E', 20, true], ['E', 104, false], ['S', 14, false], ['S', 58, true], ['S', 102, false],
];
const views = WINDOWS.map(([wall, a, heavens]) => outside(wall, a, heavens));

describe('the views out of the windows', () => {
  it('are all different, by day and by night', () => {
    for (const part of ['skyline', 'clouds', 'stars'] as const) {
      expect(new Set(views.map((view) => JSON.stringify(view[part]))).size, part).toBe(WINDOWS.length);
    }
  });

  it('are the same every time they are looked at', () => {
    WINDOWS.forEach(([wall, a, heavens], i) => expect(outside(wall, a, heavens)).toBe(views[i]));
  });

  it('have the sun and moon in one window on each wall', () => {
    for (const wall of ['N', 'E', 'S']) {
      const withSun = views.filter((view, i) => WINDOWS[i][0] === wall && view.sun && view.moon);
      expect(withSun.length, wall).toBe(1);
    }
  });

  it('show the town to the north and south and hills to the east, lit only in town', () => {
    views.forEach((view, i) => {
      expect(view.land, WINDOWS[i].join(' ')).toBe(WINDOWS[i][0] === 'E' ? 'hills' : 'city');
      expect(view.skyline.length).toBeGreaterThan(2);
      if (view.land === 'hills') expect(view.lights).toEqual([]);
    });
    expect(views.some((view) => view.lights.length > 0)).toBe(true);
  });

  it('keep everything inside the pane', () => {
    for (const view of views) {
      const patches: Patch[] = [...view.skyline, ...view.lights, ...view.clouds, ...view.stars];
      if (view.sun) patches.push(view.sun);
      if (view.moon) patches.push(view.moon);
      for (const [a0, a1, z0, z1] of patches) {
        expect(a0).toBeGreaterThanOrEqual(0);
        expect(a1).toBeLessThanOrEqual(PANE_W);
        expect(a1).toBeGreaterThan(a0);
        expect(z0).toBeGreaterThanOrEqual(PANE_Z[0]);
        expect(z1).toBeLessThanOrEqual(PANE_Z[1]);
        expect(z1).toBeGreaterThan(z0);
      }
    }
  });
});
