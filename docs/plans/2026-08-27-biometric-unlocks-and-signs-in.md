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

### C. Routing (the actual bug)

In `LoginPage.activateFamilyForBiometric`, the terminal block at `:378` currently reads "no
pending encrypted file ⇒ `pick-bean`". Correct it to:

- Pod already decrypted **and** device keys exist ⇒ `activeView = 'biometric'`, logging
  `login_routing('biometric', 'decrypted_with_key')`.
- Pod already decrypted, no device keys ⇒ today's `pick_bean` branches, unchanged.

**The seam that changes is `handleFamilySelected`'s payload, not two call sites.**
`activateFamilyForBiometric` has exactly **one** caller (`:509`, inside the
`if (payload.hasPasskeys)` at `:507`); the `onMounted` single-family fast path calls
`handleFamilySelected` at `:297`, which then reaches `:509`. So the type to change is
`handleFamilySelected`'s payload interface (`:491-496`, `hasPasskeys: boolean` at `:494`) plus
`FamilyPickerView`'s emit — from `hasPasskeys: boolean` to `deviceKeys: PasskeyRegistration[]`.
The keys are already known at the point of selection, so pass them down rather than re-querying.

**Three mechanical cleanups inside the function being edited — do them in the same change.**
`activateFamilyForBiometric` is ~81 lines, nested four deep, with five exit points, and this
change adds a sixth.

1. **Take one options object**, not a fourth positional parameter:
   `activateFamilyForBiometric({ familyId, familyName, providerConfig, deviceKeys })`. The
   fourth argument is created by this change; refusing to fix the signature you are breaking is
   worse than fixing it.
2. **Reuse the existing fall-back helpers — do not add a third.** `LoginPage.vue:470` already
   has `resetLoadPodState()` (sets the four refs plus `loadError`/`loadErrorProviderHint`/
   `reconnectDriveFile`) and `:480` has `enterGenericLoadFallback(hint)` =
   `resetLoadPodState()` + `loadError` + `loadErrorProviderHint` + `activeView='load-pod'`.
   Two of the near-identical blocks are _already_ `enterGenericLoadFallback(toProviderHint(...))`
   calls (`:562`, `:567`) and need no change at all. Extend
   `enterGenericLoadFallback(hint, opts?: { needsPermission?: boolean; autoLoad?: boolean })`;
   the permission-denied (`:337-343`) and load-failed (`:349-358`) blocks each become one call.
   An earlier draft proposed a brand-new `fallbackToLoadPod` helper without noticing either
   existing function — in the very section claiming to remove duplication from this file.
3. **The bare `catch {` at `:363` must log.** It swallows a file-moved/deleted/network error
   entirely and reports only a generic provider message. Emit `logEvent({ level: 'warn',
surface: 'native-biometric', message: 'login_routing', context: { action: 'preload_failed',
error_code } })` before falling back.

**`handleBiometricFallback` must branch — this was missed until the round-3 audit.**
`BiometricLoginView.vue:208-212` renders an always-visible password-fallback button emitting
`use-password`; `LoginPage.vue:711` routes it to `handleBiometricFallback` (`:654-665`), which
sets `activeView = 'load-pod'` with `autoLoadPod`. On the new already-decrypted route that sends
the user to a load/decrypt surface **for a pod that is already open** — and that is requirement
4's path. When `!syncStore.hasPendingEncryptedFile`, the destination must be `'pick-bean'`.
The same applies to `@back` at `:712`, which sends `isSingleFamilyAutoSelect` users to
`'welcome'` from an already-decrypted state.

`BiometricLoginView` must handle the already-decrypted case, which it has never seen:

- `familyKey` present **and** `hasPendingEncryptedFile` ⇒ today's `decryptPendingFileWithKey`.
- No pending file ⇒ **skip decryption entirely**, go straight to the shared success tail.
  Without this branch the view calls `decryptPendingFileWithKey`, gets `'No pending…'` and shows
  `passkey.fileLoadError` on a _successful_ unlock (`BiometricLoginView.vue:69-72`).
- Web only: success + `memberId` but **no** `familyKey` while a file _is_ pending ⇒ the existing
  `crossDeviceContext` path with its existing `t('passkey.crossDeviceNoCache')`, unchanged.

**Multiple device keys (requirement 6, cold start).** Pre-decryption there is no member roster,
so the record must carry its own label. `PasskeyRegistration.label` already exists and is what
the chooser renders. `BiometricLoginView` shows one button when there is one key (unchanged UI),
or N buttons when there are several, each calling the composable with that key's `memberId`.

> **Deliberately NOT adding `memberName` to the registry.** An earlier draft persisted the
> member's display name for this chooser, which bought a new local field, a new ADR privacy
> note, a documented staleness caveat and a never-log rule — all to label a two-keys-on-one-
> device cold start that `label` already labels. If device testing shows the labels are useless,
> add it then, as its own small change with evidence behind it.

**Requirement 5 simplification.** `BiometricLoginView` already has the escape: the header button
renders `t('fastLogin.notYou')` when `showNotYouLink` (`:125`), and biometric never fires on
mount — the user must tap. After §C, _every_ arrival at this view is an auto-enter path, so the
condition is not merely redundant — it is **wrong**: `showNotYouLink` is bound to
`isSingleFamilyAutoSelect` (`LoginPage.vue:709`), which is false on exactly the new path
requirement 5 was written for. **Delete the `showNotYouLink` prop**, always render
`t('fastLogin.notYou')`, and key the greeting (`:137`) off `familyName` alone. Requirement 5 is
then satisfied with **zero new strings and zero new UI**.

Two consequences to handle rather than discover:

