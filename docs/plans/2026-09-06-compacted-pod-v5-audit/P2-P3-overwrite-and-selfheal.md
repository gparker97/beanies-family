# P2/P3 audit: the stale-device overwrite, and the self-heal

> Date: 2026-09-06
> Deployed build audited: `c3a6be98` (0.16). Current build: working tree at `72d02eb4` + uncommitted changes.
> Status: INCOMPLETE — skeleton written, tracing in progress. Every claim below is labelled VERIFIED (read in the named build at the named line) or INFERRED.

## Verdicts

_(pending)_

## Findings, most severe first

_(pending)_

## Traced sequences

### P2 — deployed build `c3a6be98`: the overwrite

VERIFIED so far:

- `src/services/sync/syncService.ts:1268-1272` (deployed): `doSave` wraps `await fetchAndMergeRemote()` in `try { } catch (e) { console.warn(...) }` and continues to the write. Comment on 1267: "Non-fatal — if merge fails, we still save local state".
- `syncService.ts:1285-1286` (deployed): `const { payload } = await docClient.exportEncryptedPayload(); const fileContent = reEncryptEnvelope(currentEnvelope, payload);`
- `syncService.ts:1309` (deployed): `const ack = await providerAtWrite.write(fileContent);`
- `src/services/sync/fileSync.ts:209-216` (deployed): `reEncryptEnvelope` is `{ ...envelope, encryptedPayload, writerVersion: APP_VERSION }` — it spreads `currentEnvelope`, so `version` is whatever `currentEnvelope.version` is ('4.0'), and `wrappedKeys` / `inviteKeys` / `passkeyWrappedKeys` / `keyId` are the deployed device's LAST-KNOWN copies.
- `fileSync.ts:73-74` (deployed): `parseBeanpodV4` throws `Unsupported beanpod version: 5.0. Expected 4.0.` before any decrypt.
- `syncService.ts:1192` (deployed): `fetchAndMergeRemote` calls `parseBeanpodV4(text)` BEFORE `learnRemoteMarker` (1196) and BEFORE `setEnvelope(preserveLocalKeyDicts(...))` (1211). So on a v5 file the deployed device learns NOTHING from the remote: not the marker, not the key dicts, not the document.

### P3 — current build: the self-heal

_(pending)_

## Checked and found SAFE

_(pending)_

## What is actually lost, and what is not

_(pending)_
