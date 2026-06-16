# Plan: Beanie Lists — categorized family checklists

> Date: 2026-06-16
> Related issues: Notion tracker #33 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-06-16-beanie-lists.md`
> Mockup: `docs/mockups/family-lists-2026-06-16.html` (approved v4)

## User Story

As a beanies user, I want to create categorized family lists/checklists (one-off and recurring) — each with a single owner and optional due date — so my family can stay organized across groceries, packing, chores, honey-dos, before-school routines, party prep, and small projects, and see what's due in our daily briefing.

## Context

beanies.family has individual To-Dos (the Family To-Do page) but no way to capture a _named bundle_ of items (a grocery run, a packing list, a kids' chore set). #33 adds **Beanie Lists** — a guided, family-focused "mini project planner": create a list, categorize it, give it one owner, optionally schedule it (one-off due date, or recurring auto-reset), check items off with delight, file it when done, attach it to a trip/activity, and surface due lists in the daily briefing + Nook.

The design is locked via the approved mockup (Direction C, v4). This plan translates that mockup into a CIG-compliant implementation, reusing the To-Do system as the closest template.

Two adjacent changes ship with it:

- **Rename "Family To-Do" → "To-Dos"** to sharpen the task-vs-bundle distinction.
- **New CIG convention "page welcome subtitle"** (Heritage-Orange Caveat, one per warm Treehouse page) — applied to Beanie Lists and retro-fit to the To-Dos page.

Ships behind the `familyLists` dev feature flag (OFF in prod until ready).

## Requirements

1. **New "Beanie Lists" page** under The Treehouse 🌳 (route `/lists`), gated behind `familyLists`. Board layout: a pinned **"Due soon"** shelf, then **category shelves**; a category **filter chip** row; a page header with the **welcome subtitle** + a **"New list"** button. A **Completed** area (collapsed) at the bottom.
2. **List model:** title, emoji, category (one of 8), single **owner**, flat **items** (checkbox each), **lifecycle** (one-off | recurring), optional **due date** (one-off only), **recurrence** (recurring only: daily/weekly/monthly, auto-reset), optional **link** to an activity or travel plan, completed state + audit, `createdBy`.
3. **8 categories** (Fair-Play-_inspired_, not copied): 🏠 Home & Household · 🛒 Out & Errands · 🧒 Kids & School · 🩺 Health & Safety · 🎉 Celebrations & Traditions · 🧳 Trips & Packing · ✅ Projects & Honey-dos · ✨ Just for Me.
4. **Lifecycle & recurrence:** one-off lists carry an optional due date and are **filed to Completed** when all items are checked; recurring lists carry a frequency, **auto-reset** (uncheck all) at the start of each period, and are **not** filed away. Recurrence and due date are mutually exclusive (recurring uses its schedule).
5. **One owner per list** (no per-item assignees). Items are flat (no sub-sections).
6. **Templates as creation seeds:** curated templates (grocery, vacation packing, honey-do, kids' chores, before-school, party prep, + more) pre-fill name/emoji/category/recurrence/owner/starter items; afterwards the list is a normal, fully-editable list.
7. **New-list flow:** a sheet with category **pills** + template **cards** (visually distinct), or "start blank".
8. **Add-list entry points:** add an `add-list` action to the **global Quick-Add** sheet (`quickAddItems.ts`) + the page header "New list" button. **No new FAB** (reuse the existing global `QuickAddFab`).
9. **Completion delight:** checking the final item fires the shared `celebrate()` confetti + sound; if the list's **owner ≠ creator**, the creator sees an in-app notification with a fun note ("Barry finished your list!"). The notification is **derived** from the persisted completed state (see Caveats), not imperatively enqueued.
10. **Daily briefing + Nook integration:** whole **lists** that are due / coming-due surface in the daily briefing (`useCriticalItems`, with progress) and in the existing upcoming/"this week" card (tagged "List"); tapping opens the list. Individual list items are **never** injected. No-due-date lists follow the existing to-do "no due date" rule.
11. **Attach to activity / travel plan:** link a present/upcoming activity or trip; the list renders **on the travel-plan (trip) page** in the same style as travel ideas (one source of truth — edits sync both places).
12. **Rename Family To-Do → To-Dos** (nav, route label, page title; keep its beanie subtitle). Route stays `/todo`.
13. **"Page welcome subtitle" CIG convention:** a shared component (Heritage-Orange Caveat, one per warm page); document in the beanies-theme skill + CIG; apply to Beanie Lists + retro-fit To-Dos.
14. **i18n:** every user-visible string via `uiStrings.ts` (en + beanie + zh); run `npm run translate`; review zh.
15. **Feature gate:** `familyLists` registered in `flagRegistry.ts` + committed `false` in `featureFlags.committed.ts`; gate the route, nav item, quick-add action, and briefing surfacing. With the flag OFF, behavior is identical to today.

## Important Notes & Caveats

- **CIG always wins over the mockup.** The mockup uses brand tokens already, but any conflict resolves to `.claude/skills/beanies-theme/SKILL.md` (Outfit/Inter/Caveat, five-colour palette, Heritage Orange for accents — **never Alert Red**, squircle ≥24px radii, soft shadows, three-tier modal system, rem-based text).
- **Reuse the To-Do system as the template** — model/store/repository/components mirror it; do not reinvent CRUD, member-filtering, completion, or modal patterns. `TodoViewEditModal.vue` already composes `BeanieFormModal`, `FrequencyChips`, `FamilyChipPicker`, `BeanieDatePicker`, and `confirm()` — the list detail modal reuses the same primitives, not new ones.
- **One owner, flat items** — keep the model lean; per-item assignees, list-to-list linking, item sub-sections, and AI auto-categorization are explicitly **out of scope** (deferred).
- **Recurrence reset must be idempotent and timezone-correct** — reset keys off `useToday` (the module singleton; date-dependent logic must read it, not `new Date()`); completing all items mid-cycle must fire the celebration only once per cycle (the `cycleCelebrated` guard).
- **Briefing surfaces whole lists, not items** — keep `useCriticalItems` clean: add `'list'` to its `CriticalItem.type` union + one deriver block (mirroring the existing to-do block, including the same no-due-date / overdue / due-today gating).
- **Notifications are DERIVED, not enqueued (important correction).** `notificationsStore` does **not** expose an "enqueue notification" API — it owns only the derive-clock, the drawer state, and per-member read-state writes to `FamilyDocument.notificationReads`. Every notification is reconstructed purely by `deriveNotifications(input, now)` in `src/utils/notifications.ts` over synced data, so each device computes the same list deterministically. The creator-notify ("Barry finished your list!") is therefore implemented as a **new derived notification kind** (`list-completed`): it is emitted whenever a list `createdBy === currentMember` was completed by someone else (`completedBy && completedBy !== createdBy`), reading the already-persisted `FamilyList` completed audit. No imperative push, no new stored notification record. This requires: one `NotificationKind` union member, one deriver block + a `lists` field on `DeriveInput`, a stable id builder (`listCompletedId(listId, completedAt)`), and one entry in `components/notifications/notificationKinds.ts` (`NOTIFICATION_KIND_PRESENTATION`). `deriveNotifications` must NEVER throw — the new block lives in its own try/catch like the others, skips a malformed record (or one with no `completedAt`) with a `console.warn`, and respects the rolling `windowDays` so old completions age out (NOT prune-exempt; no entry in `PRUNE_EXEMPT_PREFIXES`).
- **Celebration reuse** — use the shared `celebrate('goal-reached', { onUndo? })` from `useCelebration` (the same call `todoStore.toggleComplete` already makes), which already routes sound + reduced-motion through `useSounds`. Do not re-implement confetti/sound.
- **No new FAB** — the global `QuickAddFab` owns bottom-right; add an `add-list` action to `quickAddItems.ts` and a page header button only.
- **No silent failures** — every persisting store action wraps the repository call in the existing `wrapAsync` (`src/composables/useStoreActions.ts`), which already shows an error toast **and** calls `reportError` (engine-panic patterns get a friendly toast + a critical Slack report). Actions return the result-or-`null`/`false`, exactly like `todoStore` — callers branch on that. No bare `catch {}`, no action that swallows a failure.
- **Welcome subtitle stays disciplined** — one per page, accent only (Caveat is never a real label/header), on warm Treehouse pages only.
- **Flag-gating of route / nav / quick-add is net-new infra (correction).** There is today no `requiresFlag` route meta, no router guard reading flags, and no flag field on `NavItemDef` or the quick-add item shape. Rather than duplicate `isFlagEnabled('familyLists')` checks across the router guard, `AppSidebar.vue`, `MobileHamburgerMenu.vue`, and `QuickAddSheet`, add **one** small reusable mechanism (see Approach → Feature gate) and consume it in each surface. `isFlagEnabled` lives in `src/config/flags.ts`. The route side reuses the existing `requiresFinance` guard pattern verbatim (one `beforeEach` block, redirect to `/no-access`), so it adds **no new guard shape** — just a new flagged meta keyed off the same mechanism.

## Important: long-term-shape caveats (Pass 3)

These exist to stop the feature ossifying into a hard-to-maintain corner. They constrain the implementation, not the scope.

- **`FamilyList` holds two completion vocabularies on one flat interface** (one-off filing: `completed`/`completedBy`/`completedAt`; recurring cadence: `frequency`/`lastResetDate`/`cycleCelebrated`). To stop `lifecycle === 'recurring'` checks scattering across store, page, modal, briefing, and notifications, **all lifecycle-conditional reads go through three tiny pure predicates** in `@/utils/listLifecycle.ts`: `isRecurring(list)`, `isFiled(list)` (one-off && `completed`), and `isListDue(list, todayStr)` (the single due/overdue/due-today rule, mirroring `isTodoOverdue`). Every consumer (store computeds, `useCriticalItems`, the tile, the modal) imports these — they are the one place lifecycle semantics live, so a future cadence change is a one-file edit. Document the per-lifecycle field invariant in a doc-comment on `FamilyList`.
- **Cap template nesting on the board page.** `BeanieListsPage.vue` renders Due-soon + N category shelves + Completed; rendering all of that inline produces a deeply-nested mega-template that's hard to read and test. Extract a single presentational **`ListShelf.vue`** (title + collapse + `v-for` of `ListTile`) and render the page as a flat `v-for` of shelves — mirroring how the To-Do page splits out `TodoSection`. The page composable returns a flat `shelves: { key, titleKey, lists }[]` array; the template stays one level deep.
- **One write path for "an item changed" and one for "the clock advanced."** Completion/filing lives only inside `toggleItem`; recurrence reset lives only inside `reconcileRecurringLists`. No other action mutates `completed`/`lastResetDate`/`cycleCelebrated`. This keeps the state machine auditable.

## Assumptions

> **Review these before implementation.**

1. The To-Do system (`TodoItem`/`todoStore`/`TodoViewEditModal`/`TodoSection`/`FamilyTodoPage`/`QuickAddBar`) remains the closest reusable template and its patterns are current. (Verified: `todoStore` uses `wrapAsync` + `createMemberFiltered` + `celebrate`; `TodoViewEditModal` composes the shared form primitives; `toggleComplete` is the single complete/undo path and is exactly the shape `toggleItem` mirrors.)
2. The CRDT collection-registration path is unchanged: `types/automerge.ts` (`FamilyDocument` + `CollectionName`/`CollectionEntity`), `docService.ts` (`initDoc`/`ALL_COLLECTIONS`/`migrateDoc`), `createAutomergeRepository`. (Verified: `FamilyDocument` is a flat record-of-collections; adding `lists` to the interface, `initDoc`, and `ALL_COLLECTIONS` makes `migrateDoc` backfill old pods automatically. `CollectionName`/`CollectionEntity` derive from the interface, so no further type wiring.)
3. `useCriticalItems` is the single daily-briefing pipeline and its `CriticalItem.type` is an open union; the Nook upcoming/"this week" card reads from the same source. (Verified — `CriticalItem.type` is a string-literal union; adding `'list'` + one deriver block in the same `for`-loop style as the to-do block is the established extension pattern.)
4. `celebrate()`/`useSounds` are the celebration/sound primitives; the creator-notify is added as a **derived** kind in `utils/notifications.ts` (NOT via a notificationsStore enqueue — that API doesn't exist). (Verified — `deriveNotifications` is pure/total with per-record try/catch and a `windowDays` window; the new block fits that exact mould.)
5. The global `QuickAddFab` + `quickAddItems.ts` + `useQuickAddIntent` are the add-entry pattern; routes accept an `?action=` deep link, validated against `VALID_ACTIONS`. (Verified — `useQuickAddIntent` already toasts + `console.error`s on unknown action / handler throw; the router already strips orphan `?action=` on hide-quick-add routes.)
6. `flagRegistry.ts` + `featureFlags.committed.ts` + `isFlagEnabled('familyLists')` (from `src/config/flags.ts`) is the gating mechanism; `navigation.ts` drives sidebar (`AppSidebar.vue`) + mobile nav (`MobileHamburgerMenu.vue`) via `TREEHOUSE_ITEMS`. (Verified — `NavItemDef` has no per-item flag field today; this plan adds an optional `requiresFlag`. `navigation.ts` already has a module-load invariant pattern (`KNOWN_BADGE_KEYS`) that the new field follows: the `requiresFlag` value is validated against the flag registry at module load so a typo throws in tests.)
7. The travel-plan page (`src/pages/TravelPlansPage.vue`) has an "ideas" section whose visual pattern (`src/components/vacation/VacationIdeaCard.vue` + `src/components/travel/IdeaEditModal.vue`) can be mirrored for an embedded list; `FamilyActivity`/`FamilyVacation` carry ids the list can back-reference (the list stores the link, not the trip).
8. `useToday` is the timezone-correct date singleton for recurrence reset. (Verified — `todoStore` and `useCriticalItems` both destructure `const { today } = useToday()` and read `today.value`; the reset watcher does the same.)
9. The router's typed `RouteMeta` augmentation block (currently typing only `noChrome`) is the right place to add `requiresFlag` so the new guard is type-checked rather than reading an `unknown`-indexed meta. (Verified — `router/index.ts` already declares `module 'vue-router' { interface RouteMeta { noChrome?: boolean } }`; adding `requiresFlag?: DevFlag` there is a one-line, in-pattern extension.)

## Approach

> Mockup-driven: this implements `docs/mockups/family-lists-2026-06-16.html` (Direction C v4) faithfully, with every concrete style token sourced from the beanies CIG.

### Data model (`src/types/models.ts`)

```ts
export type ListCategory =
  | 'home'
  | 'out'
  | 'kids'
  | 'health'
  | 'celebrations'
  | 'trips'
  | 'projects'
  | 'me';
export type ListLifecycle = 'oneoff' | 'recurring';
export type ListFrequency = 'daily' | 'weekly' | 'monthly';

export interface FamilyListItem {
  id: UUID;
  title: string;
  completed: boolean;
  completedBy?: UUID;
  completedAt?: ISODateString;
}

/**
 * A named family checklist. The fields below are split by lifecycle —
 * read them only through the predicates in `@/utils/listLifecycle.ts`,
 * never via inline `lifecycle === …` checks, so the rule lives in one place:
 *   - one-off:   `dueDate?`, plus filing audit `completed`/`completedBy`/`completedAt`
 *   - recurring: `frequency` (required), `lastResetDate`, `cycleCelebrated`;
 *                `completed` stays false (recurring lists are never filed)
 * `dueDate` and `frequency` are mutually exclusive (enforced in the modal + store input builders).
 */
export interface FamilyList {
  id: UUID;
  title: string;
  emoji: string;
  category: ListCategory;
  ownerId: UUID; // single owner
  items: FamilyListItem[]; // flat
  lifecycle: ListLifecycle;
  dueDate?: ISODateString; // one-off only
  frequency?: ListFrequency; // recurring only
  lastResetDate?: ISODateString; // recurring bookkeeping
  cycleCelebrated?: boolean; // guard: celebrate once per cycle (recurring)
  linkedActivityId?: UUID;
  linkedVacationId?: UUID;
  templateKey?: string; // which template seeded it (audit/analytics)
  completed: boolean; // one-off: filed when true; recurring: always false
  completedBy?: UUID;
  completedAt?: ISODateString;
  createdBy: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
export type CreateFamilyListInput = Omit<FamilyList, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateFamilyListInput = Partial<Omit<FamilyList, 'id' | 'createdAt' | 'updatedAt'>>;
```

### Lifecycle predicates (`src/utils/listLifecycle.ts`) — the one home for lifecycle semantics

Three pure, Vue-free, unit-testable helpers consumed by store computeds, `useCriticalItems`, `ListTile`, and `ListDetailModal`:

- `isRecurring(list): boolean` — `list.lifecycle === 'recurring'`.
- `isFiled(list): boolean` — `!isRecurring(list) && list.completed` (the "in the Completed area" test).
- `isListDue(list, todayStr): 'overdue' | 'today' | 'noDue' | null` — the single due-state rule, mirroring `isTodoOverdue`/the to-do briefing gating (returns `null` for a future-dated list = "not on the plate yet"). Recurring lists are due-state-less here (the schedule, not a due date, drives them) → returns `null`.
  No other file re-derives these. A lifecycle change (e.g. a 4th frequency) touches this file + `computeRecurringReset`, nothing else.

### CRDT wiring

- `types/automerge.ts`: import `FamilyList`; add `lists: Record<string, FamilyList>` to `FamilyDocument` (placed with the other Pod collections). `CollectionName`/`CollectionEntity` derive automatically.
- `docService.ts`: add `lists: {}` to `initDoc`'s `initial` object **and** `'lists'` to `ALL_COLLECTIONS` (so `migrateDoc` backfills old pods on load/merge — no bespoke migration code).
- `src/services/automerge/repositories/listRepository.ts`: `const repo = createAutomergeRepository<'lists', FamilyList, CreateFamilyListInput, UpdateFamilyListInput>('lists')`, then re-export with the project's named-export convention (mirroring `todoRepository.ts`): `getAllLists = repo.getAll`, `getListById = repo.getById`, `createList = repo.create`, `updateList = repo.update`, `deleteList = repo.remove`. (The factory strips `undefined`, deep-plains Vue proxies, and stamps `createdAt`/`updatedAt` — do not re-do any of that.)

### Constants

- `src/constants/listCategories.ts`: ordered array of the 8 categories `{ id, labelKey, emoji, tintVar, dotColorVar }` (CIG tokens only). Add a `getListCategoryName(id)` helper mirroring `getActivityCategoryName`.
- `src/composables/useListCategoryLabel.ts`: id→translated label, mirroring `useActivityCategoryLabel` **exactly** (beanie mode → lowercased English; English → constant name directly; other locales → `t()` with fallback to the constant). Never throws.
- `src/constants/listTemplates.ts`: curated templates `{ key, categoryId, emoji, nameKey, lifecycle, frequency?, starterItemKeys: UIStringKey[] }`. A template only produces a `CreateFamilyListInput` seed; once created the list is a normal record.

### Store (`src/stores/listStore.ts`) — mirror `todoStore`

- State: `lists: ref<FamilyList[]>`, `isLoading`, `error` (same triple as `todoStore`).
- Computeds: `activeLists` (`!isFiled`), `completedLists` (`isFiled`), `dueSoonLists` (`isListDue` returns `'overdue' | 'today'` — built on the shared predicate, never re-deriving date math), `listsByCategory` (Map category→lists). Member-filtered variants via the existing `createMemberFiltered(lists, (l) => l.ownerId)` (single owner → returns a string; `createMemberFiltered` already handles a scalar id and treats no-id as always-included). Sorting reuses `todoStore`'s `byCreatedDesc`/`byCompletedDesc` comparator shape.
- Actions (each wrapped in `wrapAsync` with an `action: 'listStore:<name>'` label; returns result-or-`null`/`false` like `todoStore` — `wrapAsync` itself surfaces the toast + `reportError`, so no action re-implements error handling or fails silently): `loadLists`, `createList`, `createFromTemplate(key, overrides)`, `updateList`, `deleteList`, `toggleItem(listId, itemId, byMemberId)`, `addItem`, `removeItem`, `resetState`. Completion + auto-file is folded into `toggleItem` (below), not a separate public action, so there is one code path for "an item changed".
- **Recurrence reset:** a pure helper `computeRecurringReset(list, todayStr)` → `{ shouldReset: boolean; nextResetDate: ISODateString }` (no Vue, no `Date.now()` — fully unit-testable; lives in `@/utils/listLifecycle.ts` next to the predicates). `reconcileRecurringLists()` runs it for all recurring lists and persists via `updateList` (unchecking items + bumping `lastResetDate` + clearing `cycleCelebrated`). It is invoked **(a) at the end of `loadLists` (after `lists.value` is populated — never before, so a watcher race can't reconcile an empty set) and (b) from a `watch(today, …)` registered inside the store**. Idempotent: a second run on the same day is a no-op (`shouldReset` is false once `lastResetDate` is current), so the load-then-watch overlap is harmless. The watcher is registered once at store init and guards `if (!lists.value.length) return;`.
- **Completion logic (inside `toggleItem`):** after toggling, if the last open item just closed →
  - **one-off:** set `completed` + `completedBy` + `completedAt` (files it) via `updateList`; fire `celebrate('goal-reached', { onUndo })` where `onUndo` reverses the toggle + unfiles (exactly the `toggleComplete` undo shape).
  - **recurring:** do NOT file; fire `celebrate('goal-reached')` only if `!cycleCelebrated`, then set `cycleCelebrated = true` (cleared on next reset).
  - The creator-notify is **not** done here — it is derived (see below) from the persisted `completedBy`/`createdBy`, so it works on every device without a side-effecting write.

### Notifications — creator-notify as a derived kind

- `src/types/notifications.ts`: add `'list-completed'` to the `NotificationKind` union and to the `KindPresentation.accent` union (e.g. `'list'`).
- `src/utils/notifications.ts`:
  - add `lists: FamilyList[]` to `DeriveInput`;
  - add `listCompletedId = (listId: string, completedAt: string) => \`list-completed:${listId}:${completedAt}\``;
  - add a deriver block (own try/catch, `console.warn` + skip on malformed **or missing `completedAt`**) that, for the current member, emits one notification per filed list where `list.createdBy === currentMember.id` and `list.completedBy && list.completedBy !== list.createdBy` — title = list title, subtitle = finisher's name, `route: '/lists'`, `query: { view: list.id }`, `sourceId: list.id`, `occurredAt: list.completedAt`. Respects the existing rolling `windowDays` (uses the shared `inWindow(triggerMs)` helper keyed off `completedAt`) so old completions age out — it is NOT prune-exempt; no entry in `PRUNE_EXEMPT_PREFIXES`.
- `src/stores/notificationsStore.ts`: feed `lists: useListStore().lists` into the `snapshot` computed (mirroring how `todos`/`members` are already threaded). No new write API — reuses the existing pure derive + read-state machinery, so the new kind gets read/unread, drawer, and badge behavior for free.
- `src/components/notifications/notificationKinds.ts`: add one `NOTIFICATION_KIND_PRESENTATION['list-completed']` entry (accent + emoji, e.g. ✅ on the list accent), per the table's single-edit-surface contract.

### Pages & components (`src/pages/`, `src/components/lists/`)

- `BeanieListsPage.vue` (route `/lists`): header (`PageWelcomeSubtitle` + "New list" button), filter chips, then a **flat `v-for` over a `shelves` array** (Due-soon, category shelves, Completed) rendering `ListShelf.vue` — the page template stays one level deep (see the nesting caveat). A small page composable (or inline computed) maps the filtered/categorized store getters into `{ key, titleKey, lists, collapsible }[]`.
- `ListShelf.vue`: presentational — title + optional collapse (`useExpandableList` + `ShowMoreToggle` + `SmoothHeight`, the same trio the briefing toast uses) + `v-for` of `ListTile`. No store access; takes `titleKey` + `lists` + `collapsible` props and emits `open(listId)`. This is the one component that owns shelf chrome, so the board page and (if ever needed) the trip page can both reuse it.
- `ListTile.vue`: the refined tile (category-tinted strip + emoji + owner avatar with ring via `BeanieAvatar`; title; merged meta row [category · status pill — status via the `isFiled`/`isListDue` predicates, not inline checks]; progress bar + count). Tap → emits open. Purely presentational (props in, event out) so it's trivially testable.
- `ListDetailModal.vue`: **mirror `TodoViewEditModal.vue`** — `BeanieFormModal` shell; top **meta band** (category pill · owner via `FamilyChipPicker` single-select · prominent due-date chip via `BeanieDatePicker`); flat checkable items (add/remove/toggle); **"Repeats?"** section (`TogglePillGroup` one-off/recurring → `FrequencyChips` when recurring — both are generic `options` + `v-model:string` components, no subclassing needed); **"Due date"** section (one-off only); **"Link"** section (trip/activity picker — reuse `ActivityLinkDropdown`/`EntityLinkDropdown` if shape-compatible, else `BaseSelect`). The one-off/recurring toggle clears the now-invalid field (switching to recurring clears `dueDate`; switching to one-off clears `frequency`) so the mutually-exclusive invariant can't be violated from the UI. Delete via `confirm({ variant: 'danger', ... })` from `useConfirm` (same call `TodoViewEditModal` makes).
- `NewListSheet.vue`: category **pills** (reuse the chip pattern) + template **cards** (distinct) + "start blank". Opens `ListDetailModal` seeded from `createFromTemplate` / a blank `CreateFamilyListInput`.
- Embedded-on-trip rendering: extend `TravelPlansPage.vue` to render any list whose `linkedVacationId` matches, styled like `VacationIdeaCard.vue` (checkable, progress), reading/writing the same `listStore` entry — no second copy of the data. Reuse `ListTile` (or its progress/check sub-parts) rather than a parallel card so the two surfaces can't visually drift.
- Shared `src/components/ui/PageWelcomeSubtitle.vue`: the Caveat Heritage-Orange subtitle element (DRY — used by Lists + To-Dos; takes a `t()` key prop). Confirmed not to exist today; the current To-Dos subtitle is a plain muted `<p>{{ t('todo.subtitle') }}</p>` and is retro-fit to this component.

### Integrations

- **Quick-Add:** add an `add-list` entry to `QUICK_ADD_ITEMS` (Everyday group, `route: '/lists'`, `action: 'add-list'`, `requiredPermission: 'activities'`). `VALID_ACTIONS`/`QuickAddAction` derive automatically. On `/lists?action=add-list`, `useQuickAddIntent` (already try/catch-guarded with toast + `console.error`) opens `NewListSheet`. Flag-gate the item in `QuickAddSheet` (see Feature gate).
- **Daily briefing:** `useCriticalItems` — add `'list'` to `CriticalItem.type`; add one deriver block that surfaces due/coming-due whole lists (with progress in the message). It calls the shared `isListDue(list, todayStr.value)` predicate for the overdue/today/no-due gating (so the briefing rule and the store/tile rule can't diverge) and reuses the existing `buildMessage` pattern. **Visibility rule (Pass 4 — the one genuine gap):** the to-do block uses `classifyAudience` over an `assigneeIds` array; lists have a single `ownerId` instead, so do NOT copy `classifyAudience`'s array shape. Surface a due list to **its owner**, and mirror the to-do "adults also see a child's items" intent so a parent/adult sees a child-owner's due list — implement this as a tiny single-owner audience check (owner-id == current member, OR current member is an adult and owner is a child), not a re-use of the array-shaped helper. The Nook upcoming/"this week" card reads the same `criticalItems`, so it picks them up (tagged "List"). Gate the block behind `isFlagEnabled('familyLists')` (one guard at the top of the block).
- **Trip/activity link:** the list stores `linkedVacationId`/`linkedActivityId`; the travel-plan page renders the embedded list; the attach picker offers only present/upcoming items (reuse the existing `tripPhase`/upcoming filter). On trip/activity delete, clear the matching link on any list (`updateList(id, { linkedVacationId: undefined })`) so no orphan/crash — add this to the existing activity/vacation delete path. Because the embedded view derives purely from `linkedVacationId`, a cleared link simply stops rendering — no dangling reference, no extra cleanup state.
- **Nav + rename:** `navigation.ts` — add a Beanie Lists item under Treehouse (with the new `requiresFlag: 'familyLists'` field, see below); rename the To-Do item's `labelKey` copy to "To-Dos" (route stays `/todo`). Update `FamilyTodoPage.vue` title + render its subtitle via `PageWelcomeSubtitle`. Update `HINT_KEY_BY_PATH` if a `/lists` mobile hint is wanted.
- **Feature flag (single shared mechanism — DRY):**
  - `flagRegistry.ts`: add `{ id: 'familyLists', label: 'Beanie Lists', description: '…' }`. `featureFlags.committed.ts`: add `familyLists: false`.
  - Add an **optional** `requiresFlag?: DevFlag` field to `NavItemDef` (`navigation.ts`) and to the quick-add item shape. `requiresFlag` is typed `DevFlag`, so a typo is already a **compile error** at the literal call site; as belt-and-suspenders for any non-typed/dynamic source, mirror the existing `KNOWN_BADGE_KEYS` module-load invariant by validating each `requiresFlag` value with the already-exported `isKnownFlag` from `flagRegistry` (reuse it — do not re-derive registry membership) so a stale id throws in the navigation unit test rather than silently hiding an item forever. Then filter once where each is consumed: `AppSidebar.vue` + `MobileHamburgerMenu.vue` drop nav items whose `requiresFlag` is off; `QuickAddSheet` drops quick-add items whose `requiresFlag` is off (alongside the existing permission filter). Factor the "is this item's flag on?" test into one shared helper (e.g. `isItemFlagEnabled(item)`) so the four surfaces share identical logic.
  - Route: type `requiresFlag?: DevFlag` into the **existing `declare module 'vue-router'` `RouteMeta` augmentation** in `router/index.ts` (today it types only `noChrome`) so the guard reads a typed field, not an `unknown`-indexed cast. Add `meta: { requiresFlag: 'familyLists' }` to the `/lists` route and **one new `beforeEach` block modelled exactly on the existing `requiresFinance` guard** — redirect to `/no-access` when the flag is off. This is the only net-new guard, and it is the same shape as the finance one, so it adds no novel control flow.
  - Briefing: the one `isFlagEnabled('familyLists')` guard in the `useCriticalItems` list block (above).
  - Net effect with the flag OFF: no route, no nav item, no quick-add action, no briefing items, no derived list-completed notifications (lists collection is empty for everyone) — identical to today.

### i18n + theme

- `uiStrings.ts`: all new keys (page title, subtitle, categories, templates + starter items, statuses, empty states, completion + notification copy, link/attach copy, the `list-completed` notification line) with en + beanie + zh; run `npm run translate`; spot-check zh per `reference_translate_mymemory_review`.
- beanies-theme skill + `docs/brand/beanies-cig-v2.html`: document the **page welcome subtitle** convention; note `PageWelcomeSubtitle.vue` as the implementation; apply to Lists + To-Dos.

## Files Affected

**New**

- `src/constants/listCategories.ts`, `src/constants/listTemplates.ts`
- `src/composables/useListCategoryLabel.ts`
- `src/utils/listLifecycle.ts` (lifecycle predicates + `computeRecurringReset`; the single home for lifecycle semantics)
- `src/services/automerge/repositories/listRepository.ts`
- `src/stores/listStore.ts`
- `src/pages/BeanieListsPage.vue`
- `src/components/lists/ListShelf.vue`, `ListTile.vue`, `ListDetailModal.vue`, `NewListSheet.vue`
- `src/components/ui/PageWelcomeSubtitle.vue`
- tests: `listStore.test.ts`, `listLifecycle.test.ts` (predicates + `computeRecurringReset`), `useListCategoryLabel.test.ts`, `ListTile.test.ts`, `ListDetailModal.test.ts` (+ briefing + notifications-derive test updates)

**Modified**

- `src/types/models.ts` (FamilyList\* types + lifecycle field-invariant doc-comment)
- `src/types/automerge.ts`, `src/services/automerge/docService.ts` (collection registration + migration backfill)
- `src/types/notifications.ts`, `src/utils/notifications.ts`, `src/stores/notificationsStore.ts`, `src/components/notifications/notificationKinds.ts` (derived `list-completed` kind)
- `src/composables/useCriticalItems.ts` (`'list'` type + deriver block via `isListDue`, flag-gated)
- `src/constants/quickAddItems.ts` (`add-list` action + `requiresFlag` field) + `QuickAddSheet` (flag filter)
- `src/constants/navigation.ts` (`requiresFlag` field + module-load invariant; add Beanie Lists; rename To-Do label) + `src/components/common/AppSidebar.vue` + `src/components/common/MobileHamburgerMenu.vue` (shared flag filter)
- `src/router/index.ts` (`/lists` route + `requiresFlag` in the typed `RouteMeta` augmentation + one guard block mirroring `requiresFinance`)
- `src/config/flagRegistry.ts`, `src/config/featureFlags.committed.ts` (`familyLists`)
- `src/pages/TravelPlansPage.vue` (embed linked list) + the activity/vacation delete path (clear link)
- `src/pages/FamilyTodoPage.vue` (rename to "To-Dos"; use `PageWelcomeSubtitle`)
- `src/services/translation/uiStrings.ts` (+ generated `zh.json` via `npm run translate`)
- `.claude/skills/beanies-theme/SKILL.md` + `docs/brand/beanies-cig-v2.html` (welcome-subtitle convention)
- `docs/mockups/family-lists-2026-06-16.html` (approved mockup — committed with the change)

## Help Center Coverage

- **Action**: `new article`
- **Category**: `features`
- **Article type**: `how-to`
- **Slug**: `beanie-lists`
- **Title**: Using Beanie Lists
- **Scope**: How to create a family list (from a template or blank), pick a category + owner, set a due date or make it recurring, check items off, attach a list to a trip, and find completed lists — and how due lists show up in your daily briefing.
- **Notes**: Clarify the difference vs To-Dos (bundled checklist vs individual task); note recurring lists auto-reset and aren't filed away; note one owner per list. Written per `.claude/skills/beanies-help-docs/SKILL.md`, gated/published in step with the feature.

## Acceptance Criteria

- [ ] New Beanie Lists page renders the board: Due-soon shelf, category shelves, filter chips, Completed area, header welcome subtitle + New-list button (matches the approved mockup, CIG-compliant). The page template stays one level deep over a `shelves` array (each shelf is a `ListShelf`).
- [ ] Create a list (blank or from a template); template pre-fills name/emoji/category/recurrence/owner/starter items, then behaves as a normal list.
- [ ] Each list has one owner; items are flat; toggling items updates progress.
- [ ] One-off list with all items checked → filed to Completed (celebration via `celebrate('goal-reached')`; creator sees a derived `list-completed` notification when owner ≠ creator). Recurring list with all items checked → celebration once per cycle (`cycleCelebrated` guard), not filed, auto-resets next period.
- [ ] One-off lists can carry a due date; recurring lists carry a frequency and auto-reset (timezone-correct via `useToday`); the two are mutually exclusive, and the modal clears the invalid field on lifecycle switch.
- [ ] All lifecycle-conditional behavior (filing, due-state, recurring detection) reads through `@/utils/listLifecycle.ts` predicates — no inline `lifecycle === …` checks in store/page/modal/briefing/notifications.
- [ ] Due / coming-due **lists** (not items) appear in the daily briefing + Nook "this week" card (tagged "List") using the shared `isListDue` rule; no-due-date lists follow the to-do rule; tapping opens the list.
- [ ] A list can be attached to a present/upcoming activity or trip and renders on the travel-plan page like ideas; deleting the trip/activity clears the link with no orphan/crash.
- [ ] "New list" is reachable from the global Quick-Add sheet and the page header button; no second FAB added.
- [ ] "Family To-Do" is renamed to "To-Dos" (nav label, page title; route stays `/todo`); its beanie subtitle preserved, now via `PageWelcomeSubtitle`.
- [ ] The "page welcome subtitle" convention is documented in the theme skill + CIG and applied via `PageWelcomeSubtitle` on Beanie Lists + To-Dos.
- [ ] All new strings are en + beanie + zh; `npm run translate` run; no bare strings (passes the i18n lint rules).
- [ ] Feature is gated by `familyLists` via the shared `requiresFlag` mechanism (one shared `isItemFlagEnabled` filter for nav + quick-add; typed `RouteMeta` + a finance-style guard for the route); a stale `requiresFlag` id throws at module load (navigation unit test). With the flag OFF, the app is unchanged (no page, no nav item, no quick-add action, no briefing items, no list-completed notifications).
- [ ] No silent failures: every persisting action goes through `wrapAsync` (toast + `reportError` on failure); the derived `list-completed` block can't throw the bell (own try/catch, skips missing `completedAt`).
- [ ] Recurrence reconcile runs only after `loadLists` populates the collection and on `today` change; a second same-day run is a no-op (idempotent); it never reconciles an empty set.
- [ ] Help Center article `beanie-lists` added and verified to match shipped behavior.
- [ ] `npm run validate` green (type-check + lint + tests + build).

## Testing Plan

1. **Unit (Vitest):**
   - `listLifecycle`: `isRecurring`/`isFiled`/`isListDue` across one-off (due/overdue/today/future/no-due) and recurring; `computeRecurringReset` daily/weekly/monthly boundaries, idempotency (second same-day run is a no-op), no reset mid-period, timezone via mocked `useToday` (per `reference_usetoday_test_mock`).
   - `listStore`: create/update/delete; `createFromTemplate` seeds correctly; `toggleItem` updates progress; one-off all-checked → completed/filed + `celebrate` called; recurring all-checked → `celebrate` called once (cycle guard) + not filed; `reconcileRecurringLists` runs after load and on `today` change, no-ops on empty/same-day; failure path (mock repo throw) → action returns null/false and `wrapAsync` toast/report fired (no silent pass).
   - `dueSoonLists` / `listsByCategory` / member-filter-by-owner computeds (all built on the predicates).
   - `useCriticalItems`: due list surfaces as a whole-list briefing item via `isListDue`; no-due-date rule; gated off when `familyLists` off.
   - `deriveNotifications`: a list completed by someone else for the creator yields one `list-completed`; self-completion yields none; missing `completedAt` / malformed list is skipped (no throw); ages out past `windowDays`.
   - `useListCategoryLabel`: id→translated label across en/beanie/zh, fallback on missing key.
   - `navigation`: a `requiresFlag` value not in the flag registry throws at module load (the new invariant).
2. **Component:** `ListTile` (renders category/owner/progress/status via predicates, emits open), `ListShelf` (renders title + tiles + collapse, emits open), `ListDetailModal` (one-off shows due date; recurring shows frequency + no due date; lifecycle switch clears the invalid field; link section).
3. **E2E (only if it fits the 25-test budget — Three-Gate Filter):** at most one journey — create a list from a template, check all items, see it filed/celebrated — asserting via IndexedDB export, no `waitForTimeout`. If it doesn't clear the gate, rely on unit coverage and log the decision in `docs/E2E_HEALTH.md`.
4. **Manual:** flag on in dev; walk the mockup surfaces (board, detail, new-list, trip attach, briefing/Nook, creator-notify in the bell); flag off → confirm zero footprint (route redirects, no nav item, no quick-add action); beanie + zh modes; reduced-motion + sound settings respected.
5. `npm run validate`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full feature from the approved mockup — FamilyList model + CRDT wiring, listStore mirroring todoStore, page/tile/detail/new-list components, recurrence reset, completion/celebration/notify, briefing + Nook integration, trip attach, Quick-Add add-list, To-Do rename, PageWelcomeSubtitle convention, feature gate, i18n, Help Center article, tests.
- **Pass 2 (DRY / error-handling, verified against the codebase)**: Read every cited file. Corrected the creator-notify mechanism — `notificationsStore` has no enqueue API; notifications are pure-derived in `utils/notifications.ts`, so the notify is re-specified as a new derived `list-completed` kind (union member + deriver block + `DeriveInput.lists` + presentation entry + snapshot wiring), inheriting read-state/drawer/badge for free with no stored record. Fixed the celebration call to the shared `celebrate('goal-reached', { onUndo })` (no re-implementing confetti/sound). Clarified that store actions return result-or-null/false and `wrapAsync` itself does the toast + `reportError` (no per-action error code, no silent failures). Switched the repository to named exports (`getAllLists`/`createList`/…) per `todoRepository`. Named the real files: travel-plan page is `TravelPlansPage.vue`, ideas pattern is `VacationIdeaCard.vue`/`travel/IdeaEditModal.vue`, `isFlagEnabled` lives in `flags.ts`. Flagged that route/nav/quick-add flag-gating is net-new infra and consolidated it into ONE shared `requiresFlag` field/meta + guard reused across router, sidebar, mobile nav, and quick-add (instead of scattering `isFlagEnabled` calls). Removed the redundant separate `completeList`/`resetRecurring` public actions (folded completion into `toggleItem`; reset via `reconcileRecurringLists`) and reused existing date helpers + `createMemberFiltered`'s scalar-id support.
- **Pass 3 (Sustainability / maintainability / reliability, verified against the codebase)**: Re-read `todoStore`, `useCriticalItems`, `utils/notifications`, `types/automerge`, `navigation`, and `router/index` to confirm the structural seams. Hardened long-term shape without weakening any Pass-2 decision: (1) Extracted **`@/utils/listLifecycle.ts`** as the single home for lifecycle semantics (`isRecurring`/`isFiled`/`isListDue` + `computeRecurringReset`), so store, page, tile, modal, briefing, and notifications all read one rule instead of scattering `lifecycle === …` and re-deriving due-date math — collapsing the dual-vocabulary `FamilyList` shape risk to one file. (2) Capped board-page nesting by splitting out a presentational **`ListShelf.vue`** and rendering `BeanieListsPage` as a flat `v-for` over a `shelves` array (mirroring `TodoSection`); kept `ListTile`/`ListShelf` props-in/event-out so they're trivially testable and reusable on the trip page (no parallel card → no visual drift). (3) Made the route guard type-safe and same-shape: `requiresFlag` is added to the **existing typed `RouteMeta` augmentation** and gated by a `beforeEach` block modelled exactly on `requiresFinance` (no novel control flow); the nav/quick-add `requiresFlag` field gets a **module-load invariant** mirroring `KNOWN_BADGE_KEYS` so a stale flag id throws in tests, and the four consumers share one `isItemFlagEnabled` helper. (4) Tightened reconcile reliability: reset runs only **after** `loadLists` populates the collection (and on `today` change), guards against an empty set, and stays idempotent — closing the watcher-race window. (5) Made the derived `list-completed` block skip records with no `completedAt` and reuse the shared `inWindow` helper so it ages out exactly like the other kinds. Added a per-lifecycle field-invariant doc-comment on `FamilyList` and a `lifecycle === …`-free acceptance criterion + tests for the new seams.

- **Pass 4 (Fresh-eyes final sweep, verified against the codebase)**: Re-verified every load-bearing claim (migration backfill via `migrateDoc` on load+merge; `wrapAsync`/`celebrate`/`createMemberFiltered` shapes; derived-notification mould; typed `RouteMeta`). Plan confirmed solid. Three minimal high-value edits only: (1) specified the daily-briefing **visibility rule for single-owner lists** — the one genuine gap — so an implementer surfaces a due list to its owner (+ adults-see-a-child's, mirroring the to-do intent) with a single-owner check rather than mis-copying the array-shaped `classifyAudience`; (2) reused the already-exported `isKnownFlag` for the nav module-load invariant (DRY) and clarified that `requiresFlag: DevFlag` is already compile-checked (the runtime check is belt-and-suspenders); (3) no other changes — the four-pass plan is implementation-ready.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (slash command)

/beanies-plan — "please create the plan" (preceded by /beanies-pre-plan intake for Notion #33)

### Assembled pre-plan prompt (Notion #33 → beanies-plan prompt)

The full `=== BEANIES PRE-PLAN ===` block for Beanie Lists (Feature, High, All platforms, new Treehouse page + Nook/briefing + trip-embed + rename Family To-Do → To-Dos). Scope: 8 Fair-Play-inspired categories; one owner per list; flat items; one-off (due date) vs recurring (auto-reset); templates as seeds; completed area; attach to activity/travel plan (renders on trip page like ideas); whole-list briefing + upcoming Nook card; completion celebration + creator notification; add-list via global Quick-Add + header button (no new FAB); new CIG "page welcome subtitle" convention applied to Lists + retro-fit To-Dos. Out of scope: kanban/projects/drag-drop, per-item assignees, list-linking, item sub-sections, AI auto-categorization. GitHub issue: SKIP. Feature gate: YES (`familyLists`). Mockup: docs/mockups/family-lists-2026-06-16.html.

### Intake decisions (from /beanies-pre-plan clarify rounds)

- Categories = 8 Fair-Play-inspired, renamed (not copied).
- Recurrence IN scope = auto-reset on schedule.
- One owner per list (per-item assignees + list-linking deferred).
- Flat lists (no sections; no AI auto-categorization).
- Briefing = whole lists; Nook "this week" card too; reuse global Quick-Add FAB (no new FAB).
- Detail: no start date; Repeat is its own control; due date only for one-off; category+owner+due at the top.
- Feature name "Beanie Lists"; rename "Family To-Do" → "To-Dos".
- Mockup approved at v4 (Direction C).

</details>
