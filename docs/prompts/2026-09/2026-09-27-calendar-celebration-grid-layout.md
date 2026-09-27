---
date: 2026-09-27
category: bug
issue: ''
plan: ''
tags: [planner, calendar, celebration, css, cascade-layers, desktop]
---

# Desktop week and day views put events on the wrong day and lane

## Prompts

- **2026-09-27** Decisions at session start: "yes the deal pile should show card art - let's show the card art wherever possible as this would be much more interesting and engaging than a standard emoji. Regarding the real statement data in git this can be ignored"
- **2026-09-27** "before we move on to the card deck art, i noticed a major calendar display but that appears to impact both the weekly and daily views on the desktop calendar. on my prod family i have several activities scheduled for the weekend, and many of them have 2 or more owners. if i view those activities on a daily basis at mobile width they are laid out on the correct days, and viewing on the beanie wall as well as the desktop monthly view also appears to be ok. however, the bug seems to manifest on desktop weekly and daily (family member lane) views, where the placement of the activities is completely wrong. in the weekly view, in one case, an activity scheduled for sunday is going across fri and sat, and other activities are all being shown on the wrong days. similarly on the day view on desktop (family member lanes), events from the wrong day are showing and they are not displayed in the correct fmaily member lanes. Can you please do a full review of those surfaces to identify and fix the bug? once the bug is fixed, run a code-review at your proposed level across the fix, and if you think necessary you can extend across the wider calendar desktop implementation, to ensure the fix is accurate and other bugs were not missed, and new bugs or side effects were not introduced. i've attached screenshots from my prod family at /tmp/daily-calendar-bug-1.png and /tmp/weekly-calendar-bug-1.png"

## Outcome

Root cause: the global `.is-celebration { position: relative }` in `src/style.css` was unlayered, and
unlayered CSS beats every Tailwind layer, so it overrode `absolute` on the time-grid cards. A birthday
card (here with a long location) fell into normal flow; its nowrap text set the min-content of its `1fr`
column, which grew to ~560px while the other six days shrank to 88px (week) and the other lanes to 188px
(day lanes). Everything else was drawn under the wrong header. Present since 2026-09-02 (`fa2e3ced`).

Fix: the celebration rules now live in `@layer components`, so a positioning utility on the element
wins and in-flow chips keep `relative` as the default. Guard: `celebrationCascade.test.ts` (fails on the
old CSS). Browser-verified before/after with a seeded family: week columns 88/564 -> 156 each, day lanes
188/537 -> 275 each; month chip still `relative`, mobile DayTimeline and wall blocks now `absolute`.

## Follow-up: time-grid span fixes

- **2026-09-27** "Commit pushes and implement the identified bugs with /beanies-build-auto"
- **2026-09-27** "Approve and implement with beanies build auto do not stop unless there is a genuine blocker"

Outcome: plan `docs/plans/2026-09-27-calendar-time-grid-span-fixes.md` (four review passes, then built, two
`/code-review high` rounds). Shared `timeSpans.ts` for planner + wall; short, zero-length and overnight cards
fixed on every grid; repeating all-day activities show on every repeat. Defect 3 re-routed after review found
Google imports legitimately carry `endDate` on repeating events (see the plan's Outcome).
