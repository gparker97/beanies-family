# Investigation: native app lost its data-file connection (unconfigured Settings, stranded owner)

> Date: 2026-07-15
> Surface: native (Capacitor Android WebView) — but the root defect is platform-agnostic
> Status: read-only code-path investigation. No code changed.
> Related: ADR-026 (iOS redirect OAuth), ADR-029 (native), ADR-032 (doc worker), `docs/STATUS.md` (session 3 native biometric)

## TL;DR

On an established owner's native install the app showed the **unconfigured** "Family data options"
state (`save your data to a file / resume setup` + `load existing family data file`) even though the
user is the pod owner. The split state is:

- `authStore.podCreated === true` and `needsPodSetup === false` (established owner) — restored from
  `localStorage` (`beanies_pod_created`, `beanies_auth_session`).
- `syncStore.isConfigured === false` — because `syncService.initialize()` could not restore a
  storage-provider config **this session**.

The `.beanpod` on Google Drive was never moved. **The provider-config record in IndexedDB
(`beanies-file-handles` → `providerConfig-<familyId>`) was absent or unreadable at boot**, and
`syncService.initialize()` has **no fallback** to the durable family registry (local or remote) that
already holds the same `fileId`. It drops straight to `isConfigured = false`. The router then strands
the user, because the one screen that runs the existing registry-based recovery
(`ResumePodSetup` → `attemptResumeFromRegistry`) is gated on `needsPodSetup === true`, which is false
for a `podCreated` owner.

The expired Google token / doc-worker timeouts / `app.postInitNoData` overlay in the same incident are
**concurrent symptoms, not the cause** of the unconfigured state (see §1, H4): an expired token keeps
`isConfigured === true` and shows the _configured_ card + reconnect banner. The card showed
_unconfigured_, so the provider-config restore itself returned nothing.

---

## 1. How `isConfigured` / provider config can end up FALSE on an established native install

### The restore path (single entry point)

`syncService.initialize()` (`src/services/sync/syncService.ts:539-644`) is the only cold-boot
provider-config restore. Sequence:

1. `getActiveFamilyId()` fast-path skip (`:541-549`) — if a valid in-memory session already exists for
   this family, return early. Cold boot: `currentFamilyId`/`currentProvider` are null, so this is
   skipped.
2. `reset()` (`:551`) — clears all in-memory provider state (`syncService.ts:513-534`).
3. **No-active-family guard** (`:553-561`): if `getActiveFamilyId()` is null → `updateState({ isConfigured:false })`, return `false`. Log: `[syncService] No active family — skipping sync initialization` (`:554`).
4. **Provider-config restore** (`:564-609`):
   - `const config = await getProviderConfig(familyId)` (`:567`).
   - Diagnostic: `[syncService] Provider config for <familyId>: <type|none>` (`:568`) — **this single log line
     confirms or refutes the whole hypothesis**.
   - Drive branch (`:569-590`): if `config.type === 'google_drive'` + `driveFileId` + `driveFileName`,
     build `GoogleDriveProvider.fromExisting(...)`, set `isConfigured:true`, return `true`.
   - Native local branch (`:594-605`): if `config.type === 'local'` + `localPath` + `isNative()`, build
     `CapacitorFileProvider.fromPath(...)`, `isConfigured:true`, return `true`.
   - `catch` (`:606-608`): swallow, `console.warn('Failed to restore provider config:', e)` — falls through.
5. Web FSA handle restore (`:611-636`) — `supportsFileSystemAccess()` is **false in a WebView**, so this
   is skipped on native.
6. **Terminal unconfigured** (`:638-643`): `updateState({ isInitialized:true, isConfigured:false })`, return `false`.

So on native, `isConfigured` becomes false **iff** step 3 sees no active family **or** step 4 sees no
usable `providerConfig-<familyId>` record (null, wrong shape, or a thrown read).

### Where the config lives, and why it has no redundancy

`getProviderConfig` (`src/services/sync/fileHandleStore.ts:160-171`) reads IndexedDB DB
`beanies-file-handles` (`:6`), store `handles` (`:8`), key `providerConfig-<familyId>` (`:163`). Written by:

- `GoogleDriveProvider.persist()` → `storeProviderConfig` (`googleDriveProvider.ts:301-309`, `fileHandleStore.ts:145-155`).
- `CapacitorFileProvider.persist()` (`capacitorFileProvider.ts:115-117`).
- `decryptPendingFile` also writes it directly (`syncStore.ts:1491-1502`).

