import { type Page } from '@playwright/test';

const E2E_PASSWORD = 'test1234';

/**
 * Bypasses the login page for E2E tests.
 *
 * On first call (fresh browser context after clearAllData): walks through
 * the WelcomeGate → Create Pod 3-step wizard (name/password → storage →
 * members) which navigates directly to /dashboard.
 *
 * On subsequent calls within the same test: the auto-auth flag is
 * already set, so the app skips login automatically.
 */
export async function bypassLoginIfNeeded(page: Page): Promise<void> {
  const createPodButton = page.getByRole('button', { name: 'Create a new pod' });

  const isOnWelcome = await createPodButton
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (isOnWelcome) {
    await createPodButton.click();

    // Step 1: Name & Password
    await page.getByLabel('Family Name').fill('Test Family');
    await page.getByLabel('Your Name').fill('John Doe');
    await page.getByLabel('Email').fill('john@example.com');
    await page.getByLabel('Password').first().fill(E2E_PASSWORD);
    await page.getByLabel('Confirm password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2: Choose storage & set pod password
    // The Local button triggers showSaveFilePicker which can't be automated,
    // so we mock both File System Access API pickers before clicking.
    await page.evaluate(() => {
      const mockHandle = {
        kind: 'file',
        name: 'e2e-test.beanpod',
        createWritable: async () => ({
          write: async () => {},
          close: async () => {},
        }),
        getFile: async () => new File(['{}'], 'e2e-test.beanpod'),
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
      };
      (window as any).showSaveFilePicker = async () => mockHandle;
      (window as any).showOpenFilePicker = async () => [mockHandle];
    });
    await page.getByRole('button', { name: 'Local' }).click();
    // Wait for storage to be confirmed before filling password
    await page.waitForTimeout(500);
    await page.getByLabel('Pod data file encryption password').fill(E2E_PASSWORD);
    await page.getByLabel('Confirm pod password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3: Add family members — finish (goes to /dashboard)
    await page.getByRole('button', { name: 'Finish' }).click();
  }

  await page.waitForURL('/dashboard');

  // Store auto-auth flag so subsequent page loads skip login
  await page.evaluate(() => {
    sessionStorage.setItem('e2e_auto_auth', 'true');
  });
}
