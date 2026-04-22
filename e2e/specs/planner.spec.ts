import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { ui } from '../helpers/ui-strings';
import { dismissActivityCreatedConfirm } from '../helpers/activity-modal';

/**
 * E2E tests for the Family Planner page.
 *
 * Tests activity CRUD lifecycle and recurring activity edit scopes
 * (this only, this & all future, all occurrences, reschedule).
 */

test.describe('Family Planner', () => {
  let dbHelper: IndexedDBHelper;

  /** Common setup: clear state, bypass login, seed a family member. */
  async function setupPlanner(page: import('@playwright/test').Page) {
    await page.goto('/');
    dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');
    await bypassLoginIfNeeded(page);

    // Navigate to planner (defaults to month view)
    await page.goto('/activities');
    await page.waitForURL('/activities');
  }

  /** Select the first family member chip in the activity modal (required for multi-owner). */
  async function selectAssignee(page: import('@playwright/test').Page) {
    // Click the first "John Doe" button — the assignee picker (not dropoff/pickup pickers below)
    await page
      .locator('div[role="dialog"]')
      .getByRole('button', { name: /John Doe/i })
      .first()
      .click();
  }

  /** Helper to get tomorrow's date string in YYYY-MM-DD format. */
  function getTomorrowStr(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  }

  /** Helper to create a recurring activity starting tomorrow and dismiss the confirmation. */
  async function createRecurringActivity(page: import('@playwright/test').Page, title: string) {
    const tomorrowStr = getTomorrowStr();
    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill(title);
    await selectAssignee(page);
    await page.locator('input[type="date"]').first().fill(tomorrowStr);
    await page.getByRole('button', { name: /^add activity$/i }).click();
    await dismissActivityCreatedConfirm(page);
  }

  /** Helper to open view modal then edit modal for the first occurrence of an activity. */
  async function openEditModal(page: import('@playwright/test').Page, title: string) {
    await page.getByText(title).first().click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /edit/i }).click();
    await expect(page.getByText(/edit activity/i)).toBeVisible({ timeout: 5000 });
  }

  test('Activity CRUD lifecycle', async ({ page }) => {
    await setupPlanner(page);

    // --- CREATE: one-time activity ---
    await page.getByRole('button', { name: /\+ add activity/i }).click();

    // Verify modal opened
    await expect(page.getByText(/new activity/i)).toBeVisible();

    // Fill in form
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Doctor Visit');
    await selectAssignee(page);

    // Switch to one-off mode
    await page.getByRole('button', { name: /one-time/i }).click();

    // Fill date (use tomorrow so it appears in upcoming)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    await page.locator('input[type="date"]').fill(tomorrowStr);

    // Save
    await page.getByRole('button', { name: /^add activity$/i }).click();

    // Dismiss confirmation modal
    await dismissActivityCreatedConfirm(page);

    // Verify one-time activity persisted in IndexedDB
    let exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    expect(exported.activities![0].title).toBe('Doctor Visit');
    expect(exported.activities![0].recurrence).toBe('none');

    // --- CREATE: recurring activity ---
    await page.getByRole('button', { name: /\+ add activity/i }).click();

    // Fill in form — recurrence defaults to "Recurring"
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Piano Lesson');
    await selectAssignee(page);
    await page.locator('input[type="date"]').first().fill('2026-03-04');

    // Open start time dropdown (trigger shows "9:00 AM" by default) then select 3:00 PM
    await page.getByRole('button', { name: '9:00 AM' }).first().click();
    await page.getByRole('button', { name: '3:00 PM' }).click();

    // End time auto-updates to startTime + 1hr = 4:00 PM — no action needed
    // Recurrence stays at default (Recurring + Weekly)

    // Save
    await page.getByRole('button', { name: /^add activity$/i }).click();

    // Dismiss confirmation modal
    await dismissActivityCreatedConfirm(page);

    // Verify recurring activity persisted
    exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(2);
    const pianoLesson = exported.activities!.find((a: any) => a.title === 'Piano Lesson');
    expect(pianoLesson).toBeDefined();
    expect(pianoLesson!.recurrence).toBe('weekly');
    expect(pianoLesson!.startTime).toBe('15:00');
    expect(pianoLesson!.endTime).toBe('16:00');

    // --- EDIT: update the one-time activity ---
    // Click on the activity in the upcoming list — opens view modal first
    const upcomingSection = page.locator('h3', { hasText: /upcoming activities/i }).locator('..');
    await upcomingSection.getByText('Doctor Visit').click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 5000 });

    // Click "Edit" button in view modal to open the full edit modal
    await page.getByRole('button', { name: /edit/i }).click();
    await expect(page.getByText(/edit activity/i)).toBeVisible({ timeout: 5000 });

    // Change the title
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Updated Visit');
    await page.getByRole('button', { name: /save activity/i }).click();

    // Modal should close
    await expect(page.getByText(/edit activity/i)).not.toBeVisible({ timeout: 5000 });

    // Verify update in IndexedDB
    exported = await dbHelper.exportData();
    const updatedVisit = exported.activities!.find((a: any) => a.title === 'Updated Visit');
    expect(updatedVisit).toBeDefined();

    // Updated title should be visible in the upcoming list
    const upcomingAfterEdit = page.locator('h3', { hasText: /upcoming activities/i }).locator('..');
    await expect(upcomingAfterEdit.getByText('Updated Visit')).toBeVisible();
    await expect(upcomingAfterEdit.getByText('Doctor Visit')).not.toBeVisible();

    // --- DELETE: remove the one-time activity ---
    // Click on the activity in the upcoming list — opens view modal
    await upcomingAfterEdit.getByText('Updated Visit').click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 5000 });

    // Click the delete button in the view modal footer
    await page.getByLabel(/delete/i).click();

    // View modal closes first, then confirmation dialog appears
    await expect(page.getByText('Are you sure you want to delete this activity?')).toBeVisible({
      timeout: 10000,
    });

    // Wait for the view modal to fully close before clicking confirm
    await expect(page.getByText(/activity details/i)).not.toBeVisible({ timeout: 5000 });

    // Confirm deletion
    await page.getByRole('button', { name: /^delete$/i }).click();

    // Wait for confirm dialog to close
    await expect(page.getByText('Are you sure you want to delete this activity?')).not.toBeVisible({
      timeout: 5000,
    });

    // Activity should be removed from the upcoming list
    await expect(page.getByText('Updated Visit', { exact: true })).not.toBeVisible({
      timeout: 5000,
    });

    // Verify in IndexedDB — only the recurring Piano Lesson remains
    exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    expect(exported.activities![0].title).toBe('Piano Lesson');
  });

  test('Recurring: edit single occurrence (this only) creates override', async ({ page }) => {
    await setupPlanner(page);

    // Create a weekly recurring activity starting tomorrow
    await createRecurringActivity(page, 'Weekly Lesson');

    // Click the first occurrence in the upcoming list — opens view modal
    await page.getByText('Weekly Lesson').first().click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 5000 });

    // Click Edit — edit modal opens directly (scope deferred to save)
    await page.getByRole('button', { name: /edit/i }).click();
    await expect(page.getByText(/edit activity/i)).toBeVisible({ timeout: 5000 });

    // Change title and save
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Special Lesson');
    await page.getByRole('button', { name: /save activity/i }).click();

    // Scope modal appears after save — choose "This Occurrence Only"
    await expect(page.getByText(/this occurrence only/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /this occurrence only/i }).click();
    await expect(page.getByText(/edit activity/i)).not.toBeVisible({ timeout: 5000 });

    // Verify in IndexedDB: original template + new override = 2 activities
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(2);
    const original = exported.activities!.find((a: any) => a.title === 'Weekly Lesson');
    const override = exported.activities!.find((a: any) => a.title === 'Special Lesson');
    expect(original).toBeDefined();
    expect(original!.recurrence).toBe('weekly');
    expect(override).toBeDefined();
    expect(override!.recurrence).toBe('none');
    expect(override!.parentActivityId).toBe(original!.id);
  });

  test('Recurring: edit this and all future creates new template', async ({ page }) => {
    await setupPlanner(page);

    // Create a weekly recurring activity starting tomorrow
    await createRecurringActivity(page, 'Piano Class');

    // Click the first occurrence → view modal → Edit → edit modal opens directly
    await openEditModal(page, 'Piano Class');

    // Change title and save
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Advanced Piano');
    await page.getByRole('button', { name: /save activity/i }).click();

    // Scope modal appears after save — choose "This & All Future"
    await expect(page.getByText(/this & all future/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /this & all future/i }).click();
    await expect(page.getByText(/edit activity/i)).not.toBeVisible({ timeout: 5000 });

    // Verify: original end-dated + new template = 2 activities
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(2);
    const original = exported.activities!.find((a: any) => a.title === 'Piano Class');
    const newTemplate = exported.activities!.find((a: any) => a.title === 'Advanced Piano');
    expect(original).toBeDefined();
    expect(original!.recurrenceEndDate).toBeDefined(); // end-dated
    expect(newTemplate).toBeDefined();
    expect(newTemplate!.recurrence).toBe('weekly');
    expect(newTemplate!.date).toBeTruthy(); // date is the clicked occurrence, not necessarily the original start
  });

  test('Recurring: edit all occurrences updates in-place', async ({ page }) => {
    await setupPlanner(page);

    // Create a weekly recurring activity starting tomorrow
    await createRecurringActivity(page, 'Soccer Training');

    // Click the first occurrence → view modal → Edit → edit modal opens directly
    await openEditModal(page, 'Soccer Training');

    // Change title and save
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Updated Soccer');
    await page.getByRole('button', { name: /save activity/i }).click();

    // Scope modal appears after save — choose "All Occurrences"
    await expect(page.getByText(/all occurrences/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /all occurrences/i }).click();
    await expect(page.getByText(/edit activity/i)).not.toBeVisible({ timeout: 5000 });

    // Verify: still only 1 activity, with updated title
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    expect(exported.activities![0].title).toBe('Updated Soccer');
    expect(exported.activities![0].recurrence).toBe('weekly');
  });

  test('Recurring: reschedule single occurrence', async ({ page }) => {
    await setupPlanner(page);

    // Create a weekly recurring activity starting tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    // Calculate a reschedule target date (3 days after tomorrow)
    const rescheduleTarget = new Date(tomorrow);
    rescheduleTarget.setDate(rescheduleTarget.getDate() + 3);
    const rescheduleStr = `${rescheduleTarget.getFullYear()}-${String(rescheduleTarget.getMonth() + 1).padStart(2, '0')}-${String(rescheduleTarget.getDate()).padStart(2, '0')}`;

    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Reschedule Test');
    await selectAssignee(page);
    await page.locator('input[type="date"]').first().fill(tomorrowStr);
    await page.getByRole('button', { name: /^add activity$/i }).click();

    // Dismiss confirmation modal
    await dismissActivityCreatedConfirm(page);

    // Click the first occurrence in the upcoming list — opens view modal
    await page.getByText('Reschedule Test').first().click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 5000 });

    // Click "Reschedule This Session" button
    await page.getByRole('button', { name: /reschedule this session/i }).click();

    // The reschedule form should appear with date and time inputs
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog.getByText(/new date/i)).toBeVisible({ timeout: 3000 });

    // Change the date in the reschedule form
    const rescheduleDateInput = dialog.locator('input[type="date"]');
    await rescheduleDateInput.fill(rescheduleStr);

    // Click the Reschedule confirm button
    await dialog.getByRole('button', { name: /^reschedule$/i }).click();

    // Modal should close
    await expect(page.getByText(/activity details/i)).not.toBeVisible({ timeout: 5000 });

    // Verify in IndexedDB: original template + rescheduled override = 2 activities
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(2);

    const original = exported.activities!.find((a: any) => a.recurrence === 'weekly');
    const override = exported.activities!.find((a: any) => a.recurrence === 'none');

    expect(original).toBeDefined();
    expect(override).toBeDefined();
    expect(override!.parentActivityId).toBe(original!.id);
    expect(override!.date).toBe(rescheduleStr);
    // originalOccurrenceDate should be set and differ from the rescheduled date
    expect(override!.originalOccurrenceDate).toBeDefined();
    expect(override!.originalOccurrenceDate).not.toBe(rescheduleStr);
  });
});