**Key asymmetry (root of the fragility):** the Google _refresh token_ is dual-written to IndexedDB **and
`localStorage`** precisely because "on PWA/mobile, IndexedDB can be evicted under storage pressure or iOS
Safari's 7-day eviction" (`fileHandleStore.ts:181-196`, `230-250`). The **provider config has NO such
fallback** — it lives only in `beanies-file-handles`. If that DB is evicted, cleared, or a read throws,
the config is simply gone, and `initialize()` has nothing else to consult.

Cleared explicitly only by: `clearProviderConfig` (`fileHandleStore.ts:176-179`) via
`deleteLocalFamily` (`familyContext.ts:182`), `provider.clearPersisted` (on `disconnect`
`syncService.ts:1288`), and the opposite-type clear inside `LocalStorageProvider.persist`
(`localProvider.ts:216-218`) / `GoogleDriveProvider.persist` clears the _file handle_, not the config.

### `getActiveFamilyId()` is in-memory only — the init-ordering angle

`getActiveFamilyId()` returns a **module-level in-memory `currentFamilyId`** (`database.ts:20,33-35`),
set only by `setActiveFamily` (`:26-28`) via `activateFamily`/`createFamilyWithId`
(`familyContext.ts:26,47,87,93`), driven by `familyContextStore` (`familyContextStore.ts:24-43,91-108`).
It is **not** persisted; the _durable_ pointer is `globalSettings.lastActiveFamilyId` (IndexedDB),
resolved back into memory during `familyContextStore.initialize()`.

On the **normal boot** path this is set **before** the restore runs: `App.vue` onMounted does Step 3
"Resolve active family" (`App.vue:936-969`, `switchFamily(authFamilyId)` `:944`) **before** Step 5
`loadFamilyData()` (`:976-996`) which calls `syncStore.initialize()` (`App.vue:407`). So the
no-active-family guard (`syncService.ts:553`) normally does not fire. It _can_ fire if any path calls
`syncService.initialize()` before the family is activated (e.g. a native deep-link/resume re-entry, or a
future re-init), in which case restore is skipped entirely with the `:554` log.

### Ranked root-cause hypotheses

| #      | Hypothesis                                                                                                                                                                                                                                                                                                                                                                                                                     | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence / confirming log                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** | The `beanies-file-handles` IndexedDB record `providerConfig-<familyId>` was **evicted or cleared by the OS/WebView** (storage pressure, "clear cache", app-data reclamation), while `localStorage` (`beanies_auth_session` + `beanies_pod_created`) survived. `getProviderConfig` returns null → `initialize()` returns false → `isConfigured:false`. The registry still holds the Drive `fileId`, but init never consults it. | **PLAUSIBLE (most likely)** — the code path **provably** yields the exact observed split state (`podCreated:true`, `needsPodSetup:false`, `isConfigured:false`); the eviction itself is unproven without device logs. Note `localStorage` and IndexedDB have independent eviction characteristics (the app relies on exactly this for the refresh-token fallback, `fileHandleStore.ts:184-186`).                                                                                                                                    | `syncService.ts:568` prints `Provider config for <familyId>: none`. If whole-origin IDB went, also expect `authStore.initializeAuth` empty-registry+session branch (`authStore.ts:383-403`). |
| **H4** | The concurrent **Google token expiry** caused the unconfigured state.                                                                                                                                                                                                                                                                                                                                                          | **REFUTED (important)** — the Drive restore branch (`syncService.ts:569-590`) builds the provider and sets `isConfigured:true` **without checking the token**. An expired token keeps the card _configured_ and surfaces the reconnect banner / auth-masked-404 path (`syncStore.ts:632-654`). The card was _unconfigured_, so the config record was genuinely absent. Token expiry, doc-worker timeouts and `app.postInitNoData` are concurrent symptoms of the same idle-eviction episode, not the cause of `isConfigured:false`. | Absence of the configured card rules this out.                                                                                                                                               |
| **H2** | The config was **never persisted** for this family, or was cleared by a provider swap / a `storeProviderConfig` write that failed under storage pressure and was not re-attempted.                                                                                                                                                                                                                                             | **PLAUSIBLE (secondary)** — possible but less likely for a long-established owner who has been saving to Drive; `persist()` failures in `installProvider` propagate (`syncStore.ts:449-489`), so a silent never-write is unlikely at create time. Eviction (H1) better fits "worked for months, then broke after idle".                                                                                                                                                                                                             | Would also show `:568 … : none`; distinguish from H1 only via history.                                                                                                                       |
| **H3** | **Init-ordering race**: `syncService.initialize()` ran while `getActiveFamilyId()` was null (skip at `:553`), e.g. a native resume/deep-link re-entry before family activation.                                                                                                                                                                                                                                                | **PLAUSIBLE (secondary/contributing)** — App.vue's main path activates family first, so this needs an alternate entry point; ADR-029 native deep-link resume is the candidate.                                                                                                                                                                                                                                                                                                                                                      | `syncService.ts:554` `No active family — skipping sync initialization`.                                                                                                                      |
| **H5** | A stray `reset()`/`resetState()`/`disconnect()` left `isConfigured:false` with no re-init.                                                                                                                                                                                                                                                                                                                                     | **REFUTED as independent cause** — `loadFamilyData` always calls `initialize()` which `reset()`s then rebuilds from `getProviderConfig`; a transient reset self-heals **unless** `getProviderConfig` returns none. Collapses into H1/H2.                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                            |

