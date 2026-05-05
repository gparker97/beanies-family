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
import { ACTIVITY_CATEGORIES } from '@/constants/activityCategories';

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
