import { ref, watch, type Ref } from 'vue';

/**
 * A `ref` that remembers its value on THIS device, for small closed-set UI preferences —
 * a sort mode, a group axis, a chosen tab.
 *
 * Extracted from `useTodoSort`, which was the right pattern in the wrong shape: its storage
 * key, its allowed values and its default were all baked in, so the cookbook's sort AND group
 * preferences would have made three copies of the same fifteen lines of graceful degradation.
 *
 * ⚠️ Device-local (`localStorage`), NOT family-shared Automerge settings. Each member sorts
 * their own view; syncing a sort order would mean one person's tap re-ordering another
 * person's screen mid-scroll. Anything that belongs to the FAMILY belongs in the doc instead.
 *
 * Storage is best-effort and never fatal. A missing value, a corrupt value, a value no longer
 * in `allowed` (a removed sort mode), or a `localStorage` that throws outright (private mode,
 * quota, a browser blocking site data) all degrade to `fallback` with a `console.warn`. Never
 * a silent failure, never a crash — losing a sort preference is not worth an error screen.
 *
 * Every warn NAMES THE KEY. A generic helper warning "could not read preference" is
 * undiagnosable without a stack trace, which would be a regression on the named-composable
 * warns this replaces.
 *
 * @param key      the `localStorage` key, e.g. `'beanies:cookbookSort'`
 * @param allowed  every valid value — also the validator for what comes back out of storage
 * @param fallback the value used when nothing valid is stored
 */
export function usePersistedChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): Ref<T> {
  const tag = `[usePersistedChoice:${key}]`;

  const isAllowed = (value: unknown): value is T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value);

  function read(): T {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return fallback;
      if (isAllowed(stored)) return stored;
      console.warn(
        `${tag} ignoring invalid stored value "${stored}" — falling back to "${fallback}"`
      );
      return fallback;
    } catch (err) {
      console.warn(`${tag} could not read preference — falling back to "${fallback}":`, err);
      return fallback;
    }
  }

  function write(value: T): void {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.warn(
        `${tag} could not persist preference "${value}" (it will not survive a reload):`,
        err
      );
    }
  }

  const choice = ref(read()) as Ref<T>;
  watch(choice, write);
  return choice;
}
