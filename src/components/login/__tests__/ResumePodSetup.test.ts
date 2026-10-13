/**
 * The create-resume screen's Drive seam, after the native round trip started being AWAITED
 * (2026-09-22), and its create order since #131: storage connects BEFORE the PIN is asked.
 *
 * ⚠️ WHAT CHANGED, AND WHY THESE CASES ARE THE ONES WORTH HAVING. This screen used to carry a
 * five-part resume machine — a `'redirecting'` phase, a `redirectInFlight` marker, a
 * `hasMounted` flag, an escape button and a `v-model` latch — because on native the OAuth return
 * is a router navigation that remounts nothing, so the work had to be picked up from a URL marker.
 * `connectDriveStorage` now awaits the trip and returns `connected` / `failed` in place, exactly
 * as the desktop popup path always did, and the whole machine is gone. What must not regress is
 * the property greg stated as the rule: never land the person back on the screen they came from
 * with nothing said.
 *
 * #131: the PIN lives only in page memory, so it is asked LAST, once, right before the write. The
 * probe's `no-registry-entry` arm goes through `proceedToFinalize`, which connects in place when
 * it can and otherwise lands on `storage`, showing a stashed Drive outcome there and only there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const h = vi.hoisted(() => {
  /** The live storage provider, as `getProvider()` sees it. */
  const provider = { value: null as { type: string } | null };
  /** A Drive connect that succeeds installs a Drive provider, as the real seam does. */
  const driveConnects = async () => {
    provider.value = { type: 'google_drive' };
    return { status: 'connected', type: 'google_drive' } as unknown;
  };
  /** A local-file connect that succeeds installs a local provider, as the real seam does. */
  const localConnects = async () => {
    provider.value = { type: 'local' };
    return { status: 'connected', type: 'local' } as unknown;
  };
  return {
    provider,
    driveConnects,
    localConnects,
    foreign: { value: false },
    probe: vi.fn(async () => ({ kind: 'no-registry-entry' }) as Record<string, unknown>),
    connectDrive: vi.fn(driveConnects),
    createNewFile: vi.fn(
      async () => ({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } }) as unknown
    ),
    reportError: vi.fn(),
    reportCreateDriveFailure: vi.fn(),
    logEvent: vi.fn(),
    activeFamilyId: { value: 'fam-1' as string | null },
    // #128
    displayName: { value: 'Greg' as string | undefined },
    desktop: { value: true },
    surveyThrows: { value: false },
    trackOnboardingStep: vi.fn(),
    // A stashed Drive outcome from before the reload (#128 redirect, #131 popup)
    reason: { value: null as string | null },
    localFiles: { value: false },
    connectLocal: vi.fn(async () => ({ status: 'failed', errorKind: 'cancelled' }) as unknown),
    rehydrateOwnerDoc: vi.fn(
      async () => ({ success: true }) as { success: boolean; error?: string }
    ),
    markRecoveryKitConfirmed: vi.fn(async () => {}),
    sync: {
      isGoogleDriveAvailable: true,
      membersStepActive: false,
      completePodSetup: vi.fn(async () => {}),
    },
  };
});

vi.mock('@/composables/useTranslation', () => ({
  // One template key resolves to a real template so the greeting's interpolation is visible.
  useTranslation: () => ({
    t: (key: string) => (key === 'resumeSetup.choosePinFor' ? 'choosePinFor:{name}' : key),
  }),
}));
vi.mock('@/services/telemetry/onboardingAttempt', () => ({
  trackOnboardingStep: h.trackOnboardingStep,
}));
vi.mock('@/utils/platformLabel', () => ({ isDesktopBrowser: () => h.desktop.value }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn(async () => false) }));
vi.mock('@/composables/useDriveCollisionRecovery', () => ({
  resolveDriveCollision: vi.fn(async () => ({ kind: 'declined' })),
}));
vi.mock('@/services/sync/connectStorage', () => ({
  connectDriveStorage: h.connectDrive,
  connectLocalStorage: h.connectLocal,
  reportCreateDriveFailure: h.reportCreateDriveFailure,
}));
vi.mock('@/services/sync/syncService', () => ({
  getProvider: vi.fn(() => h.provider.value),
  providerBelongsToAnotherFamily: vi.fn(() => h.foreign.value),
}));
vi.mock('@/services/google/driveTokenRecovery', () => ({
  tryReconnectSilently: vi.fn(async () => false),
  reconnectForWriteRetry: vi.fn(async () => false),
}));
vi.mock('@/services/google/googleAuth', () => ({
  isTokenValid: vi.fn(() => true),
}));
vi.mock('@/services/sync/capabilities', () => ({ canUseLocalFiles: () => h.localFiles.value }));
vi.mock('@/services/auth/deviceUnlock', () => ({ isValidPin: (p: string) => /^\d{6}$/.test(p) }));
// One-shot, like the real sessionStorage-backed helper.
vi.mock('@/components/login/resumePaths', () => ({
  consumeResumeReason: () => {
    const r = h.reason.value;
    h.reason.value = null;
    return r;
  },
}));
vi.mock('@/utils/payloadFailureSurface', () => ({
  surfacePayloadFatal: vi.fn(),
  surfaceBlockerFatal: vi.fn(),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    displayName: 'Greg',
    // ⚠️ MIRRORS `h.activeFamilyId`. `createFamilyId` is
    // `familyContextStore.activeFamilyId ?? currentUser.familyId`, so the null-family case has to
    // clear BOTH or the fallback quietly supplies one.
    currentUser: {
      memberId: 'mem-1',
      familyId: h.activeFamilyId.value,
      email: 'g@example.com',
      displayName: h.displayName.value,
    },
    podCreated: false,
    enrollDevicePinWrapForMember: vi.fn(async () => {}),
    rehydrateOwnerDoc: h.rehydrateOwnerDoc,
  }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    activeFamilyId: h.activeFamilyId.value,
    activeFamilyName: 'The Brambleworths',
    switchFamily: vi.fn(async () => {}),
  }),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    loadSettings: vi.fn(async () => {}),
    markRecoveryKitConfirmed: h.markRecoveryKitConfirmed,
  }),
}));
// ONE object for every `useSyncStore()` call, so a test can read `membersStepActive` back.
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () =>
    Object.assign(h.sync, {
      attemptResumeFromRegistry: h.probe,
      createNewFile: h.createNewFile,
      loadFromGoogleDrive: vi.fn(),
    }),
}));

// Leaf UI — stubbed to keep the suite about the state machine, not the widgets. Each factory is
// self-contained: `vi.mock` is hoisted above every top-level binding, so a shared helper here
// would be a TDZ error at mock time.
vi.mock('@/components/ui/BeanieSpinner.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/ui/PinInput.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/LocalFileSyncWarning.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/login/CreateMembersStep.vue', () => ({ default: { template: '<div />' } }));
// The kit stub renders its `after-confirm` slot and marks the `creation` prop, so the host's
// use of both is visible.
vi.mock('@/components/auth/RecoveryKitDisplay.vue', () => ({
  default: {
    props: { creation: Boolean },
    template:
      '<div data-testid="kit"><span v-if="creation">kit-creation</span><slot name="after-confirm" /></div>',
  },
}));
vi.mock('@/components/auth/PhoneHandoffLine.vue', () => ({
  default: { props: ['ownerMemberId'], template: '<div>phone-handoff:{{ ownerMemberId }}</div>' },
}));
vi.mock('@/components/login/CreatePodSurvey.vue', () => ({
  default: {
    setup() {
      if (h.surveyThrows.value) throw new Error('survey blew up');
      return {};
    },
    template: '<div>survey-step</div>',
  },
}));
vi.mock('@/components/login/SetupProgressModal.vue', () => ({ default: { template: '<div />' } }));

import ResumePodSetup from '../ResumePodSetup.vue';
import { isTokenValid } from '@/services/google/googleAuth';
import { tryReconnectSilently, reconnectForWriteRetry } from '@/services/google/driveTokenRecovery';
import { resolveDriveCollision } from '@/composables/useDriveCollisionRecovery';
import { confirm } from '@/composables/useConfirm';

