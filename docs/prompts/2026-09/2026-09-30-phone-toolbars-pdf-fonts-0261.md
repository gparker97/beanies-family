---
date: 2026-09-30
category: feature
issue: ''
plan: docs/plans/2026-09-30-phone-toolbars-and-deal-hero.md
tags: [phone, toolbar, who-owns-what, swipe, pdf-export, fonts, e2e, deploy, 0.26.1]
---

# Phone toolbars, Who Owns What deal card as hero, production PDF fonts, E2E repair, 0.26.1

## Prompts

- **2026-09-30** Phone toolbars and deal page: hide Export as PDF on mobile, make Share an icon, review every view, bigger cards, fold the progress counters, drop the tagline row, invoke /frontend-design, add swipe gestures.
- **2026-09-30** "looks very good, yes go ahead with /beanies-build-auto"
- **2026-09-30** "I forgot to ask one question - when clicking share or export to pdf, should there be a confirmation model before the actual pdf is generated? ..."
- **2026-09-30** "Also looking at the view now, i noticed that in some cases the left or right arrows are overlapping the text on the card"
- **2026-09-30** "Once the review is done, please check the PDF export again - the fonts and layout in the header are still wrong in production. please check /tmp/who-owns-what-pdf.pdf and /tmp/beanies-meal-plan-pdf.pdf ... Please use tests to pin this issue, if possible, in a prod environment, as it works fine in localhost / dev. Once this fix is done and applied run /deploy-prod-auto as a minor revision, both apps to android and ios autorelease, release note just minor bug fixes and improvements, no spotlight. once the deploy is done run /end-session"
- **2026-09-30** "supersede the existing releases if needed"
- **2026-09-30** "Also note that e2e ends tests appear to be failing, before starting the deploy pls be sur eto fix the e2e tests with /fix-e2e-tests"

## Outcome

- Phone toolbars + deal card as hero built and reviewed twice (`9b4967b5`); arrows no longer overlap the card text (container-sized art, arrows raised to the art band).
- Production PDF fonts fixed (`d4583f51`): the cross-origin Google Fonts sheet made html-to-image's font embed return nothing; fonts are now parsed and inlined as data: URLs, pinned by a production-build Playwright check (`playwright.prodcheck.config.ts`).
- E2E repaired (`cbfc09f7`): planner CRUD follows #113's calendar reveal; create-pod helper readiness gates root-caused with in-page probes. One webkit residual logged in `docs/E2E_HEALTH.md`. CI E2E green on chromium + webkit.
- 0.26.1 shipped (`fcf51e80`): web, Astro, Android production, iOS appstore-automatic (replaced the waiting 0.26 submission). Note "Minor bug fixes and improvements.", no spotlight.
- Open: the Share/Export confirmation question (recommended no).