**Bottom line (CONFIRMED architectural defect, independent of which of H1/H2/H3 fired):**
`syncService.initialize()` treats a missing IndexedDB `providerConfig` record as **"not configured"**
and gives up, even though (a) the durable **remote family registry** (`registryService.lookupFamily`,
`registryService.ts:34-46`) holds `provider:'google_drive'` + `fileId` + `displayPath`
(`models.ts:1516-1529`), and (b) the codebase already has the exact re-derivation primitive
(`attemptResumeFromRegistry`, `syncStore.ts:2629-2697`) — it is simply unreachable from this state
(§2). There is **no `navigator.storage.persist()` durability guarantee on native**: the call is a
web-API best-effort in `App.vue:756-770`, unavailable/unenforced in the Android WebView, and even on web
"a denial is the normal state" per the same comment.

---

## 2. The two confirmed UX bugs

### Bug A — "resume setup" is a dead button for `podCreated` owners (router bounce)

- Trigger: unconfigured Settings card → **Resume setup** → `handleResumeSetup` (`SettingsPage.vue:370-373`)
  `router.push({ path:'/welcome', query:{ resume:'setup' } })`.
- The **already-authenticated guard** (`router/index.ts:347-367`) runs for `/welcome`:
  - `membersStepActive` is false (`:357`) — not mid-create.
  - `authStore.needsPodSetup` is **false** for a `podCreated` owner (`authStore.ts:337`), so the
    `needsPodSetup` branch (`:358-364`) is skipped.
  - Falls through to `return { name: 'Nook' }` (`:366`) → the user is **silently bounced to /nook**.
- Net: the button does nothing useful. `ResumePodSetup` (which _would_ run `attemptResumeFromRegistry`)
  is never reached because it lives behind the `resume=setup` screen the guard refuses to show a
  `podCreated` user.

Fix locations: `router/index.ts:358-366`, `SettingsPage.vue:370-373`.

### Bug B — no "reconnect Google & reload my Drive file" affordance in the unconfigured card

- The unconfigured branch (`SettingsPage.vue:1198-1235`, gated `!syncStore.isConfigured` `:1198` and
  `syncStore.supportsAutoSync` `:1196`; `canAutoSync()` returns `true` unconditionally,
  `capabilities.ts:144-146`) offers exactly two actions:
  - **Resume setup** (`:1211`) — dead per Bug A.
  - **Load existing family data file** (`:1214` → `handleLoadFromFileClick` `:440-442` →
    `handleLoadFromFileConfirmed` `:444-459` → `loadFromNewFile`) — this opens a **local file picker**
    for a `.beanpod`, wrong for a **Drive-backed** pod whose file the user cannot browse to locally.
- The only **reconnect** control (`handleSettingsReconnect` `:306-311`) is rendered **only in the
  configured branch's error block** (`SettingsPage.vue:1443-1450`, gated on
  `syncStore.isGoogleDriveConnected`, which is false when `isConfigured` is false). So an established
  Drive owner in the unconfigured state has **no** in-app path to say "reconnect to Google and reload my
  Drive `.beanpod`".

Fix location: add a Drive-reconnect/reload affordance to `SettingsPage.vue:1210-1217`.