- The back button's copy changes on the family-picker path (it renders `t('action.back')`
  today). Confirm the new copy reads correctly for "go back to the family picker" as well as
  "not me" — they are the same button now.
- Metric fidelity: `LoginPage` owns the `@back` handler _and_ knows `isSingleFamilyAutoSelect`,
  so emit `not_you_used` there with `detail: 'auto_select' | 'family_picker'`. The signal stays
  clean and the component stays dumb.

No "not you?" work is needed in `PickBeanView` — the user explicitly picks a bean there.

### D. Member picker offer

`PickBeanView` gains one `onMounted` call to `authStore.resolveDeviceKeys(activeFamilyId)` → a
`Set<memberId>`. Rendering:

- **Selected-member panel only:** when the selected member has a key, a `BaseButton` above the
  password field (which stays visible and functional). Copy reuses `t('passkey.signInButton')`
  (`uiStrings.ts:3676`) — **no new string**.
- No key ⇒ exactly today's form, nothing extra rendered. Requirement 4 is satisfied by silence,
  not by an explanation.

**No glyph on the avatar grid.** The absolute-positioned status slot is not free: it is already
a two-state indicator (`:192-200` — green dot when `member.passwordHash`, `+` badge otherwise)
and it is the only thing telling a first-run member why their card behaves differently.
Overloading it either destroys that signal or forces a stacked badge, a new `aria-label` string
and a tri-state the next reader decodes from CSS. The panel button is enough — a member must be
selected before authenticating either way.

On tap, the shared composable (§E) runs. A `MEMBER_MISMATCH` — possible on both platforms —
surfaces `t('passkey.wrongMemberError')` in the component's existing `formError` banner, with
the password field still usable beneath it. (A tap-initiated prompt that silently does nothing
reads as a bug; only a _cancel_ is silent.)

**`handleSignIn` is currently unguarded** — `PickBeanView.vue:65-109` has no try/catch, so an
`authStore.signIn` or `setPassword` throw leaves the form spinner-less, silent and dead. Wrap
it: `formError.value = e instanceof Error ? e.message : t('auth.signInFailed')` plus
`reportError({ surface: 'pick-bean', severity: 'warning' })`. Three lines on a file already
being edited, closing the plan's clearest pre-existing silent failure.

### D′. The fifth consumer nobody had named

`App.vue:1591` calls the family-scoped "has this device got keys?" check to decide whether to
show the proactive enrolment prompt. Because it is **family**-scoped, it suppresses the prompt
for the _second_ member on a shared device — someone who has no key of their own is never
offered one, because a sibling has one. Requirement 6's acceptance criterion ("two members can
each enrol on the same device") is unreachable in practice until this is per-member. One-line
fix via `resolveDeviceKeys` filtered to the current member.

### E. One shared success tail — `useBiometricSignIn` (the DRY core)

`BiometricLoginView.handleBiometricLogin` (`:37-112`) is the only existing implementation of
"biometric succeeded → become this member". `PickBeanView` needs the identical sequence.
Copying it would duplicate the cancel handling, the sentinel mapping, the decrypt branch, the
session update and the bounded sync. Extract it into `src/composables/useBiometricSignIn.ts`.

**Contract — one state ref, one discriminated result, no route literals:**

```
{
  isAuthenticating: Ref<boolean>,
  signIn(familyId, memberId): Promise<
      | { ok: true }
      | { ok: false; message: string | null }
      | { ok: false; message: string; crossDevice: { memberId; credentialId? } }
  >
}
```

- **No shared `errorMessage` ref.** Both callers already own an error surface
  (`BiometricLoginView.errorMessage`, `PickBeanView.formError`). A composable-owned ref would
  give each view _two_ places a message can live and force the caller to check both the return
  value and the ref. Returning the message makes the outcome single-channel.
- **`crossDevice` is a result variant carrying its own message**, not a ref. Only
  `BiometricLoginView` handles it; `PickBeanView` narrows it away at the type level instead of
  inheriting a permanently-null ref. Carrying the message means every non-`ok` outcome has one
  source of copy.
- **No `destination: '/nook'`.** A route literal inside an orchestrator shared by two views is
  routing knowledge in the wrong layer. Both views already emit `'signed-in', '/nook'`.

Sequence, once, for both callers:

1. `authStore.signInWithPasskey({ familyId, memberId, passkeySecrets: syncStore.effectivePasskeySecrets })`.
2. `cancelled` ⇒ `{ ok: false, message: null }` (`console.warn` only) — the established noise
   pattern; a `null` message is how "say nothing" is expressed without a second flag.
3. `WRONG_FAMILY_CREDENTIAL` ⇒ `t('passkey.wrongFamilyError')`; `MEMBER_MISMATCH` ⇒
   `t('passkey.wrongMemberError')`; any other error ⇒ `result.error ?? t('passkey.signInError')`.
4. Pending file + `familyKey` ⇒ `decryptPendingFileWithKey`, mapping `'No pending'` →
   `t('passkey.fileLoadError')` as today. **No pending file ⇒ skip to step 6** (§C).
5. Pending file + no `familyKey` ⇒ the `crossDevice` variant (web only).
6. `authStore.updateSessionWithMemberData()` — which **already** does `setCurrentMember` and
   stamps `lastLoginAt`, so **delete** `BiometricLoginView`'s duplicate
   `familyStore.members.find → setCurrentMember` block at `:93-97`. (Keep `:91`, which is the
   `updateSessionWithMemberData` call itself.)
