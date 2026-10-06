# Family Registry Lambda — deploy guide (optional)

This directory contains the family-registry Lambda used by the cloud build at `app.beanies.family`. It is OPTIONAL for self-hosters — the registry is a smoothness feature for the magic-link join flow, not a hard requirement. Without it, a joiner clicking a magic-link invite picks the shared `.beanpod` from the Google Drive Picker manually (one extra tap). With it, the join flow auto-resolves the file location.

If you're a self-hoster running solo or with a single small family, **you can skip this entirely** — leave `VITE_REGISTRY_API_URL` and `VITE_REGISTRY_API_KEY` unset and rely on the Picker fallback. Deploy this Lambda only if you want the polished magic-link experience.

---

## What this Lambda does

Three family endpoints (all `JSON`, all gated on an API key header):

- `GET /family/{familyId}` — fetch a family's stored file location
- `PUT /family/{familyId}` — register or update a family's location (called after pod creation / sync changes)
- `DELETE /family/{familyId}` — tombstone a family in the registry (identity and provenance kept, everything else dropped)

State lives in DynamoDB, one row per family, keyed by `familyId` (UUID).

Plus one keyless route for the hosted service's marketing site, `POST /events` (#121), described in [Marketing-events ledger](#marketing-events-ledger-post-events) below. Self-hosters do not need it.

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
  attribution: {             // campaign tag (#118); map, nullable. Write-once: stamped only on
    utm_source?, utm_medium?, //   the signup write (isSignupEvent), never moved by a later PUT,
    utm_campaign?, utm_content?, // kept on the DELETE tombstone. Allowlisted keys only; each
    utm_term?, campaign_id?,  //   value trimmed, 1-100 chars of [A-Za-z0-9._~:-], else that field
    ad_group_id?, ad_id?,     //   is dropped. Twin of packages/brand/attribution.ts.
    oppref?: string
  } | null,
  heardVia: string | null,    // survey answer id (#121): one of reddit, product_hunt, substack,
                              //   google, app_store, chatgpt_ad, ai, friend, other. Write-once
                              //   exactly like `attribution` (signup write only, kept on the
                              //   tombstone); anything else is dropped with a `heard_via_dropped`
                              //   log line. The label and free text stay Slack-only. Twin of
                              //   packages/brand/heardVia.ts.
  attributionInferred: {...} | null, // see below; never accepted from a client
  updatedAt: ISO timestamp,   // updated on every PUT
}
```

`attributionInferred` (#121) is derived ops data, written ONLY by the metrics skill's scorer (`.claude/skills/beanies-metrics/scripts/infer_attribution.mjs --apply`) with a single-attribute conditional `UpdateItem` that requires `attribution` to be absent or null, so it can never sit beside, or overwrite, a deterministic tag. The Lambda carries it from the existing row on every PUT and on the DELETE tombstone, never reads it from a request body, and strips it from the GET response: it is not part of the app's wire contract and has no app type. Its shape, owned by the scorer:

```ts
{
  fields: { utm_source?, utm_content?, ... }, // the matched store_tap's validated tag ({} if untagged)
  confidence: number,         // 0..1, the additive score
  band: 'high' | 'medium' | 'low',
  method: string,             // scorer version stamp
  eventId: string,            // the ledger event the family was matched to
  gapMinutes: number,         // tap -> pod creation
  candidates: number,         // store_tap events considered
  scoredAt: ISO timestamp,
}
```

Re-scoring may replace an earlier value; nothing ever removes one. The scoring rules live in the metrics skill's `references/data-sources.md`.

### 2. Bundle the Lambda

```bash
cd infrastructure/lambda/registry
# Bundle index.mjs + node_modules dependencies (the AWS SDK v3 packages)
# If your Lambda runtime includes the SDK by default (Node.js 18+ usually does
# for client-dynamodb), you can skip node_modules and just zip the two modules.
# entitlement.mjs and events.mjs are imported by index.mjs; leaving either out
# fails every request with ERR_MODULE_NOT_FOUND.
zip -j lambda.zip index.mjs entitlement.mjs events.mjs
```

If you need to bundle deps:

```bash
npm init -y
npm install @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb
zip -r lambda.zip index.mjs entitlement.mjs events.mjs node_modules
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
  - `DEV_ORIGINS` (optional) — comma-separated dev origins; defaults to `http://localhost:5173,http://localhost:4173,http://localhost:4321`
  - `EVENTS_TABLE_NAME`, `EVENTS_DEV_TABLE_NAME` (optional) — the marketing-events ledger tables for `POST /events`; the dev one falls back to the prod one. Leave unset if you do not route `POST /events`.
  - `BILLING_TABLE_NAME`, `V1_LAUNCH_AT`, `BILLING_ENFORCE`: the hosted service's plan state. The hosted deployment always provisions a billing DynamoDB table and grants this Lambda `dynamodb:GetItem` on it. A self-host deployment may leave `BILLING_TABLE_NAME` unset, and then only while `V1_LAUNCH_AT` is also unset: every GET returns `entitlement.state: 'beta'` and nothing is ever read-only. (Setting `V1_LAUNCH_AT` without a billing table makes the GET return `entitlement: null`. A subscription or a `trialEndsAt` override in the billing table counts even before `V1_LAUNCH_AT` is set; only the launch-based 90-day clock waits for it.)
- **IAM permissions:** the Lambda's execution role needs `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:DeleteItem` on your table's ARN, plus `dynamodb:GetItem` on the billing table's ARN when `BILLING_TABLE_NAME` is set, plus `dynamodb:PutItem` on the events tables when `POST /events` is routed.

