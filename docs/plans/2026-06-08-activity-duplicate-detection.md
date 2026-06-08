# Plan: Duplicate-activity detection for the AI extraction wedge (confirm-prompt)

> Date: 2026-06-08
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-08-activity-duplicate-detection.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the Prompt Log below.

## User Story

As a parent who occasionally re-uploads the same invitation/notice (or a near-identical one), I want beanies to notice when an AI-extracted activity looks like one I already have and ask whether to update the existing one — so I don't end up with duplicate calendar entries.

## Context

The travel wedge dedups (`segmentMerge.ts` `mergeExtractedIntoVacation`) because segments have strong identity keys. The activity wedge has NO dedup: `useDocumentToActivity` → `extractionToActivityPrefill` → `onPhotoActivityReady` (`FamilyPlannerPage`) → `ActivityModal` (new mode, `onNew` → `applyPrefill`) → `activityStore.createActivity` always creates a fresh activity. Re-uploading the same invite → a duplicate. Activities lack strong identity keys (two real events can share title+date), so the chosen design is a CONFIRM-PROMPT (user decides), not silent merge.

## Requirements

1. When an AI-extracted prefill closely matches EXACTLY ONE existing activity, show a confirm prompt: "Looks like you already have ‹title› on ‹date› — update it instead of adding a new one?" with **Update existing** / **Add anyway**.
2. 0 matches or 2+ matches → behave exactly as today (open the new-activity modal, no prompt).
3. "Add anyway" → today's exact behavior (new-activity modal pre-filled).
4. "Update existing" → open ActivityModal in EDIT mode against the matched activity, merged NON-DESTRUCTIVELY (fill only blank fields; append new notes lines; never overwrite user data); source document attaches to the EXISTING activity. User still reviews + saves.
5. Matching: require same `date` AND a strong fuzzy title match; conservative.
6. Skip detection (→ add new) when prefill has no date or no title.
7. v1 scope: match only NON-recurring activities (`recurrence === 'none'`) that are NOT recurrence-override children (`!parentActivityId`). Recurring and overrides explicitly out of scope (documented).
8. Detection must never throw — wrap and fall back to add-new with a console.warn.
9. New strings via i18n (en + beanie + zh).
10. Client-only (no prompt/Lambda change). User-visible → CHANGELOG.

## Reuse audit (verified)

