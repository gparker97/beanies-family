# Plan: Google Calendar Integration — Code-Review Fixes (#32)

> Date: 2026-06-10
> Related issues: None — direct implementation. Parent feature: Notion #32 (Google Calendar integration). These are the fixes from the high-effort `/code-review` of the feature branch (commits 7ad5786f → 2a6130a9).
> Plan file: `docs/plans/2026-06-10-google-calendar-review-fixes.md`
>
> **No GitHub issue created.** Direct implementation; full prompt history embedded under **Prompt Log**.

## User Story

As a beanies family using the (flag-gated) Google Calendar sync, I want the sync to be correct, quiet, and self-consistent — no runaway write loops, no ghost recurring events, no stale names, no false "reconnect" prompts, no orphaned events — so that when the feature leaves the flag it behaves reliably and doesn't burn battery, quota, or trust.

## Context

A high-effort code review of the Google Calendar integration (all behind the prod-off `googleCalendarSync` flag) surfaced ten findings plus cleanup. The feature works end-to-end (events sync), but several issues must be fixed before it leaves the flag — most importantly a self-perpetuating reconcile/write loop, and four user-visible correctness bugs (ghost RRULEs, stale member names, false reconnect prompts, broken overnight/multi-day events). This plan fixes all of them in three commits (correctness → polish → cleanup).

The findings, by ID (used throughout this plan):

- **F1 [critical]** Self-perpetuating ~3s reconcile/write loop — the edit watch keys on the global `docVersion`, and `settleConnectionStatus` writes the connection record on every reconcile (even no-ops), so each reconcile bumps `docVersion` → re-fires the watch → reconciles again, forever (+ cross-device write ping-pong; + unrelated mutations trigger full reconciles).
- **F2 [high]** Recurring → non-recurring leaves a ghost RRULE — the patch omits `recurrence`, so Google retains the old rule.
- **F3 [high]** Member rename never re-syncs event descriptions — descriptions embed resolved member names, but `computePushHash` hashes only member ids.
- **F4 [high]** A single transient 401 parks the whole connection `needs_reconnect` and drops the success write.
- **F5 [med-high]** Timed overnight/multi-day events break — `buildStartEnd` ignores `endDate` and uses the same day for start+end → `end < start` (Google 400) for overnight; multi-day collapses.
- **F6 [med]** `setDestinationCalendar` removes links even when the old-calendar delete fails → orphaned, untrackable events.
- **F7 [med]** No teardown — `stop()` is never called and the store isn't in `resetAllAppStores`, so the engine (and F1's loop) survive sign-out / family-switch.
- **F8 [med]** `todayYmd()` uses UTC (`toISOString`) not local → push-window edges off by a day near midnight west of UTC.
- **F9 [low-med]** Hardcoded English "Primary calendar" fallback bypasses i18n.
- **F10 [low-med]** Diagnostic `console.warn` is unconditional (not dev-gated) and logs the connected account email.
- **Cleanup** Dead `targetActivityIds` param on `planReconcile`; unused `CALENDAR_SYNC_ERRORS.messageKey` + 7 `calendarSync.error.*` i18n keys (×2 langs); write-only `consecutiveFailures` CRDT field; duplicated `addDaysYmd`/`parseYmd`; `buildMapContext` reaching into the raw doc instead of the family store.

## Requirements

1. **F1** Eliminate the self-perpetuating loop and the unrelated-mutation triggers. The reconcile engine must wake only on genuine activity changes (and the poll/manual/connect paths), and its own connection-record writes must not re-trigger it.
2. **F2** Editing a recurring activity to non-recurring (or changing its recurrence) must clear/replace the RRULE on the Google event.
3. **F3** Renaming a family member must re-sync the descriptions of the activities that reference that member (and only those).
4. **F4** A transient per-request 401 must not park a connection; only a genuine, repeated auth failure (refresh-token `invalid_grant`) may flip it to `needs_reconnect`. Events that synced must still record success.
5. **F5** Timed activities must produce a valid Google start/end for overnight (end rolls to the next day) and multi-day (honors `endDate`) cases.
6. **F6** Changing the destination calendar must be all-or-nothing: if the old-calendar cleanup fails, the destination stays unchanged and the failure is surfaced — never leave orphaned events.
7. **F7** Sign-out / family-switch must stop the engine and reset its module-level state; a fresh session re-starts cleanly.
8. **F8** The push window must use the user's local date.
9. **F9** The destination-picker fallback label must be localized.
10. **F10** The reconcile diagnostic must be dev-only and must not log PII (account email).
11. **Cleanup** Remove dead/unused code (the items listed in Context) without changing behavior.
12. All changes covered by unit tests; `npm run validate` green; everything stays behind the prod-off flag.