---

## 3. How the WEB/PWA path already self-heals (the pattern to mirror on native)

The web path never _drops_ a configured pod to unconfigured on a transient failure; it keeps
`isConfigured === true` (provider config still present) and runs **silent, deferred recovery**, only
surfacing UI on total failure. Mechanisms already in the codebase:

| Mechanism                                                                                                                                                                        | Location                                                                                                                                 | Runs on native?                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Cold-start reconnect escalation** — on boot-time auth-transient, defer ~4 s for wake events (focus/pageshow/online) before showing the banner; cancelled by `onTokenAcquired`. | `scheduleColdStartReconnectEscalation` `syncStore.ts:1831-1885` (gated `storageProviderType==='google_drive'`)                           | Yes (provider-agnostic), but only if a Drive provider is installed.                       |
| **Background sync after cache-first load** — non-blocking Drive fetch + CRDT merge; on auth-transient defers to reconnect; always starts polling in `finally`.                   | `backgroundSyncFromFile` `syncStore.ts:1892-1955`; started from `App.vue:449` (path1a).                                                  | Yes.                                                                                      |
| **Token self-heal** — `onTokenAcquired` clears the reconnect banner / kicks a `saveNow`; `onTokenPermanentlyExpired` shows the banner only on `invalid_grant`.                   | `setupTokenExpiryHandler` `syncStore.ts:2917-2962`.                                                                                      | Yes.                                                                                      |
| **Silent token recovery** from the beanpod-mirrored refresh token before any redirect.                                                                                           | `tryReconnectSilently` via `beginDriveAuthRedirectIfNeeded` `connectStorage.ts:58-84`; `driveTokenRecovery`.                             | Yes.                                                                                      |
| **Redirect-settle memo** — coalesces the post-redirect code exchange so a "still settling" transient isn't misread as failure.                                                   | `whenRedirectAuthSettled` `syncStore.ts:619`, `connectStorage.ts:67`.                                                                    | Yes (no-op on native; native uses the `appUrlOpen` listener, ADR-029, `App.vue:796-801`). |
| **Auth-masked-404 handling** — a Drive 404 with an invalid token → reconnect path, **not** the data-loss overlay.                                                                | `loadFromFile` `syncStore.ts:632-654`; `reloadIfFileChanged` `syncStore.ts:2007-2018`; `App.vue:499-515`.                                | Yes.                                                                                      |
| **Deferred file polling** — periodic `reloadIfFileChanged`; retries every 10 s; "even on error, next poll may succeed".                                                          | `startDeferredPolling`/`startFilePolling`/`reloadIfFileChanged` `syncStore.ts:1969-2088`; `backgroundSyncFromFile` finally `:1948-1954`. | Yes.                                                                                      |
| **Offline queue flush** on the write path.                                                                                                                                       | `offlineQueue.ts`, registered via `setProvider`/init `syncService.ts:418,581`.                                                           | Yes.                                                                                      |
| **Doc-worker death recovery** (`initAndLoadCache`, cache recovery on load).                                                                                                      | `src/services/automerge/worker/`, `replaceDocWithCacheRecovery` `syncStore.ts:551-581`.                                                  | Yes.                                                                                      |

**Where native diverges (the gap):** every mechanism above assumes a **provider is installed**
(`isConfigured === true`). They recover an _authenticated/transient_ failure of an existing connection.
**None of them re-establishes the provider config itself.** When `getProviderConfig` returns null,
`initialize()` returns false, `setupAutoSync`/polling are never armed (they're only called on a load
success), and there is **no silent retry at all** — the user just lands on the unconfigured card. The
web path rarely hits this because Chromium desktop rarely evicts IndexedDB and also has the FSA handle
restore fallback (`syncService.ts:611-636`); native/iOS have neither aggressive-eviction immunity nor
the FSA fallback, so the missing-config case is native-shaped.

The **one** existing mechanism that _does_ re-derive a lost provider config —
`attemptResumeFromRegistry` (`syncStore.ts:2629-2697`), which reads `fileId` from the remote registry
and rebuilds the Drive provider — runs only inside `ResumePodSetup.vue` (`ResumePodSetup.vue:202`), i.e.
only when `needsPodSetup === true`. A `podCreated` owner never gets there (§2, Bug A).

---

## 4. Resilient fix design (design only — no code)

