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

async function openOn(activity: FamilyActivity, occurrenceDate?: string) {
  const w = mount(ActivityModal, {
    props: { open: false, activity: null, occurrenceDate },
    global: {
      stubs: {
        MagicBeansDoor: MagicBeansDoorStub,
        BeanieFormModal: { template: '<div><slot /></div>' },
        teleport: true,
      },
    },
  });
  await w.setProps({ open: true, activity, occurrenceDate });
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
  it('⭐ keeps a multi-day one-off\'s length as its "Lasts" when it becomes weekly', async () => {
    // The length is now visible and supported for repeats: a 3-day camp made
    // weekly lasts 3 days each week, so the end date is unchanged (absent from
    // the diff) rather than silently dropped.
    const w = await openOn(trip);
    const vm = w.vm as unknown as Internals & { lastsDays: number };
    vm.mode = 'recurring';
    vm.rule = { unit: 'week', interval: 1, weekdays: [1], end: { kind: 'never' } };
    await nextTick();
    expect(vm.lastsDays).toBe(3);
    vm.handleSave();

    const saved = w.emitted('save')?.[0]?.[0] as { data: Record<string, unknown> };
    expect('endDate' in saved.data).toBe(false);
  });

  it('⭐ writes a changed "Lasts" as an end date relative to the form date', async () => {
    const weekly = {
      ...trip,
      recurrence: 'weekly',
      daysOfWeek: [1],
      rule: { unit: 'week', interval: 1, weekdays: [1], end: { kind: 'never' } },
    } as unknown as FamilyActivity;
    const w = await openOn(weekly);
    const vm = w.vm as unknown as Internals & { lastsDays: number };
    expect(vm.lastsDays).toBe(3);
    vm.lastsDays = 2;
    await nextTick();
    vm.handleSave();
    const saved = w.emitted('save')?.[0]?.[0] as { data: Record<string, unknown> };
    expect(saved.data.endDate).toBe('2026-09-15');

    vm.lastsDays = 1;
    await nextTick();
    vm.handleSave();
    const cleared = w.emitted('save')?.[1]?.[0] as { data: Record<string, unknown> };
    expect('endDate' in cleared.data).toBe(true);
    expect(cleared.data.endDate).toBeUndefined();
  });

  it('⭐ repairs a stored repeat end date that is before its start on any save', async () => {
    const broken = {
      ...trip,
      endDate: '2026-09-10',
      recurrence: 'weekly',
      daysOfWeek: [1],
      rule: { unit: 'week', interval: 1, weekdays: [1], end: { kind: 'never' } },
    } as unknown as FamilyActivity;
    const w = await openOn(broken);
    const vm = w.vm as unknown as Internals & { title: string };
    vm.title = 'Camp (weekly)';
    await nextTick();
    vm.handleSave();
    const saved = w.emitted('save')?.[0]?.[0] as { data: Record<string, unknown> };
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

  it('⭐ saves an unrelated edit even when a legacy length exceeds the cap', async () => {
    // A daily repeat that lasts 3 days (max 1): only a CHANGED Lasts is checked.
    const legacy = {
      ...trip,
      assigneeIds: ['m'],
      recurrence: 'daily',
      rule: { unit: 'day', interval: 1, end: { kind: 'never' } },
    } as unknown as FamilyActivity;
    const w = await openOn(legacy);
    const vm = w.vm as unknown as Internals & { title: string; lastsDays: number };
    expect(vm.lastsDays).toBe(3);
    vm.title = 'Renamed';
    await nextTick();
    (w.vm as unknown as { onSaveClick: () => Promise<void> }).onSaveClick();
    await nextTick();
    await nextTick();
    expect(w.emitted('save')?.[0]).toBeDefined();
  });

  it("⭐ switching a later occurrence to one-off keeps that repeat's days", async () => {
    const weekly = {
      ...trip,
      recurrence: 'weekly',
      daysOfWeek: [1],
      rule: { unit: 'week', interval: 1, weekdays: [1], end: { kind: 'never' } },
    } as unknown as FamilyActivity;
    const w = await openOn(weekly, '2026-10-05');
    const vm = w.vm as unknown as Internals & { endDate: string; date: string };
    // The series' end (Sep 16, relative to its Sep 14 start) is seeded relative to
    // the opened occurrence, so the one-off form shows this repeat's own days.
    expect(vm.date).toBe('2026-10-05');
    expect(vm.endDate).toBe('2026-10-07');
    vm.mode = 'one-off';
    await nextTick();
    vm.handleSave();
    const saved = w.emitted('save')?.[0]?.[0] as { data: Record<string, unknown> };
    // Unchanged against the baseline, so absent: the override re-bases it.
    expect('endDate' in saved.data).toBe(false);
  });

  it('⭐ blocks a 10-day trip made weekly: a changed rule is checked against the cap', async () => {
    const tenDays = { ...trip, assigneeIds: ['m'], endDate: '2026-09-23' } as FamilyActivity;
    const w = await openOn(tenDays);
    const vm = w.vm as unknown as Internals & { lastsDays: number };
    expect(vm.lastsDays).toBe(10);
    vm.mode = 'recurring';
    vm.rule = { unit: 'week', interval: 1, weekdays: [1], end: { kind: 'never' } };
    await nextTick();
    await (w.vm as unknown as { onSaveClick: () => Promise<void> }).onSaveClick();
    await nextTick();
    expect(w.emitted('save')).toBeUndefined();
  });

  it('⭐ a timed multi-day repeat ticked all-day shows its real length', async () => {
    const timed = {
      ...trip,
      isAllDay: undefined,
      startTime: '18:00',
      endTime: '18:00',
      recurrence: 'weekly',
      daysOfWeek: [1],
      rule: { unit: 'week', interval: 1, weekdays: [1], end: { kind: 'never' } },
    } as unknown as FamilyActivity;
    const w = await openOn(timed);
    expect((w.vm as unknown as { lastsDays: number }).lastsDays).toBe(3);
  });

  it('⭐ a one-off whose start moves keeps the end shown on screen', async () => {
    // Without it the store's span rule would shift the end (Sat-Mon child moved
    // to Fri becoming Fri-Sun instead of the Fri-Mon on screen).
    const w = await openOn(trip);
    const vm = w.vm as unknown as Internals & { date: string };
    vm.date = '2026-09-13';
    await nextTick();
    vm.handleSave();
    const saved = w.emitted('save')?.[0]?.[0] as { data: Record<string, unknown> };
    expect(saved.data.date).toBe('2026-09-13');
    expect(saved.data.endDate).toBe('2026-09-16');
  });

  it('⭐ a timed record keeps its multi-day end in the payload (Google reads it)', async () => {
    const timed = {
      ...trip,
      isAllDay: undefined,
      startTime: '18:00',
      endTime: '18:00',
    } as unknown as FamilyActivity;
    const w = await openOn(timed);
    const vm = w.vm as unknown as { buildPayload: () => { endDate?: string } };
    expect(vm.buildPayload().endDate).toBe('2026-09-16');
  });
});
