# ADR-014: File-Based Authentication (Cognito Removal)

**Status:** Accepted
**Date:** 2026-02-22

## Context

The app previously used AWS Cognito for authentication (ADR-010), which contradicted the local-first philosophy:

- User credentials were the only data stored outside the family data file
- Cognito required complex infrastructure (User Pool, API Gateway, Lambda for admin ops — ADR-013)
- The `amazon-cognito-identity-js` package added ~165KB to the bundle
- Admin operations (e.g., deleting a member) required a server-side Lambda, adding operational complexity
- The auth resolution chain was complex: JWT claims → Cognito attributes → registry lookup → cached session

## Decision

Remove AWS Cognito entirely and store PBKDF2 password hashes directly in the family data file alongside `FamilyMember` records. Authentication becomes fully local — the file IS the auth database.

### Two-Layer Security Model

1. **File encryption password** (AES-GCM) — protects data at rest, entered once to unlock the file
2. **Member password** (PBKDF2 hash stored in file) — proves identity within the family, per-member

### Password Hashing

Reuses the PBKDF2 pattern from `src/services/crypto/encryption.ts`:

- Algorithm: PBKDF2 with SHA-256
- Iterations: 100,000
- Salt: 16 random bytes per password
- Hash: 32 bytes
- Storage format: `base64(salt):base64(hash)` on the `FamilyMember.passwordHash` field
- Verification uses constant-time comparison to prevent timing attacks

### Member Account Lifecycle

1. **Owner** creates a member record in FamilyPage (name, email, role — no password yet)
2. **Owner** shares a family code with the member
3. **Member** joins using the family code → their pre-created record is found (no password)
4. **Member** goes through joiner onboarding: profile details + creates their own password
5. **Sign In**: Load file → pick member → enter password

There is no "create account" option for members — accounts are created by the owner. Members can only sign in or claim an existing record.

### Data Model Changes

- Added `passwordHash?: string` to `FamilyMember` — stores the PBKDF2 hash
- Added `requiresPassword: boolean` to `FamilyMember` — indicates whether member needs to set a password
- Removed `CachedAuthSession` interface — no longer needed without Cognito tokens
- Removed `cachedSessions` object store from registry database (v1 → v2 migration)

## Consequences

### Positive

- **True local-first**: Zero cloud auth dependencies — data file is the complete system
- **~165KB bundle reduction**: `amazon-cognito-identity-js` removed
- **Infrastructure simplification**: Cognito User Pool, API Gateway, Lambda, and all related Terraform modules deleted
- **Simpler auth flow**: No JWT tokens, no session caching, no offline grace periods, no verification codes
- **No operational complexity**: No Lambda cold starts, no API Gateway monitoring, no Cognito user pool management
- **Same security level**: PBKDF2 is the same algorithm already used for file encryption

### Negative

- **No email verification**: Members are trusted once they have the family code (mitigated by owner control over member creation)
- **No account recovery**: If a member forgets their password, the owner must reset it (future: add owner-initiated password reset)
- **Single device**: Auth state is per-file, not cloud-synced across devices (future: DynamoDB registry + magic links)

### Supersedes

- ADR-010: AWS Cognito Authentication
- ADR-013: Admin API with Lambda + API Gateway
