# Plan: Never fork a family's data — eliminate silent pod re-homing

> Date: 2026-08-10
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-08-10-never-fork-a-family-pod.md`

## User Story

As a member of a family who does not own the `.beanpod` file, I want the app to keep writing to the one file my family shares — always — so that my data can never silently diverge onto a private copy I didn't ask for and can't see.

## Context

A non-owner family member on Android silently ended up working on a private duplicate of the family `.beanpod`. The data looked identical, so nobody noticed until her to-do items stopped appearing for the rest of the family. Recovery required a full sign-out, sign-in, and manually picking the original shared file out of two near-identically-named files.

### Root cause

`syncStore.establishDurableHomeAfterLoad()` (`src/stores/syncStore.ts:2456`) treats **"I don't own this Drive file"** as **"this isn't my home — mint me a private copy."**

In beanies' sharing model the family's `.beanpod` is owned by the inviter and **shared with edit access** to members. So for every non-owner member the file is, by design, one they do not own. The guard therefore mis-fires for exactly that population. From `syncStore.ts:2498`:

```js
// Owned by another account → re-home (never keep writing cross-account).
```

That comment encodes the wrong model. It conflates two different questions — _"can I write here?"_ (durability) and _"do I own this?"_ (Drive metadata) — and answers the first with the second.

### The chain

1. Join via invite link — `useJoinFlow` installs the inviter's shared file directly and **never** calls `establishDurableHomeAfterLoad` (verified by grep: the only non-test callers are `LoadPodView.vue` and the store's own export at `:3553`). The join itself is safe, which is why it worked at first.
2. A later load through `LoadPodView` — a re-login, or (most likely on Android WebView) IndexedDB eviction of the provider config forcing a re-load.
3. Every successful load path funnels through `finishLoaded()` → `ensureDurableHome()` → `establishDurableHomeAfterLoad()`. `ensureDurableHome` has exactly **two** call sites — `finishLoaded()` (`LoadPodView.vue:225`) and the single-member auto-sign-in branch (`LoadPodView.vue:485`). The eight line numbers quoted in pass 2 (`248, 285, 306, 399, 485, 493, 566, 831`) are the call sites of **`finishLoaded`**, not of `ensureDurableHome` (re-verified by grep in pass 4). This matters: the fix has one shared implementation and one extra branch to touch, not eight.
4. The guard probes `getFileMetadata(token, fileId, 'ownedByMe')` (`syncStore.ts:2488`) → `false`.
5. `reHomeToOwnDrive()` (`syncStore.ts:2391`) → `mintFreshOwnDrive` → `GoogleDriveProvider.createNew()` → `installProvider()` → **`syncNow()` (`syncStore.ts:562`) writes the live in-memory doc into the new file**. That is why the copy looked identical.

The `FileNameCollisionError` reject-different-account arm (`syncStore.ts:2412`) appends the familyId, producing `family data file-<familyId>.beanpod` — the exact duplicate observed.

### Second-order damage — family-wide, not one device

`installProvider` (`syncStore.ts:577`) unconditionally calls `registerCurrentFamily({ fileId })`. The re-home therefore rewrote the family's canonical registry entry to her private copy. `attemptSilentConfigHeal` (`syncStore.ts:2760-2770`) trusts `entry.fileId` as authoritative and installs it via `installProviderPersistOnly` **without any verification of which file it is** (verification of `familyId` would not help — the fork carries the same `familyId`, because it was minted from the same doc). So it could subsequently heal **other** members onto her copy. This is a propagation vector, not an isolated fault.

**`ownerEmail` was NOT rewritten, but is not protected either.** Read `infrastructure/lambda/registry/index.mjs:94-101`:

```js
provider: body.provider || 'local',
fileId: body.fileId || null,
displayPath: body.displayPath || null,
familyName: body.familyName || null,
createdAt: existing.createdAt || now,
ownerEmail: body.ownerEmail ?? existing.ownerEmail ?? null,
```

`body.ownerEmail ?? existing.ownerEmail` means a _non-null_ member email **would** overwrite. `registerCurrentFamily` (`syncStore.ts:3468`) always sends `ownerEmail: authStore.currentUser?.email ?? null`, so every member login sends a non-null email on a Google-signed-in device. `ownerEmail` is documented as write-once at `:82-84` and is **not actually enforced as write-once** — the comment and the code disagree. Separately, the three **pointer** fields (`provider`, `fileId`, `displayPath`) are unconditionally overwritten by whatever the last writer sent. Those are the fields that caused the propagation, and they are the ones this plan protects. The `ownerEmail` comment/code mismatch is fixed as part of the same change (it becomes genuinely write-once), which is also what makes the pointer guard below possible.

**Verified wider than pass 1 assumed.** `registerCurrentFamily` (`syncStore.ts:3456`) is not only reached from `installProvider` (`:577`). It is also reached from:

- `ensureRegistered(true)` at `LoginPage.vue:630` — **every member's every login**, and
- the `settingsStore.country` watcher at `syncStore.ts:3493-3500`.

Both write `fileId: provider?.getFileId()` from the _signed-in_ session. So gating only `installProvider` (the pass-1 design) leaves the propagation vector open.

### Third mis-fire

`syncStore.ts:2505` re-homes when the ownership probe _throws_:

```js
// Ownership unknown → conservative re-home (never assume ours).
```

A transient Drive 5xx forking a family's data is the least conservative outcome available. `driveRequest` (`driveService.ts:604-630`) throws `DriveApiError('Request timed out', 408)` on a 15s abort — so a slow network alone is sufficient to fork a family.

### Adjacent defects found while verifying (pass 4)

These sit inside the same fault domain — "the registry is the family's pointer of record" — and are fixed here because leaving them turns this fix into a partial one:

- **`registry.lookupFamily` cannot distinguish "no such family" from "registry unreachable."** It returns `null` for a 404, for any non-2xx, and for a thrown network error (`registryService.ts:34-46`), and swallows the cause with a bare `console.warn`.
- **Because of that, `attemptSilentConfigHeal`'s registry-outage retry path is dead code.** `syncStore.ts:2741-2748` wraps `lookupFamily` in a `try/catch` and calls `scheduleConfigHealRetry(familyId, 'registry-error')` on a throw — but `lookupFamily` never throws. A registry outage therefore falls straight to `configHealTotalFailure` (`:2755`), a **non-retryable dead end**, instead of the retry the author clearly intended. (`syncStore.ts:3048` even documents the "never throws" contract, confirming `:2745` is unreachable.)
- **`createNewFile`'s existing-pod guard fails open on a registry outage** (`syncStore.ts:1425-1443`) — `lookupFamily` returns `null`, the guard reads that as "no pod", and creation proceeds. This is a narrow duplicate-pod path. See §8 for the deliberate decision _not_ to close it by blocking, and what we do instead.

### Regression window

`6004ad6c` (2026-07-13, B3/B4/B5/B6), hardened by `a9ccbea0` (2026-07-15). The wrong behaviour is pinned by tests at `syncStore.establishDurableHome.test.ts:352` (`re-homes a FOREIGN Drive file`) and `:372` (`re-homes conservatively … when the ownership fetch throws`).

## Requirements

1. **The app must never create a `.beanpod` on its own.** Creating one is reachable only from two explicit, named user actions, both preserved: `createNewFile` (start a new family) and `migrateStorage` (move this family's storage, user-chosen in Settings).
2. **A loaded family's home is the file it was loaded from.** Nothing may re-bind that on the app's initiative — not on ownership, not on a probe failure, not on a name collision.
3. **Ownership (`ownedByMe`) must stop being the writability signal.** Writability is `capabilities/canEdit` on the same metadata call. A shared file the member can edit is a legitimate home.
4. **No "create a duplicate?" option may exist in the UI or in the code.** Not a prompt, not a fallback, not a flag. When access fails the user gets an error, a retry, a plain-language explanation, and a concrete action to restore access **to the original file**.
5. **Non-owner devices must never repoint the family's canonical pointer** (`provider` / `fileId` / `displayPath`). Enforced where it cannot be bypassed — see §5.
6. **Typed failure taxonomy with per-case recovery**, reusing the ADR-024 `JOIN_ERRORS` _shape and its view-derivation logic_, extracted to a shared pure module.
7. **The provider-less restore case must not become a read-only dead end.** The native `<input type=file>` fallback stages an envelope with no provider; it needs an **explicit, user-initiated** "pick your family's file" affordance that rebinds to the ORIGINAL file — never an automatic mint.
8. **Detect and surface canonical mismatch.** If the active file is not the family's canonical pod, tell the user plainly and offer to switch to the canonical one.
9. **Rewrite the tests that pin the wrong behaviour**, and add regression tests that fail against the current code.
10. **The fix must not increase the app's long-term complexity budget.** Explicit ceilings in §9. Every new abstraction must have ≥2 real consumers on the day it lands, or it does not land.
11. **(New, pass 4) A refused pointer write must never be silent to the device that intended it.** The server guard trades one silent failure (member overwrites the pointer) for another (owner's legitimate re-point is dropped) unless the client distinguishes _intent_. See §5.

## Important Notes & Caveats

- **`createNewFile` and `migrateStorage` are explicitly out of scope for removal.** They are the two legitimate creation paths.
- **Correction to pass 1: `migrateStorage` cannot satisfy requirement 7.** Verified at `syncStore.ts:2855-2890` — it throws `'No pod is configured to move'` when `!isConfigured.value`, throws again when `!from`, and flushes the source with `syncNow()` before building the destination. The `NO_HOME` case has no provider by definition, so `migrateStorage` is unreachable there and would create a _new_ file even if it were. Requirement 7 is satisfied by the re-pick → `rebindPodFile` path instead.
- **Correction to pass 1: `resolveExistingBeanpod`'s `reject-different-account` arm does NOT become unreachable.** Verified by grep: `useDriveCollisionRecovery.resolveDriveCollision` calls it, and that is called from `CreatePodView.vue:287` and `ResumePodSetup.vue:630`. Only the `syncStore` import (`:34`) and its single use (`:2402`) go away. **Do not delete `connectStorage.resolveExistingBeanpod`, `adoptDriveStub`, or `isStubBeanpod`.**
- **`configureSyncFileGoogleDrive` has no external consumers.** Grep confirms it is referenced only inside `syncStore` plus its export at `:3552` and a test seam. It exists solely to serve the re-home path and goes with it.
- **Do NOT call `usePermissions()` inside `registerCurrentFamily`.** `usePermissions` (`src/composables/usePermissions.ts:44-63`) registers a `watch()` on every invocation. `registerCurrentFamily` runs on every login, every country change, and every provider install. Calling a `watch`-registering composable from a repeatedly-invoked function leaks one watcher per call for the lifetime of the store's effect scope. §5 removes the question entirely by moving the guard server-side.
- **`googleDriveProvider.ts:399` is `writeAux`** — aux/attachment files, not `.beanpod`. Out of scope. `photoStore`'s `createFile` calls are photo attachments. Only `:490` (`createNew`) mints a pod.
- **Do not "fix" this by making the re-home smarter.** Any design that still ends with the app minting a second pod is out of bounds. The verification path must be able to _fail_ and say so.
- **`isStubBeanpod` / `adoptDriveStub` are create-flow concerns**, not load-flow. Leave them alone.
- **The failure surface must not block reading.** A member who cannot write must still see their already-decrypted data; the error is about durability, not visibility.
- **Beware the reverse regression**: `establishDurableHomeAfterLoad` was written for a real problem (#47 — a restored backup with no writable target). Removing it without requirement 7's affordance recreates that dead end.
- **(New, pass 4) `capabilities/canEdit` is a NESTED field.** `getFileMetadata(token, fileId, 'capabilities/canEdit,trashed')` returns `{ capabilities: { canEdit: true }, trashed: false }`. The evaluator must read `meta.capabilities?.canEdit`, **not** `meta.canEdit`. Reading the flat key yields `undefined` on every healthy file — a silent, universal false positive. The unit test asserts the nested shape explicitly.
- **(New, pass 4) Verification must never pop OAuth UI.** Today's code calls `requestAccessToken()` (`syncStore.ts:2487`), which can go interactive if the token lapses between the `isTokenValid()` check and the call. Use `tryGetSilentToken()` (`googleAuth`, already used by `usePickBeanpodFile.ts:79`) and map `null` → `CONSENT_EXPIRED`. A background durability check must never interrupt a load with a consent dialog.
- **(New, pass 4) The App-level banner does not render on the login route.** The banner region in `App.vue:1855-1884` is inside `v-if="showLayout"` and `SaveFailureBanner` is additionally gated on `&& !authStore.needsAuth` (`:1877`). This is correct and intended: `verifyPodAccess` runs immediately before `emit('file-loaded')` / `emit('signed-in')` in both call sites, so the banner appears the moment the user lands in the app. `podAccessError` is store state, so it survives the route transition. `PodAccessBanner` carries the same `!authStore.needsAuth` gate for consistency, and a test asserts the state survives the transition.
- **i18n**: every new user-facing string goes through `uiStrings.ts` with both `en` and `beanie` values. No bare strings — CI-enforced by `eslint-rules/no-bare-render-strings.js`.

## Assumptions

> **Review these before implementation.** Valid at planning time; verify if time has passed.

1. Drive's `capabilities/canEdit` is a faithful writability signal for a shared-with-edit `.beanpod`. (Evidence: these families sync normally today via the shared file.)
2. The registry row's `ownerEmail` names the account that created the family pod, and is a usable authority for "may move this family's pointer". (Evidence: `createNewFile` → `_registerCurrentFamilySync` (`syncStore.ts:1250, 1514`) is the first write for a new familyId, and it carries the creator's email.) **Verify before shipping step 0**: `ownerEmail` is sourced from `authStore.currentUser?.email` — the member-profile email, which is user-editable. §5 handles the drift case explicitly rather than assuming it away.
3. `registry` is already imported/reachable in `syncStore` — confirmed (`syncStore.ts:40`). No new dependency edge is introduced by this plan on the client side.
4. `action`, `error_code`, `http_status`, `provider_type`, `file_id_tail`, `drive_file_not_found`, `online`, `family_id`, `severity` are all already in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61-95`) — verified by reading the set — **no allowlist change, no Lambda telemetry-mirror update, no app-store declaration update**.
5. `useJoinFlow` does not call `establishDurableHomeAfterLoad` (confirmed by grep) and needs no behavioural change — only the mechanical extraction of its `currentErrorView` derivation.
6. The registry Lambda (`infrastructure/lambda/registry/index.mjs`) can be deployed independently of the client, ahead of it. (It is a standalone function behind API Gateway; `registryService.ts` speaks plain JSON over `fetch`.)
7. **(New, pass 4)** `rebindPodFile` retains the in-memory Automerge doc. Verified: `replaceEnvelope` (`syncStore.ts:167-172`) only merges local key dicts into the incoming envelope, and `syncService.setFamilyKey` (`syncService.ts:523-530`) sets the key + envelope cache and does **not** reload the doc. The next poll/save cycle therefore merges local state into the newly-bound file through the normal Automerge path. This is what makes `switchToCanonical` a merge rather than a discard — but it is asserted by an integration test (§Testing 11), not assumed.

