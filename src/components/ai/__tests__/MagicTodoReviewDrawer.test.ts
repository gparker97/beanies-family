/**
 * The magic beans to-do review drawer (#113). What it must guarantee:
 *   - one row per extracted to-do, in order,
 *   - the save button says what happens next, and follows skips,
 *   - saving writes ONE batch under the ids minted with the drafts, then says so,
 *   - a draft-build failure is toasted and handed back, never swallowed,
 *   - a row the family already has starts skipped, says why, and can be added anyway,
 *   - a stated time is shown with its date and saved; clearing the date clears it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import MagicTodoReviewDrawer from '@/components/ai/MagicTodoReviewDrawer.vue';
import type { TodoReviewReady } from '@/utils/magicTodoDrafts';
import type { TodoItemExtraction } from '@/services/ai/types';
import type { TodoItem } from '@/types/models';
import { addDaysYmd, localToday } from '@/utils/date';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const showToast = vi.fn();
vi.mock('@/composables/useToast', () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...a: unknown[]) => reportError(...a),
}));

const createTodos = vi.fn();
const storeTodos: TodoItem[] = [];
vi.mock('@/stores/todoStore', () => ({
  useTodoStore: () => ({ createTodos, todos: storeTodos }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    sortedHumans: [
      { id: 'm-greg', name: 'Greg' },
      { id: 'm-leo', name: 'Leo' },
    ],
    currentMember: { id: 'm-greg' },
    owner: { id: 'm-greg' },
  }),
}));

vi.mock('@/stores/responsibilityStore', () => ({
  useResponsibilityStore: () => ({ defaultHolderFor: () => null }),
}));

vi.mock('@/composables/useAuthoringMember', () => ({
  useAuthoringMember: () => ({ resolveOrToast: () => 'm-greg' }),
}));

vi.mock('@/composables/useCardDefaultHint', () => ({
  useCardDefaultHint: () => ({ holdsHint: () => '' }),
}));

const buildTodoDrafts = vi.fn();
const markDuplicateDrafts = vi.fn();
vi.mock('@/utils/magicTodoDrafts', async (orig) => {
  const actual = await orig<typeof import('@/utils/magicTodoDrafts')>();
  return {
    ...actual,
    buildTodoDrafts: (...a: Parameters<typeof actual.buildTodoDrafts>) =>
      buildTodoDrafts(...a) ?? actual.buildTodoDrafts(...a),
    markDuplicateDrafts: (...a: Parameters<typeof actual.markDuplicateDrafts>) =>
      markDuplicateDrafts(...a) ?? actual.markDuplicateDrafts(...a),
  };
});

function existingTodo(over: Partial<TodoItem> & Pick<TodoItem, 'id' | 'title'>): TodoItem {
  return {
    completed: false,
    createdBy: 'm-greg',
    createdAt: '2030-09-01T00:00:00Z',
    updatedAt: '2030-09-01T00:00:00Z',
    ...over,
  };
}

/** Renders the body and a save button carrying the label, like the real footer. */
const BeanieFormModalStub = defineComponent({
  name: 'BeanieFormModal',
  props: {
    open: Boolean,
    saveLabel: { type: String, default: '' },
    saveDisabled: Boolean,
    saveGradient: { type: String, default: '' },
  },
  emits: ['close', 'save'],
  setup(props, { slots, emit }) {
    return () =>
      h('div', [
        slots.default?.(),
        h(
          'button',
          {
            'data-test': 'save',
            disabled: props.saveDisabled,
            onClick: () => emit('save'),
          },
          props.saveLabel
        ),
        h('button', { 'data-test': 'close', onClick: () => emit('close') }),
      ]);
  },
});

const stubs = {
  BeanieFormModal: BeanieFormModalStub,
  AssigneePickerButton: true,
  BeanieDatePicker: true,
  TimePresetPicker: true,
  LinkList: true,
  InferredHint: true,
  MagicMiscategorisedBanner: true,
};

function item(title: string, over: Partial<TodoItemExtraction> = {}): TodoItemExtraction {
  return {
    title,
    details: null,
    dueDate: null,
    dueTime: null,
    timing: null,
    assigneeName: null,
    ownerCard: null,
    links: [],
    ...over,
  };
}

function ready(shared: boolean): TodoReviewReady {
  return {
    result: {
      items: [
        item('Return the slip', { dueDate: '2030-10-09', assigneeName: 'Leo' }),
        item('Pay the fee', { links: ['https://portal.example.org/trips'] }),
      ],
    },
    ...(shared ? { eventSummary: { title: 'Field trip', date: '2030-10-13' } } : {}),
    env: { sourceFile: null },
    primaryKind: shared ? 'event' : 'todo',
  };
}

