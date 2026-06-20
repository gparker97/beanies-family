# Plan: Beanie Lists — edit title, edit items inline, and reorder by drag-and-drop

> Date: 2026-06-20
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-20-beanie-lists-edit-and-reorder.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the `## Prompt Log` section.

## User Story

As a beanies.family user managing a shared family checklist, I want to **rename a list**, **edit an item's text**, and **reorder items by dragging** — directly in the list detail drawer — so I can keep a list accurate and ordered the way the family works through it, without deleting and re-adding items.

## Context

Beanie Lists shipped to production on 2026-06-18 (#33). Today a list is largely write-once after creation: you can add items, tick them off, and remove them, but you **cannot fix a typo in the list title, fix a typo in an item, or change the order of items**. For a surface families touch daily ("before school", "groceries", "packing"), those are basic table-stakes edits.

This is also the app's **first drag-and-drop surface**. A prior saved plan (`docs/plans/2026-05-19-calendar-drag-resize-haptics-phase-1.md`) chose `interact.js` for free-form _calendar_ drag/resize/snap, but that plan is **not implemented** — there is no drag library in the app today. List reordering is a different, simpler problem shape (a constrained vertical sortable list), so it uses **SortableJS** (via the maintained `vuedraggable@4` Vue 3 wrapper), which is purpose-built for exactly this. The two would share a library _name_ at most, not code; picking the right tool per shape is the correct call.

## Requirements

1. **Edit a list's title** — inline quick-edit. Tap the title in the `ListDetailModal` header → it becomes a text input in place → **Enter or blur saves**, **Esc cancels**. Empty-on-save reverts to the previous title (a list must always have a title).
2. **Edit a list item's text** — inline quick-edit in the item row. Tap the item text → it becomes an input in place → **Enter or blur saves**, **Esc cancels**. Empty-on-save reverts to the previous text (deletion stays on the existing remove `✕` button — never delete via an emptied edit).
3. **Reorder items by drag-and-drop** — drag an item to a new position within the list. Works with **touch (drag the handle)** and **mouse (click-drag the handle)**. Order persists to the Automerge doc and syncs. A dedicated **drag handle** per row (not long-press-the-whole-row) so dragging never conflicts with tap-to-toggle, tap-to-edit, or vertical scroll.
4. Only **one** thing is editable at a time (title or a single item) — starting a new edit auto-commits the previous one (the existing `useInlineEdit` composable already does this).
5. None of these edits change a list's **completion / filing** state: renaming and reordering never touch it; editing item text preserves each item's `completed` / `completedBy` / `completedAt`.
6. All new user-visible text (placeholders, drag-handle aria-label, edit affordance labels) goes through `uiStrings.ts` with **both** `en` (Title/Sentence case) and `beanie` (lowercase) entries; `npm run translate` run after.

## Important Notes & Caveats

- **The drawer header has no editable-title slot today.** `BeanieFormModal` renders `{{ title }}` directly in its drawer header (`src/components/ui/BeanieFormModal.vue:109`); the `#custom-header` slot is gated to `variant === 'modal'` only (`:93`), and this list modal is a `drawer`. **Fix (minimal, additive, backward-compatible):** wrap the drawer-header title render in a named slot with the current text as fallback — `<slot name="title-content">{{ title }}</slot>` — so every existing caller is byte-for-byte unchanged, and `ListDetailModal` supplies the inline-editable title via that slot. Do **not** broaden this into an "editable title" feature on the modal; the editing state stays in `ListDetailModal`.
- **Reuse `useInlineEdit`, do not rebuild.** `src/composables/useInlineEdit.ts` already provides `startEdit` / `saveField` / `cancelEdit` / `isEditing` / `saveAndClose` with single-active-field + auto-save-previous semantics. Drive both the title (`field: 'title'`) and items (`field: \`item:${id}\``) through one `useInlineEdit`instance in`ListDetailModal`.
- **Inline inputs use a raw `<input>`, not `BaseInput`.** `BaseInput` exposes no `focus()`/inner-element and is never autofocused anywhere in the app; the established pattern (`TimePresetPicker.vue:97`, `BaseCombobox.vue:276`) is a raw `<input ref>` + `nextTick(() => ref.value?.focus())`. A raw input also matches the static `text-sm` rhythm with **no** `rounded-xl`/border layout jump (which `BaseInput`'s chrome would introduce). Use a raw, lightly-styled input for both the title and item editors — it removes a dependency rather than adding one.
- **Esc/blur ordering — guard save-on-blur so Esc never commits.** Requirements 1 & 2 keep the convenient blur-to-save (tap away or move to another field commits) — but note the race: pressing Esc calls `cancelEdit()`, which unmounts the focused input, and a focused-input unmount fires a native `blur` that would otherwise re-commit the value the user just cancelled (`saveField`/`cancelEdit` both null `editingField` _synchronously_ before any await). **Structural fix, no fragile flags:** the blur save is guarded by the editing state itself — title blur saves only `if (inline.isEditing('title'))`, which is already `false` after an Esc; the item row tracks a local `cancelled` flag set on Esc and skips its blur/unmount commit when set. No existing `useInlineEdit` consumer saves on blur, so this is a new (but guarded) pattern — the guard is what makes it safe. (Enter also nulls the field first, so the unmount-blur is a guarded no-op too — no double save.)
- **`ListDetailModal` already has a sibling inline-edit pattern** (category/owner/link pills toggle to an inline editor via local `ref`s — `:50-72`). That pattern is for _pickers_, not free-text fields; the new title/item text edits use `useInlineEdit` (text fields with save/cancel/blur semantics). Don't try to force the pill pattern onto text editing or vice-versa — they're different interactions. (Out of scope: migrating the existing pill toggles to `useInlineEdit`.)
- **All three writes route through the existing `listStore.updateList`** (`:205`), which wraps `wrapAsync` (toast + `reportError`, returns `null` on failure). New store actions inherit that error discipline for free — **do not** add a second toast/report layer on top.
- **Completion logic must not run for these edits.** `deriveCompletion` is only for add/remove/toggle (which change _which_ items exist or their done-state). Rename, reorder, and item-text-edit do **not** change completion, so they must **not** call `deriveCompletion` and must **not** touch `completed`/`completedBy`/`completedAt`/`cycleCelebrated`/`lastResetDate`. Item-text-edit preserves each item's completion triple by spreading the existing item (`{ ...it, title }`).
- **SortableJS + Vue reconciliation footgun.** Raw `sortablejs` mutates the DOM directly; if you then re-render from a changed model you get a double-move/duplicated node. `vuedraggable@4` is the maintained Vue 3 wrapper that reconciles this correctly. Use it. **Route the reorder through the store, never mutate the Automerge-backed `list.items` array in place:** bind `vuedraggable` one-way and handle its `change` event (`{ moved: { oldIndex, newIndex } }`) → call `listStore.reorderItems(listId, oldIndex, newIndex)`. The store update re-renders the rows authoritatively. (See Approach for the exact binding — getting one-way vs `v-model` right is the crux.)
- **Drag handle, not long-press.** A dedicated grip handle (`⠿`) on each row with `vuedraggable`'s `handle` selector keeps the rest of the row interactive (checkbox toggles, text taps to edit, `✕` removes) and preserves vertical scroll on touch. This sidesteps the long-press-vs-tap and drag-vs-scroll conflicts entirely.
- **Automerge concurrent-reorder caveat.** Automerge array moves are delete+insert under the hood; two devices reordering the _same_ list simultaneously can transiently duplicate or drop an entry after merge. **Accepted for now** (families rarely reorder the same list at the same second; the next clean write self-heals). Do not build a guard in this plan; note it as a known limitation. If observed in practice, a follow-up can add a post-merge de-dup-by-id pass in `loadLists`.
- **Text sizing must stay rem-based** (no `text-[Npx]`, no `font-size: Npx` in scoped styles) so Large Reading Mode scales. The inline-edit input must visually match the static text it replaces (same `text-sm` rhythm) to avoid layout jump.
- **i18n is CI-blocking.** `vue/no-bare-strings-in-template` (error) catches bare text AND `aria-label`/`placeholder`/`title`/`alt`. The drag handle's `aria-label`, any edit-affordance `aria-label`, and the item-edit input `placeholder` (if any) must be `t('…')` bound. New `.ts`/template strings need both `en` + `beanie`.
- **`ListItemRow` is shared.** It renders in both the detail drawer and the travel-plan embed (`LinkedLists.vue`). The embed is a read-only preview — editing and dragging must be **opt-in via props** (e.g. `editable` / `draggable`) so the embed keeps its current non-interactive behavior. Defaults must preserve today's embed rendering exactly.

## Assumptions

> **Review these before implementation.** Valid as of 2026-06-20.

1. `vuedraggable@4` (the Vue 3 / `sortablejs` wrapper, package name `vuedraggable`, `next`/`4.x` line) installs cleanly against Vue 3.5 and adds ~12–16 KB gzipped (sortablejs core + thin wrapper). Verify exact version + bundle delta at install (`npm run build`).
2. Item ordering is **array position** in `FamilyList.items` (confirmed — `FamilyListItem` has no `order` field). Reorder = produce a re-sequenced `items` array and persist via `updateList`. No model/schema change, no migration.
3. A list always has ≥1 item is **not** guaranteed; the items container may be empty. Drag/edit affordances simply don't render for an empty list — no special-case needed.
4. The detail drawer is the only place items are editable/reorderable in this plan. The travel/activity embed (`LinkedLists.vue`) stays read-only.
5. `updateList`'s `wrapAsync` already surfaces failures (red toast + Slack `reportError`) — the new actions need no extra user-facing error UI beyond what they inherit.
6. Editing item text while the item is completed is allowed (you can fix a typo on a ticked item); the completion triple is preserved across the edit.
7. Tapping the row text to edit and tapping the checkbox to toggle are on **separate hit targets** already (the checkbox is its own `<button>`), so making the text tappable-to-edit won't hijack the toggle.

## Approach

### Data flow (MVO)

All three edits are **View → Orchestrator (store) → Automerge → persist → sync**. The View (`ListDetailModal` / `ListItemRow`) emits an intent; the store mutates the CRDT via `updateList`; reactive re-render follows. No new repository methods — `updateList(id, { … })` is the single mutation path (items array replacement or title change).

### 1. Store actions (`src/stores/listStore.ts`)

Three new thin actions, each delegating to `updateList` (so they inherit `wrapAsync`). All find the list by id and no-op (`return null`) if absent — matching `toggleItem`/`addItem`/`removeItem`.

```ts
/**
 * Rename a list. Trims; an empty/whitespace title is rejected (returns the list
 * unchanged) — a list must always have a title. Never touches completion.
 */
async function renameList(listId: string, title: string): Promise<FamilyList | null> {
  const list = lists.value.find((l) => l.id === listId);
  if (!list) return null;
  const next = title.trim();
  if (!next || next === list.title) return list; // no-op revert / unchanged
  return updateList(listId, { title: next });
}

/**
 * Edit one item's text. Preserves the item's completion triple (spread). Trims;
 * an empty/whitespace value is rejected (returns the list unchanged) — deletion
 * is the remove button's job, never an emptied edit. Never re-derives completion
 * (the set of items and their done-state is unchanged).
 */
async function updateItemText(
  listId: string,
  itemId: string,
  title: string
): Promise<FamilyList | null> {
  const list = lists.value.find((l) => l.id === listId);
  if (!list) return null;
  const next = title.trim();
  const current = list.items.find((i) => i.id === itemId);
  if (!current || !next || next === current.title) return list; // no-op
  const items = list.items.map((it) => (it.id === itemId ? { ...it, title: next } : it));
  return updateList(listId, { items });
}

/**
 * Reorder items by moving the item at `fromIndex` to `toIndex`. Pure array move;
 * never changes completion (same items, same done-state, different order). Bounds-
 * guarded: out-of-range or equal indices no-op.
 */
async function reorderItems(
  listId: string,
  fromIndex: number,
  toIndex: number
): Promise<FamilyList | null> {
  const list = lists.value.find((l) => l.id === listId);
  if (!list) return null;
  const n = list.items.length;
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= n || toIndex >= n) {
    return list; // no-op on a degenerate move
  }
  const items = [...list.items];
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
  return updateList(listId, { items });
}
```

Export all three from the store's return object alongside `toggleItem`/`addItem`/`removeItem`. Add a one-line note to the store's "Write invariants" header doc-comment (`:82-86`) that `renameList`/`updateItemText`/`reorderItems` deliberately **do not** derive completion.

> No sibling `todoStore` pattern exists to mirror (it has only a generic `updateTodo`, no reorder/rename/item-text action). These three are net-new, shaped on `listStore`'s own in-store `toggleItem`/`addItem`/`removeItem` trio (`listStore.ts:243/291/307`) — find-by-id, `return null` if absent, route through `updateList`.

### 2. `useInlineEdit`-driven editing in `ListDetailModal.vue`

Add one `useInlineEdit` instance whose field type is `'title' | \`item:${string}\``. Draft refs: `draftTitle`and`draftItem`(string).`populateDraft`copies the current value into the draft;`saveDraft` calls the matching store action.

```ts
// Capture the list id at edit time so saveDraft persists to the list that was
// being edited, even if `list` (a computed off props.listId) has re-projected.
const editingListId = ref<string | null>(null);
const draftTitle = ref('');
// The item draft lives in ListItemRow (it owns the <input>); on edit-save the
// row emits the text, so the modal only needs to hold the title draft here.

const inline = useInlineEdit<'title' | `item:${string}`>({
  populateDraft: (field) => {
    if (!list.value) return;
    editingListId.value = list.value.id;
    if (field === 'title') draftTitle.value = list.value.title;
    // item drafts are seeded inside the row from `item.title`; nothing to do here.
  },
  saveDraft: (field) => {
    const id = editingListId.value;
    if (id && field === 'title') void listStore.renameList(id, draftTitle.value);
    // item saves are dispatched from onItemEditSave(itemId, text), not here.
  },
});
```

`onItemEditSave(itemId, text)` (the Section 3 template's `@edit-save` handler) is the single item-save dispatch point: `void listStore.updateItemText(editingListId.value ?? list.value?.id ?? '', itemId, text)` then `inline.cancelEdit()`.

- **Title:** supply `BeanieFormModal`'s new `#title-content` slot. When `inline.isEditing('title')` is false, render the title as a tappable element (`@click="inline.startEdit('title')"`, `role`/`tabindex` + `@keydown.enter`/`space` for keyboard); when true, render a **raw `<input>`** styled to match the static title text, template-ref'd and focused via `nextTick(() => ref.value?.focus())`, bound to `draftTitle`, with `@keyup.enter` → `inline.saveField('title')`, `@keyup.esc` → `inline.cancelEdit()`, and `@blur` → a guarded save `() => { if (inline.isEditing('title')) inline.saveField('title') }` (the guard makes the Esc-unmount blur a no-op). Use the existing `titlePlaceholder` key for its placeholder.
- **Items:** `ListItemRow` gains an `editable` prop. When `editable` and this row is being edited, it renders an input (bound via `v-model` to a draft passed down, or — simpler — the row emits `start-edit`/`save-edit`/`cancel-edit` and the modal owns the draft + input). **Chosen shape:** keep `ListItemRow` mostly presentational — it emits `edit-start`, `edit-save` (with the new text), `edit-cancel`, and receives an `editing` boolean prop; the modal owns `draftItem` and the `useInlineEdit` state. This keeps the row reusable and the editing orchestration in the Orchestrator layer.
- **Modal close commits in-flight edits:** call `inline.saveAndClose()` in the modal's `@save`/`@close` handler so a half-typed edit isn't lost on close. **Do not** rely on the `props.listId` watcher to "save before the ref changes" — `list` is a `computed` off `props.listId`, so by the time the watcher fires it has already re-projected to the new list. Instead, `saveDraft` persists via the `editingListId` captured at edit-start (above), which stays correct regardless of when the watcher runs; the watcher's only job is to `inline.saveAndClose()` then clear `editingListId`. This removes the unanswerable "before vs after" ordering question entirely. **Item-edit close-commit:** because the item draft lives in `ListItemRow` (Pass 3) and the modal's `saveDraft` only persists the _title_, `inline.saveAndClose()` is a no-op for an active `item:…` field — it cannot reach the row's draft. The **row therefore self-commits its dirty draft on `onBeforeUnmount` / `editing`→false** (emitting `edit-save` → `onItemEditSave`, unless `cancelled`); `saveAndClose` covers the title. Together they guarantee no in-flight edit is lost on close.

### 3. Reorder with `vuedraggable@4` in `ListDetailModal.vue`

Wrap the item rows in `vuedraggable`, **one-way bound**, routing the move through the store:

```vue
<draggable
  :list="list.items"
  item-key="id"
  handle=".drag-handle"
  :animation="160"
  ghost-class="list-row-ghost"
  @change="onItemMove"
>
  <template #item="{ element: item }">
    <ListItemRow
      :item="item"
      removable
      editable
      :editing="inline.isEditing(`item:${item.id}`)"
      @toggle="toggleItem"
      @remove="removeItem"
      @edit-start="inline.startEdit(`item:${item.id}`)"
      @edit-save="(text) => onItemEditSave(item.id, text)"
      @edit-cancel="inline.cancelEdit"
    />
  </template>
</draggable>
```

```ts
function onItemMove(evt: { moved?: { oldIndex: number; newIndex: number } }): void {
  if (!list.value || !evt.moved) return;
  void listStore.reorderItems(list.value.id, evt.moved.oldIndex, evt.moved.newIndex);
}
```

- **Why `:list` + `@change` and not `v-model`:** `v-model` would have `vuedraggable` mutate the array in place — but `list.items` is the reactive projection of the Automerge doc; the authoritative mutation must go through `updateList`. The `@change` `moved` event gives us `{ oldIndex, newIndex }`, which maps 1:1 to `reorderItems`; the store update then re-renders the rows. `vuedraggable` handles the visual drag + DOM reconciliation; we own the persistence. (`vuedraggable` tolerates the prop array updating underneath it after the move — the keyed `item-key="id"` template keeps node identity stable. **Two reliability constraints make this safe:** (1) `reorderItems` is dispatched **synchronously** from `@change` (the `void`-call, no debounce/`await` gate) so the authoritative store re-render lands in the same tick family as the drop — a delayed dispatch is the known double-move/duplicate-node footgun with one-way `:list`; (2) do **not** also pass `v-model` or mutate `list.items` in the handler — `@change` is the _only_ signal we act on. If a regression ever shows a duplicated row post-drop, the cause is almost always a second mutation path, not vuedraggable itself.)
- **Drag handle:** `ListItemRow` renders a grip handle (`⠿`, `aria-label` = `t('lists.detail.dragHandle')`, `class="drag-handle"`, `aria-hidden` on the glyph itself) only when a new `draggable` prop is set. `touch-action: none` on the handle so touch-drag from the handle doesn't scroll; the row container keeps `touch-action: pan-y`.
- **Ghost/drag styling:** a `.list-row-ghost` class (heritage-orange ring + raised shadow, reduced-motion-aware) for the placeholder. Reuse the existing `useReducedMotion` composable for the motion-safe gating — do not re-detect `matchMedia`.
- **Keyboard reordering (a11y) — deferred to a fast-follow, not this pass.** SortableJS is pointer-only, so a keyboard reorder path is genuinely valuable, but a hand-rolled `@keydown` mover carries its own non-trivial surface (focus must follow the moved row, the move needs an `aria-live` announcement to be a real a11y win rather than a hidden affordance, and `Ctrl/⌘+Arrow` collides with OS/browser shortcuts on some platforms). Shipping a half-built keyboard mover is worse than shipping none. **First pass:** the drag handle is a focusable `<button>` with a clear `aria-label`; reorder is pointer-only and that limitation is stated in the Help Center note. **Fast-follow (separate small plan):** add the keyboard mover _with_ focus-follow + `aria-live` together, so it lands as one coherent, testable a11y feature.

### 4. `ListItemRow.vue` — additive props, defaults preserve today's render

New optional props: `editable?: boolean`, `editing?: boolean`, `draggable?: boolean`. New emits: `edit-start`, `edit-save: [text: string]`, `edit-cancel`. When `draggable`, render the leading `.drag-handle`. When `editable` and not `editing`, the text span becomes tappable (`@click="$emit('edit-start')"`, keyboard-activable). When `editing`, render a **raw `<input>`** styled to match the static `text-sm` item text (template-ref'd, focused via `nextTick().focus()`, placeholder = existing `itemPlaceholder` key). **The row owns a single self-contained local draft ref seeded from `item.title` on the false→true `editing` edge** (a `watch(() => props.editing)` that seeds when it flips true and resets a local `cancelled` flag to `false`) — the row does **not** receive a draft prop. Commit/cancel semantics: **Enter** → emit `edit-save` with the draft; **Esc** → set `cancelled = true`, emit `edit-cancel`, discard; **Blur** → emit `edit-save` only `if (!cancelled && draft !== item.title)` (guard makes the Esc-unmount blur a no-op); **`onBeforeUnmount` / `editing`→false while dirty** → if `!cancelled && draft !== item.title`, emit `edit-save` — **this commits an in-flight item edit when the modal closes or switches lists** (the modal's `saveAndClose` cannot reach the row-owned draft; see §2's close-commit note). The modal stays the orchestrator (owns `useInlineEdit` + which row is `editing` + persistence) but does **not** own the in-flight item text — that lives in the row rendering the input. This keeps the modal free of a per-row draft ref and avoids a parent↔child two-way binding. With all new props omitted (the `LinkedLists.vue` embed), the row renders **exactly** as today.

### 5. `BeanieFormModal.vue` — additive title slot

At `:109`, change `{{ title }}` (drawer header) to `<slot name="title-content">{{ title }}</slot>`. Purely additive: callers that don't supply the slot get the identical static title. Only `ListDetailModal` supplies it.

### 6. i18n (`src/services/translation/uiStrings.ts`)

**Reuse existing keys; add only the genuinely-new aria-labels.** Pass 2 found two keys the draft would have redefined — both already exist:

- **REUSE** `lists.detail.itemPlaceholder` (exists, `uiStrings.ts:4346` = `"What needs doing?"`) for the item-edit input placeholder — do **not** add a new key.
- **REUSE** `lists.detail.titlePlaceholder` (exists, `:4380` = `"List name"`) for the title-edit input placeholder.

New keys (aria-labels only), each with `en` (Title/Sentence case) + `beanie` (lowercase), then run `npm run translate`:

- `lists.detail.dragHandle` — en: `"Drag to reorder"` / beanie: `"drag to reorder"` (handle aria-label)
- `lists.detail.editTitle` — en: `"Edit list name"` / beanie: `"edit list name"` (aria-label on the tappable title)
- `lists.detail.editItem` — en: `"Edit item"` / beanie: `"edit item"` (aria-label on the tappable item text)

(Spot-check the auto-generated `zh.json` entries per the project's translate-review note; fix obviously wrong machine output, keep the hash.)

## Files Affected

**Modified:**

- `src/stores/listStore.ts` — add `renameList`, `updateItemText`, `reorderItems`; export them; extend the write-invariants doc-comment.
- `src/components/lists/ListDetailModal.vue` — `useInlineEdit` instance + draft refs; editable title via the new slot; wrap items in `vuedraggable` with `@change` → `reorderItems`; wire row edit emits; `saveAndClose` on close/list-change.
- `src/components/lists/ListItemRow.vue` — additive `editable`/`editing`/`draggable` props + `edit-start`/`edit-save`/`edit-cancel` emits; drag handle; inline input; defaults preserve current render.
- `src/components/ui/BeanieFormModal.vue` — wrap drawer-header title in `<slot name="title-content">{{ title }}</slot>` (additive, backward-compatible).
- `src/services/translation/uiStrings.ts` — add `lists.detail.dragHandle`/`editTitle`/`editItem` only (`en` + `beanie`); **reuse** existing `itemPlaceholder`/`titlePlaceholder`; `npm run translate` after.
- `package.json` + `package-lock.json` — add `vuedraggable@^4` (resolve exact at install).
- `CHANGELOG.md` — `### Added` entry under today's date.
- `docs/STATUS.md` — short session entry.

**New:**

- `src/stores/__tests__/listStore.test.ts` — extend (file exists) with cases for the three new actions.
- (Possibly) `src/content/help/features.ts` — update the existing Beanie Lists article; no new file (see Help Center Coverage).

**Explicitly NOT modified (DRY / scope guards):**

- `src/composables/useInlineEdit.ts` — reused as-is, no changes.
- `src/components/lists/LinkedLists.vue` — embed stays read-only (new `ListItemRow` props default off).
- `src/services/automerge/repositories/listRepository.ts` — generic factory already covers it via `updateList`.
- The existing category/owner/link pill inline editors in `ListDetailModal` — not migrated.

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `features`
- **Slug**: the existing **Beanie Lists** article in `src/content/help/features.ts` (added 2026-06-18)
- **Title**: (unchanged) — add a short subsection
- **Scope**: Add a brief "Editing and reordering a list" passage: tap the list name or any item to rename it, drag the grip handle to reorder items. Frame from the user's POV — keeping a list tidy. (Reorder is pointer/touch only for now.)
- **Notes**: Mention that emptying an item's text doesn't delete it (use the `✕`); deletion is separate. Mention reorder is per-list and syncs to the family.

## Acceptance Criteria

- [ ] Tapping the list title in the detail drawer turns it into an input; Enter or blur saves, Esc cancels; emptying it reverts to the prior title (never blank). **Esc never commits — including the blur fired by the Esc-unmount** (guarded by `isEditing`).
- [ ] Tapping an item's text turns it into an input; Enter or blur saves, Esc cancels; **Esc never commits** (row `cancelled` guard); emptying it reverts (item not deleted); a completed item stays completed (triple preserved) after a text edit.
- [ ] Only one field edits at a time; starting another edit auto-saves the previous (via `useInlineEdit`).
- [ ] Closing the drawer (or switching lists) commits an in-flight edit, no lost keystrokes — **title via `saveAndClose`, item via the row's `onBeforeUnmount` self-commit** (`saveAndClose` alone cannot reach the row-owned item draft).
- [ ] Dragging an item's handle reorders it; new order persists to Automerge and survives reload (asserted on the stored `items` array order).
- [ ] Reorder works on touch (handle drag) and mouse; the rest of the row (checkbox, text-tap-to-edit, remove) still works; vertical scroll is preserved when not dragging the handle.
- [ ] The drag handle is a focusable button with a `t()`-bound `aria-label`; pointer-only reorder is documented as a known first-pass limitation (keyboard reorder is a tracked fast-follow).
- [ ] `renameList` / `updateItemText` / `reorderItems` never alter `completed`/`completedBy`/`completedAt`/`cycleCelebrated`/`lastResetDate`; they don't call `deriveCompletion`. Reorder/rename/text-edit of a _filed_ list leave it filed; of an active list leave it active.
- [ ] Degenerate inputs no-op cleanly: empty/whitespace rename or item-text; equal/out-of-range reorder indices; missing list/item id (`return null`).
- [ ] `ListItemRow` with the new props omitted renders identically to today; `LinkedLists.vue` embed is visually and behaviorally unchanged (still read-only).
- [ ] `BeanieFormModal` callers other than `ListDetailModal` are unchanged (slot fallback renders the static title).
- [ ] A store/`updateList` failure surfaces the existing red toast + `reportError` (inherited `wrapAsync`); no silent failure, no double toast.
- [ ] All new strings exist in both `en` and `beanie`; drag-handle/edit `aria-label`s and any placeholder are `t()`-bound; `npm run translate` succeeds; `npm run lint` passes `vue/no-bare-strings`.
- [ ] No duplicate i18n keys: `lists.detail.itemPlaceholder` and `lists.detail.titlePlaceholder` are **reused**, not redefined.
- [ ] Inline editors use a raw, focusable `<input>` (not `BaseInput`, which cannot autofocus) styled to match the static text — no layout jump.
- [ ] All sizing is rem-based; the inline-edit input matches the static text rhythm (no layout jump); works in Large Reading Mode.
- [ ] Bundle delta from `vuedraggable` documented (`npm run build`); within ~12–16 KB gzipped.
- [ ] Help Center Beanie Lists article updated with the edit/reorder passage.
- [ ] `CHANGELOG.md` + `docs/STATUS.md` updated.
- [ ] `npm run validate` green (type-check + lint + unit tests).

## Testing Plan

1. **Unit — `listStore`:**
   - `renameList`: trims; empty/whitespace → unchanged; unchanged title → no write; happy path updates title and **nothing else** (assert completion triple untouched).
   - `updateItemText`: edits the target item only; preserves `completed`/`completedBy`/`completedAt`; empty/whitespace → no-op; missing item → no-op; never flips list completion.
   - `reorderItems`: moves correctly (multiple from/to permutations incl. first↔last, adjacent); equal indices, negative, and `>= length` → no-op; never changes which items are completed or the list's filing state.
   - Each returns `null` when the list id is unknown.
2. **Component / manual — `ListDetailModal` (desktop Chrome):** rename a list; edit an item; emptying either reverts; starting a 2nd edit saves the 1st; **Esc cancels and does NOT commit** (regression-guard for the Esc/blur race — type, press Esc, confirm the old value remains); blur (tap away) saves; **closing the drawer mid-edit saves both a title edit and an item edit** (regression-guard for the row-owned-draft close-commit gap). Edit a completed item — stays ticked.
3. **Manual — drag (desktop mouse):** drag handle reorders; order holds after closing/reopening the drawer; ghost styling shows; text-tap-to-edit and checkbox still work (no accidental drag).
4. **Manual — drag (Chrome DevTools touch emulation + a real iOS device/PWA):** handle-drag reorders; dragging the row _body_ scrolls (doesn't drag); long lists auto-scroll while dragging; no console warnings; works in a stacked drawer (opened from the activity drawer).
5. **Manual — keyboard a11y:** the drag handle is reachable and focusable in Tab order with a sensible `aria-label`; the tappable title/item are keyboard-activable (Enter/Space). (Keyboard _reorder_ is out of scope this pass — see the fast-follow note.)
6. **Manual — Large Reading Mode:** rename/edit/drag all usable; no clipped inputs; input matches text size.
7. **Persistence / sync:** reorder + rename + item-edit on one device; confirm the change reflects after reload (IndexedDB/Automerge) — and, if convenient, on a second signed-in device.
8. **E2E (Three-Gate Filter):** _Provisional_ — a reorder-persistence E2E asserts data (the stored `items` order after a real drag), which passes Gate 1 (user-visible data) and Gate 2 (full-stack). **But** Playwright drag of a SortableJS handle is flakiness-prone (Gate 3). **Decision:** do **not** add an E2E in this plan; the store unit tests cover the reorder/rename/edit logic deterministically, and the drag _gesture_ is verified manually on real touch. Revisit only if reorder regressions recur. (Logged here so the omission is a documented choice, not an oversight — respects the 25-test budget.)
9. `npm run validate` + `npm run build` (bundle delta).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the three-action store layer (`renameList`/`updateItemText`/`reorderItems`, all via `updateList`, none touching completion), `useInlineEdit`-driven title + item editing in `ListDetailModal`, an additive `#title-content` slot on `BeanieFormModal`, `vuedraggable@4` one-way-bound with `@change`→`reorderItems` + a dedicated drag handle + keyboard reorder, additive `ListItemRow` props preserving the read-only embed, i18n keys, Help Center update, and a deliberate no-E2E decision.
- **Pass 2 (DRY + error handling)**: Caught two duplicate i18n keys (`itemPlaceholder` `:4346`, `titlePlaceholder` `:4380`) the draft would have redefined — now reused (new-key count cut 4→3, all aria-labels). Found `BaseInput` cannot autofocus (no exposed `focus()`; app-wide pattern is raw `<input ref>` + `nextTick().focus()`) — switched both inline editors to a raw styled input, which also fixes the text-rhythm/layout-jump requirement and avoids `BaseInput`'s border chrome. Corrected the "sibling `todoStore` reorder/rename" framing (none exists; shaped on the in-store add/remove/toggle trio). Verified all other reuse claims (`updateList`/`wrapAsync` single inherited toast, `useInlineEdit` API, `BeanieFormModal:109`/`:93` slot fix, `ListItemRow`/`LinkedLists` additive defaults, no existing drag dep) — accurate; no silent failures.
- **Pass 3 (Sustainability)**: Resolved the item-draft ownership contradiction (§2 vs §4) by giving `ListItemRow` its own self-contained edit draft and removing `draftItem` from the modal — killing a cross-boundary two-way binding. Made edit-persistence robust to the `list` computed re-projecting mid-edit by capturing `editingListId` at edit-start (replaces the unimplementable "save before the ref changes" watcher note). Pinned the one-way `:list` + `@change` reliability contract (synchronous dispatch, single mutation path) to document the known vuedraggable double-move footgun. Deferred hand-rolled keyboard reorder to a coherent a11y fast-follow (focus-follow + `aria-live` together) to keep the first DnD surface small. No changes to settled decisions.
- **Pass 4 (Fresh-eyes sweep)**: Verified all anchors (`BeanieFormModal:109`/`:93`, `itemPlaceholder:4346`/`titlePlaceholder:4380`, `saveField` clears-before-await) — all correct. Caught two commit-path bugs: (1) `@blur`+Esc double-fire — pressing Esc unmounts the focused input and the unmount `blur` would re-commit the cancelled value; resolved by **guarding the blur save with `isEditing`/a row `cancelled` flag** (keeps the convenient blur-to-save UX while making Esc never commit). (2) The Pass-3 row-owned item draft was unreachable by the modal's `saveAndClose`, so closing mid-item-edit lost keystrokes; resolved by having the **row self-commit its dirty draft on `onBeforeUnmount`/`editing`→false**. Updated the caveats, §2/§4, ACs, and the test plan to lock both guards in.

## Prompt Log

> No GitHub issue created — prompts captured here.

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-06-20)

> the deploy is current running in another claude code session. while that's running, i'd like to work on some fixes/improvements to the beanies lists feature, for now let's plan the below:
>
> I should be able to edit the title of a list
>
> I should be able to edit the items in a list
>
> /frontend-design - what is the most convenient way to be able to edit these items? i thinking just an inline quick-edit
>
> I should be able to re-order the items in a list. I'd like to do this with drag and drop (or tap/hold and drop), given we've been looking at implementing drag and drop for a while, should we implement this now for this simple feature?
>
> Please let me know your thoughts

### Follow-up — prior research pointer

> note that we've already done some research around drag and drop which should be in a saved plan in the repo

### Decisions (AskUserQuestion)

- **Scope:** One combined plan for all three (title edit + item edit + reorder).
- **DnD library:** SortableJS (purpose-built for lists) — not interact.js.

</details>