Requirement: _"ensure the data connection cannot be disconnected; just like the web app / PWA, it is
retried SILENTLY and only bothers the user in case of a TOTAL failure to reestablish connectivity."_

### 4.1 Make provider-config restore self-healing (idempotent re-derivation)

Change `syncService.initialize()` so a **missing** `providerConfig-<familyId>` is not terminal. Add a
fallback tier **before** the final `isConfigured:false` (between `syncService.ts:609` and `:611`),
implemented as an orchestrator step in `syncStore` (MVO: the service exposes the primitive; the store
owns the multi-subsystem workflow, since re-derivation touches the registry + Drive + config write):

1. **Local registry / durable pointer first.** When `getProviderConfig` returns none but the family is
   known, consult the family registry. `attemptResumeFromRegistry` (`syncStore.ts:2629-2697`) already
   encodes this: `registry.lookupFamily(familyId)` → if `provider === 'google_drive'` + `fileId`,
   rebuild `GoogleDriveProvider.fromExisting(fileId, displayPath)` and **re-persist the config** via
   `provider.persist(familyId)` so the record is healed for next boot. Reuse this — do **not** duplicate
   the lookup.
2. **Re-resolve by name if the registry lacks a `fileId`.** The app has `resolveExistingBeanpod`
   (`connectStorage.ts:224-251`) and `searchBeanpodFilesGlobal` (used by `listGoogleDriveFiles`
   `syncStore.ts:2846-2860`). If the registry says "this family is Drive-backed" but the `fileId` is
   stale/absent, search the signed-in account's Drive for the `.beanpod` by name and adopt the **owned**
   match (the same ownership discipline as `establishDurableHomeAfterLoad`/`reHomeToOwnDrive`
   `syncStore.ts:2183-2385`), then re-persist. Never adopt a foreign file.
3. **Native local pods:** if the registry says `provider:'local'`, the file path cannot be re-derived
   remotely; keep it as an explicit "reconnect needed" surface (§4.3) rather than silently guessing.
4. **Idempotency + safety:** all re-derivation is a no-op when a valid provider for this family is
   already installed (mirror the `getProviderFamilyId() === activeFamilyId` guard used in
   `establishDurableHomeAfterLoad` `syncStore.ts:2257-2258`). Never `createNewFile` here (that was the
   Shaun-class data-loss regression called out at `syncStore.ts:2621-2624`); re-derivation is
   read/adopt only.

Result: an evicted config record self-heals silently from the durable registry, and `isConfigured`
stays true across idle-eviction just like the web path stays connected across a token blip.

### 4.2 A silent background retry loop (only surface UI on TOTAL failure)

Mirror `scheduleColdStartReconnectEscalation`'s deferred primitive (`syncStore.ts:225-254`
`createDeferredAction`, and the ~4 s defer at `:270-271`). Add a **config-restore retry** with the same
shape:

- On boot, if restore yields no provider **but** the registry/session says the family is Drive-backed,
  enter a silent retry: attempt §4.1 re-derivation, backing off (e.g. immediate → 2 s → 8 s → 30 s),
  driven by the same wake events the token path uses (focus/pageshow/online — the transient causes are
  identical: network down at cold start, OAuth proxy cold, Drive 5xx).
- Each attempt is silent (no toast/banner). `onTokenAcquired` and the wake listeners should also poke
  this loop so a token that lands mid-retry immediately unblocks the Drive re-resolve.
- **Total failure = retries exhausted** (all backoff steps failed, or the registry genuinely has no
  Drive home). Only then surface UI — the reconnect/reload affordance in §4.3 — and page telemetry
  (§4.4). This matches the existing "defer past the recovery window, then `severity:'critical'`" pattern
  at `syncStore.ts:1871-1883`.
- While retrying, the UI should read "reconnecting…", not the raw unconfigured card (see §4.3).

### 4.3 Correct recovery affordance for the unconfigured-but-`podCreated` state

Two coordinated fixes:

1. **Un-strand `resume=setup`.** In the already-auth guard (`router/index.ts:358-366`), allow a
   `podCreated` owner who is genuinely **unconfigured** to reach the recovery screen instead of bouncing
   to `/nook`. Cleanest: gate the recovery screen on a broader predicate than `needsPodSetup` — e.g.
   `needsPodSetup || (podCreated && !syncStore.isConfigured)` — so the _same_ `ResumePodSetup` →
   `attemptResumeFromRegistry` machinery that already exists becomes reachable for this state. (Prefer
   this over a bespoke new screen — it reuses the tested registry-resume + `completeAutoLoad` path
   `syncStore.ts:2710-2768`.) Mind the `membersStepActive` exception (`:357`) — leave it intact.
