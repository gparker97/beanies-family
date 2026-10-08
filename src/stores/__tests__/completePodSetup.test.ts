/**
 * #128: `syncStore.completePodSetup`, the create wizard's completion (after the kit, members
 * and survey steps). The "Family pod created!" Slack post moved here from `createNewFile` so
 * it can carry the survey answer and the member count.
 *
 * What these pin:
 *   - ONE registry write: `isLoginEvent: false` (`handleSignedIn` stays the sole `lastLoginAt`
 *     site), the survey answer's id, the roster `memberCount`, and the transient
 *     `setupComplete` that asks the Lambda for the country and band even on a skipped survey;
 *   - the Slack text, including Heard via, Members added (owner excluded) and the inferred
 *     line, read from THIS write's response;
 *   - the campaign tag is consumed only after the Slack line has it;
 *   - Plausible `pod_created`, the `done` funnel step and the attempt end, once;
 *   - idempotent per family on its own latch, and never blocked by a failed registry write.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RegistryWriteResult } from '@/services/registry/registryService';

const h = vi.hoisted(() => ({
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
    },
    newsletterOptIn: true,
    podCreated: true,
  },
  members: [
    { id: 'mem-1', role: 'owner', name: 'Hazel', email: 'owner@example.com' },
    { id: 'mem-2', role: 'member', name: 'Jane' },
    { id: 'mem-3', role: 'admin', name: 'Sam' },
  ] as Array<{ id: string; role: string; name: string; email?: string }>,
  attribution: {
    value: { utm_source: 'chatgpt', utm_campaign: 'sg-pilot' } as Record<string, string> | null,
  },
  registerFamily: vi.fn(),
  slackNotify: vi.fn(),
  logEvent: vi.fn(),
  reportError: vi.fn(),
  clearAttribution: vi.fn(),
  track: vi.fn(),
  trackOnboardingStep: vi.fn(),
  endCreateAttempt: vi.fn(),
  providerType: { value: 'google_drive' as string | null },
}));

vi.mock('@/services/sync/syncService', async () => {
  const defaults = await import('../../services/sync/__mocks__/syncService');
  return {
    ...defaults,
    getProviderType: vi.fn(() => h.providerType.value),
    onSaveFailureChange: vi.fn(() => () => {}),
    onStateChange: vi.fn(() => () => {}),
    getState: vi.fn(() => ({
      isInitialized: true,
      isConfigured: true,
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
  getPlatform: () => 'web',
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
vi.mock('@/services/registry/registryService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/registry/registryService')>()),
  addRegistryEntryObserver: () => () => {},
  registerFamily: h.registerFamily,
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
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/config/features', () => ({ features: h.features }));
vi.mock('@/utils/slackNotify', () => ({ slackNotify: h.slackNotify }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/services/analytics/plausible', () => ({
  track: h.track,
  trackFeature: vi.fn(),
  withAppInitiatedWrites: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock('@/services/telemetry/onboardingAttempt', () => ({
  trackOnboardingStep: h.trackOnboardingStep,
  endCreateAttempt: h.endCreateAttempt,
}));
vi.mock('@/utils/platformLabel', () => ({
  getPlatformLabel: () => 'Web',
  getDeviceLabel: () => 'Chrome on macOS',
}));
vi.mock('@/utils/attributionStash', () => ({
  peekAttribution: () => h.attribution.value,
  clearAttribution: h.clearAttribution,
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
  useFamilyStore: () => ({
    reloadFromCRDT: vi.fn(async () => {}),
    reset: vi.fn(),
    get members() {
      return h.members;
    },
    get owner() {
      return h.members.find((m) => m.role === 'owner') ?? null;
    },
    get soleOwner() {
      return h.members.find((m) => m.role === 'owner') ?? null;
    },
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
vi.mock('@/stores/familyContextStore', () => ({ useFamilyContextStore: () => h.ctx }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
vi.mock('@/stores/transactionsStore', () => ({ useTransactionsStore: stubStore() }));
vi.mock('@/stores/syncHighlightStore', () => ({
  useSyncHighlightStore: stubStore({ clearHighlights: vi.fn() }),
}));

let useSyncStore: typeof import('@/stores/syncStore').useSyncStore;

const HEARD = { id: 'chatgpt_ad', label: 'ChatGPT ad' } as const;

function lastSlack(): string {
  return h.slackNotify.mock.calls.at(-1)![0] as string;
}

/** Every `registry` `complete-setup` line. */
function registryLines() {
  return h.logEvent.mock.calls
    .map(([e]) => e as { level: string; surface: string; context: Record<string, unknown> })
    .filter((e) => e.surface === 'registry' && e.context?.action === 'complete-setup');
}

