# Plan: Fix 10 data-integrity / resilience defects from the max-effort code review

> Date: 2026-07-13
> Related issues: None — direct implementation (bug-fix batch). Remediates commits `6c76e088` (worker-death-recovery, live `0.9.4R11`) and `03120fdc` (#47 open-a-.beanpod-from-any-account, live `0.9.4R13`).
> Plan file: `docs/plans/2026-07-13-data-integrity-review-fixes.md`
>
> **`file:line` anchors are planning-time (main @ `8aeb881a`) and will drift — locate by symbol, not line.**

## User Story

As a beanies.family user, I want my data to load reliably and my edits to always persist to a real, correctly-scoped save location — even after the doc-worker is reaped, or when I open a saved/restored `.beanpod` — so that the app never silently loses my data, writes it into the wrong account, or freezes.

## Context

A max-effort, adversarially-verified code review of `6c76e088^..HEAD` found **10 defects** (9 CONFIRMED, 1 PLAUSIBLE), dominated by **silent data-integrity failures** in two live-in-prod areas: the ADR-032 doc-worker self-heal (`6c76e088`, `0.9.4R11`) and the #47 `establishDurableHomeAfterLoad` re-home (`03120fdc`, `0.9.4R13`). The tested happy paths (Chrome/Windows File System Access load; normal same-account Drive login) work; the bugs are in the recovery, native-input, web-Picker, and name-collision paths. greg chose to fix all 10 in one coherent remediation and ship as a batch.

The exact mechanics below were confirmed by a grounding investigation (this session), re-verified during Pass 2 against the live code, re-checked for sustainability in Pass 3, then re-grounded against live API shapes in Pass 4 (all cited APIs verified real).

## Requirements

Fix all 10, with no regression to: Chrome/Windows FSA load; normal same-account Google Drive login (the re-home idempotent-skip must stay a true no-op there); the invite/join flow (`useJoinFlow` — intentionally keeps reading the inviter's shared Drive file, and never routes through `finishLoaded`, so it must stay untouched); the create-a-family flow.

1. **A1 (CRITICAL):** worker recovery must never deadlock — recovery-rehydrate must not await the in-flight `spawn()` that is awaiting it.
2. **A7 (MEDIUM):** a slow-but-alive worker must not be torn down (dropping an in-flight `mutate`) on a lone light-op timeout — corroborate death before teardown.
3. **A9 (LOW):** `doc-worker-recovery` telemetry must carry its diagnostic context (not be silently stripped).
4. **B2 (CRITICAL):** every successful decrypt — including the single-member auto-sign-in path — must establish a durable writable home.
5. **B3 (CRITICAL):** the native local save file must be familyId-unique so a restored backup never clobbers another family's local pod.
6. **B4 (CRITICAL):** a Drive filename collision during re-home must adopt the existing owned file, not silently fall through to a divergent local file.
7. **B5 (HIGH):** the re-home idempotency guard must re-home a file loaded from **another account** (foreign/shared), not keep writing into it.
8. **B6 (HIGH):** the silent Drive re-home must reuse the valid token (no interactive OAuth redirect mid-restore).
9. **C8 (MEDIUM):** the "open a saved file" surface must always offer a path or clear guidance, never silently vanish.
10. **D10 (LOW):** remove the orphaned `loginV6.localFileCardDesc` string.

## Important Notes & Caveats

- **B2 + B5 are coupled and must be fixed together.** Both hinge on the same guard (`syncStore.ts:2162`). Fixing B2 (run re-home on the single-member path) without B5 (guard can't tell a foreign file from our own home) would make the app _more_ likely to skip re-home on a legitimately-loaded foreign file. **Do the guard rework (B5) first, then wire the chokepoint (B2).**
- **`establishDurableHomeAfterLoad` is idempotent** (the `:2162` guard returns early once a provider is installed for the active family), so a belt-and-suspenders call from two branches is safe — but "safe to call twice" ≠ "does the right thing"; B5 must make the guard _correct_, not just idempotent.
- **B5 MUST be a guard-only change — do NOT alter `decryptPendingFile`'s provider install.** Verified: `useJoinFlow` calls **both** `loadFromGoogleDrive` (`:420`/`:497`) **and** `decryptPendingFile` (`:677`). A joiner reads the inviter's shared file (`ownedByMe:false`) and _must_ keep it installed as the provider (the intended collaborative model). Any "skip installing the foreign Drive provider on `ownedByMe===false`" approach would break join. Because `establishDurableHomeAfterLoad` is the _only_ thing join never calls, all re-home logic lives there — `decryptPendingFile`'s existing `setProvider(fromExisting(...))` stays exactly as-is.
- **The join flow (`useJoinFlow`) is naturally out of scope** for re-home — it never routes through `LoadPodView.finishLoaded`, so it never invokes `establishDurableHomeAfterLoad`. Do not add re-home to it.
- **A1 is a live app-freeze for all prod users** and fires in the exact scenario recovery targets (backgrounded mobile PWA). Although greg chose one batched plan, A1 is the top-priority fix; if the batch slips, A1 should ship first.
- **Native re-home paths (B2 partially, B3, B6) verify live-only** on the next mobile build (greg tests iOS/Android only on deployed builds). Web paths (B4, B5, C8) + worker (A1, A7, A9) verify on the prod web deploy + the unit suite.
- **Do NOT reduce the two-tier worker timeout** (45s light / 120s heavy) or the genuine dead-worker recovery — A7 tightens the _classification_, not the recovery itself.
- **Sequencing (Pass-3): land as three reviewable, independently-bisectable commits within the one batch/PR — do NOT split into separate PRs.** The groups touch disjoint files with no shared code path, so a per-group commit keeps any future regression bisectable to a single concern:
  1. **A-group (worker):** A1 + A7 + A9 — `docClient.ts` + telemetry mirror + worker tests. Fully self-contained; ships first (A1 is the live freeze).
  2. **B-group (re-home):** B5 → B2 → B3/B4/B6 in that internal order (per the coupling note) — `syncStore.ts`, `LoadPodView.vue` (B2), `syncService.ts` (B3) + `establishDurableHome` test.
  3. **C/D-group (login surface):** C8 + D10 — `LoadPodView.vue` (render/disable) + `uiStrings.ts`/`zh.json`. Pure UI/i18n.
     A1 may be its own commit if greg wants the freeze fix landable in isolation.

## Assumptions

> Review before implementation. Valid at planning time (2026-07-13).

1. **B5 ownership signal (Pass-3: derive at the guard, don't thread a snapshot):** the loaded Drive file's true owner is knowable via `getFileMetadata(token, fileId, 'ownedByMe')` (already exported from `driveService.ts`, arbitrary-`fields`; both `getFileMetadata` and `requestAccessToken` are already imported in `syncStore.ts`). We derive ownership **at the decision point inside `establishDurableHomeAfterLoad`**, off the already-installed Drive provider (`getProvider().getFileId()` — `getFileId()` is a public accessor), using a silent `requestAccessToken()` — NOT captured at load time and threaded through a second store ref (see B5 for the rationale: a threaded reactive snapshot re-introduces the stale-cross-family-state class this very guard is fixing). `provider.getAccountEmail()` is NOT reliable (it falls back to the session account, not the file owner). **If the fetch fails, we treat ownership as unknown → re-home** (conservative: never keep writing into a possibly-foreign file) AND log a `warning` (never silent).
   - **Pass-4 verified cost & residual:** a normal same-account Drive login today short-circuits at the `:2162` guard as a pure no-op; B5 turns that same case into a single `getFileMetadata` GET. **Accepted** — one lightweight metadata read, once per _load_ (never on the save hot path), token already in hand behind `isTokenValid()`, on an already network-bound user sign-in. Residual: a _transient_ metadata failure on a same-account login yields `ownership-unknown → re-home`; for the common `${familyName}.beanpod` case this **self-heals** (B4's mint collides by name → `resolveExistingBeanpod` returns `adopt-existing` (owned) → we re-adopt the same file). Only a renamed-family same-account login whose fetch _also_ transiently fails would mint a distinct own-account duplicate — no data loss (the doc flushes to the new own file; the original is orphaned, registry-recoverable). We keep the security-conservative default (a cross-account write is the graver failure) and make the residual **observable** via the `ownership-unknown` warning (B5), not silent.
2. **B3 migration:** native cold-boot restore is **config-based** (`initialize` reads the exact `localPath` from the persisted provider config), so renaming the filename scheme is safe for **new** files without migrating existing ones — an already-created native pod keeps working via its stored config. No user has a #47-re-homed native file yet (native re-home ships only in the next mobile build). Existing native _create-flow_ pods keep their stored path.
3. **A9 keys are PII-free** (`method` enum, `attempt` int, `lostSiblings` bool) → allowlistable; renaming to snake_case (`recovery_method`, `recovery_attempt`, `lost_siblings`) to match the existing convention and avoid semantic collision. Likely no new _declared_ data-collection surface (diagnostic enums/bools), but confirm against the runbook table.
4. **A7:** a 5s `ping` (`checkWorkerLiveness` / `PING_TIMEOUT_MS`) reliably distinguishes a live-but-busy worker from a dead one; the ping runs on the worker's serial queue but `ping` does no compute, so a live worker answers quickly even behind a slow op **only if the queue head isn't wedged** — see Approach A7 for the ordering nuance and the ping re-entrancy exemption.

## Approach

### A1 — Break the recovery-rehydrate re-entrancy (`docClient.ts`)

**Root cause:** `ensureReady()` sets `readyPromise = spawn()` _before_ spawn resolves; `spawn()` then `await rehydrator(currentFamilyId)` (`:301`); the production rehydrator (`bootstrap.ts:21`) is `initAndLoadCache → request → requestCore → ensureReady()`, which returns and awaits the still-pending `readyPromise` → circular deadlock. Verified: at that `await`, `mode==='worker'` (`:298`) and `worker` is non-null (`:284`).

**Why the flag — and not "rehydrator bypasses the public API":** `readyPromise` deliberately conflates _worker-ready_ with _rehydrate-complete_ so that **all other** in-flight RPCs block until the doc is reloaded from cache (the read-after-respawn barrier — otherwise a concurrent read returns an empty doc and the user's data appears lost until rehydrate lands). We must let **only the rehydrate RPC itself** through while keeping every other caller blocked. A module flag is the minimal primitive that expresses exactly that selective bypass, and it reuses the existing send/await machinery (`pending` + `postRaw` + `withTimeout`) rather than duplicating it. Resolving `readyPromise` early, or hand-rolling a direct send inside the rehydrator, would either break the barrier or duplicate `requestCore` — both rejected.

**Pass-3 note on the module flag:** `docClient.ts` is already a deliberate module-singleton (`readyPromise`, `mode`, `worker`, `needsRehydrate`, `familyKey`, `currentFamilyId`, `rehydrator` are all module-level mutable state). `rehydrating` is consistent with that established pattern — it is **not** a new class of hidden global state, and a class/context wrapper would be a large refactor of a singleton module for no functional gain. The only real maintainability risk is a _leaked_ `true` wedging every future RPC into the bypass, so we constrain it to the narrowest possible scope and prove the reset:

**Fix:** introduce a module flag `rehydrating`, set `true` **only** immediately before `await rehydrator()` in `spawn()` and cleared in the matching `finally` (toggled nowhere else — a one-line invariant comment states this). In `requestCore`, **before `await ensureReady()`**, if `rehydrating === true` (and `mode === 'worker'` and `worker` non-null — both already true at that point), skip `ensureReady()` and post directly: register in `pending`, `postRaw({cid, method, args})`, then fall through to the **same** `withTimeout` wrapper. Everything else (`pending`, `postRaw`, `withTimeout`, delta apply) is reused unchanged.

- **Re-entrancy carve-out on timeout:** in `requestCore`'s catch, if `rehydrating === true`, a timed-out rehydrate RPC must **reject only itself** (`throw surface(timeoutErr, method, opts.quiet)`) and must **not** call `recoverDeadWorker` — recovery would reset `readyPromise`/tear down mid-spawn and re-enter. `spawn()`'s existing `catch` (`:304`) then logs + continues (worker still usable; a genuinely wedged worker is caught by the next real RPC's normal timeout path). This is the single new branch; it classifies + logs, never swallows.
- **Reset invariant test (Pass-3):** in addition to the deadlock regression, assert `rehydrating === false` after **both** a successful rehydrate **and** a throwing rehydrator (the `finally` clears it either way) — this is the guard against a future edit leaking the bypass flag.
- **Regression test:** wire a realistic rehydrator (routes through `initAndLoadCache`) + a non-null `currentFamilyId`, trigger a RETRYABLE timeout → assert recovery completes (`readyPromise` resolves, the retried RPC succeeds) rather than hanging. This is the exact gap the current tests miss (`rehydrator=null` / `currentFamilyId=null`).

### A7 — Corroborate worker death before teardown (`docClient.ts`)

**Root cause:** at `:466-471`, a lone light-op timeout with no HEAVY sibling in `pending` is classified as death and calls `recoverDeadWorker`, draining an in-flight (possibly still-progressing) light `mutate`. `heavyStillInFlight` only spares a HEAVY sibling.

**Fix (cheap check first, then corroborate):**

1. **Extend the sibling check** — before pinging, spare the worker when a non-heavy `mutate` is also in `pending` (a `mutate` means the worker has real work; a sibling light-op timeout is not proof of death). Reject only the timed-out call. Minimal change that covers the confirmed scenario and avoids a round-trip in the common case.
2. **Otherwise corroborate with a fast liveness `ping`** before `recoverDeadWorker(...)`: reuse the `ping` RPC with the short `PING_TIMEOUT_MS` ceiling. If the ping **answers** → worker alive, false positive → reject only the timed-out call (`throw surface(timeoutErr, ...)`) and leave the worker + other in-flight RPCs running (pre-change behaviour), emitting `logEvent` (info, `doc-worker-recovery`, `action:'liveness-false-positive'`). If the ping **times out** → proceed with `recoverDeadWorker` exactly as today.

- **Ping re-entrancy exemption (Pass-3 — MUST):** the corroboration `ping` is itself issued through `requestCore`, so its own timeout re-enters this same catch. Without a guard it would try to corroborate a ping _with another ping_ → unbounded recursion. **Add `method !== 'ping'` to the corroboration condition:** a `ping` that times out goes **straight to `recoverDeadWorker`** (the desired death signal), never re-pings. This keeps the corroboration a single, terminating round-trip and is the reliability fix the "ping-inside-the-timeout-path" concern surfaces.
- **Ordering nuance:** `ping` sits behind the same serial FIFO, so a genuinely-wedged heavy op at the head blocks the ping too → it times out → correctly still tears down (the _desired_ death signal). A legitimately-progressing light `mutate` completes, the ping answers → no teardown.
- **No silent path / no double-report:** the ping call already routes through `requestCore`; a ping timeout runs `recoverDeadWorker` + its `warning` telemetry inside `requestCore` (its own timeout path, now terminating via the exemption), so the outer caller must not also report. The false-positive branch emits its own info event. Every branch logs.
- **Test:** slow light `mutate` in `pending` + a `getHeads` timeout → worker NOT torn down, `mutate` not dropped; genuinely dead worker (ping times out) → recovery still fires; **a timed-out ping does NOT recurse** (asserts the exemption).

### A9 — Restore recovery telemetry (`diagnosticContext.ts` + Lambda mirror)

Rename `method`/`attempt`/`lostSiblings` → snake_case `recovery_method`/`recovery_attempt`/`lost_siblings` and add to **all four** sites, mirroring how `incr_*` / `cache_persist_*` were added:

1. `src/utils/diagnosticContext.ts` `ALLOWED_CONTEXT_KEYS` (dated comment block).
2. `infrastructure/lambda/telemetry/index.mjs` `ALLOWED_CONTEXT_KEYS`.
3. `infrastructure/lambda/telemetry/__tests__/handler.test.mjs` — add to the sorted `expected` array (keep alphabetical).
4. Update the `docClient.ts` `requestCore` `reportError` `context` (`:476`) to the renamed keys.

- Store-declaration: diagnostic enums/ints/bools (PII-free); update `docs/runbooks/native-store-submission.md` §1 only if the declared Diagnostics surface actually changes (it likely doesn't). Confirm and note either way.

### B5 — Make the re-home guard distinguish "our own home" from a foreign file (`syncStore.ts`)

**Root cause:** after a Picker-load, `decryptPendingFile` installs `GoogleDriveProvider.fromExisting(pickedFileId)` and `setProvider` sets `currentProviderFamilyId = activeFamilyId`, so the `:2162` guard is true even for a file owned by **another** account → re-home skipped → cross-account writes.

**Fix — derive ownership at the guard from the installed provider; re-home when the installed Drive home isn't owned by the signed-in account. Guard-only; `decryptPendingFile`'s provider install untouched (join safety):**

**Pass-3 simplification — NO second store ref.** The initial draft captured `ownedByMe` in `loadFromGoogleDrive` and threaded it into a store-scoped `loadedDriveOwnedByMe` ref (reset in `loadFromGoogleDrive`/`loadFromNewFile`). That re-introduces exactly the failure class B5 exists to kill: a reactive snapshot that must be manually reset in N places and can go stale across a family switch — the same "guard trusts stale cross-family state" bug as the original defect. Instead, **the guard derives ownership itself, at the one point of decision, from the authoritative source (Drive), off the provider it is about to keep or replace.** No capture edit in `loadFromGoogleDrive`, no `loadFromNewFile` edit, no new ref, no reset logic, zero threading surface — one self-contained decision that cannot go stale because it queries live state.

**Rework the guard** (`establishDurableHomeAfterLoad`, the `:2162` block) into flat guard clauses:

- No provider, or `getProviderFamilyId() !== activeFamilyId` → not a home for this family → fall through to establish (re-home). _(unchanged shape)_
- Provider is for this family AND `getProviderType() !== 'google_drive'` (a local FSA / native provider we installed) → genuine own home → skip; `logEvent('info', 'load-existing-family', action:'kept-own-home')`.
- Provider is for this family AND `getProviderType() === 'google_drive'` → **derive ownership now:** `const fileId = getProvider().getFileId()`; acquire a silent token (`requestAccessToken()` — the guard already runs only when `isTokenValid()` on the re-home path, and a valid token returns silently); `const meta = await getFileMetadata(token, fileId, 'ownedByMe')` inside `try/catch`.
  - `meta.ownedByMe === true` → our own Drive home → skip; `logEvent('kept-own-home')`.
  - `meta.ownedByMe !== true` → foreign/shared file → fall through to **re-home** (B4 `reHomeToOwnDrive`); `logEvent('warning', action:'foreign-file-load')`.
  - fetch throws (or `fileId` null) → ownership **unknown** → conservative fall-through to **re-home**; `console.warn` + `logEvent('warning', action:'ownership-unknown')`. Never silent, never "assume ours." **This `warning` is the sole observable signal for the Pass-4 residual (a transient same-account metadata blip that triggers an unnecessary re-home / duplicate mint) — keep it a `warning`, not `info`, so the rare event is countable.**
- **Preserve the no-op** for the same-account listing (own files → `ownedByMe:true` → `kept-own-home`) and never touch `useJoinFlow` (it never reaches this function). This branch now costs one `getFileMetadata` GET on the same-account Drive login that previously short-circuited — accepted per Assumption 1 (load-time only, token in hand, off the save path).
- **Design decision (Assumption 1 / Open Question):** for a file the signed-in account **does** own but that wasn't app-created (a manually-uploaded own backup), keeping it as the home satisfies "your Drive is the home" — so we re-home only foreign-owned (or ownership-unknown) files. If greg prefers "always mint a fresh app-owned copy for any aside-load," that's a stricter variant (creates a duplicate for own files) — flagged.

### B2 — Ensure re-home runs on every successful decrypt (`LoadPodView.vue`)

`finishLoaded()` already wraps `establishDurableHomeAfterLoad()` in a `try/catch` that logs and never blocks (`:207-214`). **Reuse that exact wrapper** — extract its body into a tiny local `ensureDurableHome()` (`try/catch`, no emit) so both call sites share one implementation (DRY), then:

- `finishLoaded()` calls `await ensureDurableHome()` before `emit('file-loaded')` (unchanged for all `file-loaded` paths), AND
- `handleDecrypt`'s single-member branch calls `await ensureDurableHome()` **before** `emit('signed-in','/nook')` (`:457`) — the branch that currently returns without reaching `finishLoaded()`.

Idempotency means the multi-member path is unaffected and no path double-establishes. Depends on B5 landing first so the guard is correct. **Ordering safe (Pass-4):** on the common single-member same-account path this adds one fast `kept-own-home` metadata GET before `emit('signed-in')`; the re-home block only runs for a genuinely foreign single-member file (its whole purpose), and the `await` was already present on every `finishLoaded` path — no new blocking class on the fast sign-in.

### B3 — Namespace the native local file by familyId (`syncService.ts`)

In `selectNativeLocalFile(baseName)`, build the `CapacitorFileProvider` path with the active familyId so two families never collide: `new CapacitorFileProvider(`${baseName}-${familyId}.beanpod`)` (or a `beanpods/${familyId}.beanpod` subpath — `write` uses `recursive:true`). `getActiveFamilyId()` is already read there (`:716`); when null, keep `${baseName}.beanpod` (no regression). Restore is config-based, so existing native pods keep their stored `localPath` (no migration). Confirm `createNewFile`'s native path routes through this same seam (it does) and that no code compares the filename by a fixed value.

### B4 — Adopt an existing owned Drive file on collision instead of dropping to local (`syncStore.ts`)

Replace the bare `configureSyncFileGoogleDrive(name)` in the Drive re-home branch (today swallows `FileNameCollisionError` → local split-brain) with a collision-aware re-home. **Reuse the existing `connectStorage.ts` helper `resolveExistingBeanpod` (the decrypt-free owned/stub/populated classifier) rather than re-implementing.**

**Pass-3 — flatten the branch tree and single-responsibility the helper.** The collision → resolve → adopt/mint/reject tree must not nest try/catch inside try/catch inside a switch. Structure `reHomeToOwnDrive(name)` as **one try, one typed catch, one flat dispatch**, and extract the shared "mint a distinctly-named own file" tail so the no-collision success and the reject-different-account arm don't duplicate it. The helper **only installs a home and returns an outcome tag** — it does NOT log; the caller (`establishDurableHomeAfterLoad`) owns the `logEvent`, keeping the outcome→telemetry mapping in one place.

Extract a tiny local `mintFreshOwnDrive(uniqueName)`: `const p = await GoogleDriveProvider.createNew(uniqueName, { forceConsent: false }); await installProvider(p, 'google_drive');` (B6: `forceConsent:false`).

`async function reHomeToOwnDrive(name): Promise<ReHomeOutcome>`:

- **Happy path (flat, returns early):** `try { await mintFreshOwnDrive(name); return { action:'re-homed' }; }`
- **`catch (e)` — one catch, dispatch by error class (each arm returns; ≤2 levels deep):**
  - `e instanceof FileNameCollisionError` → `const res = await resolveExistingBeanpod({ fileId: e.existingFileId, ownedByCurrentAccount: e.ownedByCurrentAccount })`, then a flat `switch (res.kind)`:
    - `'adopt-stub' | 'adopt-existing'` → `await installProvider(GoogleDriveProvider.fromExisting(res.fileId, name), 'google_drive')` (writable, own account; `installProvider` re-persists the config, overwriting the foreign one from decrypt) → `return { action:'adopted-existing' }`.
    - `'reject-different-account'` → the same-named file is foreign → `await mintFreshOwnDrive(`${base}-${familyId}.beanpod`)` (short familyId suffix, matching B3) → `return { action:'re-homed' }`. Never write into a file we don't own.
  - `e instanceof CollisionCheckUnavailableError` → retryable — leave provider-less, do **not** guess → `return { action:'collision-check-unavailable' }` (the caller fires the critical `no-backend`/retryable report). Not silent.
  - otherwise (`throw`d for any other reason) → `return { action:'failed' }` → the caller falls through to native/provider-less → critical report (existing).
- **Not-strictly-total (Pass-4 — intended):** `installProvider` inside the `adopt-*` / `reject-different-account` arms can itself throw if its internal `syncNow` write fails; that throw propagates **out** of `reHomeToOwnDrive` (rather than becoming an outcome tag) into the caller's own `try/catch` in `establishDurableHomeAfterLoad`, which falls through to the loud `critical` `no-durable-save-target` report. Acceptable + desirable — document it in a one-line comment so a future reader doesn't assume the return is total.
- **Why `installProvider`, not `adoptDriveStub` (Pass-4):** `connectStorage.adoptDriveStub` installs via `setProvider` + `persist` but does **not** `syncNow`. A re-home must flush the just-loaded in-memory doc into the adopted file and verify it's writable, so `installProvider` (persist + setProvider + syncNow) is the correct seam. The DRY reuse is `resolveExistingBeanpod` (the classifier), not the stub-install tail.

`configureSyncFileGoogleDrive` has no external non-test caller (only `establishDurableHomeAfterLoad`); fold its logic into `mintFreshOwnDrive`/`reHomeToOwnDrive` and delete the now-dead export (or leave a thin `forceConsent:false` wrapper if a test imports it — confirm and prune).

### B6 — Silent Drive re-home must not force interactive OAuth (`syncStore.ts`)

Root cause: old `configureSyncFileGoogleDrive` → `createNew(name)` defaults `forceConsent:true` → `requestAccessToken({forceConsent:true})` clears the token → full-page redirect mid-restore. B4's `mintFreshOwnDrive` fixes this by calling `createNew(name, { forceConsent:false })` on **both** the mint and (implicitly) the reject-different-account mint paths (`fromExisting` acquires the token lazily, never force-consents). The re-home is already gated on `isTokenValid()` (`:2170`), and B5's ownership fetch reuses that same silent `requestAccessToken()`. No re-home branch may trigger an interactive redirect; if a token can't be obtained silently, `createNew` surfaces an error → the helper returns `failed` → fall through to native/provider-less critical report rather than redirecting.

### C8 — Never silently hide the "open a saved file" affordance (`LoadPodView.vue`)

`canOpenSavedFile` (`:99`) currently `v-if`-removes the aside when neither backend exists (self-host + Firefox/Safari). Re-establish the invariant "always show a way OR clear guidance": always render the aside; when no working backend is present, render it **disabled** with a guidance sub-line steering to Chrome/Edge or Drive (reuse the retired guidance intent from the old `auth.localFileUnsupported` message as a new, honestly-scoped i18n string shown as the disabled reason / on click). `canOpenSavedFile` becomes the _enabled/disabled_ decision, not _mounted/not_. Present _guidance_, not a backend that will error.

### D10 — Remove the orphaned string (`uiStrings.ts`)

Delete `loginV6.localFileCardDesc` (en + beanie) and run `npm run translate` to drop it from `zh.json`, mirroring the `auth.localFileUnsupported` retirement this session. (C8 adds one honestly-scoped guidance key; D10 removes one dead key — net-neutral churn.)

## Files Affected

- `src/services/automerge/worker/docClient.ts` — A1 (`rehydrating` flag: set/cleared only in `spawn()`'s try/finally; direct-post before `ensureReady` + timeout carve-out), A7 (mutate-sibling spare + ping-corroborated teardown with the `method !== 'ping'` re-entrancy exemption + false-positive event), A9 (renamed keys).
- `src/services/automerge/worker/bootstrap.ts` — reference only (production rehydrator triggering A1); no change expected.
- `src/services/automerge/worker/__tests__/docClient*.test.ts` — A1 regression + `rehydrating` reset invariant, A7 (busy-not-dead; genuinely-dead; ping-timeout-does-not-recurse).
- `src/utils/diagnosticContext.ts` — A9 allowlist keys.
- `infrastructure/lambda/telemetry/index.mjs` + `__tests__/handler.test.mjs` — A9 Lambda mirror + pinned test.
- `src/stores/syncStore.ts` — B5 (guard rework: ownership derived **at the guard** from `getProvider().getFileId()` + `getFileMetadata(token,…,'ownedByMe')`; **no new store ref, no `loadFromGoogleDrive`/`loadFromNewFile` capture edits**), B4/B6 (`reHomeToOwnDrive` + `mintFreshOwnDrive` reusing `resolveExistingBeanpod`, `forceConsent:false`), `establishDurableHomeAfterLoad` restructure, fold + prune `configureSyncFileGoogleDrive`.
- `src/services/sync/connectStorage.ts` — reused (`resolveExistingBeanpod`); no change expected.
- `src/services/google/driveService.ts` — reused (`getFileMetadata` for `ownedByMe`); no change expected.
- `src/services/sync/providers/googleDriveProvider.ts` — B4/B6 use existing `createNew`/`fromExisting`/`getFileId`/`FileNameCollisionError`; no change expected.
- `src/services/sync/syncService.ts` — B3 (familyId-namespaced native path).
- `src/components/login/LoadPodView.vue` — B2 (`ensureDurableHome` extracted, called before both emits), C8 (render/disable, don't hide).
- `src/services/translation/uiStrings.ts` (+ `zh.json` via `npm run translate`) — C8 new guidance key, D10 remove `localFileCardDesc`.
- `src/stores/__tests__/syncStore.establishDurableHome.test.ts` — extend for B2/B3/B4/B5/B6.
- `docs/runbooks/native-store-submission.md` — A9 store-declaration check (only if the surface changes).

## Observability Coverage

- **A9 is itself an observability fix** — restores `doc-worker-recovery`'s `recovery_method`/`recovery_attempt`/`lost_siblings` (currently ships empty). Verified by the Lambda pinned test + a post-deploy CloudWatch check.
- **B-group re-home:** the existing `load-existing-family` critical `reportError` (no durable save target) is preserved and now reachable on the single-member path (B2). The **caller** (`establishDurableHomeAfterLoad`) maps the `reHomeToOwnDrive` outcome tag → one `logEvent` (info) — `action: 're-homed' | 'adopted-existing' | 'kept-own-home' | 'no-backend'` + `provider_type` (reuse existing allowlisted keys; NO new keys); `collision-check-unavailable`/`failed` route to the critical/retryable report. B5's `foreign-file-load` and `ownership-unknown` branches emit `warning` so cross-account / unverifiable loads are countable. Outcome→telemetry lives only in the caller (the helper never logs), so there's one place to read the mapping.
- **A7:** the corroborated false-positive branch emits `logEvent` (info, `doc-worker-recovery`, `action:'liveness-false-positive'`).
- No new `context` key beyond A9's three. Every new branch classifies + logs — **no silent `catch {}`** (ownership-fetch failure, collision-check-unavailable, ping failure, re-home fall-through all log).

## Acceptance Criteria

- [ ] **A1:** regression test (realistic rehydrator + `currentFamilyId`) proves recovery completes (no deadlock); `rehydrating` is `false` after both success and a throwing rehydrator; manual: backgrounded-PWA worker-reap self-heals without freeze.
- [ ] **A7:** slow in-flight `mutate` + sibling light-op timeout does NOT tear down or drop the mutate; genuinely dead worker (ping times out) still recovers; a timed-out corroboration ping does NOT recurse into another ping.
- [ ] **A9:** `doc-worker-recovery` events arrive with populated `recovery_method`/`recovery_attempt`/`lost_siblings`; Lambda pinned test green.
- [ ] **B2:** single-member `.beanpod` via native picker ends with a working writable provider (edit → reload persists); critical no-target report fires only when genuinely no backend exists.
- [ ] **B3:** restored backup of family B named same as existing local family A does NOT overwrite A (distinct familyId paths); A intact.
- [ ] **B4:** re-home onto an account with a same-named `.beanpod` adopts the existing owned file (no split-brain); `collision-check-unavailable` pages retryably rather than guessing.
- [ ] **B5:** a foreign/shared file is re-homed to the signed-in account's own Drive; saves never write cross-account; same-account listing + `useJoinFlow` unchanged; ownership-fetch failure re-homes conservatively + logs a warning; no new store ref introduced.
- [ ] **B6:** silent Drive re-home reuses the valid token — no interactive OAuth redirect mid-restore on iOS/PWA.
- [ ] **C8:** no-Drive + no-FSA build still shows a way or clear guidance (no silent dead-end).
- [ ] **D10:** `loginV6.localFileCardDesc` gone from `uiStrings.ts` + `zh.json`.
- [ ] Chrome/Windows FSA load, same-account Drive login, `useJoinFlow`, create-a-family all unregressed.
- [ ] `type-check` + `lint` + full unit suite + Lambda tests green; `npm run translate` clean.

## Testing Plan

1. **Unit — worker (A1/A7):** deadlock regression (realistic rehydrator); `rehydrating` reset after success + throw; rehydrate-timeout does not recurse into recovery; false-teardown (busy mutate + ping-alive) vs genuine death (ping-timeout); timed-out ping does not re-ping.
2. **Unit — A9:** Lambda `handler.test.mjs` asserts the three new keys; client `diagnosticContext` keeps them.
3. **Unit — `establishDurableHomeAfterLoad` (B3/B4/B5/B6):** native name-collision → familyId path, A untouched; Drive collision (ownedByMe) → adopt via `resolveExistingBeanpod`; foreign / ownership-unknown → re-home (ownership derived at the guard, no ref); own-account → keep; token-valid re-home calls `createNew({forceConsent:false})`; `collision-check-unavailable` → retryable critical; provider-less → critical.
4. **Unit — `LoadPodView` (B2/C8):** single-member decrypt calls `ensureDurableHome` before `emit('signed-in')`; multi-member unchanged; aside rendered + disabled-with-guidance on no-backend build.
5. **Integration:** cross-account load (foreign V4 envelope) → adopt → re-homed to own Drive, data present, saves target own file; `useJoinFlow` joiner keeps the inviter's shared file (no re-home).
6. **Regression:** same-account Drive login (idempotent skip), `useJoinFlow`, create-a-family — green.
7. **Manual (greg, live builds):** deadlock self-heal + native single-member restore + native name-collision + iOS silent re-home (no redirect) on the next mobile build; web B4/B5/C8 on the prod web deploy.
8. `type-check` + `lint` + full unit + Lambda suites + `npm run translate`.

## Review Passes

- **Pass 1 (Initial draft)**: Grouped remediation from the verified findings + grounding investigation — A1 re-entrancy break via the existing `postRaw` primitive; A7 ping-corroborated teardown; A9 snake_case allowlist keys across 4 mirror sites; B5 guard rework keyed on ownership (done before B2's chokepoint); B3 familyId-namespaced native path; B4 collision-adopt mirroring connectStorage; B6 `forceConsent:false`; C8 honest guidance; D10 string removal.
- **Pass 2 (DRY + error handling)**: Re-verified against live code — B5 confirmed **guard-only** (join calls both `loadFromGoogleDrive` + `decryptPendingFile`, so the decrypt-provider-install must stay); B4 **reuses** `resolveExistingBeanpod` + `getFileMetadata(…,'ownedByMe')` instead of re-implementing; B2 shares `finishLoaded`'s try/catch via one extracted `ensureDurableHome`; A1 flag justified as barrier-preserving; every new branch (ownership-unknown, collision-check-unavailable, ping false-positive) classifies + logs — no silent failures.
- **Pass 3 (Sustainability)**: Dropped the stale-prone `loadedDriveOwnedByMe` store ref — the guard now derives ownership at its single decision point from the installed provider (`getFileId()` + live `getFileMetadata`), eliminating the second-ref threading/reset that would re-create the very stale-state bug B5 fixes; flattened `reHomeToOwnDrive` to one-try/one-catch/one-switch with a shared `mintFreshOwnDrive` and caller-owned logging; added the `method !== 'ping'` A7 re-entrancy exemption (prevents ping-corroborates-ping recursion) plus a `rehydrating` reset-invariant test; kept the `rehydrating` module flag (consistent with the file's deliberate singleton state) but scoped it to `spawn()`'s try/finally only; and sequenced the batch into three bisectable commits (A-worker / B-re-home / C-D-login) within the one ship.
- **Pass 4 (Fresh-eyes sweep)**: Re-grounded every cited API against live code (all real: `resolveExistingBeanpod` kinds, `FileNameCollisionError.existingFileId`/`ownedByCurrentAccount`, `getFileMetadata`→`Record<string,unknown>`, `getFileId`/`getProviderType`/`installProvider`, `createNew` `forceConsent:true` default) and accepted B5's one-time load-path `getFileMetadata` cost — documenting the same-account transient-blip residual as self-healing via B4 and observable via the `ownership-unknown` warning; noted `reHomeToOwnDrive` is intentionally not-strictly-total (an `installProvider` throw propagates to the caller's loud critical report) and clarified why `installProvider` (not `adoptDriveStub`) is the correct adopt seam. No structural change.

> **No GitHub issue created.** Bug-fix batch approved for direct implementation. Prompt history below.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (this session)

The full verified 10-finding review output (Groups A/B/C/D with file:line, failure scenarios, fix directions) from the max-effort `/code-review` of `6c76e088^..HEAD`, plus the constraints/acceptance block. greg's directive: "Plan everything together" — one `/beanies-plan` covering all 10, implement + deploy as a batch. No GitHub issue; ship ungated.

</details>
