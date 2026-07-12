# Plan: Delete-deletes for recurring-activity instances + explicit "Reset to series" action

> Date: 2026-07-12
> Related issues: None — direct implementation (no GitHub issue, per intake)
> Plan file: `docs/plans/2026-07-12-delete-deletes-reset-to-series.md`

## User Story

As someone managing a recurring activity, I want deleting a single (moved or edited) session to remove just that session and never resurrect the original, and a clearly-labelled way to undo a one-off change when I actually mean to — so the planner behaves predictably, like any calendar app.

## Context

A single occurrence of a recurring activity can be **rescheduled** ("reschedule this session") or **edited** ("this occurrence only"). Both create a one-off **override child** activity (`materializeOverride`, `activityStore.ts:520`): `recurrence:'none'`, `parentActivityId` set, and — for a reschedule — `originalOccurrenceDate` set. The override child is _itself_ the suppression mechanism: `overridesByParent` (`activityStore.ts:51-64`) hides the master's occurrence at `overrideOccurrenceYmd(child)` (= `originalOccurrenceDate ?? date`), **regardless of the child's `isActive`**.

The bug: in `ActivityViewEditModal.handleDelete` (`:584-627`), deleting a `recurrence:'none'` activity calls `deleteActivity(act.id)`. For an override child that **removes the child**, which lifts the suppression → the master's original occurrence **silently reappears** (in-app; and now on Google too, via the 2026-07-12 recurring-exceptions sync's restore path). So "delete this moved session" resurrects the original session — counter-intuitive and unlike Google/Apple Calendar.

(Note: the existing test `activityStore.test.ts:1358` "restore original occurrence when rescheduled override is deleted" tests the pure **expansion** logic — it `splice`s the override out of the array and asserts the original returns. That is exactly the correct **reset** semantics and stays true; it is _not_ the buggy path and must not be inverted — only renamed. See Testing.)

The fix has two halves:

1. **Delete always deletes.** Deleting an override child (a moved/edited session) **cancels** that occurrence and restores nothing — modelled as marking the override inactive (`isActive:false`), the same "delete-one" state a scope-delete already produces.
2. **Reset is explicit.** The old remove-and-restore becomes a deliberate, clearly-messaged **"Reset to series"** action, shown only on a moved/edited instance.

Google sync needs **no changes**: `isActive:false` maps to the existing exception _cancel_ path, and removing the child maps to the existing _restore_ path — the calendar reconcile (triggered by the activity-edit watcher) picks up both automatically (`docs/plans/2026-07-12-recurring-occurrence-google-exceptions.md`).

## Requirements

1. Deleting an **override child** instance (moved or edited) in `ActivityViewEditModal` **cancels that occurrence** (`updateActivity(child, {isActive:false})`) and **never restores the original** — in-app and on Google.
2. Add a **"Reset to series"** action, shown **only** when the modal is displaying an override child (`parentActivityId` set), that removes the override (`deleteActivity(child)`) and restores the original recurring slot — in-app and on Google. This is the _only_ path that restores; it is never silent.
3. The reset action + its context are a **quiet Sky-Silk context banner at the top of the modal body**, per the design guidance — never the orange CTA, never red. The amber "reschedule this session" stays the primary per-instance action.
4. Wording is **adaptive** for moved vs edited: banner text, action label, and reset-confirm copy. Moved is distinguished by `originalOccurrenceDate` present; edited by its absence.
5. The **delete confirm** copy changes to state the new semantics with no restore mention: "Delete this session? Only this one is removed; the rest of the series stays."
6. **No behaviour change** to: deleting/editing a _master_ recurring occurrence via the scope modal (this-only / this-and-future / all — already correct), deleting a true one-off (`recurrence:'none'`, no `parentActivityId`), or any Google-sync code.
7. **No silent failures.** Both the cancel and the reset mutations return a result on a non-throw failure; the modal branches on it — only whoosh/emit on success, and surface a toast (user message + console breadcrumb) on failure. All new strings have `en` + `beanie`; date interpolation via `fillTemplate`.
8. Rename the mischaracterised `activityStore.test.ts:1358` to reflect the reset path (its assertions stay), and add a new test for the cancel path (inactive override → original stays suppressed).

## Important Notes & Caveats

