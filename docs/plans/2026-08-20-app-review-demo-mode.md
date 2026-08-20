# Plan: App Review demo mode — code-gated, self-seeding demo pod (no Google sign-in)

> Date: 2026-08-20
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-08-20-app-review-demo-mode.md`
> Status: **Approved 2026-08-20** — implemented directly, no GitHub issue.
>
> **Approval decisions:**
>
> 1. **Phase 0 is skipped.** The `pkce.ts` / `inviteService.ts` digest consolidation is not needed for this feature to work and is not being done. It stays recorded here as an optional future cleanup.
> 2. **No mockup.** The UI is one text button plus a `BeanieFormModal` with a single input, both reusing existing components — below the mockup-first bar.
> 3. **Possible future repurposing.** greg noted this may later become a general "try beanies" demo for prospective users, not just store reviewers. That is explicitly **out of scope now** — nothing here is built for it. It does change one thing: at retirement, consider whether to _repurpose_ rather than delete (see §Retirement). Any such change would need its own plan, because a public demo has a different threat model (no secret code, abuse/rate-limit concerns, and the expiry would have to go).

## User Story

As an Apple / Google Play app reviewer, I want to reach the fully-functional app without signing in to a Google account, so that Google's 2FA and risk-based "verify it's you" challenges on `beaniesdemo@gmail.com` cannot block my review.

## Context

beanies.family's only two ways in are **create a pod** (needs storage: Drive OAuth or a local file) and **load a pod** (needs an existing `.beanpod`). For store review we supplied `beaniesdemo@gmail.com` as a demo Google account. Reviewers report being challenged for a verification code on every sign-in.

That is not fixable on the Google side. 2-Step Verification can be turned off, but Google's risk engine still issues a "verify it's you" challenge for sign-ins from unfamiliar device + IP + country — which is exactly what a reviewer VM in Cupertino or Shanghai looks like against a young, low-activity account. There is no consumer setting that disables it. (A Workspace admin can suppress login challenges for 10 minutes per user, which is useless against a review queue.)

Apple's own App Review Information guidance is the intended path: if an app requires third-party sign-in, supply **a demo account or a demo mode that does not require it**. This plan ships the demo mode.

### The constraint that shapes the whole design

**Apple releases the binary it reviewed.** There is no "review build" separate from the shipped build — the same IPA/AAB that passes review is what users download. So "inert outside review builds" cannot mean "absent from the store binary". It means:

1. The bypass ships **disarmed by default** — it only exists when a build-time env var is explicitly set, so web, dev, self-host and any un-armed lane **short-circuit it at runtime and never fetch its code chunk**, and
2. When armed, it is **useless without a secret** (a SHA-256-hashed code, never the plaintext, in the bundle), and
3. It **expires on a baked-in date**, so an armed build turns the bypass off by itself once the review window has passed — no new release, no remote kill switch, no server dependency.

Those three together are the security model. The plan states it plainly rather than implying the code can be hidden from a shipped binary.

**Pass 4 correction — do not claim tree-shaking.** Pass 3 said an un-armed build has the bypass "fully tree-shaken". That is not true and should not be relied on: `features.reviewDemo` is `flagOn(env.VITE_REVIEW_DEMO) && ok(env.VITE_REVIEW_DEMO_CODE_HASH)` — two _function calls_ over Vite-injected literals, which Rollup will not reliably constant-fold, so the gate code stays in the bundle. The three guarantees that _are_ real and testable:

- the gate evaluates false at runtime, so no affordance renders and no code is ever accepted;
- `seedDemoFamily` is behind a dynamic `import()`, so the fixture + seeding chunk exists but is **never fetched** in an un-armed build (asserted in Testing §10);
- the plaintext code is **not in the bundle at all**, in any lane — only its SHA-256 is, and only in the two armed release lanes.

Claiming tree-shaking would have led someone to skip the runtime guards later. It is the guards, the hashed secret and the expiry that do the work.

### This is a temporary feature — design it to be deleted

The single most important sustainability fact about this plan: **demo mode has a finite life.** It exists to unblock a store submission, it carries a baked-in expiry date, and it touches a small number of production files that have nothing to do with it. Features like this rot into permanent, un-owned complexity unless removal is designed in on day one.

So the plan carries:

- a **`REVIEW-DEMO:` grep marker** comment on every production-file touchpoint, so retirement is `grep -rn "REVIEW-DEMO:" src/ .github/` and not archaeology;
- a **written retirement checklist** in the runbook (§Retirement), owned alongside the submission text it supports;
- a **blast-radius rule**: nothing in this plan may be a prerequisite for anything else in the codebase. Every extracted/shared primitive must be independently valuable and independently revertible.

### What Pass 2 established (verified against the code, not assumed)

Pass 1 was drafted from plausible-sounding architecture. Reading the actual code invalidated four of its steps and revealed several reusable seams it was about to duplicate. Everything below is grounded in verified signatures.

**Corrections (Pass 1 was factually wrong):**

- `syncStore.createNewFile` is `(_podFileName, password, memberId, familyId, familyName, heardVia?) => Promise<CreatePodResult>`. It takes **no options object**, and it **never throws** — it returns a discriminated union `{ ok: true } | { ok: false, reason, error }`. Pass 1's `createNewFile(demoPassword, { skipRegistryRegistration: true })` inside a try/catch does not compile and would never catch anything.
- **The "new family pod" Slack ping is fired by `createNewFile` itself** (step 8, `slackNotify(...)` at `syncStore.ts:1791`), _not_ by `CreatePodView`. Pass 1's caveat "do not route through CreatePodView, that component owns the Slack ping" was wrong and would have shipped a reviewer-triggered Slack ping to `#beanies-*` on every demo tap. `CreatePodView` owns only the **Substack** subscribe (`everybeancounts.substack.com/api/v1/free`, ~line 136) and the survey.
- `signUp({ deferPassword: true })` builds the owner with the `DEFERRED_PASSWORD_HASH` sentinel, and `createNewFile` has a **fail-closed precondition that refuses to write a pod whose owner still carries that sentinel** (`syncStore.ts:1618`, reports `severity: 'critical'`). Pass 1's `deferPassword: true` would have hard-failed every seed _and_ paged `#beanies-errors` for it. The demo must call `signUp({ password: DEMO_PASSWORD, ... })` (non-deferred) — no `rehydrateOwnerDoc` step needed.
- Writing ~80 fixture records "through the normal stores" is not neutral: `transactionsStore.createTransaction` fires `celebrate('first-transaction')` (a confetti overlay), fires `window.plausible('feature_used')` per record, and cascades balance / goal / loan recalcs — so Pass 1's approach would confetti the reviewer, push ~80 fake conversion events into Plausible, and do ~80 serial worker round-trips.

**Reuse found (Pass 1 was about to duplicate it):**

- `src/services/e2e/dataBridge.ts` already contains a batch document seeder (`COLLECTION_NAMES`-derived via its `COLLECTIONS` const, single `docClient.mutate({ op: 'batch', ops })` + a `named`/`setSettings` mutation). Extract it; don't rewrite it.
- `syncStore.reloadAllStores()` already re-derives every entity store from the doc — the post-seed refresh step is one call, not a per-store loop.
- `authStore.signOutAndClearData()` already performs the exact teardown a failed partial seed needs.
- `ErrorBanner.vue` (`show: boolean`, `severity?: 'critical' | 'warning' | 'notice'`, default `critical` — verified) + the `DurabilityBanner.vue` pattern already give a persistent, Heritage-Orange, in-flow banner in ~15 lines. No new chrome, and no `AppHeader` change at all.
- `showToast('error', …, { surface, context, critical })` **already auto-fires `reportError`** (`useToast.ts` — `critical`, `silent`, `surface`, `context`, `error` options all verified). Hand-rolling "error modal + `reportError` call" duplicates that seam.
- `src/utils/assertNever.ts` already exists for closed-union exhaustiveness — use it rather than a hand-written default branch.
- Three copies of a SHA-256 digest exist (`inviteToken.sha256Hex` → hex, `inviteService.hashInviteToken` → base64url via the shared `bufferToBase64url`, `pkce.generateCodeChallenge` → base64url via its own **private** `bufferToBase64url`). Only one of these is on this feature's path.
- The normalize → hash → CSV-membership _logic_ in `validateInviteToken` is the entire body of the demo-code validator. That is the thing to share, not just the digest.
- `resetAllAppStores()` (`src/utils/resetStores.ts`) is the app's canonical "wipe all in-session state" helper and already owns non-store module teardown (calendar sync engine, clash engine). It is the correct owner for clearing the demo-session flag (Pass 4, §2).

### What Pass 3 changed (sustainability / maintainability / reliability)

1. **Blast radius cut.** Pass 2 made the `pkce.ts` and `inviteService.ts` digest consolidation _required_. Refactoring the OAuth PKCE path — the login path for every real user — to save seven lines, inside a plan whose only purpose is unblocking a store submission, is the wrong risk trade. Those two are demoted to an **optional, independently-mergeable Phase 0** that is explicitly _not_ a prerequisite (§Approach 0). Only `inviteToken.ts` consolidation stays required, because that code is genuinely shared with the demo gate. Also noted: importing `bufferToBase64url` from `encoding.ts` into `pkce.ts` drags `perfTiming`/`measureSync` into the OAuth path — a real (if small) coupling that Pass 2 didn't account for.
2. **Global mutation moved to its owner.** Pass 2 monkey-patched `window.plausible` inside `demoSeed.ts`. It becomes `withAnalyticsSuppressed(fn)` in `src/services/analytics/plausible.ts` — the module that already installs that global — re-entrancy-safe and unit-tested (§Approach 3).
3. **Flat control flow mandated.** `seedDemoFamily` is a sequence of fallible steps. Written naively that is a try/catch pyramid. §Approach 6 specifies one `fail()` helper, linear early returns, **no nested try/catch**, and a hard max of two nesting levels.
4. **Expiry parsed once, compared per call.** Pass 2 re-parsed `VITE_REVIEW_DEMO_EXPIRES` on every `isReviewDemoAvailable()` call — which, since `parseIsoDateSafely` console-warns on bad input, would spam the console once per keystroke-triggered check. Parse to a module const at load; compare `Date.now()` per call.
5. **Directory sprawl removed.** Pass 2 created `src/services/seed/` to hold one file. `seedDocument.ts` moves beside the `docClient` it wraps (`src/services/automerge/`), leaving exactly one new directory (`src/services/demo/`) for the two demo-only files.
6. **Retirement designed in** — the `REVIEW-DEMO:` marker convention, a runbook removal checklist, and an acceptance criterion for both (§Retirement).
7. **Complexity tripwires** — explicit conditions under which the implementer should stop and re-plan rather than keep adding (§Complexity Guardrails).
8. Component paths corrected to `@/components/ui/BeanieFormModal.vue` / `@/components/ui/BaseInput.vue` (verified locations).

