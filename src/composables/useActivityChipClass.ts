import { useFamilyStore } from '@/stores/familyStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { normalizeAssignees } from '@/utils/assignees';
import type { FamilyActivity, FamilyMember } from '@/types/models';

/**
 * Heritage Orange — the brand "primary" tied to family / shared activities.
 * Used as the chip bar colour whenever an activity is everyone-or-many.
 *
 * Hex literal (not a CSS var) because chip backgrounds tint via the
 * `${hex}1f` 12% alpha trick (see `AllDayActivityChip.vue`) — that only
 * works on hex strings.
 */
export const HERITAGE_ORANGE = '#F15D22';

/** Default neutral grey used when an activity points only at deleted members. */
const NEUTRAL_FALLBACK = '#6b7280';

export type ActivityChipClass =
  | { kind: 'solo'; color: string; members: FamilyMember[] }
  | { kind: 'family'; color: string; members: FamilyMember[] }
  | { kind: 'shared'; color: string; members: FamilyMember[] };

/**
 * Resolve how an activity should be coloured + which avatars its right-edge
 * stack should carry. This is the single source of truth for the chip rule
 * confirmed during the calendar-refactor planning:
 *
 *  - 0 assignees   → "family"   — Heritage Orange bar, avatar stack = all human members
 *  - 1 assignee    → "solo"     — that member's own color, no right-edge stack
 *  - 2+ assignees  → "shared"   — Heritage Orange bar, stack = selected members
 *
 * Deleted-member references in `assigneeIds` are dropped via `.filter(Boolean)`.
 * If every assignee turns out to be unknown (rare data-corruption case), we
 * fall back to solo semantics with the default colour rather than misrepresent
 * the chip as a multi-person event.
 *
 * Promoted from `MonthChip.vue` during Phase B so both monthly chips AND
 * weekly event blocks share one classifier — no parallel implementation.
 *
 * Pure function: takes an activity + the family's human roster (pets
 * excluded — pass `familyStore.humans`). For the common "I have one
 * activity, give me its classification" case, prefer the composable
 * `useActivityChipClass()` wrapper below which reads the family roster
 * via the store.
 */
export function classifyActivityChip(
  activity: FamilyActivity,
  humans: FamilyMember[],
  memberById: (id: string) => FamilyMember | undefined,
  memberColor: (id: string) => string
): ActivityChipClass {
  const ids = normalizeAssignees(activity);

  if (ids.length === 0) {
    return { kind: 'family', color: HERITAGE_ORANGE, members: humans };
  }

  if (ids.length === 1) {
    return {
      kind: 'solo',
      color: memberColor(ids[0]!),
      members: [],
    };
  }

  const members = ids.map((id) => memberById(id)).filter((m): m is FamilyMember => Boolean(m));

  if (members.length === 0) {
    return { kind: 'solo', color: NEUTRAL_FALLBACK, members: [] };
  }

  return { kind: 'shared', color: HERITAGE_ORANGE, members };
}

/**
 * Composable wrapper that pulls the family roster and member helpers from
 * stores. Call inside a component setup() to get a `classify(activity)`
 * function. Reactive — re-classifies when the family or member colours
 * change.
 */
export function useActivityChipClass() {
  const familyStore = useFamilyStore();
  const { getMemberById, getMemberColor } = useMemberInfo();

  function classify(activity: FamilyActivity): ActivityChipClass {
    return classifyActivityChip(activity, familyStore.humans, getMemberById, (id) =>
      getMemberColor(id)
    );
  }

  return { classify };
}
