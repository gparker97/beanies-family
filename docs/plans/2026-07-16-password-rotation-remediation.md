# Plan: Password-rotation remediation — offline gate, timeout/fail split, verified rollback

> Date: 2026-07-16
> Related issues: Notion #54 (remediation of the change committed `5e27b7ed`; no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-07-16-password-rotation-remediation.md`

## User Story

As a family member changing or resetting a password, I want the app to (a) tell me plainly when I need a connection instead of failing with a scary error, (b) never silently leave my credential half-rotated when a rollback can't complete, and (c) not wait ~24s or fire false alarms when a save simply couldn't happen — so the durable-or-rollback guarantee from #54 holds without the rough edges a high-effort review found.

## Context

The #54 transactional-rotation change (`rotateMemberPassword` in `src/stores/authStore.ts`, committed `5e27b7ed`) made password change/reset durable-or-rollback. A subsequent high-effort code review (15 agents, 4 finders + independent verify) found **10 verified defects**, all in the rollback path. They collapse into two root causes plus supporting issues:

1. **Offline conflation (findings 3/6/8).** The code treats "genuinely offline / save cleanly failed (nothing written)" identically to "timed out (a non-cancellable write may have landed)." Consequence: an offline password change (a) fully rolls back and shows _"Couldn't save your new password"_ (scary), (b) fires a **false `critical` Slack page** claiming a cross-device-lockout window when nothing ever reached Drive, and (c) blocks ~**24s** (12s durable + 12s convergence) before surfacing the error. The old `syncDeferred` path let an offline user change locally and sync later — but this app **deletes the IndexedDB cache on sign-out**, so an offline-only rotation genuinely _can_ be lost, which is exactly why #54 chose durable-or-rollback. greg's decision (2026-07-16): **block early with a friendly message** when a durable save is confidently impossible — don't restore the fragile deferred path, but don't punish the offline user with the rollback+page+24s path either.

2. **Unverified rollback (findings 0/1/2).** `restoreCredential()` awaits `familyStore.updateMember(...)` but **discards its return value**; `updateMember` returns `null` on failure (not a throw — `familyStore.ts:264`, `wrapAsync`). So a failed local hash-restore is reported as a successful rollback ("nothing changed, your current password still works") while the local doc holds the **new** hash → silent device lockout. Additionally the whole durable-save + rollback region has **no `try/catch`**: if `envelope` is cleared mid-flight (concurrent sign-out/family-switch), `syncStore.setMemberWrappedKey` throws `"No envelope loaded"` (syncStore.ts:1657), which rejects straight out of `rotateMemberPassword` — skipping the rollback log, the convergence re-save, and the critical page, and leaving the new hash locally. And `ResetMemberPasswordModal.handleSave` has only a `finally` (no `catch`), so that rejection shows the admin **nothing at all** (the Settings change-password modal _does_ have a `catch`).

Supporting issues: a **`syncNow` rejection** after a _successful_ Drive write (the post-write `settingsRepo.saveSettings` at `syncStore.ts:593` is outside any try/catch) currently misreports a durable success as failure (finding 5); the **`updateFailed` user copy** ("Saved the new key locally but couldn't update your password record") is now false because that path rolls the wrap back (finding 7); and a lone rotation-save failure can in principle coincide with a pre-existing `SaveFailureBanner` (finding 9, PLAUSIBLE, low-risk).

### Verified facts from the codebase (investigation 2026-07-16, re-verified on disk)

