# ADR-027: Diagnostic logging & telemetry (Option A — self-hosted AWS CloudWatch Logs)

> Date: 2026-05-20
> Status: Accepted
> Plan: `docs/plans/2026-05-20-diagnostic-logging-telemetry-aws.md`

## Context

Until now beanies had exactly one telemetry path: `src/utils/errorReporter.ts` →
Slack webhook, fired only for `severity: 'error' | 'warning'` (toasts, Vue
render errors, unhandled rejections). It is well-built (strict allowlist,
two-layer dedup, fire-and-forget) but has two gaps:

1. **The non-critical stream is lost.** ~400 `console.warn/error` sites carry
   rich diagnostic context (the silent-refresh attempt blob, Drive read
   failures, malformed-data skips, IDB transients) that dies in the user's
   console where we never see it. The 2026-05-19 "Google session expired"
   morning cascade is the canonical example — the code captured per-attempt
   classification but we could only guess at patterns.
2. **The sink is not browseable or searchable.** Slack is ephemeral and
   unstructured — you can't ask "every silent-refresh failure for family X over
   the last 7 days, grouped by classification."

We evaluated managed SaaS (Sentry, Axiom) vs. self-hosting. **Self-hosting on
our own AWS won** because it is the only option fully consistent with the
"privacy-first / no data on servers" brand promise — the data stays in our
account, we control retention and deletion, no third-party processor — and
because Claude can query it directly via the authenticated AWS CLI (verified:
`aws logs` works as IAM user `greg`, region `ap-southeast-1`), turning triage
into a one-turn chat operation instead of asking users to reproduce or
copy/pasting console output.

## Decision

A new client diagnostic tier (`logEvent`) ships the full `debug|info|warn|error`
stream, enriched + redacted through a shared core, to a new AWS ingest endpoint
that writes structured JSON to CloudWatch Logs with **90-day retention**.

### Client

- **Shared core** — `src/utils/diagnosticContext.ts` owns the privacy
  allowlist (`ALLOWED_CONTEXT_KEYS`), `redactContext`, `normalizeMessage`,
  `extractStack`, and `enrichAndRedact(input, { includeEmail })`. Both
  `errorReporter` (Slack) and `logEvent` (firehose) use it — one enrichment
  implementation, two callers. Dependency direction is one-way (no cycle).
- **`logEvent`** (`src/services/telemetry/logEvent.ts`) — fire-and-forget,
  re-entry-guarded, never throws. Enriches with `includeEmail: false`. A
  `normalizeMessage`-keyed rate cap (50 / surface-message / 60s) is the only
  volume guard (per-level sampling is deferred — see below).
