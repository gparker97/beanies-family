/**
 * E2E Data Bridge — dev-only window bridge for Playwright tests.
 *
 * Exposes `window.__e2eDataBridge` with `exportData()` and `seedData()`
 * that read/write the in-memory Automerge document directly, replacing
 * the old per-entity IndexedDB approach.
 *
 * Also auto-saves the Automerge binary to sessionStorage on page unload
 * so all data survives `page.goto()` reloads during E2E tests.
 */

import { getDoc, changeDoc, saveDoc } from '@/services/automerge/docService';
import { bufferToBase64 } from '@/utils/encoding';
import type { FamilyDocument, CollectionName } from '@/types/automerge';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { removeFamily } from '@/services/registry/registryService';

/** sessionStorage key for the persisted Automerge binary */
export const E2E_SEED_KEY = '__e2eSeedDoc';

/** Collections stored as Record<string, Entity> in the Automerge doc */
const COLLECTIONS: CollectionName[] = [
  'familyMembers',
  'accounts',
  'transactions',
  'assets',
  'goals',
  'recurringItems',
  'todos',
  'activities',
];

export function initDataBridge(): void {
  if (!import.meta.env.DEV) return;

  (window as unknown as Record<string, unknown>).__e2eDataBridge = {
    exportData() {
      const doc = getDoc();
      const result: Record<string, unknown> = {};

      for (const col of COLLECTIONS) {
        result[col] = Object.values(doc[col] ?? {});
      }
      result.settings = doc.settings ?? undefined;

      // Strip Automerge Proxy wrappers for safe structured-cloning
      return JSON.parse(JSON.stringify(result));
    },

    /**
     * E2E afterEach cleanup hook — removes the active family from the
     * registry DDB table so test pods don't accumulate. Fire-and-forget
     * (registryService.removeFamily already swallows errors). Returns
     * the familyId that was deleted (or null if none was active) so the
     * Playwright helper can log it.
     */
    async cleanupActiveFamily(): Promise<string | null> {
      const id = getActiveFamilyId();
      if (!id) return null;
      await removeFamily(id);
      return id;
    },

    seedData(data: Partial<Record<keyof FamilyDocument, unknown>>) {
      changeDoc((doc) => {
        for (const col of COLLECTIONS) {
          const items = data[col] as Array<{ id: string }> | undefined;
          if (!items) continue;
          for (const item of items) {
            (doc[col] as Record<string, unknown>)[item.id] = item;
          }
        }
        if (data.settings !== undefined) {
          doc.settings = data.settings as FamilyDocument['settings'];
        }
      }, 'e2e: seed data');

      // Snapshot now so it's in sessionStorage before the reload
      snapshotDoc();
    },
  };

  // Auto-save the Automerge doc to sessionStorage before every page unload.
  // This ensures data created through the UI (not just seedData) survives
  // the full page reloads triggered by page.goto() in E2E tests.
  window.addEventListener('beforeunload', () => {
    if (sessionStorage.getItem('e2e_auto_auth') !== 'true') return;
    snapshotDoc();
  });
}

/** Serialize the current Automerge doc to sessionStorage (synchronous). */
function snapshotDoc(): void {
  try {
    const binary = saveDoc();
    sessionStorage.setItem(E2E_SEED_KEY, bufferToBase64(binary));
  } catch {
    // Doc might not be initialized yet — ignore
  }
}
