# Plan: Copy a Beanie List, once or for several beans at once

> Date: 2026-09-07
> Related issues: None — direct implementation. Notion tracker row #91 (`3d4247d9-a99f-8141-8e34-f8c8fe9cbc82`)
> Plan file: `docs/plans/2026-09-07-list-copy-for-beans.md`
> Mockup: `docs/mockups/list-duplicate-2026-09-07.html`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent setting up chores, I want to copy an existing list to one or more of my beans, so that
each child gets their own copy without me retyping the same items three times.

## Context

Beanie Lists (#33) shipped with a curated template set (`LIST_TEMPLATES` in
`src/constants/listTemplates.ts`, seeded through `listStore.createFromTemplate`). What it never got
was a way to copy a list the family **already has**. The reported pattern is the per-child chore
list: the same five items, one list per kid, and today the second and third are typed by hand.

`FamilyList` is deliberately single-owner (`ownerId`, with "no per-item assignees" written into the
type at `src/types/models.ts:804`), so the fix cannot be one shared list with per-child ticks. It has
to be N independent lists, made cheaply. This plan makes the creation gesture cheap and is explicit
with the user that the copies then drift apart.

## Requirements

1. A **copy** icon button appears top-right of every list tile, beside a **delete** icon button,
   following the `BeanCard.vue` action-cluster convention (`h-9 w-9 rounded-lg`, 16px glyph,
   `@click.stop`, neutral base, orange hover for copy, red hover for delete).
2. `ListTile`'s root stops being a `<button>` so the action buttons are valid HTML, and the tile
   **remains fully keyboard operable** with the actions as separate tab stops.
3. The owner `MemberChip` moves out of the tinted strip into the body row beside the category label,
   freeing the strip's right side for the action cluster at the 2-across mobile width.
4. Copy opens a modal (`BeanieFormModal`) containing exactly two controls: a **title field**
   pre-filled with a `{bean}` token, and a **`FamilyChipPicker` in `multi` mode**.
5. Selecting N beans and confirming creates **N lists in one user action** — and, per Approach §1,
   in **one atomic Automerge change**, one per selected bean, each owned by that bean.
6. Each copy clones: `title` (after token expansion), `emoji`, `category`, `lifecycle`, `cadence`,
   the `frequency` shadow, and item titles **in order**. Its `ownerId` is the selected bean and its
   `createdBy` is the member performing the copy — both are required fields on
   `CreateFamilyListInput` (`models.ts:830,835`), so neither may be left to inference.
7. Each copy resets: fresh item `id`s, `completed: false` with `completedBy`/`completedAt` cleared on
   every item; the list's own `completed`/`completedBy`/`completedAt` cleared; `cycleCelebrated: false`;
   `lastResetDate` stamped to today when the list is recurring.
8. Each copy **drops** `linkedActivityId` and `linkedVacationId`.
9. Each copy carries **no** `ListCycle` history.
10. The modal states plainly that copies are not linked to the original.
11. The delete icon on the tile routes through the same confirm gate the drawer already uses —
    `confirm({ variant: 'danger' })` from `@/composables/useConfirm` — via the shared
    `useListDeletion` composable. It is never a one-tap destroy.
12. All new user-visible text goes through `t()` with both `en` and `beanie` values.

## Important Notes & Caveats

- **`ListDetailModal` has nothing to remove.** The intake carried a scope item about deleting
  "redundant whole-list action rows from the bottom of `ListDetailModal`". Those rows **do not exist**
  in the code — they only ever appeared in a superseded first draft of the mockup. `ListDetailModal`
  is a `BeanieFormModal` with `showDelete`, wired `@delete="handleDelete"` (line 364 -> 334), which
  already runs the confirm gate. Its `handleDelete` body is replaced by a call to the shared
  `useListDeletion` composable (§7); **its user-facing behaviour is unchanged except that a failed
  delete now reports instead of silently closing the drawer.**
- **The confirm gate is `confirm()`, NOT `useConfirm()`.** `useConfirm()` takes no arguments and is
  the renderer composable `ConfirmModal` consumes (`src/composables/useConfirm.ts:98`). The gate is
  the module-level `export function confirm(options)` (`useConfirm.ts:72`), imported as
  `confirm as showConfirm` — exactly how `ListDetailModal.vue:11` and `useMemberRemoval.ts:18` do it.
  Its `title`/`message` are typed `UIStringKey`, not raw strings.
- **`role="button"` + `tabindex="0"` on the tile root would be an ARIA violation** once the tile
  contains real buttons (a `button` role must not contain interactive descendants). Use the
  stretched-overlay pattern in Approach instead. `BeanCard`'s `<article @click>` is _not_ keyboard
  operable; do not copy that half of the convention.
- **The overlay shadows the status pill's hover tooltip, and that is an accepted trade.** The pill
  truncates and "carries the full text as its title" by design (`ListTile.vue:40-42`, `:title` at
  `:96`). Any full-tile click overlay sits above it, so the native tooltip will no longer fire on
  hover. The attribute stays (it is still the element's accessible description, and it is correct
  markup), and nothing becomes unreachable: `ListDetailModal` renders the same
  `useRecurrenceLabel().describe()` output one tap away (`ListDetailModal.vue:43,253`). Do **not**
  "fix" this by giving the pill `relative z-20` — that creates a dead click zone in the middle of the
  tile, which is worse than a lost tooltip.
- **`BeanieIcon` fails silently on an unknown name** — it renders a three-dot placeholder rather than
  erroring, and that is deliberate and documented (`BeanieIcon.vue:29-43`). Both names this plan uses
  are verified present in `src/constants/icons.ts`: `copy` (line 194) and `trash` (line 80). No new
  icon is needed.
- **`BeanieIcon`'s size scale is not `ActionButtons`' size scale.** `BeanieIcon size="lg"` is
  `h-6 w-6` (`BeanieIcon.vue:24`), but the convention being copied is a **36px button around a 16px
  glyph** (`BeanCard.vue:254-258` — `h-9 w-9` + `size="sm"`). `ActionButtons` today forwards
  `:size="size"` straight through (`ActionButtons.vue:32,42`), so adding an `lg` button size without
  breaking that link would render a 24px glyph. §4 maps the two scales explicitly.