## Important Notes & Caveats

- **F1 is the lynchpin.** Narrowing the edit trigger from the global `docVersion` to an activity-scoped signal is what actually breaks the loop: the reconcile's writes touch `calendarConnections`, not `activities`, so once the watch is activity-scoped, those writes can no longer re-trigger it (and the cross-device ping-pong dies too). The optional churn-reduction in `settleConnectionStatus` is secondary.
- **F2 edge (documented limitation, not chased):** sending `recurrence: []` clears the rule on a patch, but converting a recurring master that already has per-occurrence exceptions to a single event may leave orphaned exceptions in Google. This is rare; note it as a v1 limitation rather than building exception-GC now.
- **F3 precision:** fold the _resolved names of the activity's own people_ (assignees + pickup + dropoff) into the hash, not a global members signature — so a rename re-pushes only the affected activities, not all of them.
- **F4:** the per-request 401 fix is a re-mint-and-retry-once inside the calendar client's `authedFetch`. Genuine `invalid_grant` still surfaces from the `TokenProvider` (refresh failure) and still parks after the K-threshold — that path is unchanged.
- **F6 UX:** `setDestinationCalendar` must report success/failure so the Settings drawer can toast on failure (it currently returns `void`).
- **Do NOT change** the deterministic-event-id scheme, the shared-token-in-`.beanpod` model, the `status: 'confirmed'` resurrect path, or the flag gating — those are settled and working.
- All work stays **prod-off** (`googleCalendarSync` committed `false`); no CHANGELOG entry, no deploy.

## Assumptions

> Review before implementation (valid 2026-06-10).

1. `useActivityStore().activities` is a reactive ref that is reassigned on every create/update/delete (so a shallow `watch` on it fires on activity changes only). Verified pattern in `activityStore.ts`.
2. `toDateInputValue(new Date())` returns the **local** `YYYY-MM-DD` (used by the planner already). `toISODateString` returns UTC (`toISOString()`) — confirmed.
3. A member-name resolver exists in the family layer (`useMemberInfo`/`useFamilyStore`) callable from within a Pinia store action; if not cleanly callable, keep the current raw-doc read but extract it to a shared helper.
4. `resetAllAppStores()` (`src/utils/resetStores.ts`) is the sign-out / family-switch reset entry point and is an acceptable place to call `calendarSyncStore.stop()`.
5. Google Calendar `patch` with `recurrence: []` clears an existing RRULE, and the `events` API accepts an all-day vs timed end rolled to the next day.
6. `CALENDAR_SYNC_ERRORS.messageKey` is unused anywhere (the Settings status uses separate `calendarSync.status.*` keys) — safe to remove with its i18n keys.

## Approach

Grouped by where the change lands. Three commits: **(1) correctness F1–F8**, **(2) polish F9–F10**, **(3) cleanup**.

### Commit 1 — Correctness

**F1 — `src/stores/calendarSyncStore.ts` (trigger + write churn).**

- Replace the edit watch `watch(() => (isDocLoaded() ? docVersion.value : 0), …)` with a watch on the **activity store's list**: `const activityStore = useActivityStore(); watch(() => activityStore.activities, () => { debounce → reconcileAll({ verifyExisting: false }) }, { deep: false })`. (Shallow — the array ref is reassigned on mutation.) This stops both the self-loop and the unrelated-mutation triggers.
- Secondary (churn reduction): in `settleConnectionStatus`, on the clean-success branch, only write when something would actually change — pass a `changed: boolean` (any upsert applied / any delete) into settle; if `!changed && connection.status === 'ok'`, only refresh `lastReconciledAt` when it's older than `FRESHNESS_WINDOW_MS` (so the periodic poll doesn't write every 5 min for nothing). Keep the freshness-claim semantics intact.

**F2 — `src/utils/calendar/activityToGoogleEvent.ts` (clear RRULE).**

- `buildRecurrenceRule` returns `[]` (not `null`) for `'none'`; `GoogleEventResource.recurrence` becomes a required `string[]`; the mapper always sets `resource.recurrence`. An empty array on patch clears a stale rule; on insert it's a no-op.

**F3 — `src/utils/calendar/{activityToGoogleEvent,reconcilePlan}.ts` (hash includes names).**

- `computePushHash(activity, memberName?: (id) => string | undefined)` — when the resolver is provided, include the resolved names of `normalizeAssignees(activity)` + `pickupMemberId` + `dropoffMemberId` in the hashed payload.
- `planReconcile(activities, links, todayYmd, memberName)` threads the resolver through to `computePushHash`. `reconcileConnection` already builds `ctx.memberName` — pass it in. (This is also where the dead `targetActivityIds` param is removed — see Cleanup.)

