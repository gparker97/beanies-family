# Plan: Seamless Cross-Device Passkey Authentication

> Date: 2026-03-01
> Related issues: #108

## Context

When a passkey is synced via Google Password Manager / iCloud Keychain to another device, the WebAuthn authentication succeeds and the member is correctly identified via `userHandle`, but the app cannot decrypt the `.beanpod` file because the encryption password is only stored in the originating device's local IndexedDB. This produces the `CROSS_DEVICE_NO_CACHE` error: "This biometric was synced from another device. Sign in with your password once to enable it here."

The root cause is architectural: `PasskeyRegistration.cachedPassword` lives in per-device IndexedDB and doesn't travel with synced passkeys. Additionally, the password caching is gated by `isTrustedDevice`, which defaults to `false` on new devices.

Two-level fix: Level 1 improves the UX so one password entry per device works smoothly. Level 2 uses the PRF extension (already scaffolded but unused) to store a PRF-wrapped password in the `.beanpod` file itself, enabling zero-password login on any device with the synced passkey.

## Level 1: Better Cross-Device UX (one password entry per new device)

### Approach

When `CROSS_DEVICE_NO_CACHE` occurs, instead of showing an error, automatically redirect the user to password entry. After successful decryption, the existing trusted device prompt flow handles caching. The user must explicitly accept trust before the password is cached (user requirement).

### Changes

**1. `src/services/auth/passkeyService.ts`**

- In the `CROSS_DEVICE_NO_CACHE` branch (line 239), return `memberId: memberMatch.memberId` alongside the error so callers know which member was identified
- Add `registerSyncedCredential(params)` function — creates a `PasskeyRegistration` for a synced credential ID, copying metadata from the member's existing registration

**2. `src/stores/authStore.ts`**

- In `signInWithPasskey()` (line 341-343), when `!result.success` and error is `CROSS_DEVICE_NO_CACHE`, return `memberId` from the result instead of losing it

**3. `src/components/login/BiometricLoginView.vue`**

- Add new emit: `'cross-device-password-needed': [payload: { memberId: string }]`
- When `CROSS_DEVICE_NO_CACHE` is detected, emit `cross-device-password-needed` with the `memberId` instead of showing an error box

**4. `src/pages/LoginPage.vue`**

- Add state: `isCrossDeviceFlow` flag, `crossDeviceMemberId` ref
- Add handler `handleCrossDevicePasswordNeeded({ memberId })`: sets the flag, stores memberId, navigates to `load-pod` with `autoLoadPod: true`
- Modify `handleFileLoaded()`: if `isCrossDeviceFlow`, skip `pick-bean` — the passkey already verified the user biometrically, so auto-sign-in the identified member, navigate to `/nook`, and let App.vue's trust prompt watcher handle caching.
- Wire up the new emit from BiometricLoginView in the template

**5. `src/services/translation/uiStrings.ts`**

- Update `passkey.crossDeviceNoCache` to friendlier text (used as a brief transition message)
- Add `passkey.crossDeviceActivated`: "Biometric login activated on this device!"

### Flow

1. User opens app on Device B → selects family → BiometricLoginView shown
2. Taps biometric → synced passkey authenticates → `CROSS_DEVICE_NO_CACHE` returned with `memberId`
3. BiometricLoginView emits `cross-device-password-needed`
4. LoginPage navigates to LoadPodView (file already loaded, just needs password)
5. User enters file encryption password → file decrypted
6. LoginPage detects cross-device flow → auto-creates auth session for identified member → navigates to `/nook`
7. App.vue trust watcher fires → TrustDeviceModal shown
8. User accepts → password cached, synced credential auto-registered locally
9. All future biometric logins on Device B work seamlessly

### Edge case: member password still required?

No. The passkey biometric already verified the user. In the normal biometric flow, the user is signed in without entering a member password. For the cross-device flow, we match this behavior — after file decryption, auto-sign-in the identified member.

---

## Level 2: PRF-Wrapped Password in .beanpod (zero password entry)

### Approach

The WebAuthn PRF extension produces a deterministic output for the same credential + salt. A synced passkey yields the same PRF output on all devices. We encrypt the file encryption password with a key derived from PRF output and store it in the `.beanpod` file envelope. Any device with the synced passkey can decrypt the password without the user typing it.

### New type

```typescript
// src/types/models.ts
interface PasskeySecret {
  credentialId: string; // base64url credential ID
  memberId: UUID;
  wrappedPassword: string; // base64(IV + AES-GCM ciphertext)
  hkdfSalt: string; // base64 HKDF salt for key derivation
  createdAt: ISODateString;
}
```

### Changes

**1. `src/types/models.ts`**

- Add `PasskeySecret` interface
- Add `passkeySecrets?: PasskeySecret[]` to `SyncFileData` (envelope level — readable before decryption)

**2. `src/services/auth/passkeyCrypto.ts`** (activate dead code + add new functions)

- Add `wrapPassword(prfOutput, password)` → `{ wrappedPassword, hkdfSalt }` using AES-GCM with HKDF-derived key (not AES-KW — passwords are strings, not CryptoKeys). Uses info string `'beanies.family-prf-password-wrap'` to domain-separate from existing DEK wrapping.
- Add `unwrapPassword(prfOutput, wrappedPassword, hkdfSalt)` → plaintext password
- Existing `getPRFOutput`, `generateHKDFSalt`, `buildPRFExtension`, `isPRFSupported` are already correct and will be used.

