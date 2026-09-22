/**
 * The create-path cross-family guard (2026-09-22).
 *
 * ⚠️ WHAT THIS EXISTS TO STOP, stated plainly because the consequence is not recoverable.
 * `createNewFile` calls `provider.write()` DIRECTLY, so it skips `doSave()`'s cross-family guard.
 * On native the in-memory provider survives a Drive OAuth redirect (nothing unloads), so a
 * provider bound to a previously-active family reached a create write on a production iPhone on
 * 2026-09-21. It only failed because the two Google accounts differed and Drive answered 404. Had
 * they matched, the write would have SUCCEEDED and replaced that family's `.beanpod` with a new
 * envelope under a new family key — unreadable by every device holding the old one.
 *
 * The predicate deliberately mirrors `doSave()`'s shape rather than being stricter; the `null`
 * cases below are the reason why.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ activeFamilyId: { value: null as string | null } }));

// `setProvider` binds from `database.getActiveFamilyId()` — that module, not familyContext.
vi.mock('@/services/indexeddb/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveFamilyId: () => h.activeFamilyId.value,
}));

import { setProvider, reset, providerBelongsToAnotherFamily } from '../syncService';
import type { StorageProvider } from '@/services/sync/storageProvider';

/** The narrowest thing `setProvider` will accept — this suite only cares about the binding. */
function stubProvider(): StorageProvider {
  return {
    write: vi.fn(async () => undefined),
    read: vi.fn(async () => null),
    getFileId: () => 'file-1',
    getFileName: () => 'stub.beanpod',
    getDisplayName: () => 'stub.beanpod',
    getType: () => 'local',
  } as unknown as StorageProvider;
}

describe('providerBelongsToAnotherFamily', () => {
  beforeEach(() => {
    h.activeFamilyId.value = null;
    reset();
  });

  it('is false when no provider is installed at all', () => {
    expect(providerBelongsToAnotherFamily('fam-A')).toBe(false);
  });

  it('is false for a provider bound to THIS family', () => {
    h.activeFamilyId.value = 'fam-A';
    setProvider(stubProvider());
    expect(providerBelongsToAnotherFamily('fam-A')).toBe(false);
  });

  it('is TRUE for a provider bound to a different family — the data-loss case', () => {
    h.activeFamilyId.value = 'fam-A';
    setProvider(stubProvider());
    expect(providerBelongsToAnotherFamily('fam-D')).toBe(true);
  });

  it('is false for a NULL-bound provider, deliberately matching doSave()', () => {
    // `null` means "not yet known", not "foreign". A provider installed before `signUp` activates
    // the family has no binding yet. Being stricter than the guard this twins would refuse
    // legitimate installs while catching nothing extra: every stale provider that can actually
    // reach a create write IS family-bound.
    h.activeFamilyId.value = null;
    setProvider(stubProvider());
    expect(providerBelongsToAnotherFamily('fam-D')).toBe(false);
  });

  it("binds to the family the CALLER names, not the database's active one", () => {
    // ⚠️ THE REASON THE PARAMETER EXISTS. After a failed `switchFamily` the database's active id
    // can still be the PREVIOUS family, so binding from it made the guard refuse the provider it
    // had just installed — forever. The create seams pass the id they later compare against.
    h.activeFamilyId.value = 'fam-A';
    setProvider(stubProvider(), 'fam-B');
    expect(providerBelongsToAnotherFamily('fam-B')).toBe(false);
    expect(providerBelongsToAnotherFamily('fam-A')).toBe(true);
  });

  it('falls back to the active family when the caller names none', () => {
    // ⚠️ THE `true` HALF IS WHAT MAKES THIS TEST ABLE TO FAIL. `false` for `fam-A` is also the
    // answer when the binding is `null`, which the case above establishes is deliberate — so on
    // its own this assertion stays green even if the `?? getActiveFamilyId()` fallback is deleted.
    h.activeFamilyId.value = 'fam-A';
    setProvider(stubProvider(), undefined);
    expect(providerBelongsToAnotherFamily('fam-A')).toBe(false);
    expect(providerBelongsToAnotherFamily('fam-B')).toBe(true);
  });
});
