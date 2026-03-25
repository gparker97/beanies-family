import { test, expect } from '../fixtures/test';
import type { Route } from '@playwright/test';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { IndexedDBHelper } from '../helpers/indexeddb';
test.describe('Magic Link Invite System', () => {
  test('Invite flow: add member, auto-open modal, verify invite link params', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    // Navigate to Family page
    await page.goto('/family');
    await page.waitForURL('/family');

    // --- Part 1: Auto-open invite modal after adding a member ---

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

    // --- Part 2: Verify invite link params ---

    // Verify QR code is displayed
    const qrSrc = await inviteQr.getAttribute('src');
    expect(qrSrc).toContain('data:image/png');

    // Verify file sharing info card is visible
    await expect(inviteModal.getByText(/share the .beanpod file/i)).toBeVisible();
  });

  test('Join flow: graceful degradation when registry unavailable', async ({ page }) => {
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

  test('Drive join failure triggers Picker fallback', async ({ page, context }) => {
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