## Approach

### Design principle

> **A family's pod binding is established once, by an explicit user action, and is never changed by the app.** Verification may _report_ a problem; it may never _resolve_ one by creating or switching files. Every resolution routes through one primitive that can only ever bind to a file whose `familyId` matches the live envelope.

### Sustainability principle

> **One state, one renderer, one primitive, one classifier.** Every duplicated concept in this feature — two banners for one condition, two rebind paths, two role predicates, two error renderers — is a future divergence bug. Where a pass leaves a choice open, the next closes it in the direction that removes a code path rather than adding one.

### 0. The reuse inventory (what we are NOT writing)

Verified by reading the code. Every one of these already exists and is used in production; the plan consumes them rather than re-implementing.

| Need                                                                                                                              | Existing thing                                                                                                                                                                                      | Location                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Rebind to a _specific existing_ file, safely                                                                                      | `syncStore.recoverFromMissingFile(fileId, name)` — checks `env.familyId === envelope.familyId`, `docClient.verifyEnvelope`, `setProvider`, `replaceEnvelope`, clears banner state, restarts polling | `syncStore.ts:3191-3251`                                                            |
| Let the user pick their `.beanpod` from Drive                                                                                     | `usePickBeanpodFile().pick()` — silent-then-interactive token, popup-vs-redirect, structured `PickBeanpodFileResult`, never throws                                                                  | `composables/usePickBeanpodFile.ts`                                                 |
| Top-of-app persistent banner chrome (severity tint, a11y roles, transitions, dark mode, inline flow, title/message/actions slots) | `ErrorBanner.vue` — its own docstring: _"Shared chrome for `SaveFailureBanner` and any future persistent error UI"_                                                                                 | `components/common/ErrorBanner.vue`                                                 |
| Thin banner wrapper pattern                                                                                                       | `DurabilityBanner.vue` (39 lines: `ErrorBanner` + one store flag + one CTA), `SaveFailureBanner.vue` (`ErrorBanner` + `usePickBeanpodFile` + recovery actions)                                      | `components/common/DurabilityBanner.vue`, `components/google/SaveFailureBanner.vue` |
| Registry-driven typed error → view derivation (message key + `fillTemplate` context + severity + ordered recoveries)              | `JOIN_ERRORS` + the `currentErrorView` computed                                                                                                                                                     | `useJoinFlow.ts:87-153`, `JoinPodView.vue:85-101`                                   |
| Interpolate `{vars}` into a translated string safely                                                                              | `fillTemplate`                                                                                                                                                                                      | `utils/fillTemplate.ts`                                                             |
| Re-grant a lapsed Google grant                                                                                                    | `useGoogleReconnect()` — already consumed by `GoogleReconnectToast.vue:13`, `SettingsPage.vue:103`, `LoadPodView.vue:627`                                                                           | `composables/useGoogleReconnect.ts`                                                 |
| Drive error classes carrying HTTP status                                                                                          | `DriveFileNotFoundError` (403 **and** 404, `.status` discriminates — `driveService.ts:643`), `DriveApiError` (408 on timeout, 5xx), `TokenExpiredError` (`googleAuth.ts:1276`)                      | `driveService.ts:652-680`                                                           |
| Silent (never-interactive) Drive token                                                                                            | `tryGetSilentToken()`                                                                                                                                                                               | `services/google/googleAuth.ts`                                                     |
| Metadata probe                                                                                                                    | `getFileMetadata(token, fileId, fields)` — arbitrary comma-separated fields, one request                                                                                                            | `driveService.ts:257`                                                               |
| In-flight/once-per-family guard pattern                                                                                           | `configHealInFlight` (`:314`) + its reset in `resetState` (`:2310`)                                                                                                                                 | `syncStore.ts`                                                                      |
| Banner mutual-exclusion pattern + its test file                                                                                   | `shouldShowSaveFailureBanner` (`:241-244`); `syncStore.bannerVisibility.test.ts:325`                                                                                                                | `syncStore.ts`, `stores/__tests__/`                                                 |
| Server-side preserve-on-omit precedent                                                                                            | `country`, `subscribeNewsletter`, `lastLoginAt`, `beanpodSizeKb` merge semantics                                                                                                                    | `infrastructure/lambda/registry/index.mjs:100-127`                                  |

**Net new code: one store action, one pure classifier module, one pure view-resolver module, one banner wrapper, and ~10 lines of Lambda.**

### 1. Replace re-homing with verification (store)

Delete `reHomeToOwnDrive` (`:2391`), `mintFreshOwnDrive` (`:2361`), `configureSyncFileGoogleDrive` (`:2369`), and the `resolveExistingBeanpod` import at `:34`. Replace `establishDurableHomeAfterLoad` with a **verify-only** action, `verifyPodAccess()`.

The store action stays thin. All decision logic lives in a **pure module** (§3) so it is testable without Pinia, without mocks, and without a DOM:

```ts
// src/stores/syncStore.ts — orchestration only, ~30 lines, max nesting depth 2
let verifyInFlight = false; // reset in resetState(), next to configHealInFlight

async function verifyPodAccess(): Promise<PodAccessResult> {
  if (verifyInFlight) return podAccessError.value ?? { ok: true };
  verifyInFlight = true;
  try {
    const result = await probeAndEvaluate(); // below
    podAccessError.value = result.ok ? null : result;
    logPodAccess(result); // one call, both outcomes
    if (result.ok) void checkCanonicalOnce(); // fire-and-forget, §6
    return result;
  } finally {
    verifyInFlight = false;
  }
}
```

