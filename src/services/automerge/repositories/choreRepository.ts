/**
 * The choreboard (#146): the complete write surface for `chores` and `choreMarks`.
 *
 * Every write and every delete for chores lives in this one file, and it computes nothing:
 * which ids to write or delete is decided by `choreStore` and the pure rules in
 * `src/utils/chores.ts`. A reviewer can audit the whole data-loss surface by reading it top to
 * bottom.
 *
 * Load-bearing rules:
 *   - A chore is created whole (a `set`) and edited with a based `patch` (the factory's
 *     `update`), so a peer's concurrent edit to another field is kept.
 *   - A mark is WRITE-ONCE with a DETERMINISTIC id (`choreMarkId`). A tick is a `set` of that
 *     id, so two devices that tick the same chore converge on one record, and two devices that
 *     each make a bean's first tick of the day while offline keep both (one record per fact,
 *     never one record per bean per day). An untick is a `remove`. There is no update path for
 *     marks; do not add one.
 *   - A batch is ONE Automerge change: a mid-batch throw commits nothing.
 */
import {
  createAutomergeRepository,
  patchOp,
  stripUndefined,
  toPlain,
} from '../automergeRepository';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';
import { toISODateString } from '@/utils/date';
import type { Chore, ChoreMark } from '@/types/models';

const choreRepo = createAutomergeRepository<'chores', Chore>('chores');
const markRepo = createAutomergeRepository<'choreMarks', ChoreMark>('choreMarks');

export type CreateChoreInput = Omit<Chore, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateChoreInput = Partial<CreateChoreInput>;
export type ChoreMarkInput = Omit<ChoreMark, 'id' | 'createdAt' | 'updatedAt'>;

export const getAllChores = choreRepo.getAll;
export const getAllChoreMarks = markRepo.getAll;

/**
 * New chores in ONE change (one chore, a starter set, a copy). The caller mints the ids. With
 * `ifAbsent`, an id already in the projection is left as it is (never overwritten) and only
 * the chores this call created are returned.
 */
export const createChores = (
  items: readonly { id: string; input: CreateChoreInput }[],
  opts?: { ifAbsent?: boolean }
) => choreRepo.createManyWithIds(items, opts);

/** A based patch of one chore; `undefined` when it is gone (deleted here or on another device). */
export const updateChore = (id: string, input: UpdateChoreInput) => choreRepo.update(id, input);

/** A different patch for each of several chores, in ONE change (reorder). Missing ids skip. */
export const updateChores = (items: readonly { id: string; patch: UpdateChoreInput }[]) =>
  choreRepo.patchEach(items, { onMissing: 'skip' });

/** Delete one chore. Its old marks stay: readers ignore marks for an unknown chore. */
export const deleteChore = (id: string): Promise<boolean> => choreRepo.remove(id);

/**
 * Take chores off the board in ONE change (Delete on a bean's day, one or many): delete each of
 * `deleteIds`, and give each of `reassign` its new `assigneeIds` (a shared chore removed for one
 * bean). Takes ids and computes nothing: WHICH chores go and who stays is `choreStore`'s
 * decision. A chore already gone is a no-op either way (`delete` of an absent key changes
 * nothing; the patch skips), so a concurrent delete on another device never fails the batch.
 * Old marks stay, as for `deleteChore`.
 */
export async function removeChores(
  deleteIds: readonly string[],
  reassign: readonly { id: string; assigneeIds: readonly string[] }[]
): Promise<void> {
  const now = toISODateString(new Date());
  const ops: MutationOp[] = [
    ...deleteIds.map((id): MutationOp => ({ op: 'delete', collection: 'chores', id })),
    // `patchOp` reads each chore's own base, so the worker edits `assigneeIds` per item and a
    // bean a peer added concurrently survives the merge.
    ...reassign.map(({ id, assigneeIds }) =>
      patchOp(
        'chores',
        id,
        toPlain(stripUndefined({ assigneeIds: [...assigneeIds] })) as Record<string, unknown>,
        { updatedAt: now, onMissing: 'skip' }
      )
    ),
  ];
  if (ops.length) await mutate({ op: 'batch', ops });
}

/**
 * Write marks by their deterministic ids in ONE change. With `ifAbsent`, a mark already in the
 * projection is left as it is and not rewritten, which is what makes the `celebrated` mark
 * once-only across devices. Returns the marks this call created.
 */
export const setChoreMarks = (
  items: readonly { id: string; input: ChoreMarkInput }[],
  opts?: { ifAbsent?: boolean }
): Promise<ChoreMark[]> => markRepo.createManyWithIds(items, opts);

/** Remove one mark (an untick). `false` when it was already gone. */
export const removeChoreMark = (id: string): Promise<boolean> => markRepo.remove(id);

/**
 * Delete exactly the mark ids given, in ONE change (the retention sweep). Takes ids and
 * computes nothing: WHICH ids is the pure `expiredMarkIds`. An id already gone is a no-op.
 */
export const removeChoreMarks = (ids: readonly string[]): Promise<void> => markRepo.removeMany(ids);
