# ADR-015: Passkey / Biometric Authentication

**Status:** Accepted
**Date:** 2026-02-24

## Context

The app requires two separate passwords to access family data:

1. **File encryption password** — decrypts the `.beanpod` file (AES-256-GCM via PBKDF2)
2. **Member password** — authenticates as a specific family member (PBKDF2 hash verification)

This two-password flow is cumbersome, especially on mobile. Users requested a single biometric gesture that identifies the member, authenticates them, and decrypts the file in one tap.

- WebAuthn is widely supported across modern browsers and platforms
- The PRF (Pseudo-Random Function) extension enables deriving cryptographic keys from biometric authentication
- Not all browsers support PRF (notably Firefox), requiring a fallback strategy
- The app is local-first with no server — challenge generation must be client-side

## Decision

Implement a **dual-path WebAuthn strategy** for biometric login:

### Primary: WebAuthn PRF path

When the browser supports the PRF extension:

- **Registration:** Derive a wrapping key from PRF output via HKDF, wrap the file's DEK with AES-KW
- **Login:** PRF assertion → HKDF → unwrap DEK → decrypt file directly (no password needed)

### Fallback: Cached password path

When PRF is not available (Firefox, older browsers):

- Passkey authenticates the member (biometric proof of identity)
- Encryption password is cached in IndexedDB alongside the credential
- Passkey assertion gates access to the cached password, which then decrypts the file

### Final fallback: Password flow

The existing two-password flow is preserved unchanged for:

- Devices without WebAuthn
- New devices without registered passkeys
- Recovery scenarios

### Challenge generation

Client-side via `crypto.getRandomValues()`. No server-side verification needed since:

- The app is local-first with no network authentication
- The authenticator handles user verification (biometric/PIN)
- We're protecting against unauthorized local access, not network replay

### Storage

Passkey registrations are stored in the registry IndexedDB (device-level), not in the per-family database. This ensures passkeys survive sign-out and family database deletion.

### Password change handling

When the encryption password changes:

- PRF-path registrations have their wrapped DEK invalidated (user must re-register)
- Non-PRF registrations get their cached password updated automatically

### Cross-device passkey sync (added 2026-02-27)

Modern platform authenticators (iCloud Keychain, Google Password Manager, Windows Hello Sync) automatically sync passkeys across devices. When a user registers a passkey on Device A and Device B, Device A's browser may present Device B's synced credential during authentication. Since the synced credential's ID doesn't exist in Device A's local registry, special handling is needed.

**Approach:** When a credential's `userHandle` identifies a known member but the `credentialId` is not in the local registry:

1. Look up the family's cached encryption password from global settings (`cachedEncryptionPasswords[familyId]`)
2. If found: auto-register the synced credential locally and return the cached password for file decryption
3. If not found: return `CROSS_DEVICE_NO_CACHE` error — user must enter their password once to populate the cache

**Trust model:** The platform authenticator has already verified the user biometrically. The `userHandle` confirms the credential belongs to a known family member. The cached password is already stored locally (trusted device model). No additional signature verification is performed — challenge generation is client-side, making server-style signature verification unnecessary.

**Limitation:** On a fresh device with no cached password, the user must sign in with their password at least once before synced passkeys work. This is consistent with the existing trusted device model.

## Consequences

### Positive

- Single biometric gesture replaces two passwords for returning users
- PRF path provides true passwordless decryption (no password stored anywhere)
- Cached password path provides biometric UX even without PRF support
- Existing password flow is fully preserved as fallback
- No server infrastructure required

### Negative

- PRF support varies by browser — users may get different levels of security
- Cached password path stores the encryption password in IndexedDB (mitigated by requiring biometric to access)
- Password changes require PRF users to re-register their passkey
- Increased complexity in the authentication flow
- Cross-device passkeys require a cached password on the device (first sign-in must use password)
