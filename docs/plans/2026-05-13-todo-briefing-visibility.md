# Plan: Daily-briefing visibility for unassigned & child-only to-dos (and activities)

> Date: 2026-05-13
> Related issues: None — direct implementation (full prompt log: `docs/prompts/2026-05/2026-05-13-todo-briefing-visibility.md`)

## Context

Two gaps in how the Family Nook **daily briefing** ("critical items" in `FamilyStatusToast`, fed by `useCriticalItems`) surfaces to-dos:

1. **Unassigned to-dos silently vanished from the briefing.** `useCriticalItems` skipped any to-do not assigned to the current member, so a to-do created with no assignee showed in the To-Do widget and the To-Do page but on **nobody's** briefing. It is now treated as "whoever's free" and appears on **everyone's** briefing until completed.
2. **A to-do assigned only to a child never reached a parent.** A young child isn't checking the Nook; the parent is the de-facto owner of "Neil — wear AM uniform for school photos". A to-do with **no adult assignee** now shows on **every adult's** briefing, framed by the child's name ("Neil: …"); the assigned child still sees it as their own. Assigning even one parent collapses it back to the prior behaviour (only the assigned people see it). The **same child-only → all-adults rule also applies to calendar activities**.

Decisions (confirmed with greg): unassigned to-dos → **all non-pet members** (kids included); child-only rule → **also applies to activities**; message style → **name-led** ("Neil: wear AM uniform for school photos" / "buy milk (anyone can do this)"), 📋 icon (⏰ when overdue, as before); **unassigned _activities_ stay as-is** — passive calendar markers, not action items — only the child-only→adults rule extends to activities.

No data-model change, no migration. The change is read-only derived state (a `computed`) — reliability comes from making it unable to throw (defensive `?? []`, fallback names, requiring a resolved `currentMember`), not try/catch. It also removes a footgun: stale-assignee or pet-only to-dos that would previously resolve to phantom IDs now degrade cleanly to "anyone can do this" (never "Unknown: …").

## Approach

- **`src/composables/useMemberInfo.ts`** — extract two reusable helpers:
  - `isAdultMember(member)` exported standalone (lifted from the inline check in `getMemberRoleLabel`, which now reuses it): `!isPet && (role === 'owner' || ageGroup === 'adult')`.
  - `getMemberById(id)` added to the composable API; `getMemberName`/`getMemberColor` now go through it (was duplicated `members.find`).
- **`src/utils/assignees.ts`** — add `formatNameList(names)`: `"Neil"` / `"Neil & Sam"` / `"Neil, Sam & Max"`, `[] → ""` (total, never throws). Co-located with `normalizeAssignees`.
- **`src/composables/useCriticalItems.ts`**:
  - A module-level pure `classifyAudience(assigneeIds, viewer, resolveMember)` — _the_ canonical statement of the visibility rule — returning a discriminated union `{ kind: 'assignee' } | { kind: 'forChild'; childNames } | { kind: 'unassigned' } | { kind: 'hidden' }`. Used by both the to-do loop and the activity generic-assignee block, so the rule lives in exactly one place. Handles stale IDs + pets gracefully (filtered out → degrade to `unassigned`).
  - Module-level `*_KEYS` lookup tables (`satisfies Record<…, UIStringKey>`) keyed by audience × `DateState` (`overdue`/`today`/`noDue`) — replaces a nested-`if` explosion with a flat lookup; a key typo or a missing variant is a compile error.
  - To-do loop: classify → skip `hidden` → keep the existing date gates → flat key lookup + replacements per audience. Activity generic block (only when not pickup/dropoff): classify → emit the assignee message for `assignee`, the for-child message for `forChild`, nothing otherwise.
  - Stronger early return: `if (!familyStore.currentMember) return []` (also fixes a latent case where `currentMemberId` points at a removed member).
  - DRY: build the full sorted list once in a new `allCriticalItems` computed; `criticalItems = allCriticalItems.slice(0, MAX_ITEMS)`, `overflowCount = max(0, allCriticalItems.length - MAX_ITEMS)`. Removes the ~30-line shadow re-implementation of the filter that `overflowCount` carried. Public surface unchanged (`{ criticalItems, overflowCount }`) — `FamilyStatusToast.vue` untouched.
- **`src/services/translation/uiStrings.ts`** — 8 new keys (en + beanie), mirroring the existing `nook.criticalTodo*` pattern: `criticalTodoForChild` / `…ForChildNoDue` / `…ForChildOverdue`; `criticalTodoUnassigned` / `…UnassignedNoDue` / `…UnassignedOverdue`; `criticalActivityForChild` / `…ForChildNoTime`. `npm run translate` regenerates `public/translations/zh.json`.
- **Docs**: rewrite the `your-daily-briefing` article (`src/content/help/how-it-works.ts`) — the "it's just for you" callout was now wrong; broaden "what shows up" to cover medications too; add the child-only + unassigned cases for to-dos and activities; bump `updatedDate`. Add a "who sees a to-do" block + cross-link in the `family-todo-lists` article (`src/content/help/features.ts`). The `classifyAudience` doc-comment is the canonical statement; the help article mirrors it.
- **Tests** (`src/composables/__tests__/useCriticalItems.test.ts`): test fixtures gained `ageGroup` (the model requires it; the fixture omitted it) + `child-2` and `pet-1` members. 9 new cases — unassigned → all non-pet not pets; child-only → all adults + the child, not other kids; child+adult → only that adult + child; multi-child name joining; child-only activity → adults not other kids; unassigned activity → nobody; overdue/no-due variants; pet-only/stale degrades to "anyone can do this"; `overflowCount` consistency.

## Files affected

- `src/composables/useMemberInfo.ts` — `isAdultMember` (exported) + `getMemberById`; `getMemberRoleLabel`/`getMemberName`/`getMemberColor` reuse them
- `src/utils/assignees.ts` — `formatNameList`
- `src/composables/useCriticalItems.ts` — `classifyAudience` + `*_KEYS` tables; audience-branched to-do + activity messages; `currentMember` guard; `allCriticalItems` → `criticalItems`/`overflowCount`
- `src/services/translation/uiStrings.ts` — 8 new `nook.critical*` keys; `public/translations/zh.json` regenerated
- `src/content/help/how-it-works.ts` — `your-daily-briefing` article rewrite
- `src/content/help/features.ts` — `family-todo-lists` article: "who sees a to-do" block + cross-link
- `src/composables/__tests__/useCriticalItems.test.ts` — fixtures + 9 new cases
- `CHANGELOG.md`; `docs/prompts/2026-05/2026-05-13-todo-briefing-visibility.md`
- _(no change: `FamilyStatusToast.vue`, `NookTodoWidget.vue`, `todoStore.ts`, `models.ts`)_

## Verification

- `npm run translate` — uiStrings parse; `zh.json` regenerates with the 8 keys. ✓
- `npx vitest run src/composables/__tests__/useCriticalItems.test.ts` — 43 pass (34 existing + 9 new). ✓
- `npm run validate` — type-check / lint / format / unit / build.
- `npm run dev` Family Nook smoke: unassigned to-do → on everyone's briefing ("… (anyone can do this)"), pets get none; child-only to-do → every adult ("{child}: …") + the child ("Don't forget: …"); add a parent → only that parent + child; child-only activity dated today → same; >5 eligible → "+N more" correct; tick an unassigned to-do as a non-creator → completes for everyone.
