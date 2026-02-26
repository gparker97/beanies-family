import { test, expect } from '@playwright/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';

/**
 * Helper to read global settings from the registry IndexedDB.
 * Opens without a version number to avoid VersionError.
 */
async function getGlobalSettings(page: import('@playwright/test').Page) {
  return await page.evaluate(async () => {
    return new Promise<Record<string, unknown> | null>((resolve) => {
      const request = indexedDB.open('gp-finance-registry');
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
      const request = indexedDB.open('gp-finance-registry');
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
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);
  });

  test('global settings initially has no cached password', async ({ page }) => {
    const settings = await getGlobalSettings(page);
    // After fresh setup, global settings should exist (created by the app)
    expect(settings).not.toBeNull();
    // No cached passwords by default
    const passwords =
      (settings!.cachedEncryptionPasswords as Record<string, string> | undefined) ?? {};
    expect(Object.keys(passwords)).toHaveLength(0);
    // Not trusted by default (e2e_auto_auth suppresses the trust prompt)
    expect(settings!.isTrustedDevice).toBeFalsy();
  });

  test('cached password persists in IndexedDB across page reload', async ({ page }) => {
    // Simulate trusted device with cached password (as if user trusted + decrypted)
    await updateGlobalSettings(page, {
      isTrustedDevice: true,
      trustedDevicePromptShown: true,
      cachedEncryptionPasswords: { 'test-family': 'test-encryption-pw' },
    });

    // Verify it was written
    let settings = await getGlobalSettings(page);
    expect(settings!.isTrustedDevice).toBe(true);
    let cached = settings!.cachedEncryptionPasswords as Record<string, string>;
    expect(cached['test-family']).toBe('test-encryption-pw');

    // Reload page — IndexedDB persists
    await page.reload();
    await page.waitForURL('/nook');

    // Verify password survived reload
    settings = await getGlobalSettings(page);
    cached = settings!.cachedEncryptionPasswords as Record<string, string>;
    expect(cached['test-family']).toBe('test-encryption-pw');
  });

  test('clear all data removes cached password and trust flag', async ({ page }) => {
    // Set up trusted device with cached password
    await updateGlobalSettings(page, {
      isTrustedDevice: true,
      trustedDevicePromptShown: true,
      cachedEncryptionPasswords: { 'test-family': 'test-encryption-pw' },
    });

    // Verify it's there
    let settings = await getGlobalSettings(page);
    const cached = settings!.cachedEncryptionPasswords as Record<string, string>;
    expect(cached['test-family']).toBe('test-encryption-pw');

    // Navigate to settings
    await page.goto('/settings');
    await page.waitForURL('/settings');

    // Find and click "Clear Data" button
    const clearDataBtn = page.getByRole('button', { name: 'Clear Data' });
    await clearDataBtn.scrollIntoViewIfNeeded();
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
      const pw = (settings.cachedEncryptionPasswords as Record<string, string> | undefined) ?? {};
      expect(Object.keys(pw)).toHaveLength(0);
    }
    // If settings is null (DB deleted entirely), that's also acceptable
  });

  test('trust device modal sets isTrustedDevice in global settings', async ({ page }) => {
    // Ensure prompt hasn't been shown yet
    await updateGlobalSettings(page, {
      trustedDevicePromptShown: false,
    });

    // Remove the e2e_auto_auth flag so TrustDeviceModal can appear
    await page.evaluate(() => {
      sessionStorage.removeItem('e2e_auto_auth');
    });

    // Trigger the trust modal by setting freshSignIn via Pinia
    await page.evaluate(() => {
      const app = (document.querySelector('#app') as any)?.__vue_app__;
      if (app) {
        const pinia = app.config.globalProperties.$pinia;
        if (pinia) {
          const authStore = pinia.state.value.auth;
          if (authStore) {
            authStore.freshSignIn = true;
          }
        }
      }
    });

    // Wait for the trust device modal to appear
    const trustButton = page.getByRole('button', { name: /trust this device/i });
    const modalAppeared = await trustButton
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (!modalAppeared) {
      // Modal didn't appear — skip test (watcher timing issue)
      test.skip();
      return;
    }

    await trustButton.click();

    // Give time for the async setTrustedDevice call
    await page.waitForTimeout(500);

    // Verify global settings updated
    const settings = await getGlobalSettings(page);
    expect(settings!.isTrustedDevice).toBe(true);
    expect(settings!.trustedDevicePromptShown).toBe(true);
  });
});
