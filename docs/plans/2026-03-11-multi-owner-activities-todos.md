# Plan: Multi-Owner Support for Activities and Todos

> Date: 2026-03-11

## Context

Activities and todos currently support only a single owner (`assigneeId?: UUID`). We need 0-to-many owners for todos and 1-to-many owners for activities, with proper notification routing and an inline-edit cancel button.

## Key Design Decisions

1. **New field `assigneeIds: UUID[]`** alongside legacy `assigneeId`. A tiny normalizer utility is the single source of truth — all consumers call it, never read `assigneeId` directly. Writes populate both fields for backward compat.

2. **Dropoff/Pickup stay single-select.** They're transport roles (one person drives), not ownership.

3. **Cancel UX for inline chip pickers:** Add confirm/cancel buttons directly in the `#edit` slot template — no changes to `InlineEditField.vue` needed. For multi-select assignee pickers, the user toggles chips then clicks confirm (saves) or cancel (reverts). For single-select pickers (dropoff/pickup), keep auto-save but add a cancel button.

4. **Extract `MemberChip.vue`** — The same colored-pill pattern (name + member color) is duplicated inline across 5+ components. Extract once, use everywhere. This prevents the multi-owner change from multiplying the duplication.

---

## Implementation Steps

### Step 1: Extract `MemberChip.vue` (DRY cleanup)

**New file: `src/components/ui/MemberChip.vue`**

A tiny presentational component accepting `memberId` (uses `useMemberInfo` internally) with two size variants:

- `size="sm"` — `rounded-full px-2 py-0.5 text-xs font-medium` (list/card usage)
- `size="md"` — `rounded-full px-3 py-1.5 text-xs font-semibold font-outfit` with gradient (modal usage)

Both render white text on member-color background. Falls back to "Unknown" if member not found.

**Then replace inline chip HTML in these files:**

- `DayAgendaSidebar.vue` (lines 142-148, 214-220) → `<MemberChip :member-id="..." size="sm" />`
- `UpcomingActivities.vue` (lines 116-122) → same; also remove local `getMemberColor`/`getMemberName` functions and use the component instead
- `TodoPreview.vue` (lines 86-92) → same
- `TodoItemCard.vue` (lines 166-174) → `<MemberChip :member-id="..." size="sm" />`
- `NookTodoWidget.vue` (lines 267-274) → same
- `ActivityViewEditModal.vue` (lines 646-654) → `<MemberChip :member-id="..." size="md" />`
- `TodoViewEditModal.vue` (lines 448-456) → same

This step is pure refactor — no behavior change — and sets up multi-owner rendering to be trivial (just `v-for` with `MemberChip`).

### Step 2: Data Layer — Types + Normalizer

**`src/types/models.ts`** — Add `assigneeIds?: UUID[]` to `FamilyActivity` and `TodoItem`. `@deprecated` JSDoc on `assigneeId`.

**New file: `src/utils/assignees.ts`** — Two functions:

```ts
normalizeAssignees(entity: { assigneeIds?: string[]; assigneeId?: string }): string[]
toAssigneePayload(ids: string[]): { assigneeIds: string[]; assigneeId: string | undefined }
```

### Step 3: Store & Composable Layer

**`src/composables/useMemberFiltered.ts`** — Widen callback return type to `string | string[] | undefined | null`. Array logic: include if **any** ID is selected. Fully backward-compatible.

**`src/stores/activityStore.ts`** — `createMemberFiltered(activeActivities, (a) => normalizeAssignees(a))`

**`src/stores/todoStore.ts`** — `createMemberFiltered(todos, (t) => normalizeAssignees(t))`

**`src/composables/useCriticalItems.ts`** — Replace `=== memberId` with `normalizeAssignees(x).includes(memberId)`.

**`src/services/automerge/repositories/activityRepository.ts`** — `getActivitiesByAssignee()` uses `normalizeAssignees().includes()`.

**`src/services/automerge/repositories/todoRepository.ts`** — Same.

### Step 4: ActivityViewEditModal — Multi-Select + Cancel

**`src/components/planner/ActivityViewEditModal.vue`**:

- `draftAssigneeId` → `draftAssigneeIds: ref<string[]>([])`
- `populateDraft('assignee')`: use `normalizeAssignees(activity.value)`
- `handleAssigneeChange`: update draft only (no auto-save)
- Add confirm (✓) + cancel (✗) buttons in the `#edit` slot after the `FamilyChipPicker`. Confirm calls `saveField('assignee')`, cancel calls `cancelEdit()`.
- `saveDraft('assignee')`: validate `length >= 1`, use `toAssigneePayload()`
- View mode: `v-for` over `normalizeAssignees()` rendering `<MemberChip>` components
- `viewAssignee` computed → `viewAssigneeIds` returning `normalizeAssignees(activity.value)`
- Dropoff/Pickup: keep `mode="single"` + auto-save, add cancel button next to picker

