# Runbook: pricing launch (#95)

> Owner: greg. Plan: `docs/plans/2026-09-30-pricing-entitlement-read-only.md`. ADR-038.
> Everything below is reversible in the same order backwards, one flip at a time.

## What is live today (sandbox, dry-run, flag off)

| Switch                 | Where                                                                                 | Value now                  |
| ---------------------- | ------------------------------------------------------------------------------------- | -------------------------- |
| Stripe keys            | `~/.beanies-tf.env` (`BEANIES_STRIPE_MODE=sandbox`) + GitHub `STRIPE_PUBLISHABLE_KEY` | sandbox pair               |
| `v1_launch_at`         | `infrastructure/terraform.auto.tfvars`                                                | `""` (every family `beta`) |
| `pricing` flag         | `src/config/featureFlags.committed.ts`                                                | `false`                    |
| `billing_enforce`      | `terraform.auto.tfvars`                                                               | `false` (dry-run)          |
| `ai_allowance_enforce` | `terraform.auto.tfvars`                                                               | `false` (dry-run)          |

**The flag can be ON in prod before launch.** Every family then sees the beta card ("everything is free for now") on web and native, and nothing else: on app.beanies.family the Plan page needs a LIVE publishable key (`features.checkout`), so no family is ever offered Stripe's test-mode checkout while prod holds the sandbox pair, and the read-only gate cannot act while `billing_enforce` is false. Until the flag is committed on, a family only sees any of this with the per-browser override `localStorage beanies:flag:pricing=true`; either way only on a cloud build: `features.pricing` (registry + `VITE_STRIPE_PUBLISHABLE_KEY`) is false on every self-host, so the plan card, the Plan page and the read-only gate are simply absent there.

**Testing from `npm run dev` works until step 1 below**: with the sandbox key in prod the Lambda allows localhost checkouts and looks localhost families up in the DEV registry table. After the live flip it refuses them (`dev_origin`), and the local harness is the sandbox path.

## Stripe objects (created once per mode, same names in sandbox and live)

Prices are found by `lookup_key = <cohort>.<plan>.<interval>.<currency>` where cohort is `list`, `pre_v1` (unused: pre_v1 is a coupon on the list Price) or `first_ten`. Amounts are `packages/brand/pricing.ts`.

| lookup_key                 | Product               | Amount         |
| -------------------------- | --------------------- | -------------- |
| `list.basic.year.usd`      | beanies basic         | $30 / year     |
| `list.basic.year.sgd`      | beanies basic         | S$39 / year    |
| `list.full.month.usd`      | beanies + magic beans | $9.99 / month  |
| `list.full.month.sgd`      | beanies + magic beans | S$13 / month   |
| `list.full.year.usd`       | beanies + magic beans | $84.99 / year  |
| `list.full.year.sgd`       | beanies + magic beans | S$110 / year   |
| `first_ten.basic.year.usd` | beanies basic         | $12 / year     |
| `first_ten.basic.year.sgd` | beanies basic         | S$16.20 / year |
| `first_ten.full.month.usd` | beanies + magic beans | $1 / month     |
| `first_ten.full.month.sgd` | beanies + magic beans | S$1.35 / month |
| `first_ten.full.year.usd`  | beanies + magic beans | $12 / year     |
| `first_ten.full.year.sgd`  | beanies + magic beans | S$16.20 / year |

Plus: coupon `PRE_V1_50` (50%, `duration=forever`); a Customer Portal configuration (cancel at period end, switch between the two products' Prices, update payment method, invoice history; **plan switches must be `subscription_update.proration_behavior = always_invoice`** (Dashboard: Customer portal → Subscriptions → "Prorate subscription updates" → invoice immediately). The default `create_prorations` parks the credit and the new charge on the NEXT invoice, which on a yearly plan is a year out, so the portal's confirmation reads as if the new plan starts then. Set 2026-10-01 on the sandbox config `bpc_1ULWbsLhz3C06djX9phOsEAW`; the live config must carry the same value before the flip); customer emails for successful and failed payments ON; the Dashboard "manage failed payments" setting → `unpaid` after Smart Retries; a webhook endpoint at `https://api.beanies.family/billing/webhook` subscribed to `customer.subscription.created|updated|deleted`, API version `2026-08-26.dahlia` (the value of `STRIPE_API_VERSION` in `lambda/billing/stripeApi.mjs`).

The sandbox set was created 2026-10-01 via the Stripe MCP (`stripe_api_write`, test mode). In live, recreate them by hand or with the same calls against a live key.

## Deploy order for a billing change

Lambda before bundle, always: `scripts/infra/tf-plan.sh -target=module.billing` → read every change → `scripts/infra/tf-apply.sh` → then the web deploy workflow. A bundle that calls a route the Lambda does not have yet shows "checkout isn't available".

The webhook secret is a two-apply dance the first time in any mode: apply with `TF_VAR_stripe_webhook_secret` empty (the route must exist before Stripe can be pointed at it), create the endpoint, paste its `whsec_`, apply again. Until then the Lambda answers 500 `webhook_secret_unset` and Stripe retries.

## The flip order (v1)

Each step is its own commit or apply, and each is watched before the next.

