# Plan: Beanie wall - the board shows the whole list, and the trip drawer shows the whole trip

> Date: 2026-09-10 (v4, final fresh-eyes pass; every load-bearing claim below re-verified against the source)
> Related issues: None; direct implementation
> Plan file: `docs/plans/2026-09-10-wall-full-lists-and-trip-timeline.md`
> Mockup: `docs/mockups/2026-09-10-wall-add-row-and-trip-timeline.html` (exists on disk, approved 2026-09-10; also published at https://claude.ai/code/artifact/52b34f3c-e0eb-4970-b018-d065497c5421)

## User Story

As a family standing at the kitchen wall, I want to see every job on my list and every part of our
trip on the one screen, and to add, rename or remove a job without leaving it, so that the wall is a
thing we use rather than a thing we tap through.

## Context

Three defects, reported by greg on 2026-09-10 after using the wall. Everything in this plan exists to
serve one of these three and nothing else.

**1. The chore board hides items it has room for.** `WallChoreBoard.vue` caps each column at
`COLUMN_ROWS = 7` (line 36) and renders a `+N more` button for the remainder. But the column body
already carries `overflow-y-auto` (line 267), so the column scrolls; the cap is trimming a list that
had somewhere to go. Two things confirm this is a leftover rather than a decision:

- The orphan column immediately below renders **all** of its groups with no cap, scrolling. The
  "show everything and scroll" path already runs on this screen, so there is no layout risk to
  discover.
- The `+N more` opens `{ kind: 'lists' }`, the _all lists_ drawer, not the list being read. A child
  taps "+4 more" under Leo's swim bag and lands in a grid of everybody's lists. That loses their
  place, which is worse than the truncation it was solving.

**2. Unlocking the wall barely does anything.** Adding to a list already exists but only inside the
drawer. On the board, unlocking renders a `+` span on each list title that opens that same drawer.
Since (1) removes the drawer's main entry point from the board, the add has to come to the board or
the feature is stranded. greg also asked for rename and remove while unlocked.

**3. The trip drawer shows three flights out of four, and nothing else.** `useWallPeripherals.ts`
reads `vacation.travelSegments.slice(0, 3)` (line 123). The cap is the reported bug. The larger miss
is that `legs` is built from `travelSegments` alone, so `accommodations` and `transportation` never
reach the wall at all.

## Corrections carried forward from v1 and v2

v1 was audited against the source. Nine of its load-bearing claims were wrong; two of them would have
shipped a user-visible defect. They stay corrected here, and are listed so nobody re-derives them
from the old text. All nine were re-verified in this pass.

1. **A list-item undo that restores only `list.items` is not enough.** `listStore.removeItem`
   (listStore.ts:694) runs `deriveCompletion`, which files a one-off list when the removal leaves
   every remaining item done (sets `completed` / `completedBy` / `completedAt`). Restoring `items`
   alone leaves the list filed, and `useWallPeripherals` filters filed lists out via `isFiled`
   (line 149), so "undo" would make the whole list vanish from the wall. The undo must write back the
   completion triple, which is exactly what `toggleItem`'s celebration undo already does
   (listStore.ts:655-666).
2. **A to-do undo does NOT have to lose fields or the id.** `CreateTodoInput` is
   `Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>` (models.ts:701), so `completedAt`, `someday`,
   `dueTime`, `description` and the hint markers all round-trip. And `createAutomergeRepository`
   already returns `createWithId` (automergeRepository.ts:76, 141), exported precedent-style by
   `familyMemberRepository.createFamilyMemberWithId` and used by `calendarRepository` and
   `driveRepository`. A faithful same-id restore is a one-line repository export plus a small store
   action, not an accepted asymmetry.
3. **`useEscapeClose` does not double-close.** It keeps a module-level stack and fires only the
   top-most token (useEscapeClose.ts:31-38). The real hazard is that `WallSheet` hand-rolls its own
   `window` keydown listener (WallSheet.vue:116-119), which sits outside that stack. v1's prescribed
   fix (`@keyup.esc`) does not help either: keyup and keydown are different events, so the sheet's
   keydown listener fires regardless. See Part 2.
4. **`ActionButtons.vue` is reusable here.** `showEdit` is a prop (default true, settable false) and
   `size="lg"` is already a 36px box around a 16px glyph. The valid objection is different: 36px is
   under the wall's 44px touch floor, and `hover:text-red-600` has no dark partner. v4 narrows the
   remedy: add a size, add dark partners, change nothing in light mode. See Part 2.
5. **The `logEvent` rate limit is per `(surface, normalized message)`**, not per surface
   (`RATE_MAX_PER_WINDOW = 50`, key `${surface}::${normalizeMessage(message)}`, logEvent.ts:75-86).
   `errorReporter` buckets the same way (errorReporter.ts:146). This changes the _reason_ the
   six-message table below is correct, not the table.
6. **The context allowlist lives in `src/utils/diagnosticContext.ts`** (line 61), not `logEvent.ts`.
   `action` (line 68) and `kind` (line 75) are both on it, so v1's conclusion (no allowlist change,
   no store-declaration change) stands.
7. **The `.when-cap` partner is `teal-lift`, not `silk-lift`.** `packages/brand/theme.css:146-149`
   states the intent explicitly: `--color-teal-lift: #4fd1be` exists "for the darker members of that
   family used as text (#0077B6, #2a9d8f)". `silk-lift` is for the Sky Silk blues.
8. **`--vacation-teal` and `--vacation-gold` do not have dark partners.** Only their _tints_ differ
   between the light (`src/style.css:124-128`) and dark (`src/style.css:170-174`) blocks; both base
   hexes are identical in each. `#00B4D8` measures 6.83 / 5.92 and clears AA on its own, so it is
   usable, but do not describe it as a lifted partner.
9. **`useVacationTimeline` will be instantiated twice, not once.** `useWallPeripherals()` is called
   independently by `WallPeripheralCards.vue:57` and `WallSheet.vue:104`, so each gets its own
   computed chain. That is fine (a trip has tens of segments and both computeds are lazy and cached),
   but the claim "the heavy computed is not evaluated twice" was false and a singleton is not worth
   the Pinia test-isolation cost.

Two omissions found in v1 are also designed for: the `WallJobRow` root is a `<button>`
(WallJobRow.vue:122, so nothing interactive can be nested inside it), and deleting the board's
`+N more` makes the `{ kind: 'lists' }` sheet variant unreachable dead code (its only emitter in the
whole app is `WallChoreBoard.vue:302`, confirmed by grep).

## What v4 changes from v3, and why

v3 was correct in its architecture and mostly correct in its facts. This pass re-verified the risky
claims against the source and found five that were wrong or unachievable, plus five places where v3
was doing more than the request needs. Every change below is a _reduction_ or a _correction_. Nothing
new is added except one characterisation test that replaces a safety claim that turned out to be
false.

**Corrections (v3 asserted something the source does not support)**

1. **"Byte-identical telemetry" was not achievable, and the test that asserted it would have been
   wrong.** The three existing wall writes do not use a consistent context shape today:
   `toggle` emits `action: 'job_toggled'` (past tense) on success but `action: 'job_toggle'` on
   failure (useWallJobs.ts:151 vs 143); `addListItem` and `addTodo` emit `kind: 'ok'` on success
   (lines 197, 244) and no `kind` at all on failure (lines 189, 236). `kind: 'ok'` is a constant that
   carries no information and collides with the real `kind` dimension (`'list' | 'todo'`). A single
   shared `write()` helper cannot reproduce that inconsistency without a per-outcome context table,
   which is a worse artefact than the inconsistency. v4 normalises: `context: { action: <op>, kind:
'list' | 'todo' }` for every operation, on both outcomes. **The six existing message strings and
   every severity are unchanged**, which is what any CloudWatch filter keys on. This is documented as
   a deliberate, tiny context correction rather than hidden behind a false claim.
2. **`action` does not need a table column at all.** With the normalisation above, `action` is
   exactly the `WriteOp` key. `context: { action: op, kind }` needs no lookup, so `WRITE_OPS` carries
   only the two message strings per op, which are the values that must be greppable literals.
3. **"`useWallJobs.ts` must come out smaller" is arithmetically false, and a criterion nobody can
   meet gets gamed.** The file is 274 lines. Deleting three try/catch scaffolds saves roughly 60
   lines; the helper plus table costs roughly 35, and rename, remove, the snapshot and the undo toast
   add roughly 55. It will land near 300 lines. v4 replaces the line-count criterion with a
   structural one that is both honest and mechanically checkable: **three new operations are added
   without adding a single new `try` / `catch` block or a single new `logEvent` / `reportError` call
   site.** `WallSheet.vue`'s shrink criterion stays, because it is real (roughly 80 lines out, two
   tags in).
4. **`ListItemRow.vue` has no tests, so v3's "regression gate on the extraction" does not exist.**
   Verified: there is no `ListItemRow.test.ts`, no `ListDetailModal.test.ts`, and no E2E touching
   inline list-item editing. `ListItemRow` is consumed by `ListDetailModal.vue`, `LinkedLists.vue`
   and `ListCycleModal.vue`. Converting an untested component used in three places on the strength of
   an imaginary gate is not acceptable, and neither is leaving a second copy of the discipline (DRY is
   a stated core principle in `CLAUDE.md`). v4 keeps the conversion and adds the missing gate: a
   characterisation test for `ListItemRow`'s edit behaviour, written and green **before** the
   conversion lands.
5. **Two smaller factual fixes.** `ReturnType<typeof buildColumn>` appears **twice**
   (WallChoreBoard.vue:112 and 146), not three times. And `deleteTodo` returns `false` on _both_ a
   refusal and a throw (`wrapAsync` result `?? false`, todoStore.ts:166), so a thrown delete never
   reaches a `catch`; the `false` branch is where every to-do delete failure lands and it must carry
   the paging signal, exactly as `toggle`'s existing comment argues for its `null` branch.

**Scope cut as over-engineering (v3 was doing more than the three asks require)**

6. **`canEdit` is NOT added to `WallLockContext`.** Three components would still each write
   `computed(() => lock?.canEdit.value === true)` for nullish safety, so the interface member removes
   the _definition_ of the rule from one place but removes none of the duplication. v4 instead
   exports one nullish-safe accessor from the existing key file, `useWallLock()`, returning
   `{ canEdit, noteActivity }`. Three call sites, one definition, no interface change, no change to
   `BeanieWallPage`'s `provide`.
7. **`WALL_EDIT` gets no fallback object.** v3 specified a fallback whose four functions each
   `console.error` and resolve `false`, and justified it as "degrade to read-only". It does the
   opposite: a truthy fallback renders the editable controls and then eats the writes. It is also
   unreachable, because the controls are gated on `canEdit`, which is already false when the lock is
   not provided. v4 uses `inject(WALL_EDIT, undefined)`, exactly as `WALL_BURST` is used today, and
   gates the controls on `canEdit && edit`. No stub functions, no dead defensive code, no policy
   paragraph needed.
8. **`ActionButtons`' light mode is not touched.** v3 proposed re-toning it, accepted a user-visible
   colour shift on Accounts, Transactions and the Beanie List tiles, gave it its own commit and its
   own manual verification pass, and carried it as assumption 4. v4 makes the change strictly
   additive: keep `text-gray-400` and `hover:text-red-600` for light, add `dark:text-ink-faint` and
   `dark:hover:text-danger-lift`. Light mode is pixel-identical on all three existing call sites, the
   dark-mode defect the CIG cares about is fixed, and one commit and one assumption disappear.
