import { describe, it, expect } from 'vitest';
import { parseExtractionResult, CATEGORY_OPTIONS_TEXT } from '../extractionPrompt';
import { getActivityCategoriesGrouped } from '@/constants/activityCategories';

// A minimal valid model object (all REQUIRED_KEYS present) the parser accepts.
function rawEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isEvent: true,
    title: 'X',
    date: '',
    startTime: '',
    endTime: '',
    isAllDay: false,
    location: '',
    description: '',
    confidence: {},
    ...overrides,
  };
}

describe('parseExtractionResult — optional category field', () => {
  it('includes category when the model returns a non-empty string', () => {
    const parsed = parseExtractionResult(rawEvent({ category: 'field_trip' }));
    expect(parsed.category).toBe('field_trip');
  });

  it('omits category entirely when absent (backward-compat: older Lambda / BYOK)', () => {
    const parsed = parseExtractionResult(rawEvent());
    expect('category' in parsed).toBe(false);
  });

  it('omits category when empty string', () => {
    const parsed = parseExtractionResult(rawEvent({ category: '' }));
    expect('category' in parsed).toBe(false);
  });

  it('coerces a non-string category to absent (no throw)', () => {
    const parsed = parseExtractionResult(rawEvent({ category: 123 }));
    expect('category' in parsed).toBe(false);
  });
});

describe('CATEGORY_OPTIONS_TEXT — taxonomy sync guard', () => {
  // The literal is hardcoded byte-identical across the three prompt copies (drift guard) because
  // the .mjs copies can't import the taxonomy. This asserts the (importable) client copy stays in
  // sync with ACTIVITY_CATEGORIES — fails CI if a category is added/renamed without regenerating
  // the literal in all three prompt copies. The builder below IS the executable spec of the recipe.
  it('matches the grouped taxonomy rendering one line per group as `id (Name)`', () => {
    const expected = getActivityCategoriesGrouped()
      .map((g) => `${g.name}: ${g.categories.map((c) => `${c.id} (${c.name})`).join(', ')}`)
      .join('\n');
    expect(CATEGORY_OPTIONS_TEXT).toBe(expected);
  });
});
