---
date: 2026-09-29
category: feature
issue: '#113 (Notion)'
plan: 'docs/plans/2026-09-29-magic-beans-todos-and-shared-results.md'
tags: [magic-beans, ai, todos, shared-result, who-owns-what, activities, calendar-reveal]
---

# Magic beans to-dos and shared results (#113)

## Prompts

- **2026-09-29** "/beanies-new-issue Let's create a new item to add a magic bean category - todos (plus shared) ..." (full text in the plan's Prompt Log)
- **2026-09-29** "priority is high, include mockup"
- **2026-09-29** Intake answers: assignee = card owner, else submitter; to-do-only uses the same review box; no GitHub issue; no feature gate.
- **2026-09-29** "yes create it"
- **2026-09-29** "regarding your questions - yes, let's link saved to-dos back to the activity ... do ahead with /beanies-pre-plan and go directly to /beanies-plan and /beanies-build-auto - only stop if you need a decision for me or hit a blocker"
- **2026-09-29** Mockup decisions: layout A (side drawer); delete default keeps the to-dos; undated prep to-dos due the day before; approved.
- **2026-09-29** "after early quick testing noticed 2 issues: 1) if i open the magic beans drawer from the FAB (no item selected) then after sending the submission to AI, the review sidebar does not open ... 2) after an activity is created, depending on the view we are in, we shuld alwasy scroll to the item ... and give it a focus pulse (as per the convention). also in the activity created modal/toast create an option to open the activity that was just created (i.e. 'view activity')"
- **2026-09-29** On issue 1: "the first time nothing happened, but I've just tested it again and it worked withot any issue. perhaps there was ongoing work happening."

## Outcome

Built, reviewed twice at `high`, verified in a browser (Playwright, light/dark, 390/1280). `ai-extract` Lambda applied; app not deployed. See the plan's Outcome section for deviations and follow-ups.

## Round 2 prompts

- **2026-09-29** "I've done some testing now and it's looking very good ... 1) ... should we check to confirm if the todo already exists before creating another? ... 2) ... linked todos in an activity ... 3) ... create a list from an activity ... 4) when a todo is created, it seems to skip the time ..."
- **2026-09-29** "#1+#4 now, log #2+#3" (plan approved: `docs/plans/2026-09-29-magic-beans-todo-dedupe-and-times.md`)
- **2026-09-29** "go ahead to create the issue in the issue tracker also as high priority" (created tracker #114)
