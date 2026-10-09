/**
 * The To-Dos page's add affordances. What this pins:
 *   - the header carries ✨ magic beans (always; the door has its own gate) and "+ Add To-do"
 *     (only with edit permission),
 *   - the quick-add sheet's To-do tile (`add-todo` intent) opens the Add To-do sidebar,
 *   - a magic beans result never opens its review drawer over the sidebar: it closes it first,
 *     and the add-todo intent never opens the sidebar over the review drawer,
 *   - saving the review closes it and reveals the TOPMOST new to-do as the list draws it (not
 *     counted here: the review drawer logs its own confirm events),
 *   - overlapping reveals never fight: only the latest one scrolls and pulses,
 *   - a to-do the quick-add bar created is revealed (the bar's own create rules are pinned in
 *     `QuickAddBar.test.ts` / `useTodoDraft.test.ts`),
 *   - desktop focuses the quick-add bar, unless the page was opened to add a to-do,
 *   - the family's reminders (#123): a phone mounts the Reminders section and not the panel,
 *     desktop the reverse; both list only repeating to-dos, honour the member lens, and a tap
 *     on a roster row opens the drawer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, nextTick, ref } from 'vue';
import FamilyTodoPage from '@/pages/FamilyTodoPage.vue';
import type { QuickAddIntentHandler } from '@/composables/useQuickAddIntent';
import { logEvent } from '@/services/telemetry/logEvent';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import type { TodoItem, TodoRepeat } from '@/types/models';

/** The query the page mounts with (the quick-add sheet's intent arrives here). */
let routeQuery: Record<string, string> = {};
vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: routeQuery, params: {}, path: '/todo' }),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    currentLanguage: ref('en'),
    isLoading: ref(false),
    isEnglish: ref(true),
    isBeanieMode: ref(false),
  }),
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));

const reveal = vi.fn();
vi.mock('@/composables/useAttentionPulse', () => ({
  useAttentionPulse: () => ({ reveal }),
}));

const canEditActivities = ref(true);
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canEditActivities }),
}));

/** Captured so a test can fire the quick-add sheet's intent as the composable would. */
let intentHandler: QuickAddIntentHandler = () => {};
vi.mock('@/composables/useQuickAddIntent', async (orig) => ({
  ...(await orig<typeof import('@/composables/useQuickAddIntent')>()),
  useQuickAddIntent: (handler: QuickAddIntentHandler) => {
    intentHandler = handler;
  },
}));

/** Captured so a test can deliver a to-do read exactly as the reader would. */
let deliverTodo: (payload?: unknown) => void = () => {};
vi.mock('@/composables/useMagicReader', async (orig) => ({
  ...(await orig<typeof import('@/composables/useMagicReader')>()),
  useMagicReader: () => ({ canReadTodo: ref(true) }),
  useMagicReaderConsumer: (surface: string, handler: (payload?: unknown) => void) => {
    if (surface === 'todo') deliverTodo = handler;
  },
}));

const isDesktop = ref(true);
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({ isDesktop }),
}));

/** The bar exposes `focus`, which the page calls on a desktop mount. */
const focusBar = vi.fn();
const QuickAddBarStub = defineComponent({
  name: 'QuickAddBar',
  emits: ['created'],
  setup(_, { expose }) {
    expose({ focus: focusBar });
    return () => h('div');
  },
});

function mountPage() {
  return shallowMount(FamilyTodoPage, { global: { stubs: { QuickAddBar: QuickAddBarStub } } });
}

const form = (w: ReturnType<typeof mountPage>) => w.findComponent({ name: 'TodoFormModal' });
const drawer = (w: ReturnType<typeof mountPage>) =>
  w.findComponent({ name: 'MagicTodoReviewDrawer' });
const addButton = (w: ReturnType<typeof mountPage>) => w.findComponent({ name: 'AddEntityButton' });

async function settle() {
  await flushPromises();
  await nextTick();
}

/** A row as the list would draw it. */
function row(w: ReturnType<typeof mountPage>, id: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.todoId = id;
  w.element.append(el);
  return el;
}

