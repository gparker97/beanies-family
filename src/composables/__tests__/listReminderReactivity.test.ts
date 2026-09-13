/**
 * Editing an EXISTING list must re-arm its reminder (#88 follow-up).
 *
 * The builders in `useScheduledReminders.test.ts` prove that a dated list yields a
 * reminder. They cannot prove the thing a user actually relies on: that adding an
 * owner or a due date to a list created days ago reaches the scheduler at all.
 * That depends on the reactive chain
 *
 *   listStore.lists → reminderInput (computed) → watch(deep) → queueReschedule
 *
 * and a computed that failed to invalidate would leave the family with a list
 * marked "due tomorrow" and no notification, with nothing in the logs to say so.
 * `listStore.updateList` REPLACES the array (`lists.value = lists.value.map(...)`),
 * which is what makes the computed invalidate — this file pins that, so a future
 * refactor to an in-place mutation fails here rather than in the field.
 *
 * Every store is stubbed: the point is the wiring in `useScheduledReminders`, not
 * the stores' own behaviour, and mounting the real ones drags in Automerge.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, effectScope, nextTick, ref, watch, type Ref } from 'vue';
import type { FamilyList, FamilyMember, UUID } from '@/types/models';

/**
 * The holder is hoisted (so the `vi.mock` factories can close over it) but
 * POPULATED below, after the `vue` import: `vi.hoisted` runs before imports, so
 * calling `ref()` inside it throws. The mock factories only dereference these at
 * call time, by which point the assignments have run.
 */
interface Holder {
  lists: Ref<FamilyList[]>;
  currentMember: Ref<FamilyMember | null>;
  members: Ref<FamilyMember[]>;
  flagOn: Ref<boolean>;
}
const h = vi.hoisted(() => ({}) as Holder);
h.lists = ref<FamilyList[]>([]);
h.currentMember = ref<FamilyMember | null>({ id: 'me', name: 'Greg' } as FamilyMember);
h.members = ref<FamilyMember[]>([
  { id: 'me', name: 'Greg' } as FamilyMember,
  { id: 'wife', name: 'Sam' } as FamilyMember,
]);
h.flagOn = ref(true);

vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({
    get lists() {
      return h.lists.value;
    },
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get currentMember() {
      return h.currentMember.value;
    },
    get members() {
      return h.members.value;
    },
  }),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    remindersEnabled: true,
    todoReminderLead: 30,
    activityReminderLead: 30,
    travelReminderLeads: {},
    helpfulHintNotifyByType: {},
  }),
}));
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ activeActivitiesForMonth: [] }),
}));
vi.mock('@/stores/todoStore', () => ({ useTodoStore: () => ({ activeTodos: [] }) }));
vi.mock('@/stores/vacationStore', () => ({
  useVacationStore: () => ({ travelSegmentOccurrencesInRange: () => [] }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => (k === 'reminders.listBody' ? '{n} left' : k) }),
}));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: ref('2026-05-22') }) }));
vi.mock('@/utils/occurrenceAssembly', () => ({ assembleOccurrencesByDate: () => ({}) }));
vi.mock('@/config/flags', () => ({ isFlagEnabled: () => h.flagOn.value }));

import { useScheduledReminders, buildReminderSchedule } from '../useScheduledReminders';

const NOW = new Date('2026-05-22T10:00:00');
const PREFS = {
  remindersEnabled: true,
  todoReminderLead: 30,
  activityReminderLead: 30,
  travelReminderLeads: {},
  helpfulHintNotifyByType: {},
};

/** A list as it exists BEFORE the user edits it: no owner change, no due date. */
function existingList(over: Partial<FamilyList> = {}): FamilyList {
  return {
    id: 'l-1' as UUID,
    title: 'Shopping',
    emoji: '🛒',
    category: 'out',
    ownerId: 'me',
    items: [{ id: 'i1', title: 'Milk', completed: false }],
    lifecycle: 'oneoff',
    completed: false,
    createdBy: 'me' as UUID,
    createdAt: '2026-05-18T08:00:00.000Z',
    updatedAt: '2026-05-18T08:00:00.000Z',
    ...over,
  } as FamilyList;
}

/** What `listStore.updateList` does: REPLACE the array with a patched copy. */
function editList(id: string, patch: Partial<FamilyList>): void {
  h.lists.value = h.lists.value.map((l) => (l.id === id ? { ...l, ...patch } : l));
}

const scopes: ReturnType<typeof effectScope>[] = [];
function mount() {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() => useScheduledReminders())!;
}

beforeEach(() => {
  while (scopes.length) scopes.pop()!.stop();
  h.lists.value = [];
  h.flagOn.value = true;
  h.currentMember.value = { id: 'me', name: 'Greg' } as FamilyMember;
});

