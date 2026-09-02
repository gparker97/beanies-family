import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `memberColors.ts` is imported by every member face in the app and by the beanie
 * wall, which is lint-fenced against finance stores. Until 2026-09-02 it
 * re-exported `HERITAGE_ORANGE` FROM `useActivityChipClass`, which imports
 * `useFamilyStore` and `useMemberInfo` — and `useMemberInfo` statically imported
 * `useAccountsStore`. So a "constants" file quietly dragged a finance store into
 * every avatar, and `wallActivities.ts` reached `accountsStore` from inside the
 * wall's own lint zone, which catches DIRECT imports only and could never see it.
 *
 * A grep for `accountsStore` would not have caught that — the path was three hops
 * long. This asserts the only thing that actually holds: the file imports nothing.
 */
describe('memberColors module graph', () => {
  it('has zero imports, so it cannot drag a store into an avatar or into the wall', () => {
    const src = readFileSync(resolve(__dirname, '../memberColors.ts'), 'utf8');
    const imports = src.match(/^\s*(import|export)\s.*\sfrom\s+['"].+['"]/gm) ?? [];
    expect(imports).toEqual([]);
  });
});

describe('useMemberInfo module graph', () => {
  it('does not import a finance store', () => {
    // Its two account-keyed helpers moved to `useAccountMemberInfo` so that member
    // name/colour lookups — which the wall does constantly — stop pulling accountsStore.
    const src = readFileSync(resolve(__dirname, '../../composables/useMemberInfo.ts'), 'utf8');
    expect(src).not.toMatch(
      /from\s+['"]@\/stores\/(accounts|transactions|budget|goals|assets|recurring)Store['"]/
    );
  });
});
