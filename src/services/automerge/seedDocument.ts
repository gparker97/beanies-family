/**
 * Batch-seed whole entities into the Automerge document.
 *
 * Extracted from the E2E data bridge (`services/e2e/dataBridge.ts`), which had
 * been the only caller until the store-review demo mode needed exactly the same
 * thing: put a pile of pre-built entities into the doc without going through the
 * entity stores.
 *
 * Going through the stores is the wrong tool for bulk seeding. `createTransaction`
 * and friends fire celebration overlays, push a Plausible `feature_used` event per
 * record, and cascade balance / goal / loan recalculation — all correct for a user
 * typing one transaction, all wrong (and slow: N serial worker round-trips) for
 * writing sixty at once. This does one batched mutation instead, and the caller
 * refreshes store state afterwards via `syncStore.reloadAllStores()`.
 *
 * NOTE: unlike `dataBridge`, this module is NOT dev-gated — it ships in
 * production because demo mode calls it there. It is a thin wrapper over
 * `docClient.mutate`, which already ships, so it adds no meaningful surface.
 */

import * as docClient from '@/services/automerge/worker/docClient';
import { COLLECTION_NAMES } from '@/types/automerge';
import type { FamilyDocument, CollectionName, CollectionEntity } from '@/types/automerge';
import type { MutationOp } from '@/services/automerge/worker/protocol';

/**
 * Collections stored as Record<string, Entity> in the Automerge doc.
 *
 * Derived from `COLLECTION_NAMES`, never hand-listed. A hand-maintained subset
 * drifts silently: any collection missing here is skipped without an error, so
 * seeding (say) a vacation would be dropped and the page would render its empty
 * state with nothing to explain why. Deriving it means a new collection in the
 * document is seedable the moment it exists.
 */
const COLLECTIONS: readonly CollectionName[] = COLLECTION_NAMES;

/**
 * Write whole entities into the doc in ONE batched worker mutation, plus
 * `data.settings` via the `setSettings` named mutation when present.
 *
 * Returns the number of entities written, for telemetry.
 *
 * THROWS if the mutation fails — callers decide how to surface it. Both current
 * callers do (the demo tears the partial session down and reports; the E2E
 * bridge fails the test).
 */
export async function seedDocument(
  data: Partial<Record<keyof FamilyDocument, unknown>>
): Promise<number> {
  const ops: MutationOp[] = [];
  for (const col of COLLECTIONS) {
    const items = data[col] as Array<{ id: string }> | undefined;
    if (!items) continue;
    for (const item of items) {
      ops.push({ op: 'set', collection: col, id: item.id, entity: item });
    }
  }
  if (ops.length) await docClient.mutate({ op: 'batch', ops });
  if (data.settings !== undefined) {
    await docClient.mutate({
      op: 'named',
      name: 'setSettings',
      args: { settings: data.settings as CollectionEntity<'familyMembers'> },
    });
  }
  return ops.length;
}
