import { expect, type Page } from '@playwright/test';
import { ui } from './ui-strings';

/**
 * Open the "Add Activity" creation drawer from the planner.
 *
 * The trigger (AddEntityButton in CalendarCommandBar) has accessible name
 * `planner.addActivity` ("Add Activity"); its leading `＋` glyph is
 * `aria-hidden`. Exactly one such button exists while no drawer is open, so a
 * page-level exact-name match is unambiguous. (Historically the label carried a
 * literal leading "+" — removed in the 2026-07-03 double-plus fix — so the old
 * `/\+ add activity/i` selector matched the visible glyph+text and now matches
 * nothing; that drift is what this helper centralises.)
 */
export async function openAddActivity(page: Page): Promise<void> {
  // Scope to `app-content`: the create drawer is teleported to <body> and its
  // own save button shares this accessible name, so a page-level match is
  // ambiguous whenever a drawer is (or is still tearing down) open. The trigger
  // always lives in the main app content.
  await page
    .getByTestId('app-content')
    .getByRole('button', { name: ui('planner.addActivity'), exact: true })
    .click();
}

/**
 * Submit the Activity CREATE drawer (save button label `modal.addActivity`,
 * "Add Activity"). It shares its accessible name with the page trigger, so it
 * MUST be scoped to the open dialog to stay unambiguous. (The EDIT drawer's save
 * button is "Save Activity" — a different label — so this is create-only.)
 */
export async function submitActivity(page: Page): Promise<void> {
  await page
    .locator('[role="dialog"]')
    .getByRole('button', { name: ui('modal.addActivity'), exact: true })
    .click();
}

/**
 * Dismiss the "Activity Created" confirmation modal (CreatedConfirmModal)
 * that stacks over the planner after saving a new activity.
 *
 * Waits for the confirmation heading first — a semantic signal that the
 * save flow has completed and the modal is rendered — then clicks OK.
 * Using the heading as the gate gives webkit room to finish the async
 * save + next-tick render without relying on a tight click timeout.
 */
export async function dismissActivityCreatedConfirm(page: Page): Promise<void> {
  const confirmHeading = page
    .locator('[role="dialog"]')
    .getByRole('heading', { name: ui('planner.activityCreatedTitle') });
  await expect(confirmHeading).toBeVisible({ timeout: 15000 });

  const okButton = page.locator('[role="dialog"]').getByRole('button', { name: /^ok$/i });
  await okButton.click();
  await expect(okButton).not.toBeVisible({ timeout: 5000 });
}
