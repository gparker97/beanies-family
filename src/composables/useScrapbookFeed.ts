/**
 * Cross-bean scrapbook feed. Merges favorites + sayings + member
 * notes into a single stream, sorted newest-first by `createdAt`.
 * Callers pass the current filter selections (`memberIds`,
 * `contentTypes`) as reactive refs; the feed recomputes when either
 * changes or when the underlying stores update.
 *
 * Per the plan, malformed entries (missing createdAt, missing
 * memberId) are skipped with a `[scrapbookFeed]`-prefixed console
 * warning — the rest of the feed still renders.
 */
import { computed, type Ref } from 'vue';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useSayingsStore } from '@/stores/sayingsStore';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import { useMilestonesStore } from '@/stores/milestonesStore';
import { safeOccurredOn } from '@/utils/date';
import type { FavoriteItem, MemberNote, Milestone, SayingItem, UUID } from '@/types/models';

export type ScrapType = 'favorite' | 'saying' | 'note' | 'milestone';

export interface ScrapbookEntry {
  id: UUID;
  type: ScrapType;
  /**
   * Owning bean. `null` for family-wide milestones — consumers render a
   * "🏡 family" pill instead of a bean avatar in that case. Other types
   * always have a non-null memberId.
   */
  memberId: UUID | null;
  /**
   * Sort key — when the thing happened (milestones use `occurredOn`) or
   * when it was added (other types use `createdAt`). ISO strings sort
   * lexically; `localeCompare` is correct chronologically.
   */
  effectiveDate: string;
  createdAt: string;
  payload: FavoriteItem | SayingItem | MemberNote | Milestone;
}

export interface UseScrapbookFeedOptions {
  /**
   * Member ids to include. Empty array means "all members" — the
   * caller should pass every member id in that case, not `[]`.
   */
  memberIds: Ref<UUID[]>;
  /**
   * Content types to include. Empty set means "all three types".
   */
  contentTypes: Ref<Set<ScrapType>>;
}

function hasValidCreatedAt(e: { createdAt?: string }): e is { createdAt: string } {
  return typeof e.createdAt === 'string' && e.createdAt.length > 0;
}

export function useScrapbookFeed(options: UseScrapbookFeedOptions) {
  const favoritesStore = useFavoritesStore();
  const sayingsStore = useSayingsStore();
  const memberNotesStore = useMemberNotesStore();
  const milestonesStore = useMilestonesStore();

  const entries = computed<ScrapbookEntry[]>(() => {
    const memberSet = new Set(options.memberIds.value);
    const types = options.contentTypes.value;
    const includeType = (t: ScrapType) => types.size === 0 || types.has(t);
    const out: ScrapbookEntry[] = [];

    if (includeType('favorite')) {
      for (const f of favoritesStore.favorites) {
        if (!memberSet.has(f.memberId)) continue;
        if (!hasValidCreatedAt(f) || !f.memberId) {
          console.warn('[scrapbookFeed] skipping malformed favorite', f);
          continue;
        }
        out.push({
          id: f.id,
          type: 'favorite',
          memberId: f.memberId,
          effectiveDate: f.createdAt,
          createdAt: f.createdAt,
          payload: f,
        });
      }
    }

    if (includeType('saying')) {
      for (const s of sayingsStore.sayings) {
        if (!memberSet.has(s.memberId)) continue;
        if (!hasValidCreatedAt(s) || !s.memberId) {
          console.warn('[scrapbookFeed] skipping malformed saying', s);
          continue;
        }
        out.push({
          id: s.id,
          type: 'saying',
          memberId: s.memberId,
          effectiveDate: s.createdAt,
          createdAt: s.createdAt,
          payload: s,
        });
      }
    }

    if (includeType('note')) {
      for (const n of memberNotesStore.notes) {
        if (!memberSet.has(n.memberId)) continue;
        if (!hasValidCreatedAt(n) || !n.memberId) {
          console.warn('[scrapbookFeed] skipping malformed note', n);
          continue;
        }
        out.push({
          id: n.id,
          type: 'note',
          memberId: n.memberId,
          effectiveDate: n.createdAt,
          createdAt: n.createdAt,
          payload: n,
        });
      }
    }

    if (includeType('milestone')) {
      // Family-wide milestones (memberId === null) always pass the bean
      // filter — they're family-level events, not bean-owned. Bean-owned
      // milestones filter against memberSet like other types.
      for (const m of milestonesStore.milestones) {
        if (m.memberId !== null && !memberSet.has(m.memberId)) continue;
        if (!hasValidCreatedAt(m)) {
          console.warn('[scrapbookFeed] skipping malformed milestone', m);
          continue;
        }
        out.push({
          id: m.id,
          type: 'milestone',
          memberId: m.memberId,
          // Milestones sort by when the thing happened, not when added.
          // Falls back to createdAt when occurredOn is malformed (with
          // a reportError surfacing the bad item) — see `safeOccurredOn`.
          effectiveDate: safeOccurredOn(m.occurredOn, m.createdAt, {
            surface: 'useScrapbookFeed',
            itemId: m.id,
          }),
          createdAt: m.createdAt,
          payload: m,
        });
      }
    }

    // Newest-first by effective date (occurredOn for milestones, createdAt
    // for other types). localeCompare on ISO8601 strings is correct
    // chronologically — no Date() allocation needed.
    return out.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  });

  return { entries };
}
