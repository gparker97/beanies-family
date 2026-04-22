import { expect, type Page } from '@playwright/test';
import { ui } from './ui-strings';

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