9. **`WallTripTimeline.test.ts` is dropped.** The component would be a `v-for` over two arrays with
   one `v-if` on `status === 'pending'`. The merge, sort, group and when-band logic it displays is
   already covered by `useVacationTimeline.band.test.ts` and `useVacationTimeline.terminal.test.ts`.
   A mount test there asserts Vue's `v-for`, not this change.
10. **`captureListRestore` loses its `isRecurring` branch.** It captures all five fields
    unconditionally. `automergeRepository.update` deletes keys explicitly set to `undefined` and
    leaves absent keys untouched (automergeRepository.ts:100-106), and `deriveCompletion` never sets
    `cycleCelebrated` on a one-off, so restoring a one-off's `cycleCelebrated` to its own prior value
    is a guaranteed no-op. One fewer branch, one fewer import, and it cannot be wrong.

**Corrections to the design that prevent a regression**

11. **The title button must wrap the trailing spans.** v3's row sketch left `ownerLabel`, `doneAt`
    and `listEmoji` outside the title button. Today they sit inside the row's single `<button>`, so
    tapping them ticks. Leaving them outside would make a chunk of every row dead to touch while
    locked, which breaks requirement 6. They are `<span>`s and are valid inside a `<button>`, so they
    move inside the title button.
12. **`useInlineRename` must preserve the Enter / blur asymmetry.** `ListItemRow.onEnter` emits
    `edit-save` **unconditionally** (line 68; the store no-ops an empty or unchanged value, which is
    how a cleared field reverts cleanly), whereas `commitIfDirty` emits **only** when the draft is
    non-blank and changed (line 62). v3 did not state this. A composable that collapses the two
    commits into one rule silently changes what "clear the field and press Enter" does.
13. **`wall.undoFailed.title` was missing from v3's i18n table.** Only `.message` was listed, and
    `wall.removeFailed.title` ("That didn't get removed") is the wrong sentence for a failed undo.

One factual point carried forward unchanged: `wall.card.more` is kept in use by the **jobs/to-dos
summary card** (`WallPeripheralCards.vue:362`), not by the trip card. The trip card's `slice(0, 2)`
renders no more-button at all. The conclusion (the key is not orphaned) is unchanged.

## Requirements

1. The chore board column renders every list and every item its member has. No row cap, no `+N more`
   button on the board. The column scrolls, as it already does.
2. The board's per-list `+` that opens the drawer is removed, replaced by an inline add row.
3. When the wall is UNLOCKED, every list on the board shows an add row directly beneath it: a text
   box whose submit `+` is hidden while the box is empty and appears on first keystroke. Enter
   submits. Minimum 44px touch target.
4. When the wall is UNLOCKED, every job row can be renamed in place by tapping its title text, and
   removed via a trash-can control at the end of the row.
5. Remove is immediate and offers **Undo** in a toast. No confirm dialog.
6. The tick control is unchanged in size, position and behaviour in every state, and while locked the
   whole row still ticks on tap. Ticking must never become riskier or smaller because edit mode is on.
7. Deleting a whole LIST is explicitly out of scope for the wall; it stays on the lists page.
8. The trip drawer shows ALL travel segments, ALL accommodations and ALL transportation for the trip,
   in chronological order, grouped by day, on a vertical spine. It scrolls. Dateless items are shown,
   not dropped.
9. Every colour, radius, shadow, font and size in the new UI comes from the CIG / theme tokens.
   Existing helpers, composables and components are reused or extended rather than reimplemented.
10. Both light and dark are authored in the same change: a `-lift` partner on every accent used as
    text or a meaningful icon, a dark partner for every painted background (inline styles and scoped
    rules included), no opacity modifier on readable text.
11. No new failure path is silent. Every store write added here either succeeds, or tells the family
    what happened in their own language AND leaves a developer a cause plus a fix on the console.
12. **The change is a net simplification, measured structurally rather than by line count.** Three
    new wall mutations are added with **zero** new `try` / `catch` blocks and **zero** new telemetry
    call sites; `WallSheet.vue` ends with fewer lines than it started; and when this lands the
    codebase has exactly one wall write layer, one lock channel, one Escape stack and one
    inline-rename implementation.

## Architecture guardrails

These are the invariants an implementer must not trade away for convenience. Each one exists because
the alternative has already cost this repo something.

| Invariant                                                                                                                                                          | Why                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One write layer.** Every wall mutation lives in `useWallJobs.ts`. No component calls a store.                                                                    | MVO: views read reactive state and emit intents; orchestrators write. A leaf component that writes directly is how a second, divergent error contract gets born. |
| **One error contract.** All six wall writes go through the same internal `write()` helper.                                                                         | Three hand-copied try / catch blocks is what the file has today; adding three more would make six.                                                               |
| **One lock channel.** `WALL_LOCK` stays exactly as it is; `useWallLock()` in the same file is the ONE nullish-safe reader of it. `WALL_EDIT` carries writers only. | Two keys able to answer "can I edit?" is an invitation to disagree, and so is three components each re-deriving the negation.                                    |
| **One Escape stack.** `useEscapeClose` only. No hand-rolled `window` keydown listeners anywhere on the wall.                                                       | The sheet's hand-rolled listener already breaks stacking for every future nested control.                                                                        |
| **One inline-rename implementation.** `useInlineRename`, consumed by both `WallJobRow` and `ListItemRow`.                                                          | The resolved-guard / blur / unmount trio is subtle enough that a second copy will drift, and the component it lives in has no tests today.                       |
| **Literal telemetry messages.** Event message strings are literals in a frozen table, never built by template interpolation.                                       | A CloudWatch filter is only as good as `grep` finding the string in the source.                                                                                  |
| **Pure rules in pure modules.** Data rules (what to snapshot for an undo) live in `src/utils/`, not in a composable.                                               | Testable without Pinia; the wall's highest-risk rule gets the cheapest test.                                                                                     |
| **No new try/catch, no new telemetry site.** Adding a seventh wall operation later must be one `write()` call.                                                     | This is the structural form of "the file does not grow in complexity", and unlike a line count it cannot be gamed.                                               |

**On the MVO question for `WallJobRow`.** The row calls injected orchestrator functions, not stores
and not services. That is inside the pattern, not an exception to it. Stated here so a future
reviewer does not flag it and "fix" it back into prop drilling.

## Important Notes and Caveats

- **`WallJobRow`'s root element is a `<button>` today** (WallJobRow.vue:122). An `<input>` or a trash
  `<button>` cannot be nested inside it: it is invalid HTML and the inner control's clicks and focus
  behave unpredictably. The row must become a `<div>` wrapper holding a tick button and a title
  button. See Part 2 for the exact shape and for how requirement 6 is preserved through that change.
- **The tick's hit area grows; the row's height does not.** `.wall-tick` is sized by
  `BeanieWallPage.vue:1088` (`height: 2rem; width: 2rem` under `.wall-root :deep()`), and the row is
  `py-2`, so the row already occupies about 48px. A 44px tick button fits inside that without moving
  anything. The `.wall-tick` span itself keeps its classes and its size.
- **Deleting the board's `+N more` orphans the `{ kind: 'lists' }` sheet.** That target is emitted
  from exactly one place in the whole app (`WallChoreBoard.vue:302`, confirmed by grep across `src`
  and `e2e`). Leaving the variant behind is unreachable code. Delete it (union member in
  `src/types/wall.ts:114`, the `case 'lists'` in `sheetTitle`, and the `|| target.kind === 'lists'`
  arm of the sheet branch). `wall.sharedLists` stays in use as the `'list'` title fallback, so no
  i18n key is orphaned.
- **The small trip CARD keeps its cap and its travel-only filter.** `WallPeripheralCards.vue` slices
  to 2 rows. That is a summary card whose job is to be glanceable; it stays, and it keeps reading
  TRAVEL items only so the card a family already knows does not silently start leading with a hotel.
- **`beanie` values keep the real noun on destructive copy.** Remove, undo and their failure copy are
  important surfaces per the beanie-mode floor in `CLAUDE.md`: lowercase only, never "bean" for the
  item. `KEY_SUFFIXES` in `uiStrings.test.ts:163` only matches keys _ending_ in `Failed` / `Error`, so
  `wall.removeFailed.title` and `.message` are NOT auto-covered; the prefixes must be added
  explicitly to `IMPORTANT_PREFIXES` (line 97).
- **`noteActivity()` must fire on KEYSTROKE, not only on submit.** `useWallLock`'s
  `RELOCK_AFTER_MS = 120_000` is an idle timer (useWallLock.ts:34, 85-88). "Call it before awaiting"
  does not satisfy its own acceptance criterion: a two-minute rename never awaits anything, so the
  wall would relock mid-type and `v-if` the editor away. Bind it to `@input` on both the add row and
  the rename input. It is a `clearTimeout` plus a `setTimeout`, so per-keystroke is free.
- **A wall job can come from a list item OR a to-do** (`WallJob.source`). Rename and remove must
  dispatch to the right store; a shared code path that assumes "list item" will silently corrupt or
  no-op on to-dos. This is the single most likely regression in the change, and it is why the
  dispatch stays in the existing two-entry `writers`-map shape rather than becoming an if/else.
- **The two stores signal failure differently, and one of them cannot throw.**
  `listStore.updateItemText` / `removeItem` / `updateList` and `todoStore.updateTodo` return
  `T | null`; `todoStore.deleteTodo` returns `boolean` and, because it ends in `result ?? false`
  (todoStore.ts:166), it returns `false` for a thrown write as well as a refused one. So on the
  to-do delete path a `catch` is unreachable and the `false` branch is the only place failure lands.
  Normalise at the writer boundary, once, and make sure the false branch carries the critical report.
- **A no-op is not a failure.** `listStore.updateItemText` returns the list unchanged when the new
  title is blank or identical (listStore.ts:730). That must not raise an error toast.
- **`todoStore.createTodo` calls `trackFeature(result, 'todo')`** (todoStore.ts:133). A restore is not
  a new feature use. `restoreTodo` must NOT call it, or every undo inflates the feature-usage metric.
- **Undo writes `items` wholesale.** `listStore.updateList(listId, { items, ... })` replaces the
  array, so a concurrent add landing from another device inside the 6-second undo window would be
  clobbered. Accepted: the window is bounded at 6s by the toast, the same trait already exists on
  `toggleItem`'s celebration undo (listStore.ts:655-666), and the alternative (a store action that
  re-inserts one item at an index) does not exist and would not fix the filing problem on its own.
  Documented rather than discovered later.
- **`automergeRepository.update` deletes keys set to `undefined`** and leaves absent keys untouched
  (automergeRepository.ts:100-106). This is what makes `captureListRestore` able to restore a
  previously-absent `completedAt` by passing `completedAt: undefined`, and it is why the capture can
  be unconditional.
- **Do not regress the tick's TransitionGroup reorder.** `WallJobList.vue` relies on stable `job.key`
  for the FLIP move. `job.key` is `list:<listId>:<itemId>` or the to-do equivalent
  (`utils/wallJobs.ts:122`); adding controls to the row must not change keying, and the row must keep
  exactly one root element.
