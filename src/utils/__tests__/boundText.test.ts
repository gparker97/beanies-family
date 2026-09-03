/**
 * The one thing this helper exists to prevent is a lone surrogate reaching a model, a
 * filename or a screen as `U+FFFD`. Every case below is really the same assertion from a
 * different angle: cutting a string is a character-level operation, not an index-level one.
 */
import { describe, it, expect } from 'vitest';
import { boundText } from '../boundText';

/** A lone surrogate is any code unit in the surrogate range without its partner. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (isHigh) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1; // consumed the pair
    } else if (isLow) {
      return true; // a low surrogate not preceded by its high half
    }
  }
  return false;
}

describe('boundText', () => {
  it('returns a string that already fits, untouched', () => {
    expect(boundText('hello', 10)).toBe('hello');
  });

  it('returns a string at exactly the cap, untouched', () => {
    // The off-by-one that would truncate every at-cap string.
    expect(boundText('hello', 5)).toBe('hello');
  });

  it('truncates one character over the cap', () => {
    expect(boundText('hello!', 5)).toBe('hello');
  });

  it('yields an empty string for a non-positive cap', () => {
    // `slice(0, 0)` and `slice(0, -1)` disagree wildly; the negative case would otherwise
    // return everything but the last character, which is the opposite of bounding.
    expect(boundText('hello', 0)).toBe('');
    expect(boundText('hello', -3)).toBe('');
  });

  describe('surrogate safety', () => {
    it('drops a high surrogate rather than orphaning it', () => {
      // '🎉' is one astral character = TWO UTF-16 code units. Cutting at 4 lands between
      // them, so a naive slice returns 'aaa\uD83C' — which renders as U+FFFD.
      const out = boundText('aaa🎉', 4);
      expect(out).toBe('aaa');
      expect(hasLoneSurrogate(out)).toBe(false);
    });

    it('keeps a pair that fits entirely', () => {
      expect(boundText('aaa🎉', 5)).toBe('aaa🎉');
    });

    it('never produces a lone surrogate at ANY cut point', () => {
      // The exhaustive version of the case above — every index through a mixed string.
      const mixed = 'a🎉b👨‍👩‍👧c日本語d😀e';
      for (let i = 0; i <= mixed.length + 1; i += 1) {
        const out = boundText(mixed, i);
        expect(hasLoneSurrogate(out)).toBe(false);
        expect(out.length).toBeLessThanOrEqual(Math.max(0, i));
      }
    });

    it('handles an all-emoji string cut on an odd boundary', () => {
      const out = boundText('🎉'.repeat(10), 5);
      // Four code units = two whole emoji; the fifth would be half of the third.
      expect(out).toBe('🎉🎉');
      expect(hasLoneSurrogate(out)).toBe(false);
    });
  });

  describe('scripts that are not the Latin alphabet', () => {
    it('cuts RTL text without producing a lone surrogate', () => {
      const out = boundText('مرحبا بالعالم هذا نص طويل', 10);
      expect(out).toHaveLength(10);
      expect(hasLoneSurrogate(out)).toBe(false);
    });

    it('cuts CJK, which is BMP and therefore one unit per character', () => {
      expect(boundText('日本語のテキスト', 3)).toBe('日本語');
    });

    it('cuts an astral CJK extension, which is NOT one unit per character', () => {
      // 𠮷 (U+20BB7) is CJK Ext-B: two code units, and the case a BMP-only assumption misses.
      const out = boundText('𠮷𠮷𠮷', 3);
      expect(out).toBe('𠮷');
      expect(hasLoneSurrogate(out)).toBe(false);
    });
  });
});