The `verifyInFlight` guard is new in pass 4: `retry` re-runs `verifyPodAccess`, and a user tapping retry repeatedly would otherwise issue overlapping Drive probes whose results race to write `podAccessError`. One flag, mirroring `configHealInFlight`, reset in `resetState()` (`:2290-2310`) alongside it.

`probeAndEvaluate` is a flat sequence of guard clauses — **no `else`, no nesting beyond one `try`**:

1. `const provider = syncService.getProvider()`; if `!provider || syncService.getProviderFamilyId() !== activeFamilyId` → `{ ok:false, code:'NO_HOME' }`. (Preserves the family-scoped check from `:2478`, which guards against a stale provider from a previously-active family.)
2. `syncService.getProviderType() !== 'google_drive'` → `{ ok:true, providerType }`. A local/native provider we installed for this family is a genuine home. Unchanged from today's `:2483` behaviour.
3. `!provider.getFileId()` → `{ ok:false, code:'CONSENT_EXPIRED' }`.
4. `const token = await tryGetSilentToken()`; `!token` → `{ ok:false, code:'CONSENT_EXPIRED' }`. **Never `requestAccessToken()`** — see Caveats; a durability check must not pop consent UI mid-load.
5. **One metadata call, correct fields**: `getFileMetadata(token, fileId, 'capabilities/canEdit,trashed')`, wrapped in the function's single `try`. Hand the raw response to the pure evaluator:

   ```ts
   evaluatePodMetadata(meta); // → 'ok' | 'PERMISSION_DENIED' | 'FILE_NOT_FOUND' | 'VERIFY_UNAVAILABLE'
   ```

   Reading the **nested** `meta.capabilities?.canEdit`:
   - `canEdit === true && trashed !== true` → `ok`
   - `canEdit === false` → `PERMISSION_DENIED`
   - `trashed === true` → `FILE_NOT_FOUND`
   - `canEdit === undefined` (field absent / unexpected shape) → **`VERIFY_UNAVAILABLE`**, not `PERMISSION_DENIED`.

   That last line changed in pass 4. Treating an _absent_ field as a denial fails closed into a **critical** red banner on a perfectly healthy file. Since no arm of this function mutates anything, failing closed buys no safety — it only manufactures false pages. Only an **explicit** `canEdit === false` is a denial; anything else we couldn't read is "we don't know", which is `VERIFY_UNAVAILABLE` (`warning` + `retry`) and is still surfaced, so nothing is silent.

6. `catch (e)` → `{ ok:false, code: classifyDriveFailure(e) }` (§3). One catch, one classifier, no `instanceof` ladder in the store.

**It performs no mutation and creates nothing.**

`LoadPodView.ensureDurableHome()` (`:216`) becomes `verifyPodAccess()` — same shape, same two call sites (`finishLoaded` at `:225`, single-member auto-sign-in at `:485`), same never-block contract. Its outer `try/catch` stays (a throw must never block the user reaching decrypted data) but the catch now writes `{ ok:false, code:'VERIFY_UNAVAILABLE' }` into the store and `reportError`s, instead of today's bare `console.error` (`LoadPodView.vue:220`). **LoadPodView renders nothing itself** — see §6.

### 2. Extract the error _view derivation_, not the markup (DRY, corrected in pass 4)

**Pass 3 proposed a shared `StructuredErrorPanel.vue`. Pass 4 drops it.** Reading the two surfaces side by side shows they are not the same component:

- `JoinPodView.vue:252-295` is an **inline tinted card** in the login flow: `bg-red-50 dark:bg-red-900/20`, `text-red-800`, `BaseButton` `primary`/`secondary` variants, `rounded-2xl`, in the page body.
- The pod-access surface is a **top-of-app full-bleed bar** — `ErrorBanner` chrome: `bg-red-600`, white text, `title`/`message`/`actions` slots, transitions, safe-area-aware, pushes `AppHeader` down (`App.vue:1866-1884`). `DurabilityBanner.vue` even carries an explicit comment that `SaveFailureBanner`'s red-on-white buttons _clash_ inside coloured banner chrome and must not be reused there.

Nesting the join card inside `ErrorBanner` would render a `red-50` card inside a `red-600` bar with two competing severity tints and two `role="alert"` regions. A component that must be parameterised into two different visual languages is not one component; requirement 10 ("≥2 real consumers on day one") would be satisfied on paper and violated in substance.

**What IS genuinely duplicated is the derivation**, and that is what we extract:

`src/utils/structuredError.ts` — **a pure module, not a composable**:

```ts
export interface StructuredErrorEntry {
  messageKey: string;
  recoveries: readonly string[];
  severity: 'warning' | 'critical';
}
export interface StructuredErrorView {
  code: string;
  severity: 'warning' | 'critical';
  message: string;
  recoveries: readonly string[];
}
export function resolveErrorView(
  registry: Readonly<Record<string, StructuredErrorEntry>>,
  err: { code: string; context?: Record<string, unknown> } | null,
  t: (key: string) => string
): StructuredErrorView | null;
```

The body is `JoinPodView.vue:86-101` verbatim, including the `fillTemplate` safety comment about `$`-replacement patterns. **Two real consumers on day one**: `JoinPodView.currentErrorView` and `PodAccessBanner`'s equivalent computed.

Why `src/utils/` and not `src/composables/`: it has no reactivity, no lifecycle, and no store access, so it is not a composable — putting it in `composables/` mislabels it and invites a future contributor to add reactivity to it. `src/utils/` already holds exactly this kind of pure helper (`fillTemplate.ts`, `diagnosticContext.ts`, `assertNever.ts`). It is also imported by `syncStore` transitively via `utils/podAccess.ts` (§3), and a store importing a composable is a dependency edge that invites a cycle later.

No generic type parameters. Exhaustiveness is enforced where it matters — at the _registry_ declaration (`as const satisfies Record<PodAccessErrorCode, StructuredErrorEntry>`), exactly as `JOIN_ERRORS` already does at `useJoinFlow.ts:153` — not at the resolver. A non-generic signature is one line, reads at a glance, and has one behaviour to test.

**`JoinPodView.vue` is refactored onto `resolveErrorView` as the first commit** (§10), with its existing error tests as the safety net, so there is exactly one implementation from the moment the shared code exists. Its markup and its `recoveryHandlers` map stay local — the actions are join-specific and the markup is context-specific. `useJoinFlow.JoinErrorEntry` becomes an alias of `StructuredErrorEntry`.

### 3. Failure taxonomy — one classifier, four recovery actions

New file `src/utils/podAccess.ts` — **pure, no Vue, no Pinia, no network**.

Exports: `PodAccessErrorCode`, `POD_ACCESS_ERRORS`, `POD_ACCESS_SEVERITY`, `classifyDriveFailure`, `evaluatePodMetadata`.

```ts
export const POD_ACCESS_ERRORS = { ... } as const satisfies Record<PodAccessErrorCode, StructuredErrorEntry>;
```

| Code                 | Cause                                                   | Recoveries                            | Severity   |
| -------------------- | ------------------------------------------------------- | ------------------------------------- | ---------- |
| `OFFLINE`            | `!navigator.onLine` at throw time                       | `retry`                               | `warning`  |
| `PERMISSION_DENIED`  | explicit `canEdit:false`, or HTTP 403                   | `retry`, `pickFamilyFile`             | `critical` |
| `CONSENT_EXPIRED`    | `TokenExpiredError` / no silent token / no fileId / 401 | `reconnectAccount`                    | `critical` |
| `FILE_NOT_FOUND`     | HTTP 404, or `trashed:true`                             | `retry`, `pickFamilyFile`             | `critical` |
| `VERIFY_UNAVAILABLE` | 408 / 5xx / unreadable metadata / anything else         | `retry`                               | `warning`  |
| `CANONICAL_MISMATCH` | active fileId ≠ registry canonical fileId               | `switchToCanonical`, `pickFamilyFile` | `critical` |
| `NO_HOME`            | loaded with no provider for this family                 | `pickFamilyFile`                      | `critical` |

**Four recovery actions, backed by exactly two store primitives** (pass 1 had six actions and no primitive discipline):

- `retry` → re-run `syncStore.verifyPodAccess()`.
- `reconnectAccount` → `useGoogleReconnect().reconnect()`, called directly from `PodAccessBanner` exactly as `GoogleReconnectToast.vue:13` does, then re-run `verifyPodAccess()`. No new App.vue wiring.
- `pickFamilyFile` → `usePickBeanpodFile().pick()` → `syncStore.rebindPodFile(fileId, fileName)`.
- `switchToCanonical` → `syncStore.rebindPodFile(canonicalFileId, canonicalName)` using the values captured in §6, then **falls back to `pickFamilyFile` automatically** if the rebind fails (a device that has never picked that file may lack `drive.file` scope for it → `FILE_NOT_FOUND`).

`switchToCanonical` is an argument source, **not a second code path** — both it and `pickFamilyFile` end in the same `rebindPodFile` call. It exists because the acceptance criterion says "switch in one tap" and asking a user to hunt for a file whose ID we already know is a worse product. Adding it costs one entry in the handler map and zero new store logic.

`signInDifferentAccount` and `askFamilyOwnerToReshare` from pass 1 remain **prose, not buttons** — there is no in-app action behind either, and `JOIN_ERRORS.NO_UNCLAIMED_MEMBERS` already sets that precedent (`recoveries: []`, comment: _"the prose copy carries the action"_, `useJoinFlow.ts:148-152`). Shipping a button that can't do the thing is a worse failure than a sentence that tells the truth.

**One primitive resolves five codes.** `rebindPodFile` (§4) is _structurally incapable_ of creating a file and _structurally incapable_ of binding a foreign family (it rejects on `env.familyId !== envelope.value.familyId` at `syncStore.ts:3210`). That property is what makes it the right choice under the binding constraint, and it is asserted directly in a test.

One classifier, used by every arm — no repeated `instanceof` ladders anywhere in the codebase:

```ts
export function classifyDriveFailure(e: unknown): PodAccessErrorCode {
  // `typeof` guard so this module stays importable outside a DOM (worker/SSR/unit).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'OFFLINE';
  if (e instanceof TokenExpiredError) return 'CONSENT_EXPIRED';
  if (e instanceof DriveApiError) {
    // DriveFileNotFoundError extends it
    // driveService.ts:643 throws DriveFileNotFoundError for BOTH 403 and 404 —
    // `.status`, not the class, is the discriminator. Do not switch on instanceof.
    if (e.status === 401) return 'CONSENT_EXPIRED';
    if (e.status === 403) return 'PERMISSION_DENIED';
    if (e.status === 404) return 'FILE_NOT_FOUND';
  }
  return 'VERIFY_UNAVAILABLE'; // 408 timeout, 5xx, unknown — never silent
}
```

