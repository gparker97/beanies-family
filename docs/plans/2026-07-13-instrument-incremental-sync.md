# Plan: Instrument the incremental delta-sync path (observability foundation for #44)

> Date: 2026-07-13
> Related issues: None — direct implementation. Unblocks Notion #44 (retire dual-publish base write); precursor per roadmap Item 1. No GitHub issue.
> Plan file: `docs/plans/2026-07-13-instrument-incremental-sync.md`

## User Story

As the operator of beanies.family, I want the incremental delta-sync path to emit structured diagnostic telemetry to CloudWatch, so that I can see whether deltas are actually working in production — and safely decide when to retire the dual-publish base write (#44) — without reproducing anything locally.

## Context

The ADR-032 worker incremental delta-sync transport (B1/B2) shipped in app `0.9.3` and runs for all prod users. But it is **unobservable in production**, in both directions:

- **Pull (apply) fallbacks are console-only.** `pullIncremental` (`incrementalTransport.ts`) returns `{ outcome: 'fallback', reason }` for five reasons — `list-failed` (:106), `read-failed` (:118), `chunk-missing` (:120), `apply-error` (:128), `missing-deps` (:132). The single consumer logs a **bare `console.warn`** at `syncService.ts:749` (`incremental pull fell back (${reason}) → whole-doc merge`). Nothing reaches CloudWatch.
- **Publish failures are swallowed.** `publishIncremental` wraps its whole body in a `try/catch` whose catch is a **bare `console.warn`** (`incrementalTransport.ts:167`, "publish chunk failed (non-fatal…)"). Nothing reaches CloudWatch.
- **The success path emits nothing queryable.** Neither a successful chunk apply (`outcome:'applied'`) nor a successful publish emits a count event. The only signal is worker perf timing (`sink.perf` → `perfTiming.record`), which is gated by `TELEMETRY_FLOOR_MS = 250` — so fast chunk applies are invisible **by construction**, and you cannot measure the delta path's success **rate**.
- **The one perf label that does fire is overloaded.** `automerge.remoteLoad` labels **both** the whole-doc base adopt (`applyAndProject.ts:355`, carries `perf_doc_bytes`) **and** the delta-chunk decrypt (`applyAndProject.ts:489`, no byte count). In CloudWatch the two are indistinguishable.

This directly blocks **#44** (retire the dual-publish base write). Its OQ4 exit criteria say to "watch missing-deps telemetry" and to stamp a writer-version before removing the base — but **neither signal was ever wired** (grep: no `minCompat`/`minVersion`/`writerVersion` anywhere; every fallback reason dead-ends in `console.warn`). The 2026-07-09 investigation nearly went wrong because STATUS implied a health signal that did not exist.

This work is **instrument-only** and is the first feature built under the new **"Observability & Diagnostic Logging"** convention (`CLAUDE.md`, 2026-07-13) — so it should read as the exemplar for that convention. It ships standalone, small and safe, and unblocks #44 without touching the base-write logic itself.

**Telemetry note (from STATUS item 2):** the honest read of what little we have (Jul 7+) is 2,793 whole-doc base adopts vs **1** delta-chunk apply — but ~2,785 of the adopts are one single-device family (no peers → incremental correctly `noop`s). So the delta path is **barely exercised**, not broken. Instrumenting is the only way to see whether real multi-device families are hitting the delta path at all — and whether the unbounded chunk history (#46) is already biting.

## Requirements

1. Every incremental **pull fallback** (`list-failed` / `read-failed` / `chunk-missing` / `apply-error` / `missing-deps`) emits a `logEvent` to CloudWatch with the reason and enough context to diagnose it blind. The console.warn at `syncService.ts:749` stays as a local-dev breadcrumb; the structured event is emitted at the source (inside `pullIncremental`).
2. Every incremental **publish failure** (the swallowed catch at `incrementalTransport.ts:167`) emits a `logEvent` with the error and context — no more silent swallow. The existing `console.warn` stays alongside it (convention = firehose + console).
3. **Success-path counters** fire on every successful chunk **apply** (`outcome:'applied'`) and successful **publish** (a chunk was written), **unconditionally** — not gated by the 250 ms perf floor — so the delta path's success rate is measurable for future alerting. `noop` outcomes are also distinguishable (so "single-device family → noop" doesn't look like "delta broken").
4. The overloaded `automerge.remoteLoad` perf label is **split** so the whole-doc base adopt and the delta-chunk decrypt are distinguishable in CloudWatch.
5. A **writer-version stamp** is added to the base envelope so a reader can tell which app version last wrote a file (the #44 exit criterion proving no whole-doc-only client still writes). It is stamped on **every** write path — both the fresh builder (`createBeanpodV4`) and the re-encrypt path (`reEncryptEnvelope`) — so a re-encrypted file reflects the version that actually re-wrote it, not a stale one. Forward-compatible: old readers ignore it.
6. The Notion **#44 removal criteria** wording is corrected to "instrument, THEN watch" (documentation task, noted here; not code).
7. **No behavioral change** to sync itself: outcomes, fallback control-flow, base-write, and pruning are untouched. This is pure instrumentation + one additive envelope field.

## Important Notes & Caveats

- **`pullIncremental` / `publishIncremental` are main-thread** (they drive `aux` Drive I/O and `docClient` RPCs), so `logEvent` (a main-thread firehose primitive) can be called **directly** at these sites — no worker→main marshalling needed. This is the clean instrumentation seam. Only the **perf label split (Req 4)** is worker-side (`sink.perf` in `applyAndProject.ts`), and that is a pure string-label change — no new sink message.
- **`logEvent` couples the transport to the telemetry module — that is acceptable.** The `incrementalTransport` docstring stresses dependency-injection for testability, but `logEvent` is a safe global sink (fire-and-forget, never throws, re-entry guarded — verified `logEvent.ts:108–138`), exactly like `console`. Importing it directly (as `photoUploadQueue.ts:19` already does) does **not** compromise the DI purity that matters (the `AuxStore`/`TransportDeps` seams stay injected). Tests neutralize it with the established `vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }))` pattern (as in `googleAuth.native.test.ts:28`).
- **`logEvent` vs `perfTiming` for counts.** Counts (Req 3) must go through **`logEvent`** (no floor; rate-limited), NOT `perfTiming` (250 ms floor, verified `perfTiming.ts:27`). Do not try to "lower the floor" — that would distort every other perf metric. The floor stays; counts simply don't use the floored channel.
- **One surface, structured context — don't fan out into many surfaces.** Use a single kebab-case surface `incremental-sync` and distinguish events by a structured `incr_phase` context field (`pull-fallback` / `pull-applied` / `pull-noop` / `publish-ok` / `publish-failed`). One CloudWatch filter (`surface = incremental-sync`) then covers the whole path.
- **Rate-limit awareness (corrected).** The limiter keys on **`surface::normalizeMessage(message)`**, not on `surface` alone (verified `logEvent.ts:85–86`, `RATE_MAX_PER_WINDOW = 50`, 60 s window). Because the helper's `message` is `incremental ${phase}`, **each phase gets its own 50/min bucket** — five buckets, not one. This is _desirable_: a family stuck in permanent `pull-fallback` will cap its own fallback bucket without starving the `pull-applied` / `publish-ok` success counters. Do **not** add a second ad-hoc limiter; the per-message bucketing already gives capped-but-visible flood protection per phase.
- **Level choice.** Fallbacks and publish-failures are `logEvent({ level: 'warn' })` — they are _handled_ degradations (the whole-doc base is authoritative), NOT user-facing failures, so they must **not** page Slack. Do **not** use `reportError({ severity: 'critical' })` here (no user action failed, no data at risk — the base write covers it). Success counters are `level: 'info'`. This matches the convention's "reserve critical for user-action-failed / data-at-risk."
- **The writer-version stamp is the one schema-touching change.** It adds an **optional** field to `BeanpodFileV4` (`syncFileV4.ts:43` type; builder `createBeanpodV4` at `fileSync.ts:34`, `version: '4.0'` at `:45`; re-encrypt at `fileSync.ts:233`). It must be optional so existing files still parse — verified safe: `parseBeanpodV4` (`fileSync.ts:62–89`) validates only the known required fields and does `return parsed as BeanpodFileV4` **without rejecting or stripping unknown fields**. Set it from `APP_VERSION` (`src/constants/appVersion.ts`, currently `'0.9.4R11'`). Do NOT gate any behavior on it yet — #44 will read it later. Name it to read as "the version that wrote this file" (`writerVersion`), not a compatibility gate we don't yet enforce.
- **The allowlist is MIRRORED in two code locations plus four store docs — the plan must touch every copy or it silently breaks.** This is the single biggest maintainability trap in this change, because the allowlist is duplicated by design and pinned by tests:
  1. **Client allowlist** — the `Set` at `diagnosticContext.ts:61`, enforced by `redactContext` (`:141–164`), which drops any unlisted key **with a `console.warn`** (`:146`) — i.e. silent telemetry data loss if we forget one.
  2. **Lambda mirror** — `infrastructure/lambda/telemetry/index.mjs:47` holds a **second copy** of the same set (the ingest Lambda re-drops non-allowlisted keys server-side, `index.mjs:121`). The `diagnosticContext.ts:52–53` docstring says verbatim "MIRROR … Update both together." **If a key is added client-side only, the Lambda strips it after it leaves the device — the exact silent-loss failure this plan exists to eliminate.**
  3. **Lambda pinned test** — `infrastructure/lambda/telemetry/__tests__/handler.test.mjs:237` asserts `assert.deepEqual([...ALLOWED_CONTEXT_KEYS].sort(), expected)` — an **exact-match** list. Adding keys to the mirror without updating this `expected` array fails CI. (There is a symmetric client-side allowlist contract test; add the new keys to its expectation too if it enumerates.)

  Follow the existing **prefixed-family convention** (`perf_*`, `silent_refresh_*`, `refresh_token_*`) and prefix the incremental family `incr_*` — this keeps the allowlist self-documenting and avoids collision-prone bare names like `dirty`.

  **Key set — deliberately minimal (5 keys, not 6): `incr_phase`, `incr_reason`, `incr_chunk_count`, `incr_seq`, `incr_dirty`.** `incr_chunk_count` carries the count of chunks _involved this tick_ — the applied count on `pull-applied`, the fresh/fetched count on `pull-fallback` — because `incr_phase` already disambiguates which one it is. Collapsing what an earlier draft split into `incr_chunk_count` + `incr_fetched_count` into a single phase-disambiguated key removes one entry that would otherwise have to be kept in lockstep across all six mirror/declaration sites **forever**; the reduction is free (no query power lost — you always filter by `incr_phase` first). Do not re-split without a concrete query that needs both counts in the _same_ phase.

  Adding these keys triggers the convention's privacy gate: update the store data-collection declarations in the **four** consumers the `diagnosticContext.ts:55–59` docstring names — `docs/runbooks/native-store-submission.md`, `ios/App/App/PrivacyInfo.xcprivacy`, the store Data-Safety/App-Privacy answers, and `web/src/pages/privacy.astro`. None carry PII (enums/counts/booleans) — but they must still be declared.

- **Do NOT instrument inside the worker's hot apply loop.** Keep all `logEvent` calls at the main-thread transport boundary (`syncService`/`incrementalTransport`), where one event summarizes an outcome — not per-chunk inside `applyRemoteChunks`. Per-chunk logging in the worker would need a new sink message AND could flood.
- **`publish-ok` and `publish-failed` are mutually exclusive by construction.** Emit `publish-ok` **immediately after the successful `aux.write`** (before `pruneOwnChunks`). `pruneOwnChunks` cannot throw into the outer `try` — it catches its own `aux.list()` failure (`:186`) and swallows each `aux.delete().catch(() => {})` (`:192`) — so no post-write step can trip the outer catch and produce a spurious `publish-failed` after a `publish-ok`. The catch only ever fires for a pre-write failure (`getActorId`/`getHeads`/`exportIncrementalPayload`/`aux.write`). Keep it that way; do not move throwing work below the `publish-ok` emit.
- **Out of scope (do not touch):** the base-write itself, `pruneOwnChunks` logic (#46), cold-load speed (#43), the fallback control flow. If a reviewer is tempted to "also fix the unbounded chunks while here" — no; that is #46 and depends on this telemetry to prioritize.

## Assumptions

> Review before implementation.

1. `pullIncremental` returns the five fallback reasons verbatim as listed (verified 2026-07-13: `incrementalTransport.ts:106,118,120,128,132`) and the sole consumer is `syncService.ts:743–751`.
2. `publishIncremental`'s only failure surface is its outer `try/catch` at `incrementalTransport.ts:167` (verified) and its sole call site is `syncService.ts:858` (call site line not re-verified in this pass; confirm during implementation — it does not change the design either way).
3. `logEvent` (`src/services/telemetry`) is importable from `syncService.ts`/`incrementalTransport.ts` (verified: already imported in the sibling `photoUploadQueue.ts:19`) and is fire-and-forget / never throws (verified `logEvent.ts:108–138`).
4. **`automerge.remoteLoad` has THREE emitters, and only one is the delta path** (corrected 2026-07-13 — an earlier draft wrongly said "exactly two"): `applyAndProject.ts:355` (worker whole-doc base adopt, `perf_doc_bytes`), `applyAndProject.ts:489` (worker delta-chunk decrypt, inside `applyRemoteChunks`), and `fileSync.ts:128` (main-thread whole-doc `Automerge.load`). **Only `:489` renames** to `automerge.remoteChunkDecrypt`; the other two are genuine whole-doc loads and correctly keep `remoteLoad`. The grep in Approach §3 must confirm exactly these three sites so the split isn't applied to the wrong one. The existing assertion `applyAndProject.test.ts:210` exercises the **base** path (`mergeRemoteEnvelope` → `:355`), so it stays green after the rename; the delta rename needs its own new assertion (Testing §4).
5. `BeanpodFileV4` can carry an optional new top-level field without breaking existing readers/validators — **verified**: `parseBeanpodV4` does not reject or strip unknown fields (`fileSync.ts:88`), and `reEncryptEnvelope` spreads the whole envelope (`fileSync.ts:235`).
6. `ALLOWED_CONTEXT_KEYS` exists in **two mirrored code copies** — `src/utils/diagnosticContext.ts:61` (client, drops unlisted keys with a `console.warn`, verified `:145–147`) and `infrastructure/lambda/telemetry/index.mjs:47` (server ingest, verified) — and the Lambda copy is pinned by an exact-match test (`handler.test.mjs:237`). Both copies plus the pinned test must be updated together.

## Approach

Four code changes + one doc change, no behavior change.

### 1. A single shared telemetry helper for the incremental path (`incrementalTransport.ts`) — DRY

Rather than sprinkle `logEvent` calls, add one tiny module-private helper so every incremental event has an identical shape (one surface, consistent `incr_*` context keys):

```ts
import { logEvent } from '@/services/telemetry';

type IncrPhase = 'pull-applied' | 'pull-noop' | 'pull-fallback' | 'publish-ok' | 'publish-failed';

/** One structured event for the whole incremental path. Fire-and-forget (logEvent
 * never throws). Level: 'warn' for degradations (fallback/publish-failed — handled,
 * base is authoritative, never pages), 'info' for successful outcomes. The message
 * embeds the phase so logEvent's per-(surface,message) rate limiter gives each phase
 * its own 50/min bucket (a fallback flood can't starve the success counters). */
function logIncremental(phase: IncrPhase, context: Record<string, unknown>, error?: unknown): void {
  const level = phase === 'pull-fallback' || phase === 'publish-failed' ? 'warn' : 'info';
  logEvent({
    level,
    surface: 'incremental-sync',
    message: `incremental ${phase}`,
    context: { incr_phase: phase, ...context },
    error,
  });
}
```

Then emit at the natural return/catch points:

- **`pullIncremental`** — before each `return { outcome: 'fallback', reason }`, call `logIncremental('pull-fallback', { incr_reason: reason, incr_chunk_count: fresh.length })` (`fresh.length` is the number of chunks being fetched this tick). Before `return { outcome:'applied', dirty: res.dirty }` → `logIncremental('pull-applied', { incr_chunk_count: payloads.length, incr_dirty: res.dirty })`. Before `return { outcome:'noop' }` → `logIncremental('pull-noop', {})`. `incr_chunk_count` means "chunks involved this tick" in both phases (fetched-at-fallback vs applied), disambiguated by `incr_phase`. Emitting inside `pullIncremental` keeps the count next to the outcome and means the `syncService` consumer needs no logging (the counts like `payloads.length` are only in scope here).
- **`publishIncremental`** — on the branch that actually writes a chunk, emit `logIncremental('publish-ok', { incr_seq: session.publishSeq - 1 })` (the seq just consumed) **immediately after `aux.write` succeeds and before `pruneOwnChunks`**; in the catch, `logIncremental('publish-failed', {}, e)` **in addition to** the existing `console.warn` (keep both — the convention wants firehose + console, matching `photoUploadQueue.ts:144–154`). Because `pruneOwnChunks` is non-throwing (it swallows its own failures), `publish-ok` and `publish-failed` can never both fire for one publish.

The `syncService.ts:749` `console.warn` **stays** as a local-dev breadcrumb (unchanged) — the CloudWatch signal is now emitted at the source inside `pullIncremental`, closer to the reason and with counts the caller cannot re-derive. No new logging is added at the consumer.

### 2. Success-path counters are covered by §1

`pull-applied` / `pull-noop` / `publish-ok` events ARE the unconditional counters (Req 3) — they go through `logEvent` (no 250 ms floor), so a 5 ms chunk apply still records. No separate counter mechanism is needed; CloudWatch counts events by `incr_phase`.

### 3. Split the overloaded perf label (`applyAndProject.ts`)

A one-line label change at the delta site so the two are distinguishable:

- `applyAndProject.ts:355` (worker base adopt) stays `automerge.remoteLoad` (carries `perf_doc_bytes`).
- `applyAndProject.ts:489` (delta-chunk decrypt, inside `applyRemoteChunks`) → `automerge.remoteChunkDecrypt`.
- `fileSync.ts:128` (main-thread whole-doc `Automerge.load`) stays `automerge.remoteLoad` — it is a genuine whole-doc load, NOT the delta path.

Grep `automerge.remoteLoad` across `src/` + `docs/` + `infrastructure/` and confirm exactly the three emitters in Assumption 4 before touching anything; update any perf-label allowlist / dashboard enumeration to add `automerge.remoteChunkDecrypt`. This is worker-side but purely a string; it still rides `sink.perf` → `perfTiming.record` (so it keeps the 250 ms floor — fine, the _count_ of applies is already covered by §1's floor-free events). The existing `applyAndProject.test.ts:210` assertion exercises the base path and is unaffected.

### 4. Writer-version stamp (`syncFileV4.ts` + `fileSync.ts`)

- Add `writerVersion?: string` to the `BeanpodFileV4` type (`syncFileV4.ts:43`), optional (old files lack it).
- In the builder `createBeanpodV4` (`fileSync.ts:44`, `version: '4.0'`), set `writerVersion: APP_VERSION` (import from `@/constants/appVersion`). No new parameter — read the constant directly.
- In `reEncryptEnvelope` (`fileSync.ts:235`), override on the spread so the re-written file reflects the version that re-wrote it: `const updated: BeanpodFileV4 = { ...envelope, encryptedPayload, writerVersion: APP_VERSION };`. Without this, a key-rotation / member-change re-encrypt by this app version would silently carry the **previous** writer's version (or none), which would misinform the #44 "no old writer remains" check.
- Nothing reads it yet; #44 will. This plan only starts the write history. Add a one-line comment at each stamp site pointing at #44.

### 5. Documentation (Notion #44) — not code

Update #44's removal-criteria wording to "instrument, THEN watch" and point at this plan. Noted as a task; the implementer updates the Notion row.

## Files Affected

- `src/services/sync/incrementalTransport.ts` — the `logIncremental` helper + emit at each pull outcome and both publish paths; keep the existing publish `console.warn` alongside the new `publish-failed` event.
- `src/services/sync/syncService.ts` — no change (the `:749` `console.warn` stays as a dev breadcrumb; the CloudWatch signal is emitted at source in `pullIncremental`).
- `src/services/automerge/worker/applyAndProject.ts` — rename the `:489` delta label to `automerge.remoteChunkDecrypt` (leave `:355` as `remoteLoad`).
- `src/types/syncFileV4.ts` — add optional `writerVersion?: string`.
- `src/services/sync/fileSync.ts` — set `writerVersion: APP_VERSION` in `createBeanpodV4` **and** `reEncryptEnvelope`; import `APP_VERSION`. (`fileSync.ts:128` `remoteLoad` label unchanged.)
- `src/utils/diagnosticContext.ts` — add the new keys to `ALLOWED_CONTEXT_KEYS` (`incr_phase`, `incr_reason`, `incr_chunk_count`, `incr_seq`, `incr_dirty`), grouped with a comment like the other families.
- **`infrastructure/lambda/telemetry/index.mjs`** — add the same five `incr_*` keys to the **mirrored** `ALLOWED_CONTEXT_KEYS` (`:47`). Without this the Lambda strips them server-side (silent loss). Keep the two copies in sync per their mirror contract.
- **`infrastructure/lambda/telemetry/__tests__/handler.test.mjs`** — add the five keys to the exact-match `expected` array (`:237`) so the pinned allowlist test passes; if the client has a symmetric enumerating allowlist test, update its expectation too.
- `docs/runbooks/native-store-submission.md`, `ios/App/App/PrivacyInfo.xcprivacy`, the store Data-Safety/App-Privacy answers, and `web/src/pages/privacy.astro` — declare the new diagnostic context keys per the privacy gate (counts/enums/booleans, no PII).
- **Tests** — `incrementalTransport` test (each fallback reason + success + publish paths emit the right event); an `applyAndProject` test asserting the split label; a `fileSync` test asserting `writerVersion` is stamped by both `createBeanpodV4` and `reEncryptEnvelope` and that a legacy envelope without it still parses.
- `CHANGELOG.md` — operator-facing note ("better sync diagnostics") or omit as operator-only; note the decision in the plan.
- `docs/STATUS.md` — record shipped + that #44 is now unblocked-pending-watch.

## Observability Coverage

This plan _is_ observability work — the events below are the deliverable.

- **Events (all `surface: 'incremental-sync'`, one helper `logIncremental`, discriminated by `incr_phase`):**
  - `incr_phase: 'pull-fallback'` — `level: warn` — context `{ incr_reason, incr_chunk_count }`. Diagnoses _why_ a delta pull fell back to whole-doc (the five reasons) and how many chunks were in flight, blind.
  - `incr_phase: 'pull-applied'` — `level: info` — context `{ incr_chunk_count, incr_dirty }`. The success counter (floor-free) — proves deltas actually applied + how many.
  - `incr_phase: 'pull-noop'` — `level: info` — context `{}`. Distinguishes "nothing to do" (single-device/no-peer) from "broken", so telemetry isn't misread.
  - `incr_phase: 'publish-ok'` — `level: info` — context `{ incr_seq }`. Publish-side success rate.
  - `incr_phase: 'publish-failed'` — `level: warn` — context `{}` + `error`. Was a silent swallow; now diagnosable.
- **Failure modes covered:** every fallback reason; publish failure; and (by absence of `pull-applied` while `pull-noop`/`fallback` dominate) "deltas never land." No bare `catch {}` remains on the incremental path — the `publishIncremental` catch now emits, and `publish-ok`/`publish-failed` are mutually exclusive per publish (prune is non-throwing).
- **Success-path signal:** `pull-applied` / `publish-ok` fire on success (floor-free via `logEvent`), so future alerting can watch the fallback-to-applied ratio and the publish-failure rate.
- **Rate-limit shape:** each phase carries a distinct `message` (`incremental <phase>`), so each occupies its own 50/min bucket — a permanent-fallback family caps its own fallback stream without hiding concurrent successes. Capped-but-visible, per phase.
- **Perf-label split:** `automerge.remoteLoad` (whole-doc base adopt / main-thread load) vs `automerge.remoteChunkDecrypt` (delta decrypt) become separable durations in CloudWatch (still `perfTiming`-floored — the floor-free counts above are the complement).
- **Critical vs. telemetry:** nothing here is `critical` — every event is a handled degradation or a success (the whole-doc base is always authoritative), so none page Slack. Correct per the convention.
- **Privacy/store gate:** new context keys `incr_phase, incr_reason, incr_chunk_count, incr_seq, incr_dirty` — enums/counts/booleans, no PII. Add them to `ALLOWED_CONTEXT_KEYS` in **both** `src/utils/diagnosticContext.ts` **and** the Lambda mirror `infrastructure/lambda/telemetry/index.mjs` (updating the pinned `handler.test.mjs` expectation), AND declare them in the four store consumers the docstring names. `writerVersion` ships in the `.beanpod` file (user-controlled, encrypted-at-rest envelope metadata), NOT the telemetry firehose — so it is not a diagnostics-declaration item, but note it in the file-format doc.

## Acceptance Criteria

- [ ] Each of the five pull fallback reasons emits a `logEvent({ surface:'incremental-sync', level:'warn', context:{ incr_phase:'pull-fallback', incr_reason, incr_chunk_count }})` — verified by test.
- [ ] A successful chunk apply emits `pull-applied` and a successful publish emits `publish-ok`, both via `logEvent` (fire even for sub-250ms operations) — verified by test.
- [ ] The `publishIncremental` catch no longer swallows silently — it emits `publish-failed` with the error (and keeps the console breadcrumb); `publish-ok` and `publish-failed` never both fire for one publish — verified by test.
- [ ] `automerge.remoteLoad` and `automerge.remoteChunkDecrypt` are distinct labels; only the `applyAndProject.ts:489` delta site renamed (`:355` and `fileSync.ts:128` stay `remoteLoad`) — verified by test/grep.
- [ ] New `.beanpod` envelopes carry `writerVersion === APP_VERSION` from **both** `createBeanpodV4` and `reEncryptEnvelope`; existing envelopes without the field still parse — verified by test.
- [ ] Every new context key is present in **both** `ALLOWED_CONTEXT_KEYS` copies (`src/utils/diagnosticContext.ts` AND `infrastructure/lambda/telemetry/index.mjs`), the pinned `handler.test.mjs` allowlist test passes, and the keys are declared in the four store data-collection consumers.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (the incremental path is triageable from CloudWatch in both directions without a local repro).
- [ ] Notion #44 removal-criteria wording updated to "instrument, THEN watch."
- [ ] `npm run type-check && npm run lint && npm test -- --run` all pass, **and** the Lambda test suite (`infrastructure/lambda/telemetry/__tests__`) passes; no behavioral change to sync (existing sync tests green).

## Testing Plan

All client tests neutralize the firehose with the established mock `vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }))` and assert on the mocked `logEvent` (pattern from `googleAuth.native.test.ts:28,120`).

1. **Unit — pull fallbacks.** Drive `pullIncremental` to each fallback reason (mock `aux.list`/`read`/`applyRemoteChunks`); assert `logEvent` called once with `incr_phase:'pull-fallback'` + the right `incr_reason` + `incr_chunk_count`. Reuse the existing `incrementalTransport.test.ts` harness.
2. **Unit — success counters.** A successful apply → `pull-applied` with `incr_chunk_count`/`incr_dirty`; a `noop` → `pull-noop`; a successful publish → `publish-ok` with `incr_seq`. Assert they fire regardless of duration (no floor — trivially true since we don't touch `perfTiming`).
3. **Unit — publish failure.** Force `aux.write`/`exportIncrementalPayload` to throw; assert `publish-failed` + `error` emitted (not swallowed), the `console.warn` still fires, control flow still returns void (base authoritative), and that a prune-time failure after a successful write does NOT emit `publish-failed` (mutual-exclusivity guard).
4. **Unit — label split.** Assert `applyRemoteChunks` (delta path) emits `automerge.remoteChunkDecrypt`; the base path (`mergeRemoteEnvelope`, `applyAndProject.test.ts:210`) still emits `automerge.remoteLoad`.
5. **Unit — writer stamp.** Build an envelope via `createBeanpodV4`; assert `writerVersion === APP_VERSION`. Re-encrypt an envelope via `reEncryptEnvelope` (including one whose input lacks `writerVersion`); assert output `writerVersion === APP_VERSION`. Parse a legacy envelope object without the field via `parseBeanpodV4`; assert no throw.
6. **Unit — allowlist mirror.** The pinned Lambda test (`handler.test.mjs`) passes with the five keys added to the mirror; a payload carrying the `incr_*` keys survives the Lambda's redaction (keys not dropped). Confirms client and server allowlists agree.
7. **Integration (folds roadmap task 8a) — multi-device convergence + observability.** Two inline-backend clients, concurrent edits, sync via a shared fake `aux`; assert (a) both projections converge to identical state and (b) at least one `pull-applied` fired (the delta path was actually exercised + observed). This is the deterministic convergence test the gap analysis flagged; it lives here because this plan makes the path observable.
8. **Regression.** Full sync suite green — no behavioral change.
9. **Manual (post-deploy).** After deploy, filter CloudWatch `surface = incremental-sync`; confirm `pull-noop` from single-device families and (from a 2-device test) `pull-applied` + `publish-ok`. Confirm the `incr_*` keys actually land in CloudWatch (proves the Lambda mirror took). Confirm `writerVersion` in a freshly-written `.beanpod`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the instrument-only design — one `logIncremental` helper (single `incremental-sync` surface, phase-keyed), floor-free success counters via logEvent, the `remoteLoad` label split, the optional `writerVersion` envelope stamp, the ALLOWED_CONTEXT_KEYS + privacy-declaration gate, and a convergence+observability integration test — grounded in verified code sites.
- **Pass 2 (DRY + error handling)**: Corrected the allowlist file (`diagnosticContext.ts`, not `logEvent.ts`); fixed the inverted rate-limit rationale (per-(surface,message) → one bucket _per phase_); adopted the `incr_*` prefixed-key family (matching `perf_*`/`silent_refresh_*`) and reconciled the key set (dropped the never-emitted `landed`, added `incr_seq`); closed a real silent gap by also stamping `writerVersion` in `reEncryptEnvelope`; kept the fallback/publish `console.warn` breadcrumbs alongside the firehose events (convention = both); and grounded the test-mock approach in the existing `vi.mock('@/services/telemetry')` pattern.
- **Pass 3 (Sustainability)**: Added the omitted **Lambda allowlist mirror** (`infrastructure/lambda/telemetry/index.mjs`) and its **exact-match pinned test** (`handler.test.mjs`) as mandatory update sites — without them the new keys are stripped server-side (silent loss) and CI fails; corrected the false "two emitters" claim (Assumption 4 → three `remoteLoad` emitters, only `:489` renames, `fileSync.ts:128` stays); **shrank the pinned-in-6-places key family from 6 to 5** by collapsing `incr_fetched_count` into phase-disambiguated `incr_chunk_count`; and pinned down `publish-ok`/`publish-failed` mutual exclusivity (emit before non-throwing prune) to prevent double-counting.
- **Pass 4 (Fresh-eyes sweep)**: _pending_

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (roadmap Item 1, via /beanies-plan)

> Plan roadmap Item 1 — Instrument the incremental delta-sync path (observability foundation; precursor to retiring the #44 dual-publish base write). [full scope: route the 5 fallback reasons through logEvent; count chunk applies/publishes unconditionally below the 250ms floor; split the overloaded automerge.remoteLoad label; add the writer-version stamp; update #44 wording. Mandatory Observability Coverage. Out of scope: #44 base-write removal, #46 pruning, #43 cold-load. GitHub issue: SKIP. Feature gate: NO.]

</details>