- **`SegmentWhenBand.vue` has a pre-existing dark-mode defect**: `.when-cap` is `#0077b6`
  (SegmentWhenBand.vue:78), named explicitly in the theme and the CIG (slide 9) as one of three blues
  that shipped under the AA floor (3.46). Its `html.dark` block (line 119) covers only the cell and
  arrow backgrounds, not this caption. It is in scope now because the wall is about to render many
  more of these bands.
- **Hint to-dos never reach the wall** (`buildWallJobs` skips `todo.someday` and `todo.hintType`), so
  there is no "a child deleted an auto-generated hint" case to design around.
- **`wallLockKey.ts`'s docblock is stale.** It says "The default THROWS" (line 6); every consumer
  actually calls `inject(WALL_LOCK, undefined)` (WallJobRow.vue:47, WallChoreBoard.vue:52,
  WallSheet.vue:66). Fix the comment while adding the accessor.
- **`BeanieFormModal` / `BaseModal` have no Escape handling** (verified by grep). So converting
  `ListItemRow` to `useInlineRename` introduces no competition with a modal-level Escape; the only
  behavioural delta there is that Escape now cancels the edit even when focus has left the input,
  which is an improvement and is covered by the new characterisation test.

## Assumptions

> **Review these before implementation.**

1. greg approved Option A (always-open add box, `+` on first keystroke) over Option B (ghost row),
   with the trash-can icon replacing the `X` in the mockup, and undo rather than a confirm.
2. The wall's own toast (`showToast`, already imported by `BeanieWallPage.vue:60`) is the right
   surface for undo. The wall has never opened a modal.
3. Deleting the unreachable `{ kind: 'lists' }` sheet variant is acceptable. If greg wants an
   "all lists" drawer kept, it needs a new entry point, which is not in this change.
4. The trip CARD losing its separately-bolded airport codes and its Sky Silk arrow tint is
   acceptable, in exchange for the wall carrying one model of a trip rather than two. The card keeps
   its `font-outfit` weight on the title, so the glance value is preserved; only the arrow's tint is
   lost. This is user-visible, so it goes in `CHANGELOG.md` under `Changed`.

(v3's fourth assumption, about accepting a deliberate light-mode tone shift on three unrelated pages,
is withdrawn: v4 does not change light mode at all.)

## Observability Coverage

All events go on the existing `beanie-wall` surface (`SURFACE` in `useWallJobs.ts:26`), so one
CloudWatch filter still isolates the whole wall. The new mutations mirror the discipline
`addListItem` / `addTodo` already set: `logEvent` on the success path, `reportError({ severity:
'critical' })` plus a user-facing toast on failure, because a lost rename or a delete that
half-happened is user-visible data loss from a family's point of view.

**Events added**

| Surface       | Level    | Message                       | Context                                            |
| ------------- | -------- | ----------------------------- | -------------------------------------------------- |
| `beanie-wall` | info     | `wall_job_renamed`            | `{ action: 'job_rename', kind: <'list'\|'todo'> }` |
| `beanie-wall` | critical | `wall_job_rename_failed`      | `{ action: 'job_rename', kind }`                   |
| `beanie-wall` | info     | `wall_job_removed`            | `{ action: 'job_remove', kind }`                   |
| `beanie-wall` | critical | `wall_job_remove_failed`      | `{ action: 'job_remove', kind }`                   |
| `beanie-wall` | info     | `wall_job_remove_undone`      | `{ action: 'job_remove_undo', kind }`              |
| `beanie-wall` | critical | `wall_job_remove_undo_failed` | `{ action: 'job_remove_undo', kind }`              |

**Six distinct message strings, deliberately.** Both the `logEvent` rate limiter
(logEvent.ts:86) and the `errorReporter` dedup bucket (errorReporter.ts:146) key on
`(surface, normalizeMessage(message))`, not on surface alone. Collapsing rename and remove into one
message would make them share a single 50-per-minute budget and a single dedup bucket, so a burst of
one would suppress the other. Distinct messages keep their rates independently measurable and
independently rate-limited. `action` and `kind` carry the axes.

**Message strings are literals, not built.** The shared `write()` helper takes its two messages from
a frozen `WRITE_OPS` table where every string appears verbatim in the source. Do **not** write
``message: `wall_job_${op}` ``. A CloudWatch alert is only maintainable if a developer can grep the
exact string and land on the line that emits it. This constraint is why the helper is a lookup, not
an interpolation.

**`action` is the op key, so it is not in the table.** `context: { action: op, kind }`, where `op` is
a member of the `WriteOp` union. `action` is a queryable context enum, not a message, so the
grep-a-literal rule does not apply to it, and duplicating it into the table would create two places
that can disagree.

**Existing messages and severities are unchanged; two junk context values are corrected.** Routing
`toggle`, `addListItem` and `addTodo` through the helper keeps `wall_job_toggled`,
`wall_job_toggle_failed`, `wall_list_item_added`, `wall_list_add_failed`, `wall_todo_added` and
`wall_todo_add_failed` exactly as they are, at the same levels and severities, so every existing
CloudWatch filter and any future alert keeps working. Two context values do change, deliberately:

- `wall_job_toggled` currently emits `action: 'job_toggled'` while its failure partner emits
  `action: 'job_toggle'`. Both become `job_toggle`, so the pair is filterable as one action.
- `wall_list_item_added` and `wall_todo_added` currently emit `kind: 'ok'`, a constant that carries
  no information and collides with the real `kind` dimension. They become `kind: 'list'` and
  `kind: 'todo'`, and the two failure events gain the same `kind` (they carry none today).

Net effect: after this change every wall write event carries the same two dimensions with the same
meaning, on both outcomes. The unit test asserts the **messages and severities** are unchanged and
asserts the **new** context shape; it must not assert byte-identical context, because that is not
what is being shipped.

**No new context keys.** `action` and `kind` are already in `ALLOWED_CONTEXT_KEYS`
(`src/utils/diagnosticContext.ts:61`, entries at lines 68 and 75) and are already declared to Apple
and Google as collected Diagnostics; every value above is a fixed enum string, never user content. So
no allowlist change and no `docs/runbooks/native-store-submission.md` update is required.
**Re-verify this before implementing**; if a new key does prove necessary, the allowlist and all four
store declarations must land in the same change.

**`wall_trip_segment_undated` is deliberately NOT added.** It would have to fire from a computed,
once per undated item, on a screen that re-renders every 20 seconds forever, which is a telemetry
loop rather than a signal. More to the point it has no triage value once this change lands: undated
items are rendered under "still deciding" in the drawer, so a dateless hotel is visible to the family
rather than absent. The UI already tells the truth; the event would only tell us the same thing more
expensively.

**Failure modes and how each is triaged blind**

- _A rename or remove silently no-ops._ The success event never fires and the `*_failed` event does,
  carrying `kind`, so it is immediately visible whether the break is on the list path or the to-do
  path. One control now dispatches to two stores, so this is the failure to instrument hardest.
- _A to-do delete fails._ `deleteTodo` cannot throw out to the caller, so the only signal is the
  `false` branch. `wall_job_remove_failed` with `kind: 'todo'` is that signal, and without it this
  failure would be completely silent.
- _Undo does not restore._ `wall_job_remove_undone` versus `wall_job_remove_undo_failed` gives the
  rate directly.
- _The wall relocks mid-edit._ `wall_relocked` with `kind: 'timeout'` already exists in
  `useWallLock`. A cluster of those interleaved with `wall_job_renamed` is the signature of the
  `noteActivity` binding having regressed.

**Success-path signal for future alerting.** Every mutation emits on success as well as failure, so
failure _rates_ are measurable rather than just failure counts. These are `logEvent` calls, not
`perfTiming`, so the `TELEMETRY_FLOOR_MS = 250` floor does not apply.

**Critical vs firehose.** Rename, remove and undo failures page (`severity: 'critical'`): a family
lost an edit, or a delete is in an unknown state.

## Approach

Four parts. Part 0 is shared plumbing that the other three consume; each of the rest is mostly
deletion plus reuse of something the app already has. Parts 0 to 2 are one sequence; Part 3 is
independent of all of them and can land first or last.

### Part 0 - shared plumbing (do this first)

Three small pieces that stop the rest of the change from duplicating anything. Each is deliberately
narrower than v3 proposed.

**0a. One nullish-safe reader for the existing lock channel; one new key for writers.**

`WallJobRow` is reached through `WallJobList`, which is used by the board, the lanes and the sheet.
Threading `renameJob` / `removeJob` down as props means editing every `WallJobList` call site and
every intermediate component, for callbacks that two of those layers do not use. The wall already
solved this exact problem twice: `WALL_LOCK` and `WALL_BURST` are provided once at `BeanieWallPage`
(lines 106-107) and injected directly by `WallJobRow`. Follow that precedent.

_`src/components/wall/wallLockKey.ts`_ keeps `WallLockContext` and `WALL_LOCK` **exactly as they
are**, and gains one accessor plus a corrected docblock:

```ts
/**
 * The wall's lock channel. Optional at every consumer: a wall component mounted
 * outside the wall (a unit test) renders READ-ONLY rather than throwing.
 * (The old docblock claimed the default throws; no consumer has ever used a
 * throwing default.)
 */
export function useWallLock(): {
  /** The ONE definition of "this wall accepts writes". Three readers. */
  canEdit: ComputedRef<boolean>;
  noteActivity: () => void;
} {
  const lock = inject(WALL_LOCK, undefined);
  return {
    canEdit: computed(() => lock?.isLocked.value === false),
    noteActivity: () => lock?.noteActivity(),
  };
}
```

This deletes the two hand-copied `canAdd` computeds in `WallChoreBoard.vue:61` and
`WallSheet.vue:73`, which are the same expression written twice today, and gives `WallJobRow` and
`WallAddRow` the same rule without a third copy. Nothing changes in `BeanieWallPage.vue`'s
`provide(WALL_LOCK, ...)`.

_`src/components/wall/wallEditKey.ts`_ (new) carries writers and nothing else, in exactly the shape
`wallBurstKey.ts` already uses (a type, a key, no accessor, because there is no derived value to
share):

```ts
export interface WallEditContext {
  addListItem: (listId: string, title: string) => Promise<boolean>;
  addTodo: (title: string) => Promise<boolean>;
  renameJob: (job: WallJob, title: string) => Promise<boolean>;
  removeJob: (job: WallJob) => Promise<boolean>;
}
export const WALL_EDIT: InjectionKey<WallEditContext> = Symbol('wallEdit');
```

- Provided once in `BeanieWallPage.vue`, beside the existing two `provide` calls, straight from
  `useWallJobs()`. It is a projection of the write layer, not a second one.
- Consumers write `const edit = inject(WALL_EDIT, undefined)` and gate their edit controls on
  `canEdit && edit`. Optional by design, same as `WALL_BURST`: a row mounted without the provide
  renders read-only, which is the honest degradation. **No fallback object.** A truthy fallback would
  render the controls and swallow the writes, which is the opposite of degrading to read-only.
- This also removes `addListItem` and `addTodo` from `WallSheet`'s prop list (WallSheet.vue:56-58)
  and from the `<WallSheet>` binding in `BeanieWallPage.vue:800-801`, so the board and the sheet feed
  `WallAddRow` from one channel rather than two.

**0b. `src/components/wall/WallAddRow.vue`** - one add row, three call sites, zero drafts in parents,
zero knowledge of the wall's write layer.

The add row exists twice in `WallSheet.vue` today (once for to-dos at line 535, once per list at line 583) and the board needs a third. Extract it now, and make it own the whole interaction rather than
just the markup, so the parents lose their `draft` / `adding` state as well as their `<form>`:

```
props:  placeholder: string
        submit: (title: string) => Promise<boolean>
```

It owns its draft and its in-flight flag, hides the `+` while the draft is blank and reveals it on
the first keystroke, submits on Enter, clears **only** when `submit` resolves `true`, and holds a
44px touch floor. It calls `useWallLock()` purely for `noteActivity()` on `@input`. It does **not**
inject `WALL_EDIT`: the caller passes `submit`, so the component stays a generic input row that can
be mounted and tested with a stub function and no provides at all.

Because the in-flight guard is per-instance it reproduces the deliberate per-list behaviour that
`WallSheet.vue:91-93` records in a comment (a shared guard once blocked every other list's add)
without anyone having to remember why.

Converting `WallSheet` deletes `draft`, `adding`, `todoDraft`, `addingTodo`, `submitItem`,
`submitTodo` and both `<form>` blocks, roughly 45 lines, and replaces them with two tags.

**0c. `src/composables/useInlineRename.ts`** - the tap-to-rename discipline, extracted from the one
place that already gets it right, and given exactly one Escape path.

`ListItemRow.vue` solves every edge case: a `resolved` guard so Enter / Esc and the unmount-blur
cannot double-commit, `commitIfDirty()` on blur _and_ on `onBeforeUnmount` so closing mid-edit never
loses text, and `@pointerdown.prevent` on the controls so blur-to-save cannot beat a deliberate
cancel. Extract it, and **convert `ListItemRow` to consume it too**. Extracting without converting
would leave two copies of the discipline and make the change a net addition rather than a
consolidation.

```ts
useInlineRename(opts: {
  /** Owned by the caller: a local ref in WallJobRow, `toRef(props,'editing')` in ListItemRow. */
  editing: Ref<boolean>;
  current: () => string;
  /** Called with the raw draft on Enter (ALWAYS), and with a dirty draft on blur / unmount /
   *  the falling edge of `editing`. Never called twice for one edit session. */
  save: (next: string) => void;
  cancel: () => void;
}): { draft: Ref<string>; inputRef: Ref<HTMLInputElement | null>;
      onEnter(): void; onEsc(): void; onBlur(): void }
```

The composable watches `editing`, populates and focuses on the rising edge, resets its `resolved`
guard, and commits on the falling edge, on blur and on unmount.

**The Enter / blur asymmetry is part of the contract and must be preserved exactly.**

- `onEnter` calls `save(draft)` **unconditionally** (matching `ListItemRow.vue:65-69`). Both stores
  no-op an empty or unchanged value, so "clear the field and press Enter" reverts cleanly rather than
  deleting. That behaviour is load-bearing and is asserted by the new characterisation test.
- `onBlur`, the unmount backstop and the falling edge call `save(draft)` **only** when the draft is
  non-blank and differs from `current()` (matching `commitIfDirty`, ListItemRow.vue:59-63).
- `resolved` makes every path idempotent: whichever fires first wins and the rest are no-ops.

`editing` stays caller-owned because `ListItemRow` gets it from its parent's `useInlineEdit`
(`ListDetailModal.vue:68`, `inline.isEditing(...)` at line 462) while `WallJobRow` owns it locally;
that difference is the only reason the two cannot share a component.

**Escape is owned by the composable, and only by the composable.** It registers
`useEscapeClose(editing, onEsc)` internally, so an editing row sits on top of the module-level stack
and one Escape cancels the rename without dismissing whatever it is nested inside. When
`ListItemRow` is converted, **delete its `@keyup.esc` binding** (line 130): with the composable
registered, keeping the input handler as well gives two cancel paths for one keypress. They happen to
be idempotent today thanks to the `resolved` guard, which is precisely the sort of accidental safety
that stops being true after the next edit. Note the one behavioural delta this creates for
`ListItemRow`: Escape now cancels the edit even if focus has moved off the input. There is no
competing modal-level Escape to worry about (`BaseModal` and `BeanieFormModal` have none).

`save` and `cancel` stay plain callbacks (no emits, no store knowledge) so the composable has no
opinion about where the text goes. `ListItemRow` passes `(t) => emit('edit-save', t)` and
`() => emit('edit-cancel')`; `WallJobRow` passes `(t) => edit?.renameJob(job, t)`.

**The missing gate.** `ListItemRow.vue` has no unit test and no E2E coverage today, and it is
consumed by `ListDetailModal.vue`, `LinkedLists.vue` and `ListCycleModal.vue`. Before the conversion,
write `src/components/lists/__tests__/ListItemRow.test.ts` as a characterisation test of the CURRENT
behaviour: Enter emits `edit-save` even when the draft is empty; blur emits only when dirty; Esc
emits `edit-cancel` and suppresses the subsequent blur; unmount-while-dirty emits `edit-save` once;
the read-only and non-editable variants render unchanged. Land that test green against the
unconverted component, then convert, and the same test is the gate.

### Part 1 - the board shows the whole list

`WallChoreBoard.vue`:

- Delete `COLUMN_ROWS` (line 36) and the row-budget loop in `buildColumn()` (lines 75-102). What
  remains is two lines: drop groups whose `jobs` array is empty (the dedupe case the existing comment
  explains), then `jobsProgress` over the flattened jobs. `hidden` and the `shown` / `groups` split
  both disappear; `column.shown` becomes `column.groups`.
- Name the column shape while it is being simplified: `interface BoardColumn { groups: WallListGroup[];
done: number; total: number }`, replacing the two `ReturnType<typeof buildColumn>` spellings (lines
  112 and 146). Two inferred-type references to a function that is being rewritten is a needless hop
  for every future reader.
- Delete the `+N more` button (lines 298-306), and with it the only emitter of `{ kind: 'lists' }`
  (see Part 3 for the matching deletion in `WallSheet`).
- Delete the `+` span on the list title (lines 284-289). The title itself stays a button and keeps
  emitting `{ kind: 'list', listId }`, which is now the board's only route into a list's own sheet.
- Under each group, `<WallAddRow v-if="canEdit && edit" :placeholder="t('wall.list.addItem')"
:submit="(title) => edit.addListItem(group.list.id, title)" />`, inside the existing
  `overflow-y-auto` body.
- Replace the local `canAdd` computed with `useWallLock()`'s `canEdit`.
- Nothing is needed to make the column scroll: the body already has `overflow-y-auto` (line 267) and
  the orphan column already renders uncapped.
- The orphan column gets no add row. An orphan list has no resolvable owner, so "who is this for" has
  no answer at the wall; it stays read-plus-tick, as today.

### Part 2 - editing on the board

**The mutations belong in `useWallJobs.ts`**, which is already the wall's write layer and already
carries the error discipline that `addListItem` established. Components never touch a store.

**No new list-store actions are needed. Every action already exists:**

| Action  | List item                                         | To-do                                          |
| ------- | ------------------------------------------------- | ---------------------------------------------- |
| rename  | `listStore.updateItemText(listId, itemId, title)` | `todoStore.updateTodo(id, { title })`          |
| remove  | `listStore.removeItem(listId, itemId)`            | `todoStore.deleteTodo(id)`                     |
| restore | `listStore.updateList(listId, snapshot)`          | `todoStore.restoreTodo(todo)` (new, see below) |

**One error contract for all six wall writes.**

`useWallJobs.ts` today contains three hand-copied try / catch / `reportError` / `logEvent` blocks
(`toggle` lines 129-167, `addListItem` lines 181-209, `addTodo` lines 220-256). Adding rename, remove
and undo alongside them would make six. Instead, introduce the helper **and route the existing three
through it**:

```ts
type WriteOp =
  'job_toggle' | 'list_add' | 'todo_add' | 'job_rename' | 'job_remove' | 'job_remove_undo';

/** Literal strings only. A CloudWatch filter must be greppable back to this table.
 *  `action` is deliberately absent: it is the key itself. */
const WRITE_OPS: Record<WriteOp, { ok: string; failed: string }> = {
  job_toggle: { ok: 'wall_job_toggled', failed: 'wall_job_toggle_failed' },
  list_add: { ok: 'wall_list_item_added', failed: 'wall_list_add_failed' },
  todo_add: { ok: 'wall_todo_added', failed: 'wall_todo_add_failed' },
  job_rename: { ok: 'wall_job_renamed', failed: 'wall_job_rename_failed' },
  job_remove: { ok: 'wall_job_removed', failed: 'wall_job_remove_failed' },
  job_remove_undo: { ok: 'wall_job_remove_undone', failed: 'wall_job_remove_undo_failed' },
};

async function write(
  op: WriteOp,
  kind: WallJob['source'],
  run: () => Promise<boolean>, // "did the store write"
  onRefused: () => void // the user-facing reporter for this op
): Promise<boolean>;
```

- `run` normalises the two return conventions at the one place that knows them: `!== null` for the
  list actions, `updateTodo` and `createTodo`; the raw boolean for `deleteTodo`. This is the only
  place in the codebase that has to know the difference. Note that `deleteTodo` returns `false` for a
  throw as well as a refusal, so the `false` branch is the whole failure signal on that path.
- On `true`, `write` fires `logEvent({ level: 'info', surface: SURFACE, message: WRITE_OPS[op].ok,
context: { action: op, kind } })` and returns `true`.
- On `false` or a throw, it calls `onRefused()` (the user toast plus console guidance) **and**
  `reportError({ surface: SURFACE, message: WRITE_OPS[op].failed, severity: 'critical',
context: { action: op, kind }, error? })`, then returns `false`.
- Nothing else in the file needs a try / catch. Six call sites, one contract.
- **Structural acceptance criterion**, not a line count: after this change `useWallJobs.ts` contains
  exactly one `try` / `catch` for store writes, exactly one `logEvent` call and exactly one
  `reportError` call. Adding a seventh operation later is one `write()` call.

**Undo: snapshot the list, via a pure function.**

`listStore.addItem` mints a fresh UUID, drops the item's `completed` / `completedBy` /
`completedAt` triple and appends to the bottom, so it is the wrong primitive for undo. The right one
is already in the codebase: `toggleItem`'s celebration undo captures the whole `items` array and
writes it back through `updateList`. `removeJob` does the same, and **must capture the completion
fields too**.

That rule is the highest-consequence, lowest-visibility line in the whole change, so it does not live
inline in a composable. It becomes a pure function in `src/utils/wallJobs.ts`, the module that already
owns the wall's pure rules and already has `src/utils/__tests__/wallJobs.test.ts`:

```ts
/**
 * What `updateList` must be given to put a removed item back EXACTLY as it was.
 *
 * `items` alone is not enough: `removeItem` runs `deriveCompletion`, so removing
 * the last open item on a one-off list FILES it, and `useWallPeripherals` filters
 * filed lists out via `isFiled`. Restoring `items` on its own would leave the list
 * filed, so an undo would make the whole list disappear from the wall.
 *
 * All five fields, unconditionally. `automergeRepository.update` deletes keys set
 * to `undefined` and ignores absent ones, and `deriveCompletion` never touches
 * `cycleCelebrated` on a one-off list, so restoring a one-off's own prior value is
 * a guaranteed no-op. One branch fewer is one thing fewer to get wrong.
 */
export function captureListRestore(list: FamilyList): UpdateFamilyListInput {
  return {
    items: list.items,
    completed: list.completed,
    completedBy: list.completedBy,
    completedAt: list.completedAt,
    cycleCelebrated: list.cycleCelebrated,
  };
}
```

Undo is then `listStore.updateList(listId, snapshot)`; ids, order, completion and filing all survive.
Testing it needs no Pinia, no mocks and no component.

**To-dos get a real restore too, with their original id.**

`createAutomergeRepository` already returns `createWithId` (automergeRepository.ts:76), and
`familyMemberRepository.createFamilyMemberWithId` (line 58) is the exported precedent for the "must
keep its id across a rebuild" case. So:

- `todoRepository.ts`: `export const createTodoWithId = repo.createWithId;` (one line, beside the
  existing `createTodo` / `updateTodo` / `deleteTodo` exports).
- `todoStore.ts`: `restoreTodo(todo: TodoItem): Promise<TodoItem | null>` - a `wrapAsync` action in
  the same shape as `createTodo`, calling `createTodoWithId(todo.id, rest)` where `rest` is the
  captured entity minus `id` / `createdAt` / `updatedAt`. Since `CreateTodoInput` is exactly that
  `Omit`, `completedAt`, `someday`, `dueTime`, `description` and the hint markers all round-trip.
- **Two deliberate differences from `createTodo`**, both of which must be in the code and in its
  docblock:
  1. No `trackFeature(...)`. A restore is not a new feature use; counting it would inflate the
     to-do adoption metric by one per undo.
  2. An idempotence guard: if `todos.value.some(t => t.id === todo.id)` it returns that existing
     to-do without writing. `createWithId` is a `set` that re-stamps `createdAt`, so a double-invoke
     would otherwise rewrite it. `invokeToastAction` dismisses before invoking, so this should be
     unreachable; it costs one line and makes it unreachable by construction rather than by timing.

`removeJob` therefore captures the whole `TodoItem` from `todoStore.todos` **before** the delete, and
undo restores it verbatim. The only fields not preserved are `createdAt` / `updatedAt`, which the
repository stamps.

**The undo toast** uses `showToast`, which already supports everything needed:
`showToast('info', title, undefined, { actionLabel, actionFn, durationMs: 6000 })` (useToast.ts:9-21,
92). Free behaviours that matter here: toasts carrying an `actionFn` are exempt from dedupe (line
106), so two quick deletes each keep their own Undo closure; and `invokeToastAction` dismisses first
then awaits, re-surfacing a throw as an error toast (lines 190-215). `ToastContainer` is mounted in
`App.vue` **outside** `v-if="showLayout"`, so it renders on the wall's chrome-less route, and
`useWallOrientation` applies no CSS transform, so the fixed stack lands correctly. Precedents to
mirror: `useGiveDose.ts` and `useContributeToGoal.ts`, both `durationMs: 6000`.

`MAX_VISIBLE = 5` (useToast.ts:73) evicts the oldest non-error toast, so a burst of six deletes can
drop an Undo. Acceptable: the removal is already committed and logged, so it is diagnosable, and six
deletes in six seconds is not a real wall interaction.

**Nothing fails silently: `reportJobEditFailed` in `src/utils/actionFailure.ts`, and one shared body
for the four wall reporters.**

`actionFailure.ts` already holds three wall reporters (`reportJobToggleFailed` line 54,
`reportListAddFailed` line 84, `reportTodoAddFailed` line 105). All three are the same two statements
with different nouns: a `console.error` naming a cause plus a fix, then a `silent: true` error toast
on `surface: 'beanie-wall'` (silent because the caller fires its own critical `reportError`, and
double-reporting split the failure rate across two buckets). A fourth near-copy would state the
pattern four times and name it never. The load-bearing part is the
`{ surface: 'beanie-wall', silent: true }` pairing, which is exactly the thing that must not drift.
So:

```ts
/** One body for every "the wall's store refused" report: a developer line with a
 *  cause AND a fix, plus a silent user toast (the caller owns the critical report). */
function reportWallFailure(
  consoleLine: string,
  titleKey: UIStringKey,
  messageKey: UIStringKey
): void;
```

The three existing exports become one-line calls into it, keeping their names, their console text and
their toast keys **exactly as they are today** (this is a de-duplication, not a copy change), and the
new one joins them:

```ts
export function reportJobEditFailed(
  op: 'rename' | 'remove' | 'undo',
  source: 'todo' | 'list',
  id: string
): void;
```

- Console: `[beanie-wall] could not <op> the <source> "<id>". Either the record is gone (deleted on
another device since this screen last synced) or the write failed and wrapAsync already reported
it. Check for a preceding store-write error on this surface before assuming a missing record.`
  Same two-hypothesis discipline `reportJobToggleFailed`'s comment argues for; naming only one cause
  sends a triager chasing a phantom.
- Toast: rename reuses the existing `wall.jobFailed.title` / `.message` verbatim ("That didn't save"
  / "It may have been changed on another device...") because that copy is already exactly right for a
  failed rename. Remove and undo take the two new key pairs in the i18n table below.
- One function with a three-value discriminator, not three functions: the three cases differ only in
  a verb, and the discriminator is already carried in telemetry as `action`.

**`WallJobRow.vue` gains the row controls,** and its root element has to change to carry them.

Today the whole row is one `<button>` (line 122). An `<input>` or a trash `<button>` cannot be nested
inside a `<button>`: it is invalid HTML and the inner control's click and focus behaviour is not
reliable across engines. The row becomes:

```
<div class="wall-job-row flex w-full items-center gap-3 py-2">
  <button  <!-- THE TICK: 44px box, :disabled="pending", :aria-pressed="isDone",
                wrapping the wall-tick span byte-identically -->
  <input v-if="renaming" ...>          <!-- else -->
  <button  <!-- THE TITLE: flex-1, :disabled="pending", @click="onTitleTap".
                WRAPS the ownerLabel pill, the doneAt stamp and the listEmoji
                spans, so a locked tap anywhere on the row still ticks. -->
  <ActionButtons v-if="canEdit && edit && !renaming" size="xl" :show-edit="false" @delete="onRemove" />
</div>
```

- `function onTitleTap() { canEdit.value ? startRename() : onTick(); }`. **Locked, behaviour is
  byte-for-byte today's**: tapping anywhere on the row (tick, title, owner pill, done stamp or list
  emoji) ticks. Unlocked, the title area becomes the rename target, which is the feature.
