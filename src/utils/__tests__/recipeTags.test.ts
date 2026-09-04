import { describe, it, expect } from 'vitest';
import {
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
});
