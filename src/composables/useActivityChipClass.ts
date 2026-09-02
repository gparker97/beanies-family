import { useFamilyStore } from '@/stores/familyStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { effectiveAssignees, normalizeAssignees } from '@/utils/assignees';
import { HERITAGE_ORANGE, NEUTRAL_MEMBER_COLOR } from '@/constants/memberColors';
import type { FamilyActivity, FamilyMember } from '@/types/models';

/**
 * Heritage Orange — re-exported so the dozen existing importers of it from this
 * module are unaffected. It is DECLARED in `@/constants/memberColors`, which has
 * zero imports: this module reaches `useAccountsStore` through `useMemberInfo`,
 * and until 2026-09-02 the constants file imported the colour from here, which
 * dragged a finance store into every avatar in the app and into the beanie
 * wall's lint-fenced tree. Do not move the declaration back.
 */
export { HERITAGE_ORANGE };

/** Default neutral grey used when an activity points only at deleted members. */
const NEUTRAL_FALLBACK = NEUTRAL_MEMBER_COLOR;

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
  // RESOLVE FIRST, then count. Counting raw ids and resolving afterwards meant a record
  // carrying one real member plus one dead id — a removed member, a pet, or the same id
  // written twice by two devices merging — was classified 'shared' and shown with the
  // multi-person treatment, while the edit form showed its single owner. `assigneeIds` is
  // a CRDT array no write path prunes, so those extra ids accumulate silently and only
  // ever surface as a chip that looks wrong.
  //
  // Dedupe + resolve is `effectiveAssignees`' job, not a second copy of it here — one
  // rule, so the two cannot drift.
  const ids = normalizeAssignees(activity);
  const members = effectiveAssignees(activity, (id) => Boolean(memberById(id)))
    .map((id) => memberById(id))
    .filter((m): m is FamilyMember => Boolean(m));

  // No owner at all: the whole family's.
  if (ids.length === 0) {
    return { kind: 'family', color: HERITAGE_ORANGE, members: humans };
  }

  // Every id was a dead reference. Solo semantics with the neutral colour rather than
  // claiming this is either a family event or a multi-person one. `members` is empty
  // because there is genuinely nobody to show — not because of the lane rule below.
  if (members.length === 0) {
    return { kind: 'solo', color: NEUTRAL_FALLBACK, members: [] };
  }

  // `members` carries the OWNER even when solo. It used to return `[]` here, which baked
  // the beanie wall's lane rule ("the lane header already names this bean, so the card
  // need not") into the classifier — and every non-lane surface then had to re-derive the
  // owner list for itself, which is where `WallTodayView.membersFor` and
  // `WallSheet.membersFor` came from. The lane rule now lives in `useActivityIdentity`,
  // which is the only thing that knows whether it is rendering inside a lane.
  if (members.length === 1) {
    return {
      kind: 'solo',
      color: memberColor(members[0]!.id),
      members,
    };
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
