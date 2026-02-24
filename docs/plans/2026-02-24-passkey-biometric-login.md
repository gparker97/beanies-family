# Plan: Passkey / Biometric Login and Data File Unlock

> Date: 2026-02-24
> Related issues: #16

## Context

The app currently requires **two separate passwords** to access family data:

1. **File encryption password** — decrypts the `.beanpod` file (AES-256-GCM via PBKDF2)
2. **Member password** — authenticates as a specific family member (PBKDF2 hash verification)

This is cumbersome, especially on mobile. Issue #16 replaces both with a **single biometric/passkey gesture** that identifies the member, authenticates them, and decrypts the file — all in one tap.

## Approach

### Two-path strategy

**Primary: WebAuthn PRF** — When browser supports the PRF extension:

- Registration: derive a wrapping key from PRF output via HKDF, wrap the file's DEK with AES-KW
- Login: PRF assertion → HKDF → unwrap DEK → decrypt file directly (no password needed)

**Fallback: Cached password** — When PRF not available (Firefox, older browsers):

- Passkey authenticates the member (biometric proof)
- Encryption password cached in IndexedDB alongside the credential
- Passkey assertion gates access to the cached password, which is then used to decrypt

**Final fallback: Password flow** — The existing two-password flow is preserved unchanged.

### Challenge generation

Client-side via `crypto.getRandomValues()`. Acceptable for local-first since we're not protecting against network replay.

## Files affected

| Action | File                                                       | Description                                                          |
| ------ | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| Create | `src/services/auth/passkeyCrypto.ts`                       | PRF helpers, HKDF, AES-KW wrap/unwrap                                |
| Modify | `src/services/crypto/encryption.ts`                        | Key-based encrypt/decrypt, extractable key, export constants         |
| Modify | `src/types/models.ts`                                      | `PasskeyRegistration` interface, `GlobalSettings.passkeyPromptShown` |
| Modify | `src/services/indexeddb/registryDatabase.ts`               | Version 3 with `passkeys` store                                      |
| Create | `src/services/indexeddb/repositories/passkeyRepository.ts` | CRUD for passkey registrations                                       |
| Modify | `src/services/auth/passkeyService.ts`                      | Full rewrite with PRF/non-PRF paths                                  |
| Modify | `src/stores/authStore.ts`                                  | `signInWithPasskey`, `registerPasskeyForCurrentUser`                 |
| Modify | `src/stores/settingsStore.ts`                              | `passkeyPromptShown`                                                 |
| Modify | `src/stores/syncStore.ts`                                  | `sessionDEK`, `loadFromFileWithDEK`, modify `syncNow`                |
| Create | `src/components/login/BiometricLoginView.vue`              | Biometric quick-login view                                           |
| Modify | `src/pages/LoginPage.vue`                                  | Add biometric view, passkey detection                                |
| Create | `src/components/common/PasskeyPromptModal.vue`             | Enable-biometric prompt modal                                        |
| Modify | `src/App.vue`                                              | Passkey prompt watcher                                               |
| Modify | `src/components/settings/PasskeySettings.vue`              | Full management UI rewrite                                           |
| Modify | `src/services/translation/uiStrings.ts`                    | `passkey.*` i18n strings                                             |
| Create | `docs/adr/015-passkey-biometric-authentication.md`         | ADR                                                                  |
| Modify | `docs/ARCHITECTURE.md`                                     | Auth section update                                                  |
| Modify | `docs/STATUS.md`                                           | Status update                                                        |
