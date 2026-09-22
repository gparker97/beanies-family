/**
 * SCRATCH verification for #63 — delete after the browser check is recorded.
 *
 * ⚠️ DELIBERATELY NOT IN `e2e/specs/`. `playwright.config.ts` sets `testDir: './e2e/specs'`
 * with no `testIgnore`, so a file there joins the CI matrix and counts against the
 * ADR-007 budget (23 of a hard cap of 25). Run with the design config:
 *
 *   npx playwright test -c playwright.design.config.ts --grep "#63"
 *
 * ⚠️ GREP ON "#63", NOT "deep link". Playwright greps the JOINED title path, the describe
 * is `#63 deep-link destinations` (hyphen), and test 1's title contains no space-separated
 * "deep link" — so the pleasant-looking `--grep "deep link"` silently runs 2 of 3 and skips
 * the one that proves the headline calendar-invite URL. It would report green having never
 * run the check this file exists for.
 *
 * WHAT THIS PROVES, and what it cannot. It proves the DESTINATION half: that every path
 * claimed in `EXTERNAL_DEEP_LINK_PATHS` actually opens the thing its query names, which
 * is the half that decides whether widening the OS claim produces "the app opened and
 * went nowhere". It CANNOT prove the OS claim itself — App Link verification and
 * Universal Link handoff need a physical device, and those stay on the manual list.
 */
import { test, expect } from '../../e2e/fixtures/test';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { TestDataFactory } from '../../e2e/fixtures/data';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';

const MEMBER_ID = 'deeplink-member-0001';
const ACTIVITY_ID = 'deeplink-activity-0001';

test.describe('#63 deep-link destinations', () => {
  test('every claimed entity path opens its target from the query alone', async ({ page }) => {
    await gotoRoot(page);
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await gotoRoot(page);
    await bypassLoginIfNeeded(page);

    const member = TestDataFactory.createFamilyMember({ id: MEMBER_ID, name: 'Deep Link Bean' });
    const activity = TestDataFactory.createActivity(member.id, {
      id: ACTIVITY_ID,
      title: 'Swimming lesson',
    });
    await dbHelper.seedData({
      familyMembers: [member],
      activities: [activity],
      settings: TestDataFactory.createSettings(),
    });

    // ── The headline case: the exact URL eventDescription writes into a calendar invite.
    await gotoRoute(page, `/activities?activity=${ACTIVITY_ID}`);
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog, 'the activity deep link must open the activity').toBeVisible({
      timeout: 15000,
    });
    await expect(dialog).toContainText(/Swimming lesson/i);
    await page.screenshot({ path: 'screenshots/deeplink-activity-light.png' });

    // `useDeepLinkParam` clears the param ONLY after a successful open, so an empty
    // `?activity=` in the address bar is itself evidence the open succeeded.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('activity'), {
        message: 'the consumed param must be cleared from the URL after a successful open',
        timeout: 10000,
      })
      .toBeNull();
  });

  test('the member deep link survives the /family → /pod redirect', async ({ page }) => {
    // Settles the one question the plan could only answer from vue-router's source:
    // `/family` is a plain string redirect, and `?edit=` has to survive it to reach
    // MeetTheBeansPage's receiver on `/pod`.
    await gotoRoot(page);
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await gotoRoot(page);
    await bypassLoginIfNeeded(page);

    const member = TestDataFactory.createFamilyMember({ id: MEMBER_ID, name: 'Deep Link Bean' });
    await dbHelper.seedData({
      familyMembers: [member],
      settings: TestDataFactory.createSettings(),
    });

    await gotoRoute(page, `/family?edit=${MEMBER_ID}`);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 10000 }).toBe('/pod');
    await expect(
      page.locator('div[role="dialog"]'),
      'the ?edit= param must survive the /family → /pod redirect and open the member'
    ).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'screenshots/deeplink-member-light.png' });
  });

  test('the activity deep link opens correctly at phone width', async ({ page }) => {
    // ⚠️ DELIBERATELY NOT A DARK-MODE CHECK, and the reason is worth recording.
    //
    // #63 paints NO surface: it changes TS constants, telemetry routing, two OS manifest
    // files, a redirect helper and the PWA manifest. It adds no component, no CSS, no
    // painted background and no user-visible string, so the "author every surface for
    // both modes" rule has nothing to bite on here — the modal below is pre-existing and
    // untouched.
    //
    // An earlier version of this check DID claim dark mode, via
    // `emulateMedia({ colorScheme: 'dark' })`, and it silently captured a LIGHT modal:
    // the app applies dark by `settingsStore` adding `html.dark`
    // (settingsStore.ts:200-202), not from the media query. Seeding `theme: 'dark'`
    // through `seedData` does not apply it either — the store does not pick the theme up
    // from the seeded doc in this harness. Rather than ship a mislabelled screenshot,
    // the claim was removed. If a future change here does paint something, driving dark
    // mode in this harness is an unsolved problem worth solving first.
    await page.setViewportSize({ width: 400, height: 860 });

    await gotoRoot(page);
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await gotoRoot(page);
    await bypassLoginIfNeeded(page);

    const member = TestDataFactory.createFamilyMember({ id: MEMBER_ID, name: 'Deep Link Bean' });
    const activity = TestDataFactory.createActivity(member.id, {
      id: ACTIVITY_ID,
      title: 'Swimming lesson',
    });
    await dbHelper.seedData({
      familyMembers: [member],
      activities: [activity],
      settings: TestDataFactory.createSettings(),
    });

    await gotoRoute(page, `/activities?activity=${ACTIVITY_ID}`);
    await expect(page.locator('div[role="dialog"]')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'screenshots/deeplink-activity-phone.png' });
  });
});
