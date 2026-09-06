import { describe, it, expect, beforeEach, vi } from 'vitest';

// Real syncService, re-imported per test to reset module-level state.
let syncService: typeof import('../syncService');

// Mock the heavy module-level dependencies syncService pulls in (same set the
// other syncService unit tests stub) — this test only exercises the pure
// byte-size tracking, so none of these need real behavior.
vi.mock('../capabilities', () => ({
  supportsFileSystemAccess: vi.fn(() => false),
}));
vi.mock('../fileHandleStore', () => ({
  getFileHandle: vi.fn(async () => null),
  verifyPermission: vi.fn(async () => true),
  getProviderConfig: vi.fn(async () => null),
}));
vi.mock('../fileSync', async (importOriginal) => ({
  // The version DERIVATION is real even where the writers are mocked: a
  // test-local `'4.0'` here would hide the one regression the derivation
  // exists to prevent (a compacted pod written as 4.0).
  beanpodVersionFor: (await importOriginal<typeof import('../fileSync')>()).beanpodVersionFor,
  reEncryptEnvelope: vi.fn(async () => '{"version":"4.0"}'),
  parseBeanpodV4: vi.fn(() => ({})),
  detectFileVersion: vi.fn(() => 4),
  openFilePicker: vi.fn(async () => null),
}));
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'test-family-id'),
}));
vi.mock('@/services/familyContext', () => ({
  createFamilyWithId: vi.fn(async () => {}),
}));
vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(),
  persistEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'base64-payload==' })),
  mergeRemoteEnvelope: vi.fn(async () => ({ dirty: false })),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

describe('syncService — persisted byte-size tracking', () => {
  beforeEach(async () => {
    vi.resetModules();
    syncService = await import('../syncService');
  }, 30000);

  it('starts null before anything is persisted or loaded', () => {
    expect(syncService.getLastPersistedBytes()).toBeNull();
  });

  it('records the UTF-8 byte length of the envelope string', () => {
    syncService.recordPersistedBytes('abcde'); // 5 ASCII bytes
    expect(syncService.getLastPersistedBytes()).toBe(5);
  });

  it('counts multibyte characters by their true UTF-8 byte length, not code units', () => {
    // '✓' is one UTF-16 code unit but three UTF-8 bytes — String.length would lie.
    syncService.recordPersistedBytes('a✓');
    expect(syncService.getLastPersistedBytes()).toBe(4);
  });

  it('overwrites the previous value on each record', () => {
    syncService.recordPersistedBytes('abcde');
    syncService.recordPersistedBytes('ab');
    expect(syncService.getLastPersistedBytes()).toBe(2);
  });

  it('clears to null on reset()', () => {
    syncService.recordPersistedBytes('abcde');
    syncService.reset();
    expect(syncService.getLastPersistedBytes()).toBeNull();
  });
});

/**
 * `cancelPendingSave` returns whether it actually cancelled something, and
 * `reloadAllStores` uses that return to put the publish back afterwards. If the
 * return ever stops tracking the timer, every store-side test still passes
 * (they mock this module) while the real app silently drops publishes again —
 * which is the bug, four times over. So the contract is pinned here, against
 * the real implementation.
 */
describe('syncService — cancelPendingSave reports what it cancelled', () => {
  beforeEach(async () => {
    vi.resetModules();
    syncService = await import('../syncService');
  }, 30000);

  it('reports false when nothing was armed', () => {
    expect(syncService.cancelPendingSave()).toBe(false);
  });

  it('reports true for an armed save, then false once it is gone', () => {
    syncService.triggerDebouncedSave();
    expect(syncService.cancelPendingSave()).toBe(true);
    // Idempotent: a second cancel has nothing left to take.
    expect(syncService.cancelPendingSave()).toBe(false);
  });
});
