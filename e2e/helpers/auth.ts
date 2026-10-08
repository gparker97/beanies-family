import { expect, type Locator, type Page } from '@playwright/test';
import { ui } from './ui-strings';

const E2E_PIN = '123456';
// Distinctive name so any future registry-table scrub can grep for it. The E2E
// suite also calls deleteFamilyFromRegistry() in afterEach to clean up; this
// name is the safety net for failed tests that crash before teardown.
const E2E_FAMILY_NAME = 'E2E Test Family';

/**
 * Resolve once `locator`'s box has held the same position for several consecutive
 * animation frames. Playwright's own "stable" check compares only two frames, and the
 * login layout re-centres for ~300ms after a view swap (the Next button measured
 * 512 → 545 → 520 → 512px on webkit), so two matching frames mid-bounce let a click land
 * on the form's padding instead of the button: no submit, no error, a 10s timeout
 * (E2E_HEALTH 2026-09-30, `invite-join.spec.ts:7`).
 */
async function waitForSettled(locator: Locator, frames = 8): Promise<void> {
  await locator.evaluate(
    (el, need) =>
      new Promise<void>((resolve) => {
        let last = '';
        let same = 0;
        const deadline = performance.now() + 3000;
        const tick = () => {
          const r = el.getBoundingClientRect();
          const key = `${Math.round(r.left)},${Math.round(r.top)}`;
          same = key === last ? same + 1 : 0;
          last = key;
          if (same >= need || performance.now() > deadline) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames
  );
}

/**
 * Drive the create-a-family flow from WelcomeGate up to the add-members step,
 * leaving the members-step exit button ("I'll do this later") visible (NOT yet clicked).
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
  const step1Next = page.getByRole('button', { name: ui('loginV6.createNext') });
  await waitForSettled(step1Next);
  await step1Next.click();

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
  // Gate on the surface's own "ready for input" signal: PinInput autofocuses the first PIN
  // in `onMounted` after a `nextTick`, and on a heavy first render that focus landed
  // between Playwright focusing Confirm PIN and inserting its text, so the digits went to
  // the (already full) first PIN and Continue failed with "Please fill in all fields"
  // (E2E_HEALTH 2026-09-30, `invite-join.spec.ts:7`).
  await expect(pinField).toBeFocused({ timeout: 5000 });
  await pinField.fill(E2E_PIN);
  await page.getByLabel(ui('pin.confirmPin')).fill(E2E_PIN);
  await page.getByRole('button', { name: ui('action.continue') }).click();

  // Recovery-kit phase (Phase 4, mandatory): the one-time kit modal — confirm stored.
  //
  // The kit modal's single primary action is "Open my pod" (`recovery.kitOpenPod`).
  const kitStored = page.getByRole('button', { name: ui('recovery.kitOpenPod') }).first();
  await kitStored.waitFor({ state: 'visible', timeout: 15000 });

  // ⚠️ The confirm is GATED now (#97): it releases on save, share, or this acknowledgement.
  // A real PDF export is not something a spec should depend on, and the tick is the arm
  // that cannot fail — the same reason it exists for users. Without this the button stays
  // `disabled`, Playwright's actionability check blocks until timeout, and every spec that
  // calls `createPod()` (6 of 7) goes red.
  await page.getByTestId('kit-acknowledged').check();

  await kitStored.click();

  // Members phase — no member is added here, so the exit button reads "I'll do this later"
  // (`setup.addLater`); it only becomes "Finish" once a member exists. This is the marker.
  await page
    .getByRole('button', { name: ui('setup.addLater') })
    .waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * Answer the PIN step-up (`ReauthChallenge`) if a sensitive action raises it. The E2E
 * owner has the fixture PIN from the create flow, so a real owner is asked to verify
 * before destructive actions (Clear Data, delete family); a spec on a phantom 0-member
 * pod never was, which is how this was missed until #85 closed that fallback. Resolves
 * quietly when no challenge appears within `timeout`.
 */
export async function answerReauthIfAsked(page: Page, timeout = 5000): Promise<void> {
  const pinField = page.getByLabel(ui('pin.enterPin'));
  const asked = await pinField
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
  if (asked) await pinField.fill(E2E_PIN);
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

  // Wait for whichever screen the app settles on: the welcome gate (fresh context) or
  // the signed-in layout (auto-auth already set). A fixed short probe for the welcome
  // button alone lost the race on a cold worker: the gate rendered after the probe gave
  // up, nothing clicked Create, and the `/nook` wait below timed out (E2E_HEALTH
  // 2026-09-30, `cross-entity.spec.ts:29`).
  await createPodButton
    .or(page.getByTestId('app-content'))
    .first()
    .waitFor({ state: 'visible', timeout: 30000 });
  const isOnWelcome = await createPodButton.isVisible();

  if (isOnWelcome) {
    // Set auto-auth flag BEFORE clicking create so InviteGateOverlay and
    // TrustDeviceModal are both suppressed in E2E.
    await page.evaluate(() => {
      sessionStorage.setItem('e2e_auto_auth', 'true');
    });

    await createPodButton.click();
    await createUpToMembers(page, opts.familyName);

    // Members step → "I'll do this later" (no member added; goes to /nook).
    await page.getByRole('button', { name: ui('setup.addLater') }).click();
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
