# Plan: Stop retrying a calendar event Google will never accept

> Date: 2026-09-12
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-12-calendar-invalid-payload-quarantine.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a family whose calendar is connected to Google, I want an event Google refuses
to accept to be reported to me once, clearly, and then left alone — so that one
bad record does not leave my connection permanently stamped "error", and does not
burn a Google API call every five minutes forever.

As the operator, I want that failure to name the record, so I can fix it without
asking the family to reproduce anything.

## Context

`#beanies-errors` has been paging on this four times across three days, three
builds, and two platforms for one family (The White House, `…f8eab8a6`):

```
[calendarSync] reconcile error (invalid): [upsert] Google Calendar HTTP 400
(invalid: Invalid start time.) (sustained ×3)
```

A 400 is Google rejecting the **payload**. It is deterministic: the identical body
will be rejected identically, forever. `CalendarClient.ts:43` already says so in
as many words —

```ts
| 'invalid' // 400 → Google rejected the request body/params — deterministic, never retryable
```

— but nothing in the reconcile loop honours it. `invalid` is counted, retried and
re-paged exactly like `rate_limited` or a transient 5xx. So:

- the offending activity never reaches Google, and never will;
- the connection is stamped `status: 'error'` (visible on their Settings card);
- every reconcile tick re-sends the same doomed body;
- the device-local counter climbs to `RECONCILE_ERROR_THRESHOLD` (3) and pages
  Slack once per app session, forever, on every device the family uses.

Other activities are unaffected — `runPooled` collects errors rather than
aborting — so this is one stuck event, not a dead integration.

### Why we cannot say which event

The alert carries Google's text and nothing else. `record()`
(`calendarSyncStore.ts:667`) prefixes the task name (`[upsert]`) and discards the
activity id it had in hand. So a permanent, reproducible failure arrives with
nothing to act on.

⚠️ **And the context the call site does pass is silently dropped.**
`calendarSyncStore.ts:827` sends `{ connectionId, consecutiveFailures }`; neither
spelling is in `ALLOWED_CONTEXT_KEYS`, so `redactContext` strips them (with a
`console.warn` nobody reads in prod) before they ship. That is why the Slack alert
shows only the generic envelope fields. One site is affected — the sibling
`needs_reconnect` park at `:784-786` already knows, and says so in its comment.

### Where a malformed body can come from

`startEndForDate` (`activityToGoogleEvent.ts:65`) builds the timestamp by
concatenation:

```ts
start: {
  dateTime: (`${ymd}T${days.startTime}:00`, timeZone);
}
```

The only upstream guard is `isAllDayActivity`, which requires `startTime` to be
**truthy — not well-formed**. Anything truthy that is not `HH:MM` produces an
invalid RFC3339 string and a guaranteed 400. There is no `HH:MM` validation
anywhere in `src/` (the only assertion lives inside an import _test_).

The calendar-import path was checked and is clean: `toTimeInputValue` zero-pads
and `activityDatesFromGoogle` rejects `NaN` dates.

**Pass 2 found the actual source, and it is one unvalidated hop from a language
model into the family's CRDT.** `extractionPrompt.ts:65` asks the model for
`24h HH:mm`; `:280` accepts the answer through `asString` (`:224-228`), which
only trims and truncates. `extractionToActivity.ts:115-121` — its comment reads
_"pass through whatever was found"_ — copies it into the prefill, and
`mergeExtractionIntoActivity` (`activityDuplicate.ts:110-118`, called from
`FamilyPlannerPage.vue:53`) writes it onto an **existing** activity, bypassing
any time input. A model answering `"9am"`, `"9:00"` or `"16:00-17:00"` lands
verbatim in the pod. `result.date` is cast `as ISODateString` at `:107` with no
validation either — and a bad `date` produces the _same_ Google error, via
`dayOffset` → `NaN` → `addDaysYmd(ymd, NaN)` (`activityDays.ts:35-38`).

### Precedent: this file has been here before

`applyUpsert`'s docblock (`calendarSyncStore.ts:347-358`) describes an almost
identical incident — a foreign Google id that _"returns a 400 that repeats on
every reconcile, forever, with nothing the user can do"_ — and resolves it by
treating the failure as a **convergence**: drop the link, let the next pass
self-heal. `applyExceptionRestore` (`:605-623`) does the same for `invalid` on a
restore. So "a deterministic 400 is terminal, not retryable" is already this
file's idiom in two places. This plan should extend that idiom, not invent a
third mechanism beside it.

## Requirements

