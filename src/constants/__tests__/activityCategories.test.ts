/**
 * Structural invariant: every activity category must appear in all three
 * sources of truth.
 *
 * 1. ACTIVITY_CATEGORIES (src/constants/activityCategories.ts) — runtime
 *    list rendered in the picker
 * 2. ActivityCategory union (src/types/models.ts) — TypeScript type that
 *    gates the FamilyActivity.category field
 * 3. activityCategoryToExpenseCategory mapping (src/constants/categories.ts)
 *    — translates an activity category into the expense category used when
 *    the activity has a fee linked to a transaction
 *
 * Drift between any two of these sources has happened in practice (the
 * 2026-05-03 Entertainment group ship landed in the runtime list and the
 * mapping but missed the type union; the 2026-05-04 Food group ship
 * caught field_trip missing from the mapping). This test parses the
 * source files and asserts the three sets are equal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIVITY_CATEGORIES, ACTIVITY_GROUP_EMOJI_MAP } from '@/constants/activityCategories';
import { UI_STRINGS } from '@/services/translation/uiStrings';

const PROJECT_ROOT = process.cwd();
const MODELS_PATH = join(PROJECT_ROOT, 'src', 'types', 'models.ts');
const CATEGORIES_PATH = join(PROJECT_ROOT, 'src', 'constants', 'categories.ts');

function extractActivityCategoryUnion(): Set<string> {
  const src = readFileSync(MODELS_PATH, 'utf-8');
  const match = src.match(/export type ActivityCategory =([\s\S]*?);/);
  if (!match) throw new Error('Could not locate ActivityCategory union in models.ts');
  const ids = new Set<string>();
  for (const line of match[1].split('\n')) {
    const m = line.match(/\|\s*'([^']+)'/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

function extractMappingKeys(): Set<string> {
  const src = readFileSync(CATEGORIES_PATH, 'utf-8');
  const match = src.match(
    /function activityCategoryToExpenseCategory[\s\S]*?const mapping[^{]*{([\s\S]*?)\n\s*};/
  );
  if (!match) throw new Error('Could not locate activityCategoryToExpenseCategory mapping');
  const ids = new Set<string>();
  for (const line of match[1].split('\n')) {
    const m = line.match(/^\s*([a-z_]+):\s*'/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

describe('activity category sources stay in sync', () => {
  const runtimeIds = new Set(ACTIVITY_CATEGORIES.map((c) => c.id));
  const typeIds = extractActivityCategoryUnion();
  const mappingIds = extractMappingKeys();

  it('every ACTIVITY_CATEGORIES id is in the ActivityCategory union', () => {
    const missing = [...runtimeIds].filter((id) => !typeIds.has(id)).sort();
    expect(missing).toEqual([]);
  });

  it('every ActivityCategory union member is in ACTIVITY_CATEGORIES', () => {
    const orphans = [...typeIds].filter((id) => !runtimeIds.has(id)).sort();
    expect(orphans).toEqual([]);
  });

  it('every ACTIVITY_CATEGORIES id is in activityCategoryToExpenseCategory', () => {
    const missing = [...runtimeIds].filter((id) => !mappingIds.has(id)).sort();
    expect(missing).toEqual([]);
  });

  it('every activityCategoryToExpenseCategory key is in ACTIVITY_CATEGORIES', () => {
    const orphans = [...mappingIds].filter((id) => !runtimeIds.has(id)).sort();
    expect(orphans).toEqual([]);
  });
});

describe('activity category presentation invariants', () => {
  it('every group used by a category has a header emoji', () => {
    const usedGroups = [...new Set(ACTIVITY_CATEGORIES.map((c) => c.group))].sort();
    const missing = usedGroups.filter((g) => !ACTIVITY_GROUP_EMOJI_MAP[g]);
    // A missing entry would silently render the 📌 fallback in the picker instead
    // of failing — so guard it here.
    expect(missing).toEqual([]);
  });

  it('no two categories within a group share an exact color', () => {
    const byGroup = new Map<string, Map<string, string>>();
    const collisions: string[] = [];
    for (const cat of ACTIVITY_CATEGORIES) {
      const seen = byGroup.get(cat.group) ?? new Map<string, string>();
      const prior = seen.get(cat.color);
      if (prior) collisions.push(`${cat.group}: ${prior} & ${cat.id} both use ${cat.color}`);
      seen.set(cat.color, cat.id);
      byGroup.set(cat.group, seen);
    }
    expect(collisions).toEqual([]);
  });
});

describe('activity category i18n keys mirror the constant', () => {
  // Category/group display is resolved via `useActivityCategoryLabel` →
  // `t('planner.category.<id>')` / `t('planner.group.<slug>')`, whose `en` value
  // MUST equal the constant name (English is constant-driven; the keys add the
  // zh layer). A missing/stale key would silently fall back, masking the gap —
  // so pin it.
  const en = UI_STRINGS as Record<string, string>;

  it('every category id has a planner.category.<id> key (zh source text)', () => {
    // English category labels are now resolved from the constant directly
    // (`useActivityCategoryLabel` short-circuits English), so the `en` value no longer
    // has to MATCH the name — but the key must still EXIST so the zh
    // `npm run translate` pipeline has source text for every id.
    const missing = ACTIVITY_CATEGORIES.filter((cat) => !en[`planner.category.${cat.id}`]).map(
      (c) => c.id
    );
    expect(missing).toEqual([]);
  });

  it('every group has a planner.group.<slug> key whose en matches the group name', () => {
    const groups = [...new Set(ACTIVITY_CATEGORIES.map((c) => c.group))];
    const mismatches: string[] = [];
    for (const g of groups) {
      const got = en[`planner.group.${g.toLowerCase()}`];
      if (got !== g) mismatches.push(`${g}: key="${got ?? '(missing)'}"`);
    }
    expect(mismatches).toEqual([]);
  });
});
