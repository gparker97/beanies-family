# ADR-048: View-only external calendars

- **Status:** Accepted
- **Date:** 2026-11-17
- **Related:** ADR-042 (home-screen widget snapshot), ADR-044 (structural strings as scalars), ADR-047 (load-time writers)
- **Plan:** `~/projects/beanies-ops/docs/plans/2026-11-17-view-only-external-calendars.md`
- **Research:** `~/projects/beanies-ops/docs/research/2026-11-17-view-only-calendar-scope.md`
- **Implementation:** `src/stores/calendarViewStore.ts`, `src/utils/calendar/externalEvents.ts`, `src/services/calendar/calendarAuth.ts` (grant kinds), `src/utils/calendar/grantGuard.ts`, `src/stores/calendarClashStore.ts`
- **Feature flag:** `viewOnlyCalendars` (committed `false` until Google approves the new OAuth scope)

## Context

beanies.family has been push-only toward Google Calendar. It writes family activities to a calendar the family owns, reads only the busy times of that same destination calendar for the clash nudge, and offers a one-time, reviewed import. It cannot show a calendar someone else owns.

Families rely on exactly those calendars to work out who has school pickup: a grandparent's babysitting calendar, a work calendar. Families moving over from Maple expect to see them. A member asked to be able to view such a calendar without changing how its owner works.

Showing external events was deliberately ruled out before. The one-time import plan (`~/projects/beanies-ops/docs/plans/2026-09-11-google-calendar-one-time-import.md`, line 182) recorded a live feed as out of scope, and the Google Calendar integration plan (`~/projects/beanies-ops/docs/plans/2026-06-10-google-calendar-integration.md`, line 149) set aside ICS feeds. This ADR reverses the first of those on purpose and changes what the privacy page and help articles promise, so it is recorded here.

The research spike (2026-11-17) established the Google facts. No scope we hold can read events on a calendar the account does not own. The narrowest scope that can is `calendar.events.readonly`, classified sensitive (not restricted), so it needs ordinary verification with a justification and a demo video, not a security assessment. With it, `events.list` returns titles for calendars shared with full details, and returns time-only events (no title, no location) for calendars shared as busy times only. One scope is enough; no free/busy fallback is needed.

## Decision

1. **One source of truth per event.** Events of a viewed calendar are Google's. beanies.family never edits them, never writes them back, never pushes them to any connected calendar and never stores them in the family file. Events that beanies.family itself pushed, adopted or imported are recognized (by deterministic ids and by `calendarEventLinks`) and dropped from the viewed set, so nothing appears twice.

2. **A separate view grant in its own two collections.** A view-only account is a `CalendarViewAccount` in the doc collection `calendarViewAccounts` (credential only: email, refresh token, granted scopes). A viewed calendar is a `ViewedCalendar` in `viewedCalendars` (which account, which Google calendar, name, access role, detail level, color, and the two switches for the daily briefing and widgets). View data is never put in `calendarConnections`. Older builds treat every record in `calendarConnections` as a push target and would try to write family activities into someone's work account. Two new collections are invisible to them. A sync connection's token and scopes also stay untouched, so push sync has no regression surface. Auth gains a grant kind (`sync` or `view`) with its own scope table; the existing call sites default to `sync`.

3. **Events live in memory, per device.** Events are fetched for the period on screen plus one period either side (and a standing window of yesterday to 35 days ahead for the Nook, search, briefing and widgets), held in an in-memory cache with a five-minute freshness limit, and never written to the family file or any server. Only the viewed-calendar list, its settings and the Google credential sync between devices. There is exactly one exception: turning on "Include in Home-Screen Widgets" for a calendar writes that calendar's rows into the on-device widget snapshot file the native widgets read (ADR-042). That file never leaves the device. Health (lost access, needs sign-in) is also per device and in memory, so the feature makes no unattended document writes.

4. **Detail stripping happens once, at the store boundary.** A calendar set to busy only, a calendar Google shares as busy times only, and any event Google marks private or confidential (except one Google itself created from an email on a calendar you own, that is a calendar the connected Google account owns, where the mark is Google's default and not the owner's choice; decided 2026-11-17 after testing; on a calendar shared with you, even with permission to make changes, such an event stays busy only) lose their title and location before the events enter the reactive cache. No surface, search index, widget snapshot or log can then leak them. Nothing about an external event or its calendar is ever logged.