- **Do not double-page Slack.** `showToast('error', …)` auto-calls `reportError` at severity `error`
  (`useToast.ts:120-143`), and only `severity: 'critical'` pages Slack (`errorReporter.ts:275`).
  `wrapAsync`'s catch calls `showToast('error', …)` (`useStoreActions.ts:74-96`). So the copy failure
  path reports **once** explicitly at `surface: 'list-copy'` / `critical` (the page), then rethrows and
  lets `wrapAsync` own the user toast, the `error` ref and the engine-panic classification. Adding a
  second `reportError` around the rethrow, or catching without rethrowing, both make this worse. The
  table at the end of §2 is the contract; change it there or not at all.
- **`wrapAsync` collapses a throw into the action's sentinel.** Its signature is
  `Promise<T | undefined>` and its catch ends `return undefined` (`useStoreActions.ts:53-58`, `:98`),
  so a store action that advertises `Promise<X | null>` must end in `?? null` — exactly as `createList`
  (`listStore.ts:388`) and `deleteList` (`:469`) do. The consequence to hold in mind: **`?? null`
  makes a thrown failure indistinguishable from a graceful `null` at the call site.** That is fine and
  intended — both mean "nothing was created, and the user has already been told" — but it is why
  callers branch on **falsy** (`if (!result)`) rather than on a specific sentinel, so the check cannot
  silently invert if the coercion is ever dropped.
- **No new telemetry context keys.** `src/utils/diagnosticContext.ts:61` documents that features reuse
  `action` / `kind` / `error_code` rather than adding their own, and `openCycle.ts:174` records that
  counts ride in `message`, which bypasses the allowlist by design. Following that costs **no**
  `ALLOWED_CONTEXT_KEYS` change and **no** store data-collection redeclaration. Do not add a key.
- **Concurrency:** another session is working on compaction and beanpod sync in this same working
  tree. This change stays inside `src/stores/listStore.ts`, `src/utils/listSeed.ts`,
  `src/components/lists/*`, `src/components/ui/ActionButtons.vue`, `src/pages/BeanieListsPage.vue`,
  `src/services/translation/uiStrings.ts` and their tests — plus **one** addition to
  `src/services/automerge/repositories/listRepository.ts` (§1). That file is 15 lines of re-exports
  and has no compaction/sync surface, so the conflict risk is near zero; nothing under
  `src/services/sync/`, `fileSync.ts`, or the rest of `src/services/automerge/` is touched.

## Assumptions

> **Review these before implementation.** Verified at planning time against the files cited.

1. `familyLists` is enabled in committed prod flags (`src/config/featureFlags.committed.ts:14` ->
   `familyLists: true`), so this ships visible with no gate.
2. `ListShelf` renders `ListTile` in `grid grid-cols-2 gap-3 lg:grid-cols-4` in **two** places — the
   banded branch (`ListShelf.vue:62-69`) and the flat branch (`:72-74`). §6 collapses these to one.
3. `FamilyChipPicker` in `mode="multi"` pushes a `string[]` through `update:modelValue`
   (`FamilyChipPicker.vue:64-77`), though the emit is **typed** as the union `string | string[]`
   (`:41-43`). Binding a `ref<string[]>` with plain `v-model` is nonetheless proven —
   `MealEditModal.vue:221` does exactly that and type-checks today — so no hand-rolled narrowing
   handler is needed. `showShared` defaults to `false` (`:33`), so no "Shared" pseudo-member appears
   unless asked for. Pets are excluded by default (`:34`, `:50-53`) — correct for chore lists.
4. `fillTemplate` leaves unmatched `{placeholders}` untouched (`fillTemplate.ts:11`) and uses a
   function replacer so a `$` in a member name cannot corrupt the output (`:23`). Both properties are
   load-bearing for the two-stage `{bean}` expansion.
5. **The Automerge worker supports atomic batches.** `MutationOp` includes `{ op: 'batch'; ops }`
   (`worker/protocol.ts:127`); `worker/docOps.ts:628-630` recurses it inside a single
   `Automerge.change`, and `worker/docOps.ts:676-679` states it outright: _"A `batch` (and a single
   op) is exactly ONE `Automerge.change` -> atomic: a mid-batch throw commits nothing."_
   `listCycleRepository.ts` already relies on this at lines 70, 86 and 103.
6. `familyStore.currentMember?.id ?? ''` is the established way a list-creating component names the
   actor (`NewListSheet.vue:20`, used for `createdBy` at `:52`). The copy path uses the same accessor.

## Approach

Mockup: `docs/mockups/list-duplicate-2026-09-07.html` (Direction A, approved). Every concrete token
comes from `.claude/skills/beanies-theme/SKILL.md` + the CIG, not from the mockup's raw values.

The feature splits into three layers with one direction of dependency and no back-edges:

```
src/utils/listSeed.ts        pure rules   — what a copy contains (reqs 6-9). No store, no clock, no I/O.
src/stores/listStore.ts      orchestration — resolve, delegate, mirror, report.
listRepository.createLists   the write     — one atomic batch, verified.
```

Nothing above reaches down past its neighbour, and the layer carrying the rules most likely to drift
is the one with no dependencies at all.

### 1. Repository — one atomic batch create

Add **one** function to `src/services/automerge/repositories/listRepository.ts`:

```ts
export async function createLists(inputs: CreateFamilyListInput[]): Promise<FamilyList[]>;
```

- Returns `[]` immediately on an empty input, before touching `mutate` — an empty batch is a pointless
  `Automerge.change`, projection delta and sync payload. `deleteCycles` sets this precedent
  (`listCycleRepository.ts:85`, `if (!ids.length) return;`).
