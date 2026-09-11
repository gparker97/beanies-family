---
date: 2026-09-11
category: enhancement
issue: Notion #94
plan: docs/plans/2026-09-11-google-calendar-one-time-import.md
tags: [calendar, google-calendar, import, recurrence, rrule, privacy, automerge, i18n, dark-mode]
---

# One-time Google Calendar import (#94)

An early adopter asked for a button that brings the events they already have in Google
Calendar into beanies, once, with a review step before anything is written.

## Prompts

**2026-09-11 — the intake.** greg asked, verbatim:

> let's prepare the pre-plan for issue #94 - which is the feedback from an early adopter asking
> for a one-time google calendar import button. the functionality should allow the user to
> import their activities and events and provide a one-time import viewer to view imported
> event details, similar to what we have to travel plans, to view and accept or remove any
> event (on an event by event basis). as per the details in the tracker, we should preserve all
> the key info and everything in the event in google calendar, including particularly recurrence
> schedules. once done move onto /beanies-plan and once the plan is complete move to
> implementation. once implementation is done run a /code-review max against the implementation
> to ensure everything is implemented as per the plan and does not introduce any bugs, side
> effects, or security issues. fix all issues found and print a browser testing summary once
> done. for any tests you are able to perform yourself using playwright, headless browser, etc
> please go ahead to perform the browser testing and fix any issues found. work autonomously and
> if any questions for me please ask them now

**On the mockup.**

> once the mockup is ready please put it as an artifact on claude so i can check it before
> implementation

**On row density and selection.**

> Looks good, but to confirm, for each mail item, will it be selected by default? I would
> propose that all items imported are selected by default. Also please be sure to include a
> select all / deselect all button for convenience, given there may be lots of events. my
> initial reaction is that a single row looks a bit tall for a table that could potentially have
> hundreds of rows.

Followed by a `/frontend-design:frontend-design` review clamped to the CIG and theme skill. The
row went from 130px to 42px, and the cause turned out to be writing, not layout: the outcome
EXPLANATION was repeated on every row. Hoisted into a legend that appears once, the row keeps
only its chip. Shipped at a measured 40px.

**On the blog post's privacy claim.**

> agree, let's update the blog post once this is released. we can just change it to something
> like we never read your events (unless you specifically ask us to) or something to that effect

**On finishing.**

> carry on into stage 2 and complete all stages, work autonomously. once done, as mentioned
> before run a /code-review max to ensure everything was implemented as per the plan and does
> not introduce new bugs, side effects, or security issues, and fix all issues found. once that
> is done, run browser tests to the extent you can do so autonomously to catch any UI, layout,
> or other functional issues.

## Outcome

Shipped across four implementation commits plus a review-fix pass.

### What the feature does

- A per-connection drawer in Settings: choose calendars, scan the next 12 months, review every
  candidate, commit the ticked ones in ONE Automerge batch. Everything actionable is ticked by
  default, with select-all/deselect-all.
- **The commit writes NOTHING to Google.** Adoption is achieved by recording a link whose
  `googleEventId` is the real Google id and whose `lastPushedHash` is the activity's correct
  current hash, so the next reconcile finds them equal and no-ops. No insert, no patch, nothing
  to half-succeed.
- Recurrence is preserved as a real `RecurrenceRule` wherever beanies can express the RRULE
  faithfully; where it cannot, the event comes across once and is pinned to `origin: 'external'`
  so beanies can never push an empty recurrence back and collapse the user's series.

### The things that would have been destructive

- **The tracker's own adoption mechanism could not work.** `reconcilePlan` derived the event id
  from the activity and ignored `link.googleEventId`, so an adopted event would have been
  patched under the wrong id. Fixed with `masterEventId()` (the link is authoritative) plus a
  migration-safety test that drives the real producer.
- **beanies deleted remote events from three places**, two of them reachable after an import —
  which would have deleted a school's event out of a parent's real calendar. Funnelled through
  one `deleteRemoteEventForLink()` seam, guarded by `beaniesMayDelete`, with a source-scan test
  asserting `client.deleteEvent(` appears exactly once.
- **Automerge materialises map keys SORTED**, so the `JSON.stringify`-based push hash was
  unstable across a reload — verified empirically, then fixed with a canonical key-ordering
  replacer.
- **The RRULE anchor was device-local.** A Singapore Tuesday series imported from a device west
  of that zone resolved to Monday. Verified with `TZ=Pacific/Honolulu` (3 red tests), fixed by
  anchoring on the event's own timezone.
- **RFC 5545 SKIPs short months for `BYMONTHDAY=31`; the beanies engine CLAMPs.** Rather than
  silently disagree, the parser now refuses those patterns and the event comes across once.
- **Google does not write an EXDATE when you delete one occurrence** — it writes a separate
  cancelled instance. So `showDeleted=false` hid exactly the signal the EXDATE guard needed, and
  a series the family had been pruning would have been adopted whole, putting deleted lessons
  back. The read now asks for deleted items on purpose, and `eventTypes=default` keeps Working
  Location / OOO / Focus Time out of the review list.
- **`ImportNotVisibleError` is thrown AFTER the batch commits**, and the modal was calling it a
  failure — inviting a retry that would have made a second full set of activities. Narrowed on
  the error type (the `listStore` precedent) with copy that says the events ARE in.

### Marketing and legal surfaces corrected

The blog post, the homepage and `privacy.astro` all claimed beanies never reads Google Calendar
events. That stopped being true the moment this shipped, so all three were corrected in the same
change — including two claims on the privacy page that were already false before this feature
existed (the scope list omitted `calendar.calendarlist.readonly`, and "disconnecting never
deletes events from your Google Calendar" contradicted the bullet three lines above it).

### Found only in a browser

Eight layout and routing defects that 7,497 green tests did not catch, including: rows painting
the drawer's own tokens (invisible against their container), a sticky header a step below the
drawer, two nested scrollers hiding the action bar, `flex-1` truncating titles to two
characters, a one-character location beside the time, a repeat chip wrapping a 40px phone row to
100px, and — the one that mattered most — `isPublicEntryRoute`'s hand-maintained name list,
which its own docblock warns drifts, having drifted: the `/dev/calendar-import` harness
redirected to `/welcome` and could not be opened at all. Replaced with a prefix test so the next
dev harness cannot be forgotten the same way.
