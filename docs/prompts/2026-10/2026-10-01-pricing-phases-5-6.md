---
date: 2026-10-01
category: feature
issue: Notion #95 (no GitHub issue)
plan: docs/plans/2026-09-30-pricing-entitlement-read-only.md
tags: [pricing, stripe, billing, lambda, terraform, help-center, adr, runbook]
---

# #95 pricing: Phases 5-6 (Stripe checkout, claim, portal, webhook; docs)

## Prompts

- **~06:50** (after `/good-morning`): "please add the relevant lines with placeholders to the beanies-tf file for the stripe publication key and secret key and i'll add it now"
- **~06:55**: "i'm trying to run vim now and is says vim: warning: out is not to a terminal and open over all the otehr text on the screen - what happened? this has never happened before"
- **~06:58**: "i've only populated the TF_VAR_stripe_secret_key var with the SANDBOX secret key. SHould we rename this var to indicate it is sandbox tho? will we add a new var later for the actual production secret key? also do you need the stripe publishable key?"
- **~07:00**: "ok i've added both keys, but if we just swap them out later, how would you do testing in the sandbox environment if needed? or would we add both sandbox and live keys to github as secrets instead so facilitate testing?"
- **~07:02**: "fold the local harness into phase 5, and pls confirm the key is ok, if all is good then let's start /beanies-build-auto"

## Decisions (greg)

- One `TF_VAR_stripe_secret_key` for both modes; the value swaps at launch, never the name.
- No second key set in prod or GitHub for sandbox testing after launch: a local harness (`infrastructure/lambda/billing/local.mjs` + `stripe listen`) is the sandbox path, folded into Phase 5.
- Sandbox objects may be created through the Stripe MCP (test mode).

## Outcome

See the plan's Outcome section (2026-10-01 entry) and `docs/STATUS.md`. Phases 5-6 built, browser-verified, and verified end to end against the live Lambda + the Stripe sandbox; Lambda deployed; bundle not deployed; flag off.
