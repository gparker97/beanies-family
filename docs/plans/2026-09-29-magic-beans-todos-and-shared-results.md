# Plan: Magic beans finds to-dos, and returns a shared result (activity + to-dos)

> Date: 2026-09-29
> Related issues: Notion tracker #113. No GitHub issue (directive: SKIP).
> Plan file: `docs/plans/2026-09-29-magic-beans-todos-and-shared-results.md`
> Mockup: `docs/mockups/magic-beans-todos-shared-2026-09-29.html` (approved 2026-09-29, layout A: right-side drawer)

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent forwarding a school note, I want beanies to put the trip on the calendar AND give the right person a dated to-do for the permission slip, so nothing on the note falls through the cracks.

## Context

Magic beans (the AI capture door: paste, photo, file, or OS share) reads a submission and routes it to exactly ONE destination: activity (`event`), travel, recipe, or bank statement (`transactions`). Much of what parents forward is really something to do: "return the signed form by Friday", "pay the $12 trip fee", "pack sunscreen on the day". Today those either vanish or get squeezed into an activity's notes.

This adds:

1. A fifth magic beans kind, **to-do** (✅ tile).
2. A **shared result**: one read can return an activity AND to-dos. It is modelled as a _companion_: the primary kind stays a single scalar (`kind: "event"`), and the event may carry a companion `todo` object. This keeps every existing single-kind guard (Lambda wrong-kind guard, client guard, correction grant, `pendingMagic` slot, `readerForShareKind`) working unchanged, and gives lists a slot later: `SHARE_COMPANIONS` is the allow-list, and a new companion adds a payload field, a parser branch, a `companionsOf` case and a review surface.
3. A **review drawer** (approved mockup, layout A) that shows a read-only activity summary plus editable to-do rows, saves the to-dos, then opens the activity form pre-filled.
4. **To-do → activity links** (`TodoItem.activityId`), a linked-activity chip that deep-links to the activity, and (stretch) an offer to remove linked to-dos when deleting an activity (default keep).

Current-state facts this plan relies on (verified 2026-09-29):

- Share prompt: `src/services/ai/extractionPrompt.ts` (`SHARE_JSON_SHAPE` :773, `buildShareExtractionMessages` :820, `parseShareExtractionResult` :901, `PROMPT_VERSION` :34; parser helpers `asString`, `asYmd`, `toStringList` :1197, `reportRejectedFields` :302; shared-text pattern `CATEGORY_OPTIONS_TEXT` :36-46 with sync test `extractionPromptCategory.test.ts:43-52`). Two hand-kept copies must match byte-for-byte: `scripts/spikes/extractionPrompt.mjs` and `infrastructure/lambda/ai-extract/extractionPrompt.mjs`, enforced by `src/services/ai/__tests__/extractionPromptDrift.test.ts`.
- Lambda does not parse the answer; it checks `requiredKeys` and a scalar wrong-kind guard (`index.mjs:505`), meters once per request (`meter.mjs:165`), and validates correction targets against `SHARE_KINDS` (`correctionGrant.mjs:56`). The sealed arm mirrors the guard client-side (`managedProvider.ts:577-585`).
- Registries: `ShareKind` (`src/types/magicPayload.ts:22`), `SharePayload` (:227), `ShareKindHint` (`src/services/ai/types.ts:47`, a separate hand-kept union today), `ShareExtractionResult` (:161), `MAGIC_READERS` (`src/composables/useMagicReader.ts:70`), `MAGIC_DESTINATIONS` (`src/constants/magicDestinations.ts:42`, header :10-21 is the add-a-kind checklist and has two stale claims), `.magic-tick:nth-child(2..4)` stagger (`src/style.css:1045-1055`).
- Ingest: `classify()` (`useSharedDocumentIngest.ts:2031`), `runIngest()` (:1579), `IngestState.resolved` carries one `kind` (:153); overlay lights one tile (`AiProcessingOverlay.vue` `litKind()` :49, grid hard-coded `grid-cols-2 sm:grid-cols-4` :129); sheet `cols` (`MagicBeansSheet.vue:110`).
- Activity delivery: `FamilyPlannerPage.vue` consumes `photo` reader → `deliverEvent` (`useDocumentToActivity.ts:62`, has its own try/catch :62-75) → `onPhotoActivityReady` (:289, duplicate check → `applyAddNew` :262 / `applyUpdateExisting` :272) → `ActivityModal` with `prefill`. `applyPrefill` (`ActivityModal.vue:238-305`) does not set `link`; `useDocumentToActivity.ts:104-110` appends `env.link.provenanceUrl` to notes. The page's create path gets `created` at :621 (id discarded today). **Eager-create:** with a `sourcePhoto`, `ActivityModal` creates the activity itself (`useEagerEntityCreate`, :849) and later emits `save({id, data})` as an update.
- Deep link: `/activities?activity=<id>` handled by `useDeepLinkParam` in FamilyPlannerPage (:101-105); shared map `src/utils/entityDeepLink.ts:43` (`entityDeepLink('activity', id)`).
- To-dos: `TodoItem` (`models.ts:696-719`) has no link field; `todoStore.createTodo` (:149) goes through `wrapAsync`, which toasts its own failures. Batch-write precedent: `commitStatementAdds` (`transactionRepository.ts:122-160`, one `mutate({op:'batch'})` + projection check); atomic cascade precedent: `deleteRecipeCascade` (`recipeRepository.ts:30-70`) + in-memory `nullifyRecipe` (`mealPlanStore.ts:299`). `listStore.ts:938-945` warns that loop-of-updates unlinking orphans links silently. `toAssigneePayload` (`src/utils/assignees.ts:116`).
- Reusable UI: `BeanieFormModal variant="drawer"` (→ `BaseSidePanel`; `saveLabel`, `saveDisabled`, `isSubmitting` props :17-31), `AssigneePickerButton`, `FamilyChipPicker`, `BeanieDatePicker`, `MemberChip`, `ChipButton`, `InferredHint`, `MagicMiscategorisedBanner` (props `env`, `from`); favicon link list in `TodoViewEditModal.vue:535-570` (unguarded `:href`). Review-modal draft pattern: `TravelExtractReviewModal.vue:111-131`.
- Name matching: `matchTravellerIds(names, humans)` (`src/utils/segmentTravellers.ts:100`: case, first name, aliases, humans only, ambiguity guards), used at `TravelExtractReviewModal.vue:126`.
- Who Owns What: `defaultHolderFor(target)` (`responsibilityStore.ts:161`, `isLoaded` guard; single-holder held cards only via `singleHolderOf`), `CardDefaultTarget` + `cardIdForTarget` (`responsibilityCards.ts:669-689`, targets `mealSlot`/`listTemplate`/`hint` today), reason text `useCardDefaultHint().holdsHint(...)` + `InferredHint` (precedent `MealEditModal.vue:50,236`; `holdsHint` returns '' once the assignee is changed).
- URLs from a model: `safeHttpsUrl` (`src/utils/url.ts:171`); hrefs via `safeExternalHref`.
- Confirm with radio choices: `confirmChoice({ choices, defaultChoice })` (`src/composables/useConfirm.ts:129`; `confirmLabel` is a fixed key :40); precedent `WhoOwnsWhatPage.vue:403-417` (count in the choice label via `fillTemplate`). Delete-composable precedent: `confirmAndDeleteList` (`useListDeletion.ts:36-66`, returns true only on success, `reportSessionActionFailed` otherwise).
- Activity delete: `activityStore.deleteActivity` (:1120; refuses + toasts when `vacationId` is set :1121) → `deleteOne` (:1096) already calls `useListStore().clearLinksFor('activity', id)`. UI confirm duplicated in `FamilyPlannerPage.handleDelete` (:737-752) and `FamilyNookPage.handleActivityDelete` (:176-189), both ignoring the boolean result; plus `ActivityViewEditModal.handleDelete` one-off/"all" path (:767). `resetOccurrenceToSeries` is literally `deleteActivity(childId)`.
- Helpful-hint to-dos reference activities via `hintKey` (`helpfulHints.ts:169,301`) and never carry `activityId`.
- `showToast('error', …, { surface, context, error })` already reports to telemetry (`useToast.ts:22-56`), so it is never paired with a separate `reportError`.
- Telemetry allowlist (`src/utils/diagnosticContext.ts:61-345`) already has `action`, `kind`, `count`, `detail`, `stage`, `error_code`, `activity_id`: no new keys needed.

