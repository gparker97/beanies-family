/**
 * Config invariant tests — every invariant the rest of the codebase
 * relies on is asserted here. If these break, something upstream of
 * the FAB is also broken.
 */
import { describe, it, expect } from 'vitest';
import {
  QUICK_ADD_ITEMS,
  QUICK_ADD_BY_GROUP,
  QUICK_ADD_BY_GROUP_FILTERED,
  QUICK_ADD_CONTEXT_KEYS,
  VALID_ACTIONS,
  type QuickAddAction,
  type QuickAddContextKey,
  type QuickAddGroup,
  type QuickAddItem,
} from '@/constants/quickAddItems';

// The raw `QUICK_ADD_ITEMS` tuple carries narrowly-typed literals per
// element (good for deriving QuickAddAction) but makes iteration
// awkward — TS doesn't see `contextKey` as a property on items that
// don't set it. The exported `QuickAddItem` interface has the right
// optional fields, so we cast the array once here for iteration.
const ITEMS: readonly QuickAddItem[] = QUICK_ADD_ITEMS;

const ALLOWED_GROUPS: readonly QuickAddGroup[] = ['everyday', 'family', 'money', 'care'];
const ALLOWED_CONTEXT_KEYS: readonly QuickAddContextKey[] = [
  'memberId',
  'recipeId',
  'vacationId',
  'medicationId',
];

