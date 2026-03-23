import { test, expect } from '../fixtures/test';
import type { Route } from '@playwright/test';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { ui } from '../helpers/ui-strings';

/** Add a family member so the invite button becomes visible. */
async function addTestMember(page: import('@playwright/test').Page) {
  const addButton = page.getByRole('button', { name: /add a beanie/i });
  await addButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const nameInput = dialog.getByPlaceholder(/name/i);
  await nameInput.fill('Test Beanie');
  const saveButton = dialog.getByRole('button', { name: /save|add/i });
  await saveButton.click();
  // Wait for invite modal to auto-open then close it
  const inviteQr = page.locator('[data-testid="invite-qr"]');
  await expect(inviteQr).toBeVisible({ timeout: 5000 });
  const closeButton = page.getByRole('dialog').getByRole('button', { name: /close/i });
  await closeButton.click();
  await expect(inviteQr).not.toBeVisible({ timeout: 3000 });
}

test.describe('Magic Link Invite System', () => {
  test.describe('Invite Modal (FamilyPage)', () => {
    test('should generate invite link with fam/p/ref params', async ({ page }) => {
      await page.goto('/');
      const dbHelper = new IndexedDBHelper(page);
      await dbHelper.clearAllData();
      await page.goto('/');
      await bypassLoginIfNeeded(page);

      // Navigate to Family page
      await page.goto('/family');
      await page.waitForURL('/family');

      // Add a member so the invite button becomes visible
      await addTestMember(page);

      // Open invite modal
      const inviteButton = page.getByRole('button', { name: /invite/i });
      await inviteButton.click();

      // Verify modal is open
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      // Verify QR code is displayed
      const qrImage = modal.locator('[data-testid="invite-qr"]');
      await expect(qrImage).toBeVisible();
      const qrSrc = await qrImage.getAttribute('src');
      expect(qrSrc).toContain('data:image/png');

      // Verify share button is present
      await expect(modal.getByRole('button', { name: /share/i })).toBeVisible();

      // Verify file sharing info card is visible
      await expect(modal.getByText(/share the .beanpod file/i)).toBeVisible();
    });

    test('should auto-open invite modal after adding a member', async ({ page }) => {
      await page.goto('/');
      const dbHelper = new IndexedDBHelper(page);
      await dbHelper.clearAllData();
      await page.goto('/');
      await bypassLoginIfNeeded(page);

      await page.goto('/family');
      await page.waitForURL('/family');

      // Click "+ Add a Beanie"
      const addButton = page.getByRole('button', { name: /add a beanie/i });
      await addButton.click();

      // Fill out form — find name input in the dialog
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const nameInput = dialog.getByPlaceholder(/name/i);
      await nameInput.fill('Test Beanie');

      // Save
      const saveButton = dialog.getByRole('button', { name: /save|add/i });
      await saveButton.click();

      // Verify invite modal opens automatically with QR code
      const inviteQr = page.locator('[data-testid="invite-qr"]');
      await expect(inviteQr).toBeVisible({ timeout: 5000 });
      const inviteModal = page
        .locator('[data-testid="invite-qr"]')
        .locator('xpath=ancestor::div[@role="dialog"]');
      await expect(inviteModal).toBeVisible({ timeout: 5000 });

      // Verify share button is present
      await expect(inviteModal.getByRole('button', { name: /share/i })).toBeVisible();
    });

    // Clipboard permissions only work in Chromium
    test('should copy invite link via share modal', async ({ page, context, browserName }) => {
      test.skip(browserName !== 'chromium', 'Clipboard API permissions only supported in Chromium');
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      await page.goto('/');
      const dbHelper = new IndexedDBHelper(page);
      await dbHelper.clearAllData();
      await page.goto('/');
      await bypassLoginIfNeeded(page);

      await page.goto('/family');
      await page.waitForURL('/family');

      // Add a member so the invite button becomes visible
      await addTestMember(page);

      // Open invite modal
      await page.getByRole('button', { name: /invite/i }).click();
      const modal = page.getByRole('dialog').first();
      await expect(modal).toBeVisible();

      // Click share button to open the share modal
      await modal.getByRole('button', { name: /share/i }).click();

      // Share modal should appear (overlay layer)
      const shareModal = page.getByRole('dialog').last();
      await expect(shareModal).toBeVisible();

      // Click "Copy Link" in the share modal
      const copyLinkButton = shareModal.getByRole('button', { name: /copy link/i });
      await copyLinkButton.click();

      // Verify "Copied!" feedback
      await expect(shareModal.getByText(/copied/i)).toBeVisible();

      // Verify clipboard contains the link
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toContain('/join?fam=');
      expect(clipboardText).toContain('&p=local');
    });
  });

  test.describe('Join Flow (JoinPodView)', () => {
    test('should show invite link instructions when navigating to /join without params', async ({
      page,
    }) => {
      await page.goto('/join');

      // Should show the join title
      await expect(page.getByText(ui('join.verifyTitle'))).toBeVisible();

      // Should show "How to join" instructional card with steps
      await expect(page.getByText(/how to join/i)).toBeVisible();
      await expect(page.getByText(/ask a parent or family admin/i)).toBeVisible();
      await expect(page.getByText(/tap invite to generate a magic link/i)).toBeVisible();
      await expect(page.getByText(/open the link on your device/i)).toBeVisible();

      // Should show expiry note
      await expect(page.getByText(/expire after 24 hours/i)).toBeVisible();

      // Should NOT show a manual code input
      await expect(page.getByLabel(/family code/i)).not.toBeVisible();

      // Should have a "Create a new pod" link
      await expect(page.getByRole('button', { name: /create a new pod/i })).toBeVisible();
    });

    test('should handle registry lookup gracefully when API is unavailable', async ({ page }) => {
      // Navigate with a fake family ID
      const fakeFamilyId = '12345678-1234-1234-1234-123456789abc';
      await page.goto(`/join?fam=${fakeFamilyId}&p=local&ref=dGVzdC5iZWFucG9k`);

      // Should show looking up message briefly, then family not found
      // Since registry API is not configured in test env, it will return null
      // Wait for lookup to complete
      await page.waitForTimeout(2000);

      // Should show the not-found/offline state with fallback to load file
      // Either the "Family not found" message or the file load button should appear
      const notFoundOrLoad = page.getByText(/family not found|load .beanpod file/i).first();
      await expect(notFoundOrLoad).toBeVisible({ timeout: 10000 });
    });

    test('should show back button that returns to welcome gate', async ({ page }) => {
      await page.goto('/join');

      // Click back
      await page.getByRole('button', { name: /back/i }).click();

      // Should return to welcome gate
      await expect(page.getByTestId('create-pod-button')).toBeVisible();
    });

    test('should navigate to create pod from join page', async ({ page }) => {
      await page.goto('/join');

      // Click "Create a new pod" link
      await page.getByRole('button', { name: /create a new pod/i }).click();

      // Should show create pod form
      await expect(page.getByText(/grow a brand-new pod/i)).toBeVisible({ timeout: 5000 });
    });

    test('should show loading state when navigating to /join with params', async ({ page }) => {
      const fakeFamilyId = '12345678-aaaa-bbbb-cccc-123456789abc';
      await page.goto(`/join?fam=${fakeFamilyId}&p=local&ref=dGVzdC5iZWFucG9k`);

      // Should attempt lookup and show a result (not the instructions screen)
      await page.waitForTimeout(2000);
      const result = page.getByText(/family not found|load .beanpod file/i).first();
      await expect(result).toBeVisible({ timeout: 10000 });
    });

    test('should show Google Picker prompt when Drive cloud load fails', async ({
      page,
      context,
    }) => {
      const fakeFamilyId = '12345678-dddd-eeee-ffff-123456789abc';
      const fakeFileId = 'fake-drive-file-id';

      // Mock the OAuth popup: when the app opens the Google auth window,
      // simulate a successful code exchange by intercepting the callback
      context.on('page', async (popup) => {
        // Close the popup immediately — the error from popup closing will trigger
        // the catch path in attemptFileLoad(), setting cloudLoadFailed = true
        await popup.close();
      });

      // Mock Drive API routes (in case OAuth somehow succeeds)
      await page.route(/googleapis\.com/, async (route: Route) => {
        const url = route.request().url();
        if (url.includes('userinfo')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ email: 'test@example.com' }),
          });
          return;
        }
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'File not found' } }),
        });
      });

      // Navigate to join with google_drive provider — triggers attemptFileLoad()
      await page.goto(
        `/join?fam=${fakeFamilyId}&p=google_drive&ref=dGVzdC5iZWFucG9k&fileId=${fakeFileId}`
      );

      // Wait for cloud load to fail (popup closes → error → cloudLoadFailed = true)
      // and show the picker prompt
      const pickerButton = page.getByRole('button', { name: /select file from drive/i });
      await expect(pickerButton).toBeVisible({ timeout: 15000 });

      // Should show the "or manual" fallback link
      await expect(page.getByText(/or load a file from your device/i)).toBeVisible();

      // Click the manual fallback link to expand the drop zone
      await page.getByText(/or load a file from your device/i).click();
      await expect(page.getByText(/drop.*beanpod|load.*beanpod/i).first()).toBeVisible();
    });
  });
});
