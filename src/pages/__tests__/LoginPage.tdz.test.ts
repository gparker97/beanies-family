/**
 * Regression test for the TDZ bug surfaced by Boeder Familienplan's onboarding
 * on 2026-05-18 (#beanies-errors vue-render alert at 07:15:08 UTC).
 *
 * The original code:
 *   const stopResumeWatch = watchEffect(() => {
 *     // ...
 *     stopResumeWatch();
 *   });
 *
 * threw `ReferenceError: Cannot access 'stopResumeWatch' before initialization`
 * when the watchEffect callback fired synchronously on its first run with all
 * conditions already true (authStore initialized + authenticated + route query
 * resume=setup) — typically the post-router-guard-redirect case. The const
 * assignment hadn't completed when the callback called the self-reference.
 *
 * Fixed by switching to `let stopResumeWatch: WatchStopHandle = () => {}`
 * then assigning the watchEffect handle to it; the first synchronous run
 * safely calls the no-op, then assignment completes.
 *
 * This test asserts: mounting LoginPage with all conditions already true
 * does not throw, and the component lands on the resume-setup view.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({
    path: '/welcome',
    fullPath: '/welcome?resume=setup',
    query: { resume: 'setup' },
    name: 'Welcome',
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    isConfigured: false,
    needsPermission: false,
    setupAutoSync: vi.fn(),
    ensureRegistered: vi.fn(),
  }),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({}),
}));

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    allFamilies: [],
  }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({}),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    // All three conditions true from the start — this is the scenario that
    // triggered the TDZ. Pre-fix, mounting threw a ReferenceError.
    isInitialized: true,
    isAuthenticated: true,
    needsAuth: false,
    podCreated: false,
    signOut: vi.fn(),
  }),
}));

vi.mock('@/services/sync/fileHandleStore', () => ({
  getProviderConfig: vi.fn(async () => null),
}));

vi.mock('@/config/features', () => ({
  features: { inviteGate: false },
}));

// Stub the login child components — they don't matter for this TDZ check.
vi.mock('@/components/login/LoginBackground.vue', () => ({
  default: { template: '<div><slot /></div>' },
}));
vi.mock('@/components/login/LoginSecurityFooter.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/login/WelcomeGate.vue', () => ({
  default: { template: '<div data-testid="welcome-gate" />' },
}));
vi.mock('@/components/login/FamilyPickerView.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/login/LoadPodView.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/login/PickBeanView.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/login/CreatePodView.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/login/ResumePodSetup.vue', () => ({
  default: { template: '<div data-testid="resume-pod-setup" />' },
}));
vi.mock('@/components/login/JoinPodView.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/login/BiometricLoginView.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('@/components/login/InviteGateOverlay.vue', () => ({
  default: { template: '<div />' },
}));

import LoginPage from '../LoginPage.vue';

describe('LoginPage — TDZ regression in stopResumeWatch', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('mounts without throwing when all watchEffect conditions are true at setup', () => {
    // Pre-fix: this throw'd `ReferenceError: Cannot access 'stopResumeWatch'
    // before initialization` because the watchEffect's first synchronous run
    // hit `stopResumeWatch()` before `const stopResumeWatch = watchEffect(...)`
    // had finished assigning. Post-fix: safe via let + no-op default.
    expect(() => mount(LoginPage)).not.toThrow();
  });

  it('lands on the resume-setup view when route query is resume=setup at mount', async () => {
    const wrapper = mount(LoginPage);
    // Resolve the synchronous watchEffect + onMounted microtasks.
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="resume-pod-setup"]').exists()).toBe(true);
  });
});
