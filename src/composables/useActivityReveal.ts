import { ref, type Ref } from 'vue';
import { useActivityStore } from '@/stores/activityStore';
import { useAttentionPulse } from '@/composables/useAttentionPulse';
import { logEvent } from '@/services/telemetry/logEvent';
import { waitForElement, waitForScrollSettle } from '@/utils/waitForElement';
import { getAppScroller } from '@/utils/getAppScroller';
import { addDaysYmd, parseLocalDate } from '@/utils/date';

/**
 * Show a just-created activity on the planner: move the calendar to it, then scroll to its chip
 * and give it the shared attention pulse (`useAttentionPulse().reveal`, which owns the scroll
 * behaviour, the pulse driver and the reduced-motion handling). The chip gets the ring-only
 * `attention-ring` variant (it paints its own colour wash), and so does a day-cell fallback (the
 * ring is the variant with a lighter dark-mode partner, and a day card paints its own surface).
 *
 * Two halves, because the moment the view can move and the moment the pulse can be SEEN differ:
 *   - `prepare(id)` moves the view straight away (behind the "Activity Created" confirmation)
 *     and parks the target;
 *   - `flush(stage)` reveals the parked target once nothing covers the calendar any more (the
 *     confirmation closed, or the view modal opened from it closed).
 * `revealNow(id, stage)` does both at once, for a save with no confirmation in front of it. When
 * that moved the view, it first lets the view's own scroll settle (the mobile month stream
 * smooth-scrolls to the new month's header, which would cancel a chip scroll started under it).
 *
 * `cancel()` (and any newer `prepare`) supersedes a flush already in flight: a generation counter
 * is re-checked after every await, so a person who moved on never gets a late scroll + pulse.
 *
 * Every view marks its activity elements with `data-activity-id` + `data-occurrence-date`. The
 * lookup order is {@link findRevealElement}'s. A miss is logged, never thrown.
 */

export const ACTIVITY_REVEAL_SURFACE = 'planner-reveal';

/** How long the chip gets to render after the view moved before falling back to its day. */
const FIND_TIMEOUT_MS = 800;
/** The furthest ahead a first occurrence is looked for (a yearly repeat's worst case). */
const FIRST_OCCURRENCE_HORIZON_DAYS = 366;
/**
 * Waiting out the view's own scroll after `revealNow` moved it (see `waitForScrollSettle`). The
 * month stream starts its anchor scroll within a couple of ticks of the move, so a view that
 * has not scrolled after START is not going to; MAX caps a long smooth scroll whose end is
 * never signalled.
 */
const VIEW_SCROLL_START_MS = 300;
const VIEW_SCROLL_MAX_MS = 1500;

export interface ActivityRevealTarget {
  id: string;
  /** The occurrence to reveal (`YYYY-MM-DD`): the first one on or after the start date. */
  date: string;
}

export interface UseActivityRevealOptions {
  /** The element the calendar views render inside; lookups never leave it. */
  root: Ref<HTMLElement | null>;
  /** Move the calendar so `ymd` is on screen. Returns true when it had to move. */
  showDate: (ymd: string) => boolean;
  /** Names the current view for the logs, e.g. `month-mobile`. */
  viewKind: () => string;
}

export type RevealMatch = 'occurrence' | 'day' | 'activity';

/**
 * The element to reveal for one activity occurrence, most specific first:
 *   1. the exact occurrence (`data-occurrence-date` is the target date). A multi-day chip is
 *      covered here too: every view stamps it with its first visible day, and the target is
 *      the activity's first occurrence, i.e. the span's own first day, which the moved view
 *      shows;
 *   2. the target's day cell (`data-date`, the month views), where the chip may be folded into
 *      a "+N" overflow;
 *   3. only then any element of the activity, for a view with no day cells (the time grids).
 * Taking (3) before (2) would pulse another week's chip of a repeat whose target occurrence is
 * folded away, which points at the wrong day.
 */
export function findRevealElement(
  root: ParentNode,
  target: ActivityRevealTarget
): { el: HTMLElement; match: RevealMatch } | null {
  let anyOccurrence: HTMLElement | null = null;
  for (const el of root.querySelectorAll<HTMLElement>('[data-activity-id]')) {
    if (el.dataset.activityId !== target.id) continue;
    if (el.dataset.occurrenceDate === target.date) return { el, match: 'occurrence' };
    anyOccurrence ??= el;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-date]')) {
    if (el.dataset.date === target.date) return { el, match: 'day' };
  }
  return anyOccurrence ? { el: anyOccurrence, match: 'activity' } : null;
}