describe('adding a due date to a list that already exists', () => {
  it('🔴 arms a reminder that was not there before', () => {
    h.lists.value = [existingList()];
    const { reminderInput } = mount();

    // Before: an undated list. Briefing only, no notification.
    expect(
      buildReminderSchedule(reminderInput.value, NOW, PREFS).reminders.filter(
        (r) => r.kind === 'list'
      )
    ).toEqual([]);

    editList('l-1', { dueDate: '2026-05-24' });

    // After: the computed re-read the store and the reminder exists.
    const after = buildReminderSchedule(reminderInput.value, NOW, PREFS).reminders.filter(
      (r) => r.kind === 'list'
    );
    expect(after).toHaveLength(1);
    expect(after[0].fireAt).toEqual(new Date('2026-05-24T09:00:00'));
  });

  it('🔴 notifies the reschedule watcher, not just the next reader', () => {
    // The pull side working is not enough: nothing re-reads `reminderInput` until
    // something tells it to. `useLocalNotifications` watches it deeply, so an edit
    // has to FIRE that watcher or the new reminder is never armed on the device.
    h.lists.value = [existingList()];
    const { reminderInput } = mount();
    const onChange = vi.fn();
    const scope = effectScope();
    scopes.push(scope);
    scope.run(() => watch(reminderInput, onChange, { deep: true }));

    editList('l-1', { dueDate: '2026-05-24' });

    return nextTick().then(() => {
      expect(onChange).toHaveBeenCalled();
    });
  });

  it('moves the reminder when the due date is changed again', () => {
    h.lists.value = [existingList({ dueDate: '2026-05-24' })];
    const { reminderInput } = mount();
    editList('l-1', { dueDate: '2026-05-26' });
    const [r] = buildReminderSchedule(reminderInput.value, NOW, PREFS).reminders.filter(
      (x) => x.kind === 'list'
    );
    expect(r.fireAt).toEqual(new Date('2026-05-26T09:00:00'));
    // The id tracks the date, so the stale 05-24 alarm is cancelled as no longer
    // desired rather than left armed alongside the new one.
    expect(r.id).toBe('list-due:l-1:2026-05-26');
  });

  it('🔴 drops the reminder when the due date is cleared', () => {
    h.lists.value = [existingList({ dueDate: '2026-05-24' })];
    const { reminderInput } = mount();
    editList('l-1', { dueDate: undefined });
    expect(
      buildReminderSchedule(reminderInput.value, NOW, PREFS).reminders.filter(
        (r) => r.kind === 'list'
      )
    ).toEqual([]);
  });
});

describe('reassigning a list that already exists', () => {
  it('🔴 stops reminding the old owner once it is handed over', () => {
    h.lists.value = [existingList({ dueDate: '2026-05-24' })];
    const { reminderInput } = mount();
    expect(
      buildReminderSchedule(reminderInput.value, NOW, PREFS).reminders.some(
        (r) => r.kind === 'list'
      )
    ).toBe(true);

    editList('l-1', { ownerId: 'wife' }); // handed to another adult

    // This device is Greg's. Sam's device schedules it instead.
    expect(
      buildReminderSchedule(reminderInput.value, NOW, PREFS).reminders.some(
        (r) => r.kind === 'list'
      )
    ).toBe(false);
  });

  it('starts reminding the new owner when it is handed TO them', () => {
    h.lists.value = [existingList({ dueDate: '2026-05-24', ownerId: 'wife' })];
    const { reminderInput } = mount();
    expect(
      buildReminderSchedule(reminderInput.value, NOW, PREFS).reminders.some(
        (r) => r.kind === 'list'
      )
    ).toBe(false);

    editList('l-1', { ownerId: 'me' });

    expect(
      buildReminderSchedule(reminderInput.value, NOW, PREFS).reminders.some(
        (r) => r.kind === 'list'
      )
    ).toBe(true);
  });
});

describe('the familyLists flag', () => {
  it('🔴 passes no lists at all when the flag is off', () => {
    h.flagOn.value = false;
    h.lists.value = [existingList({ dueDate: '2026-05-24' })];
    const { reminderInput } = mount();
    expect(reminderInput.value!.lists).toEqual([]);
  });
});

describe('the raw-vs-filtered source', () => {
  it('🔴 reads the UNFILTERED lists, not the member-filtered view', () => {
    // `listStore.activeLists` applies the global member filter, a per-device
    // DISPLAY preference. If the scheduler ever read that instead, filtering the
    // Lists page to a child would silently disarm a parent's own reminders.
    h.lists.value = [existingList({ dueDate: '2026-05-24' })];
    const { reminderInput } = mount();
    expect(reminderInput.value!.lists).toHaveLength(1);
    expect(computed(() => reminderInput.value!.lists[0].id).value).toBe('l-1');
  });
});
