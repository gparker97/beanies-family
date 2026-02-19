import { type Page } from '@playwright/test';

/**
 * Bypasses the login page if Cognito auth is configured.
 *
 * When Cognito env vars are set the app redirects to /login and shows a
 * "Continue without an account" button. When Cognito is not configured the
 * app runs in local-only mode and skips the login page entirely, going
 * straight to /setup. This helper handles both cases gracefully.
 */
export async function bypassLoginIfNeeded(page: Page): Promise<void> {
  const continueButton = page.getByRole('button', { name: 'Continue without an account' });

  const isOnLoginPage = await continueButton
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);

  if (isOnLoginPage) {
    await continueButton.click();
  }

  await page.waitForURL('/setup');
}