// Each mount adds a window `pageshow` listener; unmount after every case so a later case's
// dispatched event reaches only its own screen.
enableAutoUnmount(afterEach);
import { DriveConsentDeniedError, OAuthRoundTripAbandonedError } from '@/types/sync';

// `clearAllMocks` (in each describe) clears calls, not implementations: put back every default a
// case may flip, so nothing leaks into the next one. Runs before each describe's own `beforeEach`.
beforeEach(() => {
  h.provider.value = null;
  h.foreign.value = false;
  h.reason.value = null;
  h.localFiles.value = false;
  h.connectDrive.mockImplementation(h.driveConnects);
  h.connectLocal.mockResolvedValue({ status: 'failed', errorKind: 'cancelled' });
  vi.mocked(isTokenValid).mockReturnValue(true);
  vi.mocked(tryReconnectSilently).mockResolvedValue(false);
  vi.mocked(confirm).mockResolvedValue(false);
});

/** Mount past `onMounted → runProbe()` and return the wrapper. */
async function mountScreen() {
  const wrapper = mount(ResumePodSetup);
  await flushPromises();
  return wrapper;
}

/**
 * Mount and land on the storage step the way a fresh reload does (#131): the probe's dispatch
 * finds no provider, no Google token and no refresh token to recover. The token mock is restored
 * to valid afterwards, so a Drive connect from here connects in place. ⚠️ NO PIN HAS BEEN CHOSEN
 * YET: a connect from here reaches `finalizePod`, which defers to the PIN step (`ownerReady`);
 * the PIN submit (`submitPin`) is what writes.
 */
async function atStorage() {
  vi.mocked(isTokenValid).mockReturnValue(false);
  const wrapper = await mountScreen();
  expect((wrapper.vm as unknown as Record<string, unknown>).phase).toBe('storage');
  vi.mocked(isTokenValid).mockReturnValue(true);
  h.trackOnboardingStep.mockClear();
  h.logEvent.mockClear();
  return wrapper;
}

/** Choose a valid PIN on the PIN step and submit it, settling whatever it starts. */
async function submitPin(vm: Record<string, unknown>) {
  vm.pin = '123456';
  vm.confirmPin = '123456';
  await (vm.handleIdentityNext as () => Promise<void>)();
  await flushPromises();
}

/** The screen renders one phase at a time; read it off the rendered text/markup. */
function shows(wrapper: Awaited<ReturnType<typeof mountScreen>>, key: string): boolean {
  return wrapper.text().includes(key);
}

/**
 * The `resumeSetup` info events, in order, as `action` or `action:detail` (`finalize-dispatch:<route>`
 * carries the route in `detail`, the queryable field; `finalize-deferred:no-pin` is a bare action).
 */
function resumeActions(): string[] {
  return h.logEvent.mock.calls
    .map(([e]) => e as { surface: string; context?: { action?: string; detail?: string } })
    .filter((e) => e.surface === 'resumeSetup')
    .map((e) =>
      e.context?.detail ? `${e.context.action}:${e.context.detail}` : (e.context?.action ?? '')
    );
}

function dispatches(): string[] {
  return resumeActions().filter((a) => a.startsWith('finalize-dispatch:'));
}

