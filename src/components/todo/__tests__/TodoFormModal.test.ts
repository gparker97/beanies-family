/**
 * The To-Dos page's "Add To-do" sidebar. What it must guarantee:
 *   - a titled to-do with who/date/time/notes is created in one call, counted as a sidebar
 *     create, and reported by id,
 *   - a failed create (store returned null) keeps the drawer and the draft,
 *   - a blank title never reaches the store; the tap marks the title instead,
 *   - no author means no write,
 *   - the time field only exists alongside a date, and clearing the date clears the time,
 *   - a double tap while saving writes once,
 *   - a save still in flight from an earlier open never reports into (or locks) a new one,
 *   - the Repeat switch (#123): its copy swaps when on, it seeds a date when there is none,
 *     clearing the date turns it off, a reopen resets it, and only an "on" switch sends a rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import TodoFormModal from '@/components/todo/TodoFormModal.vue';
import { logEvent } from '@/services/telemetry/logEvent';
import type { RecurrenceRule } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({ isDesktop: ref(false) }),
}));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: ref('2030-10-10') }) }));

const createTodo = vi.fn();
vi.mock('@/stores/todoStore', () => ({ useTodoStore: () => ({ createTodo }) }));

const resolveOrToast = vi.fn();
vi.mock('@/composables/useAuthoringMember', () => ({
  useAuthoringMember: () => ({ resolveOrToast }),
}));

/** Renders the body and a save button carrying the validation state, like the real footer. */
const BeanieFormModalStub = defineComponent({
  name: 'BeanieFormModal',
  props: { open: Boolean, saveReady: { type: Boolean, default: true } },
  emits: ['close', 'save'],
  setup(props, { slots, emit }) {
    return () =>
      props.open
        ? h('div', [
            slots.default?.(),
            h('button', {
              'data-test': 'save',
              'data-ready': String(props.saveReady),
              onClick: () => emit('save'),
            }),
          ])
        : null;
  },
});

const stubs = {
  BeanieFormModal: BeanieFormModalStub,
  MagicBeansQuickCard: true,
  FamilyChipPicker: true,
  BeanieDatePicker: true,
  TimePresetPicker: true,
  RecurrencePicker: true,
};

async function mountOpen() {
  const w = mount(TodoFormModal, { props: { open: false }, global: { stubs } });
  await w.setProps({ open: true });
  return w;
}

const save = (w: Awaited<ReturnType<typeof mountOpen>>) => w.find('[data-test="save"]');
const pick = (w: Awaited<ReturnType<typeof mountOpen>>, name: string, value: unknown) =>
  w.findComponent({ name }).vm.$emit('update:modelValue', value);

beforeEach(() => {
  vi.clearAllMocks();
  resolveOrToast.mockReturnValue('m-greg');
  createTodo.mockResolvedValue({ id: 'todo-new' });
});

describe('TodoFormModal', () => {
  it('creates the to-do with every field and emits its id', async () => {
    const w = await mountOpen();
    await w.find('input').setValue('  Sign the slip ');
    await w.find('textarea').setValue('Due at the office');
    await pick(w, 'FamilyChipPicker', ['m-leo']);
    await pick(w, 'BeanieDatePicker', '2030-10-13');
    await pick(w, 'TimePresetPicker', '08:30');

    await save(w).trigger('click');
    await flushPromises();

    expect(createTodo).toHaveBeenCalledWith({
      title: 'Sign the slip',
      description: 'Due at the office',
      dueDate: '2030-10-13',
      dueTime: '08:30',
      assigneeIds: ['m-leo'],
      assigneeId: 'm-leo',
      completed: false,
      createdBy: 'm-greg',
    });
    expect(w.emitted('created')).toEqual([['todo-new']]);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'todo-create',
        context: { action: 'created', detail: 'sidebar' },
      })
    );
  });

  it('keeps the drawer and the draft when the create fails', async () => {
    createTodo.mockResolvedValue(null);
    const w = await mountOpen();
    await w.find('input').setValue('Sign the slip');

    await save(w).trigger('click');
    await flushPromises();

    expect(createTodo).toHaveBeenCalledTimes(1);
    expect(w.emitted('created')).toBeUndefined();
    expect(w.emitted('close')).toBeUndefined();
    expect((w.find('input').element as HTMLInputElement).value).toBe('Sign the slip');
  });

  it('shows not ready with a blank title, and a tap marks the title instead of saving', async () => {
    const w = await mountOpen();
    await w.find('input').setValue('   ');
    expect(save(w).attributes('data-ready')).toBe('false');

    await save(w).trigger('click');
    await flushPromises();

    expect(createTodo).not.toHaveBeenCalled();
    expect(w.text()).toContain('validation.required');
  });

  it('writes nothing when there is no author', async () => {
    resolveOrToast.mockReturnValue(null);
    const w = await mountOpen();
    await w.find('input').setValue('Sign the slip');

    await save(w).trigger('click');
    await flushPromises();

    expect(createTodo).not.toHaveBeenCalled();
    expect(w.emitted('created')).toBeUndefined();
  });

  it('only offers a time once there is a date', async () => {
    const w = await mountOpen();
    expect(w.findComponent({ name: 'TimePresetPicker' }).exists()).toBe(false);

    await pick(w, 'BeanieDatePicker', '2030-10-13');
    expect(w.findComponent({ name: 'TimePresetPicker' }).exists()).toBe(true);
  });

  it('writes once when Save is tapped twice while saving', async () => {
    let finish: (v: unknown) => void = () => {};
    createTodo.mockReturnValue(new Promise((r) => (finish = r)));
    const w = await mountOpen();
    await w.find('input').setValue('Sign the slip');

    await save(w).trigger('click');
    await save(w).trigger('click');
    finish({ id: 'todo-new' });
    await flushPromises();

    expect(createTodo).toHaveBeenCalledTimes(1);
    expect(w.emitted('created')).toEqual([['todo-new']]);
  });

  it('starts blank on every open', async () => {
    const w = await mountOpen();
    await w.find('input').setValue('Old draft');
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    expect((w.find('input').element as HTMLInputElement).value).toBe('');
  });

  it('clears the time with the date, so an old time never returns with a new date', async () => {
    const w = await mountOpen();
    await w.find('input').setValue('Sign the slip');
    await pick(w, 'BeanieDatePicker', '2030-10-13');
    await pick(w, 'TimePresetPicker', '08:30');

    await pick(w, 'BeanieDatePicker', '');
    await pick(w, 'BeanieDatePicker', '2030-10-14');
    await save(w).trigger('click');
    await flushPromises();

    expect(createTodo).toHaveBeenCalledTimes(1);
    expect(createTodo.mock.calls[0]![0]).toMatchObject({ dueDate: '2030-10-14' });
    expect(createTodo.mock.calls[0]![0]).not.toHaveProperty('dueTime');
  });

  it('ignores a save from an earlier open: no created, and the new draft can still save', async () => {
    let finishOld: (v: unknown) => void = () => {};
    createTodo.mockReturnValueOnce(new Promise((r) => (finishOld = r)));
    const w = await mountOpen();
    await w.find('input').setValue('Old draft');
    await save(w).trigger('click');

    // Closed and reopened while the first write is still in flight.
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    await w.find('input').setValue('New draft');

    // Save is not locked by the first write, which is still in flight.
    await save(w).trigger('click');
    await flushPromises();
    expect(createTodo).toHaveBeenCalledTimes(2);
    expect(createTodo.mock.calls[1]![0]).toMatchObject({ title: 'New draft' });

    // The first write lands late: that to-do exists, but it reports nothing into this open.
    finishOld({ id: 'todo-old' });
    await flushPromises();
    expect(w.emitted('created')).toEqual([['todo-new']]);
  });
});

