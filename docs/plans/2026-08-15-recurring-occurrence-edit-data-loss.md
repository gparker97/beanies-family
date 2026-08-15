# Plan: Fix recurring-occurrence edit data loss + establish full recurring test coverage

> Date: 2026-08-15
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-08-15-recurring-occurrence-edit-data-loss.md`

> **No GitHub issue created.** This plan was approved for direct implementation. All prompt history is embedded under `## Prompt Log`.

## Outcome — third pass (second review)

A second `/code-review max` over the corrected implementation returned **3 findings, down from 15** — none of the twelve second-pass fixes was refuted. All 3 plus the 4 lower-value notes are fixed:

| Finding                                                                                                                                                                                                                                    | Resolution                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| The delete cascade tolerated `deleteOne` returning false but not THROWING — a throw escaped to `wrapAsync`, so `deleteActivity` reported failure after the master was already gone (caller showed "couldn't delete" over a deleted series) | Per-child `try/catch` in both cascade loops, each failure reported individually. The docblock's "report and continue" contract now actually holds |
| `deriveFromTemplate`'s `strippedKeys` — computed expressly so the strip list has "one source of truth" — was discarded at both call sites, and `activity-split` had no success counter                                                     | Both call sites now emit `recur_stripped_fields`; a success-path `series-split` event added (CLAUDE.md observability rule 6)                      |
| The `recurringStore` split-then-update test hand-rolled the same destructure it was testing, so it could not fail on the regression it named — the exact trap in `lessons.md` rule 4, added in this same change                            | Calls the real `recurringTemplateFields`; a second test pins the "ends on" edit applying                                                          |
| E2E `nth(1)` assumed the second weekly occurrence renders in the month grid — false when the series starts in the last week                                                                                                                | New `recurringSeriesStartStr()` falls back to the 1st when start+7 would overflow the month                                                       |
| `expect(override.recurrenceEndDate).toBeUndefined()` vacuous for that fixture                                                                                                                                                              | Removed; `daysOfWeek` is the load-bearing assertion, with the leak pinned properly in the store suite                                             |
| The `debug`→`warn` promotion made an expected, self-resolving deferral warn every poll forever and burn the 50/surface/min cap                                                                                                             | The master-not-yet-pushed case is back to `debug`; the genuinely-stuck no-instance case stays `warn`                                              |
| The regression suite left telemetry and the error reporter unmocked                                                                                                                                                                        | Both mocked, matching its sibling suite                                                                                                           |

**Third-pass gates:** type-check clean, lint 0 errors, **4370 unit tests pass**, Lambda allowlist drift guard green.

## Outcome — second pass (post-review)

A `/code-review max` pass over the first implementation found **eight regressions introduced by the fix itself**, two of them financial. All are fixed; the review's findings and their resolutions:

| Finding                                                                                                                                                                                        | Resolution                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `splitActivity` minted a SECOND recurring fee item (double billing) — `linkedRecurringItemId` was stripped while the fee fields were kept                                                      | Fee ownership now **transfers**: the id is carried to the new template and cleared from the end-dated original. Removed from `SPLIT_INVALID_KEYS`, kept in `OVERRIDE_INVALID_KEYS`                                         |
| Scope-`all` date delta corrupted MULTI-weekday series (move discarded, leading occurrence dropped)                                                                                             | Refused with a translated explanation; the delta applies only to single-weekday series                                                                                                                                     |
| AI "update existing" extraction discarded by the empty-diff early return                                                                                                                       | No baseline is taken when `props.sourcePhoto` is set — that flow's merged object is never persisted, so it must emit a full payload                                                                                        |
| `confirmReschedule` diffed against the TEMPLATE's date, so moving onto the series start silently no-oped                                                                                       | Base is now `props.occurrenceDate ?? activity.date`                                                                                                                                                                        |
| Stripping the completion arrays un-ticked a duty the family had done                                                                                                                           | `completionsForDerived` filters to the relevant date(s) and re-dates them when the session moves                                                                                                                           |
| `deleteChildrenFrom` selected by occurrence KEY, hard-deleting a session moved before the cut                                                                                                  | Selects by rendered date (`child.date`); the split's re-parent still uses the key, and both are documented                                                                                                                 |
| `isPaymentChange` bypass wrote the occurrence date onto the series template                                                                                                                    | Schedule fields dropped on that path                                                                                                                                                                                       |
| `recurringTemplateFields` discarded a deliberate "ends on" edit                                                                                                                                | Takes `originalEndDate`; an unchanged end date is dropped, a changed one applies                                                                                                                                           |
| Empty patch after sanitize still created a junk detached child                                                                                                                                 | Refused, reported, returns `null`                                                                                                                                                                                          |
| `splitActivity` end-dated BEFORE creating, with unchecked writes                                                                                                                               | Create first, end-date last, roll back the replacement if the end-date write fails                                                                                                                                         |
| Two silent-failure paths missed by the first sweep + `saveDraft`'s parallel orchestrator                                                                                                       | All bound and reported; `saveDraft` also strips `date` after a split                                                                                                                                                       |
| Occurrence seeding ungated → multi-day all-day activities showed the clicked day as their start                                                                                                | Seeding gated on `recurrence !== 'none'`                                                                                                                                                                                   |
| **My process misses**: store data-collection declarations never updated; the "this & all future" E2E still clicked `.first()`; counts string-interpolated into the closed-enum `recur_outcome` | Declarations updated in all three places; `openEditModal` takes an index and both recurring specs click the second occurrence; two numeric keys (`recur_children_removed`/`recur_children_expected`) added and allowlisted |

**Second-pass gates:** type-check clean, lint 0 errors, **4369 unit tests pass**, Lambda allowlist drift guard green. The regression suite now runs 22 tests, **21 of which fail on pre-fix `main`**.

**Deliberately still deferred** (verified, unchanged from the first pass): `overridesByParent` collapses duplicate children onto one key after a multi-device merge; `deleteOne` reassigns `activities.value` per child; the "Moved from" banner shows on a time-only reschedule; `saveDraft` remains a hand-rolled diff writing literal `null`s.

## Outcome

**Implemented in full on 2026-08-15.** All four stages landed. `npm run type-check` clean, `npm run lint` 0 errors, unit suite **4354 passed** (up from 4297 — 57 new tests), Lambda allowlist drift guard green.

Verification that the fix is real, not just green:

- The regression suite (`src/stores/__tests__/recurringOccurrenceRegression.test.ts`, 15 tests) was run against a stash of the pre-fix code: **14 of 15 fail on `main` for behavioural reasons** (no import errors, no renamed APIs). The 15th ("does not delete children when the master delete fails") passes on `main` only because `main` has no cascade at all — it guards the new ordering rather than a regression.
- `src/composables/__tests__/useActivityScopeEdit.test.ts` (16 tests) also fails wholesale on `main`, though partly because `src/utils/actionFailure.ts` does not exist there — a blunter signal, noted honestly.

**Deferred, deliberately out of scope** (verified real, recorded so they are not rediscovered as regressions):

1. Emptying `photoIds` never persists — `buildPayload` omits the key entirely when the list is empty. True before and after this change; the one-word fix alters create semantics and deserves its own change.
2. `calendarSyncStore` already ships two non-allowlisted context keys (`connectionId` at `:653`, `consecutiveFailures` at `:1008`), dropped with a console warning on every send. Pre-existing.
3. A parent activity's `linkedRecurringItemId` still points at the pre-split recurring item after `splitRecurringItem`.
4. `ActivityViewEditModal.saveDraft` remains a third hand-rolled diff (~120 lines). Collapsing it onto `diffPayload` is a clear win but a large mechanical refactor with its own regression surface.
5. `linkedRecurringItem.ts:70-73` reverts manual edits to asset/account-derived payment items on the next save.
6. `Transaction.recurring` (`models.ts:278-280`) is a dead field worth deleting.

**Assumption 3 (production data audit) — CLOSED 2026-08-15.** greg repaired the handful of affected activities by hand in his prod session. No migration is needed, and none was possible for this class anyway: an override sitting on the wrong date is indistinguishable from a deliberate reschedule programmatically, which is why this was always a manual check rather than a code task. The two classes that _can_ be detected are self-healed without a migration — a leaked `recurrenceEndDate` is ignored on read (`expandRecurring`), and a leaked `linkedRecurringItemId` is cleared on contact (`syncLinkedRecurringPayment`) — so any pod still carrying them repairs itself on next use.

## User Story

As a parent managing my family's recurring activities and bills, I want editing a single occurrence of a recurring series to change **only that occurrence** — leaving its date, the series, and any linked payment untouched — so that sessions never silently move, vanish, or corrupt the family's finances.

## Context

Greg reported that editing a recurring activity occurrence (changing pickup duty, category, or "who's going" — **without touching the date**) causes the activity to disappear from the date he clicked. Sometimes it reappeared a week earlier overlapping another instance of the same series; sometimes it could not be found at all.

A full investigation reproduced the bug and found it is not one defect but **three independent root causes** producing eight distinct failure modes, two of which are proven data loss and one of which corrupts recurring payments. The defect class also exists in recurring transactions.

### Root cause 1 — a full create-payload is reused as an update/override payload

`ActivityModal.buildPayload()` (`src/components/planner/ActivityModal.vue:514-558`) builds a complete create payload. It is reused verbatim as the _update_ payload for all three edit scopes. Because `onEdit` (`:264`) seeds the form's `date` from `activity.date` — the **series start** — while the banner at `:727` displays `props.occurrenceDate` (the day the user clicked), the modal shows two different dates and the user only ever sees the banner.

`useActivityScopeEdit.ts:61` then passes that payload whole to `materializeOverride`, and `activityStore.ts:749-758` computes:

```ts
const finalDate = overrides?.date ?? occurrenceDate; // = series start date
const isRescheduled = finalDate !== occurrenceDate; // = true, falsely
```

**Proven by execution** (weekly series from 2026-03-04, clicked the 2026-04-01 occurrence, changed only the pickup person):

```
child.date               = 2026-03-04   ← lands on the series start
child.originalOccurrence = 2026-04-01   ← the slot it now suppresses
```

`overridesByParent` (`activityStore.ts:55-68`) suppresses the clicked slot, so the occurrence disappears; the edited copy renders on the series start date overlapping the first instance. This exactly matches the report.

### Root cause 2 — `materializeOverride` / `splitActivity` trust their callers

`materializeOverride` (`activityStore.ts:740-758`) strips `recurrence`/`daysOfWeek`/`recurrenceEndDate` from the **parent** spread, but `...overrides` is spread _after_ it and only `date` and `recurrence:'none'` are re-forced. The form's `recurrenceEndDate` and `daysOfWeek` therefore land on the child unopposed.

`expandRecurring` (`activityStore.ts:150-155`) applies the end-date cut **before** the `switch (activity.recurrence)`, so it prunes `recurrence:'none'` children too.

**Proven by execution** (series ends 2026-03-31; move the 2026-03-11 occurrence to 2026-04-07):

```
child.recurrenceEndDate = 2026-03-31   ← leaked from the form
occurrences on 2026-04-07 (target) = 0
occurrences on 2026-03-11 (origin) = 0
```

The activity is gone from both dates. This is the "couldn't find it at all" case — total data loss.

The same spread also clones `linkedRecurringItemId`. `createActivity` (`activityStore.ts:632-635`) unconditionally calls `syncLinkedRecurringPayment`, which passes `existingItemId: <the parent's payment item>` with the child's data. Because the child is `recurrence:'none'`, `isOneTimePayment` is true (`:512-516`), so `syncEntityLinkedRecurringItem` (`src/utils/linkedRecurringItem.ts:53-73`) **rewrites the family's monthly fee item in place** into a one-time payment re-dated to that occurrence, repointed at the child. The recurring fee stops generating. This fires on reschedule, cancel-one, and inline edit — it is store-level and **independent of the form bug**, so fixing the form does not fix it.

