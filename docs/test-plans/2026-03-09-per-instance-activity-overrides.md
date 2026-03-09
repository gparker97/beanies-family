# Test Plan: Per-Instance Overrides for Recurring Activities

> Date: 2026-03-09
> Feature: Edit/delete individual occurrences of recurring activities

## Prerequisites

- App running locally (`npm run dev`)
- At least one family member exists
- Navigate to Family Planner page

---

## 1. Setup: Create a recurring activity

1. Click **+ Add Activity**
2. Title: "Weekly Piano"
3. Set date to a day in the current month
4. Recurrence should default to **Recurring / Weekly**
5. Set start time to 10:00 AM, end time to 11:00 AM
6. Click **Add Activity**
7. **Verify:** Activity appears in the calendar grid with dots on the correct weekdays
8. **Verify:** Multiple occurrences appear in the Upcoming Activities list

---

## 2. Edit a single occurrence ("This Occurrence Only")

1. Click any occurrence of "Weekly Piano" in the Upcoming Activities list
2. **Verify:** Activity Details view modal opens showing the correct date
3. Click **Edit**
4. **Verify:** Scope modal appears with three options: "This Occurrence Only", "This & All Future", "All Occurrences"
5. Click **This Occurrence Only**
6. **Verify:** Edit modal opens with the activity fields pre-filled
7. Change the title to "Special Piano Session"
8. Change the start time to 2:00 PM
9. Click **Save Activity**
10. **Verify:** Modal closes
11. **Verify:** "Special Piano Session" appears in the upcoming list at the date you edited
12. **Verify:** All other occurrences still show "Weekly Piano" with the original time
13. **Verify:** The calendar grid still shows dots on the correct days (original + override)

---

## 3. Edit this and all future occurrences ("This & All Future")

1. Click an occurrence of "Weekly Piano" that is NOT the first one (pick one in the middle)
2. Click **Edit** in the view modal
3. Click **This & All Future** in the scope modal
4. **Verify:** Edit modal opens
5. Change the title to "Advanced Piano"
6. Change the start time to 3:00 PM
7. Click **Save Activity**
8. **Verify:** Modal closes
9. **Verify:** Occurrences BEFORE the selected date still show "Weekly Piano" at the original time
10. **Verify:** The selected date and all dates AFTER it show "Advanced Piano" at 3:00 PM
11. **Verify:** The calendar grid updates accordingly

---

## 4. Edit all occurrences ("All Occurrences")

1. Click any occurrence of "Advanced Piano" (from step 3)
2. Click **Edit** in the view modal
3. Click **All Occurrences** in the scope modal
4. **Verify:** Edit modal opens
5. Change the title to "Piano Masterclass"
6. Click **Save Activity**
7. **Verify:** ALL occurrences of "Advanced Piano" now show "Piano Masterclass"
8. **Verify:** The earlier "Weekly Piano" occurrences are unaffected (they are a separate series)

---

## 5. Delete a single occurrence ("This Occurrence Only")

1. Click any occurrence of "Piano Masterclass"
2. In the view modal, click **Delete**
3. **Verify:** Scope modal appears with the three options
4. Click **This Occurrence Only**
5. **Verify:** That specific occurrence disappears from the upcoming list
6. **Verify:** All other occurrences remain visible
7. **Verify:** The calendar dot for that day is removed (if no other activities on that day)

---

## 6. Delete this and all future ("This & All Future")

1. Click an occurrence of "Piano Masterclass" that is NOT the first one
2. Click **Delete** in the view modal
3. Click **This & All Future**
4. **Verify:** The selected occurrence and all future ones disappear
5. **Verify:** Earlier occurrences remain

---

## 7. Delete all occurrences ("All Occurrences")

1. Click any remaining occurrence of "Weekly Piano" (the original series)
2. Click **Delete** in the view modal
3. Click **All Occurrences**
4. **Verify:** Confirmation dialog appears ("Are you sure you want to delete this activity?")
5. Click **Delete**
6. **Verify:** All occurrences of that series are removed