- Builds every entity exactly the way `createAutomergeRepository.createWithId` does
  (`automergeRepository.ts:76-89`): `generateUUID()`, one shared `toISODateString(new Date())` for
  `createdAt`/`updatedAt`, and `toPlain(stripUndefined({...}))` — both already exported from
  `automergeRepository.ts`, and `listCycleRepository.ts` imports them the same way.
- Issues **one** `mutate({ op: 'batch', ops })` of `set` ops. One `Automerge.change`, one worker RPC,
  one projection delta, one sync payload.
- **Verifies** afterwards with one `projectionGetById('lists', id)` per created id
  (`projection.ts:124`) — not a full `list('lists')` scan per id. A missing id throws
  `new Error('createLists: N of M lists missing from the projection after a batch write')`.

  _What this check is and is not._ A `set` op cannot silently no-op the way a `patch`/`delete` with
  `onMissing:'skip'` can (`worker/docOps.ts:591-593`), and `deltaFor` echoes `op.entity` for a `set`
  without re-reading the committed doc (`:643-645`). So this is **not** a guard against the worker
  writing nothing — it is a guard on the projection-delta application that the store's array mirror
  and every subsequent read depend on. Three lines to make "the write landed where readers look" an
  assertion rather than an assumption.

- Returns the created entities so the store can mirror them in one array write.

**Why this replaces the loop.** An earlier draft called `listStore.createList` once per bean. That
store action is itself `wrapAsync`-wrapped with `errorToast: true` and replaces `lists.value` and
calls `trackFeature` on every call (`listStore.ts:377-389`) — so three failures meant three error
toasts, three whole-shelf re-renders and three `feature_used` events, and the outer `wrapAsync` would
have wrapped the inner one. The batch is simpler, atomic, and one of each.

### 2. Store — one action, `listStore.copyListForMembers`

```ts
/**
 * Copy `sourceId` once per selected bean, in ONE atomic write.
 * @returns the created lists, or `null` when nothing was created — for ANY
 *          reason, graceful or thrown. Every `null` has already been toasted
 *          and reported; see the failure contract below.
 */
async function copyListForMembers(
  sourceId: string,
  memberIds: string[],
  titleTemplate: string
): Promise<FamilyList[] | null>;
```

The body is orchestration only — every rule about _what a copy contains_ lives in §3:

- Resolves the source from the **projection** (`projectionList('lists')`), not the reactive array —
  the same defence `deleteList` uses (`listStore.ts:443-469`) so a stale array cannot fake the answer.
- Resolves each `memberId` through `useFamilyStore()`. An unresolvable id **throws** with a precise
  message. Ids come straight from `FamilyChipPicker`, which renders `familyStore` members, so an
  unknown id is a bug — and creating a list with a dangling `ownerId` would be worse than failing.
- Calls `buildCopySeeds({ source, owners, titleTemplate, today: today.value, createdBy })` (§3) —
  pure, cannot fail — then one `listRepo.createLists(seeds)`.
- `createdBy` is `useFamilyStore().currentMember?.id ?? ''`, matching `NewListSheet.vue:20,52`. The
  copy's author is the parent who pressed the button, **not** the source list's original creator.
- Mirrors the result into the store with **one** write: `lists.value = [...lists.value, ...created]`.
- Wrapped in `wrapAsync(isLoading, error, …, { action: 'listStore:copyListForMembers' })` and ends
  `return trackFeature(result ?? null, 'list')` — `wrapAsync` returns `T | undefined`
  (`useStoreActions.ts:53-58`), so without the coercion the declared type is a lie.
- `trackFeature` fires **once** for the action, and only on a non-null result.

**Failure contract.** One row per reachable outcome. Everything about toasts, pages and the modal's
reaction is decided here; §9 and _Observability Coverage_ only restate it.

| Outcome                         | Action returns           | Reports                                                                          | Toasts                           | Modal      |
| ------------------------------- | ------------------------ | -------------------------------------------------------------------------------- | -------------------------------- | ---------- |
| N lists created                 | `FamilyList[]`           | `logEvent` info `copy_completed`                                                 | success toast (modal)            | closes     |
| Source gone from the projection | `null` (graceful)        | `reportError` **warning** `copy_missing_source`                                  | explicit `showToast('error', …)` | stays open |
| Unknown member id               | `null` (thrown, coerced) | `reportError` **critical** `copy_failed` / `unknown-member`, then **rethrow**    | `wrapAsync`                      | stays open |
| Batch write rejects             | `null` (thrown, coerced) | `reportError` **critical** `copy_failed` / `batch-write-threw`, then **rethrow** | `wrapAsync`                      | stays open |
| Verify read finds a gap         | `null` (thrown, coerced) | `reportError` **critical** `copy_failed` / `verify-missing`, then **rethrow**    | `wrapAsync`                      | stays open |

Two rules fall out of the table and must survive future edits. First, **exactly one toast and at most
one Slack page per outcome** — the graceful row toasts explicitly _because_ it does not throw; the
thrown rows must not toast themselves, because `wrapAsync` already does. Second, **the caller branches
on falsy** (`if (!result)`), not on `=== null`: the `?? null` coercion is what makes every failure a
single sentinel, and a caller written against that specific value would silently invert into
"success" the day someone widens the signature. `error_code` values are short stable strings, the same
convention `syncStore`/`authStore` use. The missing-source row is deliberately a graceful warning with
its own toast rather than a throw: another device deleting the list mid-gesture is a race, not a
defect, and paging Slack for it would be noise.

### 3. Seed derivation — a pure module, `src/utils/listSeed.ts`

The rules for what a copy contains (requirements 6-9) are the part of this feature most likely to
drift as `FamilyList` grows fields. They go in a pure module with no store, no clock and no I/O:

```ts
/** Items for a brand-new list: fresh ids, nothing ticked. Shared with the template path. */
export function freshItems(titles: string[]): FamilyListItem[];

/** One `CreateFamilyListInput` per owner, in selection order. Pure. */
export function buildCopySeeds(args: {
  source: FamilyList;
  owners: { id: string; name: string }[];
  titleTemplate: string;
  today: string;
  createdBy: string;
}): CreateFamilyListInput[];
```

