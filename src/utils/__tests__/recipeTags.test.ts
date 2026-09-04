import { describe, it, expect } from 'vitest';
import {
  matchTags,
  normaliseTag,
  addTag,
  removeTag,
  suggestTags,
  MAX_TAGS,
  MAX_TAG_LENGTH,
} from '../recipeTags';

describe('normaliseTag', () => {
  it('lowercases', () => expect(normaliseTag('Quick')).toBe('quick'));
  it('trims', () => expect(normaliseTag('  quick  ')).toBe('quick'));
  it('collapses internal whitespace', () =>
    expect(normaliseTag('week  night   meal')).toBe('week night meal'));
  it('lowercases proper nouns too — the stated trade', () =>
    expect(normaliseTag("Nana's")).toBe("nana's"));
  it('caps length', () => expect(normaliseTag('x'.repeat(100))).toHaveLength(MAX_TAG_LENGTH));
  it('re-trims after the cap so a tag cannot end in a space', () =>
    expect(normaliseTag('a'.repeat(MAX_TAG_LENGTH - 1) + ' bbbb')).not.toMatch(/ $/));
  it.each(['', '   ', '\t\n'])('returns empty for %p', (raw) => expect(normaliseTag(raw)).toBe(''));
  it('is idempotent', () => {
    const once = normaliseTag('  Week  Night ');
    expect(normaliseTag(once)).toBe(once);
  });
});

describe('addTag', () => {
  it('adds a normalised tag', () => {
    expect(addTag([], ' Quick ')).toEqual({ tags: ['quick'], status: 'added' });
  });

  it('reports empty rather than adding nothing silently', () => {
    expect(addTag(['a'], '   ')).toEqual({ tags: ['a'], status: 'empty' });
  });

  it('reports a duplicate, case-insensitively', () => {
    expect(addTag(['quick'], 'QUICK')).toEqual({ tags: ['quick'], status: 'duplicate' });
  });

  it('reports the cap and does not add', () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `tag${i}`);
    const result = addTag(full, 'one-more');
    expect(result.status).toBe('limit');
    expect(result.tags).toHaveLength(MAX_TAGS);
  });

  it('ADDS a too-long tag but says it was shortened', () => {
    const result = addTag([], 'x'.repeat(MAX_TAG_LENGTH + 5));
    expect(result.status).toBe('truncated');
    expect(result.tags[0]).toHaveLength(MAX_TAG_LENGTH);
  });

  it('does not report truncation for a tag that merely needed trimming', () => {
    expect(addTag([], '  quick  ').status).toBe('added');
  });

  it('returns a new array rather than mutating', () => {
    const original = ['a'];
    const result = addTag(original, 'b');
    expect(original).toEqual(['a']);
    expect(result.tags).not.toBe(original);
  });

  it('preserves insertion order — the order the card renders', () => {
    let tags: string[] = [];
    for (const raw of ['zebra', 'apple', 'mango']) tags = addTag(tags, raw).tags;
    expect(tags).toEqual(['zebra', 'apple', 'mango']);
  });
});

describe('removeTag', () => {
  it('removes', () => expect(removeTag(['a', 'b'], 'a')).toEqual(['b']));
  it('is a no-op for an absent tag', () => expect(removeTag(['a'], 'z')).toEqual(['a']));
  it('does not mutate', () => {
    const original = ['a', 'b'];
    removeTag(original, 'a');
    expect(original).toEqual(['a', 'b']);
  });
});

describe('suggestTags', () => {
  const recipes = [
    { tags: ['quick', 'vegan'] },
    { tags: ['quick', 'spicy'] },
    { tags: ['quick'] },
    { tags: ['vegan'] },
    {},
  ];

  it('orders by frequency, then alphabetically', () => {
    expect(suggestTags(recipes, [])).toEqual(['quick', 'vegan', 'spicy']);
  });

  it('excludes tags already on this recipe', () => {
    expect(suggestTags(recipes, ['quick'])).toEqual(['vegan', 'spicy']);
  });

  it('respects the limit', () => {
    expect(suggestTags(recipes, [], 2)).toEqual(['quick', 'vegan']);
  });

  it('handles a zero or negative limit without throwing', () => {
    expect(suggestTags(recipes, [], 0)).toEqual([]);
    expect(suggestTags(recipes, [], -1)).toEqual([]);
  });

  it('tolerates recipes with no tags at all', () => {
    expect(suggestTags([{}, { tags: [] }], [])).toEqual([]);
  });

  // This walks every recipe in the family, so one corrupt value anywhere would otherwise throw
  // and take out the recipe FORM for every recipe — the widest blast radius of any of the
  // container guards.
  it.each([[42], ['autumn'], [null], [{}]])(
    'skips a recipe whose tags are not an array (%p) rather than throwing',
    (bad) => {
      const recipes = [{ tags: ['quick'] }, { tags: bad as never }, { tags: ['quick'] }];
      expect(() => suggestTags(recipes, [])).not.toThrow();
      expect(suggestTags(recipes, [])).toEqual(['quick']);
    }
  );
});

describe('matchTags', () => {
  const all = ['quick', 'weeknight', 'sweet', 'vegan', 'quick lunch'];

  it('returns nothing for an empty query, so the row stays quiet until typing', () => {
    expect(matchTags(all, '')).toEqual([]);
    expect(matchTags(all, '   ')).toEqual([]);
  });

  it('puts prefix matches before substring matches', () => {
    // "we" starts "weeknight" and merely appears inside "sweet".
    expect(matchTags(all, 'we')).toEqual(['weeknight', 'sweet']);
  });

  it('matches case-insensitively, the way storage normalises', () => {
    expect(matchTags(all, 'QUICK')).toEqual(['quick lunch']);
  });

  it('skips an exact match, which needs no completing', () => {
    expect(matchTags(all, 'quick')).toEqual(['quick lunch']);
  });

  it('preserves the incoming most-used-first ranking within each band', () => {
    expect(matchTags(['zeta quick', 'alpha quick'], 'quick')).toEqual([
      'zeta quick',
      'alpha quick',
    ]);
  });

  it('respects the limit', () => {
    expect(matchTags(all, 'e', 2)).toHaveLength(2);
  });

  it('returns nothing when nothing matches', () => {
    expect(matchTags(all, 'zzz')).toEqual([]);
  });

  it('handles an empty candidate list', () => {
    expect(matchTags([], 'quick')).toEqual([]);
  });
});