**Re-verified during review pass 2:** `updateActivity` (`activityStore.ts:648`) calls `syncLinkedRecurringPayment(result)` on exactly the same unconditional terms. Guarding only `createActivity` (as the pass-1 draft proposed) leaves the hijack fully reachable through the requirement-6 child reschedule and the requirement-7 idempotent re-materialize. The guard belongs inside `syncLinkedRecurringPayment` — the single choke point both paths share.

**Re-verified during review pass 4 — the leak has a second blast radius.** `TransactionsPage.vue:742` resolves a recurring item's owning activity with `activityStore.activities.find((a) => a.linkedRecurringItemId === id)`. A legacy child carrying the master's `linkedRecurringItemId` can win that `.find()`, so deleting the recurring item clears the **child's** field and leaves the **master** pointing at a deleted item. Preventing new leaks is not enough; existing ones must be neutralised on contact (see 2e).

`splitActivity` (`:713-725`) inherits the same fields plus `vacationId` (producing an undeletable activity — `deleteActivity:658-666` refuses vacation-linked deletes) and the parent's completion arrays.

### Root cause 3 — occurrence identity is not preserved across a child reschedule

`ActivityViewEditModal.confirmReschedule` (`:779`) branches on `isRecurring` = `recurrence !== 'none'`. An override child is always `'none'`, so it falls to `:801`'s plain `updateActivity({date})`, which never preserves `originalOccurrenceDate`. `overrideOccurrenceYmd` (`src/utils/calendar/overrideOccurrenceYmd.ts:18`) then falls back to `child.date`, silently moving the child's occurrence key.

This single line drives three symptoms: the master's original slot un-suppresses (the session **duplicates** instead of moving); two children can collide on one occurrence key and fight over a single Google instance; and `applyExceptionRestore` (`calendarSyncStore.ts:449-465`) anchors its restore to the now-wrong `exceptionOriginalYmd`, strands an event on the wrong day in Google, and deletes the only link that could correct it.

**Critically, this is currently masked by root cause 1** — which spuriously stamps `originalOccurrenceDate` on every child. Fixing root cause 1 alone would _expose_ it. The two must land together.

### Structural gaps around the series lifecycle _(pass-4 findings)_

Two paths break the parent↔child relationship in ways the pass-3 plan did not cover. Both are the same shape as requirement 8 (orphan cascade) and both are fixed with the same two primitives (`overridesByParent`, `deleteOne`), so they belong here rather than in a follow-up.

- **`splitActivity` abandons its children.** Verified: it end-dates the original, creates a new template, and never touches `parentActivityId` on any child. A child whose occurrence key is on/after the split date still points at the _original_ template — which no longer expands to that date, so its suppression does nothing — while the **new** template freshly generates that occurrence. The user sees their edited session **and** an unedited duplicate on the same day. (Contrast `recurringStore.splitRecurringItem:231-238`, which _does_ re-link its materialised transactions — the activity path is simply missing the equivalent step.)
- **"Delete this and all future" abandons its children.** `useActivityScopeEdit.ts:101-109` and `ActivityViewEditModal.vue:655-664` both implement this scope as `updateActivity(master, { recurrenceEndDate: dayBefore })` and nothing else. Override children on/after the cut are `recurrence:'none'` one-offs, so the end date does not touch them: the user deletes "this and all future" and every session they had previously edited stays on the calendar.

### Independent calendar-sync defects

- **`applyExceptionUpsert` has no `not_found` recovery** (`calendarSyncStore.ts:413-422`) — the only one of the three apply paths lacking it (`applyUpsert:325-333` and `applyExceptionRestore:457-464` both recover). Requires a stale instance id **and** a child-side hash change (`computeExceptionHash` contains nothing from the master, so a master-only change short-circuits at `:365`). Once both land it retries forever: `status:'error'` is not a poll gate and `shouldSkipForFreshness:268` explicitly does not skip the device's own claim. Feeds the Slack sustained-error counter.
- **No orphan cascade on series delete** — zero delete-side handling of `parentActivityId` repo-wide (verified: the only reads are `activityStore.ts:54-68`, `reconcilePlan.ts:91-99,144-146`, `activityDuplicate.ts:58`, `GlobalSearch.vue:105`, `ActivityViewEditModal.vue:493,674` — none on a delete path). Reachable unguarded from `useActivityScopeEdit.ts:111-121`, `ActivityViewEditModal.vue:669`, `FamilyPlannerPage.vue:635`, `FamilyNookPage.vue:158`. Children survive as in-app ghosts that can never sync (`reconcilePlan.ts:99` excludes them from the master path; `:145-146` skips them when the parent is gone).
- **No uniqueness guard on `(parentActivityId, occurrenceYmd)`** at any layer — not at creation, not in `planReconcile:143-159`, not in `recordLink`. Two children resolve to the same Google instance; last writer wins and exceptions never re-assert on a verify pass (`:353-355`), so the divergence is permanent.

### The same defect class in recurring transactions

- **`this-and-future` clobbers the split** — `TransactionsPage.vue:677` overwrites `splitRecurringItem`'s correct `startDate` with the form's template-seeded value (`TransactionModal.vue:195,567`), and also carries `endDate` (`:568`) and `lastProcessedDate` (`:570`), the latter suppressing materialisation of the new segment (`recurringProcessor.ts:92-93`).
- **`delete this and all future` silently does nothing** — `TransactionsPage.vue:796-799` writes `recurrenceEndDate`, a field that **does not exist on `RecurringItem`** (`models.ts:329-345` has `endDate`; `recurrenceEndDate` is an activity field at `:729`). An `as any` cast defeats the type check and `recurringProcessor.ts` checks only `endDate` (lines 41, 101, 130, 334). The materialised rows are deleted, the series is never end-dated, and the processor regenerates them forever. A user cancelling a recurring bill watches it come back. The same block also silently no-ops when `item` is not found (`:795`, no `else`).

The transactions **`this-only`** path is immune by construction — `TransactionsPage.vue:602-617` (`recurringToTransactionFields`) whitelists fields, omits every date field, and sets `date: projectedDate` explicitly at `:669`. `recurringStore.splitRecurringItem` (`:216-229`) uses the same explicit-field discipline. **That whitelist is the existing, proven shape and the model for the transactions fix — a diff utility is neither needed nor safe there** (see Approach → Transactions).

> **Pass-4 correction to the pass-3 design.** `splitRecurringItem`'s create call lists only nine fields and **omits** `loanId`, `activityId`, `goalId`, `goalAllocMode`, and `goalAllocValue`. The post-split update at `:677` is therefore the _only_ thing that restores those links, so a kept-field whitelist there that misses one silently drops it on every split. The post-split helper must be an **omit**, not a keep-list — see Transactions below.

### Surfaces confirmed immune (no action)

Beanie Lists, duty completions, medications, helpful-hint todos, todos, budget, goals, holidays, vacations, scheduled reminders, overlap acknowledgements, the onboarding recurring flow, and the calendar-sync layer itself (a faithful derivation — it amplifies corrupt data but originates none).

### Age and coverage

The occurrence banner landed in `529d2547` (2026-03-09) — it added the banner reading `occurrenceDate` but never changed the form seeding at `:264`. The bug has shipped for roughly five months.

Coverage is effectively zero: **no test file exists** for `useActivityScopeEdit`, `useRecurringEditScope`, `ActivityModal`, or `ActivityViewEditModal`. The store tests are correct but test a contract the form never satisfies (`activityStore.test.ts:1321` passes `{ startTime: '16:00' }` with no `date` key). The E2E test at `e2e/specs/planner.spec.ts:202` is **structurally incapable** of catching this: `createRecurringActivity` starts the series tomorrow and the test clicks `.first()`, so template start and clicked occurrence are the same value. Its `this-and-future` sibling at `:263` asserts only `toBeTruthy()` on the date.

## Requirements

1. Editing a single occurrence via the full form, without touching the date, must create an override on **the clicked date**, with `originalOccurrenceDate` unset.
2. The full form must never write fields the user did not change. Untouched fields must not reach the update/override/split payload.
3. The form's date field must display the occurrence being edited, not the series start.
4. An override child must never carry series-level fields: `daysOfWeek`, `recurrenceEndDate`, `linkedRecurringItemId`, `parentActivityId`-derived completions, or `vacationId`.
5. An override child must never trigger linked-recurring-payment sync — **on create or on update** — and a child found already carrying a leaked `linkedRecurringItemId` must have it cleared on contact.
6. Rescheduling an existing override child must preserve its `originalOccurrenceDate` (its occurrence key must not move).
7. `materializeOverride` must be idempotent per `(parentActivityId, occurrenceYmd)` — a second call for the same key updates the existing child rather than creating a duplicate, **must not revert changes the first call made, and must not move a child the first call rescheduled**.
8. Deleting a recurring series must cascade-delete its override children. **Splitting a series must re-parent the children on/after the split date to the new template, and end-dating a series via "this and all future" must delete the children on/after the cut.**
9. `applyExceptionUpsert` must recover from `not_found` by clearing the stale instance link and deferring, rather than throwing every poll.
10. `splitActivity` must not clone `linkedRecurringItemId`, `vacationId`, completion arrays, or `originalOccurrenceDate` onto the new template.
11. Recurring-transaction `this-and-future` must not overwrite the split's `startDate`, nor inherit `endDate`/`lastProcessedDate` — **and must not drop the goal/loan/activity links the split does not copy**.
12. Recurring-transaction `delete this and all future` must set `endDate` (the real field) and the `as any` cast must be removed.
13. Deliberate user edits must still work: changing the date at `this-only` scope reschedules that occurrence; changing the recurrence end date at `this-and-future` scope must apply (today it is silently discarded by `useActivityScopeEdit.ts:69-73`).
14. **No behavioural regression from the minimal-diff change.** Specifically, the eager-create emit path and the add/remove-payment detection in `FamilyPlannerPage` must keep working under a payload that omits untouched keys (see Important Notes).
15. Every failure introduced or touched by this change must surface a translated, actionable message and a structured report — no `console.warn`-only paths, no ignored `null` returns.
16. Full, meaningful automated test coverage across all recurring functionality — see `## Testing Plan`.

## Recurring Invariants

_(Added in pass 3, extended in pass 4. These are the durable rules this change restores. Each is enforced by code in one place and pinned by a named test, so a future contributor cannot re-break it by accident. Reference this section from the code comments at each enforcement point.)_

1. **An override child is a leaf.** It never carries series-level state: `recurrence` is always `'none'`, and `daysOfWeek`, `recurrenceEndDate`, `linkedRecurringItemId`, `vacationId`, and the parent's completion arrays never appear on it. _Enforced:_ `OVERRIDE_INVALID_KEYS` re-forced **after** the caller's overrides in `materializeOverride`. _Pinned:_ a store test that iterates the exported key list, so adding a series-level field to the model without adding it to the list fails.
2. **An override child is never a payment owner.** Fee sync is a series-level concern. _Enforced:_ the early return in `syncLinkedRecurringPayment` — the single choke point shared by `createActivity` and `updateActivity` — which also clears a leaked id it finds on the way out.
3. **The split owns the schedule.** After `splitActivity` / `splitRecurringItem`, no caller may write `date`/`startDate`, `endDate`/`recurrenceEndDate`, or `lastProcessedDate` from a form payload. _Enforced:_ the `this-and-future` branch strips `date`; `recurringTemplateFields` omits the three schedule fields.
4. **An occurrence key never moves.** `overrideOccurrenceYmd(child)` must return the same value for the life of the child. _Enforced:_ `confirmReschedule` carries `originalOccurrenceDate` on every child update; `materializeOverride`'s idempotent branch writes `date` **only** when the caller passed one.
5. **`undefined` clears, `null` never appears.** A cleared field is written as `undefined` (which `automergeRepository.update` deletes); `null` and `''` are normalised to `undefined` before they reach the store. _Enforced:_ `diffPayload`.
6. **Absent means "untouched", not "cleared".** Any consumer inferring intent from a missing key is a bug. _Enforced:_ presence checks (`'k' in obj`) at every such consumer; today that is `FamilyPlannerPage`'s payment detection.
7. **A child's parent is the template that owns its occurrence** _(pass 4)_. Whenever a series is split, the children on/after the split date move to the new template; whenever a series is deleted or truncated, the children it owned go with it. _Enforced:_ the re-parent step in `splitActivity` and the cascade in `deleteActivity` / the two `this-and-future` delete branches. _Pinned:_ a split-with-children test asserting exactly one occurrence renders on the split date.

