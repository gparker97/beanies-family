/**
 * List templates (#114): the template the activity drawer marks "Suggested" is derived from the
 * activity's category, via its group or its exact id.
 */
import { describe, it, expect } from 'vitest';
import { ACTIVITY_CATEGORIES } from '@/constants/activityCategories';
import { LIST_TEMPLATES, suggestedListTemplateFor } from '@/constants/listTemplates';

describe('suggestedListTemplateFor', () => {
  it('suggests party prep for every Party-group category', () => {
    const party = ACTIVITY_CATEGORIES.filter((c) => c.group === 'Party');
    expect(party.length).toBeGreaterThan(0);
    for (const c of party) expect(suggestedListTemplateFor(c.id)?.key).toBe('party-prep');
  });

  it('suggests party prep for an office party (a Work-group category matched by id)', () => {
    expect(suggestedListTemplateFor('work_party')?.key).toBe('party-prep');
  });

  it.each(['field_trip', 'beach', 'pool', 'theme_park', 'picnic'])(
    'suggests vacation packing for a %s day out',
    (id) => {
      expect(suggestedListTemplateFor(id)?.key).toBe('vacation-packing');
    }
  );

  it('suggests nothing for sports, an unknown category or none', () => {
    expect(suggestedListTemplateFor('soccer')).toBeUndefined();
    expect(suggestedListTemplateFor('not-a-category')).toBeUndefined();
    expect(suggestedListTemplateFor(undefined)).toBeUndefined();
  });

  it('only names real activity category ids and groups', () => {
    const ids = new Set(ACTIVITY_CATEGORIES.map((c) => c.id));
    const groups = new Set(ACTIVITY_CATEGORIES.map((c) => c.group));
    for (const t of LIST_TEMPLATES) {
      for (const id of t.suggestFor?.categories ?? []) expect(ids.has(id)).toBe(true);
      for (const g of t.suggestFor?.groups ?? []) expect(groups.has(g)).toBe(true);
    }
  });
});
