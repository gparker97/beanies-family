/**
 * The chore celebration's seven synthesized sounds (#146) as plain data: which voice plays which
 * notes, when, and how loud. `useSounds` holds the voices (the shared builders) and the one
 * output chain; a sound is only this table.
 *
 * These are the v4 mockup's RAISED versions note for note, written at the pitch they sound (the
 * mockup wrote them an octave down and doubled the frequency). Every sound is in C and ENDS on a
 * root-position C major chord, C5 E5 G5 with C6 on top as the highest and loudest note; the
 * events marked `final` are that chord. `level` is the mockup's measured equal-loudness trim for
 * the raised set. The owner approved these by ear: change nothing here without a listen.
 */
import type { SynthCelebrationSoundId } from '@/utils/choreCelebration';

export type CelebrationVoice = 'pluck' | 'marimba' | 'bell' | 'glock' | 'brass' | 'pizz' | 'kazoo';

/** A note name in scientific pitch notation, sharps or flats allowed ("C5", "F#4", "Bb3"). */
export type NoteName = string;

export interface CelebrationSoundEvent {
  voice: CelebrationVoice;
  notes: readonly NoteName[];
  /** Seconds from the sound's start. */
  at: number;
  /** Seconds between one note and the next (a run, a roll or a strum); absent = together. */
  step?: number;
  /** One peak for every note, or one per note. */
  peak: number | readonly number[];
  /** The note's length (bell, glock, brass, kazoo) or its decay (pluck). */
  dur?: number;
  /** Part of the closing C major chord. */
  final?: boolean;
}

export interface CelebrationSoundDef {
  id: SynthCelebrationSoundId;
  /** Equal-loudness trim: multiplies every peak. */
  level: number;
  events: readonly CelebrationSoundEvent[];
}

/** The closing chord's peaks: every voice at `base` except the top note, the loudest. */
export function topLoud(count: number, base: number, top: number): number[] {
  return [...Array.from({ length: count - 1 }, () => base), top];
}

const C_MAJOR = ['C5', 'E5', 'G5', 'C6'] as const;

