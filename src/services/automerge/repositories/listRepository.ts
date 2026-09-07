import { createAutomergeRepository, stripUndefined, toPlain } from '../automergeRepository';
import { getById as projectionGetById } from '../projection';
import { mutate } from '../worker/docClient';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';
import type { MutationOp } from '../worker/protocol';
import type { FamilyList, CreateFamilyListInput, UpdateFamilyListInput } from '@/types/models';

const repo = createAutomergeRepository<
  'lists',
  FamilyList,
  CreateFamilyListInput,
  UpdateFamilyListInput
>('lists');

export const getAllLists = repo.getAll;
export const getListById = repo.getById;
export const createList = repo.create;
export const updateList = repo.update;
export const deleteList = repo.remove;

/**
 * Create several lists as ONE Automerge change.
 *
 * Atomic by construction — a batch is exactly one `Automerge.change`, so a mid-batch
 * throw commits nothing. That is the whole reason this exists rather than a loop over
 * `createList`: N separate creates would be N changes, N worker round-trips, N sync
 * payloads and N chances to leave the family with a half-finished set of copies.
 *
 * NOTE a batch mutation resolves to `undefined`, so success cannot be read from the
 * return value — hence the projection verify below. Same shape as
 * `listCycleRepository.archiveCycleAndReset`.
 */
export async function createLists(inputs: CreateFamilyListInput[]): Promise<FamilyList[]> {
  // An empty batch is a pointless change, projection delta and sync payload.
  // `deleteCycles` sets this precedent.
  if (!inputs.length) return [];

  const now = toISODateString(new Date());
  const entities = inputs.map(
    (input) =>
      toPlain(
        stripUndefined({
          ...(input as Record<string, unknown>),
          id: generateUUID(),
          createdAt: now,
          updatedAt: now,
        })
      ) as unknown as FamilyList
  );

  const ops: MutationOp[] = entities.map((entity) => ({
    op: 'set',
    collection: 'lists',
    id: entity.id,
    entity,
  }));

  await mutate({ op: 'batch', ops });

  // This is NOT a guard against the worker writing nothing — a `set` cannot silently
  // no-op the way a `patch`/`delete` with `onMissing: 'skip'` can. It guards the
  // PROJECTION DELTA application, which the store's array mirror and every subsequent
  // read (including `deleteList`'s own existence check) depend on. Without it, a write
  // that never landed where readers look would be recorded as a success here and only
  // surface much later as an inexplicable missing list.
  const missing = entities.filter((e) => !projectionGetById('lists', e.id));
  if (missing.length) {
    throw new Error(
      `createLists: ${missing.length} of ${entities.length} lists missing from the projection after a batch write`
    );
  }

  return entities;
}
