---
date: 2026-08-29
category: feature
issue: 'Notion tracker #58'
plan: docs/plans/2026-08-29-continuous-month-navigation.md
tags: [planner, calendar, mobile, scrolling, ux]
---

# Continuous month navigation (#58)

## Prompts

**14:52 — intake**

> #58 let's prepare for implementing - this should be a fairly simple UX improvement to get continuous scrolling on monthly view on mobile. ask questions as needed and once clear move onto /beanies-plan

**15:05 — scope correction (the key one)**

> Actually, from the beginning I'm fairly certain the scope of this was to fix the ux on mobile and when I said desktop previously, I think I meant it failed at mobile width on desktop while I was testing using my mouse. The goal was to have a more natural and intuitive feel when scrolling in month view at mobile width — which applies to both the PWA, the app, and desktop at mobile width. When scrolling down to the end of a month, continuing to scroll takes you into the next month with a clear indicator that the next month is starting. At the same time, if you use the left or right swiping hand gesture to change month, moving to the next month places you at the start of the month on the 1st, and moving to the previous month places you at the end of the month on the last day.

Answers to the intake questions: trigger = the grid's own bottom/top edge (not page-bottom); no pre-turn affordance on desktop; reuse the existing slide animation.

**15:18 — scroll model + desktop disposition**

> Seamless continuous stream (mobile). Tackle both at once and use /frontend-design to propose the most natural and intuitive UX (desktop).

**15:41 — mockup approval**

> approved A (mobile) and B1 for desktop

**15:44 — build**

> approved and implement. once done run a /code-review max to ensure the code implemented runs as designed and no side effects or bugs were introduced, and fix any issues found

## Outcome

Shipped as `ed4cd201` + review fixes. New `CalendarMonthStream.vue` (mobile continuous stream), `useWheelMonthPaging` (desktop B1 edge-resistance), pure `monthCells` module shared by both surfaces, `getAppScroller` seam, reduced-motion consolidated onto `useReducedMotion`. `CalendarGrid` shed its mobile half (540 → 201 lines) with its interface unchanged.

`/code-review max` returned 15 findings — all legitimate, all fixed. The three that would have shipped real breakage: the window-compensation runaway (net-delta compensation across an above+below mutation, self-sustaining), the anchor race that made "Today" land on the 1st, and `deltaMode` never being read (Firefox wheel-mouse = a silent dead zone at the grid edge — the exact "desktop with a mouse" configuration that sank the 2026-07-24 attempt).

Still owed: greg's hand-verification on phone and desktop (the tracker's explicit definition of done — unit tests were insufficient evidence the first time).
