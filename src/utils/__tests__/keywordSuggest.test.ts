/**
 * The one keyword matcher (`keywordSuggester`), value-generic, and the pickers' search rule
 * (`matchesQuery`). The emoji adapter over it is pinned, unchanged, by `emojiSuggest.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { isSearchQuery, keywordSuggester, matchesQuery } from '@/utils/keywordSuggest';

const suggester = keywordSuggester<number>([
  { value: 1, words: ['cat', 'cat food'] },
  { value: 2, words: ['feed'], weak: true },
  { value: 3, words: ['dog', '狗'] },
  { value: 4, words: ['dog'] },
  { value: 5, words: ['picnic', 'after-school', 'café'] },
]);

describe('keywordSuggester.suggest', () => {
  it.each([
    // Whole word, case-insensitive.
    ['Cat', 1, 'cat'],
    // Optional plural.
    ['cats', 1, 'cat'],
    ['dogs', 3, 'dog'],
    // Never inside another word.
    ['education', undefined, undefined],
    // A strong word beats a weak one.
    ['feed the dog', 3, 'dog'],
    // A weak word alone still counts.
    ['feed', 2, 'feed'],
    // The longest keyword wins.
    ['buy cat food for the dog', 1, 'cat food'],
    // Chinese matches anywhere in the text.
    ['遛狗', 3, '狗'],
    // Hyphens and accents are part of the keyword.
    ['After-school club', 5, 'after-school'],
    ['Café run', 5, 'café'],
    ['', undefined, undefined],
    ['   ', undefined, undefined],
  ])('%s -> %s (%s)', (text, value, word) => {
    const hit = suggester.suggest(text);
    expect(hit?.value).toBe(value);
    expect(hit?.word).toBe(word);
  });

  it.each([
    ["Wendy's", 'wendys'],
    ['Wendy\u2019s drive-thru', 'wendys'],
    ["DOMINO'S pizza", 'dominos'],
    ["Sam's Club run", 'sams club'],
  ])('a possessive brand matches its stored keyword: %s', (text, word) => {
    const brands = keywordSuggester<string>([
      { value: 'fast_food', words: ['wendys', 'dominos'] },
      { value: 'groceries', words: ['sams club'] },
    ]);
    expect(brands.suggest(text)?.word).toBe(word);
  });

  it.each(["She'll pay me back", 'She\u2019ll pay me back'])(
    'a contraction never joins into a word: %s guesses nothing against "shell"',
    (text) => {
      const fuel = keywordSuggester<string>([{ value: 'gas', words: ['shell'] }]);
      expect(fuel.suggest(text)).toBeUndefined();
    }
  );

  it('only a possessive apostrophe is dropped: contractions keep theirs', () => {
    const table = keywordSuggester<string>([
      { value: 'a', words: ['dont'] },
      { value: 'b', words: ['oclock'] },
      { value: 'c', words: ['trader joes'] },
      { value: 'd', words: ['its'] },
    ]);
    expect(table.suggest("Don't forget")).toBeUndefined();
    expect(table.suggest("Five o'clock")).toBeUndefined();
    expect(table.suggest("Trader Joe's run")?.word).toBe('trader joes');
    // An apostrophe then "s" inside a longer word is no possessive.
    expect(table.suggest("it'sy")).toBeUndefined();
  });

  it('an apostrophe no longer splits a word, and a plain possessive still matches', () => {
    // "cat's" reads as "cats", the plural; it never yields a stray "s" word.
    expect(suggester.suggest("the cat's bowl")).toEqual({ value: 1, word: 'cat' });
    expect([...suggester.matches("dog's dinner")].sort()).toEqual([3, 4]);
  });

  it('a tie on length goes to the earlier table entry', () => {
    expect(suggester.suggest('dog')).toEqual({ value: 3, word: 'dog' });
  });

  it('lowercases without the device locale (a Turkish dotted I still matches)', () => {
    // `toLocaleLowerCase('tr')` would give "pıcnıc"; the matcher must not depend on the locale.
    expect(suggester.suggest('PICNIC')?.value).toBe(5);
  });
});

describe('keywordSuggester.matches: every value in the strongest tier', () => {
  it.each([
    ['buy cat food for the dog', [1, 3, 4]],
    ['feed', [2]],
    ['feed the cat', [1]],
    ['education', []],
    ['', []],
  ])('%s -> %j', (text, want) => {
    expect([...suggester.matches(text)].sort()).toEqual(want);
  });
});

describe('matchesQuery', () => {
  it.each([
    // The label contains the query (case-insensitive, trimmed).
    ['soft', 'Softball', [], true],
    ['  BALL ', 'Softball', [], true],
    // A keyword contains the query.
    ['bat', 'Softball', ['bat and ball'], true],
    ['垒', 'Softball', ['垒球'], true],
    // A single letter is a plain substring filter, never "no match" on the first keystroke.
    ['s', 'Softball', [], true],
    // Nothing contains it.
    ['tennis', 'Softball', ['bat'], false],
    // A possessive apostrophe is dropped on both sides, typed or typographic.
    ["wendy's", 'Fast food', ['wendys'], true],
    ['domino\u2019s', 'Fast food', ['dominos'], true],
    ["trader joe's", 'Groceries', ['trader joes'], true],
    // Any other apostrophe is kept: a plain substring like any other character.
    ["'", 'Softball', [], false],
    ["'", "Kids' corner", [], true],
    ["she'll", 'Gas', ['shell'], false],
    // A trailing apostrophe (one keystroke before the possessive) is not typed yet.
    ["wendy'", 'Fast food', ['wendys'], true],
    ['domino\u2019', 'Fast food', ['dominos'], true],
    ["kids'", "Kids' corner", [], true],
    ["tennis'", 'Softball', ['bat'], false],
    // Only at the end: an apostrophe inside the query still counts.
    ["she'l", 'Gas', ['shell'], false],
    // An empty query matches nothing (the caller shows its full list).
    ['', 'Softball', ['bat'], false],
    ['   ', 'Softball', [], false],
  ])('%j in %s / %j -> %s', (query, label, keywords, want) => {
    expect(matchesQuery(query, label, keywords)).toBe(want);
  });
});

describe('isSearchQuery: the one emptiness test, shared with the picker', () => {
  it.each([
    ['', false],
    ['   ', false],
    ["'", true],
    ['\u2019', true],
    ["'s", true],
    ['s', true],
  ])('%j -> %s', (query, want) => {
    expect(isSearchQuery(query)).toBe(want);
    // The picker swaps its groups for results on exactly this test (`GroupedChipPicker`),
    // and agrees with trimming: no query is blank to one and a search to the other.
    expect(isSearchQuery(query)).toBe(query.trim() !== '');
  });

  it('a query that is no search matches nothing, whatever the label', () => {
    expect(matchesQuery('  ', '   ', ['  '])).toBe(false);
  });
});
