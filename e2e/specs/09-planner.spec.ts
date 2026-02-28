import { test, expect } from '@playwright/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';

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

    // Navigate to planner
    await page.goto('/planner');
    await page.waitForURL('/planner');
  }

  test('should display the planner page with calendar grid', async ({ page }) => {
    await setupPlanner(page);

    // Page header (use emoji variant to target the page heading, not the sidebar)
    await expect(page.getByRole('heading', { name: /📅 Family Planner/ })).toBeVisible();

    // Calendar navigation
    await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();

    // Add activity button
    await expect(page.getByRole('button', { name: '+ Add Activity' })).toBeVisible();

    // View toggle pills
    await expect(page.getByText('Month')).toBeVisible();

    // Upcoming section
    await expect(page.getByRole('heading', { name: 'Upcoming Activities' })).toBeVisible();
  });

  test('should create a one-time activity', async ({ page }) => {
    await setupPlanner(page);

    // Open add modal
    await page.getByRole('button', { name: '+ Add Activity' }).click();

    // Verify modal opened
    await expect(page.getByText('New Activity')).toBeVisible();

    // Fill in form — new BeanieFormModal layout
    await page.getByPlaceholder("What's the activity?").fill('Doctor Visit');

    // Switch to one-off mode
    await page.getByRole('button', { name: 'One-off' }).click();

    // Fill date
    await page.locator('input[type="date"]').fill('2026-03-15');

    // Save — use exact match to avoid conflict with "+ Add Activity" header button
    await page.getByRole('button', { name: 'Add Activity', exact: true }).click();

    // Modal should close
    await expect(page.getByText('New Activity')).not.toBeVisible({ timeout: 5000 });

    // Activity should be persisted — verify in IndexedDB
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    expect(exported.activities![0].title).toBe('Doctor Visit');
    expect(exported.activities![0].recurrence).toBe('none');
  });

  test('should create a weekly recurring activity', async ({ page }) => {
    await setupPlanner(page);

    // Open add modal
    await page.getByRole('button', { name: '+ Add Activity' }).click();

    // Fill in form — recurrence defaults to "Recurring"
    await page.getByPlaceholder("What's the activity?").fill('Piano Lesson');
    await page.locator('input[type="date"]').fill('2026-03-04');

    // Open start time dropdown (trigger shows "9:00 AM" by default) then select 3:00 PM
    await page.getByRole('button', { name: '9:00 AM' }).first().click();
    await page.getByRole('button', { name: '3:00 PM' }).click();

    // Open end time dropdown (trigger shows "Select a time") then select 4:00 PM
    await page.getByRole('button', { name: 'Select a time' }).click();
    await page.getByRole('button', { name: '4:00 PM' }).click();

    // Recurrence stays at default (Recurring + Weekly)

    // Save — use exact match to avoid conflict with "+ Add Activity" header button
    await page.getByRole('button', { name: 'Add Activity', exact: true }).click();

    // Modal should close
    await expect(page.getByText('New Activity')).not.toBeVisible({ timeout: 5000 });

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
    await page.getByRole('button', { name: '+ Add Activity' }).click();

    // Fill title
    await page.getByPlaceholder("What's the activity?").fill('Soccer Training');

    // Date
    await page.locator('input[type="date"]').fill('2026-03-02');

    // Recurrence is "Recurring" by default
    // The DayOfWeekSelector should be visible — select Monday (M) and Wednesday (W)
    // Day buttons are 38×38px squares in order: M T W T F S S (indices 0-6)
    const dayBtns = page.locator('button.h-\\[38px\\].w-\\[38px\\]');

    // The date watcher auto-selects today's day of week — deselect all currently active
    // then select only the days we want. Click Saturday (nth 5) to deselect it if active.
    const satBtn = dayBtns.nth(5);
    const satClasses = await satBtn.getAttribute('class');
    if (satClasses?.includes('text-white')) {
      await satBtn.click(); // deselect Saturday
    }

    // Click M (Monday, index 0) and W (Wednesday, index 2)
    await dayBtns.nth(0).click();
    await dayBtns.nth(2).click();

    // Save — use exact match to avoid conflict with "+ Add Activity" header button
    await page.getByRole('button', { name: 'Add Activity', exact: true }).click();

    // Modal should close
    await expect(page.getByText('New Activity')).not.toBeVisible({ timeout: 5000 });

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

    // Create an activity for today so it shows on the current month view
    await page.getByRole('button', { name: '+ Add Activity' }).click();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    await page.getByPlaceholder("What's the activity?").fill('Today Activity');
    await page.getByRole('button', { name: 'One-off' }).click();
    await page.locator('input[type="date"]').fill(todayStr);
    await page.getByRole('button', { name: 'Add Activity', exact: true }).click();

    // Wait for modal to close
    await expect(page.getByText('New Activity')).not.toBeVisible({ timeout: 5000 });

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

    await page.getByRole('button', { name: '+ Add Activity' }).click();
    await page.getByPlaceholder("What's the activity?").fill('Upcoming Test');
    await page.getByRole('button', { name: 'One-off' }).click();
    await page.locator('input[type="date"]').fill(tomorrowStr);
    await page.getByRole('button', { name: 'Add Activity', exact: true }).click();

    await expect(page.getByText('New Activity')).not.toBeVisible({ timeout: 5000 });

    // The activity should appear in the upcoming activities section
    await expect(page.getByText('Upcoming Test')).toBeVisible({ timeout: 5000 });
  });

  test('should edit an existing activity', async ({ page }) => {
    await setupPlanner(page);

    // Create an activity first
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    await page.getByRole('button', { name: '+ Add Activity' }).click();
    await page.getByPlaceholder("What's the activity?").fill('Original Title');
    await page.getByRole('button', { name: 'One-off' }).click();
    await page.locator('input[type="date"]').fill(tomorrowStr);
    await page.getByRole('button', { name: 'Add Activity', exact: true }).click();
    await expect(page.getByText('New Activity')).not.toBeVisible({ timeout: 5000 });

    // Click on the activity in the upcoming list to edit it
    await page.getByText('Original Title').click();

    // Modal should open in edit mode
    await expect(page.getByText('Edit Activity')).toBeVisible({ timeout: 5000 });

    // Change the title
    await page.getByPlaceholder("What's the activity?").fill('Updated Title');
    await page.getByRole('button', { name: 'Save Activity' }).click();

    // Modal should close
    await expect(page.getByText('Edit Activity')).not.toBeVisible({ timeout: 5000 });

    // Verify update in IndexedDB
    const exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    expect(exported.activities![0].title).toBe('Updated Title');

    // Updated title should be visible in the upcoming list
    await expect(page.getByText('Updated Title')).toBeVisible();
    await expect(page.getByText('Original Title')).not.toBeVisible();
  });

  test('should delete an activity with confirmation', async ({ page }) => {
    await setupPlanner(page);

    // Create an activity first
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    await page.getByRole('button', { name: '+ Add Activity' }).click();
    await page.getByPlaceholder("What's the activity?").fill('To Delete');
    await page.getByRole('button', { name: 'One-off' }).click();
    await page.locator('input[type="date"]').fill(tomorrowStr);
    await page.getByRole('button', { name: 'Add Activity', exact: true }).click();
    await expect(page.getByText('New Activity')).not.toBeVisible({ timeout: 5000 });

    // Click on the activity to open edit modal
    await page.getByText('To Delete').click();
    await expect(page.getByText('Edit Activity')).toBeVisible({ timeout: 5000 });

    // Click the delete button in the modal footer (🗑️ with aria-label="Delete")
    await page.getByLabel('Delete').click();

    // Activity modal closes first, then confirmation dialog appears
    await expect(page.getByText('Are you sure you want to delete this activity?')).toBeVisible({
      timeout: 10000,
    });

    // Wait for the edit modal to fully close before clicking confirm
    await expect(page.getByText('Edit Activity')).not.toBeVisible({ timeout: 5000 });

    // Confirm deletion — the ConfirmModal uses t('action.delete') = "Delete"
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

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

    await page.getByRole('button', { name: '+ Add Activity' }).click();

    // Basic fields
    await page.getByPlaceholder("What's the activity?").fill('Soccer Practice');
    await page.locator('input[type="date"]').fill('2026-03-02');

    // Start time defaults to 9:00 AM — already correct, no action needed

    // Open end time dropdown (trigger shows "Select a time") then select 10:30 AM
    await page.getByRole('button', { name: 'Select a time' }).click();
    await page.getByRole('button', { name: '10:30 AM' }).click();

    // Recurrence defaults to Recurring + Weekly

    // Location and instructor fields are now inline
    await page.getByPlaceholder('Location').fill('City Sports Park');
    await page.getByPlaceholder('Instructor / Coach').fill('Coach Johnson');
    await page.getByPlaceholder('Contact').fill('coach@sports.com');

    // Save — use exact match to avoid conflict with "+ Add Activity" header button
    await page.getByRole('button', { name: 'Add Activity', exact: true }).click();
    await expect(page.getByText('New Activity')).not.toBeVisible({ timeout: 5000 });

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

  test.skip('should show legend with category colors', async ({ page }) => {
    await setupPlanner(page);

    // Legend should display category names
    await expect(page.getByText('Legend')).toBeVisible();
    await expect(page.getByText('Lesson')).toBeVisible();
    await expect(page.getByText('Sport')).toBeVisible();
    await expect(page.getByText('Appointment')).toBeVisible();
  });
});
