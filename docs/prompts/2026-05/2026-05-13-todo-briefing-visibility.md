---
date: 2026-05-13
category: feature
issue: 'None — direct implementation'
plan: 'docs/plans/2026-05-13-todo-briefing-visibility.md'
tags: [todo, daily-briefing, nook, useCriticalItems, assignees, visibility, help-docs]
---

# Daily-briefing visibility for unassigned & child-only to-dos (and activities)

Two changes to how the Family Nook daily briefing (`useCriticalItems` → `FamilyStatusToast`) surfaces to-dos: (1) a to-do with no assignee now shows on every non-pet member's briefing until it's done; (2) a to-do (or activity) assigned only to a child now shows on every adult's briefing, framed by the child's name — unless a parent is also assigned, in which case only the assigned people see it.

## Prompt 1 — 2026-05-13 (the proposal)

> Let's make an update to how todos work and how they are displayed on the daily briefing section of the family nook page. I'd like to make the below proposals:
>
> 1. Todos not assigned to anybody — at the moment, I believe unassigned todos do not show up in anybody's critical app section. Rather than nobody, I'd like them to show up on everybody's critical app section until they are completed. A todo assigned to nobody should be considered as if it's an immediate action that should be done by anybody
> 2. Todos assigned only to a child — for a todo assigned to only a child or children (but no adult) — the relevant messages should show up (as per the existing visibility rules for dates) on ALL critical app sections for adults. … if you want a specific parent or adult(s) to be notified on this, then simply include both the child and 1 or more parents to the todo item. So the rule is — if only a child, but no parents, are assigned — all adults see the item in the daily briefing, but if one or more parents are assigned, only those parents see the item.
>
> Update the documentation as well to reflect this new functionality. What are your thoughts on this approach?

→ Endorsed; proposed folding both into one rule ("if no grown-up owns it, the grown-ups pick up the slack; if literally nobody owns it, it's everyone's"). Asked three clarifying questions.

## Prompt 2 — 2026-05-13 (clarifying answers)

- Unassigned to-dos → **all non-pet members** (kids included).
- Child-only rule → **also applies to calendar activities**.
- Message style → **Style B, name-led**: child-only "Neil: wear AM uniform for school photos"; unassigned "Buy milk (anyone can do this)"; 📋 icon.

## Prompt 3 — 2026-05-13 (existing help article note)

> Keep in mind there is already a help center article called "your daily briefing" at /help/how-it-works/your-daily-briefing which goes into the logic of what is displayed

→ Plan updated to rewrite that article (its "it's just for you" callout was now wrong) rather than adding a new one; also broadened it to cover medications, which it had never been updated to mention.

## Prompt 4 — 2026-05-13 (review pass 1 — DRY / no silent failures / simplicity)

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles … Check existing helpers, functions, composables … If you are re-implementing any code that already exists elsewhere … considering refactoring this into a generic item now …

→ `getMemberById` consolidation in `useMemberInfo` (was duplicated `members.find`); `isAdultMember` extracted from `getMemberRoleLabel`; `classifyAudience` as the single source of the rule (used by both the to-do and activity loops); `formatNameList` reused-or-added-once in `utils/assignees.ts`; `overflowCount` collapsed onto a shared `allCriticalItems` computed (was a ~30-line shadow re-implementation — a real drift hazard); stale-assignee / pet-only items degrade gracefully to "anyone can do this" instead of "Unknown:".

## Prompt 5 — 2026-05-13 (review pass 2 — sustainability / maintainability / reliability)

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability … Check for deep nesting, overly coupled structures, or any other complexity …

→ `classifyAudience` returns a proper discriminated union (no `childNames: []` noise on non-`forChild` cases); message-key selection flattened into small `satisfies`-typed lookup tables instead of nested `audience × dateState × self/other` ifs; `currentMember` (not just `memberId`) required as the early-return guard (also fixes a latent removed-member case); the three-loops-in-one-computed structure kept (the established pattern; the targeted complexity fix is the key tables, not a structural rewrite); tests assert resolved message substrings, not `UIStringKey` constants.

## Outcome

Implemented as planned. `src/composables/useCriticalItems.ts` reworked around `classifyAudience` + the `*_KEYS` tables; `useMemberInfo` gained `isAdultMember` (exported) + `getMemberById`; `utils/assignees.ts` gained `formatNameList`; 8 new `nook.critical*` uiStrings (zh regenerated via `npm run translate`); the `your-daily-briefing` help article rewritten + the `family-todo-lists` article extended with a "who sees a to-do" block + cross-link; `useCriticalItems.test.ts` fixtures gained `ageGroup` + extra members and 9 new cases (43 pass). No data-model change. Plan: `docs/plans/2026-05-13-todo-briefing-visibility.md`.
