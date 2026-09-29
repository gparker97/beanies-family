---
date: 2026-09-29
category: feature
issue: '#116 (Notion)'
plan: 'docs/plans/2026-09-29-meal-planner-shopping-list.md'
tags: [meal-planner, shopping-list, recipes, servings, lists, checklist]
---

# Weekly shopping list from the meal planner (#116)

## Prompts

- **2026-09-29** "/beanies-pre-plan #116 let's start the plan and build for this - once done move direct to /beanies-plan and /beanies-build-auto - work autonomously as i'll be aware and only stop for a genuine blocker or someting requiring a decision. if any questions please ask now"
- **2026-09-29** Intake answers: stop for the mockup pick; magic beans merge suggestions automatic; OK to apply the ai-extract Lambda; already-on-list items flagged and unticked.
- **2026-09-29** "pls generate the mockup as a claude artifact"
- **2026-09-29** "Thanks this looks very good. However I think we're trying to hard here to merge similar items, and if we take direction (B) by meal, i think the problem goes away. Since each line in an ingredient list for a given meal is very unlikely to have duplicated, for simplicity, i think we can drop this requirement for now. When it comes to a single recipe shopping list there is no need to check for duplicates, and when creating a shopping list for a full meal planner week, we just need to de-duplicate and count the number of times each recipe is listed in the meal plan, and multiple the indgredient ammount by those types. In addition, there is a 'who's eating' section for every recipe, and each recipe should also have a 'servings' field (i.e. serves 8). we can use both of these numbers to determine the amount of ingredients required in the shopping list. For example if 'who's eating' is 8 people, and the recipe servings is 4, then the list of ingredients should be multipled by 2 (8 / 4 = 2). We should multiple ingredients by the smallest whole number to have enough to feed the number of people eating. If we need to fix the "servings" field from free text to a number, let's do that so the shopping list calculations can be more accurate. Ultimately, the shopping list for a meal planner week should reflect the list of recipes to be served (as per direction b) with the number of ingredients based on the number of times that meal will be served, and the number of people eating each time. If either number if not specified, then we just go with the default amount listed in the recipe. Let me know if this makes sense and ask questions as needed."
- **2026-09-29** Follow-up answers: servings becomes a number, old text converted to its first number ("12 muffins" cleared); multiplier = ceil per meal, then summed; lines with no amount kept as written; no "already on your list" flag.

## Outcome

_(filled in when the build completes)_
