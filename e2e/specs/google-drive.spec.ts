import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { ui } from '../helpers/ui-strings';

test.describe('Google Drive Sync', () => {
  test('Google Drive text is visible on Load Pod view', async ({ page }) => {
    await page.goto('/welcome');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/welcome');

    // Click the Sign In card on the welcome gate. Match via the i18n key
    // rather than a copy-specific regex so future copy edits don't break
    // the selector. (Previously matched /load/i, which broke when the
    // 2026-05-18 WelcomeGate refresh renamed Sign In to "Welcome back".)
    const signInButton = page.getByRole('button', { name: ui('loginV6.signInTitle') });
    await signInButton.first().waitFor({ state: 'visible', timeout: 5000 });
    await signInButton.first().click();

    // Google Drive label should be visible (either as button or disabled div)
    const driveLabel = page.getByText(ui('googleDrive.storageLabel')).first();
    await expect(driveLabel).toBeVisible({ timeout: 5000 });
  });

  test('Google Drive option visible on Create Pod step 2', async ({ page }) => {
    // Kill the Vue app first so IndexedDB connections are released,
    // then revisit the origin to clear databases while unblocked.
    await page.goto('about:blank');
    await page.goto('/welcome');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    });
    // Destroy the Vue app again, then re-enter clean
    await page.goto('about:blank');
    await page.goto('/welcome');
    await page.waitForLoadState('networkidle');

    // Set e2e_auto_auth to bypass InviteGateOverlay
    await page.evaluate(() => {
      sessionStorage.setItem('e2e_auto_auth', 'true');
    });

    // Match the Create card by its stable testid — most resilient to copy
    // changes. (Previously /create/i, which broke when the 2026-05-18
    // WelcomeGate refresh renamed the card to "Plant a new pod".)
    const createButton = page.getByTestId('create-pod-button');
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

    await page
      .getByText(ui('loginV6.storageSectionLabel'))
      .waitFor({ state: 'visible', timeout: 10000 });

    // Google Drive should be listed as a storage option
    await expect(page.getByText(ui('googleDrive.storageLabel')).first()).toBeVisible();
  });
});
