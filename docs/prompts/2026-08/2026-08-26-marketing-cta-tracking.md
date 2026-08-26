---
date: 2026-08-26
category: bug
issue: 'none (raised directly in session)'
plan: 'none — diagnosis-led, no plan mode'
tags: [analytics, plausible, marketing-site, astro, ci-guard, observability]
---

# Marketing-site CTA goals recorded nothing (#none)

## Prompts

**Initial report** — _"previously we were discussing custom events on plausible and we added custom goals/events for all the CTA clicks on the marketing page... i'm still not seeing those goals listed. however, i do see 'outbound link: click' fired 3 times, and the URLs reached were app.beanies.family/welcome (twice) and /login (once) - at least for the /welcome address, that should definitely have been a CTA click - so why are we not seeing the CTA click goal fire?"_

**Pushback on my first answer (this is the important one)** — _"hold on - just to confirm, these are the custom events that i just created this morning based on the recommendation from claude (in another session) and claude also said everything was already implemented in code for these to work so i'm surprised to hear that nothing is there. can you just check once more"_

**Fix** — _"yes please go ahead and fix the missing tags to the ctas, and also the slack webhook should be populated from a github variable, not directly in the JS. can you please check the existing gh vars and confirm if it already exists (i think it should) and substitute this string with the var?"_

**Deploy scope** — _"can we commit and deploy only to web, do not deploy the vue or apps yet"_

**Follow-ups** — _"yes do 1 and 2 together"_ (footer `/login` fix + build-time guard). Declined the webhook-proxy issue for now.

## Outcome

Two commits, both deployed to web only: `a6a4c466` (run `32948320535`) and `4b4383cc` (run `32952226956`).

**The tracking code was never broken.** The earlier session's `ce388a3a` delegated `[data-cta]` capture-phase listener in `BaseLayout.astro` was live and correct. The attribute was just on 4 of 14 app links — the nav CTA (`Nav.astro`, therefore all 110 pages), the homepage's closing CTA and four inline story links were untagged. Tagged 7 more call sites → 220 tracked links.

**The footer's "sign in" pointed at `/welcome`, not `/login`**, on every page. Returning users were being sent to create a second pod. Fixed the href rather than tagging it as a CTA — tagging would have preserved the bug behind a healthy-looking conversion number.

**Guard shipped:** `web/src/lib/assert-cta-tagged.mjs` fails the build on any untagged app link, checked against built HTML (a CTA can arrive from `.astro`, MDX or a content collection; only the output sees all three). Verified both directions.

**`CONTACT_WEBHOOK_URL` secret → repository variable.** It was never hardcoded, contrary to my initial claim; already `import.meta.env`. A secret bought nothing since the value is inlined into a client bundle — I recovered it _from the live bundle_ to create the variable. Still public and spammable; the real fix (an `api.beanies.family` proxy) is unfiled at greg's request.

### Three things worth remembering

1. **I answered confidently from a checkout 53 commits behind `origin/main` and told greg the feature did not exist.** The searches were sound; the tree was stale. greg's "check once more" is the only reason it got caught. **`git fetch` before concluding that code is absent** — "I searched and found nothing" is worthless without knowing what was searched. Saved as a lesson.
2. **Autocapture masks missing custom events.** Plausible's outbound-link tracking logged the same clicks, so the property looked alive while the goals sat at zero — nothing distinguished "nobody clicked" from "we forgot an attribute". Absence of a custom event is not evidence of absence of clicks; correlate against autocapture and deploy time before believing either.
3. **Timing is a real hypothesis and must be excluded, not assumed.** The hourly breakdown did the work: CWV events stopping dead at the deploy hour proved the new bundle was live and executing, which is what turned "maybe it hasn't shipped" into "it shipped and the coverage is wrong".
