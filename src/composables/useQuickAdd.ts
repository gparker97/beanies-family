/**
 * Global singleton for the Quick-add FAB sheet.
 *
 * Mirrors the pattern used by `useConfirm` / `useToast` / `useDoseConfirm`:
 * - Module-level reactive state shared across all callers
 * - Public functions (`openQuickAdd`, `closeQuickAdd`, `toggleQuickAdd`,
 *   `triggerQuickAddAction`) usable from anywhere
 * - Composable `useQuickAdd()` returning a read-only view + the public
 *   functions for components that want reactivity
 *
 * `buildIntentQuery` is exported so it can be unit-tested without
 * mounting a router — it's a pure function of (item, route, override).
 *
 * Sheet state is a small state machine:
 *   main            — user sees the grid of 19 items
 *   picker(item)    — user tapped a context-required item without
 *                      matching context; the sheet shows a picker for
 *                      the parent id (member / recipe / medication).
 *                      On commit, the picker's resolved id is passed
 *                      back through `buildIntentQuery`'s override
 *                      argument and navigation proceeds.
 */
import { computed, ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import router from '@/router';
import { hasOpenOverlays } from '@/utils/overlayStack';
import type { QuickAddContextKey, QuickAddItem } from '@/constants/quickAddItems';

// --- Module singleton state ------------------------------------------------

/** Sheet-open flag. `main` vs `picker` is tracked by `stage`, not here. */
const isOpen = ref(false);

export type QuickAddStage = { mode: 'main' } | { mode: 'picker'; pending: QuickAddItem };

const stage = ref<QuickAddStage>({ mode: 'main' });

// --- Open / close / toggle ------------------------------------------------

/**
 * Open the sheet in `main` mode. No-ops when another overlay already
 * has focus — stacking the sheet on top of a modal would produce
 * confusing focus ordering and double-backdrop stacking.
 */
export function openQuickAdd(): void {
  if (hasOpenOverlays()) return;
  stage.value = { mode: 'main' };
  isOpen.value = true;
}

export function closeQuickAdd(): void {
  isOpen.value = false;
  stage.value = { mode: 'main' };
}

export function toggleQuickAdd(): void {
  if (isOpen.value) {
    closeQuickAdd();
  } else {
    openQuickAdd();
  }
}

// --- Intent query construction (pure) --------------------------------------

/**
 * Build the query dict for an item tap.
 *
 * Pure. Two ways to supply the parent id for a context-required item:
 * - Omit `override` — the helper pulls from `route.params` (the
 *   "user is on the parent's detail page" path).
 * - Pass `override` with the context key set — the helper uses that
 *   value (the picker-commit path).
 *
 * If neither source has the id, the query is returned without it and
 * callers upstream (`triggerQuickAddAction`) decide whether to route
 * anyway or branch to the picker.
 */
export function buildIntentQuery(
  item: QuickAddItem,
  route: RouteLocationNormalizedLoaded,
  override?: Partial<Record<QuickAddContextKey, string>>
): Record<string, string> {
  const query: Record<string, string> = { action: item.action };
  if (item.tab) query.tab = item.tab;
  if (item.contextKey) {
    const fromOverride = override?.[item.contextKey];
    const fromParams = route.params[item.contextKey];
    const resolved =
      typeof fromOverride === 'string' && fromOverride
        ? fromOverride
        : typeof fromParams === 'string' && fromParams
          ? fromParams
          : null;
    if (resolved) query[item.contextKey] = resolved;
  }
  return query;
}

// --- Navigation (internal) -------------------------------------------------

/**
 * Run the actual vue-router navigation for a resolved intent. Same-
 * route taps replace (no history churn — no stack of identical routes
 * behind you as you add things from one page). Cross-route taps push.
 *
 * Runs OUTSIDE `setup()` (click handler / picker-commit context), so
 * we use the imported router singleton rather than `useRouter()`.
 * Navigation errors (cancelled, duplicate) are `console.warn`-ed —
 * they're expected and not user-facing failures.
 */
function navigateToIntent(item: QuickAddItem, query: Record<string, string>): void {
  const route = router.currentRoute.value;
  const sameRoute = route.path === item.route;
  const go = sameRoute ? router.replace : router.push;
  go.call(router, { path: item.route, query }).catch((err: unknown) => {
    console.warn('[useQuickAdd] navigation swallowed:', err);
  });
}

/** True when `item.contextKey` is set but the current route doesn't supply it. */
function needsPicker(item: QuickAddItem): boolean {
  if (!item.contextKey) return false;
  const value = router.currentRoute.value.params[item.contextKey];
  return !(typeof value === 'string' && value);
}

// --- Public dispatch ------------------------------------------------------

/**
 * Dispatch an item tap.
 *
 * - If the item requires context (`contextKey` set) and the current
 *   route doesn't supply it, transition to the picker stage instead
 *   of navigating. The sheet stays open; the picker shows a list of
 *   candidate parents for the user to pick.
 * - Otherwise, close the sheet and navigate to `item.route` with the
 *   intent (+ any context from route params) in the query string.
 */
export function triggerQuickAddAction(item: QuickAddItem): void {
  if (needsPicker(item)) {
    stage.value = { mode: 'picker', pending: item };
    return;
  }
  closeQuickAdd();
  const query = buildIntentQuery(item, router.currentRoute.value);
  navigateToIntent(item, query);
}

/**
 * Called by `QuickAddPicker` when the user picks a parent. Builds the
 * intent with the resolved context id and navigates. Resets stage to
 * `main` via `closeQuickAdd` before navigating so the sheet doesn't
 * flash the picker view during the route change.
 *
 * Defensive: if called from outside a picker stage (shouldn't happen
 * in practice), no-ops silently.
 */
export function commitPickerSelection(contextId: string): void {
  if (stage.value.mode !== 'picker') return;
  const item = stage.value.pending;
  const contextKey = item.contextKey;
  if (!contextKey) {
    // Picker was opened for an item with no contextKey — not possible
    // via `triggerQuickAddAction`, but guard defensively.
    console.error(
      `[useQuickAdd] commitPickerSelection called for item "${item.id}" with no contextKey`
    );
    closeQuickAdd();
    return;
  }
  const query = buildIntentQuery(item, router.currentRoute.value, {
    [contextKey]: contextId,
  });
  closeQuickAdd();
  navigateToIntent(item, query);
}

/** Return from picker view to the main item grid. */
export function cancelPicker(): void {
  stage.value = { mode: 'main' };
}

// --- Composable ----------------------------------------------------------

/**
 * Composable returning reactive state + public functions. Components
 * should prefer this over importing the module-level helpers directly,
 * so `isOpen` and `stage` stay read-only at the call site.
 */
export function useQuickAdd() {
  return {
    isOpen: computed(() => isOpen.value),
    stage: computed(() => stage.value),
    open: openQuickAdd,
    close: closeQuickAdd,
    toggle: toggleQuickAdd,
    triggerAction: triggerQuickAddAction,
    commitPicker: commitPickerSelection,
    cancelPicker,
  };
}