describe('ResumePodSetup — the Drive seam continues in place', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.desktop.value = true;
    h.surveyThrows.value = false;
    h.sync.membersStepActive = false;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
  });

  it('a CONNECTED Drive result goes to the PIN step, whose submit writes into it', async () => {
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Vm;
    await vm.handleConnectDrive();
    await flushPromises();

    // Storage first, PIN last (#131): nothing is written until the PIN is chosen.
    expect(h.connectDrive).toHaveBeenCalledTimes(1);
    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(vm.phase).toBe('identity');
    expect(resumeActions()).toContain('finalize-deferred:no-pin');

    await submitPin(vm);
    // Into the provider that connect installed: no second connect, one write, the kit.
    expect(h.connectDrive).toHaveBeenCalledTimes(1);
    expect(h.createNewFile).toHaveBeenCalledTimes(1);
    expect(dispatches()).toEqual(['finalize-dispatch:live-provider']);
    expect(vm.phase).toBe('recovery-kit');
    expect(shows(wrapper, 'resumeSetup.storagePrompt')).toBe(false);
  });

  it('an ABANDONED trip lands on storage WITH a message — never silently', async () => {
    // ⚠️ THE RULE greg STATED. "We should NEVER put users back to the same screen they came from
    // if there was an error with no error message." A dismissed consent sheet is exactly that
    // case: nothing failed in code, so nothing used to be said.
    h.connectDrive.mockResolvedValue({
      status: 'failed',
      error: new OAuthRoundTripAbandonedError('dismissed').message,
      errorKind: 'cancelled',
    });
    const wrapper = await atStorage();
    (wrapper.vm as unknown as Record<string, () => Promise<void>>).handleConnectDrive();
    await flushPromises();

    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(shows(wrapper, 'resumeSetup.storagePrompt')).toBe(true);
    // ⚠️ "CANCELLED", NOT "FAILED". Telling someone their sign-in failed when they cancelled it
    // frames their own decision as a code error and tells them to retry something that did
    // exactly what they asked.
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(true);
    expect(shows(wrapper, 'googleDrive.authFailed')).toBe(false);
    // Reported once, through the shared create-flow report (the registry gives it `warning`).
    expect(h.reportCreateDriveFailure).toHaveBeenCalledTimes(1);
    expect(h.reportCreateDriveFailure).toHaveBeenCalledWith(
      'resumeSetup.connectDrive',
      'cancelled',
      expect.anything()
    );
    expect(h.reportError).not.toHaveBeenCalled();
    // In the orange notice, never the red form-error box.
    expect(wrapper.find('p.border-l-4').text()).toBe('googleDrive.authCancelled');
    expect(wrapper.find('.bg-red-50').exists()).toBe(false);
  });

  it('a CONSENT DENIAL shows the specific "allow file access" copy, not the generic failure', async () => {
    h.connectDrive.mockResolvedValue({
      status: 'failed',
      error: new DriveConsentDeniedError('not granted').message,
      errorKind: 'consent-denied',
    });
    const wrapper = await atStorage();
    (wrapper.vm as unknown as Record<string, () => Promise<void>>).handleConnectDrive();
    await flushPromises();

    expect(shows(wrapper, 'resumeSetup.storagePrompt')).toBe(true);
    expect(shows(wrapper, 'createPod.driveConsentDenied')).toBe(true);
  });

  it('a probe that comes back WITHOUT a grant lands on retry, with a message', async () => {
    // The gesture-less probe opened the sheet and it closed. The pod IS known (the probe only
    // redirects when the registry holds a fileId), so `retry` is the honest surface.
    h.probe.mockResolvedValue({
      kind: 'drive-auth-failed',
      error: new DriveConsentDeniedError('not granted'),
    });
    const wrapper = await mountScreen();

    expect(shows(wrapper, 'resumeSetup.retryBody')).toBe(true);
    expect(shows(wrapper, 'createPod.driveConsentDenied')).toBe(true);
    // Through the shared report, whose registry severity for a decision is `warning`.
    expect(h.reportCreateDriveFailure).toHaveBeenCalledWith(
      'resumeSetup.probeDriveAuth',
      'consent-denied',
      expect.any(DriveConsentDeniedError)
    );
  });

  it.each([
    [
      'an abandoned sheet',
      new OAuthRoundTripAbandonedError('dismissed'),
      'googleDrive.authCancelled',
    ],
    [
      'a full Drive',
      Object.assign(new Error('quota'), { status: 403, reason: 'storageQuotaExceeded' }),
      'createPod.driveError.driveFull',
    ],
    ['an unknown fault', new Error('boom'), 'createPod.driveError.unknown'],
  ])(
    'the probe arm takes the message ONLY for %s: no recoveries beside a known pod',
    async (_n, error, messageKey) => {
      // ⚠️ "Use a local file" / "use a different account" here would start a second pod beside
      // the one the registry knows (the 2026-05-15 orphan incident).
      h.localFiles.value = true;
      h.probe.mockResolvedValue({ kind: 'drive-auth-failed', error });
      const wrapper = await mountScreen();

      expect((wrapper.vm as unknown as Record<string, unknown>).phase).toBe('retry');
      expect((wrapper.vm as unknown as Record<string, unknown>).driveFailure).toBeNull();
      expect(shows(wrapper, messageKey)).toBe(true);
      expect(wrapper.find('[data-recovery]').exists()).toBe(false);
      expect(shows(wrapper, 'resumeSetup.retryCta')).toBe(true);
    }
  );

  it('a WEB `redirecting` probe keeps the spinner — the page is unloading', async () => {
    h.probe.mockResolvedValue({ kind: 'redirecting' });
    const wrapper = await mountScreen();

    expect(shows(wrapper, 'resumeSetup.retryBody')).toBe(false);
    expect(shows(wrapper, 'resumeSetup.storagePrompt')).toBe(false);
  });

  it('the ORDINARY arrival at the storage step says nothing about a failure', async () => {
    // ⚠️ THE REGRESSION THIS EXISTS TO STOP, and it was introduced by a fix for an earlier
    // review finding. For a brand-new family the route is
    // `no-registry-entry → proceedToFinalize → storage` (#131), and on that path there is no
    // provider and no Google token — so the dispatch's `storage` route is the NORMAL way in, not
    // an error arm. A round-1 fix put "Google sign-in failed" there, which told every first-time
    // creator their sign-in had failed before they attempted one.
    // The shape a first-time creator is actually in at this point: nothing installed, no Google
    // token (the account was born from email + PIN), and no refresh token to recover silently.
    vi.mocked(isTokenValid).mockReturnValue(false);
    const wrapper = await mountScreen();

    expect(shows(wrapper, 'resumeSetup.storagePrompt')).toBe(true);
    expect(shows(wrapper, 'googleDrive.authFailed')).toBe(false);
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(false);
    expect(wrapper.find('p.border-l-4').exists()).toBe(false);
    // The screen's own neutral header, never a failure title.
    expect(shows(wrapper, 'resumeSetup.title')).toBe(true);
    expect(shows(wrapper, 'createPod.driveError.title')).toBe(false);
    expect(shows(wrapper, 'resumeSetup.driveDeclinedTitle')).toBe(false);
  });

  it('REFUSES to write with no resolvable family id, rather than passing "" to the guard', async () => {
    // ⚠️ `''` MAKES EVERY BOUND PROVIDER FOREIGN. Passing it would refuse the create with a
    // message about the wrong thing; the honest answer is to stop here and page.
    h.activeFamilyId.value = null;
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Vm;
    await vm.handleConnectDrive();
    await flushPromises();
    await submitPin(vm);

    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'resumeSetup.finalize', severity: 'critical' })
    );
  });

  it('a full Drive at the pod WRITE skips the reconnect retry and shows drive-full on storage', async () => {
    // A nearly full Drive passes the 2-byte stub and fails at the real write. A fresh token
    // cannot free space, so the silent-reconnect retry would only fail the same way.
    const quota = Object.assign(new Error('The user’s Drive storage quota has been exceeded.'), {
      status: 403,
      reason: 'storageQuotaExceeded',
    });
    h.createNewFile.mockResolvedValue({ ok: false, reason: 'write', error: quota });
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Vm;

    await vm.handleConnectDrive();
    await flushPromises();
    await submitPin(vm);

    expect(reconnectForWriteRetry).not.toHaveBeenCalled();
    expect(h.createNewFile).toHaveBeenCalledTimes(1);
    expect(vm.phase).toBe('storage');
    expect(vm.driveFailure).toBe('drive-full');
    // The registry's message in the orange notice, not the write-failure copy in the red box.
    expect(vm.formError).toBeNull();
    expect(shows(wrapper, 'createPod.driveError.driveFull')).toBe(true);
    expect(shows(wrapper, 'createPod.failedReasonWrite')).toBe(false);
    expect(wrapper.find('[data-recovery="retry"]').exists()).toBe(true);
    expect(wrapper.find('[data-recovery="chooseAccount"]').exists()).toBe(true);
    // One report, at the registry severity, never the `critical` write-failure page. Its own
    // surface, so CloudWatch tells a write-time full Drive from a connect-time one.
    expect(h.reportCreateDriveFailure).toHaveBeenCalledWith(
      'resumeSetup.write',
      'drive-full',
      quota
    );
    expect(h.reportError).not.toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'resumeSetup.write' })
    );
  });

  it.each([
    // `drive-busy` offers only Try again; the storage step still offers its local file.
    ['drive-busy', ['retry', 'useLocal']],
    // `cancelled` already offers it: one button, never two.
    ['cancelled', ['retry', 'useLocal']],
  ])(
    'storage keeps "use a local file" beside a %s failure, exactly once',
    async (errorKind, expected) => {
      h.localFiles.value = true;
      h.connectDrive.mockResolvedValue({ status: 'failed', error: 'x', errorKind });
      const wrapper = await atStorage();
      await (wrapper.vm as unknown as Vm).handleConnectDrive();
      await flushPromises();

      const recoveries = wrapper
        .findAll('[data-recovery]')
        .map((b) => b.attributes('data-recovery'))
        .filter((a) => a !== 'help');
      expect(recoveries).toEqual(expected);
      expect(
        wrapper.findAll('button').filter((b) => b.text() === 'storage.useLocalInstead')
      ).toHaveLength(1);
    }
  );

  it("a new attempt clears the last failure; storage's Try again is the Drive connect", async () => {
    h.connectDrive.mockResolvedValue({ status: 'failed', error: 'x', errorKind: 'drive-busy' });
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Record<string, unknown> & {
      handleConnectDrive: () => Promise<void>;
    };
    await vm.handleConnectDrive();
    await flushPromises();
    expect(vm.driveFailure).toBe('drive-busy');
    expect(shows(wrapper, 'createPod.driveError.busy')).toBe(true);

    h.connectDrive.mockResolvedValue({ status: 'redirecting' });
    await wrapper.find('[data-recovery="retry"]').trigger('click');
    await flushPromises();

    expect(h.connectDrive).toHaveBeenCalledTimes(2);
    // The emitted payload never reaches `opts`: a plain retry, not the account chooser.
    expect(h.connectDrive.mock.calls[1]).toEqual([
      expect.any(String),
      expect.objectContaining({ chooseAccount: undefined }),
    ]);
    expect(vm.driveFailure).toBeNull();
  });
});

// ─── #128: order, PIN greeting, funnel steps, header ─────────────────────────

type Vm = Record<string, unknown> & {
  handleIdentityNext: () => Promise<void>;
  handleKitStepStored: (via: 'saved' | 'acknowledged') => Promise<void>;
  handleMembersFinish: () => void;
  handleSurveyComplete: (heard: { id: string; label: string } | null) => void;
  handleSetupComplete: () => Promise<void>;
  handleConnectDrive: () => Promise<void>;
};

/**
 * Mount with a valid Drive token (a redirect that just returned with a grant): the probe's
 * dispatch connects in place and lands on the PIN step. Then submit a valid PIN and settle the
 * write, which goes into the provider that connect installed.
 */
async function throughPin() {
  const wrapper = await mountScreen();
  const vm = wrapper.vm as unknown as Vm;
  await submitPin(vm);
  return { wrapper, vm };
}

function stepCalls(action: string): string[] {
  return h.trackOnboardingStep.mock.calls.filter(([, a]) => a === action).map(([step]) => step);
}