- Requirement 6 is met precisely: the `wall-tick` span keeps its classes, its `ref="tickEl"` (the
  burst reads its bounding box), its position as first child, its `POP_MS` spring and its
  `optimistic` / `celebrating` refs. Its hit area becomes a dedicated 44px box inside the row's
  existing 48px height, so it grows and never shrinks, and nothing reflows. `aria-pressed` moves onto
  the tick button, which is more correct than having it on the whole row.
- `job.key` is untouched, so `WallJobList`'s FLIP move is unaffected, and the row still has exactly
  one root element, which `<TransitionGroup>` requires.
- The row uses `useWallLock()` for `canEdit` / `noteActivity`, keeps `inject(WALL_BURST, undefined)`,
  and adds `inject(WALL_EDIT, undefined)`.
- Both new controls call `noteActivity()` before any await, and the rename input calls it on
  `@input`.
- `pending` continues to disable the tick and the title-tap-to-tick path. It also suppresses
  `startRename`: a row mid-write is not a row to start editing.
- The row's own added logic is three things (a `renaming` ref, `onTitleTap`, `onRemove`) plus the
  composable. Everything else it needs is injected or already there. If it grows past that, the
  extra belongs in `useWallJobs`, not here.

**The trash uses `ActionButtons.vue`, extended additively.**

- Widen the `size` prop union to `'sm' | 'md' | 'lg' | 'xl'` and add
  `xl: { btn: 'flex h-11 w-11 items-center justify-center', glyph: 'sm' }` to `SIZES` (line 42).
  44px box, same 16px glyph, no new component, no new branch: `SIZES` is already a lookup table.
- **Add the missing dark partners, and change nothing in light mode.** `BASE` keeps `text-gray-400`
  and gains `dark:text-ink-faint`; the danger tone keeps `hover:text-red-600` and gains
  `dark:hover:text-danger-lift`. This closes the CIG defect (an accent used as a meaningful icon with
  no lift, on a component that had no dark answer at all) without shifting a single pixel on the
  three existing call sites in light mode. It needs no separate commit and no light-mode
  re-verification; a dark-mode look at Accounts, Transactions and the Beanie List tiles is enough.
- The glyph is the `trash` entry in the `src/constants/icons.ts` registry (line 80) rendered by
  `BeanieIcon`. Do **not** use the trash emoji; the SVG registry is canonical.

**Escape: fix the sheet, do not work around it.**

`WallSheet` hand-rolls `window.addEventListener('keydown', ...)` (lines 116-119). That listener sits
outside `useEscapeClose`'s module-level stack, so it fires for every Escape regardless of what is
focused, and `@keyup.esc` on the rename input does not stop it (keyup and keydown are different
events). Replace the hand-rolled listener with `useEscapeClose(alwaysOpen, () => emit('close'))`,
where `alwaysOpen` is a `ref(true)`: the sheet is `v-if`'d by its parent
(`BeanieWallPage.vue:791-792`), so being mounted IS being open, and `useEscapeClose` watches with
`{ immediate: true }` so it registers on mount and unregisters via `onScopeDispose`.
`useInlineRename` then registers its own token while editing, lands on top of the stack, and one
Escape cancels the rename and leaves the sheet open; a second closes the sheet. This deletes six
lines of hand-rolled listener, fixes the layering for every future stacked control on the wall, and
needs no `.stop` modifiers. `__resetEscapeCloseForTests()` (useEscapeClose.ts:95) exists for the
`beforeEach` in the new tests.

After this change there are **no hand-rolled Escape listeners left on the wall**. That is the
guardrail, and it is worth grepping for before calling Part 2 done.

**Whole-list deletion stays off the wall** (requirement 7). Removing a list takes its history with it
and affects every screen. That belongs on the lists page.

### Part 3 - the trip drawer shows the whole trip

Independent of Parts 0 to 2. It touches `useWallPeripherals`, `WallPeripheralCards`, one branch of
`WallSheet`, `SegmentWhenBand` and `types/wall.ts`, and none of the edit plumbing.

**The merge / sort / group already exists and is in production.** `useVacationTimeline(vacation:
ComputedRef<FamilyVacation | undefined>, today: Ref<string>)` (useVacationTimeline.ts:517) returns
`{ timelineItems, groupedByDate, accommodationGaps, undatedItems }` (line 703). It merges all three
entity types, sorts by `sortDate` then `sortTime` with untimed last, groups into
`DateGroup { date, label, items }` where `label` is `formatNookDate(date)`, splits dateless items out
via the `'9999-12-31'` sentinel, and attaches the `WhenBand` plus past / now / future phase per item.
`TimelineItem` already carries `icon`, `title`, `keyValue`, `status`, `travellers` and `timing.band`.

`useWallPeripherals.ts` is the **only** place in the app that hand-rolls a leg list. It goes.

- Delete `WallTripLeg` (line 40) and `WallTrip.legs` (line 63). Verified by grep: the only two
  consumers are `WallSheet.vue:747` and `WallPeripheralCards.vue:422`, both rewritten here.
