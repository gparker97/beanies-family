/**
 * C10: a legacy `admin` keeps pod management through the role migration.
 *
 * Run through the REAL repository `applyDefaults` and the real projection, which is the
 * whole point: `applyDefaults` fills a missing `canManagePod` with `role === 'owner'`, so
 * the defaulted list `normalizeRoles` receives already says `false` for a legacy admin, and
 * `m.canManagePod ?? true` never reached its `true`. The mocked-repository suite could not
 * see that, because its fixture handed `normalizeRoles` an un-defaulted row.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/automerge/repositories/removedMemberRepository', () => ({
  getAllRemovedMembers: vi.fn(async () => []),
  removeMemberAndRecord: vi.fn(async () => {}),
}));

// The worker: apply each batched patch to the projection, as the real round trip does.
vi.mock('@/services/automerge/worker/docClient', async () => {
  const projection = await import('@/services/automerge/projection');
  return {
    mutate: vi.fn(
      async (op: {
        op: string;
        ops?: { collection: 'familyMembers'; id: string; patch: Record<string, unknown> }[];
      }) => {
        for (const p of op.ops ?? []) {
          const current = projection.getById(p.collection, p.id) as unknown as Record<
            string,
            unknown
          >;
          projection.applyDelta({
            kind: 'upsert',
            collection: p.collection,
            id: p.id,
            entity: { ...current, ...p.patch } as never,
          });
        }
      }
    ),
  };
});
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(() => ({ currentUser: null, updateCurrentUserRole: vi.fn() })),
}));

import { useFamilyStore } from '../familyStore';
import { applyDelta, getById, resetProjection } from '@/services/automerge/projection';
import { mutate } from '@/services/automerge/worker/docClient';

function seed(row: Record<string, unknown>): void {
  applyDelta({
    kind: 'upsert',
    collection: 'familyMembers',
    id: row.id as string,
    entity: {
      name: String(row.id),
      email: `${String(row.id)}@example.com`,
      color: '#000',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      passwordHash: 'h',
      ...row,
    } as never,
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  resetProjection();
});

describe('normalizeRoles reads the stored flag, not the defaulted one (C10)', () => {
  it('a legacy admin with no stored canManagePod becomes a member WHO STILL MANAGES the pod', async () => {
    seed({ id: 'owner', role: 'owner', createdAt: '2025-01-01T00:00:00.000Z' });
    seed({ id: 'legacy-admin', role: 'admin' }); // no canManagePod stored at all

    const store = useFamilyStore();
    await store.loadMembers();

    expect(mutate).toHaveBeenCalledOnce();
    const stored = getById('familyMembers', 'legacy-admin') as unknown as Record<string, unknown>;
    expect(stored.role).toBe('member');
    expect(stored.canManagePod).toBe(true);
    expect(store.members.find((m) => m.id === 'legacy-admin')?.canManagePod).toBe(true);
  });

  it('an admin whose flag was explicitly turned off keeps it off', async () => {
    seed({ id: 'owner', role: 'owner', createdAt: '2025-01-01T00:00:00.000Z' });
    seed({ id: 'demoted-admin', role: 'admin', canManagePod: false });

    const store = useFamilyStore();
    await store.loadMembers();

    const stored = getById('familyMembers', 'demoted-admin') as unknown as Record<string, unknown>;
    expect(stored.role).toBe('member');
    expect(stored.canManagePod).toBe(false);
  });
});
