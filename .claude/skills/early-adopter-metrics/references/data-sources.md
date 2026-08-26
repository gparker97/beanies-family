# Data sources — early-adopter-metrics

Deep reference for the three data sources this skill reads. SKILL.md points here
when you need exact identifiers, schemas, or caveats. Everything here is
**read-only**; nothing this skill runs may write, delete, or publish customer data
without the masking rules below.

## Table of contents
1. DynamoDB family registry (primary)
2. CloudWatch telemetry firehose (activity)
3. Plausible Analytics (traffic + product usage)
3b. Google Search Console (search terms — optional)
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
| `signupPlatform` | `web` \| `ios` \| `android`, **write-once at row creation**; absent on rows created before 2026-08-24 | web-only conversion maths — absent means UNKNOWN and is EXCLUDED, never assumed web |
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
transaction / budget / goal / vacation / activity / list / todo / meal_plan / recipe /
account / asset / milestone / photo / medication / emergency_contact / saying — the
"most-used features" answer; the vocabulary is the `FeatureName` union in
`src/services/analytics/plausible.ts`, and it counts CREATION only, at user-initiated
call sites — app-initiated writes are suppressed via `withAppInitiatedWrites`), and **login
method** mix (password / passkey / cross_device).

**Enrichment queries** (all optional, via `soft()` — a failure degrades one panel and
is recorded in `_degraded`, never breaking the run):
- `channelSources` — `dimensions: ['visit:channel','visit:source']`. Resolves the
  channel bucket to named sources ("Organic Social" → Reddit, Pinterest). **Verified
  working.**
- `direct.*` — the same queries filtered to `visit:channel == "Direct"`, broken down by
  entry page / country / device, plus an overview for `visits ÷ visitors`.
- `outbound` + `outboundToApp` — `Outbound Link: Click` by `event:props:url`, and a
  **deduplicated** `contains` query for links to `app.beanies.family`. Use the deduped
  one for the hand-off number: summing per-URL rows double-counts a visitor who
  clicked both `/welcome` and `/login`.
- **New-vs-returning: not available, and not fixable.** Plausible is cookieless and its
  visitor hash is stable only within a single day, so the Stats API v2 has no such
  dimension, metric or filter — `visit:is_returning`, the `returning_visitors` metric and
  an `is_returning` filter were all rejected as invalid against the live API, and the v2
  docs list no equivalent (verified 2026-08-24). The probe was REMOVED rather than left to
  degrade every run, because a permanently-impossible query in `_degraded` trains the
  reader to ignore that banner when it names something real. Use `visits ÷ visitors` as the
  repeat-visit proxy, and the registry+CloudWatch activation cohort (stable `family_id`s)
  for a true returning signal. Do not re-add the probe.

**Goal names are matched by substring**, so the live goals resolve as:
`Family Create - Button Clicked (top of funnel)` ← `'Button Clicked'`;
`Family Create - Signup Completed` ← `'Signup Completed'`;
`Family Member Joined` ← `'Member Joined'`. Renaming a goal in Plausible silently
zeroes a funnel step — check here first if a step reads 0.

