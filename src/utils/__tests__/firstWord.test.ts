import { describe, it, expect, afterEach } from 'vitest';
import { firstWord } from '@/utils/firstWord';

const SEGMENTER = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');

afterEach(() => {
  if (SEGMENTER) Object.defineProperty(Intl, 'Segmenter', SEGMENTER);
});

describe('firstWord', () => {
  it('takes the first word of an English title', () => {
    expect(firstWord('swimming lesson at Tampines pool', 'en')).toBe('swimming');
    expect(firstWord("  Carter's party", 'en')).toBe("Carter's");
  });

  it('takes a word, never the whole sentence, from a Chinese title', () => {
    const title = '游泳课在淡马锡';
    const word = firstWord(title, 'zh');
    expect(word.length).toBeGreaterThan(0);
    expect(word.length).toBeLessThan(title.length);
    expect(title.startsWith(word)).toBe(true);
  });

  it('skips a leading emoji to the first real word', () => {
    expect(firstWord("🎂 Ava's party", 'en')).toBe("Ava's");
  });

  it('falls back to the first token when the title has no word at all', () => {
    expect(firstWord('🎂🎉 🎈', 'en')).toBe('🎂🎉');
  });

  it("is '' for a blank title", () => {
    expect(firstWord('   ', 'en')).toBe('');
  });

  it('splits on whitespace when the engine has no segmenter', () => {
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true });
    expect(firstWord('swimming lesson', 'en')).toBe('swimming');
    expect(firstWord('游泳课 在淡马锡', 'zh')).toBe('游泳课');
  });
});
