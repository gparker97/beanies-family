import { Page } from '@playwright/test';
import type { ExportedData } from '@/services/indexeddb/database';

export class IndexedDBHelper {
  constructor(private page: Page) {}

  async clearAllData() {
    await this.page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('gp-family-finance');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      });
    });
    await this.page.waitForTimeout(500);
  }

  async seedData(data: Partial<ExportedData>) {
    await this.page.evaluate((testData) => {
      return new Promise<void>((resolve) => {
        (async () => {
          const { openDB } = await import('idb');
          const db = await openDB('gp-family-finance', 3);

          if (testData.familyMembers) {
            for (const member of testData.familyMembers) {
              await db.add('familyMembers', member);
            }
          }
          if (testData.accounts) {
            for (const account of testData.accounts) {
              await db.add('accounts', account);
            }
          }
          if (testData.transactions) {
            for (const transaction of testData.transactions) {
              await db.add('transactions', transaction);
            }
          }
          if (testData.assets) {
            for (const asset of testData.assets) {
              await db.add('assets', asset);
            }
          }
          if (testData.goals) {
            for (const goal of testData.goals) {
              await db.add('goals', goal);
            }
          }
          if (testData.recurringItems) {
            for (const item of testData.recurringItems) {
              await db.add('recurringItems', item);
            }
          }
          if (testData.settings) {
            await db.put('settings', testData.settings);
          }

          resolve();
        })();
      });
    }, data);
    await this.page.reload();
  }

  async exportData(): Promise<ExportedData> {
    return await this.page.evaluate(() => {
      return new Promise<ExportedData>((resolve) => {
        (async () => {
          const { openDB } = await import('idb');
          const db = await openDB('gp-family-finance', 3);

          const data = {
            familyMembers: await db.getAll('familyMembers'),
            accounts: await db.getAll('accounts'),
            transactions: await db.getAll('transactions'),
            assets: await db.getAll('assets'),
            goals: await db.getAll('goals'),
            recurringItems: await db.getAll('recurringItems'),
            settings: (await db.get('settings', 'app_settings')) || undefined,
          };
          resolve(data);
        })();
      });
    });
  }
}
