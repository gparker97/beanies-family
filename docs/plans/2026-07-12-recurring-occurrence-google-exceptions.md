# Plan: Sync per-occurrence recurring-activity changes to Google Calendar (reschedule / edit-one / delete-one)

> Date: 2026-07-12
> Related issues: None — direct implementation (no GitHub issue, per intake)
> Plan file: `docs/plans/2026-07-12-recurring-occurrence-google-exceptions.md`

## User Story

As a beanies.family user with a connected Google Calendar, when I change a single occurrence of a recurring activity — reschedule it, edit just that session, or delete just that session — I want that change reflected on my Google Calendar, so that the calendar I actually live by matches what I set in beanies and never shows a stale or wrong instance.

## Context

beanies syncs each recurring activity to Google as **one native recurring event** (a master with an RRULE, keyed `deterministicEventId(activity.id)`; `activityToGoogleEvent.ts` + `recurrenceRrule.ts`). Google expands the RRULE into all its instances.

When a user modifies a single occurrence in beanies, the app creates a one-off **override child** activity (`materializeOverride`, `activityStore.ts:520`) with `parentActivityId` set and `recurrence:'none'`. In-app, the child renders at its date and the master's original occurrence is suppressed (`overridesByParent`, `activityStore.ts:51-64`). **This in-app behaviour is correct and out of scope.**

The Google projection diverges because `reconcilePlan.isPushable()` (`reconcilePlan.ts:67-73`) hard-drops any activity with `parentActivityId !== undefined`. So override children are **never pushed**, the master RRULE is **never touched**, and Google keeps generating the untouched instance. Result (confirmed in code, reschedule case observed on live prod 2026-07-12):

1. **Reschedule one** → Google keeps the original time; the new time never appears.
2. **Edit "this occurrence only"** → Google shows the un-edited version.
3. **Delete "this occurrence only"** → the deleted occurrence **stays** on Google.

This is documented as a deliberate "v1 follow-up" (`reconcilePlan.ts:60-66`). The comment header in `activityToGoogleEvent.ts:3` claims Layer 5 "handles recurring-override exceptions using the parent link" — currently premature (not yet true); this work makes it accurate. Reconcile both comments to the shipped behaviour.

The fix: teach the reconcile to emit **Google recurring-event exceptions** — patch, move, or cancel the specific instance of the master series — and to restore it when the override is removed.

## Requirements

1. When an **active override child** (edit-one or reschedule) exists for a synced recurring master, patch the master's Google **instance** for that occurrence: move its start/end (reschedule) and/or update its fields (edit-one), so Google shows exactly the override's values at exactly one instance.
2. When a **delete-one override** exists (`isActive:false` child), **cancel** the master's Google instance for that occurrence (`status:'cancelled'`), so the deleted session disappears from Google while every other instance stays.
3. When an override is **deleted / reverted** in beanies (the child activity is hard-removed), **restore** the master's Google instance for that occurrence to the master's generated values (un-cancel / move back), so Google matches the now-restored in-app state.
4. **No duplicate instance.** An override must never produce a _second_ top-level Google event alongside the master's generated instance. Override children must NOT flow through the ordinary master-upsert path.
5. **Idempotent + convergent.** Re-running the reconcile with no change performs no Google writes for exceptions. Data that already diverged before this fix (existing overrides with no exception yet pushed; overrides deleted before the fix) converges to the correct Google state on the next reconcile, without manual intervention and without duplicating instances.
6. **Ordering.** A master event must exist on Google before any of its instance exceptions are applied. Master upserts complete before exception ops run.
7. **No silent failures.** Every Google API call and every derivation is classified through the existing `CalendarApiError` → `record()` → `settleConnectionStatus` pipeline (toast/Slack), with the explicit taxonomy in Approach §3. A per-override failure never aborts the whole reconcile; benign "nothing to do" cases (master not yet on Google, no matching instance) breadcrumb at debug and skip — they never page.
8. Update the `activityToGoogleEvent.ts:3` comment (currently premature-true) and the `reconcilePlan.ts:60-66` "v1 follow-up" note to describe the now-implemented behaviour.

