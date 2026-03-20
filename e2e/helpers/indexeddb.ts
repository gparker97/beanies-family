import { Page } from '@playwright/test';
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
  Settings,
} from '@/types/models';

/** Shape of data exported/seeded via the E2E IndexedDB helper. */
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
  }

  async exportData(): Promise<ExportedData> {
    return await this.page.evaluate(() =>
      (window as unknown as Record<string, any>).__e2eDataBridge.exportData()
    );
  }
}
