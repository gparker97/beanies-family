/**
 * The create wizard's storage-step funnel events (#128).
 *
 * Two properties, both about what the `onboarding` firehose says happened on step 2:
 *   - a Drive connect that SUCCEEDS in place (desktop popup / native) moves the attempt's step
 *     back to `storage` when the "Drive connected" modal opens, so a tab closed on that modal is
 *     an abandon at `storage` (the pagehide hook ignores `drive-consent`);
 *   - `storage submitted` is logged only on the hand-off's success line, never for a refused one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';

const h = vi.hoisted(() => ({
  trackOnboardingStep: vi.fn(),
  reportError: vi.fn(),
  connectDrive: vi.fn(async () => ({ status: 'connected', type: 'google_drive' }) as unknown),
  sync: { isGoogleDriveAvailable: true, isConfigured: true, registerSignupStart: vi.fn() },
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/services/telemetry/onboardingAttempt', () => ({
  trackOnboardingStep: h.trackOnboardingStep,
  trackStorageChoice: vi.fn(),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ currentUser: { memberId: 'mem-1', familyId: 'fam-1' } }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'fam-1' }),
}));
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => h.sync }));
vi.mock('@/services/sync/connectStorage', () => ({
  connectDriveStorage: h.connectDrive,
  connectLocalStorage: vi.fn(),
}));
vi.mock('@/composables/useDriveCollisionRecovery', () => ({ resolveDriveCollision: vi.fn() }));
vi.mock('@/services/sync/capabilities', () => ({ canUseLocalFiles: () => false }));
vi.mock('@/services/google/googleAuth', () => ({ isUserCancellation: () => false }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));

import CreatePodView from '../CreatePodView.vue';

type Vm = Record<string, unknown> & {
  handleChooseGoogleDriveStorage: () => Promise<void>;
  handleStorageConnected: () => void;
};

async function atStorageStep() {
  const wrapper = shallowMount(CreatePodView);
  const vm = wrapper.vm as unknown as Vm;
  vm.currentStep = 2;
  await flushPromises();
  h.trackOnboardingStep.mockClear();
  return { wrapper, vm };
}

describe('CreatePodView — #128 storage-step funnel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.sync.isConfigured = true;
    h.connectDrive.mockResolvedValue({ status: 'connected', type: 'google_drive' });
  });

  it('a Drive connect that succeeds in place records storage shown when the result modal opens', async () => {
    const { vm } = await atStorageStep();

    await vm.handleChooseGoogleDriveStorage();
    await flushPromises();

    expect(vm.showDriveResultModal).toBe(true);
    expect(vm.driveResultError).toBeNull();
    expect(h.trackOnboardingStep.mock.calls).toEqual([
      ['drive-consent', 'shown'],
      ['storage', 'shown'],
    ]);
  });

  it('a failed Drive connect still records storage shown once', async () => {
    h.connectDrive.mockResolvedValue({ status: 'failed', error: 'boom' });
    const { vm } = await atStorageStep();

    await vm.handleChooseGoogleDriveStorage();
    await flushPromises();

    expect(h.trackOnboardingStep.mock.calls).toEqual([
      ['drive-consent', 'shown'],
      ['storage', 'shown'],
    ]);
  });

  it('a generic Drive failure shows the translated message, never the raw (Google) text', async () => {
    h.connectDrive.mockResolvedValue({
      status: 'failed',
      error: 'access_denied: Der Zugriff wurde verweigert',
    });
    const { vm } = await atStorageStep();

    await vm.handleChooseGoogleDriveStorage();
    await flushPromises();

    expect(vm.driveResultError).toBe('googleDrive.authFailed');
    // The raw text rides the report, not the modal.
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'createPod.connectDrive',
        message: 'access_denied: Der Zugriff wurde verweigert',
        context: { provider_type: 'google_drive' },
      })
    );
  });

  it('a classified kind that reaches the generic arm is reported as its error_code', async () => {
    // A name collision with no collision payload falls through to the generic arm.
    h.connectDrive.mockResolvedValue({
      status: 'failed',
      error: 'a file named x exists (id 1AbC)',
      errorKind: 'name-collision',
    });
    const { vm } = await atStorageStep();

    await vm.handleChooseGoogleDriveStorage();
    await flushPromises();

    expect(vm.driveResultError).toBe('googleDrive.authFailed');
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { provider_type: 'google_drive', error_code: 'name-collision' },
      })
    );
  });

  it('a redirecting connect records nothing beyond drive-consent shown (the page unloads)', async () => {
    h.connectDrive.mockResolvedValue({ status: 'redirecting' });
    const { vm } = await atStorageStep();

    await vm.handleChooseGoogleDriveStorage();
    await flushPromises();

    expect(h.trackOnboardingStep.mock.calls).toEqual([['drive-consent', 'shown']]);
  });

  it('logs storage submitted on a successful hand-off', async () => {
    const { wrapper, vm } = await atStorageStep();
    vm.storageSaved = true;

    vm.handleStorageConnected();

    expect(wrapper.emitted('finish-storage')).toHaveLength(1);
    expect(h.trackOnboardingStep).toHaveBeenCalledWith('storage', 'submitted');
  });

  it.each([
    ['no storage saved', () => {}, false],
    ['a provider that is not configured', () => (h.sync.isConfigured = false), true],
  ])('logs NO storage submitted for a refused hand-off (%s)', async (_n, arrange, saved) => {
    arrange();
    const { wrapper, vm } = await atStorageStep();
    vm.storageSaved = saved;

    vm.handleStorageConnected();

    expect(wrapper.emitted('finish-storage')).toBeUndefined();
    expect(vm.formError).toBe('setup.fileCreateFailed');
    expect(h.trackOnboardingStep).not.toHaveBeenCalledWith('storage', 'submitted');
  });
});