2. **Add an explicit Drive reconnect/reload button to the unconfigured card**
   (`SettingsPage.vue:1210-1217`), shown when the registry/session indicates a Drive-backed pod. It
   should call the §4.1 re-derivation orchestrator (reconnect Google via the existing
   `handleSettingsReconnect`/`reconnect` seam `:306-311`, then re-resolve + reload the Drive `.beanpod`),
   **not** `handleResumeSetup` (dead) and **not** the local-file picker (wrong backend). Keep
   "load existing family data file" only for genuinely local/imported pods.

While §4.2's silent retry is in flight, render a lightweight "reconnecting…" state in the card rather
than the full unconfigured layout, so the alarming "save your data to a file" copy never flashes for a
pod that is merely mid-reconnect.

### 4.4 Edge cases

- **Init-ordering race (H3):** ensure any native resume/deep-link entry activates the family
  (`setActiveFamily`) **before** `syncService.initialize()`, or have the §4.2 retry loop re-run once the
  family becomes known (guard `syncService.ts:553` currently returns silently). The retry loop naturally
  covers a "familyId was null on the first pass" case.
- **Concurrent worker death:** re-derivation must not assume a live doc. Reuse
  `replaceDocWithCacheRecovery`'s discipline (`syncStore.ts:551-581`) — cache-hit-authorises-merge, else
  drop-and-adopt — so healing the _provider_ never corrupts the _doc_.
- **Expired token during restore:** §4.1 step 1 must run `beginDriveAuthRedirectIfNeeded` /
  `tryReconnectSilently` (as `attemptResumeFromRegistry` already does `syncStore.ts:2662-2670`) so a
  gesture-less silent refresh is attempted before any redirect; on a redirect surface it returns
  `redirecting` and resumes on return (ADR-026/029). A lapsed token becomes "retry later", never "drop
  to unconfigured".
- **Multi-device:** re-resolve by ownership (`ownedByMe`, as `establishDurableHomeAfterLoad`
  `syncStore.ts:2272-2306`) so a device that has been handed a _foreign_ shared file does not adopt it as
  its own home; a joiner's shared file must stay put (the join flow never enters this path).
