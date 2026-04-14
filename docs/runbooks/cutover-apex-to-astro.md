# Runbook: apex cutover — Vue SPA → Astro marketing + Vue PWA at app.beanies.family

> **Status**: draft (awaiting Phase B staging verification)
> **Issue**: #167
> **Plan**: `docs/plans/2026-04-14-seo-aio-optimization.md`
> **Author**: greg

This runbook covers the human-driven steps for moving beanies.family to:

- **`beanies.family` + `www.beanies.family`** → Astro static marketing site (SEO/AIO-optimized)
- **`app.beanies.family`** → Vue PWA (unchanged functionally; origin-moved)

Phase A (Terraform for the new subdomains + staging distribution) is already merged. This runbook covers **Phase B (staging verification)** and **Phase C (production cutover)**.

---

## Prerequisites

- [ ] Phase A Terraform applied successfully (`terraform -chdir=infrastructure apply`)
- [ ] You have `gh` CLI authenticated
- [ ] You have AWS CLI authenticated with the deploy role
- [ ] You have access to the Google Cloud Console project that owns the OAuth client
- [ ] You have GSC and Bing Webmaster Tools access for `beanies.family`
- [ ] You have the current `CLOUDFRONT_DISTRIBUTION_ID` and `S3_BUCKET` GitHub secrets (existing Vue deploy — see §C.2 note on migrating these to variables)

## GitHub Actions **variables** required (add before Phase B)

These are **repository variables**, not secrets. Bucket names and CloudFront distribution IDs are not sensitive (visible in the AWS console to anyone with account access); storing them as variables means you can view and edit them from the GitHub UI without rotation.

| Variable                         | Value                                                | Used by          |
| -------------------------------- | ---------------------------------------------------- | ---------------- |
| `WEB_S3_BUCKET`                  | Output `web_s3_bucket_name` from `terraform output`  | `deploy-web.yml` |
| `WEB_CLOUDFRONT_DISTRIBUTION_ID` | Output `web_distribution_id` from `terraform output` | `deploy-web.yml` |

Add via GitHub UI: **Settings → Secrets and variables → Actions → Variables tab → New repository variable**. Or via `gh`:

```bash
gh variable set WEB_S3_BUCKET --body "$(cd infrastructure && terraform output -raw web_s3_bucket_name)"
gh variable set WEB_CLOUDFRONT_DISTRIBUTION_ID --body "$(cd infrastructure && terraform output -raw web_distribution_id)"
```

Existing `CLOUDFRONT_DISTRIBUTION_ID` and `S3_BUCKET` for the Vue deploy are currently stored as **secrets** (legacy). They should be migrated to variables at some point, but that's outside this cutover's scope.

---

## Phase B — staging verification

### B.1 Apply Phase A Terraform

```bash
cd infrastructure
terraform plan -out=phase-a.plan   # review carefully before applying
terraform apply phase-a.plan
```

Expected new resources (none of the existing apex infra is touched):

- ACM cert for `app.beanies.family` (us-east-1)
- ACM cert for `staging.beanies.family` (us-east-1)
- S3 bucket `beanies.family-web-prod`
- CloudFront distribution for `app.beanies.family` (origin = existing Vue S3 bucket)
- CloudFront distribution for `staging.beanies.family` (origin = new web bucket)
- Response-headers policy adding `X-Robots-Tag: noindex` to all staging responses
- Route53 A + AAAA for `app.beanies.family` and `staging.beanies.family`
- Updated bucket policy on the Vue S3 bucket to grant OAC read to the new `app.` distribution

### B.2 Deploy Astro to staging

```bash
gh workflow run deploy-web.yml -f target=staging
```

Expected URL: `https://staging.beanies.family` — served with `X-Robots-Tag: noindex` so it won't be indexed.

### B.3 Staging QA checklist

Walk every route and verify no regressions:

