# Plan: Cloud Relay for Near-Instant Cross-Device Sync

> Date: 2026-02-26
> Related issues: #103 (cross-device sync), #104 (cloud relay)

## Context

Currently, cross-device sync relies on 10-second file polling (`startFilePolling()` in syncStore) and visibility-change checks. This means changes take up to 10 seconds to appear on another device, and the polling reads the file every 10 seconds even when nothing has changed.

A cloud relay provides near-instant notifications: when Device A saves, it pings a WebSocket channel; Device B receives the ping and immediately checks the file for changes. The relay carries **no family data** -- just a "something changed" signal per family. The file remains the source of truth.

This works for both:

- **Local filesystem** (File System Access API with Google Drive / Dropbox desktop sync)
- **Future cloud API** (direct Google Drive / Dropbox API access)

## Approach

### Architecture

```
Device A saves → POST /notify/{familyId} → Lambda → DynamoDB lookup →
  API Gateway @connections → WebSocket push → Device B receives →
  reloadIfFileChanged()
```

**AWS services:**

- **API Gateway WebSocket API** (`wss://relay.beanies.family`) -- persistent connections, managed scaling
- **Lambda** (Node.js 20) -- handles `$connect`, `$disconnect`, `notify` routes
- **DynamoDB** -- tracks active WebSocket connections per family
- **Route53 + ACM** -- custom domain `relay.beanies.family`

### DynamoDB Schema

**Table:** `beanies-family-relay-prod`

| Attribute      | Type | Role                                                    |
| -------------- | ---- | ------------------------------------------------------- |
| `connectionId` | S    | Partition key (API Gateway connection ID)               |
| `familyId`     | S    | GSI partition key                                       |
| `connectedAt`  | S    | ISO timestamp                                           |
| `ttl`          | N    | DynamoDB TTL (auto-cleanup stale connections after 24h) |

**GSI:** `familyId-index` on `familyId` -- lookup all connections for a family

### Lambda Handler Routes

1. **`$connect`** -- validates `x-api-key` from query string, stores `{ connectionId, familyId, connectedAt, ttl }` in DynamoDB
2. **`$disconnect`** -- deletes connection record from DynamoDB
3. **`notify`** -- receives `{ familyId }`, queries GSI for all connections in that family, sends `{ type: "file-changed" }` to each via `@connections` POST (skips sender's own connectionId)

### Security

- Same API key as the existing registry service (`VITE_REGISTRY_API_KEY`)
- Passed as query param on WebSocket connect: `wss://relay.beanies.family?apiKey=xxx&familyId=yyy`
- Channel isolation: each family only receives notifications for their own familyId
- No family data transits the relay -- only connection metadata

### Client-Side Integration

**New file: `src/services/relay/relayService.ts`**

Manages the WebSocket lifecycle:

- `connect(familyId)` -- opens WebSocket, sends familyId on connect
- `disconnect()` -- closes WebSocket cleanly
- `notifyFileChanged(familyId)` -- fires HTTP POST to `/notify/{familyId}` after each save
- Auto-reconnect with exponential backoff (1s → 2s → 4s → max 30s)
- Heartbeat via WebSocket ping/pong (API Gateway handles this natively)
- `onFileChanged` callback -- invoked when relay receives a notification

**Integration points:**

1. **`syncStore.ts` -- `setupAutoSync()`**: after setting up the watch + file polling, also call `relayService.connect(familyId)` with callback wired to `reloadIfFileChanged()`
2. **`syncStore.ts` -- `resetState()` / `disconnect()`**: call `relayService.disconnect()`
3. **`syncService.ts` -- `save()`**: after successful save, call `relayService.notifyFileChanged(familyId)` (fire-and-forget, never blocks save)
4. **File polling remains as fallback**: if WebSocket is disconnected, 10s polling still runs. When WebSocket is connected, polling interval could optionally be extended to 30s or 60s as a safety net

### Graceful Degradation

- If relay env vars are not set → no WebSocket, polling-only (current behavior)
- If WebSocket disconnects → auto-reconnect + polling continues
- If notify POST fails → logged and ignored (save still succeeds)
- Relay is purely additive -- removing it changes nothing about data integrity

## Files Affected

### New files (5)

| File                                        | Purpose                                                |
| ------------------------------------------- | ------------------------------------------------------ |
| `src/services/relay/relayService.ts`        | WebSocket client + notify HTTP calls                   |
| `infrastructure/modules/relay/main.tf`      | API Gateway WebSocket, Lambda, DynamoDB, custom domain |
| `infrastructure/modules/relay/variables.tf` | Module variables                                       |
| `infrastructure/modules/relay/outputs.tf`   | Module outputs (WebSocket URL, API endpoint)           |
| `infrastructure/lambda/relay/index.mjs`     | Lambda handler ($connect, $disconnect, notify)         |

### Modified files (4)

| File                               | Change                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `src/stores/syncStore.ts`          | Connect/disconnect relay in `setupAutoSync()` and `resetState()`          |
| `src/services/sync/syncService.ts` | Fire-and-forget `notifyFileChanged()` after successful save in `doSave()` |
| `infrastructure/main.tf`           | Add `module "relay"` block                                                |
| `infrastructure/variables.tf`      | Add `relay_api_key` variable (can reuse registry key)                     |

### Environment variables (2 new)

| Variable             | Value                          |
| -------------------- | ------------------------------ |
| `VITE_RELAY_WS_URL`  | `wss://relay.beanies.family`   |
| `VITE_RELAY_API_URL` | `https://relay.beanies.family` |

## Cost Estimate

- API Gateway WebSocket: $1/million messages, $0.25/million connection-minutes
- Lambda: free tier covers millions of invocations
- DynamoDB: PAY_PER_REQUEST, pennies for connection tracking
- **Estimated cost: < $0.05/month** for a family of 4-5 with moderate usage

## Verification

1. **Unit test**: mock WebSocket in `relayService.ts`, verify connect/disconnect/reconnect logic
2. **Infrastructure**: `terraform plan` to verify resources are correct before apply
3. **Integration test**:
   - Open app on two devices/tabs
   - Create a todo on Device A
   - Verify it appears on Device B within 1-2 seconds (vs 10s before)
4. **Fallback test**: disconnect WebSocket, verify 10s polling still works
5. **Security test**: attempt to connect without API key, verify rejection
