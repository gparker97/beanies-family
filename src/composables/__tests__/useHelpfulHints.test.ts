/**
 * The helpful-hints orchestrator under the automatic-write cap (2026-11-12).
 *
 * The incident this guards: a newer build created a hint type an older build pruned as stale,
 * and the newer one recreated it about every 15 s for three days (~7,500 family-doc changes).
 * Every create and every reconcile-driven delete now spends one `takeAutoWrite`, so a fight is
 * held to the daily cap, while the master-OFF sweep (a person switched hints off) is not.
 *
 * The engine's `computeDesiredHints` is replaced so a test can ask for any number of hints;
 * `reconcileHints` (the diff) is the real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type { DesiredHint } from '@/utils/helpfulHints';
import type { CreateTodoInput, TodoItem } from '@/types/models';

// `vi.mock` factories are hoisted above the module body, so everything they close over must
// come from `vi.hoisted`. The fake stores are reactive so the composable's watcher sees edits.
const h = await vi.hoisted(async () => {
  const { reactive, ref } = await import('vue');
  return {
    logEvent: vi.fn(),
    reportError: vi.fn(),
    today: ref('2026-11-12'),
    desired: { value: [] as DesiredHint[] },
    family: reactive({
      currentMember: null as { id: string } | null,
      humans: [] as unknown[],
    }),
    activities: reactive({ activeActivities: [] as unknown[], activeActivitiesForMonth: [] }),
    vacations: reactive({ upcomingVacations: [] as unknown[] }),
    settings: reactive({
      helpfulHintsEnabled: true,
      helpfulHintLeadDays: {} as Record<string, number>,
      dismissedHintKeys: {} as Record<string, string>,
      pruneDismissedHints: async () => false,
    }),
    todos: reactive({ todos: [] as TodoItem[] }),
    createTodo: vi.fn(),
    deleteTodo: vi.fn(),
  };
});

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/config/flags', () => ({ isFlagEnabled: () => true }));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: h.today }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/services/analytics/plausible', () => ({
  withAppInitiatedWrites: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
}));
vi.mock('@/utils/occurrenceAssembly', () => ({ assembleOccurrencesByDate: () => [] }));
vi.mock('@/utils/helpfulHints', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/helpfulHints')>()),
  computeDesiredHints: () => ({
    hints: h.desired.value,
    skipped: 0,
    reasons: {},
    cardHolder: { used: 0, ineligible: 0 },
    audienceFallback: 0,
  }),
}));
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => h.family }));
vi.mock('@/stores/activityStore', () => ({ useActivityStore: () => h.activities }));
vi.mock('@/stores/vacationStore', () => ({ useVacationStore: () => h.vacations }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => h.settings }));
vi.mock('@/stores/responsibilityStore', () => ({
  useResponsibilityStore: () => ({ defaultHolderFor: () => null }),
}));
vi.mock('@/stores/todoStore', () => ({
  useTodoStore: () => ({
    get allHintTodos() {
      return h.todos.todos.filter((t) => !!t.hintType);
    },
    createTodo: h.createTodo,
    deleteTodo: h.deleteTodo,
  }),
}));

import { __resetHelpfulHintsForTesting, useHelpfulHints } from '../useHelpfulHints';
import { __resetAttemptBudgetForTests } from '@/utils/attemptBudget';
import { __resetWriteGateForTesting, setWriteGate } from '@/services/automerge/worker/writeGate';

const DAY = 86_400_000;
const T0 = '2026-11-01T08:00:00.000Z';
const EVENT = '2026-11-25';

function desiredHints(n: number, prefix = 'k'): DesiredHint[] {
  return Array.from({ length: n }, (_, i) => ({
    hintType: 'trip-packing' as const,
    hintKey: `${prefix}${i}`,
    title: `hint ${i}`,
    assigneeIds: ['greg'],
    eventDate: EVENT,
  }));
}

function hintTodo(key: string): TodoItem {
  return {
    id: `todo-${key}`,
    title: key,
    completed: false,
    createdBy: 'greg',
    hintType: 'trip-packing',
    hintKey: key,
    hintEventDate: EVENT,
    createdAt: T0,
    updatedAt: T0,
  } as TodoItem;
}

const createdKeys = () =>
  h.createTodo.mock.calls.map(([input]) => (input as CreateTodoInput).hintKey);

const cappedReports = () =>
  h.reportError.mock.calls.filter(
    ([input]) =>
      (input as { context?: { action?: string } }).context?.action === 'auto-write-capped'
  );

/** Let the watcher flush, then let the debounce elapse and the run settle. */
async function settle(): Promise<void> {
  await nextTick();
  await vi.advanceTimersByTimeAsync(1000);
  await nextTick();
  await vi.advanceTimersByTimeAsync(1000);
}