1. **A deterministic rejection is not retried.** Once Google has refused a
   specific payload with a 400, beanies stops sending that payload.
2. **It is retried again the moment the data changes.** Editing the activity must
   clear the quarantine, so a user fixing the problem sees it resolve without
   support.
3. **The operator can identify the record** from the alert alone, without a repro.
4. **The family is told**, once, in their own language, that one event cannot sync
   and what to do — rather than a connection permanently stamped "error" with no
   explanation.
5. **Slack is paged once per distinct broken payload**, not once per session
   forever.
6. **Transient failures behave exactly as today** — `rate_limited`, `transient`,
   `not_found`, `conflict` keep their current count-and-retry semantics. This plan
   changes the policy for `invalid` only.
7. **A malformed timestamp is caught before the network call**, so the failure is
   classified by us rather than by a round-trip.

## Important Notes & Caveats

- **`invalid` is the only kind whose policy changes.** `CalendarErrorKind` has
  eight members; seven keep today's behaviour. Widening this to `forbidden` would
  be wrong — a 403 can be a transient permission propagation — and widening it to
  everything would quarantine on a network blip.
- **Quarantine keys on the activity's push HASH, not on its id.** Keying on the id
  alone would survive the user fixing the problem, turning a self-healing situation
  permanent — strictly worse than today. `computePushHash` is the existing,
  device-stable change token: an edit changes it and the record goes live again,
  with no expiry, no timer and no separate clear path. It is deliberately NOT a
  hash of the wire payload (see Assumption 3).
- **Do not log activity titles, member names, or the event body.** The firehose is
  allowlisted and declared to Apple and Google as Diagnostics.
- **Ship an id TAIL, not a full activity id.** The repo has a `*_tail` convention
  with automatic enforcement — `redactContext` passes any `_tail`-suffixed key
  through `tail()` (last 4 chars), and `file_id_tail` / `member_id_tail` already use
  it. Four characters answer the operator's real question ("are these four alerts
  one activity?"); the family-facing "which event" answer comes from Settings, which
  holds the full id locally. A full UUID would be a new stable per-record
  identifier — today only `family_id` is declared under Identifiers → User ID — and
  is a materially harder store declaration for no extra diagnostic value.
- **The dropped-key fix is a RENAME, not an allowlist change.** `consecutive_failures`
  (snake_case) is already allowlisted (`diagnosticContext.ts:108`) and already
  declared (`native-store-submission.md:34`); the call site simply spells it
  camelCase. `connectionId` follows the precedent the sibling park already set at
  `:784-786` — device-local and useless in Slack, so it rides in the message.
  There is exactly ONE offending site: `calendarSyncStore.ts:827`.
- **A quarantine is family-wide state.** It belongs in the CRDT, not in a
  device-local `Map` — otherwise every device rediscovers the same failure
  independently, which is the behaviour we are trying to stop. It does NOT belong on
  `CalendarEventLink`: see Assumption 2.
- **"Once" is best-effort across devices.** `errorReporter`'s dedup is a 60-second
  window plus a per-tab `sessionStorage` layer, so it cannot carry this. The CRDT
  transition is the real gate, and two devices reconciling concurrently can each see
  "no entry" and each page. Bounded at one page per device per payload rather than
  one per session forever — accepted, and stated here rather than discovered later.
- **Do not delete or rewrite the user's activity.** We reject the push, never the
  record. Silently "fixing" a time in the family's own data is not ours to do.

## Assumptions

> **Review these before implementation.**

1. ~~A new family-wide CRDT collection can be registered with no migration.~~
   **VERIFIED FALSE (Pass 3), and it is why there is no longer one.** `migrateDoc`
   (`worker/docOps.ts:96-102`) writes a real `Automerge.change` into **every**
   existing family pod that lacks the key, and `SNAPSHOT_VERSION`
   (`worker/cache.ts:244`) embeds a fingerprint of the collection names — so adding
   one also invalidates the fast-first-paint projection snapshot for **every**
   family. Two global side effects, for one family's one bad event.
2. A malformed time or date is a **pure function of the activity** — identical on
   every device, recomputable for free, needing no persisted state at all. This is
   the assumption the whole design now rests on, and it holds for every cause we
   have evidence of.
3. A 400 we did NOT predict is rare enough that forgetting it on reload is
   acceptable. The cost of being wrong is one wasted API call per device per
   session — against `RECONCILE_POLL_MS = 300_000`, that is a handful a day instead
   of ~288.
4. The four observed alerts are one activity, not four. The design does not depend
   on it, and once §2 lands the question stops mattering.

