---
date: 2026-09-03
category: feature
issue: none
plan: docs/plans/2026-09-03-wall-time-grid.md
tags: [wall, calendar, layout, design, accessibility]
---

# The concertina time grid for beanie wall mode

## Prompts

### 2026-09-03 — initial (design exploration)

> before moving to #84 i wanted to propose to see how the wall mode would look with a time grid. using /frontend-design:frontend-design to propose the design, can we see how a time grid would look? as you know we have 3 views - on some i think there is plenty of space (for example, on the today view) to show items in a time grid, while on other views, we have to be clever about how we conserve space and i'm open to any ideas you have (i.e. onyl showing as much time grid as we need to show the earliest and latest events, adding an element to scroll from morning to afternoon/evening, etc - or anything else appropriate). also please look at skylight and other competitors to see how they manage putting items o na time grid when there is limited space. scrolling abviously should be avoided where possible, but i'm ok to look at is as an option, or something similar.
>
> can you pls propose how the wall mode screens might look with a clear and easy to see time grid so that items are easy to see and clearly laid out in relation to time. ask me anhy questions as needed

Answered via `AskUserQuestion`:

- **Time axis** — "Concertina (recommended)": proportional blocks, empty stretches fold to a labelled band.
- **Grid scope** — "All three (recommended)".
- **Peripherals** — "Collapse when the grid needs it (recommended)".

### 2026-09-03 — implement

> let's try the time grid in real life implementation to see how it works. i'm ok to cap long events if that is your recommendation. please go ahead to plan via /beanies-plan. once done go ahead with implementation, and once implementation is compelte run a /code-review max against the full implementation to ensure everythign works as designed and the style does not introduce any display issues or bugs. take screenshots and view those screenshots to ensure everything is displayed and laid out correctly in an easy to see and intuitive way. fix any issues found.

### 2026-09-03 — five design corrections after looking at the running app

> - when there are fewer events (i.e. 1-2 events in a day), a single even takes up half the screen. i think this is exactly the type fo situation where it makes sense to show blank space, because the day is not busy. showing a huge and tall event is confusing. could we perhaps have a maximum limit for height on events, and then show empty time above and below if needed? i would cap an event roughly a bit larger what it would take to display the agenda cards we had previously, and reduce the height only when needed, but avoid increasing height to keep consistency and to keep everything roughly the same size
>
> - it looks like the beanie lanes lost their color in the columns - didn't they used to be shaded based on the beanie colors?
>
> - also on the beanie lanes view, it seems the todos have been written to a row below the lanes and without any coloring. i think if we need to save space here, rather than putting todos on (or below) the lanes, we can just bring the cards (which were squeezed down to 1 row) back to being taller again and give them back their title and space, and just allow the user to tap the card to bring up the todo drawer, as we did before. this could save space, and todos would only be in the drawer a they are on other screens
>
> - it also looks like the calendar cards went back to being white with a color highlight on the edge - didn't ehy used to be shaded based on the color of the family member? or am i misremembering?
>
> - on the weekly calendar and beanie rows, it's hard to see the distinction between days / columns. there is very little separation and just a very thin grey line that can hardly be seen. for the beanie lanes, adding color shading could help here, but i still think it would improve from a design perspective to have something helping to visually separate the lanes / columns

## Outcome

Shipped behind the existing `beanieWall` flag (prod `false`).

**What the design became.** A concertina axis: proportional blocks on a scale that
shrinks to fit a busy day and never grows past natural size, with empty stretches
folded into a labelled band ("quiet until 15:20"). One renderer serves all three
calendar views. Greg's five corrections landed as: a bounded natural scale so a
quiet day looks quiet, lane tints restored (with cards staying neutral inside a
lane and washed on day columns — the lane rule), the per-lane jobs row removed in
favour of the to-do drawer, and much stronger column separators.

**Process note worth keeping.** Screenshots of the running app found seven layout
defects that 5,500 green tests and careful reasoning did not, including a fixed
block cap that made a two-hour event render _shorter_ than the one-hour event
beside it. `/code-review max` then found fifteen more, five confirmed by executing
the code — among them two of my own regression tests that could not fail, and a
now-line `z-index` that reintroduced the exact defect the test beside it claimed
to prevent. Neither the visual pass nor the review pass was redundant; they found
disjoint classes of defect.

Screenshot harness: `scripts/design-screenshots/wall-grid-capture.ts`
(`npx playwright test -c playwright.design.config.ts --grep "wall time grid"`).
