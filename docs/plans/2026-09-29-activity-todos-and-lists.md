# Plan: From an activity, see and add its to-dos and lists

> Date: 2026-09-29
> Related issues: Notion tracker #114 (no GitHub issue, per the tracker's `github issue` = do not create). Companion to #113.
> Plan file: `docs/plans/2026-09-29-activity-todos-and-lists.md`
> Mockup: `docs/mockups/activity-todos-and-lists-2026-09-29.html` (direction A, approved 2026-09-29)

> **No GitHub issue created.** This plan was approved for direct implementation.
>
> **On approval:** save this plan to `docs/plans/2026-09-29-activity-todos-and-lists.md`, write its GitHub URL to Notion #114 `plan file url`, then build, verify in a browser and `/code-review`. Deploy only once greg has tested #113 + #114 together, in one `/deploy-prod-auto`.

## User Story

As a parent looking at the soccer tournament, I want to see and add everything that goes with it (the forms to sign, the kit list) right there, so I don't have to hunt across pages.

## Context

#113 (built, reviewed, pushed, NOT deployed) lets magic beans turn a note into an activity plus to-dos, and links each to-do to the activity via `TodoItem.activityId` (a soft link). Lists already carry `FamilyList.linkedActivityId` and the Activity Details drawer shows them read-only through `LinkedLists`. What is missing is the other direction: from an activity you cannot see its to-dos, cannot add one, and cannot start a list. #114 makes the activity the hub. greg wants it built to ship **in the same prod deploy as #113** ("deploy all together").

Links stay on the child (to-do / list), never as arrays on the activity (`models.ts:969-975` rationale: concurrently-edited arrays merge badly under Automerge and owe reverse cascades).

Repeating activities are one stored record whose sessions are generated at render time (`activityStore` `expandRecurring`/`expandEvents`, private); only an edited session exists as its own record (an override child, `parentActivityId` + `originalOccurrenceDate`). greg decided (2026-09-29) that an item added from a session belongs to **that session only**, and nothing is ever created per session in advance.

## Requirements

