import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';

test.describe('Homepage', () => {
  test('should show homepage when no families are cached', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');

    // Should redirect to /home
    await expect(page).toHaveURL('/home');

    // Should display brand headline
    await expect(page.locator('h1')).toContainText('every. bean.');
    await expect(page.locator('h1')).toContainText('counts.');
  });

  test('should navigate to welcome gate via Get Started', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');

    await expect(page).toHaveURL('/home');
    await page.getByTestId('homepage-get-started').click();
    await expect(page).toHaveURL('/welcome');

    // Should see the WelcomeGate
    await expect(page.getByTestId('create-pod-button')).toBeVisible();
  });

  test('should redirect to welcome (not homepage) when families exist', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');

    // Create a pod first (sets up a cached family)
    await bypassLoginIfNeeded(page);
    await expect(page).toHaveURL('/nook');

    // Clear auth session but keep family data
    await page.evaluate(() => {
      localStorage.removeItem('beanies_auth_session');
      sessionStorage.removeItem('e2e_auto_auth');
    });

    // Navigate again — should go to /welcome (not /home) since family is cached
    await page.goto('/');
    await expect(page).toHaveURL('/welcome');
  });

  test('welcome gate should have link back to homepage', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');

    // Go to welcome via Get Started
    await page.getByTestId('homepage-get-started').click();
    await expect(page).toHaveURL('/welcome');

    // Should see "Back to Homepage" button
    const backLink = page.getByText('Back to Homepage');
    await expect(backLink).toBeVisible();

    // Click it to go back to homepage
    await backLink.click();
    await expect(page).toHaveURL('/home');
  });
});