1. **Live keys.** Paste `sk_live_` and `pk_live_` into `~/.beanies-tf.env` as `BEANIES_STRIPE_LIVE_SECRET_KEY` / `BEANIES_STRIPE_LIVE_PUBLISHABLE_KEY` (the sandbox pair stays beside them). Create the live Stripe objects above with that key (REST, as in the sandbox) including the webhook endpoint, whose `whsec_` goes in as `BEANIES_STRIPE_LIVE_WEBHOOK_SECRET`. Then the ONE flip: `BEANIES_STRIPE_MODE=live`, `tf-plan.sh -target=module.billing` → apply, `gh secret set STRIPE_PUBLISHABLE_KEY --body "$BEANIES_STRIPE_PUBLISHABLE_KEY"`, web deploy. Verify with a real card on a `first_ten` test family ($1), then refund it in the Dashboard. Sandbox testing from here on is `npm run billing:local` + `stripe listen` on the dev machine.
2. **`v1_launch_at`.** One-line change to `terraform.auto.tfvars` (an ISO instant), `tf-plan.sh -target=module.registry` → apply. Every family's trial clock starts: `trialEndsAt = max(createdAt, v1_launch_at) + 90 d`. Watch `entitlement_computed` in CloudWatch: every state should read `trial`, none `read_only`.
3. **Cohort snapshot.** `node scripts/billing-cohort.mjs --snapshot-pre-v1` (dry-run, read the list) then `--apply`. Every live family at that instant gets `cohort=pre_v1`; `--first-ten <familyId>` for the ten. A family created after this has no cohort and sees list prices.
4. **`pricing` flag.** `featureFlags.committed.ts` `pricing: true` → web deploy AND the mobile lanes (native shows the plan card and the band copy; no purchase path). The Plan card, Plan page and See plans are now visible to every family.
5. **`billing_enforce`.** `terraform.auto.tfvars` → apply `module.registry`. Read-only now ACTS. Do this at least a week after step 2 and after reading `read-only-gate would_block` rates; on day 91 the first trials end.
6. **`ai_allowance_enforce`.** Last. `terraform.auto.tfvars` → apply `module.ai_extract`. Over-allowance reads now 402.

## Store metadata (before step 4 reaches the store lanes)

- Apple App Privacy / Google Data Safety: no In-App Purchases; the Diagnostics rows for `entitlement_state` / `plan` / `dry_run` are already declared (`docs/runbooks/native-store-submission.md`); no purchase data is collected natively.
- `web/src/pages/privacy.astro`: Stripe as a processor (card details never reach beanies.family; customer id and email are held by Stripe for receipts).
- Review notes: "Plans are chosen on the website; the app displays plan state only" with the read-only copy.

## Watching it

CloudWatch, log group `/aws/lambda/beanies-family-billing-prod`:

- `checkout_session_created` / `checkout_refused {reason}` / `claim_ok` / `claim_refused {reason}` / `portal_session_created` / `webhook_received` / `webhook_applied {status, plan}` / `webhook_ignored {reason}` / `webhook_signature_failed`.
- Alarms (Slack via the alerts topic): `[billing] webhook_apply_failed` (a verified event that could not be written; Stripe is retrying), `[billing] billing_upstream_error` (Stripe unreachable or refused a request: a missing lookup_key, coupon or portal configuration).
- Client (`billing-ui`): `checkout_mounted`, `checkout_complete`, `claim_ok`, `claim_failed` (**critical**: money taken, plan not applied), `portal_opened`, `portal_failed`, `stripe_js_load_failed`.

## Support levers

| Situation                                                                                                                 | Do                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A paying family's plan token is missing or does not match (`plan_token_missing`, `portal_failed token_missing/bad_token`) | Refund the current period in the Stripe Dashboard and ask the family to choose the plan again; the claim mints a fresh token into their file. There is NO paste or reissue path, on purpose. |
| Extend a trial                                                                                                            | `billing-cohort.mjs --trial-ends-at <familyId> <iso> --apply`                                                                                                                                |
| Mark a founding family                                                                                                    | `billing-cohort.mjs --first-ten <familyId> --apply`                                                                                                                                          |
| Row looks stale after a Stripe change                                                                                     | Dashboard → the subscription → resend the last `customer.subscription.updated`; the Lambda re-reads current state                                                                            |
| Roll back a flip                                                                                                          | Reverse the step's one-line change and apply; rows are data, nothing is deleted                                                                                                              |
| A family wants the other currency, or picked the wrong one at checkout                                                    | See **Switching a family's currency** below. Stripe never changes a customer's currency; the switch is a new customer and a new subscription.                                                |

## Switching a family's currency

Stripe fixes a customer's currency with their first invoice and never changes it, and `/billing/checkout-session` reuses the stored `stripeCustomerId`, so a second checkout would be pinned to the old currency too. A currency switch is therefore a NEW Stripe customer and a NEW subscription, done by hand; it is rare enough that there is no automated path. Do all four steps in one sitting, because the family reads as lapsed (read-only on the next refresh) between steps 1 and 3.

1. **Stripe Dashboard → the family's subscription → Cancel → Immediately.** Refund the unused portion of the last invoice (the cancel dialog can prorate it; a same-day wrong pick is a full refund). The `customer.subscription.deleted` webhook writes `canceled` on the row, which is what lets checkout accept the family again.
2. **Drop the stored customer from the billing row**, so the Lambda falls back to `customer_email` and Stripe creates a fresh customer in the new currency. `cohort` and `planTokenHash` stay as they are; the early-family discount still applies.

   ```bash
   aws dynamodb update-item --table-name beanies-family-billing-prod \
     --key '{"familyId":{"S":"<familyId>"}}' \
     --update-expression 'REMOVE stripeCustomerId'
   ```

3. **The family chooses the plan again:** Settings → Your beanies Plan → See Plans → the other currency → pay. The webhook sees a new subscription id that is active and applies it; the row picks up the new `stripeCustomerId` and `stripeSubscriptionId`. The Plan page's claim mints a new plan token for the new subscription into the family file (the old token stops working, as designed).
4. **Nothing else to do.** Manage Plan and Receipts now open the new customer's portal.

Side effect: invoices from before the switch sit on the old Stripe customer and are not visible in the family's portal. If asked, send the PDFs from the Dashboard. The old customer can stay; do not delete it while a refund is still settling.
