# ADR-020: OAuth PKCE Migration

- **Status:** Accepted
- **Date:** 2026-02-28

## Context

Google Identity Services (GIS) implicit grant flow has been deprecated by Google. The implicit grant provides no refresh tokens, forcing users to re-authorize every hour when their access token expired. This created a poor user experience, especially for long editing sessions.

The GIS library was loaded as an external script with no tree-shaking, adding unnecessary bundle weight and an external runtime dependency.

## Decision

We migrate to the Authorization Code + PKCE flow for Google OAuth, using a stateless Lambda proxy to handle the server-side token exchange.

Key implementation details:

- **Lambda proxy** at `api.beanies.family` holds the `client_secret` server-side and exchanges authorization codes for tokens
- **Two endpoints:**
  - `/oauth/google/token` — exchanges an authorization code for access and refresh tokens
  - `/oauth/google/refresh` — exchanges a refresh token for a new access token
- **Long-lived refresh tokens** cached in IndexedDB (`beanies-file-handles` store, key: `googleRefreshToken-{familyId}`) for persistent sessions across page reloads
- **PKCE code verifier** generated client-side and never sent to the proxy — only the code challenge is included in the authorization request

## Consequences

### Positive

- Long-lived sessions via refresh tokens — users no longer need to re-authorize every hour
- No external GIS script dependency — the OAuth flow uses standard browser APIs (fetch, crypto)
- Standards-compliant Authorization Code + PKCE flow, aligned with Google's recommended approach

### Negative

- Lambda proxy is a new infrastructure component that must be maintained and monitored
- Refresh tokens are stored in IndexedDB, which is acceptable for an SPA but lacks the protection of HTTP-only cookies
- The Lambda is stateless and handles no user data — it only proxies token requests to Google, but it is still an additional point of failure
