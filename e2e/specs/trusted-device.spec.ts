import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { gotoRoot, gotoRoute } from '../helpers/navigation';
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

/** Read one trustedAutoOpen record (Phase 4 wrapped key store). */
async function getTrustedAutoOpenRecord(page: import('@playwright/test').Page, familyId: string) {
  return await page.evaluate(async (familyId) => {
    return new Promise<Record<string, unknown> | null>((resolve) => {
      const request = indexedDB.open('beanies-registry');
      request.onsuccess = () => {
        const db = request.result;
        try {
          if (!db.objectStoreNames.contains('trustedAutoOpen')) {
            db.close();
            resolve(null);
            return;
          }
          const tx = db.transaction('trustedAutoOpen', 'readonly');
          const get = tx.objectStore('trustedAutoOpen').get(familyId);
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
  }, familyId);
}

/** Write a synthetic trustedAutoOpen record (opaque wrapped bytes — persistence-level test). */
async function putTrustedAutoOpenRecord(
  page: import('@playwright/test').Page,
  record: Record<string, unknown>
) {
  await page.evaluate(async (record) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('beanies-registry');
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction('trustedAutoOpen', 'readwrite');
          tx.objectStore('trustedAutoOpen').put(record);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        } catch (e) {
          db.close();
          reject(e);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }, record);
}

test.describe('Trusted Device Password Cache', () => {
  // Firefox on CI can be slow during the create-pod flow in beforeEach
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await gotoRoot(page);
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await gotoRoot(page);
    await bypassLoginIfNeeded(page);
  });

  // Webkit-CI quarantine (E2E_HEALTH 2026-05-16): `page.goto('/settings')` is
  // consistently interrupted by another navigation to '/nook' under sustained
  // webkit-CI contention, even with `waitUntil: 'commit'`. The race survives
  // 3 retries hard, every push, while passing 21/21 on chromium. Per the
  // 2026-05-13 entry's "quarantine the affected spec on webkit rather than
  // tuning more timeouts" guidance. Re-enable when we have a SPA-internal
  // navigation path here (or a webkit-CI gateway fix lands).
  test('Password cache lifecycle: set, persist across reload, clear all data removes it', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === 'webkit', 'webkit-CI: page.goto race (E2E_HEALTH 2026-05-16)');

    // --- Phase 1: Set the trusted auto-open key and verify persistence ---
    // Phase 4: the auto-open key lives WRAPPED in the registry's `trustedAutoOpen`
    // store (the plaintext `cachedFamilyKeys` is retired to a legacy-migration
    // remnant). Persistence-level test: opaque wrapped bytes are fine.
    await updateGlobalSettings(page, {
      isTrustedDevice: true,
      trustedDevicePromptShown: true,
      // Legacy plaintext remnant — clear-data must remove this too.
      cachedFamilyKeys: { 'test-family': 'legacy-remnant' },
    });
    await putTrustedAutoOpenRecord(page, {
      familyId: 'test-family',
      wrapped: 'opaque-wrapped-bytes',
      salt: 'opaque-salt',
      kdf: 'hkdf',
      createdAt: new Date().toISOString(),
    });

    // Verify both were written
    let settings = await getGlobalSettings(page);
    expect(settings!.isTrustedDevice).toBe(true);
    let record = await getTrustedAutoOpenRecord(page, 'test-family');
    expect(record?.wrapped).toBe('opaque-wrapped-bytes');

    // Reload page — IndexedDB persists
    await page.reload();
    await page.waitForURL('/nook');

    // Verify the wrapped record survived reload
    record = await getTrustedAutoOpenRecord(page, 'test-family');
    expect(record?.wrapped).toBe('opaque-wrapped-bytes');

    // --- Phase 2: Clear all data removes cached password and trust flag ---

    // Navigate to settings and open Data Management modal.
    await gotoRoute(page, '/settings');
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
      // If settings still exist, the legacy plaintext remnant must be cleared
      const pw = (settings.cachedFamilyKeys as Record<string, string> | undefined) ?? {};
      expect(Object.keys(pw)).toHaveLength(0);
    }
    // ...and the wrapped auto-open record must be gone either way.
    record = await getTrustedAutoOpenRecord(page, 'test-family');
    expect(record).toBeNull();
  });
});
