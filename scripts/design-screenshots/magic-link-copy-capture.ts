import { test } from '../../e2e/fixtures/test';
import { gotoRoute } from '../../e2e/helpers/navigation';

/**
 * NOT a CI test — visual review of the magic-link / recovery-kit copy pass.
 *
 * Outside `e2e/specs/` deliberately: `playwright.config.ts` has `testDir: './e2e/specs'`
 * with no `testIgnore`, so a scratch file there joins the CI matrix and eats the ADR-007
 * budget.
 *
 * Run: npx playwright test -c playwright.design.config.ts --grep "kit-copy"
 *
 * It shoots `/dev/magic-link-copy`, the DEV-gated harness, because the real surfaces are
 * behind pod creation and a genuine join. That is the honest limit of what this proves:
 * how the copy READS and LAYS OUT in both themes at both widths. It says nothing about
 * the flows that reach them, which stay on the manual list.
 */
const OUT = process.env.SHOT_DIR ?? 'screenshots';

const WIDTHS = [
  { name: 'desktop', size: { width: 1280, height: 900 } },
  // 390px is where this project's UI defects actually live.
  { name: 'phone', size: { width: 390, height: 844 } },
];

for (const theme of ['light', 'dark'] as const)
  for (const w of WIDTHS) {
    test(`kit-copy: ${theme} ${w.name}`, async ({ page }) => {
      await page.setViewportSize(w.size);
      await gotoRoute(page, '/dev/magic-link-copy');
      await page.waitForLoadState('networkidle');

      // Theme LAST: applied before the page settles, the app's own theme init overwrites
      // it and every "dark" shot comes out light.
      await page.evaluate((th) => {
        document.documentElement.classList.toggle('dark', th === 'dark');
      }, theme);
      await page.waitForTimeout(600);

      await page.screenshot({ path: `${OUT}/kit-copy-${theme}-${w.name}.png`, fullPage: true });

      // ⚠️ SECOND SHOT, SCROLLED. `BaseModal` owns its own scroll container, so `fullPage`
      // photographs the document while the modal stays at its viewport slot — the magic
      // link and its copy button sit below that internal fold and simply are not in the
      // frame above. A review that stopped at the first shot would be reviewing the half
      // of the modal that did not change.
      const scrolled = await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll<HTMLElement>('*')).find(
          (n) => n.scrollHeight > n.clientHeight + 40 && getComputedStyle(n).overflowY !== 'visible'
        );
        if (!el) return false;
        el.scrollTop = el.scrollHeight;
        return true;
      });
      // No scrollable container means the modal fits the viewport whole (the desktop case),
      // so the first shot already holds everything and a second would be a duplicate.
      if (scrolled) {
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${OUT}/kit-copy-${theme}-${w.name}-scrolled.png` });
      }

      // Third shot: the JOIN surface, which the harness renders underneath the modal.
      // Dismissing the kit is the only way to see it — a run that skipped this would have
      // reviewed one of the two surfaces that changed.
      await page.getByRole('button', { name: /saved both/i }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/join-copy-${theme}-${w.name}.png`, fullPage: true });
    });
  }
