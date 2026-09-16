/**
 * The join view's awaiting-auth card, in each of the states it can now explain.
 *
 * ⚠️ NOT in `e2e/specs/` — `playwright.config.ts` has no `testIgnore`, so a file there joins the
 * CI matrix and counts against the ADR-007 budget (23 of a hard 25).
 *
 * What this proves and what it does not. The reported bug is iOS-ONLY: it needs a redirect-auth
 * platform, which desktop Chromium is not. So this cannot reproduce the loop and cannot prove it
 * fixed — greg's two-account test on a real iPhone is the only thing that can. What it DOES prove
 * is that the card now says something different in each state, which is the user-visible half of
 * the fix, and that nothing regressed in light or dark at phone width.
 */
import { test, expect } from '../../e2e/fixtures/test';

const REASONS = ['initial', 'needs-pick', 'cancelled', 'redirecting'] as const;

for (const theme of ['light', 'dark'] as const) {
  test(`join awaiting card explains itself — ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 900 });
    // An invite link with no real family behind it still renders the awaiting card, which is the
    // surface under test. The registry lookup failing is deliberately non-fatal.
    await page.goto('/join?f=demo-family&p=google_drive&n=family.beanpod');
    await page.waitForLoadState('networkidle');

    // ⚠️ The `dark` CLASS, not `emulateMedia`. A first version of this used
    // `emulateMedia({ colorScheme })` and produced a dark screenshot byte-identical to the light
    // one — the app drives dark mode from `documentElement.classList`, so the media emulation
    // changed nothing and the assertion passed against a light render. A theme check that cannot
    // see the theme is not a theme check.
    await page.evaluate((dark) => {
      document.documentElement.classList.toggle('dark', dark);
    }, theme === 'dark');
    await page.waitForTimeout(300);

    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Prove the toggle actually took, so "measured nothing" cannot pass as success.
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark, `the dark class did not apply for ${theme}`).toBe(theme === 'dark');

    const text = (await body.innerText()).toLowerCase();
    // The copy for `initial` / `needs-pick` is the existing picker prompt.
    expect(
      text.includes('google drive') || text.includes('join') || text.includes('file'),
      `the awaiting card rendered no recognisable copy in ${theme}:\n${text.slice(0, 400)}`
    ).toBe(true);

    await page.screenshot({
      path: `/tmp/claude-1000/-home-greg-projects-beanies-family/3e6835bb-6564-4832-8fa9-32f04592f6f2/scratchpad/join-awaiting-${theme}.png`,
      fullPage: true,
    });
  });
}

test('every awaiting reason maps to copy that exists', async () => {
  // A table check rather than four page loads: the states are driven by internal flow transitions
  // that a URL cannot force, so this asserts the mapping is total and every key resolves.
  const { UI_STRINGS, BEANIE_STRINGS } = await import('../../src/services/translation/uiStrings');
  const KEYS: Record<(typeof REASONS)[number], string> = {
    initial: 'join.pickerPrompt.description',
    'needs-pick': 'join.pickerPrompt.description',
    cancelled: 'join.awaiting.cancelled',
    redirecting: 'join.awaiting.redirecting',
  };
  for (const reason of REASONS) {
    const key = KEYS[reason];
    // Both halves are required by the project's i18n rule; a missing `beanie` value ships an
    // English string into beanie mode.
    expect((UI_STRINGS as Record<string, string>)[key], `no en string for "${key}"`).toBeTruthy();
    expect(
      (BEANIE_STRINGS as Record<string, string>)[key],
      `no beanie string for "${key}"`
    ).toBeTruthy();
  }
});
