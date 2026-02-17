# ADR-010: AWS Cognito Authentication

**Status:** Accepted
**Date:** 2026-02-17

## Context

The application needs user authentication to support multi-family access, identify users across devices, and enable future cloud sync. Requirements:

- Email + password sign-in and sign-up
- Magic link (passwordless) authentication (future)
- Passkey/WebAuthn biometric authentication (future)
- Offline access after initial login (cached credentials)
- Optional — users can continue without an account (local-only mode)

## Decision

Use **AWS Cognito User Pools** via the `amazon-cognito-identity-js` browser SDK for authentication. Auth is optional — the app fully functions without it.

### Architecture

```
Browser App
    │
    ├── cognitoService.ts ──── amazon-cognito-identity-js ──── AWS Cognito User Pool
    │
    ├── tokenManager.ts ────── Registry DB (cachedSessions store)
    │
    └── authStore.ts ────────── Pinia store (reactive auth state)
```

### Key Components

- **`src/config/cognito.ts`** — Reads `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_REGION` from environment variables. Auth features are disabled when these are not set.
- **`src/services/auth/cognitoService.ts`** — Wraps the Cognito SDK: `signUp()`, `signIn()`, `signOut()`, `getCurrentSession()`, `refreshSession()`, `getIdTokenClaims()`.
- **`src/services/auth/tokenManager.ts`** — Caches JWT tokens in the registry database for offline access. `isSessionValidForOffline()` allows access with cached tokens up to 7 days after expiry.
- **`src/stores/authStore.ts`** — Pinia store managing auth lifecycle: `initializeAuth()`, `signIn()`, `signUp()`, `signOut()`, `continueWithoutAuth()`.

### Auth Flow

1. App starts → `authStore.initializeAuth()`
2. If Cognito is not configured → skip auth, local-only mode
3. Try Cognito SDK session (existing browser session)
4. If no SDK session → try cached tokens from registry DB
5. If cached tokens found and < 7 days expired → offline session granted
6. Otherwise → redirect to login page

### Login Page

- **Sign In tab:** Email + password
- **Create Account tab:** Family name, user name, email, password → creates Cognito user + Family + per-family DB
- **"Continue without account":** Preserves the existing local-only setup flow for users who don't want accounts

### Cognito User Attributes

- `email` — Primary identifier
- `custom:familyId` — Links user to their family
- `custom:familyRole` — User's role within the family (admin, member)

### Route Guards

- All app routes have `requiresAuth: true` in route meta
- `/login` and `/auth/magic` routes have `requiresAuth: false`
- `App.vue` checks auth state on mount and redirects unauthenticated users to `/login`

### Offline Strategy

- After successful Cognito login, all three tokens (ID, access, refresh) are cached in the registry DB's `cachedSessions` store
- On subsequent app launches: try online refresh first, fall back to cached tokens
- Cached sessions are valid for offline use for 7 days after token expiry
- Auth only establishes identity (which family to load) — all data operations remain local

### Local-Only Mode

When Cognito environment variables are not set (`isCognitoConfigured()` returns false):

- No login page is shown
- App behaves exactly as before (pre-auth architecture)
- Users who click "Continue without account" get the same experience
- `authStore.isLocalOnlyMode` tracks this state

## Consequences

### Positive

- **Optional auth** — app works without any AWS infrastructure
- **Offline-first** — cached tokens allow access without internet for 7 days
- **Standard auth provider** — Cognito handles password hashing, email verification, token management
- **Extensible** — Custom auth challenges support magic links; WebAuthn support for passkeys
- **No server needed for basic auth** — Cognito SDK communicates directly with the user pool

### Negative

- **AWS dependency** — requires Cognito User Pool setup for auth features
- **SDK size** — `amazon-cognito-identity-js` adds to bundle (~60KB gzipped)
- **Admin operations need Lambda** — creating accounts for family members requires server-side `AdminCreateUser` API
- **Token caching security** — cached JWTs in IndexedDB are accessible to same-origin code (acceptable for local-first app)
- **7-day offline window** — users must go online at least once per week to refresh tokens
