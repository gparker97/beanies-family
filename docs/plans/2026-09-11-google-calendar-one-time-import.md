# Plan: One-time reviewed import of existing Google Calendar events

> Date: 2026-09-11
> Related issues: Notion tracker #94 (no GitHub issue — `github issue` = do not create)
> Plan file: `docs/plans/2026-09-11-google-calendar-one-time-import.md`
> Mockup: `docs/mockups/google-calendar-import-2026-09-11.html`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent who just connected Google Calendar with a year of activities already in it, I want
beanies to bring those events across once, with me choosing what comes, so that I do not have to
retype my family's life or end up with two of everything on my calendar.

## Context

A new family connected their Google Calendar, expected their existing events to come across, and
found a push-only link. Their feedback, verbatim (2026-09-10):

> I was able to sync my Google calendar but didn't realize it was a unidirectional connection. I
> have a lot of things on my calendar that I expected would transfer, and typing them all into
> beanies is going to be a bit much and will duplicate the events already on my calendar. Please
> consider adding a bidirectional connection. Thanks!

This is a **migration, not a sync**: one direction, once, user-reviewed, then it ends. beanies
remains the golden source. Adoption strengthens that rather than weakening it, because the events
it touches become beanies-owned.

### ⚠️ The finding that reshapes this plan

The tracker's requirement 5 says to adopt by "linking the new activity to the existing Google
event id so the next reconcile PATCHES instead of inserting". **That does not work against the
current engine.** Verified at `src/utils/calendar/reconcilePlan.ts:136-141`:

```ts
const upserts: ReconcileUpsert[] = pushable.map((activity) => ({
  activity,
  eventId: deterministicEventId(activity.id), // ← derived, ALWAYS
  hash: computePushHash(activity, memberName),
  existingHash: linkByActivity.get(activity.id)?.lastPushedHash, // ← only field read from the link
}));
```

The plan reads exactly one field from the link (`lastPushedHash`) and derives the target event id
from the **activity id**. `link.googleEventId` is never consulted. Today that redundancy is
invisible, because every link was minted with `googleEventId === deterministicEventId(activityId)`.
The moment a link points at a **foreign** Google id, the engine ignores it and inserts a fresh
`b<uuid>` event: the duplicate this feature exists to prevent.

So adoption requires a change to the reconcile engine, which is the most safety-critical and
most-tested code in the calendar subsystem. That change, and the evidence that it is safe, is the
spine of this plan (Approach § 3).

### Current state

- Scope granted: `calendar.events.owned` (+ `calendar.calendarlist.readonly`, `userinfo.email`),
  `src/services/calendar/calendarAuth.ts:56-63`. Google documents this as "See, create, change,
  and delete events on Google calendars you own", which **includes** full event content. No new
  scope, no consent screen, no re-verification.
- The only event read is `listEventTimes` (`googleCalendarClient.ts:427-487`), whose field mask
  `items(id,recurringEventId,start,end,status,transparency)` is commented as "the privacy
  guarantee" and whose `singleEvents: 'true'` **expands** recurring events into instances.
- There is **no RRULE parser anywhere in the repo**. The whole recurrence direction is app → Google.
- `CalendarEventLink` has no origin/no-push/direction field, and `googleEventId` is already
  overloaded (master id, or instance id when `exceptionOf` is set).

## Requirements

1. One-time, user-initiated import from connected Google Calendars, offered as the next step after
   connecting AND permanently available in Settings.
2. Read window: **12 months forward from today, no past events.** A hard cap on how many candidates
   are listed.
3. Review-and-pick before anything is written. Every candidate is shown; the user ticks what becomes
   a beanies activity. Nothing imports silently.
4. Recurring masters import as beanies **recurring** activities with the recurrence set, so a weekly
   swim lesson arrives as one series, not N copies.
5. **ADOPT** the existing Google event wherever the user is the organizer, single and recurring
   alike, so the next reconcile PATCHES the original instead of inserting a second copy.
6. Where adoption is impossible (the user is an invitee), import the activity and mark its link
   **no-push** for that calendar, so no second copy is ever created.
7. Label invited events plainly in the review list **and on the imported activity**: beanies cannot
   change an event someone else created, edits in beanies will not reach Google, and the organizer's
   later changes will not reach beanies.
8. State per event, in the review step, what happens after import.
9. Update the privacy page (no Google Calendar section today) and the in-app connect copy.
10. Announce in a NEW blog post.
11. Preserve title, description, location, start/end, all-day flag, timezone and recurrence.
    **Do not store the attendee guest list.**
12. ONE import run across all connected calendars, chosen up front (all ticked by default), merged
    into ONE review list with each row labelled by its source calendar.

## Important Notes & Caveats

- **🔴 The engine derives the event id from the activity, not the link.** See Context. Adoption is
  impossible without changing `reconcilePlan.ts:138`. Do not attempt to work around it by minting an
  activity id that hashes to the Google id; Google ids are not base32hex-constrained the way
  `deterministicEventId` output is, and the mapping is not invertible.
- **🔴 beanies deletes remote events from FOUR places, not one, and every one of them is a
  data-loss hazard once a link can point at an event beanies did not create.** Verified:
  `reconcilePlan.ts:144` (`deletes = masterLinks.filter((l) => !pushableIds.has(l.activityId))`),
  `calendarSyncStore.ts:627` (applying those deletes), `calendarSyncStore.ts:1074`
  (`finishDisconnect` deletes the remote event for EVERY link), and `calendarSyncStore.ts:1115`
  (`setDestinationCalendar` deletes every old-calendar event before switching). A single
  `noPush` boolean read only by `reconcilePlan` leaves three of those four live: disconnecting
  a calendar, or changing the destination calendar, would delete the school's event from the
  parent's Google Calendar and delete the user's own pre-existing adopted events. The model must
  therefore express "beanies did NOT create this Google event" once, and all four sites must
  honour it. See Approach § 3d/3e.
- **🔴 The reconcile also writes to Google through `exceptionUpserts`.** `reconcilePlan.ts:154`
  builds them from `mastersById`, which is derived from `pushable`. An override child of an
  imported invited series would patch or cancel an INSTANCE of someone else's recurring event.
  Suppression has to be applied where `mastersById` is built, not only where `upserts` is built.
- **🔴 `CalendarEventLink` carries no `calendarId`, and every write goes to
  `connection.destinationCalendarId`** (`calendarSyncStore.ts:590`). Requirement 12 imports across
  ALL of the account's calendars, so an adopted event living on a NON-destination calendar would be
  patched against the destination calendar: the patch 404s, `applyUpsert` falls into
  `createOrResurrect` (`calendarSyncStore.ts:325`), and beanies INSERTS a copy of that event onto
  the destination calendar while the original drifts. That is precisely the duplicate this feature
  exists to prevent. Adding `calendarId` to the link means threading it through every client call in
  the engine, which is a far larger and riskier change than this feature warrants. So: **adoption is
  only offered for events on the connection's destination calendar.** Events on the account's other
  calendars still appear in the one merged review list (requirement 12 is unaffected) and import as
  copies, with the row saying why in plain words. The destination calendar id is read through the
  existing `calendarSyncStore.listCalendarsFor`, which already normalizes the `'primary'` alias to
  the concrete primary id (`calendarSyncStore.ts:1160`); comparing against the raw stored value
  without that normalization would wrongly refuse adoption on every connection still defaulting to
  `'primary'`.
- **🔴 No RRULE parser exists, and `RecurrenceRule` cannot express much of RRULE.** No `BYSETPOS`,
  no `BYMONTH`, no multi-`BYMONTHDAY`, no `EXDATE`, and `monthlyAnchor: 'weekday'` has no ordinal
  field (the ordinal is derived from the anchor date at `recurrenceRrule.ts:122`). beanies' own
  emitted RRULEs (`BYMONTHDAY=28,29,30;BYSETPOS=-1`) are not round-trippable. Unsupported patterns
  must have a defined, visible outcome — never a silently mangled series.
- **🟠 Import Google's `description` into `notes`, NOT into `description`.** Verified: the push
  builds the Google description from `notes` only (`eventDescription.ts:81-84`); `FamilyActivity.description`
  is not pushed and is not in `computePushHash`. Importing into `description` would mean the first
  post-import push **wipes the user's original event body** in Google. Importing into `notes` round-trips
  it. This single choice turns adoption from destructive into near-lossless, and the review copy
  should still say the body gets a beanies footer.
- **🟠 `FamilyActivity` has no timezone field.** `startTime`/`endTime` are bare local `HH:mm`; the
  push stamps the _device's_ IANA zone at write time (`calendarSyncStore.ts:191`). Import must convert
  Google's offset-bearing `dateTime` to local wall-clock on the importing device. An import on a
  device in one zone, later pushed from a device in another, shifts the event. That is a pre-existing
  property of the model, not something this feature introduces, but it is worth stating.