describe('TodoFormModal: Repeat (#123)', () => {
  // 2030-10-13 is a Sunday.
  const WEEKLY_SUN: RecurrenceRule = {
    unit: 'week',
    interval: 1,
    weekdays: [0],
    end: { kind: 'never' },
  };
  const toggle = (w: Awaited<ReturnType<typeof mountOpen>>) =>
    w.find('[data-testid="todo-repeat-toggle"]');
  const picker = (w: Awaited<ReturnType<typeof mountOpen>>) =>
    w.findComponent({ name: 'RecurrencePicker' });

  it('reads as a quiet row when off, and as "Create a Repeating Family Reminder" when on', async () => {
    const w = await mountOpen();
    expect(w.text()).toContain('todo.repeat.toggle');
    expect(w.text()).toContain('todo.repeat.toggleHintOff');
    expect(picker(w).exists()).toBe(false);

    await toggle(w).trigger('click');
    expect(w.text()).toContain('todo.repeat.createTitle');
    expect(w.text()).toContain('todo.repeat.createHint');
    expect(picker(w).exists()).toBe(true);
    expect(picker(w).props()).toMatchObject({ accent: 'purple', defaultCadence: 'weekly' });
  });

  it('turning it on with no date starts today, and the picker anchors on the due date + time', async () => {
    const w = await mountOpen();
    await toggle(w).trigger('click');
    expect(picker(w).props('startDate')).toBe('2030-10-10');
    expect(w.findComponent({ name: 'BeanieDatePicker' }).props('modelValue')).toBe('2030-10-10');

    await pick(w, 'BeanieDatePicker', '2030-10-13');
    await pick(w, 'TimePresetPicker', '20:00');
    expect(picker(w).props()).toMatchObject({ startDate: '2030-10-13', time: '20:00' });
  });

  it('clearing the date turns the repeat off', async () => {
    const w = await mountOpen();
    await pick(w, 'BeanieDatePicker', '2030-10-13');
    await toggle(w).trigger('click');
    expect(picker(w).exists()).toBe(true);

    await pick(w, 'BeanieDatePicker', '');
    expect(picker(w).exists()).toBe(false);
    expect(w.text()).toContain('todo.repeat.toggle');
  });

  it('a reopened form starts with the repeat off', async () => {
    const w = await mountOpen();
    await toggle(w).trigger('click');
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    expect(picker(w).exists()).toBe(false);
    expect(w.text()).toContain('todo.repeat.toggleHintOff');
  });

  it('creates a repeating to-do anchored on its due date when on, and a plain one when off', async () => {
    const w = await mountOpen();
    await w.find('input').setValue('Put the trash out');
    await pick(w, 'BeanieDatePicker', '2030-10-13');
    await toggle(w).trigger('click');
    await picker(w).vm.$emit('update:modelValue', WEEKLY_SUN);

    await save(w).trigger('click');
    await flushPromises();
    expect(createTodo.mock.calls[0]![0]).toMatchObject({
      dueDate: '2030-10-13',
      repeat: { rule: WEEKLY_SUN, anchor: '2030-10-13' },
      repeatLog: [],
    });

    // Off again: the rule the picker emitted is not sent.
    await toggle(w).trigger('click');
    await save(w).trigger('click');
    await flushPromises();
    expect(createTodo.mock.calls[1]![0]).not.toHaveProperty('repeat');
  });
});
