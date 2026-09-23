/**
 * The resume dispatcher's `?resume=setup` branch is one-shot WITHOUT stopping the effect.
 *
 * ⚠️ BOTH HALVES ARE LOAD-BEARING, and the file exists because each has been got wrong once.
 *
 * (b) It must not RE-ASSERT. `useRoute().query` is a computed over vue-router's `currentRoute`
 * shallowRef, so every successful navigation re-runs the effect even with `resume` unchanged.
 * Four handlers move `activeView` off 'resume-setup' without touching the URL, so a standing rule
 * would snap someone mid-recovery back to the resume screen.
 *
 * (c) It must not STOP THE EFFECT either. `stopResumeWatch()` used to sit in this branch, and the
 * `load-drive` branch is the ONLY handler for `?resume=load-drive` — a return reachable in the
 * SAME mount (use a recovery kit → LoadPodView → the Drive card → a native redirect). Killing the
 * dispatcher there dropped the person back on the picker with no error, because nothing failed.
 *
 * ⚠️ HARNESS NOTE: neither sibling LoginPage test drives `route.query` reactively — they mock a
 * plain object, or mutate one before mount. (b) and (c) need the `watchEffect` to re-run on a
 * query change AFTER mount, so the route here is `reactive`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';

/**
 * ⚠️ THE TEST MUST MUTATE THE REACTIVE PROXY, NOT THE RAW OBJECT. `reactive(x)` returns a proxy;
 * writing to `x` directly notifies nothing, so the dispatcher never re-runs and every case looks
 * like the bug it is meant to detect. The mock factory publishes the proxy here.
 */
const holder = vi.hoisted(() => ({
  route: null as unknown as {
    path: string;
    fullPath: string;
    query: Record<string, unknown>;
    name: string;
  },
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// REACTIVE, unlike the sibling suites — these cases mutate the query after mount.
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
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

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

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    consumePendingRemovedEviction: async () => false,
    // The create flow is always authenticated by the time storage connects.
    isInitialized: true,
    isAuthenticated: true,
    needsAuth: false,
    podCreated: false,
    needsPodSetup: true,
    signOut: vi.fn(),
  }),
}));

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
vi.mock('@/components/login/LoadPodView.vue', () => ({
  default: {
    props: ['autoOpenDrivePicker'],
    template: '<div data-testid="load-pod" :data-auto-open="String(autoOpenDrivePicker)" />',
  },
}));
vi.mock('@/components/login/PickBeanView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/CreatePodView.vue', () => ({
  default: { template: '<div data-testid="create-pod" />' },
}));
vi.mock('@/components/login/ResumePodSetup.vue', () => ({
  default: {
    name: 'ResumePodSetup',
    emits: ['use-recovery'],
    template: '<div data-testid="resume-pod-setup" />',
  },
}));
vi.mock('@/components/login/JoinPodView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/BiometricLoginView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/login/InviteGateOverlay.vue', () => ({ default: { template: '<div />' } }));

import LoginPage from '../LoginPage.vue';

/** Point the reactive route at a `resume` marker, as a real navigation would. */
async function navigateTo(resume: string | null) {
  holder.route.query = resume === null ? {} : { resume };
  holder.route.fullPath = resume === null ? '/welcome' : `/welcome?resume=${resume}`;
  await nextTick();
  await flushPromises();
}

describe('LoginPage — the resume dispatcher is one-shot but stays alive', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    holder.route.query = {};
    holder.route.fullPath = '/welcome';
  });

  it('(a) dispatches `?resume=setup` to the resume-setup screen', async () => {
    const wrapper = mount(LoginPage);
    await flushPromises();

    await navigateTo('setup');
    expect(wrapper.find('[data-testid="resume-pod-setup"]').exists()).toBe(true);
  });

  it('(b) does NOT snap back after a handler moves the view without touching the URL', async () => {
    const wrapper = mount(LoginPage);
    await flushPromises();
    await navigateTo('setup');
    expect(wrapper.find('[data-testid="resume-pod-setup"]').exists()).toBe(true);

    // The child's "use a recovery kit" escape → LoadPodView, with `?resume=setup` still in the URL.
    await wrapper.findComponent({ name: 'ResumePodSetup' }).vm.$emit('use-recovery');
    await flushPromises();
    expect(wrapper.find('[data-testid="load-pod"]').exists()).toBe(true);

    // A later navigation re-runs the effect (a fresh `query` object, same `resume` value).
    await navigateTo('setup');
    expect(
      wrapper.find('[data-testid="load-pod"]').exists(),
      'a standing rule would snap the person mid-recovery back to the resume screen'
    ).toBe(true);
  });

  it('(d) does NOT yank an OPEN CREATE WIZARD to the resume screen', async () => {
    // ⚠️ greg's 2026-09-23 report, and the mechanism is entirely inside this file.
    //
    // A person mid-create is authenticated with no pod yet, so `needsPodSetup` is true for the
    // whole wizard. When App.vue's boot finally reaches its podless check — several awaits and
    // two dynamic imports in, which on a cold dev boot lands 5-10 seconds after the page loads —
    // it `router.replace`s to `/welcome?resume=setup` to "continue their flow". That navigation
    // re-runs this effect, the setup branch fires, and `activeView` is taken from 'create' to
    // 'resume-setup'. The wizard unmounts, which silently closes whatever modal it had open.
    //
    // greg hit it with the Drive-result modal on screen after cancelling Google's consent
    // popup: the dialog vanished by itself and he was moved to "finish setting up your pod"
    // having taken no action. His framing is the rule: the app was waiting on HIS decision.
    const wrapper = mount(LoginPage);
    await flushPromises();

    (wrapper.vm as unknown as Record<string, () => void>).handleRequestCreate();
    await nextTick();
    expect(wrapper.find('[data-testid="create-pod"]').exists()).toBe(true);

    // App.vue's boot rescue lands, late.
    await navigateTo('setup');

    expect(
      wrapper.find('[data-testid="create-pod"]').exists(),
      'the wizard must survive a late podless redirect — it IS the flow being steered to'
    ).toBe(true);
    expect(wrapper.find('[data-testid="resume-pod-setup"]').exists()).toBe(false);
  });

  it('(c) STILL dispatches `?resume=load-drive` after the setup branch has run in the same mount', async () => {
    const wrapper = mount(LoginPage);
    await flushPromises();

    await navigateTo('setup');
    expect(wrapper.find('[data-testid="resume-pod-setup"]').exists()).toBe(true);

    await navigateTo('load-drive');

    const loadPod = wrapper.find('[data-testid="load-pod"]');
    expect(
      loadPod.exists(),
      'the dispatcher must still be alive after the `setup` branch ran — this is the 2026-09-21 native bug'
    ).toBe(true);
    expect(loadPod.attributes('data-auto-open')).toBe('true');
  });
});
