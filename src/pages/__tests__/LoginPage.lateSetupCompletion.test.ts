/**
 * `handleSignedIn` finishes a setup left unfinished in the wizard FIRST (2026-11-16): before the
 * create attempt is superseded (a late completion that took over the open attempt ends it as
 * `done` itself) and before the login register (which must queue behind the completion write).
 *
 * Harness: `LoginPage.startOver.test.ts`'s (reactive route, every child view stubbed); the
 * sign-in is the resume screen's `signed-in` emit, which names no method.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';

const holder = vi.hoisted(() => {
  const state = {
    route: null as unknown as {
      path: string;
      fullPath: string;
      query: Record<string, unknown>;
      name: string;
    },
    calls: [] as string[],
    signOut: null as unknown as ReturnType<typeof vi.fn>,
    abandonSignupStart: null as unknown as ReturnType<typeof vi.fn>,
    ownsAttempt: false,
    finishPendingPodSetup: null as unknown as ReturnType<typeof vi.fn>,
  };
  state.finishPendingPodSetup = vi.fn((via: string) => {
    state.calls.push(`finishPendingPodSetup:${via}`);
    return state.ownsAttempt;
  });
  return state;
});

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

vi.mock('@/services/telemetry/onboardingAttempt', () => ({
  endCreateAttempt: vi.fn((reason: string) => holder.calls.push(`endCreateAttempt:${reason}`)),
}));

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
      ensureRegistered: vi.fn((isLogin: boolean) =>
        holder.calls.push(`ensureRegistered:${isLogin}`)
      ),
      abandonSignupStart: holder.abandonSignupStart,
      finishPendingPodSetup: holder.finishPendingPodSetup,
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
    emits: ['start-over', 'signed-in'],
    template: '<div data-testid="resume-pod-setup" />',
  },
}));
vi.mock('@/components/login/JoinPodView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/BiometricLoginView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/InviteGateOverlay.vue', () => ({ default: { template: '<div />' } }));

import LoginPage from '../LoginPage.vue';

async function signInFromResume() {
  const wrapper = mount(LoginPage);
  await flushPromises();
  holder.route.query = { resume: 'setup' };
  holder.route.fullPath = '/welcome?resume=setup';
  await nextTick();
  await flushPromises();
  await wrapper.findComponent({ name: 'ResumePodSetup' }).vm.$emit('signed-in', '/nook');
  await flushPromises();
}

describe('LoginPage.handleSignedIn: the late setup completion comes first', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    holder.calls.length = 0;
    holder.ownsAttempt = false;
    holder.route.query = {};
    holder.route.fullPath = '/welcome';
  });

  it('runs before the attempt is superseded and before the login register', async () => {
    await signInFromResume();

    expect(holder.calls).toEqual([
      'finishPendingPodSetup:signed-in',
      'endCreateAttempt:superseded',
      'ensureRegistered:true',
    ]);
  });

  it('leaves the attempt to a late completion that took it over', async () => {
    holder.ownsAttempt = true;

    await signInFromResume();

    expect(holder.calls).toEqual(['finishPendingPodSetup:signed-in', 'ensureRegistered:true']);
  });
});
