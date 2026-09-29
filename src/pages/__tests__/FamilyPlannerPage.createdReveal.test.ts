/**
 * After an activity is created on the planner, the calendar moves to it at once (behind the
 * "Activity Created" confirmation) and the chip is revealed (scroll + pulse) only once nothing
 * covers it: on OK, or when the view modal opened by "View Activity" closes. An eager create
 * (no confirmation) reveals straight away; "+ add another", deleting it from the view modal, or
 * an inline edit there that swaps the record drops the pending reveal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import FamilyPlannerPage from '@/pages/FamilyPlannerPage.vue';
import { useActivityStore } from '@/stores/activityStore';
import type { FamilyActivity } from '@/types/models';

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
    loadProgress: ref(1),
    isEnglish: ref(true),
    isBeanieMode: ref(false),
  }),
}));

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

const reveal = vi.fn();
vi.mock('@/composables/useAttentionPulse', () => ({
  useAttentionPulse: () => ({ reveal, pulse: vi.fn() }),
}));

const CREATED: FamilyActivity = {
  id: 'act-1',
  title: 'Swim',
  date: '2030-10-13',
  recurrence: 'none',
  category: 'swimming',
  isActive: true,
  createdBy: 'm1',
  createdAt: '2030-01-01T00:00:00Z',
  updatedAt: '2030-01-01T00:00:00Z',
} as FamilyActivity;

async function settle() {
  await flushPromises();
  await nextTick();
  await nextTick();
}

function mountPage() {
  return shallowMount(FamilyPlannerPage, { attachTo: document.body });
}

type Wrapper = ReturnType<typeof mountPage>;
const confirmModal = (w: Wrapper) => w.findComponent({ name: 'CreatedConfirmModal' });
const viewModal = (w: Wrapper) => w.findComponent({ name: 'ActivityViewEditModal' });
const activityModal = (w: Wrapper) => w.findComponent({ name: 'ActivityModal' });
/** Whichever month surface mounted (the stream on a phone, the grid otherwise). */
function monthSurface(w: Wrapper) {
  const stream = w.findComponent({ name: 'CalendarMonthStream' });
  return stream.exists() ? stream : w.findComponent({ name: 'CalendarGrid' });
}
function shownReferenceDate(w: Wrapper): Date {
  return monthSurface(w).props('referenceDate') as Date;
}
/** Stand in for the chip the real calendar view would draw for the new activity. */
function drawChip(): HTMLElement {
  const el = document.createElement('button');
  el.dataset.activityId = CREATED.id;
  el.dataset.occurrenceDate = CREATED.date;
  // The page's root element (the template opens with a comment, so the wrapper is a fragment).
  const root = document.querySelector<HTMLElement>('[data-v-app] > div');
  if (!root) throw new Error('planner root not found');
  root.appendChild(el);
  return el;
}

async function createActivity(w: Wrapper) {
  activityModal(w).vm.$emit('save', { title: 'Swim', date: CREATED.date, recurrence: 'none' });
  await settle();
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  const store = useActivityStore();
  store.createActivity = vi.fn(async () => {
    store.activities = [...store.activities, CREATED];
    return CREATED;
  }) as never;
});

describe('FamilyPlannerPage: reveal a just-created activity', () => {
  it('moves the view at once, and scrolls + pulses the chip when the confirmation closes', async () => {
    const w = mountPage();
    await createActivity(w);

    const shown = shownReferenceDate(w);
    expect([shown.getFullYear(), shown.getMonth()]).toEqual([2030, 9]);
    expect(confirmModal(w).props('open')).toBe(true);
    expect(confirmModal(w).props('allowView')).toBe(true);
    expect(reveal).not.toHaveBeenCalled();

    const chip = drawChip();
    confirmModal(w).vm.$emit('close');
    await settle();
    expect(confirmModal(w).props('open')).toBe(false);
    expect(reveal).toHaveBeenCalledWith(chip, 'attention-ring');
    w.unmount();
  });

  it('"View Activity" opens it, and the reveal waits for the view modal to close', async () => {
    const w = mountPage();
    await createActivity(w);
    const chip = drawChip();

    confirmModal(w).vm.$emit('view');
    await settle();
    expect(confirmModal(w).props('open')).toBe(false);
    expect(viewModal(w).props('activity')).toMatchObject({ id: CREATED.id });
    expect(viewModal(w).props('occurrenceDate')).toBe(CREATED.date);
    expect(reveal).not.toHaveBeenCalled();

    viewModal(w).vm.$emit('close');
    await settle();
    expect(viewModal(w).props('activity')).toBeNull();
    expect(reveal).toHaveBeenCalledWith(chip, 'attention-ring');
    w.unmount();
  });

  it('deleting it from the view modal drops the parked reveal', async () => {
    const w = mountPage();
    await createActivity(w);
    drawChip();
    confirmModal(w).vm.$emit('view');
    await settle();

    // The modal's own order: `deleted`, then `close`.
    viewModal(w).vm.$emit('deleted', CREATED.id);
    viewModal(w).vm.$emit('close');
    await settle();
    expect(viewModal(w).props('activity')).toBeNull();
    expect(reveal).not.toHaveBeenCalled();
    w.unmount();
  });

  it('a swap in the view modal (an inline edit) drops the parked reveal', async () => {
    const w = mountPage();
    await createActivity(w);
    drawChip();
    confirmModal(w).vm.$emit('view');
    await settle();

    const store = useActivityStore();
    const swapped = { ...CREATED, id: 'act-override' } as FamilyActivity;
    store.activities = [...store.activities, swapped];
    viewModal(w).vm.$emit('activity-swapped', swapped.id);
    await settle();
    expect(viewModal(w).props('activity')).toMatchObject({ id: swapped.id });

    viewModal(w).vm.$emit('close');
    await settle();
    expect(reveal).not.toHaveBeenCalled();

    // Left parked for the old id, it would fire the next time that activity's view closes.
    monthSurface(w).vm.$emit('view-activity', CREATED.id, CREATED.date);
    await settle();
    expect(viewModal(w).props('activity')).toMatchObject({ id: CREATED.id });
    viewModal(w).vm.$emit('close');
    await settle();
    expect(reveal).not.toHaveBeenCalled();
    w.unmount();
  });

  it('"+ add another" drops the pending reveal', async () => {
    const w = mountPage();
    await createActivity(w);
    drawChip();

    confirmModal(w).vm.$emit('create-another');
    await settle();
    expect(activityModal(w).props('open')).toBe(true);
    activityModal(w).vm.$emit('close');
    await settle();
    expect(reveal).not.toHaveBeenCalled();
    w.unmount();
  });

  it('reveals an eager-created activity straight away (no confirmation)', async () => {
    const store = useActivityStore();
    store.activities = [CREATED];
    store.updateActivity = vi.fn().mockResolvedValue(true) as never;
    const w = mountPage();
    const chip = drawChip();

    activityModal(w).vm.$emit('save', { id: CREATED.id, data: { title: 'Swim' } });
    await settle();
    expect(confirmModal(w).props('open')).toBe(false);
    expect(reveal).toHaveBeenCalledWith(chip, 'attention-ring');
    w.unmount();
  });
});
