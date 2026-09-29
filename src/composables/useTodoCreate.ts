/**
 * The one "create a to-do" sequence, shared by the To-Dos page's Add To-do sidebar, its
 * quick-add bar and the Family Nook widget: resolve who is adding it, build the payload
 * (`toCreateTodoInput`), write it (`todoStore.createTodo`).
 *
 * Every stop returns `null` and has already told the user: a missing author toasts here (via
 * `useAuthoringMember`), a failed write is toasted and reported by the store. Callers only
 * decide what to keep on screen (the draft) and never write `createdBy: ''`.
 *
 * A successful create is counted here, once per caller (`todo-create` / `created`, detail = the
 * `source`), so the create rate per surface is measurable against the store's failure reports.
 *
 * The magic beans review drawer saves in a batch (`createTodos`) but credits its to-dos through
 * the same `resolveTodoAuthor`, with its own plural toast. It logs its own confirm events, so it
 * is not counted here.
 */
import { useAuthoringMember } from '@/composables/useAuthoringMember';
import { logEvent } from '@/services/telemetry/logEvent';
import { useTodoStore } from '@/stores/todoStore';
import { toCreateTodoInput, type TodoCreateFields } from '@/utils/todo';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { TodoItem } from '@/types/models';

export const TODO_CREATE_SURFACE = 'todo-create';

/** Which single-to-do surface created it: the To-Dos page's sidebar or quick-add bar, or the Nook. */
export type TodoCreateSource = 'sidebar' | 'quick_bar' | 'nook';

interface NoAuthorToast {
  titleKey: UIStringKey;
  helpKey: UIStringKey;
}

/** The toast for a single new to-do with nobody to credit it to. */
const SINGLE_TODO_TOAST: NoAuthorToast = {
  titleKey: 'todo.error.noAuthor',
  helpKey: 'todo.error.noAuthorHelp',
};

export function useTodoCreate() {
  const todoStore = useTodoStore();
  const { resolveOrToast } = useAuthoringMember();

  /** Who a new to-do is credited to; `null` (already toasted) when nobody can be. */
  function resolveTodoAuthor(
    callerTag: string,
    toast: NoAuthorToast = SINGLE_TODO_TOAST
  ): string | null {
    return resolveOrToast({
      callerTag,
      toastTitleKey: toast.titleKey,
      toastHelpKey: toast.helpKey,
    });
  }

  /** Create one to-do from form fields; `null` on any stop (already toasted). */
  async function createTodoFrom(
    fields: TodoCreateFields,
    callerTag: string,
    source: TodoCreateSource
  ): Promise<TodoItem | null> {
    const author = resolveTodoAuthor(callerTag);
    if (!author) return null;
    const created = await todoStore.createTodo(toCreateTodoInput(fields, author));
    if (created) {
      logEvent({
        level: 'info',
        surface: TODO_CREATE_SURFACE,
        message: 'created',
        context: { action: 'created', detail: source },
      });
    }
    return created;
  }

  return { resolveTodoAuthor, createTodoFrom };
}
