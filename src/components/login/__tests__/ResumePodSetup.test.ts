/**
 * The create-resume screen's Drive seam, after the native round trip started being AWAITED
 * (2026-09-22).
 *
 * ⚠️ WHAT CHANGED, AND WHY THESE CASES ARE THE ONES WORTH HAVING. This screen used to carry a
 * five-part resume machine — a `'redirecting'` phase, a `redirectInFlight` marker, a
 * `hasMounted` flag, an escape button and a `v-model` latch — because on native the OAuth return
 * is a router navigation that remounts nothing, so the work had to be picked up from a URL marker.
 * `connectDriveStorage` now awaits the trip and returns `connected` / `failed` in place, exactly
 * as the desktop popup path always did, and the whole machine is gone. What must not regress is
 * the property greg stated as the rule: never land the person back on the screen they came from
 * with nothing said.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const h = vi.hoisted(() => ({
  probe: vi.fn(async () => ({ kind: 'no-registry-entry' }) as Record<string, unknown>),
  connectDrive: vi.fn(async () => ({ status: 'connected', type: 'google_drive' }) as unknown),
  createNewFile: vi.fn(
    async () => ({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } }) as unknown
  ),
  reportError: vi.fn(),
  reportCreateDriveFailure: vi.fn(),
  activeFamilyId: { value: 'fam-1' as string | null },
  // #128
  displayName: { value: 'Greg' as string | undefined },
  desktop: { value: true },
  surveyThrows: { value: false },
  trackOnboardingStep: vi.fn(),
  // #128 drive-declined
  reason: { value: null as string | null },
  localFiles: { value: false },
  connectLocal: vi.fn(async () => ({ status: 'failed', errorKind: 'cancelled' }) as unknown),
  rehydrateOwnerDoc: vi.fn(async () => ({ success: true }) as { success: boolean; error?: string }),
  markRecoveryKitConfirmed: vi.fn(async () => {}),
  sync: {
    isGoogleDriveAvailable: true,
    membersStepActive: false,
    completePodSetup: vi.fn(async () => {}),
  },
}));

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
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
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
  getProvider: vi.fn(() => null),
  providerBelongsToAnotherFamily: vi.fn(() => false),
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

// Each mount adds a window `pageshow` listener; unmount after every case so a later case's
// dispatched event reaches only its own screen.
enableAutoUnmount(afterEach);
import { DriveConsentDeniedError, OAuthRoundTripAbandonedError } from '@/types/sync';

/** Mount past `onMounted → runProbe()` and return the wrapper. */
async function mountScreen() {
  const wrapper = mount(ResumePodSetup);
  await flushPromises();
  return wrapper;
}

/**
 * Mount and walk the ordinary first-time route to the storage step: the PIN step with no
 * provider and no Google token lands there (`proceedToFinalize`'s last arm). The token mock is
 * restored to valid afterwards, so a Drive connect from here connects in place. ⚠️ THE PIN STEP
 * IS NOT OPTIONAL: `finalizePod` refuses to write before it (`ownerReady`), so a case that
 * starts a storage connect straight from the mount is testing the drive-declined route.
 */
async function atStorage() {
  const { isTokenValid } = await import('@/services/google/googleAuth');
  vi.mocked(isTokenValid).mockReturnValue(false);
  const wrapper = await mountScreen();
  const vm = wrapper.vm as unknown as Record<string, unknown> & {
    handleIdentityNext: () => Promise<void>;
  };
  vm.pin = '123456';
  vm.confirmPin = '123456';
  await vm.handleIdentityNext();
  await flushPromises();
  expect(vm.phase).toBe('storage');
  vi.mocked(isTokenValid).mockReturnValue(true);
  h.trackOnboardingStep.mockClear();
  return wrapper;
}

/** The screen renders one phase at a time; read it off the rendered text/markup. */
function shows(wrapper: Awaited<ReturnType<typeof mountScreen>>, key: string): boolean {
  return wrapper.text().includes(key);
}

