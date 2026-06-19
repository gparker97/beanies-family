# Plan: Comprehensive Onboarding Hardening (iOS recovery loop + auth/transport correctness)

> Date: 2026-06-19
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-19-onboarding-hardening.md`
> Findings source: `docs/plans/_review-findings-2026-06-19-onboarding.md`

## User Story

As a new user onboarding to beanies.family on an iPhone, I want the setup to recover gracefully when a previous attempt left a half-created family file behind — so that I can finish creating my family instead of looping on "a file already exists" errors and giving up.

## Context

On 2026-06-19 a real iPhone (iOS 18.7 Safari) onboarding session (`daphne@seror.it`) failed after 4+ attempts and never succeeded. A workflow-backed `/code-review max` over the 79-file onboarding surface (70 candidates → 53 verified → 15 reported) found the failure is not one bug but a **cluster of iOS-specific dead-ends that compound into a permanent loop**, plus several independent auth/transport correctness defects.

The dominant root cause: **onboarding has no idempotent recovery when its own prior attempt left Drive state behind.** Attempt #1 physically creates the `.beanpod` on Drive before the flow registers a `fileId`; if anything downstream throws (e.g. the opaque iOS "Script error."), the attempt aborts but the file persists. Every retry then collides with that orphan, and neither the create wizard nor the recovery screen has a path to _adopt the user's own file_ — they only offer "pick a different name" or re-run the same colliding call.

This plan fixes all 15 verified findings, organized into four clusters, with the **adopt-existing recovery path** as the centerpiece.

### Decisions locked with greg (2026-06-19)

1. **Adopt-existing semantics:** when the _authenticating account_ meets a same-name `.beanpod` **it owns**:
   - **empty/stub orphan** (no real family data) → **adopt silently**, continue onboarding;
   - **populated** (real content) → **confirm** ("We found an existing family file — open it?" → [Open it] / [Start fresh with a new name]);
   - **owned by a different account** → **never adopt** (the collision error stays).
2. **Finding 8 (trusted-device sign-out grant revoke):** **keep current behavior** — it is the intended `1e8090f7` convenience. The existing **`signOutAndClearData()`** action already revokes the grant at Google, deletes the per-family IndexedDB cache, resets the trust flag, and clears the cached family key — this is the security escape hatch. Finding 8 becomes a **documentation-only** change (code comment + ADR note), no behavior change.

## Requirements

### Cluster A — iOS recovery loop (findings 1, 3, 4, 5)

1. **Adopt-existing path.** When `connectDriveStorage` / the recovery screen encounters a same-name `.beanpod` owned by the authenticating account during onboarding, resolve it per the locked semantics (auto-adopt empty, confirm populated, never adopt other-account) instead of dead-ending. (Findings 1, 5)
2. **Recovery screen handles `name-collision`.** `ResumePodSetup.finishOnDrive()` must branch on `errorKind === 'name-collision'` and route into the adopt-existing path (or, for a different-account collision, show the same focused "pick a different name" guidance the create wizard shows). (Finding 1)
3. **Carry the consent-denial reason across the redirect boundary.** When `completeRedirectAuth()` throws "Google Drive file access was not granted" (granular `drive.file` deselection), the user must land on the recovery screen with a clear, translated message explaining they must re-allow file access — not a silent route with no explanation. (Finding 3)
4. **Registry-error must not trap the user.** When the DynamoDB registry is unreachable (Lambda cold-start/outage), the recovery screen must offer a real, non-destructive way forward for a genuinely-new family (create), not only a danger-styled "start a new pod". (Finding 4)
5. **No second orphan on transient list failure.** `GoogleDriveProvider.createNew`'s collision pre-check must not swallow a `listBeanpodFiles` failure and fall through to create a duplicate. A list failure during create must be treated as "cannot safely create" (surface + allow retry), not "no collision exists". (Finding 5)

### Cluster B — iOS transport correctness (findings 2, 6, 7)

6. **Resume read path must not open a non-gesture popup on iOS.** The resume probe (`attemptResumeFromRegistry` → `loadFromGoogleDrive` → `requestAccessToken()`) runs from `onMounted` with no user gesture; on iOS this hits a blocked popup and dead-ends. The resume _read_ path needs the same `shouldUseRedirectAuth` guard the connect path has — prefer silent reconnect / redirect over a popup, and never auto-trigger a popup without a gesture. (Finding 2)
7. **Safari "Load failed" must hit the offline queue.** `GoogleDriveProvider.write()`'s network-error branch matches only `'fetch'`; WebKit throws `TypeError: Load failed`. Use the same `/fetch|network/i` (or shared classifier) the `withRetry` helper already uses so iOS writes are enqueued for offline flush instead of lost. (Finding 6)
8. **Join recovery must branch on HTTP status, not localized substrings.** `useJoinFlow` matches `'File not found'`/`'404'`/`'403'` against the raw localized Drive message; route the structured `DriveApiError` status through to the composable so the Picker-grant branch fires regardless of locale. (Finding 7)

### Cluster C — auth layer (findings 8, 9, 10, 11)

9. **Finding 8 — documentation only.** Add a code comment on `signOut()`'s `preserveRefreshToken` path documenting that trusted-device sign-out intentionally preserves the grant, and that `signOutAndClearData()` is the revoke-everything escape hatch. Add a one-line ADR note. No behavior change. (Finding 8)
10. **Provider resolves token from its bound account, not the global session.** `GoogleDriveProvider.read()`/`write()` must use the provider's bound account identity when acquiring a token, so account drift can't make B's token operate on A's file. (Finding 9)
11. **No null-deref in silent refresh on concurrent sign-out.** `performSilentRefresh` must re-check `currentRefreshToken` per attempt and bail cleanly (recognize a torn-down session) rather than dereferencing `currentRefreshToken!.token` after a sign-out nulls it mid-backoff. (Finding 10)
12. **Read-only provider builds must not trigger a flush-write.** `GoogleDriveProvider.fromExisting()` (used by read-only resume/recovery paths) must not register itself as the offline-queue flush target as a build side-effect; flush registration must be an explicit step taken only by write-intent callers. (Finding 11)

### Cluster D — observability, i18n, DRY (findings 12, 13, 14)

13. **`crossorigin` on the Google API script.** `drivePicker.ts` must set `script.crossOrigin = 'anonymous'` so iOS WebKit surfaces real error message + stack instead of the opaque "Script error." (Finding 12)
14. **Translated collision error on the recovery screen.** `ResumePodSetup` must show the translated `t('createPod.duplicateFile')` (or an adopt-aware equivalent), never the raw English message with an internal `fileId`. (Finding 13)
15. **Extract the decrypt/biometric handoff.** Collapse the 6 divergent "needsPassword → tryAutoDecrypt → `checkBiometricForFamily`-or-modal" blocks in `LoadPodView.vue` into one `handlePendingPassword(fileName)` helper that preserves the per-site variance. (Finding 14)

## Important Notes & Caveats

- **Never overwrite a real family's pod.** The adopt-existing path must distinguish "empty stub from my own aborted attempt" from "a populated pod I own" from "a pod owned by another account". Adoption reads/loads; it must never create-over or truncate an existing file.
- **"Empty/stub" must be defined precisely.** An aborted attempt can leave either a zero-byte file or a `{}`-stub envelope (per finding 5, transient write failures can be swallowed mid-create). Define stub-detection on the decrypted/parsed envelope: no family members + no meaningful CRDT content = stub. When in doubt (can't parse / ambiguous), treat as **populated** → confirm (fail safe toward asking, never toward silent adopt). **`resolveExistingBeanpod` must `try/catch` the download+decrypt and map ANY throw (wrong key, parse failure, transient read error) to the `adopt-confirm` (ambiguous) outcome** — logged `[connectStorage] stub probe inconclusive: <Error>`, never re-thrown. A throw escaping this helper would re-trap the user in the collision loop, defeating the whole fix.
- **Ownership check is by Drive file ownership**, resolvable from the file metadata the collision pre-check already lists (`listBeanpodFiles` returns the candidate). Do not adopt a file the authenticating account does not own.
- **Idempotency / re-entry.** The redirect-resume can run multiple times (token lapse, repeated returns). Every step must be safe to run again: adopt is idempotent (loading the same file twice is fine); create must be guarded so a second create can't run while one is in flight or after one succeeded.
- **Do not regress the create wizard.** `CreatePodView` already handles `name-collision` with a focused hint; the adopt path is additive — the "different account" branch keeps the existing hint.
- **Finding 8 is deliberately NOT a behavior change.** Do not "fix" the revoke. Only document it.
- **iOS popup rule (project convention):** never pre-warn / pre-disable on UA sniff. The fix is to route to redirect/silent, not to show a capability banner.
- **No silent failures (project rule):** every new catch logs `[module] action failed: <Error>` and surfaces a translated user message where user-facing; transient/expected aborts log to console only with a documented fallback.

## Assumptions

> Review before implementation — valid at planning time (2026-06-19).

1. **Verified:** `listBeanpodFiles`/`searchBeanpodFilesGlobal` (`driveService.ts:328`) return only `{ fileId, name, modifiedTime }` — no owner. The query **must be extended to `fields=files(id,name,modifiedTime,ownedByMe)`** in both `listBeanpodFiles` (`:330`) and `searchBeanpodFilesGlobal` (`:355`) — **and the shared `mapFileResults` helper (`:551`) plus its input/return types must carry `ownedByMe` through** (it currently hard-strips the projection to `{fileId,name,modifiedTime}`, so the fetched field would otherwise be discarded); `searchBeanpodFilesGlobal`'s inline `.map` (`:373`) needs the same field added. (Under `drive.file` scope the app only sees app-created files, so other-account collisions are rare, but `ownedByMe` is the correct discriminator.)
2. The `.beanpod` envelope can be cheaply inspected for "stub vs populated" after the family key is available; during create the user has just set a password, so the key derivation needed to read the existing file is available (or the existing file is the user's own and uses the same key). **Open risk:** if the orphan was encrypted with a _different_ key (e.g. password changed between attempts), stub-detection by decryption may fail → falls into the "ambiguous → treat as populated → confirm" rule, and "Open it" may then fail to decrypt. The confirm copy + error handling must cover "couldn't open — start fresh".
3. **Corrected:** `DriveApiError` is exported from `services/google/driveService.ts:621` (NOT `types/sync.ts`). `loadFromGoogleDrive` already classifies `e instanceof DriveApiError && e.status === 404` (`syncStore.ts:2280`); surface the status as a **structured field on the store error** and have `useJoinFlow` branch on it — no new error type for finding 7.
4. **Corrected:** the provider exposes `getAccountEmail()`; assert it against `getGoogleAccountEmail()` (googleAuth) before token use (finding 9). `googleAccountAssertion` (in `services/auth/`, not `services/google/`) is an `onTokenAcquired` event subscriber asserting the _member's_ account — it is NOT a bound-account token resolver and is not reusable here.
5. `apis.google.com` / `accounts.google.com` serve `Access-Control-Allow-Origin: *` for the picker/api script, so `crossorigin="anonymous"` will not break loading (it enables CORS error visibility). Verify the script still loads after the change.
6. **Corrected:** use the global promise-based `confirm()` / `alert()` from `composables/useConfirm.ts` (the single `<ConfirmModal/>` is already mounted in `App.vue:1462`) for the "open existing file?" confirm — no new modal instance/primitive. Title/message are `UIStringKey`s; the dynamic family name goes in the plain-string `detail` arg (NOT interpolated into a key).

## Approach

### A. Adopt-existing recovery (centerpiece — findings 1, 3, 4, 5)

**Single source of truth for the decision.** Introduce one helper that both the create wizard and the recovery screen call, so the adopt logic exists in exactly one place (DRY):

- New: `resolveExistingBeanpod(collision: { fileId, name, ownerIsCurrentAccount })` in the sync layer (co-located with `connectStorage.ts`), returning a typed outcome. It owns the lazy stub probe: for an owned collision it downloads + attempts to inspect the envelope (decrypt-on-demand) and classifies stub-vs-populated-vs-ambiguous; for a not-owned collision it returns `reject-different-account` immediately without any download. This is the single decrypt-to-classify site. Outcomes:
  - `{ kind: 'adopt-silent' }` — owned + empty/stub → caller loads it and proceeds;
  - `{ kind: 'adopt-confirm' }` — owned + populated → caller shows confirm, then loads on accept;
  - `{ kind: 'reject-different-account' }` — not owned → caller shows the existing "pick a different name" hint.
- `connectDriveStorage` returns the collision discriminator it already has (`errorKind: 'name-collision'`, `collisionFileId`), extended with **only `collisionOwnedByCurrentAccount`** (cheaply read from the `ownedByMe` metadata the list call now returns — no extra fetch). It must NOT compute `collisionIsStub`: that requires downloading + decrypting the envelope, which violates this module's "select location, never read/write" contract (see its docstring) and can throw on the different-key case (Assumption 2). **Stub detection lives inside `resolveExistingBeanpod`**, run lazily and only for the owned case — a not-owned collision rejects before any download. This keeps the transport helper crypto-free and the one decrypt path in one place.
- "Adopt/load" reuses the **existing** load path (`syncStore.loadFromGoogleDrive` / `fromExisting` read) — no new download logic. After a successful adopt, onboarding continues exactly as a normal post-load flow (decrypt → pick bean → /nook).

**Create wizard (`CreatePodView`)** and **recovery screen (`ResumePodSetup.finishOnDrive`)** both:

1. call `connectDriveStorage`;
2. on `errorKind: 'name-collision'`, call `resolveExistingBeanpod(...)`;
3. switch on the outcome: silent-adopt → load+continue; confirm → `confirm()` (useConfirm; family name via `detail`) → load+continue or back to name step; reject → focused translated hint.

This collapses findings 1 + 5 (no dead-end, no second orphan) and gives the recovery screen parity with the wizard.

**Finding 5 specifically:** in `GoogleDriveProvider.createNew`, the collision pre-check currently swallows `listBeanpodFiles` errors and proceeds to create. Change: a list failure throws a typed `CollisionCheckUnavailableError` → `connectDriveStorage` returns `{ status: 'failed', error: <translated>, retryable: true }` → caller shows "couldn't verify your Drive — try again", never blind-creates a duplicate.

**Finding 3 (consent-denial message across redirect):** make the granular-consent throw a **typed `DriveConsentDeniedError`** (new, in `types/sync.ts`) instead of a string. App.vue boot branches on `instanceof` (not substring) and routes to `RESUME_SETUP_PATH` + a typed `&reason=drive-consent` param, extending the existing `route.query.resume` convention in `resumePaths.ts`. `ResumePodSetup` reads the reason on mount and renders a translated "you need to allow file access — reconnect" message with a reconnect CTA.

**Finding 4 (registry-error escape):** on the recovery screen's `registry-error` state, add a non-destructive "Create my family" affordance for the no-pod case (distinct from the danger-styled "start a new pod"), gated on "registry says no existing pod OR registry unreachable + user has no local pod". Keep the destructive path for the genuine "I want to abandon and start over" case.

### B. iOS transport correctness (findings 2, 6, 7)

- **Finding 2:** extract the connect path's redirect/silent decision so the resume _read_ path uses it too. Before `requestAccessToken()` in the resume probe, if `shouldUseRedirectAuth()` and no valid token, attempt `tryReconnectSilently`; if that fails, route to redirect-auth (return `redirecting`) rather than letting `requestAccessToken` open a popup. Never open a popup from a non-gesture `onMounted` path. The "Try again" button is a real gesture, so a manual retry may still use a popup on desktop — only the auto-probe is gesture-less and must avoid it.
- **Finding 6:** add `isNetworkError(e)` to `src/utils/` (it does **not** exist today) and use it in BOTH `withRetry` (`googleDriveProvider.ts:63`, currently inlines `/fetch|network/i`) and `write()`'s outer catch (`:177`, currently the narrow `.includes('fetch')`). DRY + fixes the iOS "Load failed" miss.
- **Finding 7:** `useJoinFlow` (`:434-437`) currently substring-matches `syncStore.error`. Surface the structured status (`loadFromGoogleDrive` already classifies `DriveApiError.status === 404` at `:2280`) as a structured field on the store error, and branch `useJoinFlow` on `status === 404 / 403` for the needs-pick path. No new error type.

### C. Auth layer (findings 8, 9, 10, 11)

- **Finding 8:** comment + ADR note only (see Requirements §9). Point the `preserveRefreshToken` path at `signOutAndClearData()` as the revoke route.
- **Finding 9:** in `read()`/`write()`, before `getValidTokenSilent()`, assert `getGoogleAccountEmail() === this.accountEmail` **only when `this.accountEmail` is non-null** (a null bound email legitimately means "not yet learned" → allow, the provider learns it); on a non-null **mismatch**, force a reconnect for the bound account rather than using the drifted token. **Reconcile with the existing `updateAccountEmailIfAvailable()` (`:327`, called from `syncStore.ts:2553`), which currently rebinds the provider to the drifted global email — keep its null→learn case, but tighten its `A→B` rebind (`:329-330`) to the same null-only rule** so the two paths agree (otherwise they contradict). (Do NOT use `googleAccountAssertion` — it asserts the member's account on token-acquired events, a different concern.)
- **Finding 10:** in `performSilentRefresh`'s loop, snapshot/re-read `currentRefreshToken` each iteration and `if (!currentRefreshToken) return null;` (treat as torn-down session — log `[googleAuth] silent refresh aborted: session torn down`), before the `!`-assertion. Do not count this as a transient failure.
- **Finding 11:** remove the `setFlushProvider()` call from `fromExisting()` AND from `createNew()`, and move flush registration into `syncService.setProvider()` — the single write-intent install seam. Verified zero-churn: every write-intent `fromExisting`/`createNew` caller (`syncStore.ts:860`, `:1409`, `syncService.ts:444`, `connectStorage.ts:149`) already calls `setProvider` immediately after, while the read-only callers (`loadFromGoogleDrive:2235`, `recoverFromMissingFile:2463`) never do — so they get a no-flush provider for free. Do NOT add a separate `installAsWriteProvider()` method: a second "remember to register" seam is exactly the forget-to-register reliability bug we're removing. One owner (`setProvider`), no new public surface.

### D. Observability, i18n, DRY (findings 12, 13, 14)

- **Finding 12:** in `drivePicker.ts` set `script.crossOrigin = 'anonymous'` before `src`. Verify the picker still loads.
- **Finding 13:** in `ResumePodSetup`, route the collision message through `t('createPod.duplicateFile')` / adopt-aware keys; never assign the raw `r.error` to `formError`. Add any new i18n keys (`en` + `beanie`, plus `npm run translate` for zh) for the adopt confirm + consent-denial + registry-escape copy.
- **Finding 14:** extract `handlePendingPassword(fileName: string)` that **wraps the call pattern** and internally calls the **existing** local `tryAutoDecrypt` (`LoadPodView.vue:114`) / `checkBiometricForFamily` (`:141`) — do NOT reimplement those. Replace the `needsPassword` blocks at sites `:184, :202, :233, :277, :443, :699`. **Note the sites diverge:** `:184/:202/:233` run `tryAutoDecrypt → checkBiometricForFamily`; `:277/:443` skip `tryAutoDecrypt` and go straight to biometric. The helper must accept this variance (a flag, or always-try-auto-decrypt-first if confirmed behavior-safe) rather than forcing one shape that changes behavior at `:277/:443`.

## Files Affected

- `src/services/sync/connectStorage.ts` — extend collision outcome (owner/stub flags, retryable); add/centralize `resolveExistingBeanpod`; reuse load path for adopt.
- `src/services/sync/providers/googleDriveProvider.ts` — collision pre-check no longer swallows list failure (finding 5); `read()`/`write()` bound-account token (finding 9); `write()` network classifier (finding 6); remove `setFlushProvider()` from `fromExisting()` + `createNew()` (finding 11 — flush registration moves to `syncService.setProvider`).
- `src/services/sync/syncService.ts` — `setProvider()` becomes the single flush-registration owner (finding 11).
- `src/stores/syncStore.ts` reconcile note (finding 9): tighten `updateAccountEmailIfAvailable`'s caller seam (`:2553`) to the null-only-learn rule alongside the provider change.
- `src/components/login/ResumePodSetup.vue` — handle `name-collision` + adopt path (1); registry-error escape (4); consent-denial reason on mount (3); translated collision error (13).
- `src/components/login/CreatePodView.vue` — call shared adopt resolver on collision (1); keep different-account hint.
- `src/stores/syncStore.ts` — resume probe redirect/silent guard, no non-gesture popup (2); propagate `DriveApiError.status` (7); ensure read paths use non-flush provider build (11).
- `src/services/google/googleAuth.ts` — `completeRedirectAuth` carries consent-denial reason (3); `performSilentRefresh` null-safe per attempt (10); comment on `clearGoogleSessionState` preserve path (8).
- `src/services/google/driveService.ts` — add `ownedByMe` to `listBeanpodFiles` + `searchBeanpodFilesGlobal` `fields`, **thread it through the shared `mapFileResults` helper (`:551`) + its types**, and add it to `searchBeanpodFilesGlobal`'s inline `.map` (`:373`) (owner discriminator, finding 1).
- `src/composables/useJoinFlow.ts` — branch on structured HTTP status not localized substring (7).
- `src/services/google/drivePicker.ts` — `crossOrigin = 'anonymous'` (12).
- `src/components/login/LoadPodView.vue` — extract `handlePendingPassword` wrapping existing `tryAutoDecrypt`/`checkBiometric` (14).
- `src/utils/isNetworkError.ts` (new) — shared network-error classifier `/fetch|network/i`, used by `withRetry` + `write()` (6).
- `src/services/translation/uiStrings.ts` — new keys (adopt confirm, consent-denial, registry escape) `en` + `beanie`; then `npm run translate` for zh.
- `src/types/sync.ts` — add `CollisionCheckUnavailableError` + `DriveConsentDeniedError` (finding 3). (NOT `DriveApiError` — that already lives in `driveService.ts`.) Collision metadata on `StorageConnectFailed` (in `connectStorage.ts`): rather than loose optional siblings per finding, group as one nested `collision?: { fileId: string; ownedByCurrentAccount: boolean }` (present iff `errorKind === 'name-collision'`) plus a single top-level `retryable?: boolean` for the finding-5 "couldn't verify" case. Keeps the failure shape legible.
- `src/composables/useConfirm.ts` — reused as-is for the adopt confirm (no change; listed for clarity).
- `docs/adr/` — short ADR note for finding 8 (trusted-device sign-out grant-preservation is intentional; `signOutAndClearData` is the revoke path) and for the adopt-existing recovery semantics.
- Tests — see Testing Plan.

## Acceptance Criteria

- [ ] On iOS redirect onboarding, a second attempt after an aborted first attempt **completes** (no name-collision dead-end): empty orphan adopts silently; populated owned file prompts confirm then opens.
- [ ] A same-name file owned by a _different_ account still shows the focused "pick a different name" hint (create wizard AND recovery screen), translated, with no internal `fileId` leaked.
- [ ] Granular `drive.file` deselection on the redirect path lands the user on a screen that explains they must re-allow file access, with a reconnect CTA (not a silent route).
- [ ] A transient `listBeanpodFiles` failure during create does NOT create a second `.beanpod`; the user sees a retryable "couldn't verify your Drive" message.
- [ ] Registry-unreachable on resume offers a non-destructive way forward for a no-pod user (not only the destructive "start a new pod").
- [ ] The resume auto-probe never opens a popup on iOS without a gesture; it routes to silent/redirect instead.
- [ ] A Drive write failing with WebKit `TypeError: Load failed` is enqueued offline (not lost).
- [ ] iOS join recovery offers the Picker on 404/403 regardless of UI locale.
- [ ] `read()`/`write()` use the provider's bound account; account drift no longer produces a wrong-account 404/403 reconnect loop.
- [ ] Concurrent sign-out during silent-refresh backoff does not throw / does not inflate the consecutive-failure counter.
- [ ] Read-only resume/recovery provider builds perform no flush-write.
- [ ] iOS errors thrown inside the Google API script surface a real message + stack in `#beanies-errors` (no opaque "Script error." from this source).
- [ ] Finding 8: code comment + ADR note present; behavior unchanged; `signOutAndClearData` confirmed to revoke + wipe.
- [ ] `LoadPodView` decrypt/biometric handoff lives in one helper; all 6 call sites use it.
- [ ] `npm run validate` green (lint incl. i18n rules, type-check, unit suite); new zh keys reviewed.