## Requirements

1. **New kind `todo`** everywhere a kind is registered (checklist in Approach A), tile ✅, strings `ai.capture.dest.todo` ("To-do"), `ai.capture.pick.as.todo`, `ai.capture.noun.todo` ("a to-do").
2. **To-do extraction shape** (per item): `title` (short imperative), `details` (string|null), `dueDate` (YYYY-MM-DD|null, only when the text states or clearly implies a date), `timing` (`"on_event_day" | "before_event" | null`, only meaningful beside an event), `assigneeName` (the person the text names as the one who must do it, as written, or null), `ownerCard` (one id from a closed list of Who Owns What card ids, or null), `links` (https URLs relevant to that to-do). Result: `{ items: TodoItemExtraction[] }`, capped at 10 items; invalid fields reported via `reportRejectedFields`.
3. **Classification rule in the prompt, with worked examples:** a thing a person has to DO (return, sign, pay, bring, pack, buy, book, reply) is a to-do; a thing a person GOES TO or takes part in at a time/place is an event; a document with both is `kind:"event"` with a companion `todo` object. A pure to-do note is `kind:"todo"`. Examples: field-trip note (event + to-dos), "please return the library book by Friday" (todo), birthday invite with "RSVP by" date (event + to-do "RSVP"), plain class schedule (event only).
4. **Companion registry:** `SHARE_COMPANIONS: Partial<Record<ShareKind, readonly ShareKind[]>> = { event: ['todo'] }` in `magicDestinations.ts`. It drives the parser (a companion is accepted only when allowed for that primary kind), the payload type, and the overlay (which tiles light). Each of the three prompt copies holds the literal data `PROMPT_SHARE_COMPANIONS = { event: ['todo'] }` and builds both the companion line and the hint clause from it; one client test asserts `toEqual(SHARE_COMPANIONS)`. A stated pick (`kindHint`) fixes the primary kind but still allows that kind's companions (picking Activity never drops the to-dos); picking To-do returns to-dos only.
5. **Event link:** add an optional `link` key to the event extraction (`EXTRACTION_JSON_SHAPE`, NOT in `REQUIRED_KEYS` :205, since the Lambda 502s on a missing required key and the same shape drives the standalone event task): the single most useful web address for the event, or null (validated with `safeHttpsUrl`). The link/notes rule is worked out once in `deliverEventInner`: `prefill.link = extraction.link ?? env.link?.provenanceUrl`; the provenance URL is appended to notes only when it is not already the link (update the now-false comment at `useDocumentToActivity.ts:102`). `ActivityModal.applyPrefill` copies `link` and sets `showMoreDetails = true` (the field sits in the collapsed section, :1420/:1445). The "update existing" path gets it via `mergeExtractionIntoActivity` (fills blanks; `link` is not in `MERGE_SKIP_KEYS`).
6. **Shared result flow:** routes to `/activities` as today (reader `photo`, payload `kind:'event'` now carrying optional `todo`). When the companion has ≥1 item, `FamilyPlannerPage` first opens the **magic to-do review drawer** with a read-only activity summary and the editable to-do rows. Confirm → to-dos saved → the existing path continues (duplicate check → `ActivityModal` pre-filled). Close (✕) → nothing saved, nothing opened.
7. **To-do-only flow:** new reader `todo` → route `/todo` → `FamilyTodoPage` opens the same drawer with just the to-do rows; confirm saves them.
8. **Review drawer (layout A):** `BeanieFormModal variant="drawer"` (default size, ≈448px; full-screen on phone), using its own `saveLabel`/`saveDisabled`/`isSubmitting` props (no custom footer). Header "Here's what we found" (✨). Subtitle naming the source. Activity section (shared only): read-only summary card (title, date and time, location, link, "Next" tag, helper line "You'll check who's going and the rest in the activity form next."). To-dos section header, "Linked to the activity" + rail (shared only). Each row: inline-editable title; assignee via `AssigneePickerButton` (one pre-selected) with the reason shown via `InferredHint` while unchanged; due date via `BeanieDatePicker` with a derived-date suffix ("trip day", "day before"); `LinkList` if the to-do has links; Skip / "Undo skip". Footer `MagicMiscategorisedBanner` (`from` = primary kind). Save label states its effect: "Save 3 to-dos, then add the activity" (shared), "Save 3 to-dos" (to-do only), "Add the activity" (shared, all skipped); disabled when to-do-only and all skipped. Shared: orange `saveGradient` + ✨ icon; to-do-only: `saveGradient="purple"` + ✅ icon (mockup screen 3).
9. **Assignee resolution** (pure helper, first match wins): (a) `assigneeName` → `matchTravellerIds([name], familyStore.sortedHumans)[0]` → reason "named in the note"; (b) `ownerCard` in the closed list → `responsibilityStore.defaultHolderFor({ kind: 'card', cardId })` (new `CardDefaultTarget` arm) → reason via `holdsHint` ("owns School Forms"); (c) submitter = `familyStore.currentMember ?? owner` (the `useAuthoringMember` rule) → reason "you shared it"; none → unassigned. Split-per-child and unheld cards fall through to (c).
10. **Due date resolution** (pure helper): a valid stated `dueDate` wins; else `timing:"on_event_day"` → the event's date; `timing:"before_event"` or a companion to-do with no date → event date − 1 day (`addDaysYmd`; greg's decision); derived dates are clamped to ≥ `localToday()` so nothing arrives overdue; derived dates apply only when `eventDate` is a real YYYY-MM-DD (`isRealYmd`), otherwise the to-do stays undated; a to-do-only item with no date stays undated.
11. **Links on to-dos:** saved into `description` (details, then each link on its own line, deduped), where `TodoViewEditModal` already surfaces URLs.
12. **To-do → activity link:** new optional `TodoItem.activityId` (a soft reference). To-dos saved from a shared result are linked when the activity is saved, via a page-local `commitTodoLink(activityId)` called in exactly two places: the create branch with `created?.id` before `clearActivityModalState()` (`FamilyPlannerPage.vue:630`), and after a successful update/scoped save with `data.id` before the clear at :661. This covers create, eager-create and "update existing". `commitTodoLink` copies the pending ids before `clearActivityModalState()` and writes the link after the form has closed, so a slow or failed link write never holds the form open. Closing the activity form unsaved keeps the to-dos, unlinked (`link_skipped` logged in `closeActivityModal` :417). **Per-capture reset:** `onPhotoActivityReady` owns the pending link: on entry, if ids are pending (a second capture from the form's own magic beans card, `ActivityModal.vue:1027`), log `link_skipped` and drop them; if the new result has to-dos, first `closeActivityModal()` + `await nextTick()`, then open the drawer. This stops capture A's to-dos linking to capture B's activity and stops a drawer opening over the form.
13. **Linked-activity chip:** `TodoItemRow` metadata row and a "Linked activity" row in `TodoViewEditModal` show 📅 + activity title + date; tapping navigates to `entityDeepLink('activity', id)`. Rendered only when the activity resolves in `activityStore` (never a dangling chip).
14. **Soft reference, no write-time unlink:** nothing unlinks `activityId` when an activity is deleted (other delete paths such as `vacationStore.ts:298` and deletes synced from another device would skip it anyway). Every reader (chip, `openTodosForActivity`) resolves the id against `activityStore` and ignores misses. `activityStore`, `activityRepository` and `deleteOne` are unchanged by the link.
15. **Stretch: delete an activity with linked open to-dos:** `confirmChoice` with "Keep the to-dos" (default) / "Delete the 2 to-dos too" (count in the label via `fillTemplate`). Completed to-dos are always kept. `useActivityDelete().confirmAndDeleteActivity(activity)` (mirrors `confirmAndDeleteList`) deletes the activity first (`deleteActivity(id)`, unchanged signature); only on success does it call `todoStore.deleteTodos(ids)` (one batch of `delete` ops, where a missing id is already a no-op, `docOps.ts:613-615`; one `wrapAsync`). If that second write fails the to-dos survive (no data loss) with one toast. Deleting a to-do never touches its activity. The composable replaces the duplicated planner/Nook handlers.
16. **Overlay:** `IngestState.resolved` gains `companions: { kind: ShareKind; count: number }[]`, derived by ONE pure `companionsOf(payload)` in `magicDestinations.ts` and read by `runIngest` (state), the `classified` log and the overlay; every matched tile lights; status line "Found an activity and 3 to-dos" (`.one`/`.other` keys).
    16a. **Delete failures reported once, at the source:** `activityStore.deleteActivity` reports every `false` it returns (adds `reportSessionActionFailed()` where `deleteOne` returns false without throwing; the vacation refusal already toasts). Callers never report on `false`; remove the caller-side `reportSessionActionFailed()` at `ActivityViewEditModal.vue:773` and `:799` (`handleReset` → `resetOccurrenceToSeries` is `deleteActivity`). The store reports only inside the `wrapAsync` callback when `deleteOne` returns false (a throw is already toasted by `wrapAsync`; `result ?? false` must not report again). This also fixes the planner/Nook handlers that ignore the result today.
17. **Grid + stagger:** overlay and sheet share `magicTileCols(n)` (5 tiles → 3 + 2 on phone); tick stagger becomes `animation-delay: calc(var(--tick-i) * 0.16s)` so new kinds need no CSS.
18. **Lambda:** `SHARE_KINDS` gains `todo`; legacy-arm prompt copy updated; deployed via terraform (Lambda code hash only). A test asserts Lambda `SHARE_KINDS` equals `MAGIC_DESTINATION_KINDS`.
19. **Help Center:** update `share-to-beanies` and `family-todo-lists`.

## Important Notes & Caveats

- **Do not make `kind` an array.** The scalar primary kind keeps the Lambda guard, client guard, correction grant, `pendingMagic` and `readerForShareKind` unchanged. Multi-kind is expressed only through companions.
- **Three prompt copies stay byte-identical** (drift test). Bump `PROMPT_VERSION` in all three. `PROMPT_SHARE_COMPANIONS` (data) and `TODO_OWNER_CARDS` are hard-coded in each; client tests pin them to `SHARE_COMPANIONS` (`toEqual`) and `RESPONSIBILITY_CARDS`. Also rewrite "Include ONLY the nested object matching your chosen kind" and the `kind` description.
- **No family names go to the model.** Matching is client-side from `assigneeName`; the prompt receives only constant card ids.
- **Eager-create:** the activity exists before Save; the id comes from the update-shaped save. Closing after an eager create leaves the activity (existing behaviour) and the to-dos unlinked; accepted.
- **Writes are atomic and idempotent:** each draft gets its to-do id (`generateUUID()`) when drafts are built (the id is also the draft's `key`); `createTodos` writes one batch of `set` ops with those ids, stamped like `createWithId` (`automergeRepository.ts:76-91`). A retry rewrites the same ids, so it can never duplicate (no `ImportNotVisibleError`-style projection check, which forbids retry). The drawer stays open with the drafts on failure. Linking is one batch of `patch` ops with `onMissing:'skip'` (a to-do deleted on another device cannot fail the link); the stretch to-do delete is one batch of `delete` ops. No loops of single updates. The batch helpers `createManyWithIds`, `patchMany`, `removeMany` go on `createAutomergeRepository` itself (DRY), not only the to-do repository.
- **Legacy Lambda arm:** it serves builds from before the sealed arm (2026-09-16), which know the share task but not `todo`. Guard: in the legacy arm, `if (task === 'share' && result.kind === 'todo')` → 502 `model_shape`, before the read is closed and counted (not charged). Every legacy-arm client predates `todo`. **Apply the Lambda before the app deploy.**
- **No double reporting:** store writes run in one `wrapAsync` (it toasts + reports); never add a second toast or `reportError` on top. Store batch actions report under `surface:'todos'` (generic), not the drawer's surface.
- **Draft building runs inside a `useMagicReaderConsumer` watch callback** with no catch up the chain: wrap it in try/catch with an error toast. In the shared flow a draft-build failure falls through to the normal activity path, so a to-do bug never costs the user the activity; in the to-do-only flow the drawer closes.
- **Never two dialogs at once:** on `saved(ids)` set `todoReview = null`, `await nextTick()`, then continue to the duplicate `confirm`/`ActivityModal` (WebKit stall precedent, `FamilyPlannerPage.vue:620-628`, `docs/E2E_HEALTH.md`).
- **`card` target arm:** `CardViewDrawer.vue:237` treats any non-meal/non-list target as a hint; type `cardUsesFor` as `Exclude<CardDefaultTarget, { kind: 'card' }>[]` and make the drawer branch explicit (`target.kind === 'hint'`).
- **Hint to-dos** are keyed by `hintKey`, not `activityId`; the chip and the stretch delete ignore them.
- **Recurring activities:** the chip opens the series (no occurrence param exists); acceptable.
- **Correction on a shared result:** banner `from = 'event'`; re-reading as `todo` yields a to-do-only result; travel/recipe drops the to-dos (the new read is authoritative).
- **Meter:** one request = one read (verified `meter.mjs:165`); no meter change.
- `ShareKindHint` becomes `= ShareKind` (type-only import), removing a hand-kept union.
- Fix the stale claims in the `magicDestinations.ts` header and document companions there.
- Copy: American English, no em-dashes, `en` Title/Sentence case + lowercase `beanie`. Save-failure copy keeps real nouns ("to-dos", not "beans").

## Assumptions

1. The model reliably emits a companion object when instructed with examples; the parser tests plus a manual read of the field-trip example confirm.
2. `BeanieFormModal variant="drawer"` default size renders at ~448px (`max-w-lg`) as in the mockup.
3. `AssigneePickerButton` and `BeanieDatePicker` work inside a drawer row (they already do inside `QuickAddBar`/`TodoViewEditModal`).
4. `/todo` renders `FamilyTodoPage` for all members who can use magic beans (permission `activities`).
5. The Lambda change is code-only; `scripts/infra/tf-plan.sh -target=module.ai_extract` shows exactly one in-place update (code hash).
6. The automerge repository `mutate({op:'batch'})` supports batched `set`, `patch` (`onMissing:'skip'`) and `delete` ops within one collection (as `commitStatementAdds` does for transactions; `delete` has no `onMissing`, `protocol.ts:147`).

## Approach

The approved mockup (`docs/mockups/magic-beans-todos-shared-2026-09-29.html`, layout A) is the design reference; every token comes from the theme skill + CIG.

### A. Kind + companion plumbing

- `src/types/magicPayload.ts`: `ShareKind` += `'todo'`; `SharePayload` event arm gains `todo?: TodoExtractionResult`; new arm `{ kind: 'todo'; data: TodoExtractionResult; env }`.
- `src/services/ai/types.ts`: `ShareKindHint = ShareKind` (type-only import); `TodoItemExtraction`, `TodoExtractionResult`; `ShareExtractionResult` event arm gains `todo?`, new `{ kind:'todo'; todo }` arm; `ExtractionResult.link?: string | null`.
- `src/constants/magicDestinations.ts`: `todo: { emoji: '✅' }`; `SHARE_COMPANIONS`; `companionsOf(payload)`; `magicTileCols(n)` (moved from `MagicBeansSheet.vue:110`); header checklist corrected (adds the three prompt copies, Lambda `SHARE_KINDS`, and the four steps for a new companion: payload field, parser branch, `companionsOf` case, review surface; drops the `nth-child` item, the `ShareKindHint` item and the "fourth kind" wording).
- `src/composables/useMagicReader.ts`: reader `todo` → `{ route: '/todo', shareKind: 'todo', permission: 'activities' }`; `MagicReader` + `ReaderShareKind` unions.
- `src/style.css` + `AiProcessingOverlay.vue`: `--tick-i` stagger replaces the `nth-child` rules.
- `src/constants/responsibilityCards.ts`: `CardDefaultTarget` += `{ kind: 'card'; cardId: string }`; `cardIdForTarget` becomes a `switch` with `assertNever`; `cardUsesFor` typed `Exclude<CardDefaultTarget, { kind: 'card' }>[]`; `CardViewDrawer.vue:237` branch made explicit.
- `src/services/translation/uiStrings.ts`: `ai.capture.dest/pick.as/noun.todo`; `ai.found.eventWithTodos.one/.other`; drawer keys (`magicTodos.*`: title, subtitles, section labels, helper line, skip/undo, save labels `.one/.other`, reasons `named`/`submitter`, derived-date suffixes, load/save error); `todo.linkedActivity`; delete keys (`planner.deleteLinkedTodos.*`).

### B. Prompt + parser (three copies)

- `SHARE_JSON_SHAPE`: `kind` adds `"todo"` and says companions may accompany it; new `todo` key ("present when kind="todo", OR beside kind="event" when the document also asks someone to do something for it"). Classify rules get the DO-vs-GO rule + the four worked examples. Replace the "Include ONLY the nested object…" line with one built from `PROMPT_SHARE_COMPANIONS` (the allowed companions per kind).
- `TODO_JSON_SHAPE` + `TODO_OWNER_CARDS` (closed list: `school-forms, school-vacations, helping-at-school, homework-and-school-supplies, talking-to-teachers, kids-bags-for-the-day, lunchboxes, sports-and-clubs, tutors-and-lessons, doctor-and-dentist, health-insurance-and-claims, paying-the-bills, mail-and-paperwork, packages-and-returns, birthday-parties, gifts-for-others, cards-and-thank-yous, passports-and-documents, car-care, pet-care`; all verified to exist).
- Hint branch: when the hinted kind has companions, keep "Do NOT re-decide the category" and add "you may still include the <companion> object when the document also contains it".
- `EXTRACTION_JSON_SHAPE` (event): add `link`.
- `parseTodoExtractionResult`: `asString(v, MODEL_FIELD_MAX)` for title/details (empty title → item dropped), `asYmd(v, 'todo.dueDate', rejected)`, `timing` enum, `ownerCard ∈ TODO_OWNER_CARDS` else null, `links` via `toStringList` + `safeHttpsUrl`, bounded collect-until-full loop (cap 10); rejected fields reported via `reportRejectedFields` with `todo.`-prefixed names. Zero valid items → `none` for kind `todo`; a zero-item companion is dropped.
- `parseShareExtractionResult`: new `todo` case; for `event`, a present `todo` object is parsed as a companion only if `SHARE_COMPANIONS.event` allows it. `parseExtractionResult` accepts `link` via `safeHttpsUrl`.
- `PROMPT_VERSION` bump in all three copies.
- Lambda: `correctionGrant.mjs` `SHARE_KINDS` += `'todo'`; `extractionPrompt.mjs` copy; handler + correctionGrant tests; new sync test (`SHARE_KINDS` ≡ `MAGIC_DESTINATION_KINDS`, importing the `.mjs` like the drift test).

### C. Ingest + overlay

- `classify()`: `todo` → `{ kind: 'todo', model: true, payload }`; the `event` payload carries `todo` when present.
- `IngestState.resolved.companions` from `companionsOf(payload)`; `runIngest` sets it; the `classified` log gains `count` = number of companion items (0 = single); its existing `detail` (`'corrected'|'hinted'|'surface_hinted'|'unhinted'`, `useSharedDocumentIngest.ts:1661-1670`, used by the #108 analysis) is unchanged.
- `AiProcessingOverlay.vue`: `isLit(kind)` = primary or in `companions`; shared found-line with the count; `magicTileCols`; `--tick-i`.
- `MagicBeansSheet.vue`: `magicTileCols`.

### D. Pure helpers (unit-tested)

- `src/utils/magicTodoDrafts.ts`: `buildTodoDrafts(result, { eventDate?, roster, holderFor, submitterId, today })` → `TodoDraft[]` (`{ key, title, description, dueDate?, dueDerived?: 'event_day'|'day_before', assigneeIds, reason: 'named'|'owner'|'submitter'|null, ownerCardId?, links, skipped: false }`), built from exported `resolveTodoAssignee` (uses `matchTravellerIds`) and `resolveTodoDue` (uses `addDaysYmd`, clamps derived dates to `today`). `holderFor(cardId)` is injected (`(id) => responsibilityStore.defaultHolderFor({ kind:'card', cardId:id })?.memberId`), so the util stays store-free.

### E. Orchestration (MVO: repositories + stores)

- `createAutomergeRepository` gains `createManyWithIds(items)`, `patchMany(ids, patch, { onMissing:'skip' })`, `removeMany(ids)` (one `mutate({op:'batch'})` each). The to-do repository uses them for create (ids from the drafts), link and delete.
- `todoStore.createTodos(inputs)`, `todoStore.linkTodosToActivity(ids, activityId)`, `todoStore.deleteTodos(ids)`: each inside one `wrapAsync` with `surface:'todos'` and a distinct `action` (`todoStore:createTodos` etc.), `trackFeature` once; inputs built with `toAssigneePayload`; `createdBy` from `useAuthoringMember().resolveOrToast` (abort the save if null). `todoStore.openTodosForActivity(id)` (function; open to-dos whose `activityId === id`).
- `activityStore.deleteActivity`: reports every `false` it returns (see Req 16a); no link logic.

### F. UI

- `src/components/ui/LinkList.vue` (new): favicon link rows extracted from `TodoViewEditModal.vue:535-570`, hrefs via `safeExternalHref`; used by `TodoViewEditModal` and the drawer.
- `src/components/ai/MagicTodoReviewDrawer.vue` (new, layout A): props `open`, `ready: TodoReviewReady | null` (`{ result, eventSummary?, env, primaryKind }`); builds drafts in a `watch`, like `TravelExtractReviewModal.vue:111-131` (try/catch → error toast `stage:'build_drafts'`, then emits `buildFailed` so the planner falls through to the activity path; the to-do page just closes); on save calls `todoStore.createTodos` and emits `saved(ids)`; on failure stays open with drafts; emits `close`. Row markup inline (split into `MagicTodoReviewRow.vue` only if the file passes ~300 lines).
- `FamilyPlannerPage.vue`: `todoReview = ref<TodoReviewReady|null>()`; in `onPhotoActivityReady`, if `ready.todo?.items.length` open the drawer first and park the `ready`; on `saved(ids)` keep `pendingTodoLinkIds`, set `todoReview = null`, `await nextTick()`, then continue the existing duplicate check → modal with the parked `ready`; on `buildFailed` continue the same way with no ids; on drawer `close` drop everything. `commitTodoLink(activityId)` per Req 12. `clearActivityModalState` only clears `pendingTodoLinkIds`; `closeActivityModal` logs `link_skipped` when ids were pending.
- `useDocumentToActivity.ts`: pass `todo` through `onActivityReady`; link/notes rule (Req 5). `extractionToActivity.ts` maps `link`. `ActivityModal.vue` `applyPrefill` sets `link`.
- `FamilyTodoPage.vue`: `useMagicReaderConsumer('todo', …)` → drawer (to-do only).
- `src/components/todo/LinkedActivityChip.vue` (new): used by `TodoItemRow.vue` (metadata row) and `TodoViewEditModal.vue` ("Linked activity" row).
- Delete (stretch): `src/composables/useActivityDelete.ts` `confirmAndDeleteActivity(activity)`: counts `openTodosForActivity`; >0 → `confirmChoice` (keep default / delete too), else the existing danger `confirm`; `deleteActivity(id)`; on success and "delete too" → `todoStore.deleteTodos(ids)`; returns true only when the activity was deleted; never reports on `false` (the store does). Used by `FamilyPlannerPage.handleDelete`, `FamilyNookPage.handleActivityDelete`, `ActivityViewEditModal` one-off/"all" delete.

### G. Docs

- Help articles; ADR-030 note (to-do extraction shipped; companions); `docs/STATUS.md`, `CHANGELOG.md`; `web/` check (grep pricing/privacy pages for an enumerated list of what magic beans reads; update if present, noting it needs a web deploy).

## Files Affected

- `docs/mockups/magic-beans-todos-shared-2026-09-29.html` (approved, committed `cbc373c6`)
- Types/registries: `src/types/magicPayload.ts`, `src/services/ai/types.ts`, `src/types/models.ts` (`TodoItem.activityId`), `src/constants/magicDestinations.ts`, `src/constants/responsibilityCards.ts`, `src/composables/useMagicReader.ts`, `src/style.css`
- Prompt: `src/services/ai/extractionPrompt.ts`, `scripts/spikes/extractionPrompt.mjs`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs`, `infrastructure/lambda/ai-extract/correctionGrant.mjs`, `infrastructure/lambda/ai-extract/index.mjs` (legacy-arm `todo` guard)
- Data layer: `src/services/automerge/automergeRepository.ts` (`createManyWithIds`, `patchMany`, `removeMany`)
- Ingest/UI: `src/composables/useSharedDocumentIngest.ts`, `src/components/ai/AiProcessingOverlay.vue`, `src/components/ai/MagicBeansSheet.vue`, `src/components/ai/MagicTodoReviewDrawer.vue` (new), `src/utils/magicTodoDrafts.ts` (new), `src/components/ui/LinkList.vue` (new)
- Activity: `src/composables/useDocumentToActivity.ts`, `src/utils/extractionToActivity.ts`, `src/components/planner/ActivityModal.vue`, `src/pages/FamilyPlannerPage.vue`, `src/pages/FamilyNookPage.vue`, `ActivityViewEditModal.vue`, `src/stores/activityStore.ts` (report every `false`), `src/composables/useActivityDelete.ts` (new), `CardViewDrawer.vue` (explicit hint branch)
- To-dos: `src/stores/todoStore.ts`, `src/services/automerge/repositories/todoRepository.ts` (if it needs wrappers), `src/pages/FamilyTodoPage.vue`, `src/components/todo/TodoItemRow.vue`, `src/components/todo/TodoViewEditModal.vue`, `src/components/todo/LinkedActivityChip.vue` (new)
- Strings: `src/services/translation/uiStrings.ts`
- Help: `src/content/help/features.ts`
- Docs: `docs/adr/030-private-ai-tiered-architecture.md`, `docs/STATUS.md`, `CHANGELOG.md`, `docs/plans/2026-09-29-magic-beans-todos-and-shared-results.md`
- Tests: `src/services/ai/__tests__/{extractionPromptDrift,extractionPromptCategory (or sibling sync test),shareExtraction,documentExtractionService}.test.ts`, `src/services/ai/providers/__tests__/managedProvider.test.ts`, `src/composables/__tests__/{useSharedDocumentIngest,useMagicReader,magicReaderShareKind,useDocumentToActivity}.test.ts`, `src/constants/__tests__/magicDestinations.test.ts`, `src/components/ai/__tests__/{AiProcessingOverlay,MagicBeansSheet,MagicMiscategorisedBanner}.test.ts`, new `src/utils/__tests__/magicTodoDrafts.test.ts`, new `MagicTodoReviewDrawer.test.ts`, todo/activity store + repository tests, `useActivityDelete` test, `infrastructure/lambda/ai-extract/__tests__/{handler,correctionGrant}.test.mjs`, `uiStrings.test.ts`

## Help Center Coverage

- **Action**: update existing. **Category**: features. **Slug**: `share-to-beanies` (`src/content/help/features.ts:1772`). **Title**: Share Something Straight to beanies. **Scope**: magic beans can now find to-dos, and one note can become an activity plus to-dos; how the review works (who gets each to-do and why, dates, skip), and that to-dos stay linked to the activity. Update the tile-row section (:1961) to include To-do. **Notes**: to-dos are saved before the activity form opens, so closing the form keeps them; picking To-do up front returns only to-dos.
- **Action**: update existing. **Category**: features. **Slug**: `family-todo-lists` (:645). **Scope**: a to-do can be linked to an activity; tap the chip to open it; deleting the activity asks whether to keep the linked to-dos (default keep; completed ones always kept).

## Observability Coverage

- **`magic-beans-capture` / `share-target-ingest`** (existing surfaces): `classified` event gains `count` (companion items; 0 = single); `kind` stays the primary; the existing `detail` is unchanged. Parser field rejections flow through the existing `reportRejectedFields` path with `todo.`-prefixed field names (logged under the existing `recipe-extract` surface, `extractionPrompt.ts:302-310`; the prefix tells them apart). Legacy-arm guard rejections log as `model_shape` in the Lambda's existing logs. Existing `malformed_output`/`failed` paths unchanged.
- **New surface `magic-todo-review`**: `info` `action:'opened'` (`kind`, `count`, `stage:'shared'|'todo_only'`); `info` `action:'confirmed'` (`count` saved, `stage`); `info` `action:'dismissed'` (`stage`); `info` `action:'assignee_resolved'` once per reason per review (`detail:'named'|'owner'|'submitter'|'none'`, `count`); `info` `action:'linked'` (`count`, `activity_id`); `info` `action:'link_skipped'` (`count`) when the activity form closes unsaved; `error` via the draft-build catch toast (`stage:'build_drafts'`).
- **Failures:** `createTodos`/`linkTodosToActivity`/`deleteTodos` failures report once through `wrapAsync` (toast + telemetry, `surface:'todos'`, `action:'todoStore:<name>'`); no second report. `deleteActivity` reports its own `false` once (`reportSessionActionFailed`). A draft-build failure reports `stage:'build_drafts'` and falls through to the activity form. Batch create is all-or-nothing, so the user keeps the drafts and retries; nothing is lost, so no `critical`.
- **Delete (stretch):** surface `activity-delete`: `info` `action:'linked_todos_prompt'` (`count`), `action:'linked_todos_deleted'|'linked_todos_kept'` (`count`, `activity_id`); failures via `reportSessionActionFailed` (existing helper) except the vacation refusal (already toasted).
- **Success-path signal:** `opened`/`confirmed`/`dismissed` give the confirm rate; `assignee_resolved` gives the rule mix; `classified.count > 0` gives the shared-result rate.
- **Critical vs telemetry:** none are `critical` (every failure leaves the user's input recoverable).
- **Privacy/store gate:** no new context keys (`action`, `kind`, `count`, `detail`, `stage`, `activity_id` are allowlisted). No declaration change.

## Acceptance Criteria

- [ ] Field-trip note → overlay lights Activity AND To-do with "Found an activity and 3 to-dos"; drawer shows the activity summary + 3 to-dos: slip due the stated date assigned to the School Forms holder ("owns School Forms"), fee due the day before, sunscreen/bag due the trip day; confirm saves 3 to-dos in one write, then the activity form opens pre-filled with the link in the link field.
- [ ] Saving the activity (create, eager-create, or "update existing") links the 3 to-dos; each shows the linked-activity chip; tapping it opens that activity.
- [ ] Closing the activity form unsaved keeps the to-dos (unlinked, no chip).
- [ ] Pure event → activity form only (no drawer). Pure "return the library book by Friday" → `/todo` + drawer with 1 to-do.
- [ ] Picking the Activity tile on the field-trip note still returns the to-dos; picking To-do returns only to-dos.
- [ ] A shared read increments the meter once.
- [ ] Links: activity link field filled; to-do links appear in the to-do's links list (safe hrefs).
- [ ] Assignee order holds: named member > single-holder card owner > submitter; split/unheld cards fall back to the submitter; no derived due date is in the past.
- [ ] A failed to-do save leaves the drawer open with the drafts and shows one error toast.
- [ ] (Stretch) Deleting an activity with 2 open linked to-dos shows Keep (default) / Delete the 2 to-dos too; Keep leaves them (chip disappears); Delete removes them in one batch after the activity delete succeeds; completed linked to-dos are kept either way.
- [ ] Deleting an activity (from any path, including another device) never leaves a visible chip; delete failures are reported exactly once (no silent ignore, no double toast).
- [ ] A draft-build failure on a shared result still opens the activity form.
- [ ] Light + dark, phone (390) + desktop; drawer matches mockup layout A with CIG tokens.
- [ ] Help Center articles `share-to-beanies` and `family-todo-lists` updated and matching shipped behaviour.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with the stated `surface`/`context`; failure modes are triageable from CloudWatch without a local repro; no new context key).
- [ ] `npm run validate` and `npm run test:lambda` green; drift + companion + `SHARE_KINDS` sync tests green; Lambda applied via `scripts/infra/tf-apply.sh` with only the expected code-hash change.

## Testing Plan

1. Unit: parser (todo kind, companion on event, companion refused on travel, zero-item companion dropped, bad date/card/link rejected via `reportRejectedFields`, 10-item cap); drift test extended to `kindHint: 'event'` (companion clause) and `'todo'` (today only `'recipe'`, `extractionPromptDrift.test.ts:96,116`); companion-data, card-list and `SHARE_KINDS` sync tests; Lambda legacy-arm `todo` guard (502, not metered); `magicTodoDrafts` (assignee order incl. ambiguous names, split/unheld cards, no submitter; due resolution incl. day-before, clamp to today, to-do-only undated; link merge + dedupe); `classify`/`runIngest` (`companions`); overlay lights two tiles; 5-tile grid; repository `createManyWithIds` (retry with the same ids does not duplicate), `patchMany` (`onMissing:'skip'`), `removeMany`; planner per-capture reset (second capture drops pending ids; drawer never over the form); `applyPrefill` sets `link` + opens more details; `openTodosForActivity` ignores completed + missing activities; `companionsOf`; `useActivityDelete` (choice flow, delete-to-dos only after a successful activity delete, no caller-side report); `activityStore.deleteActivity` reports `false` once; `cardIdForTarget` card arm + `cardUsesFor` excludes it; planner `commitTodoLink` on create/update and `link_skipped` only on unsaved close; Lambda `SHARE_KINDS` + handler share fixtures.
2. Browser (Playwright throwaway under `scripts/design-screenshots/`, AI provider stubbed at the service boundary): field-trip paste → overlay → drawer → confirm → activity form → save → chips → tap chip; to-do-only flow; close-form-unsaved; delete with linked to-dos (keep + delete). Light/dark × 390/1280 screenshots, inspected.
3. Real model (manual): paste the field-trip email and the library-book note; check classification and dates.
4. Infra: `scripts/infra/tf-plan.sh -target=module.ai_extract` → exactly one in-place Lambda update → `tf-apply.sh`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted companion-based shared result (scalar primary kind + `SHARE_COMPANIONS`), to-do kind, review drawer (layout A), assignee/due helpers, `TodoItem.activityId` + chip + delete cascade (stretch), Lambda + help + observability.
- **Pass 2 (DRY + error handling)**: Reused `matchTravellerIds`, `defaultHolderFor`/`holdsHint`/`InferredHint`, `safeHttpsUrl`/`toStringList`/`asYmd`/`reportRejectedFields`, BeanieFormModal save states; replaced per-item to-do writes (double toasts) and loop unlinking with atomic batch writes (`commitStatementAdds`/`deleteRecipeCascade` pattern); dropped `useMagicTodoReview`, the dynamic confirm label and the `nth-child` stagger; added prompt/companion/`SHARE_KINDS` sync tests, a guarded draft build, `LinkList` extraction, derived-date clamp; fixed the ignored delete result in planner/Nook.
- **Pass 3 (Sustainability)**: Fixed where the link commits in `handleSave` (create clears state at :630, early returns at :585/:617) and moved `link_skipped` to `closeActivityModal`; draft-build failure falls back to the activity form; drawer fully closes before the next dialog; dropped the activity→to-do cascade from `deleteOne` (soft `activityId` guarded at read; stretch deletes the activity, then the chosen to-dos in one batch); `deleteActivity` reports every `false` itself so callers need no vacation special case; `alsoKinds` → `companions {kind,count}` from one `companionsOf`; corrected the companion-extensibility claim and checklist; excluded the `card` arm from `cardUsesFor`; store batch actions report under a generic `todos` surface.
- **Pass 4 (Fresh-eyes sweep)**: Per-capture reset of pending link ids + drawer (no cross-capture linking, no drawer over the form); `classified` gains `count` instead of clobbering `detail`; to-do ids minted at draft time so a retried save cannot duplicate (batch helpers on `createAutomergeRepository`); fixed the `onMissing`-on-delete type error, the `handleReset` double toast, the hidden prefilled link and the stale `alsoKinds`; companion allow-list as data pinned by a test; `link` stays optional; legacy Lambda arm guards `todo` (502, not charged) and the Lambda applies before the app deploy; mockup gradients for to-do-only; derived dates need a real event date; `createdBy` via `useAuthoringMember`.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-new-issue, 2026-09-29)

Let's create a new item to add a magic bean category - todos (plus shared). Priority: high. Include mockup.

The basic idea is that we should add a category of magic beans to detect todo items - simple things that are clearly a requirement for somebody to take action, which optionally have an assignee (the person who sent it, usually) and a due date, with all the relevant details. Include links as well, if any, in both the activity (which has a specific links section) and the todo, which will display a link if it exists anywhere in the description i believe.

In addition I'd like to introduce the concept of a magic beans shared result. A magic beans submission could return matching more than one item, and we could start with activity + todo (something like travel plan + list could be another possible combo in the future). This might happen for an item that is clearly an activity (for example, a school field trip) but also has a todo element (i.e. sign permission slip by date XX and prepare sunscreen and a small bag on the field trip day). Something like this would fall into 2 categories, and return both an acivity and 1 or more todo items.

The main issue is that it could be hard to differentiate between an activity and a to-do item, so we need to be careful and deliberate about this. In my view, if an item is a small, clearly actionable thing, something that a person needs to do, it is a todo. If it's something that a person does, it's an activity. If the submission includes elements of both, it would be shared.

When a submission returns shared by the LLM, we should also indicate that in the UI by highlighting all the relevant boxes (i.e. both activity and to-do).

This would bring up a review box, similar to what we have already for travel plans and transactions. In the case of activity + todo, it would be a simple box with a summary of what was found. I would suggest that the todo item could be edited in this box as required (we could even simply display the shared todo composable here with the assignee and due date fields completed), and once the user has confirmed, open the activity sidebar with the information filled out.

For example, a forwarded note about a field trip at school is an activity, while a forwarded note about having to return a signed field trip form by 12 October is a to-do, that should be automatically dated and assigned to the family member responsible for school activities, as per the who owns what section.

A future addition to magic beans would probably be lists, and it could also work in combo with other items. Keep this in mind while the feature is being built.

Let me know your thoughts on the above and let me know if any questions

### Follow-up 1

priority is high, include mockup

### Follow-up 2 (intake answers)

Assignee: card owner, else submitter. To-do-only: same review box. GitHub: do not create. Gate: no feature gate.

### Follow-up 3

yes create it

### Follow-up 4

regarding your questions - yes, let's link saved to-dos back to the activity so the user could perhaps click a deep link in the app or something which opens up the linked activity. i'm ok for todos to remain even if you cancel the activity, but if we can easily detect a linked activity/to-do, we could give an option when deleting an activity with a link (i.e. remove 2 linked to-do items as well?). this could be a stretch goal and would only apply when deleting an activty with linked todos, but i don't htink it makes sense to apply the other way around (i.e. deleting a todo with a linked activity does not delete the activity).

do ahead with /beanies-pre-plan and go directly to /beanies-plan and /beanies-build-auto - only stop if you need a decision for me or hit a blocker

### Follow-up 5 (mockup decisions)

Layout A (side drawer). Delete default: keep the to-dos. Undated prep to-do: due the day before the activity. Mockup approved, go.

</details>

## Outcome

> Built 2026-09-29 via `/beanies-build-auto`. Not deployed (app). The `ai-extract` Lambda WAS applied (three code-hash-only applies via `scripts/infra/tf-apply.sh`), as the plan requires the Lambda to land before the app.

**Built as planned**, with these recorded deviations:

- **Legacy Lambda arm:** a `todo` answer is rewritten to `{ kind: 'none' }` (a normal, counted 200), not refused with a 502 as Pass 4 proposed. Round-1 review showed the 502 made every pure to-do note fail on old builds with a false "try a clearer photo" that retries repeat. The rewrite runs BEFORE the correction guard, so a legacy correction answered `todo` is a 422 `correction_disagreed` (round 2).
- **Superseded save:** the review drawer checks its own `ready` identity after the write and drops a `saved` for a capture that was replaced mid-save (logs `link_skipped`, stage `superseded`). An earlier page-level guard missed the case where the newer capture also had to-dos, so the decision moved into the drawer that owns the save.
- **Owner reason** shows as the existing `holdsHint` line ("Sofia holds School Forms in Who Owns What.") under the row, not the mockup's inline chip; the derived-date suffix reads "activity day" / "day before".
- **Favicons are off** in the review drawer (`LinkList` `favicons` prop): an unreviewed private-AI read must not send link domains to Google's favicon service.
- **Subtitle** names the source ("From a shared link / photo / document / note you shared.").
- **Titles** use a grid-mirror auto-growing textarea (wraps at phone width); pasted line breaks fold into spaces; Enter is blocked except during IME composition.
- **Update-existing:** a read's link that differs from the matched activity's existing link is appended to its notes (`mergeExtractionIntoActivity`), so it is never lost.
- **Dead code removed:** `useActivityScopeEdit.handleScopedDelete` (no callers; duplicated the delete path).
- **Pricing page** (`web/src/pages/pricing.astro`) lists to-dos among what magic beans reads; needs a web deploy.

**Added on greg's request during testing (same session):** after an activity is created on the planner, the view moves to its date, scrolls it into view and pulses it (`useActivityReveal` + `useAttentionPulse`, new `.attention-ring`), and `CreatedConfirmModal` gained a View Activity action.

**Reviews:** `/code-review high` twice (round 2 scoped to the fixes + the reveal feature). Round 1: 10 findings, 9 fixed, 1 partly (the event and companion parsers still emit one rejected-fields event each on a shared read; names are deduped within each). Round 2: 10 findings, 9 fixed, 1 partly (`firstOccurrenceDate` scans month by month instead of 13 months at once; expanding only the target activity needs the store's private `expandEvents` exported). Two rounds is the ceiling; no third review was run.

**Follow-ups:** export `expandEvents` for the reveal (above); `BeanieDatePicker` next-month skips February when opened on the 29th-31st (`addMonths` via `setMonth`, ~:216); on `/todo` a to-do whose description is only a link shows the raw URL as its description line.