describe('ResumePodSetup — #128 order: write → kit → members → survey → Nook', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.desktop.value = true;
    h.surveyThrows.value = false;
    h.sync.membersStepActive = false;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
  });

  it('the PIN step goes straight to the write (no survey) and lands on the kit', async () => {
    const { wrapper } = await throughPin();

    expect(h.rehydrateOwnerDoc).toHaveBeenCalledWith('Greg', '123456');
    expect(h.createNewFile).toHaveBeenCalledTimes(1);
    // Four positionals: no survey answer rides the write any more.
    expect(h.createNewFile.mock.calls[0]).toHaveLength(4);
    expect(shows(wrapper, 'kit-creation')).toBe(true);
    expect(shows(wrapper, 'survey-step')).toBe(false);
    expect(h.sync.membersStepActive).toBe(true);
  });

  it('kit → members → survey → setup modal → completePodSetup(heardVia) → /nook', async () => {
    const { wrapper, vm } = await throughPin();

    await vm.handleKitStepStored('saved');
    await flushPromises();
    expect(h.markRecoveryKitConfirmed).toHaveBeenCalledWith('saved');
    expect(vm.phase).toBe('members');

    vm.handleMembersFinish();
    await flushPromises();
    expect(vm.phase).toBe('survey');
    expect(shows(wrapper, 'survey-step')).toBe(true);
    // The survey is not the last screen until it is answered: the modal is still closed.
    expect(vm.showSetupModal).toBe(false);

    const heard = { id: 'chatgpt_ad', label: 'ChatGPT ad' };
    vm.handleSurveyComplete(heard);
    expect(vm.showSetupModal).toBe(true);
    expect(h.sync.completePodSetup).not.toHaveBeenCalled();

    await vm.handleSetupComplete();
    expect(h.sync.completePodSetup).toHaveBeenCalledWith({ heardVia: heard });
    expect(h.sync.membersStepActive).toBe(false);
    expect(wrapper.emitted('signed-in')).toEqual([['/nook']]);
  });

  it('a skipped survey completes with heardVia: null', async () => {
    const { vm } = await throughPin();
    await vm.handleKitStepStored('acknowledged');
    vm.handleMembersFinish();
    vm.handleSurveyComplete(null);
    await vm.handleSetupComplete();

    expect(h.sync.completePodSetup).toHaveBeenCalledWith({ heardVia: null });
  });

  it('a survey that THROWS still opens the setup modal with heardVia null', async () => {
    h.surveyThrows.value = true;
    const { vm } = await throughPin();
    await vm.handleKitStepStored('saved');
    vm.handleMembersFinish();
    await flushPromises();

    expect(vm.showSetupModal).toBe(true);
    expect(vm.heardVia).toBeNull();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'resumeSetup.survey', severity: 'warning' })
    );
    await vm.handleSetupComplete();
    expect(h.sync.completePodSetup).toHaveBeenCalledWith({ heardVia: null });
  });

  it('hides "Start over" on every post-write step, and shows it on storage and the PIN step', async () => {
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Vm;
    expect(shows(wrapper, 'resumeSetup.startOver')).toBe(true);

    vm.phase = 'identity';
    await flushPromises();
    expect(shows(wrapper, 'resumeSetup.startOver')).toBe(true);

    for (const phase of ['recovery-kit', 'members', 'survey']) {
      vm.phase = phase;
      await flushPromises();
      expect(shows(wrapper, 'resumeSetup.startOver')).toBe(false);
    }
  });
});

describe('ResumePodSetup — #128 kit step', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.surveyThrows.value = false;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
  });

  it('on a desktop browser the phone line sits in the kit modal, for the owner', async () => {
    h.desktop.value = true;
    const { wrapper } = await throughPin();

    expect(shows(wrapper, 'phone-handoff:mem-1')).toBe(true);
    // The old in-page intro and "Also using beanies" box are gone.
    expect(shows(wrapper, 'setup.kitStepIntro')).toBe(false);
    expect(shows(wrapper, 'setup.alsoOnPhone')).toBe(false);
  });

  it('anywhere else (phone browser, native) the line is absent', async () => {
    h.desktop.value = false;
    const { wrapper } = await throughPin();

    expect(shows(wrapper, 'kit-creation')).toBe(true);
    expect(shows(wrapper, 'phone-handoff')).toBe(false);
  });
});

describe('ResumePodSetup — #128 PIN greeting and header', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
  });

  it('a known name is greeted in the heading and NOT asked again', async () => {
    h.displayName.value = 'Greg';
    const wrapper = await mountScreen();

    expect(shows(wrapper, 'choosePinFor:Greg')).toBe(true);
    expect(shows(wrapper, 'resumeSetup.subtitlePin')).toBe(true);
    expect(wrapper.findComponent({ name: 'BaseInput' }).exists()).toBe(false);
    expect(shows(wrapper, 'resumeSetup.title')).toBe(false);
  });

  it('greets by first name only when the session holds a full name', async () => {
    h.displayName.value = 'Greg Parker';
    const wrapper = await mountScreen();

    expect(shows(wrapper, 'choosePinFor:Greg')).toBe(true);
    expect(shows(wrapper, 'choosePinFor:Greg Parker')).toBe(false);
  });

  it('an unknown name keeps the generic heading and the name field', async () => {
    h.displayName.value = undefined;
    const wrapper = await mountScreen();

    expect(shows(wrapper, 'resumeSetup.title')).toBe(true);
    expect(shows(wrapper, 'resumeSetup.subtitlePin')).toBe(true);
    expect(shows(wrapper, 'choosePinFor')).toBe(false);
    expect(wrapper.findComponent({ name: 'BaseInput' }).exists()).toBe(true);
  });

  it('a blank name counts as unknown', async () => {
    h.displayName.value = '   ';
    const wrapper = await mountScreen();

    expect(wrapper.findComponent({ name: 'BaseInput' }).exists()).toBe(true);
  });

  it('the header is per phase: recovery copy on auto-load, the neutral line elsewhere, none on the survey', async () => {
    h.displayName.value = 'Greg';
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as Vm;

    vm.phase = 'auto-load';
    await flushPromises();
    expect(shows(wrapper, 'resumeSetup.subtitleRecovery')).toBe(true);

    vm.phase = 'storage';
    await flushPromises();
    expect(shows(wrapper, 'resumeSetup.title')).toBe(true);
    expect(shows(wrapper, 'resumeSetup.subtitle')).toBe(true);
    expect(shows(wrapper, 'resumeSetup.subtitlePin')).toBe(false);
    // The prompt is the body's, said once, never repeated in the header.
    expect(wrapper.text().split('resumeSetup.storagePrompt')).toHaveLength(2);

    vm.phase = 'survey';
    await flushPromises();
    expect(shows(wrapper, 'resumeSetup.title')).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it.each([
    ['cancelled', 'resumeSetup.driveDeclinedTitle', 'createPod.driveError.title'],
    ['consent-denied', 'resumeSetup.driveDeclinedTitle', 'createPod.driveError.title'],
    ['app-blocked', 'createPod.driveError.title', 'resumeSetup.driveDeclinedTitle'],
  ])('storage with a %s failure: its own title, no subtitle', async (code, title, notTitle) => {
    h.displayName.value = 'Greg';
    h.reason.value = code;
    vi.mocked(isTokenValid).mockReturnValue(false);
    const wrapper = await mountScreen();

    expect(shows(wrapper, title)).toBe(true);
    expect(shows(wrapper, notTitle)).toBe(false);
    expect(shows(wrapper, 'resumeSetup.subtitle')).toBe(false);
    expect(shows(wrapper, 'resumeSetup.title')).toBe(false);
    // The storage prompt still says what the screen is for, once.
    expect(wrapper.text().split('resumeSetup.storagePrompt')).toHaveLength(2);
  });
});

