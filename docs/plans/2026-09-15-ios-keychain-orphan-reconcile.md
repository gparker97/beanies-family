# Plan: iOS keychain orphans — make key material enumerable, then reachable

> Date: 2026-09-15
> Related issues: Notion tracker #82 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-09-15-ios-keychain-orphan-reconcile.md`

## User Story

As a family whose data is supposed to be mine and under my control, I want every piece of key material beanies puts on my device to be something the app can find and delete, so that "clear all data" means what it says even after I have deleted and reinstalled the app.

## Context

iOS keychain items survive an app uninstall by design. The registry beanies uses to enumerate them does not: it lives in IndexedDB (the _registry_ DB — `passkeys` store, `passkeyRepository.ts`), which iOS removes with the app. So after a delete-and-reinstall, per-member key blobs remain in the keychain while nothing in the app knows they exist.

**The defect is confirmed in code, not inferred.** `nativeReclaimFamilyKeystore` (`src/services/auth/nativeBiometric.ts:410`) is documented as _"the only route by which another module may reclaim keystore storage"_, and it works by iterating `listNativeRecords(familyId)` — which is literally `nativeResolveDeviceKeys` (`nativeBiometric.ts:455-457`), a **registry** read. Its callers are exactly the product's advertised deletion paths:

- `src/stores/authStore.ts:2511` — inside the `reclaimAllPasskeys` sign-out step (tier 3, **clear all data** — confirmed in `signOutSteps.ts:104`, `SIGN_OUT_CLEAR_STEPS`), reached via `passkeyService.reclaimFamilyKeystore`
- `src/services/familyContext.ts:165` — `deleteLocalFamily` (delete this family from this device), same seam
- `src/services/auth/nativeBiometric.ts:370` — the device-wide OS-invalidation path

All three therefore inherit the blindness: they can only delete what the registry remembers, and the registry is the thing that died. That is the whole bug, and it means the fix belongs at that one chokepoint.

**Two further silent failures found while verifying, in the same blast radius.** They are part of this change because they are the same defect class (a delete that reports success without deleting):

- `BiometricKeystorePlugin.swift:143-148` — `deleteKey` **discards `SecItemDelete`'s `OSStatus` entirely** and always `resolve()`s. It also skips the delete and still resolves when handed no `account`. So "the OS blob was deleted" has never been a fact the JS could rely on. This is bigger than the missing-parameter case the pre-plan found.
- `BiometricKeystorePlugin.swift:122-126` — `hasKey` resolves `{present: false}` when handed no `account`. `nativeUnlock` treats `present: false` as "the OS wiped this key" and **deletes the record** (`nativeBiometric.ts:321-331`). A malformed account would therefore delete a live enrolment — the exact shape of the 0.13R2 incident.
- JS side, **two** bare `catch {}` swallows around `deleteKey` (`nativeBiometric.ts:416-418`, `492-494`) mean a failed blob delete is invisible even once the plugin starts reporting it. _(Pass 4 correction: earlier drafts said "three". There are three bare `catch {}` in the file, but the third — `:186-188` — wraps `removePasskeyRegistration` in the stale-record cleanup and is explicitly out of scope. Two are around `deleteKey`.)_

**Pass 3 addition — the same two lies exist on Android, and one of them is worse there.** `android/app/src/main/java/family/beanies/app/BiometricKeystorePlugin.java:206-213` (`deleteKey`) silently resolves on a missing account and swallows every `deleteAlias` failure; `:190-204` (`hasKey`) resolves `present: false` on a missing account **and on any exception**. `nativeBiometric.ts:316-319` already carries the comment explaining precisely why that is dangerous — _"on Android a transient KeyStore failure would otherwise delete a perfectly good enrolment"_ — and the Java code is what causes it. The TS interface (`biometricKeystorePlugin.ts:18-20` — _Pass 4 correction: the Pass-3 draft cited `:118-120`, which does not exist; the file is 56 lines_) promises _"All methods reject with a typed `BiometricKeystoreError`"_; fixing only iOS would make that doc true on one platform and false on the other, which is a maintenance trap in its own right. So the truthfulness fixes are applied to both plugins.

**What the material is.** The blob is the raw family AES key, stored biometric-gated (`SecAccessControl(.biometryCurrentSet)` + `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`) under service `family.beanies.app.biometric`, account `${familyId}:${memberId}` (legacy scheme: bare `${familyId}`). ADR-029 / #52 introduced this storage; ADR-029's 2026-08-27 amendment introduced the per-member address and the `keystoreScheme` field.

**Two facts established during pre-plan that shape the design:**

1. **The keychain is itself a durable, enumerable registry.** Because the account string encodes both ids and the service is a single fixed constant, a query by service alone recovers every `familyId`/`memberId` pair on the device. No new durable registry is needed. The plugin simply never exposes it: `baseQuery()` (`:152`) always pins `kSecAttrAccount` and all five methods require an account.
2. **iCloud sync is a non-issue.** `ThisDeviceOnly` items do not sync via iCloud Keychain and do not migrate to new hardware, so the exposure is one device. This also narrows the original framing: an orphan sits in a local encrypted backup but cannot be restored onto a different device.

## Requirements

1. The app can enumerate every keychain item it owns on the device, without a registry and without prompting for biometrics.
2. A delete-and-reinstall no longer produces material the app cannot see. Blobs for the device's families are **adopted** back into the registry rather than deleted, so a legitimate reinstaller keeps biometric unlock.
3. `nativeReclaimFamilyKeystore` reaches orphans as well as registered records, so all three advertised deletion paths do too.
4. A member absent from the live roster has no surviving blob once the roster is known — **for the family whose roster is known, and never for any other family on the device.**
5. An explicit "clear all data" removes **every** item for the service on this device, not only those the registry knows — and does so even if enumeration is unavailable, **even if the sweep primitive itself is unavailable**, **on both shipped platforms**.
6. No plugin method reports success, or reports absence, when it was given nothing to act on or when the OS operation failed. Every blob delete is either provably done or reported. One TS interface, one contract, both platforms.
7. Adoption and deletion counts reach the diagnostic firehose so we learn whether this happens in the field.
8. No measurable cold-start cost, and no unbounded added latency on the login paths. _(Pass 3 restatement: `FamilyPickerView` mounts at launch on native, so "the login path" and "boot" overlap — the adoption pass is therefore **time-bounded**, not merely "not at boot". Pass 4 tightening: the budget is spent **once per session in total**, not once per caller — `FamilyPickerView.loadFamilies()` awaits `resolveDeviceKeys` once per family in a sequential loop, so a per-caller timeout would multiply the budget by the family count. See Approach §4.)_

## Important Notes & Caveats

