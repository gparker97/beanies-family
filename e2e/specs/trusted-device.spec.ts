import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { ui } from '../helpers/ui-strings';

/**
 * Helper to read global settings from the registry IndexedDB.
 * Opens without a version number to avoid VersionError.
 */
async function getGlobalSettings(page: import('@playwright/test').Page) {
  return await page.evaluate(async () => {
    return new Promise<Record<string, unknown> | null>((resolve) => {
      const request = indexedDB.open('beanies-registry');
      request.onsuccess = () => {
        const db = request.result;
        try {
          if (!db.objectStoreNames.contains('globalSettings')) {
            db.close();
            resolve(null);
            return;
          }
          const tx = db.transaction('globalSettings', 'readonly');
          const store = tx.objectStore('globalSettings');
          const get = store.get('global_settings');
          get.onsuccess = () => {
            db.close();
            resolve((get.result as Record<string, unknown>) ?? null);
          };
          get.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  });
}

/**
 * Helper to update global settings in the registry IndexedDB.
 * Opens without a version number to avoid VersionError.
 */
async function updateGlobalSettings(
  page: import('@playwright/test').Page,
  updates: Record<string, unknown>
) {
  await page.evaluate(async (updates) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('beanies-registry');
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction('globalSettings', 'readwrite');
          const store = tx.objectStore('globalSettings');
          const get = store.get('global_settings');
          get.onsuccess = () => {
            const existing = (get.result as Record<string, unknown>) ?? {
              id: 'global_settings',
            };
            const updated = { ...existing, ...updates };
            store.put(updated);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
        } catch (e) {
          db.close();
          reject(e);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }, updates);
}

test.describe('Trusted Device Password Cache', () => {
  // Firefox on CI can be slow during the create-pod flow in beforeEach
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);
  });

  test('Password cache lifecycle: set, persist across reload, clear all data removes it', async ({
    page,
  }) => {
    // --- Phase 1: Set cached password and verify persistence across reload ---

    // Simulate trusted device with cached password (as if user trusted + decrypted)
    await updateGlobalSettings(page, {
      isTrustedDevice: true,
      trustedDevicePromptShown: true,
      cachedFamilyKeys: { 'test-family': 'test-encryption-pw' },
    });

    // Verify it was written
    let settings = await getGlobalSettings(page);
    expect(settings!.isTrustedDevice).toBe(true);
    let cached = settings!.cachedFamilyKeys as Record<string, string>;
    expect(cached['test-family']).toBe('test-encryption-pw');

    // Reload page — IndexedDB persists
    await page.reload();
    await page.waitForURL('/nook');

    // Verify password survived reload
    settings = await getGlobalSettings(page);
    cached = settings!.cachedFamilyKeys as Record<string, string>;
    expect(cached['test-family']).toBe('test-encryption-pw');

    // --- Phase 2: Clear all data removes cached password and trust flag ---

    // Navigate to settings and open Data Management modal
    await page.goto('/settings');
    await page.waitForURL('/settings');
    await page.getByText(ui('settings.dataManagement')).first().click();

    // Find and click "Clear Data" button inside the modal
    const clearDataBtn = page.getByRole('button', { name: ui('settings.clearData') });
    await clearDataBtn.waitFor({ state: 'visible', timeout: 5000 });
    await clearDataBtn.click();

    // Confirm the destructive action
    const confirmBtn = page.getByRole('button', { name: /yes.*delete/i });
    await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
    await confirmBtn.click();

    // Wait for app to process clear + reload
    await page.waitForTimeout(2000);

    // After clearing all data, the registry DB should be deleted
    settings = await getGlobalSettings(page);
    if (settings) {
      // If settings still exist, passwords should be cleared
      const pw = (settings.cachedFamilyKeys as Record<string, string> | undefined) ?? {};
      expect(Object.keys(pw)).toHaveLength(0);
    }
    // If settings is null (DB deleted entirely), that's also acceptable
  });
});
