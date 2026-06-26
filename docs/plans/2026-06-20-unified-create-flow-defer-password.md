# Plan: Unified create-a-family flow — defer the password to after storage connect, and give every user the add-members step

> Date: 2026-06-20
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-20-unified-create-flow-defer-password.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is embedded under `## Prompt Log`.

## User Story

As a new user creating a family — on iPhone **or** desktop — I want to enter my password **once**, after connecting storage, and always get the **add-family-members** step, so onboarding isn't a confusing double-password and I don't land in the app with nobody to assign to accounts and activities.

## Context

### Two symptoms, one root cause

On iOS, connecting Google Drive **must** use a full-page redirect (popups are blocked/unreliable — ADR-026). That redirect **reloads the whole app mid-wizard**, destroying all in-memory state. On return, the app sees an _authenticated session with no pod file yet_ (`needsPodSetup`) and routes to **`ResumePodSetup`** — the minimal "recovery" screen. That screen:

- **re-asks the password** (the in-memory password cache died in the reload, and we correctly never stash the secret) → the **double-password**, and
- writes the pod and routes straight to `/nook` → it has **no add-members phase**, so iPhone users skip adding their family entirely.

Desktop avoids both because the Drive **popup** doesn't reload the page, so `CreatePodView` sails through step 2 → step 3 (members) normally.

So the recovery screen — built as a _fallback_ for half-finished onboarding — is hit on **every** iPhone create, and it bypasses everything after the storage step (the password confirmation AND the members step).

### Why deferring the password is the right fix (and is safe)

Verified in the code:

