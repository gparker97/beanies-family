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

## Outcome

Image prompts written (one shared style block + ten scene lines, reference images from
`packages/brand/assets/`); greg generated the set, image 10 was regenerated twice (a pink glow, then
a grey beanie on the terracotta grown-up). The ten were cut out and exported as 512x512 WebP. Then
built per the plan: `ImageGlyph` (from `NavGlyph`) + `CardArt`, art on every card surface, greyed
on skipped/unowned tiles, precached. Validate green, browser walk green, two `/code-review high`
rounds. See the plan's Outcome section.
