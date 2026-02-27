# Plan: Fix Cross-Device Passkey Authentication

> Date: 2026-02-27
> Related issues: passkey registered on second device blocks first device login

## Context

When a user registers a passkey on two devices (e.g. laptop and mobile) for the same account, modern platform authenticators (iCloud Keychain, Google Password Manager, Windows Hello Sync) sync passkeys across devices. When Device A tries to authenticate, the browser may present a synced credential from Device B. Because the synced credential's ID doesn't exist in Device A's local registry IndexedDB, the code returns `CROSS_DEVICE_CREDENTIAL` error — even though the credential is legitimate.

## Root Cause

`authenticateWithPasskey()` in `passkeyService.ts` matches credentials by `credentialId` against the local registry. When a credential syncs from another device, its ID isn't in the local registry. The fallback logic detects the member via `userHandle` but returns an error instead of handling the legitimate cross-device case.

## Approach

**Hardened Quick Fix** — when a cross-device credential is detected (member recognized via `userHandle` but `credentialId` not in local registry):

1. Look up the family's cached encryption password from `settingsStore.getCachedEncryptionPassword(familyId)`
2. If found: auto-register the synced credential in the local registry (copying `publicKey`, `familyId`, `memberId` from the existing member registration and attaching the cached password)
3. Return success with the cached password for file decryption
4. If no cached password: return a new `CROSS_DEVICE_NO_CACHE` error with a user-friendly message directing them to enter their password

### Security considerations

- The browser's platform authenticator has already verified the user biometrically before the assertion is returned
- The `userHandle` confirms the credential belongs to a known member of the family
- The cached password is already stored locally (trusted device model) — we're just making it accessible via the synced credential
- No public key signature verification is performed (same as the existing local credential path — challenge is client-generated, not server-verified)

## Files affected

| File                                               | Change                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/services/auth/passkeyService.ts`              | Handle cross-device credentials with cached password lookup + auto-register |
| `src/components/login/BiometricLoginView.vue`      | Handle new `CROSS_DEVICE_NO_CACHE` error                                    |
| `src/services/translation/uiStrings.ts`            | Add translation string for no-cache fallback, update cross-device error     |
| `docs/adr/015-passkey-biometric-authentication.md` | Document cross-device passkey handling                                      |
| `docs/STATUS.md`                                   | Update with fix                                                             |
| `docs/SECURITY_GUIDE.md`                           | Document cross-device passkey trust model                                   |