7. `await syncStore.syncNowBounded()` — **do not hand-roll this.** `syncNowBounded`
   (`syncStore.ts:731`, exported `:4269`) already is the bounded, rejection-swallowing wrapper,
   and its docblock says so: _"The single home for the `raceTimeout(syncNow(true), …)` pattern
   (was duplicated across the login-completion sites + password rotation)."_
   `BiometricLoginView.vue:108` and `PickBeanView.vue:91` are the two surviving duplicates it
   was created to absorb — using it **removes** them rather than preserving them. Today a
   `syncNow` rejection renders a raw `err.message` on an otherwise successful sign-in (`:108`).
8. Return `{ ok: true }`.

**Do not** call `syncStore.setupAutoSync()` here: `LoginPage.handleSignedIn` is the canonical
arm-and-register point for every entry path and already calls it plus `ensureRegistered(true)`.
`BiometricLoginView`'s call at `:99` is a pre-existing duplicate — remove it. (`PickBeanView`'s
create-password path calls it too at `:91`; that path is not touched here and is left alone.)

The composable owns the try/catch and reports the unexpected-throw case via `reportError`
(`severity: 'warning'`, surface `native-biometric`) **as well as** returning a user-facing
message — today it only sets a message, so a genuine crash reaches nobody.

Rejected alternative: `authStore.createSessionForVerifiedMember` does step 6 in one call, but it
tracks `method: 'cross_device'` and cannot handle the not-yet-decrypted case, so routing the
picker through it would fork the two paths again.

### E′. The `memberId` plumbing chain — name it, or it gets discovered mid-implementation

Threading `memberId` from the composable to the keystore crosses **four** signatures. All four
change together or none compile:

1. `useBiometricSignIn.signIn(familyId, memberId)` — new.
2. `authStore.signInWithPasskey(...)` — **converted from positional
   `(familyId, passkeySecrets?)` to a params object** `{ familyId, memberId, passkeySecrets? }`.
   **One** production call site (`BiometricLoginView.vue:42`); the rest are tests. A third
   positional argument on an auth entry point is how `signInWithPasskey(familyId, undefined,
memberId)` eventually gets written.
3. `AuthenticatePasskeyParams` gains `memberId: string`, documented per assumption 5 as
   _selector on native, expectation on web_. This makes `ReauthChallenge.vue:106` a
   compile-forced update — the intended forcing function.
4. `nativeUnlock(familyId, memberId)` — §A.

### F. Lifecycle

- **Password change → re-wrap. Already implemented; no code needed.** `rotateMemberPassword`
  (`authStore.ts:117`) re-wraps `wrappedKeys[memberId]` with a full `RotationSnapshot` rollback
  and a closed `RotateError` union, and `changePassword` (`:935`), `resetMemberPassword`
  (`:996`) and the `signin-heal` path (`:354`) all delegate to it. The device key stores the
  _family key_, not the password, so it is correctly untouched. **Scope here is a regression
  test** asserting a native enrolment still unlocks after a password change.
- **Member removal → invalidate the device key.** Today nothing happens:
  `removeAllPasskeysForMember` (`passkeyService.ts:669`) calls only
  `passkeyRepo.removeAllPasskeysByMember` and has **zero call sites** — verified dead code that
  neither deletes the OS blob nor signals the platform authenticator. Three edits:
  1. Make it load the member's records via the existing `listRegisteredPasskeys(memberId)`
     (`:644`) and route each through the existing `removePasskey(credentialId)`, which already
     branches native → `nativeDisable`, web → `removePasskeyRegistration` +
     `signalCredentialsRemoved`. One implementation of "retire a credential".
  2. This orphans `passkeyRepo.removeAllPasskeysByMember` (`passkeyRepository.ts:51`) — its only
     caller. Delete it in the same change.
  3. Call it from **`familyStore.deleteMember`** (`familyStore.ts:301-313`) — the orchestrator —
     not from the three view call sites (`CreateMembersStep.vue:104`, `BeanDetailPage.vue:83`,
     `MeetTheBeansPage.vue:356`, all verified to go through the store). Views must not call
     services (MVO), and call-site placement would triplicate it and leak on any fourth path.
     Wrap in try/catch **inside the existing `wrapAsync` success branch**: a keystore failure
     must not block the deletion or flip `deleteMember`'s boolean return, but must `reportError`
     at `warning` with `member_id_tail`. `wrapAsync` (`useStoreActions.ts:53-90`) already toasts
     and sets `error.value` on any throw, and `deleteMember` returns `result ?? false`, so an
     unguarded throw here would both double-toast and report `false` for a deletion that
     happened.
  > Note a new side effect worth knowing: routing through `removePasskey` now calls the WebAuthn
  > Signal API on member deletion, telling iCloud Keychain / Windows Hello to hide the
  > credential. Correct, but it is a user-visible platform mutation on a path that previously
  > touched only IndexedDB.
- **`deleteLocalFamily` — one exported call, and it must run BEFORE the registry is emptied.**
  `familyContext.ts:171` currently imports `BiometricKeystore` directly and deletes exactly one
  OS item, `account: familyId`. After §A that is the _legacy_ address, so every per-member blob
  would be orphaned. Replace it with a single `nativeReclaimFamilyKeystore(familyId)` call
  reached through `passkeyService` (so the `isNative()` guard stays in one place);
  `familyContext.ts` then loses its `biometricKeystorePlugin` import entirely and learns nothing
  about addressing.
  **Critically, the call must be hoisted above `:154-159`, where every passkey record for the
  family is deleted.** Placed where the old block sat (`:171`), `listNativeRecords` returns `[]`,
  the loop never runs, and only the legacy blob is deleted — precisely the orphaning this fixes,
  while a mocked test passes green. Either hoist the reclaim ahead of the removal loop, or
  capture `const nativeRecords = passkeys.filter(r => r.mechanism === 'native-keystore')` before
  it. Best-effort, but log a `warn` rather than the current bare catch.

### F′. `ReauthChallenge` — a behaviour improvement that must be verified, not assumed

