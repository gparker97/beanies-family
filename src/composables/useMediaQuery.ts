import { onScopeDispose, readonly, ref, type Ref } from 'vue';

/**
 * A reactive media query, released with the owning scope.
 *
 * `BeanieWallPage` carried two hand-rolled copies of this — the room gate and the
 * orientation test — each spelling out the same query/listener/dispose triple, and
 * the days-view rail threshold would have made a THIRD in one file. Three copies of
 * a pattern whose failure mode is a forgotten `removeEventListener` is exactly the
 * kind of thing that should be structural rather than remembered.
 *
 * Reactive rather than a setup-time snapshot, because that distinction is
 * load-bearing on the wall: a snapshot meant rotating a mounted tablet kept the
 * landscape layout until someone reloaded it.
 *
 * SSR/jsdom-safe: with no `matchMedia` the ref holds `initial` forever and nothing
 * is registered, so there is nothing to release either. `initial` is a parameter
 * rather than a hardcoded `false` because the honest default differs per query —
 * "does this screen have room" wants `true` (assume capable, correct on the first
 * real measurement), "is this portrait" wants `false`.
 *
 * ⚠️ Deliberately NOT adopted by `usePWA`, `useReducedMotion`, `useIsTouchPrimary`
 * or `useBreakpoint`. Each of those is a module-scoped singleton whose listener is
 * meant to live for the life of the app; moving them onto a scope-disposing helper
 * would silently unregister them when whichever component happened to instantiate
 * them first went away. That is a separate, riskier change.
 */
export function useMediaQuery(query: string, initial = false): Readonly<Ref<boolean>> {
  const list = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null;

  const matches = ref(list?.matches ?? initial);
  if (!list) return readonly(matches);

  const onChange = (event: MediaQueryListEvent) => {
    matches.value = event.matches;
  };
  list.addEventListener('change', onChange);
  onScopeDispose(() => list.removeEventListener('change', onChange));

  return readonly(matches);
}