This is the same shape `completedListBands.ts` argues for in its own header ("Pure: takes the lists
and today's date… testable rather than only observable in December") and that `expiredCycleIds` gets
for the cycle-sweep rule (`listCycleRepository.ts:74-77`). It also keeps `listStore.ts` — already 830
lines — from absorbing another block of field-by-field policy.

`createFromTemplate` (`listStore.ts:398-422`) and the copy path share exactly one non-obvious rule:
items are rebuilt with fresh ids and unticked. `freshItems` is that rule and nothing else;
`createFromTemplate` changes by one line (its inline `.map` becomes the call) and is otherwise
byte-identical, because it is working, tested code in a concurrent working tree.

Inside `buildCopySeeds` the seed is a flat literal, which makes requirements 6-9 legible at a glance:

- Per-bean title: `fillTemplate(titleTemplate, { bean: owner.name }).trim() || source.title`. The
  fallback means an emptied token never yields a nameless list, and no validation branch is needed in
  the UI for it.
- Carried: `emoji`, `category`, `lifecycle`, `cadence`, `frequency`, `freshItems(source.items.map(i => i.title))`.
- `ownerId: owner.id`, `createdBy` from the argument.
- Always `completed: false`, `cycleCelebrated: false`.
- `lastResetDate: isRecurring(source) ? today : undefined` — via the shared predicate
  (`listLifecycle.ts:18`), never an inline `lifecycle === …`, per the store's own invariant at
  `listStore.ts:88-89` and the type's own instruction at `models.ts:789-791`.
- Deliberately **absent**, and therefore never copied: `linkedActivityId`, `linkedVacationId`,
  `completedBy`, `completedAt`, `dueDate`, `templateKey`.

`templateKey` is **not** carried to a copy: it means "which curated template seeded this", and a copy
of a copy was seeded by neither. Leaving it off keeps that field honest for analytics.

### 4. `ActionButtons` — one more button, not a configuration language

`src/components/ui/ActionButtons.vue` is already the app's icon-action cluster, used at
`AccountsPage.vue:632` and `TransactionsPage.vue:1352,1360`. Extend it **additively and statically**:

- Three boolean visibility props with today's pair as the default, so all three existing call sites
  are untouched:
  `withDefaults(defineProps<{ size?: 'sm'|'md'|'lg'; editTestId?: string; showEdit?: boolean; showCopy?: boolean; showDelete?: boolean }>(), { size: 'sm', showEdit: true, showCopy: false, showDelete: true })`.
  (`showDelete`, not `delete` — `delete` is a JS keyword and cannot appear bare in a template
  expression.) Emits become `edit` / `copy` / `delete`, all literal, all greppable. `copy` shadows the
  native clipboard event name, which is harmless: a name declared in `defineEmits` is removed from
  attribute fallthrough, so `@copy` on the component binds the custom emit.

  A data-driven `actions?: IconAction[]` prop was considered and rejected: it would add an exported
  type, a caller-side `TILE_ACTIONS` constant, a `fire(key)` dispatcher and a tone-to-class map to a
  45-line component with three call sites, and would make "who emits `copy`?" unanswerable by grep.

- One `SIZES` map, because the button scale and the glyph scale are **not** the same scale:

  ```ts
  const SIZES = {
    sm: { btn: 'p-1.5', glyph: 'sm' },
    md: { btn: 'p-2', glyph: 'md' },
    lg: { btn: 'flex h-9 w-9 items-center justify-center', glyph: 'sm' },
  } as const;
  ```

  `sm`/`md` reproduce today's behaviour exactly. `lg` is the `BeanCard` / CIG touch target
  (`BeanCard.vue:254`) — a 36px button around a 16px glyph — which a bare `:size="size"` passthrough
  would have rendered as a 24px glyph (`BeanieIcon.vue:24`).

- Hoist the shared button classes to one `BASE` const with a per-tone hover suffix
  (`hover:text-primary-600` for edit and copy, `hover:text-red-600` for delete). Going from two
  buttons to three would otherwise put the same ~120-character class string in the file three times.
  `primary-600` is the brand's hover/dark shade of Heritage Orange (`--color-primary-dark`,
  `style.css:73`; Heritage Orange itself is `primary-500`, `style.css:80`) and is already exactly what
  this component's edit button uses (`ActionButtons.vue:26`) — so requirement 1's "orange hover" is
  satisfied by reusing the existing token, with no second literal introduced alongside `BeanCard`'s
  generic `orange-600`.
- **Bug fix while here:** neither of its buttons carries `type="button"` (`ActionButtons.vue:23,34`),
  so inside a `<form>` they submit it. Add it to all of them.
- Stop-propagation needs no new code: both existing call sites already pass `@click.stop` as a
  fallthrough attribute onto the component's single root `div` (`AccountsPage.vue:634`,
  `TransactionsPage.vue:1354`), and `ListTile` does the same.

### 5. `ListTile` — accessible card with actions

