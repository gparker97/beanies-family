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
  slackNotifyWithOutcome: vi.fn(),
  slackOutcome: { value: { outcome: 'dispatched' } as { outcome: string } },
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
vi.mock('@/utils/slackNotify', () => ({
  slackNotify: h.slackNotify,
  slackNotifyWithOutcome: h.slackNotifyWithOutcome,
}));
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
const ANSWERED = { kind: 'answered', heardVia: HEARD } as const;
const SKIPPED = { kind: 'skipped' } as const;

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
  h.slackOutcome.value = { outcome: 'dispatched' };
  h.slackNotifyWithOutcome.mockImplementation(async () => h.slackOutcome.value);
  // The device marker / done record is real localStorage: every test starts without one.
  localStorage.clear();
  setActivePinia(createPinia());
  vi.resetModules();
  ({ useSyncStore } = await import('@/stores/syncStore'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('completePodSetup: the registry write', () => {
  it('is one non-login write carrying heardVia, memberCount and setupComplete', async () => {
    await useSyncStore().completePodSetup({ survey: ANSWERED });

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
    await useSyncStore().completePodSetup({ survey: SKIPPED });

    const [, body] = h.registerFamily.mock.calls[0]!;
    expect(body.heardVia).toBeNull();
    expect(body.setupComplete).toBe(true);
  });

  it('a null response is a warning and the completion carries on', async () => {
    h.registerFamily.mockResolvedValue(null);

    await useSyncStore().completePodSetup({ survey: ANSWERED });
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
    await useSyncStore().completePodSetup({ survey: SKIPPED });
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

    const done = useSyncStore().completePodSetup({ survey: ANSWERED });
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

    const done = store.completePodSetup({ survey: ANSWERED });
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

    const done = store.completePodSetup({ survey: SKIPPED });
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

    const done = store.completePodSetup({ survey: ANSWERED });
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

    const done = store.completePodSetup({ survey: SKIPPED });
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

    const done = store.completePodSetup({ survey: SKIPPED });
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
    await store.completePodSetup({ survey: SKIPPED });
    await Promise.resolve();
    await Promise.resolve();

    store.ensureRegistered(true);

    // Synchronous: no queue once the completion write has settled.
    expect(h.registerFamily).toHaveBeenCalledTimes(2);
  });
});

describe('completePodSetup: the Slack post', () => {
  it('carries family, owner, storage, Heard via, Came from, Members added and the footer', async () => {
    await useSyncStore().completePodSetup({ survey: ANSWERED });

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
      await useSyncStore().completePodSetup({ survey: SKIPPED });
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

      await useSyncStore().completePodSetup({ survey: ANSWERED });

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

    await useSyncStore().completePodSetup({ survey: SKIPPED });

    expect(lastSlack()).not.toContain('Came from');
  });

  it('clears the campaign tag only AFTER the Slack line has it', async () => {
    await useSyncStore().completePodSetup({ survey: ANSWERED });

    expect(h.clearAttribution).toHaveBeenCalledWith('consumed');
    expect(h.slackNotify.mock.invocationCallOrder[0]!).toBeLessThan(
      h.clearAttribution.mock.invocationCallOrder[0]!
    );
  });
});

describe('completePodSetup: funnel and idempotency', () => {
  it('tracks pod_created, the done step, then ends the attempt as done', async () => {
    await useSyncStore().completePodSetup({ survey: ANSWERED });

    expect(h.track).toHaveBeenCalledWith('pod_created');
    expect(h.trackOnboardingStep).toHaveBeenCalledWith('done', 'submitted');
    expect(h.endCreateAttempt).toHaveBeenCalledWith('done');
    expect(h.trackOnboardingStep.mock.invocationCallOrder[0]!).toBeLessThan(
      h.endCreateAttempt.mock.invocationCallOrder[0]!
    );
  });

  it('a second call for the same family does nothing but log skipped', async () => {
    const store = useSyncStore();
    await store.completePodSetup({ survey: ANSWERED });
    vi.clearAllMocks();

    await store.completePodSetup({ survey: ANSWERED });

    expect(h.registerFamily).not.toHaveBeenCalled();
    expect(h.slackNotify).not.toHaveBeenCalled();
    expect(h.track).not.toHaveBeenCalled();
    expect(h.endCreateAttempt).not.toHaveBeenCalled();
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'onboarding',
        message: 'complete-setup',
        context: { action: 'skipped', stage: 'wizard' },
      })
    );
  });

  it('a concurrent second call is skipped too (latched before the first await)', async () => {
    const store = useSyncStore();
    await Promise.all([
      store.completePodSetup({ survey: ANSWERED }),
      store.completePodSetup({ survey: ANSWERED }),
    ]);

    expect(h.registerFamily).toHaveBeenCalledTimes(1);
    expect(h.slackNotify).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledTimes(1);
  });

  it('leaves the router flag alone: membersStepActive is the component’s, not a latch', async () => {
    const store = useSyncStore();
    store.membersStepActive = true;

    await store.completePodSetup({ survey: SKIPPED });

    expect(store.membersStepActive).toBe(true);
  });

  it('a sign-out reset clears the latch, so a later family completes normally', async () => {
    const store = useSyncStore();
    await store.completePodSetup({ survey: SKIPPED });
    store.resetState();
    vi.clearAllMocks();
    h.ctx.activeFamilyId = 'fam-2';

    await store.completePodSetup({ survey: SKIPPED });

    expect(h.registerFamily).toHaveBeenCalledTimes(1);
    expect(h.registerFamily.mock.calls[0]![0]).toBe('fam-2');
    expect(h.slackNotify).toHaveBeenCalledTimes(1);
  });

  it('the same family after a reset is not sent again: the done record outlives the latch', async () => {
    const store = useSyncStore();
    await store.completePodSetup({ survey: SKIPPED });
    store.resetState();
    vi.clearAllMocks();

    await store.completePodSetup({ survey: SKIPPED });

    expect(h.registerFamily).not.toHaveBeenCalled();
    expect(h.slackNotify).not.toHaveBeenCalled();
    expect(h.track).not.toHaveBeenCalled();
  });
});

