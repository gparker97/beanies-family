---
date: 2026-09-13
category: feature
issue: none (direct implementation; follows Notion #88)
plan: none — built directly from the conversation
tags: [lists, notifications, reminders, cookbook, calendar-sync]
---

# List due-date reminders, recipe-list details, and a calendar 403 misclassification

## Prompts

### 1 — Does a created list notify anyone? (investigation)

> the user asked if a notification could be sent when a list is created. i wanted to ask if this is already built. i confirmed from the UI that when a list is created and assigned to a family member, it shows up in the daily briefing as a task. does that list also show up in the notifications drawer and trigger a notification under any scenario? if a list is _only_ assigned but does not have a due date, then i think showing up in the daily briefing only and NOT having a notification is correct. but if the list has an explicitly set due date, i think triggering a notification (let's say at 9am on the day it is due) makes sense, and also satisfies the user's request, not just for this list, but any list with a due date set. what do you think?

Answer: the only list bell entry was `list-completed`; `ReminderKind` was
`'activity' | 'travel' | 'todo'`, so lists produced no OS notification at all.
`ALL_DAY_REMINDER_HOUR = '09:00'` already existed as the house convention for
dated-but-untimed items, so the 9am instinct matched the existing rule.

### 2 — Build it

> yes please build it

### 3 — The same-day case (mid-build)

> just to confirm, let's say the list is created on the same day it is due, but after 9am (i.e. current day but at 3pm) - will the notification still fire for the assigned user?

It would not have. Led to `listFireTime`, whose catch-up must be a pure function
of stored data — every reschedule re-arms the whole desired set, so a fire time
derived from `now` walks forward forever and never arrives.

### 4 — Owner + due date at creation, and confirm the edit path

> can you include the ability to set a list assignee and the due date in the shopping list modal from within the cookbook? this would be key since somebody creating the list would probably already have in mind who is going to do it and when, so that as soon as the list is creatred it has the key details, and if needed, a notification is immediately triggered
>
> please also confirm that the notification / trigger function works as expected when editing a list that is already created (adding an assignee/due date at any time)

### 5 — Error review + session code review

> once this is done, appreciate if you can help perform an /error-review on an error that came through last night tha ti haven't seen before - seems to be a rate limit issue [...] once you've diagnosed and fixed (or addressed somehow) this issue, please perform a code review across all code implemented in this session to confirm it works as expected and does not introduce any new bugs, side effects, or security issues. fix any issues found.

## Outcome

Shipped in four commits. The code review found 15 issues; the material ones are
recorded in the code itself:

- The owner gate was `!== 'hidden'`, which lets an unresolvable or child owner
  through — an unowned dated list would have armed 09:00 on every device.
- The same-day catch-up keyed on `createdAt`, so adding "due today" to an older
  list armed nothing — the primary editing flow.
- The throttle carve-out suppressed the Slack page but still advanced the
  one-shot escalation counter, so a quota blip spent a connection's only
  critical alert.
- `quotaExceeded` / `dailyLimitExceeded` were made retryable, tripling requests
  against an already-exhausted shared quota.
- The due-date hint promised a notification on web, where none is ever armed.

Known follow-ups, deliberately not done here: `driveService` has the identical
403-is-not-forbidden bug; there is no per-kind reminder toggle for lists; the
reschedule fires a full OS reconcile on every list-item tick (pre-existing, now
also reached by lists); `listFireTime` is general enough to belong in
`utils/reminderSchedule.ts`, where all-day to-dos have the same after-09:00 hole.