Root becomes `<article class="group relative …">` (no `role`, no `tabindex`), carrying the current
root classes minus `type`/`text-left` (`text-left` exists only to undo a `<button>`'s centred default).
Inside it:

1. The existing tinted strip, **unchanged except** that the owner `MemberChip` leaves it and
   `<ActionButtons size="lg" :show-edit="false" show-copy class="relative z-20" @click.stop
@copy="emit('copy', list.id)" @delete="emit('delete', list.id)" />` takes its place in the strip's
   existing `flex items-center justify-between` (`ListTile.vue:72`). No absolute positioning: the
   strip grows to fit the 36px buttons, so the cluster cannot overhang into the body or clip against
   the strip's `overflow-hidden`.
2. The existing body row keeps its **two-column** `justify-between` shape (`ListTile.vue:88-107`) —
   the status pill stays alone on the right. The owner chip joins the **left** group beside the
   category label, per requirement 3: wrap the chip and the existing category `<span>` in one
   `<div class="flex min-w-0 items-center gap-1.5">`. Do **not** add the chip as a third direct child
   of the `justify-between` row — at the 2-across mobile width (~160px) that turns a stable two-column
   row into a three-way wrapping distribution. `MemberChip size="dot"` renders `BeanieAvatar` at 24px,
   and renders **nothing** when the owner id no longer resolves (`MemberChip.vue:46`), so a deleted
   owner leaves no hole.
3. **A stretched overlay button, last in the DOM** —
   `<button type="button" data-testid="list-tile-open" class="absolute inset-0 z-10 rounded-2xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary-500)] focus-visible:outline-none" :aria-label="list.title" @click="emit('open', list.id)">`.
   One tab stop, real button semantics, Enter and Space for free.

   **`ring-inset` is required, not cosmetic.** The tile root keeps `overflow-hidden`
   (`ListTile.vue:67`) and the overlay is exactly `inset-0`, so a default outward-painting `ring-2`
   is clipped to nothing and the primary action ends up with _no_ visible focus indicator. `ring-inset`
   draws it inside the border box, where `rounded-2xl` traces the tile outline exactly — so no
   `group-*` variant and no inset offset are needed. (Existing precedent: `MonthDayCard.vue:162`,
   `WeeklyCalendarView.vue:670`.) The action buttons keep the UA focus ring; `outline: none` in
   `style.css:513` is scoped to `.beanies-input` and does not reach them.

**Layering is two z tokens and nothing else.** The overlay is `z-10`; the action cluster is `z-20`.
The strip is `position: relative` with `z-auto` and creates no stacking context, and neither does the
`<article>` root (`position: relative`, `z-index: auto`) — so the cluster's `z-20` is compared against
the overlay's `z-10` and wins. There is **no** `pointer-events-none` anywhere: a positioned overlay
already paints above static and `z-auto` content, so it was redundant, and a rule of the form
"remember to mark every content subtree `pointer-events-none`" is exactly the kind of instruction that
rots the first time someone adds a `<div>`. Keep the overlay **last** in the DOM: if the z tokens are
ever removed, last-in-DOM degrades loudly (the overlay eats the buttons) rather than silently (the
strip eats the overlay).

Emits gain `copy: [id]` and `delete: [id]` alongside the existing `open: [id]`.

See the tooltip caveat above for the one accepted regression.

**`ListTile.test.ts:53-55` will break** — it does `wrapper.trigger('click')` on the root, which is no
longer the button. Change it to `wrapper.get('[data-testid="list-tile-open"]').trigger('click')` and
add cases asserting the copy/delete emits.

### 6. `ListShelf` — one tile binding, not four

`ListShelf` currently renders the `ListTile` grid twice — banded (`:62-69`) and flat (`:72-74`).
Forwarding two more events would make four copies of the same binding. Instead, normalise the flat
case into a one-element band so there is a single render path:

```ts
const groups = computed<Band<FamilyList>[]>(
  () => props.bands ?? [{ key: '__all__', label: '', isLabelKey: false, items: props.lists }]
);
```

`Band<T>` is `{ key; label: string; isLabelKey: boolean; items }` (`completedListBands.ts:18-28`) —
the placeholder must satisfy it in full, including `isLabelKey`, which the heading reads
(`ListShelf.vue:64-65`). Render one `v-for="group in groups"` with the heading behind
`v-if="group.label"`; the existing wrapper keeps `mb-4 last:mb-0`, a no-op for the single-group flat
case because that group is also the last. The `ListTile` binding then exists **once** and forwards
`@open` / `@copy` / `@delete`. Still a purely presentational shelf — no store access.

### 7. `useListDeletion` — one delete flow, and it stops lying

`src/composables/useListDeletion.ts` exporting `confirmAndDeleteList(id): Promise<boolean>`.

This is not just deduplication — it closes a **live silent failure**:
`listStore.deleteList` returns `false` _without throwing_ when the list is absent from the projection
(`listStore.ts:443-469`), so `wrapAsync` never toasts; and `ListDetailModal.handleDelete` discards
that boolean and emits `deleted` + `close` regardless (`ListDetailModal.vue:334-346`) — the drawer
shuts as though the delete worked. This is precisely the class `useMemberRemoval` was written to
close, and its header says so (`useMemberRemoval.ts:8-12`). Adding a second call site without fixing
it would make it two silent failures.

```
confirm(danger, lists.detail.deleteConfirm.*)  ->  cancelled  => false
listStore.deleteList(id)                       ->  false      => showToast('error', t('lists.detail.deleteFailed'))
                                                                 + reportError({ surface: 'lists',
                                                                     severity: 'warning',
                                                                     context: { action: 'delete_returned_false' } })
                                                                 => false
                                               ->  true       => true
```

**Authorization: unchanged, deliberately.** Unlike `useMemberRemoval`, this composable carries **no**
`canManagePod` check and **no** step-up. That is not an omission — `ListDetailModal` already passes
`:show-delete="true"` unconditionally (`ListDetailModal.vue:361`) with no permission gate, so every
member can already delete any list from the drawer. The tile button therefore opens **no new
privilege surface**; it is a second door onto an existing one. If list deletion should be gated, that
is its own change applied here once (which is the whole point of centralising it) — but doing it
inside this plan would silently alter drawer behaviour that no requirement asks to change.

Module-level exported function, not a `useX()` returning an object — mirrors `useMemberRemoval`'s
`removeMember` exactly. No router or emit dependency: navigation/close stays at the call site keyed on
the return value. `ListDetailModal.handleDelete` becomes:
`if (await confirmAndDeleteList(l.id)) { emit('deleted', l.id); emit('close'); }`.

### 8. `BeanieListsPage` — own the two actions

- `@delete` -> `void confirmAndDeleteList(id)`. Nothing else to do: the shelf re-derives from the store.
- `@copy` -> sets `copySourceId`. **One** ref drives the modal — there is no second `showCopy`
  boolean to keep in sync:
  `<ListCopyModal :open="!!copySourceId" :source-id="copySourceId" @close="copySourceId = null" />`
- **`ListCopyModal` is mounted unconditionally**, never `v-if`-gated on `copySourceId`. This is
  load-bearing, not style — see §9: `useFormModal`'s reset watcher is not `immediate`, so a modal that
  mounts with `open` already `true` never resets.
- Both `ListShelf` instances (`BeanieListsPage.vue:160-168` and `:181-190`) get the two new listeners.

### 9. `ListCopyModal.vue` (new, `src/components/lists/`)

`BeanieFormModal`, `size="narrow"`, `icon="📋"`, `icon-bg="var(--tint-orange-8)"`. Props are
`{ open: boolean; sourceId: string | null }`; `sourceList` is a computed lookup off `listStore`.

- State + reset-on-open + `isSubmitting` come from
  `const { isSubmitting } = useFormModal(() => sourceList.value, () => props.open, { onEdit: reset, onNew: reset })`
  — the same use `FeedbackModal.vue:8-10` documents. Both callbacks are required by the signature
  (`useFormModal.ts:9-16`) and both are `reset` here. No hand-rolled `watch(open)`.

  **The component must stay mounted while closed** (§8). `useFormModal` is a plain, non-immediate
  `watch(getOpen, …)` (`useFormModal.ts:20`): a `v-if`-gated modal mounts with `open` already `true`,
  the watcher never fires, and the title field opens **empty** with the previous selection still in
  place. `FeedbackModal` — the cited precedent — is mounted exactly once, in `App.vue:2177`.

- **Title field** via `FormFieldGroup` + `BaseInput`. Default value:
  `fillTemplate(t('lists.copy.titleDefault'), { list: source.title })` where `titleDefault` is
  `"{bean}'s {list}"`. Because `fillTemplate` leaves unmatched tokens alone, `{bean}` survives into
  the field for the second expansion.
- **`FamilyChipPicker`** `mode="multi"`, bound with plain `v-model="selectedIds"` on a
  `ref<string[]>` — the `MealEditModal.vue:221` precedent, so no narrowing handler is needed despite
  the union emit type. `:show-shared` is already `false` by default, so it is not passed.
- **Helper line** under the picker stating copies are not linked to the original (requirement 10).
- Save label is count-driven with explicit singular/plural keys:
  `count === 1 ? t('lists.copy.createOne') : fillTemplate(t('lists.copy.createOther'), { count })`,
  the pattern `PhotoIndicator.vue:34` and `NookVacationCard.vue:106` already use.
- `saveDisabled` has exactly **one** rule: no bean selected. A blank title is handled by the seed
  builder's fallback (§3), so it needs no second branch and no error state.
- **`isSubmitting` must actually be driven, and bound.** `BeanieFormModal` disables save via
  `:disabled="saveDisabled || isSubmitting"` (`BeanieFormModal.vue:162`) and also blocks
  close-while-submitting (`:84,91`), but only if the prop is passed. Bind `:is-submitting="isSubmitting"`
  and set it in the handler:

  ```ts
  async function onSave(): Promise<void> {
    if (isSubmitting.value) return;
    isSubmitting.value = true;
    try {
      const created = await listStore.copyListForMembers(
        props.sourceId!,
        selectedIds.value,
        title.value
      );
      if (!created) return; // store already toasted + reported — stay open
      showToast('success' /* count-driven */);
      emit('close');
    } finally {
      isSubmitting.value = false;
    }
  }
  ```

  Without this a double-tap on "Create 3 Copies" fires two atomic batches and creates **six** lists —
  the write being atomic prevents partial failure, not duplicate submission.

- The guard is `if (!created)`, **not** `created === null`: `copyListForMembers` coerces every failure
  to `null` via `?? null` (see the failure contract in §2), and branching on falsy cannot invert if
  that coercion is ever dropped. There is no partial-success branch — the write is atomic (§1).

### 10. Copy (strings)

All under `lists.copy.*` in `uiStrings.ts`, plus `action.copy` and `lists.detail.deleteFailed`, each
with `en` (Title Case labels / Sentence case sentences) and `beanie` (all lowercase).

## Files Affected

**Modified**

- `src/services/automerge/repositories/listRepository.ts` — new `createLists` atomic batch create
- `src/stores/listStore.ts` — `copyListForMembers`; `createFromTemplate` switches to `freshItems`
- `src/components/ui/ActionButtons.vue` — `showEdit`/`showCopy`/`showDelete` props (defaults preserve today's pair), `SIZES` map with the `lg` target, hoisted base classes, `type="button"` fix
- `src/components/lists/ListTile.vue` — root restructure, `ActionButtons` cluster, owner chip move
- `src/components/lists/ListShelf.vue` — single `groups` render, forward `copy`/`delete`
- `src/pages/BeanieListsPage.vue` — wire both actions, host `ListCopyModal`
- `src/components/lists/ListDetailModal.vue` — `handleDelete` body swapped for `useListDeletion`
- `src/services/translation/uiStrings.ts` — `lists.copy.*`, `action.copy`, `lists.detail.deleteFailed`
- `src/components/lists/__tests__/ListTile.test.ts` — open click target + new emit cases

**Created**

- `src/utils/listSeed.ts` — pure `freshItems` + `buildCopySeeds`
- `src/components/lists/ListCopyModal.vue`
- `src/composables/useListDeletion.ts`
- `src/utils/__tests__/listSeed.test.ts`
- `src/stores/__tests__/listStore.copy.test.ts`
- `src/components/lists/__tests__/ListCopyModal.test.ts`
- `src/components/ui/__tests__/ActionButtons.test.ts`

**Already committed (design input)**

- `docs/mockups/list-duplicate-2026-09-07.html`

## Observability Coverage

Surface: **`list-copy`** (kebab-case, one CloudWatch filter isolates the feature). The events below
are the telemetry face of the failure contract in §2 — that table is the source of truth; if the two
disagree, the table wins.

Because the write is atomic there are exactly three outcomes, so three events cover the feature
completely — `copy_completed` + `copy_failed` is an exact denominator, and a partial state is
unreachable by construction.

**Events**

- `logEvent({ level: 'info', surface: 'list-copy', message: 'copy completed: N lists, M items, <lifecycle>', context: { action: 'copy_completed', kind: <'oneoff'|'recurring'> } })` — the success counter, so a failure _rate_ is measurable, not just a failure count.
- `reportError({ surface: 'list-copy', severity: 'warning', message: 'copy source is no longer in the document', context: { action: 'copy_missing_source' } })` — source list vanished between tile tap and submit.
- `reportError({ surface: 'list-copy', severity: 'critical', message: 'copy failed: nothing was created (the batch is atomic)', error: e, context: { action: 'copy_failed', error_code: 'unknown-member' | 'batch-write-threw' | 'verify-missing' } })` — a user action failed outright, so this pages Slack. Then rethrows; `wrapAsync` renders the user toast.

**Failure modes covered**

- Source vanished between tile tap and submit -> `copy_missing_source`, warning toast, nothing created.
- A selected member id does not resolve -> `copy_failed` / `unknown-member`. Never creates a list with a dangling `ownerId`.
- The batch write rejects (doc not loaded, worker down, engine panic) -> `copy_failed` / `batch-write-threw`. **Nothing is created** — one `Automerge.change` commits all or none (`worker/docOps.ts:676-679`).
- The batch resolves but the entities are not where readers look -> `copy_failed` / `verify-missing` (§1).
- Title expansion produced nothing -> covered by the `|| source.title` fallback in `buildCopySeeds`, and the resulting list is still counted in `copy_completed`, so it cannot hide.
- Delete-from-tile on an already-deleted list -> `useListDeletion` toasts + reports `delete_returned_false` instead of closing as though it worked (§7).
- No bare `catch {}` anywhere. Every catch either reports or rethrows into `wrapAsync`, and no path both reports `critical` and lets `showToast` page a second time.

**Message cardinality:** `normalizeMessage` collapses uuids, timestamps and 6+ digit numbers only
(`diagnosticContext.ts:373-378`), so the counts embedded in `copy completed: …` form distinct
rate-limit buckets. The value space is small and bounded (beans x items x two lifecycles) and a
CloudWatch filter matches on the `copy completed:` prefix, so this is acceptable — but do not add
unbounded values (titles, ids, member names) to that string.

**Privacy / store gate:** no new context keys. `action`, `kind` and `error_code` are all pre-existing
`ALLOWED_CONTEXT_KEYS` members (`src/utils/diagnosticContext.ts:61`), and counts ride in `message`,
which bypasses the allowlist by design (`openCycle.ts:174`). **No `ALLOWED_CONTEXT_KEYS` change and no
store data-collection redeclaration is required.** No list titles, item text, or member names are
ever logged.

**Perf:** `perfTiming` is not added. A copy is a single CRDT write well under the
`TELEMETRY_FLOOR_MS = 250` floor; the counters above carry the signal that matters.

## Acceptance Criteria

- [ ] Copying a 5-item list to 3 beans produces 3 new lists, each owned by the chosen bean, each with 5 unticked items and fresh item ids
- [ ] Each copy's `createdBy` is the member who performed the copy, not the source list's creator
- [ ] The 3 lists arrive in **one** Automerge change — a forced mid-write failure leaves **zero** new lists, not one or two
- [ ] Editing an item in a copy leaves the source and the sibling copies untouched
- [ ] A recurring list's copy does not immediately reset and writes no `ListCycle` on the day it is created
- [ ] A copy of a list linked to a trip or activity has neither link
- [ ] A copy carries no `templateKey`, no `dueDate`, and no cycle history
- [ ] Tapping either tile icon does not open the list drawer
- [ ] `ListTile` is reachable and operable by keyboard; open, copy and delete are three distinct tab stops each with a visible focus ring
- [ ] The tile renders without clipping or overlap at the 2-across mobile grid with a long list title; the action cluster sits inside the tinted strip and does not overhang the body
- [ ] The recurrence pill still truncates gracefully; its full text remains readable in the detail drawer (the hover tooltip is a known, documented casualty of the overlay)
- [ ] Copy and delete icons resolve real glyphs (not the three-dot placeholder), render at 16px inside 36px buttons, and are correct in dark mode with `-lift` accents, per CIG slides 8 and 9
- [ ] `AccountsPage` and `TransactionsPage` action clusters are visually and behaviourally unchanged after the `ActionButtons` generalisation
- [ ] Deleting from the tile shows the same confirm dialog as deleting from the drawer; deleting a list that is already gone now shows an error toast instead of closing silently
- [ ] Removing `{bean}` from the title gives every copy the same name, with no validation error
- [ ] A single-bean copy reads "Create Copy", not "Create 1 Copies"
- [ ] A failed copy produces exactly **one** user toast and exactly **one** Slack page, and leaves the modal open
- [ ] Every new string exists in `uiStrings.ts` with both `en` and `beanie`; `npm run lint` passes the i18n rules
- [ ] Diagnostic logging in **Observability Coverage** implemented; no new `ALLOWED_CONTEXT_KEYS` entry was needed

## Testing Plan

1. `src/utils/__tests__/listSeed.test.ts` — the rules, with **no** Pinia and no mocks: fresh item ids,
   all items unticked, `completedBy`/`completedAt` cleared, links and `dueDate` dropped, `templateKey`
   absent, `ownerId`/`createdBy` set correctly, `lastResetDate` stamped only when recurring,
   `cycleCelebrated` false, item order preserved, zero-item source, `{bean}` expansion including a
   name containing `$`, empty-title fallback, and one seed per owner in selection order.
2. `src/stores/__tests__/listStore.copy.test.ts` — orchestration and failures only: missing-source
   path returns `null`, reports a warning, and does **not** page; unknown-member-id path; with
   `listRepo.createLists` mocked to reject, **no** list is added to `lists.value`, `copy_failed` is
   reported exactly once, and the action resolves `null` (the `?? null` coercion — assert `null`, not
   `undefined`); success mirrors the array in one write and fires `trackFeature` once.
3. `src/components/lists/__tests__/ListCopyModal.test.ts` — save disabled with no selection; label
   singular vs plural; the modal stays open when the action returns `null`; state resets on reopen
   (mount with `open: false`, then flip — the reset watcher is not `immediate`); and a **double-tap on
   save calls `copyListForMembers` exactly once** while the first call is in flight.
4. `src/components/lists/__tests__/ListTile.test.ts` — updated open target
   (`[data-testid="list-tile-open"]`) plus new cases for the `copy` and `delete` emits and that
   neither bubbles an `open`.
5. `src/components/ui/__tests__/ActionButtons.test.ts` (new — none exists today) — with no props it
   renders exactly edit + delete and no copy button; every button is `type="button"`; `size="lg"`
   renders a 36px button with an `h-4 w-4` glyph. Three call sites depend on those defaults.
6. Existing suites must stay green — in particular anything mounting `ActionButtons` via
   `AccountsPage` / `TransactionsPage`.
7. `npm run type-check`, `npm run lint` (i18n + `vue/no-restricted-class` dark-mode rules), and the
   full unit suite.
8. **Manual, in a browser, both themes** (per `docs/lessons.md` — green tests have hidden real defects
   before): copy a 5-item recurring chore list to 3 beans from the shelf; confirm 3 tiles appear with
   the right owners and names; tick an item in one and confirm the others do not change; tab through a
   tile and confirm three focus stops **with a ring actually visible on the whole-tile stop** (the
   `ring-inset` fix in §5); delete from a tile and confirm the dialog; check the 2-across mobile layout
   at 360px with a long title; check both icons in dark mode; spot-check the Accounts and Transactions
   action clusters for visual regression.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved mockup and a read of `listStore`, `ListTile`, `ListShelf`, `ListDetailModal`, `BeanCard`, `FamilyChipPicker`, `fillTemplate`, `icons.ts` and `diagnosticContext.ts`; corrected the intake's false "remove ListDetailModal action rows" scope item; chose the stretched-overlay a11y pattern over `role="button"`; resolved both open questions.
- **Pass 2 (DRY + error handling)**: Found the `op: 'batch'` API the draft claimed did not exist (`docOps.ts:676-679`) and made the copy a single atomic write — deleting the partial-failure design, `copy_partial` telemetry and the N-toast/N-render loop; reused `ActionButtons.vue` instead of hand-rolling a cluster; collapsed `ListShelf`'s duplicated tile binding; corrected the `useConfirm` -> `confirm()` API; re-justified `useListDeletion` as closing a live silent failure; replaced the 10-arg `baseListSeed` with a 3-line `freshItems`; adopted `useFormModal`; specified the single-toast/single-page failure contract and the `ListTile.test.ts` breakage.
- **Pass 3 (Sustainability)**: Split the feature into three layers by moving requirements 6-9 into a pure, store-free `src/utils/listSeed.ts`, keeping the 830-line `listStore` to orchestration; replaced the `IconAction[]` config prop on `ActionButtons` with three boolean visibility props and a `SIZES` map (the plan's `lg` would have rendered a 24px glyph, since `BeanieIcon`'s scale is not the button scale); dropped the rot-prone blanket `pointer-events-none` from `ListTile` for two explicit z tokens and moved the cluster into the strip's existing flex; caught three type/contract defects (`wrapAsync` returns `T | undefined` so the modal must branch on falsy; `Band<T>` needs `label: string` + `isLabelKey`; the required `createdBy` field was never specified); replaced the batch-verify's inaccurate rationale with a `getById` lookup plus empty-input early return; consolidated every failure outcome into one table in §2; added the status-pill tooltip caveat and an `ActionButtons` unit test, which does not exist today.
- **Pass 4 (Fresh-eyes sweep)**: Caught that `?? null` collapses thrown failures into `null`, so §2's contract table, §9's guard rationale and two test assertions all claimed a return value (`undefined`) the action can never produce; found three would-ship defects — a focus ring clipped to nothing by the tile root's `overflow-hidden` (needs `ring-inset`), a `useFormModal` reset that never fires unless `ListCopyModal` is persistently mounted (its `watch` is not `immediate`), and an unset/unbound `isSubmitting` that let a double-tap create 2N lists; corrected the false claim that `primary-600` is Heritage Orange (`style.css:80` binds it to `primary-500`); resolved §5.2's contradiction with requirement 3 by putting the owner chip in the body row's left group rather than making it a third `justify-between` child at 160px; collapsed the page's copy state to one ref; and recorded that the tile delete opens no new authorization surface since `ListDetailModal`'s delete is already ungated.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Let's make some small improvements to beanies lists - for chores, I realized that a lot of families duplicate the same list of chores for all kids, but there is no capability as far as I can tell to duplicate a list or create a list as a temoplate in beanies. My suggestion is to add the ability to copy / duplicate an existing list to new list. I also think it would be useful to be able to save a list as as a template in beanies. what are your thoughts and how could this work?
>
> Also Since there's another session ongoing building onto main, should we work on a branch and merge later or what would you suggest?

### Follow-up 1

> sure run the proposal through /beanies-pre-plan

### Follow-up 2 (intake answers)

> Scope: "Duplicate + multi-bean copy only". Priority: "Normal (medium)". Feature gate: "No gate (ship ungated)". Isolation: "Worktree (recommended)".

### Follow-up 3

> how does a worktree work? note that you are on the same machine as the other session

### Follow-up 4 (isolation re-decision)

> "Stay on main, narrow commits"

### Follow-up 5

> rather than having a "copy this list.." "delete this list.." affordance at the bottom of the drawer (where there is already a delete icon and close button) should we just have copy/delete icons at the top right of the list cards? this also follows the convention for the family member listing (which has edit/share/delete icons)

### Follow-up 6

> sure let's go with this and direction A. go ahead with pre-plan and /beanies-plan once ready. once the plan is complete proceed to implementation, and once done run a code review against the completed implementation to ensure it was implemented accurately and as per the plan and does not introduce any new bugs, side effects, or security issues, and fix all issues found.

</details>
