/**
 * The widget's to-dos and lists are the daily briefing's (greg, 2026-11-10): for the same member
 * and day, the family widget's today shows exactly the to-dos and lists the briefing does. One
 * documented difference, pinned below:
 *
 * - Surprise hints: the briefing shows one to the person it is for; the widget never does (a
 *   home screen is glanceable by anyone, including the person the surprise is about).
 *
 * Lists no longer differ (plan 2026-11-13, lists work like to-dos): both surfaces read the list's
 * show rule through `classifyPlateList`, so a list due later this week is on neither until its
 * rule says so, and one shown early is `later` on the widget and "coming up" on the briefing.
 *
 * Both surfaces run on real stores here: the briefing through `useCriticalItems`, the widget
 * through `buildWidgetSnapshot` fed the same to-dos and lists `useScheduledReminders` hands it
 * (`dedupeHintsByKey(activeTodos)`, every list).
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/utils/shareableOrigin', () => ({
  shareableOrigin: () => 'https://app.beanies.family',
}));
vi.mock('@/services/automerge/repositories/activityRepository', () => ({
  getAllActivities: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));
vi.mock('@/services/automerge/repositories/todoRepository', () => ({
  getAllTodos: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
}));
vi.mock('@/services/automerge/repositories/medicationRepository', () => ({
  getAllMedications: vi.fn().mockResolvedValue([]),
  createMedication: vi.fn(),
  updateMedication: vi.fn(),
  deleteMedication: vi.fn(),
  deleteMedicationCascade: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/automerge/repositories/medicationLogRepository', () => ({
  getAllMedicationLogs: vi.fn().mockResolvedValue([]),
  createMedicationLog: vi.fn(),
  deleteMedicationLog: vi.fn(),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/stores/notificationsStore', () => ({
  useNotificationsStore: () => ({ readState: {}, markRead: vi.fn(), markUnread: vi.fn() }),
}));
vi.mock('@/composables/useToday', async () => {
  const { ref, computed } = await import('vue');
  const { toDateInputValue, getStartOfDay } = await import('@/utils/date');
  return {
    useToday: () => ({
      today: ref(toDateInputValue(new Date())),
      startOfToday: computed(() => getStartOfDay(new Date())),
      isVisible: ref(true),
      lastVisibleAt: ref(0),
      lastHiddenAt: ref(0),
    }),
  };
});

import { useCriticalItems } from '@/composables/useCriticalItems';
import { useFamilyStore } from '@/stores/familyStore';
import { useTodoStore } from '@/stores/todoStore';
import { useListStore } from '@/stores/listStore';
import { buildWidgetSnapshot } from '@/utils/widgetSnapshot';
import { dedupeHintsByKey, isHint } from '@/utils/helpfulHints';
import { UI_STRINGS, type UIStringKey } from '@/services/translation/uiStrings';
import { addDaysYmd } from '@/utils/date';
import { WIDGET_DAYS } from '@/types/widgetSnapshot';
import type { FamilyList, FamilyMember, TodoItem, TodoRepeat } from '@/types/models';

const TODAY = '2026-03-10'; // Tuesday
const STAMP = '2026-03-01T00:00:00.000Z';
const DAILY: TodoRepeat = {
  rule: { unit: 'day', interval: 1, end: { kind: 'never' } },
  anchor: '2026-03-01',
};

function member(id: string, name: string, ageGroup: 'adult' | 'child'): FamilyMember {
  return {
    id,
    name,
    role: 'member',
    ageGroup,
    email: `${id}@test.com`,
    color: '#3b82f6',
    createdAt: STAMP,
    updatedAt: STAMP,
  } as FamilyMember;
}

function todo(id: string, over: Partial<TodoItem> = {}): TodoItem {
  return {
    id,
    title: id,
    completed: false,
    createdBy: 'dad',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...over,
  } as TodoItem;
}

function list(id: string, ownerId: string, over: Partial<FamilyList> = {}): FamilyList {
  return {
    id,
    title: id,
    emoji: '🧾',
    category: 'home',
    ownerId,
    lifecycle: 'oneoff',
    dueDate: TODAY,
    items: [{ id: `${id}-1`, title: 'item', completed: false }],
    completed: false,
    createdBy: ownerId,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...over,
  } as FamilyList;
}

/** Every case the two surfaces must agree on, for Dad on TODAY. */
function seed(): void {
  const family = useFamilyStore();
  family.members.push(
    member('dad', 'Dad', 'adult'),
    member('mom', 'Mom', 'adult'),
    member('emma', 'Emma', 'child'),
    member('noah', 'Noah', 'child')
  );
  family.setCurrentMember('dad');
  useTodoStore().todos = [
    todo('dad-overdue', { assigneeIds: ['dad'], dueDate: '2026-03-08' }),
    todo('dad-timed-passed', { assigneeIds: ['dad'], dueDate: TODAY, dueTime: '07:00' }),
    todo('dad-today', { assigneeIds: ['dad'], dueDate: TODAY, dueTime: '17:00' }),
    todo('dad-upcoming', { assigneeIds: ['dad'], dueDate: '2026-03-20' }),
    todo('dad-undated', { assigneeIds: ['dad'] }),
    todo('dad-waiting', { assigneeIds: ['dad'], dueDate: '2026-03-30', showFrom: '2026-03-25' }),
    todo('dad-due-only', { assigneeIds: ['dad'], dueDate: '2026-03-12', showOn: 'due' }),
    todo('dad-someday', { assigneeIds: ['dad'], someday: true }),
    todo('dad-done', { assigneeIds: ['dad'], dueDate: TODAY, completed: true }),
    todo('mom-today', { assigneeIds: ['mom'], dueDate: TODAY }),
    todo('mom-and-emma', { assigneeIds: ['mom', 'emma'], dueDate: TODAY }),
    todo('unassigned', { dueDate: TODAY }),
    todo('emma-oneoff', { assigneeIds: ['emma'], dueDate: TODAY }),
    todo('emma-chore', { assigneeIds: ['emma'], dueDate: TODAY, repeat: DAILY, repeatLog: [] }),
    todo('emma-chore-later', {
      assigneeIds: ['emma'],
      dueDate: '2026-03-14',
      repeat: { ...DAILY, rule: { ...DAILY.rule, interval: 7 } },
      repeatLog: [],
      showLeadDays: 5,
    }),
    todo('emma-chore-missed', {
      assigneeIds: ['emma'],
      dueDate: '2026-03-09',
      repeat: DAILY,
      repeatLog: [],
    }),
    todo('noah-chore-posted', {
      assigneeIds: ['noah'],
      dueDate: TODAY,
      repeat: DAILY,
      repeatLog: [],
      notifyParents: true,
    }),
    todo('hint-plain', {
      assigneeIds: ['dad'],
      hintType: 'birthday-party-gift',
      hintKey: 'plain',
      dueDate: TODAY,
      hintEventDate: '2026-03-14',
    }),
    todo('hint-surprise', {
      assigneeIds: ['dad'],
      hintType: 'birthday-present',
      hintKey: 'surprise',
      dueDate: TODAY,
      hintEventDate: '2026-03-20',
    }),
  ] as TodoItem[];
  const recurring = { lifecycle: 'recurring', frequency: 'daily', lastResetDate: TODAY } as const;
  useListStore().lists = [
    list('dad-list', 'dad'),
    list('dad-list-overdue', 'dad', { dueDate: '2026-03-01' }),
    list('dad-list-undated', 'dad', { dueDate: undefined }),
    list('dad-list-later', 'dad', { dueDate: '2026-03-12' }),
    list('dad-private', 'dad', { category: 'health' }),
    list('mom-list', 'mom'),
    list('mom-private', 'mom', { category: 'health' }),
    list('emma-private', 'emma', { category: 'health' }),
    list('emma-chores', 'emma', { ...recurring, dueDate: undefined }),
    list('noah-chores-posted', 'noah', { ...recurring, dueDate: undefined, notifyParents: true }),
    list('dad-filed', 'dad', { completed: true, completedAt: STAMP }),
    // Two assignees: Dad sees both, first-named or not.
    list('dad-and-mom', 'dad', { assigneeIds: ['dad', 'mom'] }),
    list('mom-and-dad', 'mom', { assigneeIds: ['mom', 'dad'] }),
    // Waiting: a "Show from" still ahead.
    list('dad-list-waiting', 'dad', { dueDate: '2026-03-20', showFrom: '2026-03-15' }),
    // Shown early by rule: a "Show from" already reached; a weekly list under Every Day.
    list('dad-list-early', 'dad', { dueDate: '2026-03-20', showFrom: '2026-03-09' }),
    list('dad-weekly-now', 'dad', {
      lifecycle: 'recurring',
      frequency: 'weekly',
      lastResetDate: '2026-03-09',
      dueDate: undefined,
      showOn: 'now',
    }),
  ] as FamilyList[];
}

