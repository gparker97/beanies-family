/**
 * Drilling into a day from the month opens the Day view on that date, and switching back to the
 * month shows the same period. The month carries no leftover "clicked day" state: the page keeps
 * only `referenceDate`, which is what both surfaces read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import FamilyPlannerPage from '@/pages/FamilyPlannerPage.vue';

vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

async function settle() {
  await flushPromises();
  await nextTick();
  await nextTick();
}

type Wrapper = ReturnType<typeof mountPage>;
function mountPage() {
  return shallowMount(FamilyPlannerPage, { attachTo: document.body });
}
/** Whichever month surface mounted (the stream on a phone, the grid otherwise). */
function monthSurface(w: Wrapper) {
  const stream = w.findComponent({ name: 'CalendarMonthStream' });
  return stream.exists() ? stream : w.findComponent({ name: 'CalendarGrid' });
}
const dayView = (w: Wrapper) => w.findComponent({ name: 'DailyCalendarView' });
const commandBar = (w: Wrapper) => w.findComponent({ name: 'CalendarCommandBar' });

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('FamilyPlannerPage: month to day and back', () => {
  it('opens the Day view on the clicked date, then returns to the month on the same period', async () => {
    const w = mountPage();
    expect(monthSurface(w).exists()).toBe(true);

    monthSurface(w).vm.$emit('selectDate', '2030-10-13');
    await settle();
    expect(monthSurface(w).exists()).toBe(false);
    const shown = dayView(w).props('referenceDate') as Date;
    expect([shown.getFullYear(), shown.getMonth(), shown.getDate()]).toEqual([2030, 9, 13]);

    commandBar(w).vm.$emit('update:activeView', 'month');
    await settle();
    expect(dayView(w).exists()).toBe(false);
    const back = monthSurface(w).props('referenceDate') as Date;
    expect([back.getFullYear(), back.getMonth()]).toEqual([2030, 9]);
    // The month surfaces take no selection prop at all.
    expect(monthSurface(w).props()).not.toHaveProperty('selectedDate');
    w.unmount();
  });
});