- **🟠 Five required fields have no Google source**: `category`, `feeSchedule`, `reminderMinutes`,
  `isActive`, `createdBy` — plus `assigneeIds`, which the activity form requires to be non-empty
  (`ActivityModal.vue:704-712`) while `createActivity` itself validates nothing
  (`automergeRepository.ts:64-91`). An import calling the store directly bypasses every form gate.
  Defaults are specified in Approach § 5 and must be applied deliberately, not left undefined.
- **🟠 Adding a method to `CalendarClient` breaks every test that builds a client** unless
  `src/services/calendar/__tests__/fakeCalendarClient.ts` (`makeCalendarClientStub`) gains a default.
  That stub exists precisely so this does not happen; update it in the same commit.
- **🟠 `googleCalendarClient.eventTimes.test.ts` pins the existing field mask.** The import is a
  SEPARATE read with a different mask and `singleEvents: false`. Do not widen `listEventTimes` in
  place: it serves the clash nudge, which wants expanded instances and the narrow mask, and that
  test is the guard proving it.
- **🟠 Telemetry context keys are allowlisted.** `action`, `kind`, `count` and `error_code` are
  available (`src/utils/diagnosticContext.ts:68,75`). `connectionId` is NOT, and is already being
  silently dropped at `calendarSyncStore.ts:755,1128,1172`. Stick to the allowlisted four; adding a
  key costs a five-file mirror update including the app-store data-collection declarations.
- **🟠 `logEvent` is rate-limited to 50 events per (surface, message) per 60s** (`logEvent.ts:74-75`).
  A per-row import log would be throttled and useless. Log per RUN with counts, not per event.
- **🟡 `CalendarSyncSettings.vue` has a single-slot `busyId`** (`:41`) shared by all per-connection
  buttons. A seconds-long import would spin Sync and Disconnect too.
- **🟡 The travel review precedent gives a modal shape, not a component.** `ExtractedSegmentRow.vue`
  is display-only with no emits and no selection; `TravelExtractReviewModal` emits one
  all-or-nothing `submit`. Per-row include/exclude has no precedent and must be built.
- **🔴 A live public claim becomes misleading when this ships, and IS IN SCOPE to fix.**
  `content/blog/2026-07-03-google-calendar-integration.md:47` says beanies "only ask[s] Google
  whether you're busy (and not for the details of any existing event)" and attributes that to "the
  limitations of the privacy scopes allowed by Google". That paragraph has **two** problems, not
  one: the busy-only claim becomes false when the import ships, and the attribution to Google's
  scopes was never true (`calendar.events.owned` always permitted content reads; the limit was
  self-imposed, as the same sentence's "by design" concedes).
  **greg's call, 2026-09-11: update that post when this ships**, superseding the tracker's original
  "do not edit, announce elsewhere". Direction: "we never read your events (unless you specifically
  ask us to)" or words to that effect. Fix **both** halves, so the post stops telling readers that
  Google prevents something Google does not prevent. This is a deliberate, authorized correction of
  a factual claim, which is the one thing that overrides the standing
  `feedback_blog_content_integrity` rule against editing post bodies; it is not licence to touch
  anything else in that post.
- **Out of scope, by decision**: any ongoing or repeated pull; non-Google calendars and `.ics`;
  ghost rendering of unimported events; importing from calendars the user does not own; past events;
  a persistent post-import management surface or batch undo; storing attendee email addresses.

## Assumptions

> **Review these before implementation.** Valid at planning time; may have changed.

1. `calendar.events.owned` still returns full event content for owned calendars. A live call with
   the widened mask is implementation step 1 — empirical confirmation, not a blocker.
2. `googleCalendarSync` remains flag-on in committed prod flags (`featureFlags.committed.ts:15`).
3. Every existing **master** link (`exceptionOf` absent) satisfies
   `googleEventId === deterministicEventId(activityId)`. Verified at the only write site,
   `calendarSyncStore.recordLink`, which is called from `applyUpsert` with `u.eventId`
   (`:316,330,340`). This is **not** true of EXCEPTION links: `applyExceptionUpsert` writes a real
   Google INSTANCE id (`:503`). That costs nothing, because `planReconcile` partitions on
   `exceptionOf` first (`:128-131`) and `linkByActivity` is built from master links only, and it is
   in fact the precedent for this whole change: `reconcilePlan.ts:165` ALREADY treats the link as
   the authority on where an exception lives in Google (`existingInstanceId: link?.googleEventId`).
   Approach § 3 extends an existing rule rather than inventing one. Asserted by a test rather than
   trusted, and the test must be scoped to master links or it will fail on the exception path.
4. The help center remains English-first; the article needs no `t()` plumbing.
5. No re-verification is required from Google, because the scope is unchanged.

## Approach

Seven phases, each independently mergeable and independently testable. Phases 1-4 are pure or
near-pure and carry the risk; phases 5-7 are UI and copy.

**Ship it in three stages, not one.** Scope is unchanged; this is sequencing only. The seam is
**the first line of code capable of writing an `origin` link**, because everything before it is
provably inert in production and everything after it needs a browser and a real calendar.

- **Stage 1, the engine, provably a no-op (phase 3).** `masterEventId`, `linkOwnership.ts`,
  `CalendarEventLink.origin`, `unlinks`, the `deleteRemoteEventForLink` funnel, the adopted-event
  no-reinsert branch, and every engine test including the migration-safety and named-regression
  ones. No code in this stage can produce a link with an `origin`, so its production behaviour is
  identical to today's and that claim is the whole of its review. Merging the riskiest change on its
  own, where the reviewer has nothing to weigh but the safety argument, is the single biggest
  reliability win available here, and a regression at this stage is trivially revertible, which it
  will not be once UI depends on it.
- **Stage 2, the read and the pure planning (phases 1, 2, 4).** `listEventsForImport` plus its
  pinned-mask test, `parseRrule`, `planImport`, `googleTimesToActivityFields`. Also inert: nothing
  calls any of it. This is the stage the live probe (Testing 11) gates, and if the probe surprises
  us the blast radius is a module nobody imports yet.
- **Stage 3, the feature (phases 5, 6, 7).** `calendarImportStore`, the modal and row, the entry
  points, and all copy. Browser testing belongs entirely here.

**The copy is not separable and must land with Stage 3, not before.** The privacy section describes
a read that does not happen until the import ships, and the `2026-07-03` blog correction says the
busy-only claim has changed while it is still true. Shipping either early makes the public claim
wrong in the other direction, which is the failure this plan exists to avoid repeating.

### 1. The read: full event content, as a separate method

Add to `CalendarClient` (`src/services/calendar/CalendarClient.ts`, after `listEventTimes`):

```ts
/** A Google event as the IMPORT needs it: content, recurrence, and ownership. */
export interface CalendarEventFull {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  /** Google's raw RRULE/EXDATE/RDATE lines on a recurring MASTER. */
  recurrence?: string[];
  /** True when the signed-in user is the organizer, so beanies may adopt it. */
  isOrganizer: boolean;
  status?: string;
  recurringEventId?: string;
}

listEventsForImport(
  connectionId: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<CalendarEventFull[]>;
```

Google impl beside `listEventTimes`, with the two deliberate differences from it:

- `singleEvents: 'false'` — masters carry their `recurrence[]`; instances are not expanded.
- field mask `nextPageToken,items(id,summary,description,location,start,end,recurrence,status,organizer(self),creator(self),recurringEventId)`.
  **`attendees` is deliberately absent**, which is the enforcement of requirement 11: the guest list
  is not requested, so it cannot be stored.

`isOrganizer` derives from `organizer.self === true` (falling back to `creator.self === true`).
Reuse `MAX_EVENT_PAGES`, the `do…while` paging shape, `authedFetch`, and the malformed-item
`console.warn`-and-skip discipline verbatim from `listEventTimes`.

**The chooser must know which calendars are read-only, and nothing in the plan currently tells it.**
`listCalendars` returns the WHOLE `calendarList`: "Holidays in United Kingdom", "Birthdays",
subscribed team calendars. `CalendarSummary` carries only `{ id, summary, primary }`
(`CalendarClient.ts:59-63`), so every one of them would be listed and ticked. A single holiday feed
can fill the 200-row cap with junk and push the family's real events out of the review list, and
`calendar.events.owned` cannot read it anyway, so the run would emit a pile of
`import_calendar_skipped` and look broken. The **approved mockup already specifies the answer**: its
chooser renders a "Holidays" calendar greyed, labelled "Read only" and UNTICKED. So `CalendarSummary`
gains `accessRole?: string`, a field already present in the `calendarList` response, so no mask to
widen, no extra request, and additive for `listCalendarsFor`'s synthetic fallback entry. The import
chooser ticks `accessRole === 'owner'` and shows anything else greyed, labelled "Read only" and
unticked. An ABSENT `accessRole` is treated as owner, so the chooser fails OPEN onto the existing
403-skip path rather than hiding a calendar the user does own. Requirement 12's "all ticked by
default" is unchanged and still holds for every calendar the import can actually read. Nothing else
reads the new field; the destination picker is untouched.

`makeCalendarClientStub` gains a `listEventsForImport: async () => []` default in the same commit.

### 2. Reading recurrence: a parser for the subset beanies can express