describe('ResumePodSetup — #128 funnel steps', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.desktop.value = true;
    h.surveyThrows.value = false;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
  });

  it("emits shown once per mapped phase, and submitted on each step's success line", async () => {
    const { vm } = await throughPin();
    await vm.handleKitStepStored('saved');
    vm.handleMembersFinish();
    await flushPromises();
    vm.handleSurveyComplete(null);
    await vm.handleSetupComplete();
    await flushPromises();

    // `finishing` is not a funnel step and emits nothing.
    expect(stepCalls('shown')).toEqual(['resume-probe', 'pin', 'kit', 'members', 'survey']);
    expect(stepCalls('submitted')).toEqual(['pin', 'kit', 'members', 'survey']);
  });

  it('a fresh reload walks storage → PIN → write, with storage shown before the PIN', async () => {
    vi.mocked(isTokenValid).mockReturnValue(false);
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as Vm;
    vi.mocked(isTokenValid).mockReturnValue(true);
    await vm.handleConnectDrive();
    await flushPromises();
    await submitPin(vm);

    expect(stepCalls('shown')).toEqual(['resume-probe', 'storage', 'drive-consent', 'pin', 'kit']);
    expect(stepCalls('submitted')).toEqual(['pin']);
    expect(vm.phase).toBe('recovery-kit');
  });

  it('no submitted for a PIN step whose owner rebuild failed', async () => {
    h.rehydrateOwnerDoc.mockResolvedValue({ success: false, error: 'nope' });
    await throughPin();

    expect(stepCalls('submitted')).toEqual([]);
    expect(h.createNewFile).not.toHaveBeenCalled();
  });

  it('the storage step is shown, and the Drive connect records drive-consent shown first', async () => {
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Vm;

    await vm.handleConnectDrive();
    await flushPromises();

    expect(h.trackOnboardingStep.mock.calls[0]).toEqual(['drive-consent', 'shown']);
    expect(h.trackOnboardingStep.mock.invocationCallOrder[0]!).toBeLessThan(
      h.connectDrive.mock.invocationCallOrder[0]!
    );
  });

  it('a fresh reload (nothing connected) lands on storage, never on the PIN step', async () => {
    vi.mocked(isTokenValid).mockReturnValue(false);
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as Vm;

    expect(vm.phase).toBe('storage');
    expect(stepCalls('shown')).toEqual(['resume-probe', 'storage']);
    // No failure on screen, so no `error_code` on the step.
    expect(h.trackOnboardingStep).toHaveBeenCalledWith('storage', 'shown');
    expect(shows(wrapper, 'setup.choosePinLabel')).toBe(false);
    expect(dispatches()).toEqual(['finalize-dispatch:storage']);
    expect(h.connectDrive).not.toHaveBeenCalled();
  });

  it('a valid token at the probe connects in place: no consent counted, the PIN step via no-pin', async () => {
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as Vm;

    expect(h.connectDrive).toHaveBeenCalledTimes(1);
    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(vm.phase).toBe('identity');
    expect(resumeActions()).toEqual(['finalize-dispatch:valid-token', 'finalize-deferred:no-pin']);
    expect(stepCalls('shown')).toEqual(['resume-probe', 'pin']);
    // The consent is the connect seam's to count, from the storage step only.
    expect(h.trackOnboardingStep.mock.calls.map(([s]) => s)).not.toContain('drive-consent');
  });

  it('storage shown carries the error_code of the failure it displays', async () => {
    h.reason.value = 'consent-denied';
    vi.mocked(isTokenValid).mockReturnValue(false);
    await mountScreen();

    expect(h.trackOnboardingStep).toHaveBeenCalledWith('storage', 'shown', {
      error_code: 'consent-denied',
    });
    // `drive-declined` is no longer a step.
    expect(stepCalls('shown')).toEqual(['resume-probe', 'storage']);
  });

  it('a failed connect back on storage logs storage shown with its error_code', async () => {
    h.connectDrive.mockResolvedValue({ status: 'failed', error: 'x', errorKind: 'drive-busy' });
    const wrapper = await atStorage();
    await (wrapper.vm as unknown as Vm).handleConnectDrive();
    await flushPromises();

    expect(h.trackOnboardingStep.mock.calls).toEqual([
      ['drive-consent', 'shown'],
      ['storage', 'shown', { error_code: 'drive-busy' }],
    ]);
  });
});

// ─── #128 / #131: a Drive outcome stashed before the reload, shown on storage ─────────────────

