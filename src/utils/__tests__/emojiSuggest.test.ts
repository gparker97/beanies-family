/** The shared keyword matcher behind the chore and reward suggesters (`emojiSuggester`). */
import { describe, it, expect } from 'vitest';
import { emojiSuggester } from '@/utils/emojiSuggest';

const suggest = emojiSuggester([
  { emoji: 'A', words: ['cat', 'cat food'] },
  { emoji: 'B', words: ['feed'], weak: true },
  { emoji: 'C', words: ['dog', '狗'] },
  { emoji: 'D', words: ['dog'] },
]);

describe('emojiSuggester', () => {
  it.each([
    ['Cat', 'A'],
    ['cats', 'A'],
    ['education', undefined],
    ['feed the dog', 'C'],
    ['feed', 'B'],
    ['buy cat food for the dog', 'A'],
    ['遛狗', 'C'],
    ['', undefined],
  ])('%s -> %s', (name, want) => {
    expect(suggest(name)).toBe(want);
  });

  it('a tie on length goes to the earlier table entry', () => {
    expect(suggest('dog')).toBe('C');
  });
});
