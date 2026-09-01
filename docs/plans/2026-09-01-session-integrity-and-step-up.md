# Plan: Seal the session, stop trusting the stored role, and step up the irreversible actions

> Date: 2026-09-01
> Related issues: Notion tracker #80 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-09-01-session-integrity-and-step-up.md`

> **No GitHub issue created.** Approved for direct implementation.

## User Story

As a parent, I want a session that cannot be hand-edited into somebody else's, and the handful of irreversible actions to demand my PIN, so that nobody who picks up my unlocked laptop can act as me or wreck the pod.

## Context

The #76 security review recorded four pre-existing auth gaps. This is the second. As with #79, **the tracker's description was half wrong and the correction matters**:

1. **Accurate.** The session is plain JSON in localStorage with no integrity check. `authStore.ts:426` writes `JSON.stringify(user)`; `:443` reads it back with a bare `JSON.parse` and a type assertion, and nothing verifies it in between.
2. **Accurate on the outcome, wrong on the mechanism — corrected in Pass 2.** `familyStore.ts:203-213` does _not_ blindly adopt the session's `memberId`: it already gates on `members.value.some((m) => m.id === sessionMemberId)`. So a forged id must name a **real member of the pod** — typically the owner — which is exactly the attack that matters, and it succeeds today. The genuinely unguarded fallback is the **last-resort branch** at `familyStore.ts:243`, `currentMemberId.value = owner.value?.id ?? prevMemberId`, reached when a `currentMemberId` vanishes from the roster: a member whose record was deleted silently becomes **the owner**. Both are in scope; the plan text below fixes the right lines.
3. **Second, independent vector — confirmed.** `usePermissions.ts:28` falls back to `authStore.currentUser?.role === 'owner'` whenever `currentMember` is null, so forging only the `role` field grants owner rights outright, without touching `memberId`.
4. **Stale — dropped.** "Web passkey assertions are never cryptographically verified" is no longer true. Phase 4 deleted that path: `passkeyService.ts:1-12` states the module "no longer creates web credentials, runs web assertions, or touches PRF", and `:138-142` confirms biometric is native-keystore only. There is no web assertion left to verify.

5. **Third vector, found in Pass 4 — same class, different function.** `familyStore.deleteMember` (`:325-338`) contains its own owner fallback: `if (currentMemberId.value === id) currentMemberId.value = owner.value?.id ?? null` (`:330-331`). Member deletion is gated on `canManagePod`, not on `isOwner`, and the owner-guard at the call sites only blocks deleting _the owner_ — not deleting _yourself_. So a non-owner with `canManagePod` who removes their own bean is silently repointed at the owner's member record, and `usePermissions.isOwner` then reads `true` from a real roster row. This is the same escalation as #2 reached by a supported UI action rather than by devtools, and it is fixed in §4b.

**Severity, stated honestly — it is lower than the row's "high".** The attacker must already hold the unlocked device with beanies signed in; there is no remote vector. Because the pod is one file under one family key, forging a `memberId` grants **no new read access** — any signed-in member can already read everything. What it grants is (a) writes attributed to someone else and (b) reach into owner-only actions. It buys nothing at all when the device is already signed in as the owner, which is the common case. The realistic attacker is a technically-minded child on a shared family desktop; devtools is effectively unavailable on iOS/Android. This is the same threat family #79 just closed. (Vector 5 raises the floor: it needs no devtools at all, only a `canManagePod` non-owner willing to delete themselves.)

**The limit this plan must not pretend away.** A client-side signature is **not** a cryptographic boundary. The devtools console shares the page's origin and can call any key the app can call, including a non-extractable `CryptoKey` in IndexedDB. The seal's real value is that it defeats _hand-editing_, which is exactly what the realistic attacker tries. The **PIN step-up is the only true boundary**, because a forger does not have the member's PIN. Both halves ship; neither is oversold.

**A second limit, added in Pass 3 — the migration branch is itself a bypass.** Requirement 4 needs an unsigned session to be accepted once so nobody is logged out by the update. But "accept an envelope with no `v` and no `t`" means an attacker can bypass the seal entirely by _deleting two fields_ rather than forging a tag. A permanently-open legacy branch would therefore make the seal decorative. §1 closes this with a **dated sunset constant**: legacy envelopes are accepted only until `LEGACY_SESSION_SUNSET`, after which the branch rejects and is deleted. The migration is bounded in time by construction, not by somebody remembering to remove it.

**A third limit, added in Pass 4 — the seal is only as available as the registry IndexedDB.** Sealing is fail-closed by design: no key means no session written, and an unverifiable session means signed out. On a browser where localStorage works but IndexedDB does not, that becomes a _reload loop of logouts_. This is rare, but it is the one failure mode of this change that would be invisible to the user and to us. §2 therefore emits a `logEvent` on the `'unavailable'` branch — a silent logout with zero telemetry is not acceptable on the boot path.

**Greg's constraint, in his words:** "I want to avoid too much friction... why such as a bunch of step up PINs." The step-up is therefore confined to four once-a-year actions. **Any design that adds a prompt to routine use is a defect.**

## Requirements

1. The persisted session carries an integrity tag. A hand-edited session fails **closed** on load: not authenticated, returned to the login screen, never silently accepted.
2. The signing key must **not** live in localStorage beside the session.
3. Verification is fully offline. No step may depend on a server.
4. **Upgrade in place.** An existing unsigned session is accepted exactly once and immediately re-sealed. Nobody is logged out by the update. **The acceptance is time-bounded and self-deleting** (see §1) so it does not become a permanent hole.
5. The stored `role` is never trusted to _grant_ a permission. `usePermissions`' owner fallback must not confer owner from session state alone.
6. A session `memberId` that is absent from a **loaded, non-empty** roster is rejected rather than silently swapped for the owner — and a `currentMemberId` that disappears from the roster must not fall back to the owner either, **whether it disappears on reload (§4) or by deletion (§4b)**.
7. Every rejection emits exactly one diagnostic event, classified, so tampering is visible in CloudWatch — and **a device-secret loss is classified separately from tampering**, because conflating them makes the tamper metric useless.
8. Four irreversible actions require a fresh PIN through the **existing** `ReauthChallenge`: transfer ownership (already done — verify only), remove a member, reset another member's credentials, clear all data.
9. Ordinary daily use gains **no** new prompts.
10. Storage failure (private browsing, blocked IndexedDB) must degrade exactly as today — no session persisted, no hard error — never a new crash or a lockout.
11. No path added by this plan may fail silently: every failure either resolves the gate `false` with a user-visible, actionable message, or reports once with developer guidance. **A logout caused by seal unavailability counts as a failure and must be counted.**
12. **There is exactly one place in the codebase where a session dies.** Every rejection path added here routes through a single `authStore.invalidateSession(kind)` action rather than each site hand-rolling clear + report.

## Important Notes & Caveats