- Add a `tripVacation` computed (the raw `FamilyVacation | undefined` it already resolves from
  `vacationStore.upcomingVacations[0]` at line 107) and return it. Feed it straight into
  `useVacationTimeline(tripVacation, today)` and expose `{ timelineItems, groupedByDate,
accommodationGaps, undatedItems }` alongside `trip`.
- Exposing `tripVacation` also lets `WallSheet` drop its
  `vacationStore.vacations.find(v => v.id === summary.id)` re-lookup (line 167), which is both a
  second source of truth and a real (if rare) failure mode: when that find misses, the whole trip
  body renders empty with nothing logged.
- `tripDetail.gaps` then reads `accommodationGaps.length` from the composable instead of calling
  `computeAccommodationGaps` a second time. `bookingProgress(tripVacation)` stays.
- Consume `item.icon`. Do not re-map types; the four icon maps and their fallback order are already
  resolved inside the composable.
- `useToday()` is already imported in `useWallPeripherals` (line 19, used at line 72), so the
  reactive `today` costs nothing.
- Note the honest cost: `WallPeripheralCards` and `WallSheet` each call `useWallPeripherals()`, so
  there will be two independent timeline computed chains while both are mounted. Both are lazy and
  cached against `(vacation, today)`, and a trip holds tens of segments, so this is not worth a
  module-level singleton, which would need its own Pinia-lifecycle handling and would break test
  isolation. See the rejected-options register.

**`src/components/wall/WallTripTimeline.vue` (new) holds the spine.**

This is the one structural addition in Part 3. `WallSheet.vue` is 822 lines with six content branches
in a single template; inlining a day-grouped spine in place of the 25-line leg loop would take it
past 900. A file that long stops being read, and the trip body is the branch least coupled to the
rest of the sheet: it needs no `target`, no `visibleMemberIds`, no `listsFor`, no `isPending` and
emits nothing.

```
props: groups: DateGroup[]          // groupedByDate
       undated: TimelineItem[]      // undatedItems
```

It renders a day chip on a rail per `DateGroup`, then one row per `TimelineItem` (`item.icon` in a
node, `item.title`, `item.keyValue`, the existing "not booked" pill for `status === 'pending'`, and
`SegmentWhenBand` for `item.timing?.band`). `undated` renders below under `vacation.stillDeciding`,
otherwise a dateless hotel would be invisible.

Three things this buys, all of them maintenance rather than feature:

1. `WallSheet`'s trip branch collapses to a header block (countdown, booked pill, gaps pill,
   travellers) plus one tag. The sheet becomes a router of branches again.
2. The spine can be read and reasoned about without opening an 822-line file.
3. It is the obvious place to converge with `TravelPlansPage`'s inline spine later, without that
   being in this change's blast radius.

It gets **no unit test of its own**: it is a `v-for` over two arrays plus one `v-if`, and the merge /
sort / group / when-band logic it displays is already covered by `useVacationTimeline.band.test.ts`
and `useVacationTimeline.terminal.test.ts`. A mount test here would assert Vue, not this change.

The `accommodationGaps` **count** stays as the existing header pill on the sheet; the wall does not
interleave gap rows the way `TravelPlansPage` does. `SegmentWhenBand` is already imported by the
sheet (line 18) and moves with the spine.

**The trip CARD (`WallPeripheralCards.vue`) is rewritten to read timeline items.** It renders
`timelineItems.filter(i => i.kind === 'travel').slice(0, 2)`, reading `item.title` (which
`buildTravelSegmentTitle` already produces as `"SIN → HND"`, utils/vacation.ts:886), `item.keyValue`
and `item.timing?.band.start.time`. The title keeps the card's existing `font-outfit` bold treatment
so the glance value is preserved. Two consequences to accept knowingly: the airport codes are no
longer _separately_ bolded from the arrow, and the arrow loses its `--sky-silk` tint, because the
arrow now lives inside a plain string. That is the cost of not keeping a parallel leg model alive for
one card; requirement 8 is about the DRAWER, and filtering to travel means the card a family already
recognises does not silently start leading with a hotel. It is user-visible, so it belongs in
`CHANGELOG.md` under `Changed`, not buried.

**Why the wall draws its own spine rather than importing the travel page's.** The travel page's day
header and rail is not a component: it is roughly 125 lines inline in `TravelPlansPage.vue`, built
around `TimelineSegmentCard`, which carries attachments, detail rows, traveller chips and edit
affordances. Dragging that onto a locked wall read from two metres away would import edit UI the wall
deliberately does not have. The expensive, correctness-critical half (merge, sort, group, when-band)
**is** shared via the composable; the presentation legitimately differs, which is the same reason the
wall has its own `wall-*` rem scale. Extracting the travel page's spine into a shared component is a
reasonable follow-up, not part of this blast radius.

**Also delete, in the same branch:** `.wall-leg` (applied on the leg wrapper at WallSheet.vue:747,
with no matching CSS rule anywhere in `src/` or `packages/`, confirmed by grep) and `text-[#00b4d8]`
on the leg arrow (line 751; no dark partner, and it disappears with the rewrite).

**Delete the `{ kind: 'lists' }` sheet variant.** Part 1 removes its only emitter. Remove the union
member from `WallSheetTarget` (`src/types/wall.ts:114`), the `case 'lists'` from `sheetTitle`, and
the `|| target.kind === 'lists'` arm (line 554); `sheetLists` collapses to the single-list filter it
already contains. Grep of `src` and `e2e` found no other reference, but re-run it before deleting.

**i18n: nothing new is needed for the trip.** Band captions resolve via `WhenCell.captionKey`,
`wall.trip.unbookedLeg` already says "Not booked" (uiStrings.ts:6277), `vacation.stillDeciding`
already exists (line 8966), and day labels come from `formatNookDate` on `DateGroup.label`.

### Dark mode and CIG compliance (requirements 9 and 10)

Fix what this change renders; leave `TravelPlansPage`'s hard-coded hexes alone as out of scope.

- **`SegmentWhenBand.vue` `.when-cap`** is `#0077b6` (line 78), named in the CIG (slide 9) and the
  theme as one of three blues that shipped **under the AA floor at 3.46**. The component ships an
  `html.dark` override (line 119) but only for the cell and arrow backgrounds, not this caption. Add
  `html.dark .when-cap { color: var(--color-teal-lift); }`. That token exists for exactly this: its
  declaration comment in `packages/brand/theme.css:146-149` names `#0077B6` as one of the two hexes
  it was added to replace, and it measures 8.98 / 7.78. Do **not** invent a one-off hex and do **not**
  use `silk-lift`, which is the Sky Silk family. Use a plain `html.dark` rule, never
  `:global(.dark)`.
- Reuse the wall's **existing** "not booked" pill styling verbatim
  (`bg-[var(--vacation-gold-tint,...)]` + `text-amber-700` + `dark:text-terracotta-lift`, as at
  WallSheet.vue:763). It is already correct in both modes and already appears twice in `WallSheet`;
  it moves into `WallTripTimeline` with the rows and is then written once, not three times.
- `--vacation-teal` and `--vacation-gold` are declared in both the light (`src/style.css:124-128`)
  and dark (lines 170-174) blocks with **identical** base hexes; only their tints differ. `#00B4D8`
  measures 6.83 / 5.92 and clears AA on its own, so it is fine for the day chip and the rail, but do
  not treat it as a lifted partner and do not use it for small caption text.
- New surfaces: rail and node borders take `--vacation-teal-15`; the day chip takes
  `--vacation-teal`; the add row's box reuses the existing add-input classes lifted into `WallAddRow`
  (`dark:border-line-strong dark:bg-surface-ground` over `border-[rgba(44,62,80,0.15)] bg-white`,
  WallSheet.vue:541), which are already correct in both modes; the trash glyph takes
  `text-gray-400 dark:text-ink-faint` at rest and `hover:text-red-600 dark:hover:text-danger-lift`
  on hover / focus (fixed once, in `ActionButtons`).
- No opacity modifier on any readable string.
- Sizes stay rem-based on the `wall-*` scale (Large reading mode depends on it); no `text-[Xpx]`, no
  custom `text-[X.Xrem]`, no `font-size: Xpx` in a scoped block.

## Explicitly considered and rejected

Recorded so the next reviewer does not re-open them. Each was weighed on maintenance cost, not on
purity.

1. **A module-level singleton for `useVacationTimeline` on the wall.** Would save one lazy, cached
   computed chain while two components are mounted. Costs a hand-rolled Pinia lifecycle and breaks
   unit-test isolation (the classic "test 2 sees test 1's trip"). Two instances of a cached computed
   over tens of segments is not a problem; a leaking module singleton is.
2. **A `WallListGroupBlock.vue` for the board's two near-identical group loops** (member column and
   orphan column). Tempting, but they differ in three ways (heading is a button vs a paragraph, the
   repeats pill, and only one gets an add row), so the component would arrive with two boolean flags
   on day one. The add row lands in only one of the two loops, so the extraction would not remove any
   of the duplication this change introduces. Revisit if the sheet's list card becomes a third
   caller.
3. **Making `ActionButtons` data-driven** (an `actions` array plus a dispatcher and a tone map). Its
   own docblock already argues against this at three call sites; adding a fourth does not change the
   arithmetic. `v-if` on three booleans keeps "who emits `delete`?" answerable by grep.
4. **Adding `canEdit` to `WallLockContext`** (what v2 and v3 proposed). Every consumer still needs a
   nullish-safe unwrap, so the member removes the definition from one place and the duplication from
   none. `useWallLock()` in the same file removes both, changes no interface and touches no
   `provide`.
5. **A fallback object for `WALL_EDIT`** (what v3 proposed: four stubs that `console.error` and
   resolve `false`). It is unreachable, because the controls are gated on `canEdit`, which is already
   false without the lock provide; and if it were reachable it would render editable controls that
   eat writes, which is the opposite of degrading to read-only. `inject(WALL_EDIT, undefined)` plus
   `v-if="canEdit && edit"` is smaller and more honest.
6. **Re-toning `ActionButtons` in light mode** (what v3 proposed). It would be a real visual change
   on Accounts, Transactions and the Beanie List tiles, needing its own commit, its own assumption
   and its own two-mode verification pass, in service of a feature that is about the wall. Adding
   the two `dark:` partners fixes the defect the CIG actually names and leaves light mode alone.
7. **`WallAddRow` injecting `WALL_EDIT` and choosing its own writer from a `kind` prop.** Would let
   the call sites drop the `:submit` binding, at the cost of putting a second dispatch table (kind to
   writer) next to the one in `useWallJobs`. The `submit` prop keeps the component generic and
   testable with a stub and no provides at all.
8. **A `useWallEditing.ts` file separate from `wallEditKey.ts`.** The key and its type belong
   together, exactly as `wallLockKey.ts` and `wallBurstKey.ts` already do.
9. **Splitting `useWallJobs.ts` into read and write composables.** It is already documented as a
   deliberate query/command split _within_ one file. Splitting would give two composables that must
   be instantiated together and kept in sync at the page.
10. **A confirm dialog before remove.** Rejected by greg in favour of undo, and the wall has never
    opened a modal. Undo is also the cheaper failure mode: a mis-tap costs six seconds of attention
    rather than a dialog on every single delete.
11. **Sharing `TravelPlansPage`'s day rail now.** Roughly 125 lines inline, built around an editable
    card. Extracting it is a separate change with its own blast radius; `WallTripTimeline.vue` is the
    placeholder that makes it possible later.
12. **Soft-delete for to-dos instead of restore-with-id.** Would touch the entity shape, every to-do
    query and the sync surface, to serve one undo button. `createWithId` already exists for exactly
    this case and one repository already exports it.