### 4. Fix and rename the rebind primitive (real defect, blocks requirement 7)

Verified at `syncStore.ts:3191-3251`: `recoverFromMissingFile` calls `syncService.setProvider(provider)` but **never calls `provider.persist(activeFamilyId)`**. `GoogleDriveProvider.persist` (`googleDriveProvider.ts:301`) is what writes the provider config to IndexedDB. So today's re-pick recovery survives only until the tab is closed — and the _next_ boot with an evicted config re-enters exactly the loop that caused this incident.

Five changes, all inside the existing function:

1. `await provider.persist(ctx.activeFamilyId)` before `setProvider` — matching `installProvider`'s ordering at `:554-556`.
2. `registerCurrentFamily({ provider:'google_drive', fileId, displayPath }, { pointerIntent: true })` after a successful rebind — unconditionally on the client; the server decides whether the pointer moves (§5). An owner who re-picks repairs the registry; a member who re-picks does not move it, and the refusal is reported (§5), not silently dropped.
3. Return typed failures instead of raw prose. It currently returns three hardcoded English strings (`:3199`, `:3206`, `:3214`) that bypass `uiStrings.ts` entirely — a live i18n hole. New signature: `Promise<{ ok: true } | { ok: false; code: PodAccessErrorCode }>`, and let the view translate. `SaveFailureBanner.handleReselectFile` (`:33-42`) is the only other caller and updates trivially (its `reselectError` becomes `t(POD_ACCESS_ERRORS[code].messageKey)`).
4. Its `catch` at `:3246` currently only `console.warn`s — add `reportError({ surface:'pod-access', severity:'critical', context:{ action:'rebind-failed', error_code, file_id_tail } })`. A failed rebind is a user action that failed with data at risk.
5. Clear `podAccessError.value = null` in the same block that already clears `driveFileNotFound` / `showSaveFailureBanner` / `saveFailureLevel` (`:3232-3238`) — **one clearing site for all recovery banner state**, so the four banners can never disagree about whether recovery succeeded.

**Deliberately NOT added: a `syncNow()` after rebind.** A blind post-install upload is precisely the mechanism (`installProvider` → `syncNow`, `syncStore.ts:562`) that made the fork indistinguishable from the original. `rebindPodFile` keeps its existing `startFilePolling()` and lets the normal poll/merge/debounced-save cycle reconcile. Per Assumption 7 this merges rather than discards.

**Rename `recoverFromMissingFile` → `rebindPodFile`.** Two call sites (`SaveFailureBanner.vue:37`, and the new pod-access handlers), one export line (`:3570`), one test seam (`SaveFailureBanner.test.ts:50`). The old name describes one caller's _symptom_; the new one describes the primitive's _contract_, now shared by five error codes. Doing the rename now — while both call sites are already being edited — costs nothing; doing it later costs a separate PR. No alias is kept: two names for one function is precisely the divergence this plan is about.

### 5. Guard the canonical pointer at the only unbypassable choke point — the Lambda

Pass 2 placed the guard client-side in `registerCurrentFamily`. Three problems, all fatal to it:

1. **It leaks watchers.** The owner predicate lives in `usePermissions()`, which calls `watch()` on every invocation (`usePermissions.ts:44`). `registerCurrentFamily` runs on every login, every `settingsStore.country` change (`syncStore.ts:3493-3500`), and every provider install.
2. **It cannot close the hole.** The propagation vector is _already deployed_. Native iOS/Android builds and cached web clients running the pre-fix code will keep sending pointer writes for as long as they run. A client-side guard protects only devices that have already taken the fix — i.e. not the ones causing the damage.
3. **It throws away telemetry.** Skipping the whole `registerCurrentFamily` call for non-owners also skips `lastLoginAt` (server-stamped from `isLoginEvent`, `index.mjs:118`), `country`, `beanpodSizeKb`, and `familyName`. Families whose owner is inactive but whose members log in daily would read as dormant. That is a silent analytics regression bought for no correctness gain.

**Server-side guard** in `infrastructure/lambda/registry/index.mjs`, in the `PUT` branch that already reads `existing` for exactly this purpose (`:85-92`):

```js
// Only the family's registered owner may move the canonical pointer. Members
// still write activity/metadata (lastLoginAt, country, beanpodSizeKb) — those
// fields are per-family facts any device can report. The pointer is not.
// Legacy rows with no ownerEmail fall open (today's behaviour) so nothing breaks.
// Normalised compare: `ownerEmail` originates from a user-editable member
// profile, so case/whitespace drift must not lock the real owner out.
const norm = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : null);
const pointerAccepted =
  !existing.ownerEmail || (!!norm(body.ownerEmail) && norm(body.ownerEmail) === norm(existing.ownerEmail));

const item = {
  familyId,
  provider:    pointerAccepted ? (body.provider || 'local') : (existing.provider || 'local'),
  fileId:      pointerAccepted ? (body.fileId || null)      : (existing.fileId ?? null),
  displayPath: pointerAccepted ? (body.displayPath || null) : (existing.displayPath ?? null),
  familyName:  body.familyName || existing.familyName || null,
  createdAt:   existing.createdAt || now,
  ownerEmail:  existing.ownerEmail ?? body.ownerEmail ?? null,   // genuinely write-once now
  ...
};
if (!pointerAccepted) {
  // Domains only — never full member emails in CloudWatch.
  console.warn('[registry] pointer write refused', familyId,
    String(existing.ownerEmail).split('@')[1], String(body.ownerEmail).split('@')[1]);
}
...
return response(200, { success: true, pointerAccepted }, event);
```

Why this is the sustainable choice:

- **The invariant lives in one place**, next to the data it protects, in the same `existing`-merge block that already implements preserve-on-omit for four other fields (`index.mjs:100-127`). A reader of that block sees the whole merge policy at once.
- **It is unbypassable.** Old clients, new clients, a curl from a shell — all get the same answer. That is what "choke point" means.
- **It removes client code rather than adding it.** No `mayWriteFamilyRegistry()`, no role predicate duplicated into `syncStore`, no `usePermissions` import into a store, no watcher-leak hazard.
- **It fixes the documented-vs-actual mismatch** on `ownerEmail` noted in §Context: the comment at `:82-84` claims write-once; `body.ownerEmail ?? existing.ownerEmail` did not deliver it. Now it does, and `ownerEmail` becomes a trustworthy authority instead of a field the last writer wins.
- **It preserves member telemetry.** Member logins still stamp `lastLoginAt`; member devices still report `country` and `beanpodSizeKb`.
- **`familyName` also becomes preserve-on-omit** (`body.familyName || existing.familyName || null`) — today an omitted name nulls a stored one. One-word fix in the same block, no behaviour risk.

#### Requirement 11 — the refusal must not be silent to a device that _intended_ it (new, pass 4)

A server guard converts one silent failure into another unless the client can tell the two populations apart:

- **No intent.** `ensureRegistered()` from `LoginPage.vue:630`, and the `country` watcher (`syncStore.ts:3493`), both call `registerCurrentFamily({})` — they send pointer fields only because the payload is uniform, not because they mean to move anything. A refusal here is the **expected, correct, boring** case for every member device.
- **Intent.** `installProvider` (`:577`, reached from `migrateStorage`), `rebindPodFile` (§4), and `_registerCurrentFamilySync` (`:1267`, reached from `createNewFile`) are _deliberately_ repointing the family. A refusal here means the registry now disagrees with where the pod actually is — and `attemptSilentConfigHeal` will heal other members onto the stale pointer. **That is data at risk.**

The concrete lockout scenario this closes: `ownerEmail` comes from `authStore.currentUser?.email`, a member-profile field the user can edit (`FamilyMemberModal.vue`). An owner who edits their own email and then runs `migrateStorage` would, with a silent guard, move their pod while the registry keeps pointing at the abandoned file — and every other member would be healed onto it. Exactly the class of bug this plan exists to eliminate.

Implementation — one explicit boolean, no role predicate, no watcher:

```ts
function registerCurrentFamily(
  overrides: Partial<Pick<RegistryEntry, 'provider' | 'fileId' | 'displayPath'>> = {},
  opts: { isLoginEvent?: boolean; pointerIntent?: boolean } = {}
): void;
```

`pointerIntent: true` is passed at exactly the two `registerCurrentFamily` sites that mean it (`installProvider`, `rebindPodFile`). It is **explicit, not inferred from `Object.keys(overrides).length`** — deriving intent from payload shape is clever and would silently break the first time someone adds a fourth override field.

In `registerCurrentFamily`'s `.then`:

- `pointerAccepted === false && opts.pointerIntent` → `reportError({ surface:'pod-access', severity:'critical', message:'registry refused a deliberate pointer write', context:{ action:'registry-pointer-write-refused', provider_type, file_id_tail } })`. The Remediation runbook's first response is "check `ownerEmail` on that row".
- `pointerAccepted === false && !opts.pointerIntent` → `logEvent({ level:'info', surface:'pod-access', context:{ action:'registry-pointer-write-ignored', provider_type } })`. This is the population counter for devices sitting on a forked pod — **including stale clients that will never ship the client fix**.

`_registerCurrentFamilySync` (the `createNewFile` anchor) **throws** on `pointerAccepted === false`. It uses `registerFamilyOrThrow` precisely because the write is the recovery anchor (`:1263-1266`); a write whose pointer was dropped does not satisfy that invariant, so it must fail the create rather than leave a family whose registry row points somewhere else. Reachable only when a row already exists with a _different_ `ownerEmail` and no `fileId` (an abandoned partial onboarding by another account) — refusing there is correct, and `createNewFile`'s existing cleanup path handles it.

#### Client plumbing for `pointerAccepted`

`registryService.registerFamilyOrThrow` parses the response body and returns `{ pointerAccepted: boolean }`; `registerFamily` forwards it (returning `null` when it swallowed a failure). Two compatibility rules, both mandatory:

- **Absent field means accepted.** `pointerAccepted: parsed?.pointerAccepted !== false`. A self-hoster on an older Lambda (and the brief prod window between step 0 and step 3) must not generate false `critical` reports.
- **Registry disabled means accepted.** `if (!features.registry) return { pointerAccepted: true }` — preserves the documented "trivially satisfied" contract at `registryService.ts:70-73`.
- Body parse is defensive: `await res.json().catch(() => ({}))`.

**Deployment ordering (important, and the reason this is step 0).** The Lambda change is backward compatible in both directions — old clients keep sending full payloads and simply have their pointer fields ignored when they aren't the owner. It can therefore ship **first, standalone, as a hotfix**, halting registry propagation for already-forked devices _before_ the client fix reaches the app stores. Ship it, verify with the CloudWatch query in §Remediation, then land the client work.

**Client-side sites that remain unchanged and are covered by the server guard:** `ensureRegistered` from `LoginPage.vue:630`, the country watcher (`:3493`). `installProviderPersistOnly` (`:2600`) already omits the registry write by design — no change, but it stays on the audit checklist.

Add Lambda unit tests alongside the existing merge-semantics tests (`infrastructure/lambda/registry/index.test.mjs:133-143`, the `backward compatibility` describe block that already asserts `ownerEmail` preservation).

### 6. Canonical-mismatch detection — one surface, once per session, fail-open

#### 6a. Make "registry unreachable" distinguishable from "no such family"

The canonical check **must** fail open, and today it cannot know when to. `lookupFamily` collapses 404, non-2xx, and network throw into `null` (`registryService.ts:34-46`). Rather than special-case it in one caller, add the typed sibling and make the existing function a wrapper over it — one implementation, zero call-site churn:

```ts
export type RegistryLookup =
  | { status: 'found'; entry: RegistryEntry }
  | { status: 'absent' }
  | { status: 'unavailable'; error?: unknown };

export async function lookupFamilyResult(familyId: string): Promise<RegistryLookup>;
export async function lookupFamily(familyId: string): Promise<RegistryEntry | null> {
  const r = await lookupFamilyResult(familyId);
  return r.status === 'found' ? r.entry : null;
}
```

`lookupFamilyResult`'s `unavailable` branch logs `logEvent({ level:'warn', surface:'registry', context:{ action:'lookup-unavailable', http_status } })` — replacing today's bare `console.warn` (`:43`), which makes registry outages visible in the firehose for the first time.

**Three consumers on day one** (requirement 10 satisfied):

1. **The canonical check** (§6b) — `unavailable` and `absent` both mean "raise nothing".
2. **`attemptSilentConfigHeal`** (`syncStore.ts:2741-2748`) — adopt `lookupFamilyResult` and delete the unreachable `try/catch`. `unavailable` → `scheduleConfigHealRetry(familyId, 'registry-error')`; `absent` → `configHealTotalFailure`. This **restores the author's stated intent** (the dead catch proves retry was intended) and turns a registry outage from a non-retryable dead end back into a retry. Behaviour-preserving in the `found`/`absent` paths.
3. **`createNewFile`'s existing-pod guard** (`syncStore.ts:1425-1443`) — `unavailable` currently fails open into a create. **We deliberately keep it failing open**, and record why: blocking new-family creation during a registry outage would break offline/degraded onboarding for every new user, a far more common and more damaging failure than the narrow duplicate risk — and `createNewFile` is one of the two creation paths the binding constraint explicitly permits. What changes is that the residual risk becomes _countable_: replace the misleading `console.warn`-and-proceed with `logEvent({ level:'warn', surface:'syncStore.createNewFile', context:{ action:'existing-pod-check-unavailable' } })`. This decision is written here so nobody "hardens" it later without seeing the trade.

Also add `file_id_tail` to `configHealSucceeded`'s event when healing from a registry `fileId`, so a poisoned entry is traceable to the devices it reached.

#### 6b. The check itself

After a successful verification, fire-and-forget:

```
r = await registry.lookupFamilyResult(familyId)
if (r.status !== 'found') return                      // absent or unavailable → raise nothing
if (r.entry.provider === 'google_drive' && r.entry.fileId && r.entry.fileId !== provider.getFileId())
  → podAccessError = { ok:false, code:'CANONICAL_MISMATCH',
                       data: { canonicalFileId, canonicalName } }
```

Constraints:

- **Fail-open is mandatory**, and §6a is what makes it correct rather than accidental.
- Never `await` it on the load path and never let it throw into the load. It is a network round-trip; the user must not wait on it.
- **Run it at most once per family per session** — a module-scope `checkedCanonicalFor: string | null` in `syncStore`, cleared in `resetState()` (`:2290`) beside `configHealInFlight`. `verifyPodAccess` runs on every load path including `retry`, so an unguarded check turns a retry loop into a registry request loop.
- **`data` is view state, not telemetry.** `PodAccessFailure.data.canonicalFileId` holds a _full_ fileId because `switchToCanonical` needs it to call `rebindPodFile`. `logPodAccess` never spreads `data` into a report — it derives `file_id_tail` explicitly. `file_id` is not in `ALLOWED_CONTEXT_KEYS` and would be stripped with a console warn, but relying on the stripper is not a policy. One comment on the type says so.

#### 6c. One state, one renderer

`syncStore` gains exactly **one** new ref:

```ts
const podAccessError = ref<PodAccessFailure | null>(null);
```

and `src/components/common/PodAccessBanner.vue` — a `SaveFailureBanner`-shaped wrapper (`ErrorBanner` chrome + `resolveErrorView(POD_ACCESS_ERRORS, …)` for message/severity + the recovery handler map, using `usePickBeanpodFile` and `useGoogleReconnect` directly, exactly as `SaveFailureBanner.vue:6` and `GoogleReconnectToast.vue:13` do) — is mounted **once**, in `App.vue` immediately above `SaveFailureBanner` (`App.vue:1876`), with the same `&& !authStore.needsAuth` gate.

Recovery buttons follow `DurabilityBanner`/`SaveFailureBanner`'s on-colour button styling, **not** `BaseButton` variants — see §2 for why.

`LoadPodView` renders nothing. It sets store state and returns. Pass 2 had LoadPodView _and_ App.vue both rendering pod-access failures, which is two renderers for one condition: they drift, they can appear simultaneously, and every future copy change has to be made twice. Routing everything through the App-level banner also means the failure survives the transition off the login view — which is the whole point, since the user is now inside the app looking at data that isn't saving.

**Banner precedence is declared once**, as a single computed next to the existing `shouldShowSaveFailureBanner` (`syncStore.ts:241-244`), which already establishes the pattern (_"Banner is mutually exclusive with the GoogleReconnectToast"_):

```ts
// Precedence: GoogleReconnectToast > PodAccessBanner > SaveFailureBanner > DurabilityBanner.
// Pod-access failure is the root cause of any save failure it coexists with, so it wins.
const shouldShowPodAccessBanner = computed(
  () => podAccessError.value !== null && !showGoogleReconnect.value
);
```

and `shouldShowSaveFailureBanner` gains `&& !shouldShowPodAccessBanner.value`. Four banners, **one ordered list, in one place**, with the reason written down. Its tests go into the existing `src/stores/__tests__/syncStore.bannerVisibility.test.ts` (`:325` already covers the toast/save-failure exclusion) — not a new file.

Copy for `CANONICAL_MISMATCH`: _"you're working on a copy of your family's file — your changes aren't reaching your family"_, with `switchToCanonical` as the primary action. Per Assumption 7 the switch merges rather than discards, so the copy must **not** promise data loss — nor promise a merge in absolute terms; the copy says changes will be brought across and the file is left in place.

### 7. Never-silent contract

Every arm of `verifyPodAccess` returns a typed code; there is no `return` without either `{ ok:true }` + a `logEvent`, or `{ ok:false, code }` + a report. Concretely:

- **One logging call site.** `logPodAccess(result)` maps result → level/severity from a single table in `src/utils/podAccess.ts`, so the "which codes are critical" policy is data, not fifteen scattered `reportError` calls. Adding a code without a severity fails the build via the `satisfies` on the same registry.
- No bare `catch {}` anywhere in the new code. Every catch either classifies via `classifyDriveFailure` or reports.
- `LoadPodView.verifyPodAccess()` keeps its outer try/catch (a throw must never block the user reaching decrypted data), but the catch now sets `code: 'VERIFY_UNAVAILABLE'` on the store **and** `reportError`s — instead of today's `console.error` (`LoadPodView.vue:220`).
- Every `reportError` carries `surface: 'pod-access'`, the `error_code`, and `file_id_tail`. The banner's diagnostic affordance reuses `useJoinFlow.buildDiagnosticReport`'s shape (a pod-access variant: familyId tail, active fileId tail, registry fileId tail, provider type, canEdit, token validity, online).
- Every console line is prefixed `[syncStore.verifyPodAccess]` / `[podAccess]` so a developer can grep it.
- **Three previously-silent paths are closed** beyond the verification itself: `registryService.lookupFamily`'s swallow (§6a), `createNewFile`'s existing-pod lookup failure (§6a), and a server-refused deliberate pointer write (§5).
- The **only** intentional swallow is the fire-and-forget canonical check, and it logs on the `unavailable` path.

### 8. Exhaustive creation audit

Enumerate every path that can create or switch the active pod; assert each is an explicit user action or removed.

