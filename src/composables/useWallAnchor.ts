import { computed, readonly, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useToday } from '@/composables/useToday';
import { useSettingsStore } from '@/stores/settingsStore';
import { reportError } from '@/utils/errorReporter';
import { startOfWeekYmd } from '@/utils/date';
import {
  MAX_ANCHOR_DRIFT_DAYS,
  anchorWeekDays,
  clampAnchorYmd,
  nextAnchorYmd,
  type WallStepUnit,
} from '@/utils/wallAnchor';

const SURFACE = 'beanie-wall';

export interface WallAnchor {
  /** The day the wall is looking at. Readonly — every write goes through a clamp. */
  anchorYmd: Readonly<Ref<string>>;
  /** The seven days the week views render, starting at the anchor. */
  weekDays: ComputedRef<string[]>;
  /** True when the wall is showing the rolling `today + 6` default. */
  isAnchoredToToday: ComputedRef<boolean>;
  /**
   * Place the anchor on a specific day (a day tap). `reason` names the caller.
   * Returns false when the value was refused and the wall landed on today
   * instead — callers must not report a move that did not happen.
   */
  setAnchor: (next: string, reason: string) => boolean;
  /**
   * Move by one week or one day. See `nextAnchorYmd` for the snapping rule.
   * Returns false when the step would leave the browsable range, in which case
   * the anchor does not move.
   */
  step: (unit: WallStepUnit, direction: -1 | 1) => boolean;
  /** Whether that step would land inside the browsable range. */
  canStep: (unit: WallStepUnit, direction: -1 | 1) => boolean;
  /** Return to the rolling default. */
  goToToday: () => void;
  /**
   * The CALENDAR week containing the anchor — for a day picker that must be able
   * to show its own selection. `weekDays` starts AT the anchor, so a picker built
   * on it re-bases itself every time someone picks.
   */
  weekOfAnchor: ComputedRef<string[]>;
}

/**
 * The wall's one date concept — the wiring around `wallAnchor.ts`, and nothing else.
 *
 * ⚠️ This REPLACES `WallTodayView`'s local `focusYmd`. That ref was destroyed on
 * every view switch (all four views render through a single `<component :is>`),
 * so moving to Thursday and flicking to another view silently returned the wall
 * to today. Owning the anchor at page level is what fixes that; do not
 * reintroduce a per-view date.
 *
 * Deliberately NOT `usePlannerNavigation`: that composable is `Date`-based, keyed
 * to `'month' | 'week' | 'day'`, and owns a `referenceDate` shared by three planner
 * views. The wall's anchor is a ymd string with its own snapping rule, and merging
 * the two would mean a type union plus a mode flag inside a file three other views
 * depend on. This one does mirror that file's one-way data-flow rule — props down,
 * intent up — and reuses `date.ts`'s formatters.
 *
 * Takes no arguments: the step unit is a per-call fact belonging to the intent, not
 * a reactive input this composable should own.
 */
export function useWallAnchor(): WallAnchor {
  const { today } = useToday();
  const settingsStore = useSettingsStore();
  const anchorYmd = ref(today.value);

  /**
   * Midnight rollover, and the reason the wall is safe to leave running for weeks.
   * Mirrors the watcher this replaces in `WallTodayView`. Navigation is
   * session-only by design — a kitchen wall left on Thursday and still showing
   * Thursday three days later is a defect, not a feature.
   */
  watch(today, (ymd) => {
    anchorYmd.value = ymd;
  });

  /**
   * The only writer. Every navigation path routes through here, so the clamp is
   * structural rather than a convention someone has to remember — which is also
   * why `anchorYmd` is handed out `readonly`.
   */
  function setAnchor(next: string, reason: string): boolean {
    const safe = clampAnchorYmd(next, today.value);

    if (safe !== next) {
      // Developer-facing, deliberately. The anchor has no untrusted input path —
      // no URL, no persistence, every value derived from a rendered day or from
      // `nextAnchorYmd` — so reaching here is a bug in a caller, not bad input
      // from a family. A translated toast carried in every locale forever, for a
      // branch that should never execute, would be cost with no user on the far
      // end. Landing silently on today is the correct, least-alarming recovery.
      console.error(
        `[wall-anchor] refusing anchor "${next}" (${reason}). Expected YYYY-MM-DD within ` +
          `±${MAX_ANCHOR_DRIFT_DAYS} days of ${today.value}. parseLocalDate does NOT throw on ` +
          `bad input — it yields "NaN-NaN-NaN" — so the caller passed something unparseable. ` +
          `Check the emitter of this navigation event.`
      );
      reportError({
        surface: SURFACE,
        message: 'wall_anchor_rejected',
        severity: 'warning',
        context: { action: 'anchor', kind: reason, error_code: 'bad_anchor' },
      });
    }

    anchorYmd.value = safe;
    return safe === next;
  }

  /**
   * Move one period, or refuse to.
   *
   * ⚠️ The range limit is a UI boundary, NOT bad input, and conflating the two
   * was a real defect: 54 presses of `›` reached +372 days, at which point the
   * clamp teleported the wall home mid-browse with no message and filed a
   * `bad_anchor` warning accusing the caller of passing something unparseable.
   * It also reported `count: 0` immediately after a `next`, corrupting the one
   * signal the signed offset exists to provide.
   *
   * So the arrow SATURATES: at the boundary the wall simply does not move, and
   * nothing is reported. `setAnchor`'s clamp stays for what it was written for —
   * a value that should never have been constructed at all.
   */
  function step(unit: WallStepUnit, direction: -1 | 1): boolean {
    if (!canStep(unit, direction)) return false;
    const next = nextAnchorYmd(anchorYmd.value, unit, direction, settingsStore.weekStartDay);
    return setAnchor(next, direction === 1 ? 'next' : 'prev');
  }

  function goToToday(): void {
    setAnchor(today.value, 'today');
  }

  /**
   * Could the arrow move, if pressed? Drives the navigator's disabled state so a
   * child pressing `›` at the boundary gets a visibly dead button rather than a
   * screen that appears frozen.
   */
  function canStep(unit: WallStepUnit, direction: -1 | 1): boolean {
    const next = nextAnchorYmd(anchorYmd.value, unit, direction, settingsStore.weekStartDay);
    return clampAnchorYmd(next, today.value) === next;
  }

  return {
    anchorYmd: readonly(anchorYmd),
    weekDays: computed(() => anchorWeekDays(anchorYmd.value)),
    isAnchoredToToday: computed(() => anchorYmd.value === today.value),
    // The CALENDAR week containing the anchor. `weekDays` starts AT the anchor,
    // which is right for the week view but wrong for a day picker: a picker
    // built on it re-bases every time someone picks, putting the days before
    // the chosen one out of reach.
    weekOfAnchor: computed(() =>
      anchorWeekDays(startOfWeekYmd(anchorYmd.value, settingsStore.weekStartDay))
    ),
    setAnchor,
    step,
    canStep,
    goToToday,
  };
}