- [ ] `curl -I https://staging.beanies.family/` returns 200 + `x-robots-tag: noindex`
- [ ] `curl https://staging.beanies.family/ | grep -c 'application/ld+json'` ≥ 1
- [ ] Sitemap resolves: `https://staging.beanies.family/sitemap-index.xml`
- [ ] robots.txt resolves and lists AI crawlers
- [ ] `llms.txt` and `llms-full.txt` resolve
- [ ] RSS feed validates at the W3C Feed Validation Service
- [ ] All 3 blog posts render with body content, byline, breadcrumbs, OG image
- [ ] All 24 help articles render; help search works on `/help`
- [ ] `/privacy` and `/terms` render with correct content
- [ ] `/about/greg` renders with Person JSON-LD
- [ ] Lighthouse mobile Performance ≥ 95 on homepage, a blog post, a help article
- [ ] Axe-core: zero critical violations on the three templates above
- [ ] Crawler simulation: `curl -A "GPTBot" https://staging.beanies.family/blog/welcome-to-the-beanstalk` returns full HTML with `BlogPosting` JSON-LD (no JS required)

### B.4 Verify app.beanies.family

- [ ] `https://app.beanies.family` resolves and serves the Vue PWA (content identical to apex during Phase A)
- [ ] All authenticated routes load (`/dashboard`, `/accounts`, etc.)
- [ ] Google OAuth flow works on `app.beanies.family` — this requires adding the redirect URI first, see §C.1

Do NOT advance to Phase C until every B item is checked.

---

## Phase C — production cutover

This is the one-way door. Plan a **low-traffic window** (suggested: weekend morning in your timezone) and have a second person available if possible.

### C.1 Add `app.beanies.family` to Google OAuth (15 min before cutover)

1. Open Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client for beanies.family.
2. Under "Authorized redirect URIs", **add** (do not remove anything):
   - `https://app.beanies.family/oauth/callback`
   - Any other redirect URI pattern currently registered for `https://beanies.family` — mirror it to `app.beanies.family`
3. Under "Authorized JavaScript origins", **add**:
   - `https://app.beanies.family`
4. Save. Propagation is typically < 5 minutes but can take longer; wait 15 min before proceeding.

**Rollback note**: the old apex URIs stay registered for 30 days as a safety net.

### C.2 Update the Vue deploy config for the apex swap

Before running Terraform, update the existing Vue deploy config so it next targets the **`app.` distribution** instead of the apex one:

| Config item                  | Storage         | Old value               | New value                                 |
| ---------------------------- | --------------- | ----------------------- | ----------------------------------------- |
| `CLOUDFRONT_DISTRIBUTION_ID` | secret (legacy) | apex (Vue) distribution | output of `app_subdomain_distribution_id` |
| `S3_BUCKET`                  | secret (legacy) | unchanged — same bucket | (no change; Vue bucket is reused)         |

Only the distribution ID changes; the S3 bucket stays the same.

> Sidebar: these are stored as secrets for historical reasons but should really be variables (see §"GitHub Actions variables required" above). Migrating them is a nice cleanup to do alongside this cutover — just delete each secret and re-add as a variable in the GitHub UI, then update `deploy.yml` to use `${{ vars.* }}` instead of `${{ secrets.* }}`.

### C.3 Verify Vue app is configured for the new origin

The Vue app ships with these values that need to match the new origin before deploy:

- `apps/app/public/manifest.webmanifest` `start_url` — should still be `/` (origin-relative ⇒ auto-points at `app.beanies.family`)
- `apps/app/index.html` Plausible `data-domain` — add the `app.beanies.family` domain in Plausible settings first, then leave the script as-is (Plausible accepts either apex or subdomain based on how the property is set up)
- Any hardcoded `https://beanies.family` links inside the Vue app — audit with:
  ```bash
  grep -rn 'beanies.family' src/ --include='*.{ts,vue}' | grep -v '\.test\.'
  ```
  Anything that points to marketing (blog/help/privacy/terms) should stay as `beanies.family`. Anything that points to the app itself should be origin-relative or `app.beanies.family`.

