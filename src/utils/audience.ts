/**
 * "Who sees what" — the canonical audience classifier, extracted verbatim from
 * `useCriticalItems` so the daily briefing, the native OS reminders, AND the new
 * in-app notification deriver all share ONE rule (duplicating it would risk the
 * copies drifting). Pure: no Vue/store references — takes the viewer + a member
 * resolver. Locked by `utils/__tests__/audience.test.ts`.
 *
 * The rule:
 *   • You're directly assigned                  → 'assignee'.
 *   • No adult assigned, but ≥1 child is         → every adult sees it framed by
 *     the child's name ('forChild'); the assigned child sees it as their own
 *     ('assignee'); other children don't.
 *   • Nobody (resolvable, non-pet) is assigned   → everyone non-pet sees it
 *     ('unassigned') — also where truly-unassigned, all-stale-ID, and pet-only
 *     items land, all degrading gracefully.
 *   • Anything else                              → 'hidden' for this viewer.
 * Pets never get a briefing.
 */
import { isAdultMember } from '@/composables/useMemberInfo';
import type { DutyCompletion, FamilyMember } from '@/types/models';

export type BriefingAudience =
  | { kind: 'assignee' }
  | { kind: 'forChild'; childNames: string[] }
  | { kind: 'unassigned' }
  | { kind: 'hidden' };

/** Check whether a duty has been completed for a given occurrence date. */
export function isDutyDone(completions: DutyCompletion[] | undefined, date: string): boolean {
  return completions?.some((c) => c.date === date) ?? false;
}

export function classifyAudience(
  assigneeIds: string[],
  viewer: FamilyMember,
  resolveMember: (id: string) => FamilyMember | undefined
): BriefingAudience {
  const known = assigneeIds.map(resolveMember).filter((m): m is FamilyMember => m !== undefined);
  if (known.some((m) => m.id === viewer.id)) return { kind: 'assignee' };
  if (known.some(isAdultMember)) return { kind: 'hidden' }; // a parent owns it → only assignees see it
  const kids = known.filter((m) => !m.isPet); // already non-adult — any adult would have returned above
  if (kids.length > 0) {
    return isAdultMember(viewer)
      ? { kind: 'forChild', childNames: kids.map((m) => m.name) }
      : { kind: 'hidden' }; // other children don't get this kid's item
  }
  return viewer.isPet ? { kind: 'hidden' } : { kind: 'unassigned' }; // none / all-stale / pet-only
}

/**
 * Single-owner sibling of `classifyAudience` for Beanie Lists (#33), which have
 * one `ownerId` rather than an `assigneeIds` array. Returns the SAME
 * `BriefingAudience` union so the briefing's message-key selection works
 * unchanged. Same rule, single-owner shape:
 *   • You own it                         → 'assignee'.
 *   • An adult owns it                   → 'hidden' (only they see it).
 *   • A child owns it                    → adults see it framed by the child
 *     ('forChild'); siblings don't ('hidden').
 *   • Unowned / pet-owned                → everyone non-pet sees it ('unassigned').
 * Pets never get a briefing.
 */
export function classifyOwnerAudience(
  ownerId: string | null | undefined,
  viewer: FamilyMember,
  resolveMember: (id: string) => FamilyMember | undefined
): BriefingAudience {
  const owner = ownerId ? resolveMember(ownerId) : undefined;
  if (owner && owner.id === viewer.id) return { kind: 'assignee' };
  if (owner && isAdultMember(owner)) return { kind: 'hidden' };
  if (owner && !owner.isPet) {
    return isAdultMember(viewer)
      ? { kind: 'forChild', childNames: [owner.name] }
      : { kind: 'hidden' };
  }
  return viewer.isPet ? { kind: 'hidden' } : { kind: 'unassigned' };
}