function mountDrawer(r: TodoReviewReady | null) {
  return mount(MagicTodoReviewDrawer, {
    props: { open: r !== null, ready: r },
    global: { stubs },
  });
}

const rows = (w: ReturnType<typeof mountDrawer>) => w.findAll('[data-testid="magic-todo-row"]');
const saveButton = (w: ReturnType<typeof mountDrawer>) => w.find('[data-test="save"]');

beforeEach(() => {
  vi.clearAllMocks();
  buildTodoDrafts.mockReturnValue(undefined);
  markDuplicateDrafts.mockReturnValue(undefined);
  storeTodos.length = 0;
});

const loggedActions = () =>
  logEvent.mock.calls.map((c) => c[0] as { message: string; context?: Record<string, unknown> });

describe('MagicTodoReviewDrawer', () => {
  it('renders one row per to-do and the activity summary for a shared result', () => {
    const w = mountDrawer(ready(true));
    expect(rows(w)).toHaveLength(2);
    expect(w.find('[data-testid="magic-todo-activity"]').text()).toContain('Field trip');
    expect(saveButton(w).text()).toBe('magicTodos.save.shared.other');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'magic-todo-review',
        context: expect.objectContaining({ action: 'opened', count: 2, stage: 'shared' }),
      })
    );
  });

  it('has no activity section for a to-do-only result', () => {
    const w = mountDrawer(ready(false));
    expect(w.find('[data-testid="magic-todo-activity"]').exists()).toBe(false);
    expect(saveButton(w).text()).toBe('magicTodos.save.todoOnly.other');
  });

  it('follows skips in the save label, and undo brings the row back', async () => {
    const w = mountDrawer(ready(true));
    await w.findAll('[data-testid="magic-todo-skip"]')[0]!.trigger('click');
    expect(saveButton(w).text()).toBe('magicTodos.save.shared.one');

    await w.findAll('[data-testid="magic-todo-skip"]')[0]!.trigger('click');
    expect(saveButton(w).text()).toBe('magicTodos.save.activityOnly');

    await w.findAll('[data-testid="magic-todo-undo"]')[0]!.trigger('click');
    expect(saveButton(w).text()).toBe('magicTodos.save.shared.one');
  });

  it('disables save for a to-do-only result once every row is skipped', async () => {
    const w = mountDrawer(ready(false));
    for (const b of w.findAll('[data-testid="magic-todo-skip"]')) await b.trigger('click');
    expect(saveButton(w).attributes('disabled')).toBeDefined();
  });

  it('saves the kept rows in one batch under the draft ids, then emits them', async () => {
    createTodos.mockImplementation(async (inputs: { id: string }[]) => inputs);
    const w = mountDrawer(ready(false));
    await w.findAll('[data-testid="magic-todo-skip"]')[1]!.trigger('click');

    await saveButton(w).trigger('click');
    await flushPromises();

    expect(createTodos).toHaveBeenCalledTimes(1);
    const inputs = createTodos.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      title: 'Return the slip',
      dueDate: '2030-10-09',
      assigneeIds: ['m-leo'],
      completed: false,
      createdBy: 'm-greg',
    });
    expect(typeof inputs[0]!.id).toBe('string');
    expect(w.emitted('saved')).toEqual([[[inputs[0]!.id]]]);
  });

  it('stays open with the drafts when the save fails (the store has toasted)', async () => {
    createTodos.mockResolvedValue(null);
    const w = mountDrawer(ready(false));
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(w.emitted('saved')).toBeUndefined();
    expect(rows(w)).toHaveLength(2);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('drops a save that lands after a newer capture replaced this one', async () => {
    let finish: (v: unknown) => void = () => {};
    createTodos.mockImplementation(
      (inputs: unknown) => new Promise((resolve) => (finish = () => resolve(inputs)))
    );
    const w = mountDrawer(ready(true));
    await saveButton(w).trigger('click');
    // Capture B arrives while A's write is in flight.
    await w.setProps({ ready: ready(true) });
    finish(undefined);
    await flushPromises();
    expect(w.emitted('saved')).toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'link_skipped', stage: 'superseded' }),
      })
    );
  });

  it('folds line breaks in a pasted title into spaces on save', async () => {
    createTodos.mockImplementation(async (inputs: { id: string }[]) => inputs);
    const w = mountDrawer(ready(false));
    await w.find('[data-testid="magic-todo-title"]').setValue('Return slip\nby Friday');
    await saveButton(w).trigger('click');
    await flushPromises();
    const inputs = createTodos.mock.calls[0]![0] as Array<{ title: string }>;
    expect(inputs[0]!.title).toBe('Return slip by Friday');
  });

  it('with every row skipped on a shared result, carries on to the activity without a write', async () => {
    const w = mountDrawer(ready(true));
    for (const b of w.findAll('[data-testid="magic-todo-skip"]')) await b.trigger('click');
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(createTodos).not.toHaveBeenCalled();
    expect(w.emitted('saved')).toEqual([[[]]]);
  });

  it('toasts and emits buildFailed when the drafts cannot be built', async () => {
    buildTodoDrafts.mockImplementation(() => {
      throw new Error('boom');
    });
    const w = mountDrawer(null);
    await w.setProps({ open: true, ready: ready(true) });
    await nextTick();
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'magicTodos.error.build',
      undefined,
      expect.objectContaining({
        surface: 'magic-todo-review',
        context: expect.objectContaining({ stage: 'build_drafts' }),
      })
    );
    expect(w.emitted('buildFailed')).toHaveLength(1);
  });

  it('logs dismissed on close', async () => {
    const w = mountDrawer(ready(false));
    await w.find('[data-test="close"]').trigger('click');
    expect(w.emitted('close')).toHaveLength(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'dismissed', stage: 'todo_only' }),
      })
    );
  });

  it('logs corrected, not dismissed, when the "not right?" banner closes the drawer', async () => {
    const w = mountDrawer(ready(true));
    logEvent.mockClear();
    w.findComponent({ name: 'MagicMiscategorisedBanner' }).vm.$emit('close');
    await nextTick();
    expect(w.emitted('close')).toHaveLength(1);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'magic-todo-review',
        message: 'corrected',
        context: { action: 'corrected', stage: 'shared' },
      })
    );
  });

  it('logs only dismissed (never corrected) for the close button', async () => {
    const w = mountDrawer(ready(true));
    logEvent.mockClear();
    await w.find('[data-test="close"]').trigger('click');
    const actions = logEvent.mock.calls.map(
      (c) => (c[0] as { context?: { action?: string } }).context?.action
    );
    expect(actions).toEqual(['dismissed']);
  });

  // ── Duplicates ────────────────────────────────────────────────────────────

  it('starts a row the family already has skipped, says why, and Add anyway brings it back', async () => {
    storeTodos.push(
      existingTodo({ id: 't-slip', title: 'Return the slip', dueDate: '2030-10-09' })
    );
    createTodos.mockImplementation(async (inputs: { id: string }[]) => inputs);
    const w = mountDrawer(ready(false));

    expect(w.findAll('[data-testid="magic-todo-duplicate-note"]').map((n) => n.text())).toEqual([
      'magicTodos.duplicate.open',
    ]);
    const undo = w.find('[data-testid="magic-todo-undo"]');
    expect(undo.text()).toBe('magicTodos.duplicate.addAnyway');
    expect(saveButton(w).text()).toBe('magicTodos.save.todoOnly.one');
    expect(loggedActions()).toContainEqual(
      expect.objectContaining({
        message: 'duplicates_flagged',
        context: { action: 'duplicates_flagged', count: 1, stage: 'todo_only' },
      })
    );

    await undo.trigger('click');
    expect(saveButton(w).text()).toBe('magicTodos.save.todoOnly.other');
    await saveButton(w).trigger('click');
    await flushPromises();
    expect((createTodos.mock.calls[0]![0] as unknown[]).length).toBe(2);
    expect(loggedActions()).toContainEqual(
      expect.objectContaining({
        message: 'duplicate_added_anyway',
        context: { action: 'duplicate_added_anyway', count: 1, stage: 'todo_only' },
      })
    );
  });

  it('says "Already done" for a completed match, and a skip the user made keeps Undo skip', async () => {
    storeTodos.push(
      existingTodo({ id: 't-slip', title: 'Return the slip', activityId: 'act-1', completed: true })
    );
    const w = mountDrawer({ ...ready(true), probableActivityId: 'act-1' });
    expect(w.find('[data-testid="magic-todo-duplicate-note"]').text()).toBe(
      'magicTodos.duplicate.done'
    );
    await w.find('[data-testid="magic-todo-skip"]').trigger('click');
    expect(w.findAll('[data-testid="magic-todo-undo"]').map((b) => b.text())).toEqual([
      'magicTodos.duplicate.addAnyway',
      'magicTodos.undoSkip',
    ]);
    // Every row skipped on a shared read: the button carries on to the activity.
    expect(saveButton(w).text()).toBe('magicTodos.save.activityOnly');
  });

  it('only matches a to-do linked to the activity when the page passed it as probable', () => {
    storeTodos.push(existingTodo({ id: 't-fee', title: 'Pay the fee', activityId: 'act-1' }));
    // "Pay the fee" is derived to the day before, so only the activity link can match it.
    expect(mountDrawer(ready(true)).find('[data-testid="magic-todo-undo"]').exists()).toBe(false);
    expect(
      mountDrawer({ ...ready(true), probableActivityId: 'act-1' })
        .find('[data-testid="magic-todo-undo"]')
        .exists()
    ).toBe(true);
  });

  it('reports a failed duplicate check and leaves every row unflagged', () => {
    markDuplicateDrafts.mockImplementation(() => {
      throw new Error('boom');
    });
    const w = mountDrawer(ready(true));
    expect(rows(w)).toHaveLength(2);
    expect(w.find('[data-testid="magic-todo-undo"]').exists()).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'magic-todo-review',
        severity: 'warning',
        context: { stage: 'duplicate_check' },
      })
    );
    expect(showToast).not.toHaveBeenCalled();
    expect(w.emitted('buildFailed')).toBeUndefined();
  });

  // ── Due time ──────────────────────────────────────────────────────────────

  function timedReady(): TodoReviewReady {
    return {
      result: {
        items: [
          item('Walk the dog', { dueDate: '2030-09-30', dueTime: '10:00' }),
          item('Call grandma', { dueTime: '15:00' }),
        ],
      },
      env: { sourceFile: null },
      primaryKind: 'todo',
    };
  }

  it('shows a stated time beside its date, saves it, and counts a time with no date', async () => {
    createTodos.mockImplementation(async (inputs: { id: string }[]) => inputs);
    const w = mountDrawer(timedReady());
    const pickers = w.findAllComponents({ name: 'TimePresetPicker' });
    // Only the dated row gets a time field.
    expect(pickers).toHaveLength(1);
    expect(pickers[0]!.props('modelValue')).toBe('10:00');
    expect(loggedActions()).toContainEqual(
      expect.objectContaining({
        message: 'due_time_dropped',
        context: { action: 'due_time_dropped', detail: 'no_date', count: 1, stage: 'todo_only' },
      })
    );

    await saveButton(w).trigger('click');
    await flushPromises();
    const inputs = createTodos.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(inputs[0]).toMatchObject({ dueDate: '2030-09-30', dueTime: '10:00' });
    expect(inputs[1]!.dueTime).toBeUndefined();
  });

  it('drops a time already past on a worked-out date of today, and says why', () => {
    const w = mountDrawer({
      result: {
        items: [
          // The day before tomorrow's activity is today, and 00:00 has always gone by.
          item('Pack the bag', { dueTime: '00:00' }),
          // On the activity day (tomorrow): still ahead, kept.
          item('Bring snacks', { dueTime: '23:59', timing: 'on_event_day' }),
        ],
      },
      eventSummary: { title: 'Field trip', date: addDaysYmd(localToday(), 1) },
      env: { sourceFile: null },
      primaryKind: 'event',
    });
    expect(
      w.findAllComponents({ name: 'TimePresetPicker' }).map((p) => p.props('modelValue'))
    ).toEqual(['', '23:59']);
    expect(loggedActions().filter((c) => c.message === 'due_time_dropped')).toEqual([
      expect.objectContaining({
        context: { action: 'due_time_dropped', detail: 'past_today', count: 1, stage: 'shared' },
      }),
    ]);
  });

  it('clears the time when the date is cleared', async () => {
    createTodos.mockImplementation(async (inputs: { id: string }[]) => inputs);
    const w = mountDrawer(timedReady());
    w.findAllComponents({ name: 'BeanieDatePicker' })[0]!.vm.$emit('update:modelValue', '');
    await nextTick();
    expect(w.findAllComponents({ name: 'TimePresetPicker' })).toHaveLength(0);

    // A new date does not bring the old time back.
    w.findAllComponents({ name: 'BeanieDatePicker' })[0]!.vm.$emit(
      'update:modelValue',
      '2030-10-01'
    );
    await nextTick();
    expect(w.findComponent({ name: 'TimePresetPicker' }).props('modelValue')).toBe('');

    await saveButton(w).trigger('click');
    await flushPromises();
    const inputs = createTodos.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(inputs[0]).toMatchObject({ dueDate: '2030-10-01' });
    expect(inputs[0]!.dueTime).toBeUndefined();
  });
});
