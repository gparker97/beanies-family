# Plan: External-calendar clash nudge (free/busy) (#34)

> Date: 2026-06-10
> Related issues: Notion #34 (depends on / launch-coupled with #32). No GitHub issue — direct implementation.
> Plan file: `docs/plans/2026-06-10-external-calendar-clash-nudge.md`
> All work stays behind a prod-off dev flag. No CHANGELOG, no deploy. Launch-coupled with #32 (one OAuth verification covers both scopes).

## User Story

As a beanies user who has connected one or more external calendars, I want beanies to gently warn me when a family activity overlaps something already on a connected calendar, so I can catch clashes with non-family commitments beanies otherwise cannot see — without beanies ever seeing WHAT those commitments are.

## Context

#32 added a one-way push of family activities into connected Google calendars. beanies-as-golden-source has one blind spot: non-family commitments (work meetings, appointments) that live only in external calendars. This feature fills it with a privacy-preserving heads-up using ONLY the Google free/busy API (busy/free time blocks — never event titles, attendees, locations, or descriptions).

The `calendar.freebusy` scope is **already requested upfront** by #32 (`CALENDAR_SCOPES` in `calendarAuth.ts` includes it), so there is no new consent screen. This feature is read-only — it writes nothing to any calendar — and is gated behind both a prod-off dev flag and a user-facing in-app toggle (default ON).

## Requirements

