import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type { ResponsibilityCardDef } from '@/constants/responsibilityCards';
import type {
  CardReminder,
  FamilyMember,
  ResponsibilityCardState,
  TodoItem,
  UpdateTodoInput,
} from '@/types/models';

// `vi.mock` factories are hoisted above the module body, so everything they close over must
// come from `vi.hoisted`. The fake stores are reactive so the composable's watchers see edits.
const h = await vi.hoisted(async () => {
  const { reactive, ref } = await import('vue');
  return {
    logEvent: vi.fn(),
    reportError: vi.fn(),
    docLoaded: { value: true },
    appInitiatedDepth: { value: 0 },
    today: ref('2026-10-09'),
    family: reactive({ currentMember: null as { id: string; ageGroup: string } | null }),
    deck: reactive({ isLoaded: true, canDeal: true, resolved: [] as unknown[] }),
    todos: reactive({ todos: [] as TodoItem[] }),
    createTodos: vi.fn(),
    patchTodosEach: vi.fn(),
    deleteTodos: vi.fn(),
  };
});

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => h.docLoaded.value }));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: h.today }) }));
vi.mock('@/services/analytics/plausible', () => ({
  withAppInitiatedWrites: async <T>(fn: () => Promise<T>): Promise<T> => {
    h.appInitiatedDepth.value++;
    try {
      return await fn();
    } finally {
      h.appInitiatedDepth.value--;
    }
  },
}));
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => h.family }));
vi.mock('@/stores/responsibilityStore', () => ({ useResponsibilityStore: () => h.deck }));
vi.mock('@/stores/todoStore', () => ({
  useTodoStore: () =>
    new Proxy(h.todos, {
      get(target, key) {
        if (key === 'createTodos') return h.createTodos;
        if (key === 'patchTodosEach') return h.patchTodosEach;
        if (key === 'deleteTodos') return h.deleteTodos;
        return Reflect.get(target, key);
      },
    }),
}));

import { __resetCardRemindersForTesting, useCardReminders } from '../useCardReminders';
import { resolveDeck } from '@/utils/responsibilityDeck';
import { __resetWriteGateForTesting, setWriteGate } from '@/services/automerge/worker/writeGate';

// ── fixtures ────────────────────────────────────────────────────────────────────

const T0 = '2026-09-01T10:00:00.000Z';
const FAMILY = [
  { id: 'greg', name: 'greg', ageGroup: 'adult', role: 'owner' },
  { id: 'sofia', name: 'sofia', ageGroup: 'adult', role: 'member' },
  { id: 'leo', name: 'leo', ageGroup: 'child', role: 'member' },
] as FamilyMember[];
const DEFS: ResponsibilityCardDef[] = [
  {
    id: 'trash',
    category: 'home',
    emoji: '🗑️',
    nameKey: 'cards.laundry.name',
    doneKey: 'cards.laundry.done',
  },
];
const TRASH: CardReminder = {
  say: 'Put the trash out',
  cadence: { unit: 'week', interval: 1, weekdays: [3] },
  time: '20:00',
  anchor: '2026-09-30',
};

function setCard(holderId: string | null, reminder: CardReminder | null = TRASH): void {
  const state: ResponsibilityCardState = {
    id: 'trash',
    status: 'kept',
    splitMode: 'single',
    parts: [holderId ? { key: 'main', holderId } : { key: 'main' }],
    createdAt: T0,
    updatedAt: T0,
    ...(reminder ? { reminders: { main: reminder } } : {}),
  };
  h.deck.resolved = resolveDeck(DEFS, [state], [], FAMILY).cards;
}

const storeCalls = () =>
  h.createTodos.mock.calls.length +
  h.patchTodosEach.mock.calls.length +
  h.deleteTodos.mock.calls.length;

const events = (message: string) =>
  h.logEvent.mock.calls
    .map(([e]) => e as { level: string; surface: string; message: string; context?: object })
    .filter((e) => e.surface === 'card-reminders' && e.message === message);

/** Let the watchers flush, then let the debounce elapse and the run settle. */
async function settle(): Promise<void> {
  await nextTick();
  await vi.advanceTimersByTimeAsync(1000);
  await nextTick();
  await vi.advanceTimersByTimeAsync(1000);
}

