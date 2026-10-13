// The tune the office plays: four slow chords that come round again, a bass under
// them and a few notes picked out over the top. It is made up a bar at a time, so
// it never comes to an end, and there is no recording to ship or to fetch.

export type Voice = 'pad' | 'bass' | 'lead';

export interface Note {
  voice: Voice;
  at: number; // beats from the start of the bar
  beats: number; // how long it is held
  midi: number;
}

export const TEMPO = 72; // beats a minute
export const BAR = 4; // beats

// Fmaj7, Em7, Dm7, Cmaj7: each a step down from the last, and round again
export const CHORDS = [
  [53, 57, 60, 64],
  [52, 55, 59, 62],
  [50, 53, 57, 60],
  [48, 52, 55, 59],
];

const HALVES = BAR * 2; // the places in a bar where a note of the top line may fall
const SUNG = 0.3; // how often one does
const RESTS = 0.25; // how often the top line sits a whole bar out

export const hertz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// The notes of one bar. `random` gives numbers from 0 up to 1, as Math.random does:
// the chords and the bass are the same every time round, the top line never is.
export function bar(index: number, random: () => number): Note[] {
  const chord = CHORDS[index % CHORDS.length];
  const notes: Note[] = chord.map((midi) => ({ voice: 'pad', at: 0, beats: BAR, midi }));
  notes.push({ voice: 'bass', at: 0, beats: 2.5, midi: chord[0] - 12 }, { voice: 'bass', at: 2.5, beats: 1.5, midi: chord[0] - 12 });
  if (random() < RESTS) return notes;

  // the top line keeps to the notes of the chord, higher up, and moves by a step
  // at a time more often than it leaps
  const reach = [...chord.map((midi) => midi + 12), chord[0] + 24, chord[1] + 24];
  let on = Math.floor(random() * reach.length);
  for (let half = 0; half < HALVES; half++) {
    if (random() < SUNG) notes.push({ voice: 'lead', at: half / 2, beats: 1.5, midi: reach[on] });
    on = Math.min(reach.length - 1, Math.max(0, on + Math.floor(random() * 3) - 1));
  }
  return notes;
}
