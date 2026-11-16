/**
 * The shared keyword matcher behind the chore and reward suggesters (`emojiSuggester`), and the
 * rename rule both follow (`emojiAfterRename`).
 */
import { describe, it, expect } from 'vitest';
import { emojiAfterRename, emojiSuggester } from '@/utils/emojiSuggest';

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

describe('emojiAfterRename: only a change of suggestion re-picks', () => {
  it.each([
    ['a new suggestion re-picks over a hand pick', '🍦', '💵', '🐷', '💵'],
    ['a first suggestion re-picks over a followed picture', undefined, '🎬', '🎁', '🎬'],
    ['the same suggestion keeps a hand pick', '💵', '💵', '🐷', '🐷'],
    ['no suggestion keeps a hand pick', '🍦', undefined, '🐷', '🐷'],
    [
      'no suggestion keeps a followed picture (no jump to the default)',
      '🍦',
      undefined,
      '🍦',
      '🍦',
    ],
    ['no picture, the same suggestion: the suggestion', '💵', '💵', undefined, '💵'],
    ['no picture, no suggestion: the default', undefined, undefined, undefined, '🎁'],
    ['an empty picture counts as none', undefined, undefined, '', '🎁'],
  ] as const)('%s', (_n, before, after, current, expected) => {
    expect(emojiAfterRename({ before, after, current, fallback: '🎁' })).toBe(expected);
  });
});
