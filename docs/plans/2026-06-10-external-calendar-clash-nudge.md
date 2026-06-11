# Plan: External-calendar clash nudge (events.owned read) (#34)

> Date: 2026-06-10 · **Revised 2026-06-11 (pivot: free/busy → field-restricted `events.list` read)**
> Related issues: Notion #34 (depends on / launch-coupled with #32). No GitHub issue — direct implementation.
> Plan file: `docs/plans/2026-06-10-external-calendar-clash-nudge.md`
> All work stays behind a prod-off dev flag. No CHANGELOG, no deploy. Launch-coupled with #32 (one OAuth verification covers both features — and now ONE fewer sensitive scope).

## ⭐ Revision banner — why this plan changed (read first)

The free/busy version of this feature was built (`231c2cbc`, behind the prod-off `calendarClashNudge` flag) and **live-tested by greg**. The test exposed a fundamental design flaw, and we agreed a pivot. This plan now describes the pivoted design. **The free/busy implementation is being reworked, not extended.**

**The flaw (free/busy self-clash).** beanies pushes each activity into the SAME connected calendar we then free/busy-query (#32). To `freeBusy.query` an activity's own synced event is just an opaque busy block at its exact time → **every synced activity self-clashes**. Worse, Google's free/busy MERGES overlapping busy blocks, so once a beanies event and a real event touch they become one indistinguishable interval — they cannot be separated afterward, and subtracting the beanies block creates false negatives.

**The pivot (events.owned, field-restricted read).** The `calendar.events.owned` scope — already requested and granted by #32 ("see, create, change, delete events on owned calendars") — already grants READ. So `calendar.freebusy` never expanded our capability; it was only a narrower-sounding claim. New design:

- Read the connected calendar with `events.list`, using a **partial-response field mask** `fields=nextPageToken,items(id,recurringEventId,start,end,status,transparency)` so the response carries **only** times + the structural fields we filter on — we never **request** event content (summary / description / location / attendees), and the mapper only ever reads the masked fields, so content never enters beanies state. (We do receive an opaque per-event `id` — an identifier, never content — used solely for the beanies-own-event exclusion and then discarded; it is never displayed, stored to disk, or sent anywhere.)
- Identify beanies' OWN events by `deterministicEventId(activity.id)` (we already mint these on push) and **exclude them** — matching the event `id` (one-off events) or `recurringEventId` (expanded recurring instances). No marker, **no #32 push change, no migration.**
- A clash = an external event (not beanies-owned), **opaque** (`transparency !== 'transparent'`), not cancelled, that overlaps a timed beanies activity.

**What this buys us:** it solves self-clash AND the merge problem (we keep individual events, never a merged busy mask), keeps external events **opaque** (no "mark genuinely-busy events as free" hack — greg rejected that), and lets us **drop `calendar.freebusy` entirely** — one fewer sensitive scope, simpler consent + Google verification. The privacy claim shifts from the (already-untrue-given-events.owned) "the API physically can't return content" to the honest, auditable "we only **request** times + the structural fields we filter on, and we read nothing else off the response" — verifiable from the `fields` mask and the mapper, which together are the auditable guarantee (not a server-side impossibility).

**greg does NOT need to disconnect/reconnect his calendars** — `events.owned` was granted on the original #32 consent; the pivot reads through an existing grant and removes a scope, it never adds one.

## ⭐ What SURVIVES the pivot (do NOT rebuild — DRY)

The free/busy build's reusable units stay; only the **data source**, **the scope**, **the beanies-own-event exclusion**, and **the surface wiring** change:

- **Pure clash math** — `src/utils/calendar/clashDetection.ts`: `activityTimeRange`, `intervalsOverlap`, `clashKey` are **unchanged**. `computeClashes` keeps its shape; only its busy-interval input type changes from ISO strings to absolute ms (the events.list path already yields ms — a net simplification, see Approach D).
- `src/utils/calendar/activityDays.ts` (`resolveActivityDays`), `monthGridRange` (in `src/utils/date.ts`), `src/services/calendar/clientInstance.ts`, `src/utils/calendar/runPooled.ts` — all unchanged.
- `src/stores/calendarClashStore.ts` **shell** — the TTL cache, reassign-the-ref reactivity contract, debounce + in-flight thrash guard, silent-to-user/always-reported degradation, and single-`stop()` teardown all stay. Only the fetch method, the cached payload type, the scope constant, and the recompute body change.
- `src/composables/useClash.ts` and `src/components/planner/ClashIndicator.vue` — the per-occurrence `useClash` seam and the presentational dot are **unchanged**; `ClashIndicator` stays props-only. The pivot only ADDS the missing call sites (see Approach G) and a small **sibling** seam in the SAME file — `useClashLookup()` — for the `v-for` inline-render surfaces where a per-iteration `useClash()` call is impossible (a composable cannot be invoked inside a loop). All store coupling still lives in this one file.

## User Story

As a beanies user who has connected one or more external calendars, I want beanies to gently warn me when a family activity overlaps something already on a connected calendar, so I can catch clashes with non-family commitments beanies otherwise cannot see — without beanies ever seeing WHAT those commitments are (only WHEN they are).

## Context

#32 added a one-way push of family activities into connected Google calendars and a read seam (it already holds `calendar.events.owned`). beanies-as-golden-source has one blind spot: non-family commitments (work meetings, appointments) that live only in external calendars. This feature fills it with a privacy-preserving heads-up using a **field-restricted `events.list` read** that returns event TIMES only — never titles, attendees, locations, or descriptions.

`calendar.events.owned` is **already requested upfront** by #32 and is its `REQUIRED_SCOPE` — every stored connection has it (connect fails with `missing_scope` otherwise). So there is no new consent screen and, unlike the free/busy version, **no separate availability scope a user could decline** (see the availability simplification in Approach A). This feature is read-only — it writes nothing to any calendar — and is gated behind both a prod-off dev flag and a user-facing in-app toggle (default ON).

## Requirements

1. **Reuse #32's connection infrastructure** — OAuth client, `TokenProvider`, shared refresh token in the `.beanpod` CRDT, and `connections` from `calendarSyncStore`. No new auth flow, **no new scope** (in fact: one scope removed).
2. **Times only, via a field mask** — read with Google `events.list` using `fields=nextPageToken,items(id,recurringEventId,start,end,status,transparency)`. The mask is the structural privacy guarantee: event content never returns. Never read or store summary/description/location/attendees.
3. **Exclude beanies' own events** — derive `deterministicEventId(activity.id)` for the activities in the window; an external event whose `id` OR `recurringEventId` is in that set is beanies-owned and is NOT a clash source. This is the fix for the self-clash flaw.
4. **Honor transparency + cancellation** — an event marked `transparency === 'transparent'` (the owner set it "free") is not busy and never clashes (this matches free/busy semantics: free/busy never reported free-marked events). Cancelled events are excluded at the API (`showDeleted=false`) with a `status` backstop.
5. **All-day external events DO flag** (greg's call, 2026-06-11) — an opaque (non-transparent) all-day external event marks timed activities on that day as clashing, preserving free/busy parity. (A free-marked all-day event — many birthdays/public holidays — still won't flag, exactly as free/busy behaved.) Implementation: all-day events become a local-midnight-spanning ms interval; no all-day special-casing beyond that, so the rule stays uniform.
6. **User toggle** — a Settings toggle ("Warn me about clashes with my other calendars") in the calendar settings drawer, **default ON**, with copy that beanies reads only WHEN your events are, never WHAT they are.
7. **Availability gate (simplified by the pivot)** — the feature is available whenever **any** calendar is connected (every connection has `events.owned`). No partial-grant "disabled with reconnect caption" state — that state is now impossible. When NO calendar is connected, the toggle is disabled with a "connect a calendar first" caption.
8. **Subtle indicator** — on the planner/activity views, a subtle Heritage Orange indicator (not Alert Red) appears when a beanies activity overlaps an external commitment on a connected calendar. A gentle nudge, not an error or blocker. **Wired into ALL the timed-activity render surfaces** (see Approach G) — the free/busy build only wired the list card, which is why greg saw no dot on the grid.
9. **Name the connected calendar** — the indicator names which connected calendar the clash is on (e.g. "May clash with your Work calendar"), but never the other event's details.
10. **Ephemeral in-memory cache** — event TIMES are held in a short-TTL in-memory session cache, never persisted to disk. Data goes device ↔ the user's own Google account directly (via the existing client), never through a beanies server.
11. **Never block render** — compute clashes asynchronously; decorate the view when the read returns. The calendar must render immediately regardless of the round-trip.
12. **Silent degradation (to the USER), developer-visible (always)** — if a read fails (offline, token expired, rate-limited, 403/404), no badge and **no user-facing toast**. But the failure is **never** swallowed: it is classified (`CalendarApiError`, by the existing `authedFetch`) and logged via `reportError({ severity: 'warning' })` (console + Slack), exactly like #32's degradation path. "Silent" = no nudge spam; the developer always sees it. Re-check on next opportunity.
13. **Teardown** — clears the in-memory cache and watchers on sign-out / family-switch (via `resetAllAppStores`).
14. **Help article** explaining the feature, the toggle, and the **times-only** privacy guarantee (reworded from the free/busy framing).
15. **Drop `calendar.freebusy`** from #32's `CALENDAR_SCOPES`. Existing test connections keep the already-granted scope harmlessly until they reconnect; nothing reads it anymore.
16. **Unit tests**; E2E only if it passes the three-gate filter (it does not — see Testing Plan).

## Important Notes & Caveats

- **Self-clash is THE bug this pivot fixes — the exclusion must be airtight.** beanies-owned events are excluded by `deterministicEventId` matching the event `id` (one-off) OR `recurringEventId` (expanded recurring instance — its per-instance `id` is `<detId>_<timestamp>`, so it must match on `recurringEventId`, not `id`). Both checks are required. Tested explicitly for the recurring case.
- **Exclusion set is occurrence-derived.** The beanies-owned id set is built from the activities that have an occurrence in the visible window (`occurrences.map(o => deterministicEventId(o.activity.id))`). A beanies event present in-window whose activity has NO in-window occurrence (e.g. a transient orphan mid-reconcile, or a multi-day activity straddling the window edge) could momentarily self-clash. Low-risk and self-healing (the #32 reconcile engine converges), logged here as a known v1 edge — NOT a blocker. Do not attempt a global activity scan to close it; the occurrence set is the right scope.
- **Why the cache stores raw times, not pre-excluded intervals.** The cache is keyed by `windowKey` (the API read), but the beanies-exclusion set is keyed by the window's _occurrences_ — two inputs that change independently (a reconcile can add/remove an occurrence without the time window moving). Caching the post-exclusion intervals would couple them and let a stale exclusion outlive an occurrence change. Storing the raw `EventTime[]` and re-running the pure `externalBusyIntervals` on every `recompute` keeps the exclusion always-fresh for the current occurrences at trivial cost (≤ a few hundred events). Do NOT "optimize" by caching the excluded result.
- **The exclusion-set build must not crash the pass.** `deterministicEventId` throws on a blank/corrupt activity id; since `recompute` runs from a fire-and-forget `void ensureBusyForWindow(...)`, an uncaught throw there is an unhandled rejection (a silent failure). Each `deterministicEventId` call in the exclusion-set build is therefore guarded — a thrown anomaly is `reportError`'d once and that occurrence is skipped from the exclusion set, never aborting the whole recompute.
- **`events.list` returns ordinary HTTP errors** (403 forbidden, 404 not-found) — handled by the existing `authedFetch` classification. Unlike `freeBusy.query`, there is NO per-calendar-error-in-a-200-body path, so the free/busy version's `freeBusyReasonToKind` helper is **deleted**, not ported.
- **No silent per-item drops.** `eventItemToMs` returns `null` only for a structurally-malformed item (an event with NEITHER `start.dateTime` NOR `start.date` — which Google should never return). That is NOT swallowed: the `listEventTimes` caller `console.warn`s once per such item (`'[calendarClash] events.list item has no usable start/end; skipping'` + the calendarId/eventId), then continues — so a systemic mapping regression surfaces in the console instead of vanishing. (A `console.warn`, not `reportError`/Slack, because the REST client holds no errorReporter dependency and this is a structural should-never-happen; genuine fetch failures still bubble as `CalendarApiError` to the store's `reportError`.) (A non-finite ms from a parseable-but-bad instant is the same path — see the `Number.isFinite` guards retained in `computeClashes`.)
- **`status: 'tentative'` events ARE busy and DO flag** — only `'cancelled'` is excluded (at the API via `showDeleted=false`, with the `status === 'cancelled'` backstop). This is deliberate and matches free/busy semantics (free/busy reports tentative as busy). Not a silent gap — called out so the reviewer reads it as a decision, not an omission.
- **`singleEvents=true` is mandatory.** It expands recurring events into concrete instances (so we get real per-instance start/end and the `recurringEventId` that drives beanies-exclusion) and is also required for `orderBy=startTime` if used. Without it, a recurring master has no usable instance times in the window.
- **Pagination is bounded but real.** A ≤42-day window on a busy personal calendar can exceed one page (`maxResults` default 250). The client follows `nextPageToken` to completion — and the `fields` mask MUST include `nextPageToken` or paging silently stops after page 1 (a real correctness trap). A hard `MAX_PAGES` cap (20) backstops a non-terminating `nextPageToken` so a server-side paging anomaly can never spin the loop indefinitely; hitting it `console.warn`s (same altitude as a malformed item) and returns what we have. The window keeps this from ever firing in practice.
- **Timezone correctness (unchanged contract).** Timed events return offset-bearing RFC3339 `dateTime`; convert via `new Date(iso).getTime()`. All-day events return a zoneless `date` (`YYYY-MM-DD`); convert via the existing `parseLocalDate` to a local-midnight ms span (`start.date` 00:00 local → `end.date` 00:00 local, where Google's `end.date` is already exclusive). Activity times are local wall-time. Comparing everything in absolute ms keeps overlap correct across zones — the `intervalsOverlap` contract is unchanged.
- **Timed activities only on the beanies side (v1).** Clash detection decorates **timed** beanies activities (those with `startTime`). All-day beanies activities are not decorated. (External all-day events still contribute busy intervals per Requirement 5 — the asymmetry is intentional and matches the free/busy build's beanies-side rule.)
- **Window-bounded — to the VISIBLE GRID, not the calendar month.** Only activities in the currently-visible planner window are checked, and the read is for that window only. For month view the window is the rendered 6-week grid (`gridStart..gridEnd`), NOT 1st→last of the month; week view straddles two months. `timeMin/timeMax` and the occurrence set MUST both cover the visible grid range. Bounded API cost (≤ ~42 days). Reuses the existing `monthGridRange` helper.
- **Do NOT write anything to any calendar.** Strictly read-only. No event insert/patch/delete.
- **Do NOT duplicate #32's client/token plumbing.** Reuse the `CalendarClient` seam and `TokenProvider`; the read shares the same closure-private `authedFetch` as every other method.
- **No Alert Red.** Heritage Orange per brand rules; informational, not destructive.
- **i18n mandatory** — all strings via `uiStrings.ts` + `npm run translate`; no hardcoded English. rem-based sizing only.

## Assumptions

> Review before implementation.

1. `calendar.events.owned` remains in `CALENDAR_SCOPES`, is #32's `REQUIRED_SCOPE`, and grants read on owned calendars — so every stored `CalendarConnection` can read events (✓ verified — `calendarAuth.ts:34,41`; connect fails `missing_scope` without it).
2. `deterministicEventId(activityId)` is the exact id beanies pushes events under (✓ verified — `src/utils/calendar/deterministicEventId.ts`; used by #32's insert path). Recurring beanies activities are pushed as a single recurring event with an RRULE (`recurrenceRrule.ts`), so their expanded instances carry `recurringEventId === deterministicEventId(activity.id)`.
3. `events.list` with `singleEvents=true` returns expanded instances with `recurringEventId` set to the master id, and per-instance `start`/`end` (✓ — Google Calendar v3 documented behavior).
4. The closure-private `authedFetch` classifies + retries (incl. one-shot 401 re-mint) identically for a GET `events.list` call (✓ — same client; method-agnostic).
5. `activityStore` occurrence expansion (`monthActivities(year, month)`, etc.) covers the visible window by iterating the `(year, month)` pairs it spans, filtered to the grid date range (✓ verified — as `WeeklyCalendarView.vue` already does).
6. `resolveActivityDays` yields the timed-occurrence range math for `activityTimeRange` (✓ — unchanged from the free/busy build).
7. `resetAllAppStores()` is the sign-out/family-switch reset entry point and already flag-gates `useCalendarClashStore().stop()` (✓ — added in the free/busy build; reused).
8. Settings persist via the Automerge settings store + repository, tolerating the existing optional `calendarClashNudgeEnabled?: boolean` (✓ — already added in the free/busy build; no migration).
9. `parseLocalDate` + `addDaysYmd` (`src/utils/date.ts`) are the canonical local-date helpers for the all-day → ms span and the overnight day-roll (✓ verified — already used by `clashDetection.ts`).

## Approach

### A. Feature flag, user toggle + availability simplification

- **Dev flag `calendarClashNudge`** — unchanged (already in `FLAG_REGISTRY` + `COMMITTED_FLAGS: false`). Gates engine + UI; launch-coupled with `googleCalendarSync`.
- **User toggle** — unchanged: optional `Settings.calendarClashNudgeEnabled?: boolean`, default ON via `?? true`, setter through the settings **repository** following the `persistAiSetting` report-on-failure contract (on catch: `reportError({ surface: 'settings-persist', severity: 'warning', … })` + re-throw so the control reverts). Reuse `SettingToggleRow.vue`.
- **Availability gate — SIMPLIFIED.** The free/busy build gated on `someConnectionHasFreebusy` (a scope a user could decline). Since `events.owned` is `REQUIRED_SCOPE`, every connection has it, so the gate collapses to **"at least one calendar is connected."** Rename the store getter `someConnectionHasFreebusy` → `hasConnectedCalendar = computed(() => syncStore.connections.length > 0)`; `isAvailable = flag && toggle && hasConnectedCalendar`. In `CalendarSyncSettings.vue`, the toggle is interactive whenever a calendar is connected; when none, `:disabled="true"` + caption "Connect a calendar to use this." **Remove the partial-grant "reconnect and allow availability" caption** — that state can no longer occur.
- **Toggle copy (reworded):** "Warn me about clashes with my other calendars — beanies only reads when your events are, never what they are."

### B. Shared client accessor

Unchanged from the free/busy build — `src/services/calendar/clientInstance.ts` (`getCalendarClient` / `setCalendarClientForTesting` / `resetCalendarClient`) stays exactly as-is. The clash store keeps using the shared singleton (one client, one token cache across push + read).

### C. Read seam on the client — `listEventTimes` (replaces `queryFreeBusy`)

Replace the `queryFreeBusy` method + `BusyInterval` type on the `CalendarClient` interface with a field-restricted event-times read:

```ts
/** A single external event's time window — TIMES ONLY. The events.list call uses a
 *  `fields` mask that omits summary/description/location/attendees, so content never
 *  crosses the wire. `transparent` = the owner marked it "free", not busy. (#34) */
export interface EventTime {
  id: string;                 // per-instance id for expanded recurring events
  recurringEventId?: string;  // master id for an expanded recurring instance
  startMs: number;            // absolute ms (timed: dateTime; all-day: local-midnight span)
  endMs: number;
  transparent: boolean;
}

listEventTimes(
  connectionId: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<EventTime[]>;
```

**Google impl** (`googleCalendarClient.ts`) — add `listEventTimes` to the returned object (shares the closure `authedFetch`); delete `queryFreeBusy` and `freeBusyReasonToKind`:

```ts
const MAX_PAGES = 20; // safety cap: 20 × 250 = 5000 events >> any ≤42-day window.
                      // Structural guard against a non-terminating nextPageToken
                      // (server anomaly / repeated token) — never fires in practice.
async listEventTimes(connectionId, calendarId, timeMinIso, timeMaxIso) {
  const out: EventTime[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({
      timeMin: timeMinIso, timeMax: timeMaxIso,
      singleEvents: 'true', showDeleted: 'false', maxResults: '250',
      fields: 'nextPageToken,items(id,recurringEventId,start,end,status,transparency)',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await authedFetch(connectionId, `/calendars/${enc(calendarId)}/events?${params}`, { method: 'GET' });
    const data = await res.json() as { nextPageToken?: string; items?: GoogleEventTimeItem[] };
    for (const it of data.items ?? []) {
      if (it.status === 'cancelled') continue;          // backstop; showDeleted handles most
      const range = eventItemToMs(it);                  // pure leaf; null ONLY if structurally malformed
      if (!range) {                                     // never a silent drop — warn + continue
        // The REST client is a thin classified-throw seam (no errorReporter dep);
        // a malformed item is a data anomaly, so a console.warn here is the right
        // altitude, while real fetch failures bubble as CalendarApiError to the
        // store's reportError. Should never fire — Google always returns one shape.
        console.warn('[calendarClash] events.list item has no usable start/end; skipping', { calendarId, eventId: it.id });
        continue;
      }
      out.push({ id: it.id, recurringEventId: it.recurringEventId, ...range, transparent: it.transparency === 'transparent' });
    }
    pageToken = data.nextPageToken;
    pages += 1;
    if (pageToken && pages >= MAX_PAGES) {
      // Enforced invariant, not an assumption — a non-terminating token can never
      // spin the loop. Truncate + warn (same altitude as a malformed item).
      console.warn('[calendarClash] events.list exceeded MAX_PAGES; truncating', { calendarId, pages });
      break;
    }
  } while (pageToken);
  return out;
}
```

`eventItemToMs(item)` — a small pure mapper (a leaf in `src/utils/calendar/`, exported for unit test): timed (`start.dateTime`/`end.dateTime` → `Date.getTime()`); all-day (`start.date`/`end.date` → `parseLocalDate(date).getTime()` for the local-midnight span); returns `null` ONLY for a structurally-malformed item (neither shape present). The mapper stays pure (no logging inside it); the `listEventTimes` caller is the one place that turns a `null` into a `console.warn` (above) so the drop is never silent — a `console.warn` (not `reportError`/Slack) is the right altitude because the REST client deliberately holds no `errorReporter` dependency and this is a should-never-happen data anomaly, while genuine fetch failures still bubble as `CalendarApiError` to the store's `reportError`. Unit-tested for all three branches incl. the `null` case. The in-memory fake client in tests implements `listEventTimes` (swap from `queryFreeBusy`).

### D. Pure layer — exclusion + overlap (`clashDetection.ts`)

`activityTimeRange`, `intervalsOverlap`, `clashKey` are **unchanged**. Two changes:

1. **`ConnectionBusy.intervals` becomes absolute ms** — `{ startMs: number; endMs: number }[]` (was ISO `BusyInterval[]`). The events.list path already yields ms, so `computeClashes` **drops its internal `new Date(iso).getTime()` pre-parse** — a net simplification. (Its `Number.isFinite` guards stay, since `eventItemToMs` could in theory yield non-finite from a malformed instant.)
2. **New pure filter `externalBusyIntervals`** — the beanies-exclusion + transparency filter, kept pure and exhaustively tested:

```ts
/** From a connection's raw event times, keep only the OTHER, busy commitments:
 *  drop transparent (free-marked) and beanies-owned (id OR recurringEventId in the
 *  set) events. Returns absolute-ms intervals ready for computeClashes. (#34) */
export function externalBusyIntervals(
  events: EventTime[],
  beanieEventIds: ReadonlySet<string>
): { startMs: number; endMs: number }[] {
  return events
    .filter((e) => !e.transparent)
    .filter(
      (e) =>
        !beanieEventIds.has(e.id) &&
        !(e.recurringEventId !== undefined && beanieEventIds.has(e.recurringEventId))
    )
    .map((e) => ({ startMs: e.startMs, endMs: e.endMs }));
}
```

`computeClashes(occurrences, busyByConnection)` keeps its signature and `clashKey`/first-match-wins behavior; only the interval type it consumes changes. `EventTime` is imported by the pure layer as a type only (it lives on the `CalendarClient` seam — a type-only import keeps the dependency direction clean).

### E. Orchestrator rework — `calendarClashStore`

Shell unchanged (TTL cache, reassign-ref reactivity, debounce/in-flight guard, `stop()`). Changes:

- Constant `FREEBUSY_SCOPE = 'calendar.freebusy'` → **removed**; `hasFreebusy()` predicate → removed. `freebusyConnections()` → `connectedCalendars()` returns `syncStore.connections` (all have events.owned). `someConnectionHasFreebusy` → `hasConnectedCalendar` (Approach A).
- `BusyCacheEntry.intervals: BusyInterval[]` → `events: EventTime[]` (cache the raw times; exclusion is recomputed per window because the beanies id set depends on the window's occurrences).
- `fetchBusy` → `fetchEventTimes`: calls `getCalendarClient().listEventTimes(connection.id, connection.destinationCalendarId || 'primary', timeMin, timeMax)`; on success caches the `EventTime[]`; on failure the SAME silent-to-user/always-`reportError({ surface: 'calendar-clash', severity: 'warning' })` path, caching `events: []` so a transient failure doesn't refetch-storm within the TTL.
- `recompute` now computes the exclusion set once and applies the pure filter:
  ```ts
  // deterministicEventId THROWS on a blank id — an occurrence with a corrupt
  // activity id must not crash the whole clash pass (recompute is called from a
  // fire-and-forget `void ensureBusyForWindow(...)`, so a throw here would become
  // an unhandled rejection — a silent failure). Guard each call; skip + report any
  // anomaly once rather than aborting the recompute.
  const beanieEventIds = new Set<string>();
  for (const o of occurrences) {
    try {
      beanieEventIds.add(deterministicEventId(o.activity.id));
    } catch (e) {
      reportError({
        surface: 'calendar-clash',
        severity: 'warning',
        message:
          '[calendarClash] could not derive event id for occurrence; skipping it from the self-exclusion set',
        error: e,
        context: { activityId: o.activity.id },
      });
    }
  }
  const busyByConnection = connections.map((connection) => {
    const entry = busyCache.get(connection.id);
    const events = entry && entry.windowKey === windowKey ? entry.events : [];
    return {
      connectionId: connection.id,
      calendarLabel: connection.accountEmail,
      intervals: externalBusyIntervals(events, beanieEventIds),
    };
  });
  clashes.value = computeClashes(occurrences, busyByConnection);
  ```
- `isAvailable`, `ensureBusyForWindow` (debounce + in-flight `windowKey` short-circuit + `CLASH_BUSY_TTL_MS` staleness + `runPooled`), `clashFor`, the `watch(isAvailable)` clear, and `stop()` are otherwise unchanged.

### F. Bounded-concurrency helper

`src/utils/calendar/runPooled.ts` — unchanged; reused as-is.

### G. Indicator UI — wire the MISSING surfaces (the visible bug)

`ClashIndicator.vue` (presentational, props-only) and `useClash(activityId, occurrenceDate)` (the single read seam) are **unchanged**. The free/busy build only mounted them in `ActivityListCard.vue` — which renders in exactly one place (the day-agenda sidebar), so nothing showed on the calendar grid where greg looked. Add the indicator at every timed-activity render site via the `useClash.ts` seams (the seam file IS the DRY unit — mounting it at N call sites is not duplication; the store/key/reactivity coupling lives in one file). Most surfaces render activities inside a `v-for`, so the per-occurrence `useClash` composable can't be called per item there — those use the `useClashLookup()` sibling instead (see below):

| Surface             | File                                            | Render site                                                                                                        | Has `activity.id` + occurrence `YYYY-MM-DD`?               |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Month grid chip     | `src/components/planner/MonthChip.vue`          | after the title span (line ~116); has `occurrence.activity` + `occurrence.date`                                    | ✓                                                          |
| Mobile day timeline | `src/components/planner/DayTimeline.vue`        | title row (line ~355, inside `v-for="ev in positionedEvents"`); `ev.occurrence.activity` + `ev.occurrence.date`    | ✓ (inline `v-for` render — use the lookup seam, see below) |
| Desktop week view   | `src/components/planner/WeeklyCalendarView.vue` | timed-block title row (line ~837, inside nested `v-for group`/`v-for activity`); `activity` + `day.dateStr`        | ✓ (inline `v-for` render — use the lookup seam, see below) |
| Desktop day view    | `src/components/planner/DailyCalendarView.vue`  | timed-block title row (line ~470, inside nested `v-for group`/`v-for activity`); `activity` + `currentDay.dateStr` | ✓ (inline `v-for` render — use the lookup seam, see below) |

**The two wiring shapes — and why no `TimedActivityBlock` extraction.**

_Single-occurrence component_ (`MonthChip` only): its `setup()` renders exactly one `occurrence` prop, so wire the existing per-occurrence seam — `const clash = useClash(() => props.occurrence.activity.id, () => props.occurrence.date)` + `<ClashIndicator v-if="clash" :calendar-label="clash.calendarLabel" />`, mirroring `ActivityListCard` exactly.

_Inline `v-for` render sites_ (`DayTimeline` — `v-for="ev in positionedEvents"`; `WeeklyCalendarView` & `DailyCalendarView` — bare `<div v-for="(activity, ai) in group">` inside a nested `v-for`), with divergent layouts (PhotoIndicator present/absent, member stacks, absolute positioning). A composable **cannot** be invoked per loop iteration (`useClash()` must run in `setup()`, not inside a `v-for`), and minting one `useClash` computed per visible activity in `setup()` is neither possible (the set is dynamic) nor DRY. **Solution: add a sibling seam `useClashLookup()` in the SAME `useClash.ts` file** that returns a single stable, reactive lookup function callable inline in the template:

```ts
// useClash.ts — sibling to useClash; the ONE place that still owns store coupling.
export function useClashLookup(): (
  activityId: string,
  occurrenceDate: string
) => ClashInfo | undefined {
  const store = useCalendarClashStore();
  // Returns a plain function; called in-template inside a v-for it re-reads the
  // reactive `clashes` ref on every render, so indicators still appear when data lands.
  return (activityId, occurrenceDate) => store.clashFor(activityId, occurrenceDate);
}
```

In each inline view: `const clashFor = useClashLookup();` once in `setup()`. In the template, resolve the clash **once per item** and read that single value — never call `clashFor()` twice on the same element (two reads per item per render + a drift risk if a future edit touches one call but not the other). Where the timed activity is rendered inside a `<template v-for>` wrapper, resolve once into a loop-scoped binding; where the current markup is a bare `<div v-for>` that makes a single-resolve binding awkward, wrap it in a `<template v-for>` so the clash resolves once:

```html
<template v-for="activity in group" :key="activity.id">
  <div class="timed-block" …>
    <span class="truncate">{{ activity.title }}</span>
    <!-- one resolve, reused; the same value gates v-if and is dereferenced -->
    <ClashIndicator
      v-if="clashFor(activity.id, day.dateStr)"
      :calendar-label="clashFor(activity.id, day.dateStr)!.calendarLabel"
    />
  </div>
</template>
```

Prefer the `<template v-for>` wrap over shipping the double-call form. The lookup is cheap, but "resolve once, read once" is the prescribed maintainable contract and keeps the `!` non-null assertion honest. This keeps **all** store/key/reactivity coupling in `useClash.ts` (one file), works inside `v-for`, and adds no per-item composable.

**Decision: NO `TimedActivityBlock.vue` extraction.** The three inline renders are layout-divergent and a shared block component is a larger #32-touching refactor out of scope here; `useClashLookup` is the minimal DRY seam that removes the actual duplication (the store coupling), which is the only thing worth de-duplicating now. (Re-evaluate a shared timed-activity component as separate tech-debt if those inline renders converge later.) `ClashIndicator` stays props-only throughout.

### H. Error handling / degradation

Unchanged contract: user-facing reads NEVER toast (anti-spam); every failure is classified by `authedFetch` (`CalendarApiError`) and `reportError({ severity: 'warning' })` (console + Slack), as #32 does. No bare `catch {}`. A failing connection's events are absent for that window and re-attempted on the next window/TTL change. The events.list 403/404 path now flows through the standard HTTP classification (no special per-calendar-body handling).

## Files Affected

**Modified**

- `src/services/calendar/CalendarClient.ts` — replace `queryFreeBusy` + `BusyInterval` with `listEventTimes` + `EventTime`.
- `src/services/calendar/googleCalendarClient.ts` — implement `listEventTimes` (events.list + `fields` mask + pagination + timed/all-day → ms + transparency; `console.warn` + skip on a structurally-malformed item — never a silent drop); delete `queryFreeBusy` and `freeBusyReasonToKind`; add the `eventItemToMs` mapper.
- `src/services/calendar/calendarAuth.ts` — remove `calendar.freebusy` from `CALENDAR_SCOPES` (#32 scope reduction).
- `src/utils/calendar/clashDetection.ts` — add `externalBusyIntervals`; change `ConnectionBusy.intervals` to absolute ms; drop `computeClashes`' internal ISO pre-parse. `activityTimeRange`/`intervalsOverlap`/`clashKey` unchanged.
- `src/stores/calendarClashStore.ts` — rework per Approach E: remove `FREEBUSY_SCOPE` / `hasFreebusy` / `freebusyConnections`; rename `someConnectionHasFreebusy` → `hasConnectedCalendar`; cache payload `EventTime[]`; `fetchBusy` → `fetchEventTimes`; exclusion-aware `recompute` (new imports: `deterministicEventId`, `externalBusyIntervals`; drop the `BusyInterval` import). Shell (TTL/reactivity/debounce/in-flight/`stop`) unchanged. Note: removing `hasFreebusy` removes this feature's ONLY read of `connection.grantedScopes` (✓ verified — after removal the sole remaining readers are `calendarSyncStore.ts` `calendarlist`-scope check for the destination picker and the connect-time `REQUIRED_SCOPE` validation at `calendarAuth.ts:202`; no clash-path reader remains). The field stays validated at connect time.
- `src/components/settings/CalendarSyncSettings.vue` — simplified availability gate (connected vs not) + reworded toggle copy; remove the partial-grant caption.
- `src/composables/useClash.ts` — ADD the sibling `useClashLookup()` seam for inline `v-for` render sites (Approach G); existing `useClash` unchanged. Keeps ALL store coupling in this one file.
- `src/components/planner/MonthChip.vue` — single-occurrence component; mount `ClashIndicator` via the per-occurrence `useClash` (Approach G).
- `src/components/planner/DayTimeline.vue`, `WeeklyCalendarView.vue`, `DailyCalendarView.vue` — `v-for` render sites; mount `ClashIndicator` via the `useClashLookup()` function (per-iteration composable calls are impossible inside `v-for`; Approach G).
- `src/content/help/security.ts` — reword the `external-calendar-clash-nudge` article from the free/busy framing to "reads when, never what."
- `src/services/translation/uiStrings.ts` (+ `npm run translate`) — reword the toggle hint + clash label + availability caption; remove now-dead free/busy-specific strings.

**Tests (modified / renamed)**

- `src/services/calendar/__tests__/googleCalendarClient.freebusy.test.ts` → rename to `…eventTimes.test.ts`; rework for `listEventTimes` (GET shape + `fields` mask incl. `nextPageToken`; pagination across two pages; timed → ms; all-day → local-midnight span; cancelled skipped; **tentative KEPT** (busy); `transparency` → `transparent`; a structurally-malformed item is skipped with a `console.warn` (spy asserts the warn fired — proves no silent drop); a 401 re-mints once). Add a focused `eventItemToMs` unit test (timed / all-day / `null` branches).
- `src/utils/calendar/__tests__/clashDetection.test.ts` — add `externalBusyIntervals` cases (transparent dropped; beanies one-off `id` dropped; beanies recurring `recurringEventId` dropped; all-day full-day interval kept; opaque external kept); update `computeClashes` cases to ms intervals.
- `src/stores/__tests__/calendarClashStore.test.ts` — fake client now returns `EventTime[]`; assert self-exclusion (a beanies event at the activity's time produces NO clash); availability = any connection (`hasConnectedCalendar`); an occurrence with a blank activity id does NOT throw out of `ensureBusyForWindow` (guarded; `reportError` fires, recompute still completes); the existing reactivity/TTL/in-flight/stop tests stay.

> The shared in-memory fake `CalendarClient` (test helper) swaps `queryFreeBusy` → `listEventTimes`. `BusyInterval` references in tests are removed with the type. `useClashLookup` is a thin re-read of `store.clashFor`, so the store's existing reactivity/self-exclusion tests cover it — no separate composable test needed (it has no logic of its own).

## Help Center Coverage

- **Action**: `update existing` — the `external-calendar-clash-nudge` article in `SECURITY_ARTICLES` (`src/content/help/security.ts`) already exists from the free/busy build; reword it (the feature is still prod-off, so the article ships when the feature does).
- **Category**: `security` · **Type**: `explainer` · **Slug**: `external-calendar-clash-nudge` (unchanged)
- **Title**: "Clash warnings from your other calendars" (unchanged)
- **Scope**: beanies can gently warn you when a family activity overlaps something on a connected calendar. Reword the privacy guarantee from "only checks if you're busy" to the honest, auditable **"beanies reads only WHEN your events are — their start and end times — never WHAT they are (no titles, people, locations, or notes), using a request that asks the calendar for times only."** How to turn it on/off; nothing is written to your calendar or sent to a beanies server.
- **Notes**: state the times-only guarantee plainly (user-facing copy may say "asks the calendar for times only"; do NOT claim Google is technically incapable of returning more — the guarantee is that beanies only requests + reads times, which is what the mask + mapper enforce); available whenever a calendar is connected (no extra permission); beanies never flags its own synced activities; events you've marked "free" don't count; gentle hint, not a blocker; v1 decorates timed activities. Cross-link `google-calendar-sync`.

## Acceptance Criteria

- [ ] Reads via `events.list` with the `fields` mask (times only); a network capture shows no event titles/descriptions/locations/attendees ever returned.
- [ ] beanies' OWN synced events never produce a clash — a timed activity whose own event sits in the connected calendar shows NO dot (one-off via `id`, recurring via `recurringEventId`). Self-clash test green.
- [ ] An OPAQUE external event (timed or all-day) overlapping a timed activity → subtle Heritage-Orange indicator naming the connected calendar, never the event's details.
- [ ] A `transparency: transparent` external event does NOT flag; a cancelled event does NOT flag.
- [ ] Indicator appears on ALL timed-activity surfaces — month chip, mobile day timeline, desktop week, desktop day, and the list card — not just the list card.
- [ ] Edge-week activities visible in month view (adjacent-month days) ARE checked — window covers the rendered grid, not just the calendar month.
- [ ] `calendar.freebusy` is removed from `CALENDAR_SCOPES`; a fresh connect requests one fewer scope; nothing in the codebase reads `freebusy`.
- [ ] Settings toggle in the calendar drawer; default ON; user can disable; persists via the settings repository; a persist failure is reported via `reportError`. Available whenever a calendar is connected; disabled with "connect a calendar" caption when none. No partial-grant state.
- [ ] Indicators appear reactively when data lands (`clashes` ref reassigned, not mutated) — store test.
- [ ] Rapid planner navigation does not stack reads: ≤1 in-flight per (connection, window); debounced; same-window TTL hits issue no network call.
- [ ] Disabling the toggle (or disconnecting the last calendar) removes all indicators and stops all reads.
- [ ] Read failures degrade silently to the USER but are ALWAYS classified + reported (console/Slack) — no bare catches.
- [ ] No event content ever read/stored/displayed; event times never persisted; never sent to a beanies server.
- [ ] Render never blocks on the read round-trip.
- [ ] Engine + cache torn down on sign-out/family-switch (single `stop()`).
- [ ] Cards resolve clashes only through `useClash`; `ClashIndicator` is props-only.
- [ ] Help article reworded to the times-only framing and matches shipped behavior.
- [ ] Unit tests pass; `npm run validate` green; `npm run translate` clean.

## Testing Plan

1. **Unit — pure layer** (`clashDetection.test.ts`): `activityTimeRange` half-open boundaries / overnight roll / multi-day / overnight-recurring (unchanged, still green); `externalBusyIntervals` — transparent dropped, beanies `id` dropped, beanies `recurringEventId` dropped, all-day kept as full-day interval, opaque external kept; `computeClashes` over ms intervals keys via `clashKey` and picks the right connection/label; cross-UTC-offset overlap still correct.
2. **Unit — events.list client** (`googleCalendarClient.eventTimes.test.ts`): GET URL + `fields` mask incl. `nextPageToken`; `singleEvents=true` + `showDeleted=false`; two-page pagination; timed `dateTime` → ms; all-day `date` → local-midnight span; cancelled item skipped; tentative item KEPT; `transparency` → `transparent` boolean; a structurally-malformed item is skipped AND a `console.warn` spy fires (no silent drop); a 401 re-mints once. Plus a focused `eventItemToMs` test for the timed / all-day / `null` branches.
3. **Unit — clash store** (fake client returning `EventTime[]`): toggle off → no reads; no connection → unavailable; **self-exclusion — a beanies event (matching `deterministicEventId`) at the activity's exact time yields NO clash**; opaque external overlap → `clashFor` returns `ClashInfo` AND `clashes` ref reassigned; TTL reuse → no new read; rapid same-window re-entry while in-flight → single fetch; throwing `listEventTimes` → no clashes, no throw, `reportError` once; `stop()` clears all in one call.
4. **Unit — grid range helper** (`monthGridRange`): unchanged regression guard (still green).
5. **E2E**: none — fails the three-gate filter (external read round-trip, connected account, copy/owner-dependent). Covered by unit + component tests; logged in `docs/E2E_HEALTH.md`.
6. **Manual (DEV, both flags on) — re-run greg's failing live test**: create a timed activity at a time the connected calendar is already busy → indicator appears on the **grid** (month/week/day) AND the list, naming the calendar; **the activity's OWN synced event does not cause a clash**; a "free"-marked external event does not flag; an all-day opaque external event flags timed activities that day; toggle off → gone, no network; disconnect the last calendar → unavailable, no errors; offline → no badge/toast but a `[calendarClash]` `reportError` warning in console (and Slack in a reporting build); spam prev/next → ≤1 read per settled window.

## Review Passes

- **Pass 1 (Initial draft — 2026-06-11 revision)**: Pivoted the data source from `freeBusy.query` to a field-restricted `events.list` read; added `deterministicEventId`-based self-exclusion (the self-clash fix) and transparency/cancellation handling; dropped `calendar.freebusy` + the per-calendar-200-error helper; simplified the availability gate (events.owned always present → "any connection"); wired `ClashIndicator` into the four previously-unwired grid surfaces; preserved all-day flagging (greg's call) by treating all-day events as full-day busy intervals while still honoring transparency; reworded the privacy framing to "times only"; itemized exactly what survives the pivot to avoid rebuilds.
- **Pass 2 (DRY + error handling)**: Verified every reuse/error claim against the live code. Resolved the Approach-G `v-for` gap (a composable can't run per loop iteration) with a `useClashLookup()` sibling seam in `useClash.ts` — keeps ALL store coupling in one file, no premature `TimedActivityBlock` extraction. Closed three silent-failure holes: `eventItemToMs` malformed items now `console.warn` + skip (not silent-drop) at the client's correct altitude; the `deterministicEventId` exclusion-set build is guarded so a corrupt activity id can't crash the fire-and-forget `recompute` into an unhandled rejection; clarified `status:'tentative'` is a deliberate keep, not an omission. Added matching unit assertions (malformed-item warn spy, `eventItemToMs` null branch, corrupt-id guard) and tightened Files Affected (store import/rename detail, `useClash.ts` now modified).
- **Pass 3 (Sustainability)**: Added a hard `MAX_PAGES` cap to the `listEventTimes` pagination loop (structural guard against a non-terminating `nextPageToken`, not just a logical window bound); made the single-resolve `useClashLookup` template form mandatory (killed the double-`clashFor` ambiguity across the 3 inline views via a `<template v-for>` wrap); documented the raw-times-vs-pre-excluded cache separation as a deliberate anti-drift invariant; confirmed `grantedScopes` has no remaining clash-path reader after `hasFreebusy` is removed. Endorsed the existing no-`TimedActivityBlock` decision as the correct minimal-coupling call.
- **Pass 4 (Fresh-eyes sweep — 2026-06-11)**: Grounded every load-bearing claim against live code (all-day midnight-span math, `parseLocalDate`/`addDaysYmd`, `deterministicEventId` throw-on-blank, the `BusyInterval`/`queryFreeBusy` seam, `monthGridRange`, `computeClashes` shape) — no correctness bug found; the self-exclusion, pagination `MAX_PAGES` guard, and `useClashLookup` seam all hold. Tightened the privacy claim from "content never crosses the wire / never reaches us" to the defensible "we only request + read times and the structural fields we filter on" (the mask + mapper are the auditable guarantee, not a server-side impossibility), and noted the opaque external `id` we do receive is an identifier used only for exclusion then discarded. Closed the `grantedScopes`-reader check (verified: no clash-path reader remains after `hasFreebusy` is removed).

## Prompt Log

> No GitHub issue created — direct implementation. Full intake captured in Notion #34 (`beanies-plan prompt`).

<details>
<summary>Full prompt history</summary>

### Pre-plan intake (Notion #34, 2026-06-10)

Assembled `=== BEANIES PRE-PLAN ===` block; resolved decisions: name the clashing calendar; ephemeral in-memory cache.

### Initial plan (2026-06-10)

`/beanies-plan` → "build the plan" → the free/busy version (now superseded).

### Pivot decision (2026-06-10, live test)

greg live-tested the free/busy build; it surfaced the self-clash flaw (an activity's own synced event registered as busy; Google merges overlapping busy blocks). greg proposed and we validated the `events.owned` field-restricted-read pivot (drop `calendar.freebusy`; identify own events via `deterministicEventId`; honest "times only" privacy claim).

### Revision request (2026-06-11)

> update the issue #34 plan as per all the revisions and work agreed in the previous session, if any questions let me know

### Clarification (2026-06-11)

Q: With events.list we can distinguish all-day vs timed external events — should an all-day external event flag a clash on every timed activity that day?
A (greg): **Keep flagging all-day events** — preserve the free/busy behavior (any opaque all-day external event marks timed activities that day as clashing).

</details>
