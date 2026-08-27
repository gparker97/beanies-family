/**
 * Regression tests for the biometric ROUTING decision (tracker #76,
 * docs/plans/2026-08-27-biometric-unlocks-and-signs-in.md).
 *
 * This decision — offer biometric, or fall through to the bean picker / load screen —
 * is the heart of #76 and had no test at all. Two consequences of that:
 *
 *  1. The original defect survived for months: a device holding a good key was never
 *     offered it once the pod was already decrypted, because the branch reasoned that
 *     "biometric decrypt would fail" and forgot the key also identifies the member.
 *  2. The fix then shipped a second defect in review — the cold-start branch routed to
 *     the biometric view WITHOUT the device keys, so the button rendered and did
 *     literally nothing: no prompt, no error, no telemetry.
 *
 * Both are cheap to pin, so they are pinned. The mock preamble is lifted from
 * LoginPage.podlessRescue.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import type { PasskeyRegistration } from '@/types/models';

const { syncState, familyState, authState, logEventMock, routeState } = vi.hoisted(() => ({
  syncState: {
    isConfigured: true,
    needsPermission: false,
    hasPendingEncryptedFile: false,
    initialize: vi.fn(async () => {}),
    resetState: vi.fn(),
    setupAutoSync: vi.fn(),
    ensureRegistered: vi.fn(),
    loadFromFile: vi.fn(async () => ({ success: true })),
    decryptPendingFileWithKey: vi.fn(async () => ({ success: true })),
  },
  familyState: { members: [], allFamilies: [] as { id: string; name: string }[] },
  authState: {
    isInitialized: true,
    isAuthenticated: false,
    needsAuth: true,
    podCreated: true,
    needsPodSetup: false,
    signOut: vi.fn(),
    resolveDeviceKeysForFamily: vi.fn(async (): Promise<PasskeyRegistration[]> => []),
  },
  logEventMock: vi.fn(),
  routeState: { path: '/welcome', fullPath: '/welcome', query: {}, name: 'Welcome' },
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(async () => undefined) }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => syncState }));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ getCachedFamilyKey: () => null }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    allFamilies: familyState.allFamilies,
    activeFamilyId: 'family-1',
    initialize: vi.fn(async () => {}),
    switchFamily: vi.fn(async () => {}),
  }),
}));
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => familyState }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => authState }));
vi.mock('@/services/sync/fileHandleStore', () => ({ getProviderConfig: vi.fn(async () => null) }));
vi.mock('@/config/features', () => ({ features: { inviteGate: false } }));

vi.mock('@/components/login/LoginBackground.vue', () => ({
  default: { template: '<div><slot /></div>' },
}));
vi.mock('@/components/login/LoginSecurityFooter.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/WelcomeGate.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/FamilyPickerView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/LoadPodView.vue', () => ({
  default: { template: '<div data-testid="load-pod" />' },
}));
vi.mock('@/components/login/PickBeanView.vue', () => ({
  default: { template: '<div data-testid="pick-bean" />' },
}));
vi.mock('@/components/login/CreatePodView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/ResumePodSetup.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/JoinPodView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/InviteGateOverlay.vue', () => ({ default: { template: '<div />' } }));
// The stub EXPOSES the prop, because "did it receive the keys?" is the assertion that
// separates a working biometric screen from a dead button.
vi.mock('@/components/login/BiometricLoginView.vue', () => ({
  default: {
    props: ['familyId', 'familyName', 'deviceKeys'],
    template: '<div data-testid="biometric" :data-keys="deviceKeys.length" />',
  },
}));

import LoginPage from '../LoginPage.vue';

function makeKey(memberId: string): PasskeyRegistration {
  return {
    credentialId: `native:family-1:${memberId}`,
    memberId,
    familyId: 'family-1',
    publicKey: '',
    prfSupported: false,
    mechanism: 'native-keystore',
    label: 'this device',
    createdAt: '2026-01-01',
  };
}

/** One family on this device, so onMounted takes the single-family fast path. */
function withOneFamily() {
  familyState.allFamilies = [{ id: 'family-1', name: 'The Beans' }];
}

describe('LoginPage — biometric routing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    withOneFamily();
    syncState.isConfigured = true;
    syncState.needsPermission = false;
    syncState.hasPendingEncryptedFile = false;
    syncState.loadFromFile.mockReset();
    syncState.loadFromFile.mockResolvedValue({ success: true });
    authState.resolveDeviceKeysForFamily.mockResolvedValue([]);
  });

  it('pod ALREADY decrypted + a key on this device → biometric, WITH the keys', async () => {
    // The #76 defect: this used to go straight to pick-bean and ask for a password.
    authState.resolveDeviceKeysForFamily.mockResolvedValue([makeKey('member-1')]);
    syncState.hasPendingEncryptedFile = false;

    const wrapper = mount(LoginPage, { props: { initialView: 'welcome' } });
    await flushPromises();

    const view = wrapper.find('[data-testid="biometric"]');
    expect(view.exists()).toBe(true);
    expect(view.attributes('data-keys')).toBe('1');
  });

  it('pod still ENCRYPTED + a key on this device → biometric, WITH the keys', async () => {
    // The review defect: this branch routed to the view but never passed the keys, so
    // the button was inert. Asserting the prop — not just the view — is what catches it.
    authState.resolveDeviceKeysForFamily.mockResolvedValue([makeKey('member-1')]);
    // The pod is only discovered to be encrypted BY loadFromFile — at mount time nothing
    // is pending yet, which is what routes us down the family path in the first place.
    syncState.loadFromFile.mockImplementation(async () => {
      syncState.hasPendingEncryptedFile = true;
      return { success: false, needsPassword: true };
    });

    const wrapper = mount(LoginPage, { props: { initialView: 'welcome' } });
    await flushPromises();

    const view = wrapper.find('[data-testid="biometric"]');
    expect(view.exists()).toBe(true);
    expect(view.attributes('data-keys')).toBe('1');
  });

  it('two keys on one device → both are handed to the chooser', async () => {
    authState.resolveDeviceKeysForFamily.mockResolvedValue([
      makeKey('member-1'),
      makeKey('member-2'),
    ]);
    syncState.loadFromFile.mockImplementation(async () => {
      syncState.hasPendingEncryptedFile = true;
      return { success: false, needsPassword: true };
    });

    const wrapper = mount(LoginPage, { props: { initialView: 'welcome' } });
    await flushPromises();

    expect(wrapper.find('[data-testid="biometric"]').attributes('data-keys')).toBe('2');
  });

  it('no key on this device → pick-bean, never the biometric screen', async () => {
    authState.resolveDeviceKeysForFamily.mockResolvedValue([]);
    syncState.hasPendingEncryptedFile = false;

    const wrapper = mount(LoginPage, { props: { initialView: 'welcome' } });
    await flushPromises();

    expect(wrapper.find('[data-testid="biometric"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pick-bean"]').exists()).toBe(true);
  });

  it('logs which way it routed, and how many keys it saw', async () => {
    authState.resolveDeviceKeysForFamily.mockResolvedValue([makeKey('member-1')]);
    syncState.hasPendingEncryptedFile = false;

    mount(LoginPage, { props: { initialView: 'welcome' } });
    await flushPromises();

    // "Why was I not offered Face ID?" has to be answerable from CloudWatch alone.
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'login_routing',
        context: expect.objectContaining({
          action: 'biometric',
          detail: expect.stringContaining('keys=1'),
        }),
      })
    );
  });
});