13. **Keeping `WallTrip.legs` alive for the trip card.** Would preserve the card's bolded airport
    codes and tinted arrow at the cost of two parallel models of a trip on one screen, one of which
    exists to serve two lines of decoration on a summary card. The card's needs are a strict subset
    of `TimelineItem`.
14. **Requiring `useWallJobs.ts` to end with fewer lines** (what v3 demanded). Arithmetically
    impossible once rename, remove, the snapshot and the undo toast are in, so it would be met by
    contorting the code or quietly dropped. The structural criterion (no new `try` / `catch`, no new
    telemetry site) measures the same thing and cannot be gamed.
15. **Extracting `useInlineRename` without converting `ListItemRow`.** Leaves two copies of a subtle
    discipline, which `CLAUDE.md` forbids explicitly. The right answer to "the component has no
    tests" is to write the characterisation test, not to duplicate the code.

## Files Affected

**Modified**

- `src/components/wall/WallChoreBoard.vue` - cap, `+N more` and the title `+` deleted; `WallAddRow`
  wired in per list; local `canAdd` replaced by `useWallLock().canEdit`; `BoardColumn` named
- `src/components/wall/WallJobRow.vue` - root restructured from `<button>` to a row wrapper (tick
  button + title button wrapping the trailing spans + trash); inline rename and trash, unlocked only;
  tick preserved exactly
- `src/components/wall/WallSheet.vue` - **must shrink**: both add rows replaced by `WallAddRow`
  (drafts and submit handlers deleted); trip body replaced by `<WallTripTimeline>`; hand-rolled
  Escape listener replaced by `useEscapeClose`; `{ kind: 'lists' }` arm and the `vacationStore`
  re-lookup removed; dead `.wall-leg` and the un-partnered arrow colour removed; local `canAdd`
  replaced by `useWallLock().canEdit`; `addListItem` / `addTodo` props removed
- `src/components/wall/WallPeripheralCards.vue` - trip card reads travel-kind timeline items instead
  of `trip.legs`
- `src/components/wall/wallLockKey.ts` - `useWallLock()` accessor added; stale "default throws"
  docblock corrected. `WallLockContext` and `WALL_LOCK` unchanged
- `src/composables/useWallPeripherals.ts` - `WallTripLeg` and `WallTrip.legs` deleted; `tripVacation`
  exposed; `useVacationTimeline` wired in
- `src/composables/useWallJobs.ts` - one `write()` helper plus a frozen `WRITE_OPS` table owns the
  error contract for all six operations; `renameJob` / `removeJob` with undo added; the three
  existing hand-copied try/catch blocks deleted
- `src/utils/wallJobs.ts` - `captureListRestore(list)` added (pure, unconditional)
- `src/components/lists/ListItemRow.vue` - converted to `useInlineRename`; `@keyup.esc` removed (the
  composable owns Escape). The extraction's second consumer, so the change is a consolidation
- `src/components/ui/ActionButtons.vue` - `size` union widened with `xl` (44px); `dark:text-ink-faint`
  and `dark:hover:text-danger-lift` added. Light mode untouched
- `src/utils/actionFailure.ts` - private `reportWallFailure` body; the three existing wall reporters
  become one-line calls with unchanged text; `reportJobEditFailed(op, source, id)` added
- `src/stores/todoStore.ts` - `restoreTodo(todo)` (no `trackFeature`, idempotent on an existing id)
- `src/services/automerge/repositories/todoRepository.ts` - export `createTodoWithId`
- `src/components/travel/SegmentWhenBand.vue` - `html.dark .when-cap` partner
- `src/types/wall.ts` - `{ kind: 'lists' }` removed from `WallSheetTarget`
- `src/pages/BeanieWallPage.vue` - `provide(WALL_EDIT, ...)` added; `add-list-item` / `add-todo`
  bindings removed from `<WallSheet>`
- `src/services/translation/uiStrings.ts` - new wall keys (`en` + `beanie`)
- `src/services/translation/uiStrings.test.ts` - new destructive key prefixes added to
  `IMPORTANT_PREFIXES`
- `src/components/wall/__tests__/WallChoreBoard.test.ts` - uncapped column and unlocked state
- `src/utils/__tests__/wallJobs.test.ts` - `captureListRestore` cases
- `CHANGELOG.md` - includes the trip-card styling change, which is user-visible
- `docs/prompts/2026-09/2026-09-10-wall-full-lists-and-trip-timeline.md` - prompt archive entry per
  `CLAUDE.md`

**Created**

- `src/components/wall/wallEditKey.ts` (type + key only, no accessor, matching `wallBurstKey.ts`)
- `src/components/wall/WallAddRow.vue`
- `src/components/wall/WallTripTimeline.vue`
- `src/composables/useInlineRename.ts`
- `src/composables/__tests__/useWallJobs.test.ts` (currently zero coverage)
- `src/components/wall/__tests__/WallJobRow.test.ts`
- `src/components/wall/__tests__/WallAddRow.test.ts`
- `src/components/lists/__tests__/ListItemRow.test.ts` (the characterisation gate that does not exist
  today; written and green BEFORE the `useInlineRename` conversion)
- `docs/plans/2026-09-10-wall-full-lists-and-trip-timeline.md` (this plan, saved before work starts)

**Deleted (no replacement)**

- `COLUMN_ROWS`, `column.hidden`, the board's more-button, the board's title `+`
- `WallTripLeg`, `WallTrip.legs`, `vacation.travelSegments.slice(0, 3)`
- `{ kind: 'lists' }` and its sheet arm
- `WallSheet`'s hand-rolled `keydown` listener, `draft`, `adding`, `todoDraft`, `addingTodo`,
  `submitItem`, `submitTodo`, and its `vacationStore` re-lookup
- the two hand-copied `canAdd` computeds
- `.wall-leg`, `text-[#00b4d8]`

**Already created (approved input, not to be regenerated)**

- `docs/mockups/2026-09-10-wall-add-row-and-trip-timeline.html`

## i18n - new keys

Every entry needs `en` + `beanie`. Remove, undo and their failure copy are **destructive / error
surfaces**, so per the beanie-mode floor in `CLAUDE.md` the `beanie` value keeps the real noun and
only drops case; never "bean" for the item.

| Key                         | en                                                                       | beanie                    |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------- |
| `wall.job.rename`           | `Rename`                                                                 | `rename`                  |
| `wall.job.remove`           | `Remove`                                                                 | `remove`                  |
| `wall.job.removed`          | `Removed "{title}"`                                                      | `removed "{title}"`       |
| `wall.job.undo`             | `Undo`                                                                   | `undo`                    |
| `wall.removeFailed.title`   | `That didn't get removed`                                                | `that didn't get removed` |
| `wall.removeFailed.message` | `It may have been changed on another device. Try again in a moment.`     | (same, lowercased)        |
| `wall.undoFailed.title`     | `That didn't come back`                                                  | `that didn't come back`   |
| `wall.undoFailed.message`   | `We couldn't put that back. It may have been changed on another device.` | (same, lowercased)        |

**Reused, no new key:** `wall.jobFailed.title` / `.message` for a failed rename (the existing copy,
"That didn't save" / "It may have been changed on another device...", is already exactly right);
`wall.list.addItem` and `wall.todo.add` as the two `WallAddRow` placeholders; `vacation.stillDeciding`
for the undated section; `wall.trip.unbookedLeg` for the pill; `wall.card.more` on the jobs/to-dos
summary card (untouched by this change).

**No rename placeholder key.** The rename input is pre-filled with the current title, so a
placeholder is only ever visible in the moment the user clears the field. `:aria-label="t('wall.job.rename')"`
carries the accessible name.

Add `wall.job.remove`, `wall.job.removed`, `wall.job.undo`, `wall.removeFailed.` and
`wall.undoFailed.` to `IMPORTANT_PREFIXES` in `uiStrings.test.ts`. Specific keys and prefixes, not a
blanket `wall.`, which would wrongly police the playful chore copy on the same screen. Note that
`KEY_SUFFIXES` only matches keys _ending_ in `Failed` / `Error`, so `wall.removeFailed.title` and
`.message` are not covered automatically.

`fillTemplate(t('wall.job.removed'), { title })` supplies the toast title;
`t()` takes only a key, so the interpolation must go through `fillTemplate`.

## Sequencing and reversibility

Five commits, each one green (`npm run lint`, `npm run type-check`, unit suite) before the next
starts. The point is that a defect found in week three can be reverted to a known-good state without
unpicking anything else.

| #   | Commit                                                                                                                                                                                                               | Depends on                          | Revertible alone? |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------- |
| 1   | `useWallJobs` write-contract consolidation + `captureListRestore` (pure) + the `useWallJobs` regression test. No behaviour change; messages and severities unchanged, two context values corrected.                  | -                                   | yes               |
| 2   | Part 0 plumbing: `useWallLock()`, `wallEditKey.ts`, `WallAddRow.vue`; `ListItemRow.test.ts` (characterisation), then `useInlineRename.ts` + the `ListItemRow` conversion; `ActionButtons` `xl` size + dark partners. | 1                                   | yes               |
| 3   | Part 1: board uncapped, `+N more` and title `+` deleted, `WallAddRow` wired in.                                                                                                                                      | 2                                   | yes               |
| 4   | Part 2: `WallJobRow` restructure, rename / remove / undo, sheet Escape fix, `restoreTodo`.                                                                                                                           | 1, 2                                | yes               |
| 5   | Part 3: trip timeline, `WallTripTimeline.vue`, `{ kind: 'lists' }` deletion, `.when-cap` fix.                                                                                                                        | 3 (for the dead-code deletion only) | yes               |

Commit 1 is deliberately first and behaviour-free: it is the riskiest refactor in the change (it
touches every existing wall write path) and it is far easier to prove correct on its own than
tangled with new features. Within commit 2, `ListItemRow.test.ts` must be written and green against
the **unconverted** component before `useInlineRename` lands, or the gate proves nothing. Commit 5 is
independent of 2 to 4 apart from the `{ kind: 'lists' }` deletion, which can be split off if the trip
work needs to land earlier.

(v3 had a sixth commit isolating an `ActionButtons` light-mode tone change. That change is withdrawn,
so the commit is gone.)

## Acceptance Criteria

**Behaviour**

- [ ] A member with more items than fit shows **all** of them; the column scrolls; no `+N more` on
      the board
- [ ] Locked: the board looks and behaves exactly as it does today; no add row, no trash, no rename,
      and tapping anywhere on a row (tick, title, owner pill, done stamp, list emoji) still ticks it
- [ ] Unlocked: every list shows an add row; the `+` is hidden until the box has text; Enter submits;
      the box clears only on a successful write
- [ ] Unlocked: tapping a job's title renames it in place; Enter commits (even when the field was
      cleared, which reverts), Esc cancels **without closing the sheet**, blur commits only a dirty
      draft, closing mid-edit does not lose the text
- [ ] Unlocked: the trash removes the row immediately and a toast offers Undo for 6s
- [ ] Undo restores a **list item** with its original id, position and completion state, **and the
      list is not left filed** when the removed item was the last open one
- [ ] Undo restores a **to-do** with its original id and every field bar `createdAt` / `updatedAt`,
      and does not increment the to-do feature-usage metric
- [ ] The tick is unchanged in size, position and behaviour in every state, its hit area is never
      smaller than today's, the row's height is unchanged, and the reorder animation still runs
