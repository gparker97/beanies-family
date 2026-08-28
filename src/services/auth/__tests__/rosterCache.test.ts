import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FamilyMember } from '@/types/models';

// The service reads the active family synchronously from the database module and the
// family name from familyContext — mock both so the test controls them without booting
// the whole registry bootstrap path.
const getActiveFamilyId = vi.fn<() => string | null>();
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: () => getActiveFamilyId(),
}));
vi.mock('@/services/familyContext', () => ({
  getFamilyById: vi.fn(async (id: string) =>
    id === 'fam-1' ? { id, name: 'The Beans', createdAt: '', updatedAt: '' } : null
  ),
}));
const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

import { refreshRosterCache } from '@/services/auth/rosterCache';
import {
  getRosterCache,
  saveRosterCache,
  deleteRosterCache,
  clearAllRosterCache,
} from '@/services/indexeddb/repositories/rosterCacheRepository';

function member(overrides: Partial<FamilyMember>): FamilyMember {
  return {
    id: 'm-1',
    name: 'Alex',
    email: 'alex@temp.beanies.family',
    role: 'member',
    color: '#F15D22',
    ageGroup: 'adult',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  } as FamilyMember;
}

describe('rosterCache', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    getActiveFamilyId.mockReturnValue('fam-1');
    await clearAllRosterCache();
  });

  it('writes the minimal projection for humans, in the given order', async () => {
    await refreshRosterCache([
      member({ id: 'a', name: 'Mum', passwordHash: 'salt:hash' }),
      member({ id: 'b', name: 'Kid', ageGroup: 'child', passwordHash: undefined }),
    ]);

    const entry = await getRosterCache('fam-1');
    expect(entry).toBeDefined();
    expect(entry!.familyName).toBe('The Beans');
    expect(entry!.members.map((m) => m.id)).toEqual(['a', 'b']);
    expect(entry!.members[0]).toMatchObject({ name: 'Mum', hasCredential: true });
    expect(entry!.members[1]).toMatchObject({ name: 'Kid', hasCredential: false });
    // Minimal projection: no email/role/passwordHash ever lands in the cache.
    expect(Object.keys(entry!.members[0]!).sort()).toEqual([
      'ageGroup',
      'color',
      'gender',
      'hasCredential',
      'id',
      'name',
    ]);
  });

  it('filters pets out', async () => {
    await refreshRosterCache([
      member({ id: 'a', name: 'Mum' }),
      member({ id: 'p', name: 'Rex', isPet: true }),
    ]);
    const entry = await getRosterCache('fam-1');
    expect(entry!.members.map((m) => m.id)).toEqual(['a']);
  });

  it('no-ops on an empty list — the sign-out reset must not erase a good roster', async () => {
    await refreshRosterCache([member({ id: 'a' })]);
    await refreshRosterCache([]);
    const entry = await getRosterCache('fam-1');
    expect(entry!.members).toHaveLength(1);
  });

  it('no-ops with no active family (join/create before registration)', async () => {
    getActiveFamilyId.mockReturnValue(null);
    await refreshRosterCache([member({ id: 'a' })]);
    expect(await getRosterCache('fam-1')).toBeUndefined();
  });

  it('logs (never throws) when the write fails', async () => {
    getActiveFamilyId.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(refreshRosterCache([member({ id: 'a' })])).resolves.toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'login-flow',
        message: 'roster_cache_refresh_failed',
      })
    );
  });

  it('delete + clearAll remove entries', async () => {
    await refreshRosterCache([member({ id: 'a' })]);
    await deleteRosterCache('fam-1');
    expect(await getRosterCache('fam-1')).toBeUndefined();

    await saveRosterCache({
      familyId: 'fam-2',
      familyName: 'Other',
      members: [],
      cachedAt: '2026-08-28',
    });
    await clearAllRosterCache();
    expect(await getRosterCache('fam-2')).toBeUndefined();
  });
});