function openTodo(id: string, dueDate?: string): TodoItem {
  return {
    id,
    title: id,
    completed: false,
    dueDate,
    createdBy: 'm-greg',
    createdAt: '2026-09-29T08:00:00.000Z',
    updatedAt: '2026-09-29T08:00:00.000Z',
  } as TodoItem;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  canEditActivities.value = true;
  isDesktop.value = true;
  routeQuery = {};
});

describe('FamilyTodoPage: add affordances', () => {
  it('shows ✨ magic beans always, and "+ Add To-do" only with edit permission', async () => {
    const w = mountPage();
    expect(w.findComponent({ name: 'MagicBeansDoor' }).props('hint')).toBe('todo');
    expect(addButton(w).props('label')).toBe('todo.addTodo');

    canEditActivities.value = false;
    await nextTick();
    expect(w.findComponent({ name: 'MagicBeansDoor' }).exists()).toBe(true);
    expect(addButton(w).exists()).toBe(false);
  });

  it('opens the Add To-do sidebar from the header button and the add-todo intent', async () => {
    const w = mountPage();
    expect(form(w).props('open')).toBe(false);

    addButton(w).vm.$emit('click');
    await nextTick();
    expect(form(w).props('open')).toBe(true);

    form(w).vm.$emit('close');
    await nextTick();
    expect(form(w).props('open')).toBe(false);

    await intentHandler('add-todo', {});
    await nextTick();
    expect(form(w).props('open')).toBe(true);
  });

  it('closes the sidebar before a magic beans result opens the review drawer', async () => {
    const w = mountPage();
    addButton(w).vm.$emit('click');
    await nextTick();

    // What the drawer sees at each render: it must never be open while the sidebar is.
    const overlaps: boolean[] = [];
    w.vm.$watch(
      () => [form(w).props('open'), drawer(w).props('open')],
      ([formOpen, drawerOpen]) => overlaps.push(Boolean(formOpen && drawerOpen)),
      { flush: 'post' }
    );

    deliverTodo({ kind: 'todo', data: { items: [] }, env: { sourceFile: null } });
    await settle();

    expect(form(w).props('open')).toBe(false);
    expect(drawer(w).props('open')).toBe(true);
    expect(drawer(w).props('ready')).toMatchObject({ primaryKind: 'todo' });
    expect(overlaps).not.toContain(true);
  });

  it('keeps the review drawer and logs when the add-todo intent arrives while it is open', async () => {
    const w = mountPage();
    deliverTodo({ kind: 'todo', data: { items: [] }, env: { sourceFile: null } });
    await settle();

    await intentHandler('add-todo', {});
    await nextTick();

    expect(drawer(w).props('open')).toBe(true);
    expect(form(w).props('open')).toBe(false);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'todo-create',
        context: { action: 'intent_ignored', detail: 'magic_review_open' },
      })
    );
  });

  it('closes the review drawer on save and reveals the topmost new to-do, uncounted', async () => {
    const w = mountPage();
    // Drafted first but due later: the Open list (sorted by due date) draws todo-2 above it.
    useTodoStore().todos = [openTodo('todo-1', '2030-10-20'), openTodo('todo-2', '2030-10-13')];
    deliverTodo({ kind: 'todo', data: { items: [] }, env: { sourceFile: null } });
    await settle();
    row(w, 'todo-1');
    const topmost = row(w, 'todo-2');

    drawer(w).vm.$emit('saved', ['todo-1', 'todo-2']);
    await settle();

    expect(drawer(w).props('open')).toBe(false);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith(topmost, 'attention-ring');
    expect(logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ action: 'created' }) })
    );
  });

  it('falls back to the first saved id when none of them is drawn in the Open list', async () => {
    const w = mountPage();
    const first = row(w, 'todo-1');
    row(w, 'todo-2');

    drawer(w).vm.$emit('saved', ['todo-1', 'todo-2']);
    await settle();

    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith(first, 'attention-ring');
  });

  it('lets only the latest of two overlapping reveals scroll and pulse', async () => {
    const w = mountPage();
    row(w, 'todo-a');
    const latest = row(w, 'todo-b');

    // Two creates back to back: the first reveal is still awaiting its row when the second starts.
    form(w).vm.$emit('created', 'todo-a');
    form(w).vm.$emit('created', 'todo-b');
    await settle();

    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith(latest, 'attention-ring');
    expect(logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ action: 'reveal_missed' }) })
    );
  });

  it('reveals the to-do the quick-add bar created', async () => {
    const w = mountPage();
    const el = row(w, 'todo-quick');

    w.findComponent({ name: 'QuickAddBar' }).vm.$emit('created', openTodo('todo-quick'));
    await settle();

    expect(reveal).toHaveBeenCalledWith(el, 'attention-ring');
  });

  it('focuses the quick-add bar on desktop, except when arriving to add a to-do', async () => {
    mountPage();
    await settle();
    expect(focusBar).toHaveBeenCalledTimes(1);

    focusBar.mockClear();
    routeQuery = { action: 'add-todo' };
    mountPage();
    await settle();
    expect(focusBar).not.toHaveBeenCalled();
  });
});

