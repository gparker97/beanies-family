---
date: 2026-03-20
category: feature
issue: n/a
plan: pending
tags: [vacation, planner, activity, modal, wizard, mockup]
---

# Family Vacation Planner — Mockup & Design

## Prompt 1 — Initial Feature Request

**Time:** 2026-03-20 ~session start

> Let's incorporate the ability to add a family vacation to the planner. A family vacation is like an activity but has much richer information to capture (and usually is not recurring). As a parent, I would love the ability to capture family vacation plans and all relevant information to be shared with my family members so that everything is in order and we can even collaborate on plans.
>
> when creating a family activity, add an option at the top to make it a family vacation - make this fun and clear to see, but also also fit inline with the activity create modal and theme. the idea is that, to keep the UI clean, there is always one button to create an activity - but the activity can be a regular daily activity, or a family vacation
>
> build the family vacation capture details reusing the existing beanie modal components and theme, ensure the design and look and feel matches the other modals
>
> capture everything that would be relevant to a family information, such as vacation type (fight, cruise, road trip - not drive, combo, etc,), flight info, Cruise info, hotel info, rental car or train info, airport or hotel / cruise transportation info, booking codes or numbers,
>
> perhaps capture in a wizard format to make the process less intimidating and more engaging and fun - but will leave this up to your judgement to propose something in the mockup
>
> add fun icons, sayings, silly headlights and titles etc to make the information capture process more fun and engaging
>
> display vacations on the planning page sidebar and calendar in a Prominent and fun way that embodies the excitement and fun of a family vacation, such as celebration icons, bright colors, etc
>
> don't ask for start and end dates, generate the vacation dates bases on the travel info entered ( ie start and end dates of cruise , departure flight and return flight, hotel dates, etc)
>
> give user option to say certain plans are not completed yet and leave black, for example return flight is selected but no info. This is important info because Later we can trigger reminder notifications to book the unfinished portions of family vacations.
>
> add ability to capture touring and sightseeing and other vacation ideas and collaborate on them with your family. Capture who created each idea
>
> Ask me any questions as needed. once all requirements are clear, build a mockup for how this might look within the overall framework of the beanies UI and planning page.

Built initial 8-screen HTML mockup at `docs/mockups/family-vacation-planner.html`.

## Prompt 2 — Add Vacation View Modal

**Time:** 2026-03-20

> Can you also add a view modal to the mockup - this view modal will give you all the key details of your vacation at a glance, including flights, confirmation numbers, etc with a simple easy way to copy key details with a tap (i.e. a confirmation number) to make it users to see all the details at a glance. use space efficiently without making the view look too crowded or intimidating - it should look fun and engaging.

Added screen 8 (vacation view modal) with teal hero header, collapsible sections, tap-to-copy confirmation codes, progress bar, and bucket list summary. Bumped planner view to screen 9.

## Prompt 3 — Replicate Real Activity Modal on Slide 1

**Time:** 2026-03-20

> Can you update the activity modal on slide 1 to reflect the actual activity modal in use on the site today - so we can see exactly how the vacation toggle fits it.

Rebuilt screen 1 to faithfully replicate the real ActivityModal.vue with all sections: who's going, grouped category picker, big title input, cost/fee schedule, calculated monthly, schedule toggle, day-of-week selector, all-day toggle, dates/times, location, drop-off/pick-up, and collapsible more details (instructor, notes, reminder, active toggle).

## Prompt 4 — Move Schedule Toggle Up + Different Element

**Time:** 2026-03-20

> Make one update to the activity modal on slide 1 - the switch to change the activity from one-time to recurring is key as it determines the fields visible on the modal, but it's a bit hidden towards the middle of the form. let's bring that toggle up to the top and make it prominent (perhaps just below the vacation toggle). also can you suggest a different element than a switch toggle, as it should have some visual differentiation from the family vacation switch toggle

Moved recurring/one-off toggle to top of form (below vacation banner). Changed from toggle switch to a segmented tab bar with card-style buttons (🔁 recurring / 📌 one-time) — visually distinct from the vacation toggle.

## Prompt 5 — Comprehensive Mockup Updates (9 items)

**Time:** 2026-03-20

> Make the below updates to the mockup:
>
> - for all text follow the beanies theme - lettering should be lowercase (except for "I")
> - On slide 2 - remove the "destination" field
> - On slide 3 - information captured should depend on vacation type, items sorted by start date, collapsible with key details shown when collapsed, editable titles
> - slide 4 - provide selection options at top before detail forms displayed
> - slide 5 - provide selection options at top before detail forms displayed
> - slide 6 - simplify category filter pills (too much space)
> - slide 7 - make celebration more fun, add beanie image, less crowded
> - slide 8 - all fields collapsible with key details shown when collapsed
> - slide 9 - show within actual website planner page framework, propose space-efficient redesign for filter pills

Full rewrite of mockup with all 9 changes: lowercase text, removed destination, collapsible date-sorted segments, add-on pill selectors for slides 4+5, inline category tags instead of filter bar, fun celebration modal, collapsible view sections, and planner page matching real layout with compact member filter dropdown.

## Prompt 6 — Idea View/Edit Modal + Chronological View + Calendar Bar Position

**Time:** 2026-03-20

> on slide 5 - please also create a mockup of the view/edit modal for each idea. the quick add row only creates the top level idea title, but the view/edit modal will be where you can add more details about the idea, category, pricing info, etc
>
> on slide 8 - vacation view - the plans should always be sorted by date rather than sorted by flights/cruise/stay/etc
>
> slide 9 - show the gradient multi-day vacation item (caribbean cruise) directly over the days (i.e. ms outlook convention).

Added idea view/edit modal on slide 6 (side-by-side with list). Restructured slide 8 to chronological timeline sorted by date with date headers. Added inline vacation bars on slide 9 calendar.

## Prompt 7 — Inline Editing + Edit Wizard Links + Calendar Bar Below Days

**Time:** 2026-03-20

> on slide 8 - add the ability to make a quick inline edit to any field, this is in addition to the edit button at the bottom which re-opens the wizard. also add an edit element to each dropdown (only shown when details expanded), which would open the edit wizard to the specific page as needed. same thing for the idea list - ability to edit inline and also open the edit wizard directly to the ideas page
>
> slide 9 - the vacation plan row should show just below the calendar numbers where it will occur (not above) - otherwise it could be confusing which row the vacation applies to

Added inline-editable fields (dashed teal underlines) to slide 8 view modal, plus "edit in wizard → [section]" buttons per expanded card and ideas list. Updated slide 9 calendar: vacation days have teal tint with rounded top corners, gradient bar sits flush below with rounded bottom corners and negative margin connection.

## Outcome

Complete 9-screen HTML mockup at `docs/mockups/family-vacation-planner.html` covering:

1. Activity modal with vacation toggle + schedule tab bar
2. Vacation type selection (wizard step 1)
3. Travel details — collapsible, date-sorted, type-dependent (wizard step 2)
4. Accommodation — add-on pill selector (wizard step 3)
5. Getting around — add-on pill selector (wizard step 4)
6. Ideas & bucket list with view/edit modal (wizard step 5)
7. Celebration confirmation
8. Vacation view modal — chronological timeline, inline editing, section edit links
9. Planner page with inline calendar vacation bars and sidebar cards
