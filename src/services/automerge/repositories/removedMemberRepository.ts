/**
 * The complete write surface for `removedMembers` (tracker #77).
 *
 * A removal is recorded in the SAME Automerge change that deletes the member's row, so no
 * device can ever see the row gone without the record, or the record without the row gone.
 * The record is write-once and never deleted: it is the authenticated fact every
 * destructive eviction step keys on (see `RemovedMember` in models.ts).
 */
import { createAutomergeRepository, stripUndefined, toPlain } from '../automergeRepository';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';
import type { RemovedMember, UUID } from '@/types/models';
import { toISODateString } from '@/utils/date';

const repo = createAutomergeRepository<'removedMembers', RemovedMember>('removedMembers');

export const getAllRemovedMembers = repo.getAll;

/**
 * Delete a member's row and record the removal as ONE change (a batch is exactly one
 * `Automerge.change`, so a throw commits neither half).
 *
 * The row delete is a plain `delete`: the worker no-ops a delete of an id that is already
 * gone, so a removal racing another device's removal of the same member converges.
 */
export async function removeMemberAndRecord(
  memberId: UUID,
  removedByMemberId: UUID | null
): Promise<void> {
  const now = toISODateString(new Date());
  const record: RemovedMember = {
    id: memberId,
    removedAt: now,
    removedByMemberId,
    createdAt: now,
    updatedAt: now,
  };
  const ops: MutationOp[] = [
    { op: 'delete', collection: 'familyMembers', id: memberId },
    {
      op: 'set',
      collection: 'removedMembers',
      id: memberId,
      entity: toPlain(stripUndefined(record)),
    },
  ];
  await mutate({ op: 'batch', ops });
}