export function useActivityReveal(options: UseActivityRevealOptions) {
  const activityStore = useActivityStore();
  const { reveal } = useAttentionPulse();
  const pending = ref<ActivityRevealTarget | null>(null);
  /**
   * Bumped by `cancel` and by every `prepare`. An in-flight flush (or `revealNow`'s settle wait)
   * captures it and gives up when it has moved on, since `pending` alone is cleared the moment
   * a flush starts and so cannot say "the person moved on" mid-flush.
   */
  let generation = 0;

  function log(
    action: string,
    target: ActivityRevealTarget | null,
    extra: Record<string, unknown>
  ) {
    logEvent({
      level: 'info',
      surface: ACTIVITY_REVEAL_SURFACE,
      message: action,
      context: { action, activity_id: target?.id, kind: options.viewKind(), ...extra },
    });
  }

  /**
   * The occurrence a new activity is revealed on: its start date for a one-off, else the first
   * drawn occurrence on or after it (a weekly repeat whose start date is not one of its days
   * starts later). Falls back to the start date when none is drawn in range, e.g. the member
   * filter hides it; the lookup then misses and says so.
   *
   * Scans forward one calendar month at a time (`monthEvents`, the per-month form of
   * `eventsInRange`) and stops at the first month holding one, so the usual repeat costs a
   * single month's expansion instead of a year's. The store exposes no single-activity
   * expansion, so each month still expands the member-filtered set.
   */
  function firstOccurrenceDate(id: string): string | null {
    const activity = activityStore.activities.find((a) => a.id === id);
    if (!activity) return null;
    if (activity.recurrence === 'none') return activity.date;
    const horizon = addDaysYmd(activity.date, FIRST_OCCURRENCE_HORIZON_DAYS);
    const start = parseLocalDate(activity.date);
    if (Number.isNaN(start.getTime())) return activity.date;
    // Cursor on the 1st, so stepping a month never overflows a short one.
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = parseLocalDate(horizon);
    while (cursor <= last) {
      let first: string | null = null;
      for (const occ of activityStore.monthEvents(cursor.getFullYear(), cursor.getMonth())) {
        if (occ.activity.id !== id || occ.date < activity.date || occ.date > horizon) continue;
        if (first === null || occ.date < first) first = occ.date;
      }
      if (first) return first;
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return activity.date;
  }

  /** Move the view to the activity and park it. Null when it is not in the store. */
  function park(
    id: string,
    stage: string
  ): { target: ActivityRevealTarget; moved: boolean } | null {
    generation++; // a newer target supersedes any flush still in flight
    const date = firstOccurrenceDate(id);
    if (!date) {
      pending.value = null;
      log('reveal_skipped', { id, date: '' }, { stage, detail: 'activity_not_in_store' });
      return null;
    }
    const target = { id, date };
    const moved = options.showDate(date);
    pending.value = target;
    log('reveal_prepared', target, { stage, detail: moved ? 'view_moved' : 'already_visible' });
    return { target, moved };
  }

  /** Move the view to the activity now and park it for `flush`. False when it is not found. */
  function prepare(id: string, stage: string): boolean {
    return park(id, stage) !== null;
  }

  /** True (and logged) when `cancel` or a newer `prepare` ran since `gen` was taken. */
  function superseded(gen: number, target: ActivityRevealTarget, stage: string): boolean {
    if (gen === generation) return false;
    log('reveal_cancelled', target, { stage, detail: 'superseded' });
    return true;
  }

  /** Reveal the parked target (scroll + pulse). Resolves true when something was revealed. */
  async function flush(stage: string): Promise<boolean> {
    const target = pending.value;
    pending.value = null;
    if (!target) return false;
    const gen = generation;
    const root = options.root.value;
    if (!root) {
      log('reveal_missed', target, { stage, detail: 'no_root' });
      return false;
    }
    // Wait for the EXACT occurrence: until the moved view re-renders, the old period can still
    // show another occurrence of a repeat, which must not win the race. The looser fallbacks are
    // only taken once the wait is over.
    const exact = await waitForElement(() => {
      const hit = findRevealElement(root, target);
      return hit?.match === 'occurrence' ? hit.el : null;
    }, FIND_TIMEOUT_MS);
    if (superseded(gen, target, stage)) return false;
    const hit = exact
      ? { el: exact, match: 'occurrence' as const }
      : findRevealElement(root, target);
    if (!hit) {
      log('reveal_missed', target, { stage, detail: 'not_rendered' });
      return false;
    }
    // Ring only, for every match: a chip wears its member's colour wash and a day card paints its
    // own surface, which `attention-pulse` (a background flash) would wipe. The ring also has
    // the lighter dark-mode partner (accents get lighter on dark).
    reveal(hit.el, 'attention-ring');
    log('revealed', target, { stage, detail: hit.match });
    return true;
  }

  /** Forget the parked target, and stop a flush already in flight (the person moved on). */
  function cancel(): void {
    generation++;
    pending.value = null;
  }

  /**
   * Reveal with nothing covering the calendar. When the view had to move, the mobile month
   * stream answers the new reference date with a smooth anchor scroll to the month header a
   * tick or two later; a chip scroll started before it ends is cancelled by it. So wait for the
   * scroller to report that scroll finished (`scrollend`, else a quiet gap), bounded both ways;
   * a view that moves without scrolling costs only the short start window.
   */
  async function revealNow(id: string, stage: string): Promise<boolean> {
    const parked = park(id, stage);
    if (!parked) return false;
    if (parked.moved) {
      const gen = generation;
      const outcome = await waitForScrollSettle(getAppScroller(options.root.value), {
        startWithinMs: VIEW_SCROLL_START_MS,
        maxMs: VIEW_SCROLL_MAX_MS,
      });
      if (superseded(gen, parked.target, stage)) return false;
      log('view_settled', parked.target, { stage, detail: outcome });
    }
    return flush(stage);
  }

  return { pending, prepare, flush, cancel, revealNow, firstOccurrenceDate };
}
