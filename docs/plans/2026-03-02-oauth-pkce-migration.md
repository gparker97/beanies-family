# Plan: Issue #112 — Google Drive Auth Migration to OAuth PKCE

> Date: 2026-03-02
> Related issues: #112, #119 (Automerge epic)

## Context

The current Google Drive auth uses GIS implicit grant — access tokens last ~1 hour with no refresh token. Silent refresh (`prompt: ''`) is unreliable, causing reconnect toasts and auth popups during background saves. This migration replaces it with Authorization Code + PKCE, giving long-lived refresh tokens and truly silent token renewal. A stateless Lambda proxy handles token exchange (keeps `client_secret` server-side).

**Branch:** `feat/112-oauth-pkce` (off `main`)

## Architecture Overview

```
User clicks "Connect Google Drive"
  → Popup opens Google consent URL (with PKCE code_challenge)
  → User grants access → Google redirects to /oauth/callback
  → Callback page sends auth code to parent via postMessage
  → Parent exchanges code via Lambda proxy (POST /oauth/google/token)
  → Lambda adds client_secret, forwards to Google, returns tokens
  → Frontend stores refresh_token in IndexedDB (per-family)
  → Access token auto-refreshes 5 min before expiry via Lambda proxy
```

## Implementation Steps

### Step 1: Backend — OAuth Lambda handler

**New file: `infrastructure/lambda/oauth/index.mjs`**

Stateless proxy — no DynamoDB. Same patterns as `infrastructure/lambda/registry/index.mjs`.

- `POST /oauth/{provider}/token` — validates provider (`google` only), required fields (`code`, `code_verifier`, `redirect_uri`, `client_id`), redirect_uri allowlist. Forwards to `https://oauth2.googleapis.com/token` with `client_secret` from env var. Returns Google's response.
- `POST /oauth/{provider}/refresh` — validates `refresh_token`, `client_id`. Forwards to same Google endpoint with `grant_type=refresh_token`.
- CORS: same pattern as registry (reads `CORS_ORIGIN` env var, validates origin).
- Invalid provider → 400. Missing fields → 400. Bad redirect_uri → 400. Unsupported method → 405. Google errors → forwarded status + body.

### Step 2: Backend — Terraform module

**Modify: `infrastructure/modules/registry/outputs.tf`** — Add:

```hcl
output "api_gateway_id" { value = aws_apigatewayv2_api.registry.id }
output "api_gateway_execution_arn" { value = aws_apigatewayv2_api.registry.execution_arn }
```

**Modify: `infrastructure/modules/registry/main.tf`** — Add `POST` to CORS `allow_methods`.

**New module: `infrastructure/modules/oauth/`** (3 files: `main.tf`, `variables.tf`, `outputs.tf`)

- Variables: `app_name`, `environment`, `google_client_secret` (sensitive), `api_gateway_id`, `api_gateway_execution_arn`, `cors_origins`
- Resources: IAM role (CloudWatch only), Lambda function (`{app_name}-oauth-{environment}`, Node.js 20.x), API GW integration + 2 routes on the **existing** API Gateway, Lambda permission
- Env vars: `GOOGLE_CLIENT_SECRET`, `CORS_ORIGIN`

**Modify: `infrastructure/main.tf`** — Add `module "oauth"` passing API GW refs from registry module.

**Modify: `infrastructure/variables.tf`** — Add `google_client_secret` (sensitive).

### Step 3: Backend — Lambda unit tests

**New file: `infrastructure/lambda/oauth/__tests__/handler.test.mjs`**

Tests (using Node.js `assert` + mock `fetch`, matching registry test patterns):

- Valid token exchange → forwards to Google, returns tokens
- Valid refresh → returns new access_token
- Invalid provider → 400
- Missing required fields → 400
- Invalid redirect_uri → 400
- Google error passthrough (invalid_grant etc.)
- CORS: allowed origin → correct headers; disallowed → no headers
- Unsupported method → 405

### Step 4: Frontend — PKCE utilities

**New file: `src/services/google/pkce.ts`** (~25 lines)

```ts
generateCodeVerifier(): string    // 32 random bytes → base64url (43 chars)
generateCodeChallenge(verifier): Promise<string>  // SHA-256 → base64url
```

Uses `crypto.subtle.digest` + `bufferToBase64url` from `@/utils/encoding`.

### Step 5: Frontend — OAuth proxy client

**New file: `src/services/google/oauthProxy.ts`** (~50 lines)