## Approach

> **Three changes, not one.** They are listed in shipping order but A and B are
> order-independent, and C depends only on B's predicate. Each is reviewable in one
> sitting; bundled, they are not.
>
> |       | Scope | Ships what                                                             |
> | ----- | ----- | ---------------------------------------------------------------------- |
> | **A** | §0    | Stops new bad data entering any pod. No calendar coupling at all.      |
> | **B** | §1–§3 | **Closes the production bug.** No UI, no i18n, no CRDT, no store gate. |
> | **C** | §4    | The family-facing half, over a predicate B already shipped.            |

### 0. Stop creating the malformed value (change A — the actual root cause)

`extractionPrompt.ts:280` accepts the model's `startTime` / `endTime` / `date`
through `asString` (`:224-228`), which only trims and truncates. `asString` is
already THE coercion helper for this file, with a docblock explaining that its trim
is load-bearing — so `asWallClockTime` / `asYmd` belong beside it, and a failing
value drops to `''`.

Emit **one aggregated** `logEvent` naming the rejected fields, not one per field:
the firehose is capped at 50 events per surface per minute, and a per-field loop is
exactly how a cap gets hit silently.

⚠️ **The travel path has the identical hole, in a different shape.**
`extractionPrompt.ts:310`/`:314` are the _prompt descriptions_ handed to the model,
not coercion sites — there is nothing to edit there. The real coercion is the
generic nested sweep at `:766-785`, which does
`target[k] = asString(v, MODEL_TEXT_MAX)` over `Object.entries(source)` for
`NESTED_FIELD_KEYS` (`:713`), keyed by whatever the model returned. It cannot be
"routed through two helpers"; it needs a small key→validator map applied inside the
sweep:

- time: `departureTime`, `arrivalTime`, `pickupTime`, `returnTime`, `embarkationTime`
- ymd: `departureDate`, `arrivalDate`, `checkInDate`, `checkOutDate`, `pickupDate`,
  `returnDate`, `embarkationDate`, `disembarkationDate`

**Scope honesty:** travel segments do not reach Google Calendar through the activity
push path, so this half is defence-in-depth against a _rendered_ junk value, not the
production bug. It stays in change A because it is the same parse boundary and the
map is ten lines — but if A has to be cut, the travel half goes first.

This does not repair pods that already hold a bad value. §2–§3 are what those
families need.

### 1. Make the failure nameable — with keys that already exist (change B)

- `calendarSyncStore.ts:827`: rename `consecutiveFailures` → `consecutive_failures`
  (already allowlisted at `diagnosticContext.ts:108`, already declared) and move
  `connectionId` into the message, following the sibling park at `:784-786`. A pure
  bug fix at zero cost.
- **No new context key.** The failure class rides the already-allowlisted
  `error_code` as `bad_start_time | bad_end_time | bad_date | google_rejected`,
  which is what an operator actually needs. `diagnosticContext.ts:81` states the
  convention outright: `action` / `kind` / `error_code` are _reused_ per feature
  rather than duplicated. An `activity_id_tail` would cost six artefacts — the
  allowlist, the pinned Lambda mirror, the store runbook, `PrivacyInfo.xcprivacy`,
  the Play Data-Safety answers and `privacy.astro`, two of them legal declarations
  — permanently, to answer a question ("are these four alerts one activity?") that
  stops existing the moment the loop stops repeating.
- `CalendarClient.ts` is NOT touched.
- Two latent bugs in the function being edited get fixed.
  **(a)** `record()` (`:667-671`) MUTATES `err.message` on an instance it does not
  own. The token provider latches one `CalendarApiError`
  (`googleCalendarClient.ts:167-174`, `throw latched;`) and rethrows **that same
  instance** to every task in the run, and every run for the rest of the session —
  so the prefix accretes unboundedly (`[upsert] [upsert] [delete] …`). Build a new
  error, preserving both readonly fields:
  `new CalendarApiError(err.kind, \`[${task}] ${err.message}\`, err.status)`.
Dropping `kind`would corrupt`lastError`at`:809`; dropping `status` would strip
the HTTP code from the Slack payload.
**(b)** the non-`CalendarApiError`branch at`:668`widens with`String(e)`, which
yields `[object Object]`for a thrown plain object — use`e instanceof Error ? e.message : String(e)`.
- The `member_id_tail` / `file_id_tail` runbook drift is a real pre-existing bug,
  but it is a compliance-doc fix: **its own commit**, so neither is hard to revert.

