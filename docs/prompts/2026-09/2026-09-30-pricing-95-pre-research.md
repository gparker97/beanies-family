---
date: 2026-09-30
category: exploration
issue: 'Notion #95'
plan: ''
tags: [pricing, stripe, iap, entitlement, read-only, magic-beans, metrics]
---

# Pricing (#95) pre-research, plus the metrics skill fixes

## Prompt 1 — 2026-09-30 ~09:00 UTC

> /good-morning and gather metrics

## Prompt 2 — 2026-09-30 ~09:10 UTC

> fix both in the metrics skill and what is the email for the family quest family

(The two dashboard defects: the hard-coded "no power user has churned" callout, and
power-user rows rendering "-1d ago".)

## Prompt 3 — 2026-09-30 ~09:20 UTC

> commit skill fixes

## Prompt 4 — 2026-09-30 ~09:30 UTC

> let's look at issue #95 - as there are several key decisions we need to make, I've enabled
> the fable model to think deeply on perform research.
>
> 1. What is the right pricing platform to use? We are a singapore based company, but will be
>    charging in multiple currencies, probably starting with USD and SGD, with others being
>    converted at going exchange rates. I've used stripe several times before, so I'm comfortable
>    with that platform. Are there other platforms that are extremely compelling in their offering
>    that would be preferred to use rather than stripe?
>
> 2. I assume we will require to carefully examine and perform surgical implementation and
>    instrumentation across several areas in the app to implement reliable and robust pricing
>    without breaking existing functionality or allowing for loopholes or security gaps. Please
>    perform pre-research (of course additional research will be done in the pre-planning and
>    planning stages) to understand the full scope and breadth of this work so we can understand
>    how difficult this would be to implement and if anyting is needed on my side in advance
>
> 3. What other considerations should we keep in mind about this approach?

## Prompt 5 — 2026-09-30 ~10:20 UTC

> I'd like to keep pricing simple, and avoid in-app pricing as much as possible. I am OK to not
> advertise or link to pricing or choose plan pages anywhere in the app, just having a message
> that if you want to choose a plan, open the app at app.beanies.family (unlinked). I think many
> apps do this. There is no way to reach the pricing page or to buy a plan from the app, only
> from the desktop site. I would very much like to avoid going through stripe, apple, and google
> and have 3 separate payment providers, especially for a small local-first app. Users i believe
> should have the right to choose, and in several apps i've already seen this model (go to our
> website to upgrade - with no link). How can we make this work for beanies so we have a single
> payment gateway for all users?

## Outcome

Direction set: Stripe as the single rail, opened from the signed-in web app; no IAP, no
RevenueCat, no in-app CTA or link; native read-only state is a neutral statement (Apple
3.1.3(f) / Google "no encouraging language"). Entitlement written to the registry by a Stripe
webhook Lambda, read by every client via the existing `checkCanonicalPod` GET. Recorded in
memory (`project_pricing_single_gateway.md`). Next step: `/beanies-pre-plan #95` from this model.

## Prompt 6 — 2026-09-30 ~10:45 UTC

> Ok this direction sounds good. Just want to do one more confirmation that Stripe is the right
> way to go here - or is there any reason or proposal to go any other direction (for example,
> hitpay, some local singapore provider, a lower cost payment gateway, a gateway that's easier
> to integrate, etc)? [...] the only real issue is that the disputes are almost always settled
> in favor of the customer, but i don't expect that to be a huge issue with this app.
>
> Also, how does the plan handle actually building a subscribe page? Do we plan to build a
> custom page to choose your plan and take your credit card info, etc, or will we just redirect
> customers to stripe and use their page for the one-time subscribe? [...] Buying a subscription
> is a critical, delicate step and any friction can be a killer [...] What is the plan now and
> what is your recommendation on this point?

Outcome of prompt 6: Stripe confirmed against nine alternatives (Airwallex the only credible
runner-up; HitPay cheaper on SG cards only, no coupons/proration/portal). Checkout surface:
beanies-branded plan page in the signed-in web app + Stripe Embedded Checkout for the card step

- hosted Customer Portal for cancel/manage. Stripe never handles the trial (server clock; subscribe
  during trial bills immediately). Recorded in memory `project_pricing_single_gateway.md`.

## Prompt 7 — 2026-09-30 ~11:30 UTC

> Ok agreed. Make all changes as needed to the issue tracker in notion and run /beanies-pre-plan #95

## Prompt 8 — 2026-09-30 ~11:50 UTC

> As an aside i'm setting up the stripe account now and it is asking about managed payments,
> which should i choose? [Stripe's "Let us handle it" (Managed Payments, +3.5%) vs "Pick what
> you need"]

## Prompt 9 — 2026-09-30 ~12:20 UTC

> ok the mockup looks ok for now. we can focus on functionality for now and tweak the design
> later. note that all pricing functionality in the UI should be behind a feature gate (or
> operate as dry-run - i.e. capture metrics/data for soak-in testing in prod but not take any
> action) until we release v1. [Native read-only copy replaced with greg's two-paragraph
> wording.] In addition, i'm setting up stripe now, and stripe has helpfully provided the
> below prompt to set up the mcp and plugins - should we also set this up now or make it part
> of the plan? [Stripe's plugin + MCP + stripe_implementation_planner prompt]

## Prompts 10-12 — 2026-09-30 ~12:40-13:30 UTC

> [Stripe plugin install failed twice from claude-plugins-official ("index.lock: File exists"
> on the git-subdir checkout; the pinned stripe/ai commit exists, so the fault is the
> installer's subdir path). Worked around by adding stripe/ai as its own marketplace:
> `claude plugin marketplace add stripe/ai` + `claude plugin install stripe@stripe` (0.11.4).
> Reloaded, authenticated the bundled mcp.stripe.com server.]
> ok have authenticated now

Outcome: ran `stripe_implementation_planner` on the NJL Solutions sandbox; accepted shape is
embedded checkout on web, flat rate, pay up front, Customer Portal, Smart Retries, Stripe Tax
threshold monitoring (free, no collection). Doc links + guide id recorded on Notion #95
References. Nothing in it contradicts the pre-plan; it added the threshold-monitoring tip.

## Prompts 13-14 — 2026-09-30 ~14:00-16:30 UTC

> ok go ahead and run /beanies-plan - do not implement yet
> [Post-pass clarifications: keep the UTC AI day with local reset display; accept the 1/day server
> floor for read-only families, with the UI refusing to send; recurring pauses and catches up.]

## Outcome

`/beanies-plan` ran the four passes (Pass 1 draft; Pass 2 DRY + errors; Pass 3 sustainability;
Pass 4 fresh eyes) with three Explore agents up front and a fresh Plan subagent per pass. Plan
approved and saved to `docs/plans/2026-09-30-pricing-entitlement-read-only.md`; URL written back
to Notion #95. Not implemented.
