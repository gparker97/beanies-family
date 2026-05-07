/**
 * Cross-family timeline composable.
 *
 * Returns all milestones grouped by year, **ascending** (oldest first).
 * A family timeline is a memory artifact, not a news feed — reading life
 * events in actual chronological order (birth → first words → school →
 * graduation) has more emotional pull than reverse-chrono.
 *
 * Filters were removed in v2 (2026-05-07): the family-scale data set
 * never gets large enough that filtering helps; the chrome added clutter
 * with no payoff. If a future feature needs scoping, add it as a
 * separate "search" surface rather than restoring page-level filter
 * chips.
 *
 * Malformed `occurredOn` falls back to `createdAt` via `safeOccurredOn`,
 * so the year grouping never produces a `NaN` bucket. Dangling
 * `memberId` references (deleted bean) are detected at the page render
 * site, not here — keeps this composable focused on time-based shape.
 */
import { computed } from 'vue';
import { useMilestonesStore } from '@/stores/milestonesStore';
import { reportError } from '@/utils/errorReporter';
import { safeOccurredOn } from '@/utils/date';
import type { Milestone } from '@/types/models';

export interface TimelineYearBucket {
  year: number;
  milestones: Milestone[];
}

export function useFamilyTimeline() {
  const milestonesStore = useMilestonesStore();

  /** All milestones, ascending by effective date (oldest first). */
  const sorted = computed<Milestone[]>(() =>
    [...milestonesStore.milestones].sort((a, b) => {
      const aKey = safeOccurredOn(a.occurredOn, a.createdAt, {
        surface: 'familyTimeline',
        itemId: a.id,
      });
      const bKey = safeOccurredOn(b.occurredOn, b.createdAt, {
        surface: 'familyTimeline',
        itemId: b.id,
      });
      return aKey.localeCompare(bKey);
    })
  );

  /**
   * Year buckets in ascending order. A milestone's year is derived from
   * its `safeOccurredOn` date; if the result is somehow non-numeric
   * (shouldn't happen since the fallback is `createdAt`, also ISO), the
   * item is dropped + reported rather than producing a "NaN" header.
   */
  const yearBuckets = computed<TimelineYearBucket[]>(() => {
    const buckets = new Map<number, Milestone[]>();
    for (const m of sorted.value) {
      const dateStr = safeOccurredOn(m.occurredOn, m.createdAt, {
        surface: 'familyTimeline',
        itemId: m.id,
      });
      const year = new Date(dateStr).getFullYear();
      if (Number.isNaN(year)) {
        console.warn('[familyTimeline] could not derive year for milestone:', m.id, dateStr);
        reportError({
          surface: 'familyTimeline',
          message: 'could not derive year for milestone',
          context: { milestoneId: m.id, dateStr },
        });
        continue;
      }
      const existing = buckets.get(year);
      if (existing) {
        existing.push(m);
      } else {
        buckets.set(year, [m]);
      }
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, milestones]) => ({ year, milestones }));
  });

  const isEmpty = computed(() => sorted.value.length === 0);
  const totalCount = computed(() => sorted.value.length);

  return { yearBuckets, isEmpty, totalCount };
}
