/**
 * The shared keyword matcher behind the chore and reward suggesters (`emojiSuggester`), and the
 * rename rule both follow (`pictureAfterRename`).
 */
import { describe, it, expect } from 'vitest';
import { emojiSuggester, pictureAfterRename } from '@/utils/emojiSuggest';

const suggester = emojiSuggester([
  { emoji: 'A', words: ['cat', 'cat food'] },
  { emoji: 'B', words: ['feed'], weak: true },
  { emoji: 'C', words: ['dog', '狗'] },
  { emoji: 'D', words: ['dog'] },
]);
const suggest = suggester.suggest;

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

describe('matches: every picture a name matches, in its strongest tier', () => {
  it.each([
    ['buy cat food for the dog', ['A', 'C', 'D']],
    // A weak word counts only when no strong word is there.
    ['feed', ['B']],
    ['feed the cat', ['A']],
    ['education', []],
    ['', []],
  ])('%s -> %j', (name, want) => {
    expect([...suggester.matches(name)].sort()).toEqual(want);
  });
});

/**
 * `pictureAfterRename`, the rule itself, over a tiny table. The chore and reward wrappers pin
 * the real examples (`choreBlocks.test.ts`, `choreStarsConstants.test.ts`).
 */
describe('pictureAfterRename', () => {
  const rule = emojiSuggester([
    { emoji: 'TRASH', words: ['trash'] },
    { emoji: 'DINNER', words: ['dinner'] },
    { emoji: 'DOG', words: ['dog'] },
    { emoji: 'BRUSH', words: ['brush'], weak: true },
    { emoji: 'HAIR', words: ['hair'] },
  ]);
  const DEFAULT = 'DEF';
  const next = (settledName: string, newName: string, current: string, hasArt = false) =>
    pictureAfterRename(rule, { settledName, newName, current, hasArt, plainDefault: DEFAULT });

  it.each([
    [
      'a longer keyword on the same thing keeps a hand pick',
      'trash',
      'trash after dinner',
      'X',
      undefined,
    ],
    [
      'the meaning moved: the new suggestion, over a hand pick',
      'trash',
      'walk the dog',
      'X',
      'DOG',
    ],
    [
      'a weak word does not hold a picture once a specific one is there',
      'brush',
      'brush hair',
      'X',
      'HAIR',
    ],
    ['the new name suggests nothing: keep', 'trash', 'help out', 'X', undefined],
    ['the old name suggested nothing: a hand pick stays', 'help', 'walk the dog', 'X', undefined],
    [
      'the old name suggested nothing: the plain default yields',
      '',
      'walk the dog',
      DEFAULT,
      'DOG',
    ],
    ['no picture at all: the suggestion', 'trash', 'trash after dinner', '', 'DINNER'],
    ['the name unchanged (opening): keep', 'dog', 'dog', 'X', undefined],
  ] as const)('%s', (_n, settled, renamed, current, want) => {
    expect(next(settled, renamed, current)).toBe(want);
  });

  it('card art is a real picture even on the default emoji', () => {
    expect(next('help', 'trash after dinner', DEFAULT, true)).toBeUndefined();
    expect(next('help', 'trash after dinner', DEFAULT, false)).toBe('DINNER');
  });
});