beforeEach(async () => {
  vi.clearAllMocks();
  h.ctx.activeFamilyId = 'fam-1';
  h.ctx.activeFamilyName = 'The Brambleworths';
  h.attribution.value = { utm_source: 'chatgpt', utm_campaign: 'sg-pilot' };
  h.providerType.value = 'google_drive';
  h.registerFamily.mockResolvedValue({ pointerAccepted: true, deviceCountry: 'SG' });
  setActivePinia(createPinia());
  vi.resetModules();
  ({ useSyncStore } = await import('@/stores/syncStore'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('completePodSetup: the registry write', () => {
  it('is one non-login write carrying heardVia, memberCount and setupComplete', async () => {
    await useSyncStore().completePodSetup({ heardVia: HEARD });

    expect(h.registerFamily).toHaveBeenCalledTimes(1);
    const [familyId, body] = h.registerFamily.mock.calls[0]!;
    expect(familyId).toBe('fam-1');
    expect(body).toEqual(
      expect.objectContaining({
        isLoginEvent: false,
        isSignupEvent: false,
        signupStart: false,
        ownerSync: false,
        heardVia: 'chatgpt_ad',
        memberCount: 3,
        setupComplete: true,
        // Write-once at the signup write; never re-sent here.
        attribution: null,
      })
    );
    // The survey label is Slack-only, never on the wire.
    expect(JSON.stringify(body)).not.toContain('ChatGPT ad');
  });

  it('sends heardVia: null, and still setupComplete, when the survey was skipped', async () => {
    await useSyncStore().completePodSetup({ heardVia: null });

    const [, body] = h.registerFamily.mock.calls[0]!;
    expect(body.heardVia).toBeNull();
    expect(body.setupComplete).toBe(true);
  });

  it('a null response is a warning and the completion carries on', async () => {
    h.registerFamily.mockResolvedValue(null);

    await useSyncStore().completePodSetup({ heardVia: HEARD });
    await Promise.resolve();

    expect(registryLines()).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: { action: 'complete-setup', detail: 'failed' },
      }),
    ]);
    // Slack still goes out (without the country), and the attempt still ends.
    expect(h.slackNotify).toHaveBeenCalledTimes(1);
    expect(lastSlack()).not.toContain('Country');
    expect(h.track).toHaveBeenCalledWith('pod_created');
    expect(h.endCreateAttempt).toHaveBeenCalledWith('done');
  });

  it('logs the success outcome too, so the failure rate is measurable', async () => {
    await useSyncStore().completePodSetup({ heardVia: null });
    await Promise.resolve();

    expect(registryLines()).toEqual([
      expect.objectContaining({
        level: 'info',
        context: { action: 'complete-setup', detail: 'ok' },
      }),
    ]);
  });

  it('waits at most 5 s for a hung write, then posts and finishes anyway', async () => {
    vi.useFakeTimers();
    let resolve!: (r: RegistryWriteResult | null) => void;
    h.registerFamily.mockReturnValue(new Promise((r) => (resolve = r)));

    const done = useSyncStore().completePodSetup({ heardVia: HEARD });
    await vi.advanceTimersByTimeAsync(5000);
    await done;

    expect(h.slackNotify).toHaveBeenCalledTimes(1);
    expect(h.endCreateAttempt).toHaveBeenCalledWith('done');
    expect(registryLines().map((l) => l.context.detail)).toEqual(['timeout']);

    // The real outcome is still logged when the write finally settles.
    resolve({ pointerAccepted: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(registryLines().map((l) => l.context.detail)).toEqual(['timeout', 'ok']);
  });
});

describe('completePodSetup: later registry writes queue behind the completion write', () => {
  // ⚠️ THE RACE: the Lambda's PUT is read-merge-write with a whole-item PutItem. A login PUT that
  // read the row before a slow completion write landed would write `heardVia` back to null.
  it('a login register during a slow completion write starts only after it settles', async () => {
    vi.useFakeTimers();
    let resolveCompletion!: (r: RegistryWriteResult | null) => void;
    h.registerFamily.mockReturnValueOnce(new Promise((r) => (resolveCompletion = r)));
    const store = useSyncStore();

    const done = store.completePodSetup({ heardVia: HEARD });
    await vi.advanceTimersByTimeAsync(5000);
    await done; // the 5 s UI bound gave up: the person is entering the app
    store.ensureRegistered(true); // `handleSignedIn`'s login register
    await vi.advanceTimersByTimeAsync(0);
    expect(h.registerFamily).toHaveBeenCalledTimes(1); // only the completion write so far

    resolveCompletion({ pointerAccepted: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.registerFamily).toHaveBeenCalledTimes(2);
    expect(h.registerFamily.mock.invocationCallOrder[1]!).toBeGreaterThan(
      h.registerFamily.mock.invocationCallOrder[0]!
    );
    expect(h.registerFamily.mock.calls[1]![1]).toEqual(
      expect.objectContaining({ isLoginEvent: true, heardVia: null })
    );
  });

  it('a FAILED completion write still releases the queue', async () => {
    vi.useFakeTimers();
    let resolveCompletion!: (r: RegistryWriteResult | null) => void;
    h.registerFamily.mockReturnValueOnce(new Promise((r) => (resolveCompletion = r)));
    const store = useSyncStore();

    const done = store.completePodSetup({ heardVia: null });
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    store.ensureRegistered(true);
    resolveCompletion(null); // `registerFamily` resolves null on a transport failure
    await vi.advanceTimersByTimeAsync(0);

    expect(h.registerFamily).toHaveBeenCalledTimes(2);
  });

  it('a write queued for family A never lands on family B after a sign-out and sign-in', async () => {
    vi.useFakeTimers();
    let resolveCompletion!: (r: RegistryWriteResult | null) => void;
    h.registerFamily.mockReturnValueOnce(new Promise((r) => (resolveCompletion = r)));
    const store = useSyncStore();

    const done = store.completePodSetup({ heardVia: HEARD });
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    store.ensureRegistered(true); // queued for fam-1 behind the completion write
    store.resetState(); // sign-out
    h.ctx.activeFamilyId = 'fam-2'; // sign-in as another family
    store.ensureRegistered(true); // B's own login register: nothing in flight for B
    expect(h.registerFamily.mock.calls.map(([id]) => id)).toEqual(['fam-1', 'fam-2']);

    resolveCompletion({ pointerAccepted: true });
    await vi.advanceTimersByTimeAsync(0);

    // The queued fam-1 write was dropped, not re-aimed at fam-2.
    expect(h.registerFamily.mock.calls.map(([id]) => id)).toEqual(['fam-1', 'fam-2']);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'registry',
        context: { action: 'put', detail: 'deferred-family-changed' },
      })
    );
  });

  it('logs the deferral', async () => {
    vi.useFakeTimers();
    h.registerFamily.mockReturnValueOnce(new Promise(() => {}));
    const store = useSyncStore();

    const done = store.completePodSetup({ heardVia: null });
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    store.ensureRegistered(true);

    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        surface: 'registry',
        context: { action: 'put', detail: 'deferred-behind-complete-setup' },
      })
    );
  });

  it('a HUNG completion write releases the queue after 15 s, with a warning', async () => {
    vi.useFakeTimers();
    h.registerFamily.mockReturnValueOnce(new Promise(() => {})); // never settles
    const store = useSyncStore();

    const done = store.completePodSetup({ heardVia: null });
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    store.ensureRegistered(true);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(h.registerFamily).toHaveBeenCalledTimes(1); // still queued at 14.999 s

    await vi.advanceTimersByTimeAsync(1);
    expect(h.registerFamily).toHaveBeenCalledTimes(2);
    expect(h.registerFamily.mock.calls[1]![1]).toEqual(
      expect.objectContaining({ isLoginEvent: true })
    );
    expect(registryLines()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        context: { action: 'complete-setup', detail: 'queue-released-timeout' },
      })
    );

    // Released for good: a later write goes out at once.
    store.ensureRegistered(false);
    expect(h.registerFamily).toHaveBeenCalledTimes(3);
  });

  it('with nothing in flight a register goes out at once, as before', async () => {
    const store = useSyncStore();
    await store.completePodSetup({ heardVia: null });
    await Promise.resolve();
    await Promise.resolve();

    store.ensureRegistered(true);

    // Synchronous: no queue once the completion write has settled.
    expect(h.registerFamily).toHaveBeenCalledTimes(2);
  });
});