## Testing Plan

### Unit (Vitest)

1. **`resolveExistingBeanpod`** — table test: owned+stub → adopt-silent; owned+populated → adopt-confirm; not-owned → reject; un-parseable/ambiguous → adopt-confirm (fail-safe).
2. **`createNew` collision pre-check** — list failure → throws `CollisionCheckUnavailableError`, never creates (assert createFile not called). Existing same-name → `FileNameCollisionError` with owner/stub flags.
3. **`write()` network classifier** — `TypeError('Load failed')` and `TypeError('Failed to fetch')` both enqueue; a non-network error still throws.
4. **`performSilentRefresh`** — `currentRefreshToken` nulled between attempts → returns null cleanly, no throw, no consecutive-failure increment (use `vi.resetAllMocks` per the project gotcha for `mockImplementationOnce`).
5. **`useJoinFlow`** — 404/403 `DriveApiError` (any locale message) → needs-pick branch.
6. **bound-account token** — provider bound to A, session drifted to B → token request targets A (or forces reconnect), not B.
7. **`fromExisting` no flush** — building a read provider does not register a flush target.

### Component (Vitest + Testing Library)

8. **`ResumePodSetup`** — collision → adopt confirm modal shown for populated; silent adopt continues for stub; different-account → translated hint, no `fileId`. registry-error → non-destructive create affordance present.