1. **To-dos section in Activity Details.** Always present (not flag-gated). Eyebrow "To-dos" with an "N open" count when there are open ones. Linked to-dos render as compact `TodoItemRow`s, open first (by due date), then a small "Done" divider and the done ones (most recently done first). Tick in place (celebration + undo as everywhere). Tap a row to open the to-do in a stacked `TodoViewEditModal`.
2. **Add row.** A one-line add row is always there for members who can edit activities, even with nothing linked. Typing a title and pressing Enter (or Add) creates a to-do linked to the activity without leaving the drawer. Defaults, both editable in the row before adding: assignee = the member adding it; due = the day before the session being viewed, or today if that day has passed (never in the past). On a repeating activity a hint under the row reads "Links to the <date> session" (mockup). The new to-do appears in the section immediately. A failed create keeps the typed text.
3. **Lists section gains create actions** (behind the existing `familyLists` flag, committed ON, and `canEditActivities`): "+ New List" (a blank list, linked, opened straight away in the stacked `ListDetailModal`) and "From a Template" (the existing `NewListSheet`, the created list linked and opened). Shown even when no lists are linked, as a dashed "No lists yet" row carrying the two actions (mockup direction A, frame 3). A template suggested for the activity's category is marked "Suggested" and listed first.
4. **No self-pointing chips.** Inside the activity, linked to-do rows do not show the `LinkedActivityChip`; the stacked `TodoViewEditModal` opened from the activity also hides its linked-activity row.
5. **Repeating activities, per-session links.** A to-do or list added from a session of a repeating activity links to `activityId` = the series (master) id + `activityDate` = that session's date (`seriesDate`, the repeat start for a multi-day repeat). It shows only on that session. Items linked to the whole activity (no `activityDate`, e.g. everything #113 saves) show on every session with a small Sky Silk "Every Session" tag (mockup). An edited session (override child) shows: items linked to its own id, plus the series' whole-activity items, plus items linked to the series for that session's original date (so a session's to-dos survive the session being edited "this only"). Items added from an edited session link to the series id + that session's original date (`overrideOccurrenceYmd(child)`), so they survive "reset to series" and splits, and a whole-series delete counts them. Items already linked to an edited session's own id (possible via `ListDetailModal` since #33) still match it.
6. **Links survive "this and future" edits.** When `splitActivity` moves future sessions to a new series id, session-dated to-dos and lists on or after the split date move to the new id (their date unchanged). Whole-activity (dateless) items stay on the original series.
7. **Chips outside the activity point at the right session.** Where a to-do (To-Dos page, Nook, briefing) shows its `LinkedActivityChip` and the link has an `activityDate`, the chip resolves to the session actually shown on the calendar (the override child if that session was edited, otherwise the series + date): its label is that session's date, and tapping it opens the drawer on that session.
8. **A list's link is always written whole.** Linking, unlinking or relinking a list (in `ListDetailModal`, on activity delete, on split) writes `linkedActivityId` and `activityDate` together, so a stale session date never survives.
9. **Help Center.** `family-todo-lists` (section `linked-activity`) and `beanie-lists` (section `linking`) cover adding from the activity side and the per-session rule.
10. **i18n.** Every new string in `uiStrings.ts` with `en` + `beanie` values; `npm run translate` run.

## Important Notes & Caveats

- **Deploy together with #113.** #113's manual tests (STATUS.md, a-f) are still owed by greg; this plan's build does not deploy. The single `/deploy-prod-auto` after both are tested ships both. No `ai-extract` Lambda change is needed for #114.
- **Old clients.** A to-do or list with `activityDate` read by a pre-#114 client is treated as linked to the whole series (it matches on id only). Harmless: it appears on every session there. No migration.
- **Session deletes.** Deleting "this session only" does not ask about that session's to-dos (it never has; `confirmAndDeleteActivity` only runs for one-offs and whole-series deletes). They stay, still dated to a now-cancelled session, and stop showing in any session drawer; their chip resolves to the cancelled child and hides like any unresolvable link. Accepted; kept to-dos are the default everywhere.
- **Whole-series delete** already counts `openTodosForActivity(id)`; that stays id-only so it counts every session's to-dos, which is correct for "delete everything".
- **Permissions.** The add row and the list actions are `v-if="canEditActivities"` (`usePermissions.ts:63`), the same gate as the To-Dos page quick bar (`FamilyTodoPage.vue:361`). Lists remain behind the flag.
- **CIG.** The shared eyebrow uses `ink-faint` text, not the drawer's older `opacity-35` Recent Transactions label (`ActivityViewEditModal.vue:1763`), which breaks the no-opacity-on-text rule; accents get `-lift` partners in dark; the "Every Session" tag uses Sky Silk tint tokens that already carry light/dark values; rem sizes only.
- **Suggested templates.** The mockup's "Kit Bag" template does not exist; sports activities get no Suggested badge. Only party and day-out categories suggest one.
- **"This and future" deletes** (`ActivityViewEditModal.vue:711-722`) end the series and remove edited sessions past the cut. Session-dated items past the cut stay on the To-Dos page but show in no drawer, like a single-session delete; a whole-series delete still counts them.
- **Rollout window.** A pre-#114 client relinking a list writes only `linkedActivityId` and can leave a stale date; once both ship, Req 8 prevents it.
- **"All sessions" edits that move the pattern** (e.g. Tue → Wed) leave session-dated items keyed to dates that are no longer sessions, the same date-keying override children already have (`useActivityScopeEdit.ts:83-101` reaps only truncations). They stay on the To-Dos page and their chip opens the series, but appear in no session drawer. Accepted for v1; not re-keyed.
- Do NOT show these sections on the activity edit form (`ActivityModal`), and do not let a to-do or list link to more than one activity (out of scope).

## Assumptions

1. `ActivityViewEditModal` receives `occurrenceDate` from every calendar entry point, and `seriesDate` (`activityStore.repeatStartFor(activity, occurrenceDate)`, `ActivityViewEditModal.vue:170`) is the correct session key (overrides, splits and scoped deletes already use it).
2. Opened without a date (inactive list, or a deep link without `date`), a repeating activity's drawer falls back to `seriesDate` = the series start; the add row then links to that first session. Acceptable; chips carry the date (Req 7).
3. `familyLists` stays committed ON in prod.
4. The #113 commits are on `main` and undeployed at build time; #114 builds on them (`useTodoCreate`, `todoStore.linkTodosToActivity`, `resolveTodoDue`).
5. `TodoItem` / `FamilyList` repositories are generic Automerge repositories with no field allowlist, so a new optional field needs no migration. `update` and (after this change) `patchMany` delete keys explicitly set to `undefined`, which the link patches rely on.

## Approach

### 1. Model and the link module

- `src/types/models.ts`: add `activityDate?: ISODateString` (YYYY-MM-DD) to `TodoItem` (beside `activityId`) and `FamilyList` (beside `linkedActivityId`), docblock: "The session of a repeating activity this links to. Absent = the whole activity. Set only when the link targets a repeating series' generated session. Always written together with the id (see `utils/activityLinks.ts`)."
- New pure module `src/utils/activityLinks.ts`, the single source of truth:
  - `type ActivityLink = { activityId: string; activityDate?: string }`
  - `linkForSession(activity, sessionYmd): ActivityLink` - repeating master: `{ activityId: activity.id, activityDate: sessionYmd }`; edited session (override child whose parent resolves): `{ activityId: child.parentActivityId, activityDate: overrideOccurrenceYmd(child) }`; one-off (or an orphaned child): `{ activityId: activity.id }`.
  - `sessionLinkMatcher(activity, sessionYmd): (link) => 'session' | 'every-session' | null` - repeating master: id match and (no date → `'every-session'`, date === sessionYmd → `'session'`); override child: own id → `'session'`; parent id with no date → `'every-session'`; parent id with date === `overrideOccurrenceYmd(child)` → `'session'`; one-off: own id → `'session'`.
  - `itemsForSession<T>(items, toLink: (t: T) => ActivityLink | null, activity, sessionYmd): { item: T; scope }[]` - the one generic filter.
  - Readers `todoLink(t)` / `listLink(l)` and writers `todoLinkPatch(link | null)` / `listLinkPatch(link | null)` that always return BOTH keys (`undefined` clears), e.g. `{ linkedActivityId, activityDate }`. Every link write in the app goes through a writer. Enforced by `src/utils/__tests__/activityLinkWrites.test.ts`, a source-scan guard in the `calendarSyncStore.deleteSites.test.ts` style: with comments stripped, it fails if `linkedActivityId\s*:` or `activityDate\s*:` appears as an object key in any `src/**/*.{ts,vue}` other than `utils/activityLinks.ts` and tests (type declarations use `?:` and do not match). `toCreateTodoInput` spreads `todoLinkPatch(...)` rather than writing the keys itself.
  - `resolveLink(link, lookup: { byId(id), overrideFor(seriesId, ymd) })` (pure, the inverse of the matcher, kept in the same module): for `(seriesId, date)` whose session was edited, returns the override child and its date, or `null` when that child has `isActive === false` (a cancelled session, `ActivityViewEditModal.vue:701,748`), so the chip hides; otherwise the activity and the date; `null` when the activity does not resolve. Dateless links resolve as today.
  - **Fail-safe:** `sessionLinkMatcher` matches a non-repeating activity on id alone and ignores any `activityDate`, so an activity edited from repeating to one-off keeps every item visible.

### 2. Stores

- `todoStore.todosForActivitySession(activity, sessionYmd)` = `itemsForSession(...)` with open sorted by `sortTodos(open, 'dueDate')` (`utils/todo.ts:48`) and done by the existing `byCompletedDesc` (`todoStore.ts:20`). `openTodosForActivity` unchanged.
- `listStore.listsForActivitySession(activity, sessionYmd)` = `itemsForSession(...)`; `LinkedLists` uses it for the activity case (vacation case unchanged).
- **Repository fix (prerequisite).** `automergeRepository.patchMany` runs `stripUndefined(patch)` and never sends `deleteKeys` (`automergeRepository.ts:125-146`), while `update` does (`:166-185`); a batched link clear would otherwise be an empty patch, silently leaving lists linked to deleted activities. Extract one private `splitPatch(input) → { patch, deleteKeys }` used by both; the worker `patch` op already honours `deleteKeys` (`docOps.ts:609`). Repository test: `patchMany` with an `undefined` key deletes it.
- `listStore.createBlankList(memberId, overrides = {})` (mirrors `createFromTemplate(key, memberId, overrides)`, `listStore.ts:464`), extracted from `NewListSheet.startBlank`; the sheet calls it.
- `listStore.createList`'s `wrapAsync` gains `surface: 'lists'` (it reports under `app` today, `listStore.ts:452`).
- `listRepository.patchLists = repo.patchMany` (one line, as `todoRepository.ts:26`) and `listStore.linkListsToActivity(ids, link | null)` mirroring `todoStore.linkTodosToActivity` (`todoStore.ts:231`): one batched write via `listLinkPatch`, `onMissing: 'skip'`, `wrapAsync` surface `lists`. `todoStore.linkTodosToActivity` is widened to take an `ActivityLink | null` and write via `todoLinkPatch` (its #113 caller passes `{ activityId }`, behavior unchanged).
- `listStore.clearLinksFor`'s activity branch collects the ids and calls `linkListsToActivity(ids, null)`: one batched write with `wrapAsync` reporting, replacing the N-write loop that ignores its results (`listStore.ts:947-953`, whose own comment names that gap). The trip branch is unchanged. `ListDetailModal` link/unlink (`ListDetailModal.vue:340-349`) write via `listLinkPatch` (Req 8).
- `activityStore.splitActivity` gains ONE line after the re-parent loop: `await moveSessionLinks(original.id, newTemplate.id, fromDate)`. `moveSessionLinks` is a private helper beside `deleteOne` (`activityStore.ts:1096-1105`), reaching the stores with dynamic `import()` (`todoStore` imports `activityStore`, `todoStore.ts:16`). It selects to-dos and lists where `activityId === fromId && activityDate >= fromDate`, groups them by `activityDate` (`patchMany` applies one patch to every id), and calls `linkTodosToActivity(ids, { activityId: newId, activityDate })` / `linkListsToActivity(...)` once per group, so each item keeps its own date. It owns the `split_relinked` (count summed across groups) / `split_relink_failed` (failed count) events. A failure has already been toasted and reported by `wrapAsync`; the split is never rolled back. Nothing else in the split body (`activityStore.ts:1278-1392`) changes.
- `activityStore.resolveActivityLink(link)` is a thin wrapper over `resolveLink` passing `activities` and `overridesByParent` (`activityStore.ts:260-270`).

### 3. Creating a to-do from the activity

- `src/utils/todo.ts`: `TodoCreateFields` gains optional `activityId`, `activityDate`; `toCreateTodoInput` adds `...(fields.activityId ? todoLinkPatch({ activityId: fields.activityId, activityDate: fields.activityDate }) : {})`, so the output for existing callers (including the #113 magic beans batch) is unchanged (closed-key builder, `todo.ts:86-89`).
- `useTodoCreate`: `TodoCreateSource` gains `'activity'`; `createTodoFrom` adds `kind: fields.activityDate ? 'session' : fields.activityId ? 'whole' : undefined` to its existing `todo-create` event.
- `src/utils/date.ts`: `defaultDueBeforeEvent(eventYmd, todayYmd)` = the later of `addDaysYmd(eventYmd, -1)` and `todayYmd`. Standalone; `resolveTodoDue` (`magicTodoDrafts.ts:217-243`) is NOT touched (it needs the unclamped date, the `on_event_day` branch and the `dueDerived` label, and #113's tested code is undeployed).
- New `src/composables/useTodoDraft.ts`, extracted from `NookTodoWidget.vue:19-84`: `useTodoDraft({ source, callerTag, defaults: () => ({ dueDate, assigneeIds }), link?: () => ActivityLink })` returns `{ title, dueDate, assigneeIds, isAdding, add }`; it guards double submits, calls `createTodoFrom`, keeps the draft on `null` (already toasted), clears only fields unchanged since submit, and resets to `defaults()`. `NookTodoWidget` and `QuickAddBar` both use it.
- `useTodoDraft`: the draft starts from `defaults()` at setup (the sections are keyed, so each session gets a fresh draft) and resets from `defaults()` after a successful add; `link()` is read only at submit. `defaults()` uses `localToday()` (`date.ts:655`), so a drawer left open past midnight never offers a past date. The assignee default is `me ? [me] : []`, never `['']`.
- `QuickAddBar` keeps `defineExpose({ focus })` (used at `FamilyTodoPage.vue:281`).
- `QuickAddBar` (reused): props `source`, `callerTag`, `defaults?`, `link?`, `placeholder?`, `hint?`; emits `created(todo)`. Its root gets `@container` and its `sm:` variants become `@lg:` (32rem, Tailwind 4 container queries), so it lays itself out by its own width: two rows in the 448px drawer, one row on the To-Dos page. No layout-mode prop. This fixes its lost-draft bug (`QuickAddBar.vue:28-36` clears the title before the create resolves) and adds the double-Enter guard. `FamilyTodoPage` switches from `@add` + `handleQuickAdd` to `@created` → `revealTodo`.

### 4. New component `src/components/todo/ActivityTodos.vue`

- Props `activity: FamilyActivity`, `sessionYmd: string`.
- Renders `SectionEyebrow` ("To-dos", "N open" in the end slot), `TodoItemRow compact` rows from `todosForActivitySession`, the "Done" divider, and (`v-if="canEditActivities"`) `QuickAddBar` with `defaults = { assigneeIds: [currentMemberId], dueDate: defaultDueBeforeEvent(sessionYmd, today) }`, `link = linkForSession(activity, sessionYmd)`, placeholder "Add a to-do for this session" and the "Links to the <sessionYmd> session" hint when `link.activityDate` is set (repeating master or edited session), "Add a to-do" and no hint otherwise.
- Toggle: `todoStore.toggleComplete(id, currentMemberId)` (same as the To-Dos page).
- Hosts its own `<TodoViewEditModal stacked hide-activity-link :todo="selected" />` (the `NookTodoWidget.vue:46-49` precedent), so `ActivityViewEditModal` gains no to-do state.
- `TodoItemRow`: optional prop `activityScope?: 'session' | 'every-session'`; when set the `LinkedActivityChip` is hidden and `'every-session'` renders `EverySessionTag`.
- `TodoViewEditModal`: `stacked?` → `BeanieFormModal :layer="stacked ? 'overlay' : 'base'"` (the `ListDetailModal` precedent) and `hideActivityLink?`.
- **Picker layering.** `BeanieDatePicker` and `AssigneePickerButton` teleport their pop-ups to `body` at `z-50` (`BeanieDatePicker.vue:349,362`; `AssigneePickerButton.vue:185,190`), below the `overlay` layer (`z-[60]`, `BaseModal.vue:57`), so a picker inside a stacked drawer opens behind it. Both pop-ups move to `z-[70]` (above `overlay`, below `top`). Fixed once in the two pickers; this also fixes the existing stacked `ListDetailModal` due-date picker.

### 5. Shared UI pieces

- `src/components/ui/SectionEyebrow.vue` (icon, label, `#end` slot), extracted from `LinkedLists.vue:141-145` and used by both sections.
- `src/components/lists/LinkedListCard.vue` (props `list`, `everySession?`) owns one list's card: the `ListCard` fields derived from the list (`LinkedLists.vue:60-84`), the fill-on-mount progress bar (`:88-89`), `headerStyle`/`tint`, and item ticking via `listStore.toggleItem` (`:101-103`). `LinkedLists` and `ActivityLists` only loop, so neither copies the `cards` computed.
- `src/components/ui/EverySessionTag.vue`, used by `TodoItemRow` and the `LinkedLists` card.

### 6. Wire into `ActivityViewEditModal.vue`

- `sessionYmd = (isRecurring && seriesDate) || extractDatePart(activity.date)` - the session's real start date (for an edited or rescheduled session, the child's own date), used for the due default and the hint. The original-date key for override matching stays inside `sessionLinkMatcher`.
- Replace `<LinkedLists :activity-id ...>` with `<ActivityTodos :activity :session-ymd />` then `<ActivityLists :activity :session-ymd />`, both keyed ``:key="`${activity.id}:${sessionYmd}`"``. The drawer stays mounted while its props change (`FamilyPlannerPage.vue:1291`, `FamilyNookPage.vue:298`), so the key resets a half-typed draft, its due default and any stacked child modal when moving to another activity or session.
- Remove `linkedListId` and the stacked `ListDetailModal` from the drawer (`ActivityViewEditModal.vue:96-99, 1795, 1821`); `ActivityLists` owns them.

### 7. `ActivityLists.vue` (new), `LinkedLists.vue` and `NewListSheet.vue`

- `LinkedLists` becomes trip-only: keeps `vacationId`, drops `activityId` (its only activity caller is `ActivityViewEditModal.vue:1795`) and its nested trip/activity ternary (`LinkedLists.vue:24, 34-43`), and renders `LinkedListCard`.
- New `src/components/lists/ActivityLists.vue` (props `activity`, `sessionYmd`), mirroring `ActivityTodos`: `v-if` on the `familyLists` flag; `SectionEyebrow` with "+ New List" / "From a Template" in `#end` (`v-if="canEditActivities"`); the dashed "No lists yet" row when empty; `LinkedListCard` per result of `listsForActivitySession` (whole-activity lists on a repeating activity pass `everySession`); hosts its own `NewListSheet` and stacked `ListDetailModal`.
- "+ New List" → `listStore.createBlankList(meId, listLinkPatch(linkForSession(...)))` → opens it in the stacked `ListDetailModal` (where the title is edited). A `null` has already toasted; `logEvent` warn `list_create_failed`.
- "From a Template" → `NewListSheet` with new props `overrides?: Partial<CreateFamilyListInput>` (spread last into both create paths), `suggestedTemplateKey?` (tile first, "Suggested" badge), `stacked?` (`BaseModal layer="overlay"`). `created` → open in `ListDetailModal`.
- `src/constants/listTemplates.ts`: `ListTemplate.suggestFor?: { groups?: string[]; categories?: ActivityCategory[] }`; `party-prep`: `{ groups: ['Party'], categories: ['work_party'] }`; `vacation-packing`: `{ categories: ['field_trip', 'beach', 'pool', 'theme_park', 'picnic'] }`; `suggestedListTemplateFor(category)` matches via `getActivityCategoryById(category)?.group` (the file's "a template is a one-row edit here" rule).

### 8. Chips and deep links

- `LinkedActivityChip`: prop `activityDate?`; label and push both come from `activityStore.resolveActivityLink`; push `entityDeepLink('activity', resolved.activity.id, resolved.date ? { date } : undefined)`.
- `entityDeepLink(type, id, extra?)` merges extra query keys.
- `useDeepLinkParam` gains `companions?: string[]`; `open(id, extras)` receives them and they are cleared with the main param (`useDeepLinkParam.ts:44-50` clears only its own today). `FamilyPlannerPage` validates `date` with `isRealYmd` (`date.ts:267`); invalid → `deeplink_date_invalid` and open without a date.
- `TodoItemRow` / `TodoViewEditModal` pass `todo.activityDate` to the chip.

## Files Affected

- `docs/mockups/activity-todos-and-lists-2026-09-29.html` (approved, committed `ea7c087f`)
- `src/types/models.ts`
- `src/utils/activityLinks.ts` (new) + test
- `src/services/automerge/automergeRepository.ts` (`splitPatch`, `patchMany` deletes) + test
- `src/components/ui/BeanieDatePicker.vue`, `src/components/ui/AssigneePickerButton.vue` (pop-up layer)
- `src/utils/date.ts` + test; `src/utils/todo.ts` + test; `src/utils/entityDeepLink.ts` + test
- `src/composables/useTodoCreate.ts`; `src/composables/useTodoDraft.ts` (new) + test; `src/composables/useDeepLinkParam.ts` + test
- `src/stores/todoStore.ts`, `src/stores/listStore.ts`, `src/stores/activityStore.ts` + tests
- `src/services/automerge/repositories/listRepository.ts`
- `src/constants/listTemplates.ts`
- `src/components/ui/SectionEyebrow.vue` (new), `src/components/ui/EverySessionTag.vue` (new)
- `src/components/todo/ActivityTodos.vue` (new) + test; `src/components/lists/ActivityLists.vue` (new) + test; `src/components/lists/LinkedListCard.vue` (new); `src/utils/__tests__/activityLinkWrites.test.ts` (new guard); `TodoItemRow.vue`; `QuickAddBar.vue`; `TodoViewEditModal.vue`; `LinkedActivityChip.vue`
- `src/components/nook/NookTodoWidget.vue`; `src/pages/FamilyTodoPage.vue`; `src/pages/FamilyPlannerPage.vue`
- `src/components/lists/LinkedLists.vue`; `NewListSheet.vue`; `ListDetailModal.vue`
- `src/components/planner/ActivityViewEditModal.vue`
- `src/services/translation/uiStrings.ts` (+ `public/translations/*` via `npm run translate`)
- `src/content/help/features.ts`
- `CHANGELOG.md`, `docs/STATUS.md`

## Help Center Coverage

- **Action**: update existing - **Category**: features - **Slug**: `family-todo-lists`, section `linked-activity` - **Title**: To-dos linked to an activity - **Scope**: open any activity to see its to-dos and add one right there; it is given to you and due the day before; on a repeating activity it belongs to the session you opened, while to-dos from a shared note belong to every session. - **Notes**: ticking works from both places; deleting a single session does not remove its to-dos.
- **Action**: update existing - **Category**: features - **Slug**: `beanie-lists`, section `linking` - **Title**: Linking a list to an activity or trip - **Scope**: start a blank or template list from an activity's Lists section and it is linked automatically; the per-session rule for repeating activities. - **Notes**: lists stay behind the lists setting.

Written per `.claude/skills/beanies-help-docs/SKILL.md`, in the same change.

## Observability Coverage

- **`todo-create`** (existing) `{ action: 'created', detail: 'activity', kind: 'session' | 'whole' }` on every add from the drawer: the success-path rate. Failures are already reported by `todoStore.createTodo`'s `wrapAsync` (toast + report) and `useTodoCreate`'s author guard; `useTodoDraft` keeps the draft.
- **`lists`**: `createList` failures now report under `lists` instead of `app`; `linkListsToActivity` failures report under `lists` via `wrapAsync`.
- **`activity-links`** (new surface, firehose only):
  - `list_created` `{ action, activity_id, detail: 'blank' | 'template', kind: <template key or 'blank'> }`; `list_create_failed` at `warn` with the same context (the store has already toasted and reported; this counts the rate for this entry point).
  - `split_relinked` `{ action, activity_id: newId, count, detail: 'todos' | 'lists' }`, emitted at `count: 0` too; `split_relink_failed` at `warn` `{ activity_id, count, detail }` when a link action returns `null` (already toasted and reported by `wrapAsync`; precedent `useActivityDelete.ts:96`).
  - `deeplink_date_invalid` `{ action, detail }` at `warn`.
- No double reporting: each failure is toasted and `reportError`ed exactly once, by the store's `wrapAsync`; the feature's own events are `logEvent` counters.
- No new context keys (`action`, `activity_id`, `kind`, `count`, `detail` are in `ALLOWED_CONTEXT_KEYS`, `src/utils/diagnosticContext.ts`). No store-declaration change. Nothing is `critical`: every failure leaves the item where it was.

## Acceptance Criteria

- [ ] A to-do saved from magic beans (#113) shows in its activity's To-dos section; on a repeating activity it shows on every session with the "Every Session" tag.
- [ ] Adding from the drawer creates a linked to-do assigned to the adder, due the day before the session (today if that has passed; the day before its new date for a rescheduled session); it appears immediately; a failed add keeps the typed text; the To-Dos page shows it with a chip dated to that session.
- [ ] Ticking works from the drawer and from the To-Dos page, and each reflects the other.
- [ ] On a repeating activity, a to-do or list added from one session shows on that session only.
- [ ] Editing that session "this only" keeps its to-dos and lists visible, and its chip opens the edited session; editing "this and future" from an earlier session moves later sessions' items to the new series.
- [ ] "+ New List" and "From a Template" create a linked list and open it; the section and actions show with no lists linked; a party or day-out activity shows a Suggested template.
- [ ] Unlinking or relinking a list in `ListDetailModal` clears its session date.
- [ ] No row inside the activity shows a chip pointing back at the activity; the stacked to-do drawer hides its activity row.
- [ ] The Nook widget and the To-Dos quick bar still add to-dos as before (now via `useTodoDraft`).
- [ ] Light + dark, phone + desktop match the approved mockup direction A with CIG tokens.
- [ ] Help Center article(s) listed in **Help Center Coverage** added/updated and verified to match the shipped behavior.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with the stated `surface`/`context`; failure modes are triageable from CloudWatch without a local repro; any new context key is allowlisted + declared).
- [ ] `npm run validate` green; lint clean (i18n rules); `npm run translate` run.

## Testing Plan

1. Unit: `activityLinks` matcher and patches (all branches); `defaultDueBeforeEvent` (future, yesterday, today); `resolveTodoDue` suite unchanged; `toCreateTodoInput` carries the link only with an id; `todosForActivitySession` / `listsForActivitySession` ordering and scope; `splitActivity` relinks only dated items on/after the split, and a relink failure logs once without a second report; `resolveLink` returns the override child; round-trip invariant: for every link written by `linkForSession` (one-off, master session, override child) the matcher of the resolved activity/date accepts it; the matcher ignores `activityDate` on a non-repeating activity; the link-write guard test; `createBlankList` (existing `NewListSheet` test green); `entityDeepLink` extra query; `useDeepLinkParam` clears companions; `useTodoDraft` keeps the draft on failure and ignores a double Enter; `ListDetailModal` link/unlink clears `activityDate`; `patchMany` with an `undefined` key deletes it; split relink with two sessions on different dates keeps each date; `resolveLink` returns `null` for a cancelled edited session; `linkForSession` on an edited session returns series + original date; `FamilyTodoPage.test.ts:83-93` stub switches from `add` to `created` (quick-add create assertions move to the `QuickAddBar`/`useTodoDraft` tests); `NookTodoWidget.test.ts` green unchanged; `listSeed.test.ts`: copied and recipe seeds carry no `activityDate`.
2. Component: `ActivityTodos` (order, add with link + defaults, tick, chip hidden, tag, hidden add row without `canEditActivities`, due default on a rescheduled override, switching the drawer's activity resets the draft and due default); `ActivityLists` empty state + actions only with flag + permission; `LinkedLists` trip case unchanged.
3. Browser (real Chromium, kept harness `scripts/design-screenshots/activity-todos-capture.ts`, phone 390 + desktop, light + dark, navigating in-app): one-off add + tick; repeating activity, add on session A, open session B (absent), open A (present); a dateless to-do on both with the tag; this-only edit of A keeps the to-do and its chip on the To-Dos page opens the edited session; "+ New List" opens the new list; From a Template on a birthday shows party-prep Suggested; Nook widget and To-Dos quick bar still add; edit the due date inside the stacked to-do drawer and the calendar appears on top; reset an edited session to series and its to-dos still show on that session.
4. `npm run validate` once, output to a scratch log.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the approved mockup (direction A) and the pre-plan block; one link matcher shared by to-dos and lists; per-session `activityDate`; reuse of QuickAddBar, TodoItemRow, NewListSheet, ListDetailModal stacking.
- **Pass 2 (DRY + error handling)**: `sessionYmd` collapsed to one expression (fixes the due date on rescheduled sessions); write-side link patches so `activityDate` never goes stale; one generic session filter; batched `linkListsToActivity` via dynamic import; `useTodoDraft` extracted from the Nook widget so QuickAddBar keeps the draft on failure; double `reportError`/toast paths removed; `SectionEyebrow` and `EverySessionTag` shared; chips resolve override sessions; deep-link companion params; template suggestions live on the template; add actions gated by `canEditActivities`.
- **Pass 3 (Sustainability)**: split relink moved into a `moveSessionLinks` helper so `splitActivity`'s body is unchanged; forward matcher and inverse resolver sit together in `activityLinks.ts` with a round-trip invariant test; new `ActivityLists` (plus extracted `LinkedListCard`) instead of a two-mode `LinkedLists`, which also takes list state out of `ActivityViewEditModal`; both sections keyed by activity + session so the always-mounted drawer can't carry a stale draft; `QuickAddBar` uses a container query instead of a `stacked` flag; single link-write path enforced by a source-scan guard test and batched `clearLinksFor`; fail-safe matching and the "all sessions" pattern-move limit documented.
- **Pass 4 (Fresh-eyes sweep)**: fixed `patchMany` so clearing a link really deletes it (otherwise `clearLinksFor` would stop unlinking lists); split relink groups items by date; edited sessions link to series + original date, so items survive reset to series and whole-series deletes count them; cancelled sessions hide their chips; picker pop-ups sit above stacked drawers; draft defaults are read at setup and use `localToday`; `resolveTodoDue` and the `toCreateTodoInput` output are left unchanged; `LinkedListCard` owns the per-card logic; affected tests listed.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (2026-09-29)

`/beanies-pre-plan #114 let's build and implement this feature to go alongside 113 to complete the overall feature, and deploy all together. once done go ahead to /beanies-plan`

### Clarifications (pre-plan, 2026-09-29)

- Empty state: "Show a slim add row" (the section always shows an add row; lists show New List / From a Template even with none).
- Recurring: "How would it work if you add a list or todo to a recurring activity? would it create one list / to-do for EACH instance of the activity? or would the list / to-do only ever link to that one instance? if the list / to-do applied for each activity that is difficult for me to visualize as it would mean lists / to-dos would be created indefinitely in advance. my inclination is that a linked list or to-do only applies to one isntance of an activity, but what would you propose?" Proposal accepted: "That session only" (series id + session date; dateless links show on every session; no every-session toggle).
- Assignee: "Whoever is adding it".
- Due date: "Day before, never past".
- Mockup: asked to "open as a claude artifact"; chose "A: two stacked sections".

</details>

## Outcome

> Built 2026-09-29 via `/beanies-build-auto`. Not committed, not deployed (ships with #113).

- **Built as planned**, with these recorded deviations: `QuickAddBar` has a `variant` look prop (`composer` | `inline`) because the mockup's dashed resting row cannot be styled from outside; layout is still the container query. "N open" sits in the eyebrow's inline slot (mockup), not `#end`. `TodoItemRow` gained a real done state (green tick, struck title) because it had none. `ActivityLists` hides entirely for a viewer who cannot edit and has nothing linked; `ActivityTodos` does the same (review round 1). `LinkedListCard` fixed three dark-mode gaps while extracting (All done lift, Open accent lifted on dark, `text-xs`). The link-write guard allows `activityDate:` only beside `activityId:` in one literal (an `ActivityLink`), and does not catch shorthand `{ activityDate }`.
- **Review round 1** (10 findings): fixed 7 (to-do drawer label for a cancelled session, `resolveLink` drops a stale date once an activity stops repeating, split skips relinking sessions whose child failed to re-parent, template create failures counted, view-only empty To-dos header, two `text-[X.Xrem]` sizes, "No date set" opacity); not fixed: session hint shows only once the add row is engaged (matches the approved mockup), and a "this and future" edit that ALSO moves the weekday leaves session-dated items on dates the new series no longer produces (same date-keying limit override children already have; documented, not re-keyed). STATUS updated.
- **Review round 2** (fixes only, 8 findings): fixed 2 (unknown template key now logs `lists/template_unknown`; one `logListCreate` helper). Not fixed, recorded: a still-repeating series can keep a session date it no longer produces after a failed write or an end-date/weekday change (drawer hides the item; chip label + deep-link date stale); whole-activity (dateless) items stay on the original series after a split, per Req 6, so they stop showing on future sessions (a plan decision, flagged to greg); the 10px chip sizes across `TodoItemRow` are older code outside #114 (follow-up); a dateless chip on a repeating series shows the series start date (#113 behaviour, follow-up); linear `find` in `resolveActivityLink` and a duplicate resolve in `TodoViewEditModal` (negligible at family scale).
- **Follow-up (greg, same session):** (1) confirmed: no to-dos/lists on the activity create/edit form (a link needs a saved activity; "Activity Created" offers View Activity). (2) A blank "+ New List" from the activity is discarded when closed untouched (no items, `updatedAt === createdAt`): `listStore.discardIfUntouched` returns `discarded | kept | gone | failed`, `ActivityLists` calls it on close and on unmount, and logs `activity-links/blank_list_closed { detail: outcome }` for every outcome. Template lists are never discarded. Scoped to the activity entry point; the Lists page's Start Blank List is unchanged.
- **Verified:** `npm run validate` green (9846 tests, 0 lint errors, build); browser walk green at phone + desktop, light + dark, including the calendar opening above the stacked to-do drawer.
