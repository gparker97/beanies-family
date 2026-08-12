# Plan: Upgrade @automerge/automerge 3.2.6 → 3.4.0 (hexane v1 engine)

> Date: 2026-08-12
> Related issues: None — direct implementation (Notion tracker #59; **no GitHub issue** per pre-plan directive)
> Plan file: `docs/plans/2026-08-12-automerge-3-4-0-hexane-upgrade.md`

## User Story

As a family relying on beanies to hold years of data, I want the CRDT engine on the latest fixed version so my file loads faster and known silent-corruption bugs are gone — with zero risk to the files I already have.

## Context

`@automerge/automerge` is beanies' CRDT source of truth. `Automerge.save()` output **is** the durable `.beanpod` V4 payload (the encrypted envelope wraps that binary), and `saveIncremental`/`loadIncremental` drive the cross-client delta sync in the ADR-032 off-main-thread worker. We are pinned at `^3.2.6`.

Version 3.4.0 lands the **hexane v1** storage-engine rewrite: a large load/save perf uplift, **two silent-corruption bug fixes** (one present in our current 3.2.6 — the primary reason to move, beyond speed), and an O(n²) fix. Because it rewrites the on-disk column format (v0 → v1), the standing worry was: could a `.beanpod` written by one version be unreadable/mis-merged by a family member still on the other version mid-rollout?

A **2026-08-11 compat spike** (`scratchpad/am-compat/harness.mjs`, 3.2.6 and 3.4.0 installed side-by-side, exchanging _bytes_ — not live doc handles — across the version boundary) answered that: **6/6 checks pass** in both directions —

- full snapshot round-trip: 3.4.0-written bytes load on 3.2.6 and vice-versa;
- incremental delta (`saveIncremental` → `loadIncremental`) both directions;
- cross-version concurrent merges converge.

Perf (Node, synthetic ~5k-txn doc): `save` 100→45ms (−56%), `load` 863→718ms (−17%), `saveIncremental` 490→382ms (−22%); snapshot size +6% (558→594KB, accepted).

**Conclusion: the mixed-version risk is retired — this is a normal, all-at-once ship. No gated rollout, no new Settings flag.** It rides the existing docWorker kill-switch; rollback = revert the bump + redeploy. **Note the rollback is not instantaneous across surfaces: web/PWA reverts on redeploy, but native iOS/Android builds ship the bundle embedded, so some clients will persist on 3.4.0 (writing v1-format bytes) after a web revert. This is safe _because of the same both-directions guarantee the spike proved_ — a reverted 3.2.6 client still loads a `.beanpod` a 3.4.0 client already wrote (new→old snapshot + incremental both pass). Rollback therefore degrades gracefully rather than stranding data; it is not a mechanism for un-writing v1 bytes already in the field, and none is needed.**

> **Note on the spike harness:** `scratchpad/` is session-ephemeral and the original `harness.mjs` is already gone. Its _logic_ is what this plan makes permanent as a checked-in CI test (see Approach) — we are not depending on the scratchpad file surviving.

## Requirements

1. Bump `@automerge/automerge` `3.2.6` → `3.4.0` in `package.json` + `package-lock.json`.
2. Land a **checked-in Vitest** that guards cross-version compatibility **in both directions**, permanently — so a future automerge bump (or our own code) cannot silently regress `.beanpod` interop. It must cover: snapshot round-trip both directions, incremental delta both directions, and cross-version concurrent-merge convergence.
3. The full unit suite + the worker suites (`cache`, `applyAndProject` incl. `mergeRecovery`, `docOps`, `photoOps`, `docClient`) pass against 3.4.0.
4. `npm run type-check`, `npm run lint`, `npm run format:check`, and `npm run build` (rollup whole-graph import-analysis) are green before pushing.
5. Post-deploy: confirm the perf uplift lands on a **real large `.beanpod`** (greg's own) via the already-existing `perfTiming` labels — no regression vs. a 3.2.6 baseline.

## Important Notes & Caveats

- **Target 3.4.0 exactly — do NOT adopt 3.3.0 / 3.3.1.** The text-encoding-on-load fixes landed _after_ 3.3.0; 3.4.0 is the settled version.
- **`.beanpod` V4 envelopes carry `Automerge.save()` binary.** A read incompatibility would surface as a **load failure** — a thrown `CorruptPayloadError` (`@/types/sync`), already caught + wrapped in `fileSync.ts:133-138` and surfaced to the sync error path — _not_ a silent no-op. The spike shows it does not occur, but the failure mode is loud by construction — reassuring for rollout.
- **The bump is not a plain Dependabot squash.** PR #302 changes only the version. This plan also adds a dev-only _aliased_ second copy of automerge (see Approach) plus the test, so it lands as a **direct change on `main`** and **#302 is closed as superseded** — exactly the pattern used for pinia #285 → `e41600d5`.
- **Do NOT touch** `src/services/automerge/worker/spike/spikeWorker.ts` — that is an unrelated pre-existing worker spike, not the am-compat spike.
- **Out of scope:** pinia 4 / web-vitals 6 / other dep bumps (separate PRs, already handled); the experimental Automerge `fragments` API; any history-compaction / truncation change.
- Snapshots are ~6% larger on disk → marginally more Drive upload + encryption cost per save. Accepted for the load/save speedup.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-08-12); may have changed.

1. **3.4.0 is still the latest settled hexane v1 release** and Dependabot PR #302 still targets it. If a 3.4.x patch has since shipped, prefer the newest 3.4.x (re-confirm no post-3.4.0 format churn).
2. **The automerge public API surface we use is unchanged in 3.4.0** — `load, change, clone, init, save, saveIncremental, loadIncremental, diff, merge, getChanges, applyChanges, getHeads, getMissingDeps, getActorId, from, view`. Verified by type-check + the worker suites; the plan calls out re-verifying, not assuming.
3. **npm package aliasing works for a wasm package** (two independent wasm instances in one test process). The spike already ran 3.2.6 and 3.4.0 side-by-side, so this is replication of a proven setup, not a new bet.
4. **greg has a real large `.beanpod`** available for the post-deploy perf confirmation (resolved in pre-plan).
5. No other in-flight branch is mid-change on `fileSync.ts` or the worker (repo is clean on `main`).

## Approach

### 1. Version bump + aliased legacy copy (one `package.json` change)

- Set `"@automerge/automerge": "3.4.0"` (drop the `^` to pin exactly — this is a data-layer engine; we upgrade it deliberately, not via a caret drift).
- Add a **devDependency alias** so the _previous_ engine stays importable in tests only:
  ```jsonc
  "devDependencies": {
    "@automerge/automerge-legacy": "npm:@automerge/automerge@3.2.6"
  }
  ```
  This is the mechanism that makes Requirement 2's "both directions" test genuinely runnable in CI from a single install — it permanently reproduces the spike's side-by-side layout. It ships in `devDependencies`, so it is **not** in the production bundle (verified by the `npm run build` step + a bundle grep in Testing).
  - **Future-bump convention (so this alias does not become stale scaffolding):** on _every_ later `@automerge/automerge` bump, advance the alias target to the version being upgraded **from** (the immediately-prior shipped version), in the **same commit** as the primary bump. The invariant that matters for a family mid-rollout is always N-1 ↔ N — "the version I'm coming from can exchange bytes with the version I'm going to." Freezing at 3.2.6 forever would test a migration no live user performs after the first ship. The alias name stays `-legacy`; only its pinned version moves. If a future bump also drops support for reading a very old format, that is the moment for an explicit decision — not something to discover via a stale alias.
- Regenerate `package-lock.json` via `npm install`.
- Close Dependabot **#302** as superseded once the direct bump is on `main` (do **not** delete its branch until closed).

### 2. Checked-in cross-version compat test

Create `src/services/automerge/__tests__/crossVersionCompat.test.ts` — a permanent, self-contained port of the spike:

- Import the current engine as `import * as AmNew from '@automerge/automerge'` and the pinned prior engine as `import * as AmOld from '@automerge/automerge-legacy'`.
- Build a small representative doc mirroring `FamilyDocument` shape by reusing the **production** helpers exported from `../worker/docOps` — `migrateDoc` (docOps.ts:38) to seed the doc and `applyMutation` (docOps.ts:520) to add entities — rather than hand-rolling a fixture, so the test exercises our real document shape, not an abstract map. Note `withTodo`/`base` in `docOps.test.ts` are **local closures, not exported**, so they cannot be imported; re-declare the same one-line `withTodo = (doc, id, extra) => applyMutation(doc, { op: 'set', collection: 'todos', id, entity: { id, ...extra } }).doc` wrapper in the new test. Do **not** duplicate any projection logic — reuse `buildFullProjection` (docOps.ts:280) for state comparison.
- Assert, exchanging **bytes** across the boundary (never a live doc handle):
  1. **Snapshot round-trip, new→old:** `AmOld.load(AmNew.save(doc))` materializes with identical projected state.
  2. **Snapshot round-trip, old→new:** `AmNew.load(AmOld.save(doc))` ditto.
  3. **Incremental delta, new→old:** apply a change on new, `saveIncremental`, `AmOld.loadIncremental` onto the old-loaded doc, state converges.
  4. **Incremental delta, old→new:** symmetric.
  5. **Cross-version concurrent merge:** old and new each apply a disjoint change to a shared base; merge via exchanged bytes; both converge to the same heads/state.
- **Engine-binding constraint (must observe — this is the subtle failure mode).** `migrateDoc`/`applyMutation`/`buildFullProjection`/`saveDoc`/`loadDoc` from `docOps.ts` are bound to the _new_ automerge import only — calling them on an `AmOld` doc handle is a wasm-instance mismatch that can throw or, worse for a _compat_ test, silently return a wrong projection that still compares equal (a silent failure in the very test meant to prevent silent failures). Therefore: build and mutate the base doc on `AmNew`, and for every assertion project **through the new engine** — for any old-side result (e.g. after `AmOld.loadIncremental`), funnel it back as bytes: `AmOld.save(oldDoc)` → `AmNew.load(...)` → `buildFullProjection`. One projection code path, never a `docOps` helper against the legacy wasm. **Codify both rules as a top-of-file comment block** in `crossVersionCompat.test.ts` (~4 lines: `AmOld` handles are a foreign wasm instance → only ever cross the boundary as bytes, never pass an `AmOld` doc into a `docOps` helper; plus a pointer to the step-1 alias future-bump convention), so they survive independently of this plan doc for whoever edits the test later.
- The assertions compare **projected application state** via the exported `buildFullProjection` (docOps.ts:280 — the exact function the worker uses, run on the new engine), plus `getHeads()` equality for the merge case — not raw byte equality (bytes legitimately differ across engine versions).
- Because CI's `main-ci.yml` runs `npm run test:run` (vitest) on every push to `main`, this test guards the invariant automatically — no workflow change needed.

### 3. Run the existing suites against 3.4.0

No code changes expected in the worker/sync layer (the API surface is stable). Run:

- worker suites: `cache`, `applyAndProject` (+ `applyAndProject.mergeRecovery`), `docOps`, `photoOps`, `docClient`;
- the sync suites that round-trip through `Automerge.load`/`save` (`fetchAndMergeRemote`, `saveFailureTracking`, `vacationPersistence`, `sayingsConcurrentEdit`);
- the full unit suite.

If anything fails, it is a real behavioral delta in 3.4.0 and must be understood before proceeding (not patched over).

### 4. Post-deploy perf confirmation (no new instrumentation)

The perf signals **already exist** — `automerge.remoteLoad` (`fileSync.ts:130`, `applyAndProject.ts:387`) and `automerge.pushProjection` (`applyAndProject.ts:345,407`) flow through `perfTiming` → CloudWatch. After deploy, compare these on greg's real large `.beanpod` against the pre-deploy 3.2.6 baseline for the same file. Expect the spike's direction (faster load/apply); the acceptance bar is **no regression**.

## Files Affected

- `package.json` — bump automerge to 3.4.0 (pinned); add `@automerge/automerge-legacy` devDependency alias.
- `package-lock.json` — regenerated.
- `src/services/automerge/__tests__/crossVersionCompat.test.ts` — **new** checked-in cross-version compat test.
- `CHANGELOG.md` — an entry under today's date (Changed/Performance: faster large-file load + sync; Fixed: latent silent-corruption bug in the CRDT engine; note that the cross-version compat baseline is now pinned at the upgraded-from version, 3.2.6, so future bumps have an auditable trail per the step-1 convention).
- `docs/STATUS.md` — mark tracker #59 done once shipped; retire the "#59 ready to plan" line.
- (No change to any worker/sync source file is expected. If the suites force one, it is documented in the commit + here.)

## Observability Coverage

This is a data-layer engine swap; the relevant diagnostics **already exist** and this change deliberately preserves them rather than adding new keys.

- **Load-failure path (the one real failure mode).** A 3.4.0 read incompatibility surfaces through **two** existing guards, not one: (a) a throw inside `Automerge.load`, wrapped in `measureSync('automerge.remoteLoad', …)` and re-thrown as `CorruptPayloadError` (`Automerge.load failed on decrypted payload: …`, fileSync.ts:130-138); and (b) the **materialize sanity check** at `fileSync.ts:141-153`, which forces a first property read (`doc.familyMembers`) because `Automerge.load` can accept bytes that parse yet throw on materialize, re-thrown as `CorruptPayloadError` (`Automerge materialize failed on decrypted payload: …`). The worker path (`applyAndProject.ts`) has `mergeRecovery`. The one residual failure a throw cannot catch — bytes that materialize _without error_ but into wrong state — is exactly what the new `crossVersionCompat.test.ts` projection-equality assertions guard in CI. No bare catch, no silent fallback. **No change required; confirm both messages still read correctly post-bump.**
- **Perf signal (success path, for the uplift claim + future alerting).** `automerge.remoteLoad` and `automerge.pushProjection` are emitted on every load/projection via `perfTiming.record` → CloudWatch, correlated by `family_id`. These are the measurable _rates_ that confirm the perf win and would catch a future regression. Mind the `TELEMETRY_FLOOR_MS = 250` floor — large-doc loads are well above it; the synthetic sub-floor cases in the spike aren't the target here.
- **Critical vs. telemetry:** a `.beanpod` load failure is already "user action failed / data at risk" and routes through the existing `reportError` path in the sync layer — no new `severity: 'critical'` call is introduced by this change.
- **Privacy/store gate:** **no new `context` key ships** → no `ALLOWED_CONTEXT_KEYS` (`logEvent.ts`) or store-declaration change. (Called out explicitly so a reviewer can confirm the gate is a no-op here.)

## Acceptance Criteria

- [ ] `@automerge/automerge@3.4.0` installed (pinned); `@automerge/automerge-legacy` alias present in `devDependencies` only.
- [ ] `src/services/automerge/__tests__/crossVersionCompat.test.ts` exists and passes in CI: snapshot round-trip both directions, incremental delta both directions, cross-version merge convergence.
- [ ] Full unit suite + all worker/sync suites green against 3.4.0.
- [ ] `npm run type-check`, `npm run lint`, `npm run format:check`, `npm run build` all green.
- [ ] The legacy alias is confirmed **absent from the production bundle** (bundle grep in Testing).
- [ ] Dependabot #302 closed as superseded (branch left intact until closed).
- [ ] Post-deploy: `automerge.remoteLoad` / `automerge.pushProjection` on greg's real large `.beanpod` show no regression vs. the 3.2.6 baseline (the perf uplift direction confirmed).
- [ ] Diagnostic logging in **Observability Coverage** verified: a forced bad-load still throws the descriptive `fileSync.ts` error; perf labels still emit; no new context key.

## Testing Plan

1. **Install + lock:** `npm install`; confirm `package-lock.json` resolves 3.4.0 for the primary dep and 3.2.6 for the `-legacy` alias.
2. **Cross-version test:** `npm run test:run -- src/services/automerge/__tests__/crossVersionCompat.test.ts` — all five assertions pass.
3. **Worker + sync suites:** `npm run test:run` (full) — everything green; pay attention to `applyAndProject.mergeRecovery`, `docOps`, `fetchAndMergeRemote`, `sayingsConcurrentEdit`.
4. **Static gates:** `npm run type-check && npm run lint && npm run format:check`.
5. **Build + bundle check:** `npm run build`; then grep the emitted `dist/` for the legacy alias to prove it is dev-only, e.g. `! grep -rl "automerge-legacy" dist/` (must find nothing).
6. **Manual smoke (local):** load an existing real `.beanpod` in the dev app, make an edit, save, reload — data intact, no console errors. (This is the human-visible proof the format round-trips.)
7. **Post-deploy (greg, real device/file):** open the real large `.beanpod`; compare CloudWatch `automerge.remoteLoad` / `pushProjection` against the pre-deploy baseline for the same file → no regression.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the bump + npm-alias approach that makes a permanent both-directions cross-version CI test runnable from a single install; confirmed existing perfTiming/error paths cover observability with no new keys; scoped #302 as superseded (pinia-pattern).
- **Pass 2 (DRY + error handling)**: Corrected the DRY claim — `withTodo`/`base` are private test closures, not importable; reuse only the exported `migrateDoc`/`applyMutation`/`buildFullProjection` from `docOps.ts`, and added the wasm-engine-binding rule (funnel all old-side results through the new engine as bytes) to prevent a silent mis-projection in the compat test; named `CorruptPayloadError` and fixed `fileSync.ts` line ranges.
- **Pass 3 (Sustainability)**: Added an explicit future-bump convention so the `-legacy` alias tracks the upgraded-from version (advanced in-commit on every bump) instead of rotting at a frozen 3.2.6 baseline; required the engine-binding + alias rules to live as in-file comments in the compat test; had the CHANGELOG record the pinned baseline for auditability. Confirmed the #302 close-as-superseded flow is correct (bump + guard test must land atomically).
- **Pass 4 (Fresh-eyes sweep)**: Verified all line references and reuse claims against the codebase — plan is sound. Two material additions: made rollback safety explicit (native builds ship embedded and can't be instantly reverted, so rollback relies on the same proven new→old byte compat rather than un-writing v1 bytes), and completed the load-failure story to name both existing `fileSync.ts` guards (load throw + materialize sanity check), with the CI compat test covering the silent-wrong-state residual.

## Prompt Log

> No GitHub issue created — this plan was approved for direct implementation. Full prompt history below.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-pre-plan #59 → /beanies-plan, assembled block)

```
=== BEANIES PRE-PLAN ===
Title:        Upgrade @automerge/automerge 3.2.6 → 3.4.0 (hexane v1 engine)
Type:         feature
Priority:     high
Surfaces:     platforms: [All (web / PWA / iOS / Android)]  •  area: overall (data layer — CRDT engine)
Category:     data
Objective:    Adopt @automerge/automerge 3.4.0 (hexane v1 storage-engine rewrite): perf uplift, TWO silent-corruption
              bug fixes (one present in 3.2.6), O(n²) fix. Automerge.save() output IS the durable .beanpod payload and
              drives ADR-032 worker delta sync. 2026-08-11 compat spike PROVED v0→v1 risk retired (both directions,
              snapshot + incremental + merge). Normal ship. Remaining: codify spike as CI test + land the bump.
User story:   As a family relying on beanies to hold years of data, I want the CRDT engine on the latest fixed version
              so my file loads faster and known silent-corruption bugs are gone — with zero risk to my existing files.
UX / mockup:  no — pure data-layer change.
Scope (do):   bump 3.2.6→3.4.0 (PR #302 vehicle); codify spike as checked-in Vitest (both directions + merge); run
              worker + full unit suites; npm run build green; measure perfTiming vs 3.2.6 baseline on greg's real .beanpod.
Out of scope: pinia 4 / web-vitals 6 / other bumps; fragments API; history-compaction.
Acceptance:   3.4.0 installed; build + suites green; CI compat test passes; perf direction holds on real .beanpod; no
              data loss; mixed-version delta sync converges.
Edge cases:   +6% snapshot size (accepted); mixed-version compat proven both directions; target settled 3.4.0 NOT
              3.3.0/3.3.1; .beanpod carries save() binary — read incompat = load failure not silent no-op.
Reuse hints:  fileSync.ts, worker/{docOps,cache,applyAndProject}.ts; worker __tests__/*; package.json/lock; PR #302.
References:   spike scratchpad/am-compat/harness.mjs (6/6); PR #302; hexane v1 automerge/automerge#1432; ADR-032.
Open Qs:      RESOLVED — perf baseline uses greg's own real large .beanpod; all-at-once ship safe (spike).
Notes:        Filed as Feature (no chore type); reliability driver = silent-corruption fix in 3.3.x/3.4.0.
GitHub issue: SKIP.   Feature gate: NO — ship ungated.
=== END PRE-PLAN ===
```

</details>
