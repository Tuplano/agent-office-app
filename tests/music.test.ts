import { describe, expect, it } from 'vitest';
import { readMusic } from '../src/lib/music';
import { BAR, bar, CHORDS, hertz } from '../src/lib/tune';

// numbers that look random and are the same every run
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

describe('the tune', () => {
  it('plays the four chords in turn and round again, with the bass under each', () => {
    for (let index = 0; index < 12; index++) {
      const notes = bar(index, seeded(index));
      const chord = CHORDS[index % 4];
      expect(notes.filter((note) => note.voice === 'pad').map((note) => note.midi)).toEqual(chord);
      const bass = notes.filter((note) => note.voice === 'bass');
      expect(bass.length).toBeGreaterThan(0);
      for (const note of bass) expect(note.midi).toBe(chord[0] - 12);
    }
  });

  it('keeps the top line inside the bar, on notes of the chord, and above it', () => {
    let sung = 0;
    for (let index = 0; index < 200; index++) {
      const chord = CHORDS[index % 4];
      const tones = chord.map((midi) => midi % 12);
      const lead = bar(index, seeded(index * 7 + 1)).filter((note) => note.voice === 'lead');
      expect(lead.length).toBeLessThanOrEqual(BAR * 2);
      for (const note of lead) {
        expect(note.at).toBeGreaterThanOrEqual(0);
        expect(note.at).toBeLessThan(BAR);
        expect(tones).toContain(note.midi % 12);
        expect(note.midi).toBeGreaterThan(Math.max(...chord));
      }
      sung += lead.length;
    }
    // neither silent nor a note in every place there is
    expect(sung).toBeGreaterThan(200);
    expect(sung).toBeLessThan(800);
  });

  it('is the same tune from the same numbers', () => {
    expect(bar(5, seeded(42))).toEqual(bar(5, seeded(42)));
  });

  it('tunes to the A above middle C', () => {
    expect(hertz(69)).toBe(440);
    expect(hertz(57)).toBe(220);
  });
});

describe('the saved music', () => {
  const quiet = { on: false, volume: 0.5 };

  it('is off, at half volume, until something has been saved', () => {
    expect(readMusic(null)).toEqual(quiet);
  });

  it('is what was saved, with the volume kept between nothing and full', () => {
    expect(readMusic('{"on":true,"volume":0.8}')).toEqual({ on: true, volume: 0.8 });
    expect(readMusic('{"on":true,"volume":7}')).toEqual({ on: true, volume: 1 });
    expect(readMusic('{"on":false,"volume":-1}')).toEqual({ on: false, volume: 0 });
  });

  it('is off when what was saved cannot be read', () => {
    for (const text of ['', 'loud', '[]', '{"on":"yes","volume":1}', '{"on":true}', '{"on":true,"volume":1e999}']) expect(readMusic(text), text).toEqual(quiet);
  });
});