describe('FamilyTodoPage: the family reminders (#123)', () => {
  const repeat: TodoRepeat = {
    rule: { unit: 'week', interval: 1, weekdays: [3], end: { kind: 'never' } },
    anchor: '2030-10-16',
  };
  function seed(): void {
    useTodoStore().todos = [
      { ...openTodo('plain', '2030-10-13'), assigneeIds: ['m-dan'] },
      { ...openTodo('trash', '2030-10-16'), repeat, repeatLog: [], assigneeIds: ['m-sofia'] },
      { ...openTodo('sitter', '2030-10-16'), repeat, repeatLog: [], assigneeIds: ['m-dan'] },
    ];
  }
  const mountWithSlots = () =>
    shallowMount(FamilyTodoPage, {
      global: { stubs: { QuickAddBar: QuickAddBarStub }, renderStubDefaultSlot: true },
    });
  const rosterIds = (w: ReturnType<typeof mountWithSlots>) =>
    (w.findComponent({ name: 'TodoRemindersRoster' }).props('todos') as TodoItem[]).map(
      (t) => t.id
    );
  const section = (w: ReturnType<typeof mountWithSlots>) =>
    w.find('[data-testid="todo-reminders-section"]');
  const panel = (w: ReturnType<typeof mountWithSlots>) =>
    w.find('[data-testid="todo-reminders-panel"]');

  it('desktop: the Family Reminders panel lists only repeating to-dos; no phone section', () => {
    seed();
    const w = mountWithSlots();
    expect(panel(w).exists()).toBe(true);
    expect(section(w).exists()).toBe(false);
    expect(panel(w).text()).toContain('todo.reminders.panelTitle');
    expect(rosterIds(w).sort()).toEqual(['sitter', 'trash']);
  });

  it('phone: the Reminders section carries the roster; no panel', () => {
    isDesktop.value = false;
    seed();
    const w = mountWithSlots();
    expect(panel(w).exists()).toBe(false);
    expect(section(w).exists()).toBe(true);
    expect(w.findAllComponents({ name: 'TodoRemindersRoster' })).toHaveLength(1);
    expect(rosterIds(w).sort()).toEqual(['sitter', 'trash']);
  });

  it('an empty family sees one empty state: no reminders panel beside it', () => {
    useTodoStore().todos = [];
    const w = mountWithSlots();
    expect(panel(w).exists()).toBe(false);
    expect(section(w).exists()).toBe(false);
    expect(w.text()).toContain('todo.getStarted');
  });

  it('honours the page member lens', async () => {
    seed();
    useFamilyStore().members = [
      { id: 'm-sofia', name: 'Sofia', role: 'owner', ageGroup: 'adult' },
      { id: 'm-dan', name: 'Dan', role: 'admin', ageGroup: 'adult' },
    ] as never;
    const w = mountWithSlots();
    w.findComponent({ name: 'TodoMemberFilter' }).vm.$emit('update:modelValue', 'm-dan');
    await nextTick();
    expect(rosterIds(w)).toEqual(['sitter']);
  });

  it('a tap on a roster row opens the to-do drawer', async () => {
    seed();
    const w = mountWithSlots();
    const trash = useTodoStore().todos.find((t) => t.id === 'trash')!;
    w.findComponent({ name: 'TodoRemindersRoster' }).vm.$emit('view', trash);
    await nextTick();
    expect(w.findComponent({ name: 'TodoViewEditModal' }).props('todo')).toMatchObject({
      id: 'trash',
    });
  });
});
