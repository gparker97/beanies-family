/**
 * `canViewFinances` default matrix (#79 review).
 *
 * A CHILD does not get the finances by default. The default applies only where no
 * value is STORED, so a grown-up's explicit choice always wins in either direction —
 * that is what keeps this rule from silently overriding a deliberate setting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('../../automergeRepository', () => ({
  createAutomergeRepository: (
    _table: string,
    opts: { transform: (m: Record<string, unknown>) => Record<string, unknown> }
  ) => ({
    getAll: async () => store.rows.map(opts.transform),
    getById: vi.fn(),
    create: vi.fn(),
    createWithId: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }),
}));

import { getAllFamilyMembers } from '../familyMemberRepository';

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return { id: 'm1', name: 'X', role: 'member', ...overrides };
}

beforeEach(() => {
  store.rows = [];
});

describe('canViewFinances default matrix', () => {
  it('a child with no stored value does NOT get the finances', async () => {
    store.rows = [row({ ageGroup: 'child' })];
    const [m] = await getAllFamilyMembers();
    expect(m!.canViewFinances).toBe(false);
  });

  it('an adult with no stored value still does', async () => {
    store.rows = [row({ ageGroup: 'adult' })];
    const [m] = await getAllFamilyMembers();
    expect(m!.canViewFinances).toBe(true);
  });

  it('a legacy row with no ageGroup reads as an adult, so nothing is taken away', async () => {
    store.rows = [row({})];
    const [m] = await getAllFamilyMembers();
    expect(m!.ageGroup).toBe('adult');
    expect(m!.canViewFinances).toBe(true);
  });

  it("a grown-up's explicit choice wins in BOTH directions", async () => {
    store.rows = [
      row({ id: 'a', ageGroup: 'child', canViewFinances: true }),
      row({ id: 'b', ageGroup: 'adult', canViewFinances: false }),
    ];
    const [child, adult] = await getAllFamilyMembers();
    expect(child!.canViewFinances).toBe(true);
    expect(adult!.canViewFinances).toBe(false);
  });
});
