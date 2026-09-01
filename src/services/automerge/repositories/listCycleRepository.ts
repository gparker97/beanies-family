/**
 * Finished cycles of recurring lists — the complete write surface for `listCycles`.
 *
 * Every write and (later) every delete for list history lives in this one file, on a
 * collection nothing else in the app reads. A reviewer can audit the whole data-loss
 * surface by reading it top to bottom.
 *
 * A cycle is **write-once**: set at rollover, never patched. That is load-bearing, not
 * incidental — it is why two devices archiving the same cycle converge on one record with
 * one intact `items` array rather than interleaving them, and why there is no
 * delete-vs-update resurrection hazard. Do not add an update path.
 */
import { createAutomergeRepository, stripUndefined, toPlain } from '../automergeRepository';
import { list } from '../projection';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';
import type { ListCycle, UpdateFamilyListInput } from '@/types/models';

const repo = createAutomergeRepository<'listCycles', ListCycle>('listCycles');

export const getAllCycles = repo.getAll;

/**
 * Archive the outgoing cycle AND reset the live list as ONE Automerge change.
 *
 * Atomic by construction — a batch is exactly one `Automerge.change`, so a mid-batch
 * throw commits neither half. A cycle can never be archived without its list being reset,
 * nor a list reset without its cycle being kept.
 *
 * NOTE the caller cannot read success from the return value: a batch mutation resolves to
 * `undefined`. The caller verifies with a projection read instead.
 */
export async function archiveCycleAndReset(
  cycle: ListCycle,
  listId: string,
  reset: UpdateFamilyListInput,
  nowIso: string
): Promise<void> {
  const ops: MutationOp[] = [
    {
      op: 'set',
      collection: 'listCycles',
      id: cycle.id,
      // `ListCycleMark.by` is optional, and Automerge rejects `undefined`. The repo
      // factory does this for its own writes; a hand-built batch must do it explicitly.
      entity: toPlain(stripUndefined(cycle)),
    },
    {
      op: 'patch',
      collection: 'lists',
      id: listId,
      patch: toPlain(stripUndefined(reset)) as Record<string, unknown>,
      updatedAt: nowIso,
      // `skip`, not the `throw` default. `reconcileRecurringLists` iterates a SNAPSHOT of
      // the lists it read, so a list deleted on another device and merged in afterwards
      // would abort the whole batch — on a background midnight or PWA-resume wake, and
      // with two error toasts (the worker's own plus the store's catch). The path this
      // replaced went through `repo.update`, which tolerated exactly this race silently.
      // Skipping is correct: no live list means there is nothing to reset, and the atomic
      // batch means the cycle is not archived either.
      onMissing: 'skip',
    },
  ];
  await mutate({ op: 'batch', ops });
}

/**
 * Delete exactly the cycle ids given. The ONLY delete-by-age path for this collection.
 *
 * Takes ids and computes nothing: every decision about WHICH ids belongs to the pure
 * `expiredCycleIds`, so the deletion rule is unit-testable without a document and cannot
 * quietly grow a dependency on another collection.
 *
 * A `delete` on an id that is already gone is a no-op in the worker, so an id list built
 * from a slightly stale read cannot abort the whole atomic batch.
 */
export async function deleteCycles(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const ops: MutationOp[] = ids.map((id) => ({ op: 'delete', collection: 'listCycles', id }));
  await mutate({ op: 'batch', ops });
}

/**
 * Delete a list together with its entire history, in one change.
 *
 * The intentional path, taken by a user who is present. Reads the projection for the ids
 * rather than a store array, so a stale array cannot leave an orphan behind.
 */
export async function deleteListWithCycles(listId: string): Promise<void> {
  const cycleIds = list('listCycles')
    .filter((c) => c.listId === listId)
    .map((c) => c.id);
  const ops: MutationOp[] = [
    ...cycleIds.map((id): MutationOp => ({ op: 'delete', collection: 'listCycles', id })),
    { op: 'delete', collection: 'lists', id: listId },
  ];
  await mutate({ op: 'batch', ops });
}
