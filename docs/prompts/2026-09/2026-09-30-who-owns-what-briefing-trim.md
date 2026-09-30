---
date: 2026-09-30
category: feature
issue: '#109 (follow-up)'
plan: docs/plans/2026-09-30-who-owns-what-briefing-trim.md
tags: [who-owns-what, nook, briefing, nav-badge, mobile-nav]
---

# Who Owns What briefing trim + "still to deal" nav badge

## Prompts

- **2026-09-30** "quick question - i can see in the daily briefing now there is a briefing for "your cards in who owns what" which seems to appear after cards have been assigned - what is the purpose of this briefing - is there any action to take or is it just informational? at what point would it disappear or is it dismissable?"
- **2026-09-30** "Let's go with option (3) - i think this is not needed. The card moved message is enough, and i would also suggest that the card moved message is dismissable anytime, and automatically clears after 7 days. I would also remove the 'cards with nobody' from daily briefing. In it's place i would suggest to have an orange badge in the sidebar with the number of kept, un-owned cards, which more closely follows the site convention of an acton required in a certain area (i.e. an over budget item, a travel plan with unbooked segments, etc)"
- **2026-09-30** "go ahead, adults only, with /beanies-build-auto"
- **2026-09-30** "once done update status and perform final commit and push so we can end session, next session will start with #95 to plan and reason about pricing"

## Outcome

- "Your cards" and "Cards with nobody" briefing rows removed; moved notes show for 7 calendar days, dismissable any time.
- Orange `stillToDeal` count on Who Owns What in the nav for anyone who can deal (adults): sidebar, mobile drawer, bean stack, and the Planning-tab dot.
- Found and fixed: the phone tab attention dot had always rendered at 0x0 (inline span), for every badge.