Passing `memberId: props.member.id` (§A) changes `ReauthChallenge` on native from "prompt, then
discover it was the wrong member" to "select that member's key, or don't prompt at all". That is
strictly better UX and removes a wasted prompt. It is **not** "unchanged in behaviour":

- Member has a key here → the prompt selects it; mismatch becomes impossible.
- Member has **no** key here → `MEMBER_MISMATCH`, no prompt, `t('passkey.wrongMemberError')`.
  It must **not** surface `biometric.reEnroll`, which would falsely tell the user their device
  biometrics changed.
- The hand-written comparisons at `:109` and `:117` are **deleted** — the sentinel replaces
  them. That is the DRY payoff of centralising the check.
- **Three silently-stripped telemetry contexts get fixed while we are here.** `:128` sends
  `{ expected, got }`, `:165` sends `{ memberId }`, and `:137` sends `{ error: result.error }`.
  None of `expected`, `got`, `memberId` or `error` is in `ALLOWED_CONTEXT_KEYS`
  (`diagnosticContext.ts:61-307`), so `redactContext` (`:319-325`) drops all four with a console
  warn — every reauth-mismatch event ever sent has been contextless. Map the first two to
  `member_id_tail` (`:140`) and the third to `detail` (`:185`).
- `detectPasskey`'s family-level `hasRegisteredPasskeys` check (`:66`) is left as-is: it can
  still show the passkey button for a member without a key, who then gets the mismatch message
  and the password field. Tightening it to a per-member check would mean a fourth view importing
  the service; it is a reasonable follow-up, not required here.

### G. End-to-end review (requirement 10)

Read and document in the Outcome: `LoginPage` routing (`onMounted` fast path,
`handleFamilySelected`, `activateFamilyForBiometric`, `handleBiometricAvailable`,
**`handleBiometricFallback`**, `handleSignedIn`, the `@back` handler), `FamilyPickerView`,
`PickBeanView`, `BiometricLoginView`, `LoadPodView.checkBiometricForFamily` +
`registerCrossDevicePasskey`, `ReauthChallenge`, `App.vue`'s enrolment prompt,
`authStore.signIn`/`signInWithPasskey`/`updateSessionWithMemberData`/sign-out teardown, and
`syncStore.hasPendingEncryptedFile`.

Round-3 found a fifth consumer (`App.vue:1591`) and a mis-routed fallback that four prior passes
had missed. Record any further one.

## Split-out work — requirement 11

The original tracker item also carried: _"removing a member should remove the ability to unwrap
the family pod with their password."_ That requirement was designed inside this plan (an
additive `revokedKeys` tombstone on the envelope, applied inside `envelopeMerge`), and a
five-reviewer adversarial audit on 2026-08-27 found the design closes only the **envelope**
routes. Six ways back into the family's data remain open, none of which the tombstone can
reach:

- **(a)** The removed member's native keystore blob returns the RAW family key with no envelope
  consulted — `nativeUnlock` (`nativeBiometric.ts:239-300`) imports it at `:265`.
- **(b)** `settingsStore.cachedFamilyKeys[familyId]` holds an exported raw family key
  (`settingsStore.ts:816-833`), read from `LoadPodView.vue:138`, `LoginPage.vue:433`,
  `syncStore.ts:2396`, `App.vue:543`/`:684`, `passkeyService.ts:746`.
- **(c)** `signInWithPasskey` never checks the roster — `authStore.ts:1128-1138` sets
  `isAuthenticated` from `result.memberId` alone, and `updateSessionWithMemberData`
  (`:1196-1198`) silently no-ops when the member row is gone.
- **(d)** Google Drive `writer` permission on the `.beanpod` **and its parent folder**
  (`useInviteFlow.ts:269`, `:283`) is never revoked. There is no permission-deletion helper
  anywhere in the codebase — `driveService.ts` has only `listFilePermissions` (`:332`),
  `shareFileWithEmail` (`:455`) and `setPublicLinkPermission` (`:487`); its only DELETE (`:441`)
  is `deleteFile`.
- **(e)** `inviteKeys` cannot be revoked by the proposed mechanism: `InviteKeyPackage`
  (`syncFileV4.ts:31-39`) has **no** `memberId`, invites are family-wide
  (`inviteService.ts:70`), nothing prunes `inviteKeys`, and expiry is checked only client-side
  (`useJoinFlow.ts:536`; `redeemInviteToken` at `:90-97` has no expiry check).
- **(f)** The tombstone itself can be silently dropped: `syncService` keeps its **own** envelope
  variable (`syncService.ts:85`), `fetchAndMergeRemote` installs the filtered merge only there
  (`:1211`), and `getEnvelope()` (`:592`) has zero production consumers — so a peer whose
  session predates the removal can clobber it and write a file with the entry restored and
  `revokedKeys` gone.

Two further design issues were left unresolved rather than patched: `keyDictSize`'s strict `>`
comparison (`syncStore.ts:1047`) can never fire for a revocation, because each tombstone added
corresponds to exactly one entry the filter removes — so the "it rides the next successful save"
retry does not exist; and a cache-only family (no provider, so `canDurablySaveNow()` is false at
`syncStore.ts:743`) whose member holds a `wrappedKeys` entry would be permanently unable to
remove them.

**Family-key rotation would not fix (d) or (e)** — a rotated key still lives in a Drive file the
removed member can write to, and a live invite token wraps whatever key is current at
redemption.

