import { Page, expect } from '@playwright/test';
import type {
  FamilyMember,
  Account,
  Transaction,
  Asset,
  Goal,
  RecurringItem,
  TodoItem,
  FamilyActivity,
  FamilyVacation,
  PhotoAttachment,
  FavoriteItem,
  SayingItem,
  Recipe,
  Medication,
  Allergy,
  Milestone,
  Settings,
} from '@/types/models';

/**
 * Shape of data exported/seeded via the E2E IndexedDB helper.
 *
 * The runtime bridge (`src/services/e2e/dataBridge.ts`) seeds every collection in
 * `COLLECTION_NAMES`, so anything in the document can be seeded. Only the
 * collections we actually use are typed here; add a key when you need it.
 */
export interface ExportedData {
  familyMembers: FamilyMember[];
  accounts: Account[];
  transactions: Transaction[];
  assets: Asset[];
  goals: Goal[];
  recurringItems: RecurringItem[];
  todos: TodoItem[];
  activities: FamilyActivity[];
  vacations?: FamilyVacation[];
  photos?: PhotoAttachment[];
  favorites?: FavoriteItem[];
  sayings?: SayingItem[];
  recipes?: Recipe[];
  medications?: Medication[];
  allergies?: Allergy[];
  milestones?: Milestone[];
  settings: Settings | undefined;
}

export class IndexedDBHelper {
  constructor(private page: Page) {}

  /**
   * Find the active per-family database name by reading the registry.
   * Falls back to looking for any beanies-data-{familyId} database.
   */
  private async getActiveFamilyDbName(): Promise<string | null> {
    return await this.page.evaluate(async () => {
      // Try reading the registry DB to find lastActiveFamilyId
      try {
        const registryDb = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('beanies-registry', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        const tx = registryDb.transaction('globalSettings', 'readonly');
        const store = tx.objectStore('globalSettings');
        const settings = await new Promise<{ lastActiveFamilyId?: string } | undefined>(
          (resolve) => {
            const req = store.get('global_settings');
            req.onsuccess = () => resolve(req.result as { lastActiveFamilyId?: string });
            req.onerror = () => resolve(undefined);
          }
        );
        registryDb.close();

        if (settings?.lastActiveFamilyId) {
          return `beanies-data-${settings.lastActiveFamilyId}`;
        }
      } catch {
        // Registry doesn't exist yet
      }

      // Fallback: find any beanies-data-* database
      if ('databases' in indexedDB) {
        const dbs = await indexedDB.databases();
        const familyDb = dbs.find((db) => db.name?.startsWith('beanies-data-'));
        if (familyDb?.name) {
          return familyDb.name;
        }
      }

      return null;
    });
  }

  async clearAllData() {
    // Delete all known databases to ensure clean state
    await this.page.evaluate(async () => {
      // Clear E2E auto-auth flag so the next load shows the login page
      sessionStorage.removeItem('e2e_auto_auth');
      // Clear any staged Automerge snapshot so a prior test's UI-created data
      // (now staged on every navigation, see gotoRoute) can't leak into the
      // next test via App.vue's init Path 3 restore.
      sessionStorage.removeItem('__e2eSeedDoc');
      // Use databases() API to find all databases to delete
      if ('databases' in indexedDB) {
        const dbs = await indexedDB.databases();
        const deletePromises = dbs
          .filter(
            (db) =>
              db.name?.startsWith('beanies-data') ||
              db.name?.startsWith('beanies-automerge') ||
              db.name === 'beanies-registry' ||
              db.name === 'beanies-file-handles'
          )
          .map(
            (db) =>
              new Promise<void>((resolve) => {
                if (!db.name) {
                  resolve();
                  return;
                }
                const request = indexedDB.deleteDatabase(db.name);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
              })
          );
        await Promise.all(deletePromises);
      } else {
        // Fallback: try known names
        const knownNames = ['beanies-data', 'beanies-registry', 'beanies-file-handles'];
        await Promise.all(
          knownNames.map(
            (name) =>
              new Promise<void>((resolve) => {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
              })
          )
        );
      }
    });
    await this.page.waitForTimeout(500);
  }

  async seedData(data: Partial<ExportedData>) {
    await this.page.evaluate(
      (d) => (window as unknown as Record<string, any>).__e2eDataBridge.seedData(d),
      data
    );
    await this.page.reload();
    // Wait for the app to finish restoring the seeded doc before returning.
    // `reload()` only awaits the `load` event; App.vue's snapshot restore into
    // the worker + store projection is async and completes AFTER load. Without
    // this gate the next navigation's `stageSnapshot` (see gotoRoute) can run
    // against a not-yet-restored (empty) doc and stage nothing, dropping the
    // seeded data on that reload — a race that surfaced webkit-only (slower
    // restore) as an empty account dropdown. `app-content` becomes visible only
    // once `isLoadingData` clears, so it is the same readiness signal
    // `bypassLoginIfNeeded` gates on.
    await this.page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });

    // `app-content` visible only proves `isLoadingData` cleared — it does NOT
    // prove the async snapshot restore has actually projected the seeded
    // collections into the live doc. On a slower browser under CI contention
    // (firefox in the 3-browser scheduled run, 2026-07-20) the restore can still
    // be in flight when this returns, so the next navigation's `stageSnapshot`
    // captures a not-yet-restored doc and drops the seed — the empty account
    // dropdown in financial-data:37 that the 2026-07-07 app-content gate fixed
    // for webkit but not firefox. Gate directly on the seeded data being
    // observable in the live projection (`exportData()` reads the same
    // projection the UI renders from), so the restore is provably complete
    // before we return. Browser-agnostic; supersedes the app-content-only gate.
    const expectedCounts: Record<string, number> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'settings' && Array.isArray(value) && value.length > 0) {
        expectedCounts[key] = value.length;
      }
    }
    if (Object.keys(expectedCounts).length > 0) {
      await expect
        .poll(
          () =>
            this.page.evaluate((counts) => {
              const exported = (
                window as unknown as Record<string, any>
              ).__e2eDataBridge.exportData() as Record<string, unknown[]>;
              return Object.entries(counts).every(
                ([col, n]) => (exported[col]?.length ?? 0) >= (n as number)
              );
            }, expectedCounts),
          {
            timeout: 30000,
            message:
              'seeded collections never projected into the live doc after reload — ' +
              'the async snapshot restore did not complete (see docs/E2E_HEALTH.md 2026-07-20)',
          }
        )
        .toBe(true);
    }
  }

  async exportData(): Promise<ExportedData> {
    return await this.page.evaluate(() =>
      (window as unknown as Record<string, any>).__e2eDataBridge.exportData()
    );
  }
}