describe('completePodSetup: the Slack post', () => {
  it('carries family, owner, storage, Heard via, Came from, Members added and the footer', async () => {
    await useSyncStore().completePodSetup({ heardVia: HEARD });

    expect(h.slackNotify).toHaveBeenCalledTimes(1);
    expect(lastSlack()).toBe(
      '🎉 *Family pod created!*\n*Family:* The Brambleworths\n*Owner:* Hazel\n*Storage:* Google Drive' +
        '\n*Heard via:* ChatGPT ad' +
        '\n*Came from:* `chatgpt / sg-pilot`' +
        // The owner is not counted.
        '\n*Members added:* 2' +
        '\n*Country:* SG\n*Platform:* Web\n*Device:* Chrome on macOS'
    );
  });

  it('says "(skipped)" for a skipped survey, Local File for local storage, and 0 members', async () => {
    h.members.splice(1);
    h.providerType.value = 'local';
    h.attribution.value = null;
    try {
      await useSyncStore().completePodSetup({ heardVia: null });
    } finally {
      h.members.push({ id: 'mem-2', role: 'member', name: 'Jane' });
      h.members.push({ id: 'mem-3', role: 'admin', name: 'Sam' });
    }

    const text = lastSlack();
    expect(text).toContain('\n*Storage:* Local File');
    expect(text).toContain('\n*Heard via:* (skipped)');
    expect(text).toContain('\n*Members added:* 0');
    expect(text).not.toContain('Came from');
  });

  it.each(['high', 'medium'] as const)(
    'adds the inferred line from THIS write for a %s band',
    async (band) => {
      h.attribution.value = null;
      h.registerFamily.mockResolvedValue({
        pointerAccepted: true,
        attributionInferred: {
          band,
          fields: { utm_source: 'chatgpt', utm_campaign: 'sg-pilot', utm_content: 'ad_1' },
        },
      });

      await useSyncStore().completePodSetup({ heardVia: HEARD });

      const text = lastSlack();
      expect(text).toContain(`\n*Came from (inferred, ${band}):* \`chatgpt / sg-pilot / ad_1\``);
      expect(text).not.toContain('\n*Came from:*');
    }
  );

  it('does not post a low band', async () => {
    h.attribution.value = null;
    h.registerFamily.mockResolvedValue({
      pointerAccepted: true,
      attributionInferred: { band: 'low', fields: { utm_source: 'chatgpt' } },
    });

    await useSyncStore().completePodSetup({ heardVia: null });

    expect(lastSlack()).not.toContain('Came from');
  });

  it('clears the campaign tag only AFTER the Slack line has it', async () => {
    await useSyncStore().completePodSetup({ heardVia: HEARD });

    expect(h.clearAttribution).toHaveBeenCalledWith('consumed');
    expect(h.slackNotify.mock.invocationCallOrder[0]!).toBeLessThan(
      h.clearAttribution.mock.invocationCallOrder[0]!
    );
  });
});

