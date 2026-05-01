# OAuth Proxy Lambda — deploy guide

This directory contains the OAuth proxy Lambda used by the cloud build at `app.beanies.family`. Self-hosters following Path B of [SELF_HOSTING.md](../../../docs/SELF_HOSTING.md) deploy their own copy with their own Google OAuth `client_secret`.

The runtime-agnostic API contract lives in [SPEC.md](./SPEC.md) — implement it on AWS Lambda, Cloudflare Workers, Vercel Edge, or any Node-compatible host. This README walks through the AWS path because that's what the existing code targets.

---

## What this Lambda does

Google's OAuth Web Application client type requires a `client_secret` for the token-refresh grant, even when using PKCE. Browsers can't safely hold a secret, so this Lambda holds it server-side and proxies the exchange to Google.

Two endpoints (both `POST`, both JSON):

- `POST /oauth/google/token` — exchange auth code for tokens (initial sign-in)
- `POST /oauth/google/refresh` — refresh an expired access token

Full request/response shapes in [SPEC.md](./SPEC.md).

The Lambda is stateless and tiny — about 175 lines, zero external deps beyond the Node.js standard runtime and `fetch`.

---

## Prerequisites

1. **Google OAuth client** — created in [Google Cloud Console](https://console.cloud.google.com/) per `docs/SELF_HOSTING.md` → Path B → Step 1. You'll need:
   - `Client ID` (goes in your SPA's `VITE_GOOGLE_CLIENT_ID`)
   - `Client Secret` (goes in this Lambda's env)
   - Authorized redirect URIs already configured to include `<your-spa-origin>/oauth/callback`
2. **AWS account** with Lambda + API Gateway permissions.
3. **Your SPA's origin URL** (e.g. `https://family.example.com`).

---

## Deploy steps (AWS Lambda + API Gateway HTTP API)

### 1. Bundle the Lambda

```bash
cd infrastructure/lambda/oauth
zip -j lambda.zip index.mjs
```

(`-j` strips paths so the zip contains a top-level `index.mjs`.)

### 2. Create the Lambda function

In the AWS Console → Lambda → Create function:

- **Runtime:** Node.js 20.x
- **Handler:** `index.handler` (the file's named export at `index.mjs:50`)
- **Architecture:** arm64 (cheaper) or x86_64 — either works
- **Memory:** 128 MB is plenty
- **Timeout:** 10 seconds
- **Environment variables:**
  - `GOOGLE_CLIENT_SECRET` — paste from Google Cloud Console
  - `CORS_ORIGIN` — comma-separated list of your SPA origins, e.g. `https://family.example.com,http://localhost:5173`

Upload `lambda.zip` as the function code.

### 3. Wire up API Gateway HTTP API

Create an HTTP API in API Gateway:

- **Routes:**
  - `POST /oauth/{provider}/token` → integrate with your Lambda
  - `POST /oauth/{provider}/refresh` → integrate with same Lambda
- **CORS:** the Lambda handles CORS itself via the `CORS_ORIGIN` env var, so you can leave the API Gateway-level CORS unconfigured (or set it to match — both work).

The HTTP API will give you an invoke URL like `https://abc123.execute-api.us-east-1.amazonaws.com`. Optionally configure a custom domain (e.g. `oauth.family.example.com`).

### 4. Configure your SPA

In your SPA's `.env.local`:

```env
VITE_OAUTH_PROXY_URL=https://abc123.execute-api.us-east-1.amazonaws.com
# OR your custom domain:
# VITE_OAUTH_PROXY_URL=https://oauth.family.example.com
```

Rebuild the SPA (`npm run build`). On next sign-in, the SPA will call your Lambda for the token exchange.

---

## Alternative runtimes

The Lambda is plain ES modules with `fetch`, so it ports easily:

- **Cloudflare Workers** — adapt `event.requestContext.http.method` to `request.method` and `event.body` to `await request.text()`. Same logic. Configure `GOOGLE_CLIENT_SECRET` and `CORS_ORIGIN` as Worker bindings.
- **Vercel Edge / Netlify Functions** — same shape; adapt the request parsing.
- **Self-hosted Node server** (e.g. behind Caddy/Nginx) — wrap the handler with any HTTP framework. The handler returns `{ statusCode, headers, body }` which maps cleanly to a Node `res` object.

See [SPEC.md](./SPEC.md) for the precise request/response contract every implementation must honor.

---

## Verifying it works

Once deployed and the SPA is configured:

1. Open your SPA, click **Sign in with Google**.
2. Watch the Network tab — you should see a `POST` to `<your-lambda>/oauth/google/token` after Google returns the auth code.
3. Watch the Lambda's CloudWatch logs — successful exchanges return 200; errors are logged with `OAuth proxy error: ...`.

If the SPA hits a `client_secret is missing` error, your Lambda's `GOOGLE_CLIENT_SECRET` env var is unset.

If the SPA hits CORS errors, check `CORS_ORIGIN` matches your SPA's origin exactly (scheme + host + port).

If the SPA hits `Invalid redirect_uri`, the request's `redirect_uri` doesn't match `<origin>/oauth/callback` for any origin in `CORS_ORIGIN`. Add the missing origin to `CORS_ORIGIN` (the redirect-URI allowlist is auto-derived).

If the SPA hits `403 forbidden_origin`, the request's `Origin` header isn't in `CORS_ORIGIN`. This is a defense-in-depth check on top of CORS — same fix: add the origin to `CORS_ORIGIN`.

---

## Security notes

- `GOOGLE_CLIENT_SECRET` is a credential. Treat it like a password: never commit it, never log it, rotate if exposed. The Lambda code itself logs only error messages, never the secret.
- `CORS_ORIGIN` is the only thing standing between your Lambda and arbitrary origins. Be explicit — don't use `*`. The redirect-URI allowlist is derived from `CORS_ORIGIN` (`<origin>/oauth/callback` for each), so this single env var prevents both cross-origin abuse and open-redirect attacks.
- The Lambda runs unauthenticated (no API key — different from the registry Lambda). Auth is implicitly handled by the OAuth code flow itself: Google won't issue a code to anyone who didn't go through Google's consent screen first.
