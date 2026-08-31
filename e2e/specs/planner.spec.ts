import { test, expect } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { gotoRoot, gotoRoute } from '../helpers/navigation';
import { ui } from '../helpers/ui-strings';
import {
  dismissActivityCreatedConfirm,
  openAddActivity,
  submitActivity,
} from '../helpers/activity-modal';
import { selectBeanieDate } from '../helpers/date-picker';
import { tomorrowOrTodayStr } from '../helpers/test-dates';

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
    await gotoRoot(page);
    dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await gotoRoot(page);
    await bypassLoginIfNeeded(page);

    // Navigate to planner (defaults to month view).
    await gotoRoute(page, '/activities');
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

  /** `YYYY-MM-DD` + n days, as a plain string (no timezone conversion). */
  function addDaysStr(ymd: string, days: number): string {
    const d = new Date(ymd.slice(0, 10) + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  }

  /**
   * Start date for a weekly series that is guaranteed to render at least TWO
   * occurrences in the current month grid.
   *
   * `tomorrowOrTodayStr` only guarantees the START is in-month. The recurring
   * scope tests must click the SECOND occurrence (on the first, the template
   * start and the clicked occurrence are the same value, so a date assertion
   * proves nothing) — and that occurrence is start+7, which falls into the
   * NEXT month whenever the series starts in the last week. The month grid
   * would not render it and `nth(1)` would time out.
   *
   * So: use tomorrow when start+7 still fits in the month, otherwise fall back
   * to the 1st. A start in the past is fine here — every one of these tests
   * asserts against IndexedDB, and the month grid renders past days normally.
   *
   * Every month calculation below anchors on TODAY's month, never tomorrow's:
   * on the last day of a month `tomorrow` has already rolled into the next one,
   * and a series started there renders nothing in the grid the planner is
   * showing. That made both recurring-scope tests fail on 2026-08-31.
   */
  function recurringSeriesStartStr(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const tomorrowIsThisMonth = tomorrow.getFullYear() === year && tomorrow.getMonth() === month;
    const useFirst = !tomorrowIsThisMonth || tomorrow.getDate() + 7 > lastDayOfMonth;
    const target = useFirst ? new Date(year, month, 1) : tomorrow;
    return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(
      target.getDate()
    ).padStart(2, '0')}`;
  }

  /** Helper to create a recurring activity and dismiss the confirmation. */
  async function createRecurringActivity(page: import('@playwright/test').Page, title: string) {
    await openAddActivity(page);
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill(title);
    await selectAssignee(page);
    await selectBeanieDate(page.locator('div[role="dialog"]'), recurringSeriesStartStr());
    await submitActivity(page);
    await dismissActivityCreatedConfirm(page);
  }

  /**
   * Open view modal then edit modal for the `index`-th occurrence of an activity.
   *
   * Defaults to the first occurrence, but recurring-scope tests MUST pass
   * `index: 1` or higher: on the FIRST occurrence the template's start date and
   * the clicked occurrence date are the SAME VALUE, so a date assertion there
   * passes whether the code used the right one or not. See
   * `recurringSeriesStartStr` for why a second occurrence is always rendered.
   */
  async function openEditModal(page: import('@playwright/test').Page, title: string, index = 0) {
    if (index > 0) {
      await expect(page.getByText(title).nth(index)).toBeVisible({ timeout: 15000 });
      expect(await page.getByText(title).count()).toBeGreaterThan(index);
    }
    // Modal-to-modal transitions can exceed 5s on webkit under CI load;
    // bump to 15s to match the hardening pattern used elsewhere
    // (activity-modal.ts, onboarding wizard test).
    await page.getByText(title).nth(index).click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /edit/i }).click();
    await expect(page.getByText(/edit activity/i)).toBeVisible({ timeout: 15000 });
  }

  test('Activity CRUD lifecycle', async ({ page }) => {
    await setupPlanner(page);

    // --- CREATE: one-time activity ---
    await openAddActivity(page);

    // Verify modal opened
    await expect(page.getByText(/new activity/i)).toBeVisible();

    // Fill in form
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Doctor Visit');
    await selectAssignee(page);

    // Switch to one-off mode
    await page.getByRole('button', { name: /one-time/i }).click();

    // Fill date — tomorrow when in-month, clamped to today on month-end so the
    // activity chip stays in the visible calendar grid.
    const tomorrowStr = tomorrowOrTodayStr();
    await selectBeanieDate(page.locator('div[role="dialog"]'), tomorrowStr);

    // Save
    await submitActivity(page);

    // Dismiss confirmation modal
    await dismissActivityCreatedConfirm(page);

    // Verify one-time activity persisted in IndexedDB
    let exported = await dbHelper.exportData();
    expect(exported.activities).toHaveLength(1);
    expect(exported.activities![0].title).toBe('Doctor Visit');
    expect(exported.activities![0].recurrence).toBe('none');

    // --- CREATE: recurring activity ---
    await openAddActivity(page);

    // Fill in form — recurrence defaults to "Recurring"
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Piano Lesson');
    await selectAssignee(page);
    await selectBeanieDate(page.locator('div[role="dialog"]'), '2026-03-04');

    // Open start time dropdown (trigger shows "9:00 AM" by default) then select 3:00 PM
    await page.getByRole('button', { name: '9:00 AM' }).first().click();
    await page.getByRole('button', { name: '3:00 PM' }).click();

    // End time auto-updates to startTime + 1hr = 4:00 PM — no action needed
    // Recurrence stays at default (Recurring + Weekly)

    // Save
    await submitActivity(page);

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
    // Click on the activity chip in the calendar grid — opens view modal first.
    // (Post `ea66dd4`, FamilyPlannerPage no longer renders the Upcoming list;
    // calendar chips are the single source for activity entry points.)
    await page.getByText('Doctor Visit').first().click();
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

    // Updated title should be visible on the calendar; old title should be gone
    await expect(page.getByText('Updated Visit').first()).toBeVisible();
    await expect(page.getByText('Doctor Visit', { exact: true })).toHaveCount(0);

    // --- DELETE: remove the one-time activity ---
    // Click the chip again to reopen the view modal
    await page.getByText('Updated Visit').first().click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 5000 });

    // Click the delete button in the view modal footer
    await page.getByLabel(/delete/i).click();

    // Confirmation dialog appears ON TOP of the view drawer, which stays open behind
    // it. Post 9b0d467b the drawer's `emit('close')` fires only after a *confirmed*
    // delete (so cancelling keeps the drawer open) — the drawer no longer closes up
    // front. Scope the confirm click to the confirm dialog: the drawer's own delete
    // button shares the same "Delete" accessible name, so an unscoped getByRole would
    // hit a strict-mode violation now that both are mounted.
    const deleteConfirmDialog = page
      .locator('div[role="dialog"]')
      .filter({ hasText: 'Are you sure you want to delete this activity?' });
    await expect(deleteConfirmDialog).toBeVisible({ timeout: 10000 });

    // Confirm deletion
    await deleteConfirmDialog.getByRole('button', { name: /^delete$/i }).click();

    // A confirmed delete closes both the confirm dialog and the view drawer
    await expect(deleteConfirmDialog).toHaveCount(0);
    await expect(page.getByText(/activity details/i)).not.toBeVisible({ timeout: 5000 });

    // Activity should be removed from the calendar grid
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

    // Edit the SECOND occurrence, never the first. The series starts tomorrow,
    // so on the first occurrence the template's start date and the clicked
    // occurrence date are the SAME VALUE — which made this test structurally
    // incapable of catching the 2026-08-15 data-loss bug, where the override
    // was written to the template's start date instead of the clicked one.
    const occurrences = page.getByText('Weekly Lesson');
    await expect(occurrences.nth(1)).toBeVisible({ timeout: 15000 });
    const occurrenceCount = await occurrences.count();
    expect(occurrenceCount).toBeGreaterThanOrEqual(2); // the blind spot must not return

    await occurrences.nth(1).click();
    await expect(page.getByText(/activity details/i)).toBeVisible({ timeout: 15000 });

    // Click Edit — edit modal opens directly (scope deferred to save)
    await page.getByRole('button', { name: /edit/i }).click();
    await expect(page.getByText(/edit activity/i)).toBeVisible({ timeout: 15000 });

    // Change ONLY the title — deliberately do not touch the date field.
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

    // THE REGRESSION ASSERTIONS. The override must land on the occurrence the
    // user clicked (one week after the series start), NOT on the template's
    // start date — and must not be tagged as a reschedule, because the user
    // never touched the date field.
    const expectedDate = addDaysStr(original!.date, 7);
    expect(override!.date).toBe(expectedDate);
    expect(override!.date).not.toBe(original!.date);
    expect(override!.originalOccurrenceDate).toBeUndefined();

    // A leaked series rule would hide the override once the series ends. NOTE:
    // this fixture has no "ends on" date, so `recurrenceEndDate` is vacuously
    // undefined — `daysOfWeek` is the load-bearing assertion here (the series
    // DOES set it), and the leak itself is pinned properly by the store suite's
    // 'never inherits recurrenceEndDate' test.
    expect(override!.daysOfWeek).toBeUndefined();
  });

  test('Recurring: edit this and all future creates new template', async ({ page }) => {
    await setupPlanner(page);

    // Create a weekly recurring activity starting tomorrow
    await createRecurringActivity(page, 'Piano Class');

    // The SECOND occurrence — on the first, the template start and the clicked
    // occurrence are the same value, so the date assertions below would pass
    // whichever one the split used.
    await openEditModal(page, 'Piano Class', 1);

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
    // The new template starts at the CLICKED (second) occurrence — asserted
    // exactly, because `toBeTruthy()` here passed for any date at all and so
    // could not catch the form payload overwriting the split's start date.
    const splitDate = addDaysStr(recurringSeriesStartStr(), 7);
    expect(newTemplate!.date).toBe(splitDate);
    expect(newTemplate!.date).not.toBe(recurringSeriesStartStr()); // not the series start
    // The end-dated original must stop the day before the split.
    expect(original!.recurrenceEndDate).toBe(addDaysStr(splitDate, -1));
    // The split must not clone the fee link onto the new template.
    expect(newTemplate!.linkedRecurringItemId).toBeUndefined();
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

    // Create a weekly recurring activity starting tomorrow (clamped to today
    // on month-end so the first occurrence is in the visible calendar grid).
    const tomorrowStr = tomorrowOrTodayStr();
    const startDate = new Date(`${tomorrowStr}T00:00:00`);

    // Calculate a reschedule target date (3 days after the start)
    const rescheduleTarget = new Date(startDate);
    rescheduleTarget.setDate(rescheduleTarget.getDate() + 3);
    const rescheduleStr = `${rescheduleTarget.getFullYear()}-${String(rescheduleTarget.getMonth() + 1).padStart(2, '0')}-${String(rescheduleTarget.getDate()).padStart(2, '0')}`;

    await openAddActivity(page);
    await page.getByPlaceholder(ui('modal.whatsTheActivity')).fill('Reschedule Test');
    await selectAssignee(page);
    await selectBeanieDate(page.locator('div[role="dialog"]'), tomorrowStr);
    await submitActivity(page);

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
    await selectBeanieDate(dialog, rescheduleStr);

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