### E2E (Playwright, Chromium) — Three-Gate Filter applied

9. **One new E2E: "onboarding recovers from an orphaned pod file."** Real user blocked + data flow (gate 1 ✓), full-stack (gate 2 ✓), no `waitForTimeout`/copy selectors (gate 3 ✓). Simulate an existing same-name owned stub in the Drive mock, run create → assert it adopts and reaches `/nook` with data (assert via IndexedDB export, not DOM). **Budget: at 25-test cap — consolidate or retire one existing onboarding E2E to make room (identify in implementation).**

### Why existing tests didn't catch the loop

The collision path had unit coverage for _create-wizard_ `name-collision` but **no test for the recovery screen's `finishOnDrive` collision branch** (it had none) and **no test for the orphan-then-retry sequence** (each attempt was tested in isolation, never "attempt 1 leaves state → attempt 2"). The new tests #1, #2, #8, #9 close exactly that gap.

### Manual / device

10. Real iPhone (iOS Safari) redirect onboarding: abort attempt 1 mid-flow, retry → completes. Verify `#beanies-errors` now shows a real message if the Google script throws (finding 12).

## Help Center Coverage

Not required — this is a bug-fix / reliability hardening pass. It changes _how reliably_ existing flows work, not _what_ the user can do. No new feature, no behavior the user must learn. (The adopt-existing confirm is self-explanatory in-context.)

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full plan — 4 clusters, 15 findings, adopt-existing centerpiece with locked semantics, finding-8 as doc-only, full files/AC/testing incl. the "why tests missed it" analysis.
- **Pass 2 (DRY + error handling)**: Verified all reuse claims against source. (1) Adopt-confirm uses global promise-based `confirm()`/`alert()` (`useConfirm.ts`; `<ConfirmModal/>` already mounted) — not a new modal; family name via `detail`. (2) Finding 9: `googleAccountAssertion` (services/auth/, a token-acquired subscriber) is NOT a bound-account resolver — replaced with `getAccountEmail()` vs `getGoogleAccountEmail()` assert-or-reconnect. (3) `isNetworkError` doesn't exist; `withRetry`(:63) inlines the regex, only `write()`(:177) uses narrow `.includes('fetch')` — add one util, use both. (4) `DriveApiError` lives in `driveService.ts` not `types/sync.ts`; finding 7 surfaces structured status, no new type; `types/sync.ts` instead gains typed `DriveConsentDeniedError` for finding 3. (5) `listBeanpodFiles` returns no owner — require `ownedByMe` field (driveService.ts added). (6) Recovery-reason = `route.query.resume` convention in `resumePaths.ts`; finding 3 adds typed `&reason=drive-consent` + typed error for `instanceof` branching. (7) Finding 14: `tryAutoDecrypt`/`checkBiometric` already local — `handlePendingPassword` wraps the call pattern (sites :200,:233,:277,:443,:699), doesn't reimplement.
- **Pass 3 (Sustainability)**: Grounded in source; tightened four coupling/complexity risks. (1) Finding 11 locked to "`setProvider` owns flush" (removed the `installAsWriteProvider` alternative) — verified every write-intent `fromExisting`/`createNew` caller already calls `setProvider`, so zero-churn and no new "remember to register" seam; also strip `setFlushProvider` from `createNew`; `syncService.ts` added to Files Affected. (2) Removed `collisionIsStub` from `connectDriveStorage`'s return — stub detection needs decryption, which breaks the helper's documented "select location, never read/write" contract; moved the lazy decrypt-to-classify into `resolveExistingBeanpod` as the single site, owned-collisions only. (3) Grouped collision metadata into one nested `collision?:{fileId,ownedByCurrentAccount}` field instead of widening `StorageConnectFailed` per finding. (4) Added explicit contract that `resolveExistingBeanpod` catches any download/decrypt throw → `adopt-confirm` (ambiguous), never re-thrown, so a wrong-key orphan can't re-trap the user.
- **Pass 4 (Fresh-eyes sweep)**: Re-grounded every load-bearing anchor against source; architecture confirmed sound. Three line-anchored corrections. (1) Finding 1: `ownedByMe` must thread through the shared `mapFileResults` helper (`driveService.ts:551`) + its types, not just the `fields=` strings, or the fetched field is discarded; `searchBeanpodFilesGlobal`'s inline `.map` needs it too. (2) Finding 9: reconciled with the pre-existing `updateAccountEmailIfAvailable()` (`:327`, called from `syncStore.ts:2553`) which currently rebinds the provider to the drifted global email — its `A→B` rebind must adopt the same null-only-learn rule as the new read/write assertion, else the two paths contradict. (3) Finding 14: helper is `checkBiometricForFamily` (`:141`) not `checkBiometric`; sites diverge (`:277/:443` skip `tryAutoDecrypt`), so the extracted helper must preserve that variance. No other changes — Passes 1-3 covered the substantive risks.

