# Plan: Helpful hints in the daily briefing

> Date: 2026-09-24
> Related issues: None — direct implementation (product decision by greg, 2026-09-24, during the blog #56 review)
> Plan file: `docs/plans/2026-09-24-helpful-hints-in-the-daily-briefing.md`

## User Story

As a parent who gets a helpful hint ("get a present for Emma's party"), I want that hint to show in my daily briefing on the Family Nook, so the one screen I look at each morning carries the prep I would otherwise forget, without me having to open the to-do page.

## Context

The #40 helpful-hints plan (`docs/plans/2026-07-24-helpful-hints.md`) deliberately excluded hints from the daily briefing. The reason was mechanical, not a product preference: a hint's `dueDate` is its **nudge date** (the day it appeared), so for the whole lead window it is "overdue" by to-do rules, and the briefing would have rendered every hint as "A gentle reminder: get a present for Emma, it was due 1 October" with the ⏰ icon. Rather than special-case it, the plan pointed the briefing at `todoStore.manualActiveTodos` (hints filtered out) and pinned the exclusion in the store comment at `src/stores/todoStore.ts:33-39` and `src/composables/useCriticalItems.ts:269-272`.

Two published blog posts (7 Aug "my life could use some helpful hints", lines 36 and 50, and the staged #56 "sharing with beanies") tell readers hints appear in the daily briefing. greg's product intent matches the posts: hints belong in the briefing. The fix is to include them with their own framing so the overdue problem never arises.

Current briefing facts (verified at HEAD `12c62bd6`):

- `useCriticalItems()` (`src/composables/useCriticalItems.ts`) builds `CriticalItem[]` from activities, medications, to-dos (`manualActiveTodos`), lists, meals, then sorts timed-first (stable), then pins tomorrow's holiday at index 0. It reads no hint feed.
- `CriticalItem.type` is `'todo' | 'activity' | 'medication' | 'holiday' | 'list' | 'meal'`. `FamilyStatusToast.vue` switches on it: `type === 'todo'` → `complete-todo` on the tick, `open-todo` on tap (`FamilyStatusToast.vue:39-45, 110-118`). `FamilyNookPage.vue:137-141` handles `complete-todo` with `todoStore.toggleComplete(id, memberId)` and `open-todo` by setting `selectedTodoId` (opens the view/edit modal).
- Hints are ordinary `TodoItem`s with `hintType` (+ `hintKey`, `hintEventDate`, `hintAcknowledged`), `src/types/models.ts:689-694`. `isHint(todo)` is a **type guard** returning `todo is TodoItem & { hintType: HelpfulHintType }` (`src/utils/helpfulHints.ts:132`). Their `title` is already the full sentence with the date baked in, e.g. "Get a present for Emma's party (3 Oct)" (`helpfulHints.ts:175-178`, keys `todo.hint.title.*` at `uiStrings.ts:6880-6903`). Their `assigneeIds` are the source activity's assignees (`helpfulHints.ts:247-257`).
- The store already exposes the audience-filtered hint feed: `todoStore.visibleHintTodos(viewer, resolveMember)` (`todoStore.ts:78-85`), which dedupes by `hintKey` and drops hints whose `classifyAudience(...)` is `'hidden'`. The to-do page uses exactly this (`FamilyTodoPage.vue:77-81`). "Keep" (`acknowledgeHint`) only sets `hintAcknowledged`; `hintType` is never cleared anywhere in `src/`, so a kept hint is still a hint.
- **Typing gap**: `hintTodos = dedupeHintsByKey(activeTodos.value.filter(isHint))` (`todoStore.ts:73`) — the `filter(isHint)` narrows, but `dedupeHintsByKey(hints: TodoItem[]): TodoItem[]` (`helpfulHints.ts:367`) widens it back, and `visibleHintTodos` is declared `: TodoItem[]`. So consumers cannot index `HINT_TYPE_META[todo.hintType]` without a ternary (`TodoItemRow.vue:46-48` does exactly that).
- Completing a hint (`toggleComplete` → `completed: true`) is what the to-do page's checkbox already does (`FamilyTodoPage.vue:125-127`) and blocks regeneration (store comment `todoStore.ts:74-76`).
- `toggleComplete` returns `null` on an unknown id (`todoStore.ts:206-207`) and none of its callers (`FamilyNookPage.vue:140`, `FamilyTodoPage.vue:126`, `TodoViewEditModal.vue:225`, `NookTodoWidget.vue:73`, `useWallJobs.ts:209`) logs it — a silent failure today. `listStore.ts:687-695` shows the house pattern for this case (`logEvent` warn + return null).
- Per-type hint emoji: `HINT_TYPE_META[hintType].emoji` (`helpfulHints.ts:42-82`).
- The `helpfulHints` flag is on in prod (`src/config/featureFlags.committed.ts:16`); `useHelpfulHints()` no-ops when off (`useHelpfulHints.ts:59`). In vitest `isFlagEnabled` returns true for every flag (it reads `import.meta.env.DEV` at call time, `flags.ts:71-75`), and `useCriticalItems.test.ts` currently mocks no flags.
- Telemetry: hint **generation** logs on surface `helpful-hints` (`useHelpfulHints.ts:38`, messages `reconcile`, `trigger skipped`, `reconcile failed; …`). Hint **consumption** (complete / keep / dismiss) logs nothing on any surface, although the allowlist already reserves `hint_type` and `hint_op` "type/op enums" for it (`src/utils/diagnosticContext.ts:252-263`). `route_path` (`:65`) is allowlisted but is **not** auto-enriched — callers set it from `window.location.pathname` (`src/services/telemetry/deepLinkEvents.ts:121-133`, `src/pages/OAuthNativeBridgePage.vue:41`).
- `useCriticalItems.test.ts` has no hint case at all, despite the #40 plan promising one (its line 203/261).
- Help articles cross-link with plain anchors: `features.ts:861` uses `<a href="/help/how-it-works/your-daily-briefing">`.
- The "Your Daily Briefing" article's "Three kinds of item can appear" sentence (`how-it-works.ts:341`) already undercounts the shipped briefing (lists, meals and the holiday pin are not described), so any new numeric count would be wrong on day one.

## Requirements

1. Helpful hints visible to the current member appear in the daily briefing (`useCriticalItems`) as `CriticalItem`s of `type: 'todo'`, so the existing tick (`toggleComplete`) and tap (`open-todo` → view/edit modal) work unchanged.
2. Framing is always `Helpful hint: {task}` (beanie: `helpful hint: {task}`), where `{task}` is the hint's own title lower-cased on its first character, exactly as manual to-dos do. Never the overdue / due-today / no-due variants, never a date label, never the ⏰ icon.
3. Icon is the hint type's emoji from `HINT_TYPE_META` (🎁 🎉 🎊 💍 🧳 🛂), matching the to-do page row.
4. Audience comes from `todoStore.visibleHintTodos(currentMember, getMemberById)`, so a surprise-sensitive hint (the birthday person's own present hint) is never shown to that person. No new audience rule; the to-do audience tables are not used for hints.
5. Hints are ordered after every other untimed item: they are pushed **last** (after meals) and carry `time: ''`, so the existing stable timed-first sort places them at the tail. Because the sort comparator returns `0` for any two untimed items (`useCriticalItems.ts:406-412`), "last" is insertion order alone: the hint block must be the final `push` before the sort, the code comment says so, and the ordering unit test (Requirement 10) is what enforces it. Holiday pinning at index 0 is unaffected.
6. `completable: true`, `completed: false` (open hints only; a completed hint is not in `activeTodos`). Ticking a hint in the briefing completes it, which also removes it from the to-do page's hint section and blocks regeneration, identical to ticking it there.
7. A kept (acknowledged) hint keeps hint framing in the briefing; nothing changes on keep.
8. Gate the hint loop on `isFlagEnabled('helpfulHints')` so a flag-off build is byte-identical to today's briefing (the #40 plan's flag-off invariant).
9. The hint feed is correctly typed end-to-end: `visibleHintTodos` returns `HintTodo[]` (hintType non-optional) so the briefing indexes `HINT_TYPE_META` without a `!` or a ternary. Achieved by exporting `HintTodo` and making `dedupeHintsByKey` generic — no new logic.
10. Unit tests in `useCriticalItems.test.ts`: hint included with "Helpful hint:" framing and the type emoji; a hint whose nudge date is in the past is NOT framed overdue and has no ⏰; a hint hidden from a non-assignee adult (audience `'hidden'`) is absent for that member and present for the assignee; hints sort after a manual untimed to-do; kept hint keeps framing; flag off → no hint items.
11. Help Center: update the "Your Daily Briefing" article (`src/content/help/how-it-works.ts`, slug `your-daily-briefing`) so the "What shows up" intro names helpful hints **without a numeric count** (the current "Three kinds" is already stale; a count is a maintenance trap), and add a level-3 "Helpful hints" section after "To-dos for the kids — and to-dos for no one" describing the framing, the tick, the tap, and the surprise rule. Update the "Helpful Hints" article (`src/content/help/features.ts`, slug `helpful-hints`, the paragraph beginning "A hint is a suggested to-do…") to mention it also appears in the daily briefing on the Family Nook.
12. Update the store comment at `todoStore.ts:33-39` and the briefing comment at `useCriticalItems.ts:269-272` so the code's own reasoning matches the new behaviour (the lessons file says findings must be read against the docblock; the docblock must therefore be true).
13. Observability lives in the store, once, for every caller: `toggleComplete` emits an info event when a hint is completed (with `hint_type`, `hint_op`, `route_path`) and a warn when the id is unknown. No page-level telemetry. The hint event is emitted via one small private helper so the action body stays flat.

## Important Notes & Caveats

- **Do not** route hints through the to-do loop with a `dateState` override. The overdue/today/noDue tables are the reason hints were excluded; a separate, tiny loop with one message key is simpler than threading an exception through three key tables.
- **Do not** add a new `CriticalItem.type`. `'todo'` gives the tick and tap behaviour for free; a new type would need handler branches in `FamilyStatusToast.vue` and `FamilyNookPage.vue` for no gain. If a consumer ever needs to distinguish, the item's `id` resolves to a `TodoItem` whose `hintType` is set.
- **Do not** put the completion telemetry in `FamilyNookPage.vue`. (a) In the missing-id branch there is no `TodoItem` to run `isHint` on, so a page-level "hint missing" warn cannot be written; (b) the to-do page, the view/edit modal, the Nook widget and the wall job queue all complete through the very same `toggleComplete` and would stay unlogged; (c) the store is the single choke point, mirroring `listStore.ts:687-695`. "From the briefing" vs "from the to-do page" is carried by `route_path`, read from `window.location.pathname` exactly as `deepLinkEvents.ts:121-133` documents.
- **Do not** guard the `route_path` read with `typeof window === 'undefined'`. The store only runs inside the Vue app and vitest is `happy-dom` (`vitest.config.ts:10`); `OAuthNativeBridgePage.vue:41` sets the same field from `window.location.pathname` bare. A guard here would be dead code that every future reader has to reason about.
- `visibleHintTodos` is a **function** taking `(viewer, resolveMember)`, not a computed; call it inside the `criticalItems` computed so reactivity flows from `hintTodos` and `familyStore.currentMember`.
- Hint `assigneeIds` are copied from the source activity. `classifyAudience` on those may yield `'forChild'` for a child's party; that is fine, the hint is still shown, but the message stays "Helpful hint: …" (no child-name prefix). The hint title already names the event.
- The "five-item limit" in the help article is a view concern (`CRITICAL_ITEMS_INITIAL_VISIBLE = 5`, "Show all"). Hints being last means they are the first to fall under the fold, which is the intended low-urgency behaviour.
- `lowercaseFirst` (private to `useCriticalItems.ts:447-450`, the only copy in `src/`) is reused so "Helpful hint: get a present for…" reads as one sentence; hint titles start with a capital ("Get a present…").
- The 7 Aug blog post and post #56 need **no copy change** once this ships. Post #56's "to-do list and daily briefing" sentence stays as written (the "todo" → "to-do" fix is already in).
- Translation sync: one new `nook.*` key goes into `uiStrings.ts` with `en` + `beanie`; `npm run translate` is not required for the change but the CI translation-sync workflow will pick the key up.
- Optional one-line tidy while touching nothing else: `FamilyTodoPage.vue:79` builds its own `resolve` with `familyStore.members.find`; `useMemberInfo().getMemberById` is the shared resolver. Not required for this change.

## Assumptions

> Review these before implementation.

1. `todoStore.visibleHintTodos(viewer, resolveMember)` remains the single audience-aware hint getter (verified `todoStore.ts:78-85`); its return type changes from `TodoItem[]` to `HintTodo[]` (a subtype — every existing caller still type-checks: `FamilyTodoPage.vue:81` passes it to `withMemberFilterAndSort`, `todoStore.test.ts:193-194` asserts structurally).
2. `dedupeHintsByKey` has TWO production callers: `todoStore.ts:73` (hints only) and `useScheduledReminders.ts:585`, which passes the whole `todoStore.activeTodos` feed (manual + hint) so non-hint to-dos pass through untouched. The generic bound is therefore `T extends TodoItem` — never `T extends HintTodo`, which would break the reminder scheduler. `helpfulHints.test.ts:299-306` also calls it with plain `TodoItem`s.
3. `FamilyStatusToast.vue` treats `type: 'todo'` uniformly for tick and tap (verified lines 39-45, 110-118); no hint-specific branch exists or is needed. `TodoViewEditModal.vue` likewise has no hint-specific branch (grep for `hint` returns nothing), so tapping a hint in the briefing opens the generic modal with the nudge date shown as the due date — identical to opening it from the to-do page today.
4. `toggleComplete` on a hint is an acceptable "done" (it is what the to-do page's checkbox does; a completed hint blocks regeneration per `todoStore.ts:74-76`). The celebration confetti fires as for any to-do; acceptable.
5. `useMemberInfo().getMemberById` has the `(id) => FamilyMember | undefined` shape `visibleHintTodos` expects (verified `useMemberInfo.ts:69`; it is already passed to `classifyAudience` in the same composable, `useCriticalItems.ts:207, 273`).
6. `ALLOWED_CONTEXT_KEYS` already contains `route_path` (`diagnosticContext.ts:65`), `action` (`:68`), `hint_type` (`:262`) and `hint_op` (`:263`); no new context key ships, so no allowlist / `PrivacyInfo.xcprivacy` / `privacy.astro` change (neither file mentions hints). One phrase in `docs/runbooks/native-store-submission.md:34` does change: it currently declares the hint enums as shipping "on a failure", and `diagnosticContext.ts:56-57` requires the table be updated when a field changes which path it ships on — the new event is a success path.
7. `logEvent` never throws (`logEvent.ts:12-18` contract), so no try/catch wraps the calls.
8. No data-model, store-state, or repository change is needed.

## Approach

### 1. `src/utils/helpfulHints.ts` — carry the `isHint` narrowing through dedupe

- Add and export `export type HintTodo = TodoItem & { hintType: HelpfulHintType };` and use it in `isHint`'s return type (`todo is HintTodo`) — same type, now named. It lives beside the guard rather than in `models.ts` (CLAUDE.md centralises model types there) because it is the guard's return type and this file already owns its own domain types (`DesiredHint`, `HintSkipReason`, `ComputeResult`, lines 112-129); keeping guard and type together means they cannot drift.
- Make the dedupe generic so it preserves whatever it is given:
  `export function dedupeHintsByKey<T extends TodoItem>(hints: T[]): T[]` (body unchanged; `byKey` becomes `Map<string, T>`, `out: T[]`). The bound MUST stay `TodoItem`, not `HintTodo`: `useScheduledReminders.ts:585` passes the mixed `activeTodos` feed and relies on non-hints passing through (its comment says so). Add one line to the docblock: "Generic so the store's `filter(isHint)` narrowing survives (→ `HintTodo[]`) while the reminder scheduler's mixed feed still comes back as `TodoItem[]`."

### 2. `src/stores/todoStore.ts`

- `hintTodos` now infers `HintTodo[]` with no annotation change; declare `visibleHintTodos(...): HintTodo[]` (import `HintTodo` from `@/utils/helpfulHints`).
- Import `logEvent` from `@/services/telemetry/logEvent` (this store has none yet; ten other stores do).
- Add one module-level private helper beside the sort comparators (`todoStore.ts:16-19`), so the narrowing, the `route_path` read and the event shape live in one place and the action body stays flat:

```ts
// #40: the ONE consumption counter for hints, emitted from `toggleComplete` so
// every surface (briefing tick, to-do row, modal, Nook widget, wall job) is
// covered by one implementation. `route_path` says which surface ticked it
// (`/nook` = the briefing, `/todo` = the to-do page) — it is not auto-enriched, so it
// is read here exactly as deepLinkEvents does. Pairs with the `reconcile`
// generation event on the same surface. No emit gate: a completion is a
// discrete user action, not a re-emitted watcher outcome.
function logHintCompleted(todo: TodoItem): void {
  if (!isHint(todo)) return;
  logEvent({
    level: 'info',
    surface: 'helpful-hints',
    message: 'hint completed',
    context: {
      hint_type: todo.hintType,
      hint_op: 'complete',
      route_path: window.location.pathname,
    },
  });
}
```

- `toggleComplete`: two one-line additions, no new nesting:

```ts
async function toggleComplete(id: string, completedBy: string): Promise<TodoItem | null> {
  const existing = todos.value.find((t) => t.id === id);
  if (!existing) {
    // Never silent: every caller funnels here, so one warn covers them all.
    // Mirrors listStore.setAllItemsCompleted.
    logEvent({
      level: 'warn',
      surface: 'todos',
      message: 'toggleComplete: to-do not found',
      context: { action: 'toggle_complete_missing_todo' },
    });
    return null;
  }
  …
    // Mark complete
    const result = await updateTodo(id, { completed: true, completedBy, completedAt: now });
    if (result) {
      logHintCompleted(existing);
      celebrate('goal-reached', { … unchanged … });
    }
    return result;
```

- Update the comment block at lines 33-39 and 69-72: hints are surfaced via `hintTodos` / `visibleHintTodos` on the to-do page **and** the daily briefing; `manualActiveTodos` still keeps them out of the open/scheduled/overdue lanes and nav badges.

### 3. `src/services/translation/uiStrings.ts`

Add next to the `nook.criticalTodo*` keys (~line 7754):

```ts
// #40: a Helpful Hint in the briefing. One fixed framing — never the overdue /
// today / no-due variants (a hint's dueDate is its nudge date, not a deadline).
'nook.criticalHint': {
  en: 'Helpful hint: {task}',
  beanie: 'helpful hint: {task}',
},
```

(Not an important surface; the beanie floor does not apply.)

### 4. `src/composables/useCriticalItems.ts`

- Import `HINT_TYPE_META` from `@/utils/helpfulHints` (`isFlagEnabled` is already imported).
- Add one message key constant beside the meal keys:
  `const HINT_KEY = 'nook.criticalHint' satisfies UIStringKey;`
- After the meal-planner block and **before** the sort:

```ts
// ── Helpful Hints (#40) for the current member ─────────────────────
// Hints ride their own loop, never the to-do loop: a hint's dueDate is its
// nudge date, so through the overdue/today/noDue tables every hint would read
// as overdue for its whole lead window. One fixed framing, no date state, no
// ⏰. Audience is the store's own `visibleHintTodos` so a surprise-sensitive
// hint (the birthday person's present) stays hidden from them.
//
// Untimed, and pushed LAST: the sort below returns 0 for any two untimed
// items, so tail position is insertion order alone. Keep this the final block
// before the sort — a new item kind goes ABOVE it. The "hints after a manual
// to-do" unit test is what locks this.
if (isFlagEnabled('helpfulHints')) {
  for (const hint of todoStore.visibleHintTodos(currentMember, getMemberById)) {
    items.push({
      id: hint.id,
      type: 'todo', // tick → toggleComplete, tap → open-todo, unchanged
      message: buildMessage(HINT_KEY, { task: lowercaseFirst(hint.title) }),
      icon: HINT_TYPE_META[hint.hintType].emoji, // HintTodo: hintType is non-optional
      time: '',
      completable: true,
      completed: false,
    });
  }
}
```

- Rewrite the comment at lines 269-272 so it says the to-do loop reads `manualActiveTodos` because hints have their own loop below (not "hints must never be here").

### 5. Tests

**`src/composables/__tests__/useCriticalItems.test.ts`** — add a flag mock at the top using the hoisted-state pattern from `useNavBadges.test.ts:40-50` (there is no flag mock in this file today; without it `isFlagEnabled` is always true under vitest). No `logEvent` mock is needed here: the composable never calls `toggleComplete`, and `logEvent` is already in this test's import graph via `listStore`.

```ts
const { flagState } = vi.hoisted(() => ({ flagState: { helpfulHints: true } }));
vi.mock('@/config/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/flags')>();
  return {
    ...actual,
    isFlagEnabled: (flag: string) =>
      flag === 'helpfulHints' ? flagState.helpfulHints : actual.isFlagEnabled(flag as never),
  };
});
```

Reset `flagState.helpfulHints = true` in the existing `beforeEach`. Then a `describe('helpful hints in the briefing')` block using the existing `makeMember` / `makeTodo` fixtures (`makeTodo` defaults `createdBy: 'parent-2'`; set fields explicitly):

- `makeTodo({ id: 'hint-1', title: "Get a present for Emma's party (12 Mar)", hintType: 'birthday-party-gift', hintKey: 'k1', dueDate: '2026-03-08', assigneeIds: ['parent-1'], createdBy: 'parent-1' })`, viewer `parent-1` → one item, `message === "Helpful hint: get a present for Emma's party (12 Mar)"`, `icon === '🎉'`, `type === 'todo'`, `completable === true`, `completed === false`, `time === ''`; `message` does **not** contain `'8 Mar'` or `'gentle'` and `icon !== '⏰'` even though `dueDate` is before `TODAY`.
- Hidden-audience case (mirrors `todoStore.test.ts:179-195`): a `birthday-present` hint with `assigneeIds: ['parent-1']`; viewer `parent-2` (adult non-assignee → `classifyAudience` = `'hidden'`, `audience.ts:40`) sees nothing; viewer `parent-1` sees it.
- Ordering: one manual untimed to-do (`assigneeId: 'parent-1', dueDate: TODAY`) + one hint → to-do index < hint index. This test is the guard for Requirement 5's insertion-order contract.
- Kept hint (`hintAcknowledged: true`) still yields the "Helpful hint:" message.
- `flagState.helpfulHints = false` → the same hint fixture yields zero items.

**`src/stores/__tests__/todoStore.test.ts`** — the `logEvent` mock MUST be hoisted, because `vi.mock` factories run before `const` declarations (the precedent is `authStore.passwordRotation.test.ts:94-98`, which does exactly this):

```ts
const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));
```

Then two cases in the existing `todoStore — Helpful Hints (#40)` describe, using its `todo()` fixture (`celebrate` is already mocked at line 12; `window.location.pathname` is `'/'` under happy-dom):

- completing a hint: `store.todos = [todo({ id: 'h', hintType: 'trip-packing', hintKey: 'k' })]`, `todoRepo.updateTodo` mocked to resolve the completed todo (as the `acknowledgeHint` test does at lines 197-205), `await store.toggleComplete('h', 'm-1')` → `logEventMock` called with `expect.objectContaining({ surface: 'helpful-hints', context: expect.objectContaining({ hint_type: 'trip-packing', hint_op: 'complete' }) })`; completing a manual to-do → no call with `surface: 'helpful-hints'`.
- `toggleComplete('nope', 'm-1')` → resolves `null` and `logEventMock` called with `expect.objectContaining({ level: 'warn', surface: 'todos' })`.

### 6. Help Center

- `src/content/help/how-it-works.ts`, `your-daily-briefing` (starts line 293):
  - "Three kinds of item can appear: **activities** happening today, **to-dos** that need attention, and **medication reminders**…" → "The briefing brings together **activities** happening today, **to-dos** that need attention, **helpful hints** beanies added ahead of an upcoming event, and **medication reminders**…". No number: the count was already stale (lists, meals and holidays are absent) and a count has to be edited every time a kind is added.
  - New `heading` (level 3, id `helpful-hints`) "Helpful hints" after the `todos-shared` infoBox ("Same rules, wider audience"), with one `paragraph`: hints beanies added ahead of a birthday, party or trip appear as _"Helpful hint: get a present for Emma's party (3 Oct)"_ with the hint's own icon; they sit after your other items for the day, never turn into an overdue nudge, tick to mark done (it leaves the to-do page too), tap to open; the person a surprise is for never sees it. End with `<a href="/help/features/helpful-hints">Learn more about helpful hints</a>` (the markup `features.ts:861` already uses in the other direction).
  - "When the briefing is hidden": "no activities, no to-dos due, no overdue items, no helpful hints".
  - Bump `updatedDate`.
- `src/content/help/features.ts`, `helpful-hints` (starts line 278): in the paragraph starting "A hint is a suggested to-do…", after "so it never looks like one of your own tasks." add "It also shows in your daily briefing on the Family Nook, framed as _Helpful hint: …_, after your other items for the day." Bump `updatedDate`.

### 7. Observability Coverage

The briefing computed is pure and re-runs on every reactive change, so it must not log. The observable event is the **user action**, and it lives once in the store so every surface is covered:

- **Success path**: `todoStore.toggleComplete` → `logHintCompleted` → `helpful-hints` / `info` / `hint completed` / `{ hint_type, hint_op: 'complete', route_path }`. Same surface as generation so one CloudWatch filter covers generation and consumption; `route_path` (`/nook` vs `/todo`) is what answers "is the briefing placement used" against the `reconcile` counts already logged. All three keys are already allowlisted; no allowlist update.
- **No emit gate**: `useHelpfulHints.ts:47` wraps its reconcile events in `createChangeGate()` because a deep watcher re-emitted the same outcome ~36 times a day. A completion is a discrete user action that carries information every time; it is emitted bare. The 50/surface/min client rate limit is the only ceiling and is unreachable by hand.
- **Store declaration**: `docs/runbooks/native-store-submission.md:34` currently reads "the closed hint-type enum + operation on a failure". Change to "the closed hint-type enum + operation, on a hint being ticked done or on a failure" — `diagnosticContext.ts:56-57` requires this when a field changes which path it ships on. No other consumer (`PrivacyInfo.xcprivacy`, `privacy.astro`) enumerates hint fields.
- **Failure path**: `toggleComplete` with an unknown id → `todos` / `warn` / `toggleComplete: to-do not found` / `{ action: 'toggle_complete_missing_todo' }`, then `return null` as today. This closes a pre-existing silent path for the briefing, the to-do page and every other caller. Repository errors are already caught and reported by `wrapAsync` inside `updateTodo`; nothing new can throw.
- **Deliberately not logged**: un-completing a hint (the celebration `onUndo` at `todoStore.ts:226-233`, or the modal on a completed hint), "keep" (`acknowledgeHint`) and "dismiss" (`deleteTodo`). `hint_op` stays a closed enum with one value so the boundary is explicit; widening it is a separate decision, not a gap to be patched ad hoc.
- Nothing is `critical`.

### 8. Order of work

1. `helpfulHints.ts` `HintTodo` + generic dedupe → 2. `todoStore.ts` types, `logHintCompleted`, telemetry, comments → 3. `uiStrings.ts` key → 4. `useCriticalItems.ts` loop + comment → 5. tests (both files) → 6. help articles → 7. `npm run validate`.

## Files Affected

- `src/utils/helpfulHints.ts` — `HintTodo` type, generic `dedupeHintsByKey` (`T extends TodoItem`; no logic change)
- `src/stores/todoStore.ts` — `visibleHintTodos: HintTodo[]`, `logHintCompleted` helper, telemetry in `toggleComplete`, comment updates
- `src/services/translation/uiStrings.ts` — `nook.criticalHint`
- `src/composables/useCriticalItems.ts` — hint loop, comment rewrite
- `src/composables/__tests__/useCriticalItems.test.ts` — flag mock + hint cases
- `src/stores/__tests__/todoStore.test.ts` — hoisted `logEvent` mock + telemetry cases
- `src/content/help/how-it-works.ts` — daily briefing article
- `src/content/help/features.ts` — helpful hints article
- `docs/runbooks/native-store-submission.md` — one phrase on line 34 (hint enums now also ship on completion)
- `docs/plans/2026-09-24-helpful-hints-in-the-daily-briefing.md` — this plan

## Help Center Coverage

- **Action**: update existing · **Category**: how-it-works · **Slug**: `your-daily-briefing` · **Title**: Your Daily Briefing · **Scope**: hints join the intro list of item kinds (no numeric count); how they read, where they sit, tick/tap, the surprise rule; link to the Helpful Hints article. **Notes**: say they sit after other items and that the person a surprise is for never sees it.
- **Action**: update existing · **Category**: features · **Slug**: `helpful-hints` · **Title**: Helpful Hints · **Scope**: one sentence that hints also appear in the daily briefing.

## Observability Coverage

See Approach §7. Events: `helpful-hints` / info / `hint completed` / `{ hint_type, hint_op: 'complete', route_path }`; `todos` / warn / `toggleComplete: to-do not found` / `{ action: 'toggle_complete_missing_todo' }`. Both emitted from `todoStore.toggleComplete` (the hint one via the private `logHintCompleted` helper, ungated) so every surface is covered by one implementation. No new context keys; one phrase in the store-submission runbook updated because `hint_type`/`hint_op` now also ship on a success path.

## Acceptance Criteria

- [ ] A visible open hint appears in the briefing as "Helpful hint: …" with its type emoji, after all other items.
- [ ] A hint whose nudge date is in the past is never framed as overdue and never shows ⏰.
- [ ] The birthday person does not see their own present hint in the briefing; another adult does.
- [ ] Ticking a hint in the briefing completes it; it leaves both the briefing and the to-do page's hint section; regeneration is blocked.
- [ ] Tapping a hint in the briefing opens the to-do view/edit modal.
- [ ] A kept hint still shows with hint framing.
- [ ] `helpfulHints` flag off → briefing identical to today.
- [ ] `visibleHintTodos` returns `HintTodo[]`; no `!` or ternary needed to read `hintType` in the briefing.
- [ ] `toggleComplete` gains no new nesting: the hint event is one call to `logHintCompleted`.
- [ ] Unit tests above pass; `npm run validate` green.
- [ ] Both help articles updated and matching shipped behaviour; the briefing intro carries no numeric count of item kinds.
- [ ] Telemetry: completing a hint from the briefing or the to-do page emits the `helpful-hints` info event with `hint_type` and `route_path`; an unknown id emits the `todos` warn instead of returning silently.
- [ ] Store and composable comments describe the new behaviour, including the "keep the hint block last" instruction.

## Testing Plan

1. Unit: the new `useCriticalItems.test.ts` block and the two `todoStore.test.ts` cases.
2. Browser (dev server, seeded family): create a birthday-party activity 2 days out assigned to a child → hint appears on the to-do page → open the Nook → briefing shows "Helpful hint: get a present for … (date)" last, with 🎉; tick it → disappears from briefing and to-do page; console shows the `helpful-hints` event with `route_path: '/nook'`; light + dark; 400px.
3. Browser: tap a hint in the briefing → to-do modal opens.
4. Manual (greg): on a real family with an existing hint, confirm the briefing shows it after the app updates, and that the birthday person's device does not show their own present hint.

## Review Passes

- **Pass 1 (Initial draft)**: separate hint loop in `useCriticalItems` reusing `visibleHintTodos`, `HINT_TYPE_META`, `type: 'todo'`; one new string; tests; two help articles; completion telemetry.
- **Pass 2 (DRY + error handling)**: fixed the `HINT_TYPE_META[hint.hintType]` type error at its source (`HintTodo` + generic `dedupeHintsByKey`, `visibleHintTodos: HintTodo[]`); moved telemetry from `FamilyNookPage.vue` into `todoStore.toggleComplete` (one implementation covers briefing + to-do page, uses the reserved `hint_op`/`hint_type` keys and `route_path` for origin) and closed the pre-existing silent `null` on unknown id for every caller; replaced the non-existent flag-mock "convention" with the concrete `useNavBadges.test.ts` hoisted pattern; made the help cross-link definite (`features.ts:861` markup); corrected the context-key assumptions.
- **Pass 3 (Sustainability)**: flattened `toggleComplete` by extracting a module-level `logHintCompleted` helper (no fourth-level nesting in the action) and dropped the dead `typeof window` guard (app-only store, happy-dom in vitest, `OAuthNativeBridgePage.vue:41` precedent); made the "hints last" contract explicit as an insertion-order rule with a code-comment instruction and the ordering test as its lock; removed the numeric item count from the help intro (already stale, a recount trap); recorded why `HintTodo` co-locates with `isHint`; drew the telemetry boundary (undo/keep/dismiss deliberately unlogged, `hint_op` a closed enum); corrected the store count and the modal assumption.
- **Pass 4 (Fresh-eyes sweep)**: verified every file:line claim against HEAD `12c62bd6`. Found and recorded the second `dedupeHintsByKey` caller (`useScheduledReminders.ts:585`, mixed feed) and pinned the generic bound to `T extends TodoItem` so nobody later tightens it to `HintTodo`; made `vi.hoisted` explicit for `logEventMock` (the un-hoisted snippet would throw at mock time); brought the store-submission runbook phrase into scope because `hint_type`/`hint_op` now ship on a success path (`diagnosticContext.ts:56-57` rule); stated that the new event is deliberately ungated relative to `useHelpfulHints`' `createChangeGate`; corrected the store count to ten. Confirmed with fresh greps that no unit or e2e test asserts hints are absent from the briefing, `todoStore.test.ts` asserts `visibleHintTodos` structurally (subtype-safe), `HelpArticle.updatedDate` exists, and `nook.criticalHint` sits outside the beanie-floor prefixes/suffixes. No design change: the separate loop, `type: 'todo'`, store-level telemetry and one-key framing remain the smallest correct shape.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (2026-09-24, during blog #56 review)

> Regarding (1) above, are you sure it's the case the helpful hints don't appear in the daily briefing? i'm pretty sure that they do, as long as you don't dismiss them from your todo list

### Follow-up 1

> Ok let's make a minor tweak to the product then - i believe helpful hint item should show up in the daily briefing. i'd suggest to preface helpfun hints in the daily briefing with something like "helpful hint: don't forget to get a present for <event name>" or something to that effect. other that that, my feeling is they should follow the exact same rules as todos. what do you think?

### Follow-up 2

> go, plan it and build it with /beanies-build-auto

</details>

## Outcome (2026-09-24, built via /beanies-build-auto, NOT committed, NOT deployed)

Built to the plan. `validate` green (8717 tests); browser-verified in real Chromium through the harness `scripts/design-screenshots/hint-briefing-capture.ts` (seeded birthday activity 2 days out → the app's own reconcile generated the hint → briefing showed "Helpful hint: get a present for Emma's birthday party (Sat, 26 Sep)" 🎉 last, light + dark, desktop + 400px → tap opened Task Details → tick completed it, `hint completed` fired with `route_path: /nook`, hint left the briefing).

**Deviations from the plan, all recorded:**

- `route_path` is `/nook` (the Nook route), not `/`; the to-do page is `/todo`, not `/todos`. Comments and this plan corrected.
- The emoji lookup went through a new shared `hintEmoji()` in `helpfulHints.ts` (round-1 finding: a `hintType` from a newer client would throw inside the briefing computed and blank the whole briefing). `TodoItemRow.vue` now uses it too.
- Hints are sorted by `hintEventDate` ascending inside the hint block (round-2 finding: `activeTodos` order is newest-generated first, which put a two-week-away present above tomorrow's packing).
- The help sentence "The person a surprise is for never sees it" was softened to the birthday-present rule only: party/celebration hints are assigned to the activity's attendees with no honoree exclusion (`activityHints`, `helpfulHints.ts:247-257`), so a child on their own party's guest list sees their own gift hint, on the to-do page today and now in the briefing. Changing the engine is a separate decision.

**Round-2 fix reverted by the browser walk.** Round 2 proposed skipping hints whose `dueDate` is in the future ("a kept, deferred hint should stay off the plate"). It hid every hint generated after 09:00: a hint's `dueDate` is its notification-fire date and is set to TOMORROW once today's 09:00 slot has passed (`useHelpfulHints.ts:155-167`). The walk caught it (briefing empty with a generated hint), the filter was removed, and a test now pins "a hint whose nudge date is tomorrow still shows".

**Findings deliberately not fixed:**

- Round 1: `forChild` framing for child-only hints (plan accepted "Helpful hint: …" without the child name; the title names the event). Expired hint lingering until reconcile (reconcile watches `today` and runs within its debounce, so the window is seconds). `window.location.pathname` vs `router.currentRoute` for `route_path` (both precedents exist; router base is `/`).
- Round 2: the briefing subtitle's "{tasks} tasks coming up" excludes hints (it is a family-wide open-task count that never matched the briefing rows; hints are not "tasks" by the #40 boundary). Flag gate placement in the store rather than the consumer (a #40 design choice touching three surfaces; flag is on in prod). Kept hints past their event date stay in the briefing (they are the family's own to-dos, same as the to-do page).
- Telemetry counts ticks, not net completions (undo-then-retick logs twice); documented on `logHintCompleted`, `hint_op` stays a closed enum.
