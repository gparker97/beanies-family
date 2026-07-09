# Plan: Capture last-login date and beanpod file size in the family registry

> Date: 2026-07-09
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-09-registry-last-login-and-beanpod-size.md`

## User Story

As the maintainer, I want to see each family's last-login date and approximate beanpod size in the registry, so that I can gauge active usage, engagement, and data growth without reading anyone's content or adding new tracking surfaces.

## Context

The family registry is a single DynamoDB table (`beanies-family-registry-{prod,dev}`, keyed on `familyId`) that maps a family to where its `.beanpod` file lives, plus a little ops metadata. It is written by exactly one Lambda (`infrastructure/lambda/registry/index.mjs`) via an HTTP API, and it is the **recovery anchor** for the resume-from-registry path (a returning user on a fresh device looks up their `fileId` here to find their Drive pod).

Today the only time-signal on a row is `updatedAt`, which is stamped on **every** PUT — and PUTs fire on family create, login/resume (`ensureRegistered`), Drive connect, country changes, and other sync-config writes. So `updatedAt` conflates "last login" with "last config touch" and can't answer "when did this family last actually use the app." There is also **no size signal at all**, so there's no sense of how much data a family holds or whether usage is growing.

We want two lightweight, privacy-respecting usage signals added to the registry row:

1. **`lastLoginAt`** — a DATE (YYYY-MM-DD), server-stamped, that moves **only** on a login-signalled PUT — a clean activity/retention signal (DAU/MAU/cohorts).
2. **`beanpodSizeKb`** — the family's `.beanpod` size rounded to KB — a coarse data-volume signal.

Both are metadata, never content: the size is the length of an **encrypted** blob, and the login value is a date. But because the registry already holds `ownerEmail` + `familyName`, adding these turns the row into a per-identifiable **usage record** — so the store-submission Data Safety declaration must be updated to match (this is part of the deliverable, not a follow-up).

TTL / auto-expiry is **deliberately excluded** — see Important Notes.

## Requirements

1. Add two attributes to the registry item, written by the Lambda's explicit item assembly (the Lambda whitelists fields at lines 93–112 — unknown body fields are dropped — so both must be added there):
   - **`lastLoginAt`**: `YYYY-MM-DD` string (date only), **server-stamped by the Lambda** (derived from the existing `now` at line 80: `now.slice(0, 10)`) on a PUT that carries the login signal. Never derived from a client-supplied value (no clock-skew, no client trust).
   - **`beanpodSizeKb`**: non-negative integer KB. The value is supplied by the client (rounded to KB there) and stored as given, with preserve-on-omit semantics.
2. Add a login signal to the PUT contract: the client sends an explicit `isLoginEvent` boolean; it is `true` **only** on the registry write that represents a genuine login/resume (the `LoginPage.handleSignedIn` entry point and the pod-create path) and `false` on every other write. The Lambda stamps `lastLoginAt = today` **iff** `body.isLoginEvent === true`; otherwise it preserves the existing `lastLoginAt`. `isLoginEvent` is a transient signal, never itself persisted. (See the maintainability note in Important Notes on why the client sends an explicit `false` rather than relying on an omitted/`undefined` field.)
3. Source the size from the client's **last persisted-or-loaded** `.beanpod`, rounded to KB at the client. Reuse the byte length of the exact envelope string that `syncService` already writes to (and reads from) the provider — do not recompute or re-serialize, and do NOT issue a worker round-trip at registration time (ADR-032: the doc + encrypted payload live in the Web Worker, so a fresh size would cost an async `exportEncryptedPayload` + envelope reassembly). Cache the byte length in a single module-scoped value **inside `syncService`** — its natural owner, which already funnels every write and read through one place — and read it via a getter in the registration payload builder.
4. Extend the `RegistryEntry` TypeScript type (`src/types/models.ts`) with `lastLoginAt?: ISODateString | null` and `beanpodSizeKb?: number | null`. Add the transient `isLoginEvent?: boolean` to the **write** payload type only in `registryService.ts` (a `RegistryWritePayload` alias), not to the stored entity.
5. Thread the new fields through the three client registration payloads:
   - `registerCurrentFamily` (`syncStore.ts:2755`) — background/config writes and the Drive-connect write (called from `installProvider`, `syncStore.ts:470`): send `beanpodSizeKb` and `isLoginEvent: false`.
   - `_registerCurrentFamilySync` (`syncStore.ts:1065`) — pod-create critical write: send `beanpodSizeKb` and `isLoginEvent: true` (create = first login; see Assumptions).
   - The login/resume signal is carried by an **explicit parameter**, not by `ensureRegistered` itself — see the critical correction in Important Notes.
6. Preserve-on-omit merge for `beanpodSizeKb` in the Lambda, mirroring the existing `country` / `subscribeNewsletter` pattern exactly (inline, for consistency with the surrounding block — see Important Notes on why we do NOT extract a merge helper), with a defensive number guard: `typeof body.beanpodSizeKb === 'number' && body.beanpodSizeKb >= 0 ? Math.round(body.beanpodSizeKb) : (existing.beanpodSizeKb ?? null)`. For `lastLoginAt`: `body.isLoginEvent === true ? today : (existing.lastLoginAt ?? null)`.
7. Keep the ops maintenance script (`scripts/migrate-registry-dev-rows.mjs`) consistent — verified: it round-trips full rows via `marshall(unmarshall(...), { removeUndefinedValues: true })` (line 197) with **no field allowlist**, so the new attributes are preserved automatically. No code change; note only.
8. Update the **Data Safety** section of `docs/runbooks/native-store-submission.md` (the canonical data-collection table at line 29 that generates the store forms and `privacy.astro`) to declare the newly-collected "app activity / product interaction" data (last-login date + approximate data size, both tied to an identifiable family row).

## Important Notes & Caveats

- **CRITICAL correction vs. the prior draft — the login signal must NOT be baked into `ensureRegistered`.** Verified in code: `ensureRegistered()` (`syncStore.ts:2779`) is called by **two** sites — the genuine login/resume point (`LoginPage.vue:612`) **and** the country watcher (`syncStore.ts:2792`, `watch(() => country) → ensureRegistered()`). If `ensureRegistered` unconditionally set `isLoginEvent: true`, every country change would re-stamp `lastLoginAt`, turning it straight back into `updatedAt` — the exact failure this feature exists to prevent. Fix: make the login flag an explicit parameter. `ensureRegistered(isLogin = false)` forwards to `registerCurrentFamily(overrides, { isLoginEvent: isLogin })`. `LoginPage.handleSignedIn` calls `ensureRegistered(true)`; the country watcher keeps calling `ensureRegistered()` (→ `false`); `installProvider`'s `registerCurrentFamily({...})` stays login-false by default.
- **Send an explicit `isLoginEvent` boolean; do not rely on omit/`undefined`-dropping (maintainability).** Always send a real boolean (`isLoginEvent: opts.isLoginEvent === true`). Server behavior is identical (`body.isLoginEvent === true` is the only branch that stamps; `false` preserves), the flag stays transient (never assigned into `item`), and the two-state contract is self-documenting to the next reader. No clever ternary, no dependence on `JSON.stringify` dropping `undefined`.
- **Single owner for the byte size, with ONE domain mutator — not a raw getter/setter pair (maintainability).** `syncService` owns the cached size. Expose a single domain function `recordPersistedBytes(envelope: string)` that does the `TextEncoder` encode in one place, plus a read-only `getLastPersistedBytes()`. `doSave` and `load` call it internally; `createNewFile`'s direct-write path calls the same function. One code path can mutate the cache, encoding logic is DRY, and the mutation is self-describing ("record what we just persisted") instead of a raw number assignment. `reset()` clears the cache.
- **TTL is intentionally OUT OF SCOPE and must NOT be added.** The registry row is the recovery anchor for resume-from-registry: auto-expiring an inactive family's row would leave a returning user on a new device unable to locate their Drive file — a data-loss/lockout risk. `lastLoginAt` is being added _only_ as a usage signal, not as an expiry driver.
- **Server-stamp the date; never trust the client clock.** `lastLoginAt` is computed from the Lambda's existing `now` when `isLoginEvent` is true. The client never sends a date.
- **`isLoginEvent` is a transient request flag, not a stored attribute.** It is read from `body`, consumed to decide whether to stamp, and never assigned into `item` — so it can never reach `marshall`.
- **Keep the Lambda merge inline; do NOT extract a `preserve()` helper (maintainability judgment).** The two new fields are two more lines in the existing preserve-on-omit block that already handles `subscribeNewsletter` and `country` the same way. Introducing a novel merge-helper abstraction for a small object would diverge from the established, easy-to-scan style in a security-sensitive Lambda and buy nothing. Consistency with the surrounding code is the more sustainable choice than premature DRY here.
- **Size is a coarse KB integer of an encrypted blob.** It reveals rough data volume, never content. Round at the client (`Math.round(bytes / 1024)`); a brand-new pod is always well over 1 KB (base64 payload + envelope), so 0 KB is not a practical concern. When no size is known yet, **omit** the field entirely (preserve-on-omit) — never send `0`, which would be a silently-wrong metric.
- **Byte count must be honest.** Use the true UTF-8 byte length of the exact string written to the provider (`new TextEncoder().encode(envelopeJson).byteLength`), not `String.length` (UTF-16 code units, which mis-counts any multibyte `familyName`). This is the literal on-disk/Drive size; the payload (base64 ASCII) dominates, so the cost is negligible and the number is exact.
- **Preserve-on-omit is mandatory for both fields.** Older clients (cached PWA builds) and member devices that don't send the new fields must never null out an existing value. Follow the `country` precedent to the letter. (With `isLoginEvent` now always sent as an explicit boolean by current clients, the omit case still matters for older cached builds, which send no flag at all — `body.isLoginEvent === true` is false → preserve. Correct either way.)
- **Registry is fire-and-forget for non-critical writes** (`registerFamily` swallows + `console.warn`s failures; `registerFamilyOrThrow` throws only for the pod-create anchor). The new fields must not change these failure semantics — a missing/failed size or login write is a lost _metric_, never a user-facing error. The existing `.catch` at `registerCurrentFamily` (`syncStore.ts:2772`) already logs, so nothing fails silently.
- **Backward compatibility:** existing rows without the new attributes must keep working across GET/PUT/DELETE. `unmarshall` of a row lacking the fields yields `undefined`, preserved as `null` on next write — no migration needed.
- **No new endpoint, no new request.** Both fields ride existing registry PUTs. Do not add a route or a dedicated "touch" call.

## Assumptions

> **Review these before implementation.** Valid at planning time; confirm if time has passed.

1. **The encrypted `.beanpod` byte length is already materialized on the client at every persist and load point — verified.** In `syncService.doSave` (`syncService.ts:821–825`), `fileContent = reEncryptEnvelope(currentEnvelope, payload)` is the exact string handed to `currentProvider.write(...)`. In `syncService.load` (`syncService.ts:897`), `text = await currentProvider.read()` is the raw file just read. In `createNewFile` (`syncStore.ts:1270–1282`), `envelopeJson = createBeanpodV4(...)` is written via `provider.write(...)`. All three are plain strings whose UTF-8 byte length is the file size — no extra serialization, no worker round-trip. Capturing on **both save and load** (and create) means the size is available synchronously at `ensureRegistered` time even on resume-from-registry (the load populated it before login registration fires).
2. **Pod creation counts as a login event.** `_registerCurrentFamilySync` runs once at create; stamping `lastLoginAt` there is correct (create is the family's first "login"). If the product later prefers "login" to mean _returning_ sessions only, drop `isLoginEvent: true` from the create path.
3. **`LoginPage.handleSignedIn` (`LoginPage.vue:605–613`) is the single canonical login/resume entry point** — the comment there confirms it was deliberately de-duplicated from `SetupProgressModal`. Passing `true` into `ensureRegistered` there covers create, load, join, and reconnect without double-writing, while the country watcher (the other `ensureRegistered` caller) stays login-false.
4. **The `features.registry` gate and prod/dev Origin routing are unchanged.** Both tables gain the fields identically; the table is schemaless past its `familyId` key — no Terraform/GSI change.
5. **Lambda deploy mechanism is the existing one.** Shipping the two fields requires deploying the updated Lambda; no API-contract break for old clients (additive body field + additive stored attributes).

## Approach

Four coordinated edits — Lambda (server-stamp + preserve-merge), `syncService` (single cached byte-size + one `recordPersistedBytes` mutator + getter), `syncStore`/type/`registryService` (KB converter + explicit login param threaded through the payloads), and docs (Data Safety) — plus a no-op consistency note on the ops script.

### 1. Lambda — `infrastructure/lambda/registry/index.mjs` (PUT handler)

In the `item` assembly (lines 93–112), add two fields alongside the existing preserve-on-omit block (kept inline, matching the `country` / `subscribeNewsletter` lines already there):

```js
const today = now.slice(0, 10); // YYYY-MM-DD from the existing ISO `now` (line 80)
// ...inside `item`:
lastLoginAt:
  body.isLoginEvent === true ? today : (existing.lastLoginAt ?? null),