function asStored(input: TodoItem): TodoItem {
  return { ...input, createdAt: T0, updatedAt: T0 };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  __resetCardRemindersForTesting();
  __resetWriteGateForTesting();
  h.docLoaded.value = true;
  h.appInitiatedDepth.value = 0;
  h.today.value = '2026-10-09';
  h.family.currentMember = { id: 'greg', ageGroup: 'adult' };
  h.deck.isLoaded = true;
  h.deck.canDeal = true;
  h.deck.resolved = [];
  h.todos.todos = [];
  // Default store behaviour: succeed and reflect the write in `todos`, like the real store.
  h.createTodos.mockImplementation(async (inputs: TodoItem[]) => {
    const created = inputs.map(asStored);
    h.todos.todos = [...h.todos.todos, ...created];
    return created;
  });
  h.patchTodosEach.mockImplementation(async (items: { id: string; patch: UpdateTodoInput }[]) => {
    const byId = new Map(items.map((i) => [i.id, i.patch]));
    h.todos.todos = h.todos.todos.map((t) => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t));
    return h.todos.todos.filter((t) => byId.has(t.id));
  });
  h.deleteTodos.mockImplementation(async (ids: string[]) => {
    h.todos.todos = h.todos.todos.filter((t) => !ids.includes(t.id));
    return true;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── guards ──────────────────────────────────────────────────────────────────────

describe('useCardReminders guards', () => {
  it('a child session never writes and logs skipped not-adult', async () => {
    h.family.currentMember = { id: 'leo', ageGroup: 'child' };
    h.deck.canDeal = false;
    setCard('leo');
    useCardReminders();
    await settle();
    expect(storeCalls()).toBe(0);
    expect(events('skipped').map((e) => e.context)).toEqual([{ detail: 'not-adult' }]);
  });

  it('does nothing before the document or the deck is loaded', async () => {
    h.docLoaded.value = false;
    setCard('greg');
    useCardReminders();
    await settle();
    expect(storeCalls()).toBe(0);
    expect(events('skipped').map((e) => e.context)).toEqual([{ detail: 'not-loaded' }]);
  });

  it('runs once the deck finishes loading', async () => {
    h.deck.isLoaded = false;
    setCard('greg');
    useCardReminders();
    await settle();
    expect(storeCalls()).toBe(0);
    h.deck.isLoaded = true;
    await settle();
    expect(h.createTodos).toHaveBeenCalledTimes(1);
  });

  it('a session with no current member writes nothing', async () => {
    h.family.currentMember = null;
    setCard('greg');
    useCardReminders();
    await settle();
    expect(storeCalls()).toBe(0);
    expect(events('skipped').map((e) => e.context)).toEqual([{ detail: 'no-member' }]);
  });

  it('a read-only family makes zero store calls and logs skipped_read_only once', async () => {
    setWriteGate(() => ({ block: true, wouldBlock: true }));
    setCard('greg');
    useCardReminders();
    await settle();
    setCard('sofia');
    await settle();
    expect(storeCalls()).toBe(0);
    const readOnly = h.logEvent.mock.calls.filter(
      ([e]) => (e as { context?: { action?: string } }).context?.action === 'skipped_read_only'
    );
    expect(readOnly).toHaveLength(1);
  });

  it('a family with no reminders and no card to-dos makes zero store calls', async () => {
    setCard('greg', null);
    h.todos.todos = [
      {
        id: 'plain',
        title: 'Buy milk',
        completed: false,
        createdBy: 'greg',
        createdAt: T0,
        updatedAt: T0,
      },
    ];
    useCardReminders();
    await settle();
    expect(storeCalls()).toBe(0);
    expect(events('reconcile').map((e) => [e.level, e.context])).toEqual([
      ['info', { count: 0, detail: 'noop', kind: 'single' }],
    ]);
  });
});

// ── writes ──────────────────────────────────────────────────────────────────────

describe('useCardReminders writes', () => {
  it('creates the card to-do under its deterministic id, ifAbsent, as an app-initiated write', async () => {
    let depthDuringCreate = -1;
    h.createTodos.mockImplementationOnce(async (inputs: TodoItem[]) => {
      depthDuringCreate = h.appInitiatedDepth.value;
      const created = inputs.map(asStored);
      h.todos.todos = created;
      return created;
    });
    setCard('greg');
    useCardReminders();
    await settle();
    expect(h.createTodos).toHaveBeenCalledTimes(1);
    const [inputs, opts] = h.createTodos.mock.calls[0]!;
    expect((inputs as TodoItem[]).map((t) => [t.id, t.assigneeIds, t.cardId])).toEqual([
      ['card-trash-main', ['greg'], 'trash'],
    ]);
    expect(opts).toEqual({ ifAbsent: true });
    expect(depthDuringCreate).toBe(1);
    expect(events('reconcile')[0]).toMatchObject({
      level: 'info',
      context: { count: 1, detail: 'created', kind: 'single' },
    });
    // Its own write changes the watch key once; that rerun is a no-op.
    expect(storeCalls()).toBe(1);
  });

  it('a re-deal patches the assignee', async () => {
    setCard('greg');
    useCardReminders();
    await settle();
    setCard('sofia');
    await settle();
    expect(h.patchTodosEach).toHaveBeenCalledWith([
      { id: 'card-trash-main', patch: { assigneeIds: ['sofia'], assigneeId: 'sofia' } },
    ]);
    expect(h.todos.todos[0]!.assigneeIds).toEqual(['sofia']);
  });

  it('turning the reminder off removes the to-do', async () => {
    setCard('greg');
    useCardReminders();
    await settle();
    setCard('greg', null);
    await settle();
    expect(h.deleteTodos).toHaveBeenCalledWith(['card-trash-main']);
    expect(h.todos.todos).toEqual([]);
  });

  it('a card to-do deleted elsewhere is recreated', async () => {
    setCard('greg');
    useCardReminders();
    await settle();
    h.todos.todos = [];
    await settle();
    expect(h.createTodos).toHaveBeenCalledTimes(2);
  });

  it('a null store result logs reconcile partial at warn, and the next trigger retries', async () => {
    h.createTodos.mockResolvedValueOnce(null);
    setCard('greg');
    useCardReminders();
    await settle();
    expect(events('reconcile')[0]).toMatchObject({
      level: 'warn',
      context: { count: 0, detail: 'partial', kind: 'single' },
    });
    setCard('greg', { ...TRASH, time: '21:00' });
    await settle();
    expect(h.createTodos).toHaveBeenCalledTimes(2);
    expect(h.todos.todos.map((t) => t.dueTime)).toEqual(['21:00']);
  });

  it('a thrown reconcile is reported and the next trigger runs again', async () => {
    h.createTodos.mockRejectedValueOnce(new Error('boom'));
    setCard('greg');
    useCardReminders();
    await settle();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'card-reminders', severity: 'error' })
    );
    setCard('sofia');
    await settle();
    expect(h.createTodos).toHaveBeenCalledTimes(2);
    expect(h.todos.todos.map((t) => t.assigneeIds)).toEqual([['sofia']]);
  });
});

