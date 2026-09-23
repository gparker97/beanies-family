/**
 * A joining link for one pod must never open another.
 *
 * The fixture below is the shape that made it happen in production: authenticated, ONE local
 * family, roster already in memory, arriving on `/join` for a DIFFERENT family.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({
    path: '/join',
    fullPath: '/join?fam=fam-B&t=tok',
    query: { fam: 'fam-B', t: 'tok' },
    name: 'JoinFamily',
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

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

// Signed in to pod A, single family, roster already in memory — the shape that made BOTH
// hijack branches fire (`:412` single-family fast login, `:422` members-already-loaded).
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    allFamilies: [{ id: 'fam-A', name: 'Pod A' }],
    activeFamilyId: 'fam-A',
    activeFamilyName: 'Pod A',
    initialize: vi.fn(async () => {}),
    switchFamily: vi.fn(async () => {}),
  }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [{ id: 'm1', name: 'Greg' }] }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    consumePendingRemovedEviction: async () => false,
    isInitialized: true,
    isAuthenticated: true,
    needsAuth: false,
    podCreated: true,
    signOut: vi.fn(),
  }),
}));

// ⚠️ MOCKED SO THE HIJACK CAN ACTUALLY SUCCEED. Left real, `startForFamily` fails in this
// environment, `activeView` never flips to 'flow', and JoinPodView renders anyway — so the
// test passed against the bug it names. Verified by disabling the guard and watching it fail.
const startForFamily = vi.fn(async () => true);
vi.mock('@/composables/useLoginFlow', () => ({
  useLoginFlow: () => ({
    startForFamily,
    state: { value: 'idle' },
    activeStep: { value: null },
    recoveryOpenedBy: { value: null },
    dispatch: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('@/services/sync/fileHandleStore', () => ({
  getProviderConfig: vi.fn(async () => null),
}));

vi.mock('@/config/features', () => ({ features: { inviteGate: false } }));

vi.mock('@/components/login/LoginBackground.vue', () => ({
  default: { template: '<div><slot /></div>' },
}));
vi.mock('@/components/login/LoginSecurityFooter.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/WelcomeGate.vue', () => ({
  default: { template: '<div data-testid="welcome-gate" />' },
}));
vi.mock('@/components/login/FamilyPickerView.vue', () => ({ default: { template: '<div />' } }));
// Expose the prop so the assertion can read it.
vi.mock('@/components/login/LoadPodView.vue', () => ({
  default: {
    props: ['autoOpenDrivePicker'],
    template: '<div data-testid="load-pod" :data-auto-open="String(autoOpenDrivePicker)" />',
  },
}));
vi.mock('@/components/login/PickBeanView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/CreatePodView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/ResumePodSetup.vue', () => ({
  default: { template: '<div data-testid="resume-pod-setup" />' },
}));
vi.mock('@/components/login/JoinPodView.vue', () => ({
  default: { template: '<div data-testid="join-pod" />' },
}));
vi.mock('@/components/login/BiometricLoginView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/InviteGateOverlay.vue', () => ({ default: { template: '<div />' } }));

import LoginPage from '../LoginPage.vue';

/**
 * ⚠️ A JOINING LINK FOR ONE POD MUST NEVER OPEN ANOTHER.
 *
 * greg hit this in production on an iPhone: signed in to pod A, scanned a joining QR for pod
 * B, and landed on pod A's member list. `/join` is deliberately excluded from
 * `ALREADY_AUTH_REDIRECT_FROM` (`router/index.ts:414`) precisely so an authenticated user can
 * accept an invite to a DIFFERENT pod — but `LoginPage.onMounted` then ran the whole boot
 * path anyway, and every branch of it reads the ACTIVE family rather than the one in the URL:
 *
 *   - the single-family fast login calls `handleFamilySelected(theOnlyLocalFamily)`
 *   - the "members already loaded" else branch calls `enterFlow(activeFamilyId)`
 *
 * Either flips `activeView` off `'join'` before `isInitializing` clears, so `JoinPodView`
 * never mounts and `route.query.fam` — sitting there the whole time — is never read.
 *
 * This fixture is the exact shape that triggered it: authenticated, ONE local family, roster
 * already in memory. If the guard is removed, `JoinPodView` does not render and this fails.
 */
describe('LoginPage — a /join arrival owns the screen', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('REGRESSION: renders JoinPodView for a pod-B link while signed in to pod A', async () => {
    const wrapper = mount(LoginPage, { props: { initialView: 'join' } });
    await flushPromises();

    expect(wrapper.find('[data-testid="join-pod"]').exists()).toBe(true);
    // The two symptoms of the hijack: the welcome gate, or pod A's own surfaces.
    expect(wrapper.find('[data-testid="welcome-gate"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="load-pod"]').exists()).toBe(false);
    // The decisive one: the boot path must never have started a flow for the ACTIVE family.
    expect(startForFamily).not.toHaveBeenCalled();
  });
});