## Important Notes & Caveats

- **Ordering trap:** requirement 1 and requirement 6 must land in the same change. Fixing the form alone un-masks the child-reschedule bug and converts a "moves" bug into a "duplicates" bug. See `## Implementation Sequencing` — they are both in stage 2.
- **`automergeRepository.update` deletes keys that are present but `undefined`** (`src/services/automerge/automergeRepository.ts:87-99` — it iterates `Object.keys(rawInput)` and collects the `undefined` ones into `keysToDelete`), while `createWithId` strips them (`:70-79`). A minimal-diff helper must therefore distinguish "field absent" (leave alone) from "field explicitly cleared" (include as `undefined` so the key is deleted). Getting this wrong silently breaks every "clear this field" interaction.
- **`null` is NOT a clear — it is a stored value.** `stripUndefined` (`automergeRepository.ts:12-13`) filters only `undefined`, and `toPlain`'s `JSON.parse(JSON.stringify(...))` preserves `null`. Existing hand-rolled deltas in `ActivityViewEditModal.confirmReschedule` (`:783-790`, `:805-812`) and `saveDraft` write `null` for cleared fields, so nulls are persisted into the doc today. `diffPayload` must normalise `null` **and** `''` in the _next_ value to `undefined`, and `confirmReschedule` must adopt it so all consumers agree on one convention (invariant 5).
- **The diff baseline is the form's own payload, not the entity** _(pass-3 change)_. `buildPayload()` derives values the entity does not store identically — `payFromAccountId: ''` (`:546-547`), `feeSchedule: 'none'` when `hasCost` is false, the legacy `assigneeId` mirror (`toAssigneePayload`), `daysOfWeek` only for `weekly`. Diffing the payload against `props.activity` would make correctness depend on those two derivations staying in lockstep forever, and — because 3a re-seeds `date` from `occurrenceDate` — would emit `date` on _every_ recurring occurrence edit. Instead, snapshot `buildPayload()` once after the edit form is populated and diff `buildPayload()` against that snapshot. The diff then literally means "what the user changed in this form session", which is exactly requirement 2.
- **`useFormModal` watches `open` only, never the entity** _(pass-4 verification, `src/composables/useFormModal.ts:21-28`)_. `onEdit` therefore fires exactly once per open transition and a mid-open `props.activity` swap does **not** re-populate the form. This is what makes "one baseline per open" correct and complete — do not add an entity watcher to keep the baseline "fresh".
- **The eager-create emit path falls out of the baseline** _(pass-3 simplification)_. `ActivityModal.handleSave` (`:681-693`) emits the _update_ shape whenever `eager.entityId` is set — which includes a brand-new activity eagerly created only to attach a photo, where `props.activity` is `null`. With a baseline snapshot, `onEdit` never ran for that case, so the baseline is `null` and the full payload is emitted with no extra gate. **The rule is one line: no baseline → no diff.** Do not add a second, parallel `props.activity` check.
- **`createdBy` is destructured off the DIFF, not the payload** _(pass-4)_. Today `handleSave` does `const { createdBy: _omit, ...updateData } = payload`. After the change the emitted object is the diff, so the destructure must move onto it — otherwise `createdBy` rides along into an update whenever the current member changed mid-session.
- **The diff changes the meaning of "absent" for `FamilyPlannerPage`'s payment detection.** `FamilyPlannerPage.vue:483-487` reads `!data.data.payFromAccountId` as "removing payment". Under a diff, an untouched `payFromAccountId` is absent, so _every_ occurrence edit of a paid activity becomes a false "remove" — which deletes all generated transactions (`:491-495`) **and** routes the save around the scope modal into a template-wide update (`:498-501`). Both detections must derive from **one** named presence check (invariant 6) — not two independently-written `in` expressions, which is precisely how `FamilyNookPage` drifted.
- **Emptying `photoIds` does not persist — before or after this change** _(pass-4, documented so it is not misattributed to the diff)_. `buildPayload` spreads `...(binding.photoIds.value.length ? { photoIds } : {})`, so removing the last photo **omits the key entirely** rather than emitting an empty array. The full payload has always omitted it too, so the diff introduces no regression. Recorded as a follow-up in `docs/lessons.md`; **out of scope** — the one-word fix changes create semantics (a stored `photoIds: []`) and deserves its own change.
- **The `daysOfWeek` watcher** (`ActivityModal.vue:359-369`) rewrites `daysOfWeek` whenever `date` changes. Re-seeding `date` from `occurrenceDate` will fire it during population and corrupt the series' weekday set. Suppress it by adding a second flag to the **existing** `props.open` suppression watcher (`:372-384`) — do not add a parallel watcher. This works because Vue's default (`'pre'`) watchers are queued, not synchronous: `onEdit`'s field assignments queue the `date`/`startTime` callbacks, and the suppression watcher — registered later on the same `props.open` source — sets the flags before that queue flushes. The baseline snapshot must be taken in the same `nextTick` **after** the flags are released, so watcher-settled values are part of the baseline rather than showing up as user changes.
- **Do not "simplify" `resetOccurrenceToSeries`** into `updateActivity({isActive:false})` — the existing comment at `activityStore.ts:685-694` explains why the delete-to-restore mapping is deliberate. Note it routes through `deleteActivity`, so the new cascade must be a no-op for a child (it is: `overridesByParent.get(childId)` is empty).
- **`payFromAccountId: ''`** is emitted rather than `undefined` (`ActivityModal.vue:546-547`), so it is stored rather than deleted. This is what makes the `enabled=false` delete branch in `linkedRecurringItem.ts:34-39` fire on paths that never touched the fee UI. `diffPayload`'s `''`↔`undefined` normalisation neutralises it for the edit path.
- **`FamilyNookPage.vue:134-139` has no payment guard**, unlike `FamilyPlannerPage.vue:483-501`. That asymmetry is itself a latent bug and is resolved here by making the **store** safe (invariant 2), not by copying the guard.
- **Idempotency is best-effort and local** _(pass-3 clarification)_. `overridesByParent` is an in-memory computed over this device's projection. Two devices can still materialise two children for one occurrence key concurrently; CRDT merge keeps both. This change makes the _single-device_ duplicate impossible and makes the multi-device case **visible** (the `activity-override` event + the duplicate-key test), but a durable uniqueness constraint is out of scope. Do not describe requirement 7 as a uniqueness guarantee in code comments.
- **`splitRecurringItem` does not copy the link fields** _(pass-4)_. Verified at `recurringStore.ts:216-229`: the new item is created without `loanId`, `activityId`, `goalId`, `goalAllocMode`, or `goalAllocValue`. The post-split `updateRecurringItem` is the only thing that puts them back, which is why the helper feeding it must **omit three fields** rather than **keep a list**. Separately, the parent activity's `linkedRecurringItemId` still points at the **old** item after a split — a real gap, **out of scope**, recorded as a follow-up.
- **Do not widen scope into `linkedRecurringItem.ts:70-73`** (asset/account-derived payment items silently reverting manual edits) or deleting the dead `Transaction.recurring` field (`models.ts:278-280`). Both are real but out of scope; note them for follow-up.
- **`ActivityViewEditModal.saveDraft` is a third hand-rolled diff** (~120 lines of `if (val !== cur) { update.x = val; changed = true }`). Collapsing it onto `diffPayload` is a clear win but is a large mechanical refactor with its own regression surface. **Out of scope for this change; recorded as a follow-up in `docs/lessons.md`.** The `null`-convention fix in `confirmReschedule` is in scope because that path is directly implicated in root cause 3.
- **Google exceptions never re-assert on a verify pass** (`calendarSyncStore.ts:353-355`). Any state that diverges in Google stays diverged. Fixes must therefore prevent divergence rather than rely on self-healing.
- **`applyExceptionUpsert` discovers the instance id exactly once — by design** _(pass-3 finding)_. The comment at `calendarSyncStore.ts:375-377` states it explicitly: _"a moved instance would fall outside an original-date re-window, so we must not re-discover."_ The `not_found` recovery must therefore **not** re-run discovery inline; see Layer 4.
- **`calendarSyncStore` already ships non-allowlisted context keys** _(pass-4, out of scope)_. `:653` and `:1008` pass `connectionId` / `consecutiveFailures`, neither of which is in `ALLOWED_CONTEXT_KEYS`, so they are dropped with a `console.warn` on every send. Not caused by this change; recorded as a follow-up so the new `recur_*` keys are not blamed for the existing noise.
- **E2E budget.** ADR-007 caps the suite at 25 (`docs/adr/007-testing-strategy.md:56`); `e2e/specs/` currently holds 21 tests across 7 files (verified: cross-entity 7, planner 5, invite-join 3, financial-data 2, google-drive 2, setup-flow 1, trusted-device 1), so there is headroom — but the discipline still applies: strengthen the two existing recurring specs rather than add.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. The intended semantics of "just this item" is: change only this occurrence, leaving its date where the user clicked unless they explicitly edit the date field.
2. Changing the date field at `all` scope on a recurring series is intended to move the whole series (re-anchoring its weekday/monthly rule accordingly), not just one occurrence. **The delta must be computed against the clicked `occurrenceDate`, not the template's start date** — the form now shows the occurrence, so the user's mental "move" is relative to what they saw. _(Weekday consistency is preserved automatically: shifting the template date and the occurrence date by the same delta yields the same weekday, so the form's watcher-updated `daysOfWeek` matches the moved template. This is load-bearing — see the test in Testing Plan §3.)_
3. No production data has already been corrupted in a way that requires a migration. **This needs verification before shipping** — see the Testing Plan's data-audit step. Overrides created since 2026-03-09 may already sit on wrong dates, and payment items may already have been rewritten.
4. `.beanpod` files in the wild may contain override children carrying leaked `recurrenceEndDate`/`linkedRecurringItemId`. The fix must be tolerant of these on load, not just prevent new ones — and, for `linkedRecurringItemId`, must actively neutralise them (see 2e), because a leaked id is not merely inert: it can win `TransactionsPage.vue:742`'s `.find()`.
5. Greg's on-device iOS App Review work (demo video + Guideline 2.1 reply on `0.9.10R6`) takes priority over shipping this; this plan does not assume an immediate deploy slot.

## Approach

Four layers. Each is independently testable, and the store layer is written so it is safe **regardless of caller** — the durable protection against this defect class recurring.

### Layer 1 — one minimal-diff utility (new), used only where a diff is the right tool

New `src/utils/diffPayload.ts`. **Verified there is no existing equivalent** — no `diff`/`changedFields`/`isEqual`/`omit`/`pick` helper exists anywhere under `src/`. The nearest relatives are domain-specific and deliberately not generic: `buildAccountDetailsPatch` (`src/utils/accountDetails.ts:135-186`, always-write-every-key), `mergeExtractionIntoActivity` (`src/utils/activityDuplicate.ts`, blank-fill only), and `recurringToTransactionFields` (`TransactionsPage.vue:602-617`, whitelist).

```ts
/**
 * Fields present in `next` whose value differs from `original`.
 *
 * `original` and `next` MUST be the same shape (both form payloads, or both
 * entity slices) — this is a field-by-field comparison, not a semantic merge.
 *
 * Conventions (must match automergeRepository — see its :12-13 and :87-99):
 *  - absent from `next`            → omitted (field left untouched)
 *  - present and equal to original → omitted
 *  - present and different         → included
 *  - present as '' / null / undefined, with a value in `original`
 *                                  → included as `undefined` so the key is DELETED
 *    (`null` would be persisted as a null literal — never emit one)
 *  - arrays compared by VALUE, element-wise (daysOfWeek, assigneeIds, photoIds)
 */
export function diffPayload<T extends object>(original: T, next: Partial<T>): Partial<T>;
```

**Complexity budget** _(pass 3)_. This stays ~30 lines: scalars by `===`, arrays by length + element-wise `===`, everything else by `JSON.stringify` fallback. **No deep-equal dependency, no nested-object semantics, no key-ordering guarantees for objects.** Activity and reschedule payloads contain only scalars and flat arrays; that limit is documented in the JSDoc and asserted by a test so nobody grows this into a general object-diff library. If a future payload needs nested-object diffing, that is a design smell in the payload, not a missing feature here.

**Implementation note:** a cleared field must be _assigned_ (`out[k] = undefined`), never omitted — `automergeRepository.update` keys its delete list off `Object.keys`, and `FamilyPlannerPage`'s payment predicate keys off `in`. Both depend on the key being present.

Consumers in this change: `ActivityModal.handleSave` (payload-vs-baseline-payload) and `ActivityViewEditModal.confirmReschedule` (payload-vs-entity-slice, four 1:1 fields). **Not** `TransactionModal` (see Transactions below).

### Layer 2 — make the activity store safe regardless of caller

All in `src/stores/activityStore.ts`.

**2a. One clone-and-strip helper, one key list** _(pass-3 revision — the override list is now derived from the split list, so the two cannot drift)_. `splitActivity` (`:713-721`) and `materializeOverride` (`:743-751`) currently each hand-roll `JSON.parse(JSON.stringify(x))` plus a destructure. Extract a single module-local:

```ts
/** Fields a derived activity (split template or override child) must never
 *  inherit from its template. See Recurring Invariants 1 & 3. */
export const SPLIT_INVALID_KEYS = [
  'id',
  'createdAt',
  'updatedAt',
  'recurrenceEndDate',
  'linkedRecurringItemId',
  'vacationId',
  'dropoffCompletions',
  'pickupCompletions',
  'originalOccurrenceDate',
  'parentActivityId',
] as const satisfies readonly (keyof FamilyActivity)[];

/** An override child is a LEAF: everything a split strips, plus the series rule. */
export const OVERRIDE_INVALID_KEYS = [
  ...SPLIT_INVALID_KEYS,
  'recurrence',
  'daysOfWeek',
] as const satisfies readonly (keyof FamilyActivity)[];

/** Plain deep-clone of a template minus `strip`, plus the names actually removed
 *  (drives the `recur_stripped_fields` telemetry — one list, one source of truth). */
function deriveFromTemplate(
  template: FamilyActivity,
  strip: readonly (keyof FamilyActivity)[]
): { payload: CreateFamilyActivityInput; strippedKeys: string[] };
```

The `keyof FamilyActivity` constraint means renaming a model field breaks type-check rather than silently disabling a strip. The typed `payload` return (not `Record<string, unknown>`) keeps `as any` out of the call sites. Both constants are **exported** so the store tests can iterate them (see Testing Plan §3).

**2b. `materializeOverride`** — re-force the invalid keys **after** the `...overrides` spread (today only `date` and `recurrence` are re-forced), so a leaking caller cannot win. Concretely: apply `overrides`, then delete every `OVERRIDE_INVALID_KEYS` entry that survived, recording which ones did for telemetry; then set `date`, `recurrence:'none'`, `parentActivityId`, and `originalOccurrenceDate` only when `finalDate !== occurrenceDate`.

**2c. Idempotency (requirement 7) reusing the existing computed.** `overridesByParent` (`:54-68`) already maps parent → `Set<occurrenceYmd>`. Widen its value to `Map<occurrenceYmd, FamilyActivity>` and use `.has(...)` for suppression, so lookup and suppression share one computed rather than adding a second scan. The only read site is `:208` (verified repo-wide: the sole other mentions are a comment at `:689`, the test file, and the util's own docblock), which becomes `.has(...)` on the map. When two children collide on one key the map keeps the last — acceptable and documented; the duplicate is surfaced by telemetry, not silently merged.

> **The idempotent patch is the sanitized `overrides` only — never the parent-derived payload** _(pass-3 correction)_. Re-deriving from the parent would silently revert every field the first override changed — reintroducing data loss inside the data-loss fix.
>
> **And the date must be resolved separately on that branch** _(pass-4 correction — this is a second data-loss hole)_. Reusing the create branch's `finalDate = overrides?.date ?? occurrenceDate` on an **existing** child snaps a previously-rescheduled child back to its original slot the moment any unrelated edit re-materializes it. The update branch must write `date` **only when the caller explicitly passed one**:
>
> ```ts
> const patch = sanitize(overrides); // OVERRIDE_INVALID_KEYS strip (incl.
> // originalOccurrenceDate + parentActivityId)
> if (overrides && 'date' in overrides && overrides.date) {
>   patch.date = overrides.date;
>   // First move of a not-yet-moved child: pin the occurrence key (Invariant 4).
>   if (!existing.originalOccurrenceDate && overrides.date !== occurrenceDate) {
>     patch.originalOccurrenceDate = occurrenceDate;
>   }
> }
> await updateActivity(existing.id, patch); // NOT the deriveFromTemplate payload
> ```
>
> `sanitize()` is the same `OVERRIDE_INVALID_KEYS` strip applied in 2b, so a leaking caller is blocked on this path too. The create path keeps `{...derived, ...sanitized(overrides)}` with the existing `finalDate` resolution. Covered by two explicit tests: "second materialize preserves the first edit" and "second materialize does not move a rescheduled child".

**2d. `splitActivity`** — use `deriveFromTemplate(original, SPLIT_INVALID_KEYS)`, then set `date: fromDate` and `recurrenceEndDate: original.recurrenceEndDate`.

**2d-bis. `splitActivity` re-parents its children** _(pass-4, requirement 8 / invariant 7)_. After the new template is created, move every child whose occurrence key is on/after `fromDate` onto it:

```ts
for (const [ymd, child] of overridesByParent.value.get(activityId) ?? []) {
  if (ymd >= fromDate) await updateActivity(child.id, { parentActivityId: newTemplate.id });
}
```

Mirrors `recurringStore.splitRecurringItem:231-238`, which already re-links its materialised transactions — the activity path is simply missing the equivalent step. Without it the child suppresses an occurrence the old template no longer produces while the new template produces an unsuppressed one, so the split-date session **duplicates**. `ymd >= fromDate` is a safe lexicographic compare on `YYYY-MM-DD`, the same form used at `TransactionsPage.vue:802`. Uses the store's own `updateActivity` (one field, no fee-sync risk — the child is guarded by 2e).

**2e. The payment-sync guard goes in `syncLinkedRecurringPayment` (`:508`), not in `createActivity`.** Both `createActivity:634` and `updateActivity:648` call it unconditionally; guarding only the former leaves the hijack reachable via the requirement-6 reschedule and the requirement-7 re-materialize. First statement becomes an early return when `activity.parentActivityId` is set — an override is never a payment owner (invariant 2). This also makes `FamilyNookPage`'s missing guard harmless.

> **The guard self-heals a legacy leak on its way out** _(pass-4, assumption 4)_. If the child it is refusing to sync carries a `linkedRecurringItemId`, clear it before returning — using `activityRepo.updateActivity` directly plus the in-memory map update, exactly the shape already at `:542-545`, so there is no re-entry into the store action:
>
> ```ts
> if (activity.parentActivityId) {
>   if (activity.linkedRecurringItemId) {
>     await activityRepo.updateActivity(activity.id, { linkedRecurringItemId: undefined });
>     activities.value = activities.value.map((a) =>
>       a.id === activity.id ? { ...a, linkedRecurringItemId: undefined } : a
>     );
>     logEvent({
>       surface: 'activity-fee-sync',
>       level: 'warn',
>       context: { action: 'cleared-leaked-link-on-child' },
>     });
>   }
>   return;
> }
> ```
>
> Inert-looking data is not inert here: `TransactionsPage.vue:742` finds a recurring item's owning activity by scanning `linkedRecurringItemId`, and a leaked child can win that scan — clearing the child's field while the **master** keeps pointing at a now-deleted item. One repo write, once per affected child, then never again.

**2f. `syncLinkedRecurringPayment` gets its own try/catch.** It is `await`ed **outside** `wrapAsync` in both callers, so today a fee-sync throw rejects the caller's save _after_ the activity was already written — a partial failure with no attributed toast. Wrap the body: on throw, `reportError({ surface: 'activity-fee-sync', severity: 'error', … })` and return; the activity write itself already succeeded and must not be reported as a failure.

**2g. `deleteActivity` cascade + honest guard** _(pass-3 revision — ordering, no recursion, one loading state)_.

- Extract an internal `deleteOne(id)` that does the repo delete + in-memory filter + `listStore.clearLinksFor` (today's inner body). `deleteActivity` then runs **one** `wrapAsync` containing: `deleteOne(master)` → if it succeeded, loop `deleteOne(child)` over `overridesByParent.get(id)?.values()`.
- **Master first, children second.** If the master delete fails we abort with nothing lost. Children-first would mean a failed master delete has already destroyed the user's edited occurrences — strictly worse. If a _child_ delete fails after the master is gone, report it (`activity-series-delete` with the shortfall) and continue the loop; the residue is today's status quo, not a new failure.
- **No recursion.** `deleteActivity` must not call itself for children — that re-enters `wrapAsync`, flickers `isLoading`, and would recurse if a child ever gained a child. `deleteOne` is the shared leaf. (It is also why `resetOccurrenceToSeries` → `deleteActivity(childId)` stays a plain single delete: a child has no entry in `overridesByParent`.)
- Separately, replace the bare `console.warn` at `:661-665` (vacation-linked refusal — user taps delete, nothing happens, nothing reported) with the shared session-action failure reporter from Layer 3d.

**2g-bis. `deleteChildrenFrom(masterId, fromYmd)`** _(pass-4, requirement 8 / invariant 7)_. A tiny exported action beside the cascade, reusing the same `deleteOne` leaf and the same `overridesByParent` lookup, returning the number reaped:

```ts
/** Reap override children on/after `fromYmd` when a series is truncated.
 *  "Delete this and all future" end-dates the master, which does NOT touch
 *  children (they are `recurrence:'none'` one-offs). See Invariant 7. */
async function deleteChildrenFrom(masterId: string, fromYmd: ISODateString): Promise<number>;
```

Called from **both** `this-and-future` delete branches — `useActivityScopeEdit.ts:101-109` and `ActivityViewEditModal.vue:655-664` — immediately after the `recurrenceEndDate` write succeeds. One implementation, two call sites, no duplicated loop. Fires `activity-series-delete` with `recur_orphans_removed`.

**2h. Defensive read path.** In `expandRecurring` (`:150`), parse `recurrenceEndDate` only when `activity.recurrence !== 'none'`:

```ts
const endDate =
  activity.recurrence !== 'none' && activity.recurrenceEndDate
    ? parseLocalDate(activity.recurrenceEndDate)
    : null;
```

which makes the existing early return at `:153` correct by construction and un-hides already-corrupted children in existing `.beanpod` files with no migration (addresses assumption 4).

### Layer 3 — make the forms honest

**3a. `ActivityModal.onEdit` (`:264`)** — seed `date` from `props.occurrenceDate ?? activity.date`.

**3b. Watcher suppression** — add `suppressDaysOfWeekSync` to the **existing** `props.open` watcher at `:372-384` (same `nextTick` release as `suppressEndTimeSync`), and early-return on it in the `date` watcher at `:359`.

**3c. Baseline snapshot + diff on save** _(pass-3 revision — baseline replaces entity-diff and the `props.activity` gate)_.

- Add `const editBaseline = ref<CreateFamilyActivityInput | null>(null)`.
- In the **same `nextTick` callback that releases the suppression flags** (`:372-384`), set `editBaseline.value = buildPayload()` when `props.open && props.activity`; set it to `null` in the watcher's else branch (close, or open-without-activity). Taking it after the flags release guarantees watcher-settled values (`daysOfWeek`, `endTime`) are part of the baseline rather than surfacing as phantom user changes. `useFormModal` watching `open` only (verified) means this is exactly one baseline per open, matching exactly one `onEdit`.
- `handleSave` (`:674`) becomes:
  ```ts
  const payload = buildPayload();
  const data = editBaseline.value ? diffPayload(editBaseline.value, payload) : payload;
  ```
  then the existing `existingId` branch emits `{ id, data }` with `createdBy` destructured **off `data`** (pass-4), or the full `payload` for a true create.
- If `editBaseline.value` is set and the diff is empty, close without emitting `save` — nothing changed.
- **Known, accepted imprecision:** `photoIds` arrive asynchronously from the binding composable. If a photo lands after the baseline is taken, `photoIds` appears in the diff with its correct current value — a harmless same-value write, not a data change. Documented in the JSDoc; do not add machinery to chase it. (Emptying `photoIds` is a separate, pre-existing gap — see Important Notes.)

**3d. One shared "store said no" reporter module** _(pass-4 revision — `src/utils/actionFailure.ts`, two named reporters)_. `ActivityViewEditModal.reportSessionActionFailed()` (`:625-633`) is already exactly this pattern — `showToast('error', t('planner.sessionActionFailed.title'), t('planner.sessionActionFailed.message'), { surface: 'activity-session-action' })`, and `showToast('error', …)` auto-fires the reporter with `surface`/`context` (`useToast.ts:24-56`). Move it verbatim into a new **`src/utils/actionFailure.ts`** and import it in `ActivityViewEditModal`, `useActivityScopeEdit`, and `activityStore`'s vacation guard.

The same module gains a sibling for the transactions path:

```ts
/** A recurring-activity session action the store refused (null / false return). */
export function reportSessionActionFailed(): void; // planner.sessionActionFailed.*
/** A recurring-ITEM (bill) scope action the store refused. */
export function reportRecurringItemActionFailed(): void; // error.saveFailed + error.generic,
// surface: 'recurring-item-scope'
```

> **The two cannot share copy** _(pass-4 correction to pass 3's "zero new strings, reuse `planner.sessionActionFailed.*` everywhere")_. That string reads _"Couldn't update this session"_ / _"Something went wrong — please try again."_ — correct for an activity occurrence, wrong for a recurring **bill** the user just tried to cancel. The transactions path reuses the existing generic pair instead: `error.saveFailed` (_"Failed to save changes"_, `uiStrings.ts:2599`) + `error.generic` (_"Something went wrong. Please try again."_, `:2594`). **Still zero new translated strings** — but two honest ones rather than one misapplied one. Two eight-line functions in one purpose-named module beats two inline `showToast` calls that will drift.

> Do **not** put this in `src/utils/notice.ts`: that module is a localStorage one-time-notice flag factory (`noticeFlag(key)`) with no toast, no i18n, and no error-reporting concern. Adding an unrelated export there makes the module name misleading and couples two independent subsystems for no benefit. A `showToast` import from `src/utils/` is already established convention (`silentReconnect.ts:3`, `discord.ts:9`), so a small purpose-named util is the consistent home.

**No new translated copy is required** — the existing `planner.sessionActionFailed.*` (`uiStrings.ts:5820-5827`) and `error.saveFailed`/`error.generic` (`:2594-2599`) entries already read correctly for every one of these paths. Developer guidance travels in the `context` (`recur_scope`, `recur_occurrence_ymd`) plus the auto-reported surface.

**3e. `useActivityScopeEdit.handleScopedSave`** — currently ignores three `null` returns (`:61` materialize, `:63` split, `:93` cancel-one). Each becomes an explicit failure: call `reportSessionActionFailed()` and return `false` (keeps the modal open, which is the correct UX for a failed save). Then:

- `this-only` — pass the diff straight through; `materializeOverride` now resolves the date correctly because an untouched date is simply absent.
- `all` — when the diff carries a `date`, translate it to a **day delta relative to `occurrenceDate`** and apply that delta to the template's `date` (assumption 2), rather than assigning the occurrence date to the template. Keep this translation in this one function — it is the only place that knows both the clicked occurrence and the template. Comment the weekday invariant (assumption 2) at the call site.
- `this-and-future` — delete the blanket `date`/`recurrenceEndDate` strip at `:69-73`; the diff already excludes untouched fields, so a deliberate end-date edit applies (requirement 13) while an untouched one no longer clobbers the split. Keep stripping `date` only — `splitActivity` owns the new template's start (invariant 3).
- `handleScopedDelete`'s `this-and-future` (`:101-109`) — after the `recurrenceEndDate` write succeeds, call `activityStore.deleteChildrenFrom(activity.id, viewingOccurrenceDate.value)` (2g-bis).

**3f. `ActivityViewEditModal.confirmReschedule` (`:775-817`)**:

- Replace both hand-rolled deltas with `diffPayload` against an **inline entity slice** — no `pick` helper exists in `src/` and four fields do not justify inventing one _(pass-4)_:
  ```ts
  const base = {
    date: activity.date,
    endDate: activity.endDate,
    startTime: activity.startTime,
    endTime: activity.endTime,
  };
  const delta = diffPayload(base, { date: rescheduleDate.value /* … */ });
  ```
  This kills the persisted-`null` bug and the duplicated `!==` comparisons; these four fields map 1:1 onto the entity so the payload-vs-entity form is safe here.
- In the non-recurring branch, detect an override child (`activity.parentActivityId`) and carry `originalOccurrenceDate: activity.originalOccurrenceDate ?? activity.date` into the update, so the occurrence key cannot drift (invariant 4).
- **Both branches currently swallow their result** _(pass-4, requirement 15)_: the recurring branch has `if (override) { … }` with no `else`, and the non-recurring branch discards `updateActivity`'s return entirely. Add `reportSessionActionFailed()` on the falsy path of each — the same helper the rest of this modal already uses.
- `handleDelete`'s `this-and-future` branch (`:655-664`) calls `deleteChildrenFrom` after the end-date write, exactly as 3e does.

### Layer 4 — calendar sync robustness

_(Pass-3 revision: recovery is now "clear the stale link and defer", not "re-discover and retry". Simpler, and it does not contradict the documented discover-once invariant at `calendarSyncStore.ts:375-377`.)_

`applyExceptionUpsert` (`calendarSyncStore.ts:381-425`): wrap the `patchEventFields`/`patchEvent` calls. On `CalendarApiError kind:'not_found'`:

1. `removeCalendarEventLinkById(connectionId, e.child.id)` — drop the link carrying the dead `existingInstanceId`. (Signature verified: `(connectionId, activityId)`, as used at `:446`, `:460`, `:465`.)
2. `logEvent` the recovery (`recur_outcome:'recovered'`).
3. `return false` — defer. The next reconcile finds no stored instance id and runs the **existing, already-tested** discovery block from the top.

Rationale over the pass-2 design (extract `discoverInstanceId`, retry inline): the comment at `:375-377` states the instance is discovered exactly once _because_ a moved instance falls outside an original-date re-window. An inline re-discovery either finds nothing (identical outcome to deferring, but via a second code path) or — worse — matches a _different_ instance that now occupies that window and patches the wrong event. Clearing + deferring costs one poll cycle, adds no new helper, and reuses the discovery path that already has the `not_found`-on-master and `no-instance` handling. Any non-`not_found` error still throws (unchanged).

**Promote all three console-only paths in this one function** _(pass-4 — pass 3 listed only the two `console.debug` calls)_: the two deferrals at `:406-409` and `:427-430`, **and** the malformed-child refusal at `:365-372` (`console.warn` when an override child has a non-`'none'` recurrence — the exact corruption this plan's Layer 2 prevents, and today the only signal that it happened is a browser console nobody reads). All three become `logEvent` at `warn`, so a never-converging exception and a data-shape violation are both visible. One edit, one convention.

### Transactions — extend the existing field discipline, do NOT add a diff

`TransactionModal`'s payload is consumed by three branches of `handleSaveRecurring` (`TransactionsPage.vue:639-700`), two of which (**create** and **convert a one-time transaction to recurring**) require the complete `CreateRecurringItemInput`. Emitting a diff from that modal would break creation. The correct, already-proven shape here is explicit field control — `recurringToTransactionFields` (`:602-617`) and `splitRecurringItem`'s explicit field list (`recurringStore.ts:216-229`).

- **Move both helpers into one module** _(pass-3: resolves the plan's "export it (or move both)" ambiguity — pick one and pick it now)_. New `src/utils/recurringItemFields.ts` exports:

  ```ts
  export function recurringToTransactionFields(d: CreateRecurringItemInput): UpdateTransactionInput;

  /** Template-level fields a scoped edit may change, after a split.
   *  Defined as an OMIT of the three schedule fields, not a keep-list:
   *  `splitRecurringItem` does not copy loanId / activityId / goalId /
   *  goalAllocMode / goalAllocValue, so this update is the only thing that
   *  restores them — a keep-list that forgets one drops it on every split.
   *  The split owns the schedule (Recurring Invariant 3). */
  export function recurringTemplateFields(d: CreateRecurringItemInput): UpdateRecurringItemInput {
    const { startDate: _s, endDate: _e, lastProcessedDate: _l, ...rest } = d;
    return rest;
  }
  ```

  > **Pass-4 correction.** Pass 3 specified `recurringTemplateFields` as a _whitelist_ by symmetry with its sibling. Verified against `recurringStore.ts:216-229`, that is the unsafe direction here: the two helpers differ because `recurringToTransactionFields` **translates** between two different types (a keep-list is forced) while `recurringTemplateFields` **filters** within one type (an omit is correct and fails safe). The comment above states why, so the asymmetry reads as deliberate rather than sloppy.

  Both are pure and unit-testable without mounting the page. Use `recurringTemplateFields` for the `this-and-future` post-split update at `:677`.

- **`:794-800` — delete the lookup, not just the missing `else`** _(pass-3 simplification)_. `updateRecurringItem` already returns falsy when the item does not exist, so `recurringStore.recurringItems.find(...)` is redundant, and the `{ ...item, … } as any` spread additionally writes back `id`/`createdAt`/`updatedAt`. Replace the whole block with:
  ```ts
  const updated = await recurringStore.updateRecurringItem(recurringItemId, {
    endDate: toDateInputValue(dayBefore),
  });
  if (!updated) {
    reportRecurringItemActionFailed();
    return;
  }
  ```
  This removes the wrong field, the `as any`, the write-back spread, the redundant lookup, and the silent no-op in one edit — and it stops the materialised-transaction deletion from running when the end-date write failed (today it deletes rows for a series that will regenerate them).
- The three other silent `return`s in `handleSaveRecurring` (`:653`, `:678`, `:684`) get the same reporter — same requirement-15 rule, same one-line call.

## Implementation Sequencing

_(Added in pass 3. Ten-plus fixes across nine files in one commit is unreviewable and unbisectable. Four stages, each independently type-checkable, testable, and shippable, in this order.)_

| Stage                           | Content                                                                                                                                      | Safe to land alone?                                                                                                                                                               | Why this order                                                                                                                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Store safety**            | 2a–2h (incl. 2d-bis re-parent, 2e self-heal, 2g-bis `deleteChildrenFrom`) + the store tests                                                  | **Yes.** Pure hardening; strictly reduces corruption under today's buggy callers (it starts stripping the leaked fields, stops the payment hijack, and neutralises legacy leaks). | Landing first means that if stages 2–4 slip, the two data-loss modes and the payment hijack are already dead. It also makes stage 2 far less risky, because the store no longer trusts the form. `deleteChildrenFrom` ships unused here and is wired up in stage 2. |
| **2 — Form honesty**            | Layer 1 (`diffPayload` + tests), 3a–3f, `FamilyPlannerPage` presence checks, the `deleteChildrenFrom` call sites, the composable/modal tests | **No — 3a and 3f must land together.** Requirement 1 and requirement 6 are one commit.                                                                                            | 3a un-masks root cause 3, which 3f fixes. Splitting them ships a duplicating-session bug.                                                                                                                                                                           |
| **3 — Transactions**            | `recurringItemFields.ts`, the `this-and-future` omit, the `endDate` fix, the four failure reporters, `recurringStore` tests                  | **Yes.** Touches no activity code.                                                                                                                                                | Independent subsystem; can land in parallel with stage 2 if two people are working. Depends only on `src/utils/actionFailure.ts`, which stage 1 creates.                                                                                                            |
| **4 — Sync + telemetry + docs** | Layer 4, the new context keys (app + Lambda mirror + privacy declarations), E2E strengthening, `CHANGELOG`/`STATUS`/`lessons`                | **Yes**, but the telemetry keys should land with or before stage 1 so stage-1 events are not dropped by the allowlist.                                                            | The allowlist is a three-place coupled change; landing it early costs nothing and avoids `[diagnosticContext] dropped non-allowlisted context key` noise during stages 1–3.                                                                                         |

**Gate between stages:** `npm run type-check && npm run lint && npm run test` green, and the stage's own regression tests demonstrably failing on the parent commit.

## Files Affected

**Created**

- `src/utils/diffPayload.ts`
- `src/utils/__tests__/diffPayload.test.ts`
- `src/utils/actionFailure.ts` _(pass-4: shared `reportSessionActionFailed` + `reportRecurringItemActionFailed`; NOT `notice.ts`, and not activity-only)_
- `src/utils/recurringItemFields.ts` _(pass-3: both recurring helpers, moved out of `TransactionsPage.vue`)_
- `src/utils/__tests__/recurringItemFields.test.ts`
- `src/composables/__tests__/useActivityScopeEdit.test.ts`
- `src/components/planner/__tests__/ActivityModal.occurrenceEdit.test.ts`
- `src/components/planner/__tests__/ActivityViewEditModal.reschedule.test.ts`

_(Removed vs pass 1: `src/pages/__tests__/transactionsRecurringScope.test.ts` — `src/pages/__tests__/` holds only 4 LoginPage/OAuth specs; mounting `TransactionsPage` is expensive and brittle. Coverage moves to a unit test of the extracted `recurringItemFields` plus a store-level `endDate` assertion in `recurringStore.test.ts`.)_

**Modified**

- `src/stores/activityStore.ts` — `SPLIT_INVALID_KEYS`/`OVERRIDE_INVALID_KEYS` + `deriveFromTemplate` (new exports/local), `overridesByParent` (widened to `Map<ymd, activity>`; single read site at `:208`), `materializeOverride` (post-spread re-force + overrides-only idempotent patch + explicit date resolution on the update branch), `splitActivity` (+ child re-parent), `syncLinkedRecurringPayment` (guard + legacy-link self-heal + try/catch), `deleteActivity` (`deleteOne` extraction, master-first cascade, honest guard), new `deleteChildrenFrom`, `expandRecurring`
- `src/components/planner/ActivityModal.vue` — `onEdit` seeding, watcher suppression + baseline snapshot on the existing `props.open` watcher, diff on save (gated on the baseline), `createdBy` destructured off the diff
- `src/components/planner/ActivityViewEditModal.vue` — `confirmReschedule` (diffPayload + child occurrence-key preservation + both swallowed returns reported), `handleDelete` this-and-future child reap, `reportSessionActionFailed` moved out
- `src/composables/useActivityScopeEdit.ts` — all three save-scope branches, the this-and-future delete child reap, and explicit handling of the three ignored `null` returns
- `src/pages/FamilyPlannerPage.vue` — payment add/remove detection derived from one named presence check (`handleSave:481-487`)
- `src/stores/calendarSyncStore.ts` — `applyExceptionUpsert` `not_found` → clear link + defer; all three console-only paths promoted to `logEvent`
- `src/pages/TransactionsPage.vue` — import the moved helpers; `recurringTemplateFields` for `this-and-future`; `endDate` fix (lookup + `as any` + `...item` spread all removed); four silent returns reported
- `src/utils/diagnosticContext.ts` — new `recur_*` context keys in `ALLOWED_CONTEXT_KEYS` (`:61`)
- `infrastructure/lambda/telemetry/index.mjs` — **mirror** the new keys (`:65`); `__tests__/handler.test.mjs` pins the two lists and fails on drift
- `docs/runbooks/native-store-submission.md` + `ios/App/App/PrivacyInfo.xcprivacy` + `web/src/pages/privacy.astro` + store Data-Safety answers — declare the new keys
- `src/services/translation/uiStrings.ts` — **no change expected**; the plan reuses `planner.sessionActionFailed.*` and `error.saveFailed`/`error.generic`. If a string proves necessary, `en` + `beanie` both.
- `src/stores/activityStore.test.ts` — extend override/split/cascade coverage
- `src/stores/recurringStore.test.ts` — split-then-update sequence; `endDate` write
- `src/stores/__tests__/calendarSyncStore.exceptions.test.ts` — `not_found` clear-and-defer, orphan, duplicate-key
- `e2e/specs/planner.spec.ts` — strengthen the two recurring specs
- `CHANGELOG.md`, `docs/STATUS.md`, `docs/lessons.md`

## Observability Coverage

Trimmed from pass 1's six events / ten new keys. Every new key is a **three-place coupled change** (`src/utils/diagnosticContext.ts:61` → `infrastructure/lambda/telemetry/index.mjs:65` → the privacy declarations), so keys that can be _derived_ at query time are not added.

> **Pass-4 correction — two errors in the pass-3 table.** (a) Pass 3 asserted that `reason`, `activity_id`, and `recovered` "are already allowlisted". **They are not** — verified against the full `ALLOWED_CONTEXT_KEYS` set; the allowlist contains no such keys and no activity keys at all. Any event shipping them would be silently stripped with a `console.warn`. (b) Every existing key family in that set is **prefix-namespaced** (`notif_*`, `hint_*`, `token_*`, `perf_*`, `save_*`, `silent_refresh_*`), so bare names like `scope` and `reason` break the convention and invite collision with the next subsystem that wants them. All new keys therefore take a `recur_` prefix, and `activity_id` is dropped entirely — a raw entity UUID adds nothing that `recur_occurrence_ymd` + `family_id` don't already give, and the set's only precedent for ids is the tailed `member_id_tail`.

**Events**

| Surface                                        | Level                                         | Context                                                                              | Purpose                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity-override`                            | `info`                                        | `recur_occurrence_ymd`, `recur_resolved_ymd`, `recur_scope`, `recur_stripped_fields` | Every materialize (create or idempotent re-use). `recur_occurrence_ymd !== recur_resolved_ymd` is the exact signature of this bug class — no separate `is_rescheduled` key needed. A non-empty `recur_stripped_fields` names a regressing caller without a repro. One event replaces pass 1's info+warn pair; level escalates to `warn` when `recur_stripped_fields` is non-empty. |
| `activity-scope-edit`                          | `info`                                        | `recur_scope`, `recur_outcome` (`applied` \| `cancelled` \| `failed`)                | Success-path counter for all three activity scopes, so failure _rates_ are computable. Replaces pass 1's `changed_field_count`/`date_changed` (derivable from the paired `activity-override` event).                                                                                                                                                                               |
| `activity-series-delete`                       | `info`                                        | `recur_orphans_removed`, `recur_scope`                                               | Cascade ran; how many children it reaped. `recur_scope` distinguishes a full `all` delete, a `this-and-future` truncation, and the split re-parent. A non-zero count on a fixed build indicates pre-existing orphans. A child-delete failure re-fires this at `warn`.                                                                                                              |
| `recurring-item-scope`                         | `info`                                        | `recur_scope`, `recur_outcome`                                                       | Recurring-transaction scope operations. `recur_outcome:'failed'` covers both the not-found item and a rejected `endDate` write — directly detects the silent-no-op bug. Deliberately shares `recur_scope`/`recur_outcome` with `activity-scope-edit` (same concept, no duplicate keys).                                                                                            |
| `calendar-sync` (existing surface)             | `warn`                                        | `recur_outcome:'recovered'`, `recur_occurrence_ymd`                                  | The `not_found` recovery fired (link cleared, deferred to next reconcile). `recur_outcome:'failed'` distinguishes a failed link-clear from a normal defer. Uses the existing surface with the new shared keys.                                                                                                                                                                     |
| `activity-fee-sync`                            | `error` (`reportError`) / `warn` (`logEvent`) | `action`                                                                             | `syncLinkedRecurringPayment` threw (previously an unhandled rejection escaping the caller's save), or the guard cleared a leaked `linkedRecurringItemId` off a legacy child (`action:'cleared-leaked-link-on-child'`). Reuses the existing `action` key — no new key needed.                                                                                                       |
| `calendar-sync` exception-deferred / malformed | `warn`                                        | `recur_outcome` (`deferred` \| `failed`), `recur_occurrence_ymd`                     | The two `console.debug` deferrals (`:406-409`, `:427-430`) and the `console.warn` malformed-child refusal (`:365-372`) promoted, so a never-converging exception and a data-shape violation are both visible.                                                                                                                                                                      |

**New allowlist keys (6):** `recur_scope`, `recur_outcome`, `recur_occurrence_ymd`, `recur_resolved_ymd`, `recur_stripped_fields`, `recur_orphans_removed`. All non-PII scalars — dates, enums, counts, and field-name lists. No titles, names, amounts, or entity ids.

> **`recur_stripped_fields` ships as a sorted, comma-joined string, not an array** _(pass-3)_. `redactContext` (`diagnosticContext.ts:259-285`) only applies `MAX_STRING_LEN` truncation to string values — an array passes through un-truncated and widens the firehose schema to a non-scalar. A joined string is bounded, sorted (so the same leak produces one stable value to group by), and needs no special handling in the Lambda.

**Failure modes covered.** Wrong-date override → `recur_occurrence_ymd` ≠ `recur_resolved_ymd`. Leaked series fields → `recur_stripped_fields`. Payment hijack → the guard is unconditional at the choke point; any `linkedRecurringItemId` reaching a child still shows in `recur_stripped_fields`, and a legacy one shows as an `activity-fee-sync` `warn`. Occurrence-key drift → `activity-override` on reschedule carries both ymd keys. Permanent Google defer → promoted `warn`. Orphan ghosts → `recur_orphans_removed` (from all three lifecycle paths). Multi-device duplicate override → two `activity-override` events on one `recur_occurrence_ymd`. Bill that won't cancel → `recurring-item-scope` with `recur_outcome:'failed'`. Fee-sync throw → `activity-fee-sync`.

**Nothing here pages** _(pass-4 correction)_. Pass 3 said `severity:'critical'` was "reserved for a failed override write … surfaced through the shared `reportSessionActionFailed` toast" — but that helper does **not** pass `critical`, so it never pages, and the two statements contradicted each other. The correct and intended behaviour is: a failed override write is user-recoverable (the modal stays open and the user retries), so it toasts and reports at default severity and stays out of `#beanies-errors`. Everything else is firehose-only. Do not add `critical: true` to these paths.

**Success-path signal.** `activity-scope-edit` and `recurring-item-scope` fire on success as well as failure, so failure rates are computable rather than only failure counts.

## Acceptance Criteria

- [ ] Editing a recurring occurrence without touching the date keeps it on the clicked date (`originalOccurrenceDate` unset)
- [ ] The date field in the edit modal shows the occurrence date, matching the banner
- [ ] Untouched form fields never reach the update/override/split payload; an explicitly cleared field is deleted (not written as `null`)
- [ ] Attaching a photo to a **new** activity (eager-create) still saves the full payload — no blank activity
- [ ] Adding/removing a linked payment on an activity still routes correctly; an untouched paid recurring activity edited at occurrence scope is **not** treated as a payment removal and does not delete generated transactions
- [ ] An override child never carries `daysOfWeek`, `recurrenceEndDate`, `linkedRecurringItemId`, `vacationId`, or inherited completions
- [ ] Editing or cancelling one session of a paid recurring activity leaves the series' recurring payment item untouched — on both the create and the update path
- [ ] A child that already carries a leaked `linkedRecurringItemId` has it cleared on next contact, so it can no longer win `TransactionsPage`'s owner lookup
- [ ] A `syncLinkedRecurringPayment` failure reports and toasts without rejecting the already-successful activity save
- [ ] Rescheduling an existing override child moves it without duplicating the session
- [ ] A second `materializeOverride` for the same `(parent, occurrence)` updates rather than duplicates, **preserves the fields the first call changed, and does not move a child the first call rescheduled**
- [ ] Deleting a series removes its override children (master first); a failed child delete is reported, not swallowed; refusing a vacation-linked delete shows the user a toast instead of only a console warning
- [ ] Splitting a series re-parents the children on/after the split date — exactly one occurrence renders on the split date, and it is the edited one
- [ ] "Delete this and all future" on an activity series also removes the edited sessions on/after the cut
- [ ] A `not_found` on an exception patch clears the stale link and defers, and the next reconcile re-discovers — no error every poll
- [ ] `this-and-future` on an activity preserves the split's start date and applies a deliberate end-date edit
- [ ] Recurring-transaction `this-and-future` preserves the split's `startDate`, does not inherit `endDate`/`lastProcessedDate`, and **retains `goalId`/`goalAllocMode`/`goalAllocValue`/`loanId`/`activityId`**
- [ ] "Delete this and all future" on a recurring bill sets `endDate`, the series stops regenerating, and a missing item reports instead of no-opping (and does not delete materialised rows when the end-date write failed)
- [ ] An already-corrupted override child (leaked `recurrenceEndDate`) becomes visible again on load without a migration
- [ ] Every new/changed error path surfaces a translated message and a structured report — no silent failures, no bare `catch {}`, no `console.warn`-only refusals, and no ignored `null`/`false` store returns in `confirmReschedule`, `useActivityScopeEdit`, or `handleSaveRecurring`
- [ ] Diagnostic logging in **Observability Coverage** implemented; new `recur_*` context keys added to `src/utils/diagnosticContext.ts`, **mirrored** in `infrastructure/lambda/telemetry/index.mjs`, and declared in the privacy consumers (the Lambda handler test pins the mirror); no `[diagnosticContext] dropped non-allowlisted context key` warnings from any new event
- [ ] Each stage in **Implementation Sequencing** lands green on `type-check`, `lint`, and the unit suite, with its regression tests demonstrably failing on the parent commit
- [ ] `npm run type-check`, `npm run lint`, and the full unit suite pass; E2E green on Chromium

## Testing Plan

Greg's explicit ask: _"write full and meaningful test coverage to ensure all recurring functionality works as expected."_ Coverage today is zero on the composables and modals, and the store tests assert a contract the form never satisfies. The suite below is built so **each proven bug has a test that fails before the fix and passes after**.

### 1. Regression tests for the proven bugs (write first — must fail on `main`)

- `date` resolution: `materializeOverride('tpl', '2026-04-01', { pickupMemberId: 'x' })` → child on `2026-04-01`, `originalOccurrenceDate` undefined. _(Reproduces the primary report.)_
- Leaked end date: a child must never carry `recurrenceEndDate`; a series ending 2026-03-31 with an occurrence moved to 2026-04-07 must render on 2026-04-07 and not on 2026-03-11. _(Reproduces the total-vanish case.)_
- Payment hijack, **both paths**: materializing an override of a paid recurring activity leaves the parent's recurring item byte-identical; _and_ a subsequent `updateActivity` on that child leaves it byte-identical (the pass-1 create-only guard fails this second case).
- Legacy leak self-heal: a child seeded with a `linkedRecurringItemId` has it cleared on the next `updateActivity`, and the parent's item is untouched.
- Child reschedule: rescheduling an override child preserves its occurrence key; the master's original slot stays suppressed; exactly one occurrence renders.
- **Second-materialize preserves the first edit** _(pass-3)_: `materializeOverride(p, d, {pickupMemberId:'x'})` then `materializeOverride(p, d, {location:'y'})` → one child carrying **both**. Fails against any implementation that re-derives the patch from the parent.
- **Second-materialize does not un-reschedule** _(pass-4)_: `materializeOverride(p, '2026-04-01', {date:'2026-04-08'})` then `materializeOverride(p, '2026-04-01', {location:'y'})` → the child is still on `2026-04-08` with `originalOccurrenceDate === '2026-04-01'`. Fails against any implementation that reuses `finalDate = overrides?.date ?? occurrenceDate` on the update branch.
- **Split with a child** _(pass-4)_: a series with an override child on 2026-04-15, split at 2026-04-08 → the child's `parentActivityId` is the **new** template and exactly one occurrence renders on 2026-04-15. Fails today (two render).
- **Truncate with a child** _(pass-4)_: "delete this and all future" from 2026-04-08 on a series with a child on 2026-04-15 → the child is gone. Fails today (it survives).
- Transactions: `delete this-and-future` writes `endDate`, and `recurringProcessor` generates nothing after it.
- Transactions: `this-and-future` after a split retains `goalId`/`activityId`/`loanId`. Fails against a keep-list helper that omits them.

### 2. New unit suites (files that do not exist today)

- **`diffPayload.test.ts`** — unchanged fields omitted; changed fields included; `''`/`null`/`undefined` in `next` against a set `original` included as **`undefined`** (never `null`) **and present under `Object.keys`/`in`** (the delete + presence-check contracts both depend on it); absent fields omitted; arrays (`daysOfWeek`, `assigneeIds`, `photoIds`) compared by value not reference; empty diff returns `{}`; **the documented limits hold** (flat scalars + arrays only — a nested-object case is asserted as out-of-contract so the budget in Layer 1 is enforced, not aspirational).
- **`recurringItemFields.test.ts`** — `recurringTemplateFields` omits `startDate`/`endDate`/`lastProcessedDate` **and retains every other key of a fully-populated `CreateRecurringItemInput`** (the omit-not-keep-list contract); `recurringToTransactionFields` behaviour preserved byte-for-byte across the move (guards the extraction).
- **`useActivityScopeEdit.test.ts`** — all three save scopes × (date untouched / date changed) = six cases, plus cancel-at-scope-modal, plus the delete branches (including the `this-and-future` child reap), plus **each of the three `null` returns produces a failure toast and `false`** (today they are silently swallowed). Asserts the exact payload reaching the store. Includes the **`all`-scope weekday invariant** (assumption 2): moving a weekly series by a delta leaves the template's weekday consistent with the form's `daysOfWeek`.
- **`ActivityModal.occurrenceEdit.test.ts`** — the date field renders `occurrenceDate`; the `daysOfWeek` watcher does not fire during population; **the baseline is captured after the suppression flags release** (open → populate → save with no user input emits nothing); the emitted payload contains only changed fields and **never `createdBy`**; **the eager-create path with no baseline emits the full payload**; an empty diff emits no `save`.
- **`ActivityViewEditModal.reschedule.test.ts`** — master reschedule materializes an override; child reschedule preserves the occurrence key; cleared fields emit `undefined` not `null`; **a null store return on either branch toasts**; inline scope-on-save still targets the swapped entity.

### 3. Extend existing suites

- `activityStore.test.ts` — idempotency guard, the preserve-first-edit case **and the preserve-reschedule case**; strip assertions driven by iterating the **exported** `OVERRIDE_INVALID_KEYS` / `SPLIT_INVALID_KEYS`, so a new series-level field added to the model without a strip entry fails the suite; `splitActivity` clone hygiene **and child re-parenting**; `deleteChildrenFrom` boundary (`ymd >= fromYmd`, inclusive); delete cascade count **and ordering** (a failing master delete leaves children intact); vacation-guard reports; `syncLinkedRecurringPayment` throw is contained; legacy-link self-heal; `expandRecurring` tolerating a corrupted legacy child.
- `recurringStore.test.ts` — the split-then-update **sequence** (currently only `splitRecurringItem` in isolation), asserting the link fields survive; `endDate` written by the scoped delete.
- `calendarSyncStore.exceptions.test.ts` — `not_found` on both `modify` and `cancel` clears the link and returns `false` (does not throw, does not re-discover inline); the following reconcile re-discovers and succeeds; a malformed (`recurrence !== 'none'`) child logs a `warn` rather than a console line; orphaned child produces no upsert; two children on one key.
- `FamilyPlannerPage` payment routing — a focused test (or a pure extraction of the predicate) asserting that an occurrence edit of a paid activity with `payFromAccountId` **absent** does not delete transactions and does reach the scope modal, while one with `payFromAccountId: undefined` **present** does.
- `infrastructure/lambda/telemetry/__tests__/handler.test.mjs` — already pins the allowlist mirror; will fail until the six `recur_*` keys are added on both sides.

### 4. E2E (ADR-007 budget: 25; currently 21)

Strengthen rather than add — no net new tests:

- `planner.spec.ts:202` — click the **second** occurrence of the series rather than `.first()`, then assert `override.date` equals that occurrence's date and `originalOccurrenceDate` is undefined. As written the test cannot fail on this bug (`createRecurringActivity` starts tomorrow and the test clicks `.first()`, so template start and clicked occurrence coincide). _(Pass-4: prefer the second occurrence over pass 3's "start the series in the past" — back-dating fights both the date input's constraints and the upcoming-list's forward-only window, for no extra discriminating power. Assert the list renders ≥2 occurrences before using `.nth(1)`, so a window change fails loudly rather than silently reverting to the old blind spot.)_
- `planner.spec.ts:263` — replace the vacuous `toBeTruthy()` with an exact date assertion.

### 5. Manual verification

- Reproduce Greg's exact steps on a series whose start is weeks in the past; confirm the activity stays put.
- Paid recurring activity: edit one session, confirm the monthly fee item in Transactions is unchanged; then reschedule that same override child and confirm it is _still_ unchanged.
- Edit one session of a series, then "this and all future" from an earlier date — confirm the edited session appears exactly once and belongs to the new segment.
- Edit one session, then "delete this and all future" from an earlier date — confirm the edited session is gone too.
- Attach a photo to a brand-new activity and save — confirm the activity is complete (eager-create regression guard).
- Google Calendar connected: edit one occurrence, confirm exactly one instance changes and no duplicate appears.
- Cancel a recurring bill with "this and all future"; confirm it does not reappear next month, and that a bill linked to a goal/activity keeps that link after a `this-and-future` **edit**.

### 6. Production data audit (blocking — see assumption 3)

Before shipping, determine whether live `.beanpod` data already contains children on wrong dates, children carrying `linkedRecurringItemId`, or rewritten payment items. Query CloudWatch for the period since 2026-03-09 and inspect Greg's own pod. If corruption exists, this plan needs a remediation step and that changes its scope — decide before, not after. (The 2e self-heal and the 2h defensive read cover the two cases we know how to neutralise lazily; anything beyond those needs a migration.)

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from a completed three-sweep investigation; two bugs proven by execution, six verified adversarially; organised into three root causes plus independent sync/transaction defects.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the code. Confirmed **no** generic diff/delta helper exists anywhere in `src/` (nearest relatives are domain-specific: `buildAccountDetailsPatch`, `mergeExtractionIntoActivity`, `recurringToTransactionFields`) — `diffPayload` is justified, but scoped to the two consumers that need it. **Reversed the transactions approach**: a payload whitelist already exists (`TransactionsPage.vue:602-617`, `recurringStore.ts:216-229`) and a modal-level diff would have broken the create and convert-to-recurring branches; replaced with a sibling `recurringTemplateFields()`. **Moved the payment guard** from `createActivity` into `syncLinkedRecurringPayment` after finding `updateActivity:648` calls it on identical unconditional terms, leaving the hijack reachable. **Caught two regressions the pass-1 design would have introduced**: the eager-create emit path (`ActivityModal.vue:681-693`, `props.activity` null) and `FamilyPlannerPage`'s absence-based payment detection (`:483-487`). **Reused the existing failure-toast pattern** (`reportSessionActionFailed` + `planner.sessionActionFailed.*`) instead of new copy, and pointed it at three currently-ignored `null` returns in `useActivityScopeEdit`. Added try/catch around `syncLinkedRecurringPayment` (unhandled rejection after a successful write), replaced the bare `console.warn` vacation guard, extracted one `deriveFromTemplate` for the duplicated clone-and-strip, reused `overridesByParent` for the idempotency lookup, reused the existing `props.open` suppression watcher, extracted `discoverInstanceId` for the sync recovery, and documented that `null` clears are currently persisted (`stripUndefined` only strips `undefined`). **Corrected the telemetry allowlist location** (`src/utils/diagnosticContext.ts:61` + Lambda mirror, not `logEvent.ts`) and trimmed observability from six events/ten keys to a set with six new keys, deriving the rest. Dropped the mounted-page test in favour of a pure unit + store test. Corrected the E2E budget framing (21 of 25 used).
- **Pass 3 (Sustainability)**: Attacked coupling, hidden invariants, and code paths that exist only to compensate for another path's imprecision. **Re-based the diff on a form-state snapshot instead of the entity** — payload-vs-entity made correctness depend on `buildPayload`'s derivations (`payFromAccountId: ''`, `feeSchedule:'none'`, the legacy `assigneeId` mirror) matching the stored shape forever, and made `date` appear in every diff; payload-vs-baseline means the diff _is_ "what the user changed", and it dissolves the separate eager-create gate into "no baseline → no diff". **Reversed the calendar-sync recovery** to clear-the-link-and-defer after finding the pass-2 inline re-discovery contradicts the explicit discover-once invariant at `calendarSyncStore.ts:375-377` and could patch a different instance; this deletes a helper rather than adding one. **Closed a latent data-loss hole in requirement 7** — the idempotent patch must be the sanitized overrides only; re-deriving from the parent would silently revert the first edit. **Derived `OVERRIDE_INVALID_KEYS` from `SPLIT_INVALID_KEYS`** (they differ by exactly two entries) and typed both against `keyof FamilyActivity` so a model rename fails type-check; typed `deriveFromTemplate`'s return to keep `as any` out of the call sites. **Rejected `src/utils/notice.ts` as the home for the shared failure reporter** (it is a localStorage flag factory) in favour of a purpose-named module. **Specified delete-cascade ordering** (master first, no recursion, one `wrapAsync`, per-child failure reported) — children-first would destroy edited occurrences on a failed master delete. **Simplified the transactions end-date fix** from "add an `else`" to deleting the lookup and the `...item` spread entirely and branching on `updateRecurringItem`'s return, which also stops materialised rows being deleted after a failed end-date write. **Resolved the "export it (or move both)" ambiguity** into one `src/utils/recurringItemFields.ts`. **Collapsed `FamilyPlannerPage`'s two presence checks into one named predicate** — duplicated invariants are exactly how `FamilyNookPage` drifted. **Made `stripped_fields` a joined string** (arrays bypass `MAX_STRING_LEN` and widen the firehose schema) and corrected the key count to 6. Added two durable artefacts the plan lacked: a **`## Recurring Invariants`** section (six rules, each with a single enforcement point and a pinning test — the thing that stops this defect class returning) and a **`## Implementation Sequencing`** section (four landable stages with the R1+R6 co-landing constraint pinned to a stage boundary, so a ten-fix change is reviewable and bisectable). Finally, put an explicit **complexity budget** on `diffPayload` (~30 lines, flat scalars and arrays, no deep-equal dependency) with an out-of-contract test, so a generic-looking utility cannot quietly become a general object-diff library.
- **Pass 4 (Fresh-eyes sweep)**: Re-read every cited line rather than trusting the plan's own summaries, which surfaced **two false claims and three new correctness holes**. **Closed a second data-loss hole in requirement 7**: pass 3 fixed _what_ the idempotent branch patches but not _the date it patches with_ — reusing `finalDate = overrides?.date ?? occurrenceDate` on an existing child snaps a previously-rescheduled child back to its original slot on the next unrelated edit; the update branch now writes `date` only when the caller explicitly passed one, and pins `originalOccurrenceDate` only on a child's first move. **Found `splitActivity` abandons its children** — verified it never touches `parentActivityId`, so a child on/after the split date suppresses an occurrence the old template no longer emits while the new template emits an unsuppressed one, duplicating the session; added a re-parent step mirroring `splitRecurringItem:231-238`, which already does exactly this for its transactions. **Found "delete this and all future" abandons its children** in both implementations (`useActivityScopeEdit:101-109`, `ActivityViewEditModal:655-664`) — end-dating a master does nothing to `recurrence:'none'` children; added one shared `deleteChildrenFrom` reusing the cascade's `deleteOne` leaf, called from both. Promoted these into requirement 8 and a seventh **Recurring Invariant** ("a child's parent is the template that owns its occurrence"). **Corrected the telemetry section twice**: `activity_id`/`reason`/`recovered` are **not** in `ALLOWED_CONTEXT_KEYS` (pass 3 said they were, so those events would have been silently stripped), and every existing key family is prefix-namespaced, so all six new keys took a `recur_` prefix and the raw `activity_id` was dropped in favour of `recur_occurrence_ymd` + the existing `family_id`. **Removed a self-contradiction** — pass 3 claimed `severity:'critical'` was reserved for failed override writes "surfaced through `reportSessionActionFailed`", but that helper never sets `critical`; stated plainly that nothing here pages, which is also the correct behaviour for a recoverable save. **Corrected "zero new strings"** for the transactions path: `planner.sessionActionFailed.*` reads _"Couldn't update this session"_, wrong for a recurring bill; the shared module (renamed `src/utils/actionFailure.ts`) now exports two reporters, the second reusing the existing generic `error.saveFailed`/`error.generic` pair — still zero new strings, but honest ones. **Reversed `recurringTemplateFields` from a keep-list to an omit** after verifying `splitRecurringItem` does **not** copy `loanId`/`activityId`/`goalId`/`goalAllocMode`/`goalAllocValue`, making the post-split update the only thing that restores them — a keep-list that forgets one drops it on every split; documented why the two sibling helpers deliberately differ in direction. **Dropped the `pick()` call** in 3f (no such helper exists in `src/`; four fields do not justify inventing one) in favour of an inline slice. **Found three more swallowed store returns** the pass-3 requirement-15 sweep missed — both branches of `confirmReschedule` and three sibling returns in `handleSaveRecurring` — and a third console-only path in `applyExceptionUpsert` (the malformed-child `console.warn` at `:365-372`, promoted alongside the two debugs in one edit). **Extended the legacy-data story from tolerate to neutralise**: a leaked `linkedRecurringItemId` on a child is not inert, because `TransactionsPage.vue:742` resolves a recurring item's owner by scanning that field and a child can win the scan, so the payment guard now clears it on contact using the repo-write shape already at `:542`. **Pinned three verified mechanics** that the design silently depends on: `useFormModal` watches `open` only (so exactly one baseline per open), Vue's queued `'pre'` watchers are what make the suppression flags work at all, and `automergeRepository.update` keys its delete list off `Object.keys` (so `diffPayload` must _assign_ `undefined`, never omit). **Softened the E2E change** from back-dating the series to clicking the second occurrence — same discriminating power, no fight with the date input or the forward-only upcoming window, plus an explicit ≥2-occurrence assertion so the blind spot cannot silently return. Finally, recorded three verified-but-out-of-scope items so they are not rediscovered as regressions: emptying `photoIds` never persists (true before and after the diff), `calendarSyncStore` already ships two non-allowlisted keys that are dropped with a warning, and a parent activity's `linkedRecurringItemId` still points at the pre-split recurring item.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> I think i've found a serious bug with editing recurring calendar activities that causes the activity items to be scheduled to a new date without the user changing the date (whicih makes those activities appear to disappear). below are steps to reproduce:
>
> - Edit a recurring activity (not sure if it has to be a recurring activity later than the original date, but i've not tested a recurring activity on the original date, i've only tested on recurring activities after the original date)
>
> - change anything on the activity (i.e. pickup/dropoff duty person, category, who?, etc). but do NOT change the date. also confirm at the top it says "editing this bean for <DATE>" which equals the date you clicked on and would expect
>
> - click on "save activity" and in the next modal "edit recurring activity" choose "just this item"
>
> After save, the item disappears from the current date. In my testing, i was able to find the changed activity one week earlier, overlapping with another instance of the same recurring session. in other testing, i was not able to find the changed activity at all. i presume it moved to another date.
>
> From what i can tell this appears to be a serious bug, it moves the date of a recurring activity unexpectedly, and it appears to the user to simply disappear.
>
> Please do a full and comprehensive investigation across the code, use /code-review if needed to do a full check of this functionality across the activities surfaces or anywhere else that uses this code or funcitons/moduls to ensure there are not other hidden bugs that also exist and need to be fixed

### Follow-up 1

> verify those six sync findings, and please check whether this applied to recurring transactions as well, or anywhere else in the code the uses recurring features and could be impacted

### Follow-up 2

> /beanies-plan build the plan and write full and meaningful test coverage to ensure all recurring functionality works as expected

</details>

### Critical Files for Implementation

- /home/greg/projects/beanies-family/src/stores/activityStore.ts
- /home/greg/projects/beanies-family/src/composables/useActivityScopeEdit.ts
- /home/greg/projects/beanies-family/src/components/planner/ActivityModal.vue
- /home/greg/projects/beanies-family/src/pages/FamilyPlannerPage.vue
- /home/greg/projects/beanies-family/src/pages/TransactionsPage.vue

```

### Critical Files for Implementation
- /home/greg/projects/beanies-family/src/stores/activityStore.ts
- /home/greg/projects/beanies-family/src/composables/useActivityScopeEdit.ts
- /home/greg/projects/beanies-family/src/components/planner/ActivityModal.vue
- /home/greg/projects/beanies-family/src/components/planner/ActivityViewEditModal.vue
- /home/greg/projects/beanies-family/src/pages/TransactionsPage.vue
```
