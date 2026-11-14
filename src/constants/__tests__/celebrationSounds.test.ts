/**
 * The seven celebration sounds as data (#146). Each must END on root-position C major, C5 E5 G5
 * with C6 on top as the highest and loudest note, exactly as the owner approved by ear. Read
 * straight from the tables, so a changed note list fails here before anyone hears it.
 */
import { describe, it, expect } from 'vitest';
import { CELEBRATION_SOUNDS, eventPeaks, noteHz, topLoud } from '@/constants/celebrationSounds';
import { SYNTH_CELEBRATION_SOUNDS } from '@/utils/choreCelebration';

const letter = (note: string) => note.replace(/[#b]?\d$/, '');

describe('celebration sound tables', () => {
  it('there is one table per synthesized sound', () => {
    expect(Object.keys(CELEBRATION_SOUNDS).sort()).toEqual([...SYNTH_CELEBRATION_SOUNDS].sort());
  });

  for (const id of SYNTH_CELEBRATION_SOUNDS) {
    describe(id, () => {
      const def = CELEBRATION_SOUNDS[id];
      const finals = def.events.filter((e) => e.final);
      const notes = finals.flatMap((e) => e.notes);
      const peaks = finals.flatMap((e) => eventPeaks(e));

      it('ends on a C major chord: only C, E and G', () => {
        expect(finals.length).toBeGreaterThan(0);
        expect(new Set(notes.map(letter))).toEqual(new Set(['C', 'E', 'G']));
        for (const n of ['C5', 'E5', 'G5', 'C6']) expect(notes).toContain(n);
      });

      it('C6 is the top note and the loudest', () => {
        const hz = notes.map(noteHz);
        const top = Math.max(...hz);
        expect(top).toBeCloseTo(noteHz('C6'), 6);
        const loudest = notes[peaks.indexOf(Math.max(...peaks))];
        expect(loudest).toBe('C6');
      });

      it('nothing is scheduled after the closing chord starts', () => {
        const lastFinal = Math.max(...finals.map((e) => e.at));
        const after = def.events.filter((e) => !e.final && e.at > lastFinal);
        expect(after).toEqual([]);
      });

      it('carries its equal-loudness trim', () => {
        expect(def.level).toBeGreaterThan(0.5);
        expect(def.level).toBeLessThan(1.5);
      });
    });
  }

  it('the raised timbre levels are the mockup’s', () => {
    expect(
      Object.fromEntries(SYNTH_CELEBRATION_SOUNDS.map((id) => [id, CELEBRATION_SOUNDS[id].level]))
    ).toEqual({
      marimba: 0.88,
      tada: 1.3,
      fanfare: 0.78,
      strum: 0.82,
      glock: 1.41,
      pizz: 1.12,
      toot: 1.15,
    });
  });

  it('noteHz is equal temperament from A4 = 440', () => {
    expect(noteHz('A4')).toBe(440);
    expect(noteHz('C6')).toBeCloseTo(1046.5, 1);
    expect(noteHz('F#4')).toBeCloseTo(369.99, 1);
    expect(() => noteHz('H2')).toThrow();
  });

  it('topLoud: every voice level except the top note', () => {
    expect(topLoud(4, 0.1, 0.2)).toEqual([0.1, 0.1, 0.1, 0.2]);
  });
});
