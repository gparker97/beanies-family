/**
 * The create wizard's storage-step funnel events (#128).
 *
 * Two properties, both about what the `onboarding` firehose says happened on step 2:
 *   - a Drive connect that SUCCEEDS in place (desktop popup / native) moves the attempt's step
 *     back to `storage` when the "Drive connected" modal opens, so a tab closed on that modal is
 *     an abandon at `storage` (the pagehide hook ignores `drive-consent`);
 *   - `storage submitted` is logged only on the hand-off's success line, never for a refused one.
 *
 * Plus the failure modal's one pattern: every failure is one registry code, reported once through
 * `reportCreateDriveFailure`, shown under one neutral title with the registry's message and the
 * shared `CreateDriveFailureActions`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import CreateDriveFailureActions from '../CreateDriveFailureActions.vue';

const h = vi.hoisted(() => ({
  trackOnboardingStep: vi.fn(),
  reportError: vi.fn(),
  reportCreateDriveFailure: vi.fn(),
  resolveDriveCollision: vi.fn(),
  connectLocal: vi.fn(),
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
  connectLocalStorage: h.connectLocal,
  reportCreateDriveFailure: h.reportCreateDriveFailure,
}));
vi.mock('@/composables/useDriveCollisionRecovery', () => ({
  resolveDriveCollision: h.resolveDriveCollision,
}));
vi.mock('@/services/sync/capabilities', () => ({ canUseLocalFiles: () => false }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));

import CreatePodView from '../CreatePodView.vue';

type Vm = Record<string, unknown> & {
  handleChooseGoogleDriveStorage: (opts?: { chooseAccount?: boolean }) => Promise<void>;
  handleChooseLocalStorage: () => Promise<void>;
  handleStorageConnected: () => void;
};

async function atStorageStep() {
  // The result modal's body is a default slot; render it so the failure state is visible.
  const wrapper = shallowMount(CreatePodView, { global: { renderStubDefaultSlot: true } });
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
    expect(vm.driveFailure).toBeNull();
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

  it('a failure with no kind is `unknown`: reported once, the registry message, never raw text', async () => {
    h.connectDrive.mockResolvedValue({
      status: 'failed',
      error: 'access_denied: Der Zugriff wurde verweigert',
    });
    const { wrapper, vm } = await atStorageStep();

    await vm.handleChooseGoogleDriveStorage();
    await flushPromises();

    expect(vm.driveFailure).toBe('unknown');
    expect(vm.driveFailureMessage).toBe('createPod.driveError.unknown');
    expect(wrapper.text()).not.toContain('Der Zugriff');
    // The raw text rides the one report, not the modal.
    expect(h.reportCreateDriveFailure).toHaveBeenCalledTimes(1);
    expect(h.reportCreateDriveFailure).toHaveBeenCalledWith(
      'createPod.connectDrive',
      'unknown',
      'access_denied: Der Zugriff wurde verweigert'
    );
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it('reports the raw `cause` when the connect carries one (its name, stack and reason)', async () => {
    const cause = Object.assign(new Error('quota'), {
      status: 403,
      reason: 'storageQuotaExceeded',
    });
    h.connectDrive.mockResolvedValue({
      status: 'failed',
      error: 'quota',
      errorKind: 'drive-full',
      cause,
    });
    const { vm } = await atStorageStep();

    await vm.handleChooseGoogleDriveStorage();
    await flushPromises();

    expect(vm.driveFailure).toBe('drive-full');
    expect(vm.driveFailureMessage).toBe('createPod.driveError.driveFull');
    expect(h.reportCreateDriveFailure).toHaveBeenCalledWith(
      'createPod.connectDrive',
      'drive-full',
      cause
    );
  });

  it('a name collision with no collision payload takes the shared lines as its own code', async () => {
    h.connectDrive.mockResolvedValue({
      status: 'failed',
      error: 'a file named x exists (id 1AbC)',
      errorKind: 'name-collision',
    });
    const { vm } = await atStorageStep();

    await vm.handleChooseGoogleDriveStorage();
    await flushPromises();

    expect(vm.driveFailure).toBe('name-collision');
    expect(vm.driveFailureMessage).toBe('createPod.duplicateFile');
    expect(h.reportCreateDriveFailure).toHaveBeenCalledWith(
      'createPod.connectDrive',
      'name-collision',
      'a file named x exists (id 1AbC)'
    );
  });

  it.each(['cancelled', 'popup-blocked', 'drive-full', 'unknown'] as const)(
    'every failure (%s) shows the neutral title, never "sign-in failed", and the shared actions',
    async (code) => {
      h.connectDrive.mockResolvedValue({ status: 'failed', error: 'x', errorKind: code });
      const { wrapper, vm } = await atStorageStep();

      await vm.handleChooseGoogleDriveStorage();
      await flushPromises();

      expect(wrapper.text()).toContain('createPod.driveError.title');
      expect(wrapper.text()).not.toContain('googleDrive.authFailed');
      const actions = wrapper.findComponent(CreateDriveFailureActions);
      expect(actions.exists()).toBe(true);
      expect(actions.props('code')).toBe(code);
      // Heritage Orange badge with its dark partner, never Alert Red.
      expect(wrapper.find('.bg-red-100').exists()).toBe(false);
      expect(wrapper.find('.dark\\:bg-surface-overlay.rounded-full').exists()).toBe(true);
    }
  );

  it('an adopt-existing failure shows `unknown`, never "sign-in failed" (sign-in succeeded)', async () => {
    h.connectDrive.mockResolvedValue({
      status: 'failed',
      error: 'collision',
      errorKind: 'name-collision',
      collision: { fileId: 'f1', ownedByCurrentAccount: true },
    });
    h.resolveDriveCollision.mockResolvedValue({ kind: 'failed', error: 'adopt blew up' });
    const { vm } = await atStorageStep();

    await vm.handleChooseGoogleDriveStorage();
    await flushPromises();

    expect(vm.driveFailure).toBe('unknown');
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'createPod.adoptExisting', severity: 'critical' })
    );
    expect(h.reportCreateDriveFailure).not.toHaveBeenCalled();
  });

  it('the actions drive the host: retry re-connects, chooseAccount forces the chooser', async () => {
    h.connectDrive.mockResolvedValue({ status: 'failed', error: 'x', errorKind: 'drive-full' });
    const { wrapper, vm } = await atStorageStep();
    await vm.handleChooseGoogleDriveStorage();
    await flushPromises();
    h.connectDrive.mockResolvedValue({ status: 'redirecting' });

    wrapper.findComponent(CreateDriveFailureActions).vm.$emit('chooseAccount');
    await flushPromises();

    expect(h.connectDrive).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ chooseAccount: true })
    );
    // A new attempt clears the old code before it runs.
    expect(vm.driveFailure).toBeNull();
    expect(vm.showDriveResultModal).toBe(false);
  });

  it('a dismissed local picker (errorKind cancelled) re-prompts with no report', async () => {
    h.connectLocal.mockResolvedValue({ status: 'failed', error: 'x', errorKind: 'cancelled' });
    const { vm } = await atStorageStep();

    await vm.handleChooseLocalStorage();
    await flushPromises();

    expect(vm.formError).toBe('setup.fileCreateFailed');
    expect(h.reportError).not.toHaveBeenCalled();
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
