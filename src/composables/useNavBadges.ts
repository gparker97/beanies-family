/**
 * Sidebar + mobile-nav attention badge system.
 *
 * Single source of truth for which nav items show an attention indicator
 * and what shape it takes. Consumers (AppSidebar, MobileBottomNav,
 * MobileNavBeanStack) read from `badgeFor(path)` and `categoryAttention`;
 * the `badges` object exists for tests + future ad-hoc lookups.
 *
 * Design contract:
 *   - `count` variant always represents an attention signal (action-needed).
 *   - `dot` variant carries an explicit `severity`; only `'attention'`
 *     dots escalate to the mobile-tab aggregator.
 *
 * Adding a new badge:
 *   1. Add the key to `KNOWN_BADGE_KEYS` in src/constants/navigation.ts
 *   2. Add the `badges[<key>]` entry below
 *   3. Tag the relevant NAV_ITEM with `badgeKey: '<key>'`
 *   The module-load invariant in navigation.ts catches typos.
 */
import { computed } from 'vue';
import { useTodoStore } from '@/stores/todoStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useBudgetStore } from '@/stores/budgetStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useToday } from '@/composables/useToday';
import { parseIsoDateSafely } from '@/utils/safeDate';
import {
  getBadgeKeyForPath,
  MOBILE_TAGGED_NAV_ITEMS,
  type KnownBadgeKey,
  type MobileCategoryId,
} from '@/constants/navigation';
import type { FamilyVacation } from '@/types/models';

export type NavBadge =
  | { kind: 'count'; count: number }
  | { kind: 'dot'; severity: 'info' | 'attention'; active: boolean };

/** Reusable literal — the orange attention dot used by the mobile-tab
 *  aggregator. Inlined in components would also work; named here so the
 *  semantic ("this is the attention-dot variant") is self-documenting. */
export const ATTENTION_DOT: NavBadge = { kind: 'dot', severity: 'attention', active: true };

const UPCOMING_TRAVEL_WINDOW_DAYS = 30;

/**
 * Count open ideas on the most-immediate qualifying trip — ongoing right
 * now or starting within the upcoming window. "Open" = an idea that's
 * neither marked planned nor skipped for this trip. Returns 0 when no
 * trip qualifies (so the count badge naturally hides), and 0 when the
 * trip has nothing left to decide (the satisfying "all-planned" state).
 *
 * Picks ONE trip — the earliest-starting qualifying one. Vacations are
 * already sorted ascending by startDate, so an ongoing trip (start <=
 * today) is iterated before any future trip in the same window.
 *
 * Date parsing is defensive — corrupt startDate/endDate is logged and
 * the vacation excluded, never silently dropped without trace.
 */
export function openIdeasOnUpcomingTrip(vacations: FamilyVacation[], todayIso: string): number {
  const today = parseIsoDateSafely(todayIso, 'useNavBadges.today');
  if (!today) return 0;
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + UPCOMING_TRAVEL_WINDOW_DAYS);
  for (const v of vacations) {
    const start = parseIsoDateSafely(v.startDate, `vacation ${v.id}.startDate`);
    if (!start) continue;
    const end = parseIsoDateSafely(v.endDate, `vacation ${v.id}.endDate`);
    const isOngoing = start <= today && (!end || end >= today);
    const isUpcomingInWindow = start > today && start <= windowEnd;
    if (!isOngoing && !isUpcomingInWindow) continue;
    return v.ideas.filter((i) => !i.isPlanned && !i.isSkipped).length;
  }
  return 0;
}

export function useNavBadges() {
  const todoStore = useTodoStore();
  const goalsStore = useGoalsStore();
  const budgetStore = useBudgetStore();
  const vacationStore = useVacationStore();
  const { today } = useToday();

  const badges = computed<Record<KnownBadgeKey, NavBadge>>(() => ({
    overdueTodos: {
      kind: 'count',
      count: todoStore.overdueTodos.length + todoStore.dueTodayTodos.length,
    },
    overBudgets: {
      kind: 'count',
      count: budgetStore.categoryBudgetStatus.filter((c) => c.status === 'over').length,
    },
    overdueGoals: { kind: 'count', count: goalsStore.overdueGoals.length },
    openTravelIdeas: {
      kind: 'count',
      count: openIdeasOnUpcomingTrip(vacationStore.upcomingVacations, today.value),
    },
  }));

  /** Resolve the badge for a route path via the nav registry. Returns null
   *  if the path isn't in the registry or the registry entry has no
   *  registered badgeKey. */
  function badgeFor(path: string): NavBadge | null {
    const key = getBadgeKeyForPath(path);
    return key ? badges.value[key] : null;
  }

  /** Whether a badge escalates to tab-level attention. The contract:
   *  `count > 0` always escalates; `dot` escalates only when its severity
   *  is `'attention'` (not `'info'`). Informational dots never light up
   *  the mobile tab — they live only at the per-item level. */
  function escalates(b: NavBadge | null): boolean {
    if (!b) return false;
    if (b.kind === 'count') return b.count > 0;
    return b.severity === 'attention' && b.active;
  }

  /**
   * Mobile-tab attention aggregate. Walks the nav registry's flat
   * mobile-tagged list and asks each item "does your badge escalate?"
   * Single source of truth = the registry. Adding a new attention badge
   * with a `mobileCategory` automatically participates here — no edits
   * required to this composable's aggregator.
   */
  const categoryAttention = computed<Record<MobileCategoryId, boolean>>(() => {
    const result: Record<MobileCategoryId, boolean> = {
      nook: false,
      planning: false,
      calendar: false,
      money: false,
      pod: false,
    };
    for (const tagged of MOBILE_TAGGED_NAV_ITEMS) {
      if (escalates(badgeFor(tagged.path))) {
        result[tagged.mobileCategory] = true;
      }
    }
    return result;
  });

  return { badges, badgeFor, categoryAttention };
}