/** Any watched source change re-runs the reconcile. */
async function retrigger(): Promise<void> {
  h.activities.activeActivities = [];
  await settle();
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T08:00:00'));
  vi.clearAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  __resetHelpfulHintsForTesting();
  __resetAttemptBudgetForTests();
  __resetWriteGateForTesting();
  h.today.value = '2026-11-12';
  h.desired.value = [];
  h.family.currentMember = { id: 'greg' };
  h.settings.helpfulHintsEnabled = true;
  h.settings.dismissedHintKeys = {};
  h.todos.todos = [];
  // Like the real store: the write lands in `todos` (and the hint getter).
  h.createTodo.mockImplementation(async (input: CreateTodoInput) => {
    const created = { ...input, id: `todo-${input.hintKey}`, createdAt: T0, updatedAt: T0 };
    h.todos.todos = [...h.todos.todos, created as TodoItem];
    return created;
  });
  h.deleteTodo.mockImplementation(async (id: string) => {
    h.todos.todos = h.todos.todos.filter((t) => t.id !== id);
    return true;
  });
});

afterEach(() => {
  warn.mockRestore();
  vi.useRealTimers();
});

describe('useHelpfulHints automatic-write cap', () => {
  it('🔴 a simulated fight (every hint vanishes after each run) stops creating at 40', async () => {
    h.desired.value = desiredHints(60);
    useHelpfulHints();
    await settle();
    expect(h.createTodo).toHaveBeenCalledTimes(40);

    // Another device prunes everything this one made, run after run.
    for (let i = 0; i < 5; i++) {
      h.todos.todos = [];
      await retrigger();
    }

    expect(h.createTodo).toHaveBeenCalledTimes(40);
    // One report for the window, however many runs were refused.
    expect(cappedReports()).toHaveLength(1);
    expect(cappedReports()[0]?.[0]).toMatchObject({
      surface: 'helpful-hints',
      severity: 'error',
      context: { action: 'auto-write-capped' },
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('the 41st hint is refused, then created on the next run after the window frees', async () => {
    h.desired.value = desiredHints(41);
    useHelpfulHints();
    await settle();
    expect(createdKeys()).toEqual(desiredHints(40).map((d) => d.hintKey));
    expect(cappedReports()).toHaveLength(1);

    await retrigger(); // still inside the window: deferred, not created, not re-reported
    expect(h.createTodo).toHaveBeenCalledTimes(40);
    expect(cappedReports()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(DAY);
    h.today.value = '2026-11-13'; // the day rollover re-runs the reconcile
    await settle();

    expect(h.createTodo).toHaveBeenCalledTimes(41);
    expect(createdKeys()[40]).toBe('k40');
    expect(cappedReports()).toHaveLength(1);
  });

  it('caps reconcile-driven removals too (stale copies are where a fight lives)', async () => {
    h.todos.todos = Array.from({ length: 50 }, (_, i) => hintTodo(`stale${i}`));
    useHelpfulHints();
    await settle();

    expect(h.deleteTodo).toHaveBeenCalledTimes(40);
    expect(h.todos.todos).toHaveLength(10);
    expect(cappedReports()).toHaveLength(1);
  });

  it('🔴 a read-only family spends no budget and emits no cap event', async () => {
    setWriteGate(() => ({ block: true, wouldBlock: true }));
    h.desired.value = desiredHints(60);
    h.todos.todos = Array.from({ length: 10 }, (_, i) => hintTodo(`stale${i}`));
    useHelpfulHints();
    await settle();
    await retrigger();

    expect(h.createTodo).not.toHaveBeenCalled();
    expect(h.deleteTodo).not.toHaveBeenCalled();
    expect(cappedReports()).toHaveLength(0);

    // Writable again: the whole day's budget is still there.
    h.todos.todos = [];
    setWriteGate(() => ({ block: false, wouldBlock: false }));
    await retrigger();
    expect(h.createTodo).toHaveBeenCalledTimes(40);
  });

  it('🔴 switching hints off removes every un-kept hint in one run, even past the cap', async () => {
    h.settings.helpfulHintsEnabled = false;
    h.todos.todos = [
      ...Array.from({ length: 50 }, (_, i) => hintTodo(`h${i}`)),
      { ...hintTodo('kept'), hintAcknowledged: true },
    ];
    useHelpfulHints();
    await settle();

    expect(h.deleteTodo).toHaveBeenCalledTimes(50);
    expect(h.todos.todos.map((t) => t.hintKey)).toEqual(['kept']);
    expect(cappedReports()).toHaveLength(0);
  });
});