Thin fetch wrapper calling the Lambda at `VITE_REGISTRY_API_URL` (same API Gateway — no new env var).

```ts
exchangeCodeForTokens({ code, codeVerifier, redirectUri, clientId }): Promise<TokenResponse>
refreshAccessToken({ refreshToken, clientId }): Promise<TokenResponse>
```

`TokenResponse`: `{ access_token, refresh_token?, expires_in, token_type, scope }`

### Step 6: Frontend — Refresh token storage

**Modify: `src/services/sync/fileHandleStore.ts`** — Add 3 functions for per-family IndexedDB persistence:

```ts
storeGoogleRefreshToken(familyId, refreshToken): Promise<void>
getGoogleRefreshToken(familyId): Promise<string | null>
clearGoogleRefreshToken(familyId): Promise<void>
```

Uses existing `gp-finance-file-handles` database + `handles` store (same pattern as `storeProviderConfig`).

### Step 7: Frontend — OAuth callback page + route

**New file: `src/pages/OAuthCallbackPage.vue`** (~25 lines)

Extracts `code` (or `error`) from URL query params, sends to opener via `postMessage({ type: 'oauth-callback', code, error })`, closes popup after 300ms.

**Modify: `src/router/index.ts`** — Add route before catch-all:

```ts
{ path: '/oauth/callback', name: 'OAuthCallback', component: () => import('@/pages/OAuthCallbackPage.vue'), meta: { requiresAuth: false } }
```

### Step 8: Frontend — Rewrite googleAuth.ts

**Rewrite: `src/services/google/googleAuth.ts`**

This is the core change. **Same public API surface** for minimal downstream impact:

| Function                       | Before (GIS)                  | After (PKCE)                                                      |
| ------------------------------ | ----------------------------- | ----------------------------------------------------------------- |
| `isGoogleAuthConfigured()`     | Checks env var                | Same                                                              |
| `loadGIS()`                    | Loads GIS script              | **No-op** (backward compat)                                       |
| `requestAccessToken(opts?)`    | GIS popup                     | Opens Google OAuth URL in popup, exchanges code via Lambda        |
| `isTokenValid()`               | Checks memory                 | Same                                                              |
| `getAccessToken()`             | Returns cached                | Same                                                              |
| `attemptSilentRefresh()`       | GIS `prompt: ''` (unreliable) | `POST /oauth/google/refresh` with stored refresh_token (reliable) |
| `getValidToken()`              | Cached or refresh             | Same logic, reliable refresh                                      |
| `revokeToken()`                | GIS revoke                    | `POST` to Google revoke endpoint + clear IndexedDB refresh token  |
| `onTokenExpired(cb)`           | Expiry callbacks              | Same (rarely fires now — auto-refresh handles it)                 |
| `fetchGoogleUserEmail(token)`  | Userinfo API                  | Same                                                              |
| `getGoogleAccountEmail()`      | Cached email                  | Same                                                              |
| `setGoogleAccountEmail(email)` | Sets cache                    | Same                                                              |

**New public function:**

- `initializeAuth(familyId)` — Loads refresh token from IndexedDB, replaces `loadGIS()` in startup flow.

**New internals:**

- `openAuthPopup(url)` — Opens centered popup, listens for `postMessage` from callback page, polls for popup close. Returns auth code.
- `scheduleAutoRefresh(expiresInSec)` — Timer to refresh 5 min before expiry. Replaces `scheduleExpiryWarning()`. On failure, fires expiry callbacks as fallback.

**Removed:**

- All GIS types/interfaces (`TokenClient`, `GoogleOAuth2`, `Window.google`)
- `GIS_SCRIPT_URL`, `SESSION_TOKEN_KEY`, localStorage token caching
- `loadGIS()` body, `scheduleExpiryWarning()`, `persistToken()`

### Step 9: Frontend — Update consumers

**Modify: `src/stores/syncStore.ts`**

- Replace `loadGIS()` call in `initialize()` with `initializeAuth(familyId)`
- Remove other `loadGIS()` calls (in `loadFromGoogleDrive`, `listGoogleDriveFiles`)
- Keep `showGoogleReconnect` + `handleGoogleReconnected()` as rare fallback (revoked refresh token)

**Modify: `src/components/google/GoogleReconnectToast.vue`**

- Remove `loadGIS` import
- `handleReconnect()` just calls `requestAccessToken()` directly

**Modify: `src/services/sync/providers/googleDriveProvider.ts`**

