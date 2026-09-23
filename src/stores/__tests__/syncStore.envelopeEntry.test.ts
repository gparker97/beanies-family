import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSyncStore } from '../syncStore';
import * as syncService from '@/services/sync/syncService';
import type { GlobalSettings } from '@/types/models';

/**
 * Mock preamble reused from `syncStore.openBaselineTerminus.test.ts` — instantiating
 * `useSyncStore` needs the whole IndexedDB/registry/worker surface stubbed, and duplicating
 * a divergent copy of that is how two harnesses quietly start testing different stores.
 */

const mockGlobalSettings: GlobalSettings = {
  id: 'global_settings',
  theme: 'system',
  language: 'en',
  lastActiveFamilyId: null,
  exchangeRates: [],
  exchangeRateAutoUpdate: true,
  exchangeRateLastFetch: null,
  isTrustedDevice: false,
  trustedDevicePromptShown: false,
};
let savedGlobalSettings = { ...mockGlobalSettings };

vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ ...mockGlobalSettings }),
  getGlobalSettings: vi.fn(async () => ({ ...savedGlobalSettings })),
  saveGlobalSettings: vi.fn(async (partial: Partial<GlobalSettings>) => {
    savedGlobalSettings = { ...savedGlobalSettings, ...partial, id: 'global_settings' };
    return { ...savedGlobalSettings };
  }),
  setGlobalTheme: vi.fn(),
  setGlobalLanguage: vi.fn(),
  setLastActiveFamilyId: vi.fn(),
  updateGlobalExchangeRates: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ id: 'app_settings', baseCurrency: 'USD', aiApiKeys: {} }),
  getSettings: vi.fn(async () => ({ id: 'app_settings', baseCurrency: 'USD', aiApiKeys: {} })),
  saveSettings: vi.fn(),
}));

// `activeFamilyId` non-null is what selects the branch that carried the bug —
// with no famId the replace path takes its `dropDoc` + adopt sub-branch, which
// already committed heads correctly.
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'family-123', activeFamilyName: 'Test Family' }),
}));

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'family-123'),
  getDatabase: vi.fn(async () => ({})),
  closeDatabase: vi.fn(async () => {}),
}));

vi.mock('@/services/registry/registryService', () => ({
  registerFamily: vi.fn(async () => {}),
  registerFamilyOrThrow: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
  lookupFamily: vi.fn(async () => null),
}));

vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({ hasFileSystemAccess: true }),
  canAutoSync: () => true,
  supportsFileSystemAccess: () => true,
  isNative: () => false,
}));

const fakeEnvelope = { version: '4.0', familyId: 'family-123', encryptedPayload: 'x' };

vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  // The version DERIVATION is real even where the writers are mocked: a

  // test-local `'4.0'` here would hide the one regression the derivation

  // exists to prevent (a compacted pod written as 4.0).

  beanpodVersionFor: (await importOriginal<typeof import('@/services/sync/fileSync')>())
    .beanpodVersionFor,
  createBeanpodV4: vi.fn(),
  parseBeanpodV4: vi.fn(() => fakeEnvelope),
  tryUnwrapFamilyKey: vi.fn(),
  reEncryptEnvelope: vi.fn(),
  exportToFile: vi.fn(async () => {}),
  importFromFile: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/services/sync/envelopeMerge', () => ({
  preserveLocalKeyDicts: vi.fn((remote: unknown) => remote),
  keyDictSize: vi.fn(() => 0),
  mergeEnvelopes: vi.fn((remote: unknown) => ({
    envelope: remote,
    needsPublish: false,
    filtered: 0,
  })),
  applyRevokedKeys: vi.fn((env: unknown) => ({ envelope: env, filtered: 0 })),
  mergeRevokedKeys: vi.fn((a: unknown, b: unknown) => ({ ...(a ?? {}), ...(b ?? {}) })),
  revocationTombstonesForMember: vi.fn(() => ({ tombstones: {}, unattributedPasskeys: 0 })),
  // Real behaviour, not a pass-through: `replaceEnvelope` strips the payload
  // from the long-lived envelope, and a stub that skipped it would hide a
  // regression in exactly the invariant this change introduces.
  withoutPayload: vi.fn((env: Record<string, unknown>) => ({ ...env, encryptedPayload: '' })),
}));

vi.mock('@/services/recurring/recurringProcessor', () => ({
  deduplicateRecurringTransactions: vi.fn(async () => 0),
}));

vi.mock('@/services/automerge/worker/docClient');
vi.mock('@/services/sync/syncService');

vi.mock('@/services/google/googleAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/google/googleAuth')>()),
  isTokenValid: vi.fn(() => true),
}));