// ── loop ────────────────────────────────────────────────────────────────────────

describe('useCardReminders loop', () => {
  it('debounces a burst of changes into one run', async () => {
    setCard(null);
    useCardReminders();
    await nextTick();
    setCard('greg');
    await nextTick();
    setCard('sofia');
    await nextTick();
    await vi.advanceTimersByTimeAsync(999);
    expect(storeCalls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.createTodos).toHaveBeenCalledTimes(1);
    expect((h.createTodos.mock.calls[0]![0] as TodoItem[])[0]!.assigneeIds).toEqual(['sofia']);
  });

  it('a change during a run is applied by exactly one rerun after it, never alongside it', async () => {
    let release: () => void = () => {};
    let inFlight = 0;
    let maxInFlight = 0;
    h.createTodos.mockImplementationOnce(async (inputs: TodoItem[]) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => (release = resolve));
      inFlight--;
      const created = inputs.map(asStored);
      h.todos.todos = created;
      return created;
    });
    setCard('greg');
    useCardReminders();
    await nextTick();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.createTodos).toHaveBeenCalledTimes(1);

    setCard('sofia'); // arrives mid-run
    await nextTick();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.patchTodosEach).not.toHaveBeenCalled();

    release();
    await settle();
    expect(maxInFlight).toBe(1);
    expect(h.patchTodosEach).toHaveBeenCalledTimes(1);
    expect(h.todos.todos[0]!.assigneeIds).toEqual(['sofia']);
  });

  it('init is once per session', async () => {
    setCard('greg');
    useCardReminders();
    useCardReminders();
    await settle();
    expect(h.createTodos).toHaveBeenCalledTimes(1);
  });
});