- **Do not invent a new key store.** `getOrCreateDeviceSecret()` already returns a per-device HKDF base key, non-extractable when the platform supports structured-cloning `CryptoKey`s and falling back to extractable bytes with a telemetry flag. That is the session key's source; derive from it with a distinct HKDF `info` label.
- **Move the device secret out of the PIN module (Pass 3).** `getOrCreateDeviceSecret` currently lives in `deviceUnlock.ts` — a module whose entire docstring is about PIN unlock, lockout counters and `MAX_PIN_ATTEMPTS`. It already has a second, unrelated consumer (`trustedAutoOpen.ts:23`, whose own comment reads "one secret, two info-domains"), and this plan adds a third. Leaving it there means `sessionSeal.ts` imports the PIN-lockout module to sign a session — a coupling that reads as a mistake to the next maintainer and drags PIN concerns into session tests. Extract it to **`src/services/auth/deviceSecret.ts`**. **Pass 4 correction to the Pass 3 wording:** the function needs no local constants, but it does need six imports — `deviceUnlockRepository`, `importHKDFBaseKey`, `base64ToBuffer`, `bufferToBase64`, `toISODateString` and `logEvent`. The consumer set is exactly two files (`deviceUnlock.ts:166,236`, `trustedAutoOpen.ts:23,39,56`) — verified by grep including tests — so this is a mechanical move, not a refactor.
- **Do not inline HKDF parameters.** `src/services/crypto/keyWrap.ts` is the single home for HKDF derivation (`deriveWrappingKeyFromBaseKey`, hash + salt-length constants). It currently derives **AES-KW only**, so this plan adds one sibling export there — `deriveHmacKeyFromBaseKey` — rather than a second copy of the HKDF parameter block inside `sessionSeal.ts`.
- **The device secret lives in the REGISTRY IndexedDB** (`deviceUnlockRepository.getDeviceSecret` → `getRegistryDatabase`). **This is the plan's sharpest hazard and Pass 1 missed it:** the `authStore.ts:563` restore path exists _precisely because iOS ITP evicts that registry while localStorage survives_. A naive seal would therefore fail verification on exactly the path built to keep those users signed in, and a regenerated key is indistinguishable from a forged tag. Section 1 solves this with a derived key id in the envelope.
- **`getOrCreateDeviceSecret` is create-on-miss, and this plan makes it race-able (Pass 4).** Two concurrent callers that both miss will both generate 32 random bytes and both write; last write wins, and a session sealed with the losing key verifies as `key-changed` on the next boot — an unexplained logout. The race is theoretically present today but adding a third caller on the _boot_ path makes it reachable. §0 closes it by memoising the in-flight promise inside the new `deviceSecret.ts`, fixing it once for all three consumers rather than three times.
- **`authStore.hasFamilies` has no consumer outside `authStore` — Pass 4 correction.** Pass 2/3 claimed that setting `hasFamilies = true` on the ITP path keeps the user off WelcomeGate. Grep says otherwise: the only readers are `authStore` itself and one assertion in `createNewFile.test.ts:1114`. Login view selection is driven by `familyContextStore.allFamilies` (`LoginPage.vue:350,548`) and `authStore.isAuthenticated`. §2 keeps setting the flag for internal consistency, but the honest UX statement is Assumption 7.
- **`MeetTheBeansPage.vue` already has a local function named `deleteMember` (`:345`)**, distinct from `familyStore.deleteMember`. The new composable is exported as `removeMember` and the local wrapper is deleted, so no shadowing survives.
- **`logEvent` requires `message`** and rate-limits on `surface::message`. Every event below names a stable, low-cardinality message string; do not interpolate ids into it.
- **Do not rebuild the step-up UI.** `ReauthChallenge.vue` already exists, already orders native biometric → PIN → password (`:8-12`), already handles a member with no credential (`noCredential` computed at `:90`, rendered at `:262-275`), and its own docstring (`:4-6`) names this exact use: "Used as a guard before high-stakes operations (transfer ownership, future: delete pod, leave pod...)". It deliberately renders as a **content panel and hosts no modal of its own** (`:14-16`) — the caller owns the host. Its PIN check is `verifyPassword(pin, props.member.pinHash)` (`:70`) against the **doc-synced** hash, so step-up keeps working with an evicted registry.
- **Do not hand-roll three modal hosts.** `useConfirm.ts` is the established promise-returning-dialog pattern (module state + `confirm()`/`alert()` + a single `<ConfirmModal />` in `App.vue:1813`). Mirror it exactly rather than inventing a second shape — including its convention that **copy crosses the boundary as a `UIStringKey`, never as a pre-translated string**.
- **Stacking is already solved — copy it, don't invent it.** `BaseModal` takes `layer: 'base' | 'overlay' | 'top'` (z-50 / z-60 / z-250, `BaseModal.vue:13-14,35-37`). `BeanieFormModal` defaults to `'base'`, and `ReauthChallenge`'s `PasswordModal` sub-flow is `'overlay'`. The gate host must therefore be **`layer="overlay"`**: above the `'base'` modals it is invoked from (`ResetMemberPinModal`), and — because `BaseModal` teleports to `body` (`:67`), so paint order at equal z is _open order_ — equal-z-but-opened-earlier than its own `PasswordModal` sub-flow, which therefore paints on top. `layer="top"` would bury `PasswordModal` under the gate — a real regression for legacy password-only members.
- **`router/index.ts:503` reads `currentUser?.role` to BLOCK, not to grant.** Trusting a forgeable value in the fail-closed direction is safe; leave the logic. Its comment ("matches usePermissions fallback behavior") goes stale when §3 lands — update the comment in the same commit or the next reader will re-widen the fallback to match.
- **Both `initializeAuth` restore sites must verify** — `:546` (normal) and `:563` (the iOS ITP-evicted-registry path). Fixing only the first leaves the hole open on Safari.
- **`AuthUser.role` stays on the type.** It is part of the session shape and is used for fail-closed checks and display. This plan changes what _trusts_ it, not what stores it.
- **`finalizeSession()` (`authStore.ts`) is the existing sign-out tail** — `currentUser = null`, `isAuthenticated = false`, `newsletterOptIn = null`, `clearSession()`. Every new rejection path builds on it (§2). Do not re-implement it, and do not have `familyStore` poke at `clearSession` directly.
- **`loadMembers` runs before there is a session.** It is called from `useLoginFlow.ts:222/634/767/805`, `syncStore.ts:2418` and `App.vue:775`. A blanket "reject and sign out" inside it would break sign-up and the login flow. §4's rejection is scoped to the authenticated case only.
- **Delete Family is already gated by the password** (`SettingsPage.handleDeleteFamilyPasswordConfirm` → `tryUnwrapFamilyKey`). It is deliberately **not** in the four; adding a reauth gate on top would be a second prompt for the same assurance.
- Do not restate baked-in constraints (DRY, i18n, no-silent-failures) — enforced elsewhere.

## Assumptions

> Review before implementation.