| Path                                                                | Disposition                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reHomeToOwnDrive` (`:2391`)                                        | **removed**                                                                                                                                                                                           |
| `mintFreshOwnDrive` (`:2361`)                                       | **removed**                                                                                                                                                                                           |
| `configureSyncFileGoogleDrive` (`:2369`, export `:3552`)            | **removed**                                                                                                                                                                                           |
| `createNewFile`                                                     | keep — explicit user action. Its existing-pod guard deliberately fails open on registry outage; now countable (§6a).                                                                                  |
| `migrateStorage` → `buildProviderForTarget` (`:2806`) → `createNew` | keep — explicit user action, owner-gated in UI (`SettingsPage.vue:81, 1473`). Its `installProvider` registry write now carries `pointerIntent:true`, so a server refusal pages (§5).                  |
| `connectStorage.connectDriveStorage` → `createNew`                  | keep — create-wizard only (`CreatePodView`, `ResumePodSetup`)                                                                                                                                         |
| `connectStorage.adoptDriveStub`                                     | keep — adopts, never creates; create-flow only                                                                                                                                                        |
| `useDriveCollisionRecovery.resolveDriveCollision`                   | keep — create-flow only                                                                                                                                                                               |
| `attemptSilentConfigHeal` (`:2723`)                                 | keep — read/adopt only, never creates (verified: `configHealTotalFailure` at `:2786` refuses to guess rather than searching Drive). Registry-outage path repaired (§6a); adds `file_id_tail` on heal. |
| `rebindPodFile` (was `recoverFromMissingFile`, `:3191`)             | keep + harden (§4) — binds only to a familyId-matching existing file                                                                                                                                  |
| `googleDriveProvider.createNew` (`:490`)                            | the one mint primitive; reachable only from the two kept user actions + the create wizard                                                                                                             |
| `googleDriveProvider.writeAux` (`:399`)                             | out of scope — attachments, not pods                                                                                                                                                                  |

Enforce mechanically: a test that imports `syncStore`, mocks `GoogleDriveProvider.createNew`, drives every `LoadPodView` load path, and asserts `mockCreateNew` was never called. This test is the durable guarantee — it will still be failing loudly in two years when someone "improves" recovery.

### 9. Complexity budget

Hard ceilings for this change. If the implementation exceeds any of them, stop and re-plan rather than absorb it.

| Budget                                       | Ceiling                                                                                                                                                                             | Rationale                                                                                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Net-new source files                         | **3** (`utils/podAccess.ts`, `utils/structuredError.ts`, `components/common/PodAccessBanner.vue`)                                                                                   | Down from pass 3's 4 — `StructuredErrorPanel.vue` is dropped (§2): its second "consumer" would have required parameterising it into a second visual language.                                                                                         |
| New `syncStore` reactive state               | **1 ref** (`podAccessError`) + 1 computed (`shouldShowPodAccessBanner`) + 2 module-scope flags (`verifyInFlight`, `checkedCanonicalFor`), both reset in the existing `resetState()` | `syncStore.ts` is already 3605 lines. Every ref added to it is permanent.                                                                                                                                                                             |
| New abstractions with fewer than 2 consumers | **0**                                                                                                                                                                               | `resolveErrorView`: `JoinPodView` + `PodAccessBanner`. `lookupFamilyResult`: canonical check + `attemptSilentConfigHeal` + `createNewFile`.                                                                                                           |
| New test files                               | **2** (`utils/__tests__/podAccess.test.ts`, `utils/__tests__/structuredError.test.ts`)                                                                                              | Banner-precedence tests go into the existing `syncStore.bannerVisibility.test.ts`; Lambda tests into the existing `index.test.mjs`.                                                                                                                   |
| Max nesting depth in new functions           | **2**                                                                                                                                                                               | The function being replaced (`establishDurableHomeAfterLoad`, `:2456-2597`, 141 lines) reaches depth 5 and is the direct cause of this incident: the `// fall through to re-home` at `:2519` is only correct if you have the whole nest in your head. |
| Max length of any new function               | **40 lines**                                                                                                                                                                        | Forces the pure/orchestration split rather than one more mega-function in `syncStore`.                                                                                                                                                                |
| Net line change in `syncStore.ts`            | **negative**                                                                                                                                                                        | ~230 lines removed (`mintFreshOwnDrive`, `configureSyncFileGoogleDrive`, `reHomeToOwnDrive`, `establishDurableHomeAfterLoad`) vs ~100 added. The store must come out of this smaller.                                                                 |
| New generic type parameters                  | **0**                                                                                                                                                                               | See §2.                                                                                                                                                                                                                                               |
| Client-side role/permission predicates added | **0**                                                                                                                                                                               | See §5. `pointerIntent` is a call-site fact, not a role check.                                                                                                                                                                                        |

### 10. Implementation sequence

Five landable steps, each independently revertable, ordered so risk falls before the risky part lands.

| #     | Step                                                                                                                                                                                                                                                                                                                              | Ships                                                                                                                      | Safety net                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **0** | Lambda pointer guard (normalised email compare) + `pointerAccepted` in the response + `ownerEmail` genuinely write-once + `familyName` preserve-on-omit + refusal `console.warn` (domains only) (§5)                                                                                                                              | **Deploy immediately, standalone** — halts registry propagation for already-forked devices, including stale native clients | `infrastructure/lambda/registry/index.test.mjs`                                                                        |
| **1** | Extract `utils/structuredError.ts`; refactor `JoinPodView.vue`'s `currentErrorView` onto it; alias `JoinErrorEntry`. **No behaviour change.**                                                                                                                                                                                     | Client                                                                                                                     | Existing `JoinPodView` error tests must pass **unchanged**                                                             |
| **2** | `utils/podAccess.ts` (registry, classifier, evaluator, severity table) + `registryService.lookupFamilyResult` / `pointerAccepted` plumbing / `lookup-unavailable` logging. Pure + service-layer, no store consumers yet.                                                                                                          | Client                                                                                                                     | New table-driven unit tests; existing registryService tests                                                            |
| **3** | `syncStore`: delete the re-home trio; add `verifyPodAccess` + `podAccessError` + `verifyInFlight` + `checkedCanonicalFor`; harden and rename `rebindPodFile`; `pointerIntent` at the two intent sites + refusal reporting; adopt `lookupFamilyResult` in `attemptSilentConfigHeal` and `createNewFile`. `LoadPodView` sets state. | Client                                                                                                                     | Rewritten `syncStore.verifyPodAccess.test.ts`; the `createNew`-never-called regression test; existing configHeal tests |
| **4** | `PodAccessBanner.vue` + `App.vue` mount + banner precedence + `uiStrings` + `SaveFailureBanner` typed-result update.                                                                                                                                                                                                              | Client                                                                                                                     | Component tests + `syncStore.bannerVisibility.test.ts` + manual two-device pass                                        |

Steps 1 and 2 are pure preparation with zero behaviour change; if step 3 needs to be reverted in a hurry, they stay.

## Files Affected

- `infrastructure/lambda/registry/index.mjs` — **step 0**: pointer guard keyed on normalised `ownerEmail`, `ownerEmail` made genuinely write-once, `familyName` preserve-on-omit, refusal warn (domains only), `pointerAccepted` in the PUT response
- `infrastructure/lambda/registry/index.test.mjs` — pointer-guard tests (owner accepted / non-owner ignored / legacy null-owner fails open / new row accepted / case-and-whitespace drift accepted / member telemetry still written)
- `src/utils/structuredError.ts` — **new**: `StructuredErrorEntry`, `StructuredErrorView`, `resolveErrorView` (extracted verbatim from `JoinPodView.vue:86-101`)
- `src/components/login/JoinPodView.vue` — `currentErrorView` refactored onto `resolveErrorView` (no behaviour change, markup untouched)
- `src/composables/useJoinFlow.ts` — `JoinErrorEntry` aliased to the shared `StructuredErrorEntry`
- `src/utils/podAccess.ts` — **new**: `PodAccessErrorCode`, `POD_ACCESS_ERRORS`, `POD_ACCESS_SEVERITY`, `classifyDriveFailure`, `evaluatePodMetadata`
- `src/stores/syncStore.ts` — remove `reHomeToOwnDrive` / `mintFreshOwnDrive` / `configureSyncFileGoogleDrive` + the `resolveExistingBeanpod` import (`:34`); add `verifyPodAccess` + `podAccessError` + `shouldShowPodAccessBanner` + `verifyInFlight` + `checkedCanonicalFor` (both reset in `resetState`, `:2290`); rename and harden `recoverFromMissingFile` → `rebindPodFile` (persist + registry write + typed result + reported catch + clears `podAccessError`); add `opts.pointerIntent` to `registerCurrentFamily` + refusal reporting; `_registerCurrentFamilySync` throws on refusal; adopt `lookupFamilyResult` in `attemptSilentConfigHeal` (`:2741`, deletes dead catch) and `createNewFile` (`:1425`); `file_id_tail` on `configHealSucceeded`
- `src/components/login/LoadPodView.vue` — `ensureDurableHome` → `verifyPodAccess` (2 call sites: `:225`, `:485`); sets store state, renders nothing
- `src/components/common/PodAccessBanner.vue` — **new**: `ErrorBanner` chrome + `resolveErrorView(POD_ACCESS_ERRORS, …)` + the recovery handler map (`usePickBeanpodFile`, `useGoogleReconnect`)
- `src/App.vue` — mount `PodAccessBanner` above `SaveFailureBanner` (`:1876`), same `!authStore.needsAuth` gate
- `src/components/google/SaveFailureBanner.vue` — updated for `rebindPodFile`'s typed result (`:37`)
- `src/services/registry/registryService.ts` — `lookupFamilyResult` + `lookupFamily` as its wrapper + `lookup-unavailable` logging; `registerFamilyOrThrow` / `registerFamily` return `{ pointerAccepted }` with absent-means-accepted and registry-disabled-means-accepted
- `src/services/translation/uiStrings.ts` — all new strings (`en` + `beanie`), keyed `podAccess.error.*` / `podAccess.recovery.*` / `podAccess.bannerTitle`
- `src/stores/__tests__/syncStore.establishDurableHome.test.ts` → renamed `syncStore.verifyPodAccess.test.ts`, rewritten
- `src/stores/__tests__/syncStore.bannerVisibility.test.ts` — precedence tests added (existing file, `:325`)
- `src/components/login/__tests__/LoadPodView.test.ts` — updated (`:71`, `:348`)
- `src/components/google/__tests__/SaveFailureBanner.test.ts` — updated mock (`:50`)
- `src/utils/__tests__/podAccess.test.ts`, `src/utils/__tests__/structuredError.test.ts` — **new**
- `docs/adr/` — amendment reversing the B3/B4/B5/B6 decision

**Not touched (verified still reachable):** `connectStorage.resolveExistingBeanpod`, `adoptDriveStub`, `isStubBeanpod`, `useDriveCollisionRecovery`, `installProviderPersistOnly`.

**Deliberately NOT created:** `src/composables/usePodAccess.ts`, `src/composables/useStructuredError.ts` (no reactivity, lifecycle, or store access — pure utils, and a store importing a composable is a dependency edge we do not need), and `src/components/common/StructuredErrorPanel.vue` (§2 — no genuine second consumer).

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `how-it-works`
- **Slug**: the existing article covering the family data file / sharing model
- **Title**: (existing)
- **Scope**: Clarify that a family shares exactly one data file, that members do not own it, and what the app does when it can't reach that file — it asks you to restore access, and never makes a second copy.
- **Notes**: Must not imply a duplicate is ever created. Document the "you're on a copy" banner: what it means, and that the fix is "switch to your family's file" / "pick your family's file", not "make a new one". Note that switching brings your recent changes across and leaves the copy in place.