describe('ResumePodSetup — a stashed Drive outcome lands on storage', () => {
  type StorageVm = Vm & {
    handleConnectLocal: () => Promise<void>;
    handleLocalFileClick: () => void;
    handleRetry: () => Promise<void>;
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.desktop.value = true;
    h.surveyThrows.value = false;
    h.sync.membersStepActive = false;
    h.reason.value = 'cancelled';
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectDrive.mockResolvedValue({ status: 'redirecting' });
    h.connectLocal.mockImplementation(h.localConnects);
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
    // Nothing connected and nothing to recover: the dispatch lands on `storage`.
    vi.mocked(isTokenValid).mockReturnValue(false);
  });

  it('a decline lands on storage: title, prompt, orange notice, retry, Start over; no red box', async () => {
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;

    expect(vm.phase).toBe('storage');
    expect(vm.driveFailure).toBe('cancelled');
    expect(shows(wrapper, 'resumeSetup.driveDeclinedTitle')).toBe(true);
    expect(shows(wrapper, 'resumeSetup.storagePrompt')).toBe(true);
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(true);
    expect(wrapper.find('[data-recovery="retry"]').exists()).toBe(true);
    expect(shows(wrapper, 'resumeSetup.startOver')).toBe(true);
    // The header's subtitle slot is empty here: the notice is the explanation.
    expect(shows(wrapper, 'resumeSetup.subtitle')).toBe(false);
    // The recoveries replace the default buttons, never sit beside them.
    expect(shows(wrapper, 'storage.connectGoogleDrive')).toBe(false);
    // A decision, not a fault: Heritage Orange with a dark partner, never the red form-error box.
    const notice = wrapper.find('p.border-l-4');
    expect(notice.classes()).toEqual(
      expect.arrayContaining([
        'border-primary-500',
        'dark:border-accent-lift',
        'dark:bg-surface-overlay',
      ])
    );
    expect(wrapper.find('.bg-red-50').exists()).toBe(false);
    // Nothing already given is asked again here: no PIN form, no name field.
    expect(shows(wrapper, 'setup.choosePinLabel')).toBe(false);
    expect(stepCalls('shown')).toEqual(['resume-probe', 'storage']);
    expect(dispatches()).toEqual(['finalize-dispatch:storage']);
    // The producer already reported it; the screen reports nothing new.
    expect(h.reportCreateDriveFailure).not.toHaveBeenCalled();
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it('an unticked file-access box uses the consent copy under the same decision title', async () => {
    h.reason.value = 'consent-denied';
    const wrapper = await mountScreen();

    expect((wrapper.vm as unknown as StorageVm).phase).toBe('storage');
    expect(shows(wrapper, 'resumeSetup.driveDeclinedTitle')).toBe(true);
    expect(shows(wrapper, 'createPod.driveConsentDenied')).toBe(true);
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(false);
    expect(wrapper.find('.bg-red-50').exists()).toBe(false);
  });

  it('a stuck popup from before the reload: storage with its notice, retry and a local file; nothing reported', async () => {
    h.reason.value = 'popup-abandoned';
    h.localFiles.value = true;
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;

    expect(vm.phase).toBe('storage');
    expect(vm.driveFailure).toBe('popup-abandoned');
    expect(shows(wrapper, 'createPod.driveError.popupAbandoned')).toBe(true);
    // Not a decision: the neutral failure title.
    expect(shows(wrapper, 'createPod.driveError.title')).toBe(true);
    expect(
      wrapper
        .findAll('[data-recovery]')
        .map((b) => b.attributes('data-recovery'))
        .filter((a) => a !== 'help')
    ).toEqual(['retry', 'useLocal']);
    expect(h.trackOnboardingStep).toHaveBeenCalledWith('storage', 'shown', {
      error_code: 'popup-abandoned',
    });
    // A person's action, measured by the funnel: never a report.
    expect(h.reportCreateDriveFailure).not.toHaveBeenCalled();
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it.each(['app-blocked', 'access-denied', 'unknown', 'drive-full', 'offline'])(
    'a stashed %s is NOT a decision: the neutral title, never "Google needs a yes"',
    async (code) => {
      h.reason.value = code;
      const wrapper = await mountScreen();

      expect((wrapper.vm as unknown as StorageVm).phase).toBe('storage');
      expect(shows(wrapper, 'createPod.driveError.title')).toBe(true);
      expect(shows(wrapper, 'resumeSetup.driveDeclinedTitle')).toBe(false);
      expect(wrapper.find('p.border-l-4').exists()).toBe(true);
    }
  );

  it('an admin-blocked return offers a different account and the app, never a retry', async () => {
    h.reason.value = 'app-blocked';
    const wrapper = await mountScreen();

    expect(shows(wrapper, 'createPod.driveError.appBlocked')).toBe(true);
    expect(wrapper.find('[data-recovery="retry"]').exists()).toBe(false);
    expect(wrapper.find('[data-recovery="chooseAccount"]').exists()).toBe(true);
    // No local files in this browser: the app, not a dead-end local button.
    expect(wrapper.find('[data-recovery="useLocal"]').exists()).toBe(false);
    expect(wrapper.find('[data-recovery="getApp"]').exists()).toBe(true);
  });

  it('a described access_denied return: its own message, retry and a different account', async () => {
    h.reason.value = 'access-denied';
    h.localFiles.value = true;
    const wrapper = await mountScreen();

    expect(shows(wrapper, 'createPod.driveError.accessDenied')).toBe(true);
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(false);
    expect(wrapper.findAll('[data-recovery]').map((b) => b.attributes('data-recovery'))).toEqual([
      'retry',
      'chooseAccount',
      'useLocal',
      'help',
    ]);
  });

  it('without local files: no local-file recovery', async () => {
    const wrapper = await mountScreen();
    expect(wrapper.find('[data-recovery="useLocal"]').exists()).toBe(false);
    expect(shows(wrapper, 'storage.useLocalInstead')).toBe(false);
  });

  it('with local files: the local-file recovery opens the single-device warning', async () => {
    h.localFiles.value = true;
    const wrapper = await mountScreen();
    const local = wrapper.find('[data-recovery="useLocal"]');
    expect(local.exists()).toBe(true);
    await local.trigger('click');
    expect((wrapper.vm as unknown as StorageVm).showLocalFileWarning).toBe(true);
  });

  it('storage offers a local file even for a code that omits it', async () => {
    h.localFiles.value = true;
    h.reason.value = 'popup-blocked';
    const wrapper = await mountScreen();
    expect((wrapper.vm as unknown as StorageVm).phase).toBe('storage');
    expect(wrapper.find('[data-recovery="useLocal"]').exists()).toBe(true);
  });

  it('Try again with no token starts the Drive connect (the redirect), and keeps the spinner', async () => {
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;
    h.trackOnboardingStep.mockClear();

    await wrapper.find('[data-recovery="retry"]').trigger('click');
    await flushPromises();

    expect(h.connectDrive).toHaveBeenCalledTimes(1);
    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(h.trackOnboardingStep.mock.calls[0]).toEqual(['drive-consent', 'shown']);
    // The page is unloading to Google: no flash of the storage picker, no `storage shown`
    // (which would log the unload as an abandon at `storage`).
    expect(vm.phase).toBe('finishing');
    expect(stepCalls('shown')).not.toContain('storage');
  });

  it('Try again with a token connects in place and goes to the PIN step, never writing', async () => {
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;
    vi.mocked(isTokenValid).mockReturnValue(true);
    h.connectDrive.mockImplementation(h.driveConnects);

    await wrapper.find('[data-recovery="retry"]').trigger('click');
    await flushPromises();

    expect(h.connectDrive).toHaveBeenCalledTimes(1);
    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(vm.phase).toBe('identity');
    expect(vm.driveFailure).toBeNull();
    expect(stepCalls('submitted')).toEqual([]);
  });

  it('"use a different Google account" runs the connect with the chooser forced', async () => {
    h.reason.value = 'app-blocked';
    const wrapper = await mountScreen();

    await wrapper.find('[data-recovery="chooseAccount"]').trigger('click');
    await flushPromises();

    expect(h.connectDrive).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ chooseAccount: true })
    );
    expect(stepCalls('submitted')).toEqual([]);
  });

  it('a local file chosen here goes to the PIN step first, then writes into it', async () => {
    h.localFiles.value = true;
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;

    await vm.handleConnectLocal();
    await flushPromises();
    expect(h.connectLocal).toHaveBeenCalledTimes(1);
    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(vm.phase).toBe('identity');

    await submitPin(vm);
    expect(h.createNewFile).toHaveBeenCalledTimes(1);
    expect(h.connectDrive).not.toHaveBeenCalled();
    expect(vm.phase).toBe('recovery-kit');
  });

  it('a local failure after a Drive failure: the red form error, the default storage screen, never the stale code', async () => {
    h.localFiles.value = true;
    h.connectLocal.mockResolvedValue({ status: 'failed', errorKind: 'unknown', error: 'disk' });
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;
    expect(vm.driveFailure).toBe('cancelled');

    await vm.handleConnectLocal();
    await flushPromises();

    expect(vm.phase).toBe('storage');
    expect(vm.driveFailure).toBeNull();
    expect(vm.formError).toBe('setup.fileCreateFailed');
    expect(wrapper.find('.bg-red-50').exists()).toBe(true);
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(false);
    expect(wrapper.find('[data-recovery]').exists()).toBe(false);
    expect(shows(wrapper, 'storage.connectGoogleDrive')).toBe(true);
  });

  it('with NO code (a dismissed local picker), the default storage screen and header', async () => {
    h.localFiles.value = true;
    h.reason.value = 'app-blocked';
    h.connectLocal.mockResolvedValue({ status: 'failed', errorKind: 'cancelled' });
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;
    expect(shows(wrapper, 'createPod.driveError.title')).toBe(true);

    await vm.handleConnectLocal();
    await flushPromises();

    expect(vm.phase).toBe('storage');
    expect(vm.driveFailure).toBeNull();
    expect(h.createNewFile).not.toHaveBeenCalled();
    // Never a failure title with nothing under it to explain it.
    expect(shows(wrapper, 'createPod.driveError.title')).toBe(false);
    expect(shows(wrapper, 'resumeSetup.driveDeclinedTitle')).toBe(false);
    expect(shows(wrapper, 'resumeSetup.title')).toBe(true);
    expect(wrapper.find('p.border-l-4').exists()).toBe(false);
    expect(shows(wrapper, 'storage.connectGoogleDrive')).toBe(true);
  });

  it('leaving storage clears the code: it never reappears on a later visit', async () => {
    h.reason.value = 'app-blocked';
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;
    expect(vm.driveFailure).toBe('app-blocked');

    vm.phase = 'identity';
    await flushPromises();
    expect(vm.driveFailure).toBeNull();

    vm.phase = 'storage';
    await flushPromises();
    expect(wrapper.find('[data-recovery]').exists()).toBe(false);
    expect(shows(wrapper, 'createPod.driveError.appBlocked')).toBe(false);
  });

  it.each([
    ['a live same-family provider', 'live-provider'],
    ['a valid token', 'valid-token'],
    ['a silent reconnect', 'silent-reconnect'],
  ])(
    'a stash is dropped when the dispatch finds %s: the PIN step, no notice',
    async (_n, route) => {
      let token = route === 'valid-token';
      vi.mocked(isTokenValid).mockImplementation(() => token);
      if (route === 'live-provider') h.provider.value = { type: 'google_drive' };
      if (route === 'silent-reconnect') {
        vi.mocked(tryReconnectSilently).mockImplementation(async () => {
          token = true;
          return true;
        });
      }
      h.connectDrive.mockImplementation(h.driveConnects);
      const wrapper = await mountScreen();
      const vm = wrapper.vm as unknown as StorageVm;

      expect(dispatches()).toEqual([`finalize-dispatch:${route}`]);
      expect(vm.phase).toBe('identity');
      expect(vm.driveFailure).toBeNull();
      expect(h.reason.value).toBeNull(); // consumed either way
      expect(wrapper.find('p.border-l-4').exists()).toBe(false);
      expect(stepCalls('shown')).toEqual(['resume-probe', 'pin']);
      expect(h.createNewFile).not.toHaveBeenCalled();
    }
  );

  it('a FOREIGN Drive provider is not "connected": the stash still lands on storage', async () => {
    // A provider bound to another family is never written into (the 2026-09-21 near data loss).
    // With no token to replace it, nothing is connected, so the stashed reason is the news.
    h.provider.value = { type: 'google_drive' };
    h.foreign.value = true;
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;

    expect(dispatches()).toEqual(['finalize-dispatch:storage']);
    expect(vm.phase).toBe('storage');
    expect(vm.driveFailure).toBe('cancelled');
    expect(h.createNewFile).not.toHaveBeenCalled();
  });

  it.each([
    ['auto-loadable', { kind: 'auto-loadable', familyName: 'X', lastSaved: null }, 'auto-load'],
    ['registry-error', { kind: 'registry-error', error: new Error('down') }, 'retry'],
    ['load-failed', { kind: 'load-failed', error: new Error('404') }, 'retry'],
    ['redirecting', { kind: 'redirecting' }, 'probing'],
  ])(
    'a %s probe keeps its own arm; the stashed reason is consumed and dropped',
    async (_n, result, expected) => {
      h.probe.mockResolvedValue(result);
      const wrapper = await mountScreen();
      expect((wrapper.vm as unknown as StorageVm).phase).toBe(expected);
      expect(h.reason.value).toBeNull();
      expect(stepCalls('shown')).not.toContain('storage');
      expect(dispatches()).toEqual([]);
    }
  );

  it('a retry re-probe never re-shows the stash (the reason is mount-only)', async () => {
    h.probe.mockResolvedValueOnce({ kind: 'registry-error', error: new Error('down') });
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;
    expect(vm.phase).toBe('retry');

    await vm.handleRetry();
    await flushPromises();
    expect(vm.phase).toBe('storage');
    expect(vm.driveFailure).toBeNull();
    expect(wrapper.find('p.border-l-4').exists()).toBe(false);
  });
});