- **The modal only ever shows an ACTIVE override child.** An inactive (deleted-one) override renders nothing and isn't clickable, so `isOverrideInstance = !!activity.parentActivityId` is sufficient (active is implied).
- **Two delete paths already exist — only ONE changes.** `handleDelete` (`:584`) has: (a) the _scope_ path for a master occurrence (`recurrence !== 'none' && occurrenceDate`) — **unchanged** (this-only already does `materializeOverride({isActive:false})` = cancel, correct); (b) the _plain_ path for `recurrence:'none'` (`:616-626`) — currently `deleteActivity`. The change is a **new branch inside (b)**, before line 616: if `act.parentActivityId` (override child) → cancel via `updateActivity({isActive:false})`; else (true one-off) → keep `deleteActivity`. Do **not** touch path (a).
- **Reset = the exact current remove behaviour, relocated.** `deleteActivity(child)` → child gone → `overridesByParent` stops suppressing → original occurrence reappears in-app; the calendar reconcile sees the exception link's child is gone → restores the Google instance. No new store logic — the existing `deleteActivity` behind an explicit, confirmed action.
- **Delete = cancel maps to the existing Google exception cancel.** Flipping the child to `isActive:false` changes the exception mode `modify → cancel`; the next reconcile re-pushes and cancels the Google instance by its stored id. The exception link stays (child still exists, inactive). Convergent; no sync change.
- **NEVER-SILENT-FAILURE (must-fix).** `updateActivity` returns `FamilyActivity | null` and `deleteActivity` returns `boolean` (`activityStore.ts`), inside `wrapAsync` which toasts only on a **thrown** error — a non-throw falsy return (record-not-found → `null`; a `vacationId`-linked activity → `false` + console.warn, `:465-470`) is NOT surfaced. So the modal MUST branch on the return: only `playWhoosh()` + `emit` on success; on falsy, `showToast('error', …)` with a user message + console guidance. (The pre-existing plain-delete path shares this latent gap; fixing it there too is a small, welcome bonus.)
- **`confirm()` variant is `'danger' | 'info'` only** (`useConfirm.ts:4`), and defaults to `'danger'`. The reset confirm MUST explicitly pass `variant: 'info'` (it discards a one-off change but isn't destructive of series data). The delete confirm stays `'danger'`.
- **`confirm()` interpolation:** `title`/`message`/`confirmLabel` are `UIStringKey`; `detail?: string` is a plain (untranslated) field. Put the interpolated date sentence in `detail` via `fillTemplate(t('key'), { date })`.
- **Date formatting:** reuse `formatDateWithDay` (`@/utils/date`, → "Wed, 6 Mar") for the "Moved from {date}" / reset-detail date. Do not hand-roll.
- **`handleScopedDelete` is DEAD CODE** — `useActivityScopeEdit` is consumed only by `FamilyNookPage.vue` + `FamilyPlannerPage.vue`, and both destructure only `handleScopedSave`; `handleScopedDelete` has no caller. So there is **no parallel live delete path** to keep in sync. Leave it (or delete it as a separate cleanup — out of scope here).
- **Store-seam decision (final):** add ONE named store verb for the RESET path (`resetOccurrenceToSeries` — the `delete-child = restore-series` mapping is genuinely surprising and deserves a self-documenting, test-stable seam that a careless refactor can't silently swap to `isActive:false`); keep the CANCEL path **inline** in the modal (`updateActivity(child,{isActive:false})` reads clearly on its own). Not "no wrappers" and not "two wrappers" — exactly one, for the non-obvious mapping.
- **Scope-branch silent-failure is INTENTIONALLY out of scope.** The new return-checks cover the plain + override delete paths and the reset; the _scope_ branches (`this-only`/`this-and-future`, `handleDelete:594-611`) keep their existing unconditional `playWhoosh()/emit` after a `materializeOverride`/`updateActivity` that can return `null`. That pre-existing gap is left as-is (path (a) unchanged) to keep the change focused — a deliberate exclusion, not an oversight. (Extending the same check there is cheap if consistency is preferred.)
- **New imports in `ActivityViewEditModal.vue`:** `formatDateWithDay` (`@/utils/date`), `fillTemplate` (`@/utils/fillTemplate`), `BaseButton` (`@/components/ui`), and `showToast` (`@/composables/useToast`) — none are currently imported. (Confirm each against the file's current imports.)
- **CIG:** Sky Silk banner (`bg-[var(--tint-silk-20)]`, `rounded-2xl`, `text-xs`, Deep Slate text); reset is a `BaseButton variant="ghost" size="sm"`, never Heritage Orange, never Alert Red. **Only standard Tailwind text classes** (`text-xs`) — never `text-[X.Xrem]` (stylelint/ESLint-enforced).
- **Moved/edited discriminator is best-effort, not a guarantee.** `originalOccurrenceDate` is set only by `materializeOverride` at creation (when the date moved). An override that was _edited-only_ and _later_ rescheduled goes through `confirmReschedule`'s one-off `updateActivity({date})` branch, which never sets `originalOccurrenceDate` — so it would show the "edited" banner and reset to the series default rather than "moved from {date}". Acceptable edge (reset still works correctly — it removes the override); just don't treat the discriminator as authoritative.

## Assumptions

> Review before implementation — valid at planning time, may have moved.

1. `ActivityViewEditModal.handleDelete` (`:584`, wired `@delete="handleDelete"` at `:722`) is the ONLY live delete path for the planner view/edit modal; `useActivityScopeEdit.handleScopedDelete` is unused (verified — no consumer).
2. The modal receives the override child as `props.activity` when the user clicks a moved/edited instance (`parentActivityId`/`originalOccurrenceDate` readable off `activity.value`).
3. `overridesByParent` keys on `overrideOccurrenceYmd` independent of `isActive` (verified `:51-64`), so `updateActivity(child,{isActive:false})` keeps the original suppressed and `deleteActivity(child)` lifts it.
4. The calendar reconcile is triggered by the activity-edit watcher on `updateActivity`/`deleteActivity`, so Google converges without an explicit sync call (verified: `calendarSyncStore.start()` watches `activityStore.activities`).
5. `confirm()`'s `detail` renders a plain interpolated string below the message (verified `useConfirm.ts:9,23,54`).

## Approach

### 1. Store: one named seam for the surprising mapping

`delete the override child = restore the series` is the least-obvious mapping in this change — a maintainer reading the modal must not have to know that `deleteActivity(childId)` is what un-suppresses the original, and a careless "cleanup" must not be able to swap it for `isActive:false` and silently break reset. So give the reset path a **thin, documented store verb** alongside the existing `materializeOverride`/`splitActivity`:

```
/** Reset a rescheduled/edited single occurrence back to the recurring series default:
 *  removing the one-off override child lifts overridesByParent's suppression, so the
 *  master's original occurrence reappears (in-app + on Google via the exception restore
 *  path). This is the ONLY intentional restore — deletion of a session must NOT restore. */
function resetOccurrenceToSeries(childId: string): Promise<boolean> { return deleteActivity(childId); }
```

The **cancel** path stays inline in the modal (`updateActivity(child,{isActive:false})` reads clearly on its own — no wrapper). No other store change.

### 2. Modal: branch the delete, add the reset

**IMPORTANT — fix the pre-existing top-level close first.** `handleDelete` currently fires `emit('close')` as its _first_ statement (`:587`), so a failure toast would fire after the modal already vanished, defeating the never-silent-failure contract. **Move `emit('close')` out of the top and emit it only on each success path** (both the scope branches at `:590-614` and the plain branches below). Structure every branch as a guarded early `return` (no trailing `else`) so the function stays a flat sequence, not a nested pyramid.

**`handleDelete` (`:584`)** — new branch inside the `recurrence:'none'` path, before the existing plain delete (`:616`):

```
// Override child (a moved/edited session) → CANCEL this occurrence; never restore.
if (act.parentActivityId) {
  if (!(await showConfirm({ title: 'planner.deleteSession.title', message: 'planner.deleteSession.message', variant: 'danger' }))) return;
  const updated = await activityStore.updateActivity(act.id, { isActive: false });
  if (updated) { playWhoosh(); emit('deleted', act.id); emit('close'); }
  else showToast('error', t('planner.sessionActionFailed.title'), t('planner.sessionActionFailed.message'));
  return;
}
// true one-off → same return-check (in scope, not optional — the two adjacent paths must be consistent)
if (!(await showConfirm({ title: 'planner.deleteActivity', message: 'planner.deleteConfirm', variant: 'danger' }))) return;
const removed = await activityStore.deleteActivity(act.id);
if (removed) { playWhoosh(); emit('deleted', act.id); emit('close'); }
else showToast('error', t('planner.sessionActionFailed.title'), t('planner.sessionActionFailed.message'));
```

(Apply the same "emit close only on success" to the scope-delete branches when moving the top-level `emit('close')`.)

Two small notes for the implementer: (1) the cancel branch emits `'deleted'` even though the child is not literally deleted (it's cancelled/inactive) — add a one-line comment so a future maintainer doesn't "fix" it into a new `@deleted` coupling; no consumer listens to `@deleted` today. (2) Pass `surface: 'activity-session-action'` to the failure `showToast` calls for telemetry grouping; the failures (record-not-found `null`, vacation-linked `false`) are unexpected-but-benign — keep them non-silent (worth one Slack page) rather than `silent:true`.

**Reset action** — computeds (one source of truth for the moved-from date; no repeated formatting or double-bangs) + handler:

- `isOverrideInstance = computed(() => !!activity.value?.parentActivityId)`
- `movedFromLabel = computed(() => activity.value?.originalOccurrenceDate ? formatDateWithDay(activity.value.originalOccurrenceDate) : null)` — single source; `isMoved` = `movedFromLabel.value !== null`.
- `overrideBannerText = computed(() => movedFromLabel.value ? fillTemplate(t('planner.override.movedFrom'), { date: movedFromLabel.value }) : t('planner.override.editedOnly'))`
- `resetLabel = computed(() => (movedFromLabel.value ? t('planner.reset.labelMoved') : t('planner.reset.label')))`

```
async function handleReset() {
  const act = activity.value; if (!act) return;
  const detail = movedFromLabel.value
    ? fillTemplate(t('planner.reset.detailMoved'), { date: movedFromLabel.value })
    : t('planner.reset.detailEdited');
  if (!(await showConfirm({ title: 'planner.reset.title', message: 'planner.reset.message', detail, variant: 'info', confirmLabel: 'planner.reset.confirm' }))) return;
  const ok = await activityStore.resetOccurrenceToSeries(act.id);
  if (ok) { playWhoosh(); emit('close'); }
  else showToast('error', t('planner.sessionActionFailed.title'), t('planner.sessionActionFailed.message'));
}
```

**Template** — a Sky-Silk banner at the top of the modal body, `v-if="isOverrideInstance && !showReschedule"` (hidden while the reschedule form is open, like the other controls):

```
<div v-if="isOverrideInstance && !showReschedule"
     class="flex items-center justify-between gap-2 rounded-2xl bg-[var(--tint-silk-20)] px-3 py-2 text-xs text-[var(--deep-slate)]/80 dark:bg-slate-800 dark:text-slate-300">
  <span>{{ overrideBannerText }}</span>
  <BaseButton variant="ghost" size="sm" @click="handleReset">{{ resetLabel }}</BaseButton>
</div>
```

Placement: first child of the modal-body container (it's _context_, so it leads), inside the existing scroll region. Confirm the exact insertion point against the current template.

Add the four imports (Caveats). `emit('close')` after reset is sufficient (Pinia state is reactive; the list auto-refreshes). Verify the parent (`FamilyPlannerPage`/`FamilyNookPage`) doesn't rely on a `'deleted'` emit to refresh after a reset — if it shows a toast off `'deleted'`, prefer a no-op close; low risk.

### 2. Strings (`uiStrings.ts`)

New keys (each `en` + `beanie`; `beanie` all-lowercase per the casing standard; `{date}` filled via `fillTemplate`):

- `planner.deleteSession.title` = "Delete this session?" · `planner.deleteSession.message` = "Only this one is removed; the rest of the series stays."
- `planner.override.movedFrom` = "Moved from {date}." · `planner.override.editedOnly` = "Edited just for this session."
- `planner.reset.label` = "Reset to series" · `planner.reset.labelMoved` = "Reset to series time"
- `planner.reset.title` = "Reset this session?" · `planner.reset.message` = "Undo this one-off change." · `planner.reset.detailMoved` = "It goes back to {date} and your one-off change is removed." · `planner.reset.detailEdited` = "It goes back to the series default and your changes to it are removed." · `planner.reset.confirm` = "Reset"
- `planner.sessionActionFailed.title` = "Couldn't update this session" · `planner.sessionActionFailed.message` = "Something went wrong — please try again." (Reuse an existing generic failure key if one already fits.)

### 3. Google sync — none

No sync code changes. After `updateActivity(child,{isActive:false})` / `deleteActivity(child)` mutate the CRDT, the calendar edit-watcher debounces a reconcile that recomputes the exception plan: an inactive child → `mode:'cancel'` → the stored instance is cancelled; a removed child → `exceptionRestores` → the instance is restored (both already implemented + tested). Add one integration assertion that the wiring holds (not new sync code).

## Files Affected

- `src/stores/activityStore.ts` — add `resetOccurrenceToSeries(childId): Promise<boolean>` (documented one-line wrapper over `deleteActivity`; export in the store return). The cancel path stays inline in the modal (no wrapper).
- `src/components/planner/ActivityViewEditModal.vue` — move the top-level `emit('close')` to the success paths; branch `handleDelete` on `parentActivityId` (with return-checks, guard-clause returns); add `isOverrideInstance`/`movedFromLabel`/`overrideBannerText`/`resetLabel` + `handleReset` (calls `resetOccurrenceToSeries`); add the Sky-Silk context banner; add 4 imports (`formatDateWithDay`, `fillTemplate`, `BaseButton`, `showToast`).
- `src/services/translation/uiStrings.ts` — new `en`+`beanie` keys (delete-session, override banner, reset, failure).
- Tests: `activityStore.test.ts` — rename `:1358` to the reset-path semantics (assertions unchanged) + ADD a cancel-path test (inactive override child → original stays suppressed, override renders nothing). `ActivityViewEditModal` — banner shows only for an override instance with adaptive label; delete of an override calls `updateActivity({isActive:false})` (not `deleteActivity`); reset calls `deleteActivity`; a falsy store return surfaces a toast (no whoosh/emit); confirm copy + `variant:'info'` on reset asserted; no banner for a master occurrence or a true one-off. A `calendarSyncStore` assertion that cancel→exception-cancel and reset→exception-restore.
- `src/content/help/features.ts` — light update to the planner activities article (see Help Center Coverage).
- (No change to `useActivityScopeEdit.ts` — `handleScopedDelete` is dead code; any cleanup is out of scope.)

## Help Center Coverage

The change introduces a **new user action** (Reset to series) and changes what deleting a single session does — worth a short mention where single-session editing is documented.

- **Action**: `update existing`
- **Category**: `features`
- **Slug**: `family-planner-and-activities` (existing)
- **Title**: unchanged
- **Scope**: A sentence or two: you can reschedule or edit a single session of a repeating activity; **deleting** that session removes just it (the rest of the series is untouched, and it won't reappear); and **Reset to series** puts a moved/edited session back to its original recurring time.
- **Notes**: Make the delete-vs-reset distinction explicit and brief — delete = gone; reset = back to the series default. No restore-on-delete.

## Acceptance Criteria

- [ ] Delete a **moved** session → it's gone; the original does NOT reappear (in-app and on Google).
- [ ] Delete an **edited** session → same (gone, no restore).
- [ ] **Reset to series** on a moved session → returns to its original slot (in-app and on Google).
- [ ] **Reset to series** on an edited session → returns to the series default (in-app and on Google).
- [ ] The reset banner/action appears **only** on an override instance and adapts wording (moved vs edited).
- [ ] Deleting a **master** occurrence (scope: this-only / this-and-future / all) and deleting a **true one-off** are unchanged.
- [ ] Delete confirm has no restore mention; reset confirm is `variant:'info'` with accurate, brief copy.
- [ ] A non-throw store failure surfaces a toast and does NOT whoosh/emit success (no silent failure).
- [ ] Cancelling the delete/reset/scope confirm now **keeps the drawer open** (a positive side effect of moving `emit('close')` off the top — no longer closes regardless of the answer).
- [ ] In-app and Google stay consistent after each action (converges on the next reconcile).
- [ ] `:1358` renamed to reset semantics; cancel-path test added; type-check + lint + unit suite green; all new strings have `en`+`beanie`.
- [ ] Help Center planner article updated + verified.

## Testing Plan

1. **Unit — `activityStore` (the core semantics live here — prefer these over the heavyweight modal mount)**: NEW cancel-path test — push an override child with `isActive:false`; assert `overridesByParent`/`monthActivities` still suppresses the original occurrence AND the inactive override renders nothing. `resetOccurrenceToSeries(childId)` — removing the child lifts suppression → original returns (a thin test of the named seam). RENAME `:1358` (reset path) — child removed → original returns; assertions unchanged, name/comment corrected (it exercises expansion, not a delete handler).
2. **Component — `ActivityViewEditModal` (kept THIN — the modal pulls in ~7 stores + router; don't re-test store semantics here)**: banner renders only when `parentActivityId` set with the correct adaptive label; delete on an override calls `updateActivity({isActive:false})`; reset calls `resetOccurrenceToSeries`; **a mocked falsy return → `showToast('error')` fires and NO whoosh/`emit`, and the modal does not report success**; **cancelling the delete/reset confirm → NO `close` emit (drawer stays open)**; reset confirm passes `variant:'info'`; no banner for a master occurrence or a true one-off.
3. **Store integration — `calendarSyncStore` (fake client)**: after `updateActivity({isActive:false})` on an override, a reconcile issues an exception **cancel**; after `deleteActivity` on an override, a reconcile issues an exception **restore** (reuse the exceptions test harness).
4. **Manual (dev + connected calendar)**: reschedule a session → delete it → gone in-app and on Google, original NOT back. Reschedule → Reset to series → original slot returns both places. Repeat for an edited (not moved) session. Confirm the amber reschedule + master-occurrence scope-delete are untouched.
5. `npm run type-check`, `npm run lint`, unit suite, build.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the pre-plan intake + code trace. Located the bug (`handleDelete` plain path removes the override → restore), scoped the change to a single `parentActivityId` branch (cancel) + an explicit reset (the old remove). Adaptive banner/labels/confirm per the design guidance; zero Google-sync changes (cancel/restore map to existing exception paths); light planner help update.
- **Pass 2 (DRY + error handling)**: Fixed a real silent-failure gap — `updateActivity`/`deleteActivity` return falsy on non-throw failures, so the modal now branches on the return (toast on failure, whoosh/emit only on success). Corrected the confirm `variant` to `'info'` (`'danger'|'info'` only; default is danger). Fixed a typography violation (`text-[0.8rem]`→`text-xs`). Corrected the `:1358` characterisation (it tests expansion, not delete — the reset semantics stay true; rename + add a cancel-path test rather than "invert"). Dropped store wrappers — `handleScopedDelete` is verified dead code (single consumer). Named the missing modal imports.
- **Pass 3 (Sustainability)**: Caught a blocking reliability bug — `handleDelete` emits `'close'` as its first statement, so a failure toast would fire on an already-closed modal (defeats the no-silent-failure fix); moved `emit('close')` to the success paths, flat guarded returns. Added ONE named store seam `resetOccurrenceToSeries` (documented) — `delete = restore` is the most surprising mapping and must be self-documenting + protected from a careless swap; cancel stays inline. Re-weighted tests toward the store (core semantics) and kept the component test thin (the modal pulls in ~7 stores). Documented the moved/edited discriminator as best-effort (an edited-then-rescheduled override won't carry `originalOccurrenceDate`). Collapsed the duplicated `formatDateWithDay` + double non-null assertions into one `movedFromLabel` source. Promoted the one-off delete return-check from "optional" to in-scope (adjacent paths stay consistent).
- **Pass 4 (Fresh-eyes sweep)**: Verified sound against code — no string-key collisions (all four namespaces free); moving `emit('close')` is safe (no caller listens to `@deleted`, no overlay stacking dependency) and fixes a latent bug (cancelling a confirm now keeps the drawer open — added as a criterion + test); delete=cancel/reset=restore are structurally isolated from the master scope-delete (override children are `recurrence:'none'`); sync claims re-confirmed against `reconcilePlan.ts`. Fixed the one real defect — a stale self-contradiction (Caveat said "no wrappers" after Pass 3 added `resetOccurrenceToSeries`); restated the final one-wrapper decision. Marked the scope-branch silent-failure as an intentional out-of-scope exclusion. Noted the `'deleted'`-emit-on-cancel semantic (comment it), a `surface` tag for the failure toasts, and that the `{date}` isn't localized (consistent with every other date render — no action).

## Prompt Log

> No GitHub issue created. This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (assembled via /beanies-pre-plan → /beanies-plan)

The `=== BEANIES PRE-PLAN ===` block: change per-occurrence delete semantics for recurring activities (delete always deletes, never silently restores) + add an explicit "Reset to series" action; design guidance (Sky-Silk banner, quiet ghost reset, adaptive moved/edited copy, no mockup); reuses the 2026-07-12 recurring-exceptions cancel/restore Google-sync paths; Type feature, Priority medium, no GitHub issue, ungated.

### Decisions (pre-plan AskUserQuestion)

Type: Enhancement (feature) · Priority: Medium · GitHub issue: Skip · Feature gate: Ungated. Design/placement via /frontend-design (text, no mockup). App-wide "delete never restores" audit deferred (behavior specific to recurring activities).

</details>