- **`confirm()`** (`src/composables/useConfirm.ts:48`) + `ConfirmModal`: `confirm({ title, message, detail?, variant?, showCancel?, confirmLabel?, cancelLabel? }): Promise<boolean>` — VERIFIED signature; `title`/`message`/`confirmLabel`/`cancelLabel` are `UIStringKey`s, `detail` is a plain (untranslated) string. `showCancel` defaults true → both buttons render. `confirm` already imported in `FamilyPlannerPage.vue`. No new modal.
- **`mergeNotes`** exported from `src/utils/segmentMerge.ts:93` (append + case-insensitive line dedupe via `dedupedAppend`, drops blank lines, returns `undefined` when empty) — REUSE for notes.
- **Generic-field-merge pattern** in `mergeOneSegment` (`segmentMerge.ts:109-143`): iterate `Object.entries(incoming)`, skip a `SPECIAL_KEYS` set, copy only non-empty strings. The new merge helper follows this shape (iterate the prefill's own keys).
- **`keyPart`** (`segmentMerge.ts:36`) is private + a single-key collapser, NOT a tokenizer — the new util defines its own token normalizer (not duplication).
- **`formatDateFull`** (`src/utils/date.ts:68`) already imported in `FamilyPlannerPage.vue` — reuse for the prompt `detail` date.
- **`activityStore.activeActivities`** is the candidate set.
- **Prefill surface (VERIFIED, `extractionToActivity.ts:102-130`)**: `extractionToActivityPrefill` only sets `title`, `date`, `location`, `notes`, `isAllDay`, `startTime`, `endTime`, `category`. Routes overflow free-text to `notes`, NOT `description`. All eight keys are valid `FamilyActivity` keys, so a generic spread into a `FamilyActivity` copy is type-sound.

## Important Notes & Caveats

- **Integration point** `FamilyPlannerPage.onPhotoActivityReady` (:162-184, VERIFIED): today sets `sidebarDate=null`, `editingActivity=null`, `editingOccurrenceDate=undefined`, `selectedDate=undefined`, `defaultStartTime=undefined`, `defaultAssigneeId=undefined`, `activityPrefill=ready.prefill`, `activityPrefillConfidence=ready.confidence`, `activitySourcePhoto=ready.sourcePhoto`, then close-reopens (`showModal=false` → `nextTick` → `showModal=true`). The check inserts BEFORE close-reopen; `await confirm(...)` makes the fn async; close-reopen stays after the await.
- **`useFormModal` dispatch (VERIFIED)**: the open-watch calls `onEdit(entity)` when `editingActivity` is truthy, else `onNew()`. So the update path just sets `editingActivity` to a truthy merged copy before the toggle; `onNew`/`applyPrefill` never fires on this path.
- **"Update existing" wiring — drive entirely through `editingActivity`.** `onEdit` (:243-278) rebuilds EVERY form field from `props.activity` + auto-expands "more details" via `hasDetailData`. Page sets `editingActivity.value = mergeExtractionIntoActivity(match, ready.prefill)` (copy KEEPS `match.id`). Matched activity is `recurrence === 'none'` and `editingOccurrenceDate` undefined → `handleSave` edit branch skips the scope modal (VERIFIED `:396-407`) → direct `updateActivity(id, data)`.
- **Prefill refs on the update path (EXPLICIT).** `applyUpdateExisting` sets `activitySourcePhoto.value = ready.sourcePhoto` but CLEARS `activityPrefill`/`activityPrefillConfidence` (they belong to the new-activity path; verified inert on the edit path — `props.prefill` is read only inside `applyPrefill`/`onNew`, and the low-confidence banner is `wasPrefilled`-gated which `onEdit` sets false). Clearing is the leak-proof choice.
- **Source-photo on update — CONFIRMED GAP (VERIFIED `:276-277`).** `onEdit` hard-sets `pendingSourcePhoto.value = null` AND `setSourcePhotoPreview(null)`, never reading `props.sourcePhoto`. `onNew` (:315-316) already stages `props.sourcePhoto ?? null`. Fix makes `onEdit` symmetric:
  ```
  pendingSourcePhoto.value = props.sourcePhoto ?? null;
  setSourcePhotoPreview(props.sourcePhoto ?? null);
  ```
  Safe for normal edits (page clears `activitySourcePhoto` on `openAddModal`/`@close` → `props.sourcePhoto === undefined` → `?? null` identical to today). The existing `maybeAttachSourcePhoto` watch (:644-650) + `eager.ensureId()` attach the doc to the EXISTING id. Only this one `onEdit` change.
- **confirm() usage:** `variant:'info'`; `confirmLabel:'planner.duplicate.updateExisting'` (→ true); `cancelLabel:'planner.duplicate.addAnyway'` (→ false). `detail = ${match.title} • ${formatDateFull(match.date)}`. Escape/backdrop → false → add-new (safe default).
- Conservative threshold; distinct same-day events with different titles must NOT match. No fuzzy dependency.

## Important edge case (Pass 4): all-day / timed consistency in the merge

The generic blank-fill rule can produce a (non-fatal, user-reviewable) inconsistency: the EXISTING activity and the prefill can disagree on the all-day/timed axis. Two cases: existing **timed** + prefill `isAllDay:true` → would set all-day while `startTime` survives; existing **all-day** + prefill `startTime`/`endTime` → times fill into an all-day activity.

Guard in `mergeExtractionIntoActivity`: treat the all-day/time triplet as coupled — only adopt prefill's `isAllDay`/`startTime`/`endTime` when the existing activity has NO time signal at all (`!existing.isAllDay && !existing.startTime && !existing.endTime`); otherwise keep the existing schedule untouched. Covered by a unit test.

## Assumptions

1. `activeActivities` filtered to `recurrence === 'none' && !parentActivityId && date === prefill.date` is sufficient.
2. Jaccard token-overlap, threshold ~0.6 (+ normalized-equality short-circuit → 1.0). Tunable via the single `threshold` param.
3. `confirm()` binary adequately expresses Update existing / Add anyway; escape = Add anyway acceptable.
4. `recurrence === 'none'` match → direct update path (no scope modal) — verified at `:396-407`.

## Approach

### A. New pure util `src/utils/activityDuplicate.ts`

- `titleTokens(title): Set<string>` — lowercase, split on non-alphanumeric, drop empties.
- `titleSimilarity(a, b): number` — Jaccard over token sets (0..1); 1 when token sets equal; 0 when either empty.
- `findDuplicateActivity(prefill, candidates, threshold = 0.6): FamilyActivity | null` — null if `!prefill.date || !prefill.title?.trim()`; filter `a.recurrence === 'none' && !a.parentActivityId && a.date === prefill.date`; keep `titleSimilarity ≥ threshold`; exactly 1 → return it; 0 or 2+ → null. Pure + total.
- `mergeExtractionIntoActivity(existing, prefill): FamilyActivity` — `{ ...existing }` (KEEPS id). Generic fill mirroring `mergeOneSegment`: iterate `Object.entries(prefill)`; for each key NOT in `SPECIAL_KEYS`, set ONLY when the existing value is blank/unset and the prefill value is a non-empty string. `SPECIAL_KEYS` = `{ id, title, notes, recurrence, isAllDay, startTime, endTime, assigneeIds, assigneeId, ... }`. `notes` via `mergeNotes(existing.notes, prefill.notes)`. The all-day/time triplet handled by the coupled guard above. Pure + total.

### B. `FamilyPlannerPage.onPhotoActivityReady` → async, flat, two helpers

- `openActivityModalReset()` — resets `sidebarDate/editingOccurrenceDate/selectedDate/defaultStartTime/defaultAssigneeId` + `showModal=false` → `nextTick(() => showModal=true)`.
- `applyAddNew(ready)` — `editingActivity=null`, `activityPrefill=ready.prefill`, `activityPrefillConfidence=ready.confidence`, `activitySourcePhoto=ready.sourcePhoto`, then `openActivityModalReset()`.
- `applyUpdateExisting(match, ready)` — `editingActivity=mergeExtractionIntoActivity(match, ready.prefill)`, clear `activityPrefill`/`activityPrefillConfidence`, set `activitySourcePhoto=ready.sourcePhoto`, then `openActivityModalReset()`.
- Body:
  ```
  let match = null;
  try {
    match = findDuplicateActivity(ready.prefill, activityStore.activeActivities);
  } catch (err) {
    console.warn('[activity-extract] duplicate detection failed; adding new', err);
  }
  if (!match) return applyAddNew(ready);
  const update = await confirm({
    title: 'planner.duplicate.title',
    message: 'planner.duplicate.message',
    detail: `${match.title} • ${formatDateFull(match.date)}`,
    variant: 'info',
    confirmLabel: 'planner.duplicate.updateExisting',
    cancelLabel: 'planner.duplicate.addAnyway',
  });
  return update ? applyUpdateExisting(match, ready) : applyAddNew(ready);
  ```

### C. ActivityModal `onEdit` source-photo staging (REQUIRED)

- Replace the two hard-null lines (:276-277) with `props.sourcePhoto ?? null` staging — symmetric with `onNew` (:315-316). Only ActivityModal change.

### D. i18n (`uiStrings.ts`, en + beanie + zh)

- `planner.duplicate.title`, `planner.duplicate.message`, `planner.duplicate.updateExisting`, `planner.duplicate.addAnyway`.

### E. Tests

- `src/utils/__tests__/activityDuplicate.test.ts`:
  - `findDuplicateActivity`: same-date+similar → match; different date → null; low similarity → null; missing date → null; blank/whitespace title → null; recurring excluded; override child (`parentActivityId` set) excluded; 2+ similar same-day → null.
  - `titleSimilarity`: equal→1, disjoint→0, partial→Jaccard.
  - `mergeExtractionIntoActivity`: fills blanks only; never overwrites populated; notes appended+deduped; id/recurrence/title/assigneeIds preserved; a NEW arbitrary prefill key applied without code change; all-day/time coupling guard (timed existing + prefill `isAllDay` → schedule untouched; all-day existing + prefill times → untouched; empty-schedule existing + prefill all-day → adopted).
- No full-mount ActivityModal test (testing discipline).

## Files Affected

- `src/utils/activityDuplicate.ts` (new); `src/utils/__tests__/activityDuplicate.test.ts` (new).
- `src/pages/FamilyPlannerPage.vue` (async detection + `openActivityModalReset`/`applyAddNew`/`applyUpdateExisting` locals).
- `src/components/planner/ActivityModal.vue` (onEdit source-photo staging — 2 lines).
- `src/services/translation/uiStrings.ts` (4 keys × 3 locales).
- `CHANGELOG.md`, `docs/STATUS.md`.

## Acceptance Criteria

- [ ] Same date + similar title re-upload → confirm prompt.
- [ ] "Update existing" → existing activity edit mode, merged non-destructively, source doc attached, save updates (no new activity, no scope modal).
- [ ] "Add anyway"/escape → today's new pre-filled activity.
- [ ] 0 or 2+ matches → no prompt.
- [ ] No date/title → no prompt.
- [ ] Recurring AND recurrence-override children never matched (v1).
- [ ] Merge helper applies any future prefill field generically (no hand-maintained field list; no dead `description` branch).
- [ ] Merge never produces an all-day activity that retains times (or vice versa): an existing timed/all-day schedule is preserved.
- [ ] Detection never throws; fallback add-new with console.warn.
- [ ] Normal non-AI edits unchanged (no source photo staged).
- [ ] `npm run validate` green.

## Testing Plan

1. Unit: activityDuplicate helpers (incl. override-child exclusion, generic-fill assertion, all-day/time guard).
2. Manual: upload+save invite; re-upload → prompt → Update existing → merged + doc attached → one activity. Add anyway → two.
3. Manual: two distinct same-day titles → no prompt on 2nd.
4. Manual: no-date extraction → no prompt.
5. Manual regression: pencil-edit an activity → no source-photo preview, save works.

## Review Passes

- **Pass 1 (Initial draft)**: confirm-prompt dedup — pure match+merge helpers, async branch reusing confirm()/ConfirmModal, edit-mode merge keeping id, source-photo-on-update, conservative matching, recurring out of scope.
- **Pass 2 (DRY / error-handling, verified)**: reused `mergeNotes` + already-imported `confirm`/`formatDateFull`; corrected the `keyPart` claim; made the one-line onEdit source-photo fix mandatory; pushed all merge into the pure util; factored the shared reset into a local helper; non-silent console.warn fallback + normal-edit regression criterion.
- **Pass 3 (Sustainability, verified)**: generic `Object.entries(prefill)` merge (kills dead `description` + drift); flattened the async branch via `applyAddNew`/`applyUpdateExisting`; excluded recurrence-override children; bounded blast radius.
- **Pass 4 (Fresh-eyes final, verified against source)**: re-verified every cited line; made the update-path prefill-ref handling explicit (set source photo, clear prefill/confidence); added the all-day/timed consistency guard + tests so the generic merge can't emit a self-contradictory schedule.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial question (verbatim)

"Have a quick question - if the same (or very similar) activity is uploaded twice, what is the behavior? For travel plans, if a doc/image for an existing travel plan is uploaded, the information for that segment will be updated rather than creating a new segment. Does the same logic exist for activities? To avoid creating duplicate activities"

### Direction (verbatim)

"plan it with the confirm-prompt approach"

</details>