1. `getOrCreateDeviceSecret()` is safe to call on every app boot. `initializeAuth` already opens the registry DB, so no new ordering dependency is introduced. It is memoised per page load anyway (§0/§1), so boot pays one derivation. Note the side effect: users who never enrol a PIN will now get a `deviceSecrets` row created on first boot. Confirm during implementation that nothing infers "PIN enrolled" from that row's presence (`deviceSecrets` and `deviceUnlocks` are separate stores, so this is expected to be a no-op).
2. **Corrected from Pass 1.** Sealing makes `persistSession`/`restoreSession` **async**. Pass 1 claimed a missed `await` "silently persists nothing" — that is **false**: a floating promise still performs the write. The real hazards are (a) _ordering_ — a seal in flight when `clearSession()` runs can resurrect a signed-out session — and (b) _unhandled rejection_ from a floating promise. `no-floating-promises` is **not** enabled in `eslint.config.js`, so neither is caught by lint. §2 removes (a) structurally with a generation counter and (b) by contract: `persistSession` never rejects.
3. The extractable-bytes fallback in `getOrCreateDeviceSecret` is weaker but still not in localStorage, so requirement 2 holds on that path too.
4. A member with no PIN and no password cannot step up. `ReauthChallenge` already renders `reauthNoCredential` for that case, so it explains itself rather than dead-ending — but its copy currently says "…to transfer ownership", which is wrong for the other three actions. §5 genericises exactly two strings rather than adding a parallel set.
5. iOS cross-browser isolation is consistent here: each browser has its own IndexedDB _and_ its own localStorage, so a per-browser key signing a per-browser session is coherent, not a bug. A **different profile on the same browser** presents as `key-changed`, handled in §1.
6. Private browsing already loses the session (`persistSession` swallows the write). Sealing must not convert that into an error.
7. **Accepted regression, restated honestly in Pass 4.** An ITP registry eviction now ends the session instead of restoring it unverified. Pass 2/3 claimed the user "lands on the sign-in/recovery route rather than WelcomeGate"; that was based on a `hasFamilies` flag nothing reads. The **actual** outcome: the user lands on WelcomeGate, taps "Sign In", and — because `familyContextStore.allFamilies` is also empty on an evicted registry — `LoginPage.handleNavigate` (`:547-555`) falls through to `load-pod` with the Drive account chooser, which finds their pod. It is one extra tap on a path they already had to re-authenticate on (their PIN wrap lives in the same evicted registry). `session_key_changed` counts how often this happens. **Do not ship claiming this is invisible to the user — it is not.**
8. **Pass 3.** A user who does not open the app between release and `LEGACY_SESSION_SUNSET` (90 days) is signed out once at the sunset. That is the same cost as an ITP eviction, which this cohort already experiences, and it is the price of the migration branch not being a permanent bypass.
9. **Pass 3, refined in Pass 4.** `members.length === 0` is a sound proxy for "the roster has not loaded yet" in §3, because `normalizeRoles` returns early only on an empty list (`:403`) and otherwise guarantees exactly one owner (`:412-446`). The one documented exception is a **pets-only pod**, which ends with no owner and reports it (`:439-444`) — §3 keys on `members.length`, not on owner presence, so that case fails closed (no owner conferred) rather than breaking. No new `hasLoadedMembers` flag is needed.

## Approach

### 0. `src/services/auth/deviceSecret.ts` — mechanical extraction (do this first)

Move `getOrCreateDeviceSecret` out of `deviceUnlock.ts:74-113` into a new `deviceSecret.ts`, carrying its six imports. Update the two importing modules (`deviceUnlock.ts`, `trustedAutoOpen.ts`). Rationale is in Notes: the session seal must not import the PIN-lockout module.

One behaviour change, deliberate: **memoise the in-flight promise** so concurrent callers cannot each generate and race-write a different secret (see Notes).

```ts
let inflight: Promise<{ baseKey: CryptoKey; kdf: 'hkdf' | 'hkdf+pbkdf2' }> | null = null;
```

Cleared in a `catch` before rethrowing, so a transient registry failure is not cached. Not cleared on success: the secret is created once and never rotated, so a stale-but-valid key cannot exist. Export `__resetDeviceSecretCacheForTests()` so the existing `deviceUnlock` suite can keep asserting the create-on-miss path.

Its docstring lists its consumers and their HKDF `info` domains (PIN wrap, trusted auto-open, session seal), so the "one secret, N info-domains" invariant is stated where the secret lives rather than in one consumer's comment.

### 1. `src/services/auth/sessionSeal.ts` — new, the whole integrity mechanism in one module

Plus **one** new export in `src/services/crypto/keyWrap.ts` so the HKDF parameter block is not duplicated:

```ts
/** Derive an HMAC-SHA256 signing key from an HKDF base key. Sibling of
 *  deriveWrappingKeyFromBaseKey — same HKDF_HASH, same salt/info contract. */
export async function deriveHmacKeyFromBaseKey(
  baseKey: CryptoKey,
  hkdfSalt: Uint8Array,
  info: string
): Promise<CryptoKey>;
```

Note `importHKDFBaseKey` currently imports with `['deriveKey']` only — that already covers `deriveKey` for HMAC, so no change is needed there.

`sessionSeal.ts`:

- **Fixed salt, documented as immutable.** HKDF's salt is non-secret and optional; the base key is already 256 random bits unique to the device, so a module constant `SEAL_SALT` (32 bytes, literal) is correct and avoids inventing per-session salt storage. Pass 1 omitted the salt entirely — `deriveKey` would have thrown.
- `getSessionKey(): Promise<CryptoKey | null>` — wraps the **whole** `getOrCreateDeviceSecret()` call in `try/catch`: `getRegistryDatabase()` and the fallback `saveDeviceSecret()` inside it are both unguarded and throw in private browsing. Returns `null` there — never throws.
  - **Memoise the key, not the failure (Pass 3).** Cache only a _successful_ derivation. A `null` must not be cached: the first call can lose a race with registry initialisation, and a memoised `null` would silently disable sealing for the rest of the page load — sessions would stop being written with no signal at all. Concretely: hold `let cached: Promise<CryptoKey> | null`, and clear it in the `catch` before returning `null`, so the next call retries.
- `getKeyId(key): Promise<string>` — first 8 bytes of `HMAC(key, 'kid')`, base64. **Derived, not stored:** no schema change to `DeviceSecretRecord`, no new persistence, and it is safe to publish because it is a one-way function of a key an attacker on this device already holds.
- `seal(user: AuthUser): Promise<string | null>` — `JSON.stringify({ v: 1, k: <keyId>, p: user, t: <base64 HMAC over the exact JSON of p> })`. `null` when there is no key. The tag covers the canonical `JSON.stringify(p)` string, and `open` verifies against **that same substring**, not a re-serialisation, so key-order differences can never cause a false tamper alarm.
- `open(raw: string): Promise<SealResult>` where

  ```ts
  type SealResult =
    | { ok: true; user: AuthUser; legacy: boolean }
    | { ok: false; reason: 'malformed' | 'bad-signature' | 'key-changed' | 'unavailable' };
  ```
  - Parses; a v1 envelope's `k` is compared to the current key id **first**. Mismatch → `'key-changed'` (device secret regenerated: ITP eviction, cleared site data, different profile). Only when `k` matches is the tag checked, so a genuine `'bad-signature'` means _the key is right and the payload was edited_ — the tamper signal is now unambiguous.
  - Tags are verified with `crypto.subtle.verify` — constant-time by construction. **Never compare tags with `===`.**
  - `'unavailable'` (no key at all) is distinct from every other reason and is NOT treated as tampering.
  - Every branch returns a typed reason; there is no `catch {}` that swallows into `null`.

