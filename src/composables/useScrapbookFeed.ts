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
import type { FavoriteItem, MemberNote, SayingItem, UUID } from '@/types/models';

export type ScrapType = 'favorite' | 'saying' | 'note';

export interface ScrapbookEntry {
  id: UUID;
  type: ScrapType;
  memberId: UUID;
  createdAt: string;
  payload: FavoriteItem | SayingItem | MemberNote;
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
          createdAt: n.createdAt,
          payload: n,
        });
      }
    }

    // Newest-first. localeCompare on ISO8601 strings is correct
    // chronologically — no Date() allocation needed.
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  return { entries };
}
