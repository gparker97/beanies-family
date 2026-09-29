# Plan: Magic beans to-dos, round 2: flag duplicates on a re-read, and keep the time

> Date: 2026-09-29
> Related issues: Notion tracker #113 (follow-up from greg's testing, same session). No GitHub issue (directive: SKIP).
> Plan file: `docs/plans/2026-09-29-magic-beans-todo-dedupe-and-times.md`
> Builds on: `docs/plans/2026-09-29-magic-beans-todos-and-shared-results.md` (uncommitted, reviewed twice)

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent who forwards the same school note twice (or re-reads an activity), I want beanies to notice the to-dos I already have instead of adding them again, and when a note says "at 10am" I want the to-do to keep that time.

## Context

greg tested #113 on real notes (a six-action soccer note came through whole) and found two gaps:

1. **Duplicates on a re-read.** Reading the same note again (or re-reading an activity) creates the same to-dos a second time. The review drawer never compares against what already exists.
2. **Time is dropped.** "Remind me to walk the dog tomorrow at 10am" became a to-do dated tomorrow with no time. `TodoItem.dueTime` (HH:mm, `models.ts:704`) exists and the to-do editor edits it, but the to-do extraction shape never asks the model for one.

Facts this plan relies on (verified 2026-09-29):

- `tokenSimilarity(a, b)` (`src/utils/textSimilarity.ts`): word-token Jaccard in [0,1], script-agnostic, already the single similarity used by `activityDuplicate.ts` (`titleSimilarity` alias; `findDuplicateActivity`'s default title threshold is 0.6, `activityDuplicate.ts:28`) and `statement/match.ts` (as one input to a combined score). Real-model evidence that exact matching is not enough: the same field-trip note came back once as "Pack sunscreen, a hat and a packed lunch" and once as "Pack sunscreen, hat, and packed lunch".
- `findDuplicateActivity(prefill, candidates, threshold = 0.6)` (`activityDuplicate.ts:25`): pure, sync; needs `title` + `date`; only one-off, non-override activities on the same date; returns a match only when exactly one qualifies. `continueActivityCapture` (`FamilyPlannerPage.vue` ~~:537-553) calls it AFTER the drawer; `onPhotoActivityReady` (~~:491-534) opens the drawer first while the capture is parked.
- Statement import's duplicate presentation: per-line decision with a default (`planStatementImport.ts:49, :62-64`), a possible match defaults to skip when strong, with a "why" line (`StatementImportPairCard.vue:73-85`; copy `statementImport.pair.possible` "Possibly already in beanies", `.possibleSkipWhy`, uiStrings ~:11165-11190).
- `todoStore`: `todos`, `activeTodos` (:54, includes hints), `somedayTodos` (:68), `openTodosForActivity(id)` (:274).
- Time: `asWallClockTime(v, field, rejected)` (`extractionPrompt.ts:277`, strict HH:mm via `isWallClockTime`, `date.ts:293`), used for event `startTime`/`endTime` (:406-407). `TimePresetPicker` (`src/components/ui/TimePresetPicker.vue`, `modelValue` string, `update:modelValue`), used in `TodoViewEditModal.vue:447`, shown only with a date (:427), cleared with the date (:106). Reminders and overdue logic assume `dueTime` only with `dueDate` (`useScheduledReminders.ts:329`, `utils/todo.ts:12`).
- To-do prompt surfaces: `TODO_JSON_SHAPE` (`extractionPrompt.ts` ~~:788) in all three copies (`scripts/spikes/extractionPrompt.mjs`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs`), kept identical by `extractionPromptDrift.test.ts`; `TodoItemExtraction` (`types.ts:192`); `parseTodoItem` (~~:1118-1156); `TodoDraft` + `buildTodoDrafts`/`resolveTodoDue` (`src/utils/magicTodoDrafts.ts`); drawer `onSave` (`MagicTodoReviewDrawer.vue` ~:224-297, `dueDate: d.dueDate || undefined` ~~:259) and its `BeanieDatePicker` (~~:465).

## Requirements

1. **Due time extraction.** The to-do shape gains `dueTime`: 24-hour HH:mm only when the text states a time for doing it ("at 10am" → "10:00"), else null. Parsed with `asWallClockTime(item.dueTime, 'todo.dueTime', rejected)`. Bump `PROMPT_VERSION` in all three copies.
2. **Time rules.** A `dueTime` is kept only with a stated date, or a derived date that was not clamped to today (a time on a clamped date would arrive overdue with no reminder: `utils/todo.ts:11-20`, `useScheduledReminders.ts:333`). The model is told never to use the event's start or end time as a to-do's `dueTime`. Clearing the date in the drawer clears the time.
3. **Drawer time field.** Each row shows `TimePresetPicker` next to the date picker when the row has a date (mirrors `TodoViewEditModal`), and save passes `dueTime`.
4. **Duplicate detection (pure).** For each draft, look for an existing to-do that is the same thing: `tokenSimilarity(draft.title, todo.title) >= 0.6` (the shared threshold), within a narrow candidate set:
   - Non-hint to-dos where either (a) there is a probable existing activity and `t.activityId` is that activity (open or done), or (b) the to-do is open and its `dueDate.slice(0, 10)` equals the draft's date (both undated counts as equal). (b) also applies with a probable activity, so an unlinked copy (first read's activity form closed unsaved, or the activity made by hand) is still caught.
     The best match above the threshold wins; each existing to-do can match at most one draft.
5. **Probable activity.** `onPhotoActivityReady` calls `findDuplicateActivity(ready.prefill, activityStore.activeActivities)` before opening the drawer and passes the id in `TodoReviewReady` (`probableActivityId`). It is only a hint for matching; `continueActivityCapture` still runs its own check and the user's choice there stands.
6. **Presentation.** A matched row starts skipped and collapsed, labelled "Already on your list" (or "Already done" when the match is completed), with an "Add anyway" action (the existing undo-skip, relabelled for this case). Nothing is ever dropped silently: the row is visible and one tap adds it.
7. **Save label + counts** follow what is kept, as today (a fully duplicate shared read reads "Add the activity").
8. **Help Center:** `share-to-beanies` mentions that to-dos you already have are flagged, and that a stated time is kept.

## Important Notes & Caveats

- Do not auto-drop duplicates; default to skip with a visible reason (statement import principle).
- Keep the candidate set narrow; that is what makes fuzzy matching safe (0.6 across ALL open to-dos would catch unrelated "Pay the fee" items).
- Helpful-hint to-dos (`hintType`/`hintKey`) are never candidates.
- A duplicate linked to the probable activity stays linked; kept (added-anyway) drafts link to whichever activity is saved, as today.
- Prompt copies must stay byte-identical; the Lambda gets a code-only apply (its legacy arm uses the prompt copy).
- No new telemetry context keys (reuse `action`, `count`, `stage`).
- American English, no em-dashes; `en` + `beanie` for every new string.

## Assumptions

1. `tokenSimilarity` at 0.6 separates re-reads ("Pack sunscreen, hat, and packed lunch" vs "Pack sunscreen, a hat and a packed lunch" ≈ 0.86) from distinct to-dos in the same activity; unit tests pin representative pairs.
2. `findDuplicateActivity` on the parked prefill gives the same answer the later confirm would (the store rarely changes in between; the later check is authoritative anyway).
3. `TimePresetPicker` fits in the drawer row beside `BeanieDatePicker` at 390px (wraps via the existing `flex-wrap`).

## Approach

### A. Due time (prompt, parser, drafts, drawer)

- `TODO_JSON_SHAPE`: add `dueTime` to the `items` "exactly these keys" list (`extractionPrompt.ts` ~:790) and describe it as `'string or null: 24-hour HH:mm, only when the source states a time for doing THIS to-do (e.g. "at 10am" -> "10:00"). Never the event\'s start or end time. Otherwise null'` (three copies, identical); `PROMPT_VERSION` bump.
- `TodoItemExtraction.dueTime: string | null` (`types.ts`); `parseTodoItem`: `dueTime: asWallClockTime(item.dueTime, 'todo.dueTime', rejected) || null`.
- `TodoDraft.dueTime?: string`; `resolveTodoDue` returns `dueTime` only with a stated date or an unclamped derived date. A stated time with no date to sit on (e.g. "call grandma at 3pm") is counted in `logOpened` by position, since drafts are 1:1 with items: `built.filter((d, i) => ready.result.items[i]?.dueTime && !d.dueTime).length` (no telemetry-only field on `TodoDraft`).
- `TimePresetPicker` gains an optional `clearable` prop: a ✕ rendered as a SIBLING of the trigger button (not nested inside it, unlike `BeanieDatePicker.vue:291-322`), shown when `modelValue` is set, emitting `''`, with aria-label from a new `time.clearAriaLabel` ("Clear time"); its 5 other users (MealEditModal, TodoViewEditModal, OnboardingActivity, ActivityModal, ActivityViewEditModal) are unchanged. Without it a wrong model time could only be removed by clearing the date.
- Drawer: `TimePresetPicker clearable` shown when `d.dueDate`; the date picker's `@update:model-value` clears `d.dueTime` when the date is emptied (the `TodoViewEditModal.vue:106` rule); `onSave` passes `dueTime: d.dueDate ? d.dueTime || undefined : undefined`.

### B. Duplicates (pure helper + wiring)

- `src/utils/magicTodoDrafts.ts`: ONE pure `markDuplicateDrafts(drafts, existing: readonly TodoItem[], { probableActivityId?, threshold = TITLE_MATCH_THRESHOLD })`, with a small pure `candidatesFor(draft, existing, probableActivityId)`: one filter over non-hint to-dos (`isHint`, `src/utils/helpfulHints.ts:158`) implementing Req 4's (a) OR (b), dates compared with `dueDate?.slice(0, 10)` (the to-do date rule, `todoStore.ts:90`). Threshold default `TITLE_MATCH_THRESHOLD` (see below). Pairs scored with `tokenSimilarity`, kept at ≥ threshold, then an inline greedy claim (sort by similarity desc, then draft index, then candidate index; skip a pair if either side is taken), about 5 lines with a comment naming `statement/match.ts` as the same pattern. The statement matchers are NOT touched: they claim by different keys (index vs id, with a pre-seeded set), so a shared helper would couple areas that change for different reasons. Returns new drafts with `duplicateOf: { id, done }` and `skipped: true` for matches.
- `src/utils/textSimilarity.ts` exports `TITLE_MATCH_THRESHOLD = 0.6`, used as the default by `findDuplicateActivity` (`activityDuplicate.ts:28`) and `markDuplicateDrafts`.
- `TodoReviewReady` gains `probableActivityId?: string`.
- `FamilyPlannerPage`: one `detectDuplicateActivity(prefill, stage)` wrapper around `findDuplicateActivity` with try/catch; on a throw it calls `reportError({ surface: 'ai-activity-capture', severity: 'warning', message: 'duplicate activity lookup failed; treating as new', error: err, context: { action: 'duplicate_check_failed', stage } })` and returns null. Used by `onPhotoActivityReady` (stage `todo_hint`, sets `probableActivityId`) and `continueActivityCapture` (stage `confirm`), replacing its console-only `console.warn` (`:539-544`).
- Drawer: a small `flagDuplicates(built, ready)` called from the watch after the build (keeping the watch flat: one try for the build, one call). It wraps `markDuplicateDrafts(built, todoStore.todos, { probableActivityId: ready.probableActivityId })` and on a throw calls `reportError({ surface: SURFACE, severity: 'warning', message: 'todo duplicate check failed; rows left unflagged', context: { stage: 'duplicate_check' }, error })` and returns `built` unchanged (today's behaviour), so a matching bug never costs the drafts or the activity. Template stays flat: `skipNote(d)` returns '' / `duplicate.open` / `duplicate.done` and `undoLabel(d)` returns `addAnyway` when `d.duplicateOf` is set, else `undoSkip`; the existing skipped block (`MagicTodoReviewDrawer.vue` ~:410-424) gains a `<p v-if="skipNote(d)" class="text-xs">` below its title/button line (inline would crush the truncated title at 390px) and binds its button text to `undoLabel(d)`. `duplicateOf` stays set after Add anyway so `duplicate_added_anyway` can count it. To-do-only reads get the date-scoped check with no page wiring (the drawer builds its own drafts), so `FamilyTodoPage` is unchanged.
- `detectDuplicateActivity` is the only caller of `findDuplicateActivity` on the page, so the fallback rule lives in one place. `probableActivityId` is not stored on `parkedCapture`: the confirm step runs its own check.

### C. Strings, help, telemetry

- Strings: `magicTodos.duplicate.open` ("Already on your list"), `magicTodos.duplicate.done` ("Already done"), `time.clearAriaLabel` ("Clear time" / "clear time"), `magicTodos.duplicate.addAnyway` ("Add anyway"; the existing `planner.duplicate.addAnyway` is Title Case "Add Anyway" for a button, while the drawer's inline actions are sentence case like `magicTodos.undoSkip`), no toast string for a failed check (it is reported, not shown).
- Help: `share-to-beanies` gets one sentence each for duplicates and times.
- Telemetry: `duplicates_flagged` (`count`, `stage`) once per review when any matched; `due_time_dropped` (`count`) in `logOpened` when any stated time had no date; `duplicate_added_anyway` (`count`) on a successful save when any kept row has `duplicateOf`.

### D. Lambda

- `infrastructure/lambda/ai-extract/extractionPrompt.mjs` copy updated; `scripts/infra/tf-plan.sh -target=module.ai_extract` must show only the code-hash change, then `tf-apply.sh`.

## Files Affected

- `src/services/ai/extractionPrompt.ts`, `scripts/spikes/extractionPrompt.mjs`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs`, `src/services/ai/types.ts`
- `src/utils/magicTodoDrafts.ts`, `src/utils/textSimilarity.ts`, `src/utils/activityDuplicate.ts`, `src/components/ui/TimePresetPicker.vue` (+ new `src/components/ui/__tests__/TimePresetPicker.test.ts`), `src/components/ai/MagicTodoReviewDrawer.vue`, `src/pages/FamilyPlannerPage.vue`
- `src/services/translation/uiStrings.ts`, `src/content/help/features.ts`
- Tests: `src/services/ai/__tests__/{shareExtraction,extractionPromptDrift}.test.ts`, `src/utils/__tests__/magicTodoDrafts.test.ts`, `src/components/ai/__tests__/MagicTodoReviewDrawer.test.ts`, `src/pages/__tests__/FamilyPlannerPage.magicTodos.test.ts`
- Docs: `docs/plans/2026-09-29-magic-beans-todo-dedupe-and-times.md`, `CHANGELOG.md`, `docs/STATUS.md`

## Help Center Coverage

- **Action**: update existing. **Category**: features. **Slug**: `share-to-beanies`. **Scope**: to-dos you already have are shown as "Already on your list" and left out unless you tap Add anyway; a time in the note ("at 10am") is kept on the to-do.

## Observability Coverage

- **`magic-todo-review`**: new `info` events `duplicates_flagged` (`count`, `stage`), `duplicate_added_anyway` (`count`), `due_time_dropped` (`count`); existing `opened`/`confirmed`/`dismissed` unchanged.
- **Parser:** a bad `dueTime` joins the existing deduped `reportRejectedFields` list as `todo.dueTime`.
- **Failures:** the duplicate-activity lookup (both call sites) reports `warning` `surface:'ai-activity-capture'` `action:'duplicate_check_failed'` with `stage`, then treats the capture as new (replacing a console-only warn). A failed to-do duplicate check reports `warning` (`stage:'duplicate_check'`) and leaves the rows unflagged.
- **Success-path signal:** `duplicates_flagged` vs `opened` gives the re-read duplicate rate.
- **Privacy:** no new context keys.

## Acceptance Criteria

- [ ] "Remind me to walk the dog tomorrow at 10am" → drawer row dated tomorrow at 10:00; saved to-do has `dueTime: '10:00'`.
- [ ] A derived-date to-do never carries the activity's start time; clearing the date clears the time.
- [ ] Re-reading the field-trip note after saving it: the 3 to-dos show "Already on your list" (skipped), save label "Add the activity"; Add anyway re-adds one.
- [ ] Re-reading a to-do-only note: matching open to-dos on the same date are flagged; a different to-do is not.
- [ ] A to-do-only re-read where every row is a duplicate shows the disabled save, and ✕ closes with `dismissed`.
- [ ] A re-read whose first activity form was closed unsaved still flags the unlinked same-date copies.
- [ ] Hint to-dos and unrelated to-dos on other dates are never flagged.
- [ ] Help article updated; `npm run validate` + `npm run test:lambda` green; drift test green; Lambda applied (code hash only).
- [ ] Diagnostic logging in **Observability Coverage** implemented (events fire with the stated surface/context; no new context key).

## Testing Plan

1. Unit: `parseTodoItem` dueTime valid/invalid; `resolveTodoDue` keeps time only with a date; `due_time_dropped` counted by position; `candidatesFor` + `markDuplicateDrafts` (activity scope incl. done, date scope excl. hints/completed, the ≈0.86 re-read pair matches, a distinct pair from the same note such as "Pack sunscreen" vs "Pack a packed lunch" stays below 0.6, each existing matched once, best pair wins); `TimePresetPicker clearable`; a throwing duplicate check leaves rows unflagged and reports a warning; `detectDuplicateActivity` reports and returns null; drawer shows duplicate rows skipped with the right label, Add anyway keeps them, save passes dueTime; planner passes `probableActivityId`.
2. Browser (extend `scripts/design-screenshots/magic-todos-capture.ts`): save the field-trip read, re-read it → duplicates flagged; to-do-only "walk the dog tomorrow at 10am" → time shown and saved. Light/dark, 390/1280.
3. Real model: re-run the field-trip and dog notes through the shipping prompt (as earlier today) to confirm `dueTime` comes back for the dog note and is null for the field-trip to-dos.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted dueTime end to end and narrow-scope fuzzy duplicate flagging (probable activity or same date) reusing `tokenSimilarity` + `findDuplicateActivity`, skip-by-default with Add anyway.
- **Pass 2 (DRY + error handling)**: Merged the duplicate helpers into one `markDuplicateDrafts` (reusing `isHint`); extracted the greedy pairing from statement `match.ts`/`transfers.ts` into `claimBestPairs` used by all three; dropped the `FamilyTodoPage` wiring (the drawer covers it); one reporting `detectDuplicateActivity` wrapper replaces a console-only catch; a failed duplicate check warns and leaves rows unflagged; logged dropped times and Add anyway; `TimePresetPicker` becomes clearable; clearing the date clears the time.
- **Pass 3 (Sustainability)**: Dropped the `claimBestPairs` extraction (statement matchers claim by different keys and change for different reasons) and inlined the 5-line greedy claim; split candidate selection into a two-branch pure `candidatesFor` matching Req 4 (uses `extractDatePart`); kept the drawer watch flat via `flagDuplicates`, which reports a warning instead of a toast plus a new string; kept telemetry-only `timeDropped` off `TodoDraft`; flat skipped-row template via `skipNote`/`undoLabel`; corrected the similarity figure to ≈0.86 and pinned a distinct pair below 0.6.
- **Pass 4 (Fresh-eyes sweep)**: Reused the existing `ai-activity-capture` surface (with `error`); the time clear is a sibling button with its own "Clear time" label; to-do dates compared with `slice(0, 10)`; one candidate predicate so unlinked same-date copies are caught even with a probable activity; a stated time is dropped when the derived date was clamped to today; the model is told never to use the event's time as `dueTime`; shared `TITLE_MATCH_THRESHOLD`; the duplicate note gets its own line; added the `TimePresetPicker` test and the all-duplicate and unlinked-copy acceptance criteria.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (2026-09-29, after testing #113)

I've done some testing now and it's looking very good. i've shared a long soccer team note with 6 actiosn in it and it captured all of them. i also tried a simple todo (remind me to walk the dog tomorrow at 10am) and a todo was created, but without the time. also confirmed that todos are deleted along wiht the activity, and the scroll to new activity + pulse looks great! noticed the below issues:

1. When todos are created and linked to an activity, what happens if the activity is read again, and the same todos are generarted? at the moment it seems that the todo items are duplicated - should we check to confirm if the todo already exists before creating another? perhaps use the same type of fingerprint convention we use to confirm we don't create duplicate transactions (which we just build in the transactions magic beans feature)? what are your thoughts?

2. i can see the link from the todo back to the activity ... should we be able to also see the list of linked todos in an activity, or create a linked to-do from an activity?

3. ... it doesn't seem possible to create a list from an activity ... should we have that also, so the feature is symmetrical? ...

4. when a todo is created, it seems to skip the time. if a time exists, that should be populated also (i.e. remind me to walk the dog tomorrow at 10am)

### Follow-up 1

"#1+#4 now, log #2+#3" (items 2 and 3 go to a new tracker issue).

</details>

## Outcome

> Built 2026-09-29 via `/beanies-build-auto`. App not deployed. The `ai-extract` Lambda was applied (code hash only) for the `dueTime` prompt change (`PROMPT_VERSION` 2026-09-29.2). Real-model check: "walk the dog tomorrow at 10am" returns `dueTime: "10:00"`; the field-trip to-dos return `dueTime: null`.

**Deviations from the plan above (decided during review):**

- **To-do title matching** uses `todoTitleSimilarity`: common filler words (the, a, an, and, to, of, for, on, at, by, with, your, my, our, please) are stripped, then the shared `tokenSimilarity`, at `TODO_MATCH_THRESHOLD = 0.75` (not the shared 0.6). One different word in a short title scores exactly 0.6 ("Pay the soccer fee" vs "Pay the swim fee"), so 0.6 flagged distinct to-dos; without stripping, 0.75 missed "Return form" vs "Return the form". The activity check keeps `TITLE_MATCH_THRESHOLD` 0.6 unchanged.
- **Date scope** matches an existing to-do whose day equals the draft's saved `dueDate` OR its unclamped `matchDate`. Known gap: an UNLINKED copy re-read on a later day (its derived date clamped to a different today) is not caught by date; linked copies are caught through `probableActivityId`.
- **Time rule (unified):** a stated time is kept whenever the to-do has a date, except a worked-out date equal to today whose time has already passed (`timeDropped: 'past_today'`). The clamp-specific rule was dropped (a clamped date with a time still ahead keeps it). `today` and `nowTime` come from one clock read.
- `candidatesFor` was folded into `markDuplicateDrafts` (tests go through the production path); a repeat `duplicate_check_failed` is suppressed per capture with a `debug` breadcrumb, and the reported message names the stage's actual fallback.
- `TimePresetPicker` got `dark:text-accent-lift` on its selected states (a pre-existing gap the drawer exposed).

**Reviews:** `/code-review high` twice (round 2 scoped to the fixes). Round 1: 8 findings, 8 fixed. Round 2: 9 findings, 9 fixed; those last fixes are covered by tests and the gate but were not re-reviewed (two-round ceiling).
