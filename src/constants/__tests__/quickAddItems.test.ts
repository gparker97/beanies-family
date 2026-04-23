/**
 * Config invariant tests — every invariant the rest of the codebase
 * relies on is asserted here. If these break, something upstream of
 * the FAB is also broken.
 */
import { describe, it, expect } from 'vitest';
import {
  QUICK_ADD_ITEMS,
  QUICK_ADD_BY_GROUP,
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
  it('has exactly 19 items (4 groups: 6 everyday + 4 family + 5 money + 4 care)', () => {
    expect(QUICK_ADD_ITEMS).toHaveLength(19);
    expect(QUICK_ADD_ITEMS.filter((i) => i.group === 'everyday')).toHaveLength(6);
    expect(QUICK_ADD_ITEMS.filter((i) => i.group === 'family')).toHaveLength(4);
    expect(QUICK_ADD_ITEMS.filter((i) => i.group === 'money')).toHaveLength(5);
    expect(QUICK_ADD_ITEMS.filter((i) => i.group === 'care')).toHaveLength(4);
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
      'add-transaction',
      'add-trip',
      'add-cooklog',
      'add-saying',
      'add-favorite',
      'add-note',
      'add-recipe',
      'add-trip-idea',
      'add-account',
      'add-budget',
      'add-recurring',
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