describe('completePodSetup: funnel and idempotency', () => {
  it('tracks pod_created, the done step, then ends the attempt as done', async () => {
    await useSyncStore().completePodSetup({ heardVia: HEARD });

    expect(h.track).toHaveBeenCalledWith('pod_created');
    expect(h.trackOnboardingStep).toHaveBeenCalledWith('done', 'submitted');
    expect(h.endCreateAttempt).toHaveBeenCalledWith('done');
    expect(h.trackOnboardingStep.mock.invocationCallOrder[0]!).toBeLessThan(
      h.endCreateAttempt.mock.invocationCallOrder[0]!
    );
  });

  it('a second call for the same family does nothing but log skipped', async () => {
    const store = useSyncStore();
    await store.completePodSetup({ heardVia: HEARD });
    vi.clearAllMocks();

    await store.completePodSetup({ heardVia: HEARD });

    expect(h.registerFamily).not.toHaveBeenCalled();
    expect(h.slackNotify).not.toHaveBeenCalled();
    expect(h.track).not.toHaveBeenCalled();
    expect(h.endCreateAttempt).not.toHaveBeenCalled();
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'onboarding',
        message: 'complete-setup',
        context: { action: 'skipped' },
      })
    );
  });

  it('a concurrent second call is skipped too (latched before the first await)', async () => {
    const store = useSyncStore();
    await Promise.all([
      store.completePodSetup({ heardVia: HEARD }),
      store.completePodSetup({ heardVia: HEARD }),
    ]);

    expect(h.registerFamily).toHaveBeenCalledTimes(1);
    expect(h.slackNotify).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledTimes(1);
  });

  it('leaves the router flag alone: membersStepActive is the component’s, not a latch', async () => {
    const store = useSyncStore();
    store.membersStepActive = true;

    await store.completePodSetup({ heardVia: null });

    expect(store.membersStepActive).toBe(true);
  });

  it('a sign-out reset clears the latch, so a later family completes normally', async () => {
    const store = useSyncStore();
    await store.completePodSetup({ heardVia: null });
    store.resetState();
    vi.clearAllMocks();

    await store.completePodSetup({ heardVia: null });

    expect(h.registerFamily).toHaveBeenCalledTimes(1);
    expect(h.slackNotify).toHaveBeenCalledTimes(1);
  });
});
