# Data sources — beanies-metrics

Deep reference for the data sources this skill reads. SKILL.md points here
when you need exact identifiers, schemas, or caveats. Everything here is
**read-only**; nothing this skill runs may write, delete, or publish customer data
without the masking rules below.

## Table of contents
1. DynamoDB family registry (primary)
2. CloudWatch telemetry firehose (activity)
3. Plausible Analytics (traffic + product usage)
3b. Google Search Console (search terms — optional)
4. What is NOT available
5. Ad spend ledger (manual — paid campaigns)
6. Privacy / masking rules

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
| `attribution` | map `{utm_source?, utm_medium?, utm_campaign?, utm_content?, utm_term?, campaign_id?, ad_group_id?, ad_id?, oppref?}`, **write-once at signup**; absent/null on earlier or untagged rows | first-party pods source (`registry-utm`), see §5b |
| `updatedAt` | ISO ts, every PUT | — |

  Note (#118 review): tombstoned families are dropped from the registry feed by `pull_registry.mjs`, so a pod whose family later deleted itself is absent from `registry-utm` while the Slack message and the Plausible signup still counted the conversion. A small, known under-count; not corrected, because the feed-wide exclusion is deliberate. Also known: the source is chosen per campaign by data presence, so in the 30 days after #118 shipped (2026-10-02) a campaign with hand-recorded `pods_manual` rows from before the rollout flips to `registry-utm` on its first attributed row and the dashboard no longer adds the manual rows; read both by hand for that one window rather than carrying merge logic that is dead after it.

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
- `paid.*` (marketing) — the paid-campaign UTM breakdowns: traffic quality by
  `visit:utm_source × visit:utm_campaign × visit:utm_content`, and CTA clicks
  (`event:name contains "CTA: "`) by `event:name × utm_campaign × utm_content` and
  by `event:name × utm_campaign`. All filtered to `['is_not','visit:utm_source',['(not set)']]`
  — **verified accepted by the live API 2026-10-01**. If Plausible ever refuses the
  filter the CTA queries fall back to the unfiltered form, `paid.ctaFilteredByUtmSource`
  flips to `false`, and `build_dashboard.mjs` drops the `(not set)` rows itself.
  CTA events inherit the visit's UTMs, which is what makes "CTA clicks per ad" possible.
- `paid.*` (app) — app visitors by `utm_source` / `utm_campaign` / `utm_content`, and
  the `signup` EVENT by `utm_campaign × utm_content`. **Empty today by design**: nothing
  carries UTMs from the marketing site into `app.beanies.family` (tracker issue "carry
  UTM attribution through to the app"). The only app-side `utm_source` seen so far is a
  base64 blob from a share link, not a campaign. Built now so the pods-per-ad column
  switches from the manual ledger to Plausible with no code change when that ships.
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

## 5. Ad platforms (paid campaigns): OpenAI Ads API + manual ledger

Two halves, joined on the ad slug `utm_content`. Every ad is tagged
`utm_source=<platform>&utm_medium=cpc&utm_campaign=<campaign>&utm_content=<angle>-<ad-slug>`;
Plausible supplies visitors + CTA clicks per slug, the platform supplies spend.

### 5a. OpenAI Ads API (live — `scripts/pull_openai_ads.mjs`)

- **Auth:** `OPENAI_ADS_API_KEY` in `~/.openai.env` (`set -a; . ~/.openai.env; set +a`).
  Never printed, never committed. Missing → exit 3, the pipeline degrades to the ledger.
- **Base:** `https://api.ads.openai.com/v1`, `Authorization: Bearer`. All GET. List
  responses are `{object:'list', data[], has_more, first_id, last_id}` with
  `?limit=&after=<last_id>` pagination (insights page at 20 rows by default, `limit=100`
  honoured — the collector walks `after` on every list).
- **Endpoints used (verified 2026-10-01):** `/ad_accounts` (currency, timezone),
  `/campaigns` (status, `budget.daily_spend_limit_micros`, targeting countries,
  `start_time`), `/ad_groups`, `/ads` (status, `review_status`, `creative.title/body`,
  `landing_page_configuration.query_string_template` — the UTMs are parsed from it),
  and `/ad_account/insights` with `aggregation_level=ad|campaign`,
  `time_granularity=daily` (per-day rows) or `none` (one lifetime aggregate; `total`,
  `weekly`, `all` are rejected), `fields[]=metadata.readable_time, ad.id, ad.name,
  ad.impressions, ad.clicks, ad.spend, ad.ctr, ad.cpc` (also `campaign.id`,
  `ad_group.id` on ad rows — the only ad→campaign link, `/ads` carries none),
  `time_ranges[]={"type":"date_range","since","until"}`, `includes[]=zero_impression_items`
  (so unserved ads still appear), and `segments[]=country` (per-country split; keys
  change to `ad_spend` / `ad_clicks` / `country_name`, and `zero_impression_items` is
  refused with a segment, so that call omits it).
- **⚠️ Units (inferred, verified):** insights `spend` and `cpc` are **whole units of the
  account currency — SGD for this account —** not micros: day one read `spend 14.69`,
  `clicks 4`, `cpc 3.67` and 4 × 3.67 = 14.68, while the campaign budget is
  `25,000,000` micros for a S$25/day cap. So budgets are micros (the collector divides
  by 1e6 into `dailyBudget`), insights are units, and `ctr` is a fraction (0.0061 =
  4/653) that the collector converts to percent. Recorded on every dump as `spendUnit`.
  The ledger's `credit_usd` was written before the platform reported SGD — the build
  step sets `currencyMismatch` when the ledger's `currency` differs from the account's.
- **Window:** `[DAYS]` (default 30) ending *today in the account timezone*
  (Asia/Singapore). Lifetime is a second `time_granularity=none` call from the earliest
  campaign `start_time` to today.
- **Output `openai_ads.json`:**

```jsonc
{
  "generatedAt": "...", "window": { "since", "until", "days", "timezone" },
  "account": { "id", "name", "status", "currency": "SGD", "timezone", "reviewStatus" },
  "spendUnit": { "unit": "currency-units", "currency": "SGD", "note": "..." },
  "campaigns": [{ "id", "name", "status", "objective", "biddingType", "dailyBudget", "countries": ["US","SG","GB","AU"], "startDate", "endDate", "createdAt" }],
  "adGroups": [{ "id", "name", "status", "contextHints": [], "biddingStrategy" }],
  "ads": [{ "id", "name", "status", "reviewStatus", "title", "body", "targetUrl", "queryStringTemplate",
            "utmSource", "utmMedium", "utmCampaign", "utmContent",   // null when untagged
            "campaignId", "adGroupId", "lifetime": { "spend", "clicks", "impressions" }, "createdAt" }],
  "dailyByAd":       [{ "date", "adId", "adName", "impressions", "clicks", "spend", "ctr", "cpc" }],
  "dailyByCampaign": [{ "date", "campaignId", "campaignName", "impressions", "clicks", "spend", "ctr", "cpc" }],
  "byCountry":       [{ "date", "adId", "country": "SG", "impressions", "clicks", "spend" }],   // soft
  "lifetime": { "since", "until", "spend", "clicks", "impressions", "byCampaign": [...], "source": "insights-lifetime | window-sum-fallback" },
  "_degraded": [{ "name", "reason" }]
}
```

### 5b. Manual ledger (`~/.config/beanies/ad-spend.json`)

- **Why it still exists:** the platform cannot know which Slack create-pod message was an
  ad (`pods_manual`), nor the promo credit and its deadline. With the API live, the
  ledger **only needs** `platform` / `utm_source` / `utm_campaign` / `currency` /
  `credit_usd` / `credit_deadline` / `pods_manual`. `ads` and `daily` are **optional
  overrides / fallback** (see precedence below) — keep them for a platform with no API.
- **File:** gitignored location, never committed. **Optional** — with neither the
  ledger nor `openai_ads.json` the paid panel hides itself with a note; a malformed
  ledger is reported as `paidLedgerError` in `dashboard_data.json` and in the
  dashboard's "missing this run" banner, never a crash. Example to copy:
  `assets/ad-spend.example.json`.
- **Precedence (per ad slug, per campaign):**
  - `spendSource: 'openai-ads-api'` when any API ad carries the campaign's
    `utm_campaign`. The roster is the API's tagged ads (name, `title`, `status`,
    `reviewStatus`, per-`countries` split); the ledger `ads` entry only lends `angle`
    (the API has no such field — else it is derived from the "angle - name" prefix).
    Ledger `daily` rows for an API-known slug are **ignored** and counted in
    `ledgerSuperseded`; ledger-only slugs keep their rows and roster entries.
  - `spendSource: 'ledger'` when the API has nothing for the campaign — identical to the
    pre-API behaviour. `'none'` when neither has rows.
  - An API campaign the ledger does not declare is synthesised from the ads' UTMs
    (`synthesizedFromApi: true`, no credit, no pods).
  - `pods_manual` / `podsSource` are unaffected by the spend source.
- **Schema:**

```jsonc
{
  "campaigns": [
    {
      "platform": "chatgpt",             // free text, shown as the campaign label
      "utm_source": "chatgpt",           // must equal the ads' utm_source
      "utm_campaign": "sg-pilot-oct26",  // must equal the ads' utm_campaign
      "currency": "USD",
      "credit_usd": 350,                 // optional: lifetime budget / promo credit
      "credit_deadline": "2026-10-14",   // optional: ISO date the credit expires
      "started": "2026-10-02",           // optional, informational
      "notes": "...",
      "ads": [
        { "utm_content": "straight-one-app", "name": "...",
          "angle": "straight|funny|testimonial|alternative", "status": "active|paused" }
      ],
      "daily": [                         // one row per ad per day, from Ads Manager
        { "date": "2026-10-02", "utm_content": "straight-one-app",
          "spend": 12.3, "impressions": 4000, "clicks": 31 }
      ],
      "pods_manual": [                   // interim attribution, see below
        { "date": "2026-10-01", "utm_content": null, "note": "slack heard-via chatgpt, untagged" }
      ]
    }
  ]
}
```

- **Window scoping:** `daily` (API or ledger) and `pods_manual` rows are filtered to the
  dashboard's date range (`dateRange.start..end`, inclusive, by the row's `date`).
  `credit` progress is **lifetime** — the credit is a budget, not a window figure — from
  the API's un-windowed insights call when available (`credit.source:
  'insights-lifetime'`), else the sum of every row held (`'row-sum'`, only right while
  the window covers the campaign). `credit.daysElapsed` counts from the API campaign
  `startDate` (else the ledger `started`, else the first served day).
- **Pods source precedence** (`podsSource: 'registry-utm' | 'plausible-app-utm' | 'manual' | 'none'`,
  labelled on every figure). The rule is per campaign, so per-ad pods and the campaign
  total never mix sources:
  1. `registry-utm` (first-party, ground truth): `pull_registry.mjs --raw` carries each
     family's write-once `attribution` map (`utm_source/medium/campaign/content/term`,
     `campaign_id`, `ad_group_id`, `ad_id`, `oppref`; null when absent) in `familiesFull`.
     Rows with `attribution.utm_campaign === <campaign>`, `createdAt` inside the window
     and no `deletedAt` are counted per `attribution.utm_content`. Used when ANY such row
     exists. The campaign filter is required: a `utm_content` slug reused by another
     campaign must not leak in.
  2. `plausible-app-utm`: the app-side `signup` event carried the campaign's UTMs.
  3. `manual`: `pods_manual`, the interim hand attribution from the create-pod Slack
     message (record the ad's `utm_content` when known, or `null` when only "heard via
     chatgpt" is known; untagged rows count toward the campaign total but no ad row).
     **Now the fallback only**: used when neither the registry nor Plausible has data
     for the campaign, and ignored as soon as either does.
  4. `none`.
  Registry rows exist only for families created after the carry-through shipped, and
  store installs cannot carry a tag (expected unattributed).
- **Derived columns** (`build_dashboard.mjs` → `dashboard_data.json.paid`): per campaign
  and per ad — spend, impressions, clicks, **CTR** (clicks ÷ impressions), **CPC**
  (spend ÷ clicks), visitors + bounce + duration (Plausible), **CTA clicks** and
  **CTA rate** (CTA clickers ÷ tagged visitors), signups (app UTM, when present), pods,
  **CPA = spend ÷ pods** (`null` when pods = 0 — never a divide-by-zero, never "$0").
  `winner` = lowest CPA among ads with ≥1 pod, else highest CTA-click rate, else null.
  `undeclaredLedger` / `undeclaredPlausible` / `untaggedApiAds` list ad slugs seen in one
  source but not the roster (or platform ads with no UTM at all) — tagging mistakes,
  surfaced rather than dropped.
- **Tweaks** (`campaign.tweaks[]`, each `{ rule, action, utmContent, name, detail }`;
  computed in `build_dashboard.mjs`, rendered under the per-ad table; a rule is emitted
  only when its precondition holds — never padded):
  - **(a)** an ad with ≥300 impressions and CTR < ½ the campaign median CTR (median over
    ads with impressions; needs ≥2 such ads) → `consider pausing`
  - **(b)** the ad with the best CTR when it is ≥2× that median → `shift budget here`
  - **(c)** an ad with clicks but no Plausible visitor for its `utm_content` in the same
    window (Plausible present) → `tagging or landing problem`
  - **(d)** credit pace: lifetime spend ÷ days elapsed × days left < credit remaining,
    with spend > 0 and days left > 0 → `under-pacing, raise daily budget to X`, X =
    remaining ÷ days left (the API's current daily cap is quoted in `detail`)
  - **(e)** an ad with `status: active` but `reviewStatus` ≠ `approved` → `blocked in review`
- **What CPA means here:** cost per **new family (pod)**. It is **not** a revenue ROI —
  no paid plan exists yet, so there is no revenue to earn back. Read CPA against the
  value of an early-adopter family, not against a sale.
- **Keeping it current:** add a `pods_manual` row the moment a create-pod Slack message
  can be tied to the campaign — that is the whole daily job now. `daily` rows are only
  for a platform without an API; a stale ledger there under-reports spend and overstates
  nothing, but CPA is only as fresh as the last row.

---

## 6. Privacy / masking rules

- **Terminal report** (local, ephemeral) may show full `ownerEmail` + family names — it's
  greg's own admin data on his own machine, and identifying "who to nurture / who we
  lost" is the point.
- **HTML dashboard artifact** is hosted (private, but hosted): **mask emails**
  (`jo****@gmail.com`, via `pull_registry.mjs` `ownerMasked`) and prefer family name +
  country + masked owner. Never publish full customer email lists to an artifact.
- **Never** print or commit the Plausible token, `OPENAI_ADS_API_KEY`, AWS keys, or
  `.beanpod` contents.
- The ad-spend ledger holds no customer data, but `pods_manual.note` may — keep notes
  to "heard via chatgpt", never a name or email. Never commit the real ledger.
- Raw JSON dumps go to the session scratchpad, never into the repo.
