import { Page } from '@playwright/test';
import type { ExportedData } from '@/services/indexeddb/database';

export class IndexedDBHelper {
  constructor(private page: Page) {}

  async clearAllData() {
    // Clear all object stores using native IndexedDB APIs
    // This works even when the database is open
    await this.page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const request = indexedDB.open('gp-family-finance', 3);

        request.onsuccess = () => {
          const db = request.result;
          const stores = [
            'familyMembers',
            'accounts',
            'transactions',
            'assets',
            'goals',
            'recurringItems',
            'settings',
          ];

          try {
            const tx = db.transaction(stores, 'readwrite');

            stores.forEach((storeName) => {
              tx.objectStore(storeName).clear();
            });

            tx.oncomplete = () => {
              db.close();
              resolve();
            };

            tx.onerror = () => {
              db.close();
              resolve();
            };
          } catch {
            db.close();
            resolve();
          }
        };

        request.onerror = () => {
          // If database doesn't exist yet, that's fine
          resolve();
        };
      });
    });
    await this.page.waitForTimeout(500);
  }

  async seedData(data: Partial<ExportedData>) {
    await this.page.evaluate((testData) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('gp-family-finance', 3);

        request.onsuccess = () => {
          const db = request.result;

          try {
            const storeNames = [];
            if (testData.familyMembers) storeNames.push('familyMembers');
            if (testData.accounts) storeNames.push('accounts');
            if (testData.transactions) storeNames.push('transactions');
            if (testData.assets) storeNames.push('assets');
            if (testData.goals) storeNames.push('goals');
            if (testData.recurringItems) storeNames.push('recurringItems');
            if (testData.settings) storeNames.push('settings');

            const tx = db.transaction(storeNames, 'readwrite');

            if (testData.familyMembers) {
              const store = tx.objectStore('familyMembers');
              testData.familyMembers.forEach((member) => store.add(member));
            }
            if (testData.accounts) {
              const store = tx.objectStore('accounts');
              testData.accounts.forEach((account) => store.add(account));
            }
            if (testData.transactions) {
              const store = tx.objectStore('transactions');
              testData.transactions.forEach((transaction) => store.add(transaction));
            }
            if (testData.assets) {
              const store = tx.objectStore('assets');
              testData.assets.forEach((asset) => store.add(asset));
            }
            if (testData.goals) {
              const store = tx.objectStore('goals');
              testData.goals.forEach((goal) => store.add(goal));
            }
            if (testData.recurringItems) {
              const store = tx.objectStore('recurringItems');
              testData.recurringItems.forEach((item) => store.add(item));
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
    }, data);
    await this.page.reload();
  }

  async exportData(): Promise<ExportedData> {
    return await this.page.evaluate(() => {
      return new Promise<ExportedData>((resolve, reject) => {
        const request = indexedDB.open('gp-family-finance', 3);

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
              settings: undefined,
            };

            const requests = [
              tx.objectStore('familyMembers').getAll(),
              tx.objectStore('accounts').getAll(),
              tx.objectStore('transactions').getAll(),
              tx.objectStore('assets').getAll(),
              tx.objectStore('goals').getAll(),
              tx.objectStore('recurringItems').getAll(),
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
    });
  }
}