/** The widget's today for the current member, from the inputs the composable hands it. */
function widgetToday() {
  const family = useFamilyStore();
  const todoStore = useTodoStore();
  const viewer = family.currentMember!;
  const resolveMember = (id: string) => family.members.find((m) => m.id === id);
  const { snapshot } = buildWidgetSnapshot(
    {
      occurrencesByDate: {},
      todos: dedupeHintsByKey(todoStore.activeTodos),
      lists: useListStore().lists,
      currentMember: viewer,
      resolveMember,
      t: (key: UIStringKey) => UI_STRINGS[key],
      today: TODAY,
      days: Array.from({ length: WIDGET_DAYS }, (_, i) => addDaysYmd(TODAY, i)),
      members: family.members,
      initialsById: family.initialsById,
      mealsByDate: {},
      recipes: [],
      vacations: [],
      hintTodos: todoStore.visibleHintTodos(viewer, resolveMember),
      flags: { mealPlanner: false, helpfulHints: true },
      lockScreenTitles: true,
      language: 'en',
      familyId: 'family-parity',
      weather: null,
    },
    new Date()
  );
  return snapshot.days[0]!.view.tasks.items;
}

/** The briefing's to-do, hint and list ids for the current member. */
function briefingIds() {
  const byId = new Map(useTodoStore().todos.map((t) => [t.id, t]));
  const items = useCriticalItems().criticalItems.value;
  const todoRows = items.filter((i) => i.type === 'todo');
  return {
    todos: todoRows.filter((i) => !isHint(byId.get(i.id)!)).map((i) => i.id),
    hints: todoRows.filter((i) => isHint(byId.get(i.id)!)).map((i) => i.id),
    lists: items.filter((i) => i.type === 'list').map((i) => i.id),
  };
}