### C.4 Deploy the Vue app to the `app.` distribution

```bash
# Dispatch the existing deploy workflow. It now targets app.beanies.family
# because we swapped the secret in C.2.
gh workflow run deploy.yml
```

Wait for success. Verify `https://app.beanies.family` still works.

### C.5 Terraform cutover — swap apex origin to Astro, attach 301 function

The cutover commit (separate from Phase A) will contain these changes:

1. `modules/frontend/main.tf`:
   - Change origin to the Astro bucket (`module.web.s3_bucket_name` via a new `origin_bucket_regional_domain_name` variable on the frontend module)
   - **Remove** the two `custom_error_response` blocks (Astro emits real 404s)
   - **Attach** the `apex-redirects.js` CloudFront Function (currently at `modules/web/functions/apex-redirects.js`) to the default cache behavior as a `viewer-request` association
2. `modules/web/main.tf`:
   - Swap `aliases` from `[staging.<apex>]` to `[<apex>, www.<apex>]` — wait, actually we keep the apex distribution on apex. The `web` module keeps serving `staging.` during Phase C as a rollback safety net; we can decommission it 2 weeks after cutover. See §C.8.
   - Actually no — the apex distribution serves Astro content by pointing its origin at the web bucket. The web distribution (at staging.) is redundant from a URL perspective but still serves as a preview environment. Keep it as staging permanently.
3. `modules/frontend/main.tf` cert SAN: if the current cert needs re-issuing with an updated SAN list (e.g. to remove `www` redirect handling that moves to the CF function), do it here. Most likely the existing cert covering apex + www is fine — no change needed.

**Order of operations**:

```bash
cd infrastructure
terraform plan -out=phase-c.plan
# REVIEW CAREFULLY. Expected changes:
#   ~ module.frontend.aws_cloudfront_distribution.frontend — origin change,
#     custom_error_response removals, function_associations added
#   + module.frontend.aws_cloudfront_function.apex_redirects — new
#   ~ module.frontend.aws_s3_bucket_policy.frontend — add Astro bucket? No:
#     the apex distribution now reads from the Astro bucket, which has its
#     own bucket policy. The Vue bucket policy drops the apex distribution
#     ARN from its additional list (no longer needed).

terraform apply phase-c.plan
```

CloudFront deploys take 5-15 minutes. Watch for "Deployed" status in the AWS console.

### C.6 Deploy Astro to apex

Once Terraform apply completes and the distribution is Deployed:

```bash
# The existing deploy-web workflow now writes to the web bucket, which
# the apex distribution now reads from. No workflow change needed.
gh workflow run deploy-web.yml -f target=production
# Wait for the IndexNow ping step — that announces the new URLs to Bing.
```

Invalidation is automatic in the workflow.

### C.7 Verify cutover

Run in quick succession:

- [ ] `curl -sI https://beanies.family/ | head -5` returns 200 + Astro-style HTML
- [ ] `curl -sI https://beanies.family/dashboard` returns 301 + `location: https://app.beanies.family/dashboard`
- [ ] `curl -sI https://beanies.family/beanstalk/welcome-to-the-beanstalk` returns 301 + `location: https://beanies.family/blog/welcome-to-the-beanstalk`
- [ ] `curl -s https://beanies.family/ | grep -o 'application/ld+json'` ≥ 1
- [ ] `curl -s -A "GPTBot" https://beanies.family/blog/welcome-to-the-beanstalk` returns full HTML with BlogPosting JSON-LD
- [ ] Sign in on `https://app.beanies.family` — OAuth round-trip works
- [ ] Open the PWA you have installed at apex — it should either (a) show the self-unregistering SW clean up and redirect, or (b) start working in degraded mode while the SW reloads
- [ ] Submit the apex sitemap in Google Search Console (`https://beanies.family/sitemap-index.xml`)
- [ ] Submit the apex sitemap in Bing Webmaster Tools
- [ ] Verify `app.beanies.family` as a separate property in both consoles (so you can monitor any accidental indexing)

