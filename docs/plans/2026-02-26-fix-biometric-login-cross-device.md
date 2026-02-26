# Plan: Fix biometric login across multiple devices

> Date: 2026-02-26
> Related: Critical bug — desktop passkey login shows QR code instead of Windows Hello

## Context

User registered passkeys on both phone (fingerprint) and desktop PC (Windows Hello) for the same family. Mobile biometric login works, but desktop login triggers a QR code scan prompt (cross-device flow) instead of Windows Hello, and ultimately fails.

**Root cause:** `authenticateWithPasskey()` passes explicit `allowCredentials` containing credential IDs loaded from IndexedDB. Chrome 130+ on Windows changed its passkey handling — credentials may be managed by Google Password Manager rather than Windows Hello directly. When Chrome can't match the explicit credential IDs against its current credential resolver, it falls back to the QR code (hybrid transport) flow.

**The fix:** Switch to **discoverable credential mode** (omit `allowCredentials`). Since all passkeys are registered with `residentKey: 'required'`, they are discoverable by `rpId` alone. The browser searches all credential stores (Windows Hello, Chrome passkey manager, iCloud Keychain) natively, eliminating the ID-matching mismatch.

## Approach

### Fix 1: Switch `authenticateWithPasskey` to discoverable mode

**File:** `src/services/auth/passkeyService.ts` — `authenticateWithPasskey()`

1. **Remove `allowCredentials`** from the `PublicKeyCredentialRequestOptions`. Don't pass the field at all — the browser discovers credentials by `rpId`.

2. **Extract `userHandle`** from the assertion response. During registration, `user.id` is set to `new TextEncoder().encode(memberId)`. The assertion returns this as `response.userHandle`, giving us a second matching signal.

3. **Improve credential matching** with multi-signal logic:
   - Primary: match `credentialId` against family's registrations (same as before)
   - If no credential ID match but `userHandle` matches a known member → `CROSS_DEVICE_CREDENTIAL` error
   - If neither matches → `WRONG_FAMILY_CREDENTIAL` error

### Fix 2: Handle new error codes in BiometricLoginView

**File:** `src/components/login/BiometricLoginView.vue` — `handleBiometricLogin()`

Map the new error codes to user-friendly messages:

- `CROSS_DEVICE_CREDENTIAL` → "This biometric was registered on another device. Sign in with password and register biometric on this device in Settings."
- `WRONG_FAMILY_CREDENTIAL` → "This biometric does not belong to the current family. Please try again."

### Fix 3: Add translation strings

**File:** `src/services/translation/uiStrings.ts`

Add `passkey.crossDeviceError` and `passkey.wrongFamilyError` keys.

### Fix 4: Export utility functions for testability

**File:** `src/services/auth/passkeyService.ts`

Export `bufferToBase64url`, `base64urlToBuffer`, `bufferToBase64`, `base64ToBuffer`, `guessAuthenticatorLabel` so tests can verify encoding roundtrips and label generation.

### Fix 5: Comprehensive passkey tests

**File:** `src/services/auth/__tests__/passkeyService.test.ts` (new)

12 test cases covering encoding, registration, discoverable auth, error codes, PRF, cached password, password invalidation, and label guessing.

## Files affected

| File                                                 | Change                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/services/auth/passkeyService.ts`                | Remove `allowCredentials`, add `userHandle` extraction, improve matching, export utils |
| `src/components/login/BiometricLoginView.vue`        | Handle `CROSS_DEVICE_CREDENTIAL` and `WRONG_FAMILY_CREDENTIAL` error codes             |
| `src/services/translation/uiStrings.ts`              | Add 2 new passkey error strings                                                        |
| `src/services/auth/__tests__/passkeyService.test.ts` | **New** — 12 test cases                                                                |