**F4 — `src/services/calendar/googleCalendarClient.ts` (401 re-mint).**

- In `createAuthedFetch`, on a `401` response: `tokenProvider.invalidate(connectionId)` and **retry once** with a freshly minted token (distinct from the 429/5xx backoff loop). Only if the retry also returns `401` throw `CalendarApiError('auth')`. This absorbs a transient expired-access-token mid-batch.
- No change to the K-threshold parking — genuine `invalid_grant` still comes from the `TokenProvider` refresh path.

**F5 — `src/utils/calendar/activityToGoogleEvent.ts` (`buildStartEnd` timed branch).**

- `endYmd = activity.endDate?.slice(0,10) ?? startYmd`. If no explicit `endDate` and `endTime <= startTime` (overnight), `endYmd = addDaysYmd(startYmd, 1)`. Build `end.dateTime` from `endYmd` + `endTime`.

**F6 — `src/stores/calendarSyncStore.ts` (`setDestinationCalendar` atomic).**

- Delete all old-calendar events first; track `allCleared` (a delete that throws → `false`; `deleteEvent` already swallows 404). If `!allCleared`, **abort**: leave `destinationCalendarId` unchanged, return `{ ok: false }`. Only on `allCleared` drop the links, update `destinationCalendarId`, and reconcile. Change the return type to a result the UI can toast on; update `CalendarSyncSettings.vue`'s `onPickCalendar` to surface a failure toast and revert the select.

**F7 — `src/stores/calendarSyncStore.ts` + sign-out path (teardown).**

- `stop()` additionally resets module-level engine state: `clientImpl = null; invalidGrantCounters.clear();` (via a small `resetEngineState()` the store calls). Keep `started = false`.
- Call `useCalendarSyncStore().stop()` from `resetAllAppStores()` (or the sign-out action that already calls `clearGoogleSessionState`). `start()` re-registers on the next `loadFamilyData`.

**F8 — `src/stores/calendarSyncStore.ts` (`todayYmd`).**

- `todayYmd = () => toDateInputValue(new Date())` (local). Leave `nowIso()` (UTC) for timestamps.

### Commit 2 — Polish

**F9 — i18n fallback.** Add `calendarSync.primaryCalendar` (`uiStrings.ts`, en+beanie; run `npm run translate`). The store's fallback returns `summary: ''`; `CalendarSyncSettings.vue` renders `label: cal.summary || t('calendarSync.primaryCalendar')`.

**F10 — diagnostic.** Gate the reconcile log behind `import.meta.env.DEV` and drop `accountEmail` (log `connectionId` + counts via `console.debug`).

### Commit 3 — Cleanup (no behavior change)

