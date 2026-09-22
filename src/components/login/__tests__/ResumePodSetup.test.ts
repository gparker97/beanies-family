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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const h = vi.hoisted(() => ({
  probe: vi.fn(async () => ({ kind: 'no-registry-entry' }) as Record<string, unknown>),
  connectDrive: vi.fn(async () => ({ status: 'connected', type: 'google_drive' }) as unknown),
  createNewFile: vi.fn(
    async () => ({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } }) as unknown
  ),
  reportError: vi.fn(),
  activeFamilyId: { value: 'fam-1' as string | null },
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn(async () => false) }));
vi.mock('@/composables/useDriveCollisionRecovery', () => ({
  resolveDriveCollision: vi.fn(async () => ({ kind: 'declined' })),
}));
vi.mock('@/services/sync/connectStorage', () => ({
  connectDriveStorage: h.connectDrive,
  connectLocalStorage: vi.fn(async () => ({ status: 'failed', cancelled: true })),
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
  isUserCancellation: vi.fn(() => false),
}));
vi.mock('@/services/sync/capabilities', () => ({ canUseLocalFiles: () => false }));
vi.mock('@/services/auth/deviceUnlock', () => ({ isValidPin: (p: string) => /^\d{6}$/.test(p) }));
vi.mock('@/components/login/resumePaths', () => ({ consumeResumeReason: () => null }));
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
    },
    podCreated: false,
    enrollDevicePinWrapForMember: vi.fn(async () => {}),
  }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    activeFamilyId: h.activeFamilyId.value,
    activeFamilyName: 'The Parkers',
    switchFamily: vi.fn(async () => {}),
  }),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ loadSettings: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    isGoogleDriveAvailable: true,
    membersStepActive: false,
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
vi.mock('@/components/auth/RecoveryKitDisplay.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/auth/MagicLinkFlow.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/CreatePodSurvey.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/SetupProgressModal.vue', () => ({ default: { template: '<div />' } }));

import ResumePodSetup from '../ResumePodSetup.vue';
import { DriveConsentDeniedError, OAuthRoundTripAbandonedError } from '@/types/sync';

/** Mount past `onMounted → runProbe()` and return the wrapper. */
async function mountScreen() {
  const wrapper = mount(ResumePodSetup);
  await flushPromises();
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
    h.probe.mockResolvedValue({ kind: 'no-registry-entry' });
    h.connectDrive.mockResolvedValue({ status: 'connected', type: 'google_drive' });
    h.createNewFile.mockResolvedValue({ ok: true, kit: { code: 'KIT-CODE', kitId: 'kit-1' } });
    // `clearAllMocks` clears calls, not return values — restore the default so a case that
    // flips it cannot leak into the next one.
    const { isTokenValid } = await import('@/services/google/googleAuth');
    vi.mocked(isTokenValid).mockReturnValue(true);
  });

  it('a CONNECTED Drive result writes the pod and leaves the storage step', async () => {
    const wrapper = await mountScreen();
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
      cancelled: true,
    });
    const wrapper = await mountScreen();
    (wrapper.vm as unknown as Record<string, () => Promise<void>>).handleConnectDrive();
    await flushPromises();

    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(shows(wrapper, 'resumeSetup.storagePrompt')).toBe(true);
    // ⚠️ "CANCELLED", NOT "FAILED". Telling someone their sign-in failed when they cancelled it
    // frames their own decision as a code error and tells them to retry something that did
    // exactly what they asked.
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(true);
    expect(shows(wrapper, 'googleDrive.authFailed')).toBe(false);
    // A benign abort is reported at `warning`, never as a fault.
    expect(h.reportError).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning' }));
  });

  it('a CONSENT DENIAL shows the specific "allow file access" copy, not the generic failure', async () => {
    h.connectDrive.mockResolvedValue({
      status: 'failed',
      error: new DriveConsentDeniedError('not granted').message,
      errorKind: 'consent-denied',
    });
    const wrapper = await mountScreen();
    (wrapper.vm as unknown as Record<string, () => Promise<void>>).handleConnectDrive();
    await flushPromises();

    expect(shows(wrapper, 'resumeSetup.driveConsentDenied')).toBe(true);
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
    expect(shows(wrapper, 'resumeSetup.driveConsentDenied')).toBe(true);
    // A consent denial is a DECISION — reported, but never at `error`.
    expect(h.reportError).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning' }));
  });

  it('a probe that ABANDONED the sheet reports nothing at all — closing it is not a fault', async () => {
    h.probe.mockResolvedValue({
      kind: 'drive-auth-failed',
      error: new OAuthRoundTripAbandonedError('dismissed'),
    });
    const wrapper = await mountScreen();

    expect(shows(wrapper, 'resumeSetup.retryBody')).toBe(true);
    expect(shows(wrapper, 'googleDrive.authCancelled')).toBe(true);
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it('a WEB `redirecting` probe keeps the spinner — the page is unloading', async () => {
    h.probe.mockResolvedValue({ kind: 'redirecting' });
    const wrapper = await mountScreen();

    expect(shows(wrapper, 'resumeSetup.retryBody')).toBe(false);
    expect(shows(wrapper, 'resumeSetup.storagePrompt')).toBe(false);
  });

  it('the ORDINARY arrival at the storage step says nothing about a failure', async () => {
    // ⚠️ THE REGRESSION THIS EXISTS TO STOP, and it was introduced by a fix for an earlier
    // review finding. For a brand-new family the route is
    // `no-registry-entry → identity → survey → proceedToFinalize → storage`, and on that path
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
    const wrapper = await mountScreen();
    (wrapper.vm as unknown as Record<string, () => Promise<void>>).handleConnectDrive();
    await flushPromises();

    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'resumeSetup.finalize', severity: 'critical' })
    );
  });
});