const sorted = (ids: string[]) => [...ids].sort();

describe('the widget shows the daily briefing’s to-dos and lists', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T08:00:00`));
    setActivePinia(createPinia());
    seed();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the same to-dos, for the same member and day', () => {
    // Lists have their own case below; clearing them keeps every to-do under the widget's cap.
    useListStore().lists = [];
    const widget = widgetToday()
      .filter((i) => i.kind === 'todo')
      .map((i) => i.id.replace(/^todo:/, ''));
    const briefing = briefingIds().todos;
    expect(sorted(widget)).toEqual(sorted(briefing));
    // The set is the briefing's audience: Dad's own (not waiting), unassigned, and his
    // children's, with a child's routine only when missed or kept posted (Emma's weekly chore in
    // its lead window is upcoming, not missed). Never Mom's, alone or shared with a child.
    expect(sorted(widget)).toEqual(
      sorted([
        'dad-overdue',
        'dad-timed-passed',
        'dad-today',
        'dad-upcoming',
        'dad-undated',
        'unassigned',
        'emma-oneoff',
        'emma-chore-missed',
        'noah-chore-posted',
      ])
    );
  });

  it('the same lists (who sees them and when), with nothing only the widget carries', () => {
    // To-dos have their own case above; clearing them keeps every list under the widget's cap.
    useTodoStore().todos = [];
    const items = widgetToday().filter((i) => i.kind === 'list');
    const ids = items.map((i) => i.id.replace(/^list:/, ''));
    expect(sorted(ids)).toEqual(sorted(briefingIds().lists));
    expect(sorted(ids)).toEqual(
      sorted([
        'dad-list',
        'dad-list-overdue',
        'dad-list-undated',
        'dad-private',
        'emma-private',
        'noah-chores-posted',
        'dad-and-mom',
        'mom-and-dad',
        'dad-list-early',
        'dad-weekly-now',
      ])
    );
    // Shown early by its rule: `later` on the widget, "coming up" (later) on the briefing. A list
    // merely due later this week (`dad-list-later`) and one still waiting are on neither.
    expect(sorted(items.filter((i) => i.bucket === 'later').map((i) => i.id))).toEqual([
      'list:dad-list-early',
      'list:dad-weekly-now',
    ]);
    const later = useCriticalItems()
      .criticalItems.value.filter((i) => i.type === 'list' && i.later)
      .map((i) => i.id);
    expect(sorted(later)).toEqual(['dad-list-early', 'dad-weekly-now']);
  });

  it('the same hints, except a surprise, which only the briefing shows', () => {
    const widget = widgetToday()
      .filter((i) => i.kind === 'hint')
      .map((i) => i.id.replace(/^todo:/, ''));
    expect(sorted(briefingIds().hints)).toEqual(['hint-plain', 'hint-surprise']);
    expect(widget).toEqual(['hint-plain']);
  });
});
