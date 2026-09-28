---
date: 2026-09-28
category: feature
issue: '#109 (Notion)'
plan: 'docs/plans/2026-09-28-who-owns-what-card-art.md'
tags: [who-owns-what, responsibilities, card-art, brand, image-generation, pwa-precache]
---

# Who Owns What card art

## Prompts

- **2026-09-28** "let's start on the card art - pls provide the prompts for the card art and the relevant reference images (you can ref from the brand / assets dirs) and i'll attach those to the AI generated along with the prompts"
- **2026-09-28** "done, all images are now in google drive at "Projects\beanies.family\Media\Family Responsibility Cards", let me now your thoughts, do these work?"
- **2026-09-28** "Ok i've regenerated image 10, please check again. for the other issues (school drop off, date, nigh, cooking, groceries) those are find to keep as is"
- **2026-09-28** "ok i've regenerated once more, pls check"
- **2026-09-28** "yes go ahead with /beanies-build-auto"
- **2026-09-28** "Approve and build with /beanies-build-auto"

- **2026-09-28** "Commit and push changes"
- **2026-09-28** "THis looks great and almost ready. Just a couple more UI suggestions / fixes before we do final test and deploy: 1) On the board view for card dealing ... family member lanes are scrunched into the top half of the view ... we don't need to show a full lane for family members who don't hold any cards ... 2) on the 'card view' sidrbar drawer ... show the actual card ... Perhaps we can even have the ability to swipe or navigate from card to card ... what do you think?"
- **2026-09-28** "yes pls do the mockup"
- **2026-09-28** "mockup looks good - regarding the questions: 1) i prefer the idle strip at the bottom ... 2) keep as done line ... 3) i think folded by default is ok 4) every drawer has a header icon ... can we find something more vibrant here to represent the family sharing and breakdown of responsibilities 5) agree to leave out. go ahead with /beanies-build-auto"
- **2026-09-28** "Looking at the view now, i can see 2 isseus: 1) The details of the card splt are not shown underneath ... 2) Let's show the full audit history below every card (rather than inside the card) ... Keep the card pure with just the image, category, done text and ownerq 3) it seems that the skipped cards row is not expandable ... is the expandion arrow hidden behind the FAB? 4) the category name above the card is getting clipped by the top of the card 5) can we show the "not holding any cards yet" row closer to the other rows? ..."
- **2026-09-28** "one more thing - can we also have the "share the deck" / "export as pdf" buttons available on all views? ... on the "deal" view, the "board view" / "card by card" view switch could be made to be more prominent ..."

- **2026-09-28** "THis looks much better and just have the belwo comments: 1) there seems to be a minor UI bug where the cards overlap the container in some situations ... 2) the 'card by card / board view' switch ... i was thinking to have a custom small icon / graphic ..."
- **2026-09-28** "for (2) yes go ahead to create the mockup ... i also hit this erroe when hitting hte "export as pdf" button: that file didn't save ..."
- **2026-09-28** "also agree to quiet the memberChip watning if it's not useful"
- **2026-09-28** "go with option B but we don't need to put "switch view" ..."
- **2026-09-28** "Also i've tried tapping the export as PDF button ... did you change the functionality of the button to share?"
- **2026-09-28** "ok looking much better - on minor UI issue - it seems the outline of the card by card / board view switch has gaps ..."
- **2026-09-28** "Just a functional question regarding the check-in - ... "settling in" or "let's talk" ... what does that actually mean? ..."
- **2026-09-28** "Ok understand - to keep things simple let's do the following: ... no issues ... we've talked ... save for next time ... also a small thing - on the overview page, the tile in the bottom right ... has no title"
- **2026-09-28** "yes to all 3, commit and push first then build it with /beanies-build-auto"

Third piece of work: plan `docs/plans/2026-09-28-check-in-outcomes-and-still-to-deal.md`.

Second piece of work: plan `docs/plans/2026-09-28-deal-board-and-card-in-hand.md`, mockup
`docs/mockups/who-owns-what-board-and-card-drawer-2026-09-28.html`.

## Outcome

Image prompts written (one shared style block + ten scene lines, reference images from
`packages/brand/assets/`); greg generated the set, image 10 was regenerated twice (a pink glow, then
a grey beanie on the terracotta grown-up). The ten were cut out and exported as 512x512 WebP. Then
built per the plan: `ImageGlyph` (from `NavGlyph`) + `CardArt`, art on every card surface, greyed
on skipped/unowned tiles, precached. Validate green, browser walk green, two `/code-review high`
rounds. See the plan's Outcome section.