**3. `src/services/auth/passkeyService.ts`**

- `registerPasskeyForMember()`: after credential creation, if `prfAvailable`, extract PRF output via `getPRFOutput()`, call `wrapPassword()`, return `PasskeySecret` in result
- `authenticateWithPasskey()`: accept optional `passkeySecrets?: PasskeySecret[]` param. After assertion, if PRF output available AND matching secret found by credentialId → `unwrapPassword()` → return as `cachedPassword`. This happens BEFORE the existing cached password lookup, and also in the cross-device branch (no `CROSS_DEVICE_NO_CACHE` if PRF unwrap succeeds).
- Add `rewrapPasskeySecret(credentialId, newPassword)`: for password change scenarios — performs a WebAuthn assertion to get PRF output, creates new secret.

**4. `src/stores/syncStore.ts`**

- Add `passkeySecrets` ref, populated from file envelope on load
- Add actions: `addPasskeySecret()`, `removePasskeySecret()`, `getPasskeySecrets()`
- Register a getter with syncService so saves include `passkeySecrets` in the envelope

**5. `src/services/sync/syncService.ts`**

- Save path (`doSave`): include `passkeySecrets` in the encrypted file JSON envelope
- Load path: extract `passkeySecrets` from raw file data and pass through results

**6. `src/services/sync/fileSync.ts`**

- `validateSyncFileData()`: accept optional `passkeySecrets` array field
- `createSyncFileData()`: include `passkeySecrets` from syncStore

**7. `src/components/login/BiometricLoginView.vue`**

- Accept `passkeySecrets` prop (from LoginPage)
- Pass to `authStore.signInWithPasskey(familyId, passkeySecrets)`

**8. `src/pages/LoginPage.vue`**

- After loading encrypted file, extract `passkeySecrets` from pending file data
- Pass as prop to BiometricLoginView

**9. `src/stores/authStore.ts`**

- `signInWithPasskey()`: accept and forward `passkeySecrets` to `authenticateWithPasskey()`

**10. `src/App.vue`**

- After passkey registration (in `handleEnablePasskey`): if result includes `passkeySecret`, add to `syncStore.passkeySecrets` and trigger save

**11. Password change handling**

- When encryption password changes: call `rewrapPasskeySecret()` for the current session's credential, update `passkeySecrets` in syncStore, save file
- Stale secrets from other devices fail gracefully (unwrap succeeds but produces old password → file decrypt fails → falls back to Level 1 flow)

### Flow (PRF-supported device)

1. **Registration (Device A):** Register passkey → PRF output → `wrapPassword()` → `PasskeySecret` stored in `.beanpod`
2. **Auth (Device B):** Load file → extract `passkeySecrets` → biometric → synced passkey → same PRF output → `unwrapPassword()` → decrypt file → signed in. Zero password entry.

### Fallback

- PRF not supported on Device B → PRF output null → skip PRF path → falls to Level 1 (password entry once + trust)
- Old `.beanpod` without `passkeySecrets` → no secrets to try → falls to Level 1
- Password changed → stale secret produces wrong password → file decrypt fails → Level 1

### Security

- Wrapped password encrypted with AES-GCM using key derived from PRF output (HKDF + SHA-256)
- PRF output requires possession of the synced passkey + biometric verification
- Stolen `.beanpod` file alone is useless — can't derive PRF output without the passkey
- More secure than Level 1's plaintext cached password in IndexedDB

---

## Implementation Order

### Phase A — Level 1 (ship independently)

1. `passkeyService.ts` — return `memberId` on CROSS_DEVICE_NO_CACHE, add `registerSyncedCredential()`
2. `authStore.ts` — pass through `memberId` on cross-device error
3. `BiometricLoginView.vue` — emit `cross-device-password-needed` instead of showing error
4. `LoginPage.vue` — handle cross-device flow, auto-sign-in after password entry
5. `uiStrings.ts` — friendlier messages
6. Unit tests for passkeyService changes
7. Manual cross-device testing

### Phase B — Level 2 (requires Phase A)

1. `models.ts` — add `PasskeySecret`, extend `SyncFileData`
2. `passkeyCrypto.ts` — add `wrapPassword()` / `unwrapPassword()`
3. `passkeyService.ts` — PRF-aware registration and authentication
4. `syncStore.ts` — `passkeySecrets` state management
5. `syncService.ts` + `fileSync.ts` — save/load `passkeySecrets` in file envelope
6. `BiometricLoginView.vue` + `LoginPage.vue` — pass secrets through
7. `authStore.ts` — forward secrets parameter
8. `App.vue` — store secret after registration
9. Password change re-wrapping
10. Unit tests for crypto roundtrip, auth flow with secrets
11. Manual testing with Chrome (PRF supported)

## Verification

- **Level 1:** Register passkey on Device A (Chrome, Google Password Manager). Open app on Device B. Biometric login should redirect to password entry. After entering password and accepting trust, biometric should work on next login.
- **Level 2:** Same setup, but after Level 2 is deployed, Device B biometric login should succeed without any password entry (PRF unwraps the password from the file).
- Run `npm run type-check` and `npm run test` after each phase.
- Existing passkey unit tests must continue to pass.
