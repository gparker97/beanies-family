---
name: early-adopter-metrics
description: >-
  Produce a founder-facing growth, usage, and engagement report for
  beanies.family — total families, engaged vs churned early adopters, who to
  nurture and who we lost, retention/time-to-quiet, most-used features and
  pages, and marketing-site traffic sources, channels, referrers and funnel.
  Reads the DynamoDB family registry (live), the CloudWatch telemetry firehose,
  and Plausible Analytics, then renders a terminal report AND a branded HTML
  dashboard. Use this WHENEVER greg asks how the app or site is doing, how many
  families/users/sign-ups there are, who the most engaged or heaviest users are,
  who's churned or gone quiet, retention or engagement numbers, growth or
  sign-up trends, what features or pages are most used, where traffic or
  referrals come from, the marketing funnel, or "founder metrics / early-adopter
  metrics / a dashboard / KPIs" — even if he doesn't name this skill. Trigger on
  phrases like "how are we doing", "how many families do we have", "who's using
  it most", "who did we lose", "where's our traffic coming from", "what's our
  most popular page", "engagement report", "usage stats", "growth numbers".
---

# early-adopter-metrics

A founder's-eye read on how beanies.family is growing and being used. It answers
"who's actually using this, who's the heaviest, who did we lose, where do new
families come from, and what do they do once inside?" by combining four sources
that each hold part of the picture. Read `references/data-sources.md` for exact
schemas, identifiers, and caveats before interpreting anything.

## The four sources (and which question each answers)

1. **DynamoDB family registry** (`beanies-family-registry-prod`, ap-southeast-1) —
   the roster. Total families, signup dates (growth), last-login recency,
   beanpod size, country, sync provider, newsletter opt-in. **Always available.**
2. **CloudWatch telemetry** (`/aws/lambda/beanies-family-telemetry-prod`) — the
   activity signal. Truer "last active" per family, app opens, which subsystems
   get exercised. Diagnostic stream, not clean product analytics. **Available via
   the `aws` CLI.**
3. **Plausible** (sites `beanies.family` + `app.beanies.family`) — traffic and
   clean product usage. Sources, channels (with a **channel x source drill-down**,
   so "Organic Social" resolves to Reddit / Pinterest), referrers, UTM, top pages,
   funnel, custom goals, feature-usage breakdown, a **Direct-traffic deep-dive**,
   and **outbound-link clicks** (the only measured marketing->app hand-off).
   **Needs a Stats API token** at `~/.config/beanies/plausible-token` or env
   `PLAUSIBLE_API_KEY`; if absent, skip those sections with a one-line note — the
   rest of the report still stands.
4. **Google Search Console** (optional) — **the only** source of Google search
   terms. Plausible cannot report them and no analytics tool can: Google strips
   the query from the referrer, so organic Google visits arrive with no term
   attached. Needs a service-account key at
   `~/.config/beanies/gsc-service-account.json` (or env `GSC_ACCESS_TOKEN`); the
   script exits 3 and the panel self-hides when absent.

## Workflow