export const CELEBRATION_SOUNDS: Readonly<Record<SynthCelebrationSoundId, CelebrationSoundDef>> = {
  // Mon, Bounce party. A quick wooden run up the C scale into a double-hit C major chord.
  marimba: {
    id: 'marimba',
    level: 0.88,
    events: [
      {
        voice: 'marimba',
        notes: ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5'],
        at: 0,
        step: 0.055,
        peak: 0.15,
      },
      { voice: 'marimba', notes: C_MAJOR, at: 0.42, peak: topLoud(4, 0.11, 0.26) },
      { voice: 'marimba', notes: C_MAJOR, at: 0.56, peak: topLoud(4, 0.121, 0.286), final: true },
    ],
  },
  // Tue, Peek-a-boo. Bells climb C, E, G, B and open into a ringing C major chord.
  tada: {
    id: 'tada',
    level: 1.3,
    events: [
      { voice: 'bell', notes: ['C5', 'E5', 'G5', 'B5'], at: 0, step: 0.07, peak: 0.1, dur: 0.7 },
      {
        voice: 'bell',
        notes: C_MAJOR,
        at: 0.32,
        peak: topLoud(4, 0.085, 0.15),
        dur: 1.6,
        final: true,
      },
    ],
  },
  // Wed, Parade. Three short horn calls on G, a quick sparkle sweep, then the horns land on C.
  fanfare: {
    id: 'fanfare',
    level: 0.78,
    events: [
      { voice: 'brass', notes: ['G4', 'G4', 'G4'], at: 0, step: 0.11, peak: 0.055, dur: 0.09 },
      {
        voice: 'glock',
        notes: ['C6', 'E6', 'G6', 'C7'],
        at: 0.21,
        step: 0.03,
        peak: 0.022,
        dur: 0.35,
      },
      {
        voice: 'brass',
        notes: ['C4', ...C_MAJOR],
        at: 0.34,
        peak: topLoud(5, 0.032, 0.065),
        dur: 0.8,
        final: true,
      },
    ],
  },
  // Thu, Drop in. A G7 strum that resolves to C major, strummed three times so it really lands.
  strum: {
    id: 'strum',
    level: 0.82,
    events: [
      {
        voice: 'pluck',
        notes: ['G4', 'B4', 'D5', 'F5', 'G5'],
        at: 0,
        step: 0.016,
        peak: [0.07, 0.07, 0.07, 0.07, 0.08],
        dur: 0.32,
      },
      {
        voice: 'pluck',
        notes: ['C4', 'G4', ...C_MAJOR],
        at: 0.3,
        step: 0.016,
        peak: topLoud(6, 0.075, 0.11),
        dur: 0.38,
      },
      {
        voice: 'pluck',
        notes: ['C4', 'G4', ...C_MAJOR],
        at: 0.52,
        step: 0.016,
        peak: topLoud(6, 0.075, 0.11),
        dur: 0.34,
      },
      {
        voice: 'pluck',
        notes: ['C4', 'G4', ...C_MAJOR],
        at: 0.74,
        step: 0.016,
        peak: topLoud(6, 0.08, 0.16),
        dur: 1.6,
        final: true,
      },
    ],
  },
  // Fri, Tumble in. Three twinkly rolled chords, F to G to C: the classic "the end" cadence.
  glock: {
    id: 'glock',
    level: 1.41,
    events: [
      { voice: 'glock', notes: ['F5', 'A5', 'C6'], at: 0, step: 0.05, peak: 0.08, dur: 0.6 },
      { voice: 'glock', notes: ['G5', 'B5', 'D6'], at: 0.26, step: 0.05, peak: 0.08, dur: 0.6 },
      {
        voice: 'glock',
        notes: C_MAJOR,
        at: 0.55,
        step: 0.03,
        peak: topLoud(4, 0.08, 0.15),
        dur: 1.5,
        final: true,
      },
    ],
  },
  // Sat, Stadium wave. Plucked strings: a G chord, then C major plucked twice. Short and bouncy.
  pizz: {
    id: 'pizz',
    level: 1.12,
    events: [
      { voice: 'pizz', notes: ['G3', 'G4', 'B4', 'D5'], at: 0, peak: [0.07, 0.09, 0.09, 0.09] },
      {
        voice: 'pizz',
        notes: ['C4', ...C_MAJOR],
        at: 0.28,
        peak: [0.13, 0.085, 0.085, 0.085, 0.18],
      },
      {
        voice: 'pizz',
        notes: ['C4', ...C_MAJOR],
        at: 0.5,
        peak: [0.14, 0.0935, 0.0935, 0.0935, 0.198],
        final: true,
      },
    ],
  },
  // Sun, Parachutes. A kazoo goes toot, toot, up to B, and a horn stab lands on C major with
  // the kazoo on top.
  toot: {
    id: 'toot',
    level: 1.15,
    events: [
      { voice: 'kazoo', notes: ['G5', 'G5', 'A5', 'B5'], at: 0, step: 0.14, peak: 0.07, dur: 0.1 },
      {
        voice: 'brass',
        notes: ['C5', 'E5', 'G5'],
        at: 0.58,
        peak: 0.028,
        dur: 0.32,
        final: true,
      },
      { voice: 'kazoo', notes: ['C6'], at: 0.58, peak: 0.1, dur: 0.5, final: true },
    ],
  },
};

const SEMITONES: Readonly<Record<string, number>> = {
  C: -9,
  D: -7,
  E: -5,
  F: -4,
  G: -2,
  A: 0,
  B: 2,
};

/** Equal temperament from A4 = 440 Hz. */
export function noteHz(name: NoteName): number {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  if (!m) throw new Error(`not a note: ${name}`);
  const s =
    (SEMITONES[m[1]!] ?? 0) + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, s / 12);
}

/** Each note's peak in an event (a single number applies to every note). */
export function eventPeaks(e: CelebrationSoundEvent): number[] {
  return e.notes.map((_, i) => (typeof e.peak === 'number' ? e.peak : (e.peak[i] ?? 0)));
}
