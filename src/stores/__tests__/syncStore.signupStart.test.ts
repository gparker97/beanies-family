/**
 * #125: the step-1 registry write of the create wizard (`registerSignupStart`) and the
 * start-over tombstone (`abandonSignupStart`).
 *
 * Both are best-effort by contract: the wizard never waits on the first, start over is
 * never blocked by the second, and neither may reject. What these pin:
 *   - the step-1 payload carries ONE mode (`signupStart`), never `isSignupEvent`,
 *     `isLoginEvent` or `ownerSync`, matching the Lambda's mode precedence;
 *   - the "pod started" Slack line waits at most 5 s for the country, and the outcome is
 *     logged from the write's own settlement, so a slow write still reports the truth;
 *   - every outcome is logged with allowlisted keys only (`action` + `detail`).
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RegistryWriteResult } from '@/services/registry/registryService';

const { features, ctx, auth, registerFamily, removeFamily, slackNotify, logEvent } = vi.hoisted(
  () => ({
    features: { drive: true, oauthProxy: true, registry: true },
    ctx: {
      activeFamilyId: 'fam-1' as string | null,
      activeFamilyName: 'The Brambleworths' as string | null,
    },
    auth: {
      currentUser: {
        memberId: 'mem-1',
        email: 'owner@example.com',
        familyId: 'fam-1',
        displayName: 'Hazel',
      } as {
        memberId: string;
        email: string;
        familyId?: string;
        displayName?: string;
      } | null,
      newsletterOptIn: true,
      // #125: the ambient registry PUT is gated on a pod existing (`registerCurrentFamily`).
      podCreated: false,
    },
    registerFamily: vi.fn(),
    removeFamily: vi.fn(),
    slackNotify: vi.fn(),
    logEvent: vi.fn(),
  })
);

vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('../../services/sync/__mocks__/syncService');
  return {
    ...defaults,
    onSaveFailureChange: vi.fn(() => () => {}),
    onStateChange: vi.fn(() => () => {}),
    getState: vi.fn(() => ({
      isInitialized: true,
      isConfigured: false,
      fileName: null,
      isSyncing: false,
      lastError: null,
      saveQueued: false,
    })),
    initialize: vi.fn(async () => true),
    hasPermission: vi.fn(async () => true),
  };
});
vi.mock('@/services/google/googleAuth', () => ({
  whenRedirectAuthSettled: vi.fn(async () => {}),
  initializeAuth: vi.fn(async () => {}),
  migratePendingRefreshToken: vi.fn(async () => {}),
  requestAccessToken: vi.fn(async () => 'mock-token'),
  onTokenPermanentlyExpired: vi.fn(() => () => {}),
  onTokenAcquired: vi.fn(() => () => {}),
  fetchGoogleUserEmail: vi.fn(async () => null),
  getVerifiedGoogleAccountEmail: vi.fn(() => null),
  isSilentRefreshPending: vi.fn(() => false),
  isTokenValid: vi.fn(() => false),
  getLastSilentRefreshDiagnostics: vi.fn(() => null),
}));
vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({ googleDrive: true, manualSync: true }),
  canAutoSync: () => true,
  getPlatform: () => 'ios',
}));
vi.mock('@/services/sync/fileSync', () => ({
  reEncryptEnvelope: vi.fn(),
  parseBeanpodV4: vi.fn(() => ({})),
  createBeanpodV4: vi.fn(),
  tryUnwrapFamilyKey: vi.fn(),
}));
vi.mock('@/services/automerge/worker/docClient', () => ({}));
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({ GoogleDriveProvider: vi.fn() }));
vi.mock('@/services/google/driveService', () => ({
  searchBeanpodFilesGlobal: vi.fn(async () => []),
  clearFolderCache: vi.fn(),
  getAppFolderId: vi.fn(() => null),
  DriveApiError: class DriveApiError extends Error {},
}));
vi.mock('@/services/sync/offlineQueue', () => ({ clearQueue: vi.fn() }));
vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  saveSettings: vi.fn(async () => {}),
}));
// The REAL `signupStartDetail` (the pure mapping under test end to end); only the
// network-facing calls are doubles.
vi.mock('@/services/registry/registryService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/registry/registryService')>()),
  addRegistryEntryObserver: () => () => {},
  registerFamily,
  removeFamily,
}));
vi.mock('@/services/automerge/docService', () => ({ replaceDoc: vi.fn(), mergeDoc: vi.fn() }));
vi.mock('@/services/crypto/familyKeyService', () => ({
  generateFamilyKey: vi.fn(),
  deriveMemberKey: vi.fn(),
  wrapFamilyKey: vi.fn(),
}));
vi.mock('@/services/recurring/recurringProcessor', () => ({
  deduplicateRecurringTransactions: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/config/features', () => ({ features }));
vi.mock('@/utils/slackNotify', () => ({ slackNotify }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));
vi.mock('@/services/telemetry', () => ({ logEvent }));
vi.mock('@/utils/platformLabel', () => ({
  getPlatformLabel: () => 'App',
  getDeviceLabel: () => 'iPhone',
}));
vi.mock('@/utils/attributionStash', () => ({
  peekAttribution: () => ({ utm_source: 'chatgpt', utm_campaign: 'sg-pilot' }),
  clearAttribution: vi.fn(),
}));
vi.mock('@/utils/timeZone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/timeZone')>()),
  knownDeviceTimeZone: () => 'Asia/Singapore',
}));

const stubStore =
  (overrides: Record<string, unknown> = {}) =>
  () => ({
    reloadFromCRDT: vi.fn(async () => {}),
    reloadAll: vi.fn(async () => {}),
    reset: vi.fn(),
    ...overrides,
  });
vi.mock('@/stores/accountsStore', () => ({ useAccountsStore: stubStore() }));
vi.mock('@/stores/assetsStore', () => ({ useAssetsStore: stubStore() }));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: stubStore({
    owner: { id: 'mem-1', email: 'owner@example.com' },
    soleOwner: { id: 'mem-1', email: 'owner@example.com' },
    members: [{ id: 'mem-1' }],
  }),
}));
vi.mock('@/stores/goalsStore', () => ({ useGoalsStore: stubStore() }));
vi.mock('@/stores/recurringStore', () => ({ useRecurringStore: stubStore() }));
vi.mock('@/stores/todoStore', () => ({ useTodoStore: stubStore() }));
vi.mock('@/stores/activityStore', () => ({ useActivityStore: stubStore() }));
vi.mock('@/stores/vacationStore', () => ({ useVacationStore: stubStore() }));
vi.mock('@/stores/budgetStore', () => ({ useBudgetStore: stubStore() }));
vi.mock('@/stores/favoritesStore', () => ({ useFavoritesStore: stubStore() }));
vi.mock('@/stores/sayingsStore', () => ({ useSayingsStore: stubStore() }));
vi.mock('@/stores/memberNotesStore', () => ({ useMemberNotesStore: stubStore() }));
vi.mock('@/stores/allergiesStore', () => ({ useAllergiesStore: stubStore() }));
vi.mock('@/stores/medicationsStore', () => ({ useMedicationsStore: stubStore() }));
vi.mock('@/stores/recipesStore', () => ({ useRecipesStore: stubStore() }));
vi.mock('@/stores/emergencyContactsStore', () => ({ useEmergencyContactsStore: stubStore() }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: stubStore({ country: null }) }));
vi.mock('@/stores/familyContextStore', () => ({ useFamilyContextStore: () => ctx }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => auth }));
vi.mock('@/stores/transactionsStore', () => ({ useTransactionsStore: stubStore() }));
vi.mock('@/stores/syncHighlightStore', () => ({
  useSyncHighlightStore: stubStore({ clearHighlights: vi.fn() }),
}));

let useSyncStore: typeof import('@/stores/syncStore').useSyncStore;

/** Every `registry` log line the action under test emitted for `action`. */
function logged(action: string) {
  return logEvent.mock.calls
    .map(([e]) => e as { level: string; surface: string; context: Record<string, unknown> })
    .filter((e) => e.surface === 'registry' && e.context?.action === action);
}