describe('QUICK_ADD_ITEMS — invariants', () => {
  it('has exactly 20 items (4 groups: 7 everyday + 5 family + 4 money + 4 care)', () => {
    expect(QUICK_ADD_ITEMS).toHaveLength(20);
    expect(QUICK_ADD_ITEMS.filter((i) => i.group === 'everyday')).toHaveLength(9);
    expect(QUICK_ADD_ITEMS.filter((i) => i.group === 'family')).toHaveLength(3);
    expect(QUICK_ADD_ITEMS.filter((i) => i.group === 'money')).toHaveLength(4);
    expect(QUICK_ADD_ITEMS.filter((i) => i.group === 'care')).toHaveLength(4);
  });

  it('the main FAB menu shows nine Everyday tiles (three full rows) and two Family tiles', () => {
    // greg, 2026-11-13: Everyday grew from six to nine. Chore (#146) is one of the nine and is
    // hidden while its gate is off, so production shows eight until the choreboard ships.
    const inMainMenu = (g: string) => ITEMS.filter((i) => i.group === g && !i.onlyWhenFiltered);
    expect(inMainMenu('everyday')).toHaveLength(9);
    expect(inMainMenu('everyday').filter((i) => i.requiresFlag === 'choreboard')).toHaveLength(1);
    expect(inMainMenu('family')).toHaveLength(2);
  });

  it('has unique item ids', () => {
    const ids = QUICK_ADD_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique (group, order) pairs', () => {
    const keys = QUICK_ADD_ITEMS.map((i) => `${i.group}:${i.order}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has unique action strings', () => {
    const actions = QUICK_ADD_ITEMS.map((i) => i.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('every group is one of the allowed values', () => {
    for (const item of QUICK_ADD_ITEMS) {
      expect(ALLOWED_GROUPS).toContain(item.group);
    }
  });

  it('every contextKey (when present) is one of the allowed values', () => {
    for (const item of ITEMS) {
      if (item.contextKey) {
        expect(ALLOWED_CONTEXT_KEYS).toContain(item.contextKey);
      }
    }
  });

  it('every labelKey and hintKey lives under the quickAdd.* namespace', () => {
    for (const item of QUICK_ADD_ITEMS) {
      expect(item.labelKey).toMatch(/^quickAdd\./);
      expect(item.hintKey).toMatch(/^quickAdd\./);
    }
  });

  it('every route starts with a slash', () => {
    for (const item of QUICK_ADD_ITEMS) {
      expect(item.route.startsWith('/')).toBe(true);
    }
  });
});

describe('VALID_ACTIONS — runtime guard set', () => {
  it('is exactly the set of action strings from QUICK_ADD_ITEMS', () => {
    const fromConfig = new Set(QUICK_ADD_ITEMS.map((i) => i.action));
    expect(VALID_ACTIONS.size).toBe(fromConfig.size);
    for (const a of fromConfig) {
      expect(VALID_ACTIONS.has(a)).toBe(true);
    }
  });

  it('rejects strings not in the config', () => {
    expect(VALID_ACTIONS.has('add-nonsense')).toBe(false);
    expect(VALID_ACTIONS.has('')).toBe(false);
    expect(VALID_ACTIONS.has('add')).toBe(false); // bare "add" is no longer valid
  });
});

describe('QUICK_ADD_BY_GROUP — pre-computed index', () => {
  it('contains entries for every allowed group', () => {
    for (const g of ALLOWED_GROUPS) {
      expect(QUICK_ADD_BY_GROUP[g]).toBeDefined();
      expect(QUICK_ADD_BY_GROUP[g].length).toBeGreaterThan(0);
    }
  });

  it('items within each group are sorted by order ascending', () => {
    for (const g of ALLOWED_GROUPS) {
      const orders = QUICK_ADD_BY_GROUP[g].map((i) => i.order);
      const sorted = [...orders].sort((a, b) => a - b);
      expect(orders).toEqual(sorted);
    }
  });

  it('union of all groups equals the full config', () => {
    const flat = ALLOWED_GROUPS.flatMap((g) => [...QUICK_ADD_BY_GROUP[g]]);
    expect(flat).toHaveLength(QUICK_ADD_ITEMS.length);
  });
});

describe('the main menu vs a filtered sheet (owner decision 2026-11-13)', () => {
  const ids = (items: readonly QuickAddItem[]) => items.map((i) => i.id);

  it('the main menu: nine Everyday tiles (recipe and milestone last) and two Family tiles', () => {
    const main = (g: QuickAddGroup) => QUICK_ADD_BY_GROUP[g].filter((i) => !i.onlyWhenFiltered);
    expect(ids(main('everyday'))).toEqual([
      'activity',
      'todo',
      'transaction',
      'trip',
      'cook-log',
      'list',
      'chore',
      'recipe',
      'milestone',
    ]);
    expect(ids(main('family'))).toEqual(['favorite', 'saying']);
  });

  it('a filtered sheet keeps the pre-move sections: recipe and milestone under Family', () => {
    // Exactly the HEAD-of-2026-11-12 index, so the Family Scrapbook's sheet (saying, favorite,
    // note, milestone) still draws all four under Family and none under the Everyday kicker.
    expect(ids(QUICK_ADD_BY_GROUP_FILTERED.everyday)).toEqual([
      'activity',
      'todo',
      'transaction',
      'trip',
      'cook-log',
      'list',
      'chore',
    ]);
    expect(ids(QUICK_ADD_BY_GROUP_FILTERED.family)).toEqual([
      'favorite',
      'saying',
      'recipe',
      'milestone',
      'note',
    ]);
    const scrapbook = ['add-saying', 'add-favorite', 'add-note', 'add-milestone'];
    const inScrapbook = (g: QuickAddGroup) =>
      ids(QUICK_ADD_BY_GROUP_FILTERED[g].filter((i) => scrapbook.includes(i.action)));
    expect(inScrapbook('everyday')).toEqual([]);
    expect(inScrapbook('family')).toEqual(['favorite', 'saying', 'milestone', 'note']);
  });

  it('the filtered index holds every item once, and money and care are unchanged', () => {
    const flat = ALLOWED_GROUPS.flatMap((g) => ids(QUICK_ADD_BY_GROUP_FILTERED[g]));
    expect(new Set(flat).size).toBe(QUICK_ADD_ITEMS.length);
    expect(QUICK_ADD_BY_GROUP_FILTERED.money).toEqual(QUICK_ADD_BY_GROUP.money);
    expect(QUICK_ADD_BY_GROUP_FILTERED.care).toEqual(QUICK_ADD_BY_GROUP.care);
  });
});

describe('QUICK_ADD_CONTEXT_KEYS', () => {
  it('lists all four allowed context keys', () => {
    expect([...QUICK_ADD_CONTEXT_KEYS].sort()).toEqual([...ALLOWED_CONTEXT_KEYS].sort());
  });
});

describe('derived QuickAddAction type', () => {
  it('type-checks against a literal union derived from the config', () => {
    // Compile-time check: every literal below must be a valid action.
    // The test itself is the assertion — if a field name drifts, tsc
    // fails the build.
    const samples: QuickAddAction[] = [
      'add-activity',
      'add-todo',
      'add-list',
      'add-chore',
      'add-transaction',
      'add-trip',
      'add-cooklog',
      'add-saying',
      'add-favorite',
      'add-note',
      'add-recipe',
      'add-milestone',
      'add-account',
      'add-budget',
      'add-asset',
      'add-goal',
      'add-medication',
      'add-dose-log',
      'add-allergy',
      'add-emergency',
    ];
    expect(samples).toHaveLength(QUICK_ADD_ITEMS.length);
    for (const s of samples) {
      expect(VALID_ACTIONS.has(s)).toBe(true);
    }
  });
});