/**
 * 2026-11-16: a setup left in the wizard after the pod write (a reload at the recovery kit) is
 * completed on the next signed-in open through the device marker `podSetupPending`. The marker
 * module and the create-attempt holder are the real ones. The late post goes through
 * `slackNotifyWithOutcome` (awaited), the wizard's through `slackNotify` (fire-and-forget).
 */
describe('finishPendingPodSetup: the late completion', () => {
  let attempt: typeof import('@/utils/createAttemptState');
  let marker: typeof import('@/utils/podSetupPending');

  const RELOADED = { kind: 'restored', native: false } as const;
  const RESTARTED = { kind: 'restored', native: true } as const;
  const signedIn = (method?: 'pin' | 'recovery-kit') =>
    ({ kind: 'signed-in', ...(method ? { method } : {}) }) as const;

  beforeEach(async () => {
    localStorage.clear();
    // The same module instances the store just imported (no `resetModules` in between).
    attempt = await import('@/utils/createAttemptState');
    marker = await import('@/utils/podSetupPending');
    attempt.__resetCreateAttemptForTesting();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  /** Let the un-awaited completion run to its end (the registry write resolves at once). */
  async function settle() {
    await new Promise((r) => setTimeout(r, 0));
  }

  function openAttempt(id = 'att-1') {
    attempt.setCreateAttempt({ id, startedAt: Date.now(), step: 'kit' });
  }

  function lateLines(action: string) {
    return h.logEvent.mock.calls
      .map(([e]) => e as { level: string; message: string; context: Record<string, unknown> })
      .filter((e) => e.message === 'late-complete' && e.context?.action === action);
  }

  function lastLateSlack(): string {
    return h.slackNotifyWithOutcome.mock.calls.at(-1)![0] as string;
  }

  /** Every Slack post, either path. */
  function slackPosts(): number {
    return h.slackNotify.mock.calls.length + h.slackNotifyWithOutcome.mock.calls.length;
  }

  function setOnline(value: boolean) {
    Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  }

  it('the wizard path is unchanged, has no Setup line, and leaves a done record', async () => {
    marker.markPodSetupPending('fam-1', 'mem-1', null);

    await useSyncStore().completePodSetup({ survey: ANSWERED });

    expect(lastSlack()).toContain('\n*Heard via:* ChatGPT ad');
    expect(lastSlack()).not.toContain('Setup');
    expect(h.slackNotifyWithOutcome).not.toHaveBeenCalled();
    expect(marker.readPodSetupPending('fam-1')).toEqual({ kind: 'done' });
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'complete-setup',
        context: { action: 'sent', stage: 'wizard', detail: 'answered' },
      })
    );
  });

  it('the wizard entering the app afterwards logs nothing on the late path', async () => {
    marker.markPodSetupPending('fam-1', 'mem-1', null);
    const store = useSyncStore();
    await store.completePodSetup({ survey: SKIPPED });

    expect(store.finishPendingPodSetup(signedIn())).toBe(false);

    expect(h.logEvent.mock.calls.filter(([e]) => e.message === 'late-complete')).toEqual([]);
  });

  it('a signed-in open with a marker sends the completion once, "not seen", with the Setup line', async () => {
    openAttempt('att-1');
    marker.markPodSetupPending('fam-1', 'mem-1', 'att-1');
    marker.notePodSetupStep('fam-1', 'members');
    const store = useSyncStore();

    const owns = store.finishPendingPodSetup(RELOADED);
    await settle();

    expect(owns).toBe(true);
    expect(h.registerFamily).toHaveBeenCalledTimes(1);
    expect(h.registerFamily.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ isLoginEvent: false, heardVia: null, setupComplete: true })
    );
    expect(h.slackNotify).not.toHaveBeenCalled();
    expect(h.slackNotifyWithOutcome).toHaveBeenCalledTimes(1);
    // No "Came from" although the stash holds a tag: days later it is the RETURN visit's.
    expect(lastLateSlack()).toBe(
      '🎉 *Family pod created!*\n*Family:* The Brambleworths\n*Owner:* Hazel\n*Storage:* Google Drive' +
        '\n*Heard via:* (not seen)' +
        '\n*Setup:* left at the add members step, finished on next open (page reloaded)' +
        '\n*Members added:* 2' +
        '\n*Country:* SG\n*Platform:* Web\n*Device:* Chrome on macOS'
    );
    // The stash is neither read into the post nor consumed.
    expect(h.clearAttribution).not.toHaveBeenCalled();
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledWith('pod_created');
    expect(h.trackOnboardingStep).toHaveBeenCalledWith('done', 'submitted');
    expect(h.endCreateAttempt).toHaveBeenCalledWith('done');
    expect(marker.readPodSetupPending('fam-1')).toEqual({ kind: 'done' });
    expect(lateLines('started')).toEqual([
      expect.objectContaining({
        context: {
          action: 'started',
          detail: 'members',
          kind: 'page-reloaded',
          create_attempt_id: 'att-1',
        },
      }),
    ]);
    expect(lateLines('sent')).toEqual([
      expect.objectContaining({
        context: {
          action: 'sent',
          detail: 'members',
          kind: 'page-reloaded',
          create_attempt_id: 'att-1',
        },
      }),
    ]);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'complete-setup',
        context: { action: 'sent', stage: 'late', detail: 'registry:ok+slack:dispatched' },
      })
    );
  });

  it('keeps the inferred line from the registry response', async () => {
    marker.markPodSetupPending('fam-1', 'mem-1', null);
    h.registerFamily.mockResolvedValue({
      pointerAccepted: true,
      attributionInferred: { band: 'high', fields: { utm_source: 'chatgpt' } },
    });

    useSyncStore().finishPendingPodSetup(RESTARTED);
    await settle();

    expect(lastLateSlack()).toContain('\n*Came from (inferred, high):* `chatgpt`');
    expect(lastLateSlack()).not.toContain('\n*Came from:*');
  });

  it('names the sign-in method when the open was a fresh sign-in', async () => {
    marker.markPodSetupPending('fam-1', 'mem-1', null);

    useSyncStore().finishPendingPodSetup(signedIn('recovery-kit'));
    await settle();

    expect(lastLateSlack()).toContain(
      '\n*Setup:* left at the recovery kit step, finished on next open (signed in with recovery kit)'
    );
  });

  it('a second open after a sent late completion does nothing, and says nothing', async () => {
    marker.markPodSetupPending('fam-1', 'mem-1', null);
    const store = useSyncStore();
    store.finishPendingPodSetup(RELOADED);
    await settle();

    // Same session: the latch.
    expect(store.finishPendingPodSetup(RELOADED)).toBe(false);
    // A reload (the latch is gone with the page): the done record.
    store.resetState();
    expect(store.finishPendingPodSetup(RELOADED)).toBe(false);
    await settle();

    expect(h.registerFamily).toHaveBeenCalledTimes(1);
    expect(slackPosts()).toBe(1);
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(lateLines('skipped')).toEqual([]);
  });

  it('a marker for another family sends nothing, and an ordinary open logs nothing', async () => {
    marker.markPodSetupPending('fam-2', 'mem-1', null);

    expect(useSyncStore().finishPendingPodSetup(RESTARTED)).toBe(false);
    await settle();

    expect(h.registerFamily).not.toHaveBeenCalled();
    expect(slackPosts()).toBe(0);
    expect(h.logEvent.mock.calls.filter(([e]) => e.message === 'late-complete')).toEqual([]);
    // Left for its own family.
    expect(marker.readPodSetupPending('fam-2').kind).toBe('ok');
  });

  it('another member of the family signing in on this device sends nothing', async () => {
    marker.markPodSetupPending('fam-1', 'mem-9', null);

    expect(useSyncStore().finishPendingPodSetup(signedIn('pin'))).toBe(false);
    await settle();

    expect(slackPosts()).toBe(0);
    expect(lateLines('skipped').map((l) => l.context)).toEqual([
      { action: 'skipped', detail: 'other-member', kind: 'signed-in-pin' },
    ]);
    expect(marker.readPodSetupPending('fam-1').kind).toBe('ok');
  });

  it('does not fire while the wizard is still on screen for the family in this tab', async () => {
    marker.markPodSetupPending('fam-1', 'mem-1', null);
    const store = useSyncStore();
    store.membersStepActive = true;

    expect(store.finishPendingPodSetup(signedIn())).toBe(false);
    await settle();

    expect(h.registerFamily).not.toHaveBeenCalled();
    expect(slackPosts()).toBe(0);
    expect(lateLines('skipped').map((l) => l.context.detail)).toEqual(['wizard-active']);
    expect(marker.readPodSetupPending('fam-1').kind).toBe('ok');
  });

  it('a failed registry write on the late path still posts, ends the attempt and is done', async () => {
    openAttempt('att-1');
    marker.markPodSetupPending('fam-1', 'mem-1', 'att-1');
    h.registerFamily.mockResolvedValue(null);

    useSyncStore().finishPendingPodSetup(RESTARTED);
    await settle();

    expect(h.slackNotifyWithOutcome).toHaveBeenCalledTimes(1);
    expect(lastLateSlack()).toContain(
      '\n*Setup:* left at the recovery kit step, finished on next open (app restarted)'
    );
    expect(h.endCreateAttempt).toHaveBeenCalledWith('done');
    expect(marker.readPodSetupPending('fam-1')).toEqual({ kind: 'done' });
    // The failure is logged by the write itself.
    expect(registryLines().map((l) => l.context.detail)).toEqual(['failed']);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'complete-setup',
        context: { action: 'sent', stage: 'late', detail: 'registry:failed+slack:dispatched' },
      })
    );
  });

  it('with no webhook configured (the dev case) it counts as sent', async () => {
    marker.markPodSetupPending('fam-1', 'mem-1', null);
    h.slackOutcome.value = { outcome: 'skipped_no_url' };

    useSyncStore().finishPendingPodSetup(RELOADED);
    await settle();

    expect(marker.readPodSetupPending('fam-1')).toEqual({ kind: 'done' });
    expect(h.track).toHaveBeenCalledTimes(1);
  });

  it('never ends a create attempt other than the one that made this pod', async () => {
    openAttempt('att-other');
    marker.markPodSetupPending('fam-1', 'mem-1', 'att-1');

    expect(useSyncStore().finishPendingPodSetup(signedIn('pin'))).toBe(false);
    await settle();

    expect(h.slackNotifyWithOutcome).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledWith('pod_created');
    expect(h.trackOnboardingStep).not.toHaveBeenCalledWith('done', 'submitted');
    expect(h.endCreateAttempt).not.toHaveBeenCalled();
  });

  it('an expired marker is removed, not acted on', async () => {
    marker.markPodSetupPending('fam-1', 'mem-1', null, Date.now() - 31 * 24 * 60 * 60 * 1000);

    expect(useSyncStore().finishPendingPodSetup(RELOADED)).toBe(false);

    expect(h.registerFamily).not.toHaveBeenCalled();
    expect(lateLines('skipped').map((l) => l.context.detail)).toEqual(['expired']);
    expect(marker.readPodSetupPending('fam-1')).toEqual({ kind: 'missing' });
  });

  it('the completion write and the login register cannot clobber each other', async () => {
    vi.useFakeTimers();
    marker.markPodSetupPending('fam-1', 'mem-1', null);
    let resolveCompletion!: (r: RegistryWriteResult | null) => void;
    h.registerFamily.mockReturnValueOnce(new Promise((r) => (resolveCompletion = r)));
    const store = useSyncStore();

    // `handleSignedIn`'s order: the late completion, then the login register.
    store.finishPendingPodSetup(signedIn('pin'));
    store.ensureRegistered(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.registerFamily).toHaveBeenCalledTimes(1); // only the completion write so far
    expect(h.registerFamily.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ isLoginEvent: false, setupComplete: true })
    );

    resolveCompletion({ pointerAccepted: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.registerFamily).toHaveBeenCalledTimes(2);
    expect(h.registerFamily.mock.calls[1]![1]).toEqual(
      expect.objectContaining({ isLoginEvent: true })
    );
    expect(h.registerFamily.mock.calls[1]![1]).not.toHaveProperty('setupComplete');
  });

  describe('delivery: sent when the registry write OR the Slack post got through', () => {
    it('offline: nothing is sent or counted, the marker is kept, and the next open sends once', async () => {
      openAttempt('att-1');
      marker.markPodSetupPending('fam-1', 'mem-1', 'att-1');
      const store = useSyncStore();
      setOnline(false);

      store.finishPendingPodSetup(RESTARTED);
      await settle();

      expect(h.registerFamily).not.toHaveBeenCalled();
      expect(slackPosts()).toBe(0);
      expect(h.track).not.toHaveBeenCalled();
      expect(h.endCreateAttempt).not.toHaveBeenCalled();
      expect(marker.readPodSetupPending('fam-1').kind).toBe('ok');
      expect(lateLines('deferred').map((l) => l.context)).toEqual([
        { action: 'deferred', detail: 'offline', kind: 'app-restarted' },
      ]);
      expect(lateLines('sent')).toEqual([]);

      // Back online: the next signed-in open sends it, and the conversion counts once.
      setOnline(true);
      store.finishPendingPodSetup(signedIn('pin'));
      await settle();

      expect(h.slackNotifyWithOutcome).toHaveBeenCalledTimes(1);
      expect(lastLateSlack()).toContain('finished on next open (signed in with PIN)');
      expect(h.track).toHaveBeenCalledTimes(1);
      expect(h.trackOnboardingStep).toHaveBeenCalledTimes(1);
      expect(h.endCreateAttempt).toHaveBeenCalledTimes(1);
      expect(h.endCreateAttempt).toHaveBeenCalledWith('done');
      expect(marker.readPodSetupPending('fam-1')).toEqual({ kind: 'done' });
    });

    it('a blocked Slack webhook with a landed registry write counts as sent, once, and never re-sends', async () => {
      openAttempt('att-1');
      marker.markPodSetupPending('fam-1', 'mem-1', 'att-1');
      const store = useSyncStore();
      h.slackOutcome.value = { outcome: 'network_error' };

      store.finishPendingPodSetup(RELOADED);
      await settle();

      expect(h.track).toHaveBeenCalledTimes(1);
      expect(h.endCreateAttempt).toHaveBeenCalledWith('done');
      expect(marker.readPodSetupPending('fam-1')).toEqual({ kind: 'done' });
      expect(lateLines('deferred')).toEqual([]);
      expect(h.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'complete-setup',
          context: { action: 'sent', stage: 'late', detail: 'registry:ok+slack:network_error' },
        })
      );

      // The next open (a reload) finds the done record: no second registry write.
      store.resetState();
      store.finishPendingPodSetup(RELOADED);
      await settle();
      expect(h.registerFamily).toHaveBeenCalledTimes(1);
      expect(h.track).toHaveBeenCalledTimes(1);
    });

    it('only when BOTH the registry write and the Slack post failed is it deferred; the retry counts once', async () => {
      marker.markPodSetupPending('fam-1', 'mem-1', null);
      const store = useSyncStore();
      h.registerFamily.mockResolvedValueOnce(null);
      h.slackOutcome.value = { outcome: 'network_error' };

      store.finishPendingPodSetup(RELOADED);
      await settle();

      expect(h.track).not.toHaveBeenCalled();
      expect(marker.readPodSetupPending('fam-1').kind).toBe('ok');
      expect(lateLines('deferred').map((l) => l.context)).toEqual([
        { action: 'deferred', detail: 'both-failed', kind: 'page-reloaded' },
      ]);

      h.slackOutcome.value = { outcome: 'dispatched' };
      store.resetState();
      store.finishPendingPodSetup(RELOADED);
      await settle();

      expect(h.slackNotifyWithOutcome).toHaveBeenCalledTimes(2);
      expect(h.track).toHaveBeenCalledTimes(1);
      expect(marker.readPodSetupPending('fam-1')).toEqual({ kind: 'done' });
    });

    it('going offline after the post was dispatched still counts it as sent (no second online check)', async () => {
      marker.markPodSetupPending('fam-1', 'mem-1', null);
      const store = useSyncStore();
      h.slackNotifyWithOutcome.mockImplementationOnce(async () => {
        setOnline(false);
        return { outcome: 'dispatched' };
      });

      store.finishPendingPodSetup(RELOADED);
      await settle();

      expect(marker.readPodSetupPending('fam-1')).toEqual({ kind: 'done' });
      expect(h.track).toHaveBeenCalledTimes(1);
      expect(lateLines('deferred')).toEqual([]);
      expect(lateLines('sent')).toHaveLength(1);
    });

    it('a throw before the post counts nothing and keeps the marker for the next open', async () => {
      openAttempt('att-1');
      marker.markPodSetupPending('fam-1', 'mem-1', 'att-1');
      const store = useSyncStore();
      h.registerFamily.mockImplementationOnce(() => {
        throw new Error('boom');
      });

      store.finishPendingPodSetup(RESTARTED);
      await settle();

      expect(slackPosts()).toBe(0);
      expect(h.track).not.toHaveBeenCalled();
      expect(h.trackOnboardingStep).not.toHaveBeenCalled();
      expect(h.endCreateAttempt).not.toHaveBeenCalled();
      expect(marker.readPodSetupPending('fam-1').kind).toBe('ok');
      expect(h.reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { action: 'late-complete', detail: 'failed', kind: 'app-restarted' },
        })
      );

      store.finishPendingPodSetup(RESTARTED);
      await settle();
      expect(h.track).toHaveBeenCalledTimes(1);
      expect(h.endCreateAttempt).toHaveBeenCalledTimes(1);
    });
  });

  it('a family switch during the wait still sends for the captured family, and only it', async () => {
    vi.useFakeTimers();
    marker.markPodSetupPending('fam-1', 'mem-1', null);
    marker.markPodSetupPending('fam-2', 'mem-7', null);
    h.registerFamily.mockReturnValueOnce(new Promise(() => {})); // hangs: the 5 s wait runs out
    const store = useSyncStore();
    const savedMembers = h.members.splice(0);

    try {
      h.members.push(...savedMembers);
      store.finishPendingPodSetup(signedIn('pin'));
      // Sign-out and sign-in as another family while the completion waits.
      store.resetState();
      h.ctx.activeFamilyId = 'fam-2';
      h.ctx.activeFamilyName = 'The Quillfeathers';
      h.members.splice(0, h.members.length, { id: 'mem-7', role: 'owner', name: 'Rowan' });
      h.providerType.value = 'local';
      await vi.advanceTimersByTimeAsync(5000);
    } finally {
      h.members.splice(0, h.members.length, ...savedMembers);
    }

    expect(h.registerFamily.mock.calls[0]![0]).toBe('fam-1');
    expect(lastLateSlack()).toContain(
      '*Family:* The Brambleworths\n*Owner:* Hazel\n*Storage:* Google Drive'
    );
    expect(lastLateSlack()).toContain('\n*Members added:* 2');
    expect(marker.readPodSetupPending('fam-1')).toEqual({ kind: 'done' });
    expect(marker.readPodSetupPending('fam-2').kind).toBe('ok');
  });

  /**
   * Two tabs of one browser profile: two store instances (each its own pinia, so its own latch),
   * ONE localStorage and ONE fake lock manager, as two real tabs share the origin's.
   */
  describe('two tabs', () => {
    let locks: ReturnType<typeof import('@/test/fakeLocks').fakeLocks>;
    let fake: typeof import('@/test/fakeLocks');

    beforeEach(async () => {
      fake = await import('@/test/fakeLocks');
      locks = fake.fakeLocks();
      fake.installLocks(locks);
    });
    afterEach(() => fake.restoreLocks());

    const tab = () => useSyncStore(createPinia());

    it('a tab opened while the wizard is on screen in another sends nothing; the wizard sends once', async () => {
      openAttempt('att-1');
      marker.markPodSetupPending('fam-1', 'mem-1', 'att-1');
      // Tab A's wizard took the lock at the pod write (`createNewFile`).
      const releaseWizardHold = marker.holdPodSetupLock('fam-1');
      await settle();
      const tabA = tab();
      const tabB = tab();

      tabB.finishPendingPodSetup(RELOADED);
      await settle();

      expect(slackPosts()).toBe(0);
      expect(h.track).not.toHaveBeenCalled();
      expect(lateLines('skipped').map((l) => l.context.detail)).toEqual(['wizard-active']);
      expect(marker.readPodSetupPending('fam-1').kind).toBe('ok');

      // Tab A's wizard completes.
      await tabA.completePodSetup({ survey: ANSWERED });
      releaseWizardHold();
      await settle();
      expect(h.slackNotify).toHaveBeenCalledTimes(1);

      // Tab B's next open (a reload) finds the done record and stays quiet.
      tabB.resetState();
      tabB.finishPendingPodSetup(RELOADED);
      await settle();

      expect(slackPosts()).toBe(1);
      expect(h.track).toHaveBeenCalledTimes(1);
      expect(h.endCreateAttempt).toHaveBeenCalledTimes(1);
    });

    it('the wizard really holds the lock from the pod write until its completion returns', async () => {
      // The lock the store's `createNewFile` takes is the one the late path asks for: release it
      // through the store, as `completePodSetup` and `ResumePodSetup`'s unmount do.
      marker.markPodSetupPending('fam-1', 'mem-1', null);
      const tabA = tab();
      const hold = marker.holdPodSetupLock('fam-1');
      await settle();
      expect(locks.heldNames.has(marker.podSetupLockName('fam-1'))).toBe(true);
      hold();
      tabA.releasePodSetupLock(); // safe with none held by the store
      await settle();
      expect(locks.heldNames.has(marker.podSetupLockName('fam-1'))).toBe(false);
    });

    it('two restored tabs reading the marker at once send it once', async () => {
      openAttempt('att-1');
      marker.markPodSetupPending('fam-1', 'mem-1', 'att-1');
      const tab1 = tab();
      const tab2 = tab();

      // A browser restart: both boots read the marker before either has sent.
      tab1.finishPendingPodSetup(RELOADED);
      tab2.finishPendingPodSetup(RELOADED);
      await settle();

      expect(h.registerFamily).toHaveBeenCalledTimes(1);
      expect(h.slackNotifyWithOutcome).toHaveBeenCalledTimes(1);
      expect(h.track).toHaveBeenCalledTimes(1);
      expect(lateLines('sent')).toHaveLength(1);
      expect(lateLines('skipped').map((l) => l.context.detail)).toEqual(['wizard-active']);
      expect(marker.readPodSetupPending('fam-1')).toEqual({ kind: 'done' });
    });

    it('a late send that started before another tab finished re-reads under the lock', async () => {
      fake.installLocks(fake.fakeLocks({ deferGrant: true }));
      marker.markPodSetupPending('fam-1', 'mem-1', null);
      const tab1 = tab();
      // Another tab sent it between this tab's first read and its lock grant.
      tab1.finishPendingPodSetup(RELOADED);
      marker.markPodSetupDone('fam-1');
      await settle();

      expect(slackPosts()).toBe(0);
      expect(lateLines('skipped').map((l) => l.context.detail)).toEqual(['done-elsewhere']);
    });

    it('without Web Locks, a wizard completing after a late send in another tab skips (done-elsewhere) but still sends its survey answer', async () => {
      fake.installLocks(undefined);
      marker.markPodSetupPending('fam-1', 'mem-1', null);
      const tabA = tab();
      const tabB = tab();

      tabB.finishPendingPodSetup(RELOADED);
      await settle();
      await tabA.completePodSetup({ survey: ANSWERED });

      expect(slackPosts()).toBe(1);
      expect(h.track).toHaveBeenCalledTimes(1);
      expect(h.trackOnboardingStep).not.toHaveBeenCalled(); // the late send's attempt was gone
      expect(h.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'complete-setup',
          context: { action: 'skipped', stage: 'wizard', detail: 'done-elsewhere' },
        })
      );
      // The late send carried `heardVia: null`; the wizard's ONE write carries the answer.
      expect(h.registerFamily).toHaveBeenCalledTimes(2);
      expect(h.registerFamily.mock.calls[0]![1]).toEqual(
        expect.objectContaining({ heardVia: null })
      );
      expect(h.registerFamily.mock.calls[1]![0]).toBe('fam-1');
      expect(h.registerFamily.mock.calls[1]![1]).toEqual(
        expect.objectContaining({ isLoginEvent: false, heardVia: 'chatgpt_ad' })
      );
      expect(h.clearAttribution).toHaveBeenCalledWith('consumed');
      // No second done record: the late send wrote the only one.
      expect(
        h.logEvent.mock.calls.filter(
          ([e]) => e.message === 'setup-marker' && e.context?.action === 'done'
        )
      ).toHaveLength(1);
      // A second wizard call is the plain latch skip, with no further write.
      await tabA.completePodSetup({ survey: ANSWERED });
      expect(h.registerFamily).toHaveBeenCalledTimes(2);
    });
  });
});