### 2. A malformed activity never enters the plan (change B)

Not a throw. A **filter**.

⚠️ The previous draft threw from `startEndForDate`, which forced §2 to land after
§3 or the bug got _worse_ — `activityToGoogleEvent` is called at
`calendarSyncStore.ts:344`, before the `hasLink` and hash checks, so a throw there
fires on every tick including the no-op path. A filter has no such ordering
constraint, because a blocked activity never reaches the mapper at all. **The
sequencing hazard is deleted, not managed.**

One new pure predicate, a sibling export in `activityDays.ts` beside
`isAllDayActivity`:

```ts
export type PushBlockReason = 'bad_start_time' | 'bad_end_time' | 'bad_date';
/**
 * Why Google can NEVER accept this activity, or null.
 *
 * Strictly narrower than "invalid": only shapes that are PROVABLY a 400.
 *
 * ⚠️ This must mirror what `resolveActivityDays` actually SERIALIZES, not what the
 * activity happens to hold. Every rule below exists because the obvious version of
 * it blocks an activity that syncs perfectly well today — and a false positive here
 * is a silent regression: the event simply stops reaching Google, with no error.
 */
export function pushBlockReason(a: FamilyActivity): PushBlockReason | null;
```

- **Times are checked ONLY when `!isAllDayActivity(a)`.** An activity with
  `isAllDay: true` and a malformed `startTime` is an all-day event today and syncs
  fine — `resolveActivityDays` takes the all-day branch (`activityDays.ts:51-53`)
  and `startTime` is never serialized (`activityToGoogleEvent.ts:62`). An absent
  `startTime` is likewise not blocked: `isAllDayActivity` already routes it.
- **`endTime` only when present** (`activityDays.ts:57` defaults it to `startTime`);
  **`endDate` only when present** (`:58` defaults it to `startYmd`).
- **Validate `.slice(0, 10)`, never the raw ymd field.** Every consumer slices
  (`activityDays.ts:49`, `:52`, `:58`; `addDaysYmd`; `activityInWindow`), so a
  `date` carrying a time component is legal today and `isRealYmd` on the raw value
  would reject it.
- **`bad_date` applies to all-day AND timed alike.** `dayOffset` runs on both
  branches (`activityDays.ts:53` and `:64`), so a bad `endDate` reaches the wire
  through `addDaysYmd` either way — an all-day event is not immune.
- **`recurrenceEndDate` is folded into `bad_date`** when `a.recurrence !== 'none'`
  or `a.rule` is present: `untilClause` (`recurrenceRrule.ts:66-68`) serializes it
  into `UNTIL=` behind only a `.trim()` guard, so a malformed value is as provably
  a 400 as a malformed `startTime` — just with a different Google message.

- `isWallClockTime` lives in `@/utils/date` beside `isRealYmd` (`date.ts:235`),
  whose docblock is the template for it. `isWallClockTime` includes the `00-23` /
  `00-59` RANGE check, not just the shape — the test table rejects `24:00` and
  `09:60` — so `TimePresetPicker.vue:101-104` (regex **plus** range check, four
  lines) collapses onto it entirely, leaving no redundant nested check behind. A malformed `HH:MM` corrupts far more than
  Google: the `endTime < startTime` string compare that decides the overnight roll
  (`activityDays.ts:59`), `setHours(NaN)` in clash detection
  (`clashDetection.ts:92-96`), `formatTime12`, `addHourToTime`, and the reminder
  trigger in `notifications.ts:302-303`.
- ⚠️ **`resolveActivityDays` is NOT modified** — not its behaviour, not its return
  type, not its throw profile. It is on the render path of the planner and the wall
  (`clashDetection.ts:109`, plus 22 call sites of its sibling `isAllDayActivity`
  across the daily/weekly/day-timeline/wall views and `monthCells`). A validation
  throw there turns one bad activity into a blank calendar — far worse than the bug
  being fixed.
- Dates are validated too: `dayOffset` (`activityDays.ts:35-38`) returns `NaN` for
  an unparseable `endDate`, and `addDaysYmd(ymd, NaN)` yields a string Google
  rejects with the very same "Invalid start time".

### 3. The planner filters; the residual memoises device-locally (change B)

**3a — the predictable case is derived, not remembered.**

`planReconcile` computes a `blocked` set exactly mirroring the `suppressed` idiom
it already carries at `reconcilePlan.ts:154-158`, and applies it in two places:

