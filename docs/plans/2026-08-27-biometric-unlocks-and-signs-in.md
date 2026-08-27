# Plan: Biometric / passkey unlocks the pod AND signs in the family member

> Date: 2026-08-27
> Related issues: Notion tracker #76 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-08-27-biometric-unlocks-and-signs-in.md`
> **Scope note:** requirement 11 (member removal must revoke pod access) was split out of
> this plan on 2026-08-27 after an adversarial security review found it delivers only a
> fraction of real revocation. It has its own tracker row and needs its own four passes.
> See "Split-out work" below.

## User Story

As a family member on my own phone or laptop, I want to unlock beanies with my face or
fingerprint and land straight in my own account, so that I never type a password on a
device I have already proved is mine.

## Context

A member's password does **two** jobs: it unwraps the family key (decrypting the pod) and
it authenticates that member. Biometric only ever replaced the first, so on a device where
the pod auto-decrypts, biometric is never offered at all and the user is asked for a member
password biometric was never designed to satisfy.

Measured on iOS build 55 (2026-08-27, after #74 restored the plugin): the `native-biometric`
surface emitted `enable_result ok` six times and `unlock_result ok` once — plugin, hardware
and stored key all working — and login still went bean-picker → password. Nothing was faulty.

**This plan is much smaller than tracker #76 implies.** Four things already exist and were
verified against source across five review rounds:

1. `passkeyService.ts` IS the unified resolver — `registerPasskeyForMember`,
   `authenticateWithPasskey`, `hasRegisteredPasskeys` and `removePasskey` each delegate to
   `nativeBiometric.*` when `isNative()`. (Six delegation points in total:
   `passkeyService.ts:81`, `:92`, `:128`, `:423`, `:654`, `:662`.)
2. `AuthenticatePasskeyResult` already carries `memberId`.
3. `authStore.signInWithPasskey` already creates a session from `result.memberId` — sets
   `currentUser`/`isAuthenticated`/`freshSignIn`, calls `persistSession` and
   `track('login', { method: 'passkey' })` (`authStore.ts:1095`). Caveat: it creates a _thin_
   session (`email: ''`, `role: undefined`); `updateSessionWithMemberData` (`:1192`) fills it
   in, sets the current member and stamps `lastLoginAt`, and must be called once the doc is
   readable.
4. The V4 envelope wraps the family key per member.

**The actual defect** is inside `activateFamilyForBiometric` (`LoginPage.vue:318-398`), whose
`if (syncStore.isConfigured && !syncStore.hasPendingEncryptedFile)` block at `:378` routes to
`pick-bean` and logs `login_routing('pick_bean', 'no_pending_file' | 'auto_decrypted')`. That
single block is the bug. `handleFamilySelected` branches on `payload.hasPasskeys` first and is
not itself wrong.

**There are two biometric decision points, not one:** `LoginPage.activateFamilyForBiometric`
and `LoadPodView.checkBiometricForFamily` (`LoadPodView.vue:160`). And five consumers of the
"has this device got keys?" question — `FamilyPickerView.vue:49`, `LoginPage.vue:292`,
`App.vue:1591` (all via the store) plus `LoadPodView.vue:165` and `ReauthChallenge.vue:66`
(direct service calls).

## Requirements

1. Where a key exists on this device, login offers biometric FIRST — before any password —
   on both the pod-level surface and the member picker.
2. **Pod-level (cold):** one biometric prompt decrypts the pod and signs in the key's member.
3. **Member picker (pod already decrypted):** picking a member who has a key on this device
   signs them in on one biometric prompt, no password.
4. Picking a member with **no** key asks for that member's password, with no implication that
   biometric failed.
5. A **"not you?" escape** is shown BEFORE the user lands in an account, on every auto-enter
   path. Load-bearing UI.
6. The native keystore item is keyed **per member** (`${familyId}:${memberId}`). Existing
   family-keyed enrolments must **self-heal**, never dead-end.
7. Keys never expire from the app's point of view. Only explicit removal or OS invalidation
   ends an enrolment.
8. Lifecycle: a member changing their password re-wraps; removing a member invalidates their
   device key and its registration record.
9. The login flow emits enough diagnostics to answer "why was I not offered biometric?" from
   CloudWatch without reading source.
10. End-to-end review of the login/authorisation flow as part of this work.

> Requirement 11 (removal revokes pod access) is **not** in this plan — see "Split-out work".

## Important Notes & Caveats

- **A device biometric authenticates the DEVICE, not a person.** If two family members' faces
  or fingers are enrolled on one iPad at OS level, either satisfies the prompt. No code fixes
  this. Policy: auto-enter anyway, with the "not you?" escape. `ReauthChallenge.vue` already
  encodes exactly this reading (a native memberId mismatch is _expected_) — match it.
- **Do NOT gate any of this on `isTrustedDevice`.** That setting governs cache retention and
  cached-password storage. Making it decide _who signs in_ attaches an identity consequence to
  a performance checkbox.
- **Do NOT delete the 24h cool-off in `biometricShared.ts:25`.** It suppresses only the
  PROACTIVE post-sign-in nag; `nativeCanEnroll` deliberately skips it, `nativeCanOffer`
  respects it, and it never grants access.
- **Do NOT "fix" the silent enrol.** `setKey` requires no authentication — only `getKey` does
  (`biometricKeystorePlugin.ts:32-36`). This is what makes the read-repair migration cost
  **zero extra biometric prompts**.
- **`nativeUnlock` already self-heals an OS-invalidated key** (`hasKey` probe →
  `clearNativeRecord` → `absent_self_heal`, `nativeBiometric.ts:256`). Extend that shape; do
  not rewrite it.
- **One module owns the keystore address.** `nativeBiometric.ts` is the only file that may
  construct `${familyId}:${memberId}` or reference the legacy bare-`familyId` address. Today
  `familyContext.ts:171-172` breaks this by importing `BiometricKeystore` directly and calling
  `deleteKey({ account: familyId })`. §F fixes that rather than adding a second address-aware
  file. **This is the single most important structural rule in the plan.**
- The `passkeys` store lives in the **registry** DB (`registryDatabase.ts:70`), so it survives
  sign-out and is cleared only by `deleteLocalFamily`. Requirement 7 depends on this.
- A member with **no password at all** is already supported (`PickBeanView.isCreatingPassword`)
  and must keep working.
- **ADR-029 needs a one-clause amendment.** It has no "identity model" section; the only
  statement of the invariant is a clause at
  `docs/adr/029-capacitor-native-app-store-distribution.md:151` — _"records carry
  `mechanism: 'native-keystore'`, one per family per device (last-writer-wins)"_. Requirement 6
  reverses that. Two source header comments (`biometricKeystorePlugin.ts:12`,
  `nativeBiometric.ts:129` and `:174-176`) state it too and are part of this change. The
  Swift/Java plugin headers do **not** encode the invariant, so `check-ios-sources.mjs` is
  unaffected.
- The keystore account string containing `:` is safe on both platforms — iOS uses it as
  `kSecAttrAccount` (arbitrary string, `BiometricKeystorePlugin.swift:144-149`), Android as
  `ALIAS_PREFIX + account` and a SharedPreferences key (`BiometricKeystorePlugin.java:45-50`).
  No native code change.
- Never weaken the zero-knowledge model.

## Assumptions

> Review before implementation.

1. `passkeyService.ts` remains the single delegation point for web-vs-native. Verified: no file
   imports `nativeBiometric` except `passkeyService`. Partial exception: `familyContext.ts`
   imports `biometricKeystorePlugin` directly, one layer below — §F closes that. **The premise
   must be preserved and, after this change, actually true.**
2. `signInWithPasskey` creating a session from `memberId` alone remains valid — it is what
   makes requirement 2 a routing change rather than a rewrite.
3. Two deciders, not three: `LoginPage.activateFamilyForBiometric` and
   `LoadPodView.checkBiometricForFamily`. Both must be fed from the same resolver so they
   cannot drift.
4. Web passkeys stay per-member and syncable; the native key stays device-local. A unified
   INTERFACE is the goal, not a unified mechanism.
5. **Web cannot _select_ a member.** `authenticateWithPasskey` uses discoverable-credential
   mode (`allowCredentials` deliberately omitted, `passkeyService.ts:439`). So a `memberId`
   argument is a **selector on native** and an **expectation on web**, verified after the
   assertion returns. This asymmetry must be documented on the parameter, or someone will later
   "fix" the web path by adding `allowCredentials` and break cross-device sign-in.
6. Adding an optional, non-indexed field to `PasskeyRegistration` needs no registry schema bump.
   Verified: `registryDatabase.ts:10` is v3, `:71-73` sets `keyPath: 'credentialId'` plus two
   indexes; a new non-indexed field is inert.

## Approach

**One resolver that every "is biometric available?" call site shares, one composable that every
"biometric just succeeded" call site shares, one routing block corrected, three lifecycle wires
connected.** Every other file is edited by deletion.

Three structural rules govern the change:

- **One owner per fact.** The keystore address lives only in `nativeBiometric`. "Which keys are
  on this device" lives only in `resolveDeviceKeys`. "Biometric succeeded → become this member"
  lives only in `useBiometricSignIn`. "This key isn't that member's" is one sentinel,
  `MEMBER_MISMATCH`, with one user-facing string.
- **No new view→service imports.** Views reach biometric state through `authStore` (as
  `FamilyPickerView` already does) or through the composable. The pre-existing direct imports in
  `LoadPodView`/`ReauthChallenge` are left alone; this change must not add a third and fourth.
- **No optional parameters where the caller always knows the value.** Every call site can supply
  `memberId`; making it optional buys nothing and creates a silent tri-state.

### A. Per-member keystore account (+ read-repair migration)

One private helper in `nativeBiometric.ts` owns the account string; nothing else in the codebase
builds it: `keystoreAccount(familyId, memberId)` → `${familyId}:${memberId}`. The legacy account
is the bare `familyId` (written today at `:177`). The synthetic credentialId helper
`nativeCredentialId(familyId, memberId)` → `native:${familyId}:${memberId}` **already exists**
(`:48`) and is reused, not re-derived.

Signature changes:

- **`nativeUnlock(familyId, memberId)` — `memberId` is REQUIRED, not optional.**
  `ReauthChallenge` holds `props.member.id` at its call site, so passing it is both possible and
  better (§F′). An optional selector on a security primitive is a permanent invitation to a
  null-member unlock.
- **`nativeDisable(familyId, memberId)`** — replacing today's `(familyId, credentialId)` at
  `:306`. The credentialId is _derived_ from the pair via the existing `nativeCredentialId`, so
  passing all three would hand a caller a value the module already owns. `removePasskey`
  (`passkeyService.ts:659`) loads the record and therefore has both.
- **Two explicit record readers, not one overloaded one.** An earlier draft proposed
  `loadNativeRecord(familyId, memberId?)` returning `null` for "none" _and_ "several, caller
  must choose" — on a two-key device a missing `memberId` would silently produce
  `friendlyError('invalidated')`, a re-enrol message for a perfectly healthy device. Split it:
  - `listNativeRecords(familyId): Promise<PasskeyRegistration[]>` — the single implementation of
    `getPasskeysByFamily().filter(mechanism === 'native-keystore')`, which appears **three times
    today** (`:137-142`, `:318-321`, `:331-334`).
  - `loadNativeRecord(familyId, memberId)` = `listNativeRecords(familyId).find(r => r.memberId
=== memberId)`. All three copies collapse into one.
- `nativeReclaimFamilyKeystore(familyId): Promise<void>` — **new, exported.** Composed from
  `listNativeRecords` → `clearNativeRecord(familyId, r.memberId)` per record → delete the legacy
  blob. The only way any other module may reclaim keystore storage (§F).
  `removeNativeRecordsForFamily` is **composed away** rather than deleted-and-retyped: its two
  callers (`:180`, `:342`) drop it and the function disappears with no loop duplicated.

**Migration is a read-repair inside `nativeUnlock`:**

1. `hasKey(keystoreAccount(familyId, memberId))` present → use it. No prompt.
2. else `hasKey(legacy)` present **and** this member owns the family's only legacy-era record →
   prompt against legacy, and **after** a successful `getKey`, `setKey({ account: perMember })`
   then `deleteKey({ account: legacy })`. `setKey` needs no auth, so this is one silent write.
3. else → existing `absent_self_heal` path, unchanged.

**Error handling:** if the re-write in step 2 throws, **do not** delete the legacy item and **do
not** fail the unlock — the user has already authenticated and holds the key. Log
`unlock_result / action: 'migrate_failed'` at `warn` with `error_code`, and return success.
Housekeeping must never break a good unlock; the next launch retries the repair.

**OS invalidation stays family-wide — this is a deliberate correction.** Today
`clearNativeRecord(familyId)` clears every stale record for the family, and its two callers are
the `absent_self_heal` path (`:251`) and the `invalidated`/`notEnrolled` path (`:286`). OS
biometric invalidation is **device-wide**, so sibling records are equally dead. Narrowing both
callers to one member would leave dead keys listed by `resolveDeviceKeys` and rendered as dead
buttons on the new cold-start chooser. **Chosen behaviour:** on `invalidated`/`notEnrolled`,
call `nativeReclaimFamilyKeystore(familyId)` (family-wide — the OS event is device-wide, so the
family-wide sweep is the correct response); reserve `clearNativeRecord(familyId, memberId)` for
the targeted `nativeDisable` path.

**`MEMBER_MISMATCH` — one sentinel, one string, three consumers.** When `nativeUnlock` is called
with a `memberId` that has no record on this device it returns
`{ success: false, error: 'MEMBER_MISMATCH' }` — **no prompt, and deliberately not the re-enrol
copy**, which would wrongly tell a healthy user their biometrics changed. On web,
`authenticateWithPasskey` returns the same sentinel when the assertion resolves to a different
member than the caller expected. It sits beside the existing `WRONG_FAMILY_CREDENTIAL`
(`passkeyService.ts:535`). Centralising the comparison in the service is what stops three views
each writing their own `result.memberId !== expected` check — `ReauthChallenge.vue:109` and
`:117` are that check today, and they are deleted.

**One string for the sentinel, not two.** A new `passkey.wrongMemberError` serves _all_
consumers including `ReauthChallenge`, which retires its bespoke
`transferOwnership.reauthWrongMember` (`uiStrings.ts:2346`) from this path. Shipping two strings
for one sentinel would re-create at the copy layer exactly the drift the sentinel removes.

`nativeEnable`:

- Writes at `keystoreAccount(familyId, memberId)`.
- **Drops its `removeNativeRecordsForFamily` call.** `credentialId` is deterministic, so
  `savePasskeyRegistration` already overwrites a re-enrol by the same member. That purge existed
  only to enforce the one-record-per-family invariant this change removes.
- **Does NOT touch the legacy blob.** A conditional legacy delete ("only when the family's
  existing native record belongs to this same member") is a three-way cross-member branch whose
  failure mode is destroying another member's key. The legacy address has exactly two owners:
  `nativeUnlock`'s read-repair and `nativeReclaimFamilyKeystore`. Worst case is an inert orphaned
  blob, never read, reclaimed on family delete. A dead byte is cheaper than a branch that can
  delete a live key.

### B. One "can this device sign someone in?" query — replacing the boolean

`resolveDeviceKeys(familyId): Promise<PasskeyRegistration[]>` on `passkeyService`.
Native → `nativeResolveDeviceKeys` (which **replaces** `nativeHasRegistered`, keeping its
stale-record cleanup at `:136-154` verbatim, now built on `listNativeRecords`).
Web → `passkeyRepo.getPasskeysByFamily`. Registry reads only, **no biometric prompt** — it runs
on every family selection and picker render.

**It returns `PasskeyRegistration[]`, not a new type.** `PasskeyRegistration`
(`src/types/models.ts:72-89`) already carries `credentialId`, `memberId`, `familyId`, `label`,
`mechanism` and `createdAt`. An earlier draft introduced a `DeviceKey` projection of exactly
those fields; it was a lossy duplicate of a type that already exists, and the loss mattered —
it dropped `mechanism`, which the split-out revocation work needs. Both sides of the resolver
already produce `PasskeyRegistration[]`.

`hasRegisteredPasskeys(familyId)` becomes `(await resolveDeviceKeys(familyId)).length > 0`. This
is the DRY point of the plan: `LoadPodView.checkBiometricForFamily` and `ReauthChallenge` keep
their existing boolean call and **cannot drift**, because there is now one implementation of
"what keys are on this device".

**Views reach it through the store, not the service.** `FamilyPickerView` already routes through
`authStore` today; matching that keeps MVO intact and gives the new capability one seam to mock.
**`authStore.checkHasRegisteredPasskeys` (`authStore.ts:1247`) is DELETED in this change** — all
three of its callers (`App.vue:1591`, `FamilyPickerView.vue:49`, `LoginPage.vue:292`) convert to
a new `authStore.resolveDeviceKeys` passthrough, so leaving it would ship dead code.
`passkeyService.hasRegisteredPasskeys` legitimately survives — `LoadPodView.vue:165` and
`ReauthChallenge.vue:66` call it directly.

`nativeResolveDeviceKeys`'s IndexedDB read must not swallow failure. Today `nativeHasRegistered`
(`:137-142`) and `loadNativeRecord` (`:317-328`) both do a bare `catch { return false / null }`,
making "registry is broken" indistinguishable from "no key enrolled" — the exact class of bug
that hid #74. Emit `action: 'registry_read_failed'` at `warn` with `error_code` before returning
empty.
