# Data sources — early-adopter-metrics

Deep reference for the three data sources this skill reads. SKILL.md points here
when you need exact identifiers, schemas, or caveats. Everything here is
**read-only**; nothing this skill runs may write, delete, or publish customer data
without the masking rules below.

## Table of contents
1. DynamoDB family registry (primary)
2. CloudWatch telemetry firehose (activity)
3. Plausible Analytics (traffic + product usage)
4. What is NOT available
5. Privacy / masking rules

---

## 1. DynamoDB family registry — the primary source

- **Table:** `beanies-family-registry-prod` (dev twin: `beanies-family-registry-dev`, ignore)
- **Region:** `ap-southeast-1`
- **Key:** hash key `familyId` (UUID). No range key, no GSI. `PAY_PER_REQUEST`.
- **Access:** this machine's `default` AWS profile authenticates as `user/greg` and can
  read it (verified). The `@aws-sdk/client-dynamodb` dep is already installed.
- **Read pattern:** paginated `ScanCommand` + `unmarshall` — exactly what
  `scripts/pull_registry.mjs` does (modeled on `scripts/migrate-registry-dev-rows.mjs`).

**Per-family attributes** (source: `RegistryEntry` in `src/types/models.ts`, Lambda
`infrastructure/lambda/registry/index.mjs`):

| Attribute | Meaning | Metric use |
| --- | --- | --- |
| `familyId` | pod UUID (partition key) | join key to CloudWatch `family_id` |
| `provider` | `local` \| `google_drive` | sync adoption |
| `fileId` | Drive file id (nullable) | — |
| `familyName` | nullable | label |
| `createdAt` | ISO ts, write-once | signup date → growth, tenure |
| `ownerEmail` | contact, write-once | identify family; dev classification |
| `ownerMemberId` | pointer authority, write-once | — |
| `subscribeNewsletter` | boolean | newsletter opt-in rate |
| `country` | CountryCode mirror | geography |
| `lastLoginAt` | **date-only `YYYY-MM-DD`**, stamped only on explicit `isLoginEvent` | recency / engaged buckets |
| `beanpodSizeKb` | client-rounded pod size (KB) | data-volume proxy |
| `updatedAt` | ISO ts, every PUT | — |

**Caveats:**
- `lastLoginAt` is **date-only** and only written when the client flags a real login
  event — it undercounts activity. For a truer "last active" use CloudWatch (below).
- `beanpodSizeKb` is client-reported and coarse; treat as an order-of-magnitude signal.
- **Dev/test rows** (owner `gpsp2001@gmail.com` incl. gmail dot/+ aliases, or any
  `@test.com`) are excluded by default — same rule as the migrate script. ~4 of ~60.

**Engagement scoring** (transparent, in `pull_registry.mjs`): `recencyScore` (0–60,
linear from today to 90d) + `volScore` (0–40, log-scaled to ~2MB). Recency-weighted so
a recently-active family outranks a big-but-quiet one. Buckets: `active_7d`,
`active_30d` (both = engaged), `dormant_90d`, `churned_90d_plus`, `never` (no login
event ever recorded).

---

## 2. CloudWatch telemetry firehose — the activity signal

- **Log group:** `/aws/lambda/beanies-family-telemetry-prod`, region `ap-southeast-1`
- **Retention:** 90 days (queries beyond that return nothing).
- **Query mechanism:** CloudWatch Logs Insights via the `aws` CLI (no SDK client
  installed). `scripts/query_cloudwatch.sh` wraps start-query → poll → get-results.
- **Discriminator:** every telemetry line is `t = "beanlog"` — always filter on it.

This is a **diagnostic** stream, not product analytics: no clean `page_view` /
`feature_used`. But nearly every event carries `family_id` (a per-pod UUID — the same
id space as the registry `familyId`), so it answers:

- **Active families** over a window: `count_distinct(family_id)` (richer than
  `lastLoginAt` because it fires on any activity, not just login). ~40 families active
  in the last 30d at build time, vs 22 "engaged" by the date-only registry field.
- **Last-active per family:** `latest(@timestamp) by family_id` — cross-check / correct
  the registry recency, and spot families active in CloudWatch but stale in the registry.
- **App opens per family:** `surface = "open-cycle"` → sessions proxy.
- **Which subsystems get exercised:** `count() by surface` (helpful-hints, save-status,
  sync-*, local-notifications, native-biometric, open-cycle, …). Secondary usage signal.
- **Error pressure:** `filter level = "error" | stats count() by surface`.

`query_cloudwatch.sh` subcommands: `activity`, `by-surface`, `last-seen`, `opens`,
`errors` (each takes optional DAYS, default 30).

---

## 3. Plausible Analytics — traffic + clean product usage

- **Sites (site_id = domain):** marketing `beanies.family`, app `app.beanies.family`.
- **Hosted** on plausible.io. **Stats API v2:** `POST https://plausible.io/api/v2/query`,
  `Authorization: Bearer <token>`, body `{ site_id, date_range, metrics, dimensions, filters, pagination }`.
- **Token:** read-only Stats key from the Plausible dashboard. `query_plausible.mjs`
  loads it from env `PLAUSIBLE_API_KEY` or `~/.config/beanies/plausible-token`
  (gitignored location, never committed). If absent the script exits 3 and the traffic
  sections are skipped with a note — the registry + CloudWatch report still stands.

**Marketing bundle** (`query_plausible.mjs marketing`): overview
(visitors/visits/pageviews/bounce/duration), top **sources**, **channels**,
**referrers**, **utm_source**, **utm_campaign**, top **pages**, **entry_page**,
**exit_page**, **countries**. Entry→exit + top pages ≈ the funnel through the site.

**App bundle** (`query_plausible.mjs app`): overview, **goals** (`event:goal` — signup,
login, member_joined, feature_used, discord_join_click, create_pod_click,
invite_request_click, install/community nudges, family_deleted, …), top app **pages**,
top **sources**, **feature usage** (`feature_used` broken down by the `feature` prop =
transaction / budget / goal / vacation — the "most-used features" answer), and **login
method** mix (password / passkey / cross_device).

**Caveats:** Plausible is aggregate and privacy-first — **no `family_id`**, so it can't
be joined per-family. Custom goals only count if the Plausible dashboard has them
configured as goals (pageviews + any received custom event still show via `event:goal`).

---

## 4. What is NOT available (state these honestly in the report)

- **Members per family / per-family member list** — not stored server-side anywhere.
  `memberCount` exists only on-device and never leaves the client. Do not estimate it.
- **Per-family `.beanpod` file sizes via Drive** — each family's pod is in *their own*
  Google Drive, unreachable from this machine. Use registry `beanpodSizeKb` instead.
- **Per-family traffic/referrer** — Plausible has no family id; acquisition is site-wide.

---

## 5. Privacy / masking rules

- **Terminal report** (local, ephemeral) may show full `ownerEmail` + family names — it's
  greg's own admin data on his own machine, and identifying "who to nurture / who we
  lost" is the point.
- **HTML dashboard artifact** is hosted (private, but hosted): **mask emails**
  (`jo****@gmail.com`, via `pull_registry.mjs` `ownerMasked`) and prefer family name +
  country + masked owner. Never publish full customer email lists to an artifact.
- **Never** print or commit the Plausible token, AWS keys, or `.beanpod` contents.
- Raw JSON dumps go to the session scratchpad, never into the repo.