New pure module `src/utils/calendar/parseRrule.ts`, the mirror of `recurrenceRrule.ts`:

```ts
export type RruleParse =
  | { ok: true; rule: RecurrenceRule }
  | { ok: false; reason: 'unsupported-freq' | 'unsupported-parts' | 'multi-rule' | 'malformed' };

export function parseRecurrence(lines: string[], startYmd: string, isAllDay: boolean): RruleParse;
```

Supported (the exact inverse of what `ruleToRrule` emits, so beanies' own events round-trip):
`FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `BYDAY` (plain and single-ordinal like `2WE`),
single-value `BYMONTHDAY` including `-1` → `monthlyDay: 'last'`, `UNTIL` (both value forms) →
`end.kind:'onDate'`, `COUNT` → `end.kind:'afterCount'`, absence → `end.kind:'never'`.

Refused, with a reason rather than a guess: `BYSETPOS`, `BYMONTH`, `BYWEEKNO`, `BYYEARDAY`,
`BYHOUR`, multi-value `BYMONTHDAY`, any `EXDATE`/`RDATE`/`EXRULE` line, more than one `RRULE`,
multi-weekday `BYDAY` at `INTERVAL > 1` (the model forbids it, `recurrence.ts:38-43`).

**And the refusal that is easiest to miss: ANCHOR DISAGREEMENT.** `RecurrenceRule` stores no
monthly ordinal and no month; both are re-derived from the activity's own start date at expansion
and serialization time (`recurrenceRrule.ts:122`, `recurrence.ts:17-20`). So a parse is only
faithful when the RRULE agrees with what the start date already implies. `parseRecurrence` therefore
takes `startYmd` (it already does) and must REFUSE, not coerce, when:

- `FREQ=MONTHLY;BYDAY=2WE` but `getWeekdayOrdinalInMonth(start)` is not 2, or the start weekday is
  not Wednesday. Accepting it would store `monthlyAnchor:'weekday'` and silently produce the THIRD
  Wednesday series instead.
- `FREQ=MONTHLY;BYMONTHDAY=15` but the start date is not the 15th; or `BYMONTHDAY=-1` but the start
  date is not that month's last day.
- `FREQ=WEEKLY;BYDAY=...` whose day set does not contain the start weekday.
- `FREQ=YEARLY` with a `BYMONTH`/`BYMONTHDAY` that does not match the start date (already covered by
  refusing `BYMONTH`, restated because `recurrenceRrule.ts:141` emits exactly that shape for a
  29 Feb anchor, so beanies' own leap-day series is correctly refused).

This is the difference between "cannot copy, and said so" and "copied the wrong series", and it is
the whole point of the module.

One further known loss, stated so it is not discovered: with `singleEvents:false` Google also
returns a master's MODIFIED and CANCELLED instances as separate items. Those are skipped (they carry
`recurringEventId`), so the beanies copy is the clean pattern. For an ADOPTED series nothing is lost
in Google, because the import performs no Google write at all (§ 6) and those exceptions stay on the
original event. The review row for a series carrying any of them says so.

**A refusal is not an error, and it is not an exclusion.** The candidate appears in the review list
like any other, **ticked by default** (greg, 2026-09-11: everything actionable defaults on), with a
chip reading "comes across once" instead of a repeat pattern.

**A refused series imports on its NEXT OCCURRENCE IN THE WINDOW, not on its DTSTART.** This is the
detail that makes defaulting it on defensible. A two-year-old weekly standup whose pattern beanies
cannot express would otherwise land as a single stale event dated two years ago: worse than useless,
and quietly wrong. Landing it on the next occurrence makes it a real, useful, correctly-dated
one-off. Computing that date needs no RRULE engine of our own, and it must NOT be taken from the
import read: that read uses `singleEvents: false`, which returns masters plus their modified and
cancelled instances, and deliberately does **not** expand the series. The answer comes from
`CalendarClient.listInstances(connectionId, calendarId, masterEventId, todayIso, windowEndIso)`,
which **already exists** (`CalendarClient.ts:147-153`) and is already used by the exception path, so
no new client surface is needed. It is called only for refused series, which are a small minority,
and a failure there degrades to skipping that one candidate with a reason rather than failing the
scan.

That satisfies "never a silently mangled series" (it is one event, labelled as one event, not a
wrong repeat) while losing nothing the user wanted to keep.

Round-trip test: for every shape `buildRecurrenceRule` can emit, `parseRecurrence` returns the
original `RecurrenceRule`. Where it cannot (the `BYSETPOS` clamps beanies itself emits), the test
asserts a **refusal**, which documents the asymmetry honestly instead of hiding it.

### 3. The engine: honour the link's event id, and a no-push link

Two changes, both small, both in the most safety-critical code in the subsystem.

**3a. `reconcilePlan.ts:138` — target the id the link actually points at, in ONE place.**

The derivation is needed by both the master path (`:138`) and the exception-discovery path
(`calendarSyncStore.ts:388`), so it is written once, next to `deterministicEventId`, and both
callers use it. Nothing else in the codebase may hand-derive a Google event id from an activity id
after this change.

```ts
// src/utils/calendar/deterministicEventId.ts
/**
 * Where an activity's MASTER event actually lives in Google. The LINK is the
 * authority; the derived id is only the fallback for an activity beanies has
 * not pushed yet. Before import these were always equal for master links
 * (see Assumptions 3), which is why the old inline derivation read as harmless
 * redundancy; an ADOPTED link points at a foreign Google id and the derived
 * value would insert a duplicate beside the user's real event.
 */
export function masterEventId(link: CalendarEventLink | undefined, activityId: string): string {
  return link?.googleEventId ?? deterministicEventId(activityId);
}
```

```ts
// reconcilePlan.ts — `suppressed` is computed once and reused by 3b.
const suppressed = new Set(masterLinks.filter((l) => !beaniesMayPush(l)).map((l) => l.activityId));

const upserts: ReconcileUpsert[] = pushable
  .filter((a) => !suppressed.has(a.id))
  .map((activity) => {
    const link = linkByActivity.get(activity.id);
    return {
      activity,
      eventId: masterEventId(link, activity.id),
      hash: computePushHash(activity, memberName),
      existingHash: link?.lastPushedHash,
    };
  });

// Same set gates the EXCEPTION path: an override child of an invited series must
// never patch or cancel an instance of someone else's recurring event.
const mastersById = new Map(pushable.filter((a) => !suppressed.has(a.id)).map((a) => [a.id, a]));
```

**Why this is safe for existing data, provably:** every link ever written was created with
`googleEventId` set to the value the plan computed, which was `deterministicEventId(activityId)`.
So for all existing links the new expression returns exactly what the old one returned. This is
asserted, not assumed, by a test that builds links the way the store builds them and checks the
two agree (see Testing § 4).

**3b. `reconcilePlan.ts:144` — an imported link is never a stray link, and is never a remote delete.**

`deletes` today means "remove the remote event AND drop the link". An imported link needs the
second half without the first, so the plan gains one additive field, `unlinks`, rather than changing
the shape of `deletes` (which every existing engine test asserts against).

```ts
// `activityIds` already exists at :149 for exceptionRestores — hoist it above this loop.
const deletes: CalendarEventLink[] = [];
const unlinks: CalendarEventLink[] = [];
for (const l of masterLinks) {
  if (pushableIds.has(l.activityId)) continue;
  if (!beaniesMayDelete(l)) {
    // NEVER delete a Google event beanies did not create. Drop the link only once the
    // ACTIVITY itself is gone; while the activity merely sits inactive or out of the
    // push window, KEEP the link, because dropping it would let a later re-entry into
    // the window mint a fresh deterministic id beside the user's original event — the
    // duplicate again, arriving months later and unexplainably.
    if (!activityIds.has(l.activityId)) unlinks.push(l);
    continue;
  }
  deletes.push(l);
}
```

The engine handles `unlinks` with `removeCalendarEventLinkById` and no client call at all. The
`beaniesMayDelete` guard here is what stops a suppressed invited activity's link from looking
abandoned; it is the most dangerous line in the feature and gets its own named test.

**3c. The exception discovery path.** `calendarSyncStore.ts:388` derives the master id the same way
(`deterministicEventId(e.master.id)`) for `listInstances`, and would go on targeting a stale id for
an adopted series. Rather than repeat the fallback there, `planReconcile` (which is the only place
holding `linkByActivity`) carries the resolved value on the task it already builds:
`ReconcileExceptionUpsert` gains `masterEventId: string`, set from
`masterEventId(linkByActivity.get(master.id), master.id)`. `applyExceptionUpsert` then reads
`e.masterEventId` and the store drops its `deterministicEventId` import entirely
(`calendarSyncStore.ts:82` becomes unused). One derivation site, no second copy of the rule, and the
store loses a direct dependency on the id scheme.

**3d. The model: one field named `origin`, read only through two named predicates.**

`CalendarEventLink` gains exactly one optional field. It is an enum, not a boolean, because the two
things the engine needs to know ("may beanies write to this event?" and "may beanies delete this
event?") have three valid combinations, not two, and a second boolean would let an impossible fourth
be represented.

The field is `origin`, not `externalOrigin`. The field name states the axis and the values state the
position on it; `externalOrigin: 'adopted'` reads as a contradiction and is the single most likely
thing for a future maintainer to misread. `link.origin === undefined` reads, correctly and at a
glance, as "beanies made this event".

```ts
/**
 * WHO CREATED this Google event. Set only by the one-time import; absent (the
 * only value before that feature) means beanies created the event and owns its
 * whole lifecycle, exactly as today.
 *  - 'adopted'  the user is the organizer and the event is on this connection's
 *               destination calendar, so pushes PATCH the original in place.
 *  - 'external' the user is an invitee (or the event lives on another calendar),
 *               so beanies never writes: no upsert, no instance exception.
 * INVARIANT: a link with any `origin` value NEVER produces a `deleteEvent` call.
 * Do not branch on this field directly. Use `beaniesMayPush` / `beaniesMayDelete`.
 */
origin?: 'adopted' | 'external';
```

**Nothing branches on the raw value.** Two predicates live in
`src/utils/calendar/linkOwnership.ts`, and every site in the subsystem calls them:

```ts
/** May beanies DELETE this event from Google? Only events beanies created. */
export function beaniesMayDelete(link: CalendarEventLink): boolean {
  return link.origin === undefined;
}
/** May beanies WRITE (insert/patch/except) this event? Everything but an invitee's. */
export function beaniesMayPush(link: CalendarEventLink): boolean {
  return link.origin !== 'external';
}
```

Four sites each testing an optional string literal is a rule that decays the first time a fifth site
is added; two named predicates give a grep target, one place to change the rule, and a
self-documenting reason at each call site.

**Why not derive ownership instead of storing it.** The obvious simpler invariant is
`link.googleEventId === deterministicEventId(link.activityId)`: no new field, no migration, cannot go
stale. It is rejected deliberately, and the reason is recorded here because a future maintainer will
propose it. It makes `deterministicEventId` load-bearing on the DELETE path, so any future change to
the id scheme, or an exotic activity id that pads differently, would silently reclassify every
existing link as foreign and beanies would stop cleaning up its own events on disconnect. A
leaked-events failure nobody can see is worse than a stale flag. It also cannot separate `'adopted'`
from `'external'`, so a second field would be needed anyway.

No new meaning is added to `googleEventId`: for an adopted link it holds the real Google master id,
which is exactly what the field already claims to be, and `reconcilePlan.ts:165` already relies on
that reading for exception links.

**3e. The other three delete sites.** All three take the same one-line rule, and all three are
reachable by a user who has imported.

- `finishDisconnect` (`calendarSyncStore.ts:1072-1079`): disconnecting must clean up what beanies
  made, never what the family already had.
- `setDestinationCalendar` (`calendarSyncStore.ts:1113-1120`): additionally KEEP `origin`-bearing
  links through the switch rather than dropping them with the rest at `:1134`. Keeping them is what
  preserves suppression for `'external'` and stops the switch from re-creating the school's event on
  the new calendar. An `'adopted'` event cannot follow the move (it lives where its organizer put
  it), so its link stays pointing at the original and the outcome is stated in the Help Center
  article rather than silently discovered.
- The `deletes` task in `reconcileConnection` (`:625-633`); the new `unlinks` list gets its own small
  task that only removes the link.

**Do not leave three sites each remembering to branch.** There are exactly three `client.deleteEvent`
calls outside the client (`:627`, `:1074`, `:1115`), and all three pass `link.googleEventId`. They
collapse into one private store helper, which is then the only place the rule exists:

```ts
/** The ONLY place beanies deletes a Google event. Refuses for a link beanies did
 *  not create, so the guard cannot be forgotten at a future fourth call site.
 *  Returns whether the remote delete happened. The caller decides what to do with the link:
 *  `reconcileConnection` and `finishDisconnect` drop it either way, but `setDestinationCalendar`
 *  KEEPS an `origin`-bearing link (§ 3e). Do not "simplify" this helper by having it remove the
 *  link itself: that would silently re-enable the destination switch to recreate an invited
 *  event on the new calendar. */
async function deleteRemoteEventForLink(
  client: CalendarClient,
  connectionId: string,
  calendarId: string,
  link: CalendarEventLink
): Promise<boolean> {
  if (!beaniesMayDelete(link)) return false;
  await client.deleteEvent(connectionId, calendarId, link.googleEventId);
  return true;
}
```

The invariant is then enforced rather than documented, using the source-scanning test pattern the
repo already uses for module-graph invariants (`memberColorsImportGraph.test.ts`):

```ts
// A new remote-delete call site that skips `deleteRemoteEventForLink` would delete
// a family's real Google events. This test is why that cannot happen quietly.
it('deletes Google events from exactly one place', () => {
  const src = readFileSync(resolve(__dirname, '../calendarSyncStore.ts'), 'utf8');
  expect(src.match(/client\.deleteEvent\(/g) ?? []).toHaveLength(1);
});
```

The invariant worth writing in the type doc is then: **a link with an `origin` never produces a
`deleteEvent` call**, and the test is what keeps that true.

**3f. An adopted event must never be re-inserted, and this is not optional.**

`applyUpsert` reaches `createOrResurrect` on two paths: a `not_found` from `patchEvent`
(`calendarSyncStore.ts:320-326`) and a failed `eventExists` probe on a verify pass (`:335-341`).
Both then call `client.insertEvent` with the SUPPLIED event id (`:209-225`).

`deterministicEventId` output is base32hex by construction, which is why that has always been safe.
A foreign Google id is **not** constrained to base32hex: events that arrived by `.ics` import or by
migration routinely carry ids with underscores or uppercase. Inserting one returns HTTP 400,
`record(e, 'upsert')` files it, and the row fails identically on **every** subsequent reconcile,
forever, with no self-heal and nothing the user can do.

`applyUpsert` cannot see the link today: it is handed a `ReconcileUpsert`, whose only link-derived
field is `existingHash`. So `ReconcileUpsert` gains `origin?: CalendarEventLink['origin']`, set from
the same `link` § 3a already resolves: no second lookup, no new store read, and the plan stays the
single place link facts enter the engine.

So `applyUpsert` gains one branch, and it is a convergence rather than an error: for an upsert where
`u.origin === 'adopted'`, a missing remote event means the organizer deleted it in Google. Drop
the link and return. The next reconcile sees an unlinked activity and creates a normal beanies-owned
event under the deterministic id, which is correct, legal, and what the user would expect. A
permanent unfixable error becomes a one-cycle self-heal. Tested directly: an adopted link whose
remote event is gone produces a link removal and zero `insertEvent` calls.

### 4. The import planner: pure, testable, no I/O

New `src/utils/calendar/planImport.ts`:

```ts
export type ImportOutcome = 'adopt' | 'copy' | 'unsupported-recurrence';

export interface ImportCandidate {
  googleEventId: string;
  connectionId: string;
  calendarId: string;
  calendarLabel: string;
  outcome: ImportOutcome;
  /** Human-readable repeat pattern for the chip; absent for a one-off. */
  recurrenceSummary?: string;
  /** The ONLY copy of the activity fields. The row renders from this. */
  draft: CreateFamilyActivityInput;
  /** Already imported on a previous run — shown, disabled, never re-created. */
  alreadyImported: boolean;
}

export function planImport(input: {
  events: Array<
    CalendarEventFull & { connectionId: string; calendarId: string; calendarLabel: string }
  >;
  existingLinks: CalendarEventLink[];
  defaults: ImportDefaults; // createdBy, assigneeIds, todayYmd, deviceTimeZone
}): { candidates: ImportCandidate[]; skipped: Array<{ id: string; reason: string }> };
```

Rules:

- `status === 'cancelled'` → skipped with a reason.
- `recurringEventId` present (an instance, not a master) → skipped; masters carry the series.
- Recurrence: `parseRecurrence` → `ok` gives `draft.rule` + `activityShadowFromRule(rule)`; a refusal
  gives `outcome: 'unsupported-recurrence'`.
- **🔴 A refused series is NEVER adopted, whoever organizes it.** Its link records the Google MASTER
  id (so a re-run recognises it) but with `origin: 'external'`, and its outcome chip reads as a copy,
  never "takes it over". The reason is concrete and verified: `GoogleEventResource.recurrence` is a
  REQUIRED `string[]` (`activityToGoogleEvent.ts:23`) and a `recurrence: 'none'` activity yields
  `recurrence: []` (`:122`). A refused series imports as a ONE-OFF activity, so the first ordinary
  edit the user makes to it in beanies would PATCH the master with `recurrence: []` and collapse
  their entire Google series into a single event: every future occurrence destroyed, silently, by an
  edit that looks harmless. `origin: 'external'` makes that push impossible. This is the one place
  `outcome` and `origin` must not be read as the same axis: `outcome` is what the ROW SAYS, `origin`
  is what the ENGINE MAY DO, and `'unsupported-recurrence'` forces `origin: 'external'` regardless of
  `isOrganizer`.
- **`title`, `startYmd` and `rule` are deliberately NOT duplicated onto the candidate.** They live in
  `draft`, and the review row reads `candidate.draft.title` / `.date` / `.rule`. A struct holding two
  copies of the same fact is a struct where the review list can silently disagree with what actually
  gets written, and the first person to adjust the draft without adjusting the mirror creates a UI
  that lies about what it is importing. Only `recurrenceSummary` is stored, because it is
  presentation and has no source in `draft`.
- `isOrganizer === true` → `'adopt'`; otherwise `'copy'`.
- `alreadyImported` = a link already exists with this `googleEventId` for this connection. This is
  how "re-running the import re-creates nothing already imported" is satisfied, and it is a property
  of the data rather than of a stored cursor.
- **An event beanies itself pushed is skipped outright**, not merely marked already-imported. The
  destination calendar is full of them and they all pass `isOrganizer`. The link check above catches
  the normal case, but a beanies event whose link was lost (a partial teardown, an activity deleted
  while a delete failed) would otherwise be offered for adoption and would import a second activity
  for something beanies created. One extra rule closes it: skip any id matching
  `/^b[0-9a-v]{32}$/`, the exact shape `deterministicEventId` emits. Cheap, and it fails in the safe
  direction (the worst case is declining to import a user event that happens to match a
  33-character beanies-shaped id, which the review list states).

**Date/time conversion is NOT written here.** `activityToGoogleEvent.startEndForDate` is the
outbound direction (beanies days/times to Google `date`/`dateTime`), so the inbound direction is its
inverse and belongs in the same module, next to it, as
`googleTimesToActivityFields(start, end)`. It reuses `toDateInputValue` and `toTimeInputValue`
(`utils/date.ts:578,628`) for the local wall-clock conversion and `addDaysYmd` for Google's exclusive
all-day end; it hand-rolls no parsing. It returns
`Pick<FamilyActivity, 'date' | 'endDate' | 'isAllDay' | 'startTime' | 'endTime'>`, **NOT**
`ActivityDays`: that is the internal day-math shape (`startYmd`/`endYmd`/`endDayOffset`/`allDay`,
`activityDays.ts:14`), and spreading it into a `CreateFamilyActivityInput` would produce a draft with
none of the right field names and no type error at the call site if the input is ever widened.
Returning the activity-shaped subset lets `planImport` spread it directly and keeps the round-trip
oracle honest: `resolveActivityDays({ ...fields })` must reproduce the `ActivityDays` that
`startEndForDate` consumed. `activityToGoogleEvent.ts`'s header comment is updated in the same
commit, because it currently states the module is one-directional. `eventItemToMs`
(`googleCalendarClient.ts:70`) already covers the Google-to-absolute-ms direction for clash detection
and must not be duplicated or widened.

**Recurring masters anchored in the past are IN scope.** The 12-months-forward window is a window on
the read, not a filter on the anchor: with `singleEvents:false` Google returns a master whose SERIES
overlaps the window, and a weekly swim lesson that started two years ago is exactly requirement 4's
example. Its `date` is its real DTSTART, in the past, which is correct and which `activityInWindow`
already handles through its ongoing-recurring branch (`reconcilePlan.ts:88`). Filtering candidates
on `startYmd >= today` would drop every long-running series, which is the most valuable thing this
feature imports. "No past events" governs one-off events only.

**Field mapping**, with the defaults that have no Google source stated once, here:

| FamilyActivity                                         | from                                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                                                | `summary`, or a translated "(no title)" fallback                                                                                                |
| `outcome`                                              | `'adopt'` only when `isOrganizer` AND the event's calendar is this connection's (normalized) destination calendar; otherwise `'copy'`           |
| `notes`                                                | `description` — **not** `description`; see caveats                                                                                              |
| `location`                                             | `location`                                                                                                                                      |
| `date` / `endDate`                                     | `start.date`/`end.date` (Google's exclusive end converted to beanies' inclusive), or the local date of `start.dateTime`                         |
| `isAllDay`                                             | `start.date` present                                                                                                                            |
| `startTime` / `endTime`                                | local `HH:mm` of `start.dateTime` / `end.dateTime`                                                                                              |
| `rule` + `recurrence`/`daysOfWeek`/`recurrenceEndDate` | `parseRecurrence` + `activityShadowFromRule`                                                                                                    |
| `category`                                             | `'other_activity'` (the union's neutral catch-all)                                                                                              |
| `feeSchedule`                                          | `'none'`                                                                                                                                        |
| `reminderMinutes`                                      | the app's existing default                                                                                                                      |
| `isActive`                                             | `true`                                                                                                                                          |
| `createdBy`                                            | current member, falling back to owner, as `ActivityModal` does                                                                                  |
| `assigneeIds`                                          | `[importing member]` — the form requires non-empty, and an import that wrote zero assignees would produce activities the UI treats as malformed |

`activityShadowFromRule` (`src/services/recurrence/adapters.ts`) is the ONLY sanctioned way to derive
the legacy `recurrence`/`daysOfWeek`/`recurrenceEndDate` trio. The importer calls it rather than
setting those fields by hand, or the shadow-fidelity contract `activityInWindow` and
`computePushHash` depend on is broken.

### 5. The review UI

Follows the mockup (`docs/mockups/google-calendar-import-2026-09-11.html`) and the CIG.

**Built for 200 rows, because that is the cap.** greg reviewed the first mockup and called the row
too tall for a list that could run to hundreds. The cause was not layout, it was repetition: the
per-row outcome explanation ("Your edits here will update this event in Google. No second copy.")
was identical on every adopted row, so 200 rows meant 200 copies of one sentence. Measured 130px per
row. The fix is a writing fix that pays out as a layout fix:

- **The explanation moves into a legend above the list, stated once**, as two labelled lines pairing
  each chip with its meaning. Requirements 7 and 8 are still met per event, because the CHIP is per
  event; only the prose is shared.
- **The row is one line**: tick, title (truncating), repeat chip, location, time (tabular-nums,
  right-aligned), outcome chip. Measured **42px**. At phone width it stacks to title over a meta
  line and stays one row, never a card.
- **Day headers are sticky** inside the scroll container, and the action bar is sticky at the
  bottom, so a user 150 rows deep can still see which day they are in and can commit without
  scrolling back.
- **Everything actionable is ticked by default** (greg's call). Already-imported rows render
  disabled, unticked, and are excluded from the count, shown only so the absence is explained
  rather than mysterious.
- **One select-all control** at the head of the list, reading "Deselect all" while everything is
  ticked, plus a live "31 of 34 ticked" count in the action bar.

**Deliberately NOT built, and worth stating so nobody adds them unasked:** filtering by outcome, and
list virtualisation. Both are defensible at 200 rows, but neither pattern exists anywhere in beanies
today, and greg's brief for the design review was to invent nothing new. The 200 cap plus 42px rows
keeps the list tractable without either.

- **`CalendarImportModal.vue`** — `BeanieFormModal variant="drawer"`, matching `CalendarSyncSettings`
  and `TravelExtractReviewModal`. Three states in one component: choose calendars, scanning, review.
  There is no result state and no confirm state:
  - the confirm summary uses the existing global `confirm()` (`@/composables/useConfirm`, rendered
    once in `App.vue:1951`), whose `detail` field takes a plain interpolated string, so the count
    ("12 events, 3 of them copies") needs no new component and no new modal instance;
  - the outcome is a `showToast('success', ...)` with the count, exactly as `ListCopyModal` does
    after `copyListForMembers`. A whole result screen for a one-line fact is bloat;
  - selection state, reset-on-open and double-submit protection come from `useFormModal` +
    `isSubmitting`, the same pair `ListCopyModal.vue:45-66` uses. Do not hand-roll a `submitting`
    ref or a guard.
- **A focused `CalendarImportRow.vue`, and `ExtractedSegmentRow` is left alone.** Pass 3 reconsidered
  Pass 2's "promote the travel row to `ui/ReviewRow.vue`" and rejects it. The import row is not the
  travel row plus selection: the travel row is a two-line, 30-line display card (emoji, title,
  detail, one chip, `py-2.5`); the import row is a one-line 42px row with a checkbox, two chips, a
  right-aligned tabular-nums time, a disabled state and a sticky-header context. Forcing both through
  one component means six new optional props and a body of conditionals serving two surfaces with no
  shared future, at exactly two call sites. That is the abstraction that looks like DRY on the day it
  lands and is the thing nobody dares touch a year later, because every import tweak risks the travel
  modal. Pass 2's own justification was also not true: the AA fix changes the travel chip, so "the
  travel surface renders identically" was wrong.
- **The chip tone map stays inside the import, and `ExtractedSegmentRow` is not touched at all.**
  Pass 3 proposed a shared `src/components/ui/reviewChipTone.ts` consumed by both rows, on the
  premise that the travel chip is the same silk pair the mockup's AA note fixes. It is not: that chip
  is `text-[#0077B6]` on `bg-[rgba(0,180,216,0.1)]` (`ExtractedSegmentRow.vue:29`), a different hue on
  a different ground from the mockup's `#2d7ca8` on `#f0f7fd`. Routing it through the import's map
  would RESTYLE the travel review modal: an unrequested visual change to an unrelated surface,
  shipped inside a calendar feature, which is the same defect Pass 3 correctly rejected in Pass 2's
  shared-row proposal. With one real consumer, a shared `ui/` module is an abstraction with no second
  caller. The three tones live as a `Record<'accent' | 'silk' | 'muted', string>` constant inside
  `CalendarImportRow.vue`, which is where the only AA fix this plan actually owes lands. (For the
  record: the travel chip measures 4.29:1 on its own ground, a genuine pre-existing AA miss at 10px.
  Noted, deliberately NOT fixed here; it is unrelated to this feature and belongs in its own change.)
- **Tokens.** The mockup carries a measured contrast note that must survive into the implementation:
  Heritage Orange on `primary-50` is **3.06:1** and fails AA for the 12px semibold chips; use
  `primary-700` (5.14:1). The silk chip needs `#1f5f80` (6.46:1), not `#2d7ca8` (3.98:1). Dark mode
  uses `accent-lift` / `silk-lift`, which are already built for that ladder.
- **Entry points.** A fourth button in the `CalendarSyncSettings` per-connection row, and a
  next-step offer after a successful connect. Do NOT add a parallel `importingId` ref beside
  `busyId` (`CalendarSyncSettings.vue:41`): that leaves the pre-existing bug live for the other
  three buttons and adds a second thing to keep in sync. Change `busyId` to hold
  `${connection.id}:${action}` with a one-line `isBusy(connection, action)` helper, so every button
  spins only for its own action. One small fix, four buttons correct, no new state.
- **All copy via `t()`**, `en` + `beanie` pairs. The invited-event explainer is an important surface
  under the beanie floor: it must keep the real nouns ("calendar", "changes", "Google"), so add its
  key prefix to `IMPORTANT_PREFIXES` in `uiStrings.test.ts`.

### 6. The orchestrator

A new `calendarImportStore` rather than more surface on the 1245-line `calendarSyncStore`. It owns
run state (`idle | scanning | reviewing | importing | done`), the candidate list, counts, and errors,
and it is the only place that sequences scan → plan → write.

**The commit writes NOTHING to Google.** Worth stating loudly, because it removes a whole class of
failure. Adoption is achieved purely by recording a link whose `googleEventId` is the real Google id
and whose `lastPushedHash` is the activity's _correct current hash_, so the very next reconcile finds
the hashes equal and no-ops. No insert, no patch, no network call, nothing to half-succeed.

**⚠️ `computePushHash` MUST be called with the member-name resolver.** It folds resolved member names
into the payload when, and only when, the resolver is passed
(`activityToGoogleEvent.ts:218-227`), and `reconcileConnection` always passes one
(`calendarSyncStore.ts:591`). Every imported activity has a non-empty `assigneeIds`, so
`computePushHash(activity)` with no resolver produces a **different** hash from the one the next
reconcile computes. The result is precisely the failure this step exists to prevent: N events patched
back to Google immediately after import for no reason, and for an adopted event that patch rewrites
the user's real event body. The import store builds the same resolver the sync store builds and
passes it.

**The commit is ONE atomic local write, not a per-row loop.** The precedent exists:
`listRepository.createLists` writes N entities as a single `mutate({ op: 'batch' })`, and
`listStore.copyListForMembers` mirrors the store array once afterwards, with the comment "ONE array
write, not one per copy" and "there is no partial-success state to design for". The import does the
same, in one batch containing both the activities and the links:

1. **ONE repository function, not two.** Two repository calls are two `mutate` calls and therefore
   two `Automerge.change`s: exactly the non-atomic state this section exists to rule out.
   (`applyMutation` in `worker/docOps.ts` wraps the whole op in a single change, and `MutationOp.batch`
   carries a per-op `collection`, so a batch is explicitly multi-collection.) So the write is one new
   `calendarRepository.createImportedActivities(entries)` taking
   `Array<{ activity: CreateFamilyActivityInput; link: CreateCalendarEventLinkInput }>`. It
   pre-generates each activity id with `generateUUID()` so the link can carry `activityId` inside the
   SAME batch (`createLists` cannot simply be reused, because it mints its ids internally and returns
   them only after the batch has already committed), builds `set` ops across BOTH the `activities`
   and `calendarEventLinks` collections, and issues one `mutate({ op: 'batch', ops })`. Link ids use
   the existing composite `calendarEventLinkId(connectionId, activityId)` (`calendarRepository.ts:46`),
   so a re-run is idempotent at the key. It carries the same post-batch projection verify
   `createLists` uses, for the same reason.
2. **No new `activityStore` action and no `activityRepository.createActivities`.** Both would be new
   public surface with exactly one caller that could not be atomic anyway. The store array is
   re-mirrored by calling the existing `activityStore.loadActivities()` once after the batch: the
   same "ONE array write, not one per copy" outcome as `copyListForMembers`, with nothing new to
   maintain. Bypassing `activityStore.createActivity` is deliberate and safe: its only extra work is
   `syncLinkedRecurringPayment`, and every imported draft has `feeSchedule: 'none'`, so there is no
   linked payment to sync.
3. `calendarSyncStore.recordLink` (`:272-298`) is currently a private closure implementing
   get-then-update-or-create; it moves to `calendarRepository.upsertCalendarEventLink` so the sync
   store keeps one implementation and the import shares its input shape. The import does NOT call it
   per row: it emits `set` ops inside the single batch above.

**Atomicity is not a nicety here, it closes a duplicate-creating hole.** If the activities were
created and the link write then failed, the next reconcile would see pushable activities with NO
links, take the `hasLink === false` branch in `applyUpsert` (`calendarSyncStore.ts:312-317`), and
INSERT fresh `b<uuid>` events beside the user's originals. That is the duplicate again, arriving from
a partial write rather than a design flaw. An activity with no link is the dangerous state; a link
with no activity is the benign one (`unlinks` collects it). One batch makes the dangerous state
unrepresentable, so no compensating-delete logic is needed.

The single failure path is therefore one
`showToast('error', …, { surface: 'calendar-import', error, context })`, which already reports to
CloudWatch through the existing toast plumbing (`useToast.ts:121-137`). No per-row error accounting,
no partial-result screen.

**Cap.** `IMPORT_MAX_CANDIDATES = 200`, applied AFTER a client-side sort by start date. Google cannot
order this read for us: `orderBy=startTime` requires `singleEvents=true`, and this read deliberately
uses `singleEvents=false`. The network read stays bounded by the inherited `MAX_EVENT_PAGES`; the cap
bounds the review list and the batch. If the window yields more, list the first 200 by date and say
so plainly.

### 7. Copy: privacy, connect, help, blog

- `web/src/pages/privacy.astro` gains a **google calendar integration** section (it has none today;
  the only calendar mentions are at `:100` and `:163`). It states what the connection reads, that
  the import reads event content on calendars you own, and that guest lists are never requested.
- In-app connect copy in `CalendarSyncSettings` updated to match.
- Help Center article (below).
- A NEW blog post announcing it, carrying the "what I said before, and what changed" correction.
- `web/src/pages/index.astro:299` ("It doesn't pull in stuff from google calendar") must be revisited.

## Files Affected

**Created**

- `src/utils/calendar/linkOwnership.ts` + `__tests__/linkOwnership.test.ts` (§ 3d predicates)
- `src/utils/calendar/parseRrule.ts` + `__tests__/parseRrule.test.ts`
- `src/utils/calendar/planImport.ts` + `__tests__/planImport.test.ts`
- `src/stores/calendarImportStore.ts` + `__tests__/calendarImportStore.test.ts`
- `src/components/settings/CalendarImportModal.vue` + `__tests__/CalendarImportModal.test.ts`
- `src/components/settings/CalendarImportRow.vue` (focused; the travel row is NOT promoted)
- `src/stores/__tests__/calendarSyncStore.deleteSites.test.ts` — the single-delete-site source assert
- A new blog post under `content/blog/`

**Modified**

- `src/services/calendar/CalendarClient.ts` — `CalendarEventFull` + `listEventsForImport`, and
  `CalendarSummary.accessRole?: string` for the read-only chooser state
- `src/services/calendar/googleCalendarClient.ts` — the impl
- `src/services/calendar/__tests__/fakeCalendarClient.ts` — stub default
- `src/utils/calendar/deterministicEventId.ts` — `masterEventId(link, activityId)` (§ 3a)
- `src/utils/calendar/reconcilePlan.ts` — link-authoritative event id, push suppression, `unlinks`
- `src/utils/calendar/__tests__/reconcilePlan.test.ts` — migration-safety + named regression tests
- `src/utils/calendar/activityToGoogleEvent.ts` — `googleTimesToActivityFields` + header comment
- `src/stores/calendarSyncStore.ts` — `deleteRemoteEventForLink` funnel (3 sites), exception path
  master id, adopted-event no-reinsert branch, `unlinks` task, keep `origin` links across a
  destination switch, `recordLink` moves to the repository
- `src/services/automerge/repositories/calendarRepository.ts` — `upsertCalendarEventLink` +
  `createImportedActivities` (the ONE cross-collection batch: activities and links in one change)
- `src/types/models.ts` — `CalendarEventLink.origin`
- `src/components/settings/CalendarSyncSettings.vue` — entry point, `busyId` becomes `${id}:${action}`
- `src/services/translation/uiStrings.ts` + `uiStrings.test.ts`
- `src/content/help/features.ts` — the new article
- `web/src/pages/privacy.astro`, `web/src/pages/index.astro`
- `content/blog/2026-07-03-google-calendar-integration.md` — correct the `:47` paragraph per greg's
  2026-09-11 call. Both halves: the busy-only claim AND the false attribution to Google's scopes.
  Nothing else in that post is touched.
- `.claude/skills/beanies-help-docs/SKILL.md` — inventory
- `CHANGELOG.md`, `docs/STATUS.md`

**Explicitly NOT modified**

- `src/components/travel/TravelExtractReviewModal.vue` — no prop changes, no behaviour change
- `src/components/travel/ExtractedSegmentRow.vue` — no visual change; the travel review surface is
  not in this feature's blast radius
- `googleCalendarClient.listEventTimes` and its pinned test — the clash nudge keeps its narrow mask

## Help Center Coverage

- **Action**: `new article`
- **Category**: `features`
- **Article type**: `how-to`
- **Slug**: `bring-your-google-calendar-across`
- **Title**: Bring your Google Calendar across
- **Scope**: How to bring events you already have in Google into beanies, once, choosing what comes;
  what happens to each event afterwards; and why some come across as copies you cannot push back.
- **Notes**: must call out that this happens once and is not an ongoing sync; that events you created
  become beanies-managed and your edits update the original in Google; that events someone else
  created are copied and your edits stay in beanies; that the guest list is never read; that
  recurring events come across as one series; that some repeat patterns cannot be copied and why;
  that the window is the next 12 months; that beanies can only take over events on the calendar it
  syncs to, so events on your other calendars come across as copies; **that deleting an imported
  activity in beanies removes it from beanies only and leaves the Google event where it was**
  (beanies never deletes an event it did not create, the same rule that protects invited events);
  and that disconnecting the calendar, or changing the synced calendar, likewise leaves imported
  events untouched in Google.

Also update `family-planner-and-activities` if it states the connection is push-only.

## Observability Coverage

Surface: **`calendar-import`** — one CloudWatch filter isolates the whole feature.

**Context keys: `action`, `kind`, `count`, `error_code` only.** All four are already allowlisted
(`src/utils/diagnosticContext.ts:68,75`). **No new context key ships**, so `ALLOWED_CONTEXT_KEYS`,
the Lambda mirror, `PrivacyInfo.xcprivacy`, the store Data-Safety answers and `privacy.astro`'s
diagnostics table need no change. `connectionId` is deliberately not passed: it is not allowlisted
and is already being silently dropped elsewhere in this subsystem.

**Per RUN, never per row** — `logEvent` is rate-limited to 50 per (surface, message) per 60s, so a
per-event log would be throttled into uselessness and would also leak shape about the user's calendar.

| event                            | level | action                          | context                                        |
| -------------------------------- | ----- | ------------------------------- | ---------------------------------------------- |
| scan started                     | info  | `import_scan`                   | `count` = calendars chosen                     |
| scan finished                    | info  | `import_scan_ok`                | `count` = candidates found                     |
| scan truncated at the cap        | warn  | `import_capped`                 | `count` = cap                                  |
| a calendar was skipped           | warn  | `import_calendar_skipped`       | `kind` = `forbidden`/`not_found`, `error_code` |
| recurrence refused               | info  | `import_recurrence_unsupported` | `count` per run                                |
| adoption refused, wrong calendar | info  | `import_not_destination`        | `count` per run                                |
| import committed                 | info  | `import_commit`                 | `count` = activities created                   |
| commit outcome mix               | info  | `import_commit_mix`             | `kind` = `adopt`/`copy`, `count`               |
| the commit batch failed          | error | `import_commit_failed`          | `error_code`                                   |

**Failure modes and how each is triaged blind:**

- Scope does not actually return content → every candidate has an empty title; `import_scan_ok` with
  a non-zero `count` alongside a `import_recurrence_unsupported` count of zero and user reports of
  blank rows. The first live call in implementation is what really settles this.
- A calendar is refused by the scope → `import_calendar_skipped` with `kind: 'forbidden'`, surfaced
  to the user as a skip with a reason, never as an error (per the tracker).
- Recurrence coverage is worse than expected in the wild → `import_recurrence_unsupported` counts
  tell us the rate without logging any pattern.
- The commit fails → `import_commit_failed` and an error toast. The write is ONE atomic Automerge
  change (§ 6), so there is no partial state to report and nothing to reconcile by hand: the user
  re-runs and nothing was half-created.
- Adoption silently degraded to a copy → `import_not_destination`. Without this event, "why did my
  own event come across as a copy" is unanswerable from logs, and the destination-calendar rule is
  the likeliest thing a user will notice and not understand.

**Success-path signal is emitted** (`import_scan_ok`, `import_commit`, `import_commit_mix`) so rates
are measurable: "how many families tried the import" over "how many completed it" is the question
this feature will actually be judged on, and it cannot be answered by failure events alone.

**Severity.** `import_commit_failed` is `error`, not `critical`: the user is told, the write was
atomic so nothing is half-done, and they can re-run. Nothing here pages Slack. **The one thing worth
`critical`** is a reconcile, disconnect or destination switch that deletes an `origin`-bearing event,
which is data loss on the family's real calendar. It cannot be detected after the fact and cannot be
monitored, so it is prevented by the tests in Testing 4 rather than instrumented.

**Line references.** `action`, `kind` and `error_code` are at `src/utils/diagnosticContext.ts:68,75`;
`count` is at `:321`, added for bean identity and documented there as the shared generic counter. An
earlier draft cited `:68,75` for all four, which is wrong for `count`; a reviewer following that
citation would conclude it was missing and widen the allowlist needlessly.

**No bare `catch {}`.** Every scan and write path either surfaces to the user, reports, or both.

## Acceptance Criteria

- [ ] Connecting a calendar that has existing events offers the import; the same import is reachable
      from Settings.
- [ ] Nothing is written to beanies without being ticked.
- [ ] An adopted single event leaves exactly ONE event in Google afterwards: the original, updated in
      place.
- [ ] An imported weekly series becomes ONE beanies recurring activity with the right pattern, and
      exactly one series remains in Google.
- [ ] An imported invited event creates a beanies activity and ZERO new Google events, and is
      visibly labelled as not pushing changes back.
- [ ] **A reconcile run after importing an invited event does not delete that event from Google.**
- [ ] **Disconnecting the calendar after an import does not delete any imported event from Google**
      (adopted or invited); the links are simply dropped.
- [ ] **Changing the destination calendar after an import does not delete any imported event**, and
      does not create a second copy of an invited event on the new calendar.
- [ ] An override on an imported invited recurring series writes nothing to Google.
- [ ] An event on a non-destination calendar imports as a copy, and the row says why.
- [ ] Read-only calendars (holidays, birthdays, subscribed feeds) appear in the chooser greyed,
      labelled and unticked, and are never scanned; every readable calendar is ticked by default.
- [ ] A long-running weekly series whose first occurrence is two years ago still imports.
- [ ] An RRULE whose `BYDAY`/`BYMONTHDAY` disagrees with the event's start date is refused, not
      coerced into a different series.
- [ ] An adopted link whose remote event has been deleted in Google drops the link and does NOT
      attempt an insert under the foreign id.
- [ ] A failed commit leaves ZERO activities and ZERO links behind (the write is one batch).
- [ ] `client.deleteEvent` appears exactly once in `calendarSyncStore.ts`.
- [ ] Editing an imported invited activity changes nothing in Google, and the user was told first.
- [ ] Re-running the import re-creates nothing already imported.
- [ ] An event whose RRULE beanies cannot express is shown ticked, labelled "comes across once", and
      imports as a single event dated its NEXT occurrence in the window, never as a mangled series
      and never on a stale past DTSTART.
- [ ] **An unsupported-recurrence import is never adopted.** Editing it in beanies afterwards writes
      NOTHING to Google, and the original recurring series is still intact with all future
      occurrences (the `recurrence: []` collapse is impossible).
- [ ] Every actionable row is ticked when the review opens; already-imported rows are disabled,
      unticked, and excluded from the count.
- [ ] One control selects and deselects everything, and the ticked count is visible without
      scrolling back.
- [ ] A row is one line at desktop and does not exceed roughly 44px; the outcome explanation appears
      once in the legend, not per row.
- [ ] Day headers and the action bar stay visible while scrolling a long list.
- [ ] No attendee email address is written into the pod, and `attendees` is absent from the field mask.
- [ ] The importing device's timezone is applied correctly to timed events, including all-day and
      multi-day spans.
- [ ] The privacy page describes the calendar integration and what the import reads.
- [ ] Chips and labels meet AA in BOTH themes; no raw `primary-500` on `primary-50`.
- [ ] `listEventTimes` and its pinned test are unchanged.
- [ ] Help Center article added; skill inventory updated.
- [ ] Observability events fire with surface `calendar-import` and only allowlisted keys.
- [ ] `npm run lint`, `type-check`, and the full unit suite pass.

## Testing Plan

1. **`parseRrule`** — round-trip against every shape `buildRecurrenceRule` emits; explicit refusal
   assertions for `BYSETPOS`, multi-`BYMONTHDAY`, `EXDATE`, multi-`RRULE`, multi-weekday at
   `INTERVAL > 1`, and every ANCHOR-DISAGREEMENT case (`BYDAY=2WE` on a 3rd-Wednesday start,
   `BYMONTHDAY=15` on a non-15th start, `BYMONTHDAY=-1` on a non-last-day start, a weekly `BYDAY`
   set excluding the start weekday). Malformed input returns a refusal, never throws.
   1b. **`googleTimesToActivityFields`** — round-trips against `startEndForDate` for timed, all-day,
   overnight and multi-day activities, so the two directions are proved inverse rather than
   separately plausible.
2. **`planImport`** — table-driven: timed, all-day, multi-day, cancelled, instance-not-master,
   organizer vs invitee, already-imported, unsupported recurrence. Assert the exact
   `CreateFamilyActivityInput` for a representative case, including that `notes` (not `description`)
   carries Google's body.
3. **Engine, adoption** — a link whose `googleEventId` is a foreign id produces an upsert targeting
   THAT id, not `deterministicEventId(activityId)`.
4. **Engine, safety (the five that matter most)** — each named so nobody deletes it casually:
   (a) a **migration-safety** test that must not be a tautology. Hand-building a link with
   `googleEventId: deterministicEventId(id)` and then asserting the two are equal proves nothing. The
   test DRIVES the real producer: run a reconcile for a pre-`origin` activity against the fake client,
   take the link `recordLink` actually wrote, feed that link back into `planReconcile`, and assert
   `upserts[0].eventId` is byte-identical to `deterministicEventId(activityId)`, i.e. `masterEventId`
   is provably a no-op for every link the store has ever minted. Scoped to master links, because
   exception links legitimately hold a Google instance id (`calendarSyncStore.ts:503`). The static
   half of the argument is a grep and it holds: `createCalendarEventLink` and
   `updateCalendarEventLink` have exactly ONE caller each, both inside `recordLink`
   (`calendarSyncStore.ts:282,289`). That is why Assumptions 3 is true, and it belongs in the test's
   own comment so a future second write site is understood as breaking it;
   (b) an `'external'` link whose activity is suppressed is in NEITHER `plan.deletes` nor
   `plan.unlinks` while the activity still exists, and moves to `unlinks` (never `deletes`) once the
   activity is gone;
   (c) `finishDisconnect` and `setDestinationCalendar` issue ZERO `deleteEvent` calls for
   `origin`-bearing links, asserted against a counting fake client;
   (d) an override child whose master carries an `'external'` link produces no `exceptionUpserts`;
   (e) the source-scanning assert that `client.deleteEvent(` appears exactly once.
5. **`calendarImportStore`** — the commit writes N activities and N links in ONE batch with the right
   `origin` and the correct `lastPushedHash` (built with the member resolver), and issues ZERO
   calendar-client calls; a failing batch leaves zero activities and zero links and emits
   `import_commit_failed`; re-running skips `alreadyImported`; a beanies-shaped event id is skipped
   outright.
6. **No push-back**: after a simulated import, a reconcile produces ZERO inserts (hashes match) and
   ZERO deletes.
7. **`CalendarImportModal`** — rows render, per-row selection works, **every actionable row
   (including `unsupported-recurrence`) is ticked on open** and already-imported rows are disabled,
   unticked and outside the count, select-all toggles both ways, and the confirm summary counts match
   the ticks.
8. **`googleCalendarClient.listEventsForImport`** — pins the new field mask and `singleEvents:false`,
   asserts `attendees` is absent, covers paging and the malformed-item skip.
9. Full unit suite, lint, type-check.
10. **Browser (Playwright, real app)**: open Settings → calendar, run the import against a stubbed
    client, walk choose → review → confirm → result at desktop AND 390px, in light and dark. Verify
    the invited label is present on the imported activity afterwards, not just in the review list.
11. **Live probe, implementation step 1**: one real call with the widened mask against greg's own
    calendar, confirming content and `recurrence[]` come back and that `organizer.self` is populated.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted seven phases from a full subsystem map; identified that the
  tracker's stated adoption mechanism cannot work because `reconcilePlan.ts:138` derives the event id
  from the activity and ignores the link, and made the engine change plus its migration-safety
  argument the spine of the plan; specified an RRULE parser with explicit refusals; caught that
  Google's description must import into `notes` rather than `description` or the first push wipes the
  user's event body; and flagged the no-push/deletes interaction as the feature's data-loss hazard.
- **Pass 2 (DRY + error handling)**: Found that three further remote-delete sites (`finishDisconnect`,
  `setDestinationCalendar`, and the exception path) would have destroyed imported events, and that
  the link carries no `calendarId` so adoption must be destination-bound; replaced the `noPush`
  boolean with a single ownership enum honoured at every one of them, collapsed the event-id
  derivation to one shared `masterEventId`, made the commit ONE atomic local batch on the existing
  `createLists` precedent (removing the per-row failure state machine entirely, since the import
  writes nothing to Google), routed inbound date/time through the inverse of `startEndForDate`, added
  the anchor-agreement refusals that stop a mangled series, and replaced the new confirm/result
  components with the global `confirm()`, `useFormModal` and a toast.
- **Pass 3 (Sustainability)**: Renamed the ownership field to `origin` and routed all reads through
  two named predicates; funnelled the three `client.deleteEvent` sites into one guarded helper backed
  by a source-scanning invariant test; caught that `computePushHash` without the member resolver
  produces a mismatched hash that re-pushes every imported event, rewriting adopted event bodies;
  caught that a foreign Google id is not base32hex so `createOrResurrect` would 400 forever, and
  added the adopted-event no-reinsert self-heal; reversed Pass 2's "promote the travel row" in favour
  of a focused row plus one shared chip-tone map (Pass 2's "renders identically" claim was false);
  de-duplicated `ImportCandidate` against its own draft; corrected the inbound converter's return
  shape; added the skip for beanies' own event ids; and split delivery into three stages seamed at
  the first code able to write an `origin` link.
- **Pass 4 (Fresh-eyes sweep)**: Spot-checked roughly 45 file:line citations (they hold, including
  the `createLists` batch precedent, which `applyMutation` confirms is one multi-collection
  `Automerge.change`, and the `masterEventId` migration-safety argument, which the single-write-site
  grep confirms); caught that a refused-recurrence candidate could still be ADOPTED, so an ordinary
  later edit would PATCH the Google master with the mandatory `recurrence: []` and destroy the user's
  whole series, and pinned it to `origin: 'external'`; caught that the "one atomic batch" was
  specified as two repository calls and therefore two Automerge changes, and collapsed it to one
  `createImportedActivities` with pre-generated ids (dropping the new `activityStore` and
  `activityRepository` surface in favour of the existing `loadActivities()`); caught that
  `applyUpsert` has no access to `link.origin` and threaded it onto `ReconcileUpsert`; fixed the
  `deleteRemoteEventForLink` doc that contradicted § 3e's keep-the-link rule; reversed Pass 3's
  shared `ui/reviewChipTone.ts` because `ExtractedSegmentRow` uses a different hue on a different
  ground, so sharing would have restyled the travel modal for no reason; added the `accessRole`
  read-only calendar state the approved mockup already shows but the plan omitted; and replaced the
  tautological migration-safety test with one that drives the real producer.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-pre-plan, Notion #94)

> let's prepare the pre-plan for issue #94 - which is the feedback from an early adopter asking for a
> one-time google calendar import button. the functionality should allow the user to import their
> activities and events and provide a one-time import viewer to view imported event details, similar
> to what we have to travel plans, to view and accept or remove any event (on an event by event
> basis). as per the details in the tracker, we should preserve all the key info and everything in
> the event in google calendar, including particularly recurrence schedules. once done move onto
> /beanies-plan and once the plan is complete move to implementation. once implementation is done run
> a /code-review max against the implementation to ensure everything is implemented as per the plan
> and does not introduce any bugs, side effects, or security issues. fix all issues found and print a
> browser testing summary once done. for any tests you are able to perform yourself using playwright,
> headless browser, etc please go ahead to perform the browser testing and fix any issues found.
>
> work autonomously and if any questions for me please ask them now

### Intake answers (AskUserQuestion, 2026-09-11)

> Import window: **12 months forward, no past**
> Viewer scope: **Pre-import review only, like travel**
> Attendees: **Skip the guest list, keep organizer status**
> Multi-calendar: **One run, pick calendars up front**

### Follow-up

> go ahead

</details>