- **The load-bearing unknown is now handled either way, not gated on.** The enumeration relies on `SecItemCopyMatching` with `kSecReturnAttributes: true`, `kSecMatchLimitAll` and **no** `kSecReturnData` returning access-controlled items _without_ an authentication prompt. This is the documented behaviour (attributes are not protected data) but this exact API surface has already burned this project once: `hasKey`'s comment (`:128-134`) records the 0.13R2 field bug where `kSecUseAuthenticationUISkip` made `SecItemCopyMatching` **silently exclude** access-controlled items, a healthy key read as `errSecItemNotFound`, and the JS self-heal then deleted live enrolments. **Read that comment before writing the query.** Pass 2 change: the query carries an `LAContext` with `interactionNotAllowed = true` from the outset (mirroring `hasKey`, the proven pattern in this same file) so that if the OS ever decides authentication is needed we get a deterministic `errSecInteractionNotAllowed` rejection instead of a **surprise Face ID prompt on the login screen**. Every consumer degrades on rejection, so the on-device check (still an acceptance criterion) confirms behaviour rather than unblocking the build.
- **⚠️ Pass 4 — do NOT read `hasKey`'s behaviour as a prediction of `listAccounts`'s, and say so in the Swift comment.** `hasKey` (`:138`) calls `SecItemCopyMatching(query, nil)` with **no return-type key at all**, and for a `kSecClassGenericPassword` item that makes the keychain fall back to returning the item's _data_ — which is why it evaluates the ACL and why its comment reports `errSecInteractionNotAllowed` as the expected status for a healthy gated item. `listAccounts` explicitly asks for `kSecReturnAttributes` only, so the item's encrypted data is never touched and the ACL should not be evaluated. This distinction is the entire basis of assumption 1. Without it stated in the code, the next reader looks at `hasKey` two functions above, concludes gated items always come back `errSecInteractionNotAllowed`, and "fixes" `listAccounts` into something that prompts.
- **Deletion is only ever of affirmatively observed accounts.** Nothing in this change deletes "everything except" a set. Every delete target is either an account the enumeration returned, or an account derived from a registry record, or — for the explicit clear-all — a single service-wide delete primitive that needs no enumeration at all. An empty or failed enumeration therefore cannot cause a deletion, structurally, with no `if (empty) return` guard to forget.
- **Requirement 5 is deliberately made independent of the unknown.** The clear-all sweep is one service-wide `SecItemDelete` (`kSecClass` + `kSecAttrService`, no account), which requires no authentication and returns no attributes — so it is immune to the "gated items excluded from enumeration" risk that would otherwise make the product's strongest promise depend on the plan's weakest assumption.
- **⚠️ Pass 3, the one behaviour regression in the Pass-2 draft: the clear-all sweep must exist on Android too, or §7 newly orphans Android blobs.** Today `authStore`'s `reclaimAllPasskeys` loops families and calls `reclaimFamilyKeystore(family.id)`, which on Android _does_ delete the SharedPreferences blob and the KeyStore alias per member. §7 replaces that loop with a single `deleteAllKeys()`. If `deleteAllKeys` is iOS-only it rejects on Android with Capacitor's not-implemented error, the step fails, **and step 2 still removes the registry records** — leaving live Android KeyStore aliases with nothing left that knows their addresses, on a still-installed app. That is this plan's own bug class, newly introduced on the platform that does not have it. `deleteAllKeys` is therefore implemented in the Java plugin as well (8 lines: iterate `prefs().getAll().keySet()` → `deleteAlias(account)`, then `prefs().edit().clear().apply()`). Verified safe: the `beanies_biometric` prefs file holds **only** account keys (`:115` is the sole writer, `putString(account, …)`). With both platforms implementing it, §7 needs no platform branch at all.
- **⚠️ Pass 4, the generalisation of that same regression: a _missing or failing_ `deleteAllKeys` must not make clear-all a total no-op.** The Pass-3 fix closed the Android case by implementing the method. It did not close the case the repo has already lived through: a Swift `@objc func` that exists but was never added to `pluginMethods` rejects as not-implemented (#74, twice — see `scripts/check-ios-sources.mjs`'s header). In that build, §7's single `deleteAllKeys()` call fails, the step is caught and logged by `runSignOutSteps`, the records are still deleted, and the user is told their data is cleared while **every blob on the device survives with nothing left that knows its address** — strictly worse than today's per-family loop. `nativeReclaimAllKeystores` therefore carries a defence-in-depth fallback that uses only the long-shipped `deleteKey`: on any rejection it reports and then reclaims per family, with the family ids derived from the registry read `authStore` already performs. See §7. This is the one fallback branch in the plan, and it is here because "reports gone while present" on the product's strongest promise is the exact failure this whole change exists to remove.
- **Adopt, do not sweep, at sign-in.** At `resolveDeviceKeys(familyId)` time the pod is not open, so there is no roster to validate member ids against. Deleting anything there would break the reinstaller. Adoption is safe because it only makes material _visible_; it grants no access the device's owner did not already have (the blob is still biometry-gated).
- **A device may legitimately hold blobs for more than one family.** "Not the family being signed into" is NOT evidence of an orphan. Only the roster of **that same family** (requirement 4) or an explicit user-initiated wipe (requirement 5) may delete a family's material. Adoption, being non-destructive, runs across **all** families in one pass (see Approach §4) — that is what makes it one enumeration per app session instead of one per family per render.
- **⚠️ Pass 4 — the single most dangerous defect found in this plan: the Pass-3 roster reconcile would delete OTHER families' live enrolments.** Adoption is all-families by design, so `adoptedTargets` spans every family on the device; the roster watcher fires with the **active** family's member list; and Pass 3's reconcile drained the whole adopted set and deleted every target whose `memberId` was not in that list. Concretely: a device holding family A (two parents) and family B (a grandparent) is reinstalled, A is loaded and signed into, A's roster arrives — and B's grandparent's blob **and** registry record are deleted, at `info`, as a successful reconcile. They lose biometric unlock on a family that was never involved. The Pass-3 `KeystoreTarget` type (`{ account; credentialId? }`) carries no `familyId`, so the filter was not merely forgotten, it was unexpressible. Fixed in §4/§6: adopted targets are a distinct `AdoptedTarget` type carrying `familyId` and `memberId`, and the drain is **per family** (`takeAdoptedTargets(familyId)`). This is exactly the "delete a live enrolment a user still needs" class, and it is worth noting that no acceptance criterion in the Pass-3 draft would have caught it — the criteria all described one family.
- **Legacy bare-`familyId` blobs cannot be adopted, ever.** `PasskeyRegistration.memberId` is required and a legacy account encodes no member; once the roster is known, any of N members could own it. So legacy blobs are enumerated, counted, and left to the reclaim/sweep paths (which already target the legacy address). Do not invent a member id for one. _(Correction: the Pass-1 draft said adoption writes "legacy where the account is bare" — that is not constructible.)_
- **Do not migrate legacy blobs to the per-member address.** `nativeBiometric.ts:423-434` already documents why at length: on Android `setKey` fires a second BiometricPrompt and a dismissal leaves the old blob uncleaned, so the double prompt returns on every sign-in. ADR-029 line 157 records the same decision ("A read-repair migration was designed and rejected during review"). Read legacy, delete legacy, never rewrite it.
- **⚠️ Pass 4 — `nativeUnlock`'s own doc comment currently contradicts all of that and must be corrected in the same edit.** `nativeBiometric.ts:283-290` documents a "Resolution order" whose step 2 is _"prompt once against [the legacy item], then silently re-home the key at the per-member address and drop the legacy blob"_. The body does no such thing: it resolves one address from `recordAccount(familyId, record)` and reads it, full stop. So the file simultaneously documents a legacy re-home (`:283-290`), documents that re-homing is unsafe and deliberately not done (`:423-434`), and implements the latter. This plan is entirely about legacy blobs and who deletes them; leaving a stale comment that says they get dropped on unlock is how the next person reasons wrongly about exactly this change. One-line fix, same edit, no behaviour change.
- **The Share Extension shares an app-group container, not the keychain.** Verified: `ShareIntentPlugin.swift` and `ShareExtension/ShareViewController.swift` touch only `containerURL(forSecurityApplicationGroupIdentifier:)`. `grep -rn SecItem ios/` returns **no** hit outside `BiometricKeystorePlugin.swift`. Assumption 3 is confirmed; the extension is out of the blast radius. Do not extend this to "delete everything on launch".
- **A new `@objc func` that is not listed in `pluginMethods` (`:25-31`) is invisible to Capacitor.** That is exactly how #74 happened. Both new methods must be added to that array in the same edit. `scripts/check-ios-sources.mjs` does not cover this (it guards files-not-in-target, not methods-not-registered), and no new Swift _file_ is added here, so that script is unaffected. The Pass-4 sweep fallback above is the runtime safety net for the same mistake.
- **`listAccounts` stays iOS-only, deliberately, and that asymmetry is safe where `deleteAllKeys`'s was not.** Android's blobs live in `SharedPreferences`, which dies with the app _together with_ the IndexedDB registry — the two can never diverge, so there is nothing to enumerate back. The union design (§5) means an unavailable enumeration contributes nothing and reclaim behaves exactly as it does today. `isPluginMissing()` (`nativeBiometric.ts:104-107`) already recognises the not-implemented rejection, and that degrade path is **mandatory regardless of platform** (a Swift method not added to `pluginMethods` fails identically — the #74 class), so no platform branch is added to the shared module.
- **Pass 3: `isPluginMissing()` matches Capacitor's rejection _message_, not a `TypeError`.** In production the Capacitor proxy always exists and rejects with "not implemented", so the helper is correct. In a **unit test** whose plugin double lacks the method, the call is `undefined(...)` → a `TypeError` the helper does not match → the `enumerate_failed` `reportError` path. That is why extending the test doubles is mandatory, not cosmetic (see Files Affected).
- **Pass 4 — adoption is lazy, and on a fresh reinstall it does not run until a family is loaded.** After a delete-and-reinstall the _family_ registry is gone too, so `FamilyPickerView.loadFamilies()` iterates zero families and never calls `resolveDeviceKeys`. Adoption first runs when the user opens their `.beanpod` and a family exists to resolve keys for — which is the intended "at sign-in" seam, but it means the correct statement is "**at most** one adoption enumeration per session", not "exactly one". The §13 CloudWatch expectation and the telemetry rate calculation are worded accordingly.
- **Pass 4 — adoption can create registry records for families that are not in the family registry.** A device holding blobs for a family the user never re-loads gets `native-keystore` records with no matching `families` entry. That is the point (requirement 1: the material becomes enumerable), and clear-all reaches them because §7 works from `getAllPasskeys()`. `deleteLocalFamily` does not, because it is per-family and that family is not listed — an accepted, documented limit, not a new leak: today those blobs are invisible to _everything_.
- **Pass 4 — a failed `deleteKey` on disable now causes the enrolment to reappear at the next session, and that is the honest outcome.** Once the blob delete is reported rather than swallowed, a genuine OS delete failure leaves the blob present with its record removed; the next session's adoption re-creates the record and biometric unlock is offered again. This is not a regression: today the same failure leaves the blob present and _hides_ it, which is the lie this plan exists to remove. The material was never gone, and re-adoption makes the UI agree with the device. It is observable (`deleteBlob` warns with an `error_code`, and `purgeTargets` emits a `warn` summary), bounded (each retry can now actually reach the blob), and pinned by a test.
- The residue case (reinstall, never sign in again) is accepted deliberately — see Approach §7.

## Assumptions

> Review these before implementation.

1. `kSecReturnAttributes` + `kSecMatchLimitAll` with no `kSecReturnData` returns access-controlled items without prompting. **Still the least certain assumption — but no longer load-bearing:** every consumer degrades safely on rejection or on an empty result, requirement 5 does not depend on it, and the `interactionNotAllowed` context converts a wrong guess into a typed error rather than a login-screen prompt. _(Pass 4: `hasKey`'s `errSecInteractionNotAllowed` behaviour does not contradict this — it requests no return-type key, so the keychain returns the item's data and evaluates the ACL. See Caveats.)_
2. The account format remains `${familyId}:${memberId}` with a bare `${familyId}` legacy form, and family/member ids never contain a colon (both are UUIDs, so this holds). The parser splits on the **first** colon and flags anything with a second colon as unparsed rather than trusting it. A malformed account is read as _"belongs to the family before the first colon"_ — the conservative reading, since that is the only claim the string supports and it keeps family-scoped reclaim able to remove it.
3. `family.beanies.app.biometric` is the only keychain service beanies writes on iOS. **Verified** (see Caveats).
4. `nativeResolveDeviceKeys` remains the single native entry point for "what keys does this device hold for this family", called from the login surface (`src/composables/useLoginFlow.ts:288`, `src/components/login/FamilyPickerView.vue:55` via `authStore.resolveDeviceKeysForFamily`, `proveMethods.ts:189/269`, `authPrompts.ts:96`, `ReauthChallenge.vue:151`). **Verified**, with one Pass-3 correction: it is not called at cold start _by `authPrompts`_ (that runs from `App.vue`'s post-sign-in chain), but `FamilyPickerView.loadFamilies()` runs in `onMounted` and loops every family — **sequentially** (`for (const family of allFamilies) { await Promise.all([...]) }`) — and on native that mount **is** app launch. Requirement 8 is restated accordingly, including the Pass-4 "budget once per session, not per caller" consequence of that loop being sequential. _(Pass 4 path correction: `useLoginFlow.ts` lives at `src/composables/`, not `src/services/auth/`.)_
5. `passkeyRepo` can write a registration record without a live pod. **Verified** — the `passkeys` store lives in the _registry_ database (`passkeyRepository.ts:3`, "device-level and survive sign-out"), not the per-family pod DB.
6. `guessAuthenticatorLabel()`, `idTail()`, `updatePasskey()`, `getAllPasskeys()`, `isPluginMissing()`, `errorCode()` and `detailOf()` already exist and are reused rather than reimplemented. **Verified** (`passkeyRepository.ts:31,36` for the repo pair).
7. **Pass 3:** `raceTimeout(promise, ms)` exists as a shared util (`src/utils/timing.ts:57`, returns `T | undefined`, already the house pattern for "do not hang a login path" — it is the fix that shipped for the 0.9.5R3 biometric "verifying" freeze). **Verified.**
8. **Pass 3:** `refreshRosterCache` (`src/services/auth/rosterCache.ts:41`) is the existing, directly analogous consumer of the `familyStore` roster watcher: `void`-called, never throws, resolves the active family itself, no-ops on an empty list, and re-checks the active family before writing (TOCTOU guard). The new roster hook is modelled on it rather than inventing a second shape. **Verified** (`rosterCache.ts:43` empty-list no-op, `:46-47` active-family resolve, `:67` TOCTOU re-check, `:69-74` never-throws).
9. **Pass 4:** `passkeyService.ts` must not gain a static import of any Pinia store. `authStore.ts:13` statically imports `resolveDeviceKeys` from `passkeyService`, so the reverse edge is a genuine cycle. **Verified** — `passkeyService`'s imports are the repo, `nativeBiometric`, models, `date`, `capabilities`, `logEvent` and `biometricShared` only. The signed-in member id is therefore **passed in** from the `familyStore` watcher (which already holds `currentMember`), not looked up inside the service. §6.
10. **Pass 4:** `passkeyService.listRegisteredPasskeys()` is never called without a `memberId` outside `removeAllPasskeysForMember` (`:233`) — `PasskeySettings.vue:46` always passes one. **Verified**, so adopted records belonging to another family are not rendered anywhere in the UI.

## Approach

The insight that shapes everything: **the fix is adoption, not deletion.** The Expected behaviour offers two branches ("either recovers the material deliberately or removes it"), and _recovering_ is both the safer branch and the one that satisfies the do-not-break-the-reinstaller requirement. Once a blob is back in the registry, every deletion path the product already advertises reaches it — so the "beyond any code path" property is cured without deleting anything.

Pass 2's shaping principle on top of that: **two new plugin methods, one new internal engine, no new branches.** Every deletion in the JS layer funnels through one reclaim function and one logged delete helper; every failure mode degrades by contributing nothing to a union rather than by taking a fallback path.

Pass 3's shaping principle on top of _that_: **no hidden work in hot paths, no higher-order indirection for a single caller, and no second piece of state where one will do.** Side effects sit at named seams; shared code is shared because it has two callers, not because it might; and every fire-and-forget or awaited call on a login path has an explicit never-throws / time-bounded contract.

Pass 4's shaping principle on top of _that_: **every delete must be provably scoped to something the user asked about, and every "it is gone" must be something the code actually observed.** Concretely: a deletable set carries the family it belongs to (not just an account string); a time budget is spent once per session rather than once per caller; and the one primitive whose failure would silently void the product's strongest promise gets a fallback that uses only long-shipped code.

### 0. Implementation sequence — four independently-green commits

Not a new requirement, a maintainability one: this change touches 13 files and mixes a low-risk truthfulness fix with a design change that depends on an unverified OS behaviour. Land it as four commits, each passing `npm run validate` on its own:

| #   | Commit                                                                                                                                                                       | Depends on                          | Why it stands alone                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Plugin truthfulness (§2) + Android parity + `deleteBlob`/`purgeTargets` replacing the two bare `catch {}` and backing `clearNativeRecord` (§3) + the two stale-comment fixes | —                                   | Pure bug fix on both platforms. Valuable and shippable even if the hardware check in §1 comes back badly. No new capability, no new call sites.                                                   |
| B   | Whole-service sweep (§1 `deleteAllKeys` on both platforms, §7) + docs for it                                                                                                 | A                                   | The destructive primitive plus its fallback, reviewed on its own, alongside the mandatory `dataClearingSecurity.test.ts` mock fix. **Depends only on A** — it needs nothing from the enumeration. |
| C   | Enumeration + parse + adopt-on-resolve + union reclaim (§1 `listAccounts`, §3 wrapper, §4, §5) + ADR/runbook amendments                                                      | A                                   | The core fix. Reviewable as one idea.                                                                                                                                                             |
| D   | Roster reconcile + `memberName` backfill (§6)                                                                                                                                | C (reconcile needs the adopted set) | The only path in the plan that deletes on _inferred_ state. Independently revertable.                                                                                                             |

**Pass 4 — should this be split into more than one change? Yes, and the line is between C and D.** A + B + C deliver requirements 1, 2, 3, 5, 6, 7 and 8 — every security-meaningful one — and every delete in them is either user-initiated (B) or scoped to affirmatively observed accounts for one named family (C). D delivers requirement 4 alone, and it is the only place where a deletion decision rests on a heuristic ("does this roster look complete?") applied to state assembled across families. It is also where this review found the plan's one live-enrolment-deletion defect. **If anything must be cut or deferred to keep the change reviewable, cut D**; requirement 4's real-world gap is narrow (a member removed while the app was uninstalled), the surviving material is biometry-gated, device-local and `ThisDeviceOnly`, and requirement 5 gives the user an explicit route to clear it. D should not be squashed with A–C.

B was moved ahead of C deliberately: the sweep has no dependency on the enumeration, and landing the product's strongest promise first means that if the on-device check in §1 says the enumeration is unusable, A and B still stand and C degrades to "no-op enumeration" — which the union makes safe by construction.

### 1. Plugin: two new methods (`ios/App/App/BiometricKeystorePlugin.swift`)

**`listAccounts`** — query by **service only**:

```swift
kSecClass: kSecClassGenericPassword
kSecAttrService: service
kSecMatchLimit: kSecMatchLimitAll
kSecReturnAttributes: true
kSecUseAuthenticationContext: LAContext()   // interactionNotAllowed = true
// deliberately NO kSecReturnData — attributes are metadata and need no authentication.
// This is what distinguishes this query from hasKey below, which passes NO return key
// at all and therefore gets the item's DATA (and so evaluates the ACL). Do not
// "simplify" by copying hasKey's query shape.
```

Returns `{ accounts: [String] }` from each item's `kSecAttrAccount`. Run on `DispatchQueue.global(qos: .userInitiated)` like `getKey` (`:107`) — it is a keychain IPC round-trip on a rendering login screen — and resolve back on main.

Error handling, explicitly non-silent:

- `errSecSuccess` → the list (skipping any item with no `kSecAttrAccount` string, counted by the caller).
- `errSecItemNotFound` → `{ accounts: [] }`, a legitimate empty result.
- **anything else, including `errSecInteractionNotAllowed`** → `call.reject` with `mapOSStatus(status)`, never an empty list. A caller must be able to distinguish "no items" from "the query failed".

**`deleteAllKeys`** — one `SecItemDelete` over `[kSecClass, kSecAttrService]` with **no account**. This is the explicit clear-all primitive: no authentication, no attribute return, so it cannot miss a gated item. `errSecSuccess`/`errSecItemNotFound` → `resolve({ deleted: status == errSecSuccess })`; anything else → `reject`. Its doc comment must state that `nativeReclaimAllKeystores` is its only permitted caller.

Register **both** in `pluginMethods`.

**Android (`BiometricKeystorePlugin.java`) — `deleteAllKeys` only** (see the ⚠️ caveat; without it, §7 orphans Android material):

```java
@PluginMethod
public void deleteAllKeys(PluginCall call) {
    // The clear-all primitive. Only nativeReclaimAllKeystores may call this.
    // Every key in this prefs file is an account (see setKey) — nothing else is stored here.
    // Copy the key set first — deleteAlias touches the KeyStore, not prefs, but
    // iterating a live SharedPreferences map while editing it is not worth risking.
    for (String account : new java.util.HashSet<>(prefs().getAll().keySet())) {
        deleteAlias(account);
    }
    prefs().edit().clear().apply();
    JSObject ret = new JSObject();
    ret.put("deleted", true);
    call.resolve(ret);
}
```

`deleteAlias` is already best-effort per alias (`:345-355`), which is right here: one dead alias must not abort the sweep. `listAccounts` is **not** added to Android — see the caveat for why it cannot be needed there.

### 2. Plugin: the existing lies, on both platforms

**iOS (`BiometricKeystorePlugin.swift`)**

- **`deleteKey` (`:143`)** — reject with `"unknown"` when `account` is missing/empty (naming the parameter), and **check the `OSStatus`**: `errSecSuccess` or `errSecItemNotFound` → `resolve()`; anything else → `reject(mapOSStatus(status))`. Not-found stays a success so the idempotent call sites keep working without a special case. (Note `mapOSStatus` maps `errSecItemNotFound` → `"invalidated"` (`:159-161`), which is why not-found must be short-circuited _before_ the mapping, not passed through it.)
- **`hasKey` (`:122`)** — reject on a missing/empty `account` instead of resolving `{present: false}`. `nativeUnlock` already treats a `hasKey` throw correctly ("fall through to the real unlock", logged at `warn`, `:332-341`), so this turns a record-deleting false-absent into a logged non-event with no call-site change.
- **`setKey` (`:73`)** — its pre-add `SecItemDelete` result is also discarded, but that one is genuinely advisory (the `SecItemAdd` below is the operation whose status is reported). Leave it, with a one-line comment saying so, so the next reader does not "fix" it into a spurious failure.

**Android (`BiometricKeystorePlugin.java`) — the same two, so the one TS contract is true on both platforms**

- **`deleteKey` (`:206-213`)** — reject `"unknown"` on a missing/empty account instead of resolving.
- **`hasKey` (`:190-204`)** — reject `"unknown"` on a missing/empty account, and reject on a **thrown** `loadKey` failure rather than reporting `present: false`. Keep `present: false` for the genuinely-absent cases (`!prefs().contains(account)`, or `loadKey` returning `null`). Verified safe for the self-heal: a real OS invalidation either removes the alias (→ `containsAlias` false → `getKey` returns `null` → `present: false`) or surfaces at `Cipher.init` as `KeyPermanentlyInvalidatedException`, not at `KeyStore.getKey`. So a _throw_ from `loadKey` is a KeyStore malfunction, and this is exactly the hazard `nativeBiometric.ts:316-319` warns about in prose while the Java code causes it: a transient KeyStore exception currently deletes a live enrolment.

No JS call-site changes result from any of the above.

### 3. JS: one typed wrapper + one logged delete helper, in the file that already owns addressing

`nativeBiometric.ts` is documented as the only module that knows how a keystore account is addressed (`:27-30`, restated in ADR-029 line 161), so the parse belongs there and nowhere else:

```ts
/** A keychain item this device holds. `memberId: null` = the legacy family-wide address. */
interface KeystoreBlob {
  account: string;
  familyId: string;
  memberId: string | null;
  malformed: boolean;
}

/** One thing to remove: the OS blob, and the registry record when there is one. */
interface KeystoreTarget {
  account: string;
  credentialId?: string;
}

/**
 * A blob this session adopted. Deletable by the roster pass — and ONLY ever against the
 * roster of its OWN `familyId`, which is why the family is part of the type and not a
 * caller's assumption. (Pass 4: the Pass-3 design used a bare KeystoreTarget here and
 * would have deleted family B's enrolments against family A's roster.)
 */
interface AdoptedTarget extends KeystoreTarget {
  familyId: string;
  memberId: string;
  credentialId: string;
}

/** Every account under our service, or null when the QUERY FAILED (reported). */
async function listKeystoreBlobs(): Promise<KeystoreBlob[] | null>;
```

Parse: `const i = account.indexOf(':')`; no colon → legacy (`memberId: null`); otherwise `familyId = slice(0, i)`, `memberId = slice(i + 1)`, and `malformed = memberId.includes(':')`. Malformed accounts are **kept** (so family-scoped reclaim still deletes them) but never adopted, and are counted in telemetry — an account we cannot parse is exactly the kind of thing worth seeing in the firehose. The `null` return distinguishes "the query failed" from "there are no items", which is the distinction every caller needs.

A missing method (Android, or a Swift method absent from `pluginMethods`) is detected with the **existing** `isPluginMissing(err)` and logged at `info` with `action: 'enumerate_unsupported'` — deliberately _not_ the `plugin-missing` action at `error` used by `nativeCanEnroll` (`:131-141`), so this cannot pollute the #74 signal. Everything else is a `reportError` at `severity: 'warning'`, `action: 'enumerate_failed'`.

```ts
/** Delete one blob. Returns whether it is provably gone. NEVER silent. */
async function deleteBlob(account: string, action: string): Promise<boolean>;

/**
 * Remove a set of targets: the blob always, the registry record when the target
 * carries a credentialId. Emits ONE summary event (warn if anything survived).
 * Returns how many blobs are provably gone.
 * The ONE implementation of "make this key material go away".
 */
async function purgeTargets(targets: KeystoreTarget[], action: string): Promise<number>;
```

`deleteBlob`'s single `try/catch` with a `warn` `logEvent` (`action`, `error_code: errorCode(err)`) replaces the **two** bare `catch {}` swallows at `:416-418` and `:492-494` and serves every new delete site. Key material that would not delete is now always visible.

**Pass 3 — `purgeTargets` replaces the Pass-2 `reclaimAccounts(match, records, action)` engine.** That engine took a `match` predicate but had exactly **one** caller (`nativeReclaimFamilyKeystore`), so the higher-order parameter bought nothing and cost a reader one extra indirection to trace on the most security-sensitive path in the module. `purgeTargets` is lower-level, has no callback, and has real callers in §5 and §6 — which is what makes it shared code rather than speculative generality. The union logic moves inline into `nativeReclaimFamilyKeystore`, where it is read once next to the thing it decides.

**Pass 4 — `clearNativeRecord` delegates to `purgeTargets`, so there is genuinely one implementation and three callers.** Pass 3 left `clearNativeRecord` (`:475-495`) doing its own "remove the record, then delete the blob" — a second copy of exactly what `purgeTargets` does, on the path (`nativeDisable`, and `nativeUnlock`'s `absent_self_heal`) where a silent failure is most user-visible. Rewrite its tail as `await purgeTargets([{ account, credentialId: nativeCredentialId(familyId, memberId) }], action)`. Consequences, all wanted:

- `purgeTargets` must preserve `clearNativeRecord`'s existing record-removal diagnostic: a `removePasskeyRegistration` failure is caught per target and logged at `warn` with `action: 'remove_registration'` and message `clear_record_failed`, exactly as today (`:480-489`) — _"a record that will not delete means a self-heal that did not heal"_. Losing that signal to a refactor would be a regression.
- Disable/self-heal now emit a purge summary event too (`action: 'disable'` / `'absent_self_heal'`), which is new and free observability on the two paths that had none.
- `purgeTargets` owning the summary emit means **no caller writes a log line for a purge**. §5 and §6 get their counts for free and cannot drift in level or wording.

`purgeTargets` also fixes an ordering hazard rather than documenting one: record removal and blob deletion happen per target, so there is no "which half runs first" question to get wrong, and a failure in one target is counted and does not abort the rest. Record removal stays _before_ the blob delete within a target, matching today's `clearNativeRecord` order, so a partly-failed disable leaves the user in the state the Pass-4 caveat describes (record gone, blob present, re-adopted next session, honest) rather than in a stuck toggle.

### 4. Adopt-on-resolve — the core fix, one bounded pass per app session

One module-level `let adoption: Promise<AdoptionSummary> | null = null` single-flight behind:

```ts
/** Adopt every orphaned blob on this device into the registry. NEVER rejects. */
function ensureKeystoreAdopted(): Promise<AdoptionSummary>;
```

**Pass 3 — where it is called from, and why that changed.** The Pass-2 draft put the call at the top of `nativeResolveDeviceKeys`. But `listNativeRecords` **is** `nativeResolveDeviceKeys` (`:455-457`), and it is called internally by `loadNativeRecord` (from `nativeUnlock` and `clearNativeRecord`) and by the reclaim loop. That would have fired adoption — a keychain IPC plus registry _writes_ — from unlock, from disable, and from inside a reclaim that is about to delete the very records being adopted. Harmless under the union, but a hidden mutation in five implicit places, a latent reentrancy hazard, and a function whose doc comment says "Registry-only (no biometric prompt) because it runs on every family selection and every picker render". So split the read from the entry point:

```ts
/** The registry read + stale-record cleanup. No side effects beyond that cleanup. */
async function readNativeRecords(familyId: string): Promise<PasskeyRegistration[]>; // today's body

export async function nativeResolveDeviceKeys(familyId: string): Promise<PasskeyRegistration[]> {
  // Bounded: the adopted records must be in the registry before the read below, but the
  // family picker mounts at launch and a keychain IPC must never hold its first paint.
  await awaitAdoptionGate();
  return readNativeRecords(familyId);
}
```

**Pass 4 — the time budget is memoized, not re-armed per caller.** Pass 3 wrote `await raceTimeout(ensureKeystoreAdopted(), ADOPTION_BUDGET_MS)` inline at the seam. `FamilyPickerView.loadFamilies()` awaits `resolveDeviceKeysForFamily` once per family **in a sequential `for` loop** (`FamilyPickerView.vue:53-64`), so a hung enumeration would cost `ADOPTION_BUDGET_MS × familyCount` before first paint — 4.5s on a three-family device, which is neither "one render of today's behaviour" nor compatible with requirement 8. Memoize the _raced_ promise so the budget is a per-session total:

```ts
const ADOPTION_BUDGET_MS = 1500; // reasoning in the real comment: keychain IPC is
// single-digit ms in practice; this is the ceiling on
// a pathological device, spent ONCE per session.
let adoption: Promise<AdoptionSummary> | null = null;
let adoptionGate: Promise<void> | null = null;

/** The adoption pass. Single-flight, NEVER rejects. */
function ensureKeystoreAdopted(): Promise<AdoptionSummary> {
  return (adoption ??= runAdoptionPass());
}

/**
 * Wait for adoption — but never for more than ADOPTION_BUDGET_MS in TOTAL per session.
 * The raced promise is memoized, so N callers share one budget instead of arming N
 * timers. On timeout the pass keeps running and later callers see its results.
 */
function awaitAdoptionGate(): Promise<void> {
  return (adoptionGate ??= raceTimeout(ensureKeystoreAdopted(), ADOPTION_BUDGET_MS).then(
    () => undefined
  ));
}
```

- `listNativeRecords` is **deleted**; its internal callers (`loadNativeRecord`, the reclaim path) call `readNativeRecords` directly. One layer of aliasing goes away.
- `awaitAdoptionGate()` is additionally awaited at the top of `nativeUnlock`, the one other place where a missing adopted record produces a _wrong answer_ (a spurious `MEMBER_MISMATCH`). **Pass 4: the gate, not the raw single-flight.** Pass 3 awaited `ensureKeystoreAdopted()` unbounded there; a hung `listAccounts` would then wedge the unlock button indefinitely, which is precisely the 0.9.5R3 "verifying" freeze `raceTimeout` exists to prevent. Bounded is strictly better: in the normal flow `resolveDeviceKeys` has already run so the gate is already settled and the call is free, and in the pathological case the degrade is `MEMBER_MISMATCH` → password, which is exactly today's outcome for an un-adopted blob.
- **Two explicit, documented seams** instead of five implicit ones; no adoption during reclaim; no possibility of a future refactor introducing recursion through the single-flight.
- **`ensureKeystoreAdopted` never rejects.** That single contract is what makes `awaitAdoptionGate` safe (no unhandled rejection from the un-awaited tail) and what makes §6's `void` call safe. It is stated in the doc comment and pinned by a test.

The pass itself, once per session, for every family at once:

1. `listKeystoreBlobs()` → `null` (failed/unsupported) or the list. `null` or `[]` → an empty summary, nothing to do.
2. `passkeyRepo.getAllPasskeys()` → the set of `credentialId`s already known. A read failure here aborts adoption (logged), leaving today's behaviour exactly as it is.
3. For each blob with a `memberId`, not malformed, whose `native:${familyId}:${memberId}` credentialId is absent → `savePasskeyRegistration` a `native-keystore` record. Each write is individually caught and counted — one bad write must not abandon the rest. (Note: `nativeCredentialId` does not encode the scheme, so an existing _legacy_-scheme record for that member suppresses adoption of their per-member blob. Correct and harmless — the union in §5 still reaches that blob.)
4. Return (and remember) an `AdoptionSummary`: `enumerated`, `adopted`, `registered`, `legacy`, `malformed`, plus `adoptedTargets: AdoptedTarget[]` for §6.

**Pass 3 — one record factory, not two record literals.** Adoption's `PasskeyRegistration` would be a near-copy of `nativeEnable`'s (`:226-237`); a future required field added to one and not the other is a silent half-record. Extract:

```ts
/** The ONE shape of a device-local native-keystore record. */
function nativeRecord(p: {
  familyId: string;
  memberId: string;
  memberName?: string;
  label: string;
}): PasskeyRegistration;
```

pinning `publicKey: ''`, `prfSupported: false`, `mechanism: 'native-keystore'`, `keystoreScheme: 'per-member'`, `createdAt: toISODateString(new Date())`, and deriving `credentialId` from `nativeCredentialId(familyId, memberId)`. `nativeEnable` and adoption both call it. Adoption passes `memberName: undefined` and `label: `${guessAuthenticatorLabel()} · ${idTail(memberId)}``.

**Why one all-families pass rather than per-family** (the Pass-2 change, unchanged): a per-family adoption would fire a fresh enumeration per record per operation, and one per family per `FamilyPickerView` render (`src/components/login/FamilyPickerView.vue:53-64` loops every family in `onMounted`). A single session-scoped pass makes the cost exactly one enumeration + one `getAllPasskeys()` for the whole session, requires no per-family bookkeeping, satisfies requirement 8, and adopts a second family's blobs too — which makes _their_ family's own reclaim path reach them as well. Adoption is non-destructive, so the "more than one family" caveat is not violated — **and §6 is the place where that all-families scope must be re-narrowed, which is what `AdoptedTarget.familyId` exists for.** `getPasskeysByMember` is the only cross-family read a view performs (`PasskeySettings.vue:46`, always member-scoped; verified there is no `listRegisteredPasskeys()` call without a member id), so an adopted record for another family is not visible anywhere in the UI.

The existing registry-read failure path (now inside `readNativeRecords`, `:167-180`) stays exactly as it is: a broken registry read already degrades to "no keys" and logs rather than looking like "nothing enrolled" (the ambiguity that hid #74). Adoption is additive and must not change that.

**Known, bounded display consequence.** After a reinstall the roster cache is gone too, so `src/composables/useLoginFlow.ts:286-299` (fallback 3) renders the picker from these records as `k.memberName || k.label`. Adopted records have no `memberName` — nothing on the device knows it — so they render as the device label. With two adopted members that is two identical cards. Mitigations, both cheap and both reusing existing code: the adopted `label` is suffixed with the existing private `idTail(memberId)` so the cards are distinguishable and honest, and §6 backfills the real `memberName` via the existing `updatePasskey` the moment the roster is known, so the ugly label is seen at most once per reinstall. Add one line to `idTail`'s doc comment (`:446-449`) noting it is now **also** a UI disambiguator, so nobody shortens it for telemetry reasons and silently changes a rendered string. `models.ts:95-105` says `memberName` is "deliberately NOT reconciled" — filling an _absent_ name is not reconciling a stale one; add one clarifying line there rather than leaving the comment contradicted. _(If D is deferred per §0, adopted records keep the `idTail` label until that member re-enrols — acceptable, and the only user-visible cost of deferring.)_

**Session state and tests.** The single-flight, the gate and `adoptedTargets` are module-level mutable state, which does not reset between cases in a single test file. Export `__resetKeystoreSessionForTests()` following the established house convention (`usePinAttemptLimit.ts:173` `__resetPinAttemptsForTests`, `useEscapeClose`, `useWallRowEdit`) and call it from the existing `beforeEach`, rather than restructuring the 394-line test file around `vi.resetModules()`.

### 5. Reclaim: one union, computed in place — closes all three deletion paths at once

`nativeReclaimFamilyKeystore(familyId)` currently iterates registry records. Replace the body with the union, computed where it is read:

```ts
export async function nativeReclaimFamilyKeystore(familyId: string): Promise<void> {
  const blobs = await listKeystoreBlobs(); // null on failure → contributes nothing
  const records = await readNativeRecords(familyId);
  const byAccount = new Map<string, KeystoreTarget>();

  for (const b of blobs ?? []) {
    if (b.familyId === familyId) byAccount.set(b.account, { account: b.account });
  }
  for (const r of records) {
    const account = recordAccount(familyId, r);
    byAccount.set(account, { account, credentialId: nativeCredentialId(familyId, r.memberId) });
  }
  byAccount.set(legacyKeystoreAccount(familyId), { account: legacyKeystoreAccount(familyId) });

  await purgeTargets([...byAccount.values()], 'reclaim'); // purgeTargets owns the event
}
```

Note the `Map`-keyed-by-account: a blob the registry also knows about is one target, and the record-derived entry wins so its `credentialId` is not lost. Note also that the blob loop is filtered by `familyId` — `nativeReclaimFamilyKeystore` never touches another family's material, which is what lets `deleteLocalFamily` keep its name honest.

**The union is the whole trick, and it is why the Pass-1 "if the enumeration rejects, fall back to registry-driven behaviour" guard is deleted rather than implemented.** A failed or empty enumeration contributes zero members to the union, which _is_ the fallback — expressed as data, with one code path, nothing to forget, and behaviour that is monotonically ≥ today's on every platform including Android. It also fixes the converse hole the Pass-1 draft would have opened: a purely keychain-driven reclaim would stop removing registry records whose blob is already gone (OS-invalidated), leaving dead records that render as dead buttons on the chooser.

**Pass 4 — reclaim performs its own enumeration, by design, and that is not a violation of "one enumeration per session".** The adoption single-flight is memoized; reclaim is not, and must not be: reusing a session-old list could miss a blob written since, and reclaim is a rare, user-initiated or invalidation-driven path where a second keychain IPC costs nothing. The Pass-3 acceptance criterion "exactly one `listAccounts` call per app session … asserted to be zero additional calls across `nativeUnlock` / `nativeDisable` / `nativeReclaimFamilyKeystore`" flatly contradicted this snippet and is corrected in Acceptance Criteria: what must be asserted is **at most one _adoption_ enumeration per session**, and that `nativeDisable`/`clearNativeRecord` trigger **no** enumeration at all.

**Pass 4 — reviewed and accepted: this widens the blast radius of `nativeUnlock`'s `invalidated` self-heal (`:365-371`).** That path calls `nativeReclaimFamilyKeystore(familyId)`, which now also deletes enumerated blobs for the family that have no registry record (orphans, and malformed accounts whose prefix is this familyId). That is consistent with the documented intent — _"a genuine OS invalidation is DEVICE-wide … every native record for this family is equally dead"_ — and with assumption 2's conservative reading of a malformed account. It is called out here so it is a decision on the record rather than an emergent surprise; note that iOS maps `errSecAuthFailed` and `errSecItemNotFound` to `invalidated` (`:159-164`), so this path is reachable from a transient auth failure, and it is family-scoped in every case.

Because `nativeBiometric.ts` declares itself the sole reclaim route, this one function fixes `authStore`'s clear-all-data, `familyContext`'s `deleteLocalFamily`, and the OS-invalidation path together. **No call-site changes.** Note that it no longer routes through `clearNativeRecord` → `loadNativeRecord`, so the reclaim loop stops doing a registry read per record.

`familyContext.ts:156-159` carries a load-bearing "this MUST run before the registry records are deleted" comment. It is still true (records are one half of the union) but no longer catastrophic — amend it in the same edit to say the keychain enumeration now covers the per-member addresses independently, so a future reorder degrades rather than orphans. A comment that overstates its own stakes is how the next person reasons wrongly.

### 6. Roster reconcile — requirement 4, deliberately narrow, one piece of state

Hooked to the **existing** roster watcher in `familyStore.ts:117-119`, which already fires "the roster is known / changed" once per mutation and already drives `refreshRosterCache(list)`. One added line:

```ts
watch(sortedMembers, (list) => {
  void refreshRosterCache(list);
  // Pass 4: the signed-in member is passed IN. passkeyService must not import a store —
  // authStore.ts:13 statically imports resolveDeviceKeys from it, so the reverse edge is
  // a real import cycle.
  void reconcileDeviceKeysWithRoster(
    list.map((m) => m.id),
    currentMember.value?.id ?? null
  );
});
```

delegated through `passkeyService` (the `isNative()` seam, where `getActiveFamilyId()` is resolved so neither the store nor `nativeBiometric` learns about the other). Pets are _included_ in the id list: it is a superset, and a superset can only ever protect a blob.

**Pass 3 — the new function is modelled on `refreshRosterCache`, its own sibling in that watcher** (`src/services/auth/rosterCache.ts:41-74`), not on a new shape:

- **It never throws.** `void`-ing a promise in a Vue watcher with no `.catch` is an unhandled rejection with no owner; `refreshRosterCache` avoids that with one internal `try/catch` + one diagnostic event, and so does this. Pinned by a test that makes the repo throw and asserts the watcher-facing call resolves.
- **It resolves the active family itself** (via `getActiveFamilyId()`, the same import `rosterCache.ts:15` uses — no store dependency) and drops the pass if the active family has changed since it started — the same TOCTOU guard, for the same reason (a late family-A mutation landing after a switch to B must not delete B's material, or A's under B's id).
- **It no-ops on an empty list.**

The reconcile is **tightly bounded**, because a roster-driven delete on a partially-painted roster would destroy live keys. Pass 3 collapses Pass 2's five separate guards plus a `reconcileDone` flag into **one piece of state and one predicate**; Pass 4 makes that state family-scoped, which is the fix for the cross-family deletion defect:

- **One piece of state, drained per family:** the reconcile _drains_ the session's adopted targets **for the active family only** — `takeAdoptedTargets(familyId)` returns that family's `AdoptedTarget[]` and removes them from the session set, leaving other families' entries untouched for whenever (if ever) they become active. An empty result therefore means "nothing was adopted for this family" **and** "this family was already reconciled" — the two conditions that previously needed a set plus a boolean now need neither to be kept in sync. There is no second flag to forget to set, and no ordering between them to get wrong.
- **⚠️ Why the family scope is non-negotiable:** adoption is all-families (§4). Draining the whole set and testing it against the active family's roster deletes every other family's adopted enrolment, because their member ids are of course not in this family's roster. That was the Pass-3 behaviour. `takeAdoptedTargets(familyId)` plus `AdoptedTarget.familyId` makes the wrong version unwritable rather than merely undocumented.
- **One predicate,** written with early returns and no nesting:
  ```ts
  /** Cheap proof this is a real decrypted roster and not a partial paint. */
  function rosterLooksComplete(memberIds: string[], signedInMemberId: string | null): boolean {
    if (memberIds.length === 0) return false;
    if (!signedInMemberId) return false;
    return memberIds.includes(signedInMemberId);
  }
  ```
- **Only this family's adopted set is ever deletable here.** A blob that was legitimately registered before this session can never be deleted by this path, and neither can another family's. This is the only scenario requirement 4 actually needs: `familyStore.invalidateDeviceCredentials` → `passkeyService.removeAllPasskeysForMember` (`:232`) already retires a member's credentials at removal time, so the sole gap is a member removed _while the app was uninstalled_.
- Deletes go through `purgeTargets(gone, 'roster_reconcile')` — the same helper §3/§5 use, so "make this key material go away" has one implementation and one summary event. An enumeration failure means there is no adopted set, so nothing happens.
- Same pass, non-destructive half: for every adopted target of this family whose member **is** in the roster and whose record has no `memberName`, `updatePasskey(credentialId, { memberName })` — the §4 display fix, reusing the existing repo function.

Scoped tightly: this plan makes the material _reachable_; the wider semantics of revoking a removed member's access on **their** devices remain #77 (as `passkeyService.ts:222-231` already documents).

### 7. Explicit clear-all-data sweeps the whole service — requirement 5, and the residue answer

New `nativeReclaimAllKeystores(familyIds: string[])` → `BiometricKeystore.deleteAllKeys()`, exposed through `passkeyService.reclaimAllKeystores(familyIds)` (the `isNative()` guard, one place — `passkeyService.ts:208` is the existing precedent). With §1 implementing `deleteAllKeys` on **both** platforms, the happy path needs no platform branch and no enumeration.

```ts
/**
 * The explicit clear-all primitive: remove EVERY blob for our service on this device.
 * Sole permitted caller of BiometricKeystore.deleteAllKeys().
 *
 * `familyIds` is a defence-in-depth fallback list, not the mechanism: if the sweep is
 * unavailable (a Swift method missing from `pluginMethods` — #74, twice) or fails, we
 * must not report a clean device while every blob survives. The fallback uses only the
 * long-shipped `deleteKey`, via the union reclaim, so it is >= today's behaviour.
 */
export async function nativeReclaimAllKeystores(familyIds: string[]): Promise<void> {
  try {
    await BiometricKeystore.deleteAllKeys();
    // one `info` logEvent, action: 'sweep'
    return;
  } catch (err) {
    reportError({/* severity: 'warning', action: 'sweep_failed', error_code, detail */});
  }
  for (const id of familyIds) await nativeReclaimFamilyKeystore(id); // >= today
}
```

`authStore.ts:2501-2517`'s `reclaimAllPasskeys` step is **simplified, not extended**. Today it loops `getAllFamilies()` and calls `reclaimFamilyKeystore(family.id)` per family — which after a reinstall iterates an empty family registry and reclaims nothing, and even with a populated one misses records for families absent from the registry. Replace with:

1. `const passkeys = await getAllPasskeys()` — one registry read, no per-family fan-out.
2. `await reclaimAllKeystores([...new Set(passkeys.map((p) => p.familyId))])` — one sweep call, outside any loop, with the registry-derived fallback list.
3. `removePasskeyRegistration` each → one `signalCredentialsRemoved(allCredentialIds)`.

That is strictly fewer lines than the current loop, strictly more complete, and it drops the per-family `getPasskeysByFamily` fan-out and the `getAllFamilies()` import entirely. **Pass 4 correction to the Pass-3 wording:** Pass 3 said "the order of these two steps is not load-bearing". With the fallback, the accurate statement — and the one that belongs in the comment — is: _the registry **read** must precede the record deletion (it is the fallback's only source of family ids); the sweep itself needs no registry, so the class of bug `familyContext.ts:156-159` warns about cannot exist on the happy path._ Write that, not a vaguer "order doesn't matter", and not a scarier warning than is true. This is user-initiated, so it cannot break a reinstaller who has not yet signed in, and it gives a deterministic way to remove material for a family this device will never open again.

> ⚠️ **`src/stores/__tests__/dataClearingSecurity.test.ts:142-145` mocks `@/services/sync/capabilities` with only `getSyncCapabilities`/`canAutoSync`.** `passkeyService` imports `isNative` from that module and `nativeBiometric` imports `getPlatform`. Today the gap is invisible because the families loop is empty (the mocked registry DB returns `[]`), so `reclaimFamilyKeystore` is never reached. Moving the call **outside** the loop reaches it, `isNative` is `undefined`, and the step throws (caught and reported by `runSignOutSteps`, so the suite stays green while the most security-critical clear step silently fails). Fix it **in the same commit** — and **Pass 4: fix it with the spread-the-original pattern the same file already uses for `fileSync` (`:147`), not by enumerating the two missing names:**
>
> ```ts
> vi.mock('@/services/sync/capabilities', async (importOriginal) => ({
>   ...(await importOriginal<typeof import('@/services/sync/capabilities')>()),
>   getSyncCapabilities: () => ({ hasFileSystemAccess: true }),
>   canAutoSync: () => true,
> }));
> ```
>
> `capabilities.ts` exports 14 functions; an enumerated mock goes stale the next time this graph reaches a fifteenth. The spread cannot. (`isNative()`/`getPlatform()` then return their real jsdom answers — `false`/`'web'` — which is what the test wants.)

**Which answers the open question.** For a user who reinstalls and never signs in again, their own old blobs persist. That is accepted, on three grounds: sweeping before sign-in would delete a legitimate reinstaller's key and break requirement 2; the material is biometry-gated, device-local and `ThisDeviceOnly` (so it cannot be restored onto another device); and requirement 5 gives the user an explicit route to clear it. The Expected criterion ("no key blob the app cannot enumerate") is met the moment the enumerate capability exists, independently of whether a sweep runs.

## Files Affected

**Modified**

- `ios/App/App/BiometricKeystorePlugin.swift` — add `listAccounts` + `deleteAllKeys` (**and register both in `pluginMethods`**), with `listAccounts` carrying the Pass-4 comment on why its query shape differs from `hasKey`'s; `deleteKey` checks its `OSStatus` and rejects on a missing account; `hasKey` rejects on a missing account; one comment on `setKey`'s advisory pre-delete
- `android/app/src/main/java/family/beanies/app/BiometricKeystorePlugin.java` — **Pass 3, moved from "Not modified"**: add `deleteAllKeys` (required — without it §7 orphans Android material on clear-all, see the ⚠️ caveat); `deleteKey` (`:206`) and `hasKey` (`:190`) reject on a missing account; `hasKey` rejects on a thrown `loadKey` failure instead of reporting absence (the hazard `nativeBiometric.ts:316-319` already documents). `listAccounts` deliberately **not** added — Android's blobs and registry die together, so there is nothing to enumerate back
- `src/services/auth/biometricKeystorePlugin.ts` — the two new methods on the `BiometricKeystorePlugin` interface + doc comments, including which method may call `deleteAllKeys` and that `listAccounts` is iOS-only _(corrections: the Pass-1 draft named a `src/services/auth/nativeBiometric.d.ts`; no such file exists — the plugin's TS contract lives here, and the "all methods reject with a typed error" promise is at `:18-20`, not `:118-120`)_
- `src/services/auth/nativeBiometric.ts` — `listKeystoreBlobs` + parse; `deleteBlob` + `purgeTargets` (replacing the two bare `catch {}`, owning the purge summary event, and now backing `clearNativeRecord` too); `nativeRecord` factory shared with `nativeEnable`; `ensureKeystoreAdopted` single-flight (never rejects) + memoized `awaitAdoptionGate` + `takeAdoptedTargets(familyId)`; `readNativeRecords` split out of `nativeResolveDeviceKeys` and `listNativeRecords` deleted; `nativeResolveDeviceKeys` and `nativeUnlock` both await the gate; `nativeReclaimFamilyKeystore` rewritten onto the inline union + `purgeTargets`; `nativeReclaimAllKeystores(familyIds)` with its fallback; `nativeReconcileRoster`; `__resetKeystoreSessionForTests`; one line on `idTail`'s comment; **the stale legacy-re-home lines in `nativeUnlock`'s doc comment (`:283-290`) corrected**; module header amended (the keychain is the durable index; the new entry points; the two adoption seams)
- `src/services/auth/passkeyService.ts` — `reclaimAllKeystores(familyIds)` and `reconcileDeviceKeysWithRoster(memberIds, signedInMemberId)` behind the existing `isNative()` seam, so no caller learns about the keychain; `reconcileDeviceKeysWithRoster` resolves the active family via `getActiveFamilyId()`, guards TOCTOU, and **never throws** (modelled on `rosterCache.refreshRosterCache`). **No store import** — see assumption 9
- `src/stores/authStore.ts` — `reclaimAllPasskeys` step simplified onto `getAllPasskeys` + the whole-service sweep with its registry-derived fallback list, with a comment stating precisely which ordering is load-bearing and which is not
- `src/stores/familyStore.ts` — one line in the existing roster watcher (`:117`), passing `currentMember.value?.id ?? null`
- `src/services/familyContext.ts` — amend the `deleteLocalFamily` ordering comment (`:156-159`)
- `src/types/models.ts` — one clarifying line on `memberName` (`:95-105`): absent names are backfilled once the roster is known; present names are still never reconciled
- `docs/adr/029-capacitor-native-app-store-distribution.md` — **AMENDED** block (the file's established convention, cf. the 2026-08-27 amendment). **Line 161's invariant is what this plan changes** — verified: _"`nativeBiometric.ts` is the only module permitted to construct a keystore account string … Other modules reclaim storage via `nativeReclaimFamilyKeystore(familyId)`"_. Record that the keychain, not IndexedDB, is the durable index of key material; that reclaim is union-driven; that clear-all sweeps the service on both platforms (with a `deleteKey`-only fallback); and that `nativeBiometric.ts` remains the sole owner of account addressing (including the new parser)
- `docs/runbooks/native-store-submission.md` — one-line prose amendment to the Diagnostics row (`:36`) (no new context keys, but the row enumerates _what_ is collected and now includes keystore reconcile counts)
- `src/stores/__tests__/dataClearingSecurity.test.ts` — the `capabilities` mock fix via `importOriginal` spread (mandatory) + the new guarantee pinned alongside the existing clearing assertions
- `src/services/auth/__tests__/nativeBiometric.test.ts` — **Pass 3, two mock gaps not one**: extend the hoisted _plugin_ mock (`:5-13`) with `listAccounts`/`deleteAllKeys`, **and** extend the _repo_ mock (`:17-29`, which today has only `getPasskeysByFamily`/`savePasskeyRegistration`/`removePasskeyRegistration`) with `getAllPasskeys`/`updatePasskey`. Adoption now runs from a seam every existing case reaches; a missing method on a plain object double is a `TypeError`, which `isPluginMissing()` does **not** match, so every existing test would emit an `enumerate_failed` `reportError` and the cases asserting no report would fail. Also call `__resetKeystoreSessionForTests()` in the existing `beforeEach`. Then the new cases: adoption, parse, union-reclaim, sweep + sweep fallback, roster reconcile (including the cross-family case), non-silent-failure, and the single-flight/never-rejects/one-shared-budget contracts

**Not modified**

- `infrastructure/lambda/telemetry/index.mjs` — no new context keys (`action`, `count`, `detail`, `error_code` are all already in its allowlist, verified against `src/utils/diagnosticContext.ts:68,69,188,321` by `src/utils/__tests__/telemetryAllowlistDrift.test.ts`)
- The Share Extension and app-group storage — verified untouched by design (`grep -rn SecItem ios/` hits only `BiometricKeystorePlugin.swift`)
- `scripts/check-ios-sources.mjs` — no new Swift file
- `src/services/auth/rosterCache.ts` — the precedent the new roster hook copies, not a thing it changes
- `src/services/auth/signOutSteps.ts` — `reclaimAllPasskeys` keeps its name, tier and position (`:104`, `SIGN_OUT_CLEAR_STEPS`); only the impl in `authStore` changes

## Observability Coverage

**Surface: the existing `native-biometric`** (`SURFACE`, `nativeBiometric.ts:57`) — _not_ a new `keystore-reconcile` surface. Pass-2 change: the module already owns one surface constant, `src/utils/diagnosticContext.ts` (the `key_backing` block, `:195-200`) documents the convention for this exact surface ("Outcome rides the existing `action` key; the rest reuse os/error_code/detail"), and a second surface would split one stream in two for CloudWatch queries and require a new runbook/declaration row. Outcomes ride `action`.

| Level                                         | When                                                                                                    | Context                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `info`, or `warn` when `adopted > 0`          | the one-per-session adoption pass completes — **one event, level computed**                             | `action: 'adopt'`, `count` = blobs enumerated, `detail` = `formatAdoptionDetail(summary)`                                                                     |
| `info`                                        | `enumerate` is unavailable (missing method / Android)                                                   | `action: 'enumerate_unsupported'`, `error_code` — deliberately NOT the `plugin-missing`/`error` pair used by `nativeCanEnroll`, so the #74 signal stays clean |
| `error` via `reportError`, severity `warning` | the enumeration query rejects                                                                           | `action: 'enumerate_failed'`, `error_code`, `detail` — names the degraded (union) behaviour                                                                   |
| `info`, or `warn` when any target survived    | **every** purge completes — emitted by `purgeTargets`, so no caller writes this                         | `action: 'reclaim' \| 'roster_reconcile' \| 'disable' \| 'absent_self_heal'`, `count` = blobs provably gone, `detail` = `formatPurgeDetail(targets, deleted)` |
| `warn`                                        | a blob delete failed (`deleteBlob`)                                                                     | `action` = the caller's, `error_code` — key material that would not delete                                                                                    |
| `warn`                                        | a registry record would not delete (preserved from `clearNativeRecord`)                                 | message `clear_record_failed`, `action: 'remove_registration'`, `detail`                                                                                      |
| `info`                                        | the whole-service sweep succeeded                                                                       | `action: 'sweep'`                                                                                                                                             |
| `error` via `reportError`, severity `warning` | **Pass 4:** the whole-service sweep rejected (missing/failing `deleteAllKeys`) — the fallback then runs | `action: 'sweep_failed'`, `error_code`, `detail`                                                                                                              |
| `warn`                                        | the adoption pass's own registry read failed, so adoption is skipped this session                       | `action: 'adopt_registry_read_failed'`, `detail`                                                                                                              |
| `warn`                                        | one adoption write failed — counted, and the rest of the device still processed                         | `action: 'adopt_write_failed'`, `detail`                                                                                                                      |
| `error` via `reportError`, severity `warning` | the adoption pass threw despite its internal handling (a bug, not an expected condition)                | `action: 'adopt_failed'`, `detail`                                                                                                                            |
| `warn`                                        | a `memberName` backfill failed — cosmetic, so the pass continues                                        | `action: 'roster_backfill_failed'`, `detail`                                                                                                                  |
| `warn`                                        | the roster reconcile threw — the never-throws backstop for the `void`-ed watcher                        | `action: 'roster_reconcile_failed'`, `detail`                                                                                                                 |

**Pass 3 — one `adopt` event, not two.** The Pass-2 table listed an `info` row and a `warn` row for the same pass, which reads as two emissions for one fact: a CloudWatch count of adoption passes would then double-count the interesting ones. Emit once with `level: summary.adopted > 0 ? 'warn' : 'info'`.

**Pass 3 — `detail` is built by exactly one function.** `formatAdoptionDetail(summary)` returns `adopted=N,registered=N,legacy=N,malformed=N`, and a unit test pins the exact string. An ad-hoc template literal in the emit site is a hand-encoded structure inside a free-text field: the moment someone reorders or renames a label, every saved CloudWatch query built on it silently returns nothing. One function, one test, one place to change deliberately. **Pass 4 adds the second and last such formatter, `formatPurgeDetail` (`targets=N,failed=M`), for the same reason and pinned the same way** — and because it lives inside `purgeTargets` there is exactly one emit site for all four purge actions.

**Failure modes covered**

- _Enumeration silently excludes gated items_ (the 0.13R2 class): the `adopt` event carries the enumerated count and the registered count **in the same event**, so `count=0, registered>0` is a **self-proving contradiction** — records exist, therefore blobs must exist, therefore the query is lying. That is a per-device invariant visible in one log line, not a fleet-wide count that has to be eyeballed. Requirement 5 is independently immune (service-wide delete, both platforms, plus the fallback).
- _Adoption is happening in the field_: `adopted>0` at `warn` quantifies how many real families hit the reinstall path, which the tracker row currently only assumes.
- _The query is broken rather than empty_: distinct `enumerate_failed` report with a code, never an empty success — and the union means "broken" degrades to today's behaviour rather than to silence.
- _An account we cannot parse_: counted as `malformed`, so a future address-scheme change cannot pass unnoticed.
- _A delete that did not delete_: newly observable at four layers — plugin status check, `deleteBlob` warn, `formatPurgeDetail`'s `failed=M`, and the purge `count`.
- _**Pass 4 — a clear-all that cleared nothing**_: `sweep_failed` at `reportError`, followed by the fallback's own `reclaim` purge events. Previously (and in the Pass-3 draft) this was a caught step failure in `runSignOutSteps` with no statement of what survived.
- _The adoption pass exceeded its budget_: no separate event — the `adopt` event still fires when the pass completes, just after the render that raced it. A device where it routinely never arrives is visible as a missing success-path signal.
- No bare `catch {}` is left in the touched code. The two existing swallows around `deleteKey` are replaced by `deleteBlob`; the remaining best-effort swallow in `readNativeRecords`'s stale-record cleanup (`:186-188`) is out of scope and unchanged.

**Success-path signal** — the `adopt` `info` event fires **at most** once per session on native including the all-clean case, so the adoption _rate_ is computable rather than only its incidents. (Pass 4: "at most", not "exactly" — see the lazy-adoption caveat; a device with no registered family never reaches the seam.) No duration is recorded, so `TELEMETRY_FLOOR_MS` does not apply.

**Critical vs telemetry** — nothing here is `severity: 'critical'`. No user action fails and no data is at risk; the worst outcome is degrading to today's behaviour. Firehose only, no Slack page.

**Privacy / store gate** — **no new context keys.** `action`, `error_code`, `detail` and `count` are already in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:68,69,188,321`) _and_ already in the Lambda's mirrored allowlist, with `telemetryAllowlistDrift.test.ts` asserting set equality between the two — so no Lambda code change and no pinned-test change. Family and member ids never ship; the counts in `detail` are integers under fixed labels, capped well under `MAX_STRING_LEN`. ⚠️ `docs/STATUS.md` (the 2026-07-14 session-3/session-4 blocks, ~`:533-536`) records that the **deployed** telemetry Lambda may predate the `native-biometric`/`key_backing` keys — confirm (and terraform-apply if needed) **before** trusting the field signal, or the whole reconcile stream is stripped after leaving the device, silently.

> **CORRECTED DURING IMPLEMENTATION (2026-09-15).** Two defects in this plan were found while
> building it and fixed in the code rather than shipped:
>
> 1. **§5's reclaim snippet would have orphaned a legacy-scheme record.** It set the bare legacy
>    target into the account-keyed Map unconditionally, AFTER the record loop. A legacy-SCHEME
>    record's own account IS the bare familyId, so that overwrote the record-derived entry, dropped
>    its `credentialId`, and left a registry record pointing at a blob that had just been deleted —
>    a dead button on the chooser. The legacy target is now added only when the account is absent.
> 2. **§6's `reconcileDeviceKeysWithRoster(memberIds, …)` signature could not do §4's `memberName`
>    backfill**, which needs names. It takes `RosterMemberRef { id, name }[]`. Consequence, not
>    stated in the plan: member names now cross from the store into the auth service layer. They are
>    only ever written to `PasskeyRegistration.memberName` (the same privacy class, never synced,
>    never logged) and never reach telemetry.
>
> Also: the ADR and runbook amendments landed in commit C rather than B, and `takeAdoptedTargets` is
> module-private (the per-family drain is asserted through `nativeReconcileRoster`, which is the only
> path permitted to call it).

## Acceptance Criteria

- [ ] Reproduced on a physical iPhone/iPad before the fix: enrol biometric unlock, delete the app, reinstall, and confirm the keychain item survives while the app reports no enrolments
- [ ] The enumeration query is confirmed on hardware to return access-controlled items **without prompting**; if it rejects instead, the `enumerate_failed` path is exercised, the union keeps reclaim at today's behaviour, and the finding is recorded in the plan
- [ ] No Face ID prompt ever appears on the family picker / login screen as a result of this change
- [ ] After a delete-and-reinstall, signing in adopts the surviving blobs and biometric unlock works again without re-enrolment
- [ ] After adoption, `clear all data` removes the adopted blobs — verified by a second enumeration returning empty
- [ ] `clear all data` removes items for a family other than the one signed in, **and** with `listAccounts` forced to reject (requirement 5 does not depend on enumeration)
- [ ] **Pass 4 —** with `deleteAllKeys` forced to reject (simulating the #74 unregistered-method class), `clear all data` still deletes every blob the registry knows about via the fallback, and emits `sweep_failed`; it never reports a clean device having deleted nothing
- [ ] **On Android**, `clear all data` still removes the keystore alias and the SharedPreferences blob for every enrolled member (the regression §7 would otherwise introduce), verified on device or emulator
- [ ] `nativeReclaimFamilyKeystore` deletes a blob that has no registry record, **and** still removes a registry record whose blob is already gone, **and** never touches an account belonging to another family
- [ ] A member absent from the live roster has no surviving blob once the roster is known; a member _present_ in the roster keeps theirs across repeated roster mutations
- [ ] **Pass 4 — the cross-family case: with blobs adopted for families A and B and family A signed in, A's roster arriving deletes nothing belonging to B**, and B's biometric unlock still works after switching to B. Asserted in a unit test; this is the defect the Pass-3 design contained
- [ ] Adopted records show a distinguishable label on the first post-reinstall picker, and the real member name after the pod opens
- [ ] `deleteKey` with no account rejects rather than resolving; `deleteKey` on a failing OS delete rejects; `deleteKey` on a missing item still resolves — **asserted for both plugins**
- [ ] `hasKey` with no account rejects, and `nativeUnlock` does not delete the record as a result; on Android a thrown `loadKey` failure rejects rather than reporting absence, and a genuinely absent key still reports `present: false` so the self-heal keeps working
- [ ] An empty or rejected enumeration never causes a deletion
- [ ] **Pass 4 (replaces the Pass-3 wording, which contradicted §5):** at most **one adoption enumeration** per app session — asserted over a multi-family `FamilyPickerView`-shaped sequence of `resolveDeviceKeys` calls plus a `nativeUnlock`; and **zero** enumerations triggered by `nativeDisable` / `clearNativeRecord`. `nativeReclaimFamilyKeystore` enumerating once per call is asserted as intended behaviour, not a violation
- [ ] **Pass 4:** with a never-resolving `listAccounts` and three families, `FamilyPickerView`'s sequence of `resolveDeviceKeys` calls completes within **one** `ADOPTION_BUDGET_MS`, not three — the shared-gate contract
- [ ] The family picker's first paint is never blocked by the adoption pass for longer than `ADOPTION_BUDGET_MS` in total, and a hung enumeration still yields a usable picker; `nativeUnlock` likewise never hangs on a hung enumeration
- [ ] `ensureKeystoreAdopted()` never rejects, and `reconcileDeviceKeysWithRoster()` never rejects — both asserted with a throwing repo/plugin
- [ ] Both new iOS methods appear in Swift `pluginMethods`; a deliberate removal makes the JS take the `enumerate_unsupported` path rather than the `plugin-missing` path
- [ ] **Pass 4:** a failed `deleteKey` during `nativeDisable` is reported (not swallowed), and the following session re-adopts that blob — pinned as the documented, honest consequence rather than discovered later as a bug report
- [ ] Diagnostic events fire with the stated actions on the existing `native-biometric` surface, exactly one `adopt` event per pass and one purge summary per `purgeTargets` call, and no new key is added to `ALLOWED_CONTEXT_KEYS`
- [ ] Cold start is not measurably slower
- [ ] `npm run validate` green **at each of the four commit boundaries in §0**; `dataClearingSecurity.test.ts` carries the new assertions **and** the `importOriginal`-spread `capabilities` mock; `nativeBiometric.test.ts` carries the extended plugin **and** repo mocks

## Testing Plan

1. **On device, before any code** — reproduce the orphan. Not optional; the behaviour has not been measured since 2026-09-01.
2. **On device** — confirm the enumeration's prompt behaviour and whether gated items are included. Record the answer in the plan either way; nothing is blocked on it.
3. **Unit — parse:** per-member, legacy, malformed (`a:b:c`), empty string. Malformed is reclaimable (under the family before the first colon) but never adopted.
4. **Unit — adoption:** adopts only unknown per-member accounts; never adopts a legacy account; a member with an existing legacy-scheme record is not adopted (and their per-member blob is still reached by the union); never deletes anything; is a single-flight (one `listAccounts` across many `resolveDeviceKeys` calls for several families, plus a `nativeUnlock`); fires **no** enumeration from `nativeDisable` / `clearNativeRecord`; a `getAllPasskeys` failure aborts adoption without changing the existing degrade; an individual `savePasskeyRegistration` failure is counted and does not abort the rest; a throwing plugin/repo still resolves (never rejects); a never-resolving `listAccounts` lets a three-family `resolveDeviceKeys` sequence return within **one** budget, and lets `nativeUnlock` return.
5. **Unit — record factory:** `nativeEnable` and adoption produce records that agree on `mechanism`, `keystoreScheme`, `publicKey`, `prfSupported`, `credentialId` (one factory, pinned).
6. **Unit — reclaim union:** deletes an enumerated blob with no record; deletes a record whose blob is absent; deletes the legacy address; a blob that is _also_ a record is deleted once and its record removed; **never deletes an enumerated blob belonging to a different family**; with `listAccounts` rejecting, behaves exactly as today (and reports); with `listAccounts` returning `[]`, deletes exactly the record-derived set and nothing more.
7. **Unit — sweep:** `reclaimAllKeystores` issues one `deleteAllKeys` and is not gated on enumeration; `deleteAllKeys` is called from no other path in the module; **with `deleteAllKeys` rejecting, `sweep_failed` is reported and every registry-known family is reclaimed via `deleteKey`**; on web (`isNative()` false) no plugin call is made at all.
8. **Unit — roster reconcile:** deletes an adopted blob whose member is gone; does **not** delete a pre-existing (non-adopted) record's blob; **does not delete another family's adopted blob when this family's roster arrives, and that other family's targets survive for its own later reconcile**; does nothing when adoption adopted nothing for this family, when the roster is empty, when the signed-in member is absent from the list, when the active family changed mid-pass, or on a second call for the same family in the same session (the per-family drain); backfills an absent `memberName`; never rejects when the repo throws.
9. **Unit — non-silent:** `deleteKey`/`hasKey` reject on a missing account; a rejecting `deleteKey` produces a `warn` with an `error_code` and a purge summary showing `failed=1`; a failing `removePasskeyRegistration` still produces `clear_record_failed`; a rejecting `listAccounts` produces one `reportError`; a missing method produces `enumerate_unsupported` and **not** `plugin-missing`; `formatAdoptionDetail` and `formatPurgeDetail` match their pinned strings.
10. **`dataClearingSecurity.test.ts`** — with `isNative` forced true, the clear tier calls `reclaimAllKeystores` exactly once **even when the family registry is empty** (the precise regression being fixed), passes the registry-derived family ids, and removes every registry record via `getAllPasskeys`. Plus the `importOriginal`-spread `capabilities` mock so the existing 20+ assertions stay meaningful.
11. **On device (iOS), after the fix** — the full cycle: enrol (two members), delete, reinstall, load the pod, sign in (adoption, biometrics restored, labels distinguishable, no Face ID prompt on the picker), open the pod (names backfilled), remove one member, confirm their blob is gone, clear all data, enumerate and confirm empty. **Plus the two-family variant**: a second family's enrolment on the same device survives the first family's sign-in and roster load.
12. **On device/emulator (Android), after the fix** — enrol, `clear all data`, then confirm re-enrol is offered cleanly and a fresh `hasKey` reports absent (i.e. the alias and the pref really went), plus one unlock to prove the `hasKey` change did not break the happy path.
13. **CloudWatch** — after a TestFlight build reaches a device: confirm the deployed telemetry Lambda is not stripping these keys (STATUS.md caveat), then confirm `native-biometric` `action: 'adopt'` events with plausible counts, at most one per session, whether `adopted>0` ever appears in the field, that `count=0 & registered>0` never appears, and that `sweep_failed` never appears.

## Review Passes

- **Pass 1 (Initial draft)**: Established from code that the defect is `nativeReclaimFamilyKeystore` being registry-driven at the one documented reclaim chokepoint; designed adopt-on-resolve as the core fix (recover rather than delete, satisfying both the security requirement and the do-not-break-the-reinstaller requirement), made reclaim keychain-driven to fix all three deletion paths at one site, answered the residue question via a user-initiated whole-service sweep, and flagged the enumeration's prompt behaviour as the load-bearing unknown to settle on hardware first.
- **Pass 2 (DRY + error handling)**: Verified every claim against the code and corrected four (no `nativeBiometric.d.ts`; legacy blobs are not adoptable; `listNativeRecords` _is_ `nativeResolveDeviceKeys`, so per-family adoption would fire an enumeration per record per operation; `authStore:2511` is clear-all while `familyContext:165` is delete-local-family) — then collapsed the design onto one session-scoped all-families adoption single-flight, one predicate-driven union reclaim engine that makes the "enumeration failed" fallback branch disappear, and one logged `deleteBlob` replacing three bare `catch {}`; made requirement 5 immune to the plan's one unknown via a service-wide `SecItemDelete`; found two further plugin silent failures (`deleteKey` discards its `OSStatus`; `hasKey` reports absence on a missing account, which deletes a live record); made the enumeration's contradiction self-proving in one log line and reused the existing `native-biometric` surface plus `guessAuthenticatorLabel`/`idTail`/`updatePasskey`/`getAllPasskeys`/`isPluginMissing` rather than adding new machinery; hung requirement 4 on the existing roster watcher with hard bounds so a partial roster cannot delete live keys; simplified `reclaimAllPasskeys` into fewer lines than it has today; and caught the `capabilities` test-mock gap that would have made the most security-critical clear step fail silently in the suite.
- **Pass 3 (Sustainability)**: Caught that §7's whole-service sweep would **orphan Android material** (unimplemented `deleteAllKeys` rejects while the registry records are still deleted) and added `deleteAllKeys` + the missing-account/thrown-failure rejects to the Java plugin so one TS contract is true on both platforms; split `readNativeRecords` out of `nativeResolveDeviceKeys` so adoption fires at **two named seams** instead of implicitly from unlock/disable/reclaim (removing a hidden mutation in a hot read, a reentrancy hazard, and adoption-during-reclaim) and deleted the `listNativeRecords` alias; bounded the adoption await with the existing `raceTimeout` and a never-rejects contract, since `FamilyPickerView` mounts at launch (requirement 8 restated); replaced the single-caller higher-order `reclaimAccounts(match, …)` engine with an inline union plus a genuinely two-caller `purgeTargets()` leaf; collapsed the roster reconcile's five guards + `reconcileDone` flag into one drained adopted-target set + one flat `rosterLooksComplete()` predicate, modelled on `rosterCache.refreshRosterCache`'s never-throws/TOCTOU shape so the `void` watcher call cannot leak an unhandled rejection; extracted one `nativeRecord()` factory shared with `nativeEnable`; reduced the `adopt` telemetry to one event with a computed level and one pinned `formatAdoptionDetail()`; found a **second** test-mock gap (the repo double lacks `getAllPasskeys`/`updatePasskey` and the plugin double lacks `listAccounts`, which `isPluginMissing` cannot classify, so every existing `nativeBiometric.test.ts` case would emit `enumerate_failed`) plus the `__reset*ForTests` convention for the new session state; and sequenced the work into three independently-green commits so the platform-agnostic truthfulness fix can land regardless of how the hardware enumeration check turns out.
- **Pass 4 (Fresh-eyes sweep)**: Caught that the Pass-3 roster reconcile would **delete other families' live enrolments** (adoption is all-families, the drained set carried no `familyId`, and it was tested against the active family's roster) — fixed with an `AdoptedTarget` type carrying `familyId`/`memberId` and a per-family `takeAdoptedTargets(familyId)` drain; that a **missing or failing `deleteAllKeys` would make clear-all a total no-op while reporting success** (the #74 unregistered-method class, twice real in this repo) — fixed with a `deleteKey`-only registry-derived fallback inside `nativeReclaimAllKeystores` plus a `sweep_failed` report, and corrected §7's "order is not load-bearing" claim accordingly; that the per-caller `raceTimeout` would cost `budget × familyCount` because `FamilyPickerView` loops families **sequentially** — fixed by memoizing the raced gate (`awaitAdoptionGate`) so the budget is a per-session total, and used the same bounded gate in `nativeUnlock`, which Pass 3 had awaiting unbounded; that `passkeyService` cannot import a store (`authStore.ts:13` imports it) so the signed-in member id must be passed in from the watcher; folded `clearNativeRecord` into `purgeTargets` (three callers, one implementation, `clear_record_failed` preserved) and moved the purge summary emit into `purgeTargets` so no caller can drift; corrected the flat contradiction between §5's per-call enumeration and the "exactly one `listAccounts` per session" criterion; corrected three factual errors (two bare `catch {}` around `deleteKey`, not three; `biometricKeystorePlugin.ts:18-20`, not `:118-120`; `useLoginFlow.ts` is in `src/composables/`); added the `hasKey`-vs-`listAccounts` query-shape distinction that assumption 1 actually rests on; documented three previously-unstated consequences (a failed disable now re-adopts next session — the honest outcome; adoption is lazy so it is "at most" one pass per session; adoption can create records for families absent from the family registry); flagged the stale legacy-re-home lines in `nativeUnlock`'s doc comment; hardened the `capabilities` test mock onto the file's own `importOriginal`-spread pattern; and resequenced into four commits with the sweep ahead of the enumeration and **the split line drawn between C and D — if anything is cut, cut the roster reconcile.**

## Prompt Log

> **No GitHub issue created.** This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial prompt (greg, 2026-09-15)

> ok - let's move on to some of the high priority bugs
>
> /beanie-pre-plan #82 - once competle move directly onto /beanies-plan and once complete move to /beanies-build-auto - work autonomously. if you have questuons let me know now or ping me when you need my help.

### Intake

The full `=== BEANIES PRE-PLAN ===` block assembled by `/beanies-pre-plan` from Notion row #82 and written back to that row, including the two pre-plan research resolutions (iCloud sync is a non-issue; the keychain is itself an enumerable registry) and the adjacent `deleteKey` silent-failure finding.

### Pass 2 review prompt

The verbatim Pass 2 prompt from `.claude/skills/beanies-plan/SKILL.md` (DRY + error handling).

### Pass 3 review prompt

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex or difficult to support or maintain in the future. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

### Pass 4 review prompt

> Take one more pass at the plan and review again with fresh eyes. Review all activities proposed and confirm again that we are applying the most simple, secure, robust, and elegant solution, strictly following DRY principles, ensuring a focus on long term sustainability, maintenance, and reliability, and avoiding introducing any bugs or side effects. This will probably be the final iteration of the plan, so please ensure we have captured any relevant issues and are implementing the most robust and sustainable version of this plan.
>
> This is a SECURITY plan whose subject is key material, so weight two things especially: (a) any path where the change could delete a live enrolment or key a user still needs, and (b) any path where it could leave material present while reporting that it is gone. Also sanity-check whether the plan has grown too large for one change — if it should be split, say so explicitly and say where the line is.

</details>