5. **Whole-family visibility, with a child exception for the digest surfaces.** Viewed events show for everyone in the pod on the planner, Nook, wall and search. The widget and daily briefing rows are built for the family audience only, so a child's session never receives them. Adding a calendar shows a one-sentence reminder that the whole family will see it, so the member can check with the calendar's owner.

6. **The grant is broader than what is fetched.** `calendar.events.readonly` can read every calendar on the signed-in account, and its refresh token syncs to every family device inside the encrypted family file (the wall tablet included), as sync credentials already do. The client therefore refuses any calendar id that is not in `viewedCalendars`. The breadth is disclosed in one sentence in the add step, and in the privacy page and the help article.

7. **The clash nudge reuses the existing UI.** Every viewed calendar becomes one more busy source for the existing overlap mark and in-drawer callout. No new nudge UI or machinery was added. The one change is a wording fix so the callout names the calendar without reading "calendar calendar". The persisted acknowledgement key format is unchanged.

### What is and is not read

For a viewed calendar the client requests a fixed field mask: id, status, title, location, start, end, transparency, visibility, link, the event type and the recurring-series id. It asks for ordinary events, out-of-office events and events Google created from an email; focus time, working location and contact birthdays are left out. It never requests the description or the attendee list, so neither can reach a device, a log or the family file. Out-of-office events are shown; focus time and working location are not.

## Consequences

- **Two refresh tokens under one Google grant.** An account used for both syncing and viewing holds two refresh tokens, but a Google grant is per user and client id, so revoking either kills both. A shared guard, `anotherGrantSharesAccount`, decides whether a revoke is safe by looking at Drive, every other calendar connection and every view account, and treats an unknown email as shared. It is used by disconnect, reconnect and view removal. This also fixes an existing defect: disconnecting one of two same-account sync connections used to cut off the other. That fix is not behind the flag and is live as soon as it ships, together with choosing the destination calendar in the add step (no more dropdown) and the "Connect Another Google Calendar" label.
- **Consent never writes a record by itself.** A fresh consent yields a pending credential held in memory; the document record is written only when the member confirms a calendar. Closing the step without confirming revokes the pending token through the guard.
- **Older builds** rebuild their projection on merges that touch the two new collections until the update floor is raised. The collections are only written when a family uses the feature.
- **Google verification is an external dependency.** Production must not request the new scope for ordinary users until Google approves it, because an unverified consent shows the unverified-app screen and counts against a 100-user cap. The flag, committed `false`, guarantees this, and carries a review date of 2027-02-15. The checklist and justification are in `~/projects/beanies-ops/docs/runbooks/native-store-submission.md`.
- **If Google refuses or delays the scope**, the flag stays off, all gated code is inert, and the un-gated settings changes stand on their own. If Google refuses after the collections exist, the two empty collections are harmless and the gated code is deleted by flag.
- **Published promises change.** The privacy page, the Google Calendar help articles, the store data declarations and the Google Calendar blog post were reworded in the same change so that none says beanies.family never reads event content. The sentences are true with the flag off and with it on.
- **Data declarations.** Event content from viewed calendars is read and shown on the device, never sent to a server and never used for tracking, so the Apple and Google store answers do not change.

## Alternatives considered

- **Reuse `calendarConnections` with a role field.** Rejected: older builds would treat the record as a push target, and a sync connection's credentials and scopes would carry new risk.
- **Store viewed events in the family document.** Rejected: it would copy other people's schedules into the encrypted file, grow it with data that is not the family's, and make every device a writer of someone else's calendar. Memory plus a short cache is enough, and the document stays the family's.
- **Subscribe by ICS feed.** Rejected (see `2026-06-10-google-calendar-integration.md`, line 149): a secret feed address has to be pasted by the calendar's owner, cannot be revoked per person and does not respect sharing levels. It does not fit "shared with me in Google".
- **Free/busy only.** Rejected: families need to see what the event is (school pickup, a babysitting shift), not only that someone is busy. Busy-only remains available per calendar as a setting.

## Revisit when

- Google classifies the scope as restricted, or changes what `events.list` returns for busy-only shares.
- A second provider (Outlook, iCloud) is requested; the view grant kind and the two collections are Google-specific today.
