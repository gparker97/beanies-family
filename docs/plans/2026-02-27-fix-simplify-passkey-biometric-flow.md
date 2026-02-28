# Plan: Fix & Simplify Passkey/Biometric Login Flow

> Date: 2026-02-27
> Related issues: biometric login breaks after switching families

## Context

After creating a passkey and switching between families, users get "encryption password has changed" or "password is for a different family" errors. The biometric flow becomes unusable. Three root causes:

1. **Password cache has no family context** — `GlobalSettings.cachedEncryptionPassword` is a single string. Switching families tries the wrong password, fails, and **clears the valid password** for the original family.
2. **DEK staleness** — Passkey wraps a DEK with a specific PBKDF2 salt. When file is re-encrypted (auto-save, other device), salt changes → wrapped DEK invalid. Fallback `cachedPassword` may already be cleared by bug #1.
3. **No family picker before biometric** — With multiple families, app auto-selects last active family. User may authenticate against the wrong family unknowingly.

## Approach

### A. Per-family password cache (fixes bug #1)

**`src/types/models.ts`** — Replace `cachedEncryptionPassword?: string | null` with `cachedEncryptionPasswords?: Record<string, string>` on `GlobalSettings`. Remove the old field entirely (no migration — no real prod users).

Remove `wrappedDEK`, `wrappedDEKSalt`, `encryptionSalt` from `PasskeyRegistration` entirely. Existing passkeys in IndexedDB with these fields will be harmlessly ignored (extra properties on a JS object). Users should delete and re-create passkeys after this change.

**`src/stores/settingsStore.ts`** — Rewrite cache functions:

- `cacheEncryptionPassword(password, familyId)` → store in per-family map
- `getCachedEncryptionPassword(familyId)` → look up by familyId (no legacy fallback)
- `clearCachedEncryptionPassword(familyId?)` → with ID: clear one entry; without: clear all

**All callers** pass `familyId`:

- `syncStore.ts` — `decryptPendingFile`, `enableEncryption`, `disconnect`, `reloadIfFileChanged`
- `App.vue` — `loadFamilyData`, `handleTrustDevice`
- `LoadPodView.vue` — `tryAutoDecrypt`: use `pendingEncryptedFile.rawSyncData.familyId`; on failure only clear that family's cache

### B. Remove DEK path from passkey flow (fixes bug #2)

**Core insight:** `cachedPassword` always works (derives key from current file salt). The wrapped DEK is locked to a specific salt and goes stale. DEK provides no security benefit since `cachedPassword` is stored alongside it. Remove the entire DEK decryption path.

**`src/services/auth/passkeyService.ts`**:

- `registerPasskeyForMember()` — Remove DEK wrapping block (~lines 149-178). Keep PRF for auth, keep `cachedPassword`. Drop `dek`/`dekSalt` from return.
- `authenticateWithPasskey()` — Remove DEK unwrap block (~lines 283-305). Return `cachedPassword` directly.
- `invalidatePasskeysForPasswordChange()` — Always update `cachedPassword` for all registrations (remove PRF-specific branch).

**`src/stores/authStore.ts`**:

- `signInWithPasskey()` — Drop `dek` from return type, just return `cachedPassword`.
- `registerPasskeyForCurrentUser()` — Remove the block that sets `syncStore.sessionDEK` and forces DEK-based save.

**`src/components/login/BiometricLoginView.vue`** — Replace 3-tier fallback (DEK → password → error) with single path: `cachedPassword → decryptPendingFile → done`.

### C. Remove sessionDEK from sync layer

**`src/stores/syncStore.ts`**:

- Remove `sessionDEK` ref
- Remove `decryptPendingFileWithDEK()` function
- Simplify `reloadIfFileChanged()`: `sessionPassword` → `getCachedEncryptionPassword(familyId)` → give up

**`src/services/sync/syncService.ts`**:

- Remove `sessionDEK`/`sessionDEKSalt` vars, `setSessionDEK()`/`getSessionDEK()`, `decryptAndImportWithKey()`
- Simplify `doSave()`: remove DEK encryption branch (password-only)
- Simplify encryption guards: check `sessionPassword` only

### D. Family picker before biometric (fixes bug #3)

**`src/pages/LoginPage.vue`** `onMounted()`:

- After `familyContextStore.initialize()`, check how many families have passkeys
- **Multiple families with passkeys** → show a family picker first (list families by name as cards; user taps one → activate → load file → biometric)
- **One family** → current behavior (auto-activate, show biometric directly)

Simple inline implementation: loop `allFamilies`, call `checkHasRegisteredPasskeys` for each, show a picker if 2+ have passkeys. Once selected → `familyContextStore.switchFamily(id)` → `syncStore.initialize()` → load file → show BiometricLoginView.

### E. No backward compatibility needed

No real production users — clean break:

- Remove DEK fields from `PasskeyRegistration` type entirely (old IndexedDB data harmlessly ignored)
- Replace `cachedEncryptionPassword` with `cachedEncryptionPasswords` (no migration)
- Users delete and re-create passkeys after deploy

## Files affected

| File                                          | Change                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/types/models.ts`                         | Replace `cachedEncryptionPassword` with per-family map; remove DEK fields from PasskeyRegistration |
| `src/stores/settingsStore.ts`                 | Per-family cache functions (no migration)                                                          |
| `src/stores/syncStore.ts`                     | Remove `sessionDEK`/`decryptPendingFileWithDEK`; pass familyId to cache                            |
| `src/stores/authStore.ts`                     | Remove DEK from `signInWithPasskey`/`registerPasskeyForCurrentUser`                                |
| `src/services/auth/passkeyService.ts`         | Remove DEK wrapping/unwrapping; simplify invalidation                                              |
| `src/services/sync/syncService.ts`            | Remove `sessionDEK`/`decryptAndImportWithKey`/DEK save branch                                      |
| `src/components/login/BiometricLoginView.vue` | Simplify to password-only                                                                          |
| `src/components/login/LoadPodView.vue`        | Per-family cache lookup in `tryAutoDecrypt`                                                        |
| `src/pages/LoginPage.vue`                     | Family picker when multiple families have passkeys                                                 |
| `src/App.vue`                                 | Pass familyId to cache functions                                                                   |
| Test files                                    | Update mocks/assertions for new signatures                                                         |

## Verification

1. `npm run type-check` — no TS errors
2. `npm run lint` — no lint errors
3. `npx vitest run` — all tests pass
4. Manual test flow:
   - Create passkey for Family A → sign out → biometric login → works
   - Load Family B → sign out → load Family A → biometric → still works (password not corrupted)
   - With 2+ families: family picker appears before biometric prompt
   - Page refresh after biometric login → auto-decrypt with cached password → works
