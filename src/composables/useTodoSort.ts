import type { Ref } from 'vue';
import { usePersistedChoice } from '@/composables/usePersistedChoice';
import type { TodoSort } from '@/types/models';

/**
 * Device-local, per-person preference for how the Family To-Do list is sorted.
 *
 * Persisted to localStorage — NOT the family-shared Automerge settings, because
 * each member sorts their own view. Defaults to `'dueDate'` so the most
 * time-sensitive tasks lead; an explicit choice is remembered across reloads
 * and navigation.
 *
 * Storage is best-effort: a missing/corrupt value, or a localStorage that
 * throws (private mode / quota), degrades gracefully to the in-memory default
 * with a `console.warn` — never a silent failure, never a crash. That behaviour
 * now lives in `usePersistedChoice`, which this composable is a thin, typed
 * wrapper around; the cookbook needs two of the same thing, and a third copy of
 * the degradation logic is what this extraction avoids.
 */
const STORAGE_KEY = 'beanies:todoSort';

/** Valid sort modes, in display order. Single source of truth for the menu,
 *  the default, and persisted-value validation. */
export const TODO_SORTS = ['dueDate', 'newest', 'oldest'] as const;

const DEFAULT_SORT: TodoSort = 'dueDate';

export interface TodoSortOption {
  value: TodoSort;
  /** uiStrings key for the option's label. */
  labelKey: 'todo.sort.dueDate' | 'todo.sort.newest' | 'todo.sort.oldest';
  /** Decorative leading glyph shown in the menu. */
  icon: string;
}

/** Rendered, in order, by `TodoSortMenu`. */
export const SORT_OPTIONS: readonly TodoSortOption[] = [
  { value: 'dueDate', labelKey: 'todo.sort.dueDate', icon: '📅' },
  { value: 'newest', labelKey: 'todo.sort.newest', icon: '↓' },
  { value: 'oldest', labelKey: 'todo.sort.oldest', icon: '↑' },
];

/**
 * Returns a reactive `sortBy` ref initialised from the persisted preference
 * (default `'dueDate'`). The ref is the single write path. One consumer today
 * (the To-Do page); if a second surface ever needs the shared preference, hoist
 * the ref to module scope as a singleton.
 */
export function useTodoSort(): { sortBy: Ref<TodoSort> } {
  return { sortBy: usePersistedChoice<TodoSort>(STORAGE_KEY, TODO_SORTS, DEFAULT_SORT) };
}
