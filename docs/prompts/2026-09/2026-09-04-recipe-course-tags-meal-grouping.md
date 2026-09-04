---
date: 2026-09-04
category: feature
issue: Notion tracker #87 (no GitHub issue — direct implementation)
plan: docs/plans/2026-09-04-recipe-course-tags-meal-grouping.md
tags: [cookbook, recipes, taxonomy, meal-planner, refactor, ai-extraction, i18n]
---

# Recipe course, tags and meal grouping (#87)

Sibling of #86 from the same early-adopter Discord thread on 2026-09-04. The user asked for
"categories for the recipe section" and "the ability to group them by meal (breakfast, lunch,
dinner, brunch, snack)". greg's decisions at intake: no brunch for now; category is BOTH a
course dropdown AND free-form tags; build order #86 → #87 → #88.

## Prompts

**16:0x — after #86 shipped and was tested**

> ok - let's move on to implement #87 - can you start /beanies-pre-plan

**During pre-plan, on the mockup**

> let's go with A

(Direction A of three: the group axis becomes recipe-box divider tabs, and the selected tab
joins the tray beneath it, so the page reads as one object rather than a toolbar stacked on a
grid. Rejected: a sticky filter/sort bar, and a collapsed filter tray.)

**Handoff to planning and implementation**

> continue to /beanies-plan - once plan is done proceed with implrmentation. once
> implementation is complete run a /code-review max to ensure all code was implemented as per
> the design and plan and workds as expected and does not introduce any new bugs, side
> effects, or security concerns

**Follow-ups, same session**

> small change - on the input form for recipe tags, i notices you have a list of "used before"
> tags but when typing the tags, it is easy to make a typo or to miss that list. can you include
> an autocomplete so an existing tag can be more easily selected?
>
> also with /frontend-design:frontend-design can you do a quick review and validate the field
> ordering on the recipe modal? it's getting longer, so it may benefit from having categories
> (i.e. main recipe, notes, other info, etc) or something to that effect to make it easier to
> take in everything an dbreak up the long list of fields. what are your thoughts?

Then, on the sectioning study:

> sure let's go with A

## Outcome

Shipped to `main` as three independently-revertable commits, each fully gated:

- `9d1a987f` — meal-slot consolidation (behaviour-identical; 15 duplicated definitions → 1)
- `336643d4` — shared UI primitives (`usePersistedChoice`, `ui/SortMenu`, `ChipButton`,
  `ChipToggleGroup`)
- `530db3f8` — the feature

**The finding that justified the four-pass discipline.** Passes 2 and 3 both identified the
form's save path as the change's biggest data-loss risk and both named the same two sites
(`baselinePayload`, `buildPayload`). Pass 4 — a fresh subagent with no sight of either — found
there are **four**, and that the missed one (`useFormModal({ onEdit })`) was the dangerous one:
omitting the new fields there would have silently wiped every recipe's tags, course and meals
on _any_ edit, including fixing a typo in the title. Verified by mutation: deleting that
seeding fails 4 of the round-trip test's 7 assertions.

Pass 4 also caught that `diffPayload`'s array equality is by index (so `mealSlots` needs
canonical ordering on both payload sides), that `[]` and `undefined` are both "unset" with `[]`
now the common case, that `recent`/`cooked` need a name tie-break for device-stable ordering,
that the course filter must **not** persist while sort and group must, and that
`FrequencyChips` has 16 call sites rather than the 13 Pass 3 counted.

Two-deployable: the ai-extract Lambda must ship alongside the client. Deploy and the manual
matrix are still owed — see `docs/STATUS.md`.
