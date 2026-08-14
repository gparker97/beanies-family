# Plan: Heal stale Google account bindings on proven file access (kill benign account-mismatch false positives)

> Date: 2026-08-14
> Related issues: Tracker #62 (Google token churn) — follow-ups (b), (c), (d). None on GitHub — direct implementation.
> Plan file: `docs/plans/2026-08-14-google-account-binding-heal-on-access.md`

## User Story

As a beanies.family user whose Google session account differs from the account a file was originally bound to (but who can still access the file), I want the app to stop falsely telling me I'm signed in with the wrong account and to quietly correct its stored binding, so that opening my family data is calm and truthful instead of throwing a "wrong Google account / reconnect required" warning on every refresh while everything actually works.

## Context

On app version 0.9.10R1, greg — signed in as `gregsophia@gmail.com` and actively using the `parker meng beanies` file (which loads and syncs correctly) — sees, on **every hard refresh**:

1. A toast: **"Wrong Google account — Please sign in with beanies.demo@gmail.com to access your data."** It flashes, then clears after a few seconds; data loads and syncs fine throughout.
2. Settings → Family Data Options shows **"Signed in with beanies.demo@gmail.com"** (the _wrong_ account) plus a warning: **"Drive session account (gregsophia@gmail.com) does not match this file's bound account (beanies.demo@gmail.com) — reconnect required."**

Every one of these is a **false positive**. The data is fully accessible the whole time.

### Root cause

Three separate identities exist for the file; two are **stale** (left over from prior dual-account testing):

| #   | Identity                                      | greg's value                     | Where it lives                                                                                                                                         |
| --- | --------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Live Drive session** (what he consented as) | `gregsophia@gmail.com`           | `cachedEmail` in `googleAuth.ts`, verified against the real token via `fetchGoogleUserEmail(token)`                                                    |
| 2   | **Provider bound account**                    | `beanies.demo@gmail.com` (stale) | `provider.accountEmail` → persisted as `driveAccountEmail` in the IndexedDB provider config; surfaced in Settings via `syncStore.providerAccountEmail` |
| 3   | **Member record binding**                     | `beanies.demo@gmail.com` (stale) | `member.googleAccountEmail` in the Automerge doc                                                                                                       |

**The account-email is not the data-integrity anchor — the `fileId` is.** The provider writes to a fixed `fileId` using whatever token the live session holds; if that account can reach the file (owns it or is shared on it), the operation succeeds regardless of which email "owns" the stored binding. The email binding is purely a UX affordance: (a) a friendly "reconnect as X" message instead of a raw 404, and (b) selecting the correct per-account beanpod-mirrored refresh token for silent recovery.

Three surfaces all fire on a **nominal** email mismatch, even though the session account demonstrably **can** access the file:

