/**
 * Regression test for the Drive-LOAD OAuth resume continuation (ADR-029 /
 * docs/plans/2026-05-22-native-pwa-drive-oauth-redirect-unification.md).
 *
 * The native/PWA Drive sign-in returns via `?resume=load-drive`. In a FRESH
 * sign-in (zero local families) the user is NOT yet authenticated when the
 * redirect lands — loading the pod is what produces the family/auth (see
 * authStore.ts). The resume dispatcher therefore MUST handle `load-drive`
 * BEFORE the `isAuthenticated` gate that `resume=setup` relies on; otherwise the
 * picker never re-opens and the user is silently stranded (the exact bug Pass 4
 * of the plan caught).
 *
 * This test pins that ordering: with `isAuthenticated === false` and
 * `resume=load-drive`, LoginPage must land on LoadPodView with
 * `autoOpenDrivePicker` true — NOT the welcome gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({
    path: '/welcome',
    fullPath: '/welcome?resume=load-drive',
    query: { resume: 'load-drive' },
    name: 'Welcome',
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

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    allFamilies: [],
    initialize: vi.fn(async () => {}),
  }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [] }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    // The fresh-sign-in shape: initialized but NOT authenticated, no pod yet.
    isInitialized: true,
    isAuthenticated: false,
    needsAuth: true,
    podCreated: false,
    signOut: vi.fn(),
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
vi.mock('@/components/login/JoinPodView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/BiometricLoginView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/InviteGateOverlay.vue', () => ({ default: { template: '<div />' } }));

import LoginPage from '../LoginPage.vue';

describe('LoginPage — resume=load-drive continuation (ADR-029)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('dispatches load-drive while UNAUTHENTICATED → LoadPodView with autoOpenDrivePicker (not the welcome gate)', async () => {
    const wrapper = mount(LoginPage);
    await flushPromises();

    const loadPod = wrapper.find('[data-testid="load-pod"]');
    expect(loadPod.exists()).toBe(true);
    // The picker auto-open flag must be set — this is what re-opens the picker
    // after the OAuth round-trip.
    expect(loadPod.attributes('data-auto-open')).toBe('true');
    // Must NOT have fallen back to the welcome gate (the regression symptom if
    // load-drive were re-folded behind the isAuthenticated gate).
    expect(wrapper.find('[data-testid="welcome-gate"]').exists()).toBe(false);
  });
});