describe('publishEnvelopeEntry — the rollback must not clobber a concurrent merge', () => {
  /**
   * The defect this pins, in one sentence: a merge updates syncService's envelope and NOT
   * `syncStore.envelope.value` (`syncService.ts` calls `setEnvelope(preserveLocalKeyDicts(...))`
   * with no path back into the store), so a rollback built from the store ref republishes a
   * PRE-MERGE snapshot and silently drops whatever the merge just brought in.
   *
   * The concrete loss is another member's key material. Here: a passkey wrap that arrives
   * while our publish is failing. Under the old code the rollback wrote an envelope without
   * it, and that envelope went to Drive AND to the worker cache — so the other member's
   * device could no longer unwrap the family key with their passkey.
   */
  const BASE = {
    version: '4.0',
    familyId: 'family-123',
    keyId: 'key-1',
    encryptedPayload: '',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
  } as unknown as Parameters<typeof syncService.setEnvelope>[0] & Record<string, unknown>;

  const PKG = {
    salt: 's',
    wrapped: 'w',
    tokenHash: 'h',
    keyId: 'key-1',
    createdAt: '2026-09-17T00:00:00.000Z',
    expiresAt: '2026-09-24T00:00:00.000Z',
  };

  /** What the merge brought in while our publish was in flight. */
  const ARRIVED_PASSKEY = { wrapped: 'other-member-wrap', hkdfSalt: 'salt', memberId: 'm-other' };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(syncService.getProviderType).mockReturnValue('google_drive');
  });

  it('re-reads the AUTHORITATIVE envelope on a clean failure, keeping merged-in key material', async () => {
    const committed: Array<Record<string, unknown>> = [];
    vi.mocked(syncService.setEnvelope).mockImplementation((env) => {
      committed.push(env as unknown as Record<string, unknown>);
    });

    // First read: the pre-publish envelope. Second read (the rollback's): the envelope as it
    // stands AFTER the merge that ran during the failed publish — our staged entry plus the
    // passkey that just arrived. This is exactly the divergence the helper exists for.
    vi.mocked(syncService.getEnvelope)
      .mockReturnValueOnce({ ...BASE } as never)
      .mockReturnValue({
        ...BASE,
        passkeyWrappedKeys: { 'cred-a': ARRIVED_PASSKEY },
        memberLinkKeys: { m1: PKG },
      } as never);

    // A CLEAN failure — not a timeout. Only this outcome may roll back.
    vi.mocked(syncService.save).mockResolvedValue(false);

    const store = useSyncStore();
    const saved = await store.setMemberLinkWrap('m1', PKG as never);

    expect(saved).toBe(false);

    const final = committed.at(-1)!;
    // The undo removed OUR key...
    expect((final.memberLinkKeys as Record<string, unknown>) ?? {}).not.toHaveProperty('m1');
    // ...and left the other member's freshly-merged passkey wrap alone. This is the
    // assertion that fails against a rollback built from the stale store ref.
    expect(final.passkeyWrappedKeys).toEqual({ 'cred-a': ARRIVED_PASSKEY });
  });

  it('does NOT roll back on a timeout — the write may still land', async () => {
    const committed: Array<Record<string, unknown>> = [];
    vi.mocked(syncService.setEnvelope).mockImplementation((env) => {
      committed.push(env as unknown as Record<string, unknown>);
    });
    vi.mocked(syncService.getEnvelope).mockReturnValue({ ...BASE } as never);
    // Never settles within the budget → 'timeout'. Undoing here could revert a rotation
    // that actually succeeded, so the entry must stay.
    vi.mocked(syncService.save).mockImplementation(() => new Promise<boolean>(() => {}));

    // Fake timers because the budget is a real 20s now — deliberately, since this publish
    // is a whole-pod upload the user is waiting on. Driving the clock keeps the test fast
    // without pretending the budget is smaller than it is.
    vi.useFakeTimers();
    const store = useSyncStore();
    const pending = store.setMemberLinkWrap('m1', PKG as never);
    await vi.advanceTimersByTimeAsync(21_000);
    const saved = await pending;
    vi.useRealTimers();

    expect(saved).toBe(false);
    expect(committed).toHaveLength(1); // the stage only — no second, undoing commit
    expect(committed[0]!.memberLinkKeys).toEqual({ m1: PKG });
  });

  // ── publishDeviceApprovalWrap: a timeout is not a failure ──
  // (no second `beforeEach` — the describe's own already resets pinia and the mocks.)

  it('REGRESSION: reports a timed-out publish as "timeout", not as a failure', async () => {
    // ⚠️ THE WHOLE POINT OF THE RETURN-TYPE WIDENING. This used to come back as `false`,
    // identical to a clean failure, and the approval sheet rendered any `false` as "we
    // couldn't save the approval". greg hit exactly that on a real device: told it had
    // failed, then watched the other device get in about ten seconds later.
    vi.mocked(syncService.setEnvelope).mockImplementation(() => {});
    vi.mocked(syncService.getEnvelope).mockReturnValue({ ...BASE } as never);
    vi.mocked(syncService.save).mockImplementation(() => new Promise<boolean>(() => {}));

    vi.useFakeTimers();
    const store = useSyncStore();
    const pending = store.publishDeviceApprovalWrap('m1', PKG as never);
    await vi.advanceTimersByTimeAsync(31_000);
    const outcome = await pending;
    vi.useRealTimers();

    expect(outcome).toBe('timeout');
    // And the guard that makes the widening safe: the value is TRUTHY, so any surviving
    // `if (!outcome)` call site would silently treat this as success.
    expect(Boolean(outcome)).toBe(true);
  });

  it('reports a clean failure as "failed", which IS an error the user must see', async () => {
    vi.mocked(syncService.setEnvelope).mockImplementation(() => {});
    vi.mocked(syncService.getEnvelope).mockReturnValue({ ...BASE } as never);
    vi.mocked(syncService.save).mockResolvedValue(false);

    const store = useSyncStore();
    expect(await store.publishDeviceApprovalWrap('m1', PKG as never)).toBe('failed');
  });

  it('reports a confirmed publish as "saved"', async () => {
    vi.mocked(syncService.setEnvelope).mockImplementation(() => {});
    vi.mocked(syncService.getEnvelope).mockReturnValue({ ...BASE } as never);
    vi.mocked(syncService.save).mockResolvedValue(true);

    const store = useSyncStore();
    expect(await store.publishDeviceApprovalWrap('m1', PKG as never)).toBe('saved');
  });
});