## Observability Coverage

**Surface**: keep `load-existing-family` (preserves CloudWatch continuity for retroactive discovery of already-forked families) and add `pod-access` for the verification outcome.

**Events** (all pod-access events emitted from the single `logPodAccess` call site, driven by the severity table in `src/utils/podAccess.ts`):

- Success — `logEvent({ level:'info', surface:'pod-access', context:{ action:'kept-home', provider_type } })` on **every** successful verification, so the failure _rate_ is measurable.
- Each failure code — `logEvent`/`reportError` with `context: { action:'<code>', error_code, http_status, provider_type, file_id_tail }`.
- `CANONICAL_MISMATCH` → `reportError({ severity:'critical' })`. A member writing to a non-canonical pod is live data divergence — the definition of "data at risk".
- `NO_HOME` → `critical` (decrypted, unsaveable).
- Rebind failure inside `rebindPodFile` → `critical` (user action failed).
- `OFFLINE` / `VERIFY_UNAVAILABLE` → `warning`, firehose only, no page.
- `registry-pointer-write-refused` → **`critical`** (deliberate pointer write rejected by the server — registry now disagrees with reality).
- `registry-pointer-write-ignored` → `info`. Counts server-refused ambient pointer writes, which is the population of devices on a forked pod — including stale clients that will never ship the client fix.
- `registry lookup-unavailable` → `warning` (new; today invisible).
- `existing-pod-check-unavailable` (createNewFile) → `warning` (new; makes the deliberate fail-open countable).
- Lambda-side: `console.warn` when `pointerAccepted === false`, with `familyId` and both emails' **domains only** (never full member emails in CloudWatch).

**Allowlist**: all keys used are already in `ALLOWED_CONTEXT_KEYS` (`diagnosticContext.ts:61-95`, verified) — **no allowlist change, no `infrastructure/lambda/telemetry/index.mjs` mirror update, no `docs/runbooks/native-store-submission.md` / `PrivacyInfo.xcprivacy` / privacy-page update.** `PodAccessFailure.data.canonicalFileId` is view state and is never spread into a report (§6b).

**Retroactive discovery**: `surface = "load-existing-family" and action in ["foreign-file-load","ownership-unknown","re-homed","adopted-existing"]` finds every family already forked by the old code. The surface name is preserved deliberately for this query.

## Remediation (operational, not code)

1. **Deploy step 0 first.** The Lambda pointer guard stops further registry poisoning immediately, including from devices running the old client. Do this before anything else.
2. **Find affected families** — run the CloudWatch query above over the window since 2026-07-13. Each hit is a member who may be on a private copy; correlate by `family_id`.
3. **Audit and correct `ownerEmail` BEFORE relying on the guard.** The pre-fix `body.ownerEmail ?? existing.ownerEmail` did not enforce write-once, so a member's email may be sitting in that field. If it is, the new guard would authorise the **wrong** account and lock the real owner out. For every family surfaced in step 2, confirm `ownerEmail` matches the family creator (cross-check `createdAt` against the creator's account) and correct it by direct DynamoDB write. There is intentionally no admin API endpoint for this — adding one would be new attack surface for a one-off repair.
4. **Registry repair** — for any family whose entry was repointed, verify `fileId` / `displayPath` still name the owner's original file and correct it (direct DynamoDB write, or a PUT as the owner account once step 3 is done). This must happen **before** other members trigger a config-heal, or `attemptSilentConfigHeal` (`syncStore.ts:2760-2770`) will heal them onto the wrong file.
5. **Per-member recovery** — greg's validated manual procedure (full sign-out → sign back in → select the original shared file) still works. Once the client fix ships, the in-app `pickFamilyFile` / `switchToCanonical` actions do the same thing without the sign-out, and (per Assumption 7) carry the copy's edits across via the normal Automerge merge. Members already recovered by the manual sign-out procedure lost the in-memory doc, so their divergent edits live only in the orphaned copy — merging those is manual.
6. **Orphan cleanup** — leave duplicate `<name>-<familyId>.beanpod` files in place until reconciled, then remove by hand.
7. **Watch `registry-pointer-write-refused`** after step 3 ships. Any hit means a device that _meant_ to move a pointer was blocked — either a genuine attack/bug, or an `ownerEmail` row that still needs correcting.

## Acceptance Criteria

- [ ] No code path outside `createNewFile`, `migrateStorage`, and the create wizard can create a `.beanpod`
- [ ] A non-owner member loading the family's shared file keeps that file as their home, in every load path
- [ ] `ownedByMe` is no longer requested or read anywhere on the load path; nested `capabilities.canEdit` is the writability signal
- [ ] Verification never triggers interactive OAuth (uses `tryGetSilentToken`, never `requestAccessToken`)
- [ ] A probe failure (403/404/408/5xx/offline/token/unreadable-metadata) never changes the pod binding
- [ ] Unreadable metadata yields `VERIFY_UNAVAILABLE` (warning), not a false `PERMISSION_DENIED` (critical)
- [ ] A non-owner device cannot move the family's canonical pointer — verified against the Lambda, from `installProvider`, from login, from the country watcher, and from a raw PUT
- [ ] A **deliberate** pointer write that the server refuses produces a `critical` report; an ambient one produces an `info` count
- [ ] `ownerEmail` is genuinely write-once, compared case/whitespace-insensitively, and the code matches its comment
- [ ] Every access failure shows a plain-language cause, a retry, and an action that restores access to the **original** file
- [ ] No UI or code path offers to create a duplicate
- [ ] A provider-less restore reaches `pickFamilyFile` → `rebindPodFile`, and the rebind **persists across a reload**
- [ ] A member on a non-canonical pod is told so, and can switch in one tap (`switchToCanonical`), with automatic fallback to the picker if scope is missing
- [ ] `JoinPodView` and the pod-access surface derive their error view through **one** function (`resolveErrorView`); no shared component is introduced without a genuine second consumer
- [ ] Exactly **one** component renders pod-access failures, mounted once in `App.vue`; `LoadPodView` renders none
- [ ] Banner precedence is declared in one place, with the ordering written down, tested in the existing `bannerVisibility` file
- [ ] `rebindPodFile` returns no untranslated English prose, and clears all recovery banner state in one block
- [ ] The canonical check runs at most once per family per session, even across repeated `retry`; overlapping `verifyPodAccess` calls are impossible
- [ ] `registry.lookupFamilyResult` distinguishes absent from unavailable; `attemptSilentConfigHeal` retries on unavailable instead of declaring total failure; the dead `try/catch` at `syncStore.ts:2745` is gone
- [ ] `createNewFile`'s deliberate fail-open on registry outage is unchanged in behaviour and now emits a countable warn
- [ ] Every complexity budget in §9 is met — including a **net negative** line change in `syncStore.ts`
- [ ] Tests at `:352`/`:372` inverted; a regression test asserts no load path calls `createNew`
- [ ] Help Center article updated
- [ ] Observability events fire with the stated `surface`/`context`; no new allowlist key needed; no full fileId reaches a report

## Testing Plan