- **`logQueue`** (`src/services/telemetry/logQueue.ts`) — bounded in-memory
  buffer (500, drop-oldest + counted warn), flushes on interval (10s) /
  batch threshold (25) / `online` / page-hide. Listeners register on first
  enqueue (idempotent `isListening` guard); the queue never calls
  `enrichAndRedact` at import time.
  - **Retry classification:** `5xx`/network/timeout → keep batch, retry on next
    trigger; `4xx` (401 bad key, 400 malformed) → terminal drop + warn (never
    retry-loop a request the server will always reject).
  - **Transport split (CORS reality):** interval/online flush uses `fetch`
    (`keepalive`) + the `x-api-key` header (preflight handled by the shared
    API's CORS config); true unload (`pagehide`, non-bfcache) uses
    `navigator.sendBeacon` with a `text/plain` Blob (a CORS-safelisted type → no
    preflight, which beacons can't do) and the key in a `?k=` query param
    (beacons can't set headers). A `false` beacon return is an accepted,
    logged, terminal loss.
- **Unification** — `reportError` emits one `logEvent('error'|'warn')` per
  invocation (under `logEvent`'s own guard, belt-and-suspenders wrapped so a
  telemetry fault can never break the Slack send). So every Slack-worthy error
  is also queryable historically, and the bulk of existing `reportError` call
  sites are captured for free.

### Server (`infrastructure/lambda/telemetry/index.mjs`)

- Node 20 ESM. `POST /logs` on the **existing shared HTTP API** (created in the
  `registry` module). Validates caps (≤100 events, ≤2KB/event, ≤256KB body),
  hard `x-api-key` 401 (header or `?k=`), 400 on malformed (never 500).
- **Re-enforces the allowlist** server-side as defense-in-depth, deliberately
  **excluding `family_email`** — the firehose is PII-free by contract; email
  lives only on the low-volume Slack path. Correlation uses `family_id`
  (a random UUID, non-PII); map to email server-side via the registry only when
  outreach is needed.
- Writes each event as `console.log(JSON.stringify({ t: 'beanlog', v: 1, ... }))`.

### Storage (Terraform `infrastructure/modules/telemetry/`)

- The sink **is the telemetry Lambda's own CloudWatch log group**, declared
  explicitly with `retention_in_days = 90` (overriding the 13-day Lambda
  default) and `depends_on` so AWS doesn't auto-create it with the default
  first. No `PutLogEvents`, no stream management, no IAM beyond
  `AWSLambdaBasicExecutionRole`.
- Per-route throttle (`POST /logs`: burst 20, rate 10/s) on the registry-owned
  `$default` stage. Ingest URL output as a fully-qualified `https://…/logs`.

### Env plumbing

- `telemetry_ingest_url` (TF output) → GitHub repo **VARIABLE**
  `BEANIES_LOG_INGEST_URL` → `VITE_BEANIES_LOG_INGEST_URL`. The soft key is a
  GitHub **SECRET** `BEANIES_LOG_INGEST_API_KEY` → `VITE_BEANIES_LOG_INGEST_API_KEY`
  (mirrors `registryService`'s `x-api-key`). Wired in **both** prod build paths:
  `deploy.yml` and `translation-sync.yml`. If unset, `logEvent` no-ops with one
  warn (never a fake success).

## Invariants (load-bearing — do not break)

- **Every telemetry line is valid JSON with `t` as the first key.** The
  Lambda's OWN errors use the `[telemetry-lambda]` text prefix (no leading `{`)
  so the `t = "beanlog"` filter unambiguously separates data from operational
  logs. The future alerting metric-filter pattern is `{ $.t = "beanlog" }`.
- **`t` and `v` are stamped server-side**, never trusted from the client
  (client-sent `t`/`v` are dropped by the allowlist). Any breaking change to the
  event shape **bumps `v`**; Logs Insights queries filter `t = "beanlog"`
  (optionally `and v = 1`) so old queries don't silently mix shapes.
- **Allowlist sync is a pinned-test contract.** The Lambda's `ALLOWED_CONTEXT_KEYS`
  copy is pinned by `infrastructure/lambda/telemetry/__tests__/handler.test.mjs`;
  adding a context key on the client (`diagnosticContext.ts`) requires mirroring
  it in the Lambda or the test fails. Build-time codegen of the list is
  deferred future-work ("if drift becomes painful") — the test contract matches
  the project's existing convention and avoids Terraform-coupled codegen.

## Operational runbook

**Query (from a Claude session or locally):**

```bash
# All telemetry for a family, last 24h
aws logs start-query \
  --log-group-name /aws/lambda/beanies-family-telemetry-prod \
  --start-time $(date -d '24 hours ago' +%s) --end-time $(date +%s) \
  --query-string 'fields @timestamp, level, surface, message
    | filter t = "beanlog" and family_id = "<uuid>"
    | sort @timestamp desc | limit 200'
# then: aws logs get-query-results --query-id <id>
```

Canonical saved queries:

- **By surface:** `filter t="beanlog" and surface="silent-refresh" | stats count() by message`
- **Silent-refresh rollup:** `filter t="beanlog" and surface="silent-refresh" | stats count() by silent_refresh_consecutive_failures`
- **Error volume by build:** `filter t="beanlog" and level="error" | stats count() by build_sha`

**Alerting (v1):** NONE. Nothing alarms on telemetry-Lambda failures or on log
patterns yet — this is an accepted v1 risk. Slack alerting stays on the
existing client `reportError` webhook. The deferred path (below) supersedes it.

**Data deletion:** 90-day auto-expiry is the primary deletion lever. Logs
Insights cannot delete individual records; targeted per-`family_id` deletion is
not supported and would require log-stream-level surgery. Disclosed in the
`zero-knowledge-architecture` Help Center article (diagnostics are anonymous,
90-day, our own infra).

## Deferred future-work

- **Server-side alerting** that supersedes the in-browser webhook: a CloudWatch
  metric filter `{ $.t = "beanlog" && $.level = "error" }` → metric → Alarm →
  Slack (SNS or a small notifier Lambda). More robust than the client webhook
  (fires even if the client can't reach Slack; centralized thresholds).
- **Per-level sampling** (`debug`/`info`) if event-per-family volume rises — the
  client rate cap is the only volume guard today.
- **Build-time allowlist generation** from `diagnosticContext.ts` if the
  pinned-test sync becomes a maintenance tax.

## Consequences

- The non-critical diagnostic stream is now captured, redacted, and queryable
  for 90 days — root-cause triage from a chat session, no user reproduction.
- The firehose is PII-free (no email) and stays in our own AWS account; cost is
  ~$0 now and <$5/mo at 10k families (no third-party subscription).
- New, mild privacy surface (allowlisted, anonymous diagnostics leave the
  device) — disclosed in the security Help Center article.
- **Go-live is greg-gated and manual** (per repo deploy rules): `terraform
apply`, then create the `BEANIES_LOG_INGEST_URL` repo VARIABLE +
  `BEANIES_LOG_INGEST_API_KEY` secret from the TF output, then deploy. Until
  then `logEvent` no-ops harmlessly.
