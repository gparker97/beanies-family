---
date: 2026-09-25
category: mockup
issue: Notion #109
plan: none (mockup only, not building yet)
tags: [family-responsibilities, fair-play, mockup, marketing, treehouse]
---

# Family responsibilities deck: marketing mockup (Notion #109)

## Prompts

**2026-09-25 15:45** — `/beanies-pre-plan` "please create a mockup for notion issue #109 - we are not building yet but i need a mockup for marketing purposes - it should look impressive, welcoming, engaging, fun, a bit silly, as per the issue plan captured in noton, pls go ahead to create the mockup as a claude artifact and ask any questions as required. we will not be building now"

## Outcome

Mockup saved to `docs/mockups/family-responsibilities-deck-2026-09-25.html` and published as a Claude artifact (https://claude.ai/artifact/XQ17mH4USvn4fALb4Jnz2T). Pre-plan stopped after the mockup step by request: no `beanies-plan prompt` write-back, Status left at Not started. Awaiting greg's approval before commit and the `mockup file url` write-back.

**2026-09-25 (later)** — "Thanks, the mockup looks good and on the right track - have the below comments: ensure the app shell (sidebar, header, etc) accurately reflects the actual app; fix the sidebar word wrap for 'who owns what'; invoke /frontend-design:frontend-design for a proper UI/UX review; show what it would look like to edit an existing card or assign a card to another person; as an alternative, what if we took the meal planner approach (a rail of cards dragged into a family member's row)? conceptually what do you think; review overall design and layout to ensure they reflect the actual design and proportions of the app."

Outcome (v2): shell rebuilt from the live app (E2E-driven screenshots + AppSidebar/AppHeader/MobileBottomNav/BeanieFormModal source); frontend-design review run and its top findings applied (portrait 5:7 cards, holder promoted, ghosted unheld cards, stacked split rows, deal check copy softened); added edit-sheet (desktop light), re-deal sheet (phone dark), and a meal-planner-rail alternative section. Nav label "Who Owns What" fits on one line.

**2026-09-25 (later)** — "can you please udpate the mockup to use lowercase as per the beanie mode theme"

Outcome (v3): every in-frame UI string lowercased (nav, header title, buttons, pills, card names, sheet labels, tabs, briefing copy). Member names, dates, currency codes and brand nouns keep their case; CSS `uppercase` section labels are unchanged as in the app.
