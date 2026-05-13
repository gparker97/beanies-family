import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCriticalItems } from '@/composables/useCriticalItems';
import { useActivityStore } from '@/stores/activityStore';
import { useTodoStore } from '@/stores/todoStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useFamilyStore } from '@/stores/familyStore';
import type {
  FamilyActivity,
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

  it('excludes todos with a future due date', () => {
    familyStore.setCurrentMember('parent-1');
    todoStore.todos.push(
      makeTodo({
        assigneeId: 'parent-1',
        dueDate: '2026-03-11', // tomorrow
        createdBy: 'parent-1',
        title: 'Future task',
      })
    );

    const { criticalItems } = useCriticalItems();
    expect(criticalItems.value).toHaveLength(0);
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
});
