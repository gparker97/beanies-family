import { readonly, ref } from 'vue';

/**
 * Is the app currently painting dark? — as a REACTIVE signal.
 *
 * The `dark` class on `<html>` is the app's single source of truth for theme, but it has
 * two writers: `settingsStore`'s theme watcher (which resolves `light | dark | system`)
 * and the FOUC-prevention bootstrap in `index.html` that runs before Vue exists. Anything
 * wanting to re-render on a theme change therefore cannot subscribe to the store alone,
 * and reading `classList` directly is not reactive at all — a plain read inside a render
 * function is a snapshot that Vue has no reason to ever re-evaluate.
 *
 * That is exactly how the planner's colour washes froze: `useActivityIdentity` derived
 * every wash alpha from a `classList.contains('dark')` call, no chip component had any
 * other theme dependency, and so switching to dark left every already-painted chip at the
 * light alpha — most visibly on the kitchen wall, which never unmounts and so never
 * self-heals (#78 review).
 *
 * A `MutationObserver` on the class attribute is the right seam because it is agnostic
 * about WHO set the class: bootstrap, store, or a future writer all reach it.
 */

const isDark = ref(
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
);

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  // Module scope on purpose: one observer for the whole app, never torn down. It outlives
  // every component that reads it, and `<html>` outlives the app.
  new MutationObserver(() => {
    const next = document.documentElement.classList.contains('dark');
    if (next !== isDark.value) isDark.value = next;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

export function useDarkMode() {
  return { isDark: readonly(isDark) };
}

/**
 * The current theme, read LIVE, in a way that also subscribes the caller.
 *
 * Both halves matter and neither alone is enough. Touching `isDark.value` registers the
 * dependency, so a reactive caller re-runs when the class changes. But returning that ref
 * would be a tick stale: `MutationObserver` delivers on a microtask, so code that sets the
 * class and reads back synchronously — `settingsStore`'s theme watcher, and every test
 * that toggles the class inline — would see the previous value. The `classList` read is
 * therefore the source of truth, and the ref is only the change signal.
 */
export function isDarkNow(): boolean {
  void isDark.value;
  return typeof document !== 'undefined'
    ? document.documentElement.classList.contains('dark')
    : isDark.value;
}
