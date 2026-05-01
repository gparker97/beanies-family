# OAuth Proxy — runtime-agnostic API spec

This document defines the HTTP contract any beanies.family OAuth proxy must honor — regardless of host (AWS Lambda, Cloudflare Workers, Vercel Edge, self-hosted Node, etc.). The reference implementation in [`index.mjs`](./index.mjs) is one valid implementation; this spec is the source of truth both clients and servers must conform to.

---

## Endpoints

Two POST endpoints, both JSON. Path parameter `{provider}` is currently always `google` — the design is provider-agnostic but only Google is wired up today.

### `POST /oauth/{provider}/token` — exchange auth code for tokens

Called by the SPA after Google's OAuth redirect returns an authorization code.

**Request body** (`Content-Type: application/json`):

```json
{
  "code": "<authorization code from Google>",
  "code_verifier": "<PKCE verifier the SPA generated>",
  "redirect_uri": "<must match the SPA's /oauth/callback URL>",
  "client_id": "<the SPA's VITE_GOOGLE_CLIENT_ID>"
}
```

All four fields are required. The proxy MUST:

1. Validate `redirect_uri` against an allowlist before forwarding (open-redirect prevention).
2. Add `client_secret` and `grant_type=authorization_code` server-side.
3. POST to Google's token endpoint at `https://oauth2.googleapis.com/token` with `Content-Type: application/x-www-form-urlencoded`.
4. Return Google's response body as-is, preserving the HTTP status code on errors.

**Response body** (success, HTTP 200):

```json
{
  "access_token": "ya29.a0...",
  "refresh_token": "1//0...",
  "expires_in": 3599,
  "token_type": "Bearer",
  "scope": "https://www.googleapis.com/auth/drive.file ..."
}
```

`refresh_token` is only present on the FIRST consent for a given Google account — re-consents return only `access_token`. The SPA persists the `refresh_token` per-family in IndexedDB and reuses it across sessions.

**Response body** (error, 4xx/5xx):

```json
{
  "error": "<machine-readable code>",
  "error_description": "<human-readable detail, optional>"
}
```

Common errors:

- `invalid_grant` — code already used or expired (HTTP 400)
- `invalid_client` — client_id/client_secret mismatch (HTTP 401) — usually means the proxy holds a `client_secret` that doesn't match the `client_id` the SPA sent
- `redirect_uri_mismatch` — `redirect_uri` doesn't match what Google has registered for the client (HTTP 400)

### `POST /oauth/{provider}/refresh` — refresh an expired access token

Called by the SPA when an access token has expired and a stored refresh token is available.

**Request body**:

```json
{
  "refresh_token": "<long-lived refresh token from a prior /token call>",
  "client_id": "<the SPA's VITE_GOOGLE_CLIENT_ID>"
}
```

The proxy MUST:

1. Add `client_secret` and `grant_type=refresh_token` server-side.
2. POST to Google's token endpoint.
3. Return Google's response body as-is.

**Response body** (success, HTTP 200): same shape as `/token`. `refresh_token` is typically NOT included in refresh responses (the SPA reuses the original).

**Response body** (error, 4xx/5xx): same shape as `/token`. The most common is `invalid_grant` indicating the refresh token was revoked (user signed out of Google, or revoked the app's permission). The SPA treats this as permanent, clears the stored refresh token, and prompts the user to re-authenticate.

---

## Required behaviors

### CORS

Both endpoints MUST respond with `Access-Control-Allow-Origin: <exact SPA origin>` for allowlisted origins, and MUST handle `OPTIONS` preflight requests with HTTP 204.

The proxy MUST NOT use `Access-Control-Allow-Origin: *`. The SPA's origin must be explicitly configured (the reference implementation reads from a `CORS_ORIGIN` env var; comma-separated for multi-origin support).

Allowed headers: `Content-Type` only.

The proxy MUST also send `Vary: Origin` whenever it emits an `Access-Control-Allow-Origin` header — without it, any cache between the client and proxy can serve a wrong-origin response.

### Origin enforcement on POSTs

The proxy MUST reject any POST whose `Origin` header is set but not in the allowlist, returning HTTP 403 with `{ "error": "forbidden_origin" }`.

This is defense-in-depth: browser CORS only blocks the response read, not the request itself. Without this check, an attacker page could have the proxy execute a request server-side (against Google) even though the response would be unreadable to them. POSTs with no `Origin` header (curl, server-to-server) are allowed.

### Cache-Control

Every response — success, error, preflight — MUST include `Cache-Control: no-store`. Token exchanges are credentials; no intermediary should ever cache them.

### Redirect URI allowlist

The proxy MUST validate the `redirect_uri` field of `/oauth/{provider}/token` against an explicit allowlist. Wildcards are not permitted.

This prevents an open-redirect attack: an attacker who tricks a user into authorizing on Google could otherwise redirect the resulting code to a malicious domain. The allowlist closes that hole.

The reference implementation derives the allowlist from `CORS_ORIGIN` by appending `/oauth/callback` to each origin. This is recommended (single source of truth, no second env var to keep in sync) since the SPA's callback path is fixed at `/oauth/callback`. Implementations MAY use a separate explicit allowlist instead if they need a non-standard callback path.

### Empty / non-JSON response handling

The SPA's client (`src/services/google/oauthProxy.ts`) defends against:

- Empty response bodies (e.g. 502 from a CDN with no JSON body)
- HTML error pages (e.g. 503 with `<html>...</html>`)

Proxies that return such responses on internal errors will surface as `Token exchange failed` / `Token refresh failed` to the SPA. Best practice: ALWAYS return JSON, even on internal errors (`{ "error": "internal_server_error" }`).

### Method handling

- `OPTIONS` → 204 with CORS headers
- `POST` → the relevant endpoint
- Any other method → 405 with `{ "error": "Method not allowed" }`

### Path parsing

Path is `/oauth/{provider}/{action}`. The proxy MUST validate:

- `{provider}` is in a supported set (currently just `["google"]`)
- `{action}` is `"token"` or `"refresh"`

Anything else → 400.

---

## What the proxy MUST NOT do

- **Log the `client_secret`** — never put it in stdout, error messages, or response bodies.
- **Log full token bodies** — `access_token` and `refresh_token` are credentials. Log error codes / status codes only.
- **Cache responses** — every request to Google must be fresh.
- **Trust the `client_id` from the request body alone** — for stricter deployments, optionally validate it matches a configured expected value; the reference implementation forwards whatever the SPA sends, relying on Google's own `invalid_client` rejection for mismatches.

---

## Reference implementations

- **AWS Lambda** (Node.js 20): [`index.mjs`](./index.mjs) — about 185 lines, no external deps.
- **Cloudflare Workers**: adapt the AWS handler — `request.method` / `await request.text()` instead of `event.requestContext.http.method` / `event.body`. The token-fetch logic and validation are identical.
- **Vercel Edge / Netlify Functions**: same as Cloudflare Workers — fetch + plain JS.
- **Self-hosted Node server**: wrap the handler in any HTTP framework (Express, Fastify, Hono, etc.) or use plain `node:http`. The handler is pure logic.

The contract above is the source of truth. Any new implementation should be testable against the existing SPA without code changes — set `VITE_OAUTH_PROXY_URL` to point at it and Drive sign-in should just work.