beanpodSizeKb:
  typeof body.beanpodSizeKb === 'number' && body.beanpodSizeKb >= 0
    ? Math.round(body.beanpodSizeKb)
    : (existing.beanpodSizeKb ?? null),
```

- `today` is derived from the existing `now` — one clock read, no drift between `updatedAt` and `lastLoginAt`.
- `isLoginEvent` is read from `body` and never written to `item` (transient).
- The number-guard (`typeof === 'number' && >= 0`, `Math.round`) ignores a malformed/negative client value without failing the write — a bad size preserves the existing value, never 500s. Mirrors the defensive posture of the `country`/`subscribeNewsletter` guards.
- Deliberately NOT extracted into a shared `preserve()` helper — see Important Notes; two inline lines matching the existing style are more maintainable in this small, security-sensitive handler than a new abstraction.
- No change to GET/DELETE. `marshall(..., { removeUndefinedValues: true })` (line 116) already tolerates the additive fields.

### 2. Client type — `src/types/models.ts` (`RegistryEntry`, lines 1489–1500) + `registryService.ts`

```ts
// models.ts — stored entity gains two nullable fields:
country?: CountryCode | null;
lastLoginAt?: ISODateString | null;  // date-only (YYYY-MM-DD), server-stamped on login PUTs
beanpodSizeKb?: number | null;       // approx .beanpod size in KB, client-rounded
updatedAt: ISODateString;
```

The transient login flag lives on the **write** payload type only. In `registryService.ts`, introduce:

```ts
export type RegistryWritePayload = Omit<RegistryEntry, 'familyId' | 'updatedAt'> & {
  isLoginEvent?: boolean;
};
```

and widen the `entry` parameter of both `registerFamily` (line 49) and `registerFamilyOrThrow` (line 72) from `Omit<RegistryEntry, 'familyId' | 'updatedAt'>` to `RegistryWritePayload`. The service still serializes the body as-is (`JSON.stringify(entry)` in `request`) — no logic change, the stored type stays clean.

### 3. Client size source — `src/services/sync/syncService.ts` (single owner, one mutator)

`syncService` is the sole module that both writes and reads the `.beanpod`, so it owns the cached size — no new `syncStore` ref, no assignments scattered across modules, and no raw number setter.

- Add one module-scoped `let lastPersistedBytes: number | null = null;` beside the other module state.
- Add exactly **one** mutator (the sole write path) plus a read-only getter, next to the existing getters (~`getState`, line 312):
  ```ts
  export function recordPersistedBytes(envelope: string): void {
    lastPersistedBytes = new TextEncoder().encode(envelope).byteLength;
  }
  export function getLastPersistedBytes(): number | null {
    return lastPersistedBytes;
  }
  ```
  The `TextEncoder` encode lives in exactly one place (DRY), and every caller passes the same input type (the envelope string), so no call site can record an inconsistent unit.
- Call `recordPersistedBytes(...)` at exactly the points where the envelope string is already in hand:
  - `doSave`, immediately after `await currentProvider.write(fileContent)` (line 825): `recordPersistedBytes(fileContent);`
  - `load`, on the success path once `text` is known non-empty (~line 913, after the `if (!text)` guard): `recordPersistedBytes(text);`
  - `createNewFile` in `syncStore` (`syncStore.ts:1282`) bypasses `doSave`, so after its `await provider.write(envelopeJson)` call the **same** function: `syncService.recordPersistedBytes(envelopeJson);` — one domain operation, no separate raw setter. Verified ordering: this runs immediately after the create write (line ~1283) and before `_registerCurrentFamilySync` (`syncStore.ts:1314`), so the create-path registration already carries a real `beanpodSizeKb`, not a preserved/omitted null.
- `reset()` (line 448) sets `lastPersistedBytes = null` to keep it consistent with the rest of the module lifecycle.

`TextEncoder().encode(...)` cannot throw on a string, so no try/catch is warranted; wrapping it would be defensive bloat.

### 4. Client registration payloads — `src/stores/syncStore.ts`

- **One converter** (DRY), defined once in the store:
  ```ts
  function currentBeanpodSizeKb(): number | null {
    const bytes = syncService.getLastPersistedBytes();
    return bytes == null ? null : Math.round(bytes / 1024);
  }
  ```
- `registerCurrentFamily(overrides, opts: { isLoginEvent?: boolean } = {})` (line 2755): add `beanpodSizeKb: currentBeanpodSizeKb()` and `isLoginEvent: opts.isLoginEvent === true` (an explicit boolean — no undefined-dropping) to the payload. `installProvider`'s call (line 470) passes no `opts` → `false`.
- `_registerCurrentFamilySync` (line 1065): add `beanpodSizeKb: currentBeanpodSizeKb()` and `isLoginEvent: true` (create = first login).
- `ensureRegistered(isLogin = false)` (line 2779): `registerCurrentFamily({}, { isLoginEvent: isLogin })`. The country watcher (line 2792) keeps calling `ensureRegistered()` → login-false.
- `LoginPage.vue:612`: change `syncStore.ensureRegistered()` → `syncStore.ensureRegistered(true)` (the sole genuine login/resume site).
- **Optional, low-priority (drift-prevention, do NOT expand scope for it):** `registerCurrentFamily` and `_registerCurrentFamilySync` already hand-maintain two near-identical payload objects (same provider/fileId/displayPath/familyName/ownerEmail/subscribeNewsletter/country shape). This plan adds the same two fields to both, so the duplication grows. If a _third_ shared field is ever added, extract a single `buildRegistryWritePayload(ctx, { isLoginEvent })` helper both call, to stop the two copies drifting. Not required for this change — flagged so the next editor consolidates instead of adding a third copy.

### 5. Ops script — `scripts/migrate-registry-dev-rows.mjs`

No change. Verified: the copy path re-marshals the full unmarshalled item (`Item: marshall(it, { removeUndefinedValues: true })`, line 197) with no field allowlist, so `lastLoginAt` / `beanpodSizeKb` round-trip intact. Add a one-line code comment only if it aids future readers; otherwise leave as-is.

### 6. Docs — `docs/runbooks/native-store-submission.md`

Update the canonical data-collection table (line 29) + Data Safety notes: add "App activity — last-login date (`lastLoginAt`)" and "App info & performance — approximate data size in KB (`beanpodSizeKb`)" as collected, tied to the family row (identifiable via `ownerEmail`), not shared with third parties, not used for tracking/ads. Note the privacy rationale (coarse KB of an encrypted blob; date-only, server-stamped) and that TTL is intentionally absent (recovery-anchor).

## Files Affected

- `infrastructure/lambda/registry/index.mjs` — PUT item assembly: server-stamp `lastLoginAt` on `isLoginEvent`, preserve-on-omit `beanpodSizeKb` (+ number guard), inline to match existing style. **Requires Lambda redeploy.**
- `src/types/models.ts` — extend `RegistryEntry` with `lastLoginAt` + `beanpodSizeKb`.
- `src/services/registry/registryService.ts` — add `RegistryWritePayload` (transient `isLoginEvent`); widen both register fns' param type. No logic change.
- `src/services/sync/syncService.ts` — `lastPersistedBytes` module var + single `recordPersistedBytes(envelope)` mutator + `getLastPersistedBytes()` getter, called at the `doSave` write and `load` read, cleared in `reset()`.
- `src/stores/syncStore.ts` — `currentBeanpodSizeKb()` converter; `isLoginEvent` param threaded through `registerCurrentFamily` / `ensureRegistered` (explicit boolean); `beanpodSizeKb` on all three payloads; `isLoginEvent: true` on create + (via param) login; `recordPersistedBytes` call for the `createNewFile` write.
- `src/pages/LoginPage.vue` — `ensureRegistered()` → `ensureRegistered(true)` (single canonical login site).
- `scripts/migrate-registry-dev-rows.mjs` — no change (verified round-trip preserves new fields); optional clarifying comment.
- `docs/runbooks/native-store-submission.md` — Data Safety declaration + data-collection table.
- Tests: Lambda PUT handler (login-stamp vs preserve; size guard/preserve); syncStore registration payload shape (size everywhere; `isLoginEvent: true` only on login/create, `false` on country-watcher and Drive-connect writes); `currentBeanpodSizeKb` rounding + null; `syncService` byte capture via `recordPersistedBytes` on save + load.

## Acceptance Criteria

- [ ] A login/resume PUT (from `LoginPage.handleSignedIn` → `ensureRegistered(true)`) sets `lastLoginAt` to the server's current date; a subsequent country-change or Drive-connect PUT leaves `lastLoginAt` unchanged.
- [ ] The country watcher (`ensureRegistered()` with no arg) sends `isLoginEvent: false` and never moves `lastLoginAt`.
- [ ] `lastLoginAt` is a date-only string (`YYYY-MM-DD`), computed server-side, never from client input.
- [ ] `beanpodSizeKb` reflects the client's last persisted-or-loaded `.beanpod` size rounded to KB, refreshed on registry PUTs; when no size is known the field is omitted (never sent as `0`).
- [ ] A PUT omitting `beanpodSizeKb` preserves the existing stored value (no clobber); same for `lastLoginAt` when `isLoginEvent` is `false`/absent.
- [ ] A malformed/negative `beanpodSizeKb` is ignored (existing value preserved), and never fails the write.
- [ ] `isLoginEvent` never appears as a stored attribute on the row.
- [ ] Existing rows lacking the new fields continue to work across GET/PUT/DELETE; no migration required.
- [ ] Both prod and dev tables gain the fields identically (Origin-routed, same Lambda).
- [ ] Registry write failures remain non-fatal for non-critical paths (metric lost, logged via existing `console.warn`, no user-facing error).
- [ ] `syncService` exposes a single `recordPersistedBytes` mutator (no raw number setter); the byte size has exactly one write path.
- [ ] `docs/runbooks/native-store-submission.md` Data Safety section + data-collection table updated to declare the two new data points.
- [ ] `npm run validate` (type-check + lint + tests) green; new tests cover login-stamp/preserve, size guard/preserve, and the country-watcher no-stamp case.

## Testing Plan

1. **Lambda unit tests** (handler-level): (a) PUT with `isLoginEvent: true` → item has today's `lastLoginAt`; (b) PUT with `isLoginEvent: false` (or omitted) → `lastLoginAt` preserved from existing; (c) PUT with numeric `beanpodSizeKb` → stored rounded; (d) PUT omitting it → preserved; (e) negative/NaN → preserved, 200; (f) `isLoginEvent` not present in the marshalled item.
2. **Client payload tests**: `ensureRegistered(true)` and the create path include `isLoginEvent: true` + `beanpodSizeKb`; `ensureRegistered()` (country watcher) and `installProvider`'s Drive-connect write include size and carry `isLoginEvent: false`.
3. **Converter + capture tests**: `currentBeanpodSizeKb()` returns `null` when `getLastPersistedBytes()` is null, else rounds bytes→KB; `recordPersistedBytes(str)` sets `lastPersistedBytes` to the UTF-8 byte length; `syncService` records it after a successful `doSave` write and after a successful `load`, and clears it on `reset()`.
4. **Manual/integration (dev table)**: log in on localhost → GET the dev row, confirm `lastLoginAt` = today + `beanpodSizeKb` ~ file size; change country → GET again, confirm `lastLoginAt` unchanged, `updatedAt` moved.
5. **Backward-compat**: GET a pre-existing row (no new fields) → 200, fields `undefined`; PUT without new fields → row still valid.
6. **Regression**: `scripts/migrate-registry-dev-rows.mjs --copy` dry-run still round-trips rows with the new attributes present.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full plan — Lambda server-stamp + preserve-merge for `lastLoginAt`/`beanpodSizeKb`, transient `isLoginEvent` login signal on login/create client sites only, `lastBeanpodBytes` ref + KB converter in syncStore, ops-script consistency check, and the Data Safety doc update. TTL explicitly excluded (recovery-anchor).
- **Pass 2 (DRY + error handling)**: Verified reuse against the code and made three corrections — (1) **correctness bug fixed**: `ensureRegistered` is shared with the country watcher, so the login flag is now an explicit param (`ensureRegistered(isLogin)`), stamped only from `LoginPage` + create, never on country/Drive writes; (2) **DRY-er size source**: dropped the new `syncStore` ref in favor of a single cached `lastPersistedBytes` in `syncService` (the sole write/read owner), captured on both `doSave` and `load` — per ADR-032 the doc lives in the worker, so this makes the exact byte size available synchronously at registration time with no worker round-trip; (3) honest byte count via `TextEncoder().byteLength`, omit-not-zero when unknown, and confirmed the ops script needs no change (full-row round-trip, no allowlist).
- **Pass 3 (Sustainability)**: Tightened three maintainability edges without expanding scope — (1) replaced the getter + raw `setLastPersistedBytes(number)` pair with a single `recordPersistedBytes(envelope)` domain mutator so the `TextEncoder` encode lives in one place and the cache has exactly one write path (no external raw-number poke); (2) client now sends an explicit `isLoginEvent` boolean instead of `=== true ? true : undefined`, removing reliance on `JSON.stringify` dropping `undefined` and making the two-state contract self-documenting; (3) recorded the deliberate decisions to keep the Lambda merge inline (consistency over a premature `preserve()` helper) and flagged the pre-existing two-copy register-payload duplication as a low-priority consolidation for the next editor rather than a change to make now.
- **Pass 4 (Fresh-eyes sweep)**: Re-verified every line-number and code claim against the live source — Lambda PUT item block (index.mjs:93–112, existing `country`/`subscribeNewsletter` preserve pattern confirmed), `registryService` param types (49/72), `registerCurrentFamily`/`_registerCurrentFamilySync` payloads (2755/1065), the shared `ensureRegistered`↔country-watcher hazard (2779/2792), `LoginPage.handleSignedIn` (612), and `syncService.doSave`/`load` capture points. No defects found; all claims hold. One strengthening added: confirmed `recordPersistedBytes(envelopeJson)` runs before `_registerCurrentFamilySync` (syncStore.ts:1314), so the create-path registration carries a real size rather than a null-omit. Plan is ship-ready.

## Prompt Log

> No GitHub issue created — this plan was approved for direct implementation. Full prompt history embedded below.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (data inventory)

> On the our dynamodb table, can you let me know what fields we have on there now and what data we are capturing? i.e. family name, email, etc

### Follow-up — the feature request

> i would like to also capture:
>
> - latest login (which i assume may be different from updatedAt since the table may not be updated at every login)
> - size of beanpod file (i.e. 34kB)
>
> i would like to capture these just to get a general sense of how much the app is being used whle still keeping user privacy. is this feasible and what are your thoughts?

### Follow-up — pre-plan invocation + TTL decision

> Based on the above info prepare a plan and prompt for beanies-plan. Let's not implement a TTL now as this concerns me - what if a user doesn't login for a while and forgets their info, then tries to login after the TTL expires from a new device and we cannot locate their file?

### Pre-plan clarifications (via AskUserQuestion)

> Size precision: **Rounded to KB**
> Login precision: **Date only**
> Priority: **Medium**

### beanies-plan hand-off

> yes, proceed to /beanies-plan

</details>
