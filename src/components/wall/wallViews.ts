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
   * ⚠️ It also settles what a DAY TAP means, which now differs per view and is
   * exactly the kind of thing a later reader gets wrong: a day header re-anchors
   * in a view that can render that day itself (`days`, `today`), and opens the
   * day sheet in a view that cannot (`lanes`, whose columns are people).
   */
  stepUnit: WallStepUnit | null;
}

export const WALL_VIEWS: readonly WallViewDef[] = [
  { id: 'days', labelKey: 'wall.view.days', glyph: '▦', component: WallDaysView, stepUnit: 'week' },
  {
    id: 'lanes',
    labelKey: 'wall.view.lanes',
    glyph: '👥',
    component: WallLanesView,
    stepUnit: 'day',
  },
  {
    id: 'today',
    labelKey: 'wall.view.today',
    glyph: '☀',
    component: WallTodayView,
    stepUnit: 'day',
  },
  {
    id: 'jobs',
    labelKey: 'wall.view.jobs',
    glyph: '✅',
    component: WallChoreBoard,
    dividerBefore: true,
    stepUnit: null,
  },
] as const;

export const DEFAULT_WALL_VIEW: WallViewId = 'days';

export function wallViewById(id: WallViewId): WallViewDef {
  return WALL_VIEWS.find((v) => v.id === id) ?? WALL_VIEWS[0];
}