- `upserts` (`:160-171`) — add `&& !blocked.has(a.id)` to the existing filter;
- `exceptionUpserts` (`:198-215`) — skip **inside the loop**, with
  `if (blocked.has(child.id) || blocked.has(child.parentActivityId)) continue;`
  beside the existing `if (!master) continue;` at `:201`. The first draft ignored
  this path entirely, yet an override child that 400s is the same bug, recorded
  identically at `calendarSyncStore.ts:726`.

🔴 **`blocked` must NOT be added to `mastersById` (`:158`) to achieve that skip.**
This is the SAME data-loss class as the delete loop, on the sibling path, and it is
what the obvious implementation does. `mastersById` is read a second time by
`exceptionRestores` (`:220-222`), which filters on `!mastersById.has(l.exceptionOf!)`
and maps `master: mastersById.get(...) ?? null`. Remove a blocked master from it and
every one of its exception links qualifies for restore with a null master — which
`applyExceptionRestore` (`calendarSyncStore.ts:577-583`) answers by **deleting the
exception link**, orphaning the family's overridden Google instance, because someone
typed a bad time on the parent.

🔴 **`blocked` must NEVER reach `pushableIds`, `suppressed`, or `mastersById`.** The delete
loop at `reconcilePlan.ts:184-191` keeps a link only via
`if (pushableIds.has(l.activityId) && !suppressed.has(l.activityId)) continue;` —
so a blocked activity added there would fall through to `deletes.push(l)` with
`beaniesMayDelete` true, and **the family's Google event would be deleted** because
someone typed a bad time. Filtering the `upserts` array alone leaves the link and
the remote event untouched and stale, which is the correct conservative outcome.
This is the one genuinely subtle failure mode in the design and it is pinned by a
test.

`exceptionRestores` needs no guard: a bad master body is already terminal at
`calendarSyncStore.ts:605-623`.

**3b — the unpredicted residual memoises in four lines.**

For a 400 we did not predict, a third module-level map beside the two that already
live at `calendarSyncStore.ts:139-143`:

```ts
/**
 * Device-local memo of payloads Google refused with a deterministic 400, keyed
 * `${connectionId}:${activityId}` → the rejected push hash.
 *
 * NOT in the CRDT, for exactly the reason the two counters above are not: sync-engine
 * failure bookkeeping is device state. An edit changes the hash and the push is
 * retried; a reload forgets and costs at most one doomed call.
 */
const rejectedPushHashes = new Map<string, string>();
```

Checked inside the EXISTING upsert task closure (`:678-686`) — so no
`planReconcile` signature change, no fourth argument, no `rejectionClears`, no
orphan GC, and no write that can fail.

**Two writers, one map, no collision.** Master upserts key
`${connectionId}:${u.activity.id}` → `computePushHash`; exception upserts key
`${connectionId}:${e.child.id}` → `computeExceptionHash` (a different string shape).
The id spaces are disjoint by construction — `isPushable` (`reconcilePlan.ts:119-125`)
excludes anything with a `parentActivityId`, so a master id and a child id can never
be the same key. Do not add a second map.

**Lifecycle, stated so nobody "fixes" it later.** `stop()` is reached only from
`resetStores.ts:42` (family reset), not per poll or per visibility change, so the
memo survives across reconciles as intended. It is deliberately NOT cleared on
disconnect/reconnect beside `invalidGrantCounters`: a 400 on the request BODY is
grant-independent, so forgetting it there would only re-burn the call. Bounded by
|activities| × |connections|, wiped on reset.

**Hash collision.** `computePushHash` is a 32-bit djb2. A false skip needs one
activity's broken and fixed states to collide, and costs one missed retry until the
next edit. Accepted; not worth widening the hash for.

**What this deletes from the previous draft:** the `calendarPushRejections`
collection, its Pinia store, its model type, its guarded writer, its orphan-GC
contract, the `automerge.ts` registration, and both global side effects from
Assumption 1.

### 4. Tell the family — derived, not stored (change C)

`CalendarSyncSettings.vue` renders an `InferredHint`
(`src/components/ui/InferredHint.vue` — already a one-line Heritage-Orange note,
never red, already carrying its `dark:text-accent-lift` partner, already rendering
nothing on empty text so no `v-if` is needed) over a **pure computed**: the
activities in the push window for which `pushBlockReason(a) !== null`.

Concretely: `useActivityStore().activities`, filtered by `isPushable(a, todayYmd())`
(already exported from `reconcilePlan.ts`) and then `pushBlockReason(a) !== null`.
⚠️ `CalendarSyncSettings.vue` imports no activity source today, so those two imports
are new — named here so a reviewer can see the computed is cheap.

