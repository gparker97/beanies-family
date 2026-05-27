import { computed, ref, type ComputedRef } from 'vue';
import { useRoute } from 'vue-router';
import { useBreakpoint } from '@/composables/useBreakpoint';

/**
 * Mobile hamburger-menu open state + the "planner reclaimed the top bar"
 * predicate — both shared so the global `AppHeader` and the planner's
 * `CalendarCommandBar` can never disagree.
 *
 * `isOpen` is a module-level singleton (mirrors `useBreakpoint`'s pattern), so
 * any component can toggle the same `MobileHamburgerMenu` without prop-drilling
 * through the page. Before this, App.vue owned a local `isMenuOpen` ref and
 * `AppHeader` reached it via a `toggle-menu` emit — which the deep-in-the-page
 * command bar could not use.
 */
const isOpen = ref(false);

export function useMobileMenu() {
  return {
    isOpen,
    open: (): void => {
      isOpen.value = true;
    },
    close: (): void => {
      isOpen.value = false;
    },
    toggle: (): void => {
      isOpen.value = !isOpen.value;
    },
  };
}

/**
 * Single source of truth for "the Family Planner has reclaimed the top bar":
 * on the `Activities` route at the phone breakpoint, App.vue hides the global
 * `AppHeader` and the `CalendarCommandBar` becomes the flush top bar (hosting
 * its own hamburger + search). Defined ONCE here so App.vue's
 * `v-if="!headerReclaimed"` and the command bar's affordance gating cannot
 * drift — a mismatch would either strand the menu (no way to open it) or paint
 * two headers. Must be called in component setup (it uses `useRoute`).
 *
 * Scoped to phones (`isMobile`, ≤767px) only — tablet (768–1023px) is not
 * space-starved, keeps its standard AppHeader, and avoids the command bar's
 * `sm:`-breakpoint (640px) layout colliding with a tablet reclaim.
 */
export function useHeaderReclaimed(): ComputedRef<boolean> {
  const route = useRoute();
  const { isMobile } = useBreakpoint();
  return computed(() => isMobile.value && route.name === 'Activities');
}
