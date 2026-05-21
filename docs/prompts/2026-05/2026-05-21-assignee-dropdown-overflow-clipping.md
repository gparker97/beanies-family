---
date: 2026-05-21
category: bug
issue: null
plan: none
tags: [ui, nook, todo, dropdown, popover, overflow, teleport, assignee]
---

# Assignee dropdown clipped by section overflow (Nook / To-do)

## Prompts

**[~11:4x]** Minor UI issue — on /nook (and potentially /todo) the dropdowns (assignee, due date) get cut off when they reach the bottom of the section/div. Seeing the dropdowns cut off today. Check they're set to work properly with overflow.

## Outcome

Implemented on `main` (not yet deployed).

**Diagnosis:** Two pickers feed the quick-add rows on both pages (`QuickAddBar.vue` on /todo, `NookTodoWidget.vue` on /nook). The **date** picker (`BeanieDatePicker.vue`) was already overflow-safe — it teleports its popover to `<body>` with `position: fixed` coords + drop-up + scroll/resize tracking ("clipping ancestors don't cut it off"). The **assignee** picker (`AssigneePickerButton.vue`) was NOT: its popover was `position: absolute; top-full` inside a `relative` wrapper, so any ancestor with `overflow: hidden/auto` (a card / scrollable section) clipped it near the bottom. That was the real bug.

**Fix:** Brought `AssigneePickerButton` up to the same proven `BeanieDatePicker` idiom — `<Teleport to="body">` + a `positionPopover()` that computes fixed viewport coords anchored to the trigger, honoring the `align` prop (right edge / left edge), flipping up when there's no room below, clamping to the viewport, and repositioning on scroll/resize. Click-outside now also ignores clicks inside the teleported popover (it's no longer a DOM descendant of the trigger). Fixes both /nook and /todo (shared component) and is safe across all 6 call sites (`QuickAddBar` ×2, `NookTodoWidget` ×2, `ActivityModal` ×2). No visual restyle — same popover markup.

**Note / follow-up:** ~6 components now hand-roll the teleport+position+drop-up+scroll-track popover logic (`BeanieDatePicker`, `BeanieTimeInput`, `BaseCombobox`, `AssigneePickerButton`, …) with no shared composable. A `useAnchoredPopover()` extraction would consolidate them — flagged as a future DRY cleanup, out of scope for this fix. `BeanHero.vue` also still uses an `absolute top-full` popover (latent same bug, not on Nook/To-do — left untouched).

**Verification:** new `AssigneePickerButton.test.ts` (4 tests: teleports out of the wrapper, fixed-not-absolute coords below the trigger, `align` left/right anchoring, click-inside-stays-open) green; `npm run type-check` clean; eslint clean on touched files. No existing tests covered this component.