1. **Unit — pure evaluator** (`utils/podAccess.test.ts`, no Pinia, no mocks) — `evaluatePodMetadata` over the **nested** shapes `{capabilities:{canEdit:true}}`, `{capabilities:{canEdit:false}}`, `{capabilities:{canEdit:true},trashed:true}`, `{}`, and the **flat** `{canEdit:true}` → `ok` / `PERMISSION_DENIED` / `FILE_NOT_FOUND` / `VERIFY_UNAVAILABLE` / `VERIFY_UNAVAILABLE`. The flat case exists specifically to pin the nested-field bug.
2. **Unit — classifier** — table test over `DriveFileNotFoundError(403)`, `(404)`, `DriveApiError(401)`, `(408)`, `(500)`, `TokenExpiredError`, `navigator.onLine=false`, and an unknown `Error` → the expected codes. Explicitly asserts the 403 case is _not_ classified as `FILE_NOT_FOUND` despite the class name.
3. **Unit — severity table** — every `PodAccessErrorCode` has a severity; a compile-time `satisfies` plus a runtime `Object.keys` parity assertion.
4. **Unit — verification** — `canEdit:true` + not owned → kept (assert `getFileMetadata` was called with exactly `'capabilities/canEdit,trashed'`, that `tryGetSilentToken` was used and `requestAccessToken` was **not**, and that the string `ownedByMe` appears nowhere in the module). `canEdit:false` → `PERMISSION_DENIED`, binding unchanged. `trashed:true` → `FILE_NOT_FOUND`. Probe throws 408/500 → `VERIFY_UNAVAILABLE`, binding unchanged. No silent token → `CONSENT_EXPIRED`. No provider / wrong-family provider → `NO_HOME`. Two concurrent calls → one probe. Every case asserts `mockCreateNew` not called.
5. **Lambda pointer guard** (`index.test.mjs`) — new row (no `existing`) → pointer written; matching `ownerEmail` → pointer written; `' Owner@X.com '` vs `'owner@x.com'` → pointer written (normalisation); different `ownerEmail` → pointer preserved, `pointerAccepted:false` returned, `lastLoginAt`/`country`/`beanpodSizeKb`/`familyName` **still updated**; legacy row with `ownerEmail:null` → pointer written (fail-open); `body.ownerEmail` null against a row that has one → pointer preserved; existing `ownerEmail` never overwritten by a different non-null body value.
6. **Pointer-intent reporting** — refused write with `pointerIntent:true` → `reportError` `critical`; refused write with no intent → `logEvent` `info`; response missing `pointerAccepted` → treated as accepted, no report; `features.registry` off → accepted, no report; `_registerCurrentFamilySync` throws on refusal.
7. **Rebind durability** — `rebindPodFile` calls `provider.persist(familyId)` before `setProvider`; a familyId-mismatched file is rejected without touching the provider; a failure `reportError`s `critical` and returns a typed code, not prose; success clears `podAccessError`, `driveFileNotFound`, and `showSaveFailureBanner` together; no `syncNow` is issued.
8. **Canonical mismatch** — registry `fileId` differs → `CANONICAL_MISMATCH` + `critical`; `status:'absent'` → no mismatch; `status:'unavailable'` → no mismatch; three consecutive `verifyPodAccess` calls in one session issue **one** `lookupFamilyResult` request; `resetState()` clears the guard.
9. **Registry lookup typing** — `lookupFamily` still returns `null` for absent _and_ unavailable (contract preserved); `attemptSilentConfigHeal` schedules a retry on `unavailable` and calls `configHealTotalFailure` only on `absent`.
10. **Banner precedence** (in `syncStore.bannerVisibility.test.ts`) — pod-access failure + save failure simultaneously → only `PodAccessBanner` renders; `showGoogleReconnect` → neither; `podAccessError` set on the login route survives the transition and renders once `showLayout` is true.
11. **Regression** — `GoogleDriveProvider.createNew` is never called from any `LoadPodView` load path.
12. **Refactor safety** — existing `JoinPodView` error tests pass **unchanged** against `resolveErrorView` (this is the gate for step 1 landing at all).
13. **Integration** — simulate the incident: join as member, evict the provider config, re-load. Assert same fileId, no new Drive file, no registry pointer mutation, and that the binding survives a second simulated boot. Then simulate the mismatch: point the registry at a different fileId, `switchToCanonical`, assert the in-memory doc's local edits are present in the file written after the switch (Assumption 7).
14. **Manual, two devices** — owner + member on the shared file; member signs out and back in; both edit; changes converge; no second file appears in Drive.
15. **Manual, revoked sharing** — owner unshares mid-session; member sees `PERMISSION_DENIED` with a working `pickFamilyFile`, and no duplicate.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the root-cause investigation — verify-only replacement for re-homing, typed failure taxonomy, registry owner gate, canonical-mismatch detection, remediation runbook.
- **Pass 2 (DRY / error handling)**: Verified every reuse claim against source. Corrected two factual errors that would have broken implementation: `migrateStorage` cannot serve the `NO_HOME` case, and `resolveExistingBeanpod`'s reject arm stays reachable via `useDriveCollisionRecovery`. Moved the registry gate from `installProvider` to `registerCurrentFamily` after finding two further write sites. Replaced four invented recovery actions with the existing `recoverFromMissingFile` + `usePickBeanpodFile` pair, and found the missing `provider.persist` that made recovery non-durable. Committed to extracting the shared error rendering from `JoinPodView`. Closed three silent failures.
- **Pass 3 (Sustainability / maintainability / reliability)**: Moved the pointer guard from the client to the registry Lambda after reading `infrastructure/lambda/registry/index.mjs:78-135` — the client gate leaked a watcher per call (`usePermissions.ts:44`), could not bind already-deployed native clients, and would have silently killed member-device `lastLoginAt`/`country` telemetry. Corrected the `ownerEmail` claim (documented write-once but not enforced). Corrected `ensureDurableHome`'s call-site count from eight to two. Collapsed two pod-access renderers into one App-level banner with a declared precedence order. Relocated the new modules from `composables/` to `utils/` and dropped the two-parameter generic. Added `switchToCanonical` as a second argument source for the _same_ rebind primitive. Renamed `recoverFromMissingFile` → `rebindPodFile`. Bounded the canonical check to once per family per session. Added a §9 complexity budget and a §10 five-step landing sequence that ships the propagation hotfix first.
- **Pass 4 (Fresh-eyes final sweep)**: Re-verified every line reference against source. **Dropped `StructuredErrorPanel.vue`** — reading `ErrorBanner.vue` (full-bleed white-on-red bar with title/message/actions slots) against `JoinPodView.vue:252-295` (inline `red-50` tinted card with `BaseButton` variants) showed the two surfaces are different visual languages; `DurabilityBanner.vue`'s own comment warns that banner-chrome buttons must not reuse the card styling. Extracting only `resolveErrorView` keeps the genuine duplication (view derivation) shared and drops a component whose "second consumer" was cosmetic — net-new files 4 → 3. **Caught a latent implementation bug**: `capabilities/canEdit` is a _nested_ Drive field, so `meta.canEdit` would be `undefined` on every healthy file; the evaluator must read `meta.capabilities?.canEdit`, and a test now pins the flat shape as a failure. **Changed unreadable metadata from `PERMISSION_DENIED` (critical) to `VERIFY_UNAVAILABLE` (warning)** — since no arm mutates anything, failing closed buys no safety and only manufactures false pages. **Replaced `requestAccessToken()` with `tryGetSilentToken()`** so a background durability check can never pop a consent dialog mid-load. **Added requirement 11 and `pointerIntent`**: the server guard, as written in pass 3, converted a member's silent overwrite into an owner's silent _drop_ — an owner who edits their own profile email (the source of `ownerEmail`) and then runs `migrateStorage` would move their pod while the registry kept pointing at the abandoned file, and every other member would be healed onto it. Two explicit call sites now mark deliberate pointer writes; a refused deliberate write pages `critical`, an ambient one counts `info`, and `_registerCurrentFamilySync` throws. Added normalised email comparison for the same reason. **Found three adjacent defects while verifying and folded in the two that belong**: `registryService.lookupFamily` cannot distinguish absent from unavailable (`:34-46`), which makes `attemptSilentConfigHeal`'s registry-retry path dead code (`syncStore.ts:2745` catches a function documented at `:3048` as never throwing) — fixed via `lookupFamilyResult` with three real consumers; and `createNewFile`'s existing-pod guard fails open on registry outage (`:1425`), which is **deliberately left open** (blocking offline onboarding is worse) but is now countable, with the trade written down so nobody "hardens" it blindly. Added a `verifyInFlight` guard so repeated `retry` taps cannot race conflicting state. Specified `podAccessError`'s full lifecycle (cleared in `rebindPodFile`'s existing single clearing block; flags reset in the existing `resetState()`). Documented that `App.vue`'s banner region is inside `v-if="showLayout"` and `!authStore.needsAuth`, why that is correct, and added a test that the state survives the route transition. Routed banner-precedence tests into the existing `syncStore.bannerVisibility.test.ts` rather than a new file. Verified via `syncService.setFamilyKey` (`:523-530`) and `replaceEnvelope` (`:167-172`) that `rebindPodFile` retains the in-memory doc, which makes `switchToCanonical` a merge rather than a discard — corrected the Remediation copy accordingly and forbade a post-rebind `syncNow` (the exact blind-upload mechanism that made the fork invisible).

## Prompt Log

> **No GitHub issue created.** This plan was approved for direct implementation, so the full prompt history lives here.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (2026-08-10)

> Let's review and investigate another issue - one of my family members is using the app on her android phone. the family data file was shared to her gmail account and she joined the family through a family joining link, and authenticated to google through the gmail account where we shared the beanpod file. I'm not sure how it happened, but she ended up working on a copy/duplicate of the family file that was completely separate from the one the rest of us were working on and our files diverged.
>
> She didn't notice as the data looked exactly the same, and it wasn't recognized until she realized todo items she was adding on her side were not showing up for he rst of the family, as we were on different data files.
>
> i fixed this by logging her out completely, logging back in with her account. i could now see two family data files with almost the same name (i.e. family data file.beanpod and family data file - z1234sx.beandpod or something like that) and selecting the original shared family data file.
>
> As mentioned above i don't know how this happened but she was totally unaare of the change, and the fact that this can happen is very dangerous - it should _never_ be possible to deviate from the original beanpod file that you loaded unless you have explicitly logged off and created a NEW family pod file. It seems that what happened was a duplicate file was created without any approval or explicit action, perhaps due to some network issue or instability, not sure, and the app silently switched to that file. this is very dangerous.
>
> please do a full a comprehensive, holistic investigationof the above issue to determine the root cause and fix

### Follow-up 1 — the binding directive (2026-08-10)

> yes, run beanies-plan. no silent re-home ever, in any situation. there shold not be anything needed to ask the user - i can't think of any scenario where it would make sense to give the user an option to create a duplicate of their beanpod file in a new place, causing their data to diverge. if the file cannot be read or accessed, it simply results in an error and option to retry, and a clear, user readable message about what happened (i.e. connectivity issues, ownership issues, need to consent again to google, etc) - something clear with an action the user can take to re-establish connectivyt and write/edit access to their family data file, but never a question about whether a new one shoiuld be created. this should not be an option to the user or in the code from what I can tell, unless you feel differently and can explain why this makes sense.

**Response to the "unless you feel differently" invitation:** agreed, with one nuance carried into the plan rather than treated as disagreement — removing the automatic path leaves the #47 restored-backup case (native `<input type=file>`, which stages an envelope with no provider at all) needing an _explicit_ affordance so it does not become a read-only dead end. That is satisfied by `rebindPodFile` via an explicit user file-pick, which is structurally incapable of creating a file, and never by an automatic mint.

</details>

## Post-approval amendment (2026-08-10, during implementation)

Greg asked whether `ownerEmail` is meant to be the family admin's email, and what happens when that user changes it. Investigating produced two evidence-backed corrections to the plan:

1. **`ownerEmail` was never a permission field.** It was added in `bb1069e3` (2026-04-12) as an ops/contact capture alongside the newsletter opt-in, and holds the signed-in member's _profile_ email — user-editable in the app. Using it as the pointer authority (as §5 specified) meant an owner who edited their email would be refused on their next pointer write with no way back, since the field is write-once. **Fixed by introducing `ownerMemberId`** (stable UUID, survives profile edits) as the authority, with `ownerEmail` retained as the legacy authority for rows registered before this change and as the ops/contact field it always was. Legacy rows upgrade themselves on the owner's next accepted write; a non-owner cannot claim the field on a legacy row. This had to land BEFORE the terraform apply — write-once means the choice of authority field is baked in for every active family the moment the guard ships.

2. **The 9 prod rows with a null `ownerEmail` also have a null `createdAt`.** Both fields were added in the same 2026-04-12 commit, and any PUT since would have stamped `createdAt` — so those families registered before the field existed and have not written to the registry since. They are dormant, not corrupt. **Decision: do not backfill them.** The stored value must match what the client sends (the member's profile email / member id); a backfilled address that doesn't match would lock a returning family out of their own pointer with no in-app recovery — strictly worse than the current fall-open.

Also found and removed during the registry inspection: a stale row (`6a08e644`, familyName "Test", written once on 2026-07-13 — the day the re-home work shipped) whose pointer was greg's real family's `.beanpod`. Two familyIds, one file. Deleted.
