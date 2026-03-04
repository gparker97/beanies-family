import { test, expect } from '@playwright/test';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { IndexedDBHelper } from '../helpers/indexeddb';

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

      // Open invite modal
      const inviteButton = page.getByRole('button', { name: /invite/i });
      await inviteButton.click();

      // Verify modal is open
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      // Verify invite link contains new format params
      const linkCode = modal.locator('code').first();
      const linkText = await linkCode.textContent();
      expect(linkText).toContain('/join?fam=');
      expect(linkText).toContain('&p=local');
      expect(linkText).toContain('&ref=');

      // Verify QR code is displayed
      const qrImage = modal.locator('[data-testid="invite-qr"]');
      await expect(qrImage).toBeVisible();
      const qrSrc = await qrImage.getAttribute('src');
      expect(qrSrc).toContain('data:image/png');

      // Verify invite link code block
      const codeBlocks = modal.locator('[data-testid="invite-link-code"]');
      await expect(codeBlocks).toHaveCount(1);

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

      // Click "Add Member"
      const addButton = page.getByRole('button', { name: /add member/i });
      await addButton.click();

      // Fill out form — find name input in the dialog
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const nameInput = dialog.getByLabel(/name/i);
      await nameInput.fill('Test Beanie');

      // Save
      const saveButton = dialog.getByRole('button', { name: /save|add/i });
      await saveButton.click();

      // Verify invite modal opens automatically with QR + link
      const inviteModal = page.getByRole('dialog');
      await expect(inviteModal).toBeVisible({ timeout: 5000 });
      await expect(inviteModal.locator('[data-testid="invite-qr"]')).toBeVisible({ timeout: 5000 });
      await expect(inviteModal.locator('[data-testid="invite-link-code"]')).toBeVisible();
    });

    // Clipboard permissions only work in Chromium
    test('should copy invite link to clipboard', async ({ page, context, browserName }) => {
      test.skip(browserName !== 'chromium', 'Clipboard API permissions only supported in Chromium');
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      await page.goto('/');
      const dbHelper = new IndexedDBHelper(page);
      await dbHelper.clearAllData();
      await page.goto('/');
      await bypassLoginIfNeeded(page);

      await page.goto('/family');
      await page.waitForURL('/family');

      // Open invite modal and copy link
      await page.getByRole('button', { name: /invite/i }).click();
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      // Click copy link button
      const copyLinkButton = modal.getByRole('button', { name: /copy link/i });
      await copyLinkButton.click();

      // Verify "Copied!" feedback
      await expect(modal.getByText(/copied/i)).toBeVisible();

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
      await expect(page.getByText('Join your family')).toBeVisible();

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
      await expect(page.getByRole('button', { name: 'Create a new pod' })).toBeVisible();
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
  });
});
