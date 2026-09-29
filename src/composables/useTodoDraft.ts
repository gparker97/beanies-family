/**
 * The draft behind a one-line "add a to-do" row (the Nook widget, the To-Dos page quick-add bar,
 * an activity's To-dos section, #114): its title, due date and assignees, and the `add` that
 * turns it into a to-do through `createTodoFrom`.
 *
 * What every row gets from this one place:
 *   - a double submit (Enter twice) while the first create is in flight writes once;
 *   - a stop (`null`: no author, or the store failed) keeps the whole draft, since it has
 *     already been toasted and the user can simply retry;
 *   - the inputs stay editable while a create is in flight, so after it succeeds only the fields
 *     still holding what was submitted are reset: anything typed or picked since belongs to the
 *     next to-do;
 *   - reset means back to `defaults()`, read at setup and after each success (a caller that must
 *     never offer a past date computes it from `localToday()` inside `defaults`);
 *   - `link()` is read only at submit, so it always reflects what the row is showing now.
 */
import { ref } from 'vue';
import { useTodoCreate, type TodoCreateSource } from '@/composables/useTodoCreate';
import type { ActivityLink } from '@/utils/activityLinks';
import type { TodoItem } from '@/types/models';

export interface TodoDraftDefaults {
  dueDate: string;
  assigneeIds: string[];
}

export interface TodoDraftOptions {
  source: TodoCreateSource;
  /** Who is creating, for the no-author diagnostics (`useAuthoringMember`). */
  callerTag: string;
  /** The due date and assignees a fresh draft starts with. Absent = none. */
  defaults?: () => TodoDraftDefaults;
  /** The activity (and session) the new to-do links to, read at submit. */
  link?: () => ActivityLink | null | undefined;
}

const EMPTY_DEFAULTS = (): TodoDraftDefaults => ({ dueDate: '', assigneeIds: [] });

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b.at(i));
}

export function useTodoDraft(options: TodoDraftOptions) {
  const { createTodoFrom } = useTodoCreate();
  const defaults = options.defaults ?? EMPTY_DEFAULTS;

  const initial = defaults();
  const title = ref('');
  const dueDate = ref(initial.dueDate);
  const assigneeIds = ref<string[]>([...initial.assigneeIds]);
  /** A create in flight: a second Enter (or tap) must not add the same to-do twice. */
  const isAdding = ref(false);

  /** Create the drafted to-do. Resolves to it, or `null` on any stop (already toasted). */
  async function add(): Promise<TodoItem | null> {
    if (isAdding.value || !title.value.trim()) return null;
    isAdding.value = true;
    // What was submitted. Anything typed or picked after this belongs to the NEXT to-do.
    const submitted = {
      title: title.value,
      dueDate: dueDate.value,
      assigneeIds: [...assigneeIds.value],
    };
    const link = options.link?.() ?? null;
    try {
      const created = await createTodoFrom(
        {
          ...submitted,
          ...(link ? { activityId: link.activityId, activityDate: link.activityDate } : {}),
        },
        options.callerTag,
        options.source
      );
      // null: already toasted; keep what was typed so it can be retried.
      if (!created) return null;
      const next = defaults();
      if (title.value === submitted.title) title.value = '';
      if (dueDate.value === submitted.dueDate) dueDate.value = next.dueDate;
      if (sameIds(assigneeIds.value, submitted.assigneeIds)) {
        assigneeIds.value = [...next.assigneeIds];
      }
      return created;
    } finally {
      isAdding.value = false;
    }
  }

  return { title, dueDate, assigneeIds, isAdding, add };
}
