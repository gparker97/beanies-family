# Family Registry Lambda — deploy guide (optional)

This directory contains the family-registry Lambda used by the cloud build at `app.beanies.family`. It is OPTIONAL for self-hosters — the registry is a smoothness feature for the magic-link join flow, not a hard requirement. Without it, a joiner clicking a magic-link invite picks the shared `.beanpod` from the Google Drive Picker manually (one extra tap). With it, the join flow auto-resolves the file location.

If you're a self-hoster running solo or with a single small family, **you can skip this entirely** — leave `VITE_REGISTRY_API_URL` and `VITE_REGISTRY_API_KEY` unset and rely on the Picker fallback. Deploy this Lambda only if you want the polished magic-link experience.

---

## What this Lambda does

Three endpoints (all `JSON`, all gated on an API key header):

- `GET /family/{familyId}` — fetch a family's stored file location
- `PUT /family/{familyId}` — register or update a family's location (called after pod creation / sync changes)
- `DELETE /family/{familyId}` — remove a family from the registry (called on disconnect)

State lives in DynamoDB, one row per family, keyed by `familyId` (UUID).

The Lambda is small (~130 lines) and uses the AWS SDK v3 DynamoDB client. Provider-agnostic ports would need to swap in a different KV store.

---

## Prerequisites

1. **AWS account** with Lambda + API Gateway + DynamoDB permissions.
2. **OAuth Lambda already deployed** (see [`../oauth/README.md`](../oauth/README.md)) — the registry is not useful without Drive sync.
3. **A random secret string** — generate with `openssl rand -base64 32` or similar. This becomes both the Lambda's `REGISTRY_API_KEY` env var and the SPA's `VITE_REGISTRY_API_KEY`.

---

## Deploy steps (AWS Lambda + API Gateway + DynamoDB)

### 1. Create the DynamoDB table

In the AWS Console → DynamoDB → Create table:

- **Table name:** `beanies-family-registry` (or your choice)
- **Partition key:** `familyId` (String)
- **No sort key**
- **Capacity mode:** On-demand (the registry traffic is too low to need provisioned)
- No secondary indexes, no streams, no encryption beyond AWS-managed defaults

The table schema is implicit — the Lambda writes whatever fields are in the PUT request. Reference shape (mirrors `RegistryEntry` at `src/types/models.ts:1067-1078`):

```ts
{
  familyId: string,           // UUID, partition key
  provider: 'local' | 'google_drive',
  fileId: string | null,      // Drive file ID, null for local
  displayPath: string | null, // e.g. "our-family.beanpod"
  familyName: string | null,
  ownerEmail: string | null,
  subscribeNewsletter: boolean | null,
  createdAt: ISO timestamp,   // write-once on first PUT
  updatedAt: ISO timestamp,   // updated on every PUT
}
```

### 2. Bundle the Lambda

```bash
cd infrastructure/lambda/registry
# Bundle index.mjs + node_modules dependencies (the AWS SDK v3 packages)
# If your Lambda runtime includes the SDK by default (Node.js 18+ usually does
# for client-dynamodb), you can skip node_modules and just zip index.mjs.
zip -j lambda.zip index.mjs
```

If you need to bundle deps:

```bash
npm init -y
npm install @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb
zip -r lambda.zip index.mjs node_modules
```

### 3. Create the Lambda function

- **Runtime:** Node.js 20.x
- **Handler:** `index.handler`
- **Memory:** 128 MB
- **Timeout:** 10 seconds
- **Environment variables:**
  - `TABLE_NAME` — your DynamoDB table name
  - `REGISTRY_API_KEY` — the random secret you generated
  - `CORS_ORIGIN` — comma-separated SPA origins (e.g. `https://family.example.com,http://localhost:5173`)
  - `DEV_TABLE_NAME` (optional) — separate dev table for `localhost` origins
  - `DEV_ORIGINS` (optional) — comma-separated dev origins; defaults to `http://localhost:5173,http://localhost:4173`
- **IAM permissions:** the Lambda's execution role needs `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:DeleteItem` on your table's ARN.

Upload `lambda.zip`.

### 4. Wire up API Gateway HTTP API

Create routes:

- `GET /family/{familyId}`
- `PUT /family/{familyId}`
- `DELETE /family/{familyId}`
- `OPTIONS /family/{familyId}` (CORS preflight; the Lambda handles it directly)

All four route to your registry Lambda.

### 5. Configure your SPA

In `.env.local` (alongside `VITE_OAUTH_PROXY_URL`):

```env
VITE_REGISTRY_API_URL=https://abc123.execute-api.us-east-1.amazonaws.com
VITE_REGISTRY_API_KEY=<the-secret-you-generated>
```

Rebuild the SPA. The next pod creation will register itself; subsequent magic-link joins will auto-resolve via the registry.

---

## Verifying it works

1. Create a new pod via your SPA. After save, check the DynamoDB table — there should be a row with the new family's `familyId` and metadata.
2. Generate an invite link from your pod. Open it in another browser (or device). The join flow should pre-fill the file selection without showing the Drive Picker.
3. If the Picker still appears: check the SPA's console for `[registry]` warnings. Common causes: API key mismatch (HTTP 401), CORS misconfiguration, or `VITE_REGISTRY_API_URL` not set.

---

## Skipping the registry (most self-hosters)

If you don't deploy this Lambda, leave `VITE_REGISTRY_API_URL` empty in your SPA's `.env.local`. The `features.registry` gate auto-disables and:

- `registerFamily()` no-ops (early-return at `src/services/registry/registryService.ts:45`)
- `lookupFamily()` returns null (`registryService.ts:24`) — joiner picks file via Drive Picker
- `removeFamily()` no-ops on disconnect (`registryService.ts:59`)

The Drive sign-in flow is unaffected — `VITE_OAUTH_PROXY_URL` (or `VITE_REGISTRY_API_URL` as fallback) provides the OAuth proxy. Only the magic-link smoothness is reduced.

---

## Security notes

- The API key in `REGISTRY_API_KEY` is the only thing protecting the registry from arbitrary writes. Treat it like a credential — don't commit it, rotate if exposed.
- DynamoDB rows are not encrypted at rest beyond the AWS-managed default. The data stored is: family ID, file location, family name, owner email, newsletter opt-in. No financial data, no member list, no transactions — none of which the registry sees.
- CORS allowlisting + API-key gating means an attacker who finds the URL still needs the key. An attacker who finds both can DoS your registry but cannot read other users' families (different family IDs).