function lastSlack(): string {
  return slackNotify.mock.calls.at(-1)![0] as string;
}

/** A write the test settles by hand, to model a slow or hung registry. */
function deferredWrite() {
  let resolve!: (r: RegistryWriteResult | null) => void;
  const promise = new Promise<RegistryWriteResult | null>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(async () => {
  vi.clearAllMocks();
  features.registry = true;
  ctx.activeFamilyId = 'fam-1';
  ctx.activeFamilyName = 'The Brambleworths';
  auth.currentUser = {
    memberId: 'mem-1',
    email: 'owner@example.com',
    familyId: 'fam-1',
    displayName: 'Hazel',
  };
  auth.podCreated = false;
  registerFamily.mockResolvedValue({ pointerAccepted: true, signupStart: 'created' });
  removeFamily.mockResolvedValue(true);
  setActivePinia(createPinia());
  vi.resetModules();
  ({ useSyncStore } = await import('@/stores/syncStore'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('registerSignupStart: the step-1 payload (one mode only)', () => {
  it('sends signupStart with isSignupEvent, isLoginEvent and ownerSync all false', async () => {
    await useSyncStore().registerSignupStart();

    expect(registerFamily).toHaveBeenCalledTimes(1);
    const [familyId, body] = registerFamily.mock.calls[0]!;
    expect(familyId).toBe('fam-1');
    expect(body).toEqual(
      expect.objectContaining({
        signupStart: true,
        isSignupEvent: false,
        isLoginEvent: false,
        ownerSync: false,
        ownerSyncReason: undefined,
        deviceTimeZone: 'Asia/Singapore',
        // The campaign tag from the device stash, for the write-once stamp at step 1.
        attribution: { utm_source: 'chatgpt', utm_campaign: 'sg-pilot' },
        ownerMemberId: 'mem-1',
        writerMemberId: 'mem-1',
        signupPlatform: 'ios',
      })
    );
  });

  it('carries the open create attempt id (#128), and none when no attempt is open', async () => {
    const { setCreateAttempt } = await import('@/utils/createAttemptState');
    setCreateAttempt({ id: 'attempt-uuid', startedAt: Date.now(), step: 'about-you' });
    try {
      await useSyncStore().registerSignupStart();
      expect(registerFamily.mock.calls.at(-1)![1].createAttemptId).toBe('attempt-uuid');
    } finally {
      setCreateAttempt(null);
    }

    await useSyncStore().registerSignupStart();
    expect(registerFamily.mock.calls.at(-1)![1].createAttemptId).toBeUndefined();
  });

  it('an ordinary write sends signupStart false and no time zone', async () => {
    // A payload-shape test, not a gate test: the ambient PUT only goes out once a pod exists.
    auth.podCreated = true;
    useSyncStore().ensureRegistered();
    await Promise.resolve();

    const [, body] = registerFamily.mock.calls.at(-1)!;
    expect(body.signupStart).toBe(false);
    expect(body.deviceTimeZone).toBeNull();
  });
});

describe('registerSignupStart: the outcome log', () => {
  it.each([
    ['created', 'info'],
    ['exists', 'info'],
    ['refused', 'warn'],
  ] as const)('logs %s at %s', async (outcome, level) => {
    registerFamily.mockResolvedValueOnce({ pointerAccepted: true, signupStart: outcome });

    await useSyncStore().registerSignupStart();

    expect(logged('signup-start')).toEqual([
      expect.objectContaining({ level, context: { action: 'signup-start', detail: outcome } }),
    ]);
  });

  it('logs failed at warn when the write was lost (registerFamily resolved null)', async () => {
    registerFamily.mockResolvedValueOnce(null);

    await useSyncStore().registerSignupStart();

    expect(logged('signup-start')).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: { action: 'signup-start', detail: 'failed' },
      }),
    ]);
  });

  it('logs unsupported at warn when the Lambda answered without the field (deploy order)', async () => {
    registerFamily.mockResolvedValueOnce({ pointerAccepted: true });

    await useSyncStore().registerSignupStart();

    expect(logged('signup-start')).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: { action: 'signup-start', detail: 'unsupported' },
      }),
    ]);
  });

  it('with the registry off, sends nothing, still posts Slack and logs disabled at info', async () => {
    features.registry = false;

    await useSyncStore().registerSignupStart();

    expect(registerFamily).not.toHaveBeenCalled();
    expect(slackNotify).toHaveBeenCalledTimes(1);
    expect(lastSlack()).not.toContain('Country');
    expect(logged('signup-start')).toEqual([
      expect.objectContaining({
        level: 'info',
        context: { action: 'signup-start', detail: 'disabled' },
      }),
    ]);
  });

  it('without an active family, logs no-family at warn and writes nothing', async () => {
    ctx.activeFamilyId = null;

    await useSyncStore().registerSignupStart();

    expect(registerFamily).not.toHaveBeenCalled();
    expect(slackNotify).not.toHaveBeenCalled();
    expect(logged('signup-start')).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: { action: 'signup-start', detail: 'no-family' },
      }),
    ]);
  });

  it('never rejects, and logs failed with the error, when the write throws synchronously', async () => {
    const boom = new Error('boom');
    registerFamily.mockImplementationOnce(() => {
      throw boom;
    });

    await expect(useSyncStore().registerSignupStart()).resolves.toBeUndefined();

    expect(logged('signup-start')).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: { action: 'signup-start', detail: 'failed' },
        error: boom,
      }),
    ]);
  });
});