// ─── #131: the PIN is the last step before the write, on every route ─────────────────────────

describe('ResumePodSetup — no pod write before the PIN step, on any route', () => {
  type StorageVm = Vm & {
    handleConnectLocal: () => Promise<void>;
    handleStartNewPodFromRetry: () => Promise<void>;
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.surveyThrows.value = false;
    h.sync.membersStepActive = false;
    h.localFiles.value = true;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectLocal.mockImplementation(h.localConnects);
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
  });

  it('a Drive gate that FAILS before redirecting returns to storage with its code', async () => {
    h.connectDrive.mockResolvedValue({
      status: 'failed',
      error: 'redirect could not start',
      errorKind: 'unknown',
    });
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as StorageVm;

    await vm.handleConnectDrive();
    await flushPromises();

    expect(vm.phase).toBe('storage');
    expect(vm.driveFailure).toBe('unknown');
    expect(shows(wrapper, 'createPod.driveError.unknown')).toBe(true);
    expect(shows(wrapper, 'createPod.driveError.title')).toBe(true);

    // …and the local-file link from here still goes to the PIN step first, no write…
    await vm.handleConnectLocal();
    await flushPromises();
    expect(vm.phase).toBe('identity');
    expect(h.createNewFile).not.toHaveBeenCalled();
    // …without the storage step's stale Drive failure above the PIN form.
    expect(vm.formError).toBeNull();
    expect(vm.driveFailure).toBeNull();
    expect(shows(wrapper, 'createPod.driveError.unknown')).toBe(false);
  });

  it('a Drive connect that THROWS returns to storage, classified and reported once', async () => {
    h.connectDrive.mockRejectedValue(new Error('boom'));
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as StorageVm;

    await vm.handleConnectDrive();
    await flushPromises();

    expect(vm.phase).toBe('storage');
    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(vm.driveFailure).toBe('unknown');
    expect(h.reportCreateDriveFailure).toHaveBeenCalledWith(
      'resumeSetup.connectDrive',
      'unknown',
      expect.any(Error)
    );
  });

  it('a provider lost between storage and the PIN sends the submit back to storage, then writes', async () => {
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as StorageVm;
    await vm.handleConnectDrive();
    await flushPromises();
    expect(vm.phase).toBe('identity');

    // The provider and the token are gone by the time the PIN is submitted.
    h.provider.value = null;
    vi.mocked(isTokenValid).mockReturnValue(false);
    await submitPin(vm);

    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(vm.phase).toBe('storage');
    expect(vm.driveFailure).toBeNull();
    expect(dispatches()).toEqual(['finalize-dispatch:storage']);

    // The PIN is already chosen: the next connect writes, and the PIN is not asked again.
    vi.mocked(isTokenValid).mockReturnValue(true);
    await vm.handleConnectDrive();
    await flushPromises();
    expect(h.createNewFile).toHaveBeenCalledTimes(1);
    expect(h.rehydrateOwnerDoc).toHaveBeenCalledTimes(1);
    expect(vm.phase).toBe('recovery-kit');
  });

  it('a failed local file returns to the storage step, no write', async () => {
    h.connectLocal.mockResolvedValue({ status: 'failed', errorKind: 'cancelled' });
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as StorageVm;

    await vm.handleConnectLocal();
    await flushPromises();
    expect(vm.phase).toBe('storage');
    expect(h.createNewFile).not.toHaveBeenCalled();
  });

  it('the retry screen\'s "set up my family" goes to storage, not the PIN step', async () => {
    h.probe.mockResolvedValue({ kind: 'registry-error', error: new Error('down') });
    vi.mocked(confirm).mockResolvedValue(true);
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;
    expect(vm.phase).toBe('retry');

    await vm.handleStartNewPodFromRetry();
    await flushPromises();
    expect(vm.phase).toBe('storage');
    expect(stepCalls('shown')).toContain('storage');
    expect(stepCalls('shown')).not.toContain('pin');
  });

  it('a silent reconnect at the probe connects in place, adopts its own stub, and lands on the PIN step', async () => {
    // A reload after a popup grant: no provider and no access token, but the family's refresh
    // token restores one. The stub the popup connect wrote comes back as a name collision and is
    // adopted; no consent is shown or counted.
    let token = false;
    vi.mocked(isTokenValid).mockImplementation(() => token);
    vi.mocked(tryReconnectSilently).mockImplementation(async () => {
      token = true;
      return true;
    });
    let tokenAtConnect: boolean | null = null;
    h.connectDrive.mockImplementation(async () => {
      tokenAtConnect = isTokenValid();
      return {
        status: 'failed',
        error: 'a pod with this name exists',
        errorKind: 'name-collision',
        collision: { fileId: 'stub-1' },
      };
    });
    vi.mocked(resolveDriveCollision).mockImplementationOnce(async () => {
      h.provider.value = { type: 'google_drive' };
      return { kind: 'adopted-stub' } as Awaited<ReturnType<typeof resolveDriveCollision>>;
    });
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;

    expect(dispatches()).toEqual(['finalize-dispatch:silent-reconnect']);
    expect(h.connectDrive).toHaveBeenCalledTimes(1);
    expect(tokenAtConnect).toBe(true);
    expect(resolveDriveCollision).toHaveBeenCalledTimes(1);
    expect(vm.phase).toBe('identity');
    expect(resumeActions()).toContain('finalize-deferred:no-pin');
    expect(h.trackOnboardingStep.mock.calls.map(([s]) => s)).not.toContain('drive-consent');
    expect(h.reportCreateDriveFailure).not.toHaveBeenCalled();
    expect(h.createNewFile).not.toHaveBeenCalled();

    // The PIN submit writes into the adopted stub: no second connect.
    await submitPin(vm);
    expect(h.connectDrive).toHaveBeenCalledTimes(1);
    expect(h.createNewFile).toHaveBeenCalledTimes(1);
    expect(vm.phase).toBe('recovery-kit');
  });

  it.each([
    ['live-provider', 'live-provider'],
    ['valid-token', 'valid-token'],
    ['silent-reconnect', 'silent-reconnect'],
    ['storage', 'storage'],
  ])('finalize-dispatch is logged exactly once per call: %s', async (_n, route) => {
    let token = route === 'valid-token';
    vi.mocked(isTokenValid).mockImplementation(() => token);
    if (route === 'live-provider') h.provider.value = { type: 'local' };
    if (route === 'silent-reconnect') {
      vi.mocked(tryReconnectSilently).mockImplementation(async () => {
        token = true;
        return true;
      });
    }
    await mountScreen();

    expect(dispatches()).toEqual([`finalize-dispatch:${route}`]);
    expect(h.logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'resumeSetup',
      message: 'finalize dispatch',
      context: { action: 'finalize-dispatch', detail: route },
    });
  });

  it('an owner rebuild that THROWS stays on the PIN step (never the storage step)', async () => {
    h.rehydrateOwnerDoc.mockRejectedValue(new Error('doc gone'));
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as StorageVm;
    expect(vm.phase).toBe('identity');

    await submitPin(vm);

    expect(vm.phase).toBe('identity');
    expect(shows(wrapper, 'setup.fileCreateFailed')).toBe(true);
    expect(h.createNewFile).not.toHaveBeenCalled();
  });
});

