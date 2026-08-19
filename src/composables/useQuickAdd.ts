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
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import { QUICK_ADD_ITEMS } from '@/constants/quickAddItems';
import type { QuickAddContextKey, QuickAddItem } from '@/constants/quickAddItems';

/** Action ID type — derived from QUICK_ADD_ITEMS so it's automatically up-to-date. */
export type QuickAddAction = (typeof QUICK_ADD_ITEMS)[number]['action'];

// --- Module singleton state ------------------------------------------------

/** Sheet-open flag. `main` vs `picker` is tracked by `stage`, not here. */
const isOpen = ref(false);

export type QuickAddStage = { mode: 'main' } | { mode: 'picker'; pending: QuickAddItem };

const stage = ref<QuickAddStage>({ mode: 'main' });

/**
 * When set, only items whose `action` is in this list render in the sheet.
 * Used by consolidation pages (Family Scrapbook, Family Timeline) to scope
 * the sheet to relevant adds. Reset to `null` on every close.
 */
const allowedActions = ref<readonly QuickAddAction[] | null>(null);

// --- History integration --------------------------------------------------

/**
 * Marker we stamp onto `history.state` when opening the sheet. Lets us
 * tell our own pushed entry apart from arbitrary navigations in the
 * `popstate` handler, and tells navigation flows whether to replace
 * vs push so the back stack doesn't accumulate dead sheet-open entries.
 */
const HISTORY_MARKER_KEY = '__beanieQuickAddOpen';

export function hasSheetHistoryMarker(): boolean {
  if (typeof window === 'undefined') return false;
  const state = window.history.state as Record<string, unknown> | null;
  return Boolean(state && state[HISTORY_MARKER_KEY]);
}

function pushSheetHistoryMarker(): void {
  if (typeof window === 'undefined') return;
  const base = (window.history.state as Record<string, unknown> | null) ?? {};
  window.history.pushState({ ...base, [HISTORY_MARKER_KEY]: true }, '');
}

/**
 * Global popstate listener — closes the sheet when the back gesture
 * (or browser back button) pops our history entry. We set
 * `isOpen=false` directly instead of calling `closeQuickAdd`, because
 * `closeQuickAdd` itself calls `history.back()` and would loop.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (isOpen.value) {
      isOpen.value = false;
      stage.value = { mode: 'main' };
      allowedActions.value = null;
    }
  });
}

// --- Open / close / toggle ------------------------------------------------

/**
 * Open the sheet in `main` mode. No-ops when another overlay already
 * has focus — stacking the sheet on top of a modal would produce
 * confusing focus ordering and double-backdrop stacking.
 *
 * Also pushes a synthetic history entry so a device back gesture (PWA
 * swipe, browser back button) dismisses the sheet instead of leaving
 * the app.
 */
export function openQuickAdd(options?: { filter?: readonly QuickAddAction[] }): void {
  if (hasOpenOverlays()) {
    // Silent-fail prevention: if openQuickAdd was called but the sheet
    // doesn't appear on screen, this is the most common cause. Surface
    // a warning + Slack report so we can debug stuck-counter cases
    // (e.g. a modal that mounted with `:open=true` initially but never
    // emitted its close, leaking a body-scroll lock).
    console.warn(
      '[useQuickAdd] openQuickAdd blocked — another overlay is registered as open. ' +
        'If no modal is visibly on screen, the overlay-stack counter has leaked; ' +
        'reload the page to reset.'
    );
    reportError({
      surface: 'useQuickAdd',
      message: 'openQuickAdd blocked by overlay stack',
    });
    return;
  }

  // Filter normalisation. Empty arrays are caller bugs — they would render
  // an empty sheet. In dev, surface loudly so the call site is fixed; in
  // prod, fall back to no filter so the user still gets a usable sheet.
  // Filter is typed against `QuickAddAction` so most typos fail at compile
  // time; the dev-mode unknown-action guard catches dynamically-built lists.
  const filter = options?.filter;
  if (filter !== undefined) {
    if (filter.length === 0) {
      if (import.meta.env.DEV) {
        console.error(
          '[useQuickAdd] openQuickAdd called with empty filter — falling back to no filter'
        );
      }
      reportError({
        surface: 'useQuickAdd',
        message: 'openQuickAdd called with empty filter',
      });
      allowedActions.value = null;
    } else {
      if (import.meta.env.DEV) {
        const valid = new Set(QUICK_ADD_ITEMS.map((i) => i.action));
        const unknown = filter.filter((a) => !valid.has(a));
        if (unknown.length > 0) {
          console.warn('[useQuickAdd] filter contains unknown actions:', unknown);
        }
      }
      allowedActions.value = filter;
    }
  } else {
    allowedActions.value = null;
  }

  stage.value = { mode: 'main' };
  isOpen.value = true;
  pushSheetHistoryMarker();
}

