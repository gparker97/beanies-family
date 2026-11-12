/**
 * The family timeline, reactive. Shared by the wall's memories viewer and the
 * Scrapbook page's Timeline view.
 *
 * The feed is asked for EVERY type (an empty set is the feed's "all"), and the
 * enabled types are applied by `buildScrapbookTimeline`, where an empty set
 * means nothing. Passing the caller's set straight to the feed would show
 * everything on a wall whose four switches are all off.
 *
 * The roster is the whole family, so departed members' entries stay hidden as
 * they do on the spreads; the bean filter happens in the pure function.
 */
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { useFamilyScrapbookFeed } from '@/composables/useFamilyScrapbookFeed';
import type { ScrapType } from '@/composables/useScrapbookFeed';
import { buildScrapbookTimeline, type TimelineMonth } from '@/utils/scrapbookTimeline';
import type { UUID } from '@/types/models';

export interface UseScrapbookTimelineOptions {
  /** `null` for everyone; a bean id for that bean plus whole-family moments. */
  memberId: MaybeRefOrGetter<UUID | null>;
  /** The enabled types. Empty shows nothing. */
  types: MaybeRefOrGetter<ReadonlySet<ScrapType>>;
}

export function useScrapbookTimeline(options: UseScrapbookTimelineOptions) {
  const { entries } = useFamilyScrapbookFeed();

  const months = computed<TimelineMonth[]>(() =>
    buildScrapbookTimeline(entries.value, {
      memberId: toValue(options.memberId),
      types: toValue(options.types),
    })
  );

  const isEmpty = computed(() => months.value.length === 0);

  return { months, isEmpty };
}