- **Cache eviction (the likely trigger):** the durable source of truth for "where is my file" must be the
  **remote registry**, not only IndexedDB. Consider also **dual-writing the provider config to
  `localStorage`** (mirroring the refresh-token fallback `fileHandleStore.ts:181-250`) as a cheap local
  redundancy, so a same-origin IndexedDB eviction that spares `localStorage` self-heals without a
  network round-trip. Request `navigator.storage.persist()` on native too where the WebView supports it
  (today it's web-only best-effort, `App.vue:756-770`).
- **`membersStepActive` guard exception:** any router change in §4.3 must preserve the mid-create
  members-step exemption (`router/index.ts:357`) so a fresh create is not re-routed into resume/recovery.
- **`resetState` / sign-out:** `resetState` legitimately sets `isConfigured:false` (`syncStore.ts:2104`);
  the silent retry must be scoped to _authenticated boot with a known Drive-backed family_, not fire
  during sign-out teardown.

---

## Observability Coverage

Every decision/fallback below must emit a structured event so the failure is triageable blind (per the
mandatory Observability convention in `CLAUDE.md`). `surface` values are kebab-case and greppable.

- **Existing signal to lean on:** `syncService.ts:568` `Provider config for <familyId>: <type|none>` is
  currently a `console.warn` — **promote it to `logEvent`** (`level:'info'`, `surface:'sync-init-restore'`,
  `context:{ provider_type, had_config: boolean }`) so "restored from config vs none" is queryable in
  CloudWatch. This one line disambiguates H1/H2 from H3/H4 in the field.
- **Config-restore fallback fired:** when `getProviderConfig` returns none but the family is Drive-backed
  → `logEvent({ level:'warn', surface:'sync-init-config-heal', message:'provider config missing — re-deriving from registry', context:{ source:'registry'|'drive-search', provider_type } })`. Emit on the
  **success path too** (`message:'re-derived and re-persisted provider config'`) so the _rate_ of
  eviction-heal is measurable, per Rule 6.
- **No-active-family skip (H3):** promote `syncService.ts:554` to
  `logEvent({ level:'warn', surface:'sync-init-no-family' })` with `context:{ has_session: boolean }`.
- **Silent retry loop:** `logEvent({ level:'info', surface:'sync-config-reconnect', context:{ attempt, backoff_ms, wake_reason } })` per attempt (below the perf floor is fine — we need the _count_), and one
  outcome event `{ outcome:'recovered'|'redirecting'|'exhausted' }`.
- **Total failure (only here do we page):** on retries exhausted **and** no registry Drive home →
  `reportError({ surface:'sync-config-total-failure', severity:'critical', context:{ provider_type, registry_had_fileId:boolean, token_valid:boolean } })` (Slack page + the §4.3 UI). Reuse the deferred-then-
  critical pattern at `syncStore.ts:1871-1883`.
- **Router un-strand:** when the guard now routes a `podCreated && !isConfigured` owner into recovery,
  `logEvent({ level:'warn', surface:'app-podcreated-unconfigured', context:{ route_path } })` — this is the
  exact state that was previously invisible (it never hit `app.onboardingZombieState`
  `router/index.ts:406-416` because `needsPodSetup` was false).
- **Settings reconnect affordance used:** `logEvent({ level:'info', surface:'settings-drive-reconnect', context:{ from:'unconfigured-card' } })` so we can see whether users self-serve or get stuck.
- **Privacy gate:** any new `context` key (e.g. `provider_type`, `wake_reason`, `registry_had_fileId`)
  must be added to `ALLOWED_CONTEXT_KEYS` in `logEvent.ts` and the store-declaration table in
  `docs/runbooks/native-store-submission.md` before shipping (never log fileIds, tokens, or `.beanpod`
  contents).

---

## Appendix — key file:line index

- Restore path: `src/services/sync/syncService.ts:539-644` (guard `:553`, config read `:567`, log `:568`,
  Drive `:569-590`, native local `:594-605`, catch `:606-608`, terminal unconfigured `:638-643`);
  `reset` `:513-534`; `setProvider` `:409-425`.
- Provider config store (no localStorage fallback): `src/services/sync/fileHandleStore.ts:145-179`;
  refresh-token dual-write (the redundancy the config lacks) `:181-250`.
- Active-family (in-memory only): `src/services/indexeddb/database.ts:20,26-35`; activation
  `src/services/familyContext.ts:26,47,87-97`; `src/stores/familyContextStore.ts:24-43`.
- Boot ordering: `src/App.vue` Step 3 family resolve `:936-969`, Step 5 `loadFamilyData` `:976-996`;
  `loadFamilyData` `:400-634` (paths 1/2/3 at `:427`,`:540`,`:575`); `navigator.storage.persist` `:756-770`;
  auth-masked-404 `:499-515`.
- Router strand (Bug A): `src/router/index.ts:340-345` (critical-write), `:347-367` (already-auth bounce,
  `membersStepActive` `:357`, `return {name:'Nook'}` `:366`), `:393-418` (requiresAuth / zombie report).
- Settings card (Bug B): `src/pages/SettingsPage.vue:1196-1235` (unconfigured), `:1238-1468` (configured),
  handlers `handleResumeSetup:370-373`, `handleLoadFromFileClick:440-442`, `handleSettingsReconnect:306-311`,
  `handleForceSave:366-368`, `handleRequestPermission:375-377`.
- Existing self-heal primitives to reuse: `attemptResumeFromRegistry` `src/stores/syncStore.ts:2629-2697`;
  `completeAutoLoad` `:2710-2768`; `establishDurableHomeAfterLoad` `:2243-2385`; `reHomeToOwnDrive` `:2183-2212`;
  `resolveExistingBeanpod` `src/services/sync/connectStorage.ts:224-251`; silent recovery
  `scheduleColdStartReconnectEscalation` `:1831-1885`, `backgroundSyncFromFile` `:1892-1955`,
  `setupTokenExpiryHandler`/`onTokenAcquired` `:2917-2962`, polling `:1969-2088`.
- Durable remote source of truth: `registryService.lookupFamily` `src/services/registry/registryService.ts:34-46`;
  `RegistryEntry{ provider, fileId, displayPath, familyName }` `src/types/models.ts:1516-1529`.