/**
 * Close the sheet. If we pushed a history marker on open, pop it via
 * `history.back()` so the stack doesn't leak dead entries. The popstate
 * handler fires async but no-ops because `isOpen` is already false.
 */
export function closeQuickAdd(): void {
  const shouldPop = isOpen.value && hasSheetHistoryMarker();
  isOpen.value = false;
  stage.value = { mode: 'main' };
  allowedActions.value = null;
  if (shouldPop) {
    window.history.back();
  }
}

/**
 * Reset visual state without touching history. Used by the navigate-
 * from-sheet paths (tap an item; tap picker commit) where the route
 * transition itself will `replace` the marker entry — double-popping
 * via `history.back()` plus `router.replace` would race and leave the
 * stack in a bad state.
 */
export function closeSheetForNavigation(): void {
  isOpen.value = false;
  stage.value = { mode: 'main' };
  allowedActions.value = null;
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
 * Run the actual vue-router navigation for a resolved intent.
 *
 * Replace semantics apply in two cases:
 *   1. Same-route taps — no history churn from repeated quick-adds on
 *      the page you're already on.
 *   2. Sheet-marker on the history stack — the sheet pushed an entry
 *      on open, and we want the target to REPLACE that entry so back
 *      from the target goes to the pre-sheet page (not a dead
 *      sheet-open marker pointing at the same URL).
 *
 * Cross-route taps with no marker push (normal router behavior).
 *
 * Runs OUTSIDE `setup()` (click handler / picker-commit context), so
 * we use the imported router singleton rather than `useRouter()`.
 * Navigation errors (cancelled, duplicate) are `console.warn`-ed —
 * they're expected and not user-facing failures.
 */
function navigateToIntent(item: QuickAddItem, query: Record<string, string>): void {
  const route = router.currentRoute.value;
  const sameRoute = route.path === item.route;
  const shouldReplace = sameRoute || hasSheetHistoryMarker();
  const go = shouldReplace ? router.replace : router.push;
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
  closeSheetForNavigation();
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
  closeSheetForNavigation();
  navigateToIntent(item, query);
}

/** Return from picker view to the main item grid. */
export function cancelPicker(): void {
  stage.value = { mode: 'main' };
}

/**
 * Programmatically start a quick-add for a specific action — the entry
 * point used by in-page "Add" affordances (e.g. the Care & Safety
 * section headers) that want the SAME flow as the FAB without making
 * the user open the sheet and hunt for the tile.
 *
 * - Context-required item on a route that can't supply the id (e.g.
 *   `add-medication` on `/pod/safety`, which has no `:memberId`) →
 *   open the sheet straight into the parent picker. On commit the
 *   existing intent pipeline navigates + opens the target form.
 * - Otherwise (no context needed, or the route already supplies it) →
 *   navigate straight to the target form, no sheet flash.
 */
export function startQuickAddItem(action: QuickAddAction): void {
  const item = QUICK_ADD_ITEMS.find((i) => i.action === action);
  if (!item) {
    // No silent failure — a caller passed an action that isn't in the
    // vocabulary (typo, stale constant). Surface it rather than no-op.
    console.error(`[useQuickAdd] startQuickAddItem: unknown action "${action}"`);
    reportError({
      surface: 'quick-add-inline',
      message: 'startQuickAddItem called with unknown action',
      context: { action },
    });
    return;
  }

  // Firehose the entry point so we can see in-page adds being used and
  // diagnose blind if the picker/form ever fails to appear. Both keys
  // are on the ALLOWED_CONTEXT_KEYS allowlist already.
  logEvent({
    level: 'info',
    surface: 'quick-add-inline',
    message: 'quick-add started from in-page affordance',
    context: { action, route_path: router.currentRoute.value.path },
  });

  if (needsPicker(item)) {
    openQuickAdd();
    // openQuickAdd no-ops if another overlay owns focus; only force the
    // picker stage if the sheet actually opened, else the picker would
    // render into a closed (invisible) sheet.
    if (isOpen.value) {
      stage.value = { mode: 'picker', pending: item };
    }
    return;
  }

  closeSheetForNavigation();
  const query = buildIntentQuery(item, router.currentRoute.value);
  navigateToIntent(item, query);
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
    allowedActions: computed(() => allowedActions.value),
    open: openQuickAdd,
    close: closeQuickAdd,
    toggle: toggleQuickAdd,
    triggerAction: triggerQuickAddAction,
    startItem: startQuickAddItem,
    commitPicker: commitPickerSelection,
    cancelPicker,
  };
}
