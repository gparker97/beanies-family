# billing Lambda (#95)

The one place beanies.family talks to Stripe. Zero-dependency Node on `nodejs20.x`; Terraform in `infrastructure/modules/billing/`. Design and rationale: ADR-038, `docs/plans/2026-09-30-pricing-entitlement-read-only.md`; launch order: `docs/runbooks/pricing-launch.md`.

| Route (POST)                | Auth              | Does                                                         |
| --------------------------- | ----------------- | ------------------------------------------------------------ |
| `/billing/checkout-session` | `x-api-key`       | Picks the Price by `lookup_key` + cohort, creates an Embedded Checkout session |
| `/billing/claim`            | `x-api-key`       | Verifies the completed session, lands the subscription, mints the plan token ONCE |
| `/billing/portal-session`   | `x-api-key` + plan token in the body | Creates a Customer Portal session |
| `/billing/webhook`          | `Stripe-Signature` only | Re-reads the subscription and writes its current state |

Files: `index.mjs` (routing, handlers), `stripeApi.mjs` (REST client, pinned `STRIPE_API_VERSION`), `webhookSignature.mjs` (HMAC + `safeEqual`), `ddb.mjs` (`UpdateItem SET` discipline), `alarms.mjs` (prefixes pinned to the Terraform by test).

```bash
npm run test:lambda      # node:test, mocked fetch + DynamoDB
```

## Testing before launch: `npm run dev` straight to the sandbox

While prod holds the sandbox key (`sk_test_`), the deployed Lambda lets a dev origin (`localhost:5173` / `:4173`) check out and looks the family up in the DEV registry table, where localhost families register. So the whole flow runs from `npm run dev` with `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...` in `.env` and the `pricing` flag override on; no harness needed. The `dev_origin` refusal arms itself the moment the Lambda's key starts with `sk_live_`.

## Sandbox repro after launch (the local harness)

Prod holds exactly one Stripe key pair. Once that is live, sandbox testing happens here, with the deployed code unchanged:

```bash
source ~/.beanies-tf.env                                   # the SANDBOX pair by name + AWS profile
# once: a sandbox billing table, so sandbox subscriptions never land in live families' rows
aws dynamodb create-table --table-name beanies-family-billing-sandbox \
  --attribute-definitions AttributeName=familyId,AttributeType=S \
  --key-schema AttributeName=familyId,KeyType=HASH --billing-mode PAY_PER_REQUEST
BILLING_TABLE_NAME=beanies-family-billing-sandbox npm run billing:local   # http://localhost:8787
stripe listen --forward-to localhost:8787/billing/webhook   # prints a whsec_; export STRIPE_WEBHOOK_SECRET=... and restart
VITE_BILLING_BASE_URL=http://localhost:8787 npm run dev     # the Plan page now talks to the harness
```

`local.mjs` wraps `handler` in a synthetic HTTP API v2 event, reads the sandbox billing table you name (it refuses a `-prod` table) and the DEV registry (where localhost families register), read-only, with your AWS profile, and, because it reads the sandbox pair by name (and refuses a live key outright), is never refused for a localhost origin. It is never packaged (the archive excludes it). `stripe trigger customer.subscription.updated --add subscription:metadata.familyId=<uuid>` exercises the webhook path.