## Important Notes & Caveats

- **Instance addressing — discover once via Google, then patch by the STORED id.** A Google instance id is `{masterEventId}_{compactUTCStart}` (timed) or `{masterEventId}_{YYYYMMDD}` (all-day). Computing the compact **UTC** start ourselves is DST-fragile, so we never derive it. The **first** time we except an occurrence (no exception link yet) we discover the id from Google (`GET /events/{masterEventId}/instances`, see §1) and **store it in the link (`googleEventId`)**. **Every subsequent op on that occurrence — re-modify, mode change, verify, and especially restore — patches by the stored id and does NOT call `listInstances`.** This is not just an optimisation: `instances?timeMin/timeMax` windows by the instance's **current** start, so a _rescheduled_ (moved) instance would fall outside a window around its original date and never be found again — restore and re-modify must use the stored, stable id (the instance id is keyed on the immovable `originalStartTime`). Steady-state Phase-B cost is therefore ~0 GETs.
- **`patchEvent` can't express a cancel at the type level — add one honest seam.** `patchEvent` takes a full `GoogleEventResource` whose `status` is the literal `'confirmed'` (`activityToGoogleEvent.ts:26`), so `{status:'cancelled'}` won't type-check and must not be cast. Add a single `patchEventFields(connectionId, calendarId, eventId, patch: GoogleEventPatch)` to the interface + Google impl + test fake, where `GoogleEventPatch = Partial<Omit<GoogleEventResource,'status'>> & { status?: 'confirmed' | 'cancelled' }`. Its wire impl is the same two lines as `patchEvent` (`PATCH` + `JSON.stringify`, `googleCalendarClient.ts:313-318`) — genuinely reused on the wire; only the type surface is new. Cancel + restore route through it; modify sends a full `confirmed` body and can keep `patchEvent` (or also use `patchEventFields` for uniformity).
- **Matching an instance is pure string comparison — no timezone math.** `matchInstanceForDate(instances, occurrenceYmd)` (no tz param) matches on the **date slice** of `originalStartTime`: `originalStartTime.date` (all-day) or `originalStartTime.dateTime.slice(0,10)` (timed — the offset-bearing string already carries the correct wall date). Match on `originalStartTime` (anchored, never moves), NOT `start` (which moves on a reschedule). Do NOT route through `eventItemToMs` (`googleCalendarClient.ts:66-78`) — it collapses to absolute ms with tz math and reintroduces the DST sensitivity we are avoiding. The `listInstances` window is padded (`timeMin = occurrenceYmd−1d`, `timeMax = occurrenceYmd+2d`) so an exact local-midnight→UTC conversion is never needed; the pure matcher picks the right instance.
- **Restore must not depend on the child record** (it's gone). The exception link stores the master activity id (`exceptionOf`), the occurrence date (`exceptionOriginalYmd`), and the discovered instance id (`googleEventId`) — enough to rebuild + address the instance without the child.
- **`originalOccurrenceDate` is only set on reschedules.** For edit-one and delete-one the child's own `date` equals the occurrence date. One shared leaf helper `overrideOccurrenceYmd(child) = child.originalOccurrenceDate ?? child.date` — the exact fallback `overridesByParent` uses (`activityStore.ts:60`) — is extracted and referenced by both the store computed and the reconcile plan (DRY; util depends only on `models`).
- **Body vs address split.** The exception body for a modify uses the OVERRIDE child's fields (its overridden start/end/title). The instance is addressed by the stored id (discovered from the ORIGINAL occurrence date against the master). Never read the master's times to build a modify body; never read the child's fields to address the instance.
- **Only except when the master is genuinely synced.** If the parent isn't in the pushable set (inactive, out-of-window), there is no master instance — skip + debug breadcrumb; never create an orphan top-level event.
- **Reverting is a PATCH back, not a "delete the exception."** Google keeps a modified instance once patched; restore sets `{status:'confirmed', …master-generated body}`, functionally identical to an untouched instance.
- **Do NOT change in-app override behaviour** (`materializeOverride`, `overridesByParent`, the planner flows). This plan changes only the Google projection.
- **Bounded work + retry.** Phase B runs under the same `runPooled(MAX_INFLIGHT=5)` and the same `rate_limited`/`transient` backoff the existing path uses (inside the existing connection lock).

## Assumptions

> Review before implementation — valid at planning time, may have moved.

1. `patchEventFields`/`patchEvent` on a Google **instance id** (`PATCH /events/{instanceId}`) works to move (`start`/`end`), edit fields, cancel (`status:'cancelled'`), and un-cancel (`status:'confirmed'`). **Critical verify:** the modify path sends the _full_ `activityToGoogleEvent(child)` body, which always includes `recurrence: []` — confirm Google does **not** 400 on a PATCH carrying an (empty) `recurrence` array against a single instance id. Verify against a live recurring event before ship.
2. `GET /events/{masterEventId}/instances?timeMin&timeMax` returns each instance with a stable `id` and an `originalStartTime` (`{date}` or `{dateTime}` with offset). **Verify** the `originalStartTime` field shape. Note: discovery always runs while the instance is still `confirmed` (before we cancel/move it, and we never re-discover — the id is stored), so `showDeleted=true` is harmless belt-and-suspenders, **not** load-bearing — no correctness depends on cancelled instances appearing in this list.
3. A recurring beanies activity produces **at most one occurrence per calendar day**, so the padded window + date-slice matcher yields exactly one instance.
4. The master's Google event id is deterministic (`deterministicEventId(masterId)`), so discovery can address the master without storing its event id separately.
5. `settleConnectionStatus` + the existing `CalendarApiError` kinds model every failure we need; no new error kind is required.
6. The reconcile cadence (5-min poll + edit-debounce) makes "converge on next reconcile" acceptable latency for pre-existing diverged data.

## Approach

**Strategy chosen: native Google recurring-event instance exceptions, id discovered once from Google's instance list then stored + reused (NOT client-side UTC id derivation, NOT re-windowed lookups).** Rejected alternative — EXDATE-on-master + a standalone event — because it mutates the master's RRULE on every override (master hash churn, re-push storms), diverges from the one-event-per-activity model, needs bespoke EXDATE add/remove + separate-event lifecycle, and complicates convergence. Native instance exceptions keep the master event stable, match the model the read side already understands (`recurringEventId`), and address each exception by the immovable instance id Google computes.

### 1. Client: one read (`listInstances`) + one patch seam (`patchEventFields`)

Add to `CalendarClient` (`CalendarClient.ts`) + the Google impl (`googleCalendarClient.ts`) + the test fake:

- **`listInstances(connectionId, calendarId, masterEventId, timeMinIso, timeMaxIso): Promise<CalendarInstance[]>`** — `GET /calendars/{cal}/events/{enc(masterEventId)}/instances` with `timeMin`, `timeMax`, `showDeleted=true`, `maxResults`, and a `fields` mask `items(id,status,start,end,originalStartTime)`; page via `nextPageToken` under the existing `MAX_EVENT_PAGES` cap; reuse `authedFetch` verbatim (same auth/retry/timeout/classification). `CalendarInstance = { id; status?; start?; end?; originalStartTime? }` reusing the existing `GoogleEventTimeItem` field shapes. A `not_found` from this endpoint = the master isn't on Google yet (caller treats as benign-skip).
- **`patchEventFields(connectionId, calendarId, eventId, patch: GoogleEventPatch)`** — same wire body as `patchEvent` (`PATCH /events/{enc(eventId)}` + `JSON.stringify(patch)`); `GoogleEventPatch = Partial<Omit<GoogleEventResource,'status'>> & { status?: 'confirmed' | 'cancelled' }`. Used for cancel + restore; modify may use it or `patchEvent`.
- **`matchInstanceForDate(instances, occurrenceYmd): CalendarInstance | null`** — **new pure helper** (`src/utils/calendar/matchInstanceForDate.ts`), no tz param; matches the date slice of `originalStartTime` (§ Caveats). Unit-tested: timed-with-offset, all-day, DST-boundary day, moved instance present (matched by `originalStartTime`, not moved `start`), cancelled instance present, no match → null.

### 2. Occurrence-date + exception classification (pure, `reconcilePlan.ts`)

- Extract `overrideOccurrenceYmd(child)` (shared leaf util; referenced by both `overridesByParent` and the plan).
- **`isPushable` unchanged** (masters + true one-off activities only; override children still excluded from the master-upsert path — Requirement 4).
- **Partition links once at the top of `planReconcile`:** `masterLinks = links.filter(l => !l.exceptionOf)` feed the existing `upserts`/`deletes` logic unchanged; `exceptionLinks = links.filter(l => l.exceptionOf)` feed the new exception plan. **This partition is mandatory and verified-required:** `deletes = masterLinks.filter(l => !pushableIds.has(l.activityId))` — without excluding exception links, every exception link would be misclassified as a stray master link and hit `deleteEvent(instanceId)` + link removal, silently deleting the instance and losing the exception.
- `planReconcile` now returns `{ upserts, deletes, exceptionUpserts, exceptionRestores }`:
  - `mastersById` = the pushable set indexed by id.
  - `exceptionUpserts`: for every override **child** whose parent ∈ `mastersById`, emit `{ child, master, occurrenceYmd, hash, existingHash, existingInstanceId, mode: child.isActive ? 'modify' : 'cancel' }`. `hash = computeExceptionHash(child, master, memberName)`; `existingHash`/`existingInstanceId` from the child's exception link (`lastPushedHash`/`googleEventId`).
  - `exceptionRestores`: for every `exceptionLink` whose child activity id is absent from `activities` (or whose master left `mastersById`) → `{ link }` (carries `exceptionOf` + `exceptionOriginalYmd` + `googleEventId`).
  - A child whose parent is NOT pushable → neither list; skipped with a debug breadcrumb.
  - **Invariant guard:** `materializeOverride` always sets `recurrence:'none'` on the child (`activityStore.ts:545`), so `activityToGoogleEvent(child)` yields `recurrence:[]`. Defensively, a child with `recurrence !== 'none'` is treated as **malformed** — `console.warn` + skip (never stamp an RRULE onto an instance, which would corrupt the master series). This makes the invariant self-enforcing rather than assumed.

### 3. Reconcile orchestration — Phase B inside the existing lock (`calendarSyncStore.ts`)

`applyExceptionUpsert` / `applyExceptionRestore` are **module-level pure-ish functions** taking explicit params (`client`, `connectionId`, `calendarId`, `ctx`, the entry/link, plus the `recordLink`/`removeCalendarEventLinkById` callables) — exactly the shape of the existing module-level `applyUpsert` (`:284`). They each **return a `boolean` (did-write)**. The `record`/`errors`/`changed`/`authAborted` sharing lives only in the **thin per-task wrapper** inside the `withConnectionLock` callback (`:373-390`, `if (await applyExceptionUpsert(...)) changed = true`) — Phase B is one more task batch in the same lock, feeding the single `settleConnectionStatus` (`:400`). This keeps `reconcileConnection` from ballooning and makes both apply functions directly unit-testable.

- **Phase A (unchanged):** `runPooled([...upsertTasks, ...deleteTasks], MAX_INFLIGHT, () => authAborted)` — guarantees masters exist.
- **Phase B (new), after Phase A's `runPooled` resolves and before `settleConnectionStatus`:** build `exceptionTasks` with the **same** per-task `try/catch → record(e)` + `if (didWrite) changed = true` wrapper as Phase A; `runPooled(exceptionTasks, MAX_INFLIGHT, () => authAborted)`.
  - **`applyExceptionUpsert(entry, …)`** → boolean. **No-op (return false) if `existingHash === hash`** — and, unlike masters, exceptions do **NOT** re-assert on a verify pass (v1: they self-heal on the next real override change; consistent with the "converge on next reconcile" latency of Assumption 6, and avoids re-patching every exception on every connect/manual-sync). Else:
    1. `instanceId = entry.existingInstanceId`. If undefined (first time): `masterEventId = deterministicEventId(master.id)`; `inst = matchInstanceForDate(await client.listInstances(connId, calId, masterEventId, paddedWindow(occurrenceYmd)), occurrenceYmd)`; if `inst` is null → **debug breadcrumb + return false** (converge next reconcile); else `instanceId = inst.id`.
    2. `mode==='cancel'` → `client.patchEventFields(connId, calId, instanceId, { status:'cancelled' })`. `mode==='modify'` → `client.patchEvent(connId, calId, instanceId, activityToGoogleEvent(child, ctx))` (child is `recurrence:'none'` → body has `recurrence:[]`, so it stays an instance).
    3. `recordLink(connId, child.id, instanceId, hash, { exceptionOf: master.id, exceptionOriginalYmd: occurrenceYmd })` (generalized `recordLink`, see §4); return true.
  - **`applyExceptionRestore({ link }, mastersById, …)`** → boolean. The child is gone. **Gate on the master still being pushable first:** `if (!mastersById.has(link.exceptionOf)) { await removeCalendarEventLinkById(connId, link.activityId); return true; }` — an out-of-window-but-active (or inactive/deleted) master is having its whole series deleted by Phase A, so we must NOT patch an instance of a just-deleted master; just drop the exception link. Only when the master is still synced:
    1. `master = mastersById.get(link.exceptionOf)`.
    2. `client.patchEventFields(connId, calId, link.googleEventId, { ...masterOccurrenceBody(master, link.exceptionOriginalYmd, ctx), status:'confirmed' })` — patches the **stored** instance id (works whether it was cancelled or moved; no `listInstances`).
    3. `removeCalendarEventLinkById(connId, link.activityId)`; return true.
  - **Failure taxonomy (each derivation classified — Requirement 7):**
    - `listInstances` throws `not_found` (master not on Google yet), **or** `patchEventFields`/`patchEvent` throws `not_found` on a cancel/restore (instance or master already gone) → `console.debug` breadcrumb, treat as converged; **not** `record()`. (Restore additionally drops the now-moot link.) Mirrors `applyUpsert`'s `not_found` special-case (`:305`).
    - matcher returns null (no instance in window) → debug breadcrumb, skip.
    - `listInstances`/`patchEvent*` throw `auth`/`forbidden`/`rate_limited`/`transient`/`unknown` → `record(e)` (so `authAborted` latches + `settleConnectionStatus` pages exactly like Phase A).
    - `masterOccurrenceBody`/`computeExceptionHash`/`overrideOccurrenceYmd` derivation throws (malformed data) → caught in the task wrapper, `record()` as `unknown` + `console.warn` with the activity id; never a bare throw that aborts the pool.

### 4. Link model + generalized `recordLink` (`models.ts`, `calendarRepository.ts`, `calendarSyncStore.ts`)

- Extend `CalendarEventLink` with two **additive optional** fields: `exceptionOf?: UUID` (master activity id — presence marks an exception link) and `exceptionOriginalYmd?: ISODateString` (the occurrence date the exception addresses; survives child deletion). `CreateCalendarEventLinkInput`/`UpdateCalendarEventLinkInput` inherit them via the existing `Omit`/`Partial` (`models.ts:758-764`) — no repo key change (composite `${connectionId}:${childActivityId}` already unique). **Add a one-line doc comment on the model** noting `googleEventId` is overloaded — the master **event** id on master links, the Google **instance** id on exception links — disambiguated by `exceptionOf` presence; this is a deliberate reuse, flagged so a future maintainer reading the link table isn't surprised.
- **Generalize the existing `recordLink`** (`calendarSyncStore.ts:256-279`) with an optional `extra?: { exceptionOf?; exceptionOriginalYmd? }` merged into both the create and update payloads — do **not** add a parallel `recordExceptionLink`. Master upserts call it with no `extra` (unchanged); exception upserts pass the two fields.

### 5. Mapper: exception body + shared re-anchor (`activityToGoogleEvent.ts`)

- **Modify body:** pass the override child unchanged to `activityToGoogleEvent`; its `recurrence:'none'` already yields `recurrence:[]` (`:20`, `:68-74`) — an instance body, no RRULE. (Drop the earlier "ctx-without-RRULE" phrasing; there is no ctx variant.)
- **`computeExceptionHash(child, master, memberName)`** = `computePushHash(child, memberName)` **plus** the resolved `occurrenceYmd` and `mode` folded in, so a delete↔edit↔reschedule transition on the same occurrence re-pushes. Reuses `computePushHash` — no duplication.
- **`masterOccurrenceBody(master, occurrenceYmd, ctx)`** for restore: the master's event body as a single instance on `occurrenceYmd`, `recurrence:[]`, `status:'confirmed'`. Built on the existing re-anchor primitive: `resolveActivityDays` already returns `endDayOffset`, documented for "a recurring occurrence [to] re-anchor the end day to the occurrence date" (`activityDays.ts:22-24`). Extract **`startEndForDate(activity, ymd, tz)`** (start/end for one date, timed + all-day, using `endDayOffset` + `addDaysYmd`) and refactor `buildStartEnd` (`:38-53`) to delegate `startEndForDate(activity, days.startYmd, tz)` — exactly one formatter.
- Fix the stale header comment (`:3`).

### 6. Convergence of pre-existing diverged data (Requirement 5)

- **Existing overrides, never excepted:** no exception link → `existingInstanceId`/`existingHash` undefined → `exceptionUpserts` discovers + patches. Converges next reconcile.
- **Overrides deleted before this fix:** no exception link ever written → nothing in `exceptionRestores` → no action. Correct: their Google instance was never modified, so it already shows the master value.
- **A master that gains its first override:** master already synced (Phase A), fields unchanged → no master re-push (no churn); Phase B patches its instance.

## Files Affected

- `src/utils/calendar/reconcilePlan.ts` — partition links (master vs exception); `planReconcile` returns `{ upserts, deletes, exceptionUpserts, exceptionRestores }`; import `overrideOccurrenceYmd`; keep `isPushable`; update the `:60-66` comment.
- `src/stores/calendarSyncStore.ts` — Phase B (`applyExceptionUpsert`, `applyExceptionRestore`) inside the existing lock, sharing `record`/`errors`/`changed`/settle; generalize `recordLink` with `extra`.
- `src/services/calendar/CalendarClient.ts` — add `listInstances` + `patchEventFields` to the interface; `CalendarInstance` + `GoogleEventPatch` types.
- `src/services/calendar/googleCalendarClient.ts` — implement `listInstances` (reuse `authedFetch`/pagination) + `patchEventFields` (same wire body as `patchEvent`).
- `src/utils/calendar/activityToGoogleEvent.ts` — `computeExceptionHash`; extract `startEndForDate` (delegate from `buildStartEnd`); `masterOccurrenceBody`; fix the `:3` comment.
- `src/utils/calendar/matchInstanceForDate.ts` — **new** pure helper (+ unit test).
- `src/utils/calendar/overrideOccurrenceYmd.ts` (or an existing calendar leaf util) — **new** shared `originalOccurrenceDate ?? date` resolver; `activityStore.overridesByParent` refactored to use it.
- `src/types/models.ts` — add `exceptionOf?` + `exceptionOriginalYmd?` to `CalendarEventLink`.
- `src/services/automerge/repositories/calendarRepository.ts` — confirm the new optional fields round-trip (no key change).
- **All inline `CalendarClient` fakes** — adding `listInstances` + `patchEventFields` to the interface forces every `const x: CalendarClient = {…}` literal to add both stubs or type-check fails. **Verified: 7 literals across 2 files** — `src/stores/__tests__/calendarSyncStore.test.ts` (`makeFakeClient` + the ad-hoc `deadToken`/`failing`/second-`deadToken` literals) and `src/stores/__tests__/calendarSyncStore.redirect.test.ts` (`noopClient`). Update all; **prefer routing them through one shared fake factory** so the next interface change doesn't re-break N literals (DRY).
- Tests: `reconcilePlan` exception-plan + link-partition cases; `matchInstanceForDate` (string-date matching, no tz); `activityToGoogleEvent` exception hash + `startEndForDate`/`masterOccurrenceBody`; `calendarSyncStore` exception flow (edit-one, reschedule, delete-one, **reschedule-then-restore via stored id**, convergence, master-not-synced skip, malformed recurring-child skip, per-override error recorded but pass completes, `patchEventFields` cancel sends `{status:'cancelled'}` by instance id).
- `src/content/help/security.ts` — light update to the `google-calendar-sync` article (see Help Center Coverage).

## Help Center Coverage

The `google-calendar-sync` article's "Editing and removing" section (`security.ts:35-40`, structured `heading`/`paragraph` blocks, English data — not i18n-routed) currently states "Edit an activity in beanies and the change syncs to your calendar" — silently untrue for single-occurrence changes to recurring activities. This fix makes reality match that promise.

- **Action**: `update existing`
- **Category**: `security`
- **Slug**: `google-calendar-sync` (existing)
- **Title**: unchanged
- **Scope**: Add a sentence to the editing/removing paragraph block confirming that changing or removing **a single session of a recurring activity** (reschedule, edit-this-only, delete-this-only) now updates just that instance on Google, leaving the rest of the series intact.
- **Notes**: One-way-source-of-truth framed (no two-way implication). Bump `updatedDate` (currently `2026-07-11`, `:15`). It's a paragraph-block edit, not free text. **Intentional v1 limitation to state plainly (so support isn't surprised):** unlike a whole activity — which beanies re-asserts on every sync if you change it directly in Google — a _single rescheduled/edited/deleted session_ is pushed once and not continuously re-asserted; if you manually change that one instance in Google, beanies restores its version only the next time you edit that session in the app. (Still strictly better than today, where per-session changes don't sync at all.)

## Acceptance Criteria

- [ ] Reschedule one occurrence → Google shows it at the new date/time and NOT at the original; other occurrences unchanged.
- [ ] Edit "this occurrence only" → only that Google instance reflects the edit; others unchanged.
- [ ] Delete "this occurrence only" → that Google instance is cancelled; others remain.
- [ ] Deleting/reverting the override → the Google instance returns to the master's generated value (patched by the stored instance id — works for a moved or a cancelled instance).
- [ ] No duplicate instance; an override never yields a second top-level event.
- [ ] Idempotent: a reconcile with no override change performs no exception Google writes; steady-state Phase B makes ~0 `listInstances` calls (patches by stored id).
- [ ] Pre-existing diverged data converges (override created pre-fix corrected next reconcile; override deleted pre-fix needs no action).
- [ ] Master-before-exception ordering holds; a child whose master isn't synced is skipped (debug breadcrumb), never orphaned.
- [ ] Every failure classified (API errors → `record()`/status/Slack; benign not-found/no-match → debug + skip); one bad override never aborts the reconcile; no bare throw escapes the task pool.
- [ ] `activityToGoogleEvent.ts:3` + `reconcilePlan.ts:60-66` comments corrected.
- [ ] Help Center `google-calendar-sync` article updated + verified; type-check, lint, and unit suite green.

## Testing Plan

1. **Unit — `matchInstanceForDate`**: timed-with-offset matched by `originalStartTime` date slice; all-day; DST-boundary occurrence day; a **moved** instance (start ≠ originalStartTime) still matched by `originalStartTime`; a cancelled instance present; no match → null. No tz param.
2. **Unit — `reconcilePlan`**: active edit-one child + synced master → one `exceptionUpsert` (modify), no top-level upsert; delete-one → cancel; reschedule → occurrence keyed by `originalOccurrenceDate`; exception link whose child is gone → `exceptionRestore`; child whose master isn't pushable → neither; **partition: an exception link is never in `deletes`**.
3. **Unit — `activityToGoogleEvent`**: `computeExceptionHash` changes across modify↔cancel and across occurrence date; `startEndForDate`/`masterOccurrenceBody` produce correct start/end (timed + all-day, using `endDayOffset`) with `recurrence:[]`.
4. **Store flow — `calendarSyncStore` (fake client)**: reschedule → first run `listInstances` + `patchEvent(instanceId, moved start)` + link stores instanceId; **reschedule-then-restore (child deleted) → restore patches by STORED `link.googleEventId`, no `listInstances`**; edit-one → patch fields; delete-one → `patchEventFields(instanceId, {status:'cancelled'})`; idempotent second run = no writes; master-not-synced child → skipped (debug, no error); a per-override client error → `record`ed, pass still completes.
5. **Manual (dev + live, connected calendar)**: weekly timed activity — reschedule one session (Google moves just that instance), edit one, delete one; then delete each override in beanies (Google restores). Repeat for an all-day recurring activity. Confirm no duplicate instances, others untouched.
6. `npm run type-check`, `npm run lint`, unit suite, Drive/calendar regression (existing master sync unchanged).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the pre-plan intake + two codebase investigations. Native Google instance exceptions addressed via Google's instance list (avoiding DST-fragile id derivation), reusing `patchEvent`; two-phase reconcile; exception link rows for restore; convergence for pre-existing data; DRY extraction of the occurrence-date fallback and `startEndForDate`.
- **Pass 2 (DRY + error handling)**: Caught a real convergence bug — a rescheduled (moved) instance falls outside an original-date window, so restore/re-modify must patch by the **stored** instance id (discover via `listInstances` once, store in the link, reuse thereafter; steady-state ~0 GETs). Added an honest `patchEventFields`/`GoogleEventPatch` seam (a bare `{status:'cancelled'}` won't type-check against `GoogleEventResource`). Dropped tz math from `matchInstanceForDate` (string-slice on `originalStartTime`, padded window). Made Phase B share the existing lock/`record`/`errors`/`changed`/single-settle (not a second lock/settle). Generalized `recordLink` with `extra` instead of a parallel writer. Refactored `buildStartEnd` to delegate `startEndForDate` (one formatter, reusing `resolveActivityDays.endDayOffset`). Made the master-vs-exception link partition explicit + verified-required. Enumerated the full Phase-B failure taxonomy (benign not-found/no-match = debug+skip; API errors = `record`; derivation throw = caught + `record` unknown).
- **Pass 3 (Sustainability)**: Made `applyExceptionUpsert`/`applyExceptionRestore` module-level functions returning `boolean` (did-write), mirroring `applyUpsert` — the `record`/`changed` sharing stays in the thin task wrapper so `reconcileConnection` doesn't balloon and both are unit-testable. Gated restore on `mastersById.has(exceptionOf)` (an out-of-window-but-active master is being series-deleted by Phase A → drop the exception link, never patch a just-deleted master's instance) — removes an ordering hazard by construction. Treated `not_found` from cancel/restore patches as benign convergence (debug + drop link), not a paged error, mirroring `applyUpsert`'s patch `not_found` branch. Defined the verify-pass rule: exceptions do NOT re-assert on verify (self-heal on next override change) — avoids a re-patch/CRDT-churn storm on every connect/manual-sync. Added a doc-comment flag for the `googleEventId` master-vs-instance overload.
- **Pass 4 (Fresh-eyes sweep)**: Confirmed the design sound and ready — no surviving correctness/security/data-loss issue. Caught one build-breaker: adding two `CalendarClient` methods forces **7 inline fake literals across 2 test files** to add stubs (added to Files Affected + a shared-fake-factory recommendation). Sharpened Assumption 1's live-verify to explicitly test a PATCH carrying `recurrence:[]` against an instance id (the real unknown). Downgraded `showDeleted=true` from load-bearing to belt-and-suspenders (discovery always runs while the instance is confirmed). Added a self-enforcing malformed-child guard (`recurrence !== 'none'` → warn+skip, never stamp an RRULE onto an instance). Documented the intentional verify-pass asymmetry in the Help scope. Softened Requirement 8 (the `activityToGoogleEvent.ts:3` comment is premature-true, not wrong).

## Prompt Log

> No GitHub issue created. This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-pre-plan → /beanies-plan, assembled intake)

The `=== BEANIES PRE-PLAN ===` block: sync per-occurrence recurring-activity changes (reschedule / edit-one / delete-one) to Google Calendar; root cause `reconcilePlan.isPushable()` skips override children + no Google exception-write logic; scope all three ops + restore + comment fixes; High priority; no GitHub issue; ungated.

### Decisions (pre-plan AskUserQuestion)

Priority: High · Scope: all three ops · GitHub issue: Skip · Feature gate: Ungated.

</details>