describe('ResumePodSetup — Safari back/forward-cache return from Google', () => {
  function pageshow(persisted: boolean) {
    const ev = new Event('pageshow');
    Object.defineProperty(ev, 'persisted', { value: persisted });
    window.dispatchEvent(ev);
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.surveyThrows.value = false;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectDrive.mockResolvedValue({ status: 'redirecting' });
    vi.mocked(isTokenValid).mockReturnValue(false);
  });

  it('a restored page leaves the spinner for the storage step, stepping back from drive-consent', async () => {
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Vm;
    vi.mocked(isTokenValid).mockReturnValue(false);

    await vm.handleConnectDrive();
    await flushPromises();
    expect(vm.phase).toBe('finishing'); // the page is unloading to Google
    h.trackOnboardingStep.mockClear();

    pageshow(true);
    await flushPromises();

    expect(vm.phase).toBe('storage');
    expect(vm.navigatedAway).toBe(false);
    expect(shows(wrapper, 'resumeSetup.startOver')).toBe(true);
    // The attempt leaves `drive-consent` (`back`, returned), THEN the restored screen is shown,
    // so a later tab close is an abandon at `storage`, where the person actually is.
    expect(h.trackOnboardingStep.mock.calls).toEqual([
      ['drive-consent', 'back', { error_code: 'returned' }],
      ['storage', 'shown'],
    ]);
  });

  it('a restored page from a PROBE redirect leaves the spinner for retry', async () => {
    h.probe.mockResolvedValue({ kind: 'redirecting' });
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as Vm & { handleRetry: () => Promise<void> };
    expect(vm.phase).toBe('probing'); // the page is unloading to Google
    h.trackOnboardingStep.mockClear();

    pageshow(true);
    await flushPromises();

    expect(vm.phase).toBe('retry');
    expect(vm.navigatedAway).toBe(false);
    expect(shows(wrapper, 'resumeSetup.retryCta')).toBe(true);
    expect(shows(wrapper, 'resumeSetup.startOver')).toBe(true);
    // The probe never recorded `drive-consent`, so there is nothing to step back from.
    expect(h.trackOnboardingStep).not.toHaveBeenCalled();
    // Nothing re-probes until the person taps Try again.
    expect(h.probe).toHaveBeenCalledTimes(1);

    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    await vm.handleRetry();
    await flushPromises();
    expect(h.probe).toHaveBeenCalledTimes(2);
    expect(vm.phase).toBe('storage');
  });

  it('a restore while an action is still busy changes nothing', async () => {
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Vm;
    vi.mocked(isTokenValid).mockReturnValue(false);
    await vm.handleConnectDrive();
    await flushPromises();
    vm.busy = true;

    pageshow(true);
    await flushPromises();

    expect(vm.phase).toBe('finishing');
    expect(vm.navigatedAway).toBe(true);
  });

  it('a restored page from a stashed-failure retry goes back to storage', async () => {
    h.reason.value = 'cancelled';
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as Vm;
    expect(vm.phase).toBe('storage');
    await wrapper.find('[data-recovery="retry"]').trigger('click');
    await flushPromises();
    expect(vm.phase).toBe('finishing');

    pageshow(true);
    await flushPromises();

    expect(vm.phase).toBe('storage');
  });

  it('an ordinary (non-persisted) pageshow, or one after unmount, changes nothing', async () => {
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Vm;
    vi.mocked(isTokenValid).mockReturnValue(false);
    await vm.handleConnectDrive();
    await flushPromises();

    pageshow(false);
    await flushPromises();
    expect(vm.phase).toBe('finishing');

    wrapper.unmount();
    expect(() => pageshow(true)).not.toThrow();
  });
});

describe('ResumePodSetup — a survey that throws can never block completion', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.surveyThrows.value = true;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
  });
  it('throws twice: the setup modal opens both times, nothing escapes, and completion runs', async () => {
    const escaped = vi.fn();
    const wrapper = mount(ResumePodSetup, { global: { config: { errorHandler: escaped } } });
    await flushPromises();
    const vm = wrapper.vm as unknown as Vm & { handleSetupBack: () => void };
    vm.pin = '123456';
    vm.confirmPin = '123456';
    await vm.handleIdentityNext();
    await flushPromises();
    await vm.handleKitStepStored('saved');
    vm.handleMembersFinish();
    await flushPromises();

    // First throw: the survey is LEFT (unmounted), not left mounted behind the modal.
    expect(vm.showSetupModal).toBe(true);
    expect(vm.phase).toBe('finishing');
    expect(shows(wrapper, 'survey-step')).toBe(false);
    expect(shows(wrapper, 'resumeSetup.startOver')).toBe(false);

    // Back from the modal re-mounts the survey, which throws again: handled the same way.
    vm.handleSetupBack();
    await flushPromises();
    expect(vm.showSetupModal).toBe(true);
    expect(vm.phase).toBe('finishing');
    expect(
      h.reportError.mock.calls.filter(([a]) => a.surface === 'resumeSetup.survey')
    ).toHaveLength(2);
    expect(escaped).not.toHaveBeenCalled();

    await vm.handleSetupComplete();
    expect(h.sync.completePodSetup).toHaveBeenCalledWith({ heardVia: null });
    expect(wrapper.emitted('signed-in')).toEqual([['/nook']]);
  });

  it('Back from the setup modal records survey back, then survey shown', async () => {
    h.surveyThrows.value = false;
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as Vm & { handleSetupBack: () => void };
    vm.pin = '123456';
    vm.confirmPin = '123456';
    await vm.handleIdentityNext();
    await flushPromises();
    await vm.handleKitStepStored('saved');
    vm.handleMembersFinish();
    await flushPromises();
    vm.handleSurveyComplete(null);
    await flushPromises();
    h.trackOnboardingStep.mockClear();

    vm.handleSetupBack();
    await flushPromises();

    expect(vm.phase).toBe('survey');
    expect(h.trackOnboardingStep.mock.calls).toEqual([
      ['survey', 'back'],
      // No Drive failure on screen: the watcher's `extra` is `undefined`.
      ['survey', 'shown'],
    ]);
  });
});
