/**
 * Who Owns What (#109) — the complete write surface for `responsibilityCards`,
 * `responsibilityMoves` and `responsibilityCheckIns`.
 *
 * Every write and every delete for the deck lives in this one file, and it COMPUTES
 * NOTHING: each decision about what to write is made by the pure builders in
 * `src/utils/responsibilityOps.ts`, and `applyDeckOps` writes their precomputed ops as ONE
 * Automerge change. A reviewer can audit the whole data-loss surface by reading the
 * builders that emit `deleteState` / `deleteMove` plus this file.
 *
 * Load-bearing rules:
 *   - Card state is always written WHOLE (`set`), never patched. Two adults dealing the
 *     same card at once resolve to one complete version (last writer wins per card), and a
 *     delete racing a deal on another device can only resurrect a complete record.
 *   - Moves and check-ins are WRITE-ONCE. There is no update path; do not add one.
 *   - The ONLY paths that delete moves are `deleteCustom` (that card's moves),
 *     `restoreDefaults` (every move) and `undo` of a move the same session just created.
 *     Check-ins are never deleted.
 *
 * NOTE the caller cannot read success from the return value: a batch mutation resolves to
 * `undefined`. The store verifies with `isDeckOpApplied` (a projection read) instead.
 */
import { createAutomergeRepository, stripUndefined, toPlain } from '../automergeRepository';
import { getById } from '../projection';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';
import type { DeckOp } from '@/utils/responsibilityOps';
import type {
  ResponsibilityCardState,
  ResponsibilityCheckIn,
  ResponsibilityMove,
} from '@/types/models';

const cardRepo = createAutomergeRepository<'responsibilityCards', ResponsibilityCardState>(
  'responsibilityCards'
);
const moveRepo = createAutomergeRepository<'responsibilityMoves', ResponsibilityMove>(
  'responsibilityMoves'
);
const checkInRepo = createAutomergeRepository<'responsibilityCheckIns', ResponsibilityCheckIn>(
  'responsibilityCheckIns'
);

export const getAllCardStates = cardRepo.getAll;
export const getAllMoves = moveRepo.getAll;
export const getAllCheckIns = checkInRepo.getAll;

function toMutation(op: DeckOp): MutationOp {
  switch (op.op) {
    case 'setState':
      return {
        op: 'set',
        collection: 'responsibilityCards',
        id: op.state.id,
        // Automerge rejects `undefined`; `toPlain` also drops it from nested parts.
        entity: toPlain(stripUndefined(op.state)),
      };
    case 'deleteState':
      return { op: 'delete', collection: 'responsibilityCards', id: op.id };
    case 'setMove':
      return {
        op: 'set',
        collection: 'responsibilityMoves',
        id: op.move.id,
        entity: toPlain(stripUndefined(op.move)),
      };
    case 'deleteMove':
      return { op: 'delete', collection: 'responsibilityMoves', id: op.id };
    case 'setCheckIn':
      return {
        op: 'set',
        collection: 'responsibilityCheckIns',
        id: op.checkIn.id,
        entity: toPlain(stripUndefined(op.checkIn)),
      };
  }
}

/**
 * Write a builder's ops as ONE Automerge change (a batch is atomic: a mid-batch throw
 * commits nothing). A `delete` of an id that is already gone is a no-op in the worker, so
 * an op list built from a slightly stale read cannot abort the batch.
 */
export async function applyDeckOps(ops: readonly DeckOp[]): Promise<void> {
  if (!ops.length) return;
  await mutate({ op: 'batch', ops: ops.map(toMutation) });
}

/** Did this op land? Read from the projection, which the worker updates before `mutate` resolves. */
export function isDeckOpApplied(op: DeckOp): boolean {
  switch (op.op) {
    case 'setState':
      return getById('responsibilityCards', op.state.id)?.updatedAt === op.state.updatedAt;
    case 'deleteState':
      return !getById('responsibilityCards', op.id);
    case 'setMove':
      return !!getById('responsibilityMoves', op.move.id);
    case 'deleteMove':
      return !getById('responsibilityMoves', op.id);
    case 'setCheckIn':
      return (
        getById('responsibilityCheckIns', op.checkIn.id)?.completedAt === op.checkIn.completedAt
      );
  }
}
