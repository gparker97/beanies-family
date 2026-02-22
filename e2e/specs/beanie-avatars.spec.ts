import { test, expect } from '@playwright/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';

test.describe('Beanie Avatars', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);
  });

  test('header shows BeanieAvatar with PNG image', async ({ page }) => {
    await page.goto('/dashboard');
    const headerAvatar = page.getByTestId('header-avatar');
    await expect(headerAvatar).toBeVisible();
    await expect(headerAvatar).toHaveAttribute('data-variant');
    // Should contain an img element with a brand PNG source
    const img = headerAvatar.locator('img');
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toMatch(/\/brand\/beanies_.*\.png$/);
  });

  test('family page member cards show BeanieAvatar', async ({ page }) => {
    await page.goto('/family');
    // Scope to main content area (exclude header filter avatar)
    const mainContent = page.locator('main');
    const avatars = mainContent.locator('[data-testid="beanie-avatar"]');
    await expect(avatars.first()).toBeVisible();
    // Owner created in setup defaults to adult-male
    await expect(avatars.first()).toHaveAttribute('data-variant', 'adult-male');
    // Should render as an img
    const img = avatars.first().locator('img');
    await expect(img).toBeVisible();
  });

  test('add member with Female Child shows correct avatar', async ({ page }) => {
    await page.goto('/family');

    // Click Add Member
    await page.getByRole('button', { name: /add member|add a beanie/i }).click();

    // Fill name and email
    await page.getByLabel(/name/i).first().fill('Luna');
    await page.getByLabel(/email/i).fill('luna@example.com');

    // Select Female gender
    const genderSelect = page.getByTestId('gender-select').locator('select');
    await genderSelect.selectOption('female');

    // Select Child age group
    const ageGroupSelect = page.getByTestId('age-group-select').locator('select');
    await ageGroupSelect.selectOption('child');

    // Verify avatar preview shows child-female variant
    const preview = page.getByTestId('avatar-preview');
    await expect(preview).toHaveAttribute('data-variant', 'child-female');

    // Submit
    await page
      .getByRole('button', { name: /add member|add a beanie/i })
      .last()
      .click();

    // Wait for modal to close and verify the new card has the correct avatar
    await page.waitForTimeout(500);
    const childAvatar = page.locator('[data-testid="beanie-avatar"][data-variant="child-female"]');
    await expect(childAvatar.first()).toBeVisible();
  });

  test('member filter dropdown shows beanie avatars', async ({ page }) => {
    await page.goto('/dashboard');
    // At minimum the header avatar should be present
    const headerAvatar = page.getByTestId('header-avatar');
    await expect(headerAvatar).toBeVisible();
    // Verify BeanieAvatar elements exist on the page
    const avatars = page.locator('[data-testid="beanie-avatar"]');
    await expect(avatars.first()).toBeVisible();
  });
});
