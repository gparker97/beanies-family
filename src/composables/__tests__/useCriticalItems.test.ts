import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCriticalItems } from '@/composables/useCriticalItems';
import { formatNookDate } from '@/utils/date';
import { useActivityStore } from '@/stores/activityStore';
import { useTodoStore } from '@/stores/todoStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { useListStore } from '@/stores/listStore';
import { useChoreStore } from '@/stores/choreStore';
import { useChoreClock } from '@/composables/useChoreClock';
import type {
  Chore,
  ChoreMark,
  FamilyActivity,
  FamilyList,
  FamilyMember,
  Medication,
  MedicationLogEntry,
  TodoItem,
} from '@/types/models';

// Mock the repositories so stores can initialise
vi.mock('@/services/automerge/repositories/activityRepository', () => ({
  getAllActivities: vi.fn(),
  getActivityById: vi.fn(),
  getActivitiesByDate: vi.fn(),
  getActivitiesByAssignee: vi.fn(),
  getActivitiesByCategory: vi.fn(),
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

// Toggle `helpfulHints` per-test so the briefing's hint loop can be proven
// flag-gated (under vitest `isFlagEnabled` is otherwise true for every flag).
const { flagState } = vi.hoisted(() => ({
  flagState: { helpfulHints: true, choreboard: true },
}));
vi.mock('@/config/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/flags')>();
  return {
    ...actual,
    isFlagEnabled: (flag: string) =>
      flag === 'helpfulHints'
        ? flagState.helpfulHints
        : flag === 'choreboard'
          ? flagState.choreboard
          : actual.isFlagEnabled(flag as never),
  };
});

// Who Owns What (#109): the briefing reads card-move / check-in dismissals from the
// viewer's read-state slice. Driven per test.
const { readStateBox, markRead, markUnread, showToastSpy } = vi.hoisted(() => ({
  readStateBox: { value: {} as Record<string, string> },
  markRead: vi.fn(),
  markUnread: vi.fn(),
  showToastSpy: vi.fn(),
}));
vi.mock('@/composables/useToast', () => ({ showToast: showToastSpy }));
vi.mock('@/stores/notificationsStore', () => ({
  useNotificationsStore: () => ({
    get readState() {
      return readStateBox.value;
    },
    markRead,
    markUnread,
  }),
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

const NOW = '2026-03-10T00:00:00.000Z';
const TODAY = '2026-03-10'; // Tuesday

function makeMember(overrides: Partial<FamilyMember> & { id: string; name: string }): FamilyMember {
  return {
    role: 'member',
    ageGroup: 'adult',
    email: `${overrides.name.toLowerCase()}@test.com`,
    color: '#000',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as FamilyMember;
}

function makeActivity(overrides?: Partial<FamilyActivity>): FamilyActivity {
  return {
    id: 'activity-1',
    title: 'Soccer Practice',
    date: TODAY,
    startTime: '15:00',
    endTime: '16:00',
    recurrence: 'none',
    category: 'tennis',
    assigneeId: 'child-1',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'parent-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTodo(overrides?: Partial<TodoItem>): TodoItem {
  return {
    id: 'todo-1',
    title: 'Buy groceries',
    completed: false,
    createdBy: 'parent-2',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeMedication(overrides?: Partial<Medication>): Medication {
  return {
    id: 'med-1',
    memberId: 'child-1',
    name: 'Antibiotics',
    dose: '5ml',
    frequency: 'twice daily',
    dosesPerDay: 2,
    ongoing: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeMedLog(overrides?: Partial<MedicationLogEntry>): MedicationLogEntry {
  // Use local ISO-ish strings (no trailing Z) so the test is timezone-
  // robust — `dosesToday` extracts the LOCAL date from administeredOn,
  // and a UTC `Z` timestamp can roll into the next/prev local day in
  // east/west timezones.
  return {
    id: `medlog-${Math.random().toString(36).slice(2, 8)}`,
    medicationId: 'med-1',
    administeredOn: TODAY + 'T10:00:00.000',
    administeredBy: 'parent-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('useCriticalItems', () => {
  let familyStore: ReturnType<typeof useFamilyStore>;
  let activityStore: ReturnType<typeof useActivityStore>;
  let todoStore: ReturnType<typeof useTodoStore>;
  let medicationsStore: ReturnType<typeof useMedicationsStore>;

  beforeEach(() => {
    // Fake the system clock BEFORE Pinia setup — stores call useToday() at
    // setup time and capture the resulting `today` ref. If the clock is
    // faked after setup, those captured refs hold the real date and the
    // medication-dose tests can't reach the TODAY date their logs use.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TODAY + 'T08:00:00'));

    setActivePinia(createPinia());
    vi.clearAllMocks();
    flagState.helpfulHints = true;
    flagState.choreboard = true;
    readStateBox.value = {};

    familyStore = useFamilyStore();
    activityStore = useActivityStore();
    todoStore = useTodoStore();
    medicationsStore = useMedicationsStore();

    // Set up family members
    familyStore.members.push(
      makeMember({ id: 'parent-1', name: 'Dad', role: 'owner', ageGroup: 'adult' }),
      makeMember({ id: 'parent-2', name: 'Mom', ageGroup: 'adult' }),
      makeMember({ id: 'child-1', name: 'Emma', ageGroup: 'child' }),
      makeMember({ id: 'child-2', name: 'Noah', ageGroup: 'child' }),
      makeMember({ id: 'pet-1', name: 'Rex', ageGroup: 'child', isPet: true })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty array when no current member', () => {
    // currentMemberId is null by default (no setCurrentMember call)
    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toEqual([]);
  });

  it('shows pickup message for activity where current member is pickup', () => {
    familyStore.setCurrentMember('parent-1');
    activityStore.activities.push(
      makeActivity({
        pickupMemberId: 'parent-1',
        assigneeId: 'child-1',
        endTime: '16:00',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    const msg = criticalItems.value[0]!;
    // Message contains child name, activity title, and time (beanie: "scoop up", en: "pick up")
    expect(msg.message).toContain('Emma');
    expect(msg.message).toContain('Soccer Practice');
    expect(msg.message).toContain('4pm');
    expect(msg.icon).toBe('🚗');
    expect(msg.type).toBe('activity');
  });

  it('shows dropoff message for activity where current member is dropoff', () => {
    familyStore.setCurrentMember('parent-2');
    activityStore.activities.push(
      makeActivity({
        dropoffMemberId: 'parent-2',
        assigneeId: 'child-1',
        startTime: '15:00',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    const msg = criticalItems.value[0]!;
    // Message contains child name and time (beanie: "time to drop", en: "drop off")
    expect(msg.message).toContain('Emma');
    expect(msg.message).toContain('3pm');
    expect(msg.icon).toBe('🚗');
  });

  it('shows combined item when current member has both dropoff and pickup roles', () => {
    familyStore.setCurrentMember('parent-1');
    activityStore.activities.push(
      makeActivity({
        dropoffMemberId: 'parent-1',
        pickupMemberId: 'parent-1',
        assigneeId: 'child-1',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.message).toContain('Emma');
    expect(criticalItems.value[0]!.icon).toBe('🚗');
    expect(criticalItems.value[0]!.dutyType).toBe('dropoff-pickup');
  });

  it('shows assignee message when current member is assignee (not pickup/dropoff)', () => {
    familyStore.setCurrentMember('child-1');
    activityStore.activities.push(
      makeActivity({
        assigneeId: 'child-1',
        pickupMemberId: 'parent-1',
        dropoffMemberId: 'parent-2',
        startTime: '15:00',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.message).toContain('Soccer Practice');
    expect(criticalItems.value[0]!.message).toContain('3pm');
    // Should NOT contain pickup/dropoff wording
    expect(criticalItems.value[0]!.message).not.toContain('pick up');
    expect(criticalItems.value[0]!.message).not.toContain('drop off');
  });

  it('skips generic assignee message when member is also pickup', () => {
    familyStore.setCurrentMember('parent-1');
    activityStore.activities.push(
      makeActivity({
        assigneeId: 'parent-1',
        pickupMemberId: 'parent-1',
      })
    );

    const { criticalItems } = useCriticalItems();
    // Should only show pickup, not an additional assignee message
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.icon).toBe('🚗');
  });

  it('shows todo assigned by another member', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        assigneeId: 'parent-1',
        dueDate: TODAY,
        createdBy: 'parent-2',
        title: 'Buy groceries',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.message).toContain('Mom');
    expect(criticalItems.value[0]!.message).toContain('buy groceries');
    expect(criticalItems.value[0]!.type).toBe('todo');
    expect(criticalItems.value[0]!.icon).toBe('📋');
  });

  it('shows self-assigned todo message', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        assigneeId: 'parent-1',
        dueDate: TODAY,
        createdBy: 'parent-1',
        title: 'Fix the sink',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.message).toContain('fix the sink');
    expect(criticalItems.value[0]!.message).not.toContain('Dad'); // no creator mention
  });

  it('excludes completed todos', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        assigneeId: 'parent-1',
        dueDate: TODAY,
        completed: true,
        completedAt: NOW,
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(0);
  });

  // "Show from": a dated one-off shows every day until it is done (greg, 2026-11-10).
  it('shows a future-dated to-do every day before it is due, with its due date', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        assigneeId: 'parent-1',
        dueDate: '2026-03-13', // Friday
        dueTime: '09:00',
        createdBy: 'parent-1',
        title: 'Future task',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.message).toMatch(/^coming up: future task, due Fri, 13 Mar$/i);
    expect(criticalItems.value[0]!.icon).toBe('📋');
    // Only a to-do due today carries its time (and sorts with the timed rows).
    expect(criticalItems.value[0]!.time).toBe('');
  });

  it('uses the upcoming variant for every audience', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({ id: 'asked', assigneeId: 'parent-1', dueDate: '2026-03-13', title: 'Asked' }),
      makeTodo({ id: 'kid', assigneeIds: ['child-1'], dueDate: '2026-03-13', title: 'Kid' }),
      makeTodo({ id: 'anyone', dueDate: '2026-03-13', title: 'Anyone' })
    );
    const byId = Object.fromEntries(
      useCriticalItems().criticalItems.value.map((i) => [i.id, i.message])
    );
    expect(byId.asked).toMatch(/^Mom asked you: asked, due Fri, 13 Mar$/i);
    expect(byId.kid).toMatch(/^Emma: kid, due Fri, 13 Mar$/i);
    expect(byId.anyone).toMatch(/^anyone, due Fri, 13 Mar \(anyone can do this\)$/i);
  });

  it('leaves out a to-do whose show date is still ahead, and a repeating one before its day', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        id: 'later',
        assigneeId: 'parent-1',
        dueDate: '2026-03-20',
        showFrom: '2026-03-15',
      }),
      makeTodo({ id: 'on-due', assigneeId: 'parent-1', dueDate: '2026-03-20', showOn: 'due' }),
      makeTodo({
        id: 'weekly',
        assigneeId: 'parent-1',
        dueDate: '2026-03-17',
        repeat: {
          rule: { unit: 'week', interval: 1, weekdays: [2], end: { kind: 'never' } },
          anchor: '2026-03-03',
        },
        repeatLog: [],
      })
    );
    expect(useCriticalItems().criticalItems.value).toEqual([]);
  });

  it('orders untimed to-dos overdue, today, undated, then upcoming (soonest first)', () => {
    familyStore.setCurrentMember('parent-1');
    const mine = (id: string, dueDate?: string) =>
      makeTodo({ id, assigneeId: 'parent-1', createdBy: 'parent-1', title: id, dueDate });
    // Pushed in reverse so the order comes from the plate, not insertion.
    todoStore.todos.push(
      mine('later', '2026-03-20'),
      mine('soon', '2026-03-12'),
      mine('undated'),
      mine('today', TODAY),
      mine('late', '2026-03-09')
    );
    expect(useCriticalItems().criticalItems.value.map((i) => i.id)).toEqual([
      'late',
      'today',
      'undated',
      'soon',
      'later',
    ]);
  });

  it('includes todos with no due date', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        assigneeId: 'parent-1',
        createdBy: 'parent-2',
        title: 'No deadline task',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.message).toContain('Mom');
    expect(criticalItems.value[0]!.message).toContain('no deadline task');
    expect(criticalItems.value[0]!.icon).toBe('📋');
  });

  it('shows overdue todos with gentle reminder and clock icon', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        assigneeId: 'parent-1',
        dueDate: '2026-03-08', // two days ago
        createdBy: 'parent-1',
        title: 'Overdue task',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.message).toContain('overdue task');
    expect(criticalItems.value[0]!.message).toContain('8 Mar');
    expect(criticalItems.value[0]!.icon).toBe('⏰');
  });

  it('excludes todos assigned to other members', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        assigneeId: 'parent-2',
        dueDate: TODAY,
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(0);
  });

  it('excludes activities on other dates', () => {
    familyStore.setCurrentMember('parent-1');
    activityStore.activities.push(
      makeActivity({
        pickupMemberId: 'parent-1',
        date: '2026-03-11', // tomorrow
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(0);
  });

  it('sorts timed items before untimed', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({ id: 'untimed', assigneeId: 'parent-1', dueDate: TODAY, title: 'Untimed task' }),
      makeTodo({
        id: 'timed',
        assigneeId: 'parent-1',
        dueDate: TODAY,
        dueTime: '10:00',
        title: 'Timed task',
        createdBy: 'parent-1',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(2);
    expect(criticalItems.value[0]!.id).toBe('timed');
    expect(criticalItems.value[1]!.id).toBe('untimed');
  });

  it('returns every eligible item (capping/expansion is a view concern)', () => {
    familyStore.setCurrentMember('parent-1');
    for (let i = 0; i < 7; i++) {
      todoStore.todos.push(
        makeTodo({
          id: `todo-${i}`,
          assigneeId: 'parent-1',
          dueDate: TODAY,
          title: `Task ${i}`,
          createdBy: 'parent-1',
        })
      );
    }

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(7);
  });

  it('uses no-time translation variant when activity has no time', () => {
    familyStore.setCurrentMember('parent-1');
    activityStore.activities.push(
      makeActivity({
        pickupMemberId: 'parent-1',
        assigneeId: 'child-1',
        startTime: undefined,
        endTime: undefined,
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    // Should not contain "at " followed by nothing — just the no-time message
    expect(criticalItems.value[0]!.message).toContain('Emma');
    expect(criticalItems.value[0]!.message).toContain('Soccer Practice');
  });

  // ── Multi-assignee tests ──────────────────────────────────────────

  it('shows activity for all assignees using assigneeIds', () => {
    // Both parent-1 and child-1 are assignees via the new array field
    const sharedActivity = makeActivity({
      assigneeIds: ['parent-1', 'child-1'],
      assigneeId: 'parent-1', // legacy field (ignored when assigneeIds is present)
    });

    // Check from parent-1's perspective
    familyStore.setCurrentMember('parent-1');
    activityStore.activities.push(sharedActivity);
    const parent1Items = useCriticalItems().criticalItems.value;
    expect(parent1Items).toHaveLength(1);
    expect(parent1Items[0]!.message).toContain('Soccer Practice');

    // Check from child-1's perspective
    activityStore.activities.length = 0;
    activityStore.activities.push(sharedActivity);
    familyStore.setCurrentMember('child-1');
    const child1Items = useCriticalItems().criticalItems.value;
    expect(child1Items).toHaveLength(1);
    expect(child1Items[0]!.message).toContain('Soccer Practice');
  });

  it('shows todo for all assignees using assigneeIds', () => {
    const sharedTodo = makeTodo({
      assigneeIds: ['parent-1', 'parent-2'],
      assigneeId: 'parent-1',
      dueDate: TODAY,
      createdBy: 'child-1',
      title: 'Shared task',
    });

    // parent-1 should see it
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(sharedTodo);
    const p1 = useCriticalItems().criticalItems.value;
    expect(p1).toHaveLength(1);
    expect(p1[0]!.message).toContain('shared task');

    // parent-2 should also see it
    todoStore.todos.length = 0;
    todoStore.todos.push(sharedTodo);
    familyStore.setCurrentMember('parent-2');
    const p2 = useCriticalItems().criticalItems.value;
    expect(p2).toHaveLength(1);
    expect(p2[0]!.message).toContain('shared task');
  });

  it('excludes multi-assignee activity from non-assignees', () => {
    familyStore.setCurrentMember('parent-2');
    activityStore.activities.push(
      makeActivity({
        assigneeIds: ['parent-1', 'child-1'],
        assigneeId: 'parent-1',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(0);
  });

  it('excludes multi-assignee todo from non-assignees', () => {
    familyStore.setCurrentMember('child-1');
    todoStore.todos.push(
      makeTodo({
        assigneeIds: ['parent-1', 'parent-2'],
        assigneeId: 'parent-1',
        dueDate: TODAY,
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(0);
  });

  // ── Audience: child-only & unassigned to-dos / activities ─────────────

  it('shows an unassigned to-do on every non-pet member, but not on a pet', () => {
    const unassigned = makeTodo({
      id: 'u1',
      title: 'Buy milk',
      dueDate: TODAY,
      createdBy: 'parent-1',
    });

    familyStore.setCurrentMember('parent-1'); // an adult
    todoStore.todos.push(unassigned);
    let items = useCriticalItems().criticalItems.value;
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toContain('buy milk');
    expect(items[0]!.message).toContain('anyone can do this');

    // a child sees it too
    todoStore.todos.length = 0;
    todoStore.todos.push(unassigned);
    familyStore.setCurrentMember('child-1');
    items = useCriticalItems().criticalItems.value;
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toContain('anyone can do this');

    // a pet never gets a briefing
    todoStore.todos.length = 0;
    todoStore.todos.push(unassigned);
    familyStore.setCurrentMember('pet-1');
    expect(useCriticalItems().criticalItems.value).toHaveLength(0);
  });

  it('shows a child-only to-do on every adult, on the child itself, but not on another child', () => {
    const childTodo = makeTodo({
      id: 'c1',
      title: 'Wear AM uniform',
      assigneeId: 'child-1',
      dueDate: TODAY,
      createdBy: 'parent-1',
    });

    // adult parent-2 sees it framed by the child's name
    familyStore.setCurrentMember('parent-2');
    todoStore.todos.push(childTodo);
    let items = useCriticalItems().criticalItems.value;
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toContain('Emma');
    expect(items[0]!.message).toContain('wear AM uniform');
    expect(items[0]!.message).not.toContain('anyone can do this');

    // the assigned child sees it as her own to-do (not the "Emma: …" framing)
    todoStore.todos.length = 0;
    todoStore.todos.push(childTodo);
    familyStore.setCurrentMember('child-1');
    items = useCriticalItems().criticalItems.value;
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toContain('wear AM uniform');
    expect(items[0]!.message).not.toContain('Emma:');

    // another child does NOT see it
    todoStore.todos.length = 0;
    todoStore.todos.push(childTodo);
    familyStore.setCurrentMember('child-2');
    expect(useCriticalItems().criticalItems.value).toHaveLength(0);
  });

  it('joins multiple child names for a to-do assigned to several kids only', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        id: 'kids',
        title: 'Tidy your rooms',
        assigneeIds: ['child-1', 'child-2'],
        dueDate: TODAY,
        createdBy: 'parent-1',
      })
    );
    const items = useCriticalItems().criticalItems.value;
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toContain('Emma & Noah');
  });

  it('once an adult is also assigned, only that adult and the child see the to-do', () => {
    const todo = makeTodo({
      id: 'mix',
      title: 'Pack swim bag',
      assigneeIds: ['parent-1', 'child-1'],
      dueDate: TODAY,
      createdBy: 'parent-1',
    });

    familyStore.setCurrentMember('parent-1'); // assigned adult
    todoStore.todos.push(todo);
    expect(useCriticalItems().criticalItems.value).toHaveLength(1);

    todoStore.todos.length = 0;
    todoStore.todos.push(todo);
    familyStore.setCurrentMember('child-1'); // assigned child
    expect(useCriticalItems().criticalItems.value).toHaveLength(1);

    todoStore.todos.length = 0;
    todoStore.todos.push(todo);
    familyStore.setCurrentMember('parent-2'); // a different adult — should NOT see it
    expect(useCriticalItems().criticalItems.value).toHaveLength(0);
  });

  it('shows a child-only activity on adults, but not on another child', () => {
    const act = makeActivity({
      id: 'a-child',
      assigneeId: 'child-1',
      pickupMemberId: undefined,
      dropoffMemberId: undefined,
    });

    familyStore.setCurrentMember('parent-2');
    activityStore.activities.push(act);
    const items = useCriticalItems().criticalItems.value;
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toContain('Emma');
    expect(items[0]!.message).toContain('Soccer Practice');

    activityStore.activities.length = 0;
    activityStore.activities.push(act);
    familyStore.setCurrentMember('child-2');
    expect(useCriticalItems().criticalItems.value).toHaveLength(0);
  });

  it('does not surface an unassigned activity on anyone', () => {
    familyStore.setCurrentMember('parent-1');
    activityStore.activities.push(
      makeActivity({
        id: 'a-none',
        assigneeId: undefined,
        assigneeIds: undefined,
        pickupMemberId: undefined,
        dropoffMemberId: undefined,
      })
    );
    expect(useCriticalItems().criticalItems.value).toHaveLength(0);
  });

  it('uses the overdue / no-due variants for unassigned and child-only to-dos', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        id: 'u-overdue',
        title: 'Overdue chore',
        dueDate: '2026-03-08',
        createdBy: 'parent-1',
      }),
      makeTodo({
        id: 'c-nodue',
        title: 'School project',
        assigneeId: 'child-1',
        createdBy: 'parent-1',
      })
    );
    const items = useCriticalItems().criticalItems.value;
    const overdue = items.find((i) => i.id === 'u-overdue')!;
    expect(overdue.icon).toBe('⏰');
    expect(overdue.message).toContain('8 Mar');
    expect(overdue.message).toContain('anyone can do this');
    const childNoDue = items.find((i) => i.id === 'c-nodue')!;
    expect(childNoDue.message).toContain('Emma');
    expect(childNoDue.message).toContain('school project');
  });

  it('degrades a pet-only / stale-assignee to-do to "anyone can do this" (no "Unknown:")', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        id: 'pet-only',
        title: 'Walk the dog',
        assigneeId: 'pet-1',
        dueDate: TODAY,
        createdBy: 'parent-1',
      }),
      makeTodo({
        id: 'stale',
        title: 'Mystery task',
        assigneeId: 'ghost-member',
        dueDate: TODAY,
        createdBy: 'parent-1',
      })
    );
    const items = useCriticalItems().criticalItems.value;
    expect(items).toHaveLength(2);
    for (const i of items) {
      expect(i.message).toContain('anyone can do this');
      expect(i.message).not.toContain('Unknown');
      expect(i.message).not.toContain('Rex');
    }
  });

  it('mixes unassigned and assigned-to-self items in one list for an adult viewer', () => {
    familyStore.setCurrentMember('parent-1');
    // 4 unassigned + 2 assigned-to-self = 6 eligible for parent-1
    for (let i = 0; i < 4; i++) {
      todoStore.todos.push(
        makeTodo({ id: `un-${i}`, title: `Loose ${i}`, dueDate: TODAY, createdBy: 'parent-1' })
      );
    }
    todoStore.todos.push(
      makeTodo({
        id: 'mine-1',
        title: 'Mine 1',
        assigneeId: 'parent-1',
        dueDate: TODAY,
        createdBy: 'parent-1',
      }),
      makeTodo({
        id: 'mine-2',
        title: 'Mine 2',
        assigneeId: 'parent-1',
        dueDate: TODAY,
        createdBy: 'parent-1',
      })
    );
    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(6);
  });

  // ── Vacation start-date filter ──────────────────────────────────────

  it('shows vacation activity only on the start date', () => {
    familyStore.setCurrentMember('parent-1');
    activityStore.activities.push(
      makeActivity({
        id: 'vacation-activity',
        assigneeId: 'parent-1',
        date: TODAY, // start date = today
        endDate: '2026-03-14',
        isAllDay: true,
        recurrence: 'none',
        vacationId: 'vacation-1',
        startTime: undefined,
        endTime: undefined,
        pickupMemberId: undefined,
        dropoffMemberId: undefined,
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.id).toBe('vacation-activity');
  });

  it('skips vacation activity on non-start dates', () => {
    familyStore.setCurrentMember('parent-1');
    // Vacation started yesterday, still active today
    activityStore.activities.push(
      makeActivity({
        id: 'vacation-activity',
        assigneeId: 'parent-1',
        date: '2026-03-09', // started yesterday
        endDate: '2026-03-14',
        isAllDay: true,
        recurrence: 'none',
        vacationId: 'vacation-1',
        startTime: undefined,
        endTime: undefined,
        pickupMemberId: undefined,
        dropoffMemberId: undefined,
      })
    );

    const { criticalItems } = useCriticalItems();
    // Today (2026-03-10) is not the start date, so should be filtered out
    expect(criticalItems.value).toHaveLength(0);
  });

  // ── Duty completion ─────────────────────────────────────────────────

  it('marks dropoff duty as completed when occurrence date has a completion record', () => {
    familyStore.setCurrentMember('parent-1');
    activityStore.activities.push(
      makeActivity({
        dropoffMemberId: 'parent-1',
        assigneeId: 'child-1',
        dropoffCompletions: [{ date: TODAY, completedBy: 'parent-1', completedAt: NOW }],
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.dutyType).toBe('dropoff');
    expect(criticalItems.value[0]!.completed).toBe(true);
  });

  it('marks combined duty as incomplete when only one duty is completed', () => {
    familyStore.setCurrentMember('parent-1');
    activityStore.activities.push(
      makeActivity({
        dropoffMemberId: 'parent-1',
        pickupMemberId: 'parent-1',
        assigneeId: 'child-1',
        dropoffCompletions: [{ date: TODAY, completedBy: 'parent-2', completedAt: NOW }],
        pickupCompletions: [],
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.dutyType).toBe('dropoff-pickup');
    expect(criticalItems.value[0]!.completed).toBe(false);
  });

  it('marks combined duty as complete when both duties are completed', () => {
    familyStore.setCurrentMember('parent-1');
    activityStore.activities.push(
      makeActivity({
        dropoffMemberId: 'parent-1',
        pickupMemberId: 'parent-1',
        assigneeId: 'child-1',
        dropoffCompletions: [{ date: TODAY, completedBy: 'parent-2', completedAt: NOW }],
        pickupCompletions: [{ date: TODAY, completedBy: 'parent-1', completedAt: NOW }],
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.dutyType).toBe('dropoff-pickup');
    expect(criticalItems.value[0]!.completed).toBe(true);
  });

  // ── Todo completable flag ─────────────────────────────────────────

  it('marks todos as completable in critical items', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        assigneeId: 'parent-1',
        dueDate: TODAY,
        createdBy: 'parent-1',
        title: 'Test task',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(1);
    expect(criticalItems.value[0]!.completable).toBe(true);
    expect(criticalItems.value[0]!.completed).toBe(false);
  });

  // ── Card reminders (#123) ─────────────────────────────────────────

  describe('card reminder rows', () => {
    const cardTodo = (overrides?: Partial<TodoItem>) =>
      makeTodo({
        id: 'card-trash-main',
        title: 'Put the trash out',
        assigneeIds: ['parent-1'],
        dueDate: TODAY,
        dueTime: '20:00',
        createdBy: 'parent-2',
        cardId: 'trash',
        cardPartKey: 'main',
        repeat: {
          rule: { unit: 'week', interval: 1, weekdays: [2], end: { kind: 'never' } },
          anchor: '2026-03-03',
        },
        repeatLog: [],
        ...overrides,
      });

    it('on its due day reads "Reminder for {name}: {task} at {time}!" with a bell, completable', () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(cardTodo());
      const items = useCriticalItems().criticalItems.value;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 'card-trash-main',
        type: 'todo',
        icon: '🔔',
        completable: true,
        completed: false,
        time: '20:00',
      });
      // Case-free: the test store renders in beanie mode (lowercase first word).
      expect(items[0]!.message).toMatch(/^reminder for Dad: put the trash out at 8pm!$/i);
    });

    it('an untimed reminder says "today"', () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(cardTodo({ dueTime: undefined }));
      expect(useCriticalItems().criticalItems.value[0]!.message).toMatch(
        /^reminder for Dad: put the trash out today!$/i
      );
    });

    // greg, 2026-11-06: a child's routine stays off a parent's briefing until it is missed,
    // unless the reminder asks to keep parents posted. Partially reverses #123's "adults see it too".
    it("an adult sees a child's reminder only once its time has passed; another child never", () => {
      const childTodo = cardTodo({ assigneeIds: ['child-1'], title: 'Water the plants' });
      todoStore.todos.push(childTodo);

      // 08:00, on track: not on the parent's plate, but on the child's.
      familyStore.setCurrentMember('parent-2');
      expect(useCriticalItems().criticalItems.value).toEqual([]);
      familyStore.setCurrentMember('child-1');
      expect(useCriticalItems().criticalItems.value).toHaveLength(1);
      familyStore.setCurrentMember('child-2');
      expect(useCriticalItems().criticalItems.value).toEqual([]);

      // 20:30, missed: the parent sees the same reminder line, with the bell.
      vi.setSystemTime(new Date(TODAY + 'T20:30:00'));
      familyStore.setCurrentMember('parent-2');
      const items = useCriticalItems().criticalItems.value;
      expect(items).toHaveLength(1);
      expect(items[0]!.message).toMatch(/^reminder for Emma: water the plants at 8pm!$/i);
      expect(items[0]!.icon).toBe('🔔');
      familyStore.setCurrentMember('child-1');
      expect(useCriticalItems().criticalItems.value).toHaveLength(1);
      familyStore.setCurrentMember('child-2');
      expect(useCriticalItems().criticalItems.value).toEqual([]);
    });

    it("notifyParents puts a child's reminder on an adult's plate while still on track", () => {
      familyStore.setCurrentMember('parent-2');
      todoStore.todos.push(
        cardTodo({ assigneeIds: ['child-1'], title: 'Water the plants', notifyParents: true })
      );
      const items = useCriticalItems().criticalItems.value;
      expect(items).toHaveLength(1);
      expect(items[0]!.message).toMatch(/^reminder for Emma: water the plants at 8pm!$/i);
      expect(items[0]!.icon).toBe('🔔');
    });

    it('not on its day, or a plain repeating to-do: the generic rows are unchanged', () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(
        cardTodo({ dueDate: '2026-03-12' }),
        cardTodo({ id: 'plain', cardId: undefined, cardPartKey: undefined, title: 'Pay rent' })
      );
      const items = useCriticalItems().criticalItems.value;
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe('plain');
      expect(items[0]!.icon).toBe('📋');
      expect(items[0]!.message).toContain('Mom');
      expect(items[0]!.message).not.toMatch(/reminder for/i);
    });
  });

  // ── Medication dose reminders ─────────────────────────────────────

  it('shows a medication reminder when no doses logged today (plural)', () => {
    familyStore.setCurrentMember('parent-1');
    medicationsStore.medications.push(makeMedication({ dosesPerDay: 2 }));

    const { criticalItems } = useCriticalItems();
    const meds = criticalItems.value.filter((i) => i.type === 'medication');
    expect(meds).toHaveLength(1);
    expect(meds[0]!.message).toContain('Antibiotics');
    expect(meds[0]!.message).toContain('Emma');
    expect(meds[0]!.message).toContain('2 more today');
    expect(meds[0]!.icon).toBe('💊');
    expect(meds[0]!.id).toBe('med-1');
  });

  it('shows a medication reminder with singular copy when 1 dose remains', () => {
    familyStore.setCurrentMember('parent-1');
    medicationsStore.medications.push(makeMedication({ dosesPerDay: 2 }));
    medicationsStore.medicationLogs.push(makeMedLog());

    const { criticalItems } = useCriticalItems();
    const meds = criticalItems.value.filter((i) => i.type === 'medication');
    expect(meds).toHaveLength(1);
    expect(meds[0]!.message).toContain('1 more today');
  });

  it('clears the medication reminder once all doses are logged', () => {
    familyStore.setCurrentMember('parent-1');
    medicationsStore.medications.push(makeMedication({ dosesPerDay: 2 }));
    medicationsStore.medicationLogs.push(
      makeMedLog({ id: 'log-1', administeredOn: TODAY + 'T08:00:00.000' }),
      makeMedLog({ id: 'log-2', administeredOn: TODAY + 'T20:00:00.000' })
    );

    const { criticalItems } = useCriticalItems();
    const meds = criticalItems.value.filter((i) => i.type === 'medication');
    expect(meds).toHaveLength(0);
  });

  it('clears the medication reminder when over-dosed (defensive)', () => {
    familyStore.setCurrentMember('parent-1');
    medicationsStore.medications.push(makeMedication({ dosesPerDay: 2 }));
    medicationsStore.medicationLogs.push(
      makeMedLog({ id: 'log-1', administeredOn: TODAY + 'T08:00:00.000' }),
      makeMedLog({ id: 'log-2', administeredOn: TODAY + 'T14:00:00.000' }),
      makeMedLog({ id: 'log-3', administeredOn: TODAY + 'T20:00:00.000' })
    );

    const { criticalItems } = useCriticalItems();
    const meds = criticalItems.value.filter((i) => i.type === 'medication');
    expect(meds).toHaveLength(0);
  });

  it('skips legacy medications without dosesPerDay (no reminder)', () => {
    familyStore.setCurrentMember('parent-1');
    // Legacy med — dosesPerDay is undefined; make sure to override the
    // default dosesPerDay: 2 from makeMedication.
    medicationsStore.medications.push({
      ...makeMedication(),
      dosesPerDay: undefined,
    });

    const { criticalItems } = useCriticalItems();
    const meds = criticalItems.value.filter((i) => i.type === 'medication');
    expect(meds).toHaveLength(0);
  });

  it('skips medications explicitly marked "as needed" (dosesPerDay null)', () => {
    familyStore.setCurrentMember('parent-1');
    medicationsStore.medications.push(makeMedication({ dosesPerDay: null }));

    const { criticalItems } = useCriticalItems();
    const meds = criticalItems.value.filter((i) => i.type === 'medication');
    expect(meds).toHaveLength(0);
  });

  it('skips inactive medications even when dosesPerDay is set', () => {
    familyStore.setCurrentMember('parent-1');
    // endDate < today → inactive
    medicationsStore.medications.push(
      makeMedication({
        dosesPerDay: 2,
        ongoing: false,
        endDate: '2026-03-01',
      })
    );

    const { criticalItems } = useCriticalItems();
    const meds = criticalItems.value.filter((i) => i.type === 'medication');
    expect(meds).toHaveLength(0);
  });

  // ── Helpful Hints (#40) in the briefing ──────────────────────────────
  describe('helpful hints in the briefing', () => {
    // A hint's dueDate is its NUDGE date — deliberately in the past relative to
    // TODAY here, so any leak into the to-do loop would frame it as overdue.
    const partyHint = () =>
      makeTodo({
        id: 'hint-1',
        title: "Get a present for Emma's party (12 Mar)",
        hintType: 'birthday-party-gift',
        hintKey: 'birthday-party-gift:act-1:2026-03-12',
        hintEventDate: '2026-03-12',
        dueDate: '2026-03-08',
        assigneeIds: ['parent-1'],
        createdBy: 'parent-1',
      });

    it('shows a visible hint with fixed "Helpful hint:" framing and its type emoji', () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(partyHint());

      const { criticalItems } = useCriticalItems();
      expect(criticalItems.value).toHaveLength(1);
      const item = criticalItems.value[0];
      expect(item.type).toBe('todo');
      // Copy is asserted case-insensitively: the test locale renders the beanie
      // (lowercase) variant, prod English renders "Helpful hint: …".
      expect(item.message).toMatch(/^helpful hint: get a present for Emma's party \(12 Mar\)$/i);
      expect(item.icon).toBe('🎉');
      expect(item.completable).toBe(true);
      expect(item.completed).toBe(false);
      expect(item.time).toBe('');
    });

    it('never frames a past-nudge-date hint as overdue (no date label, no ⏰)', () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(partyHint());

      const { criticalItems } = useCriticalItems();
      const item = criticalItems.value[0];
      expect(item.message).not.toMatch(/gentle/i);
      expect(item.message).not.toContain('8 Mar');
      expect(item.icon).not.toBe('⏰');
    });

    it('hides a surprise-sensitive hint from a non-assignee, shows it to the assignee', () => {
      todoStore.todos.push(
        makeTodo({
          id: 'hint-present',
          title: 'Plan a birthday present for Mom (20 Mar)',
          hintType: 'birthday-present',
          hintKey: 'birthday-present:parent-2:2026-03-20',
          assigneeIds: ['parent-1'],
          createdBy: 'parent-1',
        })
      );

      familyStore.setCurrentMember('parent-2');
      expect(useCriticalItems().criticalItems.value).toHaveLength(0);

      familyStore.setCurrentMember('parent-1');
      const items = useCriticalItems().criticalItems.value;
      expect(items.map((i) => i.id)).toEqual(['hint-present']);
    });

    it('orders hints after a manual untimed to-do', () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(
        partyHint(),
        makeTodo({ id: 'todo-manual', assigneeId: 'parent-1', dueDate: TODAY })
      );

      const ids = useCriticalItems().criticalItems.value.map((i) => i.id);
      expect(ids.indexOf('todo-manual')).toBeLessThan(ids.indexOf('hint-1'));
    });

    it('keeps hint framing for a kept (acknowledged) hint', () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push({ ...partyHint(), hintAcknowledged: true });

      const item = useCriticalItems().criticalItems.value[0];
      expect(item.message).toMatch(/^helpful hint: /i);
    });

    it('orders several hints by event date, soonest first, not by creation order', () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(
        // Generated most recently (activeTodos puts it first) but for the later event.
        makeTodo({
          id: 'hint-present',
          title: 'Plan a birthday present for Mom (24 Mar)',
          hintType: 'birthday-present',
          hintKey: 'birthday-present:parent-2:2026-03-24',
          hintEventDate: '2026-03-24',
          assigneeIds: ['parent-1'],
          createdBy: 'parent-1',
          createdAt: '2026-03-10T09:00:00.000Z',
        }),
        makeTodo({
          id: 'hint-packing',
          title: 'Start packing for Beach trip (11 Mar)',
          hintType: 'trip-packing',
          hintKey: 'trip-packing:trip-1:2026-03-11',
          hintEventDate: '2026-03-11',
          assigneeIds: ['parent-1'],
          createdBy: 'parent-1',
          createdAt: '2026-03-09T09:00:00.000Z',
        })
      );

      const ids = useCriticalItems().criticalItems.value.map((i) => i.id);
      expect(ids).toEqual(['hint-packing', 'hint-present']);
    });

    it('still shows a hint whose nudge date is tomorrow (dueDate is the notification date)', () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push({ ...partyHint(), dueDate: '2026-03-11' });

      expect(useCriticalItems().criticalItems.value).toHaveLength(1);
    });

    it('shows no hints when the helpfulHints flag is off', () => {
      flagState.helpfulHints = false;
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(partyHint());

      expect(useCriticalItems().criticalItems.value).toHaveLength(0);
    });
  });
  describe('Who Owns What card rows (#109)', () => {
    const RECENT = '2026-03-05T10:00:00.000Z';
    function kept(id: string, holderId?: string, createdAt = RECENT) {
      return {
        id,
        status: 'kept',
        splitMode: 'single',
        parts: [{ key: 'main', ...(holderId ? { holderId } : {}) }],
        createdAt,
        updatedAt: createdAt,
      };
    }
    /** The first deal (no `fromId`): never a moved note. */
    const FIRST_DEAL = {
      id: 'laundry:main:2026-01-01T10:00:00.000Z',
      cardId: 'laundry',
      partKey: 'main',
      toId: 'parent-2',
      byId: 'parent-2',
      at: '2026-01-01T10:00:00.000Z',
    };
    /** The check-in cycle's start record, written with that first deal: anchors the clock. */
    const CYCLE_START = {
      id: '2026-01-01-start',
      kind: 'start' as const,
      completedAt: '2026-01-01T10:00:00.000Z',
      byId: 'parent-2',
      stillWorks: 0,
      talkAbout: 0,
      redealt: 0,
      dealtNow: 0,
    };
    function seedDeck(states: unknown[], moves: unknown[] = []) {
      const deck = useResponsibilityStore();
      deck.states = states;
      deck.moves = moves as never;
      deck.checkIns = moves.length ? [CYCLE_START] : [];
    }
    const cardRows = () => useCriticalItems().criticalItems.value.filter((i) => i.type === 'card');

    /** A re-deal of laundry from parent-2 to parent-1, made by parent-2: a moved note for both. */
    const REDEAL = {
      id: 'laundry:main:2026-03-09T10:00:00.000Z',
      cardId: 'laundry',
      partKey: 'main',
      fromId: 'parent-2',
      toId: 'parent-1',
      byId: 'parent-2',
      at: '2026-03-09T10:00:00.000Z',
    };

    it('shows a moved note and a due check-in, with no "your cards" or "cards with nobody" rows', () => {
      familyStore.setCurrentMember('parent-1');
      seedDeck(
        [
          kept('laundry', 'parent-1', '2026-01-01T10:00:00.000Z'), // dealt > 4 weeks ago
          kept('dishes', 'parent-1'),
          kept('floors'),
        ],
        [FIRST_DEAL, REDEAL]
      );
      const rows = cardRows();
      // parent-1 holds two cards and "floors" has nobody: neither adds a row any more
      // (the nav badge `stillToDeal` counts cards with nobody instead).
      expect(rows.map((r) => r.icon)).toEqual(['🙋', '🗓️']);
      expect(rows.map((r) => r.id)).not.toContain('card-mine');
      expect(rows.map((r) => r.id)).not.toContain('card-nobody');
      const [moved, checkIn] = rows;
      expect(moved!.completable).toBeFalsy(); // the ✕ is the dismiss, no tick
      expect(moved!.dismissKey).toBe('card-move:laundry:main:2026-03-09T10:00:00.000Z');
      expect(moved!.route).toEqual({ path: '/who-owns-what', query: { card: 'laundry' } });
      expect(checkIn!.dismissKey).toMatch(/^card-checkin:/);
    });

    it("dates a moved note by the viewer's LOCAL day, not the UTC day of the timestamp", () => {
      familyStore.setCurrentMember('parent-1');
      // 20:00 UTC is already the next day east of UTC (the UTC slice would be a day early).
      const at = '2026-03-08T20:00:00.000Z';
      seedDeck(
        [kept('laundry', 'parent-2')],
        [
          {
            id: `laundry:main:${at}`,
            cardId: 'laundry',
            partKey: 'main',
            fromId: 'parent-1', // "Laundry moved to Dad on {date}."
            toId: 'parent-2',
            byId: 'parent-2',
            at,
          },
        ]
      );
      const d = new Date(at);
      const localYmd = [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
      ].join('-');
      const moved = cardRows().find((r) => r.id === `card-move:laundry:main:${at}`);
      expect(moved!.message).toContain(formatNookDate(localYmd));
    });

    it('orders card rows above the helpful-hint block', () => {
      familyStore.setCurrentMember('parent-1');
      seedDeck([kept('laundry', 'parent-1', '2026-01-01T10:00:00.000Z')], [FIRST_DEAL, REDEAL]);
      todoStore.todos.push(
        makeTodo({
          id: 'hint-1',
          title: 'Pack for the trip',
          hintType: 'trip-packing',
          hintKey: 'trip-packing:v1:2026-03-12',
          hintEventDate: '2026-03-12',
          dueDate: '2026-03-10',
          assigneeIds: ['parent-1'],
          createdBy: 'parent-1',
        })
      );
      const ids = useCriticalItems().criticalItems.value.map((i) => i.id);
      const movedId = `card-move:${REDEAL.id}`;
      expect(ids.indexOf(movedId)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(movedId)).toBeLessThan(ids.indexOf('hint-1'));
    });

    it('shows the check-in to adults only (a child holding cards gets no card rows)', () => {
      familyStore.setCurrentMember('child-1');
      seedDeck(
        [kept('laundry', 'child-1', '2026-01-01T10:00:00.000Z'), kept('floors')],
        [FIRST_DEAL]
      );
      expect(cardRows()).toEqual([]);
    });

    it('hides a dismissed moved note and a snoozed check-in', () => {
      familyStore.setCurrentMember('parent-2');
      const moveId = 'laundry:main:2026-03-09T10:00:00.000Z';
      seedDeck(
        [kept('laundry', 'parent-1', '2026-01-01T10:00:00.000Z')],
        [
          FIRST_DEAL,
          {
            id: moveId,
            cardId: 'laundry',
            partKey: 'main',
            fromId: 'parent-2',
            toId: 'parent-1',
            byId: 'parent-1',
            at: '2026-03-09T10:00:00.000Z',
          },
        ]
      );
      const before = cardRows();
      expect(before.map((r) => r.icon)).toEqual(['🙋', '🗓️']);
      readStateBox.value = {
        [`card-move:${moveId}`]: '2026-03-09T12:00:00.000Z',
        [before[1]!.dismissKey!]: '2026-03-09T12:00:00.000Z',
      };
      expect(cardRows()).toHaveLength(0);
    });
  });

  describe('dismissing a row', () => {
    const hint = () =>
      makeTodo({
        id: 'hint-1',
        title: "Get a present for Emma's party (12 Mar)",
        hintType: 'birthday-party-gift',
        hintKey: 'birthday-party-gift:act-1:2026-03-12',
        hintEventDate: '2026-03-12',
        dueDate: '2026-03-08',
        assigneeIds: ['parent-1'],
        createdBy: 'parent-1',
      });

    it('gives an activity a key for its occurrence and a to-do a key for today', () => {
      familyStore.setCurrentMember('parent-1');
      activityStore.activities.push(makeActivity({ pickupMemberId: 'parent-1' }));
      todoStore.todos.push(makeTodo({ assigneeIds: ['parent-1'], dueDate: TODAY }));
      const { criticalItems } = useCriticalItems();
      const keys = criticalItems.value.map((i) => i.dismissKey);
      expect(keys).toContain(`briefing-hide:activity:activity-1:${TODAY}`);
      expect(keys).toContain(`briefing-hide:todo:todo-1:${TODAY}`);
    });

    it('drops a row whose hide key is read, and keeps the rest', () => {
      familyStore.setCurrentMember('parent-1');
      activityStore.activities.push(makeActivity({ pickupMemberId: 'parent-1' }));
      todoStore.todos.push(makeTodo({ assigneeIds: ['parent-1'], dueDate: TODAY }));
      readStateBox.value = { [`briefing-hide:activity:activity-1:${TODAY}`]: NOW };
      const { criticalItems } = useCriticalItems();
      expect(criticalItems.value.map((i) => i.id)).toEqual(['todo-1']);
    });

    it("yesterday's hide key does not hide today's row", () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(makeTodo({ assigneeIds: ['parent-1'], dueDate: '2026-03-01' }));
      readStateBox.value = { 'briefing-hide:todo:todo-1:2026-03-09': NOW };
      const { criticalItems } = useCriticalItems();
      expect(criticalItems.value.map((i) => i.id)).toEqual(['todo-1']);
    });

    it('a hint row dismisses the hint itself, not a read key', async () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(hint());
      const discard = vi.spyOn(todoStore, 'discardTodo').mockResolvedValue(true);
      const { criticalItems, dismissItem } = useCriticalItems();
      const row = criticalItems.value.find((i) => i.id === 'hint-1')!;
      expect(row.dismissHint).toBe(true);
      expect(row.dismissKey).toBeUndefined();
      await expect(dismissItem(row)).resolves.toBe(true);
      expect(discard).toHaveBeenCalledWith('hint-1');
      expect(markRead).not.toHaveBeenCalled();
    });

    it("a KEPT hint is the family's own to-do now: its ✕ only hides it for today", async () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push({ ...hint(), hintAcknowledged: true });
      const discard = vi.spyOn(todoStore, 'discardTodo');
      const { criticalItems, dismissItem } = useCriticalItems();
      const row = criticalItems.value.find((i) => i.id === 'hint-1')!;
      expect(row.dismissHint).toBe(false);
      expect(row.dismissKey).toBe(`briefing-hide:todo:hint-1:${TODAY}`);
      await dismissItem(row);
      expect(discard).not.toHaveBeenCalled();
      expect(markRead).toHaveBeenCalledWith(`briefing-hide:todo:hint-1:${TODAY}`);
    });

    it('a hide shows the house Undo toast; Undo un-hides, a tap opens the row', async () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(makeTodo({ assigneeIds: ['parent-1'], dueDate: TODAY }));
      const open = vi.fn();
      const { criticalItems, dismissItem } = useCriticalItems();
      await dismissItem(criticalItems.value[0]!, open);
      expect(showToastSpy).toHaveBeenCalledTimes(1);
      const [type, title, message, options] = showToastSpy.mock.calls[0]!;
      expect(type).toBe('info');
      expect(title).toMatch(/removed from your daily briefing/i);
      expect(message).toMatch(/still open/i);
      expect(options.durationMs).toBe(6000);
      options.actionFn();
      expect(markUnread).toHaveBeenCalledWith(`briefing-hide:todo:todo-1:${TODAY}`);
      options.openFn();
      expect(open).toHaveBeenCalledOnce();
    });

    it('a row with nothing to open gets no tap target and says so', async () => {
      familyStore.setCurrentMember('parent-1');
      todoStore.todos.push(makeTodo({ assigneeIds: ['parent-1'], dueDate: TODAY }));
      const { criticalItems, dismissItem } = useCriticalItems();
      await dismissItem(criticalItems.value[0]!);
      const [, , message, options] = showToastSpy.mock.calls[0]!;
      expect(options.openFn).toBeUndefined();
      expect(message).not.toMatch(/tap/i);
    });

    it('any other row writes its hide key', async () => {
      familyStore.setCurrentMember('parent-1');
      activityStore.activities.push(makeActivity({ pickupMemberId: 'parent-1' }));
      const { criticalItems, dismissItem } = useCriticalItems();
      await expect(dismissItem(criticalItems.value[0]!)).resolves.toBe(true);
      expect(markRead).toHaveBeenCalledWith(`briefing-hide:activity:activity-1:${TODAY}`);
    });
  });

  // A repeating list is "due today" on the day it reset (isListDue), never otherwise.
  describe('repeating lists', () => {
    const repeating = (over: Partial<FamilyList> = {}): FamilyList =>
      ({
        id: 'list-rec',
        title: 'Morning routine',
        emoji: '🧾',
        category: 'home',
        ownerId: 'parent-1',
        items: [
          { id: 'i1', title: 'teeth', completed: false },
          { id: 'i2', title: 'shoes', completed: false },
        ],
        lifecycle: 'recurring',
        frequency: 'daily',
        lastResetDate: TODAY,
        completed: false,
        createdBy: 'parent-1',
        createdAt: '2026-03-01',
        updatedAt: '2026-03-01',
        ...over,
      }) as FamilyList;

    it('shows a list that reset today as due today, with the list icon', () => {
      familyStore.setCurrentMember('parent-1');
      useListStore().lists = [repeating()];
      const { criticalItems } = useCriticalItems();
      expect(criticalItems.value).toHaveLength(1);
      expect(criticalItems.value[0]!.message.toLowerCase()).toBe(
        'your list “morning routine” is due today'
      );
      expect(criticalItems.value[0]!.icon).toBe('🧾');
    });

    it('sorts a coming-up to-do after an untimed list due today and an undated to-do', () => {
      familyStore.setCurrentMember('parent-1');
      // Pushed first, so only the `upcoming` rank (not insertion order) can put it last.
      todoStore.todos.push(
        makeTodo({
          id: 'soon',
          assigneeId: 'parent-1',
          createdBy: 'parent-1',
          title: 'soon',
          dueDate: '2026-03-12',
        }),
        makeTodo({
          id: 'undated',
          assigneeId: 'parent-1',
          createdBy: 'parent-1',
          title: 'undated',
        })
      );
      useListStore().lists = [repeating()];
      const ids = useCriticalItems().criticalItems.value.map((i) => i.id);
      expect(ids).toHaveLength(3);
      expect(ids.at(-1)).toBe('soon');
    });

    it('stays off the briefing between resets (a weekly list that reset yesterday)', () => {
      familyStore.setCurrentMember('parent-1');
      // Weekly resets on Mondays: it reset on Monday the 9th, the next is the 16th.
      useListStore().lists = [repeating({ frequency: 'weekly', lastResetDate: '2026-03-09' })];
      expect(useCriticalItems().criticalItems.value).toEqual([]);
    });

    it('shows a weekly list early under Every Day, as coming up with its reset day', () => {
      familyStore.setCurrentMember('parent-1');
      useListStore().lists = [
        repeating({ frequency: 'weekly', lastResetDate: '2026-03-09', showOn: 'now' }),
      ];
      const [item] = useCriticalItems().criticalItems.value;
      expect(item).toMatchObject({ id: 'list-rec', type: 'list', later: true });
      expect(item!.message.toLowerCase()).toBe(
        'coming up: your list “morning routine”, due mon, 16 mar'
      );
    });

    it('shows a list for two assignees to both of them', () => {
      useListStore().lists = [repeating({ assigneeIds: ['parent-1', 'parent-2'] })];
      for (const id of ['parent-1', 'parent-2']) {
        familyStore.setCurrentMember(id);
        expect(useCriticalItems().criticalItems.value.map((i) => i.id)).toEqual(['list-rec']);
      }
    });

    it('stays off the briefing when every item is already ticked', () => {
      familyStore.setCurrentMember('parent-1');
      useListStore().lists = [
        repeating({ items: [{ id: 'i1', title: 'teeth', completed: true }] }),
      ];
      expect(useCriticalItems().criticalItems.value).toEqual([]);
    });

    // greg, 2026-11-06: a child's recurring list is a routine; it never reads as overdue, so
    // a grown-up sees it only when the list asks to keep parents posted.
    it("keeps a child-owned list off a grown-up's plate unless notifyParents is on", () => {
      familyStore.setCurrentMember('parent-1');
      useListStore().lists = [repeating({ ownerId: 'child-1' })];
      expect(useCriticalItems().criticalItems.value).toEqual([]);

      useListStore().lists = [repeating({ ownerId: 'child-1', notifyParents: true })];
      const { criticalItems } = useCriticalItems();
      expect(criticalItems.value).toHaveLength(1);
      expect(criticalItems.value[0]!.message).toBe('Emma’s list “Morning routine” is due today');
    });

    it('a child still sees their own recurring list', () => {
      familyStore.setCurrentMember('child-1');
      useListStore().lists = [repeating({ ownerId: 'child-1' })];
      expect(useCriticalItems().criticalItems.value).toHaveLength(1);
    });
  });

  describe('one-off lists and their show rule', () => {
    const oneOff = (over: Partial<FamilyList> = {}): FamilyList =>
      ({
        id: 'list-trip',
        title: 'Packing',
        emoji: '🧳',
        category: 'out',
        ownerId: 'parent-1',
        items: [
          { id: 'p1', title: 'passports', completed: false },
          { id: 'p2', title: 'chargers', completed: true },
        ],
        lifecycle: 'oneoff',
        completed: false,
        createdBy: 'parent-1',
        createdAt: '2026-03-01',
        updatedAt: '2026-03-01',
        ...over,
      }) as FamilyList;

    it('keeps a list due later off the briefing by default, and one still waiting to show', () => {
      familyStore.setCurrentMember('parent-1');
      useListStore().lists = [
        oneOff({ id: 'due-later', dueDate: '2026-03-18' }),
        oneOff({ id: 'waiting', dueDate: '2026-03-18', showFrom: '2026-03-12' }),
      ];
      expect(useCriticalItems().criticalItems.value).toEqual([]);
    });

    it('shows a list early once its "Show from" date is reached, as coming up', () => {
      familyStore.setCurrentMember('parent-1');
      useListStore().lists = [oneOff({ dueDate: '2026-03-18', showFrom: TODAY })];
      const [item] = useCriticalItems().criticalItems.value;
      expect(item).toMatchObject({ id: 'list-trip', later: true, icon: '🧾' });
      expect(item!.message.toLowerCase()).toBe('coming up: your list “packing”, due wed, 18 mar');
    });

    it('names the child on an early-shown list a parent sees for them', () => {
      familyStore.setCurrentMember('parent-1');
      useListStore().lists = [oneOff({ ownerId: 'child-1', dueDate: '2026-03-18', showOn: 'now' })];
      expect(useCriticalItems().criticalItems.value[0]!.message.toLowerCase()).toBe(
        'emma’s list “packing”, due wed, 18 mar'
      );
    });

    it('shows a list for two assignees to each of them, never to another adult', () => {
      useListStore().lists = [
        oneOff({ ownerId: 'parent-2', assigneeIds: ['parent-2', 'child-1'], dueDate: TODAY }),
      ];
      familyStore.setCurrentMember('parent-2');
      expect(useCriticalItems().criticalItems.value[0]!.message.toLowerCase()).toBe(
        'your list “packing” is due today'
      );
      familyStore.setCurrentMember('child-1');
      expect(useCriticalItems().criticalItems.value).toHaveLength(1);
      // Another adult's, shared with a child: hidden from Dad, exactly as a to-do is.
      familyStore.setCurrentMember('parent-1');
      expect(useCriticalItems().criticalItems.value).toEqual([]);
    });
  });
  describe('choreboard lines (#146)', () => {
    function makeChore(id: string, assigneeIds: string[], extra: Partial<Chore> = {}): Chore {
      return {
        id,
        title: id,
        emoji: '🧹',
        assigneeIds,
        block: 'morning',
        sortOrder: 0,
        createdBy: 'parent-1',
        createdAt: NOW,
        updatedAt: NOW,
        ...extra,
      } as Chore;
    }
    function doneMark(memberId: string, ref: string): ChoreMark {
      return {
        id: `done:${memberId}:${TODAY}:${ref}`,
        kind: 'done',
        memberId,
        date: TODAY,
        ref,
        by: memberId,
        createdAt: NOW,
        updatedAt: NOW,
      };
    }
    const choreRows = () =>
      useCriticalItems().criticalItems.value.filter((i) => i.type === 'chores');

    it('gives a child their own line, routed to their day, in the block’s colour', () => {
      familyStore.setCurrentMember('child-1');
      useChoreStore().chores = [makeChore('c1', ['child-1']), makeChore('c2', ['child-1'])];
      const rows = choreRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.message).toMatch(/^you have 2 morning chores left$/i);
      expect(rows[0]).toMatchObject({
        id: 'child-1:morning',
        icon: '🌅',
        choreBlock: 'morning',
        completable: false,
        route: { path: '/choreboard', query: { bean: 'child-1' } },
      });
    });

    it('uses the .one form for one chore left', () => {
      familyStore.setCurrentMember('child-1');
      useChoreStore().chores = [makeChore('c1', ['child-1']), makeChore('c2', ['child-1'])];
      useChoreStore().choreMarks = [doneMark('child-1', 'c1')];
      expect(choreRows()[0]!.message).toMatch(/^you have 1 morning chore left$/i);
    });

    it('a parent sees a child’s line only when it keeps parents posted', () => {
      familyStore.setCurrentMember('parent-1');
      const store = useChoreStore();
      store.chores = [makeChore('c1', ['child-1']), makeChore('c2', ['child-2'])];
      expect(choreRows()).toHaveLength(0);
      store.chores = [
        makeChore('c1', ['child-1'], { notifyParents: true }),
        makeChore('c3', ['child-1'], { notifyParents: true }),
        makeChore('c2', ['child-2'], { notifyParents: true }),
      ];
      const rows = choreRows();
      expect(rows.map((r) => r.id)).toEqual(['child-1:morning', 'child-2:morning']);
      expect(rows[0]!.message).toMatch(/^emma has 2 morning chores left$/i);
      expect(rows[1]!.message).toMatch(/^noah has 1 morning chore left$/i);
    });

    it('shows no line for a bean with nothing left, and the viewer’s own line first', () => {
      familyStore.setCurrentMember('parent-1');
      const store = useChoreStore();
      store.chores = [
        makeChore('c1', ['child-1'], { notifyParents: true }),
        makeChore('d1', ['parent-1'], { block: 'anytime' }),
      ];
      expect(choreRows().map((r) => r.id)).toEqual(['parent-1:anytime', 'child-1:morning']);
      expect(choreRows()[0]!.message).toMatch(/^you have 1 anytime chore left$/i);
      store.choreMarks = [doneMark('child-1', 'c1')];
      expect(choreRows().map((r) => r.id)).toEqual(['parent-1:anytime']);
    });

    it('hiding the morning line hides only that line: the missed line and the next block still show', () => {
      familyStore.setCurrentMember('child-1');
      const store = useChoreStore();
      store.chores = [
        makeChore('m1', ['child-1']),
        makeChore('a1', ['child-1'], { block: 'afternoon' }),
      ];
      const [morning] = choreRows();
      expect(morning!.id).toBe('child-1:morning');
      readStateBox.value = { [morning!.dismissKey!]: NOW };
      expect(choreRows()).toHaveLength(0);
      // 13:00: Morning has ended with its chore undone. Before the fix the line's id was the
      // bean's alone, so this missed line (and every later one) stayed hidden all day.
      vi.setSystemTime(new Date(TODAY + 'T13:00:00'));
      useChoreClock(); // the clock reads the minute it is called in
      expect(choreRows().map((r) => r.id)).toEqual(['child-1:morning:missed']);
      store.choreMarks = [doneMark('child-1', 'm1')];
      expect(choreRows().map((r) => r.id)).toEqual(['child-1:afternoon']);
    });

    it('hiding the missed morning line hands over to the afternoon line while morning stays undone', () => {
      vi.setSystemTime(new Date(TODAY + 'T13:00:00'));
      useChoreClock(); // the clock reads the minute it is called in
      familyStore.setCurrentMember('child-1');
      useChoreStore().chores = [
        makeChore('m1', ['child-1']),
        makeChore('a1', ['child-1'], { block: 'afternoon' }),
      ];
      const [missed] = choreRows();
      expect(missed!.id).toBe('child-1:morning:missed');
      // m1 stays undone: the afternoon line must still reach the bean after the hide.
      readStateBox.value = { [missed!.dismissKey!]: NOW };
      const rows = choreRows();
      expect(rows.map((r) => r.id)).toEqual(['child-1:afternoon']);
      expect(rows[0]!.message).toMatch(/^you have 1 afternoon chore left$/i);
    });

    it('shows no chore lines when the choreboard flag is off', () => {
      flagState.choreboard = false;
      familyStore.setCurrentMember('child-1');
      useChoreStore().chores = [makeChore('c1', ['child-1'])];
      expect(choreRows()).toHaveLength(0);
    });

    it('sits above the helpful-hint block', () => {
      familyStore.setCurrentMember('parent-1');
      useChoreStore().chores = [makeChore('d1', ['parent-1'])];
      todoStore.todos.push(
        makeTodo({
          id: 'hint-1',
          title: 'Pack for the trip',
          hintType: 'trip-packing',
          hintKey: 'trip-packing:v1:2026-03-12',
          hintEventDate: '2026-03-12',
          dueDate: TODAY,
          assigneeIds: ['parent-1'],
          createdBy: 'parent-1',
        })
      );
      const items = useCriticalItems().criticalItems.value;
      const choreAt = items.findIndex((i) => i.type === 'chores');
      const hintAt = items.findIndex((i) => i.id === 'hint-1');
      expect(choreAt).toBeGreaterThanOrEqual(0);
      expect(hintAt).toBeGreaterThan(choreAt);
    });
  });
});
