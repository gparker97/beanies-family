/**
 * The view registry — the single source the switcher AND the page both read.
 *
 * Two parallel lists (one for the tabs, one for the rendered screen) is the
 * classic drift bug in a multi-tab surface: you add a view to one and forget
 * the other. There is only one list here.
 *
 * Adding a fifth screen is one component + one row. No existing wall file
 * changes — that is the maintainability test this design has to pass.
 */
import type { Component } from 'vue';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { WallViewId } from '@/types/wall';
import type { WallStepUnit } from '@/utils/wallAnchor';
import WallDaysView from '@/components/wall/WallDaysView.vue';
import WallLanesView from '@/components/wall/WallLanesView.vue';
import WallTodayView from '@/components/wall/WallTodayView.vue';
import WallChoreBoard from '@/components/wall/WallChoreBoard.vue';
import WallChoreLanes from '@/components/wall/WallChoreLanes.vue';

export interface WallViewDef {
  id: WallViewId;
  labelKey: UIStringKey;
  /** Decorative glyph — the switcher is icon-only, with the label as its title. */
  glyph: string;
  component: Component;
  /** The jobs board is a peer of the calendar, not another calendar layout. */
  dividerBefore?: boolean;
  /**
   * How the header's arrows move this view, or `null` for a view with no date.
   *
   * REQUIRED rather than optional, and spelled `null` rather than omitted, so a
   * fifth view cannot quietly inherit someone else's stepping — this file's
   * maintainability test is "one component + one row", and a row that can be
   * half-filled fails it.
   *
   * ⚠️ It does NOT settle what a day tap means. That rule belongs to the
   * AFFORDANCE rather than to the view — a day the wall is not drawing in full
   * re-anchors, a day it IS drawing drills in — so stating it per-view here is
   * what made the previous version of this paragraph false. It lives once, on
   * `onOpenDay` in `BeanieWallPage`, beside the handler for its other half.
   */
  stepUnit: WallStepUnit | null;
  /**
   * Does this view draw its OWN step arrows, beside the dates they move?
   *
   * `false` means the page's header navigator draws them. Read only when
   * `stepUnit` is non-null — a view with no date has no arrows at all, and that
   * fact is already recorded above.
   *
   * ⚠️ A boolean, not a `'row' | 'header' | null` tri-state. A tri-state records
   * "no arrows" TWICE — here and as `stepUnit: null` — and makes
   * `{ stepUnit: null, arrows: 'header' }` a constructible, type-checking,
   * meaningless row: a view with no date and a pair of arrows that step nothing.
   * Two fields that compose cannot be set to contradict each other.
   */
  arrowsInView: boolean;
}

export const WALL_VIEWS: readonly WallViewDef[] = [
  {
    id: 'days',
    labelKey: 'wall.view.days',
    glyph: '▦',
    component: WallDaysView,
    stepUnit: 'page',
    arrowsInView: true,
  },
  {
    id: 'lanes',
    labelKey: 'wall.view.lanes',
    glyph: '👥',
    component: WallLanesView,
    stepUnit: 'day',
    arrowsInView: false,
  },
  {
    id: 'today',
    labelKey: 'wall.view.today',
    glyph: '☀',
    component: WallTodayView,
    stepUnit: 'day',
    arrowsInView: false,
  },
  {
    id: 'jobs',
    labelKey: 'wall.view.jobs',
    glyph: '✅',
    component: WallChoreBoard,
    dividerBefore: true,
    stepUnit: null,
    // Unread: `stepUnit` is null, so the page never asks.
    arrowsInView: false,
  },
] as const;

/**
 * The views while the `choreboard` gate is on (#146): the chore lanes join the boards, ahead of
 * the lists board, which is renamed "Lists" (it shows lists only now that chores have their own
 * board). `WALL_VIEWS` itself stays the gate-off registry, so removing the gate later is this
 * function becoming the registry, nothing more.
 *
 * Takes the gate as a value: the PAGE reads the flag, once.
 */
export function wallViewsFor(choreboard: boolean): readonly WallViewDef[] {
  if (!choreboard) return WALL_VIEWS;
  const calendar = WALL_VIEWS.filter((v) => !isBoardView(v.id));
  const lists = WALL_VIEWS.find((v) => v.id === 'jobs');
  return [
    ...calendar,
    {
      id: 'chores',
      labelKey: 'wall.view.chores',
      glyph: '🧹',
      component: WallChoreLanes,
      dividerBefore: true,
      stepUnit: null,
      arrowsInView: false,
    },
    ...(lists ? [{ ...lists, labelKey: 'wall.view.lists' as const, dividerBefore: false }] : []),
  ];
}

/**
 * The boards: views with no date, which "back" never returns to (the lists board and, while
 * the gate is on, the chore lanes).
 */
export function isBoardView(id: WallViewId): boolean {
  return id === 'jobs' || id === 'chores';
}

export const DEFAULT_WALL_VIEW: WallViewId = 'days';

/** `views` is the set the page is offering (`wallViewsFor`); an id not in it falls back. */
export function wallViewById(
  id: WallViewId,
  views: readonly WallViewDef[] = WALL_VIEWS
): WallViewDef {
  return views.find((v) => v.id === id) ?? views[0] ?? WALL_VIEWS[0];
}

/** Where the wall is, and the view its back control returns to. */
export interface WallViewState {
  active: WallViewId;
  back: WallViewId;
}

/**
 * Move to a view, and work out what "back" should mean afterwards.
 *
 * ⚠️ Pure, and extracted, because three review passes got this wrong in a row.
 * There are TWO ways to end up with a back control that names the view you are
 * already in, and each needs a different guard:
 *
 *   1. Re-tapping the tab you are on. Without `id !== active`, selecting `today`
 *      while in `today` records `today` as the place to go back to.
 *   2. `today -> jobs -> back`. Entering jobs records `today`; leaving jobs
 *      SKIPS the write, because the write is gated on not being in jobs — so
 *      `back` is still `today` while `active` becomes `today` again.
 *
 * This function closes (1). `canGoBack` — comparing the two — closes (2), and it
 * has to be a read-side check because no write-side rule can see it coming.
 */
export function wallViewTransition(state: WallViewState, id: WallViewId): WallViewState {
  // Leaving a BOARD never records it: a board has no date, and "back" is to a calendar view.
  const recordsBack = id !== state.active && !isBoardView(state.active);
  return { active: id, back: recordsBack ? state.active : state.back };
}

/** Is there a DIFFERENT view to go back to? See `wallViewTransition` for why. */
export function canGoBackFrom(state: WallViewState): boolean {
  return state.back !== state.active;
}
