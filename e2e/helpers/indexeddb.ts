import { Page } from '@playwright/test';
import type { ExportedData } from '@/services/indexeddb/database';

export class IndexedDBHelper {
  constructor(private page: Page) {}

  /**
   * Find the active per-family database name by reading the registry.
   * Falls back to looking for any gp-family-finance-* database.
   */
  private async getActiveFamilyDbName(): Promise<string | null> {
    return await this.page.evaluate(async () => {
      // Try reading the registry DB to find lastActiveFamilyId
      try {
        const registryDb = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('gp-finance-registry', 1);
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
          return `gp-family-finance-${settings.lastActiveFamilyId}`;
        }
      } catch {
        // Registry doesn't exist yet
      }

      // Fallback: find any gp-family-finance-* database
      if ('databases' in indexedDB) {
        const dbs = await indexedDB.databases();
        const familyDb = dbs.find((db) => db.name?.startsWith('gp-family-finance-'));
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
              db.name?.startsWith('gp-family-finance') ||
              db.name === 'gp-finance-registry' ||
              db.name === 'gp-finance-file-handles'
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
        const knownNames = ['gp-family-finance', 'gp-finance-registry', 'gp-finance-file-handles'];
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
    // Find the active per-family database name
    const dbName = await this.getActiveFamilyDbName();

    await this.page.evaluate(
      ({ testData, familyDbName }) => {
        return new Promise<void>((resolve, reject) => {
          // Use the per-family DB name, or fall back to legacy name for migration
          const targetDb = familyDbName || 'gp-family-finance';
          const request = indexedDB.open(targetDb, 4);

          request.onsuccess = () => {
            const db = request.result;

            try {
              const storeNames: string[] = [];
              if (testData.familyMembers) storeNames.push('familyMembers');
              if (testData.accounts) storeNames.push('accounts');
              if (testData.transactions) storeNames.push('transactions');
              if (testData.assets) storeNames.push('assets');
              if (testData.goals) storeNames.push('goals');
              if (testData.recurringItems) storeNames.push('recurringItems');
              if (testData.todos) storeNames.push('todos');
              if (testData.settings) storeNames.push('settings');

              const tx = db.transaction(storeNames, 'readwrite');

              if (testData.familyMembers) {
                const store = tx.objectStore('familyMembers');
                testData.familyMembers.forEach((member: unknown) => store.add(member));
              }
              if (testData.accounts) {
                const store = tx.objectStore('accounts');
                testData.accounts.forEach((account: unknown) => store.add(account));
              }
              if (testData.transactions) {
                const store = tx.objectStore('transactions');
                testData.transactions.forEach((transaction: unknown) => store.add(transaction));
              }
              if (testData.assets) {
                const store = tx.objectStore('assets');
                testData.assets.forEach((asset: unknown) => store.add(asset));
              }
              if (testData.goals) {
                const store = tx.objectStore('goals');
                testData.goals.forEach((goal: unknown) => store.add(goal));
              }
              if (testData.recurringItems) {
                const store = tx.objectStore('recurringItems');
                testData.recurringItems.forEach((item: unknown) => store.add(item));
              }
              if (testData.todos) {
                const store = tx.objectStore('todos');
                testData.todos.forEach((item: unknown) => store.add(item));
              }
              if (testData.settings) {
                const store = tx.objectStore('settings');
                store.put(testData.settings);
              }

              tx.oncomplete = () => {
                db.close();
                resolve();
              };

              tx.onerror = () => {
                db.close();
                reject(tx.error);
              };
            } catch (error) {
              db.close();
              reject(error);
            }
          };

          request.onerror = () => {
            reject(request.error);
          };
        });
      },
      { testData: data, familyDbName: dbName }
    );
    await this.page.reload();
  }

  async exportData(): Promise<ExportedData> {
    // Find the active per-family database name
    const dbName = await this.getActiveFamilyDbName();

    return await this.page.evaluate((familyDbName) => {
      return new Promise<ExportedData>((resolve, reject) => {
        const targetDb = familyDbName || 'gp-family-finance';
        const request = indexedDB.open(targetDb, 4);

        request.onsuccess = () => {
          const db = request.result;

          try {
            const tx = db.transaction(
              [
                'familyMembers',
                'accounts',
                'transactions',
                'assets',
                'goals',
                'recurringItems',
                'todos',
                'settings',
              ],
              'readonly'
            );

            const data: ExportedData = {
              familyMembers: [],
              accounts: [],
              transactions: [],
              assets: [],
              goals: [],
              recurringItems: [],
              todos: [],
              settings: undefined,
            };

            const requests = [
              tx.objectStore('familyMembers').getAll(),
              tx.objectStore('accounts').getAll(),
              tx.objectStore('transactions').getAll(),
              tx.objectStore('assets').getAll(),
              tx.objectStore('goals').getAll(),
              tx.objectStore('recurringItems').getAll(),
              tx.objectStore('todos').getAll(),
              tx.objectStore('settings').get('app_settings'),
            ];

            let completed = 0;
            const total = requests.length;

            requests.forEach((req, index) => {
              req.onsuccess = () => {
                switch (index) {
                  case 0:
                    data.familyMembers = req.result || [];
                    break;
                  case 1:
                    data.accounts = req.result || [];
                    break;
                  case 2:
                    data.transactions = req.result || [];
                    break;
                  case 3:
                    data.assets = req.result || [];
                    break;
                  case 4:
                    data.goals = req.result || [];
                    break;
                  case 5:
                    data.recurringItems = req.result || [];
                    break;
                  case 6:
                    data.todos = req.result || [];
                    break;
                  case 7:
                    data.settings = req.result || undefined;
                    break;
                }

                completed++;
                if (completed === total) {
                  db.close();
                  resolve(data);
                }
              };
            });

            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          } catch (error) {
            db.close();
            reject(error);
          }
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    }, dbName);
  }
}
