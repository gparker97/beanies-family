/**
 * `requiresPassword` derivation matrix (Phase 4): "unclaimed" = has NO credential
 * at all. A PIN is a first-class claim credential — a PIN-only member (kit-born
 * family, or a set-pin join) must read as CLAIMED exactly like a password holder,
 * or old surfaces would re-invite them / exclude them from ownership transfer.
 * The repository derives this UNCONDITIONALLY on every read, so no stored value
 * can disagree with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('../../automergeRepository', () => ({
  createAutomergeRepository: (
    _table: string,
    opts: { transform: (m: Record<string, unknown>) => Record<string, unknown> }
  ) => ({
    getAll: async () => store.rows.map(opts.transform),
    getById: async (id: string) => {
      const row = store.rows.find((r) => r.id === id);
      return row ? opts.transform(row) : undefined;
    },
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

describe('requiresPassword derivation matrix', () => {
  it('PIN-only member (kit-born owner / set-pin joiner) reads as CLAIMED', async () => {
    store.rows = [row({ passwordHash: '', pinHash: 'salt:pin' })];
    const [m] = await getAllFamilyMembers();
    expect(m!.requiresPassword).toBe(false);
  });

  it('password-only legacy member reads as CLAIMED', async () => {
    store.rows = [row({ passwordHash: 'salt:hash' })];
    const [m] = await getAllFamilyMembers();
    expect(m!.requiresPassword).toBe(false);
  });

  it('fresh invitee (no credential at all) reads as UNCLAIMED', async () => {
    store.rows = [row({ passwordHash: '' })];
    const [m] = await getAllFamilyMembers();
    expect(m!.requiresPassword).toBe(true);
  });

  it('a stored requiresPassword value is overridden by the derivation', async () => {
    store.rows = [row({ passwordHash: '', pinHash: 'salt:pin', requiresPassword: true })];
    const [m] = await getAllFamilyMembers();
    expect(m!.requiresPassword).toBe(false);
  });
});