- **Toast** — `googleAccountAssertion.ts` (`registerGoogleAccountAssertion`, the mismatch branch at lines 140–158) compares the live OAuth email against `member.googleAccountEmail`. It is `warn-once` per session (the `mismatchWarned` latch), so it fires exactly once on every hard refresh (each refresh is a fresh session).
- **`ensureBoundAccount()`** — `googleDriveProvider.ts:143–151` throws `TokenExpiredError("… does not match this file's bound account … reconnect required")` whenever `getGoogleAccountEmail() !== this.accountEmail`. This is a **pre-emptive nominal gate**, called at the top of `read`/`write`/`listAux`/`readAux`/`writeAux`/`deleteAux` — not a check of whether access actually works.
- **Settings display** — `SettingsPage.vue:1442` renders `syncStore.providerAccountEmail` (= `provider.getAccountEmail()` = the **stale** bound account #2), not the live session, as "Signed in with". The persistent "reconnect required" warning at `SettingsPage.vue:1543–1546` renders `syncStore.error` — which is the raw `TokenExpiredError` message thrown by `ensureBoundAccount()`; removing the pre-emptive throw (Change 1) removes that warning for the benign case.

### The protection we must NOT break (finding 9)

`ensureBoundAccount()` was added deliberately (2026-06-19 "finding 9") to catch a **real** failure: if the live session silently drifts to an account that **cannot** reach the file, using that account's token yields spurious 404s and a confusing reconnect loop / missing-file recovery. The guard converts that into a clean "reconnect for the bound account" message. `updateAccountEmailIfAvailable()` (`googleDriveProvider.ts:420–432`) correspondingly only ever _learns_ `null → email` and explicitly refuses to rebind `A → B`, citing finding 9.

Our fix must preserve that protection for the genuine can't-access case while eliminating the false positive for the can-access case. The discriminator that separates them is **whether an actual Drive operation succeeds** — which we only know _after_ attempting it.

## Requirements

1. **No false toast.** A nominal account mismatch where the session can access the file must produce **no** "wrong Google account" toast.
2. **No false "reconnect required".** The same benign mismatch must not raise the reconnect banner or block reads/writes.
3. **Preserve finding-9 protection.** A genuine mismatch where the session account **cannot** access the file must still produce a clear "reconnect as the bound account" signal (reconnect banner), and must NOT be misrouted into missing-file recovery or a silent data-duplication path.
4. **Self-heal on proven access.** After a Drive read/write **succeeds** with the live session account while a nominal mismatch exists, rebind (and persist) `provider.accountEmail` and rebind `member.googleAccountEmail` to the live verified account, so subsequent refreshes have no mismatch at all. These two bindings are reconciled independently (each may be stale on its own).
5. **Heal only on PROVEN access, never on mere identity.** The rebind must be gated on a successful Drive operation — never on token acquisition / consent completion alone (that is the finding-9 hazard: rebinding to an account that would then fail).
6. **Truthful Settings display.** Settings → Family Data Options must show the **live session account** as "Signed in with", not a stale bound account.
7. **Verified email only.** The heal must rebind to the OAuth-**verified** live email (`fetchGoogleUserEmail`-confirmed, i.e. `cachedEmailToken` non-null), never to an unverified primed guess (`setGoogleAccountEmail` sets `cachedEmailToken = null`).
8. **Fold in #62 (c):** sign-out must not clear the stored IndexedDB refresh token **un-revoked** when no in-memory token exists — read and revoke it first, so it does not leak toward Google's per-account token cap.
9. **Observability:** the heal decision, the suppressed-benign-mismatch path, and the genuine-mismatch-on-failure path each emit a structured `logEvent` — using only **already-allowlisted** context keys — so rates are queryable in CloudWatch without a coupled allowlist change.
10. **No new user-facing feature copy beyond removing the mismatch strings.** This is a correctness fix, not a feature.

## Important Notes & Caveats

- **Do NOT heal at `onTokenAcquired` / consent completion.** That point knows the live _identity_ but has **no proof of file access** (Drive access is per-file, not per-scope). Rebinding there re-introduces the finding-9 hazard. The earliest safe point is the first successful `read` — which _is_ the file-open.
- **`createNew` already binds correctly** from the `fetchGoogleUserEmail`-verified email (`googleDriveProvider.ts:455,495`), so a freshly created pod needs no heal.
- **Item (b) — self-recovery across a different mirrored account — is BY DESIGN, not a bug to "fix" here.** `tryReconnectSilently(getGoogleAccountEmail())` reads the doc-mirrored token keyed by the **session** account; `matchesBoundAccount` deliberately rejects a token minted for a different account (`driveTokenRecovery.ts` invariant: "a token for account A is never used by a device acting as account B"). Forcing cross-account adoption would violate that core invariant. The heal in this plan _narrows_ (b) organically: once the binding is corrected to the session account, the next interactive acquisition re-mirrors the token under the correct account. **We document (b) as a deliberate boundary and make no code change for it.**
- **Item (a) — the full unified Drive + Calendar single-consent (tracker #62 "commit 5") — is explicitly OUT OF SCOPE.** It is a larger, iOS-live-only OAuth-completion piece. Note the boundary; do not absorb it.
- **`ensureBoundAccount` has 6 call sites** in the provider: `read`, `write`, `listAux`, `readAux`, `writeAux`, `deleteAux`. The aux ops are best-effort (any failure degrades to whole-doc sync), so they must not gain new blocking behavior.
- **`read()` and `write()` do NOT catch 404 symmetrically today.** `write()` has an explicit `status === 404` branch (`googleDriveProvider.ts:184`) that re-throws for missing-file recovery — modify it. `read()`'s catch (lines 238–253) special-cases only `401` and re-throws everything else — a **new** 404 branch must be added there. Do not assume a symmetric edit. **Both branches call the same shared `reconnectIfAccountMismatch()` helper (see Change 1) — so despite the asymmetric wiring, there is only ONE copy of the classifier decision and the reconnect message string.**
- **Drive returns 404 for "not found OR no access"** (it does not distinguish, to avoid leaking existence). So the genuine-can't-access case surfaces primarily as a 404, not a 403. The classifier must key on 404 (keep the existing 401 → silent-refresh path untouched).
- **`getGoogleAccountEmail()` can be null or a primed (unverified) guess** at read time. When it is null/unverified, the classifier cannot attribute a failure to an account mismatch — it must fall back to today's behavior (no regression), exactly as the current guard's `if (!active) return;` does. (This uses `getGoogleAccountEmail`, the same value the old guard used — safe. The _heal_ is stricter: it requires the **verified** accessor, per Requirement 7.)
- This is **auth-critical and cross-cutting**. Keep the change minimal and well-logged; do not refactor unrelated auth flows.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-08-14); confirmed against the code below.

1. `fetchGoogleUserEmail(token)` sets `cachedEmail` and `cachedEmailToken = token` (verified), and `setGoogleAccountEmail(email)` sets `cachedEmailToken = null` (primed/unverified) — so "verified" can be distinguished from "primed". (Confirmed at `googleAuth.ts:1791–1831`; module-level `cachedEmail`/`cachedEmailToken` at lines 94–95.)
2. A successful `read()`/`write()` in `GoogleDriveProvider` means the live session account genuinely has access to `this.fileId`. (True — Drive returns 200 only when the token's account can read/write the file.)
3. `syncStore` is the orchestrator that observes load/save success and may call both `provider.persist(...)` and `familyStore.updateMember(...)` — consistent with MVO (provider = service, store = orchestrator). (Confirmed: `updateProviderEmailAfterLoad` at `syncStore.ts:3452` already does provider persist + `providerAccountEmail` update post-load; `onSaveComplete` subscription at `syncStore.ts:451` is the post-save seam.)
4. `member.googleAccountEmail` is safe to overwrite once access is proven for the live account. (The member's Google identity for this device legitimately became the live account.)
5. `familyStore.updateMember(memberId, { googleAccountEmail })` exists and persists to the Automerge doc via `familyRepo.updateFamilyMember`. (Confirmed: `familyStore.ts:252-265`.)
6. The reconnect banner path already handles a `TokenExpiredError` surfaced from a Drive op (via `syncStore`), so re-routing a genuine-mismatch 404 into that message reaches the user correctly. (Confirmed: the existing `ensureBoundAccount` throws the identical `TokenExpiredError` shape today; its message flows to `syncStore.error` and renders at `SettingsPage.vue:1543–1546` / the reconnect banner — Change 1 preserves that exact message string.)
7. **The context keys the new events want (`trigger`, `outcome`, `changed`, `had_prior_binding`, `source`) are NOT in `ALLOWED_CONTEXT_KEYS`** (`diagnosticContext.ts:61–247`). `redactContext` drops any non-allowlisted key with a `console.warn` — so these would be **silently stripped**. The already-allowlisted keys we CAN use freely are `action` (general free-form string), `http_status`, `provider_type`, `severity`, and the `token_*` family (`token_grant`/`token_op`/`token_outcome`/`token_trigger`, emitted by `logTokenLifecycle`). Adding a genuinely new key is a coupled change (mirror in the Lambda allowlist + its pinned test + `docs/runbooks/native-store-submission.md` + `PrivacyInfo.xcprivacy` + Play Data-Safety / App-Privacy + `privacy.astro`). **We avoid that entirely by encoding decisions in `action`.** (Confirmed at `diagnosticContext.ts`: `action`, `http_status`, `provider_type`, `severity` present; `trigger`/`outcome`/`changed`/`source`/`had_prior_binding` absent.)
8. `revokeGrant(token, { grant, trigger })` **already** calls `logTokenLifecycle({ op: 'revoke', outcome, trigger })` internally (`googleRevoke.ts:119–137`), so any revoke path is self-observable — no extra logging code is needed for (c).

## Approach

The unifying principle: **make "can access" the source of truth, not "email matches."** A nominal mismatch is treated as _provisional_, never as an error on its own. The real signals are (a) an actual Drive failure → surface reconnect, and (b) an actual Drive success → heal the stale binding.

A secondary principle for this pass: **each new decision has exactly one home.** The 404 classifier + reconnect message live in one private method; the "is the binding converged?" question is answered once (inside the heal); the non-reactive session-email mirror is written through one helper. This keeps an auth-critical, cross-cutting change from sprouting duplicated logic that later drifts.

### Change 1 — `ensureBoundAccount`: gate → classifier (`googleDriveProvider.ts`)

Stop pre-emptively throwing on a nominal mismatch. Instead, let the Drive API be the arbiter and classify the _result_:

- **Remove the pre-call `this.ensureBoundAccount()` invocations** from `read` (line 227), `write` (line 155), `listAux` (375), `readAux` (384), `writeAux` (396), `deleteAux` (405).
- **Repurpose the guard into a private predicate** `private accountMismatch(): boolean` returning `true` only when both emails are known and differ (`this.accountEmail && getGoogleAccountEmail() && they differ`) — the exact condition the old guard used, minus the throw. Keep the finding-9 rationale in its doc-comment.
- **Add a single shared classifier** that both catch blocks call, so the reconnect message string and its log event exist in exactly one place:

  ```
  /**
   * Shared 404 classifier (finding 9). Call from a caught Drive 404. If the
   * live session account is known to differ from this file's bound account,
   * that 404 means "this account can't reach the file" — log it and throw the
   * reconnect TokenExpiredError so the banner appears for the bound account.
   * Otherwise return; the caller re-throws the raw 404 for missing-file
   * recovery (today's behavior). SINGLE home for the reconnect message string
   * and the drive-account-mismatch-blocked event.
   */
  private reconnectIfAccountMismatch(): void
  ```

  Body: `if (!this.accountMismatch()) return;` then `logEvent({ level:'warn', surface:'drive-account-mismatch-blocked', context:{ http_status: 404, action: 'reconnect-required' } })`, then `throw new TokenExpiredError(\`Drive session account (${getGoogleAccountEmail()}) does not match this file's bound account (${this.accountEmail}) — reconnect required\`)`— the message string identical to today's`ensureBoundAccount` so it routes to the reconnect banner unchanged.

- **`write()` catch — modify the existing 404 branch (line 184):** replace the bare `throw e;` with `this.reconnectIfAccountMismatch(); throw e;`. When accounts are known to differ, the helper throws the reconnect error (finding-9 message, routes to banner, does NOT reach missing-file recovery); otherwise it returns and the `throw e;` preserves today's missing-file behavior.
- **`read()` catch — ADD a 404 branch (there is none today; the catch only handles 401 then re-throws at line 252):** `if (e instanceof DriveApiError && e.status === 404) { this.reconnectIfAccountMismatch(); throw e; }` above the final re-throw — same shared helper, so read and write cannot drift.
- Aux ops need no classifier — a bare failure already degrades to whole-doc sync (best-effort by contract); dropping their pre-emptive guard cannot cause data loss.

This preserves finding-9's user experience for the genuine can't-access case (still a "reconnect for the bound account" message) while never blocking a session that can actually access the file — and it does so with **one** copy of the classifier decision, not one per op.

### Change 2 — Provider gains a proven-access rebind (`googleDriveProvider.ts`)

Add a narrowly-scoped method distinct from the null-only learner:

```
/**
 * Rebind this provider to a DIFFERENT account after that account has PROVEN
 * it can access this.fileId (a read/write succeeded). This is the ONE safe
 * exception to finding 9's "never rebind A→B": success is proof the new
 * account is a legitimate accessor. Returns true if the binding changed.
 * Callers MUST only invoke this after a successful Drive operation.
 */
rebindProvenAccount(verifiedEmail: string): boolean
```

It sets `this.accountEmail = verifiedEmail` when the value actually changes and returns whether it changed. `updateAccountEmailIfAvailable()` (null→learn) is left exactly as-is — its finding-9 comment stays accurate for the non-proven path.

### Change 3 — One heal orchestration in `syncStore` (`syncStore.ts`)

Add a single private orchestration function — the DRY home for "an access just succeeded; reconcile the stale binding(s)" — that **also owns the convergence decision** so callers never re-derive it:

```
/**
 * Reconcile stale provider AND member bindings after a proven Drive access.
 * The provider binding (per-device IndexedDB) and the member binding (shared
 * Automerge doc) can be stale independently, so each is reconciled on its own
 * — both under the same gate: a Drive op just succeeded (proven access) and a
 * VERIFIED live email exists. Each write is guarded by an inequality check so a
 * steady-state load performs no IndexedDB or Automerge write.
 *
 * Returns `true` when the binding is SETTLED (nothing left to do): either the
 * bindings are already correct, or we just reconciled them, or there is no
 * verified identity to act on and no further progress is possible right now.
 * Returns `false` only when there is no verified email yet AND a retry could
 * still converge — used by the load poll to decide whether to keep polling.
 * Best-effort: never throws.
 */
async function healAccountBindingIfNeeded(trigger: 'load' | 'save'): Promise<boolean>
```

Behavior:

1. Get the provider; if it is not a `GoogleDriveProvider`, return `true` (nothing to converge — stop any poll).
2. Resolve the **verified** live email via a new tiny accessor `getVerifiedGoogleAccountEmail(): string | null` in `googleAuth.ts` that returns `cachedEmail` only when `cachedEmailToken` is non-null (guards against a primed guess — Requirement 7). If it is null, emit the cheap `action:'noop-no-verified-email'` event and return **`false`** (no verified identity yet; a later poll tick could still converge — this is the "keep polling" signal). No regression: nothing is rebound.
3. **Reconcile the provider binding (independent).** If `verifiedEmail !== provider.getAccountEmail()`, call `provider.rebindProvenAccount(verifiedEmail)`; when it changes:
   - `providerAccountEmail.value = verifiedEmail`
   - `refreshSessionAccountEmail()` (see Change 5 — converges the Settings display in the same breath)
   - `await provider.persist(activeFamilyId)` (persists `driveAccountEmail`) — using `useFamilyContextStore().activeFamilyId`, guarded non-null (same pattern as the existing `updateProviderEmailAfterLoad`).
   - record `providerChanged = true`.
4. **Reconcile the member binding (independent).** Resolve `memberId` from `useAuthStore().currentUser?.memberId` (guarded) and the member from `familyStore`. If the member exists and `member.googleAccountEmail !== verifiedEmail`, call `familyStore.updateMember(memberId, { googleAccountEmail: verifiedEmail })` and record `memberChanged = true`. The inequality guard means a steady-state load writes nothing (no Automerge write amplification, no save loop — a member write triggers one more save whose `heal('save')` finds equality and no-ops).
5. **Log the outcome.** `logEvent` the heal with `action:'changed'` when `providerChanged || memberChanged`, else `action:'noop-steady-state'`. Return `true` (settled — with a verified email in hand, whatever could be reconciled has been).
6. Wrap the whole body in try/catch → `reportError({ surface: 'account-binding-heal', severity: 'warning' })` on failure and return `true` (best-effort; a failed heal must never break the load/save and must not spin the poll forever).

> Note: reconciling the member independently (not nested inside the provider-changed branch) is what satisfies Requirement 4 in the case where only one of the two bindings is stale — e.g. a provider already corrected on one device while the shared member doc, or a device whose provider was created correct, still carries a stale `member.googleAccountEmail`. Without this, `googleAccountAssertion` would log `account-mismatch-benign` on every refresh forever and the acceptance criterion "no mismatch anywhere" would not hold.

**Wiring the seams (reusing what already exists — no new callback plumbing):**

- **Post-load:** the existing `updateProviderEmailAfterLoad()` is a retry poll (`syncStore.ts:3452–3468`) that exists _because the verified email frequently arrives late_ after a cached-token resume. Do **not** delete it and replace with a single synchronous heal check — that would early-return before the email is verified and never retry (timing regression). Instead **fold the heal into the existing poll**, keeping its timing-robustness while upgrading it from "learn null→email only" to "learn null→email **and** rebind a stale one (provider and/or member)":
  - Each tick `await healAccountBindingIfNeeded('load')`; **clear the interval when it returns `true`** (settled) or when `attempts >= 10` (existing cap). The convergence definition lives entirely inside the heal — the poll does not independently re-check "verified email known and equal to bound email," avoiding two copies of that condition.
  - **Guard against overlapping ticks.** The tick now does heavier async work (`persist` + `updateMember`) on the convergence iteration, not just a synchronous check as today. A `setInterval` callback can re-enter if a tick outruns the interval. Add a `let ticking = false;` re-entrancy guard (skip the tick if `ticking`), or equivalently convert the loop to a self-scheduling `setTimeout` chain. Either removes the overlap hazard; prefer the guard for the smaller diff.

  This folds the two overlapping post-load email reconcilers into one code path (DRY) and is still called from the same site (`syncStore.ts:992`).

- **Post-save:** hook the **existing** `syncService.onSaveComplete(...)` subscription (`syncStore.ts:451`, currently just sets `lastSync`). Add a `void healAccountBindingIfNeeded('save')` call inside that callback (the returned boolean is unused on the save seam — there is no poll to stop). No new save-callback registration is introduced.

### Change 4 — Assertion: drop the false toast, keep backfill + switch (`googleAccountAssertion.ts`)

- **Keep** the deliberate-account-switch consumption branch (interactive + `isPendingAccountSwitch()`, lines 121–126) and the first-time backfill branch (`!member.googleAccountEmail`, lines 129–132) — both are correct and unaffected.
- **Replace the mismatch-toast branch** (lines 147–158) with a **silent** `logEvent` (level `info`, surface `account-mismatch-benign`, `context: { action: 'deferred-to-access-path' }`) recording that a nominal mismatch was observed and deferred to the access-based path. **No toast.** The genuine can't-access case is now surfaced by Change 1's classifier (reconnect banner) — a single, truthful signal instead of a pre-emptive guess.
- **Remove the now-dead `mismatchWarned` latch** (declaration line 40, the two resets at lines 123 & 136, and its reference in `_resetGoogleAccountAssertionForTests` line 171). `logEvent` has a built-in 50-events/surface/min rate-limit, so a repeating silent refresh cannot spam CloudWatch — the latch is no longer load-bearing.
- **Remove the now-unused imports** `showToast` (from `@/composables/useToast`) and `useTranslationStore` — they were only used by the deleted toast. Add `import { logEvent } from '@/services/telemetry'`.

### Change 5 — Settings shows the live session account (`SettingsPage.vue`, `syncStore.ts`)

- Add a `sessionAccountEmail` ref in `syncStore` backed by `getVerifiedGoogleAccountEmail()`. Because that accessor is a plain function (not reactive), it must be mirrored into the ref at the seams where the verified email can change. **To avoid three drifting copies of the same assignment, add one private helper** `function refreshSessionAccountEmail(): void { sessionAccountEmail.value = getVerifiedGoogleAccountEmail(); }` and call it — not an inline assignment — at each seam: the `reactiveState` subscription (`syncStore.ts:445`, alongside the existing `providerAccountEmail` refresh), the token-acquired handler, and inside `healAccountBindingIfNeeded` (step 3). One function to grep, one place to change the read logic. After a heal, `sessionAccountEmail` and `providerAccountEmail` converge; before a heal (or if access failed), the live session account is the truthful answer to "who am I signed in as."
- Change `SettingsPage.vue:1442` (and the `v-if` guard at line 1434) to display `syncStore.sessionAccountEmail` for "Signed in with". Guard fallback: if `sessionAccountEmail` is null (verified email not yet known), fall back to `providerAccountEmail` so the row does not vanish mid-session.
- The `CloudProviderBadge :account-email` at line 1369 should also receive the live session account (`sessionAccountEmail ?? providerAccountEmail`) for consistency.
- No new i18n key needed — `settings.familyData.signedInAs` copy is unchanged.

### Change 6 — #62 (c): revoke the stored refresh token before clearing it (`googleAuth.ts`)

In both `revokeToken()` (lines 1389–1413; revoke target resolved at line 1402, stored-token clear at 1408–1410) and `clearGoogleSessionState()` (the revoke at line 1475–1483 + the clear at 1489–1494), the revoke target is `currentRefreshToken?.token ?? accessToken`. When **both are null** (e.g. after a token death cleared `currentRefreshToken`), the code clears the **persisted** IndexedDB token (`clearGoogleRefreshToken(familyId)`) **without revoking it** — leaking a live grant toward Google's per-account cap.

Fix (contained):

- `revokeToken()`: when `revokeTarget` is null and a `currentFamilyId` exists, `await getGoogleRefreshToken(currentFamilyId)` and, if present, `await revokeGrant(stored.token, { grant: 'drive', trigger: 'signout' })` **before** the existing `clearGoogleRefreshToken(currentFamilyId)`.
- `clearGoogleSessionState()`: when NOT preserving, and both `refreshSnapshot` and `tokenSnapshot` are null and a `familyIdSnapshot` exists, `await getGoogleRefreshToken(familyIdSnapshot)` and, if present, revoke it before the `Promise.allSettled` clear step. Keep the network revoke fire-and-forget in shape, but this specific stored-token read+revoke is awaited (it only runs on the uncommon both-null path, so it does not slow the common teardown).
- **No extra logging code:** `revokeGrant` already emits `logTokenLifecycle({ op: 'revoke', outcome, trigger })` internally (`googleRevoke.ts:127`), so the stored-token revoke is visible in CloudWatch automatically.
- **Guards:** only do the extra IDB read when the in-memory target is null (avoid an unnecessary read on the common path). **Preserve `preserveRefreshToken` semantics** in `clearGoogleSessionState` — when preserving, do NOT read-or-revoke the stored token (trusted-device preservation deliberately keeps the grant live; the existing security note at lines 1468–1474 stays accurate).

### Items explicitly NOT changed

- **(b) cross-account self-recovery** — deliberate per-account invariant; documented boundary, no code change (heal narrows it organically).
- **(a) unified Drive+Calendar consent** — out of scope (larger separate piece).

## Files Affected

- `src/services/sync/providers/googleDriveProvider.ts` — `ensureBoundAccount` gate → `accountMismatch()` predicate + shared `reconnectIfAccountMismatch()` classifier (single home for the finding-9 message + `drive-account-mismatch-blocked` event); remove the 6 pre-emptive guard calls; 404-with-mismatch → reconnect `TokenExpiredError` in `write` (modify existing branch, call the helper) + `read` (add branch, call the same helper); add `rebindProvenAccount(verifiedEmail)`.
- `src/stores/syncStore.ts` — add `healAccountBindingIfNeeded(trigger): Promise<boolean>` (owns the convergence decision; reconciles provider AND member independently, each inequality-guarded); fold it into the `updateProviderEmailAfterLoad` poll (load; clear on returned `true` or attempts cap; add re-entrancy guard) and the existing `onSaveComplete` subscription (save); add reactive `sessionAccountEmail` written through one `refreshSessionAccountEmail()` helper at the existing refresh seams.
- `src/services/auth/googleAccountAssertion.ts` — remove mismatch toast + `mismatchWarned` latch + unused `showToast`/`useTranslationStore` imports; add silent `logEvent`; keep backfill + switch branches.
- `src/services/google/googleAuth.ts` — add `getVerifiedGoogleAccountEmail()`; (c) revoke stored IDB refresh token before clearing when no in-memory target, in `revokeToken` + `clearGoogleSessionState`.
- `src/pages/SettingsPage.vue` (~1358–1453) — "Signed in with" (line 1442 + `v-if` 1434) and `CloudProviderBadge` (1369) use `syncStore.sessionAccountEmail` (falling back to `providerAccountEmail`).
- `src/services/translation/uiStrings.ts` — remove the now-unused `auth.accountMismatchTitle` (line 3314) and `auth.accountMismatchBody` (3318) keys. `settings.familyData.signedInAs` unchanged.
- **No change to `src/utils/diagnosticContext.ts` / Lambda allowlist / privacy declarations** — all new events reuse already-allowlisted keys (`action`, `http_status`, `provider_type`, `severity`) and `logTokenLifecycle`'s existing `token_*` keys. (If a future reviewer insists on a dedicated `account-binding-heal` key, that becomes the full coupled change — deliberately avoided here.)
- Tests: `src/services/sync/providers/__tests__/googleDriveProvider.test.ts`, `src/services/auth/__tests__/googleAccountAssertion.test.ts` (update: it asserts the toast at lines 132/194/237 — rewrite to assert the silent `logEvent` + no toast, and drop the `auth.accountMismatch*` translation stub at line 53), `src/stores/__tests__/syncStore.resume.test.ts`, `src/services/google/__tests__/driveTokenRecovery.test.ts` (verify unaffected), plus new unit tests (below).

## Observability Coverage

All events flow to CloudWatch via `logEvent`/`reportError`. **No new context key is introduced** — every field below is already in `ALLOWED_CONTEXT_KEYS`, so nothing is silently stripped and no Lambda-mirror / privacy-declaration change is required. **Never log the actual email addresses** (PII) — the decision is carried by the fixed-enum `action` string, never by an email value.

- **Heal decision (success path — enables rate alerting):** `logEvent({ level: 'info', surface: 'account-binding-heal', context: { action: 'changed' | 'noop-steady-state' | 'noop-no-verified-email' } })`. `action:'changed'` is emitted when the provider binding, the member binding, or both were reconciled on this proven-access tick; `noop-steady-state` when both were already correct; `noop-no-verified-email` when no verified identity was available yet. Emitting the no-ops too (where cheap) makes the _rate_ of real heals versus already-correct versus not-yet-verified measurable. `provider_type` is auto-injected by `diagnosticContext`.
- **Benign mismatch suppressed (the thing we stopped toasting):** `logEvent({ level: 'info', surface: 'account-mismatch-benign', context: { action: 'deferred-to-access-path' } })` from `googleAccountAssertion.ts`, so we can see how often a nominal mismatch occurs and confirm the toast removal isn't hiding a real problem.
- **Genuine mismatch on access failure (finding-9 case):** the shared `reconnectIfAccountMismatch()` classifier logs `logEvent({ level: 'warn', surface: 'drive-account-mismatch-blocked', context: { http_status: 404, action: 'reconnect-required' } })` before throwing the reconnect `TokenExpiredError`, distinguishing a true can't-access from a benign one. (One emit site, shared by `read` and `write`.)
- **Heal failure:** `reportError({ surface: 'account-binding-heal', severity: 'warning', … })` — best-effort; never breaks the load/save, but visible (`severity` rides its allowlisted key).
- **(c) stored-token revoke:** no bespoke event — `revokeGrant` self-emits `logTokenLifecycle({ token_op: 'revoke', token_outcome, token_trigger: 'signout', token_grant: 'drive' })`, so the closed leak is confirmable in CloudWatch by the same query that covers every other revoke.
- **Triage-blind check:** "wrong account toast still appears" → filter `surface: account-mismatch-benign` (benign, expected) vs `drive-account-mismatch-blocked` (real). "token cap churn" → `token_op: revoke` outcomes. "binding never corrects" → `account-binding-heal` with `action: 'noop-steady-state'` repeating despite a known benign mismatch elsewhere, or `action: 'noop-no-verified-email'` never advancing to `changed` (verified email never arriving).

No `severity: 'critical'` is warranted — none of these is "user action failed / data at risk"; the benign path is silent-by-design and the genuine path already pages via the existing reconnect-failure flow if the user cannot reconnect.

## Acceptance Criteria

- [ ] On a hard refresh with a benign account mismatch (session account CAN access the file), **no** "wrong Google account" toast appears and **no** reconnect banner appears.
- [ ] After the first successful load with a benign mismatch, `provider.accountEmail`, the persisted `driveAccountEmail`, and `member.googleAccountEmail` are all rebound to the live verified session account; a second refresh shows no mismatch anywhere.
- [ ] When only ONE of the two bindings is stale (provider correct but member stale, or vice versa), the stale one still heals on the next proven access, and each already-correct binding is left untouched (no redundant IndexedDB / Automerge write).
- [ ] Settings → Family Data Options "Signed in with" shows the **live session account**, not the stale bound account, even before the heal completes (falls back to `providerAccountEmail` only if no verified email is known yet).
- [ ] A genuine mismatch (session account CANNOT access the file → Drive 404) still surfaces the "reconnect required" banner and does **not** trigger missing-file recovery or data duplication.
- [ ] The heal fires only after a successful Drive op, never on token acquisition alone (verified by test: a mismatch with no successful read/save does not rebind).
- [ ] The heal rebinds only to an OAuth-**verified** email (`cachedEmailToken` non-null), never a primed guess.
- [ ] The load poll terminates: it clears on a settled heal (`healAccountBindingIfNeeded` → `true`) or the attempts cap, and never re-enters overlapping ticks.
- [ ] Sign-out revokes the stored IndexedDB refresh token even when no in-memory token exists (no un-revoked leak); `preserveRefreshToken` still preserves it (no revoke, token survives).
- [ ] Observability implemented and verified: events fire with the stated `surface`/`action`; `redactContext` drops **no** key (grep the console for `dropped non-allowlisted context key` during a test run); no email PII logged; `(c)` revoke visible via `logTokenLifecycle`.
- [ ] No dead code / dead i18n keys left behind (removed `auth.accountMismatch*`, removed `mismatchWarned`, removed unused `showToast`/`useTranslationStore` imports; `updateProviderEmailAfterLoad` folded into the heal, not duplicated; reconnect message + classifier event exist in exactly one place).
- [ ] `npm run build` (full rollup import-analysis), `npm run type-check`, and Vitest all pass before push.

## Testing Plan

**Unit (Vitest):**

1. `googleDriveProvider`: `read()`/`write()` success with a nominal mismatch does **not** throw (no pre-emptive gate); `rebindProvenAccount` changes the binding and returns `true`, is a no-op returning `false` when equal.
2. `googleDriveProvider`: `read()` returning 404 **with** `accountMismatch()` true throws the reconnect `TokenExpiredError` (and logs `drive-account-mismatch-blocked`); 404 **without** a known mismatch keeps the missing-file path (re-throws the raw 404). Same two cases for `write()`. Assert **both** ops route through the same `reconnectIfAccountMismatch()` helper (identical message string / single log emit).
3. `syncStore.healAccountBindingIfNeeded`:
   - Both bindings stale on a proven mismatch → rebinds provider + persists + updates member, logs `action:'changed'`, returns `true`.
   - **Only provider stale** (member already correct) → rebinds/persists provider, does **not** call `updateMember`, logs `action:'changed'`, returns `true`.
   - **Only member stale** (provider already correct) → calls `updateMember`, does **not** rebind/persist provider, logs `action:'changed'`, returns `true`.
   - Both correct → no writes, `action:'noop-steady-state'`, returns `true`.
   - Live email only primed/unverified → `action:'noop-no-verified-email'`, returns `false`.
   - Best-effort: a throw in `updateMember` (or `persist`) is caught → `reportError`, returns `true`, load/save unaffected.
   - Poll test: interval clears when heal returns `true`, keeps polling (up to cap) while it returns `false`, and does not re-enter while a tick is in flight.
4. `googleAccountAssertion`: mismatch branch emits the benign `logEvent` (surface `account-mismatch-benign`) and shows **no** toast; backfill and account-switch branches unchanged; test updated to drop the toast + `mismatchWarned` expectations.
5. `googleAuth` (c): with `currentRefreshToken` and `accessToken` both null but a stored token present, `revokeToken`/`clearGoogleSessionState` call `revokeGrant` on the stored token before clearing; with `preserveRefreshToken`, no read/revoke and the token survives.
6. `getVerifiedGoogleAccountEmail`: returns the email only when `cachedEmailToken` is set; null after a primed `setGoogleAccountEmail`.

**Manual (greg, on deployed web — matches his repro):** 7. On `parker meng beanies` signed in as `gregsophia`: hard refresh → confirm no toast, no reconnect banner, data loads. Open Settings → "Signed in with" shows `gregsophia`. Hard refresh again → still clean (binding healed). 8. Confirm CloudWatch shows `account-binding-heal action:changed` on the first refresh, then `action:noop-steady-state` after. 9. (If reproducible) a file the session account genuinely cannot access → confirm the reconnect banner still appears with the right account name.

**Regression:** 10. Fresh create-pod (single account) → binding correct from `createNew`, heal is a no-op, no new toasts. Deliberate "Switch Google account" in Settings still rebinds via the assertion's switch branch.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full gate→classifier + heal-on-proven-access + Settings-truthfulness + (c) stored-token-revoke plan; scoped out (a) and documented (b) as a deliberate boundary; folded overlapping post-load email reconcilers into one `healAccountBindingIfNeeded`.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the code. Corrected the observability design (proposed keys were not allowlisted → would be silently stripped; reworked to reuse `action`/`http_status`/`severity` + `logTokenLifecycle`, avoiding a coupled Lambda/privacy change). De-duplicated Change 6 (`revokeGrant` self-logs). Pinned Change 1's read/write 404 asymmetry, Change 3's real seams (`onSaveComplete` + folding the existing poll rather than deleting it), Change 4's dead-import cleanup, and Change 5's non-reactive-accessor handling. No silent-failure paths remain.
- **Pass 3 (Sustainability)**: Collapsed the would-be-duplicated 404 classifier + reconnect message into a single shared `reconnectIfAccountMismatch()` helper (one home, not one-per-op); gave `healAccountBindingIfNeeded` ownership of the convergence decision via a returned `settled` boolean so the poll stops re-deriving it; routed the non-reactive `sessionAccountEmail` mirror through one `refreshSessionAccountEmail()` helper instead of three inline copies; added a re-entrancy guard to the now-heavier load poll.
- **Pass 4 (Fresh-eyes sweep)**: Re-verified every line reference, function name, and reuse claim against the live code (all accurate). Fixed one real gap against Requirement 4: the heal rebound `member.googleAccountEmail` only inside the provider-changed branch, so a provider-correct-but-member-stale divergence (the two bindings live in independent stores) would never heal and would log `account-mismatch-benign` forever — reworked Change 3 to reconcile provider and member independently under the same proven-access + verified-email gate, each inequality-guarded to avoid write amplification, with `action:'changed'` when either changed. Confirmed security (finding-9 preservation, (c) preserve-semantics), DRY (single classifier/message/heal home), and the allowlist-key claim all hold.

## Prompt Log

> No GitHub issue created — this plan was approved for direct implementation. Full prompt history embedded here.

<details>
<summary>Full prompt history</summary>

### Initial prompt (via /good-morning follow-up)

> Yes please continue the investigation - as a reminder here was the issue:
>
> i'm on 0.9.10R1 now on the web app, and every time i perform a hard refresh i get the wrong account toast: "wrong google account / please sign in with beanies.demo@gmail.com to access your data". it then disappears after a few sec, and everything seems ok. so perhaps the fix is not preventing the toast from being displayed.
>
> Note that I have already completed the google consent flow for gregsophia@gmail.com and i am looking at the family data file parker meng beanies which is the file i selected when i signed in, but the family data option screen shows that i am signed in with beanies.demo@gmail.com and there is a warning message saying "drive session account (gregsophia@gmail.com) does not match this file's bound account (beanies.demo@gmail.com) - reconnect required". however the family data file at the top of the view (under "my family's data") is set to parker meng beanies, which is NOT bound to beanies.demo@gmail.com.

### Follow-up (on the recommended fix)

> This looks good but a question about #2 in the recommended fix - why would we wait for a successful _read/write_ to update the relevant variables? Why not update them as soon as sign in / file open is successful? Or is that considered a read, so directly upon login (and google consent completion) all the correct vars would be set?

### Follow-up (proceed)

> yes, take this into /beanies-plan

</details>