## Implementation Notes (as built, 2026-06-19)

All 15 findings implemented across the four clusters. `npm run validate` green (type-check, lint 0 errors, **3349 unit tests pass**, build, prettier). New ADR-031 records the adopt-existing semantics + the finding-8 decision. zh translations synced (9 keys, spot-checked clean).

**As-built deviations / decisions:**

- **Consent-reason channel:** used a sessionStorage-backed `setResumeReason`/`consumeResumeReason` in `resumePaths.ts` (survives the full-page redirect, decoupled from the shared `RESUME_SETUP_PATH`) rather than a URL `&reason=` param. Functionally equivalent; avoids mutating the shared redirect.
- **Finding 2 placement:** the redirect/silent guard lives in `attemptResumeFromRegistry` (the only gesture-less caller) rather than inside `loadFromGoogleDrive` — narrower blast radius; other callers arrive with a token. Added a `redirecting` result kind to `ResumeFromRegistryResult`.
- **Finding 4:** with adopt-existing now protecting the create path, the retry-screen escape was downgraded from a danger confirm to a reassuring info confirm (`resumeSetup.startNewConfirm*` reworded) — non-destructive, no longer a trap.
- **Stub detection is decryption-free:** classifies the `'{}'` placeholder / non-V4 vs. a real V4 envelope structurally (`detectFileVersion`), so the "orphan encrypted with a different key" risk never arises.