Run the collectors (they're all read-only), save each JSON to the session
scratchpad, then synthesize. Default window is 30 days unless greg asks otherwise.

```bash
SKILL=.claude/skills/early-adopter-metrics/scripts
OUT="$SCRATCH"   # your session scratchpad dir

# 1. Registry — the core. --raw includes the full per-family list (real emails +
#    familyId join key) needed for the terminal report and the CloudWatch join.
node $SKILL/pull_registry.mjs --raw > "$OUT/registry.json"

# 2. CloudWatch activity (each ~a few seconds). last-seen at 90d (full retention)
#    is what build_dashboard joins for true recency; the rest are 30d.
bash $SKILL/query_cloudwatch.sh activity 30    > "$OUT/cw_activity.json"
bash $SKILL/query_cloudwatch.sh activity 7     > "$OUT/cw_activity7.json"
bash $SKILL/query_cloudwatch.sh by-surface 30  > "$OUT/cw_surface.json"
bash $SKILL/query_cloudwatch.sh last-seen 90   > "$OUT/cw_lastseen.json"
bash $SKILL/query_cloudwatch.sh opens 30       > "$OUT/cw_opens.json"
bash $SKILL/query_cloudwatch.sh daily 30       > "$OUT/cw_daily.json"   # DAU series

# 3. Plausible traffic + usage (exits 3 if no token — the pipeline degrades
#    gracefully: the dashboard hides the traffic panels with a note). Optional
#    enrichment queries that fail are listed on stderr and in `_degraded`; the
#    dashboard names them rather than rendering a silently-empty panel.
node $SKILL/query_plausible.mjs both 30d > "$OUT/plausible.json" || echo "PLAUSIBLE SKIPPED"

# 3b. Google search terms (optional — exits 3 without credentials).
node $SKILL/query_search_console.mjs 30 > "$OUT/search_console.json" || echo "SEARCH CONSOLE SKIPPED"

# 4. Consolidate + reconcile registry<->CloudWatch, and render the dashboard HTML
#    from assets/dashboard-template.html. Writes $OUT/dashboard_data.json (the
#    figures for the terminal report) and $OUT/beanies-metrics.html (the artifact).
node $SKILL/build_dashboard.mjs "$OUT"
```

Then interpret `dashboard_data.json` for the terminal report and publish the
HTML. Don't dump raw JSON at greg — lead with what changed and what it means.
The filenames above are exact — `build_dashboard.mjs` expects `registry.json`,
`cw_activity.json`, `cw_activity7.json`, `cw_surface.json`, `cw_lastseen.json`,
`cw_daily.json`, and (optionally) `plausible.json` + `search_console.json` in `$OUT`.

### Cross-source reconciliation (do this — it's where the insight is)
- Registry `lastLoginAt` is date-only and login-only; CloudWatch `last-seen` fires on
  any activity. Where CloudWatch shows a family active but the registry looks stale,
  trust CloudWatch and say so. Note the active-family gap (e.g. "40 active in
  CloudWatch/30d vs 22 'engaged' by the registry's login field").
- Registry `familyId` and CloudWatch `family_id` share the pod-id space — you can name
  specific families as active/quiet by joining them.
- Plausible has no family id — keep it as site-wide traffic/usage, never per-family.

## Deliverable 1 — terminal report (markdown)

Structure it in this order. Be concrete with numbers and deltas; call out the
signal, not every field.

1. **Snapshot** — open with the **date range** (`dateRange.label`, e.g. "past 30
   days · 24 Jul – 23 Aug 2026"). Then real families (dev/test excluded, show
   excluded count), engaged %, active families (CloudWatch 30d & 7d), new this
   month / this week, growth direction.
   - **Daily active families (DAU):** `dau.avg` / `dau.peak` and the **DAU/MAU
     stickiness** (`dau.stickiness`%). Always label the unit as *families, not
     members*, and note it's a floor (offline use flushes telemetry later) and
     that raw DAU includes the founder's own pod(s).
2. **Growth** — new families by month and recent weeks; note acceleration/stall.
3. **Engagement & retention** — bucket table (active_7d / active_30d / dormant /
   churned / never); engaged vs non-engaged; **never-logged-in** count (activation
   gap); median days-active-before-quiet (time-to-quiet, with the date-only caveat).
4. **Conversion funnels** (`funnelAcq`, `funnelRet`) — two funnels:
   - **Acquisition** (Plausible: marketing site → hand-off → welcome gate → started
     creation → completed signup). Lead with `conversion.overallPct` — the
     **same-source** rate (Plausible signup goal ÷ Plausible marketing visitors).
     Report step conversion %. State that the marketing→app step is a *cross-site
     aggregate* (two Plausible sites, no shared visitor id), not per-visitor tracking.
     - ⚠️ **Never lead with `conversion.overallPctUpperBound`** (registry families ÷
       marketing visitors). Its numerator counts families created *anywhere* —
       direct, invited, native app — against a marketing-only denominator, so it
       mixes populations and inflates the rate. It is an upper bound, labelled as one.
     - If `conversion.gapIsMaterial` is true, **say so prominently**: the registry
       and the Plausible signup goal disagree, so every conversion rate carries that
       uncertainty until it's resolved (under-firing goal vs. non-marketing arrivals).
   - **Activation/retention** (registry+CloudWatch cohort of families created ≥28d
     ago: signed up → used beyond day 0 → active at 1 week → at 4 weeks). This is
     the actionable one — a true per-family cohort. Note it's a floor (activity older
     than CloudWatch's 90d window isn't observable) and N is small (call the noise).
5. **Who to nurture** — top engaged families (score, recency, beanpod size). Full
   emails/names OK here (terminal is local). **Who we lost** — families that were
   active and are now dormant/churned.
6. **Data volume** — median beanpod size, count of empty/tiny pods (signed-up-but-
   -barely-used).
7. **Geography / sync / newsletter** — country spread, google_drive vs local, opt-in %.
8. **Usage (CloudWatch)** — top subsystems by events/families, app-open counts.
9. **Traffic & acquisition (Plausible marketing)** — visitors, top sources,
   **channels resolved to named sources** (`channelBreakdown` — say "Organic Social,
   led by Reddit", never just the bucket), referrers, UTM campaigns, top pages.
   (Skip w/ note if no token.)
   - **Direct** (`direct`) is usually the biggest bucket and is not a dead end: split
     it by entry page. Landing on `/` = typed/bookmarked/brand-aware; landing deep =
     **dark social** (a link shared in WhatsApp/Discord/iMessage/email, which strips
     the referrer). Report `sessionsPerVisitor` as the repeat-visit proxy — Plausible
     exposes no new-vs-returning dimension (verified: the query degrades).
   - **Google search terms** (`searchTerms`) come from Search Console only. Rank by
     clicks; call `opportunities` (high impressions, CTR <2%, position ≤20) the
     cheapest SEO win. Never call any term "converting" without saying it is
     **inferred via the landing page** — GSC has no conversion signal.
10. **App usage (Plausible app)** — goals/conversions (signups, logins,
    member_joined, discord clicks…), feature_used breakdown, login-method mix.
11. **Founder callouts** — 3–5 bullets: the one number that moved most, the biggest
    risk (e.g. activation gap), the best acquisition channel, one concrete action.

## Deliverable 2 — HTML dashboard artifact (ONE standing URL, updated in place)

greg's decision (2026-08-23): the dashboard is a **standing private Artifact**, not
a fresh one each run. `build_dashboard.mjs` already produced `beanies-metrics.html`
from the committed template (`assets/dashboard-template.html`) — you do **not**
re-author the HTML. Just publish it to the **canonical URL** so the same bookmark
refreshes in place:

```
CANONICAL_ARTIFACT_URL = https://claude.ai/code/artifact/f68410b5-879d-40c1-ba58-c0564e190788
```

Publish with the Artifact tool: `file_path` = `$OUT/beanies-metrics.html`,
`url` = the canonical URL above, `favicon` = 📊, `title` = "beanies metrics".
Passing `url` is what keeps the link stable — omitting it spawns a NEW artifact
(don't). If greg ever says he lost the link, recover it via Artifact `action:"list"`
rather than creating another. If the canonical artifact was deleted and publishing
to `url` fails, publish fresh, then **update this file** with the new URL.

- The template is already brand-correct (Heritage Orange / Deep Slate / Sky Silk /
  Cloud White, Outfit + Inter, squircle cards, theme-aware, inline CSS charts, CSP-safe)
  and **data-driven** — every number, the callouts, and the source list recompute from
  the embedded data, and the traffic panels self-hide when Plausible is absent. So you
  normally don't touch the HTML. Only load `beanies-theme` / `artifact-design` /
  `dataviz` if you're changing the template's **design or which panels it shows**.
- **Privacy:** the template only ever shows masked owners + family name + country —
  `build_dashboard.mjs` never puts raw emails in the HTML. Keep it that way; full
  emails belong only in the terminal report.
- Hand greg the (unchanged) URL alongside the terminal summary.

### Future automation
A scheduled/unattended refresh would need to run this pipeline and re-publish to the
canonical URL without Claude-in-the-loop — which the Artifact API doesn't do from cron
today. If greg wants true automation, that's the trigger to revisit the "on-site authed
dashboard" option (its own `/beanies-plan`, with a threat model), not to bolt it on here.

## Guardrails
- **Read-only.** Never write to DynamoDB, never mutate logs, never touch `.beanpod`
  files. The scripts here only scan/query.
- **State the honest gaps** every run: members-per-family is not available; registry
  `lastLoginAt` is coarse (CloudWatch corrects it); `beanpodSizeKb` is approximate;
  Plausible can't be joined per-family. Don't invent members-per-family numbers.
- **Never** print or commit the Plausible token, AWS credentials, or beanpod contents.
- Save raw JSON to the scratchpad, not the repo.
- If AWS creds fail (registry/CloudWatch error), say so plainly and report whatever
  sources did succeed rather than aborting the whole run.
