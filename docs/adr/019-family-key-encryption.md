# ADR-019: Family Key Encryption

- **Status:** Accepted
- **Date:** 2026-03-03
- **Supersedes:** ADR-014 (File-Based Auth)

## Context

The previous per-file password encryption required users to share a password out-of-band for every new family member. There was no secure mechanism for inviting new members to a family without revealing the file password.

Two separate passwords — one for file encryption and one for member sign-in — caused user confusion and made onboarding difficult. Additionally, changing a password required re-encrypting the entire file, which was slow and error-prone for large datasets.

## Decision

We introduce a random 256-bit AES-GCM family key per family, generated once at family creation, and wrap it per-member using key-wrapping techniques.

Key implementation details:

- **Family key wrapping:** The family key is wrapped per-member via AES-KW with PBKDF2-derived wrapping keys (100k iterations, per-member salt)
- **V4 beanpod envelope** stores three key-wrapping mechanisms:
  - `wrappedKeys` — password-wrapped keys for standard sign-in
  - `passkeyWrappedKeys` — PRF-wrapped keys for passkey/biometric unlock
  - `inviteKeys` — token-wrapped keys with 24-hour expiry for new member invitations
- **Single password sign-in:** A member's password both proves identity AND unwraps the family key in one step, eliminating the two-password confusion
- **Invite tokens:** 32 random bytes encoded as base64url, used to derive an AES-KW key via PBKDF2, which wraps the family key. Shared via magic link with QR code. Expires after 24 hours
- **Passkey/PRF integration:** Authenticator PRF output is fed through HKDF to derive an AES-KW key for zero-password unlock on trusted devices

## Consequences

### Positive

- Single password for sign-in — no more dual-password confusion
- Secure invites without sharing passwords — invite links contain a one-time token, not the family password
- Passkey PRF works directly with key wrapping — no intermediate password needed
- Password changes only re-wrap the family key for that member, not re-encrypt the entire file

### Negative

- Key rotation is needed on member removal to prevent evicted members from decrypting future data (deferred to #117)
- Invite links expire in 24 hours — if not used in time, a new invite must be generated
- The raw family key exists in memory during the active session, which is an accepted trade-off for a client-side SPA