- [ ] A rename typed slowly over two minutes does not relock the wall; an idle unlocked wall still
      relocks after two minutes
- [ ] Deleting a whole list is not reachable from the wall
- [ ] A trip with 4 flights, 2 stays and 1 car shows all 7 in the drawer, in date order, grouped by
      day, and the drawer scrolls
- [ ] Dateless segments appear under "still deciding" rather than vanishing
- [ ] The trip card still renders two travel rows and did not break on the `legs` removal
- [ ] The lists drawer's inline item edit behaves exactly as it did before the `useInlineRename`
      conversion (the characterisation test is the gate)

**Structure (requirement 12)**

- [ ] `useWallJobs.ts` contains exactly one `try` / `catch` for store writes, exactly one `logEvent`
      call and exactly one `reportError` call, while carrying three more operations than before
- [ ] `WallSheet.vue` has **fewer lines** than before the change
- [ ] `grep -rn "addEventListener('keydown'" src/components/wall src/pages/BeanieWallPage.vue`
      returns nothing
- [ ] Exactly one definition of "the wall accepts writes" exists (`useWallLock().canEdit`); no
      component re-derives `isLocked === false`
- [ ] Exactly one inline-rename implementation exists; `ListItemRow` consumes it and has no
      `@keyup.esc` of its own
- [ ] Every telemetry message string appears verbatim in the source (no template-built messages);
      the six pre-existing wall messages and their severities are unchanged
- [ ] `COLUMN_ROWS`, `column.hidden`, the board's more-button, `WallTripLeg`,
      `travelSegments.slice(0, 3)`, `{ kind: 'lists' }`, `.wall-leg` and `text-[#00b4d8]` no longer
      exist anywhere in the codebase
- [ ] No unreachable sheet branch remains

**Quality gates**

- [ ] Every added failure path shows the family a toast **and** leaves a cause-plus-fix line on the
      console; no path returns quietly, including the to-do delete's `false` branch, which is the
      only signal that path has
- [ ] Every new surface is correct in light **and** dark: a `-lift` on every accent, a dark partner on
      every painted background, no opacity on readable text
- [ ] `.when-cap` clears AA on dark via `teal-lift`
- [ ] `ActionButtons`' three pre-existing call sites are **pixel-identical in light mode** and legible
      in dark after the additive partners
- [ ] `npm run lint`, `npm run type-check` and the unit suite are green at every one of the five
      commits, not just at the end
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified
- [ ] `CHANGELOG.md` names the trip-card styling change under `Changed`
- [ ] The plan is saved to `docs/plans/` and the prompt logged to `docs/prompts/2026-09/` before
      implementation starts

## Testing Plan

1. **Unit - `wallJobs.captureListRestore`** (pure, no Pinia). The last-open-item case: a one-off list
   that `removeItem`'s `deriveCompletion` would file comes back unfiled, with the completion triple
   restored; a recurring list gets `cycleCelebrated` back; a list with items still open gets the
   triple restored unchanged; a list whose `completedAt` was absent gets `completedAt: undefined`
   in the patch (the key-deletion contract). This is the cheapest test of the change's
   highest-consequence rule.
2. **Unit - `useWallJobs`** (new file; the composable has zero coverage today). Assert:
   - `renameJob` and `removeJob` dispatch on `job.source` to the right store.
   - A `null` return (list paths, `updateTodo`) **and** a `false` return (`deleteTodo`) each fire
     `reportJobEditFailed` plus a critical `reportError` and return `false`; a thrown store error
     takes the same path.
   - A genuine no-op rename (unchanged title, `updateItemText` returns the list) is treated as
     success and raises no toast.
   - List undo calls `updateList` with the completion fields as well as `items`; to-do undo calls
     `restoreTodo` with the original id.
   - **Regression gate on commit 1:** `toggle`, `addListItem` and `addTodo` still emit exactly
     `wall_job_toggled` / `wall_job_toggle_failed`, `wall_list_item_added` / `wall_list_add_failed`,
     `wall_todo_added` / `wall_todo_add_failed` at unchanged levels and severities, and now carry
     `{ action: 'job_toggle' | 'list_add' | 'todo_add', kind: 'list' | 'todo' }` on both outcomes.
     Written before the refactor. Do NOT assert the old `action: 'job_toggled'` or `kind: 'ok'`;
     those are the two values this commit deliberately corrects.
3. **Unit - `ListItemRow`** (new file, written FIRST, against the unconverted component). Enter emits
   `edit-save` even with an emptied draft; blur emits only when dirty and non-blank; Esc emits
   `edit-cancel` and the following blur emits nothing; unmount-while-dirty emits `edit-save` exactly
   once; the read-only and non-editable variants are unaffected. Re-run unchanged after the
   `useInlineRename` conversion; add one case for the Escape move (an editing row cancels on Escape
   and the surrounding overlay stays open). `__resetEscapeCloseForTests()` in `beforeEach`.
4. **Unit - `WallJobRow`** (new file). Locked: no trash, no rename, tapping the title (and the owner
   pill, and the done stamp) ticks. Unlocked: trash present, tapping the title opens the input, Enter
   commits, Esc cancels, unmount-while-editing commits. Assert the tick button's markup and
   `wall-tick` classes are identical in both states, and that `job.key` is unchanged. Mount with and
   without a `WALL_EDIT` provide; without one the row must render read-only.
5. **Unit - `WallAddRow`** (new file). `+` hidden while blank, appears on input, Enter submits
   trimmed, does not submit blank, does not clear when `submit` resolves `false`, and one instance's
   in-flight state does not disable another's. Mounted with a stub `submit` and no provides at all,
   which is the check that it stayed generic.
6. **Unit - `WallChoreBoard`**. Existing tests mount with **no** `WALL_LOCK` and no `WALL_EDIT`, so
   they all run locked and stay green. Add a provide helper and cases for the unlocked state, plus
   the case the suite has never had: a member with 12 items across 3 lists renders all 12 and no
   more-button. Nothing currently asserts the cap, so the existing suite would have stayed green
   through a regression here.
7. **No new test for `WallTripTimeline`.** It is a `v-for` over two arrays with one `v-if`; the
   merge / sort / group / when-band logic is already covered by `useVacationTimeline.band.test.ts`
   and `useVacationTimeline.terminal.test.ts`. It is verified manually in step 9.
8. **Manual, in a browser, both themes** (per `docs/lessons.md`; a green suite has hidden real
   defects on this project before): unlock the wall, add to a chore list and a grocery list, rename
   one item, delete the LAST OPEN item on a one-off list and undo it, and confirm the list is still
   on the board with the item back in its original position and tick state. Press Escape mid-rename
   inside the sheet and confirm the sheet stays open. Leave the wall unlocked and idle for two
   minutes to confirm the relock still fires when not editing, then repeat while typing to confirm it
   does not.
9. **Manual - trip.** Open a trip with 4+ flights plus a hotel and a car. Confirm all segments appear
   in date order grouped by day, that the drawer scrolls, that a dateless item shows under "still
   deciding", that the when-band caption is legible in dark mode, and that the trip card still shows
   two flights.
10. **Manual - `ActionButtons` call sites.** After commit 2, check Accounts, Transactions and the
    Beanie List tiles: light mode must be **unchanged** (the change is additive `dark:` classes
    only), and dark mode must show a legible icon at rest and a legible danger tone on hover.
11. **No new E2E test.** Applying the Three-Gate Filter from ADR-007: rename and remove are covered
    by unit tests at the store boundary, the budget is capped at 25, and nothing here is a
    full-stack journey a unit test cannot assert. If one is ever added it replaces an existing test,
    it does not extend the budget.
12. **CloudWatch.** After deploy, filter `surface = beanie-wall` and confirm `wall_job_renamed` /
    `wall_job_removed` / `wall_job_remove_undone` appear with the right `kind`, that the six
    pre-existing wall messages still appear unchanged after the commit-1 refactor, that every wall
    write event now carries both `action` and `kind`, and that no `*_failed` events are firing.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved mockup plus two codebase reuse audits; established the three parts (uncap the board, inline add/rename/remove, full trip timeline).
- **Pass 2 (DRY + error handling)**: Found a real undo bug (`removeItem` can file a list, so restoring only `items` leaves it hidden), that `WallJobRow`'s root is a `<button>` so controls cannot nest, and that the proposed `@keyup.esc` fix does not stop the sheet's `keydown` listener; replaced prop-drilling with a `WALL_EDIT` injection key and routed all writes through one error contract.
- **Pass 3 (Sustainability)**: Extracted `WallTripTimeline.vue` so `WallSheet.vue` shrinks rather than passing 900 lines; moved the undo snapshot into a pure, Pinia-free helper; unified the error contract across all six operations; added guardrails, a rejected-options register and per-commit green gates.
- **Pass 4 (Fresh-eyes sweep)**: Disproved the "byte-identical telemetry" claim (the existing events disagree with themselves) and the impossible line-count criterion; found the row restructure would have broken tap-anywhere-to-tick; **cut five items as over-engineering** (`canEdit` on the lock context, the `WALL_EDIT` fallback stubs, the `ActionButtons` light-mode re-tone, a presentation-only test file, and a dead `isRecurring` branch), taking six commits down to five.

## No GitHub issue

> **No GitHub issue created.** This plan was approved for direct implementation.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-09-10)

> Let's make some small updates this session then work on the google calendar sync fix based on the user feedback.
>
> first a small fix for the beanie wall regarding the chores board. At the moment, chores are listed on the board and they scroll to apoint, and then you have a "+X more" element which brings up the drawer. My question is - what is the purpose of the drawer screen when the chores board already scrolls? i would propose to scroll/overflow for the full list rather than having the "+N" element that opens up the chores board. As the chores board already scrolls, i don't see the value of using the drawer and this is confusing for kids. Just let the kids (or any user) see the full list on the one main screen. let me know if this makes sense and your thoughts on this.
>
> in addition, when edit mode is enabled on the wall, it seems that all it does is include the ability to add an item to a todo list. can we include the ability to add an item to a list (i.e. chore list, grocery list, etc) as well?
>
> ALso a small bug it seems on the travel drawer - when opening a travel plan on the beanie wall, i have one travel plan with 4 flights, and it only seems to show 3 of the flights. Can this be fixed to show all flights, as well as accomodation, plans, etc? it is ok if it scrolls. When opening the travel plan, why not just show all travel segments rather than just a portion of the flights.

### Follow-up 1

> use /frontend-design:frontend-design as needed to make UI changes easy and fun and engaging for the family

### Follow-up 2

> yes, mock up the add row and trip timeline

### Follow-up 3

> can you put the mockup artifact on claude pls

### Follow-up 4

> sorry in addition, can edit mode edit or remove list or todo rows also?

### Follow-up 5 (the approval that set scope)

> option A with remove and edit looks good, but rather than an "x" icon for remove can we use a trashcan icon please? to me, 'x' is more like clearnig a line, while a trash can is a clear symbol for deleting a line. undo is fine as well. For travel, the travel spine looks good, but please ensure that all the styles, colors, etc are all following the beanies CIG theme and style, and reuse where possible from the existing travel board and travel segments. please write the plan then implement.

### Follow-up 6

> once done save the plan and start implementing. if you feel the implementation requires it, run a code review to ensure it was implemented as intended and does not introduce new bugs, side effects, or security issues, and fix any issues found

</details>
