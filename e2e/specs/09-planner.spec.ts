import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { ui } from '../helpers/ui-strings';

/**
 * E2E tests for the Family Planner page.
 *
 * Tests activity CRUD (create/edit/delete) for both one-time and
 * recurring activities, calendar grid display, upcoming activities,
 * and multi-day weekly recurrence.
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

    // Navigate to planner (defaults to week view)
    await page.goto('/planner');
    await page.waitForURL('/planner');
  }

  /** Switch to month view by clicking the Month toggle button. */
  async function switchToMonthView(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /^month$/i }).click();
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

  test('should display the planner page with calendar grid', async ({ page }) => {
    await setupPlanner(page);

    // Page header — title comes from AppHeader (lowercase, no emoji)
    await expect(page.getByRole('heading', { name: /family planner/i })).toBeVisible();

    // Calendar navigation
    await expect(page.getByRole('button', { name: /today/i })).toBeVisible();

    // Add activity button
    await expect(page.getByRole('button', { name: /\+ add activity/i })).toBeVisible();

    // View toggle pills (default is week view)
    await expect(page.getByText(/^month$/i)).toBeVisible();
    await expect(page.getByText(/^week$/i)).toBeVisible();

    // Upcoming section
    await expect(page.getByRole('heading', { name: /upcoming activities/i })).toBeVisible();
  });

  test('should create a one-time activity', async ({ page }) => {
    await setupPlanner(page);

    // Open add modal
    await page.getByRole('button', { name: /\+ add activity/i }).click();

    // Verify modal opened
    await expect(page.getByText(/new activity/i)).toBeVisible();

    // Fill in form — new BeanieFormModal layout
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Doctor Visit');
    await selectAssignee(page);

    // Switch to one-off mode
    await page.getByRole('button', { name: /one-off/i }).click();

    // Fill date
    await page.locator('input[type="date"]').fill('2026-03-15');

    // Save — use exact regex to avoid conflict with "+ add activity" header button
    await page.getByRole('button', { name: /^add activity$/i }).click();

    // Modal should close
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Activity should be persisted — verify in IndexedDB
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    expect(exported.activities![0].title).toBe('Doctor Visit');
    expect(exported.activities![0].recurrence).toBe('none');
  });

  test('should create a weekly recurring activity', async ({ page }) => {
    await setupPlanner(page);

    // Open add modal
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

    // Save — use exact regex to avoid conflict with "+ add activity" header button
    await page.getByRole('button', { name: /^add activity$/i }).click();

    // Modal should close
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Verify persistence
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    expect(exported.activities![0].title).toBe('Piano Lesson');
    expect(exported.activities![0].recurrence).toBe('weekly');
    expect(exported.activities![0].startTime).toBe('15:00');
    expect(exported.activities![0].endTime).toBe('16:00');
  });

  test('should create a multi-day weekly activity', async ({ page }) => {
    await setupPlanner(page);

    // Open add modal
    await page.getByRole('button', { name: /\+ add activity/i }).click();

    // Fill title
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Soccer Training');
    await selectAssignee(page);

    // Date
    await page.locator('input[type="date"]').first().fill('2026-03-02');

    // Recurrence is "Recurring" by default
    // The DayOfWeekSelector should be visible — select Monday (M) and Wednesday (W)
    // Day buttons are 38×38px squares in order: M T W T F S S (indices 0-6)
    const dayBtns = page.locator('button.h-\\[38px\\].w-\\[38px\\]');

    // The date watcher auto-selects today's day of week — deselect all currently active
    // days before selecting only the ones we want (date-independent).
    for (let i = 0; i < 7; i++) {
      const btn = dayBtns.nth(i);
      const cls = await btn.getAttribute('class');
      if (cls?.includes('text-white')) {
        await btn.click();
      }
    }

    // Click M (Monday, index 0) and W (Wednesday, index 2)
    await dayBtns.nth(0).click();
    await dayBtns.nth(2).click();

    // Save — use exact regex to avoid conflict with "+ add activity" header button
    await page.getByRole('button', { name: /^add activity$/i }).click();

    // Modal should close
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Verify persistence — daysOfWeek should contain [1, 3] (Mon, Wed)
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    const activity = exported.activities![0];
    expect(activity.title).toBe('Soccer Training');
    expect(activity.recurrence).toBe('weekly');
    expect(activity.daysOfWeek).toBeDefined();
    expect(activity.daysOfWeek).toContain(1); // Monday
    expect(activity.daysOfWeek).toContain(3); // Wednesday
    expect(activity.daysOfWeek).toHaveLength(2);
  });

  test('should show activity dots on the calendar grid', async ({ page }) => {
    await setupPlanner(page);

    // Switch to month view (dots only appear in month view)
    await switchToMonthView(page);

    // Create an activity for today so it shows on the current month view
    await page.getByRole('button', { name: /\+ add activity/i }).click();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Today Activity');
    await selectAssignee(page);
    await page.getByRole('button', { name: /one-off/i }).click();
    await page.locator('input[type="date"]').fill(todayStr);
    await page.getByRole('button', { name: /^add activity$/i }).click();

    // Wait for modal to close
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Calendar grid should have at least one activity dot (5px circles)
    // The dots are small span elements inside the calendar buttons
    const calendarDots = page.locator('.rounded-full.h-\\[5px\\].w-\\[5px\\]');
    await expect(calendarDots.first()).toBeVisible({ timeout: 5000 });
  });

  test('should display activity in upcoming list', async ({ page }) => {
    await setupPlanner(page);

    // Create a one-time activity for tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Upcoming Test');
    await selectAssignee(page);
    await page.getByRole('button', { name: /one-off/i }).click();
    await page.locator('input[type="date"]').fill(tomorrowStr);
    await page.getByRole('button', { name: /^add activity$/i }).click();

    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // The activity should appear in the upcoming activities section
    const upcomingSection = page.locator('h3', { hasText: /upcoming activities/i }).locator('..');
    await expect(upcomingSection.getByText('Upcoming Test')).toBeVisible({ timeout: 5000 });
  });

  test('should edit an existing activity', async ({ page }) => {
    await setupPlanner(page);

    // Create an activity first
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Original Title');
    await selectAssignee(page);
    await page.getByRole('button', { name: /one-off/i }).click();
    await page.locator('input[type="date"]').fill(tomorrowStr);
    await page.getByRole('button', { name: /^add activity$/i }).click();
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Click on the activity in the upcoming list — opens view modal first
    const upcomingSection = page.locator('h3', { hasText: /upcoming activities/i }).locator('..');
    await upcomingSection.getByText('Original Title').click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 5000 });

    // Click "Edit" button in view modal to open the full edit modal
    await page.getByRole('button', { name: /edit/i }).click();
    await expect(page.getByText(/edit activity/i)).toBeVisible({ timeout: 5000 });

    // Change the title
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Updated Title');
    await page.getByRole('button', { name: /save activity/i }).click();

    // Modal should close
    await expect(page.getByText(/edit activity/i)).not.toBeVisible({ timeout: 5000 });

    // Verify update in IndexedDB
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    expect(exported.activities![0].title).toBe('Updated Title');

    // Updated title should be visible in the upcoming list
    const upcomingAfterEdit = page.locator('h3', { hasText: /upcoming activities/i }).locator('..');
    await expect(upcomingAfterEdit.getByText('Updated Title')).toBeVisible();
    await expect(upcomingAfterEdit.getByText('Original Title')).not.toBeVisible();
  });

  test('should delete an activity with confirmation', async ({ page }) => {
    await setupPlanner(page);

    // Create an activity first
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('To Delete');
    await selectAssignee(page);
    await page.getByRole('button', { name: /one-off/i }).click();
    await page.locator('input[type="date"]').fill(tomorrowStr);
    await page.getByRole('button', { name: /^add activity$/i }).click();
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Click on the activity in the upcoming list — opens view modal
    const upcomingSection = page.locator('h3', { hasText: /upcoming activities/i }).locator('..');
    await upcomingSection.getByText('To Delete').click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 5000 });

    // Click the delete button in the view modal footer (🗑️ with aria-label="delete")
    await page.getByLabel(/delete/i).click();

    // View modal closes first, then confirmation dialog appears
    await expect(page.getByText('Are you sure you want to delete this activity?')).toBeVisible({
      timeout: 10000,
    });

    // Wait for the view modal to fully close before clicking confirm
    await expect(page.getByText(/activity details/i)).not.toBeVisible({ timeout: 5000 });

    // Confirm deletion — the ConfirmModal uses t('action.delete') = "delete"
    await page.getByRole('button', { name: /^delete$/i }).click();

    // Wait for confirm dialog to close
    await expect(page.getByText('Are you sure you want to delete this activity?')).not.toBeVisible({
      timeout: 5000,
    });

    // Activity should be removed from the upcoming list
    await expect(page.getByText('To Delete', { exact: true })).not.toBeVisible({ timeout: 5000 });

    // Verify in IndexedDB
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(0);
  });

  test('should navigate months with prev/next buttons', async ({ page }) => {
    await setupPlanner(page);

    // Switch to month view for month navigation test
    await switchToMonthView(page);

    // Get current month name — target the h3 inside the calendar grid specifically
    const monthHeading = page.locator('h3.font-outfit.text-lg.font-bold');
    const currentMonthText = await monthHeading.textContent();

    // Click next month button (the > arrow after the month name)
    const nextButton = page
      .locator('button')
      .filter({ has: page.locator('path[d="M9 5l7 7-7 7"]') });
    await nextButton.click();

    // Month label should change
    await expect(monthHeading).not.toHaveText(currentMonthText!, { timeout: 3000 });

    // Click prev month button to go back
    const prevButton = page
      .locator('button')
      .filter({ has: page.locator('path[d="M15 19l-7-7 7-7"]') });
    await prevButton.click();

    // Should be back to original month
    await expect(monthHeading).toHaveText(currentMonthText!);
  });

  test('should create recurring activity with advanced fields', async ({ page }) => {
    await setupPlanner(page);

    await page.getByRole('button', { name: /\+ add activity/i }).click();

    // Basic fields
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Soccer Practice');
    await selectAssignee(page);
    await page.locator('input[type="date"]').first().fill('2026-03-02');

    // Start time defaults to 9:00 AM, end time auto-defaults to 10:00 AM

    // Open end time dropdown (trigger shows "10:00 AM") then select 10:30 AM
    await page.getByRole('button', { name: '10:00 AM' }).click();
    await page.getByRole('button', { name: '10:30 AM' }).click();

    // Recurrence defaults to Recurring + Weekly

    // Location is visible inline
    await page.getByPlaceholder(ui('planner.field.location')).fill('City Sports Park');

    // Instructor fields are inside "add more details" collapsible
    await page.getByRole('button', { name: /add more details/i }).click();
    await page.getByPlaceholder(ui('planner.field.instructor')).fill('Coach Johnson');
    await page.getByPlaceholder(ui('planner.field.instructorContact')).fill('coach@sports.com');

    // Save — use exact regex to avoid conflict with "+ add activity" header button
    await page.getByRole('button', { name: /^add activity$/i }).click();
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Verify all fields persisted
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    const activity = exported.activities![0];
    expect(activity.title).toBe('Soccer Practice');
    expect(activity.recurrence).toBe('weekly');
    expect(activity.location).toBe('City Sports Park');
    expect(activity.instructorName).toBe('Coach Johnson');
    expect(activity.instructorContact).toBe('coach@sports.com');
  });

  test('should create a recurring activity with an end date', async ({ page }) => {
    await setupPlanner(page);

    // Open add modal
    await page.getByRole('button', { name: /\+ add activity/i }).click();

    // Fill in form — recurrence defaults to "Recurring"
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Summer Swimming');
    await selectAssignee(page);
    await page.locator('input[type="date"]').first().fill('2026-06-01');

    // Recurrence stays at default (Recurring + Weekly)

    // Fill end date (inside the recurring details section)
    // There are now 2 date inputs: start date and end date
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(1).fill('2026-08-31');

    // Save
    await page.getByRole('button', { name: /^add activity$/i }).click();
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Verify persistence — recurrenceEndDate should be saved
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    const activity = exported.activities![0];
    expect(activity.title).toBe('Summer Swimming');
    expect(activity.recurrence).toBe('weekly');
    expect(activity.recurrenceEndDate).toBe('2026-08-31');
  });

  test('should edit a single occurrence of a recurring activity (this only)', async ({ page }) => {
    await setupPlanner(page);

    // Create a weekly recurring activity starting tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Weekly Lesson');
    await selectAssignee(page);
    await page.locator('input[type="date"]').first().fill(tomorrowStr);
    await page.getByRole('button', { name: /^add activity$/i }).click();
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

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

  test('should edit this and all future occurrences of a recurring activity', async ({ page }) => {
    await setupPlanner(page);

    // Create a weekly recurring activity starting tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Piano Class');
    await selectAssignee(page);
    await page.locator('input[type="date"]').first().fill(tomorrowStr);
    await page.getByRole('button', { name: /^add activity$/i }).click();
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Click the first occurrence → view modal → Edit → edit modal opens directly
    await page.getByText('Piano Class').first().click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /edit/i }).click();
    await expect(page.getByText(/edit activity/i)).toBeVisible({ timeout: 5000 });

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

  test('should edit all occurrences of a recurring activity', async ({ page }) => {
    await setupPlanner(page);

    // Create a weekly recurring activity starting tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    await page.getByRole('button', { name: /\+ add activity/i }).click();
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Soccer Training');
    await selectAssignee(page);
    await page.locator('input[type="date"]').first().fill(tomorrowStr);
    await page.getByRole('button', { name: /^add activity$/i }).click();
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

    // Click the first occurrence → view modal → Edit → edit modal opens directly
    await page.getByText('Soccer Training').first().click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /edit/i }).click();
    await expect(page.getByText(/edit activity/i)).toBeVisible({ timeout: 5000 });

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

  test('should reschedule a single occurrence of a recurring activity', async ({ page }) => {
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
    await expect(page.getByText(/new activity/i)).not.toBeVisible({ timeout: 5000 });

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

  test.skip('should show legend with category colors', async ({ page }) => {
    await setupPlanner(page);

    // Legend should display category names
    await expect(page.getByText(/legend/i)).toBeVisible();
    await expect(page.getByText(/lesson/i)).toBeVisible();
    await expect(page.getByText(/sport/i)).toBeVisible();
    await expect(page.getByText(/appointment/i)).toBeVisible();
  });
});