describe('registerSignupStart: the "pod started" Slack line', () => {
  it('carries the family, the owner and the country before the platform lines', async () => {
    registerFamily.mockResolvedValueOnce({
      pointerAccepted: true,
      signupStart: 'created',
      deviceCountry: 'SG',
    });

    await useSyncStore().registerSignupStart();

    expect(lastSlack()).toBe(
      '🫘 *New family pod started!*\n*Family:* The Brambleworths\n*Owner:* Hazel' +
        '\n*Country:* SG\n*Platform:* App\n*Device:* iPhone'
    );
  });

  it('leaves the country out when the registry returned none', async () => {
    registerFamily.mockResolvedValueOnce({
      pointerAccepted: true,
      signupStart: 'created',
      deviceCountry: null,
    });

    await useSyncStore().registerSignupStart();

    expect(lastSlack()).toBe(
      '🫘 *New family pod started!*\n*Family:* The Brambleworths\n*Owner:* Hazel' +
        '\n*Platform:* App\n*Device:* iPhone'
    );
  });

  it('posts within the 5 s bound when the write hangs, then logs the real outcome late', async () => {
    const store = useSyncStore();
    vi.useFakeTimers();
    const write = deferredWrite();
    registerFamily.mockReturnValueOnce(write.promise);

    let settled = false;
    const run = store.registerSignupStart().then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(slackNotify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    // Posted without the country: the wait is a bound, not a dependency.
    expect(slackNotify).toHaveBeenCalledTimes(1);
    expect(lastSlack()).not.toContain('Country');
    expect(logged('signup-start')).toEqual([]);
    expect(settled).toBe(false);

    // The write settles later; the log reports what really happened.
    write.resolve({ pointerAccepted: true, signupStart: 'created', deviceCountry: 'SG' });
    await run;
    expect(logged('signup-start')).toEqual([
      expect.objectContaining({
        level: 'info',
        context: { action: 'signup-start', detail: 'created' },
      }),
    ]);
    expect(slackNotify).toHaveBeenCalledTimes(1);
  });
});

describe('abandonSignupStart: start over', () => {
  it('asks the registry for a never-finished-only tombstone and logs ok', async () => {
    await useSyncStore().abandonSignupStart();

    expect(removeFamily).toHaveBeenCalledWith('fam-1', 'mem-1', { neverFinishedOnly: true });
    expect(logged('start-over')).toEqual([
      expect.objectContaining({ level: 'info', context: { action: 'start-over', detail: 'ok' } }),
    ]);
  });

  it('logs failed at warn when the registry did not confirm', async () => {
    removeFamily.mockResolvedValueOnce(false);

    await useSyncStore().abandonSignupStart();

    expect(logged('start-over')).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: { action: 'start-over', detail: 'failed' },
      }),
    ]);
  });

  it('logs no-family at warn and sends nothing without a session family', async () => {
    auth.currentUser = null;

    await useSyncStore().abandonSignupStart();

    expect(removeFamily).not.toHaveBeenCalled();
    expect(logged('start-over')).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: { action: 'start-over', detail: 'no-family' },
      }),
    ]);
  });

  it('resolves at the 5 s bound when the DELETE hangs, logs timeout, then ok once when it lands', async () => {
    const store = useSyncStore();
    vi.useFakeTimers();
    let resolveWrite!: (ok: boolean) => void;
    removeFamily.mockReturnValueOnce(new Promise<boolean>((r) => (resolveWrite = r)));

    let settled = false;
    const run = store.abandonSignupStart().then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    expect(logged('start-over')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    // Sign-out is not held hostage by a stalled uplink.
    expect(settled).toBe(true);
    expect(logged('start-over')).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: { action: 'start-over', detail: 'timeout' },
      }),
    ]);

    // The DELETE lands later; its real outcome is still logged, exactly once.
    resolveWrite(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(logged('start-over').map((e) => [e.level, e.context.detail])).toEqual([
      ['warn', 'timeout'],
      ['info', 'ok'],
    ]);
  });

  it('never rejects, even if the registry call does', async () => {
    const boom = new Error('boom');
    removeFamily.mockRejectedValueOnce(boom);

    await expect(useSyncStore().abandonSignupStart()).resolves.toBeUndefined();

    expect(logged('start-over')).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: { action: 'start-over', detail: 'failed' },
        error: boom,
      }),
    ]);
  });
});

