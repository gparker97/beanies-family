/**
 * The Family Nook to-do widget's quick add. What it must guarantee:
 *   - a double Enter while the first create is in flight writes once,
 *   - no author means no write, and what was typed stays,
 *   - a failed create (store returned null) keeps what was typed,
 *   - a created to-do clears the inputs it was made from, and is counted as a Nook create,
 *   - anything typed or picked while that create was in flight is the next to-do's, and stays.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import NookTodoWidget from '@/components/nook/NookTodoWidget.vue';
import { logEvent } from '@/services/telemetry/logEvent';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const createTodo = vi.fn();
vi.mock('@/stores/todoStore', () => ({
  useTodoStore: () => ({ createTodo, filteredActiveTodos: [], todos: [] }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: { id: 'm-greg' } }),
}));

const resolveOrToast = vi.fn();
vi.mock('@/composables/useAuthoringMember', () => ({
  useAuthoringMember: () => ({ resolveOrToast }),
}));

/** Renders both slots, like the real card. */
const NookSectionCardStub = defineComponent({
  name: 'NookSectionCard',
  setup(_, { slots }) {
    return () => h('section', [slots['header-right']?.(), slots.default?.()]);
  },
});

function mountWidget() {
  return mount(NookTodoWidget, {
    global: {
      stubs: {
        NookSectionCard: NookSectionCardStub,
        TodoViewEditModal: true,
        TodoItemRow: true,
        AssigneePickerButton: true,
        BeanieDatePicker: true,
        RouterLink: true,
      },
    },
  });
}

const input = (w: ReturnType<typeof mountWidget>) => w.find('input');
const enter = (w: ReturnType<typeof mountWidget>) => input(w).trigger('keydown', { key: 'Enter' });
/** Every copy of a picker (the widget draws one for desktop and one for mobile). */
const pickers = (w: ReturnType<typeof mountWidget>, name: string) => w.findAllComponents({ name });
async function pick(w: ReturnType<typeof mountWidget>, name: string, value: unknown) {
  pickers(w, name)[0]!.vm.$emit('update:modelValue', value);
  await flushPromises();
}
const pickerValues = (w: ReturnType<typeof mountWidget>, name: string) =>
  pickers(w, name).map((p) => p.props('modelValue'));

beforeEach(() => {
  vi.clearAllMocks();
  resolveOrToast.mockReturnValue('m-greg');
  createTodo.mockResolvedValue({ id: 'todo-new' });
});

describe('NookTodoWidget quick add', () => {
  it('writes once when Enter is pressed twice while saving', async () => {
    let finish: (v: unknown) => void = () => {};
    createTodo.mockReturnValue(new Promise((r) => (finish = r)));
    const w = mountWidget();
    await input(w).setValue('Pack the lunch');

    await enter(w);
    await enter(w);
    finish({ id: 'todo-new' });
    await flushPromises();

    expect(createTodo).toHaveBeenCalledTimes(1);
    expect(createTodo).toHaveBeenCalledWith({
      title: 'Pack the lunch',
      completed: false,
      createdBy: 'm-greg',
    });
  });

  it('writes nothing and keeps what was typed when there is no author', async () => {
    resolveOrToast.mockReturnValue(null);
    const w = mountWidget();
    await input(w).setValue('Pack the lunch');

    await enter(w);
    await flushPromises();

    expect(createTodo).not.toHaveBeenCalled();
    expect((input(w).element as HTMLInputElement).value).toBe('Pack the lunch');
  });

  it('keeps what was typed when the create fails', async () => {
    createTodo.mockResolvedValue(null);
    const w = mountWidget();
    await input(w).setValue('Pack the lunch');

    await enter(w);
    await flushPromises();

    expect(createTodo).toHaveBeenCalledTimes(1);
    expect((input(w).element as HTMLInputElement).value).toBe('Pack the lunch');
  });

  it('clears the inputs once the to-do is created, and can add another', async () => {
    const w = mountWidget();
    await input(w).setValue('Pack the lunch');
    await pick(w, 'BeanieDatePicker', '2030-10-13');
    await pick(w, 'AssigneePickerButton', ['m-leo']);

    await enter(w);
    await flushPromises();
    expect((input(w).element as HTMLInputElement).value).toBe('');
    expect(pickerValues(w, 'BeanieDatePicker')).toEqual(['', '']);
    expect(pickerValues(w, 'AssigneePickerButton')).toEqual([[], []]);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'todo-create',
        context: { action: 'created', detail: 'nook' },
      })
    );

    await input(w).setValue('Book the dentist');
    await enter(w);
    await flushPromises();
    expect(createTodo).toHaveBeenCalledTimes(2);
  });

  it('keeps what was typed and picked during an in-flight create for the next to-do', async () => {
    let finish: (v: unknown) => void = () => {};
    createTodo.mockReturnValue(new Promise((r) => (finish = r)));
    const w = mountWidget();
    await input(w).setValue('Pack the lunch');
    await pick(w, 'AssigneePickerButton', ['m-leo']);
    await enter(w);

    // Typed while the first is still saving; this Enter is dropped by the in-flight guard.
    await input(w).setValue('Book the dentist');
    await pick(w, 'BeanieDatePicker', '2030-10-13');
    await enter(w);
    finish({ id: 'todo-new' });
    await flushPromises();

    expect(createTodo).toHaveBeenCalledTimes(1);
    expect((input(w).element as HTMLInputElement).value).toBe('Book the dentist');
    expect(pickerValues(w, 'BeanieDatePicker')).toEqual(['2030-10-13', '2030-10-13']);
    // Unchanged since the submit, so it went with the first to-do and is cleared.
    expect(pickerValues(w, 'AssigneePickerButton')).toEqual([[], []]);
  });
});