Requirement 11 therefore needs a real revocation design — session gate, key eviction on the
removed member's own device, Drive permission removal, an invite story, and the `syncService`
write-back — and gets its own tracker row and its own four passes. **The Help Center copy
drafted for it ("their keys to the pod are destroyed", "their password no longer opens the
family's data on any device") is not true and must not ship in that form.**

## Files Affected

- `src/types/models.ts` — no new type. (`PasskeyRegistration` is the resolver's return type;
  the `DeviceKey` projection considered in earlier drafts is deliberately not added.)
- `src/services/auth/nativeBiometric.ts` — per-member `keystoreAccount`, read-repair migration,
  `nativeResolveDeviceKeys` (replaces `nativeHasRegistered`), `listNativeRecords` +
  `loadNativeRecord` composed on it, new exported `nativeReclaimFamilyKeystore`,
  `nativeDisable(familyId, memberId)`, `MEMBER_MISMATCH` sentinel,
  `removeNativeRecordsForFamily` composed away, family-wide reclaim on OS invalidation, logged
  registry-read failures, updated header comments (`:129`, `:174-176`)
- `src/services/auth/passkeyService.ts` — `resolveDeviceKeys`; `hasRegisteredPasskeys` derived
  from it; `AuthenticatePasskeyParams.memberId` + web-side mismatch → `MEMBER_MISMATCH`;
  `removeAllPasskeysForMember` routed through `listRegisteredPasskeys` + `removePasskey`;
  reclaim delegation; `nativeDisable`/`nativeUnlock` call sites updated
- `src/services/indexeddb/repositories/passkeyRepository.ts` — **delete**
  `removeAllPasskeysByMember` (`:51`), orphaned by the above
- `src/services/auth/biometricKeystorePlugin.ts` — header comment only (`:12`)
- `src/stores/authStore.ts` — `signInWithPasskey` takes a params object with `memberId`; new
  `resolveDeviceKeys` passthrough; **delete** `checkHasRegisteredPasskeys` (`:1247`)
- `src/composables/useBiometricSignIn.ts` — **new**, extracted from `BiometricLoginView`
- `src/pages/LoginPage.vue` — corrected terminal block (`:378`); options object;
  `enterGenericLoadFallback` extended rather than a new helper; logged `:363` catch;
  `handleBiometricFallback` (`:654`) and `@back` (`:712`) branch on the decrypted route;
  `deviceKeys` threaded through `handleFamilySelected`'s payload (`:491-496`); extended
  `logBiometricRouting`; drop `show-not-you-link` (`:709`); emit `not_you_used`
- `src/components/login/FamilyPickerView.vue` — emit `deviceKeys` instead of `hasPasskeys`
- `src/components/login/BiometricLoginView.vue` — net **smaller**: logic moves to the composable;
  adds the no-pending-file branch and the N-key chooser; drops the `showNotYouLink` prop, the
  duplicate `setCurrentMember` (`:93-97`) and the duplicate `setupAutoSync` (`:99`)
- `src/components/login/PickBeanView.vue` — per-member offer in the selected-member panel via the
  composable; try/catch around the currently-unguarded `handleSignIn` (`:65-109`)
- `src/components/login/LoadPodView.vue` — no logic change; confirm `checkBiometricForFamily`
  (`:160`) still reads correctly through the derived boolean
- `src/components/auth/ReauthChallenge.vue` — pass `memberId`; delete the two hand-written
  comparisons (`:109`, `:117`); fix three stripped telemetry contexts (`:128`, `:137`, `:165`)
- `src/App.vue` — per-member enrolment check (`:1591`)
- `src/stores/familyStore.ts` — `deleteMember` invalidates the removed member's passkeys
- `src/services/familyContext.ts` — `deleteLocalFamily` calls `nativeReclaimFamilyKeystore`
  **before** the registry deletion at `:154-159`; **drops** its `biometricKeystorePlugin` import
- `src/services/translation/uiStrings.ts` — one new key, `passkey.wrongMemberError`
  (`en` + `beanie`, both mandatory per CLAUDE.md)
- `src/content/help/security.ts` — the existing `biometric-login` article (`:461`)
- `docs/adr/029-capacitor-native-app-store-distribution.md` — amend the one-per-family clause
  at `:151`
- Tests alongside each of the above

**Considered and NOT changed:** `podAccess.ts` / `structuredError.ts` (the ADR-024 structured-
error registry). It is the right tool for a surface with a _family_ of codes and per-code
recoveries; this change has one new code with one recovery. A registry of one, plus a
`resolveErrorView` wiring and a bespoke banner, would be more code than the existing
`formError`/`errorMessage` surfaces it would replace.

## Help Center Coverage

- **Action**: `update existing` · **Category**: `security` · **Slug**: `biometric-login`
  (`src/content/help/security.ts:461`)
- **Title**: unchanged
- **Scope**: explain that once biometric is set up it becomes the normal way in — unlocking the
  pod and signing you in together — and that a password is always still available. Update the
  existing "What biometric unlock does" section, which currently frames it as a convenience
  layer over the _family password_ only.
- **Notes**: must state plainly that a device's biometric cannot tell family members apart, so
  on a shared device anyone whose face or finger is enrolled on that device can enter the account
  the key belongs to, and that the "not you?" link is how to switch. Also correct the implicit
  one-enrolment-per-device claim: two members can now each enrol on the same device.

## Observability Coverage

**Events.** All on the existing `native-biometric` surface, reusing already-allowlisted keys —
`action`, `detail`, `kind`, `stage`, `os`, `error_code`, `key_backing`, `member_id_tail`, each
individually verified present in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61-307`).
**No new context key**, so no allowlist, Lambda-mirror or store-declaration change.

> **Counts must ride inside `detail`.** `count` is _not_ allowlisted (see the
> `settingsStore.ts:336` precedent), so device-key counts and offered/total pairs must be
> formatted into the `detail` string. Passing them as their own keys would be silently stripped
> by `redactContext` — the exact failure mode requirement 9 exists to prevent. (Note CLAUDE.md
> points at `logEvent.ts` for the allowlist; it actually lives in `diagnosticContext.ts` and is
> imported by `logEvent.ts:25`.)

- `login_routing` (already shipped, `f3cca02c`) — extended with a device-key count inside
  `detail`, the new `decrypted_with_key` reason, and the new `preload_failed` action from the
  newly-logged `:363` catch.
- `unlock_result` — extended `action` with `migrated`, `migrate_failed`, `member_mismatch`.
- `registry_read_failed` (`warn`) — the IndexedDB read behind `resolveDeviceKeys` failed.
  Replaces a bare `catch { return false }` indistinguishable from "no key".
- `picker_offer` — once per picker mount, not per member: `action: offered | not_offered`, with
  the reason and the offered/total counts in `detail`. Per-member emission would burn the
  50/surface/min client cap on a six-bean family for no extra signal.
- `picker_unlock` — `ok | mismatch | cancelled | error`, with `member_id_tail`.
- `not_you_used` — with `detail: 'auto_select' | 'family_picker'`. **The metric that says whether
  the shared-device policy was right**, so it ships from day one.

**Failure modes → the event that diagnoses each, blind:**

- Key exists but never offered → `login_routing` / `picker_offer` naming the branch and count.
- Registry unreadable (masquerading as "no key") → `registry_read_failed`.
- Pod pre-load failing on family select → `login_routing / preload_failed` (previously a bare
  catch).
- Migration silently failing → `migrate_failed`, or absence of `migrated`.
- OS-invalidated key → existing `absent_self_heal`.
- Asked for a member with no key here → `member_mismatch`, distinct from `absent_self_heal`
  (conflating them would send a healthy user a re-enrol message).
- Auto-enter entering the wrong account → `not_you_used` + `picker_unlock: mismatch`.

**Success path emits too**, so rates are computable rather than only failures.

**Critical vs telemetry.** None of these warrant `severity: 'critical'` — a biometric failure
always falls back to a password, so no user action fails and no data is at risk. Firehose
`info`/`warn` only. The existing `plugin-missing` at `error` (a broken build) stays as-is.

**Rate cap.** Worst realistic burst is four events — one cold login (`login_routing` +
`unlock_result`), one picker mount (`picker_offer`), one tap (`picker_unlock`) — against
50/surface/min. The per-mount rather than per-member choice for `picker_offer` is what keeps it
there.

## Acceptance Criteria

- [ ] Cold sign-in on a device with a key: one biometric prompt → in the app as the right
      member, no password at any point.
- [ ] Pod already decrypted: picking the member with a key signs in on one prompt, no password.
- [ ] Picking a member with no key asks for their password, with no failure implication.
- [ ] "Not you?" is visible before landing in an account on every auto-enter path — including
      the family-picker route, which `showNotYouLink` did not cover.
- [ ] Declining biometric on the already-decrypted route lands on `pick-bean`, **not** on
      `load-pod` with autoLoad; `@back` likewise.
- [ ] Two members can each enrol on the same device, are each offered their own key, and are
      distinguishable on the cold-start screen — including that the second member is actually
      _offered_ enrolment (`App.vue:1591` is per-member).
- [ ] An enrolment made before this change still works after it (read-repair), the migration is
      visible in telemetry, and a _failed_ repair still yields a successful unlock.
- [ ] A key survives sign-out, restart and app update.
- [ ] An OS-invalidated key gives a re-enrol message, never a dead end, and clears the family's
      stale records device-wide — while a member who simply has no key on this device gets the
      _mismatch_ path, not the re-enrol message.
- [ ] Removing a member invalidates their key, record and OS blob from every removal call site,
      because the invalidation lives in the store — and a keystore failure does not flip
      `deleteMember`'s return value.
- [ ] Deleting a local family reclaims every per-member blob plus the legacy one, and the reclaim
      runs **before** the registry records are deleted.
- [ ] A password change leaves a working enrolment working (regression only — no new code).
- [ ] `LoadPodView`'s biometric path is unchanged in behaviour. `ReauthChallenge` is unchanged on
      web and **improved** on native per §F′ — no wasted prompt, same outcomes — and its three
      mismatch telemetry contexts now actually reach CloudWatch.
- [ ] `${familyId}:${memberId}` and the bare-`familyId` legacy address appear in exactly one
      source file (`nativeBiometric.ts`). Grep proves it.
- [ ] `authStore.checkHasRegisteredPasskeys` and `passkeyRepo.removeAllPasskeysByMember` are
      gone, with no remaining callers. Grep proves it.
- [ ] Behaviour matches on web, PWA, iOS and Android, or the difference is documented.
- [ ] Help Center article updated per **Help Center Coverage**; ADR-029's one-per-family clause
      (`:151`) amended.
- [ ] Diagnostic logging per **Observability Coverage** implemented and verified — including
      that no count is passed as an un-allowlisted key.
- [ ] No bare `catch {}` remains on any code path this change adds or modifies. (Scoped to
      modified paths: `LoadPodView.vue` is 1464 lines and `familyContext.ts` carries unrelated
      best-effort catches; converting those is diff-inflating scope creep. The `LoginPage.vue:363`
      catch IS in scope.)

## Testing Plan

1. Unit: `resolveDeviceKeys` for none/one/many members, native and web; and that
   `hasRegisteredPasskeys` is genuinely derived from it (one fake registry drives both).
2. Unit: the read-repair — per-member hit; legacy hit + successful re-write + legacy delete;
   legacy hit + re-write failure (must still return the key and emit `migrate_failed`); double
   miss (`absent_self_heal`).
3. Unit: `nativeUnlock` with a `memberId` that has no record returns `MEMBER_MISMATCH`, issues
   **no** biometric prompt, and does **not** clear any record.
4. Unit: OS invalidation clears the family's records device-wide, not just the unlocking
   member's.
5. Unit: `LoginPage` routing precedence — key present + pod decrypted must reach `biometric`.
   **Assert it red first**: this is the exact case that fails today.
6. Unit: `use-password` from `BiometricLoginView` with no pending file lands on `pick-bean`;
   `@back` on that route likewise; with a pending file both keep today's behaviour.
7. Unit: the extended `enterGenericLoadFallback` — each fall-back reason produces the correct
   flag combination; the preload catch emits `preload_failed`.
8. Unit: `BiometricLoginView` no-pending-file branch (must not call `decryptPendingFileWithKey`),
   and the N>1 chooser rendering one button per device key.
9. Unit: `useBiometricSignIn` — cancel returns `{ ok:false, message:null }`;
   `WRONG_FAMILY_CREDENTIAL` and `MEMBER_MISMATCH` map to their strings; the `crossDevice`
   variant carries `passkey.crossDeviceNoCache`; a `syncNow` rejection does not surface an error
   on an otherwise successful sign-in; an unexpected throw calls `reportError` **and** returns a
   message.
10. Unit: `PickBeanView` offers in the selected-member panel only when that member has a key; a
    `MEMBER_MISMATCH` surfaces in `formError` with the password field usable; a member with no
    password still gets the create-password form; a throw in `handleSignIn` surfaces rather than
    dying silently.
11. Unit: `App.vue`'s enrolment prompt is offered to a second member on a device where a sibling
    already has a key.
12. Unit: `familyStore.deleteMember` invalidates that member's passkeys, and a keystore failure
    neither blocks the deletion nor changes the returned `true`.
13. Unit: `deleteLocalFamily` calls `nativeReclaimFamilyKeystore` **before**
    `removePasskeyRegistration`, and constructs no account string itself. (Assert ordering — an
    order-agnostic test passes on the broken sequence.)
14. Regression: an enrolled member changes their password and biometric still unlocks.
15. Device (iOS + Android, cannot be simulated): cold sign-in; sign-out then sign-in; two members
    enrolled on one device; a pre-change enrolment surviving; "not you?" switching member; OS
    invalidation by adding a fingerprint; `ReauthChallenge` for a member with and without a key
    on the device.
16. Web: the same matrix with WebAuthn passkeys, including the no-PRF-no-cache path, and
    confirming `allowCredentials` is still omitted (assumption 5 has not been "fixed" away).
17. Full suite + lint + type-check; `check-ios-sources.mjs` still green. No new E2E test — the
    Three-Gate Filter fails at gate 3 (biometric cannot run headless) and the budget is capped.
    Verified: no existing E2E spec touches pick-bean, biometric, member removal or the "not you?"
    copy.

**Known test blast radius** (the plan's "tests alongside" is doing real work):
`nativeBiometric.test.ts` — six `nativeUnlock('family-1')` arity failures (`:164`-`:209`), the
`nativeHasRegistered` block (`:227-251`), and the one-record-per-family assertion (`:110`);
effectively a rewrite. `passkeyService.test.ts` — thirteen `authenticateWithPasskey({ familyId })`
calls now missing a required `memberId`, plus `:174`/`:185` delegation assertions and the `:64`
mock. `familyStore.test.ts` and `CreateMembersStep.test.ts` — the new `passkeyService` import.
`authStore.passwordRotation.test.ts` / `authStoreChangePassword.test.ts` and five `syncStore`
tests — `passkeyService` module shape. `LoadPodView.test.ts:122` — the `hasRegisteredPasskeys`
mock. **No test file exists for `BiometricLoginView.vue` or `LoginPage.vue`** — which is why the
routing bug survived; items 5-8 are net-new files.

## Review Passes

**Round 1** (initial design):

- **Pass 1 (draft)**: drafted from the code rather than the ticket, which revealed the resolver,
  the `memberId` plumbing and `signInWithPasskey` already exist — reducing the work to routing, a
  per-member storage key with read-repair, and lifecycle.
- **Pass 2 (DRY + error handling)**: corrected two false claims — the routing bug is in
  `activateFamilyForBiometric`, and `LoadPodView` is a second decider. Found the password-change
  half already implemented and the removal half dead code. Made `resolveDeviceKeys` supersede
  `hasRegisteredPasskeys`, extracted `useBiometricSignIn`, moved removal invalidation into the
  store, deleted `removeNativeRecordsForFamily`, two duplicate calls and the `showNotYouLink`
  prop.
- **Pass 3 (sustainability)**: removed an ambiguous tri-state reader and an optional `memberId`,
  centralised the mismatch as one sentinel, closed an address-format leak into `familyContext`,
  kept new view code off direct service imports, named the four-signature plumbing chain.
- **Pass 4 (fresh eyes)**: found the mixed-version reasoning backwards, native credentialIds
  deterministic rather than fresh, a fifth `checkHasRegisteredPasskeys` consumer, and a §D/§E
  contradiction over whether `MEMBER_MISMATCH` is silent.

**Round 2** (requirement 11 added, then split out): passes 2-4 re-ran on the combined plan. Pass
2 found `passkeyWrappedKeys` is keyed by credentialId not memberId, and that `envelopeMerge`'s
union merge resurrects any bare prune — rebuilding §F″ around a tombstone. Pass 3 caught an ESM
store cycle and split the store action. Pass 4 found the durability pre-gate would have made
member removal impossible for cache-only families.

**Round 3 (five-reviewer codebase audit, 2026-08-27)** — the pass that split the plan:

- _Reuse_: found the DRY plan itself duplicating existing code three times — `syncNowBounded`
  (which exists specifically to absorb the pattern being rewritten), `resetLoadPodState` /
  `enterGenericLoadFallback`, and `DeviceKey` over `PasskeyRegistration`. Also: deleting
  `authStore.checkHasRegisteredPasskeys` and `passkeyRepo.removeAllPasskeysByMember`, collapsing
  three copies of the native-record filter, and a third stripped telemetry context.
- _Fact-check_: verified every file:line claim. Found the ADR-029 "identity model" quotation does
  not exist, ADR-032 is the wrong ADR for the envelope contract, the member-removal help article
  is not in `the-pod.ts`, `activateFamilyForBiometric` has one call site not two, and a dozen
  line-number drifts. Corrected `healStaleWrappedKey`'s described behaviour.
- _Blast radius_: found `handleBiometricFallback` mis-routing the new decrypted path, the
  `deleteLocalFamily` reclaim running after the registry is emptied (a no-op that tests green),
  the narrowed OS-invalidation self-heal, and mapped the test-suite damage.
- _Security (requirement 11)_: traced every unwrap path and found the tombstone closes only the
  envelope routes — six others remain open. This is why requirement 11 was split out.
- _Scope_: confirmed requirements 1-10 are delivered, recommended cutting `memberName`, and made
  the case for the split.

## Implementation Outcome (2026-08-27)

Implemented and reviewed. Type-check clean, lint clean, 5077 tests pass (22 net-new), iOS
source guards green, and `${familyId}:${memberId}` appears in exactly one source file.

**Four reviewers went over auth/login/biometrics afterwards — new code and old — and found
three defects in the implementation itself.** Each is worth recording, because each is a
different way for a change to look finished and not be:

1. **The biometric button did nothing on cold start.** Three routes reach the biometric
   view; only one set `biometricDeviceKeys`, and the view drives itself off that prop. So
   on the commonest path of all, the button rendered and silently no-opped — no prompt, no
   error, no telemetry. Fixed by making `enterBiometricView` the single entry point that
   sets all four pieces of state together, and pinned by a test that fails on the old code.
2. **The read-repair migration was removed entirely.** Its central claim — "`setKey` needs
   no authentication, so re-homing the key costs zero extra prompts" — is true on iOS and
   false on Android, where `setKey` fires a second `BiometricPrompt` immediately after the
   unlock the user just satisfied, and dismissing it would repeat that forever. Replaced by
   a `keystoreScheme` field on the record: legacy enrolments keep working at the legacy
   address, and a re-enrol moves them. Simpler, and it also fixed a data-loss bug where the
   first bean to open the app after an update destroyed the other bean's enrolment.
3. **The chooser could not tell two beans apart.** `PasskeyRegistration.label` is a DEVICE
   descriptor ("Face ID · Safari, iOS"), identical for everyone enrolled on the same phone,
   so "Who's signing in?" rendered two identical buttons. `memberName` — dropped earlier as
   unnecessary complexity — turned out to be exactly what the feature needed, and is now
   captured at enrol time.

Also fixed from the review: `notEnrolled` no longer wipes the whole family's enrolments (on
Android it can mean a momentarily busy sensor); a thrown keystore presence check no longer
deletes a good enrolment; `ReauthChallenge` and `LoadPodView` gate per member rather than
per family, so neither offers a button that cannot work; the web registry read degrades like
the native one instead of throwing out of three views' `onMounted`; synced passkeys are
de-duplicated by member; the cross-device banner no longer permanently masks later errors;
and `hasRegisteredPasskeys` was deleted once its last caller went, leaving `resolveDeviceKeys`
as the single question.

### Known gaps, deliberately not fixed here

- **A member can sign in as a different member on a shared device.** The OS prompt accepts
  any enrolled biometric, and every member's blob holds the same family key, so a child
  whose fingerprint is enrolled on the family tablet can pick a parent's bean and pass.
  Per-member addressing labels identity; it does not separate keys. Needs its own decision.
- `settingsStore.cachedFamilyKeys` stores the family key **unencrypted** in IndexedDB and
  `signOut` never clears it (only `signOutAndClearData` does).
- `setPassword` has no authorization check, so any unclaimed member can be claimed from the
  login screen.
- iOS keychain items survive app uninstall, but the registry that enumerates them does not —
  so per-member blobs can be orphaned beyond any code path's reach.
- The `'loading'` view has no escape, and `onMounted`'s unbounded awaits can leave a spinner
  with no way out.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial (tracker #76 refinement, 2026-08-27)

> "close #74 and file an issue … to implement comprehensive and holistic biometric
> authentication, across web and all apps" — plus the follow-up specifying: unlock the pod AND
> log in directly to the member; after logout, biometric after the member is picked; never
> expire; always the default; review all existing login/authorization code.

### Policy decision

> "i actually lean towards the second - always auto-enter, but have a not you? escape hatch …
> trusted device does not really apply here as it's more for whether or not we keep cache than
> for deciding who to login"

### Go-ahead

> "go ahead with /beanies-plan"

### Requirement 11 (later split out)

> "yes, removing a member should remove the ability to unwrap the family pod with their
> password. please wrap in that implementation to this plan"

### Round-3 audit

> "given the importance and complexity of this plan, and especially the fact that we are
> reviewing and updating/changing existing code that has been built at the very beginning of this
> project, please perform one more comprehensive holistic review of the overall codebase and plan
> to ensure that the plan is accurate and delivers what we expect, is not copying or duplicating
> any functionality that already exists, and has taken into account the existing code and is
> making the correct and appropriate changes without adding any unnecessary complexity or side
> effects"

> "find to also fold in the fixes you found if they are legitimate and accurate bugs"

### Split

> "yes go ahead with the split"

</details>
