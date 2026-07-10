/**
 * E2E Data Bridge — dev-only window bridge for Playwright tests.
 *
 * Exposes `window.__e2eDataBridge` with `exportData()` and `seedData()` that
 * read the main-thread `projection` and write via `docClient` (ADR-032).
 *
 * Persistence across `page.goto()` reloads: the Automerge binary is pre-staged
 * (worker `exportSnapshot` on `visibilitychange:hidden` and after each seed),
 * then written to sessionStorage synchronously on `beforeunload` (a `beforeunload`
 * handler can't await a worker RPC). App.vue restores it via `docClient.loadSnapshot`.
 */

import {
  list as projectionList,
  getSettings as projectionGetSettings,
} from '@/services/automerge/projection';
import * as docClient from '@/services/automerge/worker/docClient';
import { bufferToBase64 } from '@/utils/encoding';
import { COLLECTION_NAMES } from '@/types/automerge';
import type { FamilyDocument, CollectionName, CollectionEntity } from '@/types/automerge';
import type { MutationOp } from '@/services/automerge/worker/protocol';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { removeFamily } from '@/services/registry/registryService';

/** sessionStorage key for the persisted Automerge binary */
export const E2E_SEED_KEY = '__e2eSeedDoc';

/**
 * Collections stored as Record<string, Entity> in the Automerge doc.
 *
 * Derived from `COLLECTION_NAMES`, never hand-listed. A hand-maintained subset
 * drifts silently: `seedData` skips any collection missing here, so seeding (say)
 * a vacation would be dropped without an error and the page would render its
 * empty state while the run still passed. Deriving it means a new collection in
 * the document is seedable and exportable the moment it exists.
 */
const COLLECTIONS: readonly CollectionName[] = COLLECTION_NAMES;

/** The most recent serialized doc binary (base64), pre-staged for a sync unload. */
let stagedSnapshot: string | null = null;

export function initDataBridge(): void {
  if (!import.meta.env.DEV) return;

  (window as unknown as Record<string, unknown>).__e2eDataBridge = {
    exportData() {
      const result: Record<string, unknown> = {};
      for (const col of COLLECTIONS) {
        result[col] = projectionList(col);
      }
      result.settings = projectionGetSettings() ?? undefined;
      // Already plain (projection stores materialized objects), but round-trip
      // for parity with the old proxy-stripping contract.
      return JSON.parse(JSON.stringify(result));
    },

    /**
     * E2E afterEach cleanup hook — removes the active family from the registry.
     * Fire-and-forget. Returns the familyId that was deleted (or null).
     */
    async cleanupActiveFamily(): Promise<string | null> {
      const id = getActiveFamilyId();
      if (!id) return null;
      await removeFamily(id);
      return id;
    },

    /**
     * Pre-stage the current worker doc binary into sessionStorage-ready form so
     * it survives the next full-page reload (`page.goto`). Called by the E2E
     * navigation helper before every programmatic navigation.
     *
     * Why this is needed: with the ADR-032 worker migration, reload-persistence
     * for a memory-provider family (no configured `.beanpod` file → App.vue init
     * Path 3) comes ONLY from the `__e2eSeedDoc` snapshot. That snapshot was
     * previously staged solely by `seedData()` / `visibilitychange:hidden`, so
     * data created through the REAL create-a-family UI (never seeded, and
     * `page.goto` doesn't fire `visibilitychange:hidden`) was lost on the first
     * reload — leaving the family with 0 members. Staging on navigation closes
     * that gap for UI-created data.
     */
    async stageSnapshot(): Promise<void> {
      await refreshSnapshot();
    },

    async seedData(data: Partial<Record<keyof FamilyDocument, unknown>>) {
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
      // Pre-stage the binary so it's in sessionStorage before the reload.
      await refreshSnapshot();
    },
  };

  // Pre-stage the snapshot when the tab is about to hide (fires while the page is
  // still alive), so the sync beforeunload handler only reads a ready value.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && sessionStorage.getItem('e2e_auto_auth') === 'true') {
      void refreshSnapshot();
    }
  });

  // Synchronous write on unload — no await (beforeunload can't).
  window.addEventListener('beforeunload', () => {
    if (sessionStorage.getItem('e2e_auto_auth') !== 'true') return;
    if (stagedSnapshot) sessionStorage.setItem(E2E_SEED_KEY, stagedSnapshot);
  });
}

/** Fetch the current doc binary from the worker and stage it (base64). */
async function refreshSnapshot(): Promise<void> {
  try {
    const { binary } = await docClient.exportSnapshot();
    stagedSnapshot = bufferToBase64(binary);
  } catch {
    // Doc might not be initialized yet — leave the previous staged value.
  }
}