- **Provider / connectivity signals** (`src/services/sync/syncService.ts`): `getProvider(): StorageProvider | null` (`:419`), `getProviderType(): StorageProviderType | null` (`:412`), `getProviderFamilyId(): string | null` (`:430`). `doSave` returns `false` (never throws) when `!currentProvider` / `!currentFamilyKey` / `!currentEnvelope` / provider-family-mismatch (`:870-888`) and **catches all in its body** → `false` (`:957-962`). syncStore mirrors: `storageProviderType` ref (`:199`) kept in sync via `onStateChange` (`:372`), `isGoogleDriveConnected` computed (`:201`). No `syncEnabled` live getter (it's only a persisted settings field). `navigator.onLine` is used elsewhere (`useOnline.ts`, `offlineQueue.ts`) but NOT in the save path. `syncStore` imports the service as `syncService`, so `syncService.getProviderType()` is callable in-store.
- **`raceTimeout` distinguishes timeout from clean-fail** (`src/utils/timing.ts:39-47`): on timeout it resolves the **distinct sentinel `undefined`**; a promise resolving `false` stays `false`; a genuine rejection still propagates. `syncNow(true)` (`syncStore.ts:582-599`) returns strictly `boolean`, never `undefined`. `syncNowBounded` (`:575-577`) is currently `!!(await raceTimeout(syncNow(true), ms))` — it **collapses** the distinction AND swallows the reject-vs-false difference (a post-write rejection would propagate straight through, since the `!!` never runs), so the durable path must NOT use `syncNowBounded` in its current form. (This plan makes `syncNowBounded` delegate to the new `syncNowDurable` — see Approach B — so both share one core.)
- **`syncNow` can reject only post-write** (`syncStore.ts:591-598`): `save()` never throws (`doSave` catches all → `false`, `:957-962`); the un-try/caught `await settingsRepo.saveSettings(...)` at `:593` runs **only when `save()` returned `true`**, so any rejection strictly implies the Drive write **succeeded**. `raceTimeout` re-throws genuine rejections (`timing.ts:44`).
- **`SaveFailureBanner`** (`syncService.ts` + `syncStore.ts`): a _single_ failed save reaches level `'warning'` only; the banner shows only at `'critical'` = **3+ consecutive** failures (deferred 5s). A subsequent success resets the counter. So a lone rotation failure never raises the banner unless ≥2 prior consecutive failures already occurred this session.
- **`updateMember` returns `null` on failure, never throws** (`familyStore.ts:252-265`, `wrapAsync` → `result ?? null`). Checking the return is the correct rollback failure signal.
- **`reportError(input)`** (`src/utils/errorReporter.ts:69`) takes `{ surface, message, error?, severity?, context? }`; `surface` is a free-form `string` (`:46`), so a new value like `'sync-now-durable'` needs no type change. It has its own top-level `try/catch` (`:78`) so it never throws to the caller. Only `severity: 'critical'` pages Slack (`:275`). **`logEvent(input)`** (`src/services/telemetry/logEvent.ts:108`) takes `{ level, surface, message, context? }` with a re-entry guard — never throws. Both filter `context` through `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61`), which already includes `action`, `error_code`, `severity`, `member_id_tail` — the only keys used here. New `action` _values_ need no allowlist change (only keys are allowlisted).
- **`reportError` is already imported in `syncStore.ts`** (`:61`); no new import needed for `syncNowDurable`. **`reportError` is NOT imported in `ResetMemberPasswordModal.vue`** — it must be added there (Approach E).
- **Change-password error copy is split**: `changePassword.errorMessages` (authStore.ts:869-878) holds `familyKeyMissing` / `wrapFailed` / `updateFailed` as **inline English strings** and `saveFailed` via `useTranslationStore().t('changePassword.error.saveFailed')`. There is **no** `changePassword.error.updateFailed` i18n key — that stale copy is the inline string at authStore.ts:872-873. Only the reset surface routes 100% through i18n (`t('family.resetPassword.error.${error}')`), so `family.resetPassword.error.updateFailed` (uiStrings.ts:1969) is the i18n one.

## Requirements

1. **Early offline/no-durable-target gate (findings 3/6/8).** Before mutating anything, if a durable save is confidently impossible — no write provider configured, or a `google_drive` provider while `navigator.onLine === false` — return a new `RotateError: 'noConnection'` with a calm "you'll need a connection to change your password" message. NO mutation, NO rollback, NO convergence, NO `critical` page, NO 12s wait. This applies to the two user surfaces; `signin-heal` is unaffected (it stays best-effort and never blocks).
2. **Timeout vs clean-fail split (findings 6/8).** Replace the durable path's `syncNowBounded(...)` with a three-state outcome (`'saved' | 'failed' | 'timeout'`) that reads `raceTimeout` directly:
   - `'saved'` → success.
   - `'failed'` (clean — write did NOT complete) → roll back, **no convergence re-save, no `critical`**, return `saveFailed`. Fast (no second 12s).
   - `'timeout'` (ambiguous — non-cancellable write may have landed) → roll back **+ convergence re-save + `critical`-on-re-save-failure**, return `saveFailed`.