- **The bounded legacy branch (Pass 3 — this replaces Pass 2's open-ended acceptance).**

  ```ts
  /**
   * MIGRATION ONLY — DELETE THIS BRANCH AND THIS CONSTANT AFTER THE DATE BELOW.
   * A bare pre-#80 session (no `v`, no `t`) is accepted so the release logs nobody
   * out. It is by definition an unauthenticated shape, so while it is accepted the
   * seal can be bypassed by DELETING fields rather than forging a tag. It is
   * therefore time-boxed: after the sunset a bare object is `malformed` like any
   * other unverifiable blob. Tracked for removal by follow-up issue #80-b.
   */
  const LEGACY_SESSION_SUNSET = Date.parse('2026-12-01T00:00:00Z');
  ```

  A bare object opens with `legacy: true` while `Date.now() < LEGACY_SESSION_SUNSET`, and returns `{ ok: false, reason: 'malformed' }` after it. The constant is a module-level literal — no config, no flag, no server. Two unit tests pin both sides of the boundary with a faked clock.

  **No other test may depend on this branch (Pass 4).** A test that writes a bare session and asserts it restores becomes a time bomb that fails on 2026-12-01. Every non-legacy test needing a restorable session must write a **sealed** envelope via the module's own `seal()`.

  **File a follow-up issue at implementation time** ("#80-b: delete the legacy session branch") so the deletion is scheduled work rather than a comment nobody re-reads.

- One module, one responsibility, no store imports, so it is unit-testable in isolation.

### 2. `src/stores/authStore.ts`

- `persistSession` → `async`, `await seal(...)`. A `null` seal means "cannot persist", the same silent-degrade as today's `catch`, plus one `logEvent` (below) so the degrade is not invisible.
- **`persistSession` must never reject (Pass 4).** Its whole body stays inside the existing `try/catch`, and the `catch` swallows exactly as today. Three of the ten call sites are inside **synchronous** store actions — `createSessionForVerifiedMember` (`:1780`), `updateCurrentUserRole` (`:1828`) and `updateSessionWithMemberData` (`:1837`) — and their callers (`familyStore.ts:579,581`, `useBiometricSignIn.ts:97`) call them synchronously. **Do not convert those three to `async` to satisfy an `await`**; that ripples a signature change through two other modules and three test files for no correctness gain. They stay fire-and-forget, which is safe precisely because `persistSession` cannot reject and the generation counter makes ordering safe.
- **Generation counter (replaces Pass 1's "audit every call site" hope).** A module-level `let sessionGeneration = 0`. `clearSession()` increments it and removes the item **synchronously**, exactly as today. `persistSession` captures the generation before awaiting the seal and skips the write if it changed. Result: a sign-out can never be undone by an in-flight seal, and forgetting an `await` at one of the ten call sites (`:641, 729, 1002, 1451, 1525, 1688, 1783, 1815, 1831, 1848`) is harmless rather than a latent bug. Add the `await` at the seven sites already inside `async` functions; the counter covers the three that cannot take one.
- `restoreSession` → `async`, returns `SealResult` unchanged so the caller decides — no reason is flattened away.
- **One new action: `invalidateSession(kind)` — the single place a session dies (Pass 3, requirement 12).**

  ```ts
  /**
   * End the session because it could not be trusted. THE one exit for every
   * integrity rejection — restore-time (§2), roster-time (§4) and self-removal (§4b) alike — so the
   * clear/report pair exists once and every kind is reported identically.
   */
  function invalidateSession(kind: SessionRejectionKind): void;
  ```

  It emits the classified diagnostic (see Observability) and then calls the **existing** `finalizeSession()`. `SessionRejectionKind = 'malformed' | 'bad-signature' | 'key-changed' | 'unknown-member'` lives in `authStore` and is pulled into `familyStore` with **`import type`** (so the erased import cannot add a runtime cycle to the dynamic-import dance `familyStore` already performs), giving the kind vocabulary one definition. Pass 2 had §2 and §4 each hand-rolling `clearSession()` plus a `reportError` with matching-by-convention context; that is two copies of a security-relevant decision.

- Both `initializeAuth` restore sites consume the result through **one shared local helper**, so the ITP path cannot drift from the normal path:
  - `ok` → authenticate as today; on `legacy: true` immediately `await persistSession(user)` to re-seal and `logEvent` the reseal.
  - `'malformed' | 'bad-signature' | 'key-changed'` → `invalidateSession(reason)`, stay unauthenticated.
  - `'unavailable'` → behave as "no session" and do **not** call `invalidateSession`, but **do emit one `logEvent`** (`session_seal_unavailable`). Pass 3 said "report nothing"; that would make a blocked-IndexedDB logout loop completely invisible (see Context, third limit). It stays out of `reportError` because it is not a rejection and must not pollute the tamper metric.
- **`hasFamilies` on the `:563` path — corrected in Pass 4.** A rejected-but-present blob still proves _a returning user exists on this device_, and that fact grants no authority, so the empty-registry branch still sets `hasFamilies.value = true` (and nothing else) on a non-`unavailable` rejection, preserving the flag's stated meaning. **But do not document this as a routing affordance** — nothing outside `authStore` reads it (see Notes). The user-visible outcome is Assumption 7's: WelcomeGate → Sign In → Drive chooser. The load-bearing change here is removing the unverified `isAuthenticated = true`; the flag is bookkeeping.
- The existing `try/catch` + `reportError` around that branch stays; it now also covers the verification call.

### 3. `src/composables/usePermissions.ts` — close the role vector

Narrow the fallback so it can only apply during the genuine pre-load window and can never confer owner on a loaded pod:

```ts
// A loaded pod ALWAYS contains its owner (normalizeRoles guarantees it; the one
// exception, a pets-only pod, has no human to confer owner on anyway), so an
// empty roster means "not loaded yet" (signup, or before the stores hydrate).
const rosterLoaded = computed(() => familyStore.members.length > 0);

const isOwner = computed(
  () =>
    familyStore.currentMember?.role === 'owner' ||
    // Pre-load ONLY. Once the roster exists, an absent currentMember is a
    // REJECTION (see familyStore §4), not a fallback — otherwise a forged
    // session `role` confers owner outright (#80).
    (!rosterLoaded.value && authStore.currentUser?.role === 'owner')
);
```

Keyed on the roster's existence rather than `!currentMember`, so the moment a roster exists the session's `role` stops mattering. The named `rosterLoaded` computed exists so the reason for `length === 0` is readable at the point of use — the naked comparison invites a future reader to "fix" it. Note the existing `canViewFinances` true→false diagnostic watcher (`:41-62`) will now fire in the forged-role case; that is correct and already reported. Update the stale cross-reference comment at `router/index.ts:503-505` in the same change.

### 4. Reject an unknown member — `src/stores/familyStore.ts`

**Restructure before adding guards (Pass 3).** `loadMembers` today is `wrapAsync` → `if (!currentMemberId.value)` (`:206`) / `else if (not in roster)` (`:223`), and **each branch contains its own copy** of the same eleven-line "dynamic-import authStore, read `currentUser.memberId`, check membership, assign, `catch {}`" block (`:208-218` and `:232-242`). Bolting a rejection onto both branches would give four copies of session-resolution logic nested three deep inside an async callback — precisely the shape that rots. Extract one helper first:

```ts
type MemberResolution =
  | { kind: 'use'; id: string }
  | { kind: 'none' } // no session member — legitimate bootstrap
  | { kind: 'reject' }; // authenticated session names a member who isn't here

/** Single reader of the session's memberId. Both loadMembers branches call this. */
async function resolveSessionMember(roster: FamilyMember[]): Promise<MemberResolution>;
```

It performs the dynamic import once, and returns `'reject'` only when `authStore.isAuthenticated` **and** `currentUser.memberId` is set **and** the roster is non-empty **and** the id is absent. The existing `catch` (authStore not constructed yet) maps to `'none'`, preserving today's fall-through.

`loadMembers` then reads as three flat cases instead of two nested trees:

1. **No `currentMemberId` yet (`:206`).** `'use'` → adopt. `'reject'` → `rejectSession()`. `'none'` → the existing owner fallback (`:220-222`), **untouched** — that is the legitimate signup / pre-login bootstrap and removing it would break onboarding.
2. **`currentMemberId` no longer in the roster (`:223`).** Same three cases. The `'none'` leg is the fix: replace `currentMemberId.value = owner.value?.id ?? prevMemberId` (`:244`) with `currentMemberId.value = prevMemberId` **only if `prevMemberId` is still in the roster**, otherwise `null` plus `rejectSession()` when authenticated. The owner leg is deleted outright, since silently promoting a deleted member to owner is the escalation this requirement exists to stop.

`rejectSession()` is one local line — `authStore.invalidateSession('unknown-member')` (§2) — plus `currentMemberId.value = null`. **`familyStore` does not clear storage, does not emit its own report, and does not reimplement a sign-out tail**; it states the fact and lets the session owner act on it. The existing `console.warn` at `:225-230` is replaced by the classified event rather than kept alongside it.

### 4b. Close the same hole in `deleteMember` (new in Pass 4)

`familyStore.deleteMember:330-331` repoints `currentMemberId` at the owner when you delete _yourself_ — the vector described in Context #5, reachable by any `canManagePod` non-owner through the normal UI. Replace:

```ts
if (currentMemberId.value === id) {
  // Self-removal: this session no longer names a real member. Do NOT inherit the
  // owner's row (#80) — the session is over.
  currentMemberId.value = null;
  if (authStore.isAuthenticated) authStore.invalidateSession('unknown-member');
}
```

Reached through the same `rejectSession()` helper as §4, so there is still exactly one expression of "this session names nobody". The `isAuthenticated` guard keeps the signup-time `CreateMembersStep` delete path (unauthenticated) working unchanged: it just clears `currentMemberId` as before, minus the owner inheritance.

### 5. `src/composables/useReauth.ts` + `src/components/auth/ReauthGateModal.vue` — one step-up gate, mirroring `useConfirm`

- `useReauth.ts`: module-level state, `requireReauth(): Promise<boolean>` for callers, `useReauth()` for the host — the same three-part shape as `useConfirm.ts` (which likewise exports plain `confirm`/`alert` alongside its host composable).
- **Fail-closed preconditions, never a hang.** `requireReauth()` resolves `false` _and_ explains itself when it cannot run:
  - `familyStore.currentMember` is null → `alert()` from `useConfirm` with `reauth.unavailable`, plus one `reportError` (`severity: 'warning'`) naming the fix for a developer ("the gate needs a resolved currentMember; called before the roster loaded"). Pass 1 did not cover this and it would have hung the four call sites.
  - A gate is already open → resolve `false` immediately and `logEvent` at `warn`; re-entrancy is a caller bug, not a UX state.
- `ReauthGateModal.vue`: a `BaseModal` (`size="sm"`, **`layer="overlay"`**, title `transferOwnership.reauthTitle` — already generic: "Verify Identity") hosting `ReauthChallenge` with `familyStore.currentMember` and `:open`, resolving `true` on `@verified` and `false` on `@cancelled`/close. Mounted **once** in `App.vue` beside `<ConfirmModal />`.
- **Copy: genericise two strings, do not clone twelve — and pass keys, not sentences (Pass 3).** The existing `transferOwnership.reauth*` keys are reused as-is except the two that name the action. `ReauthChallenge` gains two optional props typed **`UIStringKey`**, not pre-translated `string`:
  - `descriptionKey?: UIStringKey`, defaulting to a new generic `reauth.description` ("Confirm it's really you before continuing."), replacing the hard-coded `t('transferOwnership.reauthDescription')` at `:258`. `TransferOwnershipModal` passes `'transferOwnership.reauthDescription'` so its wording is unchanged.
  - `noCredentialKey?: UIStringKey`, defaulting to a new generic `reauth.noCredential` (the current string minus "…to transfer ownership"), replacing `:269`.

  The component keeps calling `t()` on them exactly as it does today. Pass 2 proposed handing in already-translated strings; that moves translation out to every caller, means the copy does not re-render on a language change, and breaks the `UIStringKey` convention that `useConfirm` and `BaseModal` already follow. Three new keys total — not a parallel namespace.

- Call sites become one line: `if (!(await requireReauth())) return;`

### 6. `src/composables/useMemberRemoval.ts` — new, because the remove flow is already duplicated

`MeetTheBeansPage.vue:345-357` and `BeanDetailPage.vue:92-108` contain the **same** twelve lines: owner-check → `showAlert` → `showConfirm` → `familyStore.deleteMember(id)`. Adding `requireReauth()` to both would make it a third and fourth copy of a triplicated sequence. Extract it once:

```ts
/** Owner-check → confirm → step-up → delete. Returns true only when the member
 *  was actually removed, so callers can navigate on success and only on success. */
export async function removeMember(id: string): Promise<boolean>;
```

It performs owner-check → confirm → `requireReauth()` → `deleteMember`, and — fixing an existing defect — **checks `deleteMember`'s boolean return**. Today both pages discard it, and `BeanDetailPage` `router.push('/pod')` even when the delete returned `false`, i.e. it navigates away as if a failed deletion succeeded. `familyStore.deleteMember` returns `false` without throwing when the repo reports no such row, so `wrapAsync`'s toast never fires: that is a genuine silent failure this refactor closes with a `showToast('error', …)` plus one `reportError`. `BeanDetailPage` navigates only on `true`.

The composable takes no router dependency — navigation stays at the call site, keyed on the return value — so it remains usable from any future third page without growing a routing branch. `MeetTheBeansPage`'s local `deleteMember` wrapper and its `handleMemberDelete` collapse into direct `removeMember(id)` calls.

**Ordering note:** the gate runs _after_ the confirm, so a user who cancels the confirm is never asked for a PIN. This keeps the added prompt strictly on the "yes, delete them" path.

### 7. Wire the four actions

| Action                             | Site                                                | Today                                                               | Change                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transfer ownership                 | `TransferOwnershipModal.vue:193-199`                | `ReauthChallenge` inline, step 2 of 3                               | **Verify only** — leave it. Its three-step wizard is a better fit than a global gate, and it already passes `currentOwner` explicitly. Add the `descriptionKey` prop only (copy parity).                                                                                                                                                          |
| Remove a member                    | `MeetTheBeansPage.vue:345`, `BeanDetailPage.vue:92` | `showConfirm` only                                                  | Both call `removeMember(id)` (§6); the reauth lives inside it, once.                                                                                                                                                                                                                                                                              |
| Reset another member's credentials | `ResetMemberPinModal.vue:66 handleSave`             | `assertCanResetMember` (authorization, reads the forgeable session) | `requireReauth()` **after** the existing validation and **inside** the existing `try` (so `isSubmitting` is reset by the existing `finally`), before `adminResetMemberPin`; a `false` result just returns. The store check stays as authorization — the gate is authentication, they are not substitutes.                                         |
| Clear all data                     | `SettingsPage.vue:578 handleClearData`              | inline confirm, **and no error handling at all**                    | `requireReauth()` first; then wrap the three awaits (`clearCachedFamilyKey`, `setTrustedDevice`, `deleteFamilyDatabase`) in `try/catch` → `showToast('error', …)` + `reportError` and **do not reload**. Today any throw leaves the confirm panel open with no message and no reload — a silent failure sitting directly on a destructive action. |

**Friction audit (requirement 9).** The four gated actions are the only new prompts. Sign-in, boot, navigation, viewing, creating, editing and syncing are untouched: the seal is verified programmatically with no UI, and §3/§4/§4b either allow or sign out — neither ever prompts. The one _non-prompt_ friction increase is Assumption 7's ITP logout, which is an existing re-authentication, not a new one.

## Files Affected

- `src/services/auth/deviceSecret.ts` — new (extraction of `getOrCreateDeviceSecret` + in-flight memo + test reset hook)
- `src/services/auth/deviceUnlock.ts`, `src/services/auth/trustedAutoOpen.ts` — import update only
- `src/services/auth/sessionSeal.ts` — new
- `src/services/crypto/keyWrap.ts` — add `deriveHmacKeyFromBaseKey` (the single home for HKDF params)
- `src/composables/useReauth.ts` — new
- `src/composables/useMemberRemoval.ts` — new (de-duplicates an existing double, absorbs the reauth)
- `src/components/auth/ReauthGateModal.vue` — new
- `src/components/auth/ReauthChallenge.vue` — two optional `UIStringKey` props (`descriptionKey`, `noCredentialKey`); no behaviour change
- `src/stores/authStore.ts` — seal/open, generation counter, non-rejecting `persistSession`, `unavailable` telemetry, `invalidateSession(kind)` on top of the existing `finalizeSession()`, both restore sites via one shared helper, presence-only `hasFamilies` on the ITP path, re-seal on legacy
- `src/stores/familyStore.ts` — extract `resolveSessionMember`, flatten the two duplicated blocks into it, reject an unknown session member, drop the owner fallback in the last-resort branch (§4) **and in `deleteMember` self-removal (§4b)**
- `src/composables/usePermissions.ts` — narrow the owner fallback behind a named `rosterLoaded`
- `src/router/index.ts` — comment only (stale cross-reference at `:503`)
- `src/App.vue` — mount `<ReauthGateModal />`
- `src/pages/MeetTheBeansPage.vue`, `src/pages/BeanDetailPage.vue` — call `removeMember`; delete the duplicated block; navigate only on `true`
- `src/pages/SettingsPage.vue` — gate + error-handle `handleClearData`
- `src/components/family/ResetMemberPinModal.vue` — gate before submit
- `src/components/family/TransferOwnershipModal.vue` — pass `descriptionKey` (copy parity only)
- `src/services/translation/uiStrings.ts` — three keys: `reauth.description`, `reauth.noCredential`, `reauth.unavailable` (`en` + `beanie`)
- **Existing tests that break — corrected in Pass 4.** Pass 2/3 listed `dataClearingSecurity.test.ts:514/579/670`; those assert only `removeItem('beanies_auth_session')` and are **unaffected**. The real breakage is `src/stores/__tests__/createNewFile.test.ts:1065-1114`:
  - `(i)` writes a raw `sampleUser` and asserts `isAuthenticated === true`. It must write a **sealed** envelope via `seal()` — not rely on the legacy branch, or it silently becomes a 2026-12-01 time bomb.
  - `(iii)` asserts `isAuthenticated === true` on the ITP path. That expectation is **inverted by this plan**: rewrite to `isAuthenticated === false`, `hasFamilies === true`, and one `session_seal` key-changed event. This is the single assertion guarding the accepted regression, so it must state the new contract explicitly rather than be deleted.
- New tests: `sessionSeal.test.ts`, `useReauth.test.ts`, `useMemberRemoval.test.ts`, plus authStore restore/reject cases and familyStore `deleteMember` self-removal
- **Follow-up issue #80-b** (tracker row, not code): delete the legacy session branch and `LEGACY_SESSION_SUNSET` after 2026-12-01

## Observability Coverage

**Events** — all session-death events are emitted from the single `invalidateSession(kind)` action (§2), so the shape cannot drift between call sites. `logEvent` requires a `message`; the stable strings below are also the rate-limit keys, so no ids go in them.

- `reportError` — `surface: 'session-integrity'`, `severity: 'warning'`, `message: 'persisted session rejected'`, `context: { action: 'session_rejected', kind: 'malformed' | 'bad-signature' | 'unknown-member' }`. Exactly one per rejected load. `warning`, not `critical`: a rejection is the system working, and paging Slack for it would be noise.
- `logEvent` — `level: 'warn'`, `surface: 'session-integrity'`, `message: 'session_key_changed'`, `context: { action: 'session_rejected', kind: 'key-changed' }`. **Deliberately not a `reportError`, and deliberately a separate kind:** device-secret loss (ITP eviction, cleared site data, second profile) is expected environmental churn, not an attack. Folding it into `bad-signature` would drown the one metric that means "somebody edited a session". This is also the counter that decides whether Assumption 7's accepted regression stays accepted.
- `logEvent` — `level: 'warn'`, `surface: 'session-integrity'`, `message: 'session_seal_unavailable'`, `context: { action: 'session_rejected', kind: 'unavailable' }` (new in Pass 4). Emitted both when `open()` cannot get a key at restore and when `seal()` returns `null` at persist. This is the **logout-loop detector**: a browser with working localStorage and blocked IndexedDB would otherwise sign users out on every reload with no trace. Not a `reportError`, so the tamper metric stays clean.
- `logEvent` — `level: 'info'`, `surface: 'session-integrity'`, `message: 'session_resealed'`, `context: { action: 'session_resealed' }` on the legacy upgrade. This is the **success-path counter**: it should spike once after release and then fall to near zero. A population that never stops re-sealing means the seal is not sticking — and it is also the signal that says whether the `LEGACY_SESSION_SUNSET` date can be brought forward or must be honoured as-is.
- `logEvent` — `level: 'info'`, `surface: 'reauth-gate'`, `message: 'reauth_outcome'`, `context: { action: 'reauth_outcome', kind: 'verified' | 'cancelled' | 'no-credential' | 'unavailable' }`. Emitting on the **success** path too is what makes a cancel _rate_ measurable; `unavailable` is the "gate could not run" case from §5.
- `reportError` — `surface: 'member-removal'`, `severity: 'warning'`, `message: 'deleteMember returned false'`, `context: { action: 'delete_returned_false', member_id_tail }` when `deleteMember` reports `false` (§6). Previously invisible. Note `surface: 'member-removal'` is already in use by `invalidateDeviceCredentials`, so this joins an existing surface rather than adding one.
- `reportError` — `surface: 'settings-clear-data'`, `severity: 'error'`, `message: 'clear all data failed'`, `context: { action: 'clear_data_failed' }` (§7). Previously an unhandled rejection.

**Failure modes covered**

- Seal key unavailable (private mode, blocked IndexedDB) → distinct `'unavailable'`, never counted as tampering, the key cache is _not_ poisoned so a later call can still succeed, **and it is now counted** so a logout loop is detectable.
- Device secret regenerated → distinct `'key-changed'`, separately counted, never counted as tampering.
- Two concurrent device-secret creations → impossible after §0's in-flight memo; previously would have produced an unexplained `key-changed` logout on the next boot.
- Self-removal by a `canManagePod` non-owner → session invalidated, not silently promoted to owner (§4b).
- A `persistSession` call site that forgot its `await`, or one of the three that structurally cannot have one → harmless: the generation counter prevents resurrection and `persistSession` cannot reject, so no unhandled rejection reaches the global handler.
- Legacy branch outliving its usefulness → bounded by `LEGACY_SESSION_SUNSET` and tracked by issue #80-b; and no test depends on it, so the sunset cannot break CI.
- Step-up unreachable for a credential-less member → `kind: 'no-credential'` names it rather than looking like a cancel; the user sees the (now generic) `reauth.noCredential` guidance pointing at Settings → Security.
- Gate invoked with no resolved member → `kind: 'unavailable'`, a user-facing alert, and a developer-directed `reportError` naming the cause.
- A failed member deletion and a failed clear-all-data both surface a toast instead of a dead button.
- No bare `catch {}` is added anywhere in this plan; every catch either reports or returns a typed reason.

**Privacy / store gate**

`action`, `kind` and `member_id_tail` are already in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts`). **No new context key**, so no `PrivacyInfo.xcprivacy` / store data-safety update, and no mirror change in `infrastructure/lambda/telemetry/index.mjs`.

## Acceptance Criteria

- [ ] A hand-edited `beanies_auth_session` is rejected on load; the app lands on the login screen and does not authenticate
- [ ] After `LEGACY_SESSION_SUNSET`, a bare unsigned session is rejected as `malformed` (clock-faked unit test); before it, accepted once and re-sealed
- [ ] **No test other than the two boundary tests depends on the legacy branch** (grep: every test that seeds a session calls `seal()`)
- [ ] Follow-up issue #80-b exists, naming the legacy branch and constant for deletion
- [ ] Forging only `role` grants nothing once a roster is loaded
- [ ] A `memberId` absent from the loaded pod is rejected, not silently swapped for the owner — and neither is a `currentMemberId` that vanishes from the roster
- [ ] **A `canManagePod` non-owner who deletes their own bean is signed out, not repointed at the owner** (§4b)
- [ ] An existing unsigned session is accepted once, re-sealed, and the user is NOT logged out
- [ ] Deleting the registry IndexedDB (ITP simulation) yields `key-changed`, **not** `bad-signature`; `createNewFile.test.ts (iii)` asserts the new contract
- [ ] Every rejection emits exactly one event with the right `kind`, and **every rejection path routes through `invalidateSession`** (grep: no other new caller of `clearSession`/`finalizeSession`)
- [ ] A key-unavailable boot emits `session_seal_unavailable` and does **not** emit a tamper report
- [ ] `persistSession` never rejects; `updateCurrentUserRole` / `updateSessionWithMemberData` / `createSessionForVerifiedMember` remain synchronous
- [ ] `loadMembers` reads the session's memberId in exactly one place (`resolveSessionMember`); the duplicated block is gone
- [ ] Private browsing behaves exactly as before: no session, no error, no lockout — and a transient key failure does not disable sealing for the page load
- [ ] Both `initializeAuth` restore paths verify, including the ITP-evicted one
- [ ] Remove a member, reset another member's credentials, and clear all data each demand a fresh PIN; transfer ownership verified as already covered
- [ ] A member with no PIN and no password sees the explanatory state with **action-neutral** wording, not "transfer ownership"
- [ ] `ReauthChallenge`'s new props are `UIStringKey`s and its copy still follows a language change
- [ ] The password sub-flow renders **above** the gate for a legacy password-only member (layer check)
- [ ] The remove-member block exists in exactly one place; a failed delete toasts instead of navigating; cancelling the confirm never shows a PIN prompt
- [ ] `handleClearData` surfaces an error instead of silently doing nothing
- [ ] `sessionSeal.ts` does not import `deviceUnlock.ts`
- [ ] **No new prompt appears anywhere in routine use**
- [ ] Diagnostic logging in Observability Coverage implemented and verified

## Testing Plan

1. **Unit — `sessionSeal`**: round-trip seal/open; a flipped payload byte fails `bad-signature`; a truncated envelope fails `malformed`; a bare legacy object opens with `legacy: true` **before** the sunset and `malformed` **after** it (fake timers, both sides of the boundary); no key yields `unavailable` **and a subsequent call with a working key succeeds** (cache-poisoning regression); a **different device secret** yields `key-changed`, not `bad-signature`.
2. **Unit — `deviceSecret`**: two concurrent `getOrCreateDeviceSecret()` calls on an empty store resolve to the **same** key and write **once** (the race fix); a throwing registry clears the memo so the next call retries.
3. **Unit — authStore restore**: each reason produces the right outcome and exactly one event; a legacy session re-seals; `unavailable` emits `session_seal_unavailable`, does not report a rejection and does not call `invalidateSession`; `persistSession` with a throwing seal resolves rather than rejects; a `clearSession()` racing an in-flight `persistSession` leaves storage **empty** (the generation counter).
4. **Unit — usePermissions**: a forged `role: 'owner'` with a loaded roster does NOT confer owner; the same forged role with an empty roster still does (the signup window).
5. **Unit — familyStore / `resolveSessionMember`**: table-driven over the three resolutions x the two `loadMembers` branches — an authenticated session naming a missing member rejects (both branches); an **unauthenticated** `loadMembers` (signup path) still falls back to the owner and is not broken; a `currentMemberId` that vanished does not become the owner; `prevMemberId` is reused only when still present.
6. **Unit — familyStore `deleteMember`**: an authenticated self-removal calls `invalidateSession('unknown-member')` and leaves `currentMemberId` null; an **unauthenticated** self-removal (signup `CreateMembersStep`) clears it without invalidating.
7. **Unit — `useReauth`**: resolves `true` on verified, `false` on cancelled; a second concurrent call resolves `false`; a null `currentMember` resolves `false` with an alert and one report.
8. **Unit — `useMemberRemoval`**: owner is refused; cancel at the confirm performs **no PIN prompt and no delete**; cancel at the gate performs no delete; `deleteMember` returning `false` toasts and returns `false` (and `BeanDetailPage` therefore does not navigate).
9. **Manual — the repro**: sign in as a non-owner on desktop, edit `memberId` to the owner's, reload → login screen. Repeat editing only `role` → no owner rights. Repeat by _deleting_ `v` and `t` → accepted once pre-sunset (expected, documented), rejected post-sunset. Then, with a `canManagePod` non-owner, delete your own bean → signed out, not promoted.
10. **Manual — migration**: sign in on the old build, update, reload → still signed in, and the stored value is now sealed.
11. **Manual — the four actions**, plus a full pass through ordinary use confirming **zero** new prompts.
12. **Manual — modal stacking**: as a legacy password-only member, trigger the gate from `ResetMemberPinModal` and confirm the order is base modal → gate → password sub-flow, top-most last.
13. **Regression**: full unit suite (including the two rewritten `createNewFile` cases and the `deviceUnlock` suite after the §0 extraction) + E2E chromium — E2E signs in through the UI, so a broken seal surfaces there.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the pre-plan block after code research corrected the premise (web-passkey half moot; second `role` vector found). Seal derived from the existing per-device secret; step-up gate mirrors `useConfirm`.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the source. Found and fixed a design-breaking omission (the device secret lives in the registry IndexedDB that the ITP restore path exists to survive) with a derived key id and a distinct `key-changed` reason plus a presence-only `hasFamilies` affordance. Corrected two factual claims about existing code (`familyStore` already validates the session memberId; a missed `await` does not lose the write) and replaced the second with a generation counter that removes the bug class. Added the missing HKDF salt and moved HKDF derivation into `keyWrap.ts` rather than inlining it. Replaced two duplicated remove-member blocks with one composable instead of adding a third and fourth copy. Reused the existing twelve `reauth*` strings via two optional props instead of a parallel namespace. Pinned the modal stacking layer (`overlay`, not `top`) so the password sub-flow is not buried. Closed three pre-existing silent failures the plan would otherwise have built on top of: unguarded `handleClearData`, discarded `deleteMember` boolean with navigation-on-failure, and the gate's unhandled null-member case.
- **Pass 3 (Sustainability / maintainability / reliability)**: Closed the plan's one remaining structural hole — the open-ended legacy-envelope branch, which made the seal bypassable by _deleting_ two fields forever — with a dated `LEGACY_SESSION_SUNSET` constant and a scheduled removal issue, so the migration cannot outlive its purpose. Consolidated session death into a single `invalidateSession(kind)` action built on the existing `finalizeSession()`, replacing two hand-rolled clear+report pairs and removing `familyStore`'s reach into `authStore`'s storage internals. Required `loadMembers` to be flattened via one `resolveSessionMember` helper _before_ guards are added, since the function already contains the session-lookup block twice at three levels of nesting. Fixed a reliability defect in the key cache (a memoised `null` would silently disable sealing for the page load). Changed `ReauthChallenge`'s new props from pre-translated strings to `UIStringKey`s to match `useConfirm`/`BaseModal` and keep copy reactive to language changes. Extracted `getOrCreateDeviceSecret` into `deviceSecret.ts` so the session seal does not import the PIN-lockout module. Named the `rosterLoaded` computed and recorded the pod-always-has-an-owner invariant it rests on. Renamed the removal export to match its file, and kept the router dependency out of it.
- **Pass 4 (Fresh eyes / final sweep)**: Re-verified every code claim against source and corrected four that were wrong, one load-bearing (`authStore.hasFamilies` has no consumer, so Pass 2/3's "lands on sign-in rather than WelcomeGate" was fiction — Assumption 7 now states the real one-extra-tap outcome). Found a **fourth escalation vector of the same class** in `deleteMember`'s self-removal owner fallback, reachable through the normal `canManagePod` UI with no devtools, and added §4b. Closed the last silent-failure hole in the change itself: a key-unavailable boot would have logged users out with zero telemetry, so `'unavailable'` now emits `session_seal_unavailable`. Fixed the async contract: three of the ten `persistSession` call sites are synchronous store actions with cross-module synchronous callers and must NOT be converted, so `persistSession` is specified as never-rejecting. Closed the device-secret create race by memoising in `deviceSecret.ts` once rather than in three consumers. Corrected the breaking-test list (the three `dataClearingSecurity` assertions do not break; two `createNewFile` cases do, one with an inverted expectation) and forbade any test leaning on the legacy branch, which would be a 2026-12-01 time bomb. Added the `message` field every `logEvent` requires, `import type` for the cross-store kind union, the pets-only exception to Assumption 9, the `MeetTheBeansPage` local-`deleteMember` collision, and an explicit friction audit confirming the four gated actions are the only new prompts.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> ok let's keep this artifact in mind but let's implement another security issue now /beanies-pre-plan #80 - can we perform implementation now? once done move ahead to /beanies-plan to ask any questions as needed and build the plan and once done move direct to implementation, once complete run a /code-review high to ensure everything works as designed and no new bug or side effects or security issues were introduced

### Follow-up 1 (pre-plan clarify loop — greg challenged whether to fix this at all)

> Can you explain once again clearly as I'm still trying to understand what the attack surface is and how this issue can actually be exploited is it worth it to even apply a fix? Since from what you're saying, it won't provide that much protection against a real attack and I want to avoid too much friction. I mean why such as a bunch of step up PINs. So what is your proposal here? Should we implement this fix or can we just accept the risk?

Answered with the threat model in full: the attack needs the attacker to already hold the unlocked device with beanies signed in; there is no remote vector; and because the pod is one file under one family key, forging a memberId grants no new read access. Recommended the no-friction half, with the step-ups as an optional second half scoped to four once-a-year actions.

### Follow-up 2 (the decision)

Selected: **"Free half + step-ups on the four irreversible actions"** — sign the session, stop trusting the stored role, reject an unknown memberId, AND gate transfer ownership / remove a member / reset another member's credentials / clear all data behind a fresh PIN.

Migration question was left at "[No preference]", so pre-plan chose upgrade-in-place (nobody is logged out).

</details>
