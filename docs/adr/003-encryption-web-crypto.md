# ADR-003: AES-GCM Encryption with Web Crypto API

**Status:** Accepted
**Date:** Early development

## Context

When users sync their financial data via a file (which may be placed in a cloud folder), the data should optionally be encrypted so that the cloud provider and anyone with file access cannot read it.

## Decision

Use the **Web Crypto API** (native browser API) for encryption, specifically **AES-GCM** symmetric encryption with **PBKDF2** key derivation from a user-provided password.

### Implementation Details

Located in `src/services/crypto/encryption.ts`:

- **Algorithm**: AES-GCM (authenticated encryption)
- **Key length**: 256 bits
- **Key derivation**: PBKDF2 with SHA-256, 100,000 iterations
- **Salt**: 16 random bytes (generated per encryption)
- **IV**: 12 random bytes (generated per encryption)
- **File format**: `GP_ENCRYPTED_V1` magic header + salt + IV + ciphertext, base64-encoded

### Encrypted Sync File Structure

```json
{
  "version": "1.0",
  "exportedAt": "2026-02-17T...",
  "encrypted": true,
  "data": "<base64-encoded encrypted blob>"
}
```

When `encrypted` is `false`, the `data` field contains the plain JSON data object.

### Password Handling

- Password is provided by the user each session (never stored)
- A "session password" is held in memory for auto-sync during the session
- Password correctness is verified by AES-GCM authentication tag (decryption fails on wrong password)

## Consequences

### Positive

- No external dependencies — Web Crypto API is built into all modern browsers
- Strong encryption (AES-256-GCM is an industry standard)
- Each encryption produces unique salt + IV, so identical data produces different ciphertext
- Authenticated encryption detects tampering or wrong passwords

### Negative

- Password is user-managed — no recovery if forgotten
- PBKDF2 with 100k iterations adds ~100ms to encrypt/decrypt operations
- Entire data set is encrypted as one blob (no partial decryption)
