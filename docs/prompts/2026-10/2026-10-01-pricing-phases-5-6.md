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
- **later, session 2**: "Do you recommend to run a third review? ... Currently I see that 'checkout isn't set up on this build of beanies.family' - should this instead be sending me to the sandbox? If we are on the dev build ... how do we differentiate between me ... and a self-hoster"
- "yes go ahead and make the change / also please update this copy: 'your plan' -> 'your beanies plan' / 'all set...' -> 'you're all set - your plan details are below. thanks so much for being a beanie supporter! you will be rewarded in this life and the next.'"
- "Should we run one final code review ...? Or are we ready for prod deployment (with the flag enabled so existing users will see that they are still on free beta?)"
- "I just tried cancelling my subscription - after returning to the page ... no change ... still shows 'beanies + magic beans' and renewal date ... handle both active and cancelled subscriptions, and any other possible plan states?"
- "I've refreshed my dev client, but i still see the message 'renews 1 oct 2027' ... is this screen stateful?" / "even after refreshing, it still says 'renews 1 oct 2027'"
- "I think my client may be in a strange state ... couldn't open the plan portal ... this type of action is something we should never be asking a user to take ... 1) way to reach plans page from settings? 2) navigate back? 3) profile dropdown? 4) magic beans quota progress bar? 5) 'your beanies plan' above quick settings?"
- "Once done let's run one more code review to ensure everything works as intended and designed and is built appropriately for users (including error messages, alerting/logging, statefulness, refreshes to stripe, etc)"
- "Looking much better ... still shows that i only have 1 magic bean ... still can't open the restart plan or receipts ... there is nowhere to paste a token on the plan page, and in addition i don't think we should have that capability at all as it would be a strange security backdoor ... let me know what steps are remaining to test or capture keys for us to push to live."
- "Commit and push changes"
- **session 3**: "Looks like e2e tests are failing can you check? Once resolved let me know how to get the stripe live secret and anything else you need to deploy. Once you have the right credentials you can create the product catalog in line as appropriate as you did on the sandbox"
- "Also one other issue you raised ... 'the settings merge still wrote the whole map, so two devices could still clash at CRDT merge' - should we check if this same issue exists on any other surfaces? ... is it worth doing a full sweep and check?" / "To check once the current tasks are done"
- "for the stripe key can you add a placeholder field again? or should i replace the sandbox key in the beanies-tf file? Just thinking that we should keep both in case you need to make changes in sandbox for testing vs changes in live"
- "it looks like there is no secret key yet on the stripe live dashboard - should i create one? - if so which options should i use?" / "it is asking to assign permissions to a key ... which would you suggest" / "ok i've copied the secret key and publishable key, where do i get the webhook?"
- "i don't see any option for branding under stripe settings" / "can you provide the hex colors for brand color and accent color?" / "i thought that heritage orange was supposed to be the accent color?" / "actually i've checked the preview and the accent color is used for the pay button, and the brand color used as the background at the top of the invoice. what do you suggest we use?"
- "ok branding done - let's not change to live yet but do you need to make any changes now as per the steps you mentioned above to prepare for live? (i.e. gh secret, terraform, etc?"
- "Ok - before we move to live, let's address the CRDT merge issue previously where you proposed to create a plan and fix. should we raise that with /beanies-new-issue now and move to pre-plan / plan so this fix can be deployed alongside the pricing changes?"
- "yes, create it and run pre-plan" / "what is the migrateDoc fix? does it mean the beanpod file for all users needs to be migrated or updated to a new version?" / scope: one plan, two phases
- "would you propose to move forward in this session - is this context important? or should we clear context and start in a new session to save tokens?" / "ok /end-session"

## Decisions (greg)

- One `TF_VAR_stripe_secret_key` for both modes; the value swaps at launch, never the name.
- No second key set in prod or GitHub for sandbox testing after launch: a local harness (`infrastructure/lambda/billing/local.mjs` + `stripe listen`) is the sandbox path, folded into Phase 5.
- Sandbox objects may be created through the Stripe MCP (test mode).
- No token paste field and no reissue path in the product ("a strange security backdoor"); both removed.
- Keep BOTH key pairs in `~/.beanies-tf.env` (`BEANIES_STRIPE_SANDBOX_*` / `BEANIES_STRIPE_LIVE_*`) with one `BEANIES_STRIPE_MODE` switch; prod and GitHub still hold exactly one pair.
- Live secret is a restricted key ("full access except sensitive operations"). Stripe branding: accent (Pay button) Heritage Orange `#F15D22`, brand (invoice header) Deep Slate `#2C3E50`.
- Do NOT flip to live yet. Pricing deploys only after the CRDT merge fix (#117 Phase 1) is planned and built.
- #117 scope: one plan, two phases; Phase 1 (code-only) ships with pricing, Phase 2 (Counter migration) after.

## Outcome

See the plan's Outcome section (2026-10-01 entry) and `docs/STATUS.md`. Phases 5-6 built, browser-verified, and verified end to end against the live Lambda + the Stripe sandbox; Lambda deployed; bundle not deployed; flag off.

Session 3 (2026-10-01, later): E2E fixed (`05d2f798`, fresh-family defaults seeding; `docs/E2E_HEALTH.md`). Env mode switch + harness (`63784050`). Live catalogue created in the live Stripe account and recorded (`a3cc457d`): 2 products, 12 prices, coupon `PRE_V1_50`, portal config, webhook endpoint; `whsec_` written to the env file. GitHub secret `STRIPE_PUBLISHABLE_KEY` set to the SANDBOX pk. Terraform plan in sandbox mode: no changes. Live flip NOT done. CRDT merge class sweep raised as Notion #117 and pre-planned (In Progress, prompt on the row); plan to be written in a fresh session.
