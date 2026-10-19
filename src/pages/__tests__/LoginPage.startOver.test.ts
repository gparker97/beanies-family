/**
 * "Start over" on the resume-setup screen runs the Start over sign-out tier (2026-10-19).
 *
 * The plain sign-out never forgets the family, so the tombstoned family stayed active in the
 * family context: every later event carried its `family_id` and the next boot restored it.
 * `signOut({ startOver: true })` selects `SIGN_OUT_START_OVER_STEPS`, which forgets it
 * locally. The registry tombstone (`abandonSignupStart`) must run first, while the session
 * still names the family.
 *
 * Harness: the mount pattern from `LoginPage.resumeSetupOneShot.test.ts` (reactive route,
 * every child view stubbed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';

const holder = vi.hoisted(() => ({
  route: null as unknown as {
    path: string;
    fullPath: string;
    query: Record<string, unknown>;
    name: string;
  },
  calls: [] as string[],
  signOut: null as unknown as ReturnType<typeof vi.fn>,
  abandonSignupStart: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  holder.route = reactive({
    path: '/welcome',
    fullPath: '/welcome',
    query: {} as Record<string, unknown>,
    name: 'Welcome',
  });
  return {
    useRoute: () => holder.route,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(async () => {}) }),
  };
});

vi.mock('@/services/telemetry/onboardingAttempt', () => ({ endCreateAttempt: vi.fn() }));

vi.mock('@/stores/syncStore', () => {
  holder.abandonSignupStart = vi.fn(async () => {
    holder.calls.push('abandonSignupStart');
  });
  return {
    useSyncStore: () => ({
      isConfigured: false,
      needsPermission: false,
      hasPendingEncryptedFile: false,
      initialize: vi.fn(async () => {}),
      setupAutoSync: vi.fn(),
      ensureRegistered: vi.fn(),
      abandonSignupStart: holder.abandonSignupStart,
    }),
  };
});
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => ({}) }));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ allFamilies: [], initialize: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => ({ members: [] }) }));

vi.mock('@/stores/authStore', () => {
  holder.signOut = vi.fn(async () => {
    holder.calls.push('signOut');
    return { cacheDeleted: true };
  });
  return {
    useAuthStore: () => ({
      consumePendingRemovedEviction: async () => false,
      isInitialized: true,
      isAuthenticated: true,
      needsAuth: false,
      podCreated: false,
      needsPodSetup: true,
      signOut: holder.signOut,
    }),
  };
});

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
vi.mock('@/components/login/CreatePodView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/ResumePodSetup.vue', () => ({
  default: {
    name: 'ResumePodSetup',
    emits: ['start-over'],
    template: '<div data-testid="resume-pod-setup" />',
  },
}));
vi.mock('@/components/login/JoinPodView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/BiometricLoginView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/InviteGateOverlay.vue', () => ({ default: { template: '<div />' } }));

import LoginPage from '../LoginPage.vue';

describe('LoginPage: Start over forgets the never-finished family', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    holder.calls.length = 0;
    holder.signOut.mockClear();
    holder.abandonSignupStart.mockClear();
    holder.route.query = {};
    holder.route.fullPath = '/welcome';
  });

  it('runs the Start over sign-out tier after the registry tombstone', async () => {
    const wrapper = mount(LoginPage);
    await flushPromises();
    holder.route.query = { resume: 'setup' };
    holder.route.fullPath = '/welcome?resume=setup';
    await nextTick();
    await flushPromises();

    await wrapper.findComponent({ name: 'ResumePodSetup' }).vm.$emit('start-over');
    await flushPromises();

    expect(holder.signOut).toHaveBeenCalledWith({ startOver: true });
    expect(holder.calls).toEqual(['abandonSignupStart', 'signOut']);
  });
});
