import { describe, expect, it } from 'vitest';
import { lightAt } from '../src/engine/light';

const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));

describe('the light through the day', () => {
  it('is a blue sky with clouds from morning to mid-afternoon', () => {
    for (const hour of [7.5, 9, 12, 14.75]) {
      const light = lightAt(hour);
      expect(light.sun, `at ${hour}`).toBe('day');
      expect(light.sky, `at ${hour}`).toBe('#c4e4f4');
      expect(light.ambient, `at ${hour}`).toEqual([1, 1, 1]);
      expect(light.lamps, `at ${hour}`).toBe(false);
    }
  });

  it('turns orange in the late afternoon, with the sun low', () => {
    for (const hour of [16.5, 17, 17.5]) {
      const light = lightAt(hour);
      const [red, green, blue] = rgb(light.sky);
      expect(light.sun, `at ${hour}`).toBe('low');
      expect(red, `at ${hour}`).toBeGreaterThan(green + 60);
      expect(green, `at ${hour}`).toBeGreaterThan(blue + 40);
    }
    // already most of the way there by twenty past four
    const [red, , blue] = rgb(lightAt(16 + 20 / 60).sky);
    expect(red - blue).toBeGreaterThan(90);
  });

  it('is dark outside, with the lamps on inside, through the night', () => {
    for (const hour of [19.25, 22, 0, 3, 4.9]) {
      const light = lightAt(hour);
      expect(light.sun, `at ${hour}`).toBe('night');
      expect(light.sky, `at ${hour}`).toBe('#202038');
      // lit by the office's own lamps: warm, and not much dimmer than day
      expect(light.lamps, `at ${hour}`).toBe(true);
      expect(light.ambient[0], `at ${hour}`).toBeGreaterThan(0.8);
      expect(light.ambient[0], `at ${hour}`).toBeGreaterThan(light.ambient[2]);
    }
  });

  it('has a low sun at dawn, and moves in steps small enough not to jump', () => {
    expect(lightAt(6).sun).toBe('low');
    for (let minute = 0; minute < 24 * 60 - 1; minute++) {
      const [a, b] = [rgb(lightAt(minute / 60).sky), rgb(lightAt((minute + 1) / 60).sky)];
      for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - b[k]), `at ${minute} minutes`).toBeLessThanOrEqual(8);
    }
  });
});