3. **`syncNow` rejection = durable success (finding 5).** A rejection from `syncNow(true)` strictly implies the Drive write already succeeded (only the post-write settings-metadata write threw). The three-state outcome maps a rejection to `'saved'` (log a `warning` for the metadata failure). The rotation must NOT be reported as failed in this case. **This same reject-means-saved mapping is reused for the convergence re-save** (a post-write rejection there means Drive converged back to the old password → success, not `critical`).
4. **Verified rollback (findings 0/1/2).** `restoreCredential` returns a boolean success and is fully guarded (try/catch + checks `updateMember`'s return). If any piece of the rollback fails (setter throws, or `updateMember` returns null), that is genuinely data-at-risk → emit `critical` and return a new `RotateError: 'rollbackFailed'` ("we couldn't fully undo the change — please sign out and back in") — distinct from `saveFailed`, so the "nothing changed" copy is only ever shown when the rollback actually succeeded. **The rollback guard lives inside `restoreCredential` (the single rollback path — DRY), which is the exact call that can throw on a mid-flight `envelope`-clear; every other call in the durable region is internally guarded and cannot throw, so no additional region-level `try/catch` is needed** (see Approach C for the throw-free-by-construction argument).
5. **No half-rotation persisted (finding 2).** The `updateFailed` path already rolls back the wrap locally; keep that, and it now also benefits from the verified-rollback boolean (a failed wrap-restore → `rollbackFailed` + `critical`).
6. **Reset-modal catch (finding 4).** `ResetMemberPasswordModal.handleSave` gets a `catch` that surfaces an inline `formError` + `reportError`, matching `ChangePasswordSettings.vue`'s existing pattern (defense-in-depth even though the store no longer throws; also covers a stray `hashPassword` rejection, which currently propagates silently through the missing catch).
7. **Corrected copy (finding 7) + new keys.** Fix the stale `updateFailed` copy for both surfaces (no longer "saved locally") — **note the change-password one is an inline string in authStore, the reset one is in uiStrings** (see Approach F). Add `noConnection` + `rollbackFailed` copy for both surfaces (en + beanie + zh).
8. **Observability.** Success/rollback/critical outcome events continue to ride the existing allowlisted keys (`action`/`error_code`/`severity`/`member_id_tail`) — no new context keys. Add an outcome value for the early-gate (`action:'rotation-blocked-offline'`, `info`) and the rollback-failed (`action:'rotation-rollback-failed'`, `critical`).
9. **Unit tests** for every new branch: early offline gate (no mutation), clean-fail rollback (no convergence/critical), timeout rollback + convergence + critical-on-re-save-fail, rejection-as-saved (primary and convergence), rollback-failed → `rollbackFailed` + critical, reset-modal catch surfaces an error, and a `syncNowBounded`-delegation regression (signin-heal on a post-write reject returns success without throwing).

## Important Notes & Caveats

- **`signin-heal` is untouched behaviorally.** It re-wraps with the CURRENT password (no old/new split-brain), must never block sign-in, and keeps its 5s best-effort `syncNowBounded()` call. Do NOT route it through the early gate, the three-state outcome, or the rollback path — a blocking/erroring heal would reopen the 0.9.5R3/R4 spinner-freeze class. Branch on `surface === 'signin-heal'` exactly as today. **Note:** because `syncNowBounded` now delegates to `syncNowDurable` (see the single-core point below), one _latent_ edge changes for signin-heal: a post-write `syncNow` rejection now maps to `'saved'`→`true` instead of throwing out of the un-caught signin-heal branch. This is strictly a robustness improvement (it _removes_ a throw path — it cannot cause the block/error spinner-freeze regression, which was about hangs/errors, not about a save succeeding), and reject-means-saved is the correct semantics established in finding 5. A regression test asserts signin-heal still returns success and does not throw on this path.
- **The early gate must not false-block online users.** Only block when durability is _confidently_ impossible: `getProviderType() === null` (cache-only family, no write target) OR (`getProviderType() === 'google_drive'` AND `navigator.onLine === false`). A `local`-file provider is durable without network → never blocked on connectivity. An online Drive provider that then fails mid-write is NOT pre-blocked — it falls through to the durable-or-rollback path (clean-fail → fast rollback, no page). Guard `navigator` for non-browser/test contexts (`typeof navigator !== 'undefined'`).
- **The `'failed'` vs `'timeout'` distinction is the whole point of the three-state helper.** The old `!!(await raceTimeout(...))` shape collapses `undefined`→`false` AND would let a post-write rejection propagate uncaught. The durable path needs the raw three-way plus reject-means-saved. **Single-core rule:** put the three-state logic in ONE syncStore helper, `syncNowDurable`, and make the existing `syncNowBounded` a thin wrapper over it (`(await syncNowDurable(ms)) === 'saved'`). This keeps authStore free of timing/`raceTimeout` wiring AND — critically for maintainability — leaves exactly ONE place that knows `syncNow`'s timeout + reject-means-saved semantics. (The syncStore comment at `:566` already declares `syncNowBounded` "the single home for the `raceTimeout(syncNow(true), …)` pattern"; adding a _second, independent_ copy of that core would contradict that invariant and let the two drift. Delegation preserves the invariant.) Both the primary durable save AND the convergence re-save call `syncNowDurable` directly.
- **`critical` is now correctly scoped.** After this change `critical` fires ONLY when (a) the durable save TIMED OUT (write may have landed) AND the convergence re-save also failed to confirm `'saved'` — the true residual cross-device-lockout window — OR (b) a rollback itself failed (local credential may be half-reverted). It NO LONGER fires for a routine offline/clean-fail attempt (which now either never mutates — early gate — or rolls back cleanly with no page), and no longer false-fires on a convergence post-write metadata rejection (which now maps to `'saved'`).
- **`rollbackFailed` copy must be actionable.** "We couldn't fully undo the change. Please sign out and back in to be safe, then try again." — because a failed local hash-restore means the device's cached credential state is uncertain; a sign-out clears the cache and reloads authoritative state from the durable file.
- **Do NOT reintroduce `syncDeferred`.** The durable-or-rollback contract stands; the early gate replaces the deferred path for the offline case.
- **Reset-surface `t(... as never)` cast is a known type-safety gap (low priority, not fixed here).** The change-password surface maps errors through an exhaustive `Record<RotateError, string>` (compile-time key coverage), while the reset surface uses `t(\`family.resetPassword.error.${result.error}\` as never)`, which defeats compile-time checking that every `ResetError`variant has an i18n key. Adding`noConnection`/`rollbackFailed`/`unexpected` relies on the copy-rendering test rather than the compiler to catch a missing key. Converting the reset modal to an exhaustive map is a reasonable future cleanup but is out of scope here; the rendering test is the guardrail for this change.
- **`hashPassword`-throw pre-mutation residual (documented, out of scope — NOT one of the 10 findings).** Between the wrap mutation (`wrapFamilyKeyForMember`, authStore.ts:154, inside its own `try/catch`→`wrapFailed`) and the `passwordHash` write (`updateMember`, `:166`) sits an un-guarded `await hashPassword(newPassword)` (`:165`). If `hashPassword` (a local SubtleCrypto digest) were to reject — near-zero probability, and not observed by the 15-agent review — the in-memory envelope would already hold the **new** wrapped key while `passwordHash` stays **old** (a half-rotated in-memory envelope that would ride the next auto-sync to Drive), with no rollback. This is (a) pre-existing (present before `5e27b7ed`), (b) the same "no rollback of a _partial_ wrap" property the existing `wrapFailed` catch already accepts, and (c) negligibly probable. The **user-facing** side is what this plan fixes: the new reset-modal `catch` (finding 4) and the existing `ChangePasswordSettings.vue` catch both now surface an inline error instead of a silent stop on such a rejection. Adding envelope-rollback around `hashPassword` would be scope creep beyond the #54 remediation and is intentionally deferred; it is called out here so the decision is conscious rather than an oversight. (If ever revisited, the clean fix is to compute `hashPassword` _before_ `wrapFamilyKeyForMember`, so a hash failure precedes any mutation.)
- **Telemetry stays on existing allowlisted keys** — no `ALLOWED_CONTEXT_KEYS` / privacy-manifest / Lambda-mirror edits.
- **Finding 9 (banner) is a documented low-risk residual, not fixed here.** A lone rotation-save failure never raises the banner (needs 3 consecutive); if a user already had ≥2 consecutive save failures this session, the banner ("your data isn't saving") and the modal ("your password didn't change") are both _true_, not contradictory. Rotation-specific banner suppression would add coupling for a benign edge — out of scope, noted.

## Assumptions

> Review before implementation.

1. `syncService.getProviderType()` / `getProvider()` are exported and callable from syncStore (they already back `storageProviderType`). The early gate calls `syncService.getProviderType()` directly (always current at call time, not a stale ref). (Verified: `syncService.ts:412`, `syncStore.ts:199,372`.)
2. `raceTimeout(syncNow(true), ms)` yields `true`/`false`/`undefined` distinctly, and re-throws a genuine `syncNow` rejection. (Verified: `timing.ts:39-47`.)
3. `syncNow(true)` only ever rejects via the post-write `settingsRepo.saveSettings` (i.e. after `save()` returned `true`), so reject ⇒ durable write succeeded. (Verified: `syncStore.ts:591-598`, `doSave` catches all `:957-962`.)
4. `familyStore.updateMember` returns `null` (not throw) on failure. (Verified: `familyStore.ts:252-265`.)
5. greg-confirmed (2026-07-16): block early with a friendly message on offline/no-provider; keep durable-or-rollback for the online-but-failed case; do not restore the deferred path.
6. `navigator.onLine === false` is a reliable "definitely offline" signal (false positives for "online but Drive unreachable" are acceptable — those fall through to the durable path and roll back cleanly, no page).
7. Making `syncNowBounded` delegate to `syncNowDurable` changes only one latent edge (post-write reject → `true` instead of a throw), which is a strict robustness improvement for its two callers (login-completion + signin-heal) and cannot reopen the spinner-freeze regression. (To be confirmed by the delegation regression test.)

## Approach

All changes stay within the existing single-home `rotateMemberPassword` + its two syncStore helpers + the two modals' copy/catch. No new module, no new indirection layer. `syncNowDurable` becomes the single implementation of the `raceTimeout(syncNow(true), …)` core; `syncNowBounded` is refactored into a one-line wrapper over it.

**A. syncStore — `canDurablySaveNow()` (early gate).**

```ts
function canDurablySaveNow(): boolean {
  const providerType = syncService.getProviderType(); // 'google_drive' | 'local' | null
  if (!providerType) return false; // cache-only family: no durable target
  if (providerType === 'google_drive' && typeof navigator !== 'undefined' && !navigator.onLine) {
    return false; // cloud provider needs the network
  }
  return true; // local file, or online cloud
}
```

Exported from the store. (Reads the non-reactive singleton via `syncService.getProviderType()` — the same source `storageProviderType` mirrors — so it's always current at call time, not a stale ref.)

**B. syncStore — `syncNowDurable(timeoutMs): Promise<'saved' | 'failed' | 'timeout'>` as the SINGLE core; `syncNowBounded` delegates to it.** `syncNowDurable` keeps all `raceTimeout`/reject semantics in ONE place — used by the primary durable save, the convergence re-save, AND (via delegation) by `syncNowBounded`:

```ts
async function syncNowDurable(timeoutMs: number): Promise<'saved' | 'failed' | 'timeout'> {
  try {
    const r = await raceTimeout(syncNow(true), timeoutMs);
    if (r === undefined) return 'timeout'; // non-cancellable write may still be in flight
    return r ? 'saved' : 'failed'; // clean success / clean failure (write did not complete)
  } catch (e) {
    // syncNow rejects ONLY after a successful Drive write (post-write settings-metadata write threw).
    // The credential IS durable; surface the metadata failure but report saved.
    reportError({
      surface: 'sync-now-durable',
      severity: 'warning',
      message:
        'syncNow rejected after a successful Drive write (settings metadata write failed) — credential is durable',
      error: e,
    });
    return 'saved';
  }
}

// Thin wrapper — preserves the syncStore ":566 single-home" invariant so there is
// exactly ONE implementation of the raceTimeout(syncNow(true)) + reject-means-saved
// core. Behavioral note vs. the old `!!(await raceTimeout(...))`: a post-write reject
// now maps to `true` (durable) instead of throwing — strictly safer for both callers.
async function syncNowBounded(timeoutMs = POST_AUTH_SAVE_TIMEOUT_MS): Promise<boolean> {
  return (await syncNowDurable(timeoutMs)) === 'saved';
}
```

Both exported. `POST_AUTH_SAVE_TIMEOUT_MS` and `DURABLE_ROTATION_SAVE_TIMEOUT_MS` (12000, already added in `5e27b7ed`) unchanged and reused. (`reportError` is already imported in syncStore — `:61`.)

**C. authStore — `rotateMemberPassword`.**

- **Types:** `RotateError` gains `'noConnection'` and `'rollbackFailed'` (in addition to the existing `'saveFailed'`). `RotateResult` unchanged (`{success:true} | {success:false; error}`). `ResetError` inherits via the union, so both modals' error maps stay exhaustive at compile time (the change-password map does; the reset surface's `as never` cast does not — see caveat).
- **Early gate (user surfaces only), before any mutation.** Placement: right after the existing `familyKeyMissing` guard (authStore.ts:127) — i.e. after `memberIdTail` is computed (`:118`) and after the non-mutating `old` snapshot (`:129-136`), and before the first mutation (`wrapFamilyKeyForMember`, `:154`). Both the familyKey guard and this gate are cheap non-mutating pre-checks; either order between them is correct, but keeping the gate immediately after it groups the two "can't even start" early-returns together.
  ```ts
  if (surface !== 'signin-heal' && !syncStore.canDurablySaveNow()) {
    logEvent({
      level: 'info',
      surface,
      message: 'rotation blocked — no durable save target',
      context: { member_id_tail: memberIdTail, action: 'rotation-blocked-offline' },
    });
    return { success: false, error: 'noConnection' };
  }
  ```
- **`restoreCredential` returns success + is the single guarded rollback path:**
  ```ts
  async function restoreCredential(opts?: { wrapOnly?: boolean }): Promise<boolean> {
    try {
      await syncStore.setMemberWrappedKey(memberId, old.wrappedKeyEntry); // may throw on mid-flight envelope-clear
      if (!opts?.wrapOnly) {
        const restored = await familyStore.updateMember(memberId, {
          passwordHash: old.passwordHash,
          requiresPassword: old.requiresPassword,
        });
        if (!restored) return false; // local hash NOT reverted — new hash may persist
      }
      return true;
    } catch (e) {
      reportError({
        surface,
        severity: 'critical',
        message: 'rollback threw — credential may be half-rotated',
        error: e,
        context: { member_id_tail: memberIdTail, action: 'rotation-rollback-failed' },
      });
      return false;
    }
  }
  ```
- **`updateFailed` path:** `const ok = await restoreCredential({ wrapOnly:true });` → if `!ok`, `critical` already logged inside → `return { success:false, error:'rollbackFailed' }`; else keep `updateFailed`.
- **Durable path (user surfaces), replacing the `syncNowBounded` call + the old rollback block.** No region-level `try/catch` is added: `syncNowDurable` and `restoreCredential` are each internally guarded and cannot throw, `doSave` catches all → the durable region (from the `syncNowDurable` call onward) is **throw-free by construction** (the only call that could throw on a mid-flight envelope-clear — `setMemberWrappedKey` — lives inside `restoreCredential`'s guard). A wrapper here would be dead code. (The one un-guarded pre-mutation call, `hashPassword` at `:165`, sits _before_ this region — see the documented residual caveat; its user-facing side is covered by the modal catches.)
  ```ts
  const outcome = await syncStore.syncNowDurable(syncStore.DURABLE_ROTATION_SAVE_TIMEOUT_MS);

  if (outcome === 'saved') {
    logEvent({
      level: 'info',
      surface,
      message: 'rotation saved durably',
      context: { member_id_tail: memberIdTail, action: 'rotation-saved' },
    });
    return { success: true };
  }

  // Not saved → roll back. On a rollback failure, that itself is data-at-risk.
  const restored = await restoreCredential();
  if (!restored) {
    return { success: false, error: 'rollbackFailed' }; // critical already logged inside restoreCredential
  }
  reportError({
    surface,
    severity: 'warning',
    message: 'password rotation rolled back — durable save did not confirm',
    context: { member_id_tail: memberIdTail, action: 'rotation-rolled-back', error_code: outcome },
  }); // 'failed' | 'timeout'

  // Convergence re-save ONLY on timeout (the write may have landed). On a clean
  // 'failed' nothing reached Drive, so no convergence + no critical is needed.
  // Reuses syncNowDurable so a post-write metadata rejection here maps to 'saved'
  // (Drive converged) rather than propagating uncaught or firing a false page.
  if (outcome === 'timeout') {
    const converged = await syncStore.syncNowDurable(syncStore.DURABLE_ROTATION_SAVE_TIMEOUT_MS);
    if (converged !== 'saved') {
      reportError({
        surface,
        severity: 'critical',
        message:
          'rollback re-save did not confirm after a timed-out durable save — Drive may hold the new password while local reverted (possible cross-device lockout window)',
        context: {
          member_id_tail: memberIdTail,
          action: 'rotation-resave-failed',
          error_code: converged,
        },
      });
    }
  }
  return { success: false, error: 'saveFailed' };
  ```

**D. Callers.**

- `changePassword`'s `errorMessages: Record<RotateError, string>` gains `noConnection` + `rollbackFailed` (both via `useTranslationStore().t(...)`, consistent with the existing `saveFailed` entry), and its `saveFailed` stays as the i18n key added in `5e27b7ed`. The stale `updateFailed` **inline** string (authStore.ts:872-873) is corrected in place (see F). The other two legacy entries (`familyKeyMissing`, `wrapFailed`) stay English-only (out of scope, unchanged). This map is `Record<RotateError, …>`, so the two new union members are enforced at compile time here.
- `resetMemberPassword` propagates the new `ResetError` variants unchanged (it already returns `result.error`); the modal maps them via `t('family.resetPassword.error.${error}')`.

**E. `ResetMemberPasswordModal.handleSave` — add `catch` (finding 4).**

```ts
try {
  const result = await authStore.resetMemberPassword(props.member.id, newPassword.value);
  if (result.success) {
    /* … existing success path … */ return;
  }
  formError.value = t(`family.resetPassword.error.${result.error}` as never);
} catch (e) {
  formError.value = t('family.resetPassword.error.unexpected');
  reportError({
    surface: 'reset-member-password',
    severity: 'error',
    message: 'resetMemberPassword threw',
    error: e,
  });
} finally {
  isSubmitting.value = false;
}
```

(Import `reportError` in the modal — currently not imported; add a `family.resetPassword.error.unexpected` key — the reset surface maps 100% through i18n, so a dedicated key matches the file's pattern. `ChangePasswordSettings.vue` already has an equivalent catch → its `changePassword.error.failed` covers it; no change there beyond the two new mapped keys.)

**F. i18n (`uiStrings.ts`, en + beanie; zh via `npm run translate`) + one inline authStore string.**

- **Reset surface (uiStrings):** fix `family.resetPassword.error.updateFailed` → e.g. _"Couldn't update their password. Nothing was changed. Please try again."_; add `family.resetPassword.error.noConnection` → _"You'll need a connection to reset their password. Reconnect and try again."_; add `family.resetPassword.error.rollbackFailed` → _"Something went wrong and we couldn't fully undo the change. Please sign out and back in to be safe, then try again."_; add `family.resetPassword.error.unexpected` → generic _"Something went wrong. Please try again."_
- **Change-password surface:** the stale `updateFailed` copy is the **inline string** in authStore's `errorMessages` map (authStore.ts:872-873) — correct it there to _"Couldn't update your password. Nothing was changed. Please try again."_ (NOT a uiStrings edit). Add uiStrings keys `changePassword.error.noConnection` → _"You'll need a connection to change your password. Reconnect and try again."_ and `changePassword.error.rollbackFailed` → the sign-out-and-back-in copy — both referenced via `useTranslationStore().t(...)` in the map.
- `auth.passwordRotation.savingLabel` unchanged.

## Files Affected

- `src/stores/authStore.ts` — **modified**: `RotateError` gains `'noConnection'` + `'rollbackFailed'`; early offline gate (user surfaces, placed right after the `familyKeyMissing` guard); `restoreCredential` returns `boolean` + full try/catch (single rollback guard point); durable path uses `syncNowDurable` three-state for BOTH the primary and the convergence save (convergence + `critical` only on `'timeout'`); no dead region-level wrapper; `changePassword.errorMessages` gains the two new i18n-backed keys and its inline `updateFailed` string is corrected.
- `src/stores/syncStore.ts` — **modified**: add `canDurablySaveNow()` + `syncNowDurable(timeoutMs)` (both exported); **refactor `syncNowBounded` into a one-line wrapper over `syncNowDurable`** so the `raceTimeout(syncNow(true), …)` + reject-means-saved core lives in exactly one place (preserving the `:566` single-home invariant). `POST_AUTH_SAVE_TIMEOUT_MS`/`DURABLE_ROTATION_SAVE_TIMEOUT_MS` unchanged. (`reportError` already imported — `:61`.)
- `src/components/family/ResetMemberPasswordModal.vue` — **modified**: add `catch` to `handleSave` (+ `reportError` import — not currently present).
- `src/services/translation/uiStrings.ts` — **modified**: corrected `family.resetPassword.error.updateFailed`; new `family.resetPassword.error.noConnection` / `.rollbackFailed` / `.unexpected`; new `changePassword.error.noConnection` / `.rollbackFailed` (en + beanie). (The change-password `updateFailed` correction is NOT here — it's the inline authStore string.)
- `public/translations/zh.json` — **modified**: zh for the new/changed keys (via `npm run translate`, spot-checked).
- `src/stores/__tests__/authStore.passwordRotation.test.ts` — **modified/added**: early-gate, clean-fail (no convergence/critical), timeout+convergence+critical, rejection-as-saved (primary + convergence), rollback-failed→`rollbackFailed`+critical.
- `src/stores/__tests__/authStoreChangePassword.test.ts` — **modified**: mock gains `canDurablySaveNow`/`syncNowDurable`; happy path still green.
- `src/stores/__tests__/` (syncStore delegation) — **modified/added**: `syncNowBounded` delegation regression — post-write `syncNow` reject → `syncNowBounded` returns `true` and does not throw (guards the signin-heal edge).
- `src/components/family/__tests__/ResetMemberPasswordModal.test.ts` — **modified**: add a throw-path test asserting the inline error.
- `docs/plans/2026-07-16-password-rotation-remediation.md` — this plan.
- **NOT touched (by design):** `src/utils/diagnosticContext.ts` + all privacy-coupled surfaces (no new context keys); `signin-heal` code path (only the shared `syncNowBounded` implementation changes, behavior-preserving except the benign reject→saved edge); the reset modal's `as never` cast (known low-priority type gap, out of scope); the un-guarded `hashPassword` call (documented near-zero-probability residual, out of scope).

## Observability Coverage

All rotation telemetry continues on the existing allowlisted keys (`action`/`error_code`/`severity`/`member_id_tail`) — **no new context keys**, so no `ALLOWED_CONTEXT_KEYS` / Lambda-mirror / `PrivacyInfo.xcprivacy` / store-answers / `privacy.astro` changes. New `action`/`error_code` _values_ need no allowlist change.

- **Early offline gate:** `logEvent({ level:'info', surface, message:'rotation blocked — no durable save target', context:{ action:'rotation-blocked-offline', member_id_tail } })`. Measures how often users hit the offline wall (rate visible without paging).
- **Durable success:** `logEvent({ level:'info', ..., action:'rotation-saved' })` (unchanged).
- **Clean-fail rollback:** `reportError({ severity:'warning', ..., action:'rotation-rolled-back', error_code:'failed' })` — firehose, no page (nothing landed on Drive).
- **Timeout rollback:** same `warning` with `error_code:'timeout'`; then convergence re-save; `critical` (`action:'rotation-resave-failed'`, `error_code` = the convergence outcome) ONLY if that re-save does not confirm `'saved'` — the true residual cross-device-lockout window.
- **Rollback failed:** `reportError({ severity:'critical', ..., action:'rotation-rollback-failed' })` — local credential may be half-reverted (user action failed + data at risk). One of the only two `critical`s.
- **`syncNow` post-write metadata failure (primary or convergence):** `reportError({ severity:'warning', surface:'sync-now-durable', ... })` — surfaces the swallowed settings-write failure without failing the (durable) rotation or false-paging. Fires from the single `syncNowDurable` core, so it is emitted consistently for every caller (durable path, convergence, and `syncNowBounded`).
- **No bare catch, no unhandled rejection:** every new branch logs; `syncNowDurable` is internally guarded and is the single core for all bounded saves; `restoreCredential` is the single guarded rollback path. The durable region is throw-free by construction. No silent fallback.
- **`critical` scope tightened:** fires only on (timeout ∧ convergence-not-saved) or (rollback-failed) — never on a routine offline/clean-fail attempt, and never on a convergence post-write metadata rejection.

## Acceptance Criteria

- [ ] Offline (or cache-only / Drive-provider-while-`navigator.onLine===false`) change/reset **does not mutate**, shows the calm `noConnection` copy, fires **no** `critical` page, and returns immediately (no 12s wait).
- [ ] Online-but-clean-fail durable save rolls back fully, shows `saveFailed` ("nothing changed"), fires **no** convergence re-save and **no** `critical`, and returns without a second 12s wait.
- [ ] Timed-out durable save rolls back, runs the convergence re-save, and fires `critical` **only** if that re-save does not confirm `'saved'`.
- [ ] A rollback that can't complete (setter throws or `updateMember` returns null) fires `critical` and returns `rollbackFailed` with the sign-out-and-back-in copy — never the "nothing changed" copy.
- [ ] A `syncNow` rejection after a successful Drive write is treated as a durable success (primary → rotation reports success; convergence → no `critical`); a `warning` is logged for the metadata failure.
- [ ] `ResetMemberPasswordModal` surfaces an inline error (never a silent stop) if the store rejects.
- [ ] `signin-heal` behavior is unchanged (best-effort, never blocks/rolls back/errors); its `syncNowBounded` call still returns success on a post-write reject and does not throw.
- [ ] `syncNowBounded` is a thin wrapper over `syncNowDurable` — there is exactly ONE implementation of the `raceTimeout(syncNow(true))` + reject-means-saved core in the codebase.
- [ ] Corrected `updateFailed` copy (inline change-password + uiStrings reset) + new `noConnection`/`rollbackFailed`/`unexpected` copy render via `t()` in en + beanie + zh.
- [ ] No telemetry context key added outside the existing allowlist.
- [ ] Full Vitest suite + type-check + lint + `npm run build` + `npm run translate` clean.

## Testing Plan

1. **Early gate — no provider:** mock `getProviderType`→null; assert change/reset returns `{success:false, error:'noConnection'}`, `wrapFamilyKeyForMember`/`updateMember`/`setMemberWrappedKey` NOT called, `logEvent(action:'rotation-blocked-offline')`, no `reportError(critical)`.
2. **Early gate — Drive offline:** `getProviderType`→'google_drive', `navigator.onLine`→false; same assertions.
3. **Early gate NOT triggered — local provider:** `getProviderType`→'local'; rotation proceeds (mutates), independent of `navigator.onLine`.
4. **Clean-fail rollback:** `syncNowDurable`→'failed'; assert full rollback (setter + `updateMember` with old hash), `saveFailed`, `warning`(error_code:'failed'), **no** second `syncNowDurable` call, **no** `critical`.
5. **Timeout rollback + convergence:** `syncNowDurable`→'timeout' then convergence `syncNowDurable`→'failed' (or 'timeout'); assert rollback, convergence attempted, `critical`(action:'rotation-resave-failed'). Then convergence→'saved': assert **no** critical.
6. **Rejection-as-saved:** (a) make the primary `syncNow` reject after a successful save → `syncNowDurable`→'saved' + `warning` → rotation returns success; (b) make the convergence `syncNow` reject post-write on a timeout path → convergence 'saved' → **no** critical.
7. **Rollback failed:** `syncNowDurable`→'failed' AND `updateMember`(restore)→null → assert `rollbackFailed` + `critical`(action:'rotation-rollback-failed'), NOT `saveFailed`.
8. **updateFailed wrap-rollback:** `updateMember`(mutation)→null → `restoreCredential({wrapOnly:true})`; if it succeeds → `updateFailed`; if the wrap-restore throws → `rollbackFailed`+critical.
9. **signin-heal best-effort:** `surface:'signin-heal'`, provider null → NOT early-gated, NOT rolled back, NO error surface (best-effort event only).
10. **`syncNowBounded` delegation regression:** post-write `syncNow` reject → `syncNowBounded` resolves `true` (not a throw); a clean `false`→`false`; a `timeout`→`false`. Guards the single-core refactor and the signin-heal reject edge.
11. **Reset modal catch:** mock `resetMemberPassword` to reject → assert inline `formError` set + `reportError` called, spinner cleared.
12. **Suite:** full Vitest green; `type-check`, `lint`, `npm run build`, `npm run translate` (+ zh spot-check) clean.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the remediation from the 10 verified review findings + greg's block-early decision + the codebase investigation — early `canDurablySaveNow()` gate, `syncNowDurable` three-state outcome (reject⇒saved), verified/guarded `restoreCredential` with `rollbackFailed`+critical, convergence+critical scoped to the timeout case only, reset-modal catch, corrected/new i18n copy, and tightened observability on existing allowlisted keys.
- **Pass 2 (DRY + error handling)**: Reused `syncNowDurable` for the convergence re-save (was `syncNowBounded`, which could leak an uncaught post-write rejection and false-page); removed the dead region-level `try/catch` now that both saves and `restoreCredential` are internally guarded (throw-free by construction); corrected the change-password `updateFailed` fix to the inline authStore string (no such uiStrings key exists) while keeping the reset fix in uiStrings.
- **Pass 3 (Sustainability)**: Folded `syncNowBounded` into a one-line wrapper over `syncNowDurable` so there is exactly ONE implementation of the `raceTimeout(syncNow(true))`+reject-means-saved core (restoring the `syncStore.ts:566` single-home invariant instead of shipping two divergent copies), added a delegation regression test + the benign signin-heal reject→saved delta note, and flagged the reset modal's `as never` cast as a known low-priority type gap (rendering test is the guardrail).
- **Pass 4 (Fresh-eyes sweep)**: Re-verified every load-bearing claim on disk (all confirmed); documented the pre-existing near-zero-probability `hashPassword`-throw half-rotation residual (user-facing side already covered by the modal catches, envelope-rollback intentionally out of scope) so the decision is conscious rather than an oversight; confirmed `reportError`'s `surface` is a free-form string (no type change for `'sync-now-durable'`) and that it is already imported in syncStore but NOT in the reset modal; and pinned the early-gate's exact placement (immediately after the `familyKeyMissing` guard, before the first mutation).

## Prompt Log

> No GitHub issue — direct implementation (remediation of #54). Origin: high-effort `/code-review` of commit `5e27b7ed` returned 10 verified findings (silent half-rotation lockouts, offline conflation, false critical page, ~24s double-timeout, missing reset-modal catch, stale copy). greg direction (2026-07-16, AskUserQuestion): "Block early, friendly message" for offline/no-provider — do not restore the deferred path. Then: "run it through /beanies-plan."
