import { type Page } from '@playwright/test';

const E2E_PASSWORD = 'test1234';

/**
 * Bypasses the login page for E2E tests.
 *
 * On first call (fresh browser context after clearAllData): walks through
 * the WelcomeGate → Create Pod wizard then navigates to /dashboard.
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

    // Step 2: Storage & pod password
    // The Local button triggers showSaveFilePicker (native OS dialog) which
    // cannot be automated in headless browsers. Skip to step 3 using the
    // dev-mode E2E hook exposed by CreatePodView.
    await page.evaluate(() => {
      (window as any).__e2eCreatePod?.setStep(3);
    });

    // Wait for step 3 to render
    await page.getByRole('button', { name: 'Finish' }).waitFor({ state: 'visible', timeout: 5000 });

    // Step 3: Add family members — finish (goes to /dashboard)
    await page.getByRole('button', { name: 'Finish' }).click();
  }

  await page.waitForURL('/dashboard');

  // Store auto-auth flag so subsequent page loads skip login
  await page.evaluate(() => {
    sessionStorage.setItem('e2e_auto_auth', 'true');
  });
}
