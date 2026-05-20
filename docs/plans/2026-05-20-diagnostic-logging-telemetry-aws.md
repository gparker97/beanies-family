# Plan: Full diagnostic logging & telemetry (Option A — AWS CloudWatch Logs)

> Date: 2026-05-20
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-05-20-diagnostic-logging-telemetry-aws.md`
> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the Prompt Log below.

## User Story

As the operator of beanies.family (greg) — and as Claude assisting him — I want every useful diagnostic signal the app currently throws away to the browser console to instead be captured, enriched, redacted, and stored in a queryable AWS log store, so that I can review, search, diagnose, and fix site issues directly from a chat session (via the AWS CLI) instead of asking users to reproduce problems or copy/pasting console output.

## Context

Today beanies has exactly one telemetry path: `src/utils/errorReporter.ts` → `slackPost` → a Slack webhook, fired only for `severity: 'error' | 'warning'` (toasts, Vue render errors, unhandled rejections). It is well-built — strict field allowlist, two-layer dedup, fire-and-forget — but it has two gaps:

1. **Everything classified non-critical is lost.** ~401 `console.warn/error` call sites carry rich diagnostic context (the silent-refresh attempt blob, Drive read failures, malformed-data skips, IDB transients) that dies in the user's console where we never see it. The morning's Google-session-expired investigation is the canonical example: the code captured per-attempt classification but we could only guess at patterns.
2. **The sink is not browseable or searchable.** Slack is ephemeral and unstructured — you cannot ask "every silent-refresh failure for family X over the last 7 days, grouped by classification."

Decision (confirmed with greg): **Option A — store logs in our own AWS account** (CloudWatch Logs + Logs Insights), not a third-party SaaS. This is the only option fully consistent with the "privacy-first / no data on servers" brand promise: the data stays in our account, we control retention and deletion, and — critically — **Claude can query it directly via the authenticated AWS CLI** (verified this session: `aws sts get-caller-identity` works as IAM user `greg`, region `ap-southeast-1`, and `aws logs describe-log-groups` already returns our Lambda groups). Confirmed parameters: **CloudWatch Logs**, **90-day retention**, **alerting designed-for but deferred** (this ship keeps the client→Slack webhook as-is; the pipeline is shaped so a future server-side CloudWatch-metric-filter → Alarm → Slack layer can supersede the in-browser webhook without rework).

## Requirements

1. A new **client diagnostic-logging tier** — `logEvent({ level, surface, message, context?, error? })` — that captures `debug | info | warn | error` events, enriches them with standard context, redacts them through the existing allowlist, and ships them to an AWS ingest endpoint. It must never throw, never block render, and never break the app (same fire-and-forget contract as `reportError`).
2. A **batched, offline-aware client transport**: events buffer in memory, flush on a short interval / batch-size threshold / `online` / `pagehide` (via `navigator.sendBeacon`), and survive transient network failure by retrying on the next trigger. Bounded buffer with drop-oldest + a counted overflow warning (no unbounded growth).
3. A new **AWS ingest endpoint**: `POST /logs` added to the **existing shared HTTP API** (created in the `registry` Terraform module, domain `api.beanies.family`), backed by a new lightweight **telemetry Lambda** (Node 20, single `.mjs`, copying the registry/oauth pattern).
4. The Lambda writes each event as a **structured JSON line** to a **dedicated CloudWatch Logs group with 90-day retention**, with a discriminator field so Logs Insights can separate telemetry data from the Lambda's own operational logs.
5. **Server-side defense-in-depth**: the Lambda re-enforces the same field allowlist (a non-allowlisted key never reaches durable storage even if a future client bug sends it), caps batch size and per-event size, and rejects oversized/malformed payloads with a clear status.
6. **DRY core**: the context-enrichment logic currently private inside `errorReporter.buildContext` is extracted to a shared helper so both `reportError` and `logEvent` enrich identically. `redactContext`, `normalizeMessage`, and `tail` are reused as-is (already exported).
7. **Unify the two paths**: `reportError` additionally emits a `logEvent` (level `error`) so every Slack-worthy error is also queryable historically. The Slack path is unchanged.
8. **Privacy posture for the firehose**: the high-volume `logEvent` tier correlates by `family_id` (a random UUID, non-PII) only — `family_email` is **not** included in `logEvent` and remains exclusively in the low-volume critical `reportError`→Slack path. (We can map `family_id`→email server-side via the registry when a finding requires outreach.)
9. **Abuse/cost protection**: API Gateway route-level throttling on `POST /logs`, plus the Lambda's body/size caps. The Lambda checks `x-api-key` and returns **401 on mismatch** (matching the registry Lambda's hard check, `index.mjs:54-55` — there is no "soft" precedent; oauth has no key check at all). **The client queue MUST classify responses: `4xx` (incl. 401/403/400) = terminal, non-retryable drop + one `[telemetry]` warn (never loop on a bad key or malformed batch); `5xx`/network/timeout = retry on next trigger.**
10. **Env-var plumbing**: Terraform output → GitHub repository **VARIABLE** `BEANIES_LOG_INGEST_URL` (non-sensitive, per the vars-not-secrets lesson) → `deploy.yml` build env → `import.meta.env.VITE_BEANIES_LOG_INGEST_URL`. If unset, `logEvent` is a no-op + single `[telemetry]` warn (never a fake-success).
11. A new **ADR-027** documenting the design + an **observability section** in `docs/ARCHITECTURE.md`.
12. Tests matching existing conventions for: the client queue (Vitest, module-state reset), the shared enrichment helper, the redaction re-use, and the Lambda handler (Node native test runner).

## Important Notes & Caveats

- **Privacy tension is real and must be disclosed.** Even allowlisted (`family_id`, `route`, `browser`, `build_sha`), diagnostic telemetry _is_ data leaving the device to a server — a nuance against "no data on servers." Mitigations: (a) strict allowlist re-enforced server-side; (b) `family_id` is a random UUID, not PII; (c) email kept out of the firehose; (d) 90-day auto-expiry; (e) data stays in our own AWS account, never a third party. **The privacy/data-handling explainer must be updated to disclose diagnostic logging** (see Help Center Coverage). Note existing precedent: Plausible (cookieless analytics, `VITE_PLAUSIBLE_DOMAIN`) and the error→Slack webhook already send allowlisted data off-device.
- **Do NOT use `mode: 'no-cors'` for the ingest POST.** Unlike Slack, we own this endpoint and the shared API already has CORS configured for our origins — we want real status codes to drive retry. `sendBeacon` is used only for the `pagehide` final flush.
- **`pagehide`/`sendBeacon`/`keepalive` are new to this codebase** (the only existing unload hooks use `beforeunload` — `App.vue:1085`, `dataBridge.ts:86`). The telemetry queue owns its OWN lifecycle listener and must NOT piggyback on `App.vue`'s `beforeunload` handler (different lifecycle — App.vue unmounts).
- **The "dedicated log group" is the telemetry Lambda's own execution log group**, declared explicitly in Terraform with `retention_in_days = 90` (overriding the 13-day Lambda default) and created with `depends_on` before the function so AWS doesn't auto-create it with default retention. The Lambda emits telemetry via `console.log(JSON.stringify({ t: 'beanlog', ...event }))`; its own errors stay as plain text. Logs Insights queries filter on the `t = "beanlog"` discriminator. This avoids all `PutLogEvents`/sequence-token/stream-management code and needs no IAM beyond `AWSLambdaBasicExecutionRole`. **Load-bearing invariant (document in ADR-027 as a contract, not a caveat): every beanlog line MUST be valid JSON with `t` as the first key; the Lambda's own error path MUST use the `[telemetry-lambda]` text prefix (no leading `{`) so the discriminator stays unambiguous; the future alerting metric-filter pattern is `{ $.t = "beanlog" }`.**
- **Do not over-instrument in this ship.** Land the pipeline + the shared core + the `reportError` unification, then convert a _small, high-value_ set of currently-console-only call sites to `logEvent` (the silent-refresh / Drive / offline-queue cluster). Bulk migration of all ~401 sites is explicitly out of scope and follows incrementally.
- **One volume guard only, at current scale.** Client rate-limiting reuses `normalizeMessage` (`errorReporter.ts:237`, already exported) to cap identical events per flush window — the genuine runaway-loop guard. **Per-level sampling is NOT built in this ship** (it would never fire at ~45K events/mo); it is documented as future work in ADR-027 instead.

## Assumptions

> **Review before implementation.** Valid at planning time (2026-05-20).

1. The shared HTTP API created in `infrastructure/modules/registry/main.tf` is the correct place to add `POST /logs` (the `oauth` module already adds routes to it via `api_gateway_id`). Confirmed by exploration.
2. Region stays `ap-southeast-1`; CloudWatch Logs pricing there is ~$0.50–0.60/GB ingest, ~$0.03/GB-mo storage, ~$0.0057/GB scanned (Logs Insights). Cost is negligible at current scale (see Cost Estimate).
3. `family_id` (active family UUID from `useFamilyContextStore`) is a non-PII random identifier suitable as the durable correlation key.
4. `navigator.sendBeacon` is acceptable for the unload flush (supported across the app's target browsers; iOS WebKit supports it).
5. The prod build env var must be added to **both** prod build paths: `deploy.yml` AND `translation-sync.yml` (the latter is a real prod build+S3-sync deploy with a reduced env block — verified). Re-scan for any other `npm run build` prod workflow during implementation.
6. Next ADR number is **027** (last is `026-ios-redirect-oauth.md`).
7. Updating the privacy/data-handling explainer to disclose diagnostic logging is acceptable to greg (flagged for confirmation).

## Approach

### A. Shared enrichment core (DRY refactor) — `src/utils/diagnosticContext.ts` (new)

Extract the body of `errorReporter.buildContext` (the family/sync/browser/build enrichment, each store read independently try/caught) into an exported `enrichAndRedact(input): Record<string, unknown>` that returns allowlisted, redacted context. `errorReporter` is refactored to call it (behavior-preserving — same fields, same `redactContext`). `logEvent` calls the same helper. `redactContext`, `normalizeMessage`, `tail` remain in their current homes and are imported. Net effect: one enrichment implementation, two callers.

- Email handling parameterized: `enrichAndRedact(input, { includeEmail })` — `reportError` passes `true`, `logEvent` passes `false` (Requirement 8).
- **`reportError`→`logEvent` coupling (Requirement 7) is explicit and decoupled:** `reportError` emits one `logEvent('error', ...)` per invocation (the firehose is the complete record; flood is handled queue-side by the `normalizeMessage` cap, not by Slack's dedup). The `logEvent` call runs under `logEvent`'s OWN re-entry guard, independent of `reportError`'s `reentryGuard` (`errorReporter.ts:59`), so a telemetry fault can never re-enter and suppress a genuine Slack error.

### B. Client logging tier — `src/services/telemetry/` (new)

- `logEvent.ts`: public `logEvent({ level, surface, message, context?, error? })`. Re-entry guard (mirrors errorReporter). Enriches via `enrichAndRedact(..., { includeEmail: false })`, adds `level`, `surface`, `message`, ISO `timestamp`, trimmed stack. **Move `extractStack` (currently private in `errorReporter.ts:465`, used only at `:427`) into `diagnosticContext.ts` and export it; `errorReporter` imports it back — do not duplicate the 12-frame-slice logic. Move it verbatim (12-frame slice + null handling, no "while I'm here" tweaks); the Slack-payload snapshot test is the guard that the move is behavior-preserving.** Applies per-level sampling + `normalizeMessage` bucket cap. Hands the finished record to the queue. Wrapped in try/catch → `[telemetry] <reason>` `console.warn`; never throws.
- `logQueue.ts`: in-memory bounded buffer (cap e.g. 500, drop-oldest + counted `[telemetry] buffer overflow dropped N`). Flush triggers modeled on `offlineQueue.ts`: interval (~10s), batch threshold (~25), `window 'online'`, `document 'visibilitychange'→hidden` / `pagehide`. Periodic/online flush uses `fetch(url, { method:'POST', keepalive:true, headers:{'Content-Type':'application/json','x-api-key':KEY}, body })`; unload flush uses `navigator.sendBeacon(url, Blob)`. On `5xx`/network/timeout: keep the batch, retry next trigger (coalescing guard like offlineQueue's `flushInFlight`). On `4xx` (401/403 bad key, 400 malformed): drop the batch terminally + one `[telemetry]` warn — never retry-loop a request the server will always reject. **`sendBeacon` (~64KB browser cap) and `keepalive` fetch (Lambda body cap ~256KB) have different size ceilings — the unload flush must chunk to the beacon limit or cap the unload batch separately; a `sendBeacon` returning `false` is an accepted terminal loss (page is unloading, no retry possible) and is logged as such, not retried.** Reads `VITE_BEANIES_LOG_INGEST_URL`; if unset → no-op + one warn.
- `index.ts`: barrel export.

### C. Wire-in

- `src/main.ts`: initialize the queue (register listeners) at app boot near the existing error-handler wiring; ensure a final `pagehide` flush. The existing `window 'error'`/`unhandledrejection`/`vue-render` handlers already call `reportError` — which now also emits a `logEvent`, so they are captured with zero extra wiring. **Queue init must be idempotent — guard double listener registration with an `isListening` flag (mirror `offlineQueue.ts:40`). Listeners may register at module import, but the queue must NOT call `enrichAndRedact` (which touches Pinia) at import time — only on actual `logEvent` calls — and the first flush must tolerate Pinia/router not yet being ready (per-store reads are already independently try/caught in `enrichAndRedact`).**
- Convert the high-value cluster (silent-refresh in `googleAuth.ts`, Drive read/API errors in `googleDriveProvider.ts`, `offlineQueue` flush failures, `photoUploadQueue` flush) from console-only to `logEvent({ level:'warn'|'info', surface, message, context })`, reusing the `silentRefreshAlertContext` builder for the auth ones. **`photoUploadQueue.flushQueue()` currently only `console.warn`s per-entry flush failures (`:141`) with no `reportError` — a genuine silent-failure gap; this conversion is its fix and the highest-value closure in the cluster.**

### D. Telemetry Lambda — `infrastructure/lambda/telemetry/index.mjs` (new)

- Node 20 ESM `export const handler`. Parses `event.body` JSON `{ events: [...] }`. Validates: array, length ≤ `MAX_EVENTS` (100), each event size ≤ `MAX_EVENT_BYTES` (~2KB), total body ≤ ~256KB. Re-enforces the allowlist (ported `ALLOWED_CONTEXT_KEYS` constant). **The client allowlist churns (3 dated additions in 2026-05 alone), so drift is the real hazard. Primary sync mechanism = a pinned unit-test contract, matching the project's established convention (`errorReporter.ts:78-79` already enforces the client allowlist purely by test, with zero build-time codegen): the Lambda handler test asserts the exact expected key set and fails if the client adds a key the Lambda hasn't mirrored, and a comment beside the client `ALLOWED_CONTEXT_KEYS` (`errorReporter.ts:85`) points at the Lambda copy. Without this the server silently lags and drops new fields — a silent data-loss gap. Build-time generation from `diagnosticContext.ts` is explicitly DEFERRED to ADR-027 future-work ("if drift becomes painful") — it would add Terraform-coupled codegen and a new `apply`-time failure mode, contradicting the simpler test-contract precedent.** For each valid event: `console.log(JSON.stringify({ t: 'beanlog', v: 1, ...event }))` — the Lambda stamps the schema version `v` server-side (never trusted from the client) so old Logs Insights queries don't silently mix shapes as the event schema evolves over 90-day windows; any breaking field change bumps `v` (policy documented in ADR-027). Returns `204` (or `200 {ok,count,dropped}`) with CORS headers (copy registry pattern). Hard `x-api-key` check → `401` on mismatch (matches registry `index.mjs:54-55`). Malformed → `400` with a clear message; never 500 on bad input. Its own failures → `console.error('[telemetry-lambda] ...')` (lands in the same group, plain text, excluded by the `t` filter).
- `__tests__/handler.test.mjs`: Node native test runner, dynamic import with cache-bust, `makeEvent()` helper — matching the oauth Lambda test.

### E. Terraform — `infrastructure/modules/telemetry/` (new: main.tf, variables.tf, outputs.tf)

- `aws_cloudwatch_log_group.telemetry` — name `/aws/lambda/${app}-telemetry-${env}`, `retention_in_days = 90`.
- `aws_iam_role` + `AWSLambdaBasicExecutionRole` attachment (no extra policy needed — Lambda writes only to its own group).
- `data.archive_file` + `aws_lambda_function` (`nodejs20.x`, `index.handler`, timeout 10, memory 128, `depends_on = [aws_cloudwatch_log_group.telemetry]`, env: `LOG_INGEST_API_KEY`, `CORS_ORIGINS`).
- `aws_apigatewayv2_integration` (AWS_PROXY) + `aws_apigatewayv2_route` `POST /logs` on the passed-in `api_gateway_id` + `aws_lambda_permission` (source `${api_gateway_execution_arn}/*/*`). **CORS needs no change — `POST` is already in the shared API's `allow_methods` and `x-api-key` in `allow_headers` (`registry/main.tf:137-138`); do not edit the registry CORS block.** **Throttling decision (concrete, not deferred): add a targeted `route_settings` block for the `"POST /logs"` route_key to the registry-owned `aws_apigatewayv2_stage.default` (`registry/main.tf:148`) with explicit `throttling_burst_limit`/`throttling_rate_limit` (e.g. burst 20, rate 10/s — telemetry is bursty-but-low). This is a documented cross-module edit; prefer it over stage-level `default_route_settings`, which would change registry/oauth behavior too.**
- `outputs.tf`: `telemetry_log_group_name`, `telemetry_lambda_name`, `telemetry_ingest_url = "https://${module.registry.api_domain_name}/logs"`. **Must be a fully-qualified `https://` URL — `api_domain_name` is a bare scheme-less hostname (`api.beanies.family`); `registryService.ts` gets its scheme from the separate `VITE_REGISTRY_API_URL` secret, so do NOT hand the bare hostname to the client or `fetch`/`sendBeacon` will resolve it as a relative URL against the app origin and fail.**
- `infrastructure/main.tf`: add `module "telemetry"` passing `app_name`, `environment`, `api_gateway_id`, `api_gateway_execution_arn`, `log_ingest_api_key`. **`cors_origins` is defaulted inside the telemetry module's own `variables.tf` (copy the registry/oauth 4-origin default) — there is no root `cors_origins` pass-through to existing modules, so don't add one.** `infrastructure/outputs.tf`: surface `telemetry_ingest_url`. Root `variables.tf`: add `log_ingest_api_key` (sensitive).

### F. Env-var plumbing

- `.github/workflows/deploy.yml`: add `VITE_BEANIES_LOG_INGEST_URL: ${{ vars.BEANIES_LOG_INGEST_URL }}` (+ the `VITE_BEANIES_LOG_INGEST_API_KEY` secret) to the `npm run build` `env:` block (next to `VITE_BEANIES_ERROR_WEBHOOK_URL`).
- **`.github/workflows/translation-sync.yml` is a SECOND prod-build-and-deploy path (job "Deploy to PROD" runs `npm run build` then `aws s3 sync … --delete`) with a deliberately REDUCED build-env subset — it already omits `VITE_BEANIES_ERROR_WEBHOOK_URL`/`VITE_PLAUSIBLE_DOMAIN`/`VITE_BUILD_SHA`.** Decision required and stated, not assumed: add the same telemetry env vars to its build step so a translation-triggered deploy doesn't intermittently ship a telemetry-disabled build. (The `logEvent`-no-ops-with-one-warn contract makes a miss non-fatal, but the env must be consistent across both prod build paths.)
- `.env.example`: add `VITE_BEANIES_LOG_INGEST_URL=` placeholder + comment.
- Post-`terraform apply`: create the GitHub repo VARIABLE `BEANIES_LOG_INGEST_URL` from the TF output (manual one-time, documented in the ADR/runbook). **Follow the established registry precedent (verified): the ingest URL is a repo VARIABLE; the soft `x-api-key` is a repo SECRET `BEANIES_LOG_INGEST_API_KEY` consumed client-side as `VITE_BEANIES_LOG_INGEST_API_KEY`, exactly as `registryService.ts` consumes `VITE_REGISTRY_API_KEY` (`deploy.yml:143`). The Lambda env `LOG_INGEST_API_KEY` reads the same TF `sensitive` variable. No plaintext key literal anywhere in the repo.** This is decided by precedent, not an open choice.

### G. Docs

- `docs/adr/027-diagnostic-logging-telemetry.md` — the design, the privacy posture, the deferred-alerting migration path, the schema-version (`v`) policy, and the single-group JSON invariant.
- `docs/ARCHITECTURE.md` — new "Observability & diagnostics" subsection.
- **Operational runbook (in ADR-027 or the ARCHITECTURE subsection):** 2-3 canonical saved Logs Insights queries (by `family_id`; by `surface`; silent-refresh classification rollup); an explicit statement that NOTHING alarms on telemetry-Lambda failures in v1 (accepted risk — alerting is deferred); and the data-deletion procedure for a family's logs (90-day auto-expiry is the primary deletion lever; targeted per-`family_id` deletion isn't supported by Logs Insights and would require log-stream-level action — note the limitation against the privacy promise).

## Files Affected

**New (client):** `src/utils/diagnosticContext.ts`, `src/services/telemetry/logEvent.ts`, `src/services/telemetry/logQueue.ts`, `src/services/telemetry/index.ts` (+ `__tests__/`).
**Modified (client):** `src/utils/errorReporter.ts` (use shared core + emit logEvent), `src/main.ts` (queue init + pagehide flush), `src/services/google/googleAuth.ts`, `src/services/sync/providers/googleDriveProvider.ts` (verify path during implementation — confirm the provider's actual location vs. the `./storageProvider` import `offlineQueue` uses), `src/services/sync/offlineQueue.ts`, `src/services/sync/photoUploadQueue.ts` (high-value call-site conversions).
**New (infra):** `infrastructure/lambda/telemetry/index.mjs` (+ `__tests__/handler.test.mjs`), `infrastructure/modules/telemetry/{main,variables,outputs}.tf`.
**Modified (infra/CI):** `infrastructure/main.tf`, `infrastructure/outputs.tf`, `infrastructure/variables.tf`, `infrastructure/modules/registry/main.tf` (per-route `route_settings` throttle for `POST /logs`), `.github/workflows/deploy.yml`, `.github/workflows/translation-sync.yml`, `.env.example`.
**Docs:** `docs/adr/027-diagnostic-logging-telemetry.md` (new), `docs/ARCHITECTURE.md`, `CHANGELOG.md`, `docs/STATUS.md`.

## Help Center Coverage

- **Action**: `update existing` (privacy / data-handling explainer) — confirm exact slug during implementation (likely under `security` or `how-it-works`).
- **Category**: `how-it-works` / `security`
- **Scope**: Add a short, plain-language disclosure that beanies collects **anonymous diagnostic logs** (no names, balances, transactions, or family content — only a random family identifier, the screen you were on, browser/version, and error details) to our own servers for 90 days to keep the app working smoothly, and that this is separate from your encrypted family data which never leaves your control.
- **Notes**: Must reinforce the boundary — diagnostic logs ≠ family data; no financial content; auto-deleted after 90 days; stored in our own infrastructure, not a third party. Land in the same change.

## Acceptance Criteria

- [ ] `logEvent(...)` enriches + redacts + buffers + flushes to the endpoint; never throws (unit-tested with a throwing enricher / fetch).
- [ ] Buffer is bounded; overflow drops oldest and emits one counted warn.
- [ ] Flush occurs on interval, batch threshold, `online`, and `pagehide` (sendBeacon); failed flush retries on next trigger without duplicating sent events.
- [ ] `reportError` emits a parallel `logEvent('error', ...)`; Slack output byte-for-byte unchanged (snapshot test).
- [ ] Shared `enrichAndRedact` produces identical context for the error path as before the refactor (regression test); `family_email` present only when `includeEmail: true`.
- [ ] Lambda re-enforces the allowlist, caps batch/size, returns 400 on malformed (not 500), writes `t:"beanlog"` JSON lines; handler unit-tested.
- [ ] Lambda allowlist test pins the exact expected key set and fails on client-side drift (a client key-add that isn't mirrored breaks the test).
- [ ] `x-api-key` sourced as a repo SECRET per the `registryService` precedent — no plaintext key literal anywhere in the repo.
- [ ] CloudWatch log group exists with 90-day retention; a real event from the deployed app is queryable via `aws logs` Logs Insights filtering `t = "beanlog"`.
- [ ] `VITE_BEANIES_LOG_INGEST_URL` unset → `logEvent` no-ops with one warn (no fake success, no thrown error); when set, the value is a fully-qualified `https://…/logs` URL (assert scheme).
- [ ] Queue retry classification: `5xx`/network/timeout retries on next trigger; `4xx` (401/403/400) drops terminally with one warn and never retry-loops.
- [ ] Both prod build paths (`deploy.yml` + `translation-sync.yml`) carry `VITE_BEANIES_LOG_INGEST_URL` + the API-key secret, so telemetry isn't intermittently disabled depending on which workflow deployed.
- [ ] ADR-027 + ARCHITECTURE.md observability section written; privacy explainer updated and matches shipped behavior.
- [ ] `npm run validate` green (type-check + lint + format + unit + build); Lambda tests green.

## Testing Plan

1. **Unit (client, Vitest):** `logEvent` enrich/redact/never-throw (mock throwing enricher + fetch); queue flush triggers + retry + overflow (`vi.resetModules()` + dynamic import for module state, `vi.stubEnv`, `vi.spyOn(globalThis,'fetch')`, mock `sendBeacon`); `enrichAndRedact` regression vs. current errorReporter output; `reportError` Slack-payload snapshot unchanged + emits logEvent. Use `vi.resetAllMocks()` in `beforeEach` where `mockImplementationOnce` is used (lessons.md).
2. **Unit (Lambda, Node native test):** valid batch → N `console.log` JSON lines with `t:"beanlog"`; non-allowlisted key stripped; oversized batch/event → 400; malformed body → 400 not 500; CORS headers present; bad `x-api-key` rejected.
3. **Local integration:** `npm run dev`, point `VITE_BEANIES_LOG_INGEST_URL` at a deployed dev endpoint (or a local stub), trigger a known warn path (force a Drive read failure), confirm a batch POST with the expected redacted shape in network tab.
4. **Infra:** `terraform plan -var-file=…` shows only the new telemetry resources + the `POST /logs` route; `terraform apply` (greg-run, explicit) creates them; `aws logs describe-log-groups` shows the 90-day group.
5. **End-to-end (Claude-run, the whole point):** after deploy, generate an event from the live app, then from this chat run `aws logs start-query` over the telemetry group filtering `t="beanlog"` and the `family_id`, and read the result back — proving self-service triage with no copy/paste.
6. **Privacy assertion:** a test (or manual Logs Insights query) confirms no `family_email` and no non-allowlisted keys appear in any `beanlog` line.

## Cost Estimate

CloudWatch Logs, `ap-southeast-1`, fire-and-forget batches (~0.5KB/event):

| Scale              | Events/mo        | Ingest (~$0.55/GB) | Storage 90d (~$0.03/GB-mo) | Insights queries | Lambda + API GW | **Total/mo** |
| ------------------ | ---------------- | ------------------ | -------------------------- | ---------------- | --------------- | ------------ |
| Now (~30 families) | ~45K             | <$0.01             | <$0.01                     | pennies          | free tier       | **~$0**      |
| ~1,000 families    | ~900K (~0.45 GB) | ~$0.25             | ~$0.04                     | pennies          | ~$0 (free tier) | **<$1**      |
| ~10,000 families   | ~9M (~4.5 GB)    | ~$2.50             | ~$0.40                     | ~$0.05/query     | ~$1–2           | **~$5**      |

The deferred per-level sampling lever (ADR-027 future-work) keeps this flat if event-per-family rises. No third-party subscription.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full Option-A pipeline — shared enrichment core (DRY), client `logEvent` tier + offline-aware bounded queue, telemetry Lambda writing JSON to its own 90-day CloudWatch group, `reportError` unification, server-side allowlist re-enforcement, env plumbing, ADR-027 + privacy disclosure, cost model.
- **Pass 2 (DRY + error handling)**: Verified all reuse claims against real code. Fixed `extractStack` (private→move+export, no dupe); locked `x-api-key` to the registry secret precedent (dropped the open "decide" hedge); `cors_origins` defaulted in-module (no root pass-through); flagged `pagehide`/`sendBeacon` as net-new (don't piggyback App.vue's `beforeunload`); strengthened the server-allowlist drift guard to a pinned Lambda test; cut per-level sampling from this ship (kept only the `normalizeMessage` runaway guard); marked `photoUploadQueue` as the highest-value silent-failure closure; added 2 acceptance criteria.
- **Pass 3 (Sustainability)**: Added a server-stamped schema-version `v` to the log envelope (prevents query drift over time); named the allowlist single-source-of-truth strategy (canonical in `diagnosticContext.ts`, Lambda copy generated at build); made the queue init idempotent + no-Pinia-at-import; turned the throttling hand-wave into a concrete per-route `route_settings` block on the registry stage + noted no CORS change needed; promoted the single-group JSON invariant to an ADR contract; added an operational runbook (saved queries, "nothing alarms in v1", data-deletion procedure); pinned the `reportError`→`logEvent` ordering/guard independence; flagged the `sendBeacon` 64KB vs fetch/Lambda size-ceiling edge; flagged the `googleDriveProvider` path to verify.
- **Pass 4 (Fresh-eyes sweep)**: Caught two correctness traps — the ingest URL must be a fully-qualified `https://` (not bare `api_domain_name`), and `translation-sync.yml` is a second prod-deploy path with a stripped env block that would intermittently ship telemetry-disabled builds (both now named + fixed). Corrected the `x-api-key` from "soft" to a hard `401` and pinned the queue's 4xx-terminal-vs-5xx-retry classification (prevents an infinite retry loop on a bad key). Demoted build-time allowlist codegen to deferred future-work, making the pinned-test contract primary (matches project convention, removes a TF-coupled failure mode). Locked `extractStack` to a verbatim move guarded by the Slack snapshot. Everything else verified clean — no restructuring needed.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial discussion prompt (pre-plan)

> One thing we have not discussed or implemented yet is full, browseable, searchable system logging and diagnostics, with monitoring / observability to also leverage this logging in the future. We have an observability type function with errors being fired to slack, but aside from that, all other typical errors and issues are logged and lost to the user's console or on a toast that we never see. As an example, an error toast is shown regularly that indicates the google connection expired and silent token refresh failed. The code captures detailed error messages, but they are either swallowed or lost to the browser's console, which we never see. These important and useful messages should be stored and logged. Anything that could be useful to us for troubleshooting in the future should be stored, together with relevant information including (but not limited to) timestamp, family ID, app surface, view, component, module, filename, and any other relevant information that would help us (or yourself - claude) to review, triage, diagnose, troubleshoot, identify root causes, and ultimately fix errors in a long term and sustainable manner. What are some options we have, together with estimated cost, to capture and store all relevant logs...

### Follow-up (capability question)

> If we were to go with (A) - would you be able to access and triage logs directly from chat (i.e. via MCP, API, cli, etc) or would i need to copy/paste logs like we did earlier this morning?

### Plan request (/beanies-plan)

> Yes let's build a plan to implement full logging and telemetry based on the option (a) recommendation to store logs in AWS as appropriate, with the goal of ensuring we have the capability to review, diagnose, troubleshoot, and fix key site issues. Going forward we may also want to use this capability to trigger alerts as well (perhaps superseding the current direct webhook to slack approach from code, making alerting more robust)

### Clarifying answers

> Log store: CloudWatch Logs (Recommended). Retention: 90 days (Recommended). Alerting: Design for it, defer (Recommended).

</details>
