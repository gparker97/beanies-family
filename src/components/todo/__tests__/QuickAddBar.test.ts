/**
 * The quick-add bar (To-Dos page, an activity's To-dos section). What it must guarantee:
 *   - it creates the to-do itself and emits `created` with it (the host only reveals it),
 *   - a stop (nobody to credit, or a failed write) keeps what was typed and emits nothing,
 *     and never writes `createdBy: ''`,
 *   - it starts from `defaults` and writes its `link` with the to-do,
 *   - the inline variant stays one slim line until engaged, then shows its pickers and hint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import QuickAddBar from '@/components/todo/QuickAddBar.vue';
import { showToast } from '@/composables/useToast';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const createTodo = vi.fn();
vi.mock('@/stores/todoStore', () => ({ useTodoStore: () => ({ createTodo }) }));

/** The real resolver's toast path, reduced to its contract: no member → toast + null. */
const member = { id: 'm-greg' as string | null };
vi.mock('@/composables/useAuthoringMember', async () => {
  const { showToast: toast } = await import('@/composables/useToast');
  return {
    useAuthoringMember: () => ({
      resolveOrToast: (o: { toastTitleKey: string; toastHelpKey: string }) => {
        if (member.id) return member.id;
        toast('error', o.toastTitleKey, o.toastHelpKey);
        return null;
      },
    }),
  };
});

type Props = InstanceType<typeof QuickAddBar>['$props'];

function mountBar(props: Partial<Props> = {}) {
  return mount(QuickAddBar, {
    props: { source: 'quick_bar', callerTag: 'test', ...props } as Props,
    global: { stubs: { BeanieDatePicker: true, AssigneePickerButton: true } },
  });
}

const input = (w: ReturnType<typeof mountBar>) => w.find('input');
const enter = (w: ReturnType<typeof mountBar>) => input(w).trigger('keydown', { key: 'Enter' });

beforeEach(() => {
  vi.clearAllMocks();
  member.id = 'm-greg';
  createTodo.mockResolvedValue({ id: 'todo-new', title: 'Pack the lunch' });
});

describe('QuickAddBar', () => {
  it('creates the to-do, emits it, and clears the title', async () => {
    const w = mountBar();
    await input(w).setValue('Pack the lunch');
    await enter(w);
    await flushPromises();

    expect(createTodo).toHaveBeenCalledWith({
      title: 'Pack the lunch',
      completed: false,
      createdBy: 'm-greg',
    });
    expect(w.emitted('created')).toEqual([[{ id: 'todo-new', title: 'Pack the lunch' }]]);
    expect((input(w).element as HTMLInputElement).value).toBe('');
  });

  it('stops with nobody to credit: no write, a toast, nothing emitted, the title kept', async () => {
    member.id = null;
    const w = mountBar();
    await input(w).setValue('Pack the lunch');
    await enter(w);
    await flushPromises();

    expect(createTodo).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'todo.error.noAuthor',
      'todo.error.noAuthorHelp'
    );
    expect(w.emitted('created')).toBeUndefined();
    expect((input(w).element as HTMLInputElement).value).toBe('Pack the lunch');
  });

  it('keeps the title when the write fails', async () => {
    createTodo.mockResolvedValue(null);
    const w = mountBar();
    await input(w).setValue('Pack the lunch');
    await enter(w);
    await flushPromises();

    expect(w.emitted('created')).toBeUndefined();
    expect((input(w).element as HTMLInputElement).value).toBe('Pack the lunch');
  });

  it('starts from its defaults and writes its link', async () => {
    const w = mountBar({
      source: 'activity',
      variant: 'inline',
      defaults: () => ({ dueDate: '2030-10-09', assigneeIds: ['m-greg'] }),
      link: { activityId: 'series-1', activityDate: '2030-10-10' },
    });
    await input(w).setValue('Sign the form');
    await enter(w);
    await flushPromises();

    expect(createTodo).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Sign the form',
        dueDate: '2030-10-09',
        activityId: 'series-1',
        activityDate: '2030-10-10',
      })
    );
  });

  it('shows its pickers in the composer, and in the inline row only once engaged', async () => {
    expect(mountBar().findAllComponents({ name: 'BeanieDatePicker' }).length).toBeGreaterThan(0);

    const w = mountBar({ variant: 'inline', placeholder: 'Add a to-do', hint: 'Links to it' });
    expect(input(w).attributes('placeholder')).toBe('Add a to-do');
    expect(w.findAllComponents({ name: 'BeanieDatePicker' })).toHaveLength(0);
    expect(w.find('[data-testid="quick-add-hint"]').exists()).toBe(false);

    await input(w).trigger('focusin');
    expect(w.findAllComponents({ name: 'BeanieDatePicker' }).length).toBeGreaterThan(0);
    expect(w.find('[data-testid="quick-add-hint"]').text()).toBe('Links to it');
  });

  it('exposes focus for the page to call', () => {
    const w = mountBar();
    expect(typeof (w.vm as unknown as { focus: () => void }).focus).toBe('function');
  });
});
