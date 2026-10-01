# ADR-038: Pricing: server-computed entitlement, an honesty gate, one payment rail

> Status: Accepted
> Date: 2026-10-01
> Related: [`docs/plans/2026-09-30-pricing-entitlement-read-only.md`](../plans/2026-09-30-pricing-entitlement-read-only.md), Notion tracker #95, `docs/runbooks/pricing-launch.md`, ADR-030 (managed AI proxy)

## Context

The marketing site promised a commercial model the app could not honour: a 90-day trial, read-only after it, magic-beans quotas per plan, two plans, and grandfathered pricing. The app had no plan state, no trial clock, no read-only mode, no meter and no way to take money. The data lives in an encrypted, user-editable Automerge document that the server never reads, on three surfaces (web, iOS, Android), two of which forbid a third-party purchase path.

## Decision

### 1. Entitlement is computed on the server, from a table the client never writes

`beanies-family-billing-<env>` (hash key `familyId`) holds subscription state, cohort, an optional trial override and the plan-token hash. The registry GET, which every client already makes once per session, joins it and returns a computed `entitlement { state, reason, plan, cohort, trialEndsAt, currentPeriodEnd, enforced, serverTime }`. The rules live in one pure module (`lambda/registry/entitlement.mjs`), in this order: subscribed → per-family `trialEndsAt` override → no `V1_LAUNCH_AT` means `beta` → launch-based 90-day trial → `read_only`.

The client never computes the trial. It applies two rules to a cached answer: a `trial` expires on its own `trialEndsAt` regardless of connectivity, and an open-ended answer (`active`, `beta`) is honoured for 14 days without a refresh, then treated as read-only until one succeeds. Clearing storage, reinstalling, a second device or going offline therefore cannot extend a trial.

### 2. Read-only is an honesty gate at the one write funnel

All family-data writes pass through `mutate()`. The gate there refuses with a `ReadOnlyError` (info toast, no modal) unless the write is `system` (sign-in stamps, roster heal, credentials, via `familyStore.updateMemberCredentials`, whose patch type IS the allowlist), a named settings write, or one of two bookkeeping collections. Merges, snapshots, compaction and migrations bypass `mutate()` and keep doing so: a read-only family still receives a peer's edits. Recurring processing and the reminder backfill pause and catch up.

It is an honesty gate, not a security boundary: the client cannot be forced to update, so the only server-side enforcement is the AI allowance (a 402 from ai-extract). That is accepted. A stale client that keeps writing gains nothing it could not get by exporting and self-hosting, which is free by design.

### 3. Dry-run first, then a documented flip order

Every enforcement path shipped computing and logging its would-be decision with no effect: `BILLING_ENFORCE=false`, `AI_ALLOWANCE_ENFORCE=false`, the `pricing` feature flag off, `V1_LAUNCH_AT` unset. CloudWatch `entitlement_computed`, `read-only-gate would_block` and `allowance_would_deny` are the soak. The flip order (live keys → `V1_LAUNCH_AT` → cohort snapshot → flag → `BILLING_ENFORCE` → `AI_ALLOWANCE_ENFORCE`) is `docs/runbooks/pricing-launch.md`.

### 4. One payment rail, Stripe, from the web app only

No Apple IAP, no Google Play Billing, no RevenueCat, no in-app link, price or purchase verb on native (Apple 3.1.3(f), Google Play). Native shows greg's fixed read-only copy and Export. The Plan page (`/settings/plan`) is `webOnly` in the router and hosts **Stripe Embedded Checkout**; **cancel, card and invoices are Stripe's hosted Customer Portal**. Custom Elements were ruled out as more code for no product gain.

The billing Lambda is zero-dependency (Stripe REST over `fetch`, HMAC signature check with `timingSafeEqual`), pinned to one `Stripe-Version` (`2026-08-26.dahlia`), and never trusts a webhook's snapshot: every `customer.subscription.*` event (and the claim) re-reads the subscription and writes its current state with `UpdateItem SET` on its own attributes. Ordering and duplicates therefore have no failure mode, and there is no event ledger. Prices are addressed by `lookup_key` (`<cohort>.<plan>.<interval>.<currency>`), identical in sandbox and live, so no Price id lives in Terraform.

### 5. The plan token is a bearer secret, not identity, and not the family key

On the first successful claim the Lambda mints a 32-byte token, stores only its sha256, and returns it once. It lives in the encrypted doc (`settings.planToken`) so every member's device has it, and gates two things: the Customer Portal (a forged `familyId` cannot cancel a stranger's plan) and the `full` AI allowance. Trial and basic allowances stay keyed on `familyId`. Because `settings` is whole-replaced by concurrent writers, the token can be lost; that is made visible (`plan_token_missing`) and recovered by hand (`scripts/billing-cohort.mjs --reissue-token`, pasted on the Plan page). No self-service re-claim in v1.

### 6. Prices and quotas have one source

`packages/brand/pricing.ts` (`PRICES`, `TRIAL_DAYS`, `MAGIC_BEANS`, `familyPrice`) is consumed by the marketing site and the app; `lambdaContractParity` pins the Lambda's `PLAN_ALLOWANCE` to it.

## Consequences

- A paying family is `active` before launch too, which is what let the sandbox run end to end on prod with everything else off.
- Two Stripe keys live in exactly one deployed environment. After the live flip, sandbox testing happens on the dev machine through `infrastructure/lambda/billing/local.mjs` + `stripe listen`, never as a second key set in prod or GitHub.
- Embedded Checkout has no Appearance API on the pinned version; dark mode is a flat colour set per session (`branding_settings`), not a theme.
- Read-only families keep a 1/day server floor for AI (the UI refuses to send); exposure is one hand-made read a day.
- The trial-ending email is owned by #115's campaign Lambda, not this one.