**Platform split + the conversion numbers (#71, 2026-08-24).** `signupPlatforms` breaks
the `signup` EVENT down by the `platform` prop (`web` / `ios` / `android`). Read these
rules before quoting any conversion figure:

- **The headline `overallPct` is WEB-ONLY on both sides** — `completedWeb` ÷ marketing
  visitors. It is the only like-for-like pairing on the page. The platform split ships
  as **volume** beside it, never as a second percentage; the old
  `overallPctUpperBound` (registry ÷ visitors) was **retired** in #71 because it mixed
  populations and readers could not tell which of the two rates was real.
- **`completedWeb` is DERIVED, not read.** The headline count comes from the
  dashboard-configured GOAL `Signup Completed`; the split comes from the raw EVENT
  `signup`. The goal→event mapping is Plausible-side config this repo cannot see, and
  the sibling goal `Family Create - Button Clicked` has no matching event name at all —
  so the two are not assumed 1:1. The web SHARE from the breakdown is applied to the
  goal count, keeping the rate consistent with the count displayed next to it.
  `conversion.platformTotalsAgree` reports whether the totals actually matched on a
  given run — if `false`, do not quote the split as exact.
- **The absent-platform rule is PER-SOURCE. Getting this backwards ships a visibly
  broken number.**
  - **Plausible: absent ⇒ WEB.** Every signup before 2026-08-24 is *provably* web,
    because native builds never loaded Plausible at all. Plausible returns those rows
    under the literal string `(none)`, folded into `web` in `build_dashboard.mjs`.
    Treating them as unknown would make the web-only headline read ≈0% for the first 30
    days — indistinguishable from a regression.
  - **Registry: absent ⇒ UNKNOWN, excluded.** `signupPlatform` is stamped write-once at
    row creation, so pre-#71 rows genuinely cannot be attributed. Assuming web there
    would re-introduce the exact inflation this change removes.
- **`gapIsMaterial` is coverage-gated.** It is computed only once ≥80% of in-window
  registry rows carry a platform (`conversion.platformCoverage`); below that it is
  `null` and nothing renders — on the first post-deploy runs correctly no row carries
  one. Its floor was also raised from 3 to 5: restricting both sides to web-only roughly
  halves *n*, and at realistic monthly volumes (~15–25 new families) the constant floor
  becomes the binding term. **Expected trigger rate: rare — a handful of times a year.**
  If it starts firing most months, the floor is wrong again; ordinary ad-blocker loss
  should not reach it.
- **`inAppPct` excludes iOS while `conversion.inAppPctExcludesIos` is true.** Its
  numerator (`completed`) is a custom EVENT and its denominator (`appArrivals`) is a
  PAGEVIEW count. On iOS the WebView origin is `capacitor://app.beanies.family`
  (`iosScheme: 'https'` is silently ignored by WKWebView), so iOS pageviews are not
  confirmed to land — counting iOS signups against a denominator missing iOS arrivals
  would inflate the one metric this document calls the one to optimise against. Flip
  `IOS_PAGEVIEW_AUTOCAPTURE` in `build_dashboard.mjs` once a TestFlight build proves
  otherwise.
- **`actualNewFamilies` stays ALL-PLATFORM.** It is a volume fact ("families actually
  created"), not a rate input. `newWebInWindow` is the web-only figure used for the gap.

**2026-08-24 is a SERIES BREAK — on the APP property.** Two changes landed: native builds
began loading Plausible, and four app-fired events became non-interactive. Do not compare
across it without saying so. It moves the **app** property's arrivals, top pages and bounce
rate (bounce should RISE toward a real value — until this date, merely being SHOWN an
install nudge counted as engagement), plus `inAppPct` and `conversion.overallPct`.

⚠️ **It does NOT move the marketing site's bounce rate.** The two are separate Plausible
properties — the app loads `pa-jvjpzIr6FM9tDKaS1gZaK` (`deploy.yml:187`), the marketing
site loads `pa-3pxexgz2YF03NyMDucQKN` (`web/src/layouts/BaseLayout.astro:113`) — and none
of the four events ever fired on marketing. Marketing's implausible 1–2% bounce has its own
separate causes (outbound-link and file-download events suppressing bounces) and is only
PARTLY fixed. When it still reads low next month, that is expected, not evidence the
passive-event fix failed to ship.

⚠️ **Second series break — marketing bounce, 2026-08-26.** The CWV RUM script was removed
on this date (see the caveat below), eliminating one of the two suppressors. Marketing
bounce may step UP across this date without any real behaviour change. Outbound-link and
file-download events still suppress it, so it remains unreliable in absolute terms.

**Native has NO offline queue.** CloudWatch telemetry has `logQueue.ts`; Plausible does
not, so an event fired with no connectivity is simply lost. Native therefore under-counts
somewhat — far less than the 100% it under-counted before #71. Also note `plausible_ignore`
is stored per-origin, so excluding yourself in a browser does not exclude you in an
installed app (a separate origin).

**Caveats:** Plausible is aggregate and privacy-first — **no `family_id`**, so it can't
be joined per-family. Custom goals only count if the Plausible dashboard has them
configured as goals (pageviews + any received custom event still show via `event:goal`).
The marketing site's `bounce_rate` reads implausibly low because outbound-link and
file-download events suppress bounces. Treat marketing bounce as unreliable — #71 did not
change it, and the 2026-08-26 CWV removal only removed one of two causes (see both
series-break notes above). The APP property's bounce is usable from 2026-08-24 onward.

**No Core Web Vitals in Plausible (removed 2026-08-26).** Five `CWV *` custom events
(LCP/INP/CLS/FCP/TTFB) were sent from a RUM script and their goals deleted. Plausible
treats custom properties as *categorical dimensions* — it has no average, median or
percentile — so the numeric `value` prop produced one row per distinct millisecond and
aggregated into nothing, while the Goals view showed only how many visitors fired each
event, which says nothing about performance. Google grades CWV on **p75**, which Plausible
cannot compute. Use **Lighthouse** for lab data and **Search Console / CrUX** for field
data (CrUX needs more traffic than beanies.family currently has). Do not re-add these to
Plausible.

---

## 3b. Google Search Console — search terms (optional)

- **Why it exists:** Plausible **cannot** report Google search terms and neither can any
  other analytics tool. Google strips the query from the referrer, so an organic Google
  visit arrives as nothing but `source = Google`. Search Console is the only source.
- **API:** `POST https://searchconsole.googleapis.com/webmasters/v3/sites/{site}/searchAnalytics/query`
- **Property:** `sc-domain:beanies.family` — **verified working** as a Domain property
  (2026-08-23). Pass `https://beanies.family/` only if it is ever changed to URL-prefix.
- **Auth:** service-account key at `~/.config/beanies/gsc-service-account.json`, OR **any
  service-account JSON dropped into `~/.config/beanies/`** (the script scans the dir for
  a file with `type: "service_account"`, so Google's original download name works
  unrenamed), OR `GSC_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` /
  `GSC_ACCESS_TOKEN`. Scope `webmasters.readonly`. `query_search_console.mjs` signs its
  own JWT — no `googleapis` dependency.
- **Setup:** Google Cloud → enable the **Google Search Console API** → create a service
  account → JSON key → then Search Console → Settings → Users and permissions → add the
  service-account email with **Restricted** access.
- **Returns:** per `query` and per `page`, plus the `query × page` join — clicks,
  impressions, CTR, average position. Data lags ~2 days.

**⚠️ Query rows are an anonymised SAMPLE, not the total.** Google omits rare queries
from the `query` dimension entirely for privacy, so query-level sums understate badly
(measured 2026-08-23: 151 impressions across all named queries vs **577** site-wide from
the `page` dimension). `totals` is therefore computed from **pages**; the query sum is
reported separately as `queryLevelTotals`. Never present the query total as site traffic.

**⚠️ The hard limit on "highest-converting search terms":** Search Console knows
**clicks, not conversions**, and shares no identifier with Plausible. No tool can say
"this term produced a signup". The only honest construction is term → landing page
(GSC) → that page's downstream behaviour (Plausible), and it must be labelled
**inferred**. Never present it as tracked attribution.

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
