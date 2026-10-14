/**
 * "Open their profile" in the birthday drawer navigates to the member's profile. It once pushed
 * the named `BeanDetail` route with `params: { id }` while the route takes `memberId` + `tab`, so
 * vue-router threw `Missing required param "memberId"` on every tap and the button did nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import FamilyPlannerPage from '@/pages/FamilyPlannerPage.vue';

const push = vi.fn();
vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push, replace: vi.fn() }),
  useRoute: () => ({ query: {}, params: {}, path: '/activities' }),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    currentLanguage: ref('en'),
    isLoading: ref(false),
    isEnglish: ref(true),
    isBeanieMode: ref(false),
  }),
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

const MEMBER_ID = '0b9c2f4e-1a2b-4c3d-8e9f-0123456789ab';

beforeEach(() => {
  setActivePinia(createPinia());
  push.mockReset();
});

describe('FamilyPlannerPage birthday drawer', () => {
  it('opens the member profile overview by path', async () => {
    const wrapper = shallowMount(FamilyPlannerPage);
    await flushPromises();

    wrapper.findComponent({ name: 'BirthdayDetailsModal' }).vm.$emit('open-profile', MEMBER_ID);

    expect(push).toHaveBeenCalledWith(`/pod/${MEMBER_ID}/overview`);
  });
});
