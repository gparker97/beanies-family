import { describe, it, expect } from 'vitest';
import { computeInitials } from '../memberInitials';

const m = (id: string, name: string) => ({ id, name });

describe('computeInitials', () => {
  it('gives one letter when no first letter is shared', () => {
    const out = computeInitials([m('1', 'Max'), m('2', 'Leo'), m('3', 'Sofia')]);
    expect(out.get('1')).toBe('M');
    expect(out.get('2')).toBe('L');
    expect(out.get('3')).toBe('S');
  });

  it('widens BOTH colliding members to two letters, not just the second', () => {
    const out = computeInitials([m('1', 'Max'), m('2', 'Mia')]);
    expect(out.get('1')).toBe('MA');
    expect(out.get('2')).toBe('MI');
  });

  it('keeps widening until the labels are actually DISTINCT', () => {
    // Two characters is not enough for the commonest sibling pairs there are — the
    // widening would have produced "MA" over "MA" and done nothing on exactly the
    // families it exists for.
    for (const [a, b] of [
      ['Max', 'Mark'],
      ['Sam', 'Sarah'],
      ['Ben', 'Bella'],
    ]) {
      const out = computeInitials([m('1', a!), m('2', b!)]);
      expect(out.get('1')).not.toBe(out.get('2'));
    }
  });

  it('degrades to two letters when two beans genuinely share a name', () => {
    // Mia and Mia cannot be told apart by any prefix. Colour and the full name in the
    // picker do the work; the glyph stops rather than growing forever.
    const out = computeInitials([m('1', 'Mia'), m('2', 'Mia')]);
    expect(out.get('1')).toBe('MI');
    expect(out.get('2')).toBe('MI');
  });

  it('treats a flag and a ZWJ family emoji as ONE grapheme each', () => {
    // Code-point splitting yields a lone regional indicator for a flag, and the SAME
    // dangling-ZWJ label for two different family emoji — so the disambiguating widen
    // produced two identical faces.
    const flags = computeInitials([m('1', '🇬🇧 Nan')]);
    expect(flags.get('1')).toBe('🇬🇧');
    const fam = computeInitials([m('1', '👨‍👩‍👧 Us'), m('2', '👨‍👩‍👦 Them')]);
    expect(fam.get('1')).not.toBe(fam.get('2'));
  });

  it('does not let ß expand a one-letter initial into two', () => {
    // `toUpperCase()` maps ß to SS, so a single glyph became three in a 24px circle.
    expect(computeInitials([m('1', 'ßeta')]).get('1')).toBe('ß');
  });

  it('leaves a non-colliding member on one letter while others widen', () => {
    const out = computeInitials([m('1', 'Max'), m('2', 'Mia'), m('3', 'Leo')]);
    expect(out.get('3')).toBe('L');
  });

  it('narrows back to one letter when the colliding member is removed', () => {
    const before = computeInitials([m('1', 'Max'), m('2', 'Mia')]);
    expect(before.get('1')).toBe('MA');
    const after = computeInitials([m('1', 'Max')]);
    expect(after.get('1')).toBe('M');
  });

  it('handles an emoji / astral-plane first character as ONE grapheme', () => {
    // `charAt(0)` returns half a surrogate pair here — three of the four avatar
    // implementations this replaced did exactly that and rendered a broken glyph.
    const out = computeInitials([m('1', '🐶 Rex')]);
    expect(out.get('1')).toBe('🐶');
    expect([...(out.get('1') ?? '')]).toHaveLength(1);
  });

  it('falls back to ? for a blank name rather than an empty circle', () => {
    const out = computeInitials([m('1', '   ')]);
    expect(out.get('1')).toBe('?');
  });

  it('widens to a single letter when a colliding name is one character long', () => {
    const out = computeInitials([m('1', 'M'), m('2', 'Mia')]);
    expect(out.get('1')).toBe('M');
    expect(out.get('2')).toBe('MI');
  });
});
