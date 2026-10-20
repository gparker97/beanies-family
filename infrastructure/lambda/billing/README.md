# billing Lambda (#95)

The one place beanies.family talks to Stripe. Zero-dependency Node on `nodejs20.x`; Terraform in `infrastructure/modules/billing/`. Design and rationale: ADR-038, `docs/plans/2026-09-30-pricing-entitlement-read-only.md`; launch order: `docs/runbooks/pricing-launch.md`.

| Route (POST)                | Auth              | Does                                                         |
| --------------------------- | ----------------- | ------------------------------------------------------------ |
| `/billing/checkout-session` | `x-api-key`       | Picks the Price by `lookup_key` + cohort, creates an Embedded Checkout session |
| `/billing/claim`            | `x-api-key`       | Verifies the completed session, lands the subscription, mints the plan token ONCE |
| `/billing/portal-session`   | `x-api-key` + plan token in the body | Creates a Customer Portal session |
| `/billing/webhook`          | `Stripe-Signature` only | Re-reads the subscription and writes its current state |

Files: `index.mjs` (routing, handlers), `stripeApi.mjs` (REST client, pinned `STRIPE_API_VERSION`), `webhookSignature.mjs` (HMAC + `safeEqual`), `ddb.mjs` (`UpdateItem SET` discipline), `alarms.mjs` (prefixes pinned to the Terraform by test), `slack.mjs` (the #beanies-joiners subscription lines: `formatSubscriptionMessage`, `postToSlack`).

```bash
npm run test:lambda      # node:test, mocked fetch + DynamoDB
```

## Sandbox testing: the deployed sandbox lane (default)

Prod holds the LIVE key pair and refuses localhost origins (`dev_origin`). Sandbox testing goes to
a second instance of this Lambda, `module.billing_sandbox` (added 2026-10-20):

- routes `POST /sandbox/billing/{checkout-session,claim,portal-session,webhook}` on the same API
  (`ROUTE_PREFIX=/sandbox`; `routePathOf` strips it, so routing is identical);
- the SANDBOX key pair only, with `STRIPE_MODE=sandbox`. Terraform's precondition refuses a live key
  for it, and the handler's `mode_mismatch` guard refuses every request if one slips through;
- localhost origins only (`sandbox_origin` refuses any other, `app.beanies.family` included);
- localhost-created families only (`live_family` refuses a family that exists in the PROD
  registry, so a real pod opened on `npm run dev` can never pick up a sandbox plan token);
- its own billing table, `beanies-family-billing-sandbox`. The registry reads it for dev-origin
  GETs, so a sandbox purchase shows as `active` on dev;
- the Stripe sandbox webhook endpoint points at `/sandbox/billing/webhook`;
- its metrics go to `beanies-family/billing-sandbox` and it has no alarms, so sandbox noise never
  pages.

`npm run dev` needs `VITE_BILLING_BASE_URL=https://api.beanies.family/sandbox` and a `pk_test_`
publishable key in `.env`; a dev build refuses checkout otherwise (`src/config/features.ts`).
Removal path: the plan, `~/projects/beanies-ops/docs/plans/2026-10-20-sandbox-billing-lane-and-test-isolation.md`.

## Iterating on the handler before a deploy (the local harness)

```bash
source ~/.beanies-tf.env                                   # the SANDBOX pair by name + AWS profile
npm run billing:local                                      # http://localhost:8787, the lane's sandbox table
stripe listen --forward-to localhost:8787/billing/webhook  # optional; prints a whsec_ to export as STRIPE_WEBHOOK_SECRET
VITE_BILLING_BASE_URL=http://localhost:8787 npm run dev    # the Plan page now talks to the harness
```

`local.mjs` wraps `handler` in a synthetic HTTP API v2 event and runs it with the lane's guards
(`STRIPE_MODE=sandbox`: `mode_mismatch`, `sandbox_origin`, `live_family`). It reads the sandbox
billing table (default `beanies-family-billing-sandbox`; it refuses a `-prod` table), looks
localhost families up in the DEV registry, and reads the PROD registry only for the `live_family`
existence check, all with your AWS profile. It reads the sandbox pair by name and refuses a live
key outright. It is never packaged (the archive excludes it). Without `stripe listen`, sandbox
webhooks still reach the deployed lane, which writes the same table.
`stripe trigger customer.subscription.updated --add subscription:metadata.familyId=<uuid>`
exercises the webhook path.