No store beyond that, no CRDT read, no reactivity plumbing, correct on a device that
has never reconciled, and it self-clears the instant the user fixes the time. That
also disposes of the previous draft's worry about gating on `connection.status` —
there is nothing to gate.

"Open the event" uses `entityDeepLink('activity', id)` (`entityDeepLink.ts:15-18`),
the shared map already behind global search and notification "Open".

ONE `uiStrings` entry, `en` + `beanie`, real nouns, interpolated with `fillTemplate`.
⚠️ **`uiStrings` has no plural forms** — `fillTemplate` is a `.replace()` and the
house idiom is the literal `(s)` (`:895`, `:1319`) — so the copy must read correctly
at one AND at three from a single key. Do not add a pluralisation helper for one
string.
**`google_rejected` is deliberately NOT surfaced to the family**: "one of your
events couldn't sync and we don't know why" is worse than silence. It stays
operator-facing. Google's raw English is never stored or rendered.

### 5. Page once per broken payload — at the source (change B)

`applyExceptionRestore` already implements this policy for restores
(`calendarSyncStore.ts:605-623`): on `kind === 'invalid'` it resolves the case, logs
at `error`, and returns converged so the error is never `record()`ed. Mirror it; do
not write a second thing that knows what `invalid` means.

In the upsert and exception task wrappers (`:678-686`, `:720-728`): catch a
`CalendarApiError` with `kind === 'invalid'`, memoise it, page once iff newly
memoised, and **do not call `record()`**.

`settleConnectionStatus` (`:765-857`) is then **completely untouched** — no new
severity branch, no "are all errors invalid?" predicate, `status` stays `ok` for
free, the seven other kinds keep byte-identical semantics, and
`worst = otherErrors[0]` (`:807`, a misnomer — it is "first") is left alone.

## Files Affected

**Change A** — stops new bad data:

- `src/services/ai/extractionPrompt.ts` — `asWallClockTime` / `asYmd` beside
  `asString`; applied to the activity fields AND the travel fields (`:310`, `:314`)

**Change B** — closes the production bug:

- `src/utils/date.ts` — `isWallClockTime`, beside `isRealYmd` (`:235`)
- `src/components/ui/TimePresetPicker.vue` — dedupe its inline regex (`:101`) onto it
- `src/utils/calendar/activityDays.ts` — NEW `pushBlockReason` sibling export.
  **`resolveActivityDays` unchanged** (22 render-path call sites)
- `src/utils/calendar/reconcilePlan.ts` — a `blocked` set mirroring `suppressed`
  (`:154-158`); filter `upserts` and `exceptionUpserts` **only**, never `pushableIds`
- `src/stores/calendarSyncStore.ts` — device-local `rejectedPushHashes` beside the
  two maps at `:139-143`; skip in the upsert task; `invalid` handled in the wrapper
  per `:605-623`; `record()` hardening; the `:827` context rename.
  `settleConnectionStatus` and `planReconcile`'s signature unchanged.

**Change C** — the family-facing half:

- `src/components/settings/CalendarSyncSettings.vue` — `InferredHint` over a pure computed
- `src/services/translation/uiStrings.ts` — one parameterised string, `en` + `beanie`

**Deliberately NOT touched** (all in the previous draft, all removed by Pass 3):
`types/automerge.ts` · `types/models.ts` · `CalendarClient.ts` ·
`diagnosticContext.ts` · the pinned Lambda mirror · `native-store-submission.md` ·
`PrivacyInfo.xcprivacy` · the Play Data-Safety answers · `privacy.astro` · a new
Pinia store.

**Separately, unbundled:** the `member_id_tail` / `file_id_tail` runbook drift.

## Observability Coverage

**Surfaces: `calendar-sync`** (already owned) and **`recipe-extract`** for change A.
⚠️ `logEvent` requires `message`; every snippet carries one. **No new context key:
`action` and `error_code` are already allowlisted, so this feature adds zero
store-declaration work.**

- `logEvent({ level: 'warn', surface: 'recipe-extract', message: '…', context: { action: 'model-field-rejected', error_code: <fields> } })`
  — change A, **one aggregated event** naming the rejected fields, never one per
  field. Tells us how often the model returns an unusable value, which is the
  evidence that says whether the prompt needs work.
- `logEvent({ level: 'warn', surface: 'calendar-sync', message: '…', context: { action: 'push-blocked', error_code: <PushBlockReason> } })`
  — emitted when the planner filters an activity, as an **aggregate count per
  reconcile**, not per activity: the firehose is capped at 50 events per surface per
  minute and a per-activity loop truncates itself silently.
