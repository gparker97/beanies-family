---
date: 2026-09-10
category: feature, design, marketing-site
issue: none
plan: docs/plans/2026-09-10-pricing-page.md
tags: [pricing, astro, marketing-site, copy, gate, branch]
---

# The pricing page, and every "free for now" that now points at it

Branch `pricing-page`, deliberately off `main`. Mockup
`docs/mockups/2026-09-10-pricing-page.html` (artifact v4
https://claude.ai/code/artifact/1cc2a871-831e-4dee-a973-f83acde9e2e2).
Times are not recorded for this file; all prompts are from the afternoon and
evening of 2026-09-10 SGT, in order.

## Prompt 1

> ok now i wanted to work on building a pricing page for our marketing website,
> something that has been a long time coming for the marketing site i think, and
> a big visible gap that we've never had one. along with this work, we should be
> careful to identify everywhere i've ever said that beanies is free "for now" or
> "probably not forever" and to update those side notes with a link to this page.
> the goal of the pricing page will be to clearly set out my philosophy on
> pricing, the fact that we will remain free while in beta and why, and clearly
> lay out our plan for rolling out pricing, or at least a template for that plan,
> as it's not fully clear yet in my mind as well. [...] I've prepared a pricing
> statement on notion on the beanstalk blog page - see item #61. [...] for the
> pricing table, for now let's keep it very simple - have a free tier, monthly
> and yearly options, with pricing listed as TBC for now [...] prepare one (or
> more) proposals and mockups so we can review different directions.

## Prompt 2

> Yes, the $1 forever deal applies to the first 10 early adopters who give a
> review and let me know. the rest of the early adopters get a permanent 50%
> discount which is anybody who joins before v1.0 is relased. beta ends at v1.0

## Prompt 3

> Direction B is great and definitely the one i'd go with, but let's add the faq
> section from A to direction b as well - also pls make these copy updates:
> [twelve verbatim edits, all applied: "you are not the product"; "there are no
> advertisers to answer to because there are no ads, period. annoying popups be
> gone!"; "$0 today. a fair number later."; "here's where you can find our
> prices. cuz somebody's gotta pay for this."; "a note from me (greg)"; "it's
> free, _for now_. get in while the gettin's good"; and six smaller ones]
> in addition [...] my current thinking is to move from free tier to paid based
> on number of events [...] only thing restricted form the free tier is the use
> of AI [...] beanies should be in the premium range - 15-20% above market
> average

## Prompt 4

> just to confirm are the above prices in USD?

## Prompt 5

> i feel that the messaging that "something's gotta give" [...] does not gel with
> [...] free tier forever [...] what if we change the message hre - rather than
> always having a free tier, we have a very generous (market leading) free trial
> period [...] what do you think?

## Prompt 6

> I've switched to the fable model- hello fable. I wanted to get a second opinion
> on the above and your thoughts on the way forward

## Prompt 7

> ok agree with this approach. go ahead to re-write the mockup based on the above
> free tier then no-AI approach and update the pricing as you proposed as well,
> but for th epricing please include a switcher for both USD and SGD, with SGD at
> $13/mo or $110/year, leaving options for other currencies in the future [...]
> the angle is that you get an industry leading free tier and lots of time to try
> everything [...] subscribers pay for beanies, so with no subscribers, not only
> is there no free tier, there's no beanies at all. also please do another pass
> of all the copy [...] in my voice, feel free to propose changes or additions

## Prompt 8

> the $1 deal is USD or SGD. go ahead and build the page

## Prompt 9 (mid-build)

> sorry i didn't mean to actually build the page, i meant to update the mockup.
> you can finish building, but please put the page behind a gate so that it does
> not get pushed to production in the next deploy

## Outcome

Built, on branch `pricing-page`, not on `main`. The model that emerged from the
debate: beta is everything free with no clock and ends at v1.0; from v1.0 a new
family gets 90 days of everything including the AI helper, then chooses the
free tier (the whole app minus managed AI; bring-your-own-key still works) or a
subscription. Subscribers fund the free tier. Prices USD $9.99/mo, $84.99/yr;
SGD S$13/mo, S$110/yr, with a currency switcher built to take more. First ten
families who rate, review and tell greg: $1/mo forever in either currency;
everyone else who joins before v1.0: half price forever.

Two gates, on purpose. `PRICING_LIVE = false` in `web/src/lib/pricing.ts` turns
`/pricing` into the draft placeholder (noindex, no FAQ schema) and removes the
nav, footer, badge and homepage links. The branch is the real gate: the prose
rewrites on `/from/*`, `/help/faq` and four blog posts link to `/pricing`
unconditionally, and on `main` they would send readers to a placeholder.

Rejected on the way: a paid tier gated on event count (not cost-grounded,
unenforceable under encryption, would misuse Diagnostics telemetry, no market
precedent) and a trial-only model with no free tier (inverts the Cozi paywall
attack the switching pages make).

Verified with the gate off: `astro check` + build 0 errors, 124 pages, CTA
guard 264 tagged / 0 untagged, `/pricing` renders the placeholder, homepage and
`/from` carry no pricing link. Verified with the gate on, before it was added:
FAQPage JSON-LD with 9 questions, the switcher persisting SGD across a reload,
the nav fitting seven links at 940px.

Not touched, flagged for greg: `web/src/pages/terms.astro` says "provided free
of charge" and needs a legal read before v1.0.
