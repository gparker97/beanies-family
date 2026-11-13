import { useFamilyStore } from '@/stores/familyStore';
import { formatNameList, listAssignees, membersByIds } from '@/utils/assignees';
import type { FamilyMember } from '@/types/models';

/** Anything with a list's ownership pair: a `FamilyList` or an archived `ListCycle`. */
type ListOwnership = { ownerId: string; assigneeIds?: string[] };

/**
 * Who a list (or an archived cycle) is for, as people (#147): every assignee the roster still
 * knows, owner first, read through the one reader (`listAssignees`). The one lookup every list
 * surface renders (tiles, cards, drawers, the wall), so none of them rebuilds it. Reactive
 * inside a computed or a template, since it reads `familyStore.members`.
 */
export function useListPeople() {
  const familyStore = useFamilyStore();
  const peopleOf = (entity: ListOwnership): FamilyMember[] =>
    membersByIds(familyStore.members, listAssignees(entity));
  /** "Greg, Sam & Jill"; '' when none of the list's people is a member we know. */
  const namesOf = (entity: ListOwnership): string =>
    formatNameList(peopleOf(entity).map((m) => m.name));
  return { peopleOf, namesOf };
}