describe('ResumePodSetup — the Drive seam continues in place', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.desktop.value = true;
    h.surveyThrows.value = false;
    h.sync.membersStepActive = false;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectDrive.mockResolvedValue({ status: 'connected', type: 'google_drive' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
    // `clearAllMocks` clears calls, not return values — restore the default so a case that
    // flips it cannot leak into the next one.
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(true);
  });

  it('a CONNECTED Drive result writes the pod and leaves the storage step', async () => {
    const wrapper = await atStorage();
    (wrapper.vm as unknown as Record<string, () => Promise<void>>).handleConnectDrive();
    await flushPromises();

    expect(h.connectDrive).toHaveBeenCalledTimes(1);
    expect(h.createNewFile).toHaveBeenCalledTimes(1);
    // The write succeeded, so the screen must NOT be back on the storage picker.
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
      h.localFiles.value = false;
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
    // `no-registry-entry → identity → proceedToFinalize → storage`, and on that path
    // there is no provider and no Google token — so the `else` that lands on 'storage' is the
    // NORMAL way in, not an error arm. A round-1 fix put "Google sign-in failed" there, which
    // told every first-time creator their sign-in had failed before they attempted one.
    // The shape a first-time creator is actually in at this point: nothing installed, no Google
    // token (the account was born from email + PIN), and no refresh token to recover silently.
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(false);

    const wrapper = await mountScreen();
    (wrapper.vm as unknown as Record<string, () => Promise<void>>).proceedToFinalize();
    await flushPromises();

    expect(shows(wrapper, 'resumeSetup.storagePrompt')).toBe(true);
    expect(shows(wrapper, 'googleDrive.authFailed')).toBe(false);
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(false);
  });

  it('REFUSES to write with no resolvable family id, rather than passing "" to the guard', async () => {
    // ⚠️ `''` MAKES EVERY BOUND PROVIDER FOREIGN. Passing it would refuse the create with a
    // message about the wrong thing; the honest answer is to stop here and page.
    h.activeFamilyId.value = null;
    const wrapper = await atStorage();
    (wrapper.vm as unknown as Record<string, () => Promise<void>>).handleConnectDrive();
    await flushPromises();

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
    const { reconnectForWriteRetry } = await import('@/services/google/driveTokenRecovery');
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Record<string, unknown> & {
      handleConnectDrive: () => Promise<void>;
    };

    await vm.handleConnectDrive();
    await flushPromises();

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
      h.localFiles.value = false;
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

/** Mount, set a valid PIN, submit the PIN step and settle the write. */
async function throughPin() {
  const wrapper = await mountScreen();
  const vm = wrapper.vm as unknown as Vm;
  vm.pin = '123456';
  vm.confirmPin = '123456';
  await vm.handleIdentityNext();
  await flushPromises();
  return { wrapper, vm };
}

function stepCalls(action: string): string[] {
  return h.trackOnboardingStep.mock.calls.filter(([, a]) => a === action).map(([step]) => step);
}

describe('ResumePodSetup — #128 order: write → kit → members → survey → Nook', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.desktop.value = true;
    h.surveyThrows.value = false;
    h.sync.membersStepActive = false;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectDrive.mockResolvedValue({ status: 'connected', type: 'google_drive' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(true);
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

  it('hides "Start over" on every post-write step, and shows it on the PIN step', async () => {
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as Vm;
    expect(shows(wrapper, 'resumeSetup.startOver')).toBe(true);

    for (const phase of ['recovery-kit', 'members', 'survey']) {
      vm.phase = phase;
      await flushPromises();
      expect(shows(wrapper, 'resumeSetup.startOver')).toBe(false);
    }
  });
});

describe('ResumePodSetup — #128 kit step', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.surveyThrows.value = false;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectDrive.mockResolvedValue({ status: 'connected', type: 'google_drive' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(true);
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

    vm.phase = 'survey';
    await flushPromises();
    expect(shows(wrapper, 'resumeSetup.title')).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
  });
});

describe('ResumePodSetup — #128 funnel steps', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.desktop.value = true;
    h.surveyThrows.value = false;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectDrive.mockResolvedValue({ status: 'connected', type: 'google_drive' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(true);
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

  it('no submitted for a PIN step whose owner rebuild failed', async () => {
    h.rehydrateOwnerDoc.mockResolvedValue({ success: false, error: 'nope' });
    await throughPin();

    expect(stepCalls('submitted')).toEqual([]);
    expect(h.createNewFile).not.toHaveBeenCalled();
  });

  it('the storage step is shown, and the Drive connect records drive-consent shown first', async () => {
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as Vm;
    vm.phase = 'storage';
    await flushPromises();
    h.trackOnboardingStep.mockClear();

    await vm.handleConnectDrive();
    await flushPromises();

    expect(h.trackOnboardingStep.mock.calls[0]).toEqual(['drive-consent', 'shown']);
    expect(h.trackOnboardingStep.mock.invocationCallOrder[0]!).toBeLessThan(
      h.connectDrive.mock.invocationCallOrder[0]!
    );
  });

  it('with no stashed reason the probe goes to the PIN step, never drive-declined', async () => {
    const wrapper = await mountScreen();
    expect(stepCalls('shown')).not.toContain('drive-declined');
    expect(shows(wrapper, 'resumeSetup.subtitlePin')).toBe(true);
  });
});

// ─── #128 B2: the web redirect's "Google needs a yes" return ──────────────────

describe('ResumePodSetup — #128 drive-declined', () => {
  type DeclinedVm = Vm & {
    handleDriveDeclinedRetry: () => Promise<void>;
    handleConnectLocal: () => Promise<void>;
    handleLocalFileClick: () => void;
  };

  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.desktop.value = true;
    h.surveyThrows.value = false;
    h.sync.membersStepActive = false;
    h.reason.value = 'cancelled';
    h.localFiles.value = false;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectDrive.mockResolvedValue({ status: 'redirecting' });
    h.connectLocal.mockResolvedValue({ status: 'connected', type: 'local' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(false);
  });

  it('a decline lands on the screen: title, orange notice, retry, Start over; no red box', async () => {
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;

    expect(vm.phase).toBe('drive-declined');
    expect(vm.driveFailure).toBe('cancelled');
    expect(shows(wrapper, 'resumeSetup.driveDeclinedTitle')).toBe(true);
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(true);
    expect(wrapper.find('[data-recovery="retry"]').exists()).toBe(true);
    expect(shows(wrapper, 'resumeSetup.startOver')).toBe(true);
    // The header's subtitle slot is empty here: the notice is the explanation.
    expect(shows(wrapper, 'resumeSetup.subtitle')).toBe(false);
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
    expect(stepCalls('shown')).toEqual(['resume-probe', 'drive-declined']);
    // The producer already reported it; the screen reports nothing new.
    expect(h.reportCreateDriveFailure).not.toHaveBeenCalled();
  });

  it('an unticked file-access box uses the consent copy under the same decision title', async () => {
    h.reason.value = 'consent-denied';
    const wrapper = await mountScreen();

    expect((wrapper.vm as unknown as DeclinedVm).phase).toBe('drive-declined');
    expect(shows(wrapper, 'resumeSetup.driveDeclinedTitle')).toBe(true);
    expect(shows(wrapper, 'createPod.driveConsentDenied')).toBe(true);
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(false);
    expect(wrapper.find('.bg-red-50').exists()).toBe(false);
  });

  it.each(['app-blocked', 'access-denied', 'unknown', 'drive-full', 'offline'])(
    'a stashed %s is NOT a decision: the neutral title, never "Google needs a yes"',
    async (code) => {
      h.reason.value = code;
      const wrapper = await mountScreen();

      expect((wrapper.vm as unknown as DeclinedVm).phase).toBe('drive-declined');
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
    expect((wrapper.vm as unknown as DeclinedVm).showLocalFileWarning).toBe(true);
  });

  it("the actions' Try again is the declined screen's own retry (it keeps the token shortcut)", async () => {
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(true);
    const wrapper = await mountScreen();

    await wrapper.find('[data-recovery="retry"]').trigger('click');
    await flushPromises();

    expect((wrapper.vm as unknown as DeclinedVm).phase).toBe('identity');
    expect(h.connectDrive).not.toHaveBeenCalled();
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
    expect(stepCalls('submitted')).toContain('drive-declined');
  });

  it('Try again with no token starts the Drive connect (the redirect), and keeps the spinner', async () => {
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;
    h.trackOnboardingStep.mockClear();

    await vm.handleDriveDeclinedRetry();
    await flushPromises();

    expect(h.connectDrive).toHaveBeenCalledTimes(1);
    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(h.trackOnboardingStep.mock.calls.slice(0, 2)).toEqual([
      ['drive-declined', 'submitted'],
      ['drive-consent', 'shown'],
    ]);
    // The page is unloading to Google: no flash of the storage picker, no `storage shown`
    // (which would log the unload as an abandon at `storage`).
    expect(vm.phase).toBe('finishing');
    expect(stepCalls('shown')).not.toContain('storage');
  });

  it('Try again with a VALID token routes to the PIN step and never writes a pod without a PIN', async () => {
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(true);
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;

    await vm.handleDriveDeclinedRetry();
    await flushPromises();

    expect(vm.phase).toBe('identity');
    expect(h.connectDrive).not.toHaveBeenCalled();
    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(stepCalls('submitted')).toEqual(['drive-declined']);
  });

  it('a local file chosen here goes to the PIN step first, then writes into it', async () => {
    h.localFiles.value = true;
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;

    await vm.handleConnectLocal();
    await flushPromises();
    expect(h.connectLocal).toHaveBeenCalledTimes(1);
    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(vm.phase).toBe('identity');
  });

  it('a local failure after a Drive failure: the red form error, the default notice, never the stale code', async () => {
    h.localFiles.value = true;
    h.connectLocal.mockResolvedValue({ status: 'failed', errorKind: 'unknown', error: 'disk' });
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;
    expect(vm.driveFailure).toBe('cancelled');

    await vm.handleConnectLocal();
    await flushPromises();

    expect(vm.phase).toBe('drive-declined');
    expect(vm.driveFailure).toBeNull();
    expect(vm.formError).toBe('setup.fileCreateFailed');
    expect(wrapper.find('.bg-red-50').exists()).toBe(true);
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(false);
    expect(wrapper.find('[data-recovery]').exists()).toBe(false);
    expect(shows(wrapper, 'resumeSetup.driveDeclinedBody')).toBe(true);
  });

  it('with NO code (a dismissed local picker), the screen keeps its default title and notice', async () => {
    h.localFiles.value = true;
    h.reason.value = 'app-blocked';
    h.connectLocal.mockResolvedValue({ status: 'failed', errorKind: 'cancelled' });
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;
    expect(shows(wrapper, 'createPod.driveError.title')).toBe(true);

    await vm.handleConnectLocal();
    await flushPromises();

    expect(vm.phase).toBe('drive-declined');
    expect(vm.driveFailure).toBeNull();
    // Never the neutral failure title with nothing under it to explain it.
    expect(shows(wrapper, 'createPod.driveError.title')).toBe(false);
    expect(shows(wrapper, 'resumeSetup.driveDeclinedTitle')).toBe(true);
    const notice = wrapper.find('p.border-l-4');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('resumeSetup.driveDeclinedBody');
    expect(shows(wrapper, 'resumeSetup.tryAgainWithGoogle')).toBe(true);
  });

  it('the declined screen offers a local file even for a code that omits it (as storage does)', async () => {
    h.localFiles.value = true;
    h.reason.value = 'popup-blocked';
    const wrapper = await mountScreen();
    expect((wrapper.vm as unknown as DeclinedVm).phase).toBe('drive-declined');
    expect(wrapper.find('[data-recovery="useLocal"]').exists()).toBe(true);
  });

  it('the valid-token shortcut to the PIN step clears the code: it never reappears on storage', async () => {
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(true);
    h.reason.value = 'app-blocked';
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;
    expect(vm.driveFailure).toBe('app-blocked');

    await vm.handleDriveDeclinedRetry();
    await flushPromises();
    expect(vm.phase).toBe('identity');
    expect(vm.driveFailure).toBeNull();

    vm.phase = 'storage';
    await flushPromises();
    expect(wrapper.find('[data-recovery]').exists()).toBe(false);
    expect(shows(wrapper, 'createPod.driveError.appBlocked')).toBe(false);
  });

  it('moving between the two failure phases keeps the code', async () => {
    h.reason.value = 'drive-full';
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;

    vm.phase = 'storage';
    await flushPromises();
    expect(vm.driveFailure).toBe('drive-full');
    expect(shows(wrapper, 'createPod.driveError.driveFull')).toBe(true);
  });

  it('a failed local file returns to the declined screen, not the storage step', async () => {
    h.localFiles.value = true;
    h.connectLocal.mockResolvedValue({ status: 'failed', errorKind: 'cancelled' });
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;

    await vm.handleConnectLocal();
    await flushPromises();
    expect(vm.phase).toBe('drive-declined');
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
      expect((wrapper.vm as unknown as DeclinedVm).phase).toBe(expected);
      expect(h.reason.value).toBeNull();
      expect(stepCalls('shown')).not.toContain('drive-declined');
    }
  );

  it('a retry re-probe never re-shows the decline (the reason is mount-only)', async () => {
    h.probe.mockResolvedValueOnce({ kind: 'registry-error', error: new Error('down') });
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm & { handleRetry: () => Promise<void> };
    expect(vm.phase).toBe('retry');

    await vm.handleRetry();
    await flushPromises();
    expect(vm.phase).toBe('identity');
  });
});

// ─── #128 review fix-ups: no write before the PIN, bfcache return, survey re-throw ───────────

describe('ResumePodSetup — no pod write before the PIN step, on any route', () => {
  type DeclinedVm = Vm & {
    handleDriveDeclinedRetry: () => Promise<void>;
    handleConnectLocal: () => Promise<void>;
  };

  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.surveyThrows.value = false;
    h.sync.membersStepActive = false;
    h.reason.value = 'cancelled';
    h.localFiles.value = true;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectLocal.mockResolvedValue({ status: 'connected', type: 'local' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(false);
  });

  it('a Drive gate that FAILS before redirecting returns to drive-declined, not storage', async () => {
    // The finding: this used to land on `storage`, whose buttons assume the PIN step ran, so
    // its local-file link (or a later Drive connect) wrote a pod with pin === ''.
    h.connectDrive.mockResolvedValue({
      status: 'failed',
      error: 'redirect could not start',
      errorKind: 'unknown',
    });
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;

    await vm.handleDriveDeclinedRetry();
    await flushPromises();

    expect(vm.phase).toBe('drive-declined');
    expect(vm.driveFailure).toBe('unknown');
    expect(shows(wrapper, 'createPod.driveError.unknown')).toBe(true);
    expect(shows(wrapper, 'createPod.driveError.title')).toBe(true);
    expect(stepCalls('shown')).not.toContain('storage');

    // …and the local-file link from here still goes to the PIN step first, no write…
    await vm.handleConnectLocal();
    await flushPromises();
    expect(vm.phase).toBe('identity');
    expect(h.createNewFile).not.toHaveBeenCalled();
    // …without the declined screen's stale Drive failure above the PIN form.
    expect(vm.formError).toBeNull();
    expect(vm.driveFailure).toBeNull();
    expect(shows(wrapper, 'createPod.driveError.unknown')).toBe(false);
  });

  it('a Drive connect that THROWS from drive-declined returns there too', async () => {
    h.connectDrive.mockRejectedValue(new Error('boom'));
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;

    await vm.handleDriveDeclinedRetry();
    await flushPromises();

    expect(vm.phase).toBe('drive-declined');
    expect(h.createNewFile).not.toHaveBeenCalled();
    // The unexpected throw takes the shared pattern: classified, reported once, shown in orange.
    expect(vm.driveFailure).toBe('unknown');
    expect(h.reportCreateDriveFailure).toHaveBeenCalledWith(
      'resumeSetup.connectDrive',
      'unknown',
      expect.any(Error)
    );
  });

  it('a Drive connect that CONNECTS in place from drive-declined goes to the PIN step, then writes', async () => {
    h.connectDrive.mockResolvedValue({ status: 'connected', type: 'google_drive' });
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;

    await vm.handleDriveDeclinedRetry();
    await flushPromises();
    expect(vm.phase).toBe('identity');
    expect(h.createNewFile).not.toHaveBeenCalled();

    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(true);
    vm.pin = '123456';
    vm.confirmPin = '123456';
    await vm.handleIdentityNext();
    await flushPromises();
    expect(h.rehydrateOwnerDoc).toHaveBeenCalledWith('Greg', '123456');
    expect(h.createNewFile).toHaveBeenCalledTimes(1);
    expect(vm.phase).toBe('recovery-kit');
  });

  it('an owner rebuild that THROWS stays on the PIN step (never the storage step)', async () => {
    h.reason.value = null;
    h.rehydrateOwnerDoc.mockRejectedValue(new Error('doc gone'));
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as DeclinedVm;
    vm.pin = '123456';
    vm.confirmPin = '123456';

    await vm.handleIdentityNext();
    await flushPromises();

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

  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.surveyThrows.value = false;
    h.reason.value = null;
    h.localFiles.value = false;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectDrive.mockResolvedValue({ status: 'redirecting' });
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(false);
  });

  it('a restored page leaves the spinner for the storage step, stepping back from drive-consent', async () => {
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Vm;
    const { isTokenValid } = await import('@/services/google/googleAuth');
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
    expect(vm.phase).toBe('identity');
  });

  it('a restore while an action is still busy changes nothing', async () => {
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Vm;
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(false);
    await vm.handleConnectDrive();
    await flushPromises();
    vm.busy = true;

    pageshow(true);
    await flushPromises();

    expect(vm.phase).toBe('finishing');
    expect(vm.navigatedAway).toBe(true);
  });

  it('a restored page from the drive-declined retry goes back to drive-declined', async () => {
    h.reason.value = 'cancelled';
    const wrapper = await mountScreen();
    const vm = wrapper.vm as unknown as Vm & { handleDriveDeclinedRetry: () => Promise<void> };
    await vm.handleDriveDeclinedRetry();
    await flushPromises();
    expect(vm.phase).toBe('finishing');

    pageshow(true);
    await flushPromises();

    expect(vm.phase).toBe('drive-declined');
  });

  it('an ordinary (non-persisted) pageshow, or one after unmount, changes nothing', async () => {
    const wrapper = await atStorage();
    const vm = wrapper.vm as unknown as Vm;
    const { isTokenValid } = await import('@/services/google/googleAuth');
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
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.activeFamilyId.value = 'fam-1';
    h.displayName.value = 'Greg';
    h.reason.value = null;
    h.surveyThrows.value = true;
    h.rehydrateOwnerDoc.mockResolvedValue({ success: true });
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectDrive.mockResolvedValue({ status: 'connected', type: 'google_drive' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(true);
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
      ['survey', 'shown'],
    ]);
  });
});