Upload `lambda.zip`.

### 4. Wire up API Gateway HTTP API

Create routes:

- `GET /family/{familyId}`
- `PUT /family/{familyId}`
- `DELETE /family/{familyId}`
- `OPTIONS /family/{familyId}` (CORS preflight; the Lambda handles it directly)

All four route to your registry Lambda. The hosted service also routes `POST /events` (the keyless marketing-events ledger, below) to the same Lambda; a self-host does not need it.

### 5. Configure your SPA

In `.env.local` (alongside `VITE_OAUTH_PROXY_URL`):

```env
VITE_REGISTRY_API_URL=https://abc123.execute-api.us-east-1.amazonaws.com
VITE_REGISTRY_API_KEY=<the-secret-you-generated>
```

Rebuild the SPA. The next pod creation will register itself; subsequent magic-link joins will auto-resolve via the registry.

---

## Marketing-events ledger (`POST /events`)

The hosted service's marketing site (`beanies.family`) beacons two kinds of first-party event to `POST /events` (#121), so the metrics skill can infer which ad brought a family whose pod was created in the App Store or Play build (those installs carry no campaign tag):

- `landing`: an entry pageview (a page whose referrer is not the site itself), tagged or not.
- `store_tap`: a tap on the App Store or Play badge, fired from the `/ios` and `/android` redirect pages, with `platform: 'ios' | 'android'`.

The site sends `{ kind, platform?, fields, loc }` as a `text/plain` JSON string (`navigator.sendBeacon`, so there is no CORS preflight). The route is **keyless** by design and branches before the API-key and familyId checks. In order, it:

1. rejects a missing or non-allowlisted `Origin` with `403 origin_not_allowed` (before any body parsing);
2. decodes a base64 body (API Gateway v2 may encode one) and rejects more than 2 KB (`400 body_too_large`);
3. rejects unparseable JSON (`400 bad_json`), an unknown `kind` (`400 bad_kind`), a `store_tap` without a valid `platform` (`400 bad_platform`), or `fields` that are present but not an object (`400 bad_fields`);
4. validates each field of `fields` with the same allowlist and value rule as `attribution`, dropping a bad field on its own (one `attribution_dropped` line, no family hash) and storing the rest; nothing valid left means an untagged event, never a rejected one;
5. truncates `loc` to 120 characters, or stores `/` when it is not a path (never a rejection);
6. writes one item to the events table (dev origins write to the dev table) and answers `204`; a DynamoDB failure answers `500`.

Every request logs exactly one structured line: `{ msg: 'marketing_event', kind, platform, tagged, outcome: 'stored' | 'rejected' | 'error', reason }`. `kind` and `platform` are logged only when they are allowlisted values. `rejected` lines also carry `origin` (the `Origin` header reduced by `reduceOrigin` to `scheme://host[:port]`, or `none` / `null` / `invalid`, at most 80 characters) and `device` (`reduceUserAgent`), so a rejection can be told apart as a bot, a non-browser client or a real origin missing from `CORS_ORIGIN`; stored and error lines omit both.

The item (`events.mjs` `buildItem`):

```ts
{
  eventId: string,            // server-generated UUID, partition key
  ts: ISO timestamp,
  tsEpoch: number,            // epoch SECONDS, same unit as expires_at
  kind: 'landing' | 'store_tap',
  platform?: 'ios' | 'android',  // store_tap only
  tagged: boolean,
  fields?: { utm_source?, ... },  // the validated tag; absent when untagged
  device?: { class: 'phone' | 'tablet' | 'desktop', os: 'ios' | 'android' | 'macos' | 'windows' | 'other' },
  loc: string,                // bounded page path
  origin: string,
  expires_at: number,         // epoch seconds, now + 390 days (the table's TTL attribute)
}
```

`device` is reduced server-side from the `User-Agent` header (class and OS family only). The raw User-Agent, any OS or browser version, the IP address, cookies and anything that would link two events from one person are never stored. iPadOS Safari presents as a Mac and is recorded as `desktop` / `macos`.

Tables (provisioned by the hosted deployment): `beanies-family-marketing-events-prod` and `beanies-family-marketing-events-dev`, hash key `eventId`, TTL on `expires_at`, point-in-time recovery on, deletion protection in prod. The name grammar is `eventsTableName(env)` in `events.mjs`, which the metrics skill imports. The stage throttles the route at burst 20 / rate 10.

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
- DynamoDB rows are not encrypted at rest beyond the AWS-managed default. The data stored is: family ID, file location, family name, owner email, newsletter opt-in, the campaign tag from the link that first brought the family to beanies.family (`attribution`, if there was one; it identifies the ad, not the person), the survey answer id (`heardVia`, if answered) and, on the hosted service, the scorer's inferred ad (`attributionInferred`). No financial data, no member list, no transactions — none of which the registry sees.
- `POST /events` has no API key. It is bounded by the `Origin` allowlist (forgeable by a non-browser client, so it is a filter, not a boundary), the 2 KB cap, strict validation and the per-route throttle; at 10 rps a flood is at most 864k small writes a day, and a polluted event can only ever attach to a pod that really was created. The worst outcome is a mis-scored dashboard, never data exposure: the route writes only, and reads nothing back.
- CORS allowlisting + API-key gating means an attacker who finds the URL still needs the key. An attacker who finds both can DoS your registry but cannot read other users' families (different family IDs).