- `reportError({ surface: 'calendar-sync', severity: 'warning', message: '…', context: { action: 'push-rejected', error_code: 'google_rejected' } })`
  — the unpredicted 400, once per device per payload. `warning`, not `critical`:
  nothing is at risk and no action of ours failed — one event is not syncing, and
  for the derivable reasons the family has already been told in Settings. That
  downgrade is the point of requirement 5.
- `logEvent({ level: 'info', surface: 'calendar-sync', message: '…', context: { action: 'push-unblocked' } })`
  — the success-path counterpart (rule 6). Without it we cannot distinguish
  "families fix these" from "families abandon them", which is the only evidence
  that the Settings copy works.
- Unchanged: the existing sustained-error page keeps firing for every non-`invalid`
  kind.

**Failure modes covered:** an activity blocked that should not have been (`push-blocked`
with no matching `push-unblocked`); the predicate missing a real cause (`push-rejected`
volume — every one of these is a shape §2 failed to predict, and is the signal that
tells us what to add); the model producing junk (`model-field-rejected` volume).

**Privacy:** no titles, no member names, no event bodies, no per-record identifier.

## Acceptance Criteria

- [ ] A model returning `"9am"` / `"16:00-17:00"` / a bad date never reaches the CRDT
- [ ] The same holds for the travel fields, not just the activity fields
- [ ] An activity with a malformed time or date is absent from `plan.upserts`
- [ ] 🔴 …and its existing link and Google event are **left untouched** — never deleted
- [ ] An `exceptionUpsert` whose child or master is blocked is skipped too
- [ ] 🔴 …and a blocked MASTER's exception link is **not** restored or deleted
- [ ] An `isAllDay` activity with a junk `startTime` still syncs — it is NOT blocked
- [ ] A `date` carrying a time component is NOT blocked
- [ ] A connection stuck at `status: 'error'` from this bug returns to `ok` on the
      FIRST reconcile after the fix, with no user action
- [ ] An unpredicted 400 is memoised and not re-sent while the hash is unchanged
- [ ] Editing the activity retries the push, with no expiry and no clear path
- [ ] A transient failure (429/5xx) is NOT memoised and still retries as today
- [ ] `consecutive_failures` arrives in Slack; `connectionId` no longer claims to
- [ ] `resolveActivityDays`'s behaviour and return type are unchanged
- [ ] `planReconcile`'s signature is unchanged
- [ ] `settleConnectionStatus` is byte-identical to today
- [ ] The connection is not left `status: 'error'` for a blocked item alone
- [ ] Settings names the affected events, in both languages and both modes
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified

## Testing Plan

1. Table-test `isWallClockTime`: `09:00` ok; `9:00`, `24:00`, `09:00:00`, `''`,
   `'abc'`, `'09:60'`, `'9am'`, `'16:00-17:00'` rejected.
2. Table-test `pushBlockReason`: a well-formed timed activity → `null`; an all-day
   activity with no `startTime` → `null`; **`{ isAllDay: true, startTime: '9am' }` →
   `null`** (not blocked — it syncs today); a `date` with a time component → `null`;
   an absent `endTime`/`endDate` → `null`; `"9am"` → `bad_start_time`; a bad
   `endDate` on an ALL-DAY activity → `bad_date`; a bad `recurrenceEndDate` on a
   repeating activity → `bad_date`.
3. Change A: a model returning `"9am"` never reaches the activity prefill, the
   travel fields are covered too, and one aggregated rejection is logged.
4. `reconcilePlan`: a blocked activity is absent from `upserts`; the same activity
   with a valid time is present; a blocked child or master is absent from
   `exceptionUpserts`.
5. 🔴 **A blocked activity that already has a link produces NO delete and NO
   unlink** — its Google event survives.
   5b. 🔴 **A blocked MASTER with an existing exception link produces NO
   `exceptionRestore`** — the link survives and Google is not touched. These two are
   the only ways this design could destroy user data, and the tests exist to make
   both impossible to reintroduce.
6. `calendarSyncStore`: a 400 memoises; a 429 does not; a 400 followed by an edit
   re-pushes; `stop()` clears the memo.
7. **Mutation check**: add `blocked` to `pushableIds` and confirm test 5 fails.
   7b. **Mutation check**: add `blocked` to the `mastersById` filter and confirm 5b fails.
