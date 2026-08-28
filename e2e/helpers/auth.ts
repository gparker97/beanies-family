import { type Page } from '@playwright/test';
import { ui } from './ui-strings';

const E2E_PIN = '123456';
// Distinctive name so any future registry-table scrub can grep for it. The E2E
// suite also calls deleteFamilyFromRegistry() in afterEach to clean up; this
// name is the safety net for failed tests that crash before teardown.
const E2E_FAMILY_NAME = 'E2E Test Family';

/**
 * Drive the create-a-family flow from WelcomeGate up to the add-members step,
 * leaving the Finish button visible (NOT yet clicked).
 *
 * The unified flow finishes on the `ResumePodSetup` surface, which calls
 * `createNewFile` and so needs a real `StorageProvider`. The storage connect
 * (OS save-file picker / Drive OAuth) is the ONE step Playwright can't drive
 * headless, so we inject a DEV in-memory provider via
 * `__e2eCreatePod.installMemoryProvider` and drive everything else through the
 * REAL UI: step-1 identity, the step-2 Continue hand-off, then the finish
 * surface's PIN entry (Phase 4: families are born password-free) and the
 * mandatory recovery-kit confirmation.
 */
async function createUpToMembers(page: Page, familyName = E2E_FAMILY_NAME): Promise<void> {
  // Step 1 — identity only (no password; it moved to the finish surface).
  await page.getByLabel(ui('auth.familyName')).fill(familyName);
  await page.getByLabel(ui('setup.yourName')).fill('John Doe');
  await page.getByLabel(ui('form.email')).fill('john@example.com');
  await page.getByRole('button', { name: ui('loginV6.createNext') }).click();

  // Step 2 — inject the headless provider (the only un-automatable piece), then
  // drive the real Continue hand-off to the finish surface.
  await page
    .getByText(ui('loginV6.storageSectionLabel'))
    .waitFor({ state: 'visible', timeout: 10000 });
  await page.evaluate(async () => {
    await (
      window as unknown as { __e2eCreatePod?: { installMemoryProvider: () => Promise<void> } }
    ).__e2eCreatePod?.installMemoryProvider();
  });
  // The step-2 CTA enables once storage is marked connected.
  await page.getByRole('button', { name: ui('loginV6.createNext') }).click();

  // Finish surface (ResumePodSetup) — identity phase: set the 6-digit PIN ONCE
  // (Phase 4). PinInput exposes a hidden input carrying the aria-label.
  const pinField = page.getByLabel(ui('setup.choosePinLabel'));
  await pinField.waitFor({ state: 'visible', timeout: 10000 });
  await pinField.fill(E2E_PIN);
  await page.getByLabel(ui('pin.confirmPin')).fill(E2E_PIN);
  await page.getByRole('button', { name: ui('action.continue') }).click();

  // Recovery-kit phase (Phase 4, mandatory): the one-time kit modal — confirm stored.
  const kitStored = page.getByRole('button', { name: ui('recovery.kitConfirmStored') });
  await kitStored.waitFor({ state: 'visible', timeout: 15000 });
  await kitStored.click();

  // Members phase — the Finish button is the marker we leave visible.
  await page
    .getByRole('button', { name: ui('loginV6.finish') })
    .waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * Navigates through the create flow to the Add Family Members step.
 * Useful for tests that need to interact with the members step directly.
 * (Replaces the old `navigateToSetupStep3` — there is no "step 3" anymore;
 * members live on the finish surface.)
 */
export async function navigateToAddMembers(page: Page): Promise<void> {
  const createPodButton = page.getByTestId('create-pod-button');
  await createPodButton.waitFor({ state: 'visible', timeout: 5000 });

  // Set auto-auth flag before clicking create so InviteGateOverlay and
  // TrustDeviceModal are both suppressed in E2E.
  await page.evaluate(() => {
    sessionStorage.setItem('e2e_auto_auth', 'true');
  });
  await createPodButton.click();

  await createUpToMembers(page);
}

/**
 * Bypasses the login page for E2E tests.
 *
 * On first call (fresh browser context after clearAllData): walks through the
 * WelcomeGate → create flow (identity → injected storage → password → members),
 * clicks Finish, then waits for /nook.
 *
 * On subsequent calls within the same test: the auto-auth flag is already set,
 * so the app skips login automatically.
 *
 * `familyName` defaults to `E2E_FAMILY_NAME` — do NOT change that default; it is
 * the registry-scrub safety net. The store-listing / promo harnesses pass a
 * presentable name instead ("E2E Test Family" on a Play screenshot is a bad look);
 * they run against a memory provider + mocked registry, so nothing is persisted.
 */
export async function bypassLoginIfNeeded(
  page: Page,
  opts: { familyName?: string } = {}
): Promise<void> {
  const createPodButton = page.getByTestId('create-pod-button');

  const isOnWelcome = await createPodButton
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (isOnWelcome) {
    // Set auto-auth flag BEFORE clicking create so InviteGateOverlay and
    // TrustDeviceModal are both suppressed in E2E.
    await page.evaluate(() => {
      sessionStorage.setItem('e2e_auto_auth', 'true');
    });

    await createPodButton.click();
    await createUpToMembers(page, opts.familyName);

    // Members step → finish (goes to /nook).
    await page.getByRole('button', { name: ui('loginV6.finish') }).click();
  }

  await page.waitForURL('/nook', { timeout: 60000 });

  // Wait for data loading to complete — the ContentSkeleton covers the
  // router-view until isLoadingData becomes false. Without this, tests
  // timeout trying to click elements hidden behind the skeleton.
  await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });

  // Dismiss TrustDeviceModal if it appears (triggered by freshSignIn).
  // The modal races with navigation, so give it a short window to show up.
  const notNowButton = page.getByRole('button', { name: ui('trust.notNow') });
  const modalAppeared = await notNowButton
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (modalAppeared) {
    await notNowButton.click();
  }

  // Ensure auto-auth flag is set for subsequent page loads
  await page.evaluate(() => {
    sessionStorage.setItem('e2e_auto_auth', 'true');
  });
}