### What Pass 4 changed (fresh-eyes correctness sweep)

Pass 4 re-read every seam the plan touches. Passes 1–3 were sound on structure; Pass 4 found **one data-safety defect, three correctness defects, three silent-failure gaps, and four accuracy corrections**. In order of severity:

1. **Data-safety defect — a pre-existing session would seed into a real family.** `authStore.signUp` opens with an idempotency guard: `if (currentUser.value) return { success: true }` (`authStore.ts:802`). Pass 3's step 4 branches only on `!success`, so with a live session `signUp` returns _success_ having created nothing, and the plan then reads `memberId`/`familyId` from the existing user and runs `seedDocument(...)` — writing ~60 synthetic records into a **real family's Automerge document**. Assumption 2 ("treated as a new session") was hand-waving over a destructive path. Fixed with an explicit **step 0 precondition**: if `authStore.currentUser` is non-null, `fail('session-exists', …, /* needsTeardown */ false)` and tell the reviewer to sign out first. Non-destructive, fail-closed, and it also makes the retry path safe when a teardown itself failed. New `DemoSeedErrorCode` member + string + test.
2. **Correctness defect — `materializeFixture(today)` cannot produce valid data.** The fixture's transactions, activities, to-dos and account owners must reference **the owner member id that `signUp` generates at runtime**, which is not knowable at authoring time. The signature becomes `materializeFixture({ today, ownerMemberId })`, and the fixture must **not** emit the owner into `familyMembers` (doing so would overwrite `signUp`'s owner row and could strip its `passwordHash`, breaking the session). Verified against `src/types/models.ts`: entities carry no `familyId`, so `ownerMemberId` is the only runtime value the fixture needs.
3. **Correctness defect — the suppression option missed a network call.** `createNewFile` awaits `registry.lookupFamilyResult(familyId)` (`syncStore.ts:1640`) _before_ the write, i.e. before both suppressed steps. On the armed mobile lanes `features.registry` is on, so a demo tap makes a live registry GET — violating Requirement 5's "no network", adding reviewer-visible latency, and importing a `reportError`/`logEvent` path on registry flakiness. `suppressRemoteSideEffects` now skips **all three** remote interactions (existing-pod lookup, registration, Slack ping). Skipping the lookup is provably safe: the family id was minted seconds earlier by `signUp`, so it cannot have an existing pod.
4. **Correctness defect — `isDemoSession` is not one-way-safe.** Pass 3 asserted "the only exit is `signOutAndClearData` or closing the app, both of which drop the module". Verified false: `AppHeader.confirmSignOut` / `confirmSignOutAndClearData` do `await authStore.signOut…(); resetAllAppStores(); router.replace('/login')` — **no reload**, so the module survives and the demo banner would persist onto the login screen and onto any real pod created afterwards in the same JS session. (Only `App.vue`'s `handleClearDataAndSignOut` hard-reloads.) Fixed by adding `clearDemoSession()` and calling it from `resetAllAppStores()` — the canonical reset that both sign-out paths already invoke and that already tears down non-store module state. That makes a **fourth** named shared-code touchpoint; Guardrail 6 updated accordingly.
5. **Silent-failure gap — armed with no expiry is a silently dead build.** `parseIsoDateSafely` returns `null` **without warning** when the input is empty/unset (it only warns on _unparseable_ input — verified, `safeDate.ts:15`). So shipping `VITE_REVIEW_DEMO=true` + a hash but forgetting `VITE_REVIEW_DEMO_EXPIRES` produces an armed-but-permanently-expired build with **zero signal** — the exact failure mode that would burn a submission cycle. Added a one-line module-load `console.warn` when `features.reviewDemo` is true but `EXPIRES_AT` is `-Infinity`, plus an acceptance criterion.
6. **Silent-failure gap — expiry is an off-by-one-day trap.** `new Date('2026-10-31')` parses as **UTC midnight**, so `VITE_REVIEW_DEMO_EXPIRES=2026-10-31` disarms the build at the _start_ of 31 Oct UTC, not the end. Left as-is (comparing to a shifted end-of-day would be more code and more surprise) but the semantics are now stated in three places — the var's doc comment, `.env.example`, and the runbook: **"the demo stops working at 00:00 UTC on this date; set it to the day AFTER the last day you want it live."**
7. **Silent-failure gap — `withAnalyticsSuppressed` must restore _absence_.** On the native release lanes `VITE_PLAUSIBLE_DOMAIN` is an explicit exemption in `workflowEnvParity.test.ts`, so `features.analytics` is false, `initAnalytics` returns early, and `window.plausible` is **`undefined`** on the actual store binaries. Restoring with `window.plausible = saved` would leave an installed no-op function where there was none, making `window.plausible?.()` calls start succeeding-into-nothing instead of short-circuiting. Restore must `delete window.plausible` when it was originally absent. (Corollary worth recording: on the real submission binaries the suppression is a belt-and-braces no-op — it earns its keep in dev and on any future analytics-enabled lane, not in review.)
8. **Accuracy — Requirement 6 overclaimed non-durability.** `createNewFile` step 5 does `docClient.openCache(familyId)` → `flush()` → `persistEnvelope(env)`, and step 7 does `settingsStore.cacheFamilyKey(exported, familyId, { force: true })` → `globalSettingsRepo.saveGlobalSettings`. `signUp` adds a `userFamilyMappings` row. So a demo session **does** write durable local artifacts: an IndexedDB family cache, a cached family key, and a local registry row. What it never writes is Drive, a filesystem `.beanpod`, or anything remote. Requirement 6, the caveat, the acceptance criteria and the runbook are reworded to say exactly that, and the runbook gains the reviewer-facing consequence (§13, reload behaviour). Pretending otherwise would have produced an acceptance test nobody could pass.
9. **Accuracy — the `LoginPage` wiring is not "one union member".** `LoginView` is declared **locally and independently** in `WelcomeGate.vue:20` and `LoginPage.vue:45`, and `handleNavigate(view: 'load-pod' | 'create' | 'join')` ends in `activeView.value = view`. The demo is a **modal, not a view**. Precise instruction added (§Approach 7): add `'review-demo'` to `WelcomeGate`'s local union and to `handleNavigate`'s parameter union **only** — never to `LoginPage`'s `LoginView` — and make the new branch the **first** statement with an early `return`, so TypeScript's narrowing keeps the tail `activeView.value = view` assignable. Done in the wrong order this is a type error or, worse, a blank screen.
10. **Accuracy — `createNewFile`'s first parameter is `_podFileName` and is unused.** Pass the demo file name for symmetry, but no one should hunt for where it lands.
11. **Accuracy — CI builds the bundle five times, not three.** Web deploy + Android/iOS **release** + Android/iOS **debug**. Only the two release lanes are armed; the debug lanes are deliberately left un-armed (dev builds use `.env.local`). Recorded because the parity test is one-directional (release ⊇ web) and therefore structurally incapable of noticing a mobile-only var — which is precisely why the explicit negative assertion against `deploy.yml` exists.
12. **Tree-shaking claim removed** (see §Context) and replaced with the three guarantees that are actually testable.

## Requirements

1. **Gate.** A new `features.reviewDemo` gate in `src/config/features.ts`, armed only when **both** `VITE_REVIEW_DEMO === "true"` **and** `VITE_REVIEW_DEMO_CODE_HASH` is non-empty — the same two-condition interlock as `features.inviteGate`, expressed with the same existing `flagOn(...) && ok(...)` helpers (arming with no valid code would ship a dead affordance).
2. **Expiry.** `VITE_REVIEW_DEMO_EXPIRES` (ISO date, e.g. `2026-11-01`). At and after that instant the gate reads false: no affordance, no code accepted. An unset/unparseable value means **expired** (fail closed, never fail open). Parsing uses the existing `parseIsoDateSafely` from `src/utils/safeDate.ts`. **Parsed exactly once at module load**, and **an armed-but-unset expiry warns at module load** (Pass 4 §5 — `parseIsoDateSafely` is silent for empty input). The value is **UTC midnight of the named date**, i.e. the first _expired_ instant — set it to the day after the last day the demo should work (Pass 4 §6).
3. **Code validation.** The entered code is normalized (trim + lowercase), SHA-256'd, and compared against the comma-separated hashes in `VITE_REVIEW_DEMO_CODE_HASH` — through the **same shared validator the invite gate uses** (see Approach §1). The plaintext code never appears in the bundle or the repo.
4. **Entry point.** When and only when the gate is armed, `WelcomeGate.vue` renders one unobtrusive text button below the existing choice cards, opening a single-field code modal built on the **Tier-2 `BeanieFormModal`** (`@/components/ui/BeanieFormModal.vue` — never a modal from scratch; theme skill, "Modal Conventions"). No hidden tap-count gesture (untestable, inaccessible, and a reviewer following written instructions handles a labelled button far more reliably).
5. **Demo pod.** A valid code seeds a complete synthetic family **at runtime, in memory** — no Google OAuth, no Drive, no file picker, and **no network call of any kind** (including the pre-create registry lookup — Pass 4 §3) — and lands the reviewer on `/nook` signed in as the demo owner.
6. **Non-durable _storage_, by construction — stated precisely (Pass 4 §8).** The demo session runs on the existing `MemoryProvider`, so **nothing is ever written to Google Drive, to a filesystem `.beanpod`, or to any remote service.** It _does_ write the same local artifacts any local session writes — an IndexedDB family cache + envelope (`createNewFile` step 5), a cached family key in global settings (step 7), and a `userFamilyMappings` row (`signUp`). All three are removed by `signOutAndClearData()`, which is both the failure teardown and the documented reviewer exit. Requirement 6 is "no durable pod and no remote trace", not "no bytes touch the device".
7. **No production side effects.** Seeding must not query or register with the remote registry API, must not fire the `#beanies-*` "new family pod" Slack ping, must not subscribe anything to Substack, and must not emit Plausible conversion events (`signup`, `login`, `create_pod_click`, `feature_used`).
8. **Visibly a demo.** While a demo session is active, a persistent `ErrorBanner severity="notice"` marks it, so nobody can mistake demo data for their own — and the flag driving it is **cleared on app-state reset** so the banner can never leak onto a subsequent real session (Pass 4 §4).
9. **Synthetic data only.** The fixture contains invented names, amounts and dates. No real family data, no real emails (`@example.invalid` only), nothing resembling a live account.
10. **Observability.** Every branch of the code-entry and seed pipeline emits a structured `logEvent`/`reportError` on surface `review-demo`, so a reviewer's failure can be diagnosed from CloudWatch alone.
11. **i18n.** All new copy goes through `uiStrings.ts` with both `en` and `beanie` values.
12. **CI parity.** The two new env vars are wired into the Android + iOS **release** lanes **only** — not the two debug lanes, not `deploy.yml` (Pass 4 §11) — declared in `vite-env.d.ts`, `.env.example`, and `docs/SELF_HOSTING.md` per the four-place rule in `features.ts`, and a **negative assertion is added to the existing `workflowEnvParity.test.ts`** proving `deploy.yml` never defines them (the web bundle must never carry the bypass; the existing release ⊇ web assertion cannot catch this direction).
13. **Runbook.** `docs/runbooks/native-store-submission.md` gains the exact App Review Information text to paste, including the code, step-by-step reviewer instructions, the expiry semantics, and the reload/sign-out behaviour.
14. **Retirement.** Every production-file touchpoint carries a `REVIEW-DEMO:` marker comment, and the runbook carries a removal checklist that a future maintainer can execute without reading this plan (§Retirement).

## Important Notes & Caveats

- **The bypass ships to real users in the reviewed binary.** Accept this and mitigate it (hashed secret + expiry + synthetic data + memory-only storage) rather than pretending otherwise. Do not add a plaintext code, a code derived from anything guessable, or a code reused across submissions. **Do not claim the code is tree-shaken out of un-armed builds** — it is runtime-short-circuited and its seed chunk is never fetched (§Context).
- **A pre-existing session is a hard stop, not a merge (Pass 4 §1).** `signUp` returns `{ success: true }` without doing anything when `currentUser` is set (`authStore.ts:802`). Seeding on top of that would write the fixture into a **real family's document**. `seedDemoFamily` therefore refuses outright when a session exists. Never "work around" this by clearing the user's data automatically — that turns a confusing state into a destructive one.
- **`MemoryProvider` currently hard-throws outside `import.meta.env.DEV`** (`memoryProvider.ts:109`). Its guard widens to `import.meta.env.DEV || isReviewDemoAvailable()` — the _same single predicate_ the UI binds to, so an expired build cannot install it either. Deliberate, with the doc comment updated (it currently says "DEV/E2E ONLY", twice) and a `REVIEW-DEMO:` marker. Do not delete the guard; a stray memory provider in a real family's session would silently discard their data. Do **not** add an `allowInProd` argument as an alternative — an argument can be passed from anywhere; the predicate cannot. Its `type` is `'local'` (verified), which is what makes `provider_type: 'local'` correct in telemetry.
- **`createNewFile` makes THREE remote interactions, not two (Pass 4 §3):** the existing-pod registry lookup (`lookupFamilyResult`, before the write), the registry write (step 6, `_registerCurrentFamilySync`) and the Slack pod-created ping (step 8). One new option suppresses all three (Approach §5). Thread an explicit option; do not short-circuit inside `_registerCurrentFamilySync`, `registry.*` or `slackNotify` — those are shared by real flows, and a suppression baked into a shared service is a permanent, invisible trap.
- **`createNewFile` also writes durable LOCAL state** — cache open/flush/`persistEnvelope` (step 5) and `cacheFamilyKey({ force: true })` (step 7). This is intended (it is what makes the seeded session behave like a real one) and is cleaned up by `signOutAndClearData`. It is _not_ a Drive or filesystem write. See Requirement 6.
- **`createNewFile` returns a result, it does not throw.** Its `reason` is already a closed union (`CreatePodFailureReason`: `concurrent-write | precondition | existing-pod | write | verify | persist | register`). Map `reason` straight onto `error_code` — do not invent a parallel stage enum. Its first parameter is `_podFileName` and is currently unused (Pass 4 §10).
- **`signUp` returns `{ success, error? }` and also does not throw** for its expected failures (it catches storage-blocked and generic errors internally). Branch on `success`; a bare try/catch would look like handling while catching nothing. Its param type is a discriminated union — pass `password` and omit `deferPassword` entirely.
- **Do not clone `InviteGateOverlay.vue`.** It is a 3-mode overlay (token / request / confirmed) carrying Discord, a Slack webhook form, and marketing links — none of which the demo needs. Share the _validation function_, build the _UI_ on `BeanieFormModal` + `BaseInput`.
- **Do not bundle a pre-built `.beanpod` asset.** It was the obvious approach and it rots: a committed ciphertext blob stops decrypting the moment the V4 envelope or Automerge schema moves, and the failure surfaces as a reviewer staring at "wrong password". A typed TS fixture is compile-checked and migrates with the code for free.
- **Do not seed through the entity stores.** Confetti, Plausible events, cascading balance math, and N serial worker round-trips (see Context). Use the shared batch seeder.
- **The fixture must not contain the owner member (Pass 4 §2).** `signUp` already wrote the owner row, including its `passwordHash`. A fixture `familyMembers` entry with the same id would overwrite it via `{ op: 'set' }` and could lock the demo session out of its own pod. The fixture emits the _other_ members only, and receives `ownerMemberId` so its transactions/activities/to-dos can reference the owner.
- **`DEMO_PASSWORD` is deliberately a non-secret constant** in `demoSeed.ts`. The pod it unlocks exists only in memory for one session and contains only synthetic data, so there is nothing to protect. Document that inline so nobody "hardens" it later, and never reuse it anywhere else.
- **`seedDocument` moves from a DEV-only module into a production-shipped one.** `dataBridge.ts` short-circuits on `!import.meta.env.DEV`; `seedDocument.ts` will not. This is fine — it is ~15 lines wrapping `docClient.mutate`, which already ships — but it is a deliberate change in what's in the prod bundle, not an accident.
- **Expiry is checked against the device clock**, which a reviewer's VM controls. That is fine — the threat model is "an ordinary user stumbles onto the affordance a year later", not "a determined attacker with a hashed code and a clock". Note the UTC-midnight semantics (Requirement 2).
- **Analytics suppression is a no-op on the actual store binaries (Pass 4 §7),** because `VITE_PLAUSIBLE_DOMAIN` is exempted from the mobile release lanes and `window.plausible` is therefore `undefined` there. Keep it anyway — it is correct in dev, correct if analytics is ever added to a native lane, and it is what the seed test asserts against.
- **Seed size is a latency budget, not a showcase.** Keep the fixture around 50–80 records; a reviewer waiting on a spinner is a worse outcome than a slightly sparse dashboard.
- **Do not add an E2E test.** It fails the Three-Gate Filter in ADR-007 (no real user is blocked, and the 25-test budget is capped). Unit tests plus a TestFlight walkthrough are the coverage.

## Complexity Guardrails

Hard limits for the implementer. Hitting any of these means **stop and re-plan**, not "add one more branch":

1. **No nested `try`/`catch` anywhere in the demo path.** One `try` per function, maximum. `seedDemoFamily` uses linear early returns through a single `fail()` helper (§Approach 6).
2. **Maximum nesting depth of 2** inside any new function (one conditional inside one loop/try, no deeper).
3. **`demoSeed.ts` stays under ~150 lines and `demoFixture.ts` is data only** — no logic in the fixture beyond date materialisation and substituting `ownerMemberId`. If the fixture needs branching, the fixture is wrong.
4. **No new store, no new composable, no new Pinia state.** Demo mode adds one module-level `ref` (§Approach 2) and nothing else to the app's state surface.
5. **Exactly one new directory** (`src/services/demo/`). Anything else goes beside the code it extends.
6. **No demo-specific branching in shared production code beyond the four named touchpoints** (Pass 4 §4): `createNewFile`'s one option, `memoryProvider`'s guard, `WelcomeGate`'s one `v-if`, and `resetAllAppStores`'s one `clearDemoSession()` line. (`LoginPage`'s modal mount and `App.vue`'s banner line are mounts, not branches, but carry markers too.) A fifth `if (isDemoSession)` sprinkled into a store means the design has failed — come back to this plan.
7. **Nothing in this plan may become a prerequisite for unrelated work.** The extracted primitives (`sha256Hex`, `matchesHashedCode`, `seedDocument`, `withAnalyticsSuppressed`) must each stand alone and be revertible independently of the feature.

## Assumptions

> Review these before implementation.

1. `beaniesdemo@gmail.com` stays as a fallback in App Review Information; the demo code becomes the primary instruction. Removing the Google account entirely is not part of this plan.
2. **(Rewritten, Pass 4 §1)** The reviewer's device has **no active session**. This is no longer an assumption but an enforced precondition: `seedDemoFamily` refuses with `session-exists` if `authStore.currentUser` is set, and the runbook instructs the reviewer to sign out first if they somehow have a session. The demo never merges into, overwrites, or clears a pre-existing family.
3. ~~`authStore.signUp` writes only to the local IndexedDB registry~~ — **verified true** (`authStore.ts:787-896`): it calls `familyContextStore.createFamily`, `buildOwnerDoc`, one `userFamilyMappings` add, and two `window.plausible` calls (`signup` at :870, `login` at :871). No remote call. The two Plausible calls are the only side effect needing suppression — and note its leading idempotency guard (Assumption 2).
4. `MemoryProvider` implements the full `StorageProvider` contract (verified: read/write/aux/persist/disconnect/metadata all present; `type = 'local'`). Still exercise the seeded session across pages before shipping — the assumption under test is _app_ completeness, not provider completeness.
5. ~~`VITE_REVIEW_DEMO_CODE_HASH` is stored as a GitHub **secret**~~ — **changed at greg's direction during implementation.** All three are repo **variables**. The hash is a one-way digest that ships in the client bundle either way, so the repo setting is not where the exposure lives; the plaintext code is what stays out of the repo. Set 2026-08-20: `REVIEW_DEMO=true`, `REVIEW_DEMO_CODE_HASH=d97d8adc…` (SHA-256 of the code), `REVIEW_DEMO_EXPIRES=2026-11-01` (live through 31 Oct UTC).
6. Google Play review hits the same wall, so the Android release lane is wired identically.
7. ~~**Reloading the app ends the demo session.**~~ **WRONG — corrected during implementation (browser walkthrough).** `createNewFile` writes an IndexedDB family cache + a cached family key, so a reload lands the reviewer back in the SAME demo pod, still populated. Better UX than assumed, but it broke the banner: `isDemoSession` was module-only state, so after a reload the synthetic data was on screen with nothing marking it as a demo — exactly what Requirement 8 exists to prevent. Fixed by backing the flag with `sessionStorage` (inside `reviewDemo.ts`, so no new shared-code touchpoint); it survives a reload and dies with the app process. Runbook updated to tell reviewers reloading is fine.
8. Demo mode is retired within ~2 release cycles of the submission it unblocks. If it is still present a year from now, that is a failure of §Retirement, not a reason to keep extending it.

## Approach

### 0. (Optional, independent) Digest consolidation beyond the shared path

**Not a prerequisite for anything below. Merge it separately, before or after, or not at all.**

`src/utils/encoding.ts` is already documented as "shared binary ↔ string encoding utilities … consolidation is a separate cleanup task". Two existing duplications can be collapsed onto the helpers added in §1(a):

- `src/services/crypto/inviteService.ts` `hashInviteToken` → `return sha256Base64url(token)`. Covered by existing invite tests.
- `src/services/google/pkce.ts` `generateCodeChallenge` → `return sha256Base64url(verifier)`, and its **private** `bufferToBase64url` (verified: `pkce.ts:8-15`, a genuine third copy) deleted in favour of the shared one. Covered by existing pkce tests.

**Why this is Phase 0 and optional, not required.** `pkce.ts` is on the OAuth login path for every real Drive user. This plan's purpose is unblocking a store submission; coupling that submission to a refactor of the login path trades a real reliability risk for seven deleted lines. There is also a non-obvious side effect Pass 2 missed: the shared `bufferToBase64url` routes through `measureSync`/`perfTiming`, so this change pulls a telemetry dependency into OAuth that isn't there today. Small, but it is a coupling increase, not a decrease.

If done: **its own commit, its own PR-sized diff, green existing `pkce` + `inviteService` suites before anything else lands.** If skipped, note it as a follow-up; the demo feature is unaffected either way.

### 1. One hashed-code gate primitive (DRY) — `src/utils/encoding.ts` + `src/utils/hashedCodeGate.ts`

**(a) Digest helpers into the existing shared module.** Add to `src/utils/encoding.ts` — no new `sha256.ts` file:

```ts
export async function sha256(input: string): Promise<ArrayBuffer>; // TextEncoder + crypto.subtle.digest
export async function sha256Hex(input: string): Promise<string>; // lowercase hex
export async function sha256Base64url(input: string): Promise<string>; // reuses bufferToBase64url
```

`sha256Base64url` exists for §0's benefit; if §0 is skipped it has one caller and can be omitted until then. **Required now:** `sha256` + `sha256Hex`, and `src/utils/inviteToken.ts` deleting its private `sha256Hex` (verified: `inviteToken.ts:16-22`) to import it — required because §1(b) shares that code path with the demo gate.

**(b) The gate logic itself into `src/utils/hashedCodeGate.ts`.** `validateInviteToken`'s body _is_ the demo validator: normalize → hash → membership test against a comma-separated hash list. One function, two callers:

```ts
/** normalize (trim+lowercase) → sha256Hex → membership in a comma-separated
 *  lowercase-hex list. Returns false for empty input or an empty list.
 *  Never throws: a crypto.subtle failure (non-secure-context) is caught,
 *  console.warn'd + reported, and returns false — fail closed, never silent. */
export async function matchesHashedCode(input: string, hashesCsv: string): Promise<boolean>;
```

`validateInviteToken` becomes `features.inviteGate ? matchesHashedCode(token, HASHES_ENV) : true` (note the `true` — the invite gate's "off" means _allow_, the demo gate's means _deny_; keep those inversions at the call sites, never inside the shared function). `validateReviewDemoCode` becomes `isReviewDemoAvailable() ? matchesHashedCode(code, DEMO_HASHES_ENV) : false`. The two gates are then provably identical in behaviour, and `crypto.subtle` being unavailable (an `http://` origin — a real possibility on a sideloaded review build) surfaces as a reported error instead of a silent `false`.

This file is the one piece of this plan with a life beyond demo mode: it is a general "is this string one of the configured hashed secrets" primitive, already serving two gates. It stays after retirement.

### 2. Gate + expiry + session flag — `src/config/features.ts` + `src/utils/reviewDemo.ts`

```ts
// features.ts — same two-condition interlock and same helpers as inviteGate
// REVIEW-DEMO: temporary store-review bypass. See docs/runbooks/native-store-submission.md
// (Retirement) — delete this gate and its env vars when demo mode is retired.
reviewDemo: flagOn(env.VITE_REVIEW_DEMO) && ok(env.VITE_REVIEW_DEMO_CODE_HASH),
```

`src/utils/reviewDemo.ts` exports exactly five things and holds all of the feature's decision logic:

- `isReviewDemoAvailable(): boolean` — `features.reviewDemo && Date.now() < EXPIRES_AT`. **The single predicate.** The `WelcomeGate` affordance, the validator, the seed guard and the `MemoryProvider` guard all bind to this one function, so they can never disagree. Cheap and side-effect-free, so it is safe to call from a render expression.
- `EXPIRES_AT` (private module const) — `parseIsoDateSafely(env.VITE_REVIEW_DEMO_EXPIRES, 'VITE_REVIEW_DEMO_EXPIRES')?.getTime() ?? -Infinity`. **Parsed once at module load**: `parseIsoDateSafely` console-warns on _unparseable_ input, and a per-call parse would emit that warning on every render and every keystroke-driven validation. `-Infinity` for unset/unparseable means permanently expired: fail closed. **Pass 4:** because `parseIsoDateSafely` is _silent_ for empty input, add immediately after it —

  ```ts
  // REVIEW-DEMO: an armed build with no/blank expiry is permanently disarmed and
  // would otherwise fail SILENTLY — burning a submission cycle. Warn once at load.
  if (features.reviewDemo && EXPIRES_AT === -Infinity) {
    console.warn(
      '[reviewDemo] ARMED but VITE_REVIEW_DEMO_EXPIRES is unset/unparseable — ' +
        'demo mode is permanently disabled in this build. Set it on the release lane ' +
        '(UTC midnight of the FIRST expired day, e.g. 2026-11-01 keeps it live through Oct 31).'
    );
  }
  ```

  and document the UTC-midnight semantics on the const (Requirement 2 / Pass 4 §6).

- `validateReviewDemoCode(code): Promise<boolean>` — see §1(b).
- `isDemoSession: Readonly<Ref<boolean>>` + `markDemoSession()` — a module-level `ref`, following the established decoupled module-flag precedent of `src/utils/newFamilyFlag.ts` (documented there as deliberate: same JS session, no reload, avoids a store-to-store import). A `ref` rather than a plain boolean because the banner binds to it reactively. **No store change anywhere** (Guardrail 4).
- **`clearDemoSession()` (Pass 4 §4).** Pass 3 made the flag one-way on the false premise that every exit reloads. Verified otherwise: `AppHeader.confirmSignOut` and `confirmSignOutAndClearData` both do `resetAllAppStores(); router.replace('/login')` with **no reload**, so a one-way flag would leave the demo banner on the login screen and on any real pod created afterwards in the same session. `clearDemoSession()` is called from **`src/utils/resetStores.ts`'s `resetAllAppStores()`** — one marked line, in the helper that is already the canonical owner of non-store module teardown (it stops the calendar-sync and clash engines the same way). Both sign-out paths, and every family switch, therefore clear it for free.

### 3. Analytics suppression lives with the global it mutates — `src/services/analytics/plausible.ts`

Every analytics call site in the repo is a bare `window.plausible?.('event')` — verified across ~16 files; there is no central `track()` wrapper to gate. So suppressing `signUp`'s `signup` + `login` events genuinely requires temporarily swapping the global. Put that swap in the module that already **owns** and **installs** `window.plausible`:

```ts
/** Run `fn` with `window.plausible` swapped for a no-op, restoring it in `finally`.
 *  The ONLY sanctioned way to suppress analytics for a code path — every call site
 *  in the app calls `window.plausible?.()` directly, so there is no other seam.
 *  Re-entrant: nested calls share one saved original and one restore.
 *  Restores ABSENCE faithfully: when analytics is off (`VITE_PLAUSIBLE_DOMAIN`
 *  unset — which is the case on BOTH mobile release lanes) `window.plausible` is
 *  `undefined`, and this `delete`s the key rather than leaving an installed no-op
 *  behind, so `?.()` short-circuits exactly as it did before.
 *  Fire-and-forget events queued by Plausible's own script are unaffected; this
 *  suppresses only calls made synchronously-or-awaited inside `fn`. */
export async function withAnalyticsSuppressed<T>(fn: () => Promise<T>): Promise<T>;
```

Implementation shape (guardrail-compliant: one `try`, depth 2):

```ts
let depth = 0;
let saved: PlausibleQueue | undefined;
let hadKey = false;
// on entry: if (depth++ === 0) { hadKey = 'plausible' in window; saved = window.plausible;
//                                window.plausible = noop as PlausibleQueue; }
// in finally: if (--depth === 0) { hadKey ? (window.plausible = saved) : delete window.plausible; }
```

Why this matters for maintainability: a global mutation hidden inside a feature module is invisible to anyone auditing analytics. Placed next to `initAnalytics`, it is discoverable, documented, independently unit-testable (assert no-op during, original restored after, absence restored as absence, restored even when `fn` throws), and reusable if a second flow ever needs it.

Known limitations, documented inline: (a) an event fired from a `setTimeout`/unawaited promise scheduled inside `fn` but running after it can still land — none exist on the seed path (`signUp`'s two calls are synchronous), and the assertion is covered by the seed test; (b) on the real submission binaries this is a no-op because analytics is not wired into the native lanes at all (Pass 4 §7) — it earns its keep in dev and as future-proofing.

### 4. One shared document seeder (DRY) — `src/services/automerge/seedDocument.ts`

Lift the existing batch-seed core out of `src/services/e2e/dataBridge.ts` (its `seedData`, `dataBridge.ts:86-105`) verbatim, placed **beside the `docClient` it wraps** rather than in a new one-file `src/services/seed/` directory (Guardrail 5):

```ts
/** Write whole entities into the Automerge doc in ONE batched worker mutation,
 *  iterating COLLECTION_NAMES so a new collection is seedable the day it exists.
 *  Also applies `data.settings` via the `setSettings` named mutation, exactly as
 *  the E2E bridge did. Returns the number of entities written. Throws on mutate
 *  failure — callers decide how to surface it. */
export async function seedDocument(
  data: Partial<Record<keyof FamilyDocument, unknown>>
): Promise<number>;
```

`dataBridge.seedData` becomes `await seedDocument(data); await refreshSnapshot();` — the E2E bridge keeps its snapshot-staging responsibility and loses its copy of the seeding logic. `demoSeed` calls the same function. One seeder, two callers, and the `COLLECTION_NAMES`-derived guarantee (already documented in `dataBridge.ts:31` as the reason a hand-listed subset drifts silently) now protects both. Note the bundle consequence recorded in Caveats: this ~15-line helper now ships in production, where `dataBridge` did not.

This is also why the demo does **not** go through the entity stores: one batched `docClient.mutate` instead of ~80 serial store calls, each with confetti, analytics, and balance cascades. Store state is refreshed afterwards by the **existing** `syncStore.reloadAllStores()` — the same call `loadFromFile` and `resetInMemoryFamilyState` already use.

### 5. One suppression option on `createNewFile`

`createNewFile` gains a single trailing optional parameter (the sixth positional param `heardVia` already exists; this is the seventh and last — do not add an eighth, fold any future need into this object):

```ts
async function createNewFile(
  _podFileName: string,
  password: string,
  memberId: string,
  familyId: string,
  familyName: string,
  heardVia?: string | null,
  /** REVIEW-DEMO: Demo/review seeding only — skip every REMOTE interaction of this
   *  create: the existing-pod registry LOOKUP (pre-write), the registry
   *  REGISTRATION (step 6), and the #beanies pod-created Slack ping (step 8).
   *  Skipping the lookup is safe here and only here: the familyId was minted by
   *  `signUp` seconds earlier, so it cannot already have a pod. Local writes
   *  (cache, envelope, cached family key, session) are UNAFFECTED — the demo
   *  session is deliberately indistinguishable from a real local one on-device.
   *  Set ONLY by `seedDemoFamily`; a real pod must ALWAYS register (it is the
   *  recovery anchor for ResumePodSetup). Delete this parameter with demo mode. */
  opts?: { suppressRemoteSideEffects?: boolean }
): Promise<CreatePodResult>;
```

**Three** call sites inside the function become conditional (Pass 4 §3 — Pass 3 had two), each with a one-line `// REVIEW-DEMO:` comment pointing back here:

1. the `registry.lookupFamilyResult(familyId)` block and its `existingLookup?.status === 'unavailable'` telemetry (`~1638-1672`) — skipped entirely, leaving `existingLookup` null;
2. `await _registerCurrentFamilySync()` at step `register` (`~1743`);
3. `slackNotify(...)` at step 8 (`~1791`).

One flag, all three side effects — not three flags that can be set inconsistently, and not a flag read from module state (an explicit parameter is testable and greppable; `if (isDemoSession.value)` inside `syncStore` would be neither).

Existing tests in `src/stores/__tests__/createNewFile.test.ts` get two additions: with the flag, `lookupFamilyResult`, `registerFamilyOrThrow` and `slackNotify` are not called; without it (the default, i.e. every real caller), all three still are. The second assertion is the important one — it is what catches the flag being inverted or defaulted wrong.

### 6. Seeding — `src/services/demo/demoSeed.ts` + `src/services/demo/demoFixture.ts`

`demoFixture.ts` is **plain typed data, no logic** (Guardrail 3), keyed by collection name and typed against `src/types/models.ts` / `@/types/automerge` — so a model change is a compile error rather than silent rot. One family: **the four non-owner members only** (the owner's partner and three kids — minus the owner, who already exists; Pass 4 §2), a handful of accounts (balances stated directly, since the batch path does no cascading recalculation), ~30 transactions across recent months, 2–3 goals, an asset, a week of calendar activities, a short to-do list.

It exports one pure function:

```ts
/** Materialize the fixture for a given "today" and the runtime owner member id.
 *  PURE — same inputs, identical output. Every date is a function of `today` so
 *  the demo never looks stale; every member reference is either a fixture member
 *  or `ownerMemberId`. Deliberately emits NO entry for the owner in
 *  `familyMembers` — `signUp` already wrote that row (with its passwordHash) and
 *  a `{ op: 'set' }` here would overwrite it. */
export function materializeFixture(args: {
  today: Date;
  ownerMemberId: UUID;
}): Partial<FamilyDocument>;
```

Every email is `@example.invalid`.

`demoSeed.ts` exports one function:

```ts
export async function seedDemoFamily(): Promise<
  { ok: true } | { ok: false; code: DemoSeedErrorCode }
>;
```

It returns a result rather than throwing, matching `createNewFile`'s established contract, so the caller's handling is a `switch` (closed with `assertNever`) and no unreachable catch.

**Control flow.** Eight fallible steps written naively become a try/catch pyramid. Instead: one local helper and linear early returns, no nesting beyond depth 2, no nested `try` (Guardrails 1–2):

```ts
// One place that reports, tears down, and shapes the failure result.
async function fail(code: DemoSeedErrorCode, error?: unknown, needsTeardown = true) { … }
```

Body, in order — every step's failure mapped to a distinct code, none of them swallowed:

0. **Session precondition (Pass 4 §1)** — `if (authStore.currentUser) return fail('session-exists', undefined, false)`. `signUp` short-circuits on an existing session and returns `{ success: true }` having created nothing; without this guard the fixture would be written into a **real family's document**. No teardown — we must never clear a stranger's data. The reviewer-facing string says "sign out first, then re-enter the code".
1. **Gate** — `if (!isReviewDemoAvailable()) return fail('not-available', undefined, false)`. Defence in depth behind the UI gate.
2. **Wrap the remainder in `withAnalyticsSuppressed(...)`** (§3) so `signUp`'s `signup` + `login` events never fire. One call, restoring in its own `finally`, owned by the analytics module.
3. **Install the provider** — `syncService.setProvider(createMemoryProvider('beanies-demo.beanpod'))`, the same seam the real Drive/local connect uses (`connectStorage.ts:168,266`). → `provider-install` (no teardown — nothing has been created yet).
4. **`authStore.signUp({ email, familyName, memberName, password: DEMO_PASSWORD, subscribeNewsletter: false })`** — non-deferred, `deferPassword` omitted entirely (its param type is a discriminated union). On `!success` → `fail('signup', result.error)`.
5. **`syncStore.createNewFile('beanies-demo.beanpod', DEMO_PASSWORD, memberId, familyId, familyName, null, { suppressRemoteSideEffects: true })`.** On `!ok` → `fail(result.reason, result.error)` — the existing closed union passed straight through. This step already performs envelope build → write → verify → local cache persist → key cache → `markPodCreated`.
6. **`seedDocument(materializeFixture({ today: new Date(), ownerMemberId: memberId }))`** then **`syncStore.reloadAllStores()`**, together in the one `try` → `fail('fixture-write', e)`.
7. **`markDemoSession()`**, `logEvent` seed-complete + `perfTiming.record`, return `{ ok: true }`. The caller routes to `/nook`.

**Teardown** (inside `fail`, for any failure at or after step 4) is `await authStore.signOutAndClearData()` — the existing, already-hardened full teardown (forced save with timeout, reminder cancel, Google state wipe, store reset, family DB delete, trust flag + cached key clear, session clear — verified `authStore.ts:1472-1519`). It is wrapped in its own try/catch that reports (`surface: 'review-demo'`, `error_code: 'teardown'`) but never masks the originating failure. No bespoke teardown code is written, and because it lives in `fail` there is exactly one teardown call site rather than six.

`seedDemoFamily` is **dynamically `import()`ed** from the modal, so the fixture and seeding code land in a separate chunk that an un-armed build never loads.

### 7. UI — three small pieces, zero new chrome

- **`WelcomeGate.vue`** — one text button below the existing cards, `v-if="isReviewDemoAvailable()"`, `@click="emit('navigate', 'review-demo')"`. Copy via `t('reviewDemo.*')`. Marked `REVIEW-DEMO:`.

- **`LoginPage.vue` wiring — precise, because Pass 3's "one union member" was wrong (Pass 4 §9).** `LoginView` is declared **locally and independently** in `WelcomeGate.vue:20` (`'load-pod' | 'create' | 'join'`) and `LoginPage.vue:45` (a nine-member view union), and `handleNavigate(view: 'load-pod' | 'create' | 'join')` ends with `activeView.value = view`. The demo is a **modal, not a view**, so:
  - add `'review-demo'` to **`WelcomeGate`'s local union** and to **`handleNavigate`'s parameter union** — and to **nothing else**;
  - do **not** add it to `LoginPage`'s `LoginView`;
  - make the new branch the **first statement** of `handleNavigate`, with an early `return`:

    ```ts
    function handleNavigate(view: 'load-pod' | 'create' | 'join' | 'review-demo') {
      // REVIEW-DEMO: modal, not a view — must return before the tail assignment.
      if (view === 'review-demo') { showReviewDemoModal.value = true; return; }
      resetLoadPodState();
      …
      activeView.value = view;   // narrowed back to the three real views
    }
    ```

    TypeScript's narrowing then keeps the tail assignment valid with no cast. Placed anywhere else, this is either a type error or (with a cast) a blank screen.

  - mount `<ReviewDemoCodeModal v-if="showReviewDemoModal" @close="showReviewDemoModal = false" />` at the `LoginPage` template root, alongside the existing overlay mounts. Marked `REVIEW-DEMO:`.

- **`src/components/login/ReviewDemoCodeModal.vue`** — a `@/components/ui/BeanieFormModal.vue` (Tier 2, `size="narrow"`) wrapping one `@/components/ui/BaseInput.vue` bound to `code`, with an inline `:error` string. Submit → `validateReviewDemoCode` → on false set the inline error; on true `isSubmitting = true`, dynamic-import + run `seedDemoFamily`, then `router.push('/nook')`. `BeanieFormModal` already supplies the submit button, `isSubmitting` spinner + label, close handling, `rounded-3xl`, and fullscreen-mobile — so this component is form state and one async handler, nothing else.

- **`src/components/common/ReviewDemoBanner.vue`** — a ~15-line `ErrorBanner severity="notice"` wrapper bound to `isDemoSession`, rendered in `App.vue` immediately after `DurabilityBanner` (`App.vue:1992`; both are in-flow, so they stack predictably and push the header down rather than overlapping). Identical shape to `DurabilityBanner.vue`, Heritage Orange (never Alert Red). Unlike `DurabilityBanner` it has **no CTA** — there is nowhere for a reviewer to go — so it is title + message only. **`AppHeader.vue` is not modified at all** — Pass 1's bespoke header chip is dropped.

All copy: `uiStrings.ts` with `en` + `beanie`, all keys under the single `reviewDemo.*` namespace so retirement is one contiguous block to delete.

### 8. Failure handling — no silent failures, no hand-rolled reporting

The demo has exactly two failure surfaces, and each uses the existing seam:

- **Code rejection** (user-recoverable) → inline `:error` on the `BaseInput`, exactly as `InviteGateOverlay.handleUnlock` does, plus a `logEvent` at `warn`. No toast, no page — a reviewer mistyping a code must not wake anyone up.
- **Seed failure** (blocking) → `showToast('error', t('reviewDemo.seedFailedTitle'), t('reviewDemo.seedFailed.' + code), { surface: 'review-demo', critical: true, context: { action: 'seed-failed', error_code: code }, error })`. `showToast` **already** fires `reportError` with that surface/severity/context (verified in `useToast.ts`'s options doc), so this single call both tells the reviewer what broke and pages `#beanies-errors`. Writing a separate error modal plus an explicit `reportError` would duplicate that. The toast is sticky for errors by default, and the modal stays open with its input intact so the reviewer can retry without re-navigating.

| Stage       | Failure                                  | Reviewer sees                                             | `error_code`                                                                                             | Teardown |
| ----------- | ---------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| Code submit | empty input                              | inline "enter the code" (submit disabled until non-empty) | — (client-side, no event)                                                                                | —        |
| Code submit | wrong code                               | inline "that code isn't right"                            | `invalid-code`                                                                                           | —        |
| Code submit | gate closed/expired                      | inline "this demo code has expired"                       | `expired`                                                                                                | —        |
| Code submit | `crypto.subtle` unavailable              | inline "this browser can't verify the code"               | `crypto-unavailable`                                                                                     | —        |
| Seed        | **a session already exists**             | error toast: "sign out first, then re-enter the code"     | `session-exists`                                                                                         | **no**   |
| Seed        | gate closed at seed time                 | error toast + retry                                       | `not-available`                                                                                          | no       |
| Seed        | provider install threw                   | error toast + retry                                       | `provider-install`                                                                                       | no       |
| Seed        | `signUp` returned `!success`             | error toast + retry, session torn down                    | `signup`                                                                                                 | yes      |
| Seed        | `createNewFile` returned `!ok`           | error toast + retry, session torn down                    | `result.reason` (`write`/`verify`/`persist`/`register`/`precondition`/`existing-pod`/`concurrent-write`) | yes      |
| Seed        | `seedDocument` / `reloadAllStores` threw | error toast + retry, session torn down                    | `fixture-write`                                                                                          | yes      |
| Teardown    | `signOutAndClearData` threw              | (original error still shown)                              | `teardown`                                                                                               | —        |

A partial seed is **torn down** via `signOutAndClearData`, not left half-populated — a reviewer exploring a broken half-family is worse than a clean error with a retry. `session-exists`, `not-available` and `provider-install` are the three that must **never** tear down: nothing was created, and in the `session-exists` case the data at risk is someone else's.

`DemoSeedErrorCode` is a closed union and the modal's message lookup ends in `assertNever(code, 'reviewDemoSeedError')` (the existing helper), so adding a stage without adding its user-facing string is a compile error.

Developer guidance is carried in the `message` field of every event (which bypasses the context allowlist), e.g. `"review-demo seed failed at createNewFile (reason=verify) — check VITE_REVIEW_DEMO_* on the release lane and the MemoryProvider guard"`. So the fix is in the alert, not just in someone's head.

## Retirement

Demo mode is temporary by design (Requirement 14). Two mechanisms make removing it a mechanical task rather than an archaeology project:

**1. The `REVIEW-DEMO:` marker.** Every touchpoint in shared/production code carries a comment beginning `REVIEW-DEMO:` — `features.ts`, `syncStore.createNewFile`'s option and its **three** conditionals, `memoryProvider`'s guard, `resetStores.ts`'s `clearDemoSession()` line, `WelcomeGate`'s button, `LoginPage`'s `handleNavigate` branch + modal mount, `App.vue`'s banner line, the two release workflow files, and the `uiStrings` block. `grep -rn "REVIEW-DEMO:" src/ .github/ .env.example docs/` returns the complete removal surface. Files that exist _only_ for demo mode (`src/utils/reviewDemo.ts`, `src/services/demo/*`, `ReviewDemoCodeModal.vue`, `ReviewDemoBanner.vue`, their tests) are deleted whole and need no marker.

**2. A removal checklist in `docs/runbooks/native-store-submission.md`,** sitting directly beneath the App Review Information text it supports, so whoever next edits that submission text sees it:

- delete every `REVIEW-DEMO:` marked block and every demo-only file listed above;
- delete `VITE_REVIEW_DEMO`, `VITE_REVIEW_DEMO_CODE_HASH`, `VITE_REVIEW_DEMO_EXPIRES` from the two mobile **release** workflows, `vite-env.d.ts`, `.env.example`, `docs/SELF_HOSTING.md`, and GitHub repo variables/secrets;
- revert `memoryProvider`'s guard to `import.meta.env.DEV` and restore its "DEV/E2E ONLY" doc comment (both occurrences);
- revert `createNewFile`'s seventh parameter and its three conditionals, and drop the two suppression tests;
- remove the `clearDemoSession()` call from `resetAllAppStores()`;
- revert `handleNavigate`'s parameter union and `WelcomeGate`'s local `LoginView` union;
- **keep** `encoding.ts`'s `sha256*`, `hashedCodeGate.ts`, `seedDocument.ts` and `withAnalyticsSuppressed` — they have non-demo callers and stand alone (Guardrail 7);
- drop the negative `workflowEnvParity` assertion and the `reviewDemo.*` `uiStrings` block;
- CHANGELOG entry.

The expiry date already makes an un-retired build **harmless** rather than merely unreviewed — that is the safety net, not the plan.

**Before executing the checklist, check whether demo mode is being repurposed** rather than retired (see the approval note in the header: a general "try beanies" demo for prospective users is a possibility greg has flagged). If so, stop and plan that separately — do not simply widen this feature's gate. A public demo drops the secret code, which removes the only thing currently limiting who can seed a pod, and so needs its own thinking about abuse, rate limiting, and whether the expiry survives at all. The primitives (`hashedCodeGate`, `seedDocument`, `withAnalyticsSuppressed`, the fixture) are the reusable part; the gate is not.

## Files Affected

**New**

- `src/utils/hashedCodeGate.ts` — the shared normalize→hash→membership gate primitive (survives retirement)
- `src/utils/reviewDemo.ts` — gate + expiry (+ armed-without-expiry warning) + code validation + `isDemoSession` / `markDemoSession` / `clearDemoSession`
- `src/services/automerge/seedDocument.ts` — the shared batch document seeder, lifted from `dataBridge.ts` and placed beside `docClient` (survives retirement)
- `src/services/demo/demoFixture.ts` — typed synthetic family data + pure `materializeFixture({ today, ownerMemberId })`
- `src/services/demo/demoSeed.ts` — `seedDemoFamily()`
- `src/components/login/ReviewDemoCodeModal.vue` — `BeanieFormModal` + one `BaseInput`
- `src/components/common/ReviewDemoBanner.vue` — `ErrorBanner severity="notice"` wrapper, no CTA
- `src/utils/__tests__/reviewDemo.test.ts`
- `src/services/demo/__tests__/demoSeed.test.ts`

**Modified**

- `src/utils/encoding.ts` — add `sha256` / `sha256Hex` (+ `sha256Base64url` if §0 is taken)
- `src/utils/inviteToken.ts` — delete its private `sha256Hex`, delegate to `matchesHashedCode` (behaviour-identical)
- `src/services/analytics/plausible.ts` — add `withAnalyticsSuppressed` (restores absence as absence)
- `src/config/features.ts` — `reviewDemo` gate (marked)
- `src/vite-env.d.ts`, `.env.example`, `docs/SELF_HOSTING.md` — env declarations (the four-place rule), incl. the UTC-midnight expiry semantics
- `src/services/sync/providers/memoryProvider.ts` — guard → `DEV || isReviewDemoAvailable()`; both "DEV/E2E ONLY" doc comments updated (marked)
- `src/services/e2e/dataBridge.ts` — `seedData` delegates to `seedDocument`
- `src/stores/syncStore.ts` — `createNewFile` gains `opts.suppressRemoteSideEffects` (registry **lookup** + registration + Slack) (marked)
- `src/utils/resetStores.ts` — one `clearDemoSession()` line in `resetAllAppStores()` (marked) **(Pass 4)**
- `src/components/login/WelcomeGate.vue` (marked), `src/pages/LoginPage.vue` — local union member, first-branch early-returning `handleNavigate` case, modal mount (marked)
- `src/App.vue` — render `ReviewDemoBanner` after `DurabilityBanner` (marked)
- `src/services/translation/uiStrings.ts` — one contiguous `reviewDemo.*` block (en + beanie)
- `src/config/__tests__/workflowEnvParity.test.ts` — negative assertion: `deploy.yml` defines no `VITE_REVIEW_DEMO*`
- `src/stores/__tests__/createNewFile.test.ts` — suppression-option coverage (both directions, all three remote calls)
- `src/services/analytics/plausible.test.ts` — `withAnalyticsSuppressed` coverage
- `.github/workflows/mobile-ios-release.yml`, `.github/workflows/mobile-android-release.yml` — the two new env vars (marked)
- `docs/runbooks/native-store-submission.md` — App Review Information text **+ the retirement checklist**
- `CHANGELOG.md`

**Optional / separate commit (§0), not required by this feature**

- `src/services/crypto/inviteService.ts` — `hashInviteToken` → `sha256Base64url`
- `src/services/google/pkce.ts` — `generateCodeChallenge` → `sha256Base64url`; drop its private `bufferToBase64url`

**Explicitly NOT modified:** `src/components/common/AppHeader.vue` (banner instead of a chip), `src/components/login/InviteGateOverlay.vue` (validation shared, UI not cloned), `src/services/registry/*` and `src/utils/slackNotify.ts` (suppression is threaded from the caller, never baked into a shared service), `.github/workflows/deploy.yml` (web must never carry the bypass), the two mobile **debug** lanes (dev builds use `.env.local`), any Pinia store (Guardrail 4).

## Implementation Sequence

Each phase is independently reviewable and, except where noted, independently revertible.

- **Phase 0 (optional, standalone):** §0 digest consolidation for `inviteService` + `pkce`. Green existing suites before anything else. Skippable.
- **Phase 1 — primitives:** `encoding.sha256*`, `hashedCodeGate.ts`, `inviteToken` delegation, `seedDocument.ts` + `dataBridge` delegation, `withAnalyticsSuppressed`. All four are useful and tested on their own; the invite gate and E2E bridge regression suites are the gate to proceed.
- **Phase 2 — gate:** `features.reviewDemo`, `reviewDemo.ts` (incl. the armed-without-expiry warning and `clearDemoSession`), `resetAllAppStores` line, `memoryProvider` guard, env declarations in all four places. Ends with the gate matrix unit test green and nothing user-visible yet.
- **Phase 3 — seed:** `createNewFile` option + its tests, `demoFixture.ts`, `demoSeed.ts` + its tests (including the `session-exists` precondition).
- **Phase 4 — UI:** `ReviewDemoCodeModal`, `WelcomeGate` button, `LoginPage` wiring (first-branch early return), `ReviewDemoBanner`, `App.vue`, `uiStrings`.
- **Phase 5 — release plumbing & docs:** the two mobile release workflows, the negative parity assertion, the runbook text **and retirement checklist**, CHANGELOG. Then the manual dev walkthrough and the TestFlight walkthrough.

## Observability Coverage

Surface: **`review-demo`** (one CloudWatch filter isolates the whole feature; one filter to delete at retirement).

**Events**

- `logEvent({ level: 'info', surface: 'review-demo', message: 'code submitted', context: { action: 'code-submitted' } })` — the denominator for a success _rate_.
- `logEvent({ level: 'warn', …, context: { action: 'code-rejected', error_code: 'invalid-code' | 'expired' | 'crypto-unavailable' } })`.
- `logEvent({ level: 'info', …, context: { action: 'seed-start' } })` and `{ action: 'seed-complete', provider_type: 'local' }` — success-path signal, emitted unconditionally so rates are measurable. (`'local'` is verified: `MemoryProvider.type = 'local' as const`.)
- `perfTiming.record('review-demo-seed', ms, { perf_entity_count: seeded })` — seeding is the slow step; a reviewer abandoning on a spinner shows up as a long tail. Comfortably above `TELEMETRY_FLOOR_MS = 250`, and `perf_entity_count` is an existing `PerfContext` field (Pass 1's `{ action: … }` is not part of `PerfContext` and would not have type-checked).
- `reportError({ surface: 'review-demo', severity: 'critical', … })` — fired **via `showToast(..., { critical: true })`**, not by a separate call. A blocked reviewer is a failed user action with a submission on the line, so this is one of the rare genuine `critical` pages to `#beanies-errors`.
- **Build-time misconfiguration is a `console.warn` at module load, not telemetry** (Pass 4 §5): an armed build with no expiry produces no user action to attach an event to, and the audience is whoever is reading the build/dev console. It is loud where it can be seen.

**Failure modes covered.** Gate not armed in the shipped lane (no `code-submitted` events at all from that build SHA — visible by absence, cross-checked against `build_sha`); armed but silently disarmed by a missing expiry (console warning at load); wrong or stale code (`invalid-code`); build outlived its window (`expired`); non-secure context (`crypto-unavailable`); a pre-existing session (`session-exists`); each seed stage distinguished by `error_code`, with `createNewFile`'s own seven-value `reason` union passed through verbatim. No bare `catch {}` anywhere in the path; the one deliberately-swallowing catch (teardown, inside `fail`) reports before returning.

**Critical vs. firehose.** Only `seed-failed` is `critical`. Code rejections are `warn` — a reviewer mistyping a code must not page Slack. Volume is bounded by the fact that only reviewers hold the code.

**Privacy / store gate.** **No new context keys.** `action`, `error_code`, `provider_type`, `perf_entity_count` and `perf_duration_ms` are all already in `ALLOWED_CONTEXT_KEYS` (verified in `src/utils/diagnosticContext.ts`), so no `logEvent.ts` allowlist change, no `infrastructure/lambda/telemetry/index.mjs` mirror change, and no store data-collection re-declaration is required. The fixture is synthetic, so nothing user-typed can reach telemetry through this path.

## Acceptance Criteria

- [ ] With no env vars set (dev, web, self-host), no affordance renders and `validateReviewDemoCode` returns false for every input
- [ ] With `VITE_REVIEW_DEMO=true` but no hash set, the gate stays closed
- [ ] With both set and the expiry in the future, the affordance renders and a correct code seeds the pod
- [ ] With the expiry in the past (or unset/unparseable), the affordance is hidden, a correct code is rejected, **and `createMemoryProvider` throws** (all three follow from the one `isReviewDemoAvailable` predicate)
- [ ] The unparseable-expiry warning is emitted **once**, at module load, not per gate check
- [ ] **Armed with an unset/blank `VITE_REVIEW_DEMO_EXPIRES` emits an explicit "ARMED but permanently disabled" console warning at module load** (Pass 4 §5)
- [ ] **`VITE_REVIEW_DEMO_EXPIRES=<date>` disarms at 00:00 UTC on `<date>`**, and that semantic is documented in `.env.example`, `vite-env.d.ts` and the runbook (Pass 4 §6)
- [ ] The plaintext code appears nowhere in the repo or in `dist/`
- [ ] A demo session reaches `/nook` with a populated dashboard, calendar, to-dos and accounts, with no Google prompt at any point
- [ ] **The demo session makes zero network requests** — no registry lookup, no registry write, no Slack, no Substack, no Drive (Pass 4 §3; assert via mocked `fetch` in the seed test and confirm in the dev walkthrough's Network tab)
- [ ] The demo session writes nothing to Drive and creates no `.beanpod` file; its local IndexedDB cache, cached family key and registry row are all removed by `signOutAndClearData` (Requirement 6 as reworded — Pass 4 §8)
- [ ] **Seeding while a session already exists is refused with `session-exists`, writes nothing, and clears nothing** (Pass 4 §1)
- [ ] Seeding fires no Slack ping, no Substack subscribe, and no Plausible event; `window.plausible` is the original reference again afterwards — **and is `undefined`/absent again if it was absent before** — including on the failure path (Pass 4 §7)
- [ ] No confetti / celebration overlay fires during seeding
- [ ] **`materializeFixture` emits no `familyMembers` entry whose id is `ownerMemberId`**, and every member reference in the fixture resolves to a fixture member or the owner (Pass 4 §2)
- [ ] The demo banner is visible for the whole session, **and disappears after a normal sign-out from `AppHeader` (no reload) — it never appears on a subsequently-created real pod in the same JS session** (Pass 4 §4)
- [ ] Every failure path shows a specific message and emits its `error_code`; a partial seed is torn down via `signOutAndClearData` exactly once, and `session-exists` / `not-available` / `provider-install` tear down **zero** times
- [ ] `deploy.yml` defines neither `VITE_REVIEW_DEMO*` var, and the parity test asserts it
- [ ] The invite gate still passes its existing suite after the `inviteToken` consolidation (and, if §0 was taken, `inviteService` + `pkce` do too)
- [ ] `npm run type-check`, `npm run lint` and the unit suite pass
- [ ] `docs/runbooks/native-store-submission.md` carries the exact App Review Information text, the expiry semantics, and the reload/sign-out note
- [ ] **`grep -rn "REVIEW-DEMO:" src/ .github/` returns every shared-code touchpoint**, and `docs/runbooks/native-store-submission.md` carries the retirement checklist
- [ ] No new Pinia store, composable, or `isDemoSession` read outside `ReviewDemoBanner.vue` (Guardrails 4 and 6)
- [ ] No nested `try`/`catch` in any new file (Guardrail 1)
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; no new context key required

## Testing Plan

1. **Unit — gate matrix.** `reviewDemo.test.ts` covers all four arming combinations plus expiry past/future/unset/garbage, using `vi.stubEnv`. Assert fail-closed on every malformed input, assert `isReviewDemoAvailable` is the sole input to all consumers, assert the parse warning fires once rather than per call, and assert the **armed-without-expiry** warning fires (Pass 4 §5). Include a boundary case pinning the UTC-midnight semantics: with `EXPIRES=2026-11-01`, `2026-10-31T23:59:59Z` is available and `2026-11-01T00:00:00Z` is not.
2. **Unit — session flag lifecycle (Pass 4 §4).** `markDemoSession()` → `isDemoSession` true; `resetAllAppStores()` → false. Guards the banner-leak regression directly.
3. **Unit — shared code gate.** `matchesHashedCode`: correct, wrong, wrong case, surrounding whitespace, empty input, empty list, multi-hash list, and a mocked `crypto.subtle.digest` rejection → returns false **and** reports (proving no silent failure). Plus: `validateInviteToken` returns `true` when the invite gate is off while `validateReviewDemoCode` returns `false` when the demo gate is off — the inversion lives at the call sites, and this pins it.
4. **Unit — analytics suppression.** `withAnalyticsSuppressed`: events inside are swallowed; `window.plausible` is restored to the identical original afterwards; **when it was absent beforehand, the key is absent afterwards** (`'plausible' in window === false`); restored even when `fn` rejects; nested calls restore correctly once.
5. **Unit — seed.** `demoSeed.test.ts` asserts: **`currentUser` set → `session-exists`, and neither `signUp`, `createNewFile`, `seedDocument` nor `signOutAndClearData` is called** (Pass 4 §1 — the most important test in this plan); the expected entity count reaches `seedDocument`; `materializeFixture` is called with the id `signUp` produced; `reloadAllStores` runs after it; `lookupFamilyResult`, `registerFamilyOrThrow` and `slackNotify` are never called; **`fetch` is never called**; no `window.plausible` call is recorded during the seed; and a forced failure at each stage returns the right `error_code` and calls `signOutAndClearData` exactly once (and _zero_ times for `session-exists` / `not-available` / `provider-install`, where nothing was created).
6. **Unit — `createNewFile` option.** In `createNewFile.test.ts`: `suppressRemoteSideEffects: true` skips the existing-pod lookup, registry registration and Slack; the default path still does all three (guards against the flag inverting).
7. **Unit — shared seeder.** `seedDocument` batches into a single `docClient.mutate` and covers every `COLLECTION_NAMES` entry present in the input, and applies `settings` via the `setSettings` named mutation; `dataBridge.seedData` still stages a snapshot after delegating.
8. **Fixture integrity.** Assert `materializeFixture` is pure — the same injected `{ today, ownerMemberId }` produces identical output, and every date resolves relative to `today` (no hardcoded past dates); **no `familyMembers` entry uses `ownerMemberId`**; every member/account/goal reference resolves; and every fixture email ends `@example.invalid`.
9. **Workflow parity.** Existing suite (mobile release lanes ⊇ web) plus the new negative assertion (web defines no `VITE_REVIEW_DEMO*`). Record in the test comment _why_ the negative assertion is needed: the existing direction cannot see a mobile-only var (Pass 4 §11).
10. **Bundle check.** Build with the gate armed; `grep` `dist/` for the plaintext code — must be absent. Build un-armed; confirm the demo chunk exists but is **never fetched** at runtime (do not assert it is absent from `dist/` — see §Context, the gate is not statically foldable).
11. **Regression — consolidation.** Run the existing `inviteToken` suite (required). If §0 was taken, run `inviteService` and `pkce` too — a changed digest encoding would break real invites and real OAuth, so that gate is non-negotiable before merging §0.
12. **Manual (dev).** `VITE_REVIEW_DEMO=true` + a local hash + a future expiry in `.env.local`; walk the full flow with the Network tab open (assert no requests during seed), then walk every page of the seeded pod, then sign out from `AppHeader` and confirm the banner is gone.
13. **Manual (TestFlight).** Install the armed build on a device with no pod, in a browser/app never signed in to Google, and complete the flow exactly as the runbook instructs a reviewer to. This is the only test that proves the actual submission works. Also confirm the reload behaviour matches Assumption 7 so the runbook text is accurate.
14. **Manual (retirement dry-run).** Run `grep -rn "REVIEW-DEMO:" src/ .github/` and confirm the result matches the checklist in the runbook. Five minutes now; hours saved later.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the code-gated, runtime-seeded in-memory demo pod — env-armed + hashed code + baked-in expiry, reusing the existing memory-provider create seam rather than shipping a pre-built `.beanpod`.
- **Pass 2 (DRY / error handling)**: Verified every reuse claim against the source. Corrected four factual errors that would not have compiled or would have shipped side effects (`createNewFile`'s real signature + result-not-throw contract; the Slack ping living inside `createNewFile`, not `CreatePodView`; `deferPassword: true` tripping the fail-closed sentinel precondition; store-by-store seeding firing confetti, Plausible and balance cascades). Removed five would-be duplications by extracting and sharing what already exists: SHA-256 into `encoding.ts`, the normalize→hash→membership gate into `hashedCodeGate.ts` shared with the invite gate, the batch document seeder out of `dataBridge.ts`, `signOutAndClearData` as the teardown, and `reloadAllStores` as the refresh. Replaced the bespoke `AppHeader` chip with an `ErrorBanner` wrapper and the hand-rolled error modal + `reportError` pair with the single `showToast(..., { critical: true })` seam that already reports. Collapsed two suppression flags into one option, mapped `createNewFile`'s existing closed `reason` union straight onto `error_code`, made `DemoSeedErrorCode` closed, added `crypto-unavailable` and `teardown` as explicitly-handled failures, added Plausible-event suppression, fixed the `perfTiming` context to a real `PerfContext` field, and added a negative CI assertion that the web bundle never carries the bypass.
- **Pass 3 (Sustainability / maintainability / reliability)**: Treated demo mode as what it is — a temporary feature that must be deletable — and cut its long-term cost. Added a **Retirement** section (grep-able `REVIEW-DEMO:` markers on every shared-code touchpoint, a runbook removal checklist, and acceptance criteria for both) and a **Complexity Guardrails** section with seven hard limits (no nested try/catch, max nesting depth 2, no new store/composable, one new directory, a capped set of shared-code touchpoints, nothing becomes a prerequisite for unrelated work). Cut blast radius by demoting the `pkce.ts` + `inviteService.ts` digest consolidation from _required_ to an **optional, independently-mergeable Phase 0** — refactoring the OAuth login path to save seven lines inside a submission-unblocking change is the wrong risk trade, and Pass 2 also missed that it drags `perfTiming` into OAuth; only the genuinely-shared `inviteToken` consolidation stays required. Moved the `window.plausible` monkey-patch out of `demoSeed.ts` into `withAnalyticsSuppressed()` in `services/analytics/plausible.ts`, the module that already owns that global, making it discoverable, re-entrant-safe and unit-tested. Replaced Pass 2's multi-step try/catch structure with a single `fail()` helper and linear early returns, giving exactly one teardown call site. Fixed a real reliability defect: Pass 2 re-parsed the expiry date on every `isReviewDemoAvailable()` call, which would have console-warned on every render and keystroke — now parsed once into a module const, compared per call. Removed the one-file `src/services/seed/` directory by putting `seedDocument.ts` beside the `docClient` it wraps. Added an explicit five-phase implementation sequence where each phase is independently revertible, plus tests for suppression restore-on-throw, teardown call counts per stage, fixture purity, and a retirement dry-run. Corrected component paths to `@/components/ui/`, noted that `seedDocument` now ships in production where `dataBridge` did not, and documented `DEMO_PASSWORD` as intentionally non-secret.
- **Pass 4 (Fresh eyes / final sweep)**: Re-verified every seam against source and found one **data-safety defect** plus eleven correctness/accuracy issues. Chief among them: `signUp`'s idempotency guard (`if (currentUser.value) return { success: true }`) meant a pre-existing session would have made the seed write ~60 synthetic records into a **real family's Automerge document** — fixed with a non-destructive `session-exists` precondition as step 0. Also: `materializeFixture(today)` could not produce valid data (it needs the runtime `ownerMemberId`, and must not re-emit the owner member and clobber its password hash); the suppression option missed `createNewFile`'s pre-write `registry.lookupFamilyResult` network call, so "no network" was false; `isDemoSession` was not one-way-safe because `AppHeader`'s sign-out does `router.replace` not a reload — added `clearDemoSession()` called from `resetAllAppStores()` (a fourth, correctly-owned touchpoint); an armed build with an unset expiry was **silently** dead because `parseIsoDateSafely` only warns on _unparseable_, not empty, input — added a module-load warning; `VITE_REVIEW_DEMO_EXPIRES` is UTC-midnight, i.e. an off-by-one-day trap, now documented in three places; `withAnalyticsSuppressed` must `delete` rather than restore-undefined, because analytics is exempted from both mobile release lanes and `window.plausible` is genuinely absent there. Corrected four overclaims: dropped the "fully tree-shaken" security claim (the gate is two function calls over injected literals and is not statically foldable — the real guarantees are runtime short-circuit, an unfetched dynamic chunk, and no plaintext secret); rewrote Requirement 6, which said "writes nothing" while `createNewFile` demonstrably persists an IndexedDB cache, an envelope and a cached family key; replaced "one union member and one case" with the exact `LoginPage` wiring (two _local_ `LoginView` declarations, a modal-not-a-view branch that must come first and early-return so narrowing keeps the tail assignment valid); and recorded that CI builds five bundles, not three, which is why the one-directional parity test cannot substitute for the explicit negative assertion. Added six acceptance criteria and three unit tests covering the new guards.

## Outcome (implemented 2026-08-20)

Shipped complete. `npm run type-check`, `npm run lint` (0 errors in `src/`) and the
full unit suite (399 files / 4558 tests) all pass, and the flow was driven
end-to-end in a real browser against an armed dev build.

**Phase 0 was skipped**, as agreed — the `pkce.ts` / `inviteService.ts` digest
consolidation touches the OAuth login path for every real Drive user and is not
needed here. `encoding.ts` gained `sha256` + `sha256Hex` only; `sha256Base64url`
was dropped rather than shipped with no caller.

### What the browser walkthrough caught that the unit tests could not

Every unit test passed while the feature was still broken for a reviewer. Three
defects only surfaced by driving the real app:

1. **The reviewer landed on the first-run setup wizard, not the demo family.**
   `buildOwnerDoc` sets `onboardingCompleted: false`, and the real create flow
   clears it by walking the user through `OnboardingWizard` on `/nook`. Fixed by
   calling `settingsStore.setOnboardingCompleted(true)` during the seed — through
   the store, because the `setSettings` mutation REPLACES the settings singleton,
   so seeding a partial settings object from the fixture would have silently
   dropped every other default. `settingsStore` swallows its own write errors into
   `error.value` rather than throwing, so the seed verifies the flag afterwards
   and fails with `fixture-write` if it did not stick.
2. **The seed made a network call**, violating Requirement 5. Setting the base
   currency to GBP made the app fetch live rates from a CDN. The fixture is now
   authored in USD to match `DEFAULT_CURRENCY`, and the base currency is left
   alone. Verified: zero external requests during the seed.
3. **Assumption 7 was wrong** — a reload does not end the demo session (see the
   struck-through assumption above), which left the demo banner missing while the
   synthetic data stayed on screen. `isDemoSession` is now `sessionStorage`-backed.

### Deliberately not done

- **The trusted-device prompt is not suppressed for demo sessions.** It appears
  right after landing. Suppressing it would mean a fifth demo-specific branch in
  shared code, which Guardrail 6 says should trigger a re-plan rather than another
  `if`. The reviewer instructions tell them to dismiss it, and the runbook records
  this as a decision to revisit if review feedback ever flags it.
- **Nothing was built toward the possible future "try beanies" public demo.** It
  is recorded as a decision point at the top of the retirement checklist.

### Verified in-browser

Affordance renders only when armed · wrong code rejected inline · correct code
lands on `/nook` · demo banner visible throughout and across a reload · nook,
dashboard, transactions, accounts, activities and to-dos all populated · **zero
external network requests during the seed** · no console errors · plaintext code
absent from `dist/` in an armed build · no code hash present in an un-armed build.

### Still outstanding

- **TestFlight / Play internal-testing walkthrough on a real device** (Testing
  §13). The only test that proves the actual submission works; cannot be done from
  the dev environment.
- The GitHub repo variables `REVIEW_DEMO` / `REVIEW_DEMO_EXPIRES` and the secret
  `REVIEW_DEMO_CODE_HASH` must be created before an armed build can be produced.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> no matter what i do it seems that i can't force google to turn of 2FA checks on the beaniesdemo@gmail.com account that i sent to apple for review. they keep telling me they are being asked for a code every time they logon. is there any way to turn off all forms of 2FA and verification for gmail ?

### Follow-up 1

> plan option A with /beanies-plan

(Option A, as presented in the preceding answer: "Ship a review bypass — a hidden code on the welcome screen that loads a pre-seeded pod straight from a bundled `.beanpod` — no Google, no Drive, no OAuth. Put the code in App Review Information notes.")

### Follow-up 2 (approval)

> approve and start implementation to completion, no need for a mockup, ok to skip phase 0 if it's not needed for this feature to work. we can perhaps use it as a general demo for other users interested in beanies as well in teh future

### Pass 2 review prompt

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles - you are not re-writing or repeating any code.
>
> Check existing helpers, functions, composables, etc or other code where a solution already exists, check existing components and other reusable UI elements. If you are re-implementing any code that already exists elsewhere, including a UI modal or component that exists elsewhere (or a very close version exists), function, helper, composable, etc, considering refactoring this into a generic item now as opposed to duplicating code and refactoring later.
>
> Ensure that there are never any silent failures. Everything with the potential to fail should be handled gracefully (i.e. a try/catch block or something similar as appropriate). Users should be shown informative error message, with direction for developers as well either in the error modal itself or on the console. Nothing should ever fail silently, and guidance on how to fix the error should always be available.
>
> Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, silent failures, overly complicated flows, or code bloat where not necessary.

### Pass 3 review prompt

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex or difficult to support or maintain in the future. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

### Pass 4 review prompt

> Take one more pass at the plan and review again with fresh eyes. Review all activities proposed and confirm again that we are applying the most simple, secure, robust, and elegant solution, strictly following DRY principles, ensuring a focus on long term sustainability, maintenance, and reliability, and avoiding introducing any bugs or side effects. This will probably be the final iteration of the plan, so please ensure we have captured any relevant issues and are implementing the most robust and sustainable version of this plan.

</details>
