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
