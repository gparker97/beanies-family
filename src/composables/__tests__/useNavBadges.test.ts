/**
 * Unit tests for useNavBadges — the shared composable that derives
 * sidebar + mobile-nav attention badges from the relevant Pinia stores.
 *
 * Covers the four surface-derivation rules + the aggregation contract:
 *   1. To-Do count = overdue + today (no future-dated)
 *   2. Budget count = only status === 'over' (not 'warning')
 *   3. Goals count = overdueGoals only (not all activeGoals)
 *   4. Travel count = sum of open ideas (!isPlanned && !isSkipped) across
 *      every upcoming-or-active trip (anything not ended yet)
 *   5. categoryAttention escalation rule: count > 0 OR attention-dot
 *      active; informational dots do NOT escalate
 *   6. Corrupt deadline on a goal → logged + excluded (no silent drop)
 *   7. badgeFor(path) resolves via the nav registry
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock useToday so its `today` ref reflects whatever time is set via
// `vi.setSystemTime` at the moment useToday() is invoked. The real
// composable initialises a module-scoped singleton at import time, which
// captures the real system date before vi.useFakeTimers() runs in
// beforeEach — making `dueTodayTodos` miss anything dated FAKE_TODAY.
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

// Toggle `familyLists` per-test so we can prove the Lists badge is flag-gated
// (the mobile-tab aggregator walks the registry without checking requiresFlag).
const { flagState } = vi.hoisted(() => ({ flagState: { familyLists: false } }));
vi.mock('@/config/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/flags')>();
  return {
    ...actual,
    isFlagEnabled: (flag: string) =>
      flag === 'familyLists' ? flagState.familyLists : actual.isFlagEnabled(flag as never),
  };
});

import { useNavBadges } from '../useNavBadges';
import { useTodoStore } from '@/stores/todoStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useBudgetStore } from '@/stores/budgetStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useListStore } from '@/stores/listStore';
import type { TodoItem, Goal, FamilyVacation, VacationIdea, FamilyList } from '@/types/models';

// Pin "today" to a deterministic date so the time-window assertions are
// stable. The vacation tests assume today = 2026-05-16.
const FAKE_TODAY = new Date('2026-05-16T00:00:00.000Z');

function makeTodo(overrides: Partial<TodoItem>): TodoItem {
  return {
    id: overrides.id ?? `todo-${Math.random()}`,
    title: 'Test',
    completed: false,
    someday: false,
    assignees: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  } as TodoItem;
}

function makeGoal(overrides: Partial<Goal>): Goal {
  return {
    id: overrides.id ?? `goal-${Math.random()}`,
    name: 'Test',
    type: 'savings',
    targetAmount: 100,
    currentAmount: 0,
    currency: 'USD',
    priority: 'medium',
    isCompleted: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  } as Goal;
}

function makeVacation(overrides: Partial<FamilyVacation>): FamilyVacation {
  return {
    id: overrides.id ?? `vac-${Math.random()}`,
    activityId: 'a-1',
    name: 'Test trip',
    tripType: 'leisure',
    assigneeIds: [],
    travelSegments: [],
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: 'm-1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  } as FamilyVacation;
}

function makeIdea(overrides: Partial<VacationIdea>): VacationIdea {
  return {
    id: overrides.id ?? `idea-${Math.random()}`,
    title: 'Test idea',
    votes: [],
    createdBy: 'm-1',
    createdAt: '2026-01-01',
    ...overrides,
  } as VacationIdea;
}

function makeList(overrides: Partial<FamilyList>): FamilyList {
  return {
    id: overrides.id ?? `list-${Math.random()}`,
    title: 'Test list',
    emoji: '🧾',
    category: 'home',
    ownerId: 'm-1',
    items: [],
    lifecycle: 'oneoff',
    completed: false,
    createdBy: 'm-1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  } as FamilyList;
}

describe('useNavBadges', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_TODAY);
    flagState.familyLists = false; // default off; the Lists test opts in
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('empty stores: every count is 0, travel inactive, no category escalates', () => {
    const { badges, categoryAttention } = useNavBadges();
    expect(badges.value.overdueTodos).toEqual({ kind: 'count', count: 0 });
    expect(badges.value.overBudgets).toEqual({ kind: 'count', count: 0 });
    expect(badges.value.overdueGoals).toEqual({ kind: 'count', count: 0 });
    expect(badges.value.openTravelIdeas).toEqual({ kind: 'count', count: 0 });
    expect(badges.value.dueLists).toEqual({ kind: 'count', count: 0 });
    expect(categoryAttention.value).toEqual({
      nook: false,
      planning: false,
      calendar: false,
      money: false,
      pod: false,
    });
  });

  it('lists count: overdue + due-today only, and gated to 0 (no Planning leak) when familyLists is off', () => {
    const listStore = useListStore();
    listStore.lists = [
      makeList({ id: 'o', dueDate: '2026-05-10' }), // overdue
      makeList({ id: 't', dueDate: '2026-05-16' }), // today (FAKE_TODAY)
      makeList({ id: 'fut', dueDate: '2026-06-01' }), // future → excluded
      makeList({ id: 'rec', lifecycle: 'recurring', frequency: 'daily' }), // recurring → excluded
      makeList({ id: 'filed', dueDate: '2026-05-10', completed: true }), // filed → excluded
    ];

    // Flag OFF (default): even with due lists synced, the badge is 0 and the
    // Planning tab must not escalate for a hidden page.
    expect(useNavBadges().badges.value.dueLists).toEqual({ kind: 'count', count: 0 });
    expect(useNavBadges().categoryAttention.value.planning).toBe(false);

    // Flag ON: counts overdue + due-today only, and escalates Planning.
    flagState.familyLists = true;
    const { badges, categoryAttention } = useNavBadges();
    expect(badges.value.dueLists).toEqual({ kind: 'count', count: 2 });
    expect(categoryAttention.value.planning).toBe(true);
  });

  it('to-do count includes overdue + due-today, excludes future-dated', () => {
    const todoStore = useTodoStore();
    todoStore.todos = [
      makeTodo({ id: 'a', dueDate: '2026-05-14' }), // overdue (2 days ago)
      makeTodo({ id: 'b', dueDate: '2026-05-16' }), // today
      makeTodo({ id: 'c', dueDate: '2026-06-01' }), // future
      makeTodo({ id: 'd' }), // undated — neither overdue nor today, excluded
    ];

    const { badges, categoryAttention } = useNavBadges();
    expect(badges.value.overdueTodos.kind).toBe('count');
    if (badges.value.overdueTodos.kind === 'count') {
      expect(badges.value.overdueTodos.count).toBe(2);
    }
    expect(categoryAttention.value.planning).toBe(true);
  });

  it('budget count: only status === "over" contributes (not "warning")', () => {
    const budgetStore = useBudgetStore();
    // Stub the public computed directly — bypasses the heavy spending pipeline.
    Object.defineProperty(budgetStore, 'categoryBudgetStatus', {
      get: () => [
        { category: 'food', status: 'over', limit: 100, spent: 120, percentUsed: 120 },
        { category: 'fun', status: 'warning', limit: 100, spent: 90, percentUsed: 90 },
        { category: 'gas', status: 'ok', limit: 100, spent: 30, percentUsed: 30 },
        { category: 'other', status: 'over', limit: 50, spent: 70, percentUsed: 140 },
      ],
      configurable: true,
    });

    const { badges, categoryAttention } = useNavBadges();
    expect(badges.value.overBudgets).toEqual({ kind: 'count', count: 2 });
    expect(categoryAttention.value.money).toBe(true);
  });

  it('goals count: only overdue (past deadline & not completed)', () => {
    const goalsStore = useGoalsStore();
    goalsStore.goals = [
      makeGoal({ id: 'g1', deadline: '2026-05-10' }), // overdue
      makeGoal({ id: 'g2', deadline: '2026-06-01' }), // future
      makeGoal({ id: 'g3' }), // active but no deadline
      makeGoal({ id: 'g4', deadline: '2026-05-01', isCompleted: true }), // completed (excluded)
    ];

    const { badges, categoryAttention } = useNavBadges();
    expect(badges.value.overdueGoals).toEqual({ kind: 'count', count: 1 });
    expect(categoryAttention.value.money).toBe(true);
  });

  it('travel count: open ideas on an ongoing trip', () => {
    const vacationStore = useVacationStore();
    vacationStore.vacations = [
      makeVacation({
        startDate: '2026-05-10',
        endDate: '2026-05-20',
        ideas: [
          makeIdea({ id: 'i1' }),
          makeIdea({ id: 'i2' }),
          makeIdea({ id: 'i3', isPlanned: true }),
          makeIdea({ id: 'i4', isSkipped: true }),
        ],
      }),
    ];

    const { badges, categoryAttention } = useNavBadges();
    expect(badges.value.openTravelIdeas).toEqual({ kind: 'count', count: 2 });
    // Count badges always escalate the mobile tab.
    expect(categoryAttention.value.planning).toBe(true);
  });

  it('travel count: open ideas on a trip starting next month', () => {
    const vacationStore = useVacationStore();
    vacationStore.vacations = [
      makeVacation({
        startDate: '2026-06-01',
        endDate: '2026-06-07',
        ideas: [makeIdea({ id: 'i1' }), makeIdea({ id: 'i2' })],
      }),
    ];

    const { badges } = useNavBadges();
    expect(badges.value.openTravelIdeas).toEqual({ kind: 'count', count: 2 });
  });

  it('travel count: open ideas on a trip months out still count (no horizon)', () => {
    const vacationStore = useVacationStore();
    vacationStore.vacations = [
      makeVacation({
        startDate: '2026-08-01',
        endDate: '2026-08-07',
        ideas: [makeIdea({ id: 'i1' })],
      }),
    ];

    const { badges } = useNavBadges();
    expect(badges.value.openTravelIdeas).toEqual({ kind: 'count', count: 1 });
  });

  it('travel count: 0 when all trips have ended (upcomingVacations is empty)', () => {
    const vacationStore = useVacationStore();
    vacationStore.vacations = [
      makeVacation({
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        ideas: [makeIdea({ id: 'i1' })],
      }),
    ];

    const { badges } = useNavBadges();
    expect(badges.value.openTravelIdeas).toEqual({ kind: 'count', count: 0 });
  });

  it('travel count: 0 when every idea on every upcoming trip is planned or skipped', () => {
    const vacationStore = useVacationStore();
    vacationStore.vacations = [
      makeVacation({
        startDate: '2026-05-10',
        endDate: '2026-05-20',
        ideas: [makeIdea({ id: 'i1', isPlanned: true }), makeIdea({ id: 'i2', isSkipped: true })],
      }),
    ];

    const { badges } = useNavBadges();
    expect(badges.value.openTravelIdeas).toEqual({ kind: 'count', count: 0 });
  });

  it('travel count: sums open ideas across all upcoming trips, ignores ended ones', () => {
    const vacationStore = useVacationStore();
    vacationStore.vacations = [
      makeVacation({
        id: 'ended',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        ideas: [makeIdea({ id: 'e1' }), makeIdea({ id: 'e2' })], // excluded — past trip
      }),
      makeVacation({
        id: 'ongoing',
        startDate: '2026-05-10',
        endDate: '2026-05-25',
        ideas: [makeIdea({ id: 'o1' }), makeIdea({ id: 'o2', isPlanned: true })], // 1 open
      }),
      makeVacation({
        id: 'soon',
        startDate: '2026-06-05',
        endDate: '2026-06-10',
        ideas: [makeIdea({ id: 's1' }), makeIdea({ id: 's2' }), makeIdea({ id: 's3' })], // 3 open
      }),
      makeVacation({
        id: 'far',
        startDate: '2026-09-01',
        endDate: '2026-09-07',
        ideas: [makeIdea({ id: 'f1' }), makeIdea({ id: 'f2', isSkipped: true })], // 1 open
      }),
    ];

    const { badges } = useNavBadges();
    // Sum across all upcoming trips: 1 (ongoing) + 3 (soon) + 1 (far) = 5.
    expect(badges.value.openTravelIdeas).toEqual({ kind: 'count', count: 5 });
  });

  it('corrupt goal deadline: logs via safeDate + excludes from overdue count', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const goalsStore = useGoalsStore();
    goalsStore.goals = [
      makeGoal({ id: 'g-bad', deadline: 'not-a-date' }),
      makeGoal({ id: 'g-good', deadline: '2026-05-10' }), // overdue
    ];

    const { badges } = useNavBadges();
    expect(badges.value.overdueGoals).toEqual({ kind: 'count', count: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[safeDate\] could not parse "not-a-date" in goal g-bad\.deadline/)
    );
    warnSpy.mockRestore();
  });

  it('badgeFor(path) resolves via the nav registry', () => {
    const todoStore = useTodoStore();
    todoStore.todos = [makeTodo({ id: 't', dueDate: '2026-05-14' })];

    const { badgeFor } = useNavBadges();
    const todoBadge = badgeFor('/todo');
    expect(todoBadge?.kind).toBe('count');
    if (todoBadge?.kind === 'count') {
      expect(todoBadge.count).toBe(1);
    }
    expect(badgeFor('/unknown-path')).toBeNull();
    expect(badgeFor('/nook')).toBeNull(); // nook has no badgeKey
  });

  it('categoryAttention: planning lights up on travel ideas OR overdue todos', () => {
    const todoStore = useTodoStore();
    const vacationStore = useVacationStore();

    // No trips, no todos → planning quiet.
    let badges = useNavBadges();
    expect(badges.categoryAttention.value.planning).toBe(false);

    // Ongoing trip with no open ideas → still quiet (count is 0).
    vacationStore.vacations = [makeVacation({ startDate: '2026-05-10', endDate: '2026-05-20' })];
    badges = useNavBadges();
    expect(badges.categoryAttention.value.planning).toBe(false);

    // Ongoing trip WITH open ideas → planning escalates (count > 0).
    vacationStore.vacations = [
      makeVacation({
        startDate: '2026-05-10',
        endDate: '2026-05-20',
        ideas: [makeIdea({ id: 'i1' })],
      }),
    ];
    badges = useNavBadges();
    expect(badges.categoryAttention.value.planning).toBe(true);

    // Or via an overdue todo with no trip ideas.
    vacationStore.vacations = [];
    todoStore.todos = [makeTodo({ id: 't', dueDate: '2026-05-10' })];
    badges = useNavBadges();
    expect(badges.categoryAttention.value.planning).toBe(true);
  });
});
