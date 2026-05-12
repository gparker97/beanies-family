---
date: 2026-05-12
category: feature
issue: none
plan: docs/plans/2026-05-12-public-holidays-on-the-planner.md
tags: [planner, calendar, holidays, reference-data, i18n, settings, onboarding]
---

# Public Holidays on the Family Planner

## Prompt 1 — 2026-05-12 (via `/beanies-plan` with leading `/frontend-design`)

> One thing I'd like to add to the family activies / planning section is a list of local public holidays for each family, based on the country where they live.
>
> Public holidays should be visualized on the calendar and planner as special days, clearly indicating they are a holiday, but with some type of subtle differentiation from normal plans, all-day events, travel, etc. Public holidays are special, and there is usually no school on public holidays, so it is important information for families to be aware of.
>
> Can you propose a few simple and elegant methods for (a) determine how we can capture and keep an up to date list of public holidays across all countries, and (b) how we would visualize those public holidays for users

## Clarifications (AskUserQuestion)

- **Data source** → "Generated JSON, committed" (devDependency `date-holidays` + committed generator → `public/holidays/<CC>.json`, fetched on demand, IndexedDB-cached; refreshed via scheduled CI + Dependabot).
- **Visual** → "Cell tint + flag + label chip" (warm-clay cell wash + country flag emoji by the date + an italic holiday-name chip in the all-day lane; week-header tint/flag; day-view banner).
- **Setup surface** → "New Settings card + onboarding step" ("Country & Holidays" Settings card + optional picker in onboarding step 1).
- **v1 scope** (follow-up) → "Keep v1 lean" (national `public`-type holidays only, English names) + "Include the details popup + opt-out toggle" + keep the observance note in beanie language: "work and school are probably off — please check!"

## Prompt 2 — 2026-05-12 (review redirection, after the first plan draft)

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles — you are not re-writing or repeating any code. Check existing helpers, functions, composables, etc or other code where a solution already exists, check existing components and other reusable UI elements. If you are re-implementing any code that already exists elsewhere, including a UI modal or component that exists elsewhere (or a very close version exists), function, helper, composable, etc, considering refactoring this into a generic item now as opposed to duplicating code and refactoring later. Ensure that there are never any silent failures. […] Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, silent failures, overly complicated flows, or code bloat where not necessary.

## Prompt 3 — 2026-05-12 (review redirection)

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex or difficult to support or maintain in the future. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

## Prompt 4 — 2026-05-12

> [plan approved] [implementation]

## Outcome

Implemented end-to-end (Phase 1 + Phase 2 from the plan; the Nook surface stays deferred). `npm run validate` green. **Not deployed** — left for greg to review the help-center copy and do a hands-on browser smoke pass before pushing to prod. Full detail of what landed is in `docs/STATUS.md` (2026-05-12 "Last updated" entry) and `CHANGELOG.md`.
