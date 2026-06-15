/**
 * Regression test for the create-pod onboarding remount race
 * (docs/plans/2026-06-15-onboarding-remount-race.md).
 *
 * When LoginPage is (re)mounted in a podless state (authenticated, no `.beanpod`
 * yet) WITHOUT a recovery query in the URL — e.g. the create-pod step-1 remount,
 * or a deep-link to /create after signup — its onMounted must SELF-RESCUE by
 * replacing to the resume-setup screen, and must clear `isInitializing` so the
 * user is never stranded on an infinite spinner under the app shell.
 *
 * It must NOT redirect when already on a recovery surface (?resume=setup /
 * ?resume=load-drive) — there the reactive watchEffect drives the view.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const RESUME_SETUP_PATH = '/welcome?resume=setup';

// Hoisted so the (hoisted) vi.mock factories below can safely reference them.
const { replaceMock, reportErrorMock, routeState } = vi.hoisted(() => ({
  replaceMock: vi.fn(async () => undefined),
  reportErrorMock: vi.fn(),
  routeState: {
    path: '/create',
    fullPath: '/create',
    query: {} as Record<string, unknown>,
    name: 'CreateFamily',
  },
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push: vi.fn(), replace: replaceMock }),
}));

// RESUME_SETUP_PATH now lives in the lightweight resumePaths.ts (no heavy
// Drive/sync graph), so LoginPage no longer imports connectStorage — no mock
// needed for it.

vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    isConfigured: false,
    needsPermission: false,
    hasPendingEncryptedFile: false,
    initialize: vi.fn(async () => {}),
    setupAutoSync: vi.fn(),
    ensureRegistered: vi.fn(),
  }),
}));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => ({}) }));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ allFamilies: [], initialize: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => ({ members: [] }) }));

const authState = {
  isInitialized: true,
  isAuthenticated: true,
  needsAuth: false,
  podCreated: false,
  needsPodSetup: true,
  signOut: vi.fn(),
};
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => authState }));

vi.mock('@/services/sync/fileHandleStore', () => ({ getProviderConfig: vi.fn(async () => null) }));
vi.mock('@/config/features', () => ({ features: { inviteGate: false } }));

vi.mock('@/components/login/LoginBackground.vue', () => ({
  default: { template: '<div><slot /></div>' },
}));
vi.mock('@/components/login/LoginSecurityFooter.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/WelcomeGate.vue', () => ({
  default: { template: '<div data-testid="welcome-gate" />' },
}));
vi.mock('@/components/login/FamilyPickerView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/LoadPodView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/PickBeanView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/CreatePodView.vue', () => ({
  default: { template: '<div data-testid="create-pod" />' },
}));
vi.mock('@/components/login/ResumePodSetup.vue', () => ({
  default: { template: '<div data-testid="resume-pod-setup" />' },
}));
vi.mock('@/components/login/JoinPodView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/BiometricLoginView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/InviteGateOverlay.vue', () => ({ default: { template: '<div />' } }));

import LoginPage from '../LoginPage.vue';

describe('LoginPage — podless self-rescue (onboarding remount race)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    routeState.path = '/create';
    routeState.fullPath = '/create';
    routeState.query = {};
    routeState.name = 'CreateFamily';
  });

  it('podless on /create with no recovery query → replaces to resume-setup, clears the spinner', async () => {
    const wrapper = mount(LoginPage, { props: { initialView: 'create' } });
    await flushPromises();

    expect(replaceMock).toHaveBeenCalledWith(RESUME_SETUP_PATH);
    // The spinner (v-if="isInitializing") must be gone — never a dead hang.
    expect(wrapper.text()).not.toContain('counting beans');
    // The create view is still mounted (we did not blow away the page).
    expect(wrapper.find('[data-testid="create-pod"]').exists()).toBe(true);
  });

  it('does NOT redirect when already on a recovery surface (?resume=setup)', async () => {
    routeState.path = '/welcome';
    routeState.fullPath = '/welcome?resume=setup';
    routeState.query = { resume: 'setup' };
    routeState.name = 'Welcome';

    mount(LoginPage, { props: { initialView: 'welcome' } });
    await flushPromises();

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('does NOT redirect when on the Drive-load recovery surface (?resume=load-drive)', async () => {
    routeState.path = '/welcome';
    routeState.fullPath = '/welcome?resume=load-drive';
    routeState.query = { resume: 'load-drive' };
    routeState.name = 'Welcome';

    mount(LoginPage, { props: { initialView: 'welcome' } });
    await flushPromises();

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