### Step 5: TodoViewEditModal — Multi-Select + Cancel

**`src/components/todo/TodoViewEditModal.vue`** — Same pattern as Step 4, except no minimum-1 validation (todos can be unassigned). View renders chips or "Unassigned".

### Step 6: ActivityModal (Create/Edit Form)

**`src/components/planner/ActivityModal.vue`**:

- `assigneeId: ref('')` → `assigneeIds: ref<string[]>([])`
- `FamilyChipPicker mode="multi"` for "Who's going?"
- `canSave`: require `assigneeIds.value.length >= 1`
- Save: `toAssigneePayload(assigneeIds.value)`
- Edit populate: `normalizeAssignees(activity)`

### Step 7: Multi-Chip Rendering in Lists

All list views already use `MemberChip` from Step 1. Now change from single to multi:

- `DayAgendaSidebar.vue` — `v-for` over `normalizeAssignees(occ.activity)`
- `UpcomingActivities.vue` — same
- `TodoItemCard.vue` — `v-for` over `normalizeAssignees(todo)`
- `TodoPreview.vue` — same
- `NookTodoWidget.vue` — same
- `ActivityLinkDropdown.vue` — show comma-joined names or first + "+N"

### Step 8: Page-Level & Quick-Add Updates

- `FamilyPage.vue` — member counts: `normalizeAssignees(x).includes(m.id)`
- `FamilyTodoPage.vue` — member filter: same
- `QuickAddBar.vue` — emit `toAssigneePayload([selectedId])` instead of `{ assigneeId }`
- `NookTodoWidget.vue` — `createTodo` call: use `toAssigneePayload([id])`

### Step 9: Translation Strings

**`src/services/translation/uiStrings.ts`** — Add `planner.assigneeRequired` validation message. Reuse existing `planner.field.assignee` label (no need for a separate plural form — it works for both).

### Step 10: Tests

- New: `src/utils/__tests__/assignees.test.ts` — cover normalizer + payload builder
- Update `useCriticalItems` tests for multi-assignee
- Run `npm run type-check`, `npm run lint`, existing tests

---

## Files Affected

| File                                                        | Change                                 |
| ----------------------------------------------------------- | -------------------------------------- |
| `src/components/ui/MemberChip.vue`                          | **New** — reusable member chip         |
| `src/utils/assignees.ts`                                    | **New** — normalizer + payload builder |
| `src/types/models.ts`                                       | Add `assigneeIds` field                |
| `src/composables/useMemberFiltered.ts`                      | Support array return                   |
| `src/composables/useCriticalItems.ts`                       | Use normalizer                         |
| `src/stores/activityStore.ts`                               | Update filtered getter                 |
| `src/stores/todoStore.ts`                                   | Update filtered getter                 |
| `src/services/automerge/repositories/activityRepository.ts` | Array-aware query                      |
| `src/services/automerge/repositories/todoRepository.ts`     | Array-aware query                      |
| `src/components/planner/ActivityViewEditModal.vue`          | Multi-select + cancel                  |
| `src/components/planner/ActivityModal.vue`                  | Multi-select in form                   |
| `src/components/todo/TodoViewEditModal.vue`                 | Multi-select + cancel                  |
| `src/components/planner/DayAgendaSidebar.vue`               | Use MemberChip + multi                 |
| `src/components/planner/UpcomingActivities.vue`             | Use MemberChip + multi                 |
| `src/components/todo/TodoItemCard.vue`                      | Use MemberChip + multi                 |
| `src/components/planner/TodoPreview.vue`                    | Use MemberChip + multi                 |
| `src/components/nook/NookTodoWidget.vue`                    | Use MemberChip + multi                 |
| `src/components/ui/ActivityLinkDropdown.vue`                | Multi-name display                     |
| `src/pages/FamilyPage.vue`                                  | Array-aware lookups                    |
| `src/pages/FamilyTodoPage.vue`                              | Array-aware filter                     |
| `src/components/todo/QuickAddBar.vue`                       | Array payload                          |
| `src/services/translation/uiStrings.ts`                     | New string                             |
| `src/utils/__tests__/assignees.test.ts`                     | **New** — unit tests                   |

## Verification

1. `npm run type-check` — no errors
2. `npm run dev` — manual test: create/edit activities and todos with multiple owners, verify chips render everywhere, cancel button works, member filter works, critical items shows for all owners
3. `npm run lint` — clean
4. Existing tests pass