**Test coverage (as built):**

- Unit: `isNetworkError` (Safari "Load failed"); `connectStorage` — `resolveExistingBeanpod` 4-way (reject / stub / populated / throw→fail-safe) + `adoptDriveStub`; `useDriveCollisionRecovery` orchestration (5 cases); `googleDriveProvider` — Safari-network enqueue, bound-account guard (drift→throw, null→learn), `fromExisting` no-flush, collision-check-unavailable throws-not-creates; `driveService` `ownedByMe`; `googleAuth` — silent-refresh null-mid-retry bail (finding 10); `useJoinFlow` 404 structured-status → needs-pick. Existing resume/provider/driveService tests updated to the new behavior.
- **E2E: deliberately NOT added.** The E2E budget has room (21/25), but the existing harness does not mock the Google Drive/OAuth network — a Drive-orphan-recovery E2E would require mocking the entire Drive REST + OAuth surface, which is "testing your own mocks" (explicitly forbidden by the project E2E rules). The adopt logic is pure and covered by the unit + composable-orchestration tests above; the real integration risk (the wiring) is covered by the orchestrator-composable test. Revisit only if a Drive-mock E2E harness is built for other reasons.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (error-review invocation, 2026-06-19)

greg pasted 4 `#beanies-errors` Slack alerts from helping a friend onboard on iPhone (continual errors, 4+ attempts, unsuccessful). Asked to: triage all errors via error-review, then do a full comprehensive review of ALL onboarding code via `/code-review ultra`, inventorying every onboarding file first; weight iPhone; review recent onboarding commits since "previous fixes may have permanently broken iphone onboarding."

### Follow-up — review engine

"Rather than a code review ultra invoke a /code-review max."

### Follow-up — fix slicing

Chose "One /beanies-plan, full set" — route all 15 findings into a single plan, clustered.

### Follow-up — adopt semantics

"Auto-adopt empty, confirm populated" — orphan stub adopts silently; populated owned file confirms ([Open it]/[Start fresh]); different account → collision error stays.

### Follow-up — finding 8

"(1) - I want to keep the current behavior - but to be clear, don't we already have a 'sign out and delete data' option which deletes all local data and revokes consent?" → Confirmed: `signOutAndClearData()` revokes grant + wipes data + resets trust. Finding 8 → documentation only.

</details>
