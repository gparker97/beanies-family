import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Select a date via a `<BeanieDatePicker>` component.
 *
 * The picker replaced every native `<input type="date">` across the app
 * (commit 878d894, 2026-04-24). It's a button-triggered popover with no
 * writable `<input>` underneath, so tests have to open it and click a
 * day cell to set the value.
 *
 * Each day cell in the calendar grid has `aria-label="YYYY-MM-DD"`, so
 * we navigate months forward/backward using the "Next month" / "Previous
 * month" buttons until the target day cell is visible in the popover,
 * then click it. The popover is teleported to <body>, so day-cell
 * selectors are not scoped to the parent dialog — we look page-wide for
 * the cell with the matching aria-label.
 *
 * @param scope   Where the picker's trigger button lives (usually a
 *                dialog locator, or `page` for page-level pickers).
 *                If there are multiple pickers in the scope, pass `index`.
 * @param isoDate Target date as `YYYY-MM-DD`.
 * @param options
 *   - `index` — which picker in the scope to open (default 0).
 *   - `timeout` — total ms budget (default 6000).
 */
export async function selectBeanieDate(
  scope: Page | Locator,
  isoDate: string,
  options: { index?: number; timeout?: number } = {}
): Promise<void> {
  const { index = 0, timeout = 6000 } = options;

  // Trigger button: BeanieDatePicker carries `data-testid="beanie-
  // date-picker-trigger"`. Using the test id avoids false matches on
  // other 📅-decorated buttons that can coexist in a modal (e.g. the
  // "📅 Reschedule This Session" button in ActivityViewEditModal).
  //
  // Dispatch the click via the DOM `HTMLElement.click()` method rather
  // than Playwright's hit-tested click. The modal backdrop (fixed
  // inset-0, z-40) intercepts Playwright's pointer-based click at the
  // trigger's bounding box during frames where the portal is settling;
  // a logical DOM click fires Vue's `@click="toggle"` handler regardless
  // of the pointer-event stacking state.
  const trigger = scope.locator('[data-testid="beanie-date-picker-trigger"]').nth(index);
  await trigger.waitFor({ state: 'visible', timeout });
  await trigger.evaluate((el: HTMLElement) => el.click());

  // `scope` for popover elements is always `page` because the popover
  // teleports to document body. Derive it from the scope parameter.
  const page: Page = 'page' in scope ? (scope.page() as Page) : (scope as Page);

  // Wait for the popover to actually render in the teleport target. The
  // popover is a <div class="z-50 w-[260px]..."> direct child of body
  // (via `<Teleport to="body">`). Use the "Next month" aria-label as a
  // stable marker of the popover having mounted — that button is always
  // present when the popover is open and absent when it's not.
  //
  // If the first click didn't land (rare: webkit sometimes drops the
  // first DOM click during a modal-open transition), re-dispatch once.
  const nextBtn = page.locator('button[aria-label="Next month"]');
  try {
    await nextBtn.waitFor({ state: 'visible', timeout: 2000 });
  } catch {
    await trigger.evaluate((el: HTMLElement) => el.click());
    await nextBtn.waitFor({ state: 'visible', timeout });
  }

  // Popover opens. Day cells are `<button aria-label="YYYY-MM-DD">` in
  // the current-month grid. Out-of-month cells are rendered but faded;
  // the current month is the authoritative target.
  const dayCell = page.locator(`button[aria-label="${isoDate}"]`);

  // If the target date is already visible in the current month view,
  // click it. Otherwise, step months forward (future dates) or backward
  // (past dates) relative to today.
  const today = new Date();
  const target = new Date(`${isoDate}T00:00:00`);
  const monthDiff =
    (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth());

  const navButton =
    monthDiff >= 0
      ? page.locator('button[aria-label="Next month"]')
      : page.locator('button[aria-label="Previous month"]');

  // Cap navigation at |monthDiff| + 1 clicks (+ 1 absorbs off-by-one
  // if today is in the final days of the month and target is early in
  // the next month — rare but possible). If the cell still isn't
  // visible, fall through to the waitFor below which will surface the
  // real failure mode.
  const maxSteps = Math.abs(monthDiff) + 1;
  for (let i = 0; i < maxSteps; i++) {
    if (await dayCell.isVisible()) break;
    await navButton.click();
    // Tiny settle for the month re-render before checking again.
    await page.waitForTimeout(50);
  }

  await dayCell.waitFor({ state: 'visible', timeout });
  await dayCell.click();

  // BeanieDatePicker auto-closes the popover on selection. Confirm the
  // popover is gone so downstream actions don't race against it.
  await expect(dayCell).not.toBeVisible({ timeout });
}