---

## 8. One-off activities are unaffected

1. Click **+ Add Activity**
2. Title: "Doctor Appointment"
3. Toggle to **One-time** mode
4. Set a date and time
5. Click **Add Activity**
6. Click the appointment in the upcoming list
7. Click **Edit**
8. **Verify:** Edit modal opens directly -- NO scope modal appears (it's not recurring)
9. Change the title and save
10. **Verify:** Change is applied
11. Click the appointment again, click **Delete**
12. **Verify:** Confirmation dialog appears directly -- NO scope modal (not recurring)

---

## 9. Scope modal from Day Agenda sidebar

1. Create a new recurring activity (or use an existing one)
2. Click a day on the calendar grid that has a recurring activity
3. **Verify:** Day Agenda sidebar opens
4. Click the activity in the sidebar
5. **Verify:** Activity Details view modal opens with the correct occurrence date
6. Click **Edit**, then choose a scope option
7. **Verify:** Edit works correctly (same behavior as from Upcoming Activities)

---

## 10. Scope modal from Family Nook (Dashboard)

1. Navigate to **Family Dashboard** (Family Nook)
2. **Verify:** Schedule Cards section shows upcoming activities
3. Click a recurring activity occurrence
4. **Verify:** Activity Details view modal opens
5. Click **Edit**
6. **Verify:** Scope modal appears for recurring activities
7. Choose a scope and verify the edit works

---

## 11. Inactive activities section

1. Create a recurring activity, then delete a single occurrence (step 5 above)
2. Scroll down on the planner page
3. **Verify:** "Inactive activities" section appears with a count
4. Click to expand
5. **Verify:** The deleted single occurrence appears in the inactive list

---

## 12. Help article

1. Navigate to **Help** (sidebar)
2. Find the article "Family Planner & Activities"
3. **Verify:** Article loads and contains sections on:
   - Overview
   - Creating activities (one-off vs recurring)
   - Recurring activities (weekly, daily, monthly, yearly)
   - Editing a single occurrence (This Occurrence Only / This & All Future / All Occurrences)
   - Deleting recurring occurrences (same three options)
   - Activity details (location, transport, instructor, notes, fees)
   - Calendar views
   - Inline editing

---

## 13. Edge cases

### 13a. Cancel scope modal

1. Click a recurring occurrence, click **Edit**
2. When scope modal appears, click **Cancel** (or close it)
3. **Verify:** Nothing changes, you return to the view modal

### 13b. Override appears correctly in month view

1. After editing a single occurrence (step 2), navigate months back and forth
2. **Verify:** The override shows on the correct day, not duplicated

### 13c. Multiple overrides on same series

1. Edit two different occurrences of the same recurring activity using "This Occurrence Only"
2. Give them different titles
3. **Verify:** Both overrides appear with their unique titles
4. **Verify:** All other occurrences still show the original title

### 13d. Read-only mode (non-owner member)

1. If possible, switch to a family member with limited permissions
2. Click a recurring activity
3. **Verify:** Edit and Delete buttons respect permission settings

---

## Automated test coverage

The following automated tests cover this feature:

### Unit tests (`npm run test:run`)

- `activityStore > expandRecurring with overrides > should skip dates with materialized overrides`
- `activityStore > expandRecurring with overrides > should include override as one-off`
- `activityStore > splitActivity > should end-date original and create new template`
- `activityStore > splitActivity > should preserve original recurrenceEndDate on new template`
- `activityStore > materializeOverride > should create one-off with parentActivityId`
- `activityStore > materializeOverride > should apply overrides on top of parent fields`
- `activityStore > materializeOverride > should strip recurrence fields`

### E2E tests (`npx playwright test e2e/specs/09-planner.spec.ts`)

- `should edit a single occurrence of a recurring activity (this only)`
- `should edit this and all future occurrences of a recurring activity`
- `should edit all occurrences of a recurring activity`