describe('registerCurrentFamily: no ambient PUT before the pod exists (#125)', () => {
  /** Every ambient `put` gate line `registerCurrentFamily` emitted. */
  const putLogs = () =>
    logEvent.mock.calls
      .map(([e]) => e as { level: string; surface: string; context: Record<string, unknown> })
      .filter((e) => e.surface === 'registry' && e.context?.action === 'put');

  it('sends no registry PUT while podCreated is false, and logs skipped-pre-pod at debug', async () => {
    auth.podCreated = false;

    useSyncStore().ensureRegistered();
    await Promise.resolve();

    expect(registerFamily).not.toHaveBeenCalled();
    expect(putLogs()).toEqual([
      expect.objectContaining({
        level: 'debug',
        surface: 'registry',
        context: { action: 'put', detail: 'skipped-pre-pod' },
      }),
    ]);
  });

  it('sends the PUT as before once podCreated is true, with no skip line', async () => {
    auth.podCreated = true;

    useSyncStore().ensureRegistered(true);
    await Promise.resolve();

    expect(registerFamily).toHaveBeenCalledTimes(1);
    const [familyId, body] = registerFamily.mock.calls[0]!;
    expect(familyId).toBe('fam-1');
    expect(body).toEqual(expect.objectContaining({ isLoginEvent: true, signupStart: false }));
    expect(putLogs()).toEqual([]);
  });
});