- Remove the dead `targetActivityIds` param + its two filter branches from `planReconcile` (subsumed by F3's signature change).
- Reduce `CALENDAR_SYNC_ERRORS` to `Record<CalendarErrorKind, 'warning' | 'error'>` (drop the unused `messageKey`); delete the 7 `calendarSync.error.*` keys from `uiStrings.ts` + their `zh.json` entries.
- Remove the write-only `consecutiveFailures` field from `CalendarConnection` (models.ts) and all its write sites (parking uses the device-local `invalidGrantCounters`).
- Extract a single `addDaysYmd(ymd, n)` into `src/utils/date.ts` (compose `parseLocalDate` + `addDays` + `toDateInputValue`); replace the 2 copies in `reconcilePlan.ts`/`activityToGoogleEvent.ts` and `parseYmd` in `recurrenceRrule.ts`.
- Switch `buildMapContext`'s member-name resolution to the family store's resolver (`useMemberInfo`/`useFamilyStore`) if cleanly callable from the store; else leave but document.

## Files Affected

**Modified**

- `src/stores/calendarSyncStore.ts` — F1 (trigger + settle churn), F4 wiring, F6 (atomic destination), F7 (stop/reset), F8 (local date), F10 (diagnostic), cleanup (consecutiveFailures, registry, buildMapContext)
- `src/utils/calendar/activityToGoogleEvent.ts` — F2 (recurrence), F3 (hash), F5 (timed end)
- `src/utils/calendar/reconcilePlan.ts` — F3 (resolver thread), cleanup (drop targetActivityIds)
- `src/utils/calendar/recurrenceRrule.ts` — F2 ([] for none), cleanup (parseYmd → shared)
- `src/services/calendar/googleCalendarClient.ts` — F4 (401 re-mint)
- `src/components/settings/CalendarSyncSettings.vue` — F6 (toast on failed switch), F9 (localized fallback)
- `src/utils/date.ts` — cleanup (shared `addDaysYmd`)
- `src/types/models.ts` — cleanup (drop `consecutiveFailures`)
- `src/services/translation/uiStrings.ts` — F9 (+ primaryCalendar), cleanup (− 7 error keys); `public/translations/zh.json` regenerated via `npm run translate`
- `src/utils/resetStores.ts` (or the sign-out action) — F7 (`stop()` call)
- Test files alongside each (`reconcilePlan.test.ts`, `calendarMapping.test.ts`, `calendarSyncStore.test.ts`)

## Acceptance Criteria

- [ ] F1: a non-activity CRDT mutation does NOT trigger a reconcile; a no-op reconcile does not re-trigger itself (no 3s loop); cross-device write ping-pong gone.
- [ ] F2: a recurring activity edited to `recurrence: 'none'` produces `recurrence: []` and clears the Google RRULE.
- [ ] F3: renaming a referenced member changes that activity's push hash (re-syncs its description); an unrelated activity's hash is unchanged.
- [ ] F4: a single 401 mid-batch re-mints and succeeds — connection stays `ok`, counter not incremented; only repeated genuine auth failure parks it.
- [ ] F5: overnight timed activity → end on the next day; multi-day timed → end honors `endDate`; no `end < start`.
- [ ] F6: a failed old-calendar delete leaves `destinationCalendarId` unchanged and surfaces a failure toast; no orphaned events.
- [ ] F7: sign-out / family-switch stops the engine and clears `clientImpl` + `invalidGrantCounters`; a new session re-starts cleanly.
- [ ] F8: the push window uses the local date.
- [ ] F9: the picker fallback label is localized (no raw English in zh/beanie).
- [ ] F10: the diagnostic is dev-only and logs no account email.
- [ ] Cleanup: dead `targetActivityIds`, unused `messageKey` + 7 error keys, write-only `consecutiveFailures`, duplicated date math removed; behavior unchanged.
- [ ] `npm run validate` green; all calendar unit tests pass; feature stays behind the prod-off flag.

## Testing Plan

1. **Unit (reconcilePlan/mapping):** recurrence→`none` → `recurrence: []`; member-rename → hash changes for referencing activity only; overnight/multi-day timed start/end; `addDaysYmd` parity.
2. **Unit (engine, fake client):** no-op reconcile writes nothing that re-triggers; a non-activity doc mutation triggers no reconcile; 401-once-then-200 stays `ok`; failed-delete destination-change aborts + returns failure; `stop()` clears engine state.
3. **Full suite + `npm run validate`** (type-check, lint, format, test, build).
4. **Manual (DEV, flag on):** connect a calendar; confirm no perpetual console/network activity at idle (F1); edit a recurring activity to one-off → Google event stops recurring (F2); rename a member → its events' descriptions update (F3); add an overnight activity → valid event (F5); switch destination calendar with a forced failure → stays put + toast (F6); sign out → engine quiet (F7).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted fixes for all 10 review findings + cleanup, grouped into correctness / polish / cleanup commits, with the F1 trigger-narrowing as the lynchpin and per-finding designs, tests, and acceptance criteria.
- **Pass 2 (DRY + error handling)**: `changed` must reflect actual Google writes (not `plan.upserts.length`); reuse `useMemberInfo().getMemberById` (drop the raw-doc resolver + hedge); pin F4 to a one-shot retry guard; F6 must `reportError` + keep links on failed delete + UI toast/revert; reuse existing `localToday()`; `parseYmd`→`parseLocalDate`.
- **Pass 3 (Sustainability)**: Keep `changed`/resolver engine-side & single-path; memoize the resolver per-reconcile (avoid O(N·M) `find`); write down the F4 (second-401 parks via K-threshold) and F6 (destination + all links stay; resurrection self-heals, reusing the `allCleared` pattern) invariants; `consecutiveFailures` removal needs no migration but all 4 writes go with the type; preserve recurrenceRrule fail-loud; remove dead `targetActivityIds` in Commit 1; confirm `familyStore.members` is the full member set.
- **Pass 4 (Fresh-eyes sweep)**: Sound. Two precisions — F4: `invalidate` already exists on the 401 path, add only the re-mint retry; F6: do NOT copy `finishDisconnect`'s eager per-task link removal (keep ALL links on abort). Added test: deleted-OK links still present after an aborted switch. No `{flush}` needed; F2 `[]` doesn't interact with all-day/timed; F10 keeps the dev signal.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (/code-review high → findings) then /beanies-plan

> Agree, let's fix all the issues together. Please put together the full scope of the issues and prepare a plan to fix

(Context: the ten findings + cleanup are from the high-effort `/code-review` of the Google Calendar feature branch; the agreed fix design is captured in this plan's Approach.)

</details>
