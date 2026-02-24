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

      // Verify family code is displayed
      const codeBlock = modal.locator('code').nth(1);
      const codeText = await codeBlock.textContent();
      expect(codeText).toBeTruthy();
      // Family code should be a UUID
      expect(codeText!.trim()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // Verify file sharing info card is visible
      await expect(modal.getByText(/share the .beanpod file/i)).toBeVisible();

      // Verify role toggle is NOT present (removed in this update)
      await expect(modal.getByText(/parent/i, { exact: true })).not.toBeVisible();
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
    test('should show manual code entry when navigating to /join without params', async ({
      page,
    }) => {
      await page.goto('/join');

      // Should show the join title
      await expect(page.getByText('Join your family')).toBeVisible();

      // Should show the manual code input
      await expect(page.getByLabel(/family code/i)).toBeVisible();

      // Should show "What happens next?" card
      await expect(page.getByText(/what happens next/i)).toBeVisible();

      // Should show the 3 steps
      await expect(page.getByText(/verify your family and load the data file/i)).toBeVisible();
      await expect(page.getByText(/pick your profile and create a password/i)).toBeVisible();

      // Should have a Next button
      await expect(page.getByRole('button', { name: /next/i })).toBeVisible();

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

    test('should submit manual code and attempt lookup', async ({ page }) => {
      await page.goto('/join');

      // Enter a family code
      const input = page.getByLabel(/family code/i);
      await input.fill('12345678-aaaa-bbbb-cccc-123456789abc');

      // Click Next
      await page.getByRole('button', { name: /next/i }).click();

      // Should attempt lookup (spinner or result)
      // Since API is not configured, it will show fallback
      await page.waitForTimeout(2000);
      const result = page.getByText(/family not found|load .beanpod file/i).first();
      await expect(result).toBeVisible({ timeout: 10000 });
    });
  });
});
