import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { ui } from '../helpers/ui-strings';

test.describe('Google Drive Sync', () => {
  test('Google Drive text is visible on Load Pod view', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');

    // Click through homepage to WelcomeGate
    await page.getByTestId('homepage-get-started').click();

    // Click "Load my pod" on welcome gate
    const loadButton = page.getByRole('button', { name: /load/i });
    await loadButton.first().waitFor({ state: 'visible', timeout: 5000 });
    await loadButton.first().click();

    // Google Drive label should be visible (either as button or disabled div)
    const driveLabel = page.getByText(ui('googleDrive.storageLabel')).first();
    await expect(driveLabel).toBeVisible({ timeout: 5000 });
  });

  test('Google Drive option visible on Create Pod step 2', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');

    // Click through homepage to WelcomeGate
    await page.getByTestId('homepage-get-started').click();

    // Set e2e_auto_auth before clicking create to bypass InviteGateOverlay
    await page.evaluate(() => {
      sessionStorage.setItem('e2e_auto_auth', 'true');
    });

    const createButton = page.getByRole('button', { name: /create/i }).first();
    await createButton.waitFor({ state: 'visible', timeout: 5000 });
    await createButton.click();

    // Wait for step 1 to render before filling — the WelcomeGate → CreatePodView
    // transition has raced clicks in CI, leaving us on WelcomeGate.
    await page.getByLabel('Family Name').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByLabel('Family Name').fill('E2E Drive Family');
    await page.getByLabel('Your Name').fill('Drive Test');
    await page.getByLabel('Email').fill('drive@test.com');
    await page.getByLabel('Password').first().fill('test12345');
    await page.getByLabel('Confirm password').fill('test12345');

    await page.getByRole('button', { name: ui('action.next') }).click();

    await page.getByText(ui('loginV6.step2Title')).waitFor({ state: 'visible', timeout: 10000 });

    // Google Drive should be listed as a storage option
    await expect(page.getByText(ui('googleDrive.storageLabel')).first()).toBeVisible();
  });
});
