import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSyncExternalStore } from 'react';
import { BAR, bar, hertz, type Note, TEMPO } from './tune';

export interface Music {
  on: boolean;
  volume: number; // from 0 to 1
}

const KEY = 'agent-office-music';
// Until it is asked for there is none: nothing starts playing unasked.
const QUIET: Music = { on: false, volume: 0.5 };

// what was saved, or silence if it is not there or cannot be read
export function readMusic(text: string | null): Music {
  try {
    const saved = JSON.parse(text ?? 'null');
    if (typeof saved?.on !== 'boolean' || !Number.isFinite(saved.volume)) return QUIET;
    return { on: saved.on, volume: Math.min(1, Math.max(0, saved.volume)) };
  } catch {
    return QUIET;
  }
}

function saved(): Music {
  try {
    return readMusic(localStorage.getItem(KEY));
  } catch {
    return QUIET; // storage is off
  }
}

const BEAT = 60 / TEMPO; // seconds
const AHEAD = 2; // seconds of the tune kept lined up, so a slow timer leaves no gap
const FADE = 0.6; // seconds it takes to come in and to go out

// What plays the tune: made the first time there is music, and kept from then on.
interface Band {
  ctx: AudioContext;
  out: GainNode; // everything, at the volume chosen
  soft: AudioNode; // where the chords and the bass go in: the top is taken off them
  bright: AudioNode; // where the top line goes in: it is left clearer, and echoes
  wobble: AudioNode; // a slow drift in pitch, as of a tape
  next: number; // when the next bar starts, by the context's clock
  index: number; // which bar that is
}

let music = saved();
let band: Band | null = null;
let away = false; // the window is hidden in the tray: nobody is there to hear
let lining: ReturnType<typeof setInterval> | undefined;
let resting: ReturnType<typeof setTimeout> | undefined;
const told = new Set<() => void>();

function makeBand(): Band {
  const ctx = new AudioContext();
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(ctx.destination);

  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 900;
  soft.connect(out);

  const bright = ctx.createBiquadFilter();
  bright.type = 'lowpass';
  bright.frequency.value = 2400;
  const echo = ctx.createDelay(1);
  echo.delayTime.value = BEAT * 0.75;
  const again = ctx.createGain();
  again.gain.value = 0.35;
  bright.connect(out);
  bright.connect(echo);
  echo.connect(again);
  again.connect(echo);
  again.connect(out);

  const drift = ctx.createOscillator();
  drift.frequency.value = 0.25;
  const wobble = ctx.createGain();
  wobble.gain.value = 5; // cents
  drift.connect(wobble);
  drift.start();

  return { ctx, out, soft, bright, wobble, next: 0, index: 0 };
}

// One note, lined up to sound `start` seconds into the context's clock.
function sound({ ctx, soft, bright, wobble }: Band, note: Note, start: number) {
  const from = start + note.at * BEAT;
  const held = note.beats * BEAT;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, from);
  let until: number;
  // each voice as [wave, cents off the note, how loud] for every oscillator in it
  let waves: [OscillatorType, number, number][];
  if (note.voice === 'pad') {
    // swells in and dies away slowly, into the chord that comes after
    waves = [['triangle', -4, 0.035], ['triangle', 4, 0.035]];
    until = from + held + 1;
    gain.gain.linearRampToValueAtTime(1, from + 0.5);
    gain.gain.setValueAtTime(1, from + held);
    gain.gain.linearRampToValueAtTime(0, until);
    gain.connect(soft);
  } else {
    // struck, and left to ring down
    waves = note.voice === 'bass' ? [['triangle', 0, 0.2]] : [['sine', 0, 0.09], ['sine', 1200, 0.025]];
    until = from + held + (note.voice === 'bass' ? 0 : 0.6);
    gain.gain.linearRampToValueAtTime(1, from + (note.voice === 'bass' ? 0.03 : 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, until);
    gain.connect(note.voice === 'bass' ? soft : bright);
  }
  for (const [wave, cents, loud] of waves) {
    const voice = ctx.createOscillator();
    voice.type = wave;
    voice.frequency.value = hertz(note.midi);
    voice.detune.value = cents;
    wobble.connect(voice.detune);
    const level = ctx.createGain();
    level.gain.value = loud;
    voice.connect(level);
    level.connect(gain);
    voice.start(from);
    voice.stop(until + 0.05);
    voice.onended = () => {
      wobble.disconnect(voice.detune);
      level.disconnect();
    };
  }
}

// Lines up every bar that starts within the next `AHEAD` seconds.
function line() {
  if (!band) return;
  const now = band.ctx.currentTime;
  if (band.next < now) band.next = now + 0.1; // the first bar, or the timer was held up past the last one
  while (band.next < now + AHEAD) {
    for (const note of bar(band.index, Math.random)) sound(band, note, band.next);
    band.next += BAR * BEAT;
    band.index++;
  }
}

// A page may make no sound until it has been clicked or typed at. When the music
// was left on last time, this is where it starts.
function wake() {
  if (music.on && !away) void band?.ctx.resume();
}

// Brings what is heard into line with what is wanted: playing or not, and how loud.
function follow() {
  const wanted = music.on && !away;
  if (!wanted && !band) return;
  try {
    band ??= makeBand();
  } catch (err) {
    console.error('Agent Office: there is no way to play music here', err);
    music = { ...music, on: false };
    return;
  }
  const { ctx, out } = band;
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setTargetAtTime(wanted ? music.volume ** 2 : 0, ctx.currentTime, FADE / 3);
  clearTimeout(resting);
  if (wanted) {
    void ctx.resume();
    for (const kind of ['pointerdown', 'keydown']) window.addEventListener(kind, wake, { once: true });
    line();
    lining ??= setInterval(line, 500);
  } else {
    clearInterval(lining);
    lining = undefined;
    // once it has faded the clock is stopped, and the tune picks up where it left off
    resting = setTimeout(() => void ctx.suspend(), FADE * 1000);
  }
}

function change(next: Music) {
  music = next;
  follow();
  try {
    localStorage.setItem(KEY, JSON.stringify(music));
  } catch {
    // storage is off; the choice lasts until the window is closed
  }
  for (const tell of told) tell();
}

// Called once the page is up: music that was left on comes back, and it stops
// while the window is away in the tray. Returns the way to undo that.
export function startMusic(): () => void {
  follow();
  if (!isTauri()) return () => {};
  const listening = listen<boolean>('shown', (event) => {
    away = !event.payload;
    follow();
  });
  return () => {
    listening.then((stop) => stop()).catch(() => {});
  };
}

const subscribe = (tell: () => void) => {
  told.add(tell);
  return () => void told.delete(tell);
};
const play = (on: boolean) => change({ ...music, on });
const setVolume = (volume: number) => change({ ...music, volume: Math.min(1, Math.max(0, volume)) });

// Whether there is music and how loud, and the ways to change both. Both are
// remembered.
export function useMusic() {
  const now = useSyncExternalStore(subscribe, () => music, () => QUIET);
  return { ...now, play, setVolume };
}