8. **Mutation check**: key the memo on `activityId` instead of the hash and confirm
   the edit-retries test fails — that mutation turns a self-healing state permanent.
9. **Mutation check**: widen the memo from `invalid` to all kinds and confirm the
   transient test fails.
10. Settings card in both modes and both languages, with one and three blocked
    events, and with a healthy connection (no line at all).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the `/error-review` triage of four
  production alerts; established that `invalid` is documented as never-retryable
  but not treated as such, and that the alert's two context keys never ship.
- **Pass 2 (DRY + error handling)**: Verified every claim against source. Assumption 2
  is FALSE — `recordLink` runs only after a successful insert
  (`calendarSyncStore.ts:373-374`), so a first-push 400 has no link to mark; the
  quarantine moved to its own family-wide collection copying the
  `overlapAcknowledgments` idiom. Removed four re-implementations (`InferredHint`,
  `entityDeepLink`, `overlapAckStore`'s guarded writer, and the existing
  `invalid`-is-terminal branch at `:605-623`), dropped `CalendarClient` and
  `CalendarEventLink` from scope, cut the allowlist cost to one `activity_id_tail`
  (`consecutive_failures` was already allowlisted — a rename, not a gate), moved
  paging into the task wrapper so `settleConnectionStatus` is untouched, fixed the
  §2-before-§3 sequencing that would have made the loop worse, added the missing
  `exceptionUpsert` path and orphan cleanup, and added §0: the malformed value's
  source is an unvalidated LLM→CRDT hop (`extractionPrompt.ts:280` →
  `activityDuplicate.ts:110-118`).
- **Pass 3 (Sustainability)**: Cut the permanent `calendarPushRejections` CRDT
  collection, its Pinia store, its model type, its `planReconcile` fourth argument
  and its orphan-GC contract — a malformed time is a PURE FUNCTION of the activity,
  so the planner filters with a `blocked` set mirroring the existing `suppressed`
  idiom and the unpredicted residual memoises device-locally beside the two counters
  a prior Pass 4 already kept out of the CRDT. Verified Assumption 1 was false
  (`docOps.ts:96-102` writes a migration into every pod; `cache.ts:244` invalidates
  every family's snapshot). Turned §2 from a throw into a filter, which deletes the
  §2-before-§3 sequencing hazard outright; kept `resolveActivityDays` off the change
  list (22 render-path call sites); caught that adding `blocked` to `pushableIds`
  would DELETE the family's Google event via `reconcilePlan.ts:184-191`; dropped
  `activity_id_tail` and with it the entire six-artefact store-declaration gate in
  favour of the already-allowlisted `error_code`; aggregated the telemetry against
  the 50/surface/min cap; added the travel fields to §0; and split the work into
  A (parse-boundary validation), B (the bug fix) and C (the Settings hint).
- **Pass 4 (Fresh-eyes sweep)**: Confirmed the delete-loop safety claim against
  `reconcilePlan.ts:185` and the stuck-connection self-heal at
  `calendarSyncStore.ts:806-848`. Caught that `blocked` reaching `mastersById`
  (`:158`) silently arms `exceptionRestores` (`:220-222`) with a null master, which
  `applyExceptionRestore` (`:577-583`) answers by DELETING the exception link — the
  same data-loss class as `pushableIds`, on the path §3a's own wording invites.
  Closed four `pushBlockReason` false-positive holes (all-day activities with junk
  times, unsliced ymd fields, absent `endTime`/`endDate`) and added two missed 400
  vectors (`dayOffset` on the all-day branch, `recurrenceEndDate` → `UNTIL=`).
  Re-attributed the double-prefix bug from `createOrResurrect` to the token-provider
  latch (`googleCalendarClient.ts:167-174`) and required `kind`/`status` preservation
  in the rebuilt error. Found §0's travel citations point at prompt text, with the
  real coercion in a key-agnostic sweep at `:779`. Pinned the memo's two disjoint key
  spaces and its deliberate non-clearing on disconnect, named §4's two unstated
  imports and the no-plurals trap, and corrected seven `file:line` references.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Triage request

> before we move on, i wanted to run /error-review on the below messages which i'm
> seeing coming in from other families now - can yo uplease triage and let me know
> if these are genuine errors, especially if they are blocking these familes - and
> shyould they be fixed or are they noise and they shoiuld not trigger slack
> messages?
> [four Slack alerts: createPod.connectDrive, app.onboardingZombieState, and three
> calendar-sync "Invalid start time" firings]

### Approval

> yes please fix both, plan #3 with /beanies-plan

</details>