### C.8 Cleanup (2 weeks after cutover, assuming no regressions)

- [ ] Remove the `staging.beanies.family` distribution from Terraform (or keep as a dev preview)
- [ ] Remove the redundant apex/www URIs from Google OAuth (the ones that point at `https://beanies.family/oauth/callback`)
- [ ] Delete the now-unused Vue marketing pages from the Vue app's router (`HomePage.vue`, `BeanstalkBlogPage.vue`, `BeanstalkPostPage.vue`, `HelpCenterPage.vue`, `HelpCategoryPage.vue`, `HelpArticlePage.vue`, `PrivacyPolicyPage.vue`, `TermsOfServicePage.vue`) plus the unused `useBlog.ts` / `useHelpSearch.ts` composables
- [ ] Remove the smoke `sw.js` cleanup script from Astro's `public/` once CloudFront logs show no more hits

---

## Rollback

### From Phase A

Non-destructive to existing infra; to fully undo:

```bash
terraform plan -destroy -target=module.app_subdomain -target=module.web
# review then:
terraform apply -destroy -target=module.app_subdomain -target=module.web
```

### From Phase C (most critical)

If anything is wrong after C.5:

1. `git revert` the cutover commit
2. `cd infrastructure && terraform apply` — reverts apex distribution to Vue-serving state
3. Invalidate apex: `aws cloudfront create-invalidation --distribution-id $VUE_DIST_ID --paths "/*"`
4. The `app.beanies.family` distribution stays live — users migrated there continue working

Timings:

- CloudFront revert deploy: 5-15 min
- DNS propagation: edge caches clear within 60s thanks to our short lastmod; browser caches up to 24h (but SW cleanup navigates them back)

### If only OAuth breaks

Both redirect URIs stay registered for 30 days post-cutover. If the new `app.` URI fails for some reason, apex requests would 301 to app (broken), so this rollback requires the full Phase C revert above. The 30-day window exists so apex OAuth keeps working through any CloudFront propagation edge cases.

---

## Observability during + after cutover

- Plausible: watch realtime for traffic drop-off (should see apex and `app.` as two properties after cutover)
- GSC + Bing: submit sitemap, check coverage reports in 7 and 14 days
- CloudFront logs: `aws logs tail ... --follow` on both distributions for 30 min post-cutover
- AI crawler hits: grep CloudFront logs for GPTBot, ClaudeBot, PerplexityBot, CCBot user agents in the first week — all should be 200s
- Monitor Otterly.ai tracked prompts weekly for citation emergence

---

## Known sharp edges

1. **The web distribution's staging alias must be removed before the apex distribution can reuse the apex alias.** If we reuse the same distribution for staging→apex, that's a Terraform alias swap. In our design, apex stays on the existing frontend distribution and we just swap its S3 origin — no alias contention, which is why this design was chosen.
2. **CloudFront Functions have a 1 KB URL size limit on redirect `Location` values.** All our 301 targets are well under this (max is a help article URL ~80 chars).
3. **PWA service worker update cadence**: Chrome checks for SW updates once per navigation up to every 24h. After cutover, some users may see stale content from their cached SW until it updates. The self-unregistering `sw.js` accelerates this — typically within one page navigation.
4. **Trailing slash behavior**: the Astro site uses `trailingSlash: 'never'`. The 301 function preserves the exact URI, so `/dashboard/` (with trailing slash) → `https://app.beanies.family/dashboard/` (with trailing slash). The Vue app's router handles both.
5. **IndexNow response is fire-and-forget** — the workflow step catches failures so deploys aren't blocked by IndexNow outages. It's an enhancement, not a requirement.
