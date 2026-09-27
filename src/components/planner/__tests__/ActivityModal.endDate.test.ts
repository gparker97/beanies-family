/**
 * The end-date field is hidden while an activity repeats, and only a one-off can
 * span days. Switching a multi-day one-off to repeating used to keep the hidden
 * value and save it, which made every repeat after the first vanish from the
 * all-day rows. The save now drops it, and `undefined` in an update clears it.
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import ActivityModal from '@/components/planner/ActivityModal.vue';
import type { FamilyActivity } from '@/types/models';

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

const MagicBeansDoorStub = {
  name: 'MagicBeansDoor',
  props: ['claim'],
  template: '<div><slot name="trigger" :open="() => {}" /></div>',
};

const trip: FamilyActivity = {
  id: 'act-1',
  title: 'Camp',
  date: '2026-09-14',
  endDate: '2026-09-16',
  isAllDay: true,
  recurrence: 'none',
  category: 'other',
  feeSchedule: 'none',
  reminderMinutes: 0,
  isActive: true,
  createdBy: 'm',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
} as unknown as FamilyActivity;

beforeEach(() => setActivePinia(createPinia()));

async function openOn(activity: FamilyActivity) {
  const w = mount(ActivityModal, {
    props: { open: false, activity: null },
    global: {
      stubs: {
        MagicBeansDoor: MagicBeansDoorStub,
        BeanieFormModal: { template: '<div><slot /></div>' },
        teleport: true,
      },
    },
  });
  await w.setProps({ open: true, activity });
  await nextTick();
  await nextTick();
  return w;
}

type Internals = {
  mode: string;
  rule: unknown;
  handleSave: () => void;
};

describe('ActivityModal — end date on a repeating activity', () => {
  it('⭐ clears the hidden end date when a multi-day one-off becomes weekly', async () => {
    const w = await openOn(trip);
    const vm = w.vm as unknown as Internals;
    vm.mode = 'recurring';
    vm.rule = { unit: 'week', interval: 1, weekdays: [1], end: { kind: 'never' } };
    await nextTick();
    vm.handleSave();

    const saved = w.emitted('save')?.[0]?.[0] as { data: Record<string, unknown> };
    expect(saved).toBeDefined();
    expect('endDate' in saved.data).toBe(true);
    expect(saved.data.endDate).toBeUndefined();
  });

  it('keeps the end date of a multi-day one-off', async () => {
    const w = await openOn(trip);
    const vm = w.vm as unknown as Internals & { title: string };
    vm.title = 'Summer camp';
    await nextTick();
    vm.handleSave();

    const saved = w.emitted('save')?.[0]?.[0] as { data: Record<string, unknown> };
    expect(saved.data.title).toBe('Summer camp');
    expect('endDate' in saved.data).toBe(false); // unchanged, so absent from the diff
  });

  it('⭐ drops an end date that would now fall before the start', async () => {
    const w = await openOn(trip);
    const vm = w.vm as unknown as Internals & { date: string };
    vm.date = '2026-10-05';
    await nextTick();
    vm.handleSave();

    const saved = w.emitted('save')?.[0]?.[0] as { data: Record<string, unknown> };
    expect(saved.data.date).toBe('2026-10-05');
    expect('endDate' in saved.data).toBe(true);
    expect(saved.data.endDate).toBeUndefined();
  });
});
