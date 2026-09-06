import { describe, it, expect, beforeEach, vi } from 'vitest';

// B3: `selectNativeLocalFile` must namespace the app-managed filename by familyId so
// a restored backup of family B (named identically to an existing local family A) can
// NEVER clobber A's local pod. Two families → two distinct filenames.

let syncService: typeof import('../syncService');

const { mockGetActiveFamilyId, capacitorPaths } = vi.hoisted(() => ({
  mockGetActiveFamilyId: vi.fn<() => string | null>(() => null),
  capacitorPaths: [] as string[],
}));

// Capture the exact path each CapacitorFileProvider is constructed with.
vi.mock('../providers/capacitorFileProvider', () => ({
  CapacitorFileProvider: class {
    path: string;
    type = 'local' as const;
    constructor(path: string) {
      this.path = path;
      capacitorPaths.push(path);
    }
    persist = vi.fn(async () => {});
    getDisplayName() {
      return this.path;
    }
    supportsLocalPolling() {
      return undefined;
    }
  },
}));

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: () => mockGetActiveFamilyId(),
}));
vi.mock('../capabilities', () => ({ supportsFileSystemAccess: vi.fn(() => false) }));
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
  openFilePicker: vi.fn(async () => null),
}));
vi.mock('@/services/familyContext', () => ({ createFamilyWithId: vi.fn(async () => {}) }));
vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(),
  persistEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'base64==' })),
  mergeRemoteEnvelope: vi.fn(async () => ({ dirty: false })),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

describe('syncService.selectNativeLocalFile — B3 familyId namespacing', () => {
  beforeEach(async () => {
    vi.resetModules();
    capacitorPaths.length = 0;
    mockGetActiveFamilyId.mockReturnValue(null);
    syncService = await import('../syncService');
  });

  it('namespaces the filename by the active familyId', async () => {
    mockGetActiveFamilyId.mockReturnValue('fam-A');

    const ok = await syncService.selectNativeLocalFile('my-family');

    expect(ok).toBe(true);
    expect(capacitorPaths).toEqual(['my-family-fam-A.beanpod']);
  });

  it('gives two families with the same name DISTINCT files (no clobber)', async () => {
    mockGetActiveFamilyId.mockReturnValue('fam-A');
    await syncService.selectNativeLocalFile('smith');
    mockGetActiveFamilyId.mockReturnValue('fam-B');
    await syncService.selectNativeLocalFile('smith');

    expect(capacitorPaths).toEqual(['smith-fam-A.beanpod', 'smith-fam-B.beanpod']);
    expect(new Set(capacitorPaths).size).toBe(2); // never the same path
  });

  it('falls back to the bare name when familyId is unknown (no regression)', async () => {
    mockGetActiveFamilyId.mockReturnValue(null);

    await syncService.selectNativeLocalFile('my-family');

    expect(capacitorPaths).toEqual(['my-family.beanpod']);
  });
});
