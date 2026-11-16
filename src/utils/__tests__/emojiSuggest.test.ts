/**
 * The shared keyword matcher behind the chore and reward suggesters (`emojiSuggester`), and the
 * rename rule both follow (`pictureAfterRename`, with `isEditOfName`).
 */
import { describe, it, expect } from 'vitest';
import { emojiSuggester, isEditOfName, pictureAfterRename } from '@/utils/emojiSuggest';

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
    [
      'the old name suggested nothing: an edit of it keeps a hand pick',
      'help out',
      'help walk the dog',
      'X',
      undefined,
    ],
    [
      'the old name suggested nothing: a different name re-picks over a hand pick',
      'help',
      'walk the dog',
      'X',
      'DOG',
    ],
    [
      'the old name suggested nothing: a first title keeps a hand pick',
      '',
      'walk the dog',
      'X',
      undefined,
    ],
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
    expect(next('help', 'help after dinner', DEFAULT, true)).toBeUndefined();
    expect(next('help', 'help after dinner', DEFAULT, false)).toBe('DINNER');
    // A different name re-picks over the art as well.
    expect(next('help', 'trash after dinner', DEFAULT, true)).toBe('DINNER');
  });
});

describe('isEditOfName: the new name shares a significant word with the old one', () => {
  it.each([
    ['Clear your plate', 'Clear your plate after dinner', true],
    ['Clear your plate', 'Clear the table', true],
    ['Clear your plate', 'CLEAR UP', true],
    ['Clear your plate', 'Feed the dog', false],
    ['Something nice', 'Allowance', false],
    ['Help Grandma', 'Feed the dog', false],
    // Words under three letters and common filler words are not significant.
    ['Go to bed', 'Go to school', false],
    ['Clean the room', 'Walk the dog', false],
    ['Tidy up, 2 rooms', 'Feed 2 cats', false],
    // A name without spaces (Chinese) shares a character that is not punctuation or a digit.
    ['洗碗', '洗衣服', true],
    ['洗碗', '喂狗', false],
    ['1。作业', '2。喂狗', false],
    ['', 'Feed the dog', false],
  ] as const)('%s -> %s: %s', (from, to, want) => {
    expect(isEditOfName(from, to)).toBe(want);
  });
});