1. **Reuse #32's connection infrastructure** — OAuth client, `TokenProvider`, shared refresh token in the `.beanpod` CRDT, and `connections` from `calendarSyncStore`. No new auth flow, no new scope request.
2. **Free/busy only** — query the Google `freeBusy.query` endpoint with the `calendar.freebusy` scope. Never read or store event details. Structurally limited to busy/free intervals.
3. **User toggle** — a Settings toggle ("Warn me about clashes with my other calendars") in the calendar settings drawer, **default ON**, with copy that it only checks whether you're busy, never what the event is.
4. **Partial-grant handling** — if no connection has `calendar.freebusy` in `grantedScopes` (user declined it on the combined #32 consent), the feature is unavailable: the toggle is shown disabled with an explanatory caption, no queries run, no errors.
5. **Subtle indicator** — on the planner/activity views, a subtle Heritage Orange indicator (not Alert Red) appears when a beanies activity overlaps a busy block on a connected calendar. A gentle nudge, not an error or blocker.
6. **Name the connected calendar** (resolved in pre-plan) — the indicator names which connected calendar the clash is on (e.g. "May clash with your Work calendar"), but never the other event's details.
7. **Ephemeral in-memory cache** (resolved in pre-plan) — busy blocks are held in a short-TTL in-memory session cache, never persisted to disk. Busy data goes device ↔ the user's own Google account directly (via the existing client), never through a beanies server.
8. **Never block render** — compute clashes asynchronously; decorate the view when busy data arrives. The calendar must render immediately regardless of the free/busy round-trip.
9. **Silent degradation (to the USER), developer-visible (always)** — if a free/busy query fails (offline, token expired, rate-limited), no badge and **no user-facing toast**. But the failure is **never** swallowed by a bare catch: it is classified (`CalendarApiError`) and logged via `reportError({ severity: 'warning' })` (console + Slack), exactly like #32's degradation path. "Silent" = no nudge spam to the user; the developer always sees it. Re-check on next opportunity.
10. **Teardown** — clears the in-memory cache and watchers on sign-out / family-switch (via `resetAllAppStores`).
11. **Help article** explaining the feature, the toggle, and the free/busy-only privacy guarantee.
12. **Unit tests**; E2E only if it passes the three-gate filter (it does not — see Testing Plan).

## Important Notes & Caveats

- **Family-wide connection model (privacy interpretation to confirm).** #32 made calendar connections **family-wide** (shared refresh token in the CRDT; all family activities push to all connected calendars). Consequently free/busy busy intervals for a connected account are queryable by any family device, exactly as the push already is. The indicator references the **connected calendar** (account/calendar name already visible in Settings), consistent with #32's existing family-shared model. The privacy guarantee the scope enforces — busy/free only, never event details, never to a beanies server — holds regardless. Flag for confirmation.
- **freeBusy feasibility (Open Q1 — resolved).** `freeBusy.query` is an ordinary Calendar v3 REST endpoint callable with the per-connection access token via the existing closure-private `authedFetch` inside `createGoogleCalendarClient`, exactly like `listCalendars`. Adding `queryFreeBusy` to the returned client object gives it `authedFetch` access for free — no new fetch/token plumbing. Feasibility confirmed (`authedFetch` is constructed once per client and closed over by every method).
- **Timed activities only in v1.** Clash detection applies to **timed** activities (those with `startTime`). All-day beanies activities are not decorated — free/busy all-day semantics are noisy. Documented v1 limitation.
- **Window-bounded — to the VISIBLE GRID, not the calendar month.** Only the activities in the currently-visible planner window are checked, and free/busy is queried only for that window. **For month view the visible window is the rendered 6-week grid (leading/trailing adjacent-month days), NOT the 1st→last of the calendar month** — `CalendarGrid.vue` renders `gridStart..gridEnd` and the weekly view already straddles two months. The free/busy `timeMin/timeMax` and the occurrence set MUST both cover the visible grid range, or edge-week activities silently get no clash check while on screen. Bounded API cost (≤ ~42 days).
- **Do NOT write anything to any calendar.** Strictly read-only. No event insert/patch/delete.
- **Do NOT duplicate #32's client/token plumbing.** Reuse the `CalendarClient` seam and `TokenProvider`. Extract the shared singleton client accessor (see Approach) rather than re-instantiating.
- **No Alert Red.** Heritage Orange per the brand rules; informational, not destructive.
- **i18n mandatory** — all strings via `uiStrings.ts` + `npm run translate`; no hardcoded English. rem-based sizing only.

## Assumptions

> Review before implementation.

1. `calendar.freebusy` remains in `CALENDAR_SCOPES` and is requested upfront with #32 (✓ verified — `calendarAuth.ts`).
2. `CalendarConnection.grantedScopes: string[]` reliably reflects what the user granted — populated from `tokens.scope.split(' ')` post-consent and stored on connect/reconnect (✓ verified). The scope check uses **substring matching** (`s.includes('calendar.freebusy')`) to mirror the existing `listCalendarsFor` style and stay robust to full-URL vs short scope forms.
3. The closure-private `authedFetch` path classifies + retries (incl. one-shot 401 re-mint) identically for a POST `freeBusy` call (✓ — same client; the 401 re-mint is method-agnostic).
4. `activityStore` exposes occurrence expansion (`monthActivities(year, month)`, `activitiesForDate(date)`, `expandRecurring(activity, year, month)`) — reuse for per-instance overlap (✓ verified). These are **month-keyed**: covering a multi-month visible window means iterating the `(year, month)` pairs the window spans (as `WeeklyCalendarView.vue` already does) and filtering to the grid's date range — not assuming one month.
5. `buildStartEnd`'s time-range logic (all-day, overnight, multi-day day-rolling) in `activityToGoogleEvent.ts` is the canonical activity→range math (✓ verified — it is **module-private** and returns Google `dateTime` strings, not ms; see Approach D).
6. `resetAllAppStores()` is the sign-out/family-switch reset entry point and already flag-gates `useCalendarSyncStore().stop()` (✓ verified — same pattern reused).
7. Settings persist via the Automerge settings store + its repository (`settingsRepo`), tolerating an added optional boolean with no migration (✓ — optional CRDT field, same as #32; setter MUST go through `settingsRepo`, not write `settings.value` directly).

## Approach

### A. Feature flag + user toggle

- **Dev flag `calendarClashNudge`** — add an entry to `FLAG_REGISTRY` in `flagRegistry.ts` (`id`/`label`/`description`) and `calendarClashNudge: false` to `COMMITTED_FLAGS` in `featureFlags.committed.ts`. Gates the engine `start()` and the UI. Launch-coupled with `googleCalendarSync`.
- **User toggle** — add an optional `calendarClashNudgeEnabled?: boolean` to the `Settings` model. Default ON: `clashNudgeEnabled = computed(() => settings.value.calendarClashNudgeEnabled ?? true)`. The setter goes through the settings **repository** (`settings.value = await settingsRepo.setCalendarClashNudgeEnabled(enabled)`).
  - **Error contract.** Follow the codebase's actual report-on-failure path — the `persistAiSetting` contract (NOT `setSyncEnabled`/`setShowPublicHolidays`, which silently set `error.value` only): on catch, `reportError({ surface: 'settings-persist', severity: 'warning', error, context: { field: 'calendarClashNudgeEnabled' } })` and re-throw so the toggle control can revert its optimistic state. The failure is never swallowed.
- **Toggle UI** — reuse the existing `SettingToggleRow.vue` (`title`/`hint`/`disabled`/`testid` + default slot) inside `CalendarSyncSettings.vue`. Copy: "Warn me about clashes with my other calendars — beanies only checks whether you're busy, never what the event is."
- **Availability gate** — interactive only when `someConnectionHasFreebusy` (any `connection.grantedScopes.some(s => s.includes('calendar.freebusy'))`). On partial grant / no connection: `:disabled="true"` + caption ("Reconnect your calendar and allow availability to use this") in the row's default slot. No queries, no errors.

### B. Shared client accessor (small DRY refactor of #32)

`getClient()` / `setCalendarClientForTesting()` and the module-private `clientImpl` currently live in `calendarSyncStore.ts`. Extract into `src/services/calendar/clientInstance.ts`:

```ts
let clientImpl: CalendarClient | null = null;
export function getCalendarClient(): CalendarClient {
  if (!clientImpl) clientImpl = createGoogleCalendarClient(createGoogleTokenProvider());
  return clientImpl;
}
export function setCalendarClientForTesting(c: CalendarClient | null): void {
  clientImpl = c;
}
/** Drop the singleton on teardown so a new session/family mints a fresh client + token cache. */
export function resetCalendarClient(): void {
  clientImpl = null;
}
```

`calendarSyncStore` imports `getCalendarClient` (replacing local `getClient`) and re-exports `setCalendarClientForTesting` (its existing tests import it from the store). **`calendarSyncStore.stop()`'s current `clientImpl = null` MUST become `resetCalendarClient()`** — otherwise teardown stops resetting the shared client. The clash store uses the same singleton — one client, one token cache across push + free/busy. Keep `clientInstance.ts`'s public surface to exactly these three functions.

### C. Free/busy on the client seam

Extend the `CalendarClient` interface with one read-only method, plus `BusyInterval` in `CalendarClient.ts`:

```ts
export interface BusyInterval { start: string; end: string } // ISO
queryFreeBusy(
  connectionId: string, calendarIds: string[], timeMinIso: string, timeMaxIso: string,
): Promise<Record<string, BusyInterval[]>>; // calendarId → busy intervals
```

Google impl: add `queryFreeBusy` to the object returned by `createGoogleCalendarClient` (shares the closure's `authedFetch`). `POST /freeBusy` with `{ timeMin, timeMax, items: calendarIds.map(id => ({ id })) }`; parse `data.calendars[id].busy`. **`freeBusy` returns HTTP 200 even when an individual calendar fails** — the failure appears in `data.calendars[id].errors`, so the per-calendar `errors` check is the ONLY surfacing path for forbidden/not-found per-calendar; map the Google reason → kind (`notFound`→`not_found`, `accessDenied`/`forbidden`→`forbidden`, else `unknown`) and throw a classified `CalendarApiError`. Transport-level failures (401/403/429/5xx) are still classified by `authedFetch`. The in-memory fake client in tests implements `queryFreeBusy`.

### D. Pure overlap util — `src/utils/calendar/clashDetection.ts` (+ leaf `activityDays.ts`)

Factor only the **day-rolling math** out of `buildStartEnd` into a leaf helper (since `buildStartEnd` returns Google strings, not ms, and stays the canonical mapper):

- `resolveActivityDays(activity): { startYmd; endYmd; allDay; startTime?; endTime? }` — in **`src/utils/calendar/activityDays.ts`** (its own leaf so the shipped sync mapper doesn't depend on new clash code; dependency direction stays `activityToGoogleEvent → activityDays ← clashDetection`). Preserves the exact rules: all-day end exclusive (`addDaysYmd(lastDay, 1)`); timed `endTime` defaults to `startTime`; multi-day honours `endDate`; overnight (no `endDate`, `endTime < startTime`) rolls end to +1 day. `buildStartEnd` is refactored to call it then format into Google `date`/`dateTime`.
- `activityTimeRange(activity, occurrenceDate): { startMs; endMs } | null` — absolute local ms range for a **timed** occurrence (null for all-day). **The day-roll anchors to the occurrence date passed in, not `activity.date`** — `resolveActivityDays` yields the times + roll delta; `activityTimeRange` applies the delta to the occurrence date (overnight recurring → occurrenceDate+1). Test the overnight-recurring case explicitly.
- `intervalsOverlap(aStart, aEnd, bStart, bEnd): boolean` — half-open `[start, end)` on **absolute ms** (`aStart < bEnd && bStart < aEnd`). Google busy times are offset-bearing RFC3339 instants; activity times are local wall-time — convert both via `new Date(iso).getTime()` so the compare is timezone-correct. (`groupOverlapping` in `useCalendarNavigation.ts` is a different domain — minutes-of-day lane-packing — and is NOT refactored to share this.)
- `clashKey(activityId, occurrenceDate): string` — the single source of the `${activityId}:${occurrenceDate}` key, used on both write and read sides; never hand-built at a call site.
- `computeClashes(occurrences, busyByConnection): Map<string, ClashInfo>` — pure; first overlapping connection yields `ClashInfo { connectionId; calendarLabel }`, keyed by `clashKey`.

> The `buildStartEnd` refactor is DRY-only (not required for clash correctness), pinned by a regression-guard test. Fallback if awkward: leave `buildStartEnd` untouched and have `activityDays.ts` own the math with `buildStartEnd` as a thin caller — never duplicate the rules.

### E. Orchestrator: `calendarClashStore` (read-only, separate from sync)

New `src/stores/calendarClashStore.ts` (Pinia). All state **store-scoped** (no module-level mutable state) so a single `stop()` clears everything:

- `busyCache: Map<connectionId, { windowKey; intervals; fetchedAt }>` — ephemeral, in-memory only.
- `clashes = ref<Map<string, ClashInfo>>(new Map())` — **recompute by REPLACING the ref (`clashes.value = next`), never mutating the Map in place** (a mutated Map doesn't trigger Vue reactivity → indicators would silently never appear; this is the key reliability detail, asserted by a test).

Actions/getters:

- `isAvailable` — flag on AND `clashNudgeEnabled` AND `someConnectionHasFreebusy`.
- `ensureBusyForWindow(timeMinIso, timeMaxIso)` — guard on `isAvailable` (early return otherwise). Per freebusy-scoped connection, on cache miss/stale (TTL `CLASH_BUSY_TTL_MS = 5 min`) or `windowKey` change, `queryFreeBusy` for the connection's calendars (v1: `destinationCalendarId || 'primary'`; no extra `listCalendars`). Run connections under the shared `runPooled`. Each query wrapped: failure → classify + `reportError({ surface: 'calendar-clash', severity: 'warning', … })` + treat busy data as absent (no bare catch, no toast). Then reassign `clashes`.
  - **Thrash guard:** the planner `watch` is debounced (~250–400 ms) so rapid prev/next collapse to one query; `ensureBusyForWindow` records the in-flight `windowKey` and short-circuits a same-window re-entry while outstanding; a same-window cache hit within TTL does no network call and no needless reassignment. At most one query per (connection, window) per TTL.
- `clashFor(activityId, occurrenceDate)` — `clashes.value.get(clashKey(...))` (reactive read).
- `start()` (flag-gated; no polling — view-driven). `stop()` clears cache + reassigns `clashes.value = new Map()` + clears the in-flight marker; called from `resetAllAppStores` (flag-gated).

**Window + occurrence derivation (visible grid, not month).** `usePlannerNavigation` exposes only `referenceDate`/`label` (no range helper). Extract the inline month-grid bounds from `CalendarGrid.vue` into a shared `monthGridRange(referenceDate, weekStartDay): { startYmd; endYmd }` (in `src/utils/date.ts` or a planner util), consumed by BOTH `CalendarGrid.vue` and the window derivation. Week view → 7 `weekDays` bounds; day view → that day. Occurrences gathered by iterating the `(year, month)` pairs the range spans via `monthActivities`, filtered to `[startYmd, endYmd]`. One computed in `FamilyPlannerPage.vue` maps `(referenceDate, activeView)` → `{ window ISO, occurrences }`, then a debounced `watch` calls `ensureBusyForWindow`.

### F. Shared bounded-concurrency helper (DRY)

Extract module-private `runPooled` from `calendarSyncStore.ts` verbatim into `src/utils/calendar/runPooled.ts` (each task owns its try/catch; pool never rejects). Both stores import it.

### G. Indicator UI — one read seam

- `src/components/planner/ClashIndicator.vue` — small Heritage-Orange dot/icon + accessible label/tooltip "May clash with {calendar}" (i18n), rem-based. **Purely presentational** — receives a resolved `ClashInfo`/label as a prop; does NOT read the store.
- `src/composables/useClash.ts` — `useClash(activityId, occurrenceDate): ComputedRef<ClashInfo | undefined>` (accept `MaybeRefOrGetter` so cards pass live refs/getters) wrapping `calendarClashStore.clashFor`. The store read + key format + reactivity contract live in ONE place; cards do NOT import the store for this.
- Attach where timed activities render: `ActivityListCard.vue` (primary), `DayTimeline.vue`, `WeeklyCalendarView.vue`, `DailyCalendarView.vue`. Each uses `useClash(activity.id, date)` and mounts `<ClashIndicator>` only when resolved; renders nothing otherwise. `CalendarGrid` month-cell dot: optional, low priority.

### H. Error handling / degradation

- User-facing: free/busy failures NEVER toast (no nudge spam) — by design.
- Developer-facing: every failure classified (`CalendarApiError`) + `reportError({ severity: 'warning' })` (console + Slack), as #32 already does. No bare `catch {}`; every catch re-throws classified or reports. A failing connection's busy data is absent for that window and re-attempted on the next window/TTL change.

## Files Affected

**New**

- `src/services/calendar/clientInstance.ts` — shared client singleton + `resetCalendarClient` (exactly three exports).
- `src/utils/calendar/activityDays.ts` — `resolveActivityDays` (shared day-math leaf util).
- `src/utils/calendar/clashDetection.ts` — `activityTimeRange`, `intervalsOverlap`, `computeClashes`, `clashKey`, types.
- `src/utils/calendar/runPooled.ts` — bounded-concurrency helper (extracted from #32).
- `src/stores/calendarClashStore.ts` — read-only clash orchestrator (state store-scoped).
- `src/composables/useClash.ts` — single read seam.
- `src/components/planner/ClashIndicator.vue` — subtle indicator (props-only).
- Tests: `clashDetection.test.ts`, `activityDays.test.ts`, `calendarClashStore.test.ts`, `googleCalendarClient.freebusy.test.ts`, grid-range helper test.

**Modified**

- `src/services/calendar/CalendarClient.ts` — add `queryFreeBusy` + `BusyInterval`.
- `src/services/calendar/googleCalendarClient.ts` — implement `queryFreeBusy` (closure `authedFetch`); surface per-calendar `errors` as classified `CalendarApiError`.
- `src/stores/calendarSyncStore.ts` — import `getCalendarClient`/`resetCalendarClient` + `runPooled` from the new shared modules (remove local copies); re-export `setCalendarClientForTesting`; `stop()` → `resetCalendarClient()`.
- `src/utils/calendar/activityToGoogleEvent.ts` — `buildStartEnd` calls shared `resolveActivityDays` (DRY; regression-guard test).
- `src/types/models.ts` — add `Settings.calendarClashNudgeEnabled?: boolean`.
- `src/stores/settingsStore.ts` (+ settings repository) — getter (`?? true`) + repo-backed setter following the `persistAiSetting` report-on-failure contract.
- `src/components/settings/CalendarSyncSettings.vue` — toggle row + availability gate + caption.
- `src/components/planner/ActivityListCard.vue`, `DayTimeline.vue`, `WeeklyCalendarView.vue`, `DailyCalendarView.vue` — consume `useClash` + mount `ClashIndicator`.
- `src/pages/FamilyPlannerPage.vue` — derive visible-grid ISO window + occurrence set via shared helper; debounced `watch` → `ensureBusyForWindow`.
- `src/components/planner/CalendarGrid.vue` — consume the extracted `monthGridRange` (pure refactor; one source of truth).
- `src/utils/date.ts` (or planner util) — add `monthGridRange(referenceDate, weekStartDay)`.
- `src/utils/resetStores.ts` — flag-gated `useCalendarClashStore().stop()`.
- `src/config/flagRegistry.ts` + `src/config/featureFlags.committed.ts` — register `calendarClashNudge: false`.
- `src/content/help/security.ts` — append the new article to `SECURITY_ARTICLES` (mirroring `google-calendar-sync`).
- `src/services/translation/uiStrings.ts` (+ `npm run translate`) — all new strings.

## Help Center Coverage

- **Action**: `new article` (append to `SECURITY_ARTICLES` in `src/content/help/security.ts`)
- **Category**: `security` · **Type**: `explainer` · **Slug**: `external-calendar-clash-nudge`
- **Title**: "Clash warnings from your other calendars"
- **Scope**: beanies can gently warn you when a family activity overlaps something on a connected calendar, using only free/busy availability (never the event's details); how to turn it on/off; nothing is written to your calendar or sent to a beanies server.
- **Notes**: state the free/busy-only guarantee plainly; needs a connected calendar with the availability permission; gentle hint, not a blocker; v1 covers timed activities only. Cross-link `google-calendar-sync`.

## Acceptance Criteria

- [ ] Settings toggle in the calendar drawer; default ON; user can disable; persists via the settings repository; a persist failure is reported via `reportError` (not swallowed).
- [ ] No separate consent prompt — scope granted via #32's combined consent.
- [ ] Partial grant (freebusy declined) → feature unavailable, toggle disabled with caption, no queries, no errors.
- [ ] Enabled + a timed activity overlaps a busy block → subtle Heritage-Orange indicator on the planner/activity views, naming the connected calendar, never the event's details.
- [ ] Edge-week activities visible in month view (adjacent-month days) ARE checked — window covers the rendered grid, not just the calendar month.
- [ ] Indicators appear reactively when busy data lands (`clashes` ref reassigned, not mutated) — store test.
- [ ] Rapid planner navigation does not stack queries: ≤1 in-flight per (connection, window); debounced; same-window TTL hits issue no network call.
- [ ] Disabling the toggle (or revoking the scope) removes all indicators and stops all queries.
- [ ] Free/busy failures degrade silently to the USER but are ALWAYS classified + reported (console/Slack) — no bare catches; a per-calendar `errors` entry is surfaced, not dropped.
- [ ] No event details ever read/stored/displayed; busy data never persisted; never sent to a beanies server.
- [ ] Render never blocks on the free/busy round-trip.
- [ ] Engine + cache torn down on sign-out/family-switch (single `stop()`); `calendarSyncStore.stop()` resets the shared client.
- [ ] Cards resolve clashes only through `useClash`; `ClashIndicator` is props-only.
- [ ] Help article appended to `SECURITY_ARTICLES` and matches shipped behavior.
- [ ] Unit tests pass; `npm run validate` green; `npm run translate` clean.

## Testing Plan

1. **Unit — day math + overlap** (`activityDays.test.ts`, `clashDetection.test.ts`): `resolveActivityDays` matches `buildStartEnd`'s prior output (regression guard); half-open boundaries; overnight roll; multi-day endDate; **overnight RECURRING occurrence rolls relative to the occurrence date**; all-day → null; adjacent-not-overlapping → no clash; **cross-UTC-offset busy interval still overlaps (absolute-ms)**; `computeClashes` keys via `clashKey` and picks the right connection/label.
2. **Unit — freebusy client**: POST body shape; parses `calendars[id].busy`; a per-calendar `errors` entry (HTTP 200) throws classified `CalendarApiError`; a 401 re-mints once.
3. **Unit — clash store** (fake client): toggle off → no queries; partial grant → unavailable, no queries; happy path → `clashFor` returns `ClashInfo` AND `clashes` ref reassigned; TTL reuse → no new query; **rapid same-window re-entry while in-flight → single fetch**; throwing `queryFreeBusy` → no clashes, no throw, `reportError` called once; `stop()` clears all in one call.
4. **Unit — grid range helper**: `monthGridRange` matches `CalendarGrid.vue`'s prior inline output (regression guard) across week-start Sun/Mon and a 6-week month.
5. **E2E**: none — fails the three-gate filter (external free/busy round-trip, connected account, copy/owner-dependent). Covered by unit + component tests; logged in `docs/E2E_HEALTH.md`.
6. **Manual (DEV, both flags on)**: overlapping timed activity → indicator naming the calendar; edge month-grid day → also flagged; toggle off → gone, no network; revoke freebusy → unavailable, no errors; offline → no badge/toast but `[calendar-clash]` console warning; spam prev/next → ≤1 query per settled window.

## Review Passes

- **Pass 1 (Initial draft)**: Reuse-first design — shared client accessor + `runPooled` extraction, `queryFreeBusy` on the client seam, pure `clashDetection` util, read-only `calendarClashStore` with ephemeral TTL cache + async view-driven decoration, `ClashIndicator` on timed cards, dev flag + default-ON toggle with partial-grant gating, silent degradation, teardown, help article, unit-test-heavy (no E2E).
- **Pass 2 (DRY + error handling)**: Verified reuse against source. Corrected `groupOverlapping` (not shared), `buildStartEnd` (module-private/strings → factor day-math), help path (flat `security.ts`), settings setter (via repo), `queryFreeBusy` placement (closure `authedFetch`). Added `resetCalendarClient()`; reused `SettingToggleRow` (+ slot caption); reconciled silent-to-user vs always-reported-to-dev with a test that the report fires.
- **Pass 3 (Sustainability)**: Hardened the reactivity contract (replace the `clashes` ref, never mutate — else indicators silently never appear) + test; all clash state store-scoped (single `stop()` teardown); single `useClash` composable + `clashKey` (one read seam, `ClashIndicator` props-only); `resolveActivityDays` to its own leaf `activityDays.ts` (one-way deps); planner window must reuse existing date-range helpers; `buildStartEnd` refactor flagged DRY-only with a non-duplicating fallback.
- **Pass 4 (Fresh-eyes sweep)**: Corrected three grounded errors — (1) settings setter no longer mis-cites `setSyncEnabled`/`setShowPublicHolidays` (those are silent); follows the actual `persistAiSetting` report-on-failure contract; (2) window is the **visible 6-week grid** (+ cross-month week spans), not the calendar month — extract `monthGridRange` from `CalendarGrid.vue` so edge-week activities aren't silently unchecked; (3) added absolute-ms (offset-aware) timezone contract for `intervalsOverlap` + an overnight-recurring occurrence day-roll rule, both tested. Added a watch-debounce + in-flight/window-key thrash guard; clarified `freeBusy` returns HTTP 200 with per-calendar `errors`.

## Prompt Log

> No GitHub issue created — direct implementation. Full intake captured in Notion #34 (`beanies-plan prompt`).

- **Pre-plan intake (Notion #34)** — assembled `=== BEANIES PRE-PLAN ===` block; resolved decisions: name the clashing calendar; ephemeral in-memory cache. Carried to planning: confirm freebusy client-side feasibility (resolved here); exact indicator design + copy (design pass).
- **/beanies-plan** → "build the plan"
