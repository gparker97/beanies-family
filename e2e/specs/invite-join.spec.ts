import { test, expect } from '../fixtures/test';
import type { Route } from '@playwright/test';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { IndexedDBHelper } from '../helpers/indexeddb';
test.describe('Magic Link Invite System', () => {
  test('Invite wizard: add member, walk through Step 1 → Step 2, verify QR', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    // Navigate to The Pod (/family auto-redirects to /pod as of 2026-04).
    await page.goto('/pod');
    await page.waitForURL(/\/pod(\/|$)/);

    // --- Part 1: Add member, wizard auto-opens at Step 1 ---

    const addButton = page.getByRole('button', { name: /add (bean|a beanie)/i });
    await addButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const nameInput = dialog.getByPlaceholder(/name/i);
    await nameInput.fill('Test Beanie');

    const saveButton = dialog.getByRole('button', { name: /save|add/i });
    await saveButton.click();

    // Wizard opens with Step 1 visible (email field + confirmation checkbox).
    // Scope by step-content testid since BaseModal doesn't forward attrs.
    const step1 = page.locator('[data-testid="invite-wizard-step-1"]');
    await expect(step1).toBeVisible({ timeout: 5000 });

    // --- Part 2: Walk Step 1 — fill email, confirm, submit ---

    const emailInput = page.locator('[data-testid="invite-email-input"]');
    await emailInput.fill('test.invitee@example.com');

    const submitButton = page.locator('[data-testid="invite-wizard-submit"]');
    // Submit is disabled until the confirmation checkbox is ticked.
    await expect(submitButton).toBeDisabled();

    // The checkbox is sr-only (visually replaced by a custom box); use force to
    // skip the visibility check since the wrapping <label> is the visible target.
    const confirmCheckbox = page.locator('[data-testid="invite-wizard-confirm-checkbox"]');
    await confirmCheckbox.check({ force: true });
    await expect(submitButton).toBeEnabled();

    await submitButton.click();

    // --- Part 3: Step 2 renders QR + channels + back button ---

    const step2 = page.locator('[data-testid="invite-wizard-step-2"]');
    await expect(step2).toBeVisible({ timeout: 5000 });

    const qr = page.locator('[data-testid="invite-wizard-qr"]');
    await expect(qr).toBeVisible({ timeout: 5000 });
    const qrSrc = await qr.getAttribute('src');
    expect(qrSrc).toContain('data:image/png');

    // Channel grid + copy-link row from ShareChannelGrid.
    await expect(page.locator('[data-testid="invite-channel-whatsapp"]')).toBeVisible();
    await expect(page.locator('[data-testid="invite-copy-link"]')).toBeVisible();

    // Back link returns to Step 1 with email retained but checkbox unticked.
    await page.locator('[data-testid="invite-wizard-back"]').click();
    await expect(step1).toBeVisible();
    await expect(emailInput).toHaveValue('test.invitee@example.com');
    await expect(confirmCheckbox).not.toBeChecked();
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

    // The new useJoinFlow defers cloud auto-load to a user gesture when no
    // silent token is available (which is always the case in tests), so
    // the user lands on `awaiting-auth` with the Picker CTA visible —
    // ready to be tapped. The picker button is the canonical and only
    // recovery path for Drive-backed joiners; the rev-3 plan deliberately
    // removed the local-file fallback for cloud joiners (it would have
    // created an orphaned standalone copy of the data).
    const pickerButton = page.getByRole('button', { name: /select file from drive/i });
    await expect(pickerButton).toBeVisible({ timeout: 15000 });

    // The local-file drop zone is NOT shown for google_drive invites —
    // there's no "load from device" link or drop zone. Negative assert
    // so a future regression that re-introduces the fallback is caught.
    await expect(page.getByText(/or load a file from your device/i)).not.toBeVisible();
  });
});
