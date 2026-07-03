/**
 * CalendarConnectNudge — renders only when the composable says so, "Connect"
 * deep-links to the calendar settings drawer, and ✕ dismisses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import CalendarConnectNudge from '../CalendarConnectNudge.vue';
import { CALENDAR_SYNC_OPEN } from '@/constants/settingsDeepLinks';

const showNudge = ref(true);
const dismiss = vi.fn();
vi.mock('@/composables/useCalendarNudge', () => ({
  useCalendarNudge: () => ({ showNudge, dismiss }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const push = vi.fn(() => Promise.resolve());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  showNudge.value = true;
  dismiss.mockClear();
  push.mockClear();
});

describe('CalendarConnectNudge', () => {
  it('renders the banner when showNudge is true', () => {
    const wrapper = mount(CalendarConnectNudge);
    expect(wrapper.find('[data-testid="calendar-connect-nudge"]').exists()).toBe(true);
  });

  it('renders nothing when showNudge is false', () => {
    showNudge.value = false;
    const wrapper = mount(CalendarConnectNudge);
    expect(wrapper.find('[data-testid="calendar-connect-nudge"]').exists()).toBe(false);
  });

  it('Connect deep-links to the calendar settings drawer', async () => {
    const wrapper = mount(CalendarConnectNudge);
    await wrapper.get('.cal-nudge-connect').trigger('click');
    expect(push).toHaveBeenCalledWith({ path: '/settings', query: { open: CALENDAR_SYNC_OPEN } });
  });

  it('✕ dismisses the nudge', async () => {
    const wrapper = mount(CalendarConnectNudge);
    await wrapper.get('.cal-nudge-dismiss').trigger('click');
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