- Remove `loadGIS` from imports and calls in `requestAccess()` / `createNew()`
- 401 retry logic unchanged (still calls `attemptSilentRefresh()` then `requestAccessToken()`)

### Step 10: Frontend tests

**Rewrite: `src/services/google/__tests__/googleAuth.test.ts`**

- Mock `oauthProxy` (exchangeCodeForTokens, refreshAccessToken)
- Mock `fileHandleStore` (storeGoogleRefreshToken, getGoogleRefreshToken, clearGoogleRefreshToken)
- Mock `window.open` for popup
- Tests: isGoogleAuthConfigured, isTokenValid, getAccessToken, initializeAuth loads refresh token, attemptSilentRefresh succeeds/fails/clears, requestAccessToken returns cached, revokeToken clears IndexedDB, onTokenExpired subscribe/unsubscribe

**New: `src/services/google/__tests__/pkce.test.ts`**

- Code verifier: URL-safe, 43 chars, unique
- Code challenge: deterministic SHA-256, no +/=/

**New: `src/services/google/__tests__/oauthProxy.test.ts`**

- Successful exchange/refresh, error handling, network errors

**Update: `src/services/sync/providers/__tests__/googleDriveProvider.test.ts`**

- Remove `loadGIS` from mocks. Structure otherwise unchanged.

### Step 11: Verify

1. `npm run type-check` — clean
2. `npm run test:run` — all tests pass
3. `npm run build` — succeeds
4. `npm run lint` — 0 new errors
5. Lambda tests pass: `node --test infrastructure/lambda/oauth/__tests__/handler.test.mjs`
6. Manual: `terraform plan` shows expected new resources (can't apply without secrets)

## Files

### New (9 files)

```
infrastructure/lambda/oauth/index.mjs
infrastructure/lambda/oauth/__tests__/handler.test.mjs
infrastructure/modules/oauth/main.tf
infrastructure/modules/oauth/variables.tf
infrastructure/modules/oauth/outputs.tf
src/services/google/pkce.ts
src/services/google/oauthProxy.ts
src/services/google/__tests__/pkce.test.ts
src/services/google/__tests__/oauthProxy.test.ts
src/pages/OAuthCallbackPage.vue
```

### Modified (8 files)

```
infrastructure/main.tf — add oauth module
infrastructure/variables.tf — add google_client_secret
infrastructure/modules/registry/main.tf — add POST to CORS
infrastructure/modules/registry/outputs.tf — export api_gateway_id + execution_arn
src/services/google/googleAuth.ts — full PKCE rewrite
src/services/sync/fileHandleStore.ts — add refresh token storage
src/stores/syncStore.ts — replace loadGIS with initializeAuth
src/components/google/GoogleReconnectToast.vue — remove loadGIS
src/services/sync/providers/googleDriveProvider.ts — remove loadGIS
src/router/index.ts — add /oauth/callback route
```

### Rewritten (2 test files)

```
src/services/google/__tests__/googleAuth.test.ts — full rewrite for PKCE
src/services/sync/providers/__tests__/googleDriveProvider.test.ts — update mocks
```

## Key references

- `infrastructure/lambda/registry/index.mjs` — Lambda handler pattern (CORS, response format)
- `infrastructure/modules/registry/main.tf` — API GW + Lambda Terraform pattern
- `src/services/google/googleAuth.ts` — Current GIS flow being replaced
- `src/services/sync/fileHandleStore.ts` — IndexedDB storage pattern to reuse

## Manual steps (post-merge)

1. **Google Cloud Console**: Add `https://beanies.family/oauth/callback` + `http://localhost:5173/oauth/callback` as authorized redirect URIs. Ensure client has `client_secret`.
2. **GitHub Secrets**: Add `TF_VAR_google_client_secret` for Terraform deploy.
3. **Terraform apply**: Deploy the new OAuth Lambda module.

## Risk mitigation

1. **Existing GIS users**: After deploy, cached GIS tokens in localStorage are ignored. Users re-auth once via popup, get a refresh token. One-time cost.
2. **Popup blockers**: `openAuthPopup()` only fires from user gestures (button clicks), which browsers allow. Detects blocked popup and throws clear error.
3. **No refresh token returned**: Google only issues refresh_token on first consent. Use `prompt: 'consent'` for first-time auth, `prompt: 'select_account'` for re-auth. If no refresh_token, degrade to popup-based re-auth per session.
4. **Lambda cold starts**: Stateless + lightweight = <200ms cold start. Only fires on initial auth and explicit re-auth.
