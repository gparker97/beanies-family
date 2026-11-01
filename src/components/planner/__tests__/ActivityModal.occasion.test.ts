/**
 * The activity drawer in occasion mode (#137), end to end through the real modal: an invalid
 * year blocks Save and marks the field; a cleared year is deleted on an edit; "who's
 * remembering" is optional only for an occasion; "Birthday party" stays a party; logistics an
 * occasion already carries stay visible; the AI update-existing flow keeps a saved year; a
 * create session's notes never leak into the next edit; and the past-year date rules hold
 * (one-off left alone, 29 Feb once, a calendar-click date never becomes a year).
 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    currentLanguage: ref('en'),
    isLoading: ref(false),
    isEnglish: ref(true),
    isBeanieMode: ref(false),
  }),
}));

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

import ActivityModal from '@/components/planner/ActivityModal.vue';
import type { FamilyActivity } from '@/types/models';

const MagicBeansDoorStub = {
  name: 'MagicBeansDoor',
  props: ['claim'],
  template: '<div><slot name="trigger" :open="() => {}" /></div>',
};
const PhotoAttachmentsStub = {
  name: 'PhotoAttachments',
  template: '<div />',
  methods: { addFiles: () => Promise.resolve(), openPicker: () => {} },
};

const unclesBirthday: FamilyActivity = {
  id: 'occ-1',
  title: "Uncle Bob's birthday",
  date: '2026-11-07',
  isAllDay: true,
  recurrence: 'yearly',
  rule: { unit: 'year', interval: 1, end: { kind: 'never' } },
  category: 'occasion_birthday',
  occasionYear: 1966,
  assigneeIds: ['m'],
  feeSchedule: 'none',
  reminderMinutes: 30,
  isActive: true,
  createdBy: 'm',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} as unknown as FamilyActivity;

type Vm = {
  title: string;
  date: string;
  mode: string;
  category: string;
  occasionYear: number | undefined;
  assigneeIds: string[];
  onCategoryPicked: (id: string) => Promise<void>;
  onSaveClick: () => Promise<void> | void;
  handleSave: () => void;
};

beforeEach(() => {
  setActivePinia(createPinia());
  logEvent.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 1, 12, 0, 0));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.useRealTimers());

function mountClosed() {
  return mount(ActivityModal, {
    props: { open: false, activity: null },
    global: {
      stubs: {
        MagicBeansDoor: MagicBeansDoorStub,
        PhotoAttachments: PhotoAttachmentsStub,
        BeanieFormModal: { template: '<div><slot /></div>' },
        teleport: true,
      },
    },
  });
}

async function flush() {
  await nextTick();
  await nextTick();
}

async function openWith(w: VueWrapper, props: Record<string, unknown>) {
  await w.setProps({ open: true, activity: null, ...props });
  await flush();
}

async function openNew(props: Record<string, unknown> = {}) {
  const w = mountClosed();
  await openWith(w, props);
  return { w, vm: w.vm as unknown as Vm };
}

function field(w: VueWrapper, label: string) {
  return w.find(`[data-form-label="${label}"]`);
}

function saved(w: VueWrapper, i = 0) {
  return w.emitted('save')?.[i]?.[0] as Record<string, unknown> & {
    data?: Record<string, unknown>;
  };
}

function yearMoves(): number {
  return logEvent.mock.calls.filter(
    (c) => (c[0] as { message: string }).message === 'year moved from date'
  ).length;
}

describe('ActivityModal: occasions', () => {
  it.each([
    [2030, 'planner.occasion.yearError.future'],
    [1850, 'planner.occasion.yearError.tooEarly'],
  ])('⭐ a year of %i blocks Save and marks the field', async (year, message) => {
    const { w, vm } = await openNew();
    vm.title = "Uncle Bob's birthday";
    await vm.onCategoryPicked('occasion_birthday');
    vm.occasionYear = year;
    await flush();
    // Flagged as soon as a whole year is typed, before any Save.
    expect(field(w, 'planner.occasion.year.bornIn').text()).toContain(message);
    await vm.onSaveClick();
    await flush();
    expect(w.emitted('save')).toBeUndefined();
    const group = field(w, 'planner.occasion.year.bornIn');
    expect(group.exists()).toBe(true);
    expect(group.text()).toContain(message);
  });

  it('⭐ a valid year is saved with the occasion', async () => {
    const { w, vm } = await openNew();
    vm.title = "Uncle Bob's birthday";
    await vm.onCategoryPicked('occasion_birthday');
    vm.occasionYear = 1966;
    await flush();
    await vm.onSaveClick();
    await flush();
    expect(saved(w).occasionYear).toBe(1966);
    expect(saved(w).recurrence).toBe('yearly');
    expect(saved(w).isAllDay).toBe(true);
  });

  it('⭐ a cleared year is sent as undefined on an edit', async () => {
    const { w, vm } = await openNew({ activity: unclesBirthday });
    expect(vm.occasionYear).toBe(1966);
    vm.occasionYear = undefined;
    await flush();
    vm.handleSave();
    const data = saved(w).data!;
    expect('occasionYear' in data).toBe(true);
    expect(data.occasionYear).toBeUndefined();
  });

  it('an untouched occasion edit writes nothing', async () => {
    const { w, vm } = await openNew({ activity: unclesBirthday });
    vm.handleSave();
    expect(w.emitted('save')).toBeUndefined();
    expect(w.emitted('close')).toBeDefined();
  });

  it('a year left in the drawer is removed when the category leaves Occasions', async () => {
    const { w, vm } = await openNew({ activity: unclesBirthday });
    vm.category = 'birthday';
    await flush();
    vm.handleSave();
    const data = saved(w).data!;
    expect('occasionYear' in data).toBe(true);
    expect(data.occasionYear).toBeUndefined();
  });

  it('⭐ nobody remembering is fine for an occasion, but not for any other activity', async () => {
    // No current member in this pinia, so the creator default cannot fill the field.
    const a = await openNew();
    a.vm.title = "Grandma's birthday";
    await a.vm.onCategoryPicked('occasion_birthday');
    await flush();
    expect(a.vm.assigneeIds).toEqual([]);
    expect(field(a.w, 'planner.occasion.whoRemembering').text()).toContain(
      'planner.occasion.whoRememberingEmpty'
    );
    await a.vm.onSaveClick();
    await flush();
    expect(a.w.emitted('save')).toBeDefined();

    const b = await openNew();
    b.vm.title = 'Swimming';
    await b.vm.onCategoryPicked('swimming');
    await flush();
    await b.vm.onSaveClick();
    await flush();
    expect(b.w.emitted('save')).toBeUndefined();
  });

  it('⭐ "Birthday party" typed then committed stays out of Occasions', async () => {
    const { w, vm } = await openNew();
    const input = w.find('input[placeholder="modal.whatsTheActivity"]');
    await input.setValue('Birthday party');
    await input.trigger('change');
    await flush();
    expect(vm.category).toBe('');

    await input.setValue("Uncle Bob's birthday");
    await input.trigger('change');
    await flush();
    expect(vm.category).toBe('occasion_birthday');
  });

  it('⭐ an empty occasion keeps logistics behind "Add more details"', async () => {
    const { w, vm } = await openNew();
    expect(field(w, 'planner.field.location').exists()).toBe(true);
    await vm.onCategoryPicked('occasion_birthday');
    await flush();
    expect(field(w, 'planner.field.location').exists()).toBe(false);
    const more = w.findAll('button').find((b) => b.text().includes('planner.field.moreDetails'))!;
    await more.trigger('click');
    await flush();
    expect(field(w, 'planner.field.location').exists()).toBe(true);
  });

  it('⭐ an occasion with a location shows it without opening "Add more details"', async () => {
    const { w } = await openNew({ activity: { ...unclesBirthday, location: 'Gran’s house' } });
    expect(field(w, 'planner.field.location').exists()).toBe(true);
  });

  it('⭐ the AI update-existing flow keeps a saved year', async () => {
    const { w, vm } = await openNew({
      activity: unclesBirthday,
      sourcePhoto: new File(['x'], 'card.jpg', { type: 'image/jpeg' }),
    });
    vm.handleSave();
    expect(saved(w).data!.occasionYear).toBe(1966);
  });

  it('⭐ a create session\'s "set for Occasions" notes never reach the next edit', async () => {
    const w = mountClosed();
    await openWith(w, {});
    await (w.vm as unknown as Vm).onCategoryPicked('occasion_birthday');
    await flush();
    expect(w.findAll('[data-testid="inferred-hint"]').length).toBeGreaterThan(0);

    await w.setProps({ open: false });
    await flush();
    await openWith(w, { activity: unclesBirthday });
    expect(w.findAll('[data-testid="inferred-hint"]')).toHaveLength(0);
  });

  it('⭐ a one-off occasion keeps its 1966 date', async () => {
    const { vm } = await openNew();
    await vm.onCategoryPicked('occasion_birthday');
    await flush();
    vm.mode = 'one-off';
    await flush();
    vm.date = '1966-11-07';
    await flush();
    expect(vm.date).toBe('1966-11-07');
    expect(vm.occasionYear).toBeUndefined();
  });

  it('⭐ 7 Nov 1966 becomes the year and the next birthday, with a caption', async () => {
    const { w, vm } = await openNew();
    await vm.onCategoryPicked('occasion_birthday');
    await flush();
    vm.date = '1966-11-07';
    await flush();
    expect(vm.date).toBe('2026-11-07');
    expect(vm.occasionYear).toBe(1966);
    expect(w.text()).toContain('planner.occasion.dateMoved.withYear');
    expect(yearMoves()).toBe(1);
  });

  it('⭐ 29 Feb 1964 normalises once', async () => {
    const { vm } = await openNew();
    await vm.onCategoryPicked('occasion_birthday');
    await flush();
    vm.date = '1964-02-29';
    await flush();
    await flush();
    expect(vm.date).toBe('2024-02-29');
    expect(vm.occasionYear).toBe(1964);
    expect(yearMoves()).toBe(1);
  });

  it('⭐ a past-year calendar click moves the date but never fills the year', async () => {
    const { vm } = await openNew({ defaultDate: '2025-03-01' });
    expect(vm.date).toBe('2025-03-01');
    await vm.onCategoryPicked('occasion_birthday');
    await flush();
    expect(vm.date).toBe('2027-03-01');
    expect(vm.occasionYear).toBeUndefined();
    expect(yearMoves()).toBe(0);
  });
});