- **`authStore.signUp()`** (`authStore.ts:503`) only **hashes** the password (`hashPassword` → the owner member's `passwordHash` via `buildOwnerDoc`, `:534-535`) and builds the in-memory owner doc + session + `podCreated=false`. It does **no** key derivation.
- **`syncStore.createNewFile(…, password, …)`** (`syncStore.ts:1135`) is where the password actually does crypto: PBKDF2 → AES-KW wrap the family key → write the V4 `.beanpod` envelope. **This is the only step that genuinely needs the plaintext password**, and it runs _after_ storage is connected.
- Connecting Drive needs the **Google OAuth token only**, not the password (`connectStorage.ts`).

So the password is needed at **pod-write time**, never at storage-connect time — collect it **once, after** the storage connect, for **all** users. This also lowers step-1 friction (identity only).

### The unification that makes this clean

`ResumePodSetup` **already owns the entire post-connect finish minus members**, verified at `ResumePodSetup.vue`: the `identity` phase collects name + password → `handleIdentityNext` (`:321`) calls `rehydrateOwnerDoc(name, password)` (`:326`, sets the real `passwordHash`) → `finishOnDrive` (`:416`, full Drive connect + name-collision/adopt-existing recovery + all error branches) → `finalizePod` (`:362`, `createNewFile` + its typed-`reason` error surfacing). It also already owns the local-file finish (`handleConnectLocal`, `:537`) and the non-destructive auto-load path.

**The only thing `ResumePodSetup` lacks is the add-members step.** The add-members UI + `handleAddMember`/`createMember` logic lives **only** in `CreatePodView` step 3 (`:498-564` script, `:1053-1252` template). So the least-duplication unification is **shape B**: make `ResumePodSetup` the single post-connect finish surface, extract the members UI from `CreatePodView` into a shared sub-component it renders after the pod write, and have `CreatePodView` (desktop) route into that same finish surface after storage connects. This deletes — not duplicates — the create-completion logic in `CreatePodView` (its `createNewFile` call + members step), because every piece already exists once in `ResumePodSetup`.

## Requirements

1. **Step 1 = identity only.** `CreatePodView` step 1 collects **family name + owner name + email** — **no password / confirm-password fields.** Lower friction; nothing secret committed before the first real action.
2. **The "🫘 New family pod started!" Slack ping STILL fires on step-1 completion** (greg's hard requirement). Unchanged trigger point and copy (`CreatePodView.vue:169-171`).
3. **Step 2 = connect storage** (Drive redirect on iOS / Drive popup on desktop / local file) — unchanged transport, no password involved.
4. **Finish phase (post-connect) = set password ONCE → write the pod → add members.** Runs **inline on the finish surface** on desktop (no reload) and **post-redirect** on iOS (the app returns into this same finish surface, not a dead-end recovery screen). The password is entered exactly once, by every user.
5. **The add-members step runs for EVERY user**, including iPhone — before landing in the onboarding wizard.
6. **The "🎉 Family pod created!" ping + `markPodCreated()` continue to fire from `syncStore.createNewFile()`** (ping at `syncStore.ts:1305`, `markPodCreated` at `:1291`) after the pod is actually written — unchanged.
7. **No secret is ever stashed across the redirect.** The password is collected fresh in the finish phase, which on iOS runs _after_ the redirect returns.
8. **No regression** to: join-a-family, load-existing-pod, Settings→Reconnect, local-file storage, the desktop popup path, the auto-load/retry recovery paths, or the adopt-existing collision recovery. The `signUp` idempotency guard must still hold.
9. **`onboardingCompleted=false`** stays set (it's inside `buildOwnerDoc`, `:466`, so it survives both the fresh and rehydrate paths); members added in the finish phase persist into the pod before `/nook`.

## Important Notes & Caveats

- **The password's two consumers, both deferrable:** (a) the owner member's `passwordHash` (set today inside `signUp`→`buildOwnerDoc`); (b) the family-key derivation in `createNewFile`. BOTH move to the finish phase. `rehydrateOwnerDoc(name, password)` (`authStore.ts:479`) **already** computes `hashPassword(password)` (`:487`) and re-runs `buildOwnerDoc` on the stable `currentUser.memberId` — reuse it; do not write a parallel "set owner passwordHash" path. This is what the finish surface already calls.

- **`signUp` must create the session/family/owner WITHOUT a usable password — and the empty-hash window is verified safe.** Add a `deferPassword` path to the SINGLE existing `signUp`/`buildOwnerDoc` (no clone). When deferred, skip `hashPassword(params.password)` (`:534`) and pass `passwordHash: DEFERRED_PASSWORD_HASH` (a single named `''` constant co-located with `buildOwnerDoc`, so the sentinel is greppable and the fail-closed guard in `createNewFile` references the same constant). The `signUp` param becomes a **discriminated union** so the two modes can't be mixed: `{ deferPassword: true; password?: never } | { deferPassword?: false; password: string }`. Verified readers of the owner's `passwordHash` between step-1 `signUp` and the finish-phase `createNewFile`:
  - `signIn` (`authStore.ts:379`), `ReauthChallenge.vue:149`, `PickBeanView.vue:40`, `ChangePasswordSettings.vue:38` — **all post-pod surfaces** (member-select / settings), unreachable in the pre-pod create window. None run.
  - `familyStore.owner` (`familyStore.ts:23`) keys off `role === 'owner'`, **not** `passwordHash` — the owner card on the members step renders fine.
  - **WATCH (verified — fresh-eyes 2026-06-26):** `buildOwnerDoc` passes `requiresPassword: false` literally (`authStore.ts:453`), but `familyMemberRepository.applyDefaults` (`:27`) **derives `requiresPassword = !member.passwordHash` on EVERY read** via the repo `transform` — it is never persisted from the literal. So with an empty hash, every read yields `requiresPassword: true` (a derived value, not a stored one). This is _latent but safe_ pre-pod: the only consumer, `familyStore.normalizeRoles` (`:288`), only **elects** a new owner when `owners.length === 0` (`:306`); our owner keeps `role: 'owner'` (`owners.length === 1`), so neither the demote (`:300`) nor elect (`:306`) branch fires — it is never demoted or skipped. The correction is **automatic and robust**: because the flag is derived on read, the instant `rehydrateOwnerDoc` sets a non-empty hash, _every_ subsequent read yields `requiresPassword: false` (no stale stored value to go wrong). **Acceptance test must assert the owner ends with `requiresPassword === false` and a non-empty `passwordHash` after the finish phase.**

- **Fail-closed precondition in `createNewFile` (defense-in-depth).** Add a guard at the top of `createNewFile` that **refuses the envelope write** (returns a typed `reason: 'precondition'` + `reportError`, severity `critical`, surface `syncStore.deferredHashLeak`) if the resolved owner member still carries `DEFERRED_PASSWORD_HASH`. This makes it structurally impossible to write a pod whose owner can never authenticate, even if a future refactor forgets to call `rehydrateOwnerDoc`. It reuses the SAME constant as `signUp`'s deferred branch (single source of truth). This is a cheap, local invariant — no new state, no new flow.

- **Identity survives the iOS redirect — already.** `signUp` persists session + family + owner-doc to IndexedDB and caches `displayName`. On return `authStore.displayName` / `activeFamilyName` are restored — that's how `ResumePodSetup` pre-fills the owner name today (`:125`). Only `mode=create` rides the `state` param (already present — `redirectState.ts`).

- **The finish phase is ONE shared unit (shape B) — DRY, decided.** Verified ownership today: `ResumePodSetup` owns the password form, `rehydrateOwnerDoc`, `finishOnDrive` (Drive connect + collision/adopt recovery + every error branch), `finalizePod` (`createNewFile` + typed-reason surfacing), and the local-file finish. `CreatePodView` owns ONLY the members UI/logic that `ResumePodSetup` lacks. Therefore: **extract `CreatePodView`'s members step into `<CreateMembersStep>` and render it in `ResumePodSetup` after a successful pod write; route the desktop create into that same finish surface; delete the create-completion logic from `CreatePodView`.** A `useCreateFinish` composable (shape A) is rejected — it would force re-homing the already-correct `finishOnDrive`/`finalizePod`/collision machinery that lives in `ResumePodSetup`, i.e. _more_ churn for the same result. The non-negotiable invariant holds either way: the password form, the `createNewFile` dispatch, and the members UI each live in exactly one place.

- **Phase-machine growth in `ResumePodSetup` — bound it, don't let it sprawl (Pass 3).** This refactor makes `ResumePodSetup` both the _recovery_ surface AND the first-class _create-finish_ surface, adding a terminal `members` phase to the existing `probing | auto-load | identity | storage | finishing | retry`. Keep the single flat `switch` (adding one terminal phase is linear, not exponential), but draw two lines so it doesn't smear: (1) `<CreateMembersStep>` is a **fully self-contained leaf** — owns its member-form state + its own add-member error/`reportError`, emits only `finish`; no member-form refs leak into the host. (2) Add a short **phase-reachability doc-comment table** (auto-load/retry/open-existing → never `members`; `no-registry-entry`/start-new → `identity` → `storage`/`finishing` → `members`) so the load and create sub-flows stay disjoint. Do NOT split into two components (re-duplicates `finishOnDrive`/collision recovery) and do NOT add a state-machine library (over-engineering for six flat states).

- **Desktop must NOT double-create — verified.** Today desktop `connected` flows `CreatePodView` step2→step3 inline (no reload). Routing it into the finish surface means the `attemptResumeFromRegistry` probe runs; for a brand-new family the registry has **no `fileId`** yet (it's written only inside `createNewFile`'s `register` step), so the probe returns `no-registry-entry` → the `identity` phase (correct create path). Even if anything re-enters, `createNewFile` independently refuses a double-write via its **registry-`fileId` existing-pod guard** (`syncStore.ts:1182-1183`) and its **`criticalWriteState` re-entrancy guard** (`:1146`) — neither of which depends on a session password. So a double-create is structurally impossible.

- **The desktop → finish-surface seam — host-owned `activeView`, via a NEW emit (verified mechanism; corrected from Pass 2).** `LoginPage.vue` owns a single `activeView` ref (`:59`, `LoginView` union includes both `'create'` and `'resume-setup'`). It mounts `CreatePodView` under `activeView === 'create'` (`:677`) and `ResumePodSetup` under `activeView === 'resume-setup'` (`:692`). The iOS resume flips that same ref reactively in the `watchEffect` at `:114-136` (the `activeView.value = 'resume-setup'` assignment at `:133`, gated on `authStore.isInitialized && authStore.isAuthenticated && route.query.resume === 'setup'`) — this is the **single host-owned `activeView` seam** and the cite is correct. **Correction to Pass 2:** there is NO existing emit from `CreatePodView` that flips the host to `resume-setup`. `CreatePodView` emits only `back`, `signed-in`, and `navigate` whose payload type is `'load-pod'` only (`CreatePodView.vue:33-39`); `ResumePodSetup` emits only `signed-in` / `start-over`. So the desktop hand-off requires a **new event** from `CreatePodView` (e.g. add `'resume-setup'` to `navigate`'s union, or a dedicated `finish-storage` emit) and a **new handler branch in `LoginPage`** that sets `activeView.value = 'resume-setup'` directly (no `router.replace`, no URL change → the freshly-connected `syncStore` provider/token stay live in the store). A `router.replace` would _also_ work (the `:114-136` watchEffect is already authenticated post-`signUp` and would catch it), but it adds a needless navigation and risks a transient re-mount; the direct in-component flip is simpler and preserves live provider state. The implementer should use the direct flip. Either way the registry/`criticalWriteState` guards make a double-create impossible; only UX degrades if a route is taken.

- **⚠️ Desktop must SKIP a second Drive connect on the finish surface — the short-circuit must be ADDED, it does NOT exist (fresh-eyes 2026-06-26, corrects Pass 2/Pass 4 + Assumption 5).** Pass 2 asserted that on desktop `isTokenValid()` makes `finishOnDrive` "short-circuit to `finalizePod`." **There is no such short-circuit: `finishOnDrive` (`ResumePodSetup.vue:416`) unconditionally calls `connectDriveStorage` (`:418`).** On desktop, step 2 ALREADY called `connectDriveStorage` → `GoogleDriveProvider.createNew` (`googleDriveProvider.ts:380`), which **writes a `{}` stub `.beanpod` to Drive** (`:425`) and installs the provider. Re-entering `finishOnDrive` → `connectDriveStorage` → `createNew` a **second** time runs the collision check (`:408-416`), finds the step-2 stub, and throws `FileNameCollisionError`. It would _self-heal_ via the adopt-stub recovery (own empty `{}` → `resolveExistingBeanpod` → `adopt-stub` → `adoptDriveStub`), so no hard block — **but every desktop create would then run through aborted-attempt collision recovery** (an extra Drive `list` + stub `read`). That is wrong for the happy path. **Required:** add a guard at the top of `finishOnDrive` (or the finish-surface dispatch) — **when `syncService.getProvider()` is already installed AND `isTokenValid()` (storage connected live on this same page), skip `connectDriveStorage` and call `finalizePod` directly** (it writes the real pod into the already-installed provider via `createNewFile`). This fires on the **desktop** seam (provider live, token held) and does **NOT** fire on **iOS** (after the redirect reload `syncService.getProvider()` is null), so iOS still connects Drive inside the finish surface exactly once. Acceptance: **desktop create runs exactly ONE `createNew`, with no name-collision recovery on the happy path.**

- **Members after the pod exists.** `createMember` mutates the in-memory doc; the pod write (`createNewFile`) + `SetupProgressModal.syncNow()` persist them. In shape B, `finalizePod` currently emits `signed-in` immediately on success (`ResumePodSetup.vue:411-412`). The finish surface must instead, on `createNewFile` success, **advance to the new `members` phase** (render `<CreateMembersStep>`), and only emit `signed-in` after the user finishes there (driving `SetupProgressModal` exactly as `CreatePodView.handleFinish`→`SetupProgressModal` does today). Members are thus added **after** the pod exists, matching the proven desktop ordering. **The `members` phase is reached ONLY from `finalizePod`'s create-success branch** — never from `handleAutoLoadSubmit`'s `success` (`:244-246`), `openExistingOnDrive`, or the `retry` path, all of which load an _existing_ pod and continue to emit `signed-in '/nook'` directly. (Acceptance test asserts this.)

- **Do NOT re-introduce a pre-redirect password.** Remove `CreatePodView.handleStep1Next`'s password validation (`:145-158`) and the `password`/`confirmPassword` refs + fields (`:53-54`, `:728-748`); grep that no guard still requires `password` before step 2.

- **`hasSessionPassword` guard change — scoped and verified.** The only create-flow consumer of `hasSessionPassword` is `CreatePodView.handleStep2Next`'s "already created" short-circuit (`:451`). Since `createNewFile` moves out of `CreatePodView`, that whole step-2 `createNewFile` block (`:407-496`) including the guard is **deleted**, not rewritten — there is no longer a session password to key off in `CreatePodView`. (The other `hasSessionPassword` use, the `App.vue` save-on-hide guard, is unrelated — untouched.) `createNewFile`'s own guards (registry `fileId` + `criticalWriteState`) remain the single source of double-write protection.

- **Error handling — every finish-phase failure already surfaces; preserve it.** `finishOnDrive`/`finalizePod`/`handleConnectLocal`/`rehydrateOwnerDoc` each already map failures to a translated `formError` + a focused `reportError` (critical/error/warning as appropriate) and never silently drop (`ResumePodSetup.vue:321-578`). The new `members` phase must match this discipline: `<CreateMembersStep>`'s add-member failure (today `formError = t('loginV6.addMemberFailed')` when `createMember` returns null, `CreatePodView.vue:537-538`) must **also `reportError`** — the current CreatePodView path shows the toast but does NOT report, a silent-to-telemetry gap this refactor should close (severity `warning`, surface `createMembers.addMember`). `<CreateMembersStep>` owns its own add-member error display + `reportError` (it has the failing call in hand); it does NOT bubble a string up to `ResumePodSetup.formError` — keeps the seam clean. The `SetupProgressModal` sync failure path stays as-is.

- **Onboarding-stall watchdog + force-flush telemetry** already cover the finish surface on iOS.

- **iOS still requires ONE password entry** — inherent and correct; it now happens once, after Drive.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-06-20).

1. Current `main` tip includes the bounce-tracking fix (`redirectState.ts` with `mode=create`), the onboarding watchdog (`App.vue INIT_TIMEOUTS`), and force-flush telemetry. Verified current create flow: `CreatePodView` 3 steps (step1 identity+password+signUp+started-ping; step2 connect+createNewFile guarded by `hasSessionPassword`; step3 members) and `ResumePodSetup` (probe → auto-load | identity→rehydrate→finishOnDrive→finalizePod | retry, **no members**).
2. **VERIFIED:** `signUp` can create family+owner+session with `passwordHash: ''`; no `passwordHash` reader runs in the pre-pod window; `requiresPassword:true` on the empty-hash owner is harmless (only `normalizeRoles` reads it, and only when there is no owner) and is corrected to `false` by `rehydrateOwnerDoc` before the pod write.
3. **VERIFIED:** owner name + email survive the iOS redirect via the persisted session (`displayName`/`currentUser`); no need to carry them in `state`.
4. **VERIFIED:** `createNewFile` is idempotent-guarded against a double-write via the registry-`fileId` existing-pod check (`:1182-1183`) + `criticalWriteState` (`:1146`), independent of any session password; the finish phase calls it exactly once.
5. **VERIFIED + CORRECTED (2026-06-26):** the desktop popup path returns `{ status: 'connected' }` without reload, so it can enter the finish surface via the host-owned `activeView` flip with the provider still live. **BUT** the `finishOnDrive` `isTokenValid()` short-circuit Pass 2 assumed does NOT exist — `finishOnDrive` always calls `connectDriveStorage`, which on desktop would re-`createNew` and collide with the step-2 stub. **The short-circuit (`syncService.getProvider()` set + `isTokenValid()` → skip connect, go straight to `finalizePod`) must be ADDED.** See the dedicated "⚠️ Desktop must SKIP a second Drive connect" caveat above. The seam is a NEW `CreatePodView` emit + a NEW `LoginPage` handler setting `activeView = 'resume-setup'` (no existing emit does this — verified).
6. **VERIFIED:** `LoginPage` owns `activeView` as the single switch between `CreatePodView` (`'create'`, `:677`) and `ResumePodSetup` (`'resume-setup'`, `:692`), and already flips to `'resume-setup'` reactively for the iOS return (`:114-136`, assign `:133`).

## Approach

**Architecture: one post-connect finish surface (`ResumePodSetup`, extended with a members phase), reused by desktop (inline `activeView` flip) and iOS (post-redirect). `CreatePodView` shrinks to identity → connect → hand off. Step 1 stays identity-only; the "started" ping stays.**

### A. Step 1 → identity only (`CreatePodView.vue`)

- Remove the **password** + **confirm-password** refs (`:53-54`), fields (`:728-748`), and their validation (`handleStep1Next` `:145-158`). Step 1 validates family name + owner name + email only.
- Keep the **"🫘 New family pod started!" ping** (`:169-171`) and the newsletter opt-in capture, unchanged.
- Call `signUp` in **deferred-password mode** (see C) — `signUp({ deferPassword: true, email, familyName, memberName, subscribeNewsletter })`. Keep the idempotency guard (`:140-143`).
- Advance to step 2.

### B. Step 2 → connect storage only, then hand off (`CreatePodView.vue`)

- `handleChooseGoogleDriveStorage`/local handlers + collision recovery unchanged (transport is correct).
- **Delete `handleStep2Next` entirely** (`:407-496`) — its `createNewFile` block AND its `hasSessionPassword` short-circuit. Step 2's job ends at "storage connected." The success-modal "Continue" (`handleDriveModalContinue`, `:394-397`) and the local-connect success now emit the new hand-off event instead of calling `handleStep2Next`.
- On desktop `connected`: emit the new hand-off event → `LoginPage` sets `activeView = 'resume-setup'` — provider stays live in `syncStore`. On iOS `redirecting`: nothing more here; the app resumes into the finish surface on return via the existing `:114-136` watchEffect.
- `CreatePodView` becomes effectively 2 steps (identity → connect); the step-3 members UI moves to the shared sub-component (D). Update `totalSteps`/`stepLabels`/`__e2eCreatePod.setStep` accordingly (the wizard now shows the password+members on the finish surface, not inside `CreatePodView`).

### C. `signUp` deferred-password mode (`authStore.ts`)

- Change the `signUp` param to the discriminated union `{ deferPassword: true; password?: never; … } | { deferPassword?: false; password: string; … }` on the SAME function (`:503`). When `deferPassword`, skip `hashPassword` (`:534`) and call `buildOwnerDoc({ …, passwordHash: DEFERRED_PASSWORD_HASH })`. Everything else (createFamily, registry mapping, session, `podCreated=false`, `displayName` cache, plausible events) is unchanged. `setOnboardingCompleted(false)` stays in `buildOwnerDoc`.
- Define `const DEFERRED_PASSWORD_HASH = '';` co-located with `buildOwnerDoc`, exported (or module-scoped + re-exported) so `createNewFile`'s fail-closed guard references the same constant.
- The finish phase sets the real hash via the existing **`rehydrateOwnerDoc(name, password)`** (`:479`) — the single "apply the password to the owner" path, which also recomputes `requiresPassword` to `false`.

### D. The finish surface = `ResumePodSetup` + a new `members` phase

- Add `<CreateMembersStep>` — **new** sub-component extracted verbatim from `CreatePodView`'s step-3 members UI + `handleAddMember`/`handleRemoveMember`/`openAddMemberForm`/`getNextColor` (`:498-564` script, `:1053-1252` template). It owns the owner card + added-members list + add-member form AND all member-form state. Props: the owner (from `familyStore.owner`) + `ownerRole` for the avatar; emits `finish` when the user is done. **Add the missing `reportError`** on `createMember` failure (see Caveats).
- Extend `ResumePodSetup`'s `Phase` union (`:73`) with `'members'`: after `finalizePod` succeeds, instead of emitting `signed-in` immediately (`:411-412`), set `phase.value = 'members'` and render `<CreateMembersStep>`. On its `finish`, open `SetupProgressModal` (reuse `CreatePodView`'s `handleFinish`/`handleSetupComplete` pattern) → on complete, `emit('signed-in', '/nook')`.
- **Add the desktop "already-connected" short-circuit (fresh-eyes 2026-06-26):** at the top of `finishOnDrive` (`:416`), if `syncService.getProvider()` is set AND `isTokenValid()` (the desktop seam — Drive was connected in step 2 on this same page), **skip `connectDriveStorage` and call `finalizePod` directly**. Prevents the second `createNew` from colliding with the step-2 `{}` stub. iOS is unaffected (post-reload `getProvider()` is null → connects once). Import `getProvider`/`isTokenValid` are already in the module graph (`connectStorage.ts` uses both).
- The surface knows it's a **create** (vs auto-load) via `attemptResumeFromRegistry` returning `no-registry-entry` → the existing `identity` phase. For a genuinely-resumed half-finished iOS create, the same path applies. For auto-load/retry/open-existing (loading an _existing_ pod), the `members` phase is **never** entered — those route straight to `/nook` as today.
- **Document phase reachability** as a short table in the SFC doc-comment (`:1-35`) so the two disjoint sub-flows stay legible.

### E. The "🎉 created" ping + `markPodCreated` stay in `createNewFile` (`syncStore.ts`)

Unchanged — the ping (`:1305`) + `markPodCreated` (`:1291`) fire when the pod is written, now always via the finish surface's `finalizePod`. The new fail-closed `DEFERRED_PASSWORD_HASH` precondition guard sits at the top of `createNewFile`, before any write, and does not touch the ping path.

### F. Routing / guards

- `needsPodSetup` (`authStore.ts:283`) already routes an authenticated-no-pod session to the finish surface — now a _first-class_ create step. The desktop `activeView` flip and the iOS `:114-136` resume converge on `'resume-setup'`. The `attemptResumeFromRegistry` `no-registry-entry`→`identity` routing is the create entry; no guard change needed beyond deleting `CreatePodView`'s removed `createNewFile`/`hasSessionPassword` logic and adding the new hand-off emit/handler.
- Reframe `ResumePodSetup`'s doc-comment (`:1-35`) + any `app.onboardingZombieState` wording: the create finish is now an _expected_ step, not only an anomaly.

### Why this satisfies everything

One password entry (finish surface, post-connect) for all users; members for all users (new `members` phase); identity-only step 1 (lower friction); "started" ping at step 1, "created" ping at pod write (both unchanged); no secret crosses the redirect; desktop + iOS share the one finish surface (`ResumePodSetup`) via the single host-owned `activeView` seam; zero duplication — the password form, `createNewFile` dispatch, collision recovery, and members UI each live in exactly one place; every failure path surfaces a translated message + `reportError`, including the previously-silent add-member failure; and a deferred-hash pod is structurally unwritable (fail-closed guard).

## Files Affected

- `src/components/login/CreatePodView.vue` — step 1 → identity-only (drop `password`/`confirmPassword` refs, fields, validation); keep the "started" ping; deferred-password `signUp`; **delete `handleStep2Next` (the `createNewFile` block + `hasSessionPassword` guard)**; on `connected`, emit the new hand-off event; **remove the step-3 members UI/logic** (moves to `<CreateMembersStep>`); collapse to identity → connect (`totalSteps`, `stepLabels`, `__e2eCreatePod`).
- `src/components/login/ResumePodSetup.vue` — becomes the single create-finish surface: existing `identity`→`rehydrateOwnerDoc`→`finishOnDrive`→`finalizePod` PLUS a new `members` phase rendering `<CreateMembersStep>` after a successful pod write, then `SetupProgressModal` → `/nook`. `finalizePod` no longer emits `signed-in` on success — it sets `phase = 'members'`. **Add the desktop short-circuit in `finishOnDrive` (`:416`): if `syncService.getProvider()` && `isTokenValid()`, skip `connectDriveStorage` and call `finalizePod` directly** (avoids the step-2-stub collision; iOS unaffected). Auto-load/open-existing/retry success paths unchanged (still emit `signed-in` directly). Add the phase-reachability table + update the recovery-vs-create doc-comment.
- `src/components/login/CreateMembersStep.vue` — **new** self-contained leaf sub-component extracted from `CreatePodView` step-3 (owner card + members list + add-member form + all member-form state + `handleAddMember`/`handleRemoveMember`/`openAddMemberForm`/`getNextColor`), used by the finish surface. Props the owner + `ownerRole`; emits `finish`. **Adds the missing `reportError` on `createMember` failure** (surface `createMembers.addMember`, severity `warning`). No member-form refs leak to the host.
- `src/stores/authStore.ts` — `signUp` param becomes a discriminated union `{deferPassword:true; password?:never} | {deferPassword?:false; password:string}`; deferred branch skips `hashPassword` and passes `passwordHash: DEFERRED_PASSWORD_HASH` (new `''` constant co-located with `buildOwnerDoc`). `rehydrateOwnerDoc` reused as the single "apply password to owner" path (also corrects `requiresPassword`). No `passwordHash` reader runs pre-pod (verified).
- `src/stores/syncStore.ts` — `createNewFile` crypto/pings/guards unchanged; ADD a fail-closed precondition at the top: refuse the write (`reason: 'precondition'` + `reportError` critical, surface `syncStore.deferredHashLeak`) if the owner still carries `DEFERRED_PASSWORD_HASH`. The double-write guards (`criticalWriteState`, registry `fileId`) remain the single source of truth, independent of `hasSessionPassword`.
- `src/components/login/SetupProgressModal.vue` — unchanged behavior; now driven from the finish surface's `members` phase (sync members + register) instead of `CreatePodView`.
- `src/services/translation/uiStrings.ts` — copy updates: step-1 no longer mentions a password; the `identity`-phase prompt on the finish surface reads as "set your password to finish setting up your family"; remove any "create a password again" wording; add a members-phase title fitting the create context. `npm run translate` after.
- `src/services/sync/connectStorage.ts` — unchanged (transport already correct); verify the desktop `connected` return threads into the finish surface via the new hand-off emit.
- `src/pages/LoginPage.vue` — add the desktop create → finish-surface hand-off: a new handler that sets `activeView.value = 'resume-setup'` in response to `CreatePodView`'s new emit (no `router.replace`, so `syncStore` provider state is preserved). The iOS reactive flip at `:114-136` (`:133`) is unchanged.
- `docs/adr/026-ios-redirect-oauth.md` — amend: the create flow now defers the password to a post-connect finish surface shared by desktop + iOS; the resume surface is a first-class create step, not only a fallback.
- Tests: `authStore` (deferred `signUp` writes `passwordHash:''`; the union rejects passing both `password` and `deferPassword`; `rehydrateOwnerDoc` sets the real hash + flips `requiresPassword` to false on the same `memberId`; idempotency guard still no-ops a second `signUp`); `ResumePodSetup`/`CreateMembersStep` finish-flow (one password entry; `members` phase reached on BOTH create transports but NEVER on auto-load/retry/open-existing; add-member failure reports); `syncStore.createNewFile` (still fires created-ping + `markPodCreated`; refuses a double-write; **fail-closed on a deferred-hash owner**); and any existing create/resume tests asserting the old step-1-password or the old `finalizePod`-emits-immediately contract.

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `getting-started`
- **Slug**: the existing "create a family" / getting-started onboarding article (locate in `src/content/help/`)
- **Title**: (unchanged) — adjust the setup walkthrough
- **Scope**: Reflect the new order — you enter your details, connect storage, then **set your password and add your family members** to finish. Frame from the user's POV (one password, add your people before you start).
- **Notes**: Call out that the password is the key to your family's encrypted data (set once, after connecting storage); adding members here means they're ready to assign to accounts/activities immediately.

## Acceptance Criteria

- [ ] **iPhone (Safari + installed PWA):** create → step 1 (no password) → connect Drive (redirect) → return → **enter password ONCE** → **add-members step shows** → land in `/nook` with the added members present. No recovery-screen detour feel, no second password.
- [ ] **Desktop (popup):** same outcome via the finish-surface `activeView` flip — step 1 (no password) → Drive popup → **password once** → **add members** → `/nook`. One completion path shared with iOS, no route change / re-mount. **Desktop create runs exactly ONE `createNew` — no name-collision recovery on the happy path** (the `getProvider()`+`isTokenValid()` short-circuit fired).
- [ ] **Local-file storage** create still completes with one password + members.
- [ ] The **"🫘 started" ping fires on step-1 completion**; the **"🎉 created" ping fires from `createNewFile`** after the pod is written. Neither double-fires; the started ping is not gated on the password.
- [ ] Step 1 has **no** password/confirm fields; no validation blocks step 1 on a password (grep clean).
- [ ] The password form, the `createNewFile` dispatch, the Drive-collision recovery, and the add-members UI each exist in **exactly one place** (no desktop/iOS duplication).
- [ ] `signUp` creates the session/family/owner with `passwordHash:''`; no code reads `passwordHash` before the pod exists; after the finish phase the stored owner has a non-empty `passwordHash` AND `requiresPassword === false`.
- [ ] `createNewFile` refuses to write (typed `precondition` + critical report) if the owner still holds `DEFERRED_PASSWORD_HASH` — a deferred-hash pod is structurally unwritable.
- [ ] No secret is written to `sessionStorage`/`localStorage`/the `state` param across the redirect (grep clean).
- [ ] No regression: join-a-family, load-existing-pod, Settings→Reconnect, auto-load/retry recovery, adopt-existing collision recovery all still work (manual + existing tests). The `members` phase is never reached from any existing-pod load path.
- [ ] Every finish-phase failure surfaces a translated message + a focused `reportError` (`createNewFile` typed-reason, `rehydrateOwnerDoc`, Drive connect/collision, local file, **and add-member**) — no silent failure, including the previously-silent add-member path.
- [ ] Help Center getting-started article updated to the new order.
- [ ] `npm run validate` green; i18n checks pass for the new/removed copy.

## Testing Plan

1. **Unit — `authStore`:** deferred `signUp` creates family+owner+session with `passwordHash:''` and fires no key derivation; the discriminated union rejects `{deferPassword:true, password:'x'}` at the type level (and a runtime test that the deferred branch ignores any password); `rehydrateOwnerDoc(name, password)` sets the real hash + flips `requiresPassword` to false on the same `memberId`; the idempotency guard still no-ops a second `signUp`.
2. **Unit — `syncStore.createNewFile`:** still derives/wraps/writes with the password, fires the "🎉 created" ping + `markPodCreated`, refuses a double-write via the registry-`fileId` + `criticalWriteState` guards (independent of `hasSessionPassword`), and **refuses a deferred-hash owner** via the fail-closed precondition (typed reason + critical report, no envelope written).
3. **Component — finish surface + `CreateMembersStep`:** one password entry → pod written → `members` phase → members addable → `/nook`; a `createNewFile` failure shows the focused error (not a dead end); a `createMember` failure shows the toast AND reports; members persist (asserted on the stored doc, owner ends with `requiresPassword:false`). Assert `members` phase is NOT entered from auto-load/open-existing/retry success.
4. **Manual — iPhone Safari tab + installed PWA (greg):** full create → password once → members → `/nook` with members; CloudWatch shows the success path, no `oauth.redirectStateLost`, no stall watchdog.
5. **Manual — desktop Chrome:** create via popup → password once (finish-surface `activeView` flip, no reload/route change) → members → `/nook`.
6. **Manual — local file + join + load-existing + Settings→Reconnect + adopt-existing collision:** regression pass.
7. **Telemetry:** confirm the "started" ping on step 1 and "created" ping on pod write for one real run.
8. `npm run validate` + a build.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the unified post-connect Finish phase (password once → write pod → add members) shared by desktop (inline) and iOS (post-redirect); step 1 → identity-only with the "started" ping retained; password-deferred `signUp` + reuse of `rehydrateOwnerDoc`; `createNewFile` (and its "created" ping) unchanged; members step extracted to a shared sub-component.
- **Pass 2 (DRY + error handling)**: Verified the actual code and **committed to shape B** (`ResumePodSetup` as the single finish surface + extracted `<CreateMembersStep>`), because `ResumePodSetup` already owns the password form, `rehydrateOwnerDoc`, `finishOnDrive`, collision recovery, and `finalizePod`/`createNewFile` — only the members UI (CreatePodView-only) needs to move; a `useCreateFinish` composable would re-home working code for no gain. Confirmed the empty-`passwordHash` window is safe (no pre-pod reader; `requiresPassword:true` only matters to `normalizeRoles` which never demotes our owner; `rehydrateOwnerDoc` corrects it). Confirmed desktop cannot double-create (registry-`fileId` + `criticalWriteState` guards, both independent of the session password) and chose an in-component view switch over a hard route so the live provider isn't dropped. Pinned the guard change to _deleting_ `CreatePodView`'s `hasSessionPassword` short-circuit (the only create-flow consumer; `App.vue`'s is unrelated). Closed a real silent-failure gap: `CreateMembersStep` must `reportError` on `createMember` failure (CreatePodView doesn't today). Sequenced members after `createNewFile` via a new `members` phase (`finalizePod` no longer emits `signed-in` directly).
- **Pass 3 (Sustainability)**: Hardened the `signUp` contract into a **discriminated union** (`{deferPassword:true; password?:never} | {deferPassword?:false; password:string}`) so the two modes can never be mixed, and named the empty hash a single co-located **`DEFERRED_PASSWORD_HASH`** constant. Added a **fail-closed precondition** in `createNewFile` (typed `precondition` reason + critical `reportError`) that refuses to write a pod whose owner still carries the deferred sentinel — a deferred-hash pod becomes structurally unwritable even under a future refactor, referencing the same constant (single source of truth). Bounded `ResumePodSetup`'s phase-machine growth (self-contained `<CreateMembersStep>` leaf + a documented phase-reachability table; rejected a component split or a state-machine lib). Tightened the `members`-phase invariant to assert it is reached only from `finalizePod`'s create-success branch and never from any existing-pod load. Expanded the test matrix (union rejection, `requiresPassword` flip, fail-closed write, phase reachability).
- **Pass 5 (Fresh-eyes verification, 2026-06-26)**: Re-verified every code claim against current `main` (≤1-line drift) and ran 3 parallel code explorations. Found **one substantive gap**: the desktop seam's assumed `isTokenValid()` short-circuit in `finishOnDrive` **does not exist** — `finishOnDrive` (`:416`) unconditionally calls `connectDriveStorage` (`:418`), and since desktop step 2 already wrote a `{}` stub via `createNew` (`googleDriveProvider.ts:425`), a second connect would `FileNameCollisionError` and route the happy path through aborted-attempt collision recovery. **Added the required `getProvider()`+`isTokenValid()` short-circuit** (skip connect → `finalizePod`) across the caveats, Approach D, Assumption 5, Files Affected, and a new acceptance check (desktop = exactly one `createNew`). Dismissed two false alarms: (a) `createNewFile` "has no password" — it is collected in the finish/identity phase and passed to `createNewFile` via `finalizePod` (`:374`), signature unchanged; (b) `applyDefaults` `requiresPassword` "CRITICAL blocker" — the flag is **derived on read** (`familyMemberRepository.ts:27`), `normalizeRoles` only elects at `owners.length===0` (our owner keeps `role:'owner'`), so the empty-hash window is safe and self-corrects automatically once the hash is set; tightened the WATCH caveat wording accordingly. Confirmed `SetupProgressModal` is self-contained (`open:boolean` only) and the desktop hand-off bridge is genuinely absent (as Pass 4 said). No new scope; settled decisions not re-litigated.
- **Pass 4 (Fresh-eyes sweep)**: Re-read the real code end-to-end. **Corrected the desktop seam description**: Pass 2 implied an existing emit/`?resume=setup` view mechanism flips the host into the finish surface — it does not. `LoginPage` owns a single `activeView` ref (`:59`) and the iOS resume flips it reactively at `:133` (watchEffect `:114-136`), but `CreatePodView` emits only `back`/`signed-in`/`navigate('load-pod')` and `ResumePodSetup` only `signed-in`/`start-over` — so the desktop hand-off needs a **new emit + a new `LoginPage` handler** setting `activeView = 'resume-setup'` directly (no `router.replace`, preserving live `syncStore` provider/token). The single host-owned `activeView` seam itself is confirmed correct. **Confirmed both Slack pings are preserved and unmoved**: the "🫘 started" ping stays in `CreatePodView.handleStep1Next` (`:169-171`), and the "🎉 created" ping stays in `createNewFile` (`syncStore.ts:1305`, with `markPodCreated` at `:1291` — corrected a stale `:1291` cite for the ping). Verified `buildOwnerDoc` literally passes `requiresPassword:false` (`:453`) so the `applyDefaults` override is the load-bearing detail, and `rehydrateOwnerDoc` computes the real hash at `:487`. Settled decisions (shape B, the discriminated-union `deferPassword`, the fail-closed `createNewFile` guard, the single `activeView` seam) were not re-litigated; no new scope added.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Context (this session)

> After the bounce-tracking fix deployed, greg tested create-a-family on a confirmed-latest-build iPhone (twice): no freeze, onboarding succeeded, no what's-new pop — BUT the step-1 password wasn't carried (dropped into the recovery screen, asked to create a password again), and iPhone users miss step 3 (add family members), so they reach the onboarding wizard with no members for account/activity assignment.

### greg's question + direction

> "what is the reason / root cause that onboarding on iphone always falls back to the recovery step? … iphone users completely miss step 3 of the setup wizard (creating their family members), so by the time they arrive in the onboarding wizard, there are no family members available for the various account and activity creation steps."
> "ok this sounds good" (to Option B — defer the password / resume the full wizard). "will the password creation step be moved to after the drive creation for ALL users? … is the password required to create the file on google drive?"

### Decisions

> - **All users**, not just iPhone — one unified flow + lower step-1 friction.
> - Password is NOT needed to connect Drive (only the OAuth token); it IS needed to encrypt the `.beanpod`. So it's collected once, after storage connect, before the file write.
> - **HARD REQUIREMENT:** the "🫘 New family pod started!" Slack ping must CONTINUE to fire on STEP 1 completion; the "🎉 Family pod created!" ping keeps firing after the pod is written.

### Initial Prompt (this plan)

> /beanies-plan — write the plan for the unified create flow (identity → connect → password + members), folding in the single-password and members-step fixes.

</details>
