# Plan: Compaction fallout remediation — auth, registry, lineage, and the surfaces that lied

> Date: 2026-09-08
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-08-compaction-fallout-remediation.md`
> Investigation: `docs/investigations/2026-09-08-compaction-fallout.md` (read first; carries every root cause with file:line)

## User Story

As a family using beanies across several devices and app versions, I want compaction, sync and
Google connection to be quiet and truthful, so that I am not re-consenting every few hours, not
refused an operation that is actually fine, not told my family's owner changed when it did not,
and not silently losing an edit made on a device that had not updated yet.

## Context

On 2026-09-08 greg ran the first real pod compaction across his own fleet (desktop browser on
0.17, one phone deliberately left on 0.16, an older Galaxy Tab A7). Compaction itself worked
(4MB+ to ~350KB). Nine distinct problems fell out. All nine were root-caused; this plan fixes
them. Two were already applied during the investigation and are recorded here for completeness.

The single most important finding: **none of these are compaction bugs.** Compaction exposed
pre-existing defects in the auth, registry, sync-gate and lineage layers.

**Pass 2 changed the shape of this plan materially.** Reading the code rather than trusting the
draft showed that one item was already shipped, one was provably ineffective, one targeted a
component that cannot render on the route in question, and five more were re-implementations of
helpers that already exist.

**Pass 3 changed how it ships.** The Pass 2 plan was one change set spanning auth, registry,
sync-gate, lineage and UI, with a coupled two-sided client/Lambda migration inside it. That
coupling is not achievable (the Lambda and two native store builds deploy on different cadences)
and it is not necessary. The work is now `## Implementation Stages`: seven stages, each one
shippable and revertible on its own. Pass 3 also found two places where the Pass 2 design created
a state the user could not leave, and one where it deleted the only surface a whole route class had.

## PASS 4 CORRECTIONS (applied to the sections below)

Pass 4 compiled every sketch against the real code. Nine corrections were blocking.

**C1. §5a (adopt rescue) is DELETED as provably unreachable.** Pass 3 scoped it to
`adopt-remote × clean`, and `clean` IS `headsEqual(basis.heads, headsOf(doc))`
(`applyAndProject.ts:884`). `buildRebaseOps` then runs `touchedBetween(local, basis.heads,
getHeads(local))` (`docOps.ts:754`) = `Automerge.diff(doc, X, X)` (`docOps.ts:231`) = zero patches
-> `{ op: null }` -> `replayed === 0` -> always falls through. Keeping it would add a second
`migrateDoc(remote)` pass to every clean adopt in the fleet for a branch that can never be taken.
**The `if (act === 'rebase')` block at `applyAndProject.ts:1063` is NOT touched by this plan.**

**C2. `materialize()` does not exist anywhere in `src/`.** The Pass 3 carry sketch would not
compile. The right primitive is in the same file: `docOps.ts:794` already emits
`{ op: 'set', collection, id, entity: toPlain(now) }` for exactly "present locally, absent in
target". `toPlain` is `docOps.ts:47` and is module-private, so the helper must live in `docOps.ts`.

**C3. `structuredClone` is the wrong tool** and the cited precedent does not support it:
`settingsRepository.ts:66-69` clones a plain object from `getSettings()`, not an Automerge value.
Use `toPlain`.

**C4. The carry must be a `MutationOp` applied through `applyMutation`** (`docOps.ts:682-694`),
already imported at `applyAndProject.ts:33` as `applyMutationOp`. It is one `Automerge.change`, so
the carry lands atomically and a throw leaves `currentDoc` untouched structurally rather than by a
restore step. No hand-rolled change callback.

**C5. SECURITY: the carry must EXCLUDE credential and roster collections.** `driveConnections`
holds refresh tokens (`docOps.ts:817-824`). Carrying a local-only entry republishes a token the
compacted pod deliberately dropped, and §1d now READS remote `driveConnections` to heal, so a dead
token would be adopted fleet-wide: item 5's exact bug, manufactured out of this plan's own parts.
Same reasoning for `calendarConnections` (carries `needs_reconnect`, §11) and `familyMembers`
(resurrecting a removed member feeds `normalizeRoles` owner promotion, `familyStore.ts:615-647`,
and §2c-ii's roster-owner lookup). `calendarEventLinks` and `notificationReads` are device/sync
bookkeeping, not user work. Express the decision as a total map so adding a collection without
deciding is a compile error.

**C6. §1c as written would SILENTLY DISABLE escalation.** `oauthProxy.ts:165-170` logs
`HTTP ${res.status}` to the console but throws `Token refresh failed: ${detail}` with **no status
in the message**. So a `/HTTP 4\d\d/` predicate is false for every real 4xx and the counter would
never increment. The throw must carry the status. Corollary: the Pass 3 claim "no diagnostic output
changes" is withdrawn; a non-`invalid_grant` 4xx reclassifies `unknown` -> `http`.

**C7. `syncService.remoteUnreadable()` does not exist.** It is `syncService.isRemoteBlocked()`
(`syncService.ts:128`); `remoteUnreadable` is a store-local alias (`syncStore.ts:732`). Also, step
2 of `tryReconnectSilently` has three early `return false`s (`:313`, `:315`, `:316`), so a step 3
appended at the bottom is reachable from only one of them.

**C8. §9's toast suppression would remove the only surface from two paths.**
`syncStore.ts:3694-3695` ("password may have changed") and `:3848-3849` (`keyMayBeWrong` rotated
key) both set `backgroundSyncErrorKind = 'decrypt'` WITHOUT `podUnopenable` and without
`podBlockMessageKey`, and `notePodUnopenable` declines to latch that class (`:4002-4003`). The
banner's gate is `podUnopenable && kind === 'decrypt'`, so neither gets a banner. Suppress on
`podUnopenable && kind && BANNERED_BLOCKER_KINDS.has(kind)`, never on kind alone. The `kind &&` is
required: `backgroundSyncErrorKind` is nullable (`:719`) against a `ReadonlySet<NonNullable<...>>`.

**C9. §8's `useRoute()` in the composable breaks six existing tests.**
`src/composables/__tests__/useReconnectCoordinator.test.ts` calls it bare at `:60`, `:67`, `:79`
and three more with no router stub. Move the computed into `UnifiedReconnectToast.vue`, the only
consumer.

**Counts and names corrected:** SEVEN revoke sites (`googleAuth.ts:592, 1022, 1540, 1549, 1641,
2113` + `calendarSyncStore.ts:987`), five surviving. SEVEN `decrypt` kinds, retry honest for five
of them. `?: never` catches SIX of seven `lastSyncTimestamp` writes: `syncStore.ts:3231` assigns
`undefined`, which `?: never` accepts (no `exactOptionalPropertyTypes` in `tsconfig.app.json`), so
**§2b and §3a must ship in the same stage** because deleting `disconnect()` is what removes it.
THREE stale `disconnect()` comments (`index.mjs`, `registryService.ts`, plus `syncStore.ts:2445-2448`).
TWO `isFullySynced` mocks (`__mocks__/syncService.ts:130` and `usePodCompaction.test.ts:87`).
POLICY adopt cells are `podLineage.ts:175-177`.

**Unlisted blast radius:** the tombstone corrupts the founder metrics.
`.claude/skills/beanies-metrics/scripts/pull_registry.mjs:110-121` scans the whole prod table, so a
`deletedAt` row counts as a live family forever. The filter ships in Stage 2 with the Lambda.
E2E is safe: `dataBridge` runs on localhost, which `tableForOrigin` routes to the dev table
(`index.mjs:88-90`).

**Security notes.** Neither registry guard is authorization: `VITE_REGISTRY_API_KEY` ships in the
client bundle and the Lambda already concedes "A curl gets the same answer here too"
(`index.mjs:117`). They defend the family against the app's own bugs, which is the failure that
actually happened. Say so at the new gate so nobody later treats the 403 as a security control.
Mask the member id in the DELETE warn the way `index.mjs:160-167` masks the pointer-refusal warn.

**Ops steps that actually complete the 2026-09-08 repair.** greg's row is re-claimable for the
whole length of the ladder, because clients through Stage 4 still send session-sourced owner fields
and the Lambda stamps write-once on the first accepted write. Stage 5 therefore carries: a
pre-flight confirming the Stage 2 Lambda is live in prod (shipping Stage 5 first hands every member
device a passing pointer guard), and a post-ship re-verify of `ae92950b`'s `ownerMemberId`,
re-nulling if a pre-Stage-5 device re-claimed it.

**New assumption 7 (recorded because §1a was silently accepting it).** Removing the two reconnect
revokes re-opens issue #62's concern (Google's ~100-token FIFO cap per user + client_id). Judged
the better trade: the revoke kills every device of the account on EVERY reconnect,
deterministically, whereas the cap needs ~100 accumulated tokens; the `signout` /
`explicit-disconnect` / `account-change` revokes still keep the pool tidy; and since #62 the fleet
converges on one mirrored token per family so an evicted device self-heals from the doc copy. It is
a judgement, not a proof, and `revoke-skipped` climbing alongside
`drive-token-silent-reconnect` failures is what would falsify it.

---

## Requirements

1. **Google grant + consent (item 5, the priority).** Stop revoking the shared Google grant on
   reconnect, stop escalating transient failures to permanent, and let a lineage-blocked device
   heal its own token before any consent screen. Audit every revoke and every forced-consent site.
2. **Registry ownership (items 3 + 8).** A per-device action must never delete the family's
   shared registry row. The Lambda must not be able to lose `createdAt`/owner identity even if a
   delete happens. Owner fields must come from the pod roster's actual owner, not from whoever is
   signed in on the writing device, **without weakening the canonical-pointer guard, and without a
   lockstep release**. Registry writes and their failures must be observable.
3. **Compaction `not-synced` false refusal (item 1).** `syncNow` must stop dirtying the document
   immediately after committing the sync baseline. A transient probe failure must not be reported
   as "changes have not reached the cloud".
4. **Native Drive restore (item 7).** Remove the vestigial `!isNative()` gate and close the
   popup-token gap behind it.
5. **Best-effort data preservation across versions (item 4).** A wholesale adopt must never
   silently discard local-only entities. Do **not** gate compaction on straggler versions.
   **Preserve means preserve.** A refusal that latches the device preserves nothing and satisfies
   neither half of this requirement.
6. **Version floor (item 4 mitigation).** Raise the update floor to 0.17, and make both deploy
   skills ask whether to raise it on every deploy.
7. **`buildInviteLink` iOS origin.** The last unfixed instance of the `location.origin` bug.
8. **Reconnect surface on the public shared-recipe page (item 8b).** A visitor opening a shared
   recipe link must never see a Google reconnect surface.
9. **Blocker latches are banners, not 4-second toasts (item 2).** A condition that stops sync for
   the session must not be announced in a toast the user cannot finish reading, and replacing the
   toast must not reduce the set of routes on which the condition reaches anyone.
10. **Every stage ships alone.** No step may depend on another landing in the same release. Where a
    semantic change to a wire field is needed, it goes out as an additive field first and a meaning
    change second.

## Important Notes & Caveats

- **Do NOT gate compaction on `membersOnOlderVersions()`.** Advisory only; greg explicitly
  rejected turning it into a block. `podSoak.ts` stays advisory.
- **Do NOT hand-set `ownerMemberId` on any registry row.** Write-once in the Lambda; a wrong value
  permanently refuses the real owner's pointer writes with no way back (`index.mjs:121-138`).
  greg's row has both owner fields deliberately NULLed.
- **Sourcing `ownerMemberId` from the roster WILL neuter the pointer guard unless the guard moves
  to a new field first.** `index.mjs:139-143` compares `body.ownerMemberId` against
  `existing.ownerMemberId`. **Pass 3: this is a sequencing constraint, not a coupling.** The Pass 2
  wording ("must ship together") describes a release that cannot exist: the Lambda deploys on its
  own cadence (`index.mjs:243-247`) and two native builds deploy on store cadence. Stage 2 is a
  byte-for-byte no-op because no client sends `writerMemberId`. Stage 4 is a no-op because writer
  and owner ids are the same value today. Only Stage 5 changes meaning, by which time both halves
  are in the field.
- **`user-file` NEVER BLOCKS, and no new guard may change that.** `podLineage.ts:154-158`: it is
  the pre-compaction `.beanpod` rollback route, and a guard that refuses it "would have made the
  recovery it mandates impossible". `LineageBanner.vue:22-27` says the same from the UI side: the
  adopt is "the only exit there is". Every new refusal in §5 is scoped to `adopt-remote × clean`.
- **0.16 is already shipped and cannot be fixed.** The only levers are the 0.17+ fleet defending
  itself and the update floor. Accept that a 0.16 device can still overwrite a 5.0 pod.
- **The registry DELETE trigger is not fully identified.** Defence in depth across four
  independent layers, not a single-door patch. Do not collapse it to one.
- **`compactDoc` throws if any JSON differs** (`applyAndProject.ts:1392-1430`). §3a only stops
  WRITING a field; stored values are untouched. `settingsRepository.ts:66-81` makes this
  structural: `saveSettings` rebuilds from `getSettings()`, which spreads the stored object, so an
  unmodelled key rides through every write unchanged.
- **The `same` row of the lineage POLICY table must stay byte-for-byte `merge`.**
- **Forced consent on reconnect is deliberate and load-bearing.** `useGoogleReconnect.ts:48-51`:
  `forceConsent: false` yields `prompt=select_account`, which returns an access token with no
  refresh token, which is the reconnect-every-launch bug. Do not remove it.
- **5xx IS TRANSIENT, and one module already says so.** `refreshFailure.ts:8`: "Everything else
  (network, timeout, 5xx, rate limiting) is transient and must stay retryable." Any gate treating
  the classifier's `'http'` bucket as a rejection contradicts it, because that bucket is
  `/HTTP [45]\d\d/` (`googleAuth.ts:1187`). See §1c.
- **`isRemoteBlocker` is duck-typed by design** (`types/sync.ts:280-284`). A new refusal that must
  reach a banner needs an entry in `BLOCKER_BANNER_KIND`, not a new `instanceof`.
- **A banner inside `showLayout` is not a replacement for a toast outside it.**
  `BackgroundSyncBar` is mounted at `App.vue:1931`, outside `<div v-if="showLayout">` (`:2190`).
  The existing blocker banners are inside it (`:2225-2226`). See §9.
- Prettier ignores `docs/brand/` — do not reformat the CIG.

## Assumptions

> Review before implementation.

1. Google's revoke endpoint kills every token for the (user, client_id) pair
   (`googleRevoke.ts:10-19`). The whole auth fix rests on it.
2. The Tab A7 memory failure was a genuine allocation failure, correctly classified. The fix is to
   the surface, not the classifier.
3. `isExternalLandingRoute` (`utils/appChrome.ts:100`) is the right test for "here to consume
   content from outside the app". Its list is exactly `['ShareTarget', 'SharedRecipe']` (`:59`).
   The broader `isPublicEntryRoute` is NOT used: it also covers `OpenFromDrive` and `Login`, where
   a Drive reconnect prompt is legitimate.
4. Raising `promptBelowVersion` to 0.17 prompts but cannot block; `versionPolicy.ts` has no
   hard-block field (`:42-43`, `:162`) and this plan does not add one.
5. **Revised in Pass 3.** An entity id present locally and absent from the remote is a sufficient
   proxy for "adopting wholesale will destroy work". False positives are EXPECTED, not merely
   possible: deletes are hard (`docOps.ts:613-615`), so any entity deleted on a peer and not yet
   merged here reads as local-only. They are handled by CARRYING the entity forward rather than by
   refusing the adopt, so a false positive costs a resurrected entity the user can delete rather
   than a device the user cannot un-latch. Resurrecting an un-propagated delete is already what an
   ordinary CRDT merge does here; the wholesale adopt is the anomaly.
6. **New in Pass 3.** §1d's remote token heal only helps a device that can still READ Drive but
   cannot MERGE it. A device whose credential is wholly dead cannot fetch the envelope, step 3
   returns false, behaviour unchanged. The target case is real (the lineage guard refuses at merge
   time, not fetch time) but narrower than "any permanent failure"; the test pins both halves.

## Approach

### 1. Google grant + consent (priority)

**1a. Stop the reconnect revoke, and account for every survivor.** Delete the two
`trigger: 'reconnect'` revokes: `googleAuth.ts:1019-1022` (popup) and `:2109-2113` (redirect).

There are **five** revoke sites, not three. The surviving four each get a one-line comment:

- `googleAuth.ts:592` — `account-change`, a different account is taking over this device.
- `googleAuth.ts:1540` and `:1549` — `signout`, the user asked to disconnect.
- `googleAuth.ts:1641` — `explicit-disconnect` (`disconnectGoogleEverywhere`). The investigation
  names this one as a keeper; the Pass 1 draft omitted it.
- `calendarSyncStore.ts:987` — already behind the shared-grant guard at `:951-989`; unchanged, but
  the comment should now say Drive no longer needs the symmetric guard.

Fix the false comment at `googleAuth.ts:2106-2108` ("a Drive reconnect never disturbs a live
calendar grant"), which becomes true only after this change.

**1b. Forced consent on reconnect STAYS. What changes is what happens before it.**
The Pass 1 draft proposed `forceConsent: false` from reconnect callers. That is a regression
(`useGoogleReconnect.ts:48-51`). `getValidToken`'s `forceConsent: !currentRefreshToken` (`:1480`)
is a different question and is not a reconnect helper. So the consent-storm fix is entirely
1a + 1c + 1d. The only change here is auditing: `unifiedReconnect.ts:78`,
`useGoogleReconnect.ts:51` and `usePickBeanpodFile.ts:62` each get a one-line comment recording
that a reconnect must force consent to obtain a refresh token, and that the cheap paths run first.

**1c. Escalate only on a server REJECTION, and a 5xx is not one.**
`googleAuth.ts:1404-1420` increments a persisted counter after every exhausted run and fires
`firePermanentFailureCallbacks()` at threshold 2 regardless of classification. The Pass 1 "gate on
permanent/4xx" would disable escalation entirely: a `permanent` classification returns at
`:1362-1383` and never reaches the counter.

**Pass 3 correction to the Pass 2 gate.** Pass 2 proposed gating on
`classifySilentRefreshError === 'http'`. That bucket is `/HTTP [45]\d\d/` (`:1187`), so it includes
5xx, and `refreshFailure.ts:8` says a 5xx is transient. Gating there leaves a proxy outage
escalating to permanent failure, raising a reconnect surface, driving a consent: the same bug in a
smaller box. **Pass 4, and without it this gate is a silent off-switch (C6).** First fix `oauthProxy.ts:170` to
include the status in the thrown message, matching the `console.warn` immediately above it:
``throw new Error(`Token refresh failed: HTTP ${res.status} — ${detail}`)``. Then add one predicate
to `refreshFailure.ts`, the module that already owns this rule:

```
/** A 4xx from the OAuth proxy: Google rejected the exchange. Distinct from a
 *  permanent revocation (which returns earlier) and from a 5xx, which is the
 *  proxy failing rather than the grant being refused. */
export function isRefreshRejection(errOrMessage: unknown): boolean
```

Then increment only when the LAST attempt satisfies it; never for network, timeout, unknown or
5xx; keep the existing `>=` test and the existing resets (`:1731-1732`, `:1766-1767`).
`classifySilentRefreshError` keeps its five labels for diagnostics; only the counter consults the
new predicate, so no diagnostic output changes.

**1d. Let a lineage-blocked device heal its own token, in the module that owns token recovery.**
`driveTokenRecovery.ts:13-15` states as an invariant that `googleAuth` imports nothing from it, and
`readDriveTokenFromDoc` (`:72`) + `restoreLocalFromDoc` (`:144`) already exist there. Extend
`tryReconnectSilently` (`:291-327`) with a third step, after the local token and the local doc copy
have both failed:

3. If `syncService.isRemoteBlocked()` (`syncService.ts:128`; `remoteUnreadable` is a store-local
   alias at `syncStore.ts:732`) reports the pod is latched, read the remote
   `driveConnections` for the bound account. If it holds a token this device has not tried, adopt
   it via `restoreLocalFromDoc` and re-run `attemptSilentRefresh`.

Right placement because `useGoogleReconnect.ts:32` already calls `tryReconnectSilently` first, so
every reconnect surface inherits the fix; the function already carries the session-epoch guard, the
account-match guard and the "never clobber a good local token" ordering; and its contract is
already "never throws, returns false, caller proceeds unchanged".

**Pass 3: three structural constraints on the new read.**

- **It returns connections, never a document.** `syncService.readRemoteDriveConnections():
Promise<DriveConnection[] | null>`, not a general "read-only envelope fetch". A function handing
  back a decrypted `Doc` next to the merge path is a loaded gun; one that can only yield
  credentials cannot be mistaken for a sync path.
- **Step 2 has three early `return false`s** (`:313`, `:315`, `:316`), so a step 3 appended at the
  bottom is reachable from only one. Restructure the body into three small local closures and one
  set of returns: `if (await fromLocalToken()) return true; if (await fromDocCopy()) return true;
return await fromRemoteDocCopy();`
- **Reached by dynamic import** (the `familyContext.ts:202` idiom, since `:253` is deleted by §2a), so `driveTokenRecovery`'s
  stated dependency set is not widened at module scope. Update that header.
- **Acquires its token with `getValidTokenSilent()` only.** `getValidToken`/`requestAccessToken`
  would let token recovery recurse into the consent screen it exists to avoid.

**And say what it does not do.** Step 3 helps only a device that can READ Drive but cannot MERGE
it. A wholly dead credential cannot fetch; step 3 returns false; behaviour is today's. State that
in the comment and pin both halves with a test.

**1e. Audit output.** Enumerate every `revokeGrant`, every `forceConsent: true`, and every raiser
of a reconnect surface, with the justifying comment for each survivor. Record in the Outcome
section.

### 2. Registry ownership — four independent layers, shipped as a ladder

**2a. Client: a per-device action stops touching the shared row.** Remove the `removeFamily` call
and its swallowing try/catch from `familyContext.deleteLocalFamily` (`familyContext.ts:251-257`).
Delete the whole step-8 block, not just the call: an empty `try {} catch {}` with a comment about
the remote registry is worse than no block. Renumber the remaining steps.

This also makes `uiStrings.ts:6134` ("The original file is not affected") true for the first time,
and it fixes the picker path (`FamilyPickerView.vue:92-97`) as well as the Settings path, which is
the point of fixing the shared function rather than each caller.

Remote removal moves to the owner-gated full-family deletion in `SettingsPage.vue`, called
explicitly **before** `deleteLocalFamily(familyId)` at `:1232` (after it, the auth teardown at
`:1235` has run and there is no session left to authorise the delete). Awaited, and its failure is
surfaced: `reportError` with `surface: 'registry'`, `severity: 'warning'`, and the farewell dialog
gains a line saying the cloud registry entry could not be removed and support can clear it. Silent
is not an option: the user is being told their data is gone.

**2b. Client: delete the dead code.** `syncStore.disconnect()` (`:3193-3234`) has no production
caller and contains a `removeFamily`. Delete it. Two knock-on comment fixes:
`infrastructure/lambda/registry/index.mjs:232-236` and `registryService.ts:29-35` both justify the
`isSignupEvent` design by citing `syncStore.disconnect()` as a live delete-and-recreate path. Both
become false; rewrite them to cite the tombstone.

**2c. Client: split writer identity from owner identity, in two releases.**

**2c-i (Stage 4, additive, zero behaviour change).** Add `writerMemberId`
(`authStore.currentUser?.memberId ?? null`) to `RegistryWritePayload`, to `buildRegistryPayload`,
and to the DELETE call. Leave `ownerMemberId`/`ownerEmail` exactly as they are. The server (on
Stage 2) reads `body.writerMemberId ?? body.ownerMemberId`, and today those are the same value, so
nothing observable changes. That is what makes it safe alone.

**2c-ii (Stage 5, the meaning change).** Source owner fields from
`useFamilyStore().members.find(m => m.role === 'owner')`. The store is already used here
(`memberCount` at `:2444`), so no new coupling. **Omit both owner fields entirely when no roster
owner is resolvable** rather than substituting the local session; the Lambda preserves on omit. By
now the guard has been on `writerMemberId` for two releases and every client sends it. There is no
window in which the guard is off.

**2d. Server: make loss structurally impossible, in two releases.**

**2d-i (Stage 2, backward compatible, a no-op for every deployed client).**

- **Move the pointer guard to the writer.** `isOwner` compares
  `(body.writerMemberId ?? body.ownerMemberId)` against `existing.ownerMemberId`. The `??` is
  required, not cosmetic: every deployed client sends only `ownerMemberId` and without it they are
  all refused the moment this deploys. Comment naming the version after which it may be removed.
- **`ConsistentRead: true`** on the PUT handler's `GetItemCommand` (`:100-103`) and on the GET
  handler (`:82-85`). Today it is an eventually-consistent read feeding a full-row `PutItem`; a
  stale miss clobbers write-once fields.
- **Tombstone instead of delete.** The DELETE arm (`:270-277`) sets `deletedAt` and keeps
  `createdAt`, `ownerMemberId`, `ownerEmail`, `country`, `signupPlatform`. A PUT on a tombstoned
  row clears `deletedAt` and restores it. GET returns 404 for a tombstoned row so no client
  behaviour changes.
- **Read `writerMemberId` on DELETE, validate, log, and ACCEPT either way.**
  `registryService.request('DELETE', familyId)` sends no body (`:42-52`) and the DELETE arm reads
  none. Add `?writerMemberId=<uuid>` as a query parameter (a body on DELETE is legal but is dropped
  by enough intermediaries to be a bad bet), validate against `UUID_RE`. In this release a DELETE
  failing the ladder, or carrying no id, is still performed and emits
  `console.warn('[registry] delete would be refused', …)`. That warn is the measurement that
  decides when Stage 7 can enforce.

**2d-ii (Stage 7, enforcement).** Flip the warn to a 403. Fail-safe direction: the worst case is a
stale row.

**Pass 3: why enforcement is a separate stage.** Enforcing on the same deploy as 2d-i breaks two
callers neither earlier draft listed:

- `src/services/e2e/dataBridge.ts:64` (the Playwright `afterEach` cleanup) calls `removeFamily(id)`
  with no member context. Every E2E run would silently stop cleaning up, and because `removeFamily`
  is fire-and-forget today, nothing would say so.
- Every already-deployed client running the owner-gated full deletion. Combined with §2a's new
  surfaced failure, a 0.17 user deleting their family would be told on every attempt that the
  registry row could not be removed, until they update. A user-visible regression manufactured by a
  server deploy is exactly what staging exists to prevent.

Both are fixed by Stage 4. Stage 7 then enforces against a fleet that already sends it.

**2e. Observability, reusing the surface that already exists.** `surface: 'registry'` with `action`
and `http_status` already emits on the lookup path (`:79-85`, `:92-98`). Extend it:

- `registerFamilyOrThrow` emits `action: 'put'` on success with `count` = 1 when owner fields came
  from the roster else 0, and `action: 'refused'` at `warn` when `pointerAccepted === false`.
- `removeFamily` **must check `res.ok`**, which it does not today (`:178-186`): the DELETE response
  is discarded, so a 403 from the new gate would be perfectly silent. Emits `action: 'delete'` /
  `'delete-failed'` at `warn` with `http_status`, and returns a boolean so §2a can tell the user.
  `dataBridge.ts:64` ignores the boolean, correct for a test hook, but the signature change means
  it must be re-read once.
- `registerFamily` (fire-and-forget, `:127-135`) emits `action: 'put-failed'` at `warn` before
  returning null, so a swallowed write is at least counted.

No new context keys.

### 3. Compaction `not-synced` false refusal

**3a. Stop writing the derived field, and make that permanent in the type.** `syncStore.syncNow`
(`:974-994`) calls `syncService.save()`, which commits the baseline as the exported heads
(`syncService.ts:1981`), then writes `settingsRepo.saveSettings({ lastSyncTimestamp })` at
`:987-991`, an Automerge change with a fresh value every time. Heads advance past the baseline just
committed and `usePodCompaction.ts:223` reads dirty.

Fixing one write is not enough: `lastSyncTimestamp` is written at **seven** sites
(`syncStore.ts:879, 990, 1893, 1940, 2126, 2982`, plus `:3231` inside the `disconnect()` deleted in
§2b) and **read at zero**. Any survivor can re-dirty the gate.

**Pass 3 revision to the mechanism.** Pass 2 proposed deleting the field plus a comment. Use the
type system for both jobs instead:

```
/** @deprecated (2026-09-08) Derived state that was never read, and whose write
 *  after `syncService.save()` re-dirtied the document and false-refused
 *  compaction. `never` so a re-added write is a compile error, not a comment
 *  nobody reads. The UI value lives on the `lastSync` ref. Existing documents
 *  still carry the stored value; nothing removes it. */
lastSyncTimestamp?: never;
```

Identical compiler sweep, enforced forever rather than eroding the first time someone adds a write
back. The repo already uses `@deprecated` tombstones on this type (`models.ts:677`, `:809`,
`:1027`, `:1045`), so this is the house idiom. A `never` also documents honestly what a reader now
gets: `undefined`.

Stored values are untouched, and `settingsRepository.ts:66-81` makes that structural rather than
incidental: `saveSettings` rebuilds from `getSettings()`, which spreads the stored object.

**Say what this does not fix while the fleet is mixed.** Older clients keep writing the field on
every `syncNow`, so a 0.18 device can still see the pod move. That surfaces as `'remote-moved'` (a
true statement) rather than the false `not-synced` this fixes, and it resolves as the fleet turns
over. Record it so nobody re-opens the bug during the overlap.

Explicitly rejected: a "skip the mutate when nothing changed" guard in
`settingsRepository.saveSettings` (`:62-81`). Automerge already produces no change for an identical
value; the bug is the fresh value, not the write.

**3b. Distinguish "cannot verify" from "not synced" by giving the probe a voice.**
`isFullySynced()` (`syncService.ts:1081-1085`) collapses three answers into one boolean: the remote
moved, the probe failed, or the document is genuinely ahead. Only the second is "cannot verify",
and its copy asserts changes have not reached the cloud, which is untrue.

One production caller (`usePodCompaction.ts:223,225`), so change the return type:

```
export type SyncLevel = 'level' | 'remote-moved' | 'unpushed' | 'cannot-verify';
export async function syncLevel(): Promise<SyncLevel>
```

`'cannot-verify'` when `remoteChanged()` answers `status: 'unknown'` (`syncService.ts:1034`).

**The compaction gate maps it with a total table, not an if-ladder:**

```
const REFUSAL_FOR: Record<Exclude<SyncLevel, 'level'>, RefusalCode> = {
  'remote-moved': 'not-synced',
  unpushed: 'not-synced',
  'cannot-verify': 'cannot-verify',
};
```

A fifth level is then a compile error at the one place that has to decide what it means, the same
property `BLOCKER_BANNER_KIND` and the lineage POLICY table buy.

**`src/services/sync/__mocks__/syncService.ts:130` exports `isFullySynced` and must change with
it.** Missing this turns a "one caller" refactor into a red suite nobody expected.

**3c. The retry surface needs no component change.** `CompactionProgressModal.vue:261-268` already
renders its button on the generic `failure.retryable` flag. The only edit is
`usePodCompaction.ts:129`, where `retryable: code === 'not-synced'` becomes a module-level
`RETRYABLE: ReadonlySet<RefusalCode>`. Add `compaction.refused.cannot-verify` to `uiStrings.ts`
beside the existing `compaction.refused.*` family at `:4473-4599`.

**3d. Already applied.** The "Check Again" button, `progressFailure.retryable`, and the
`SettingsPage.vue` `@retry` wiring landed during the investigation.

### 4. Native Drive restore

Drop `&& !isNative()` from `canRestoreFromDrive` (`SettingsPage.vue:581`), remove the now-unused
`isNative` import if nothing else uses it, and delete the stale comment at `:570-573` (which
contradicts `:574`).

Close the token gap: add `silent?: boolean` to `syncStore.listGoogleDriveFiles` (`:5350-5363`)
using `getValidTokenSilent()` instead of `requestAccessToken()`.

The error handling is **already there**: `openDriveRestorePicker` (`:679-698`) has a try/catch,
sets `importError`, console-warns, and emits `surface: 'pod-load-failure'`. The only addition is
one branch inside that catch: on `TokenExpiredError`, call the already-imported
`useGoogleReconnect` (`:53`), because that composable handles native via `startRedirectAuth`.

Add a unit test with `isNative` mocked true asserting `canRestoreFromDrive` is true and the button
renders. There is no test on this predicate today, which is exactly how the bug shipped.

### 5. Best-effort preservation on adopt — the item-4 fix

**Pass 2 correction.** The Pass 1 draft proposed attempting the rebase diff before a wholesale
adopt. Provably a no-op for the case it was written for: `lineageContextFor` answers `clean`
exactly when `headsEqual(basis.heads, headsOf(doc))` (`applyAndProject.ts:884`), and
`rebaseOntoRemote` then calls `buildRebaseOps(local, basis.heads, target)` (`:829`), which returns
zero ops by construction when those heads are equal. The diff is driven by the same lying baseline
that produced the false `clean`. It cannot see the todo.

The loss line is still `applyAndProject.ts:1152-1153`, reached because
`POLICY['adopt-remote'].clean = 'adopt'` installs wholesale.

**Pass 3 correction, and it is the most important one in this plan.** Pass 2 wrote both sub-items
as "in the `act === 'adopt'` arm". `act === 'adopt'` is reached from **three** POLICY cells
(`podLineage.ts:174-176`):

| verdict        | context     | action                                          |
| -------------- | ----------- | ----------------------------------------------- |
| `adopt-remote` | `clean`     | `adopt` <- the 2026-09-08 case, the only target |
| `ours-newer`   | `user-file` | `adopt`                                         |
| `conflict`     | `user-file` | `adopt`                                         |

The two `user-file` cells are the deliberate rollback route (`podLineage.ts:154-158`,
`LineageBanner.vue:22-27`: the adopt is "the only exit there is"). An unscoped §5b would refuse the
exit offered by the banner that the refusal raises: press "use the family file", re-enter the same
path, hit the same guard, return to the same banner. A state the user cannot leave, created by a
safety feature, on the device holding the at-risk data.

**Everything in §5 is scoped to `verdict === 'adopt-remote' && lineageCtx === 'clean'`, expressed
as one hoisted flag beside the existing `stampNewGeneration` / `rebaseUnavailable` flags, not as a
condition repeated at each site.**

**5a. CARRY local-only entities into the adopted document. (Pass 4: the Pass 3 "adopt rescue"
that stood here is DELETED as provably unreachable, see C1. The `act === 'rebase'` block at
`applyAndProject.ts:1063` is NOT touched by this plan.)**

Hoist the source DOCUMENT, not a boolean, beside the existing `stampNewGeneration` /
`rebaseUnavailable` flags (`applyAndProject.ts:1009-1029`):

```
/** The local document to carry local-only entities from, or null when this is
 *  not the scoped case. A Doc rather than a flag so the wholesale branch below
 *  never needs a non-null assertion on `currentDoc`, which is legitimately null
 *  there on the first-load adopt. `stampNewGeneration` requires
 *  lineageCtx === 'user-file' (:1038), which this excludes by construction, so
 *  the two can never both be set. */
let carryFrom: Doc | null =
  verdict === 'adopt-remote' && lineageCtx === 'clean' ? currentDoc : null;
```

Add a pure helper beside `buildRebaseOps` in `docOps.ts`, returning a `MutationOp` in the shape the
file already emits at `:794`, built with the module-private `toPlain` (`:47`):

```
/** Ops that re-add entities present locally and absent from the target.
 *  Baseline-independent: it compares the two documents, never a heads baseline,
 *  which is the whole point — the baseline is the thing that lied. */
export function buildLocalOnlyCarryOps(local: Doc, target: Doc): MutationOp
```

**The exclusion list is a total map, so adding a collection without deciding is a compile error:**

```
/** Which collections may be carried across a lineage adopt.
 *  false is not a default — every entry is a decision, and a new collection
 *  fails to compile until someone makes one. */
const CARRY_LOCAL_ONLY: Record<CollectionName, boolean> = {
  // user work: carry
  transactions: true, accounts: true, activities: true, todos: true, /* …etc */
  // NEVER: credentials. driveConnections holds refresh tokens (docOps.ts:817-824)
  // and §1d reads remote driveConnections to heal, so carrying a dead one would
  // republish it fleet-wide — item 5's bug, made out of this plan's own parts.
  driveConnections: false,
  // NEVER: carries needs_reconnect, which §11 records as a cross-device amplifier.
  calendarConnections: false,
  // NEVER: a resurrected member feeds normalizeRoles owner promotion
  // (familyStore.ts:615-647) and §2c-ii's roster-owner lookup.
  familyMembers: false,
  // NEVER: device/sync bookkeeping, not user work.
  calendarEventLinks: false, notificationReads: false,
};
```

In the wholesale-install branch, compose **before** the single assignment, preserving the "compose
fully, install ONCE" invariant the block's comment at `:1145-1149` insists on:

```
const adopted = migrateDoc(remote);
const carryOps = carryFrom ? buildLocalOnlyCarryOps(carryFrom, adopted) : { op: null };
const withCarry = carryOps.op ? applyMutationOp(adopted, carryOps) : adopted;
currentDoc = stampNewGeneration ? Automerge.change(withCarry, stamp) : withCarry;
```

`applyMutation` is one `Automerge.change` (`docOps.ts:688-690`), so the carry lands atomically or
not at all, and a throw leaves `currentDoc` untouched by construction. No hand-rolled change
callback, no `structuredClone`, no non-null assertion.

Why this is safe, and more conservative than it looks:

- **Additive only.** The ids written are absent from the target by construction, so there is
  nothing to overwrite. No deletes, no field merges, no conflict resolution.
- **Referentially closed within the carried set**, and honest about the edge: anything a carried
  entity references is either present in the remote, or itself local-only in a carried collection
  and therefore also carried, or a member id in the excluded roster. That last case leaves the same
  dangling member reference an ordinary member deletion already produces, which the projection
  already renders as unassigned. The test pins it rather than the prose asserting it.
- **A false positive costs a zombie, not a loss.** The user deletes it again. Recoverable. Silent
  loss is not, and a latch is not.
- **It is what an ordinary merge already does.** A device whose peer's delete has not arrived keeps
  showing the entity. The wholesale adopt is the anomaly here, not the carry.
- **It never latches and never dead-ends.**
- **Cost on the common path is one `Object.keys` sweep** per clean adopt, on a document just
  decrypted and migrated. No second `migrateDoc`, no `Automerge.diff`.

No cap on the carried count, deliberately: any cap is a number nobody can justify, and the only
thing above it is the loss we are fixing. `count` rides to CloudWatch (§5c) so the distribution is
observable rather than guessed.

The lineage block stays as the fallback for exactly one case: `applyMutationOp` throwing. The
document is untouched on a throw, so raising `lineageBlockError('adopt-remote')` there is honest and
the banner's adopt exit still works, because that exit arrives as `user-file`, outside this scope.

**Tell the user.** After a successful carry, show a non-latching info toast naming the count. The
one place in this plan where a toast is correct and a banner would be over-alarming.

**5b. `commitRemoteBaseline` after an unreadable merge is ALREADY FIXED at HEAD.** (Renumbered in Pass 4.) `doSave`'s
pre-write catch does `if (isRemoteBlocker(e)) { …; throw e; }` (`syncService.ts:1849-1871`), and
`UnsupportedBeanpodVersionError` extends `PayloadLoadError` which `implements RemoteBlocker`
(`types/sync.ts:286`, `:441`), so it refuses the save and never reaches
`commitRemoteBaseline(exportedHeads)` at `:1981`. The work is a **regression test plus a
tripwire**: a test that `doSave` throws and commits no baseline on that error, and a test pinning
`isRemoteBlocker(new UnsupportedBeanpodVersionError('5.0')) === true` so a refactor of the error
hierarchy cannot silently re-open the 0.16 hole.

**5c. Observability.** (Renumbered in Pass 4; the `adopt-rescued` event is gone with the branch
that would have emitted it.) `surface: 'pod-lineage'` gains `action: 'adopt-carried-local-only'`
with `count` = carried entities, and `action: 'adopt-carry-failed'` at `warn` when the carry throws.
Both use `count`, already allowlisted.

### 6. Version floor

- `web/public/min-app-version.json`: `promptBelowVersion` `"0.16"` to `"0.17"`.
- **Append to the `reason` string, do not replace it.** It carries two facts a future editor needs
  ("Not rendered anywhere. For whoever edits this file, and for telemetry"), and `_docs` points at
  the runbook. Add the compaction hazard after them.
- **One script, two one-line invocations.** Both deploy skills state the same principle ("Two
  design principles" 2): compound logic goes into a script under `scripts/deploy/`, and skills
  invoke scripts rather than orchestrating them. Add `scripts/deploy/check-version-floor.sh`, which
  prints the current `promptBelowVersion` and the `APP_VERSION` being shipped, and invoke it from
  the existing Phase 1 Step 4 decision gate in each skill, folded into the question greg already
  answers about the version bump. Two prose copies of the same policy in two 200-line files is a
  drift waiting to happen.

**Note for greg (do not silently "fix"):** `versionPolicy.ts` has only `promptBelowVersion`
(`:42-43`, `:162`); there is no hard-block field, so this prompts but cannot force. Given a 0.16
device can silently destroy post-compaction edits, a blocking floor is arguably justified, but
adding one is a product decision with real lockout risk (a bad predicate strands users, and native
users cannot update instantly). This plan raises the prompt floor and **flags the block as a
separate decision** rather than inventing it inside a bug-fix plan.

### 7. `buildInviteLink`

`inviteService.ts:159` builds the join URL from `globalThis.location?.origin`, so an invite shared
from the iOS app carries `capacitor://…`. Switch to `shareableOrigin()`.

**The reason this was deferred no longer applies.** The stated blocker was that its fallback is the
marketing apex while `/join` lives on `app.beanies.family`. `shareableOrigin()`'s fallback is
already `https://app.beanies.family` (`shareableOrigin.ts:21`, returned at `:26` and `:43`). So it
is a one-line swap with the hardcoded fallback deleted, not a change to shared behaviour.

Add unit tests for the native (`capacitor:` origin) and absent-`location` cases, mirroring
`utils/__tests__/shareableOrigin.test.ts`. greg's device check stays a manual step.

### 8. Reconnect surface on public routes

**Pass 2 correction: the Pass 1 draft named the wrong component.** `PodAccessBanner` is mounted at
`App.vue:2214` **inside** `<div v-if="showLayout">` (`:2190`), and `/recipe` is `noChrome: true`
(`router/index.ts:364`), which `shouldShowAppLayout` treats as "no shell" (`App.vue:376-381`). It
cannot render there.

The surface that can is `UnifiedReconnectToast` (`App.vue:1926`), in the always-mounted toast stack
outside the layout, gated only on `!authStore.needsAuth`. That matches greg's report exactly,
including that it does not recur once the recipe is added.

**Pass 3: add a computed, do not redefine the existing one.** `useReconnectCoordinator.ts:141`
reads `activeReconnectPrompt.value?.variant` inside `reconnectAll` to label its telemetry. Nulling
it on external landing routes silently changes that event to `'none'`. Keep
`activeReconnectPrompt` as the STATE and export a second computed as the DISPLAY question:

```
/** Display-only. The underlying state is untouched, so the prompt appears the
 *  moment the user navigates to a real app route — this is a suppression, not a
 *  cancellation. */
const visibleReconnectPrompt = computed(() =>
  isExternalLandingRoute(route) ? null : activeReconnectPrompt.value
);
```

Declared in `UnifiedReconnectToast.vue`, rebinding all four references (`:21` destructure stays,
`:26`, `:32`, `:33`), so `useReconnectCoordinator.ts` and its test have a zero-line diff. The two
names are the comment:
nobody reading `visibleReconnectPrompt` thinks the reconnect was cancelled. `useRoute()` inside a
component is unremarkable. (`useRoute()` in a composable is established here too
(`useJoinFlow.ts:298`, `useMobileMenu.ts:47`,
`useQuickAddIntent.ts:76` and four more), and `useReconnectCoordinator` has exactly one consumer
today, which is component-scoped.

Use the exported `isExternalLandingRoute` (`ShareTarget`, `SharedRecipe`), not
`PUBLIC_ENTRY_ROUTE_NAMES`, which is module-private (`appChrome.ts:79`), and not the broader
`isPublicEntryRoute`, which also covers `OpenFromDrive` and `Login`, where a reconnect prompt is
legitimate and suppressing it would create a dead end (`appChrome.ts:93-99`).

### 9. Blocker latches as banners — one component, seven conditions

`BackgroundSyncBar.vue:47-51` announces a session-ending latch in a 4s toast, and its own comment
at `:40-46` admits it is the only place any of it reaches the user.

**The memory latch is not a special case.** `podTooLarge.inline` maps to
`backgroundSyncErrorKind: 'decrypt'` in `BLOCKER_BANNER_KIND` (`syncStore.ts:255-276`), with
`podCorrupted`, `podCredentialStale`, `podUnreadable`, `podNewerVersion`, `podOlderVersion` and
`podMerge.failedInline`: **seven keys, corrected from Pass 3's six**. `lineage` has
`LineageBanner` and `local-unreadable` has
`LocalDocUnreadableBanner`; `decrypt` has **no banner at all**. A memory-only banner would leave
five session-ending latches speaking only through a 4-second toast, and would be the third
near-copy of the same component.

Build one `PodUnreadableBanner.vue` in the established house pattern: state and dismissal from the
shared latch composable; chrome from `ErrorBanner` + `BannerActionButton`, `severity="notice"`;
title from the existing `sync.podUnopenable` (`uiStrings.ts:4324`); message from
`t(syncStore.podBlockMessageKey)`, the same key the toast already passes as its detail, so all six
conditions get honest copy with no new strings and no ternary; actions "Try again"
(`action.tryAgain`, `:3804`) and "Dismiss" (`action.dismiss`, `:1378`).

**The retry is already built.** `syncStore.backgroundSyncFromFile(undefined, { manual: true })`,
which performs the half-open retry by calling `syncService.retryAfterRemoteBlock()` at
`syncStore.ts:3561`. (There is no `syncStore.retryAfterRemoteBlock`; the Pass 1 draft named one.
The function lives at `syncService.ts:233`.) Feed the returned `RefreshOutcome` through the
existing pure `presentRefreshOutcome` and show the toast it returns, exactly as
`AppHeader.vue:218-220` does; try/catch with `sync.backgroundError` on a throw, matching
`AppHeader.vue:236-238`.

**The retry is honest for five of the seven kinds, and that is acceptable.**
`podNewerVersion.inline` and `podOlderVersion.inline` also map to `decrypt`
(`syncStore.ts:257-259`), and no number of retries lets a client read a pod version it cannot
parse. Do **not** add a per-kind action table: that is the switch-that-grows this section exists to
avoid. The accepted behaviour is that a retry on a version block half-opens, fails identically, and
re-latches with the same honest message, which the `message` binding already carries. Pin it with a
test so a future refactor cannot turn the re-latch into a silently vanishing banner.

**Pass 3: `useBlockerBanner` gets an EXTRACTION, not a discriminator.** Pass 2 proposed an
`action: 'adopt-remote-file' | 'retry-remote-read'` discriminator. Two reasons that is wrong: it
makes `useTheFamilyFile` a function that sometimes does not use the family file, and it is a switch
with one arm per future banner in shared code. The header at `:14-21` rejected splitting, but read
its reason: "these two components are the only ones in the repo that carry a `dismissed` flag AND
the only ones that call `useRemoteFileOverLocalDocument`, so the second composable's consumer set
is exactly the first's". A third consumer that carries `dismissed` and does NOT adopt is exactly
what breaks that premise. Update the header to record what changed, then:

- Extract `useBlockerLatch(kind)` returning `{ blocked, dismissed, busy }`: the `computed` at
  `:49-51`, the re-arm `watch` at `:59-61`, and the `busy` ref at `:48`, verbatim. **Pass 4 added
  `busy`**: all three banners need it and the claim-before-await rule at `:73-77` applies to all
  three.
- `useBlockerBanner` calls it and spreads the result. **Its exported signature and return type do
  not change**, so `LineageBanner.vue:52` and `LocalDocUnreadableBanner` are not edited at all.
- `PodUnreadableBanner` uses `useBlockerLatch` plus its own local `busy` ref around the retry,
  applying the same claim-before-await rule the composable documents at `:74-77`.

A fourth banner with a fourth exit then needs no edit to any shared file. That is the test of a good
extension shape, and a discriminator fails it.

**Remove the competing toast, but only for the kind that gains a banner, and mount the banner where
the toast was.** Two facts settle this:

- `BackgroundSyncBar` is at `App.vue:1931`, **outside** `<div v-if="showLayout">` (`:2190`), so its
  toast is currently the only surface a `decrypt` latch has on Login, LoadPod, Join, CreatePod,
  OpenFromDrive, ShareTarget and SharedRecipe (`router/index.ts:82, 88, 94, 101, 303, 319, 346,
364`).
- The existing blocker banners are **inside** the layout (`:2225-2226`), so they never render there.

Mounting `PodUnreadableBanner` at `:2224-2226` and deleting the toast arm would leave a whole route
class with no surface at all: strictly worse than the toast being replaced. So:

- Mount `PodUnreadableBanner` beside `OfflineBanner` (`App.vue:1915-1916`), the always-mounted,
  in-document-flow banner slot. `ErrorBanner.vue:9-13` states it renders inline and is not
  `position: fixed`, so it belongs in flow rather than in the fixed toast stack.
- In `BackgroundSyncBar.vue:47-51`, suppress **only when a banner is actually up** (Pass 4, C8):
  `if (syncStore.podUnopenable && kind && BANNERED_BLOCKER_KINDS.has(kind)) return;`
  The `kind &&` is required, not cosmetic: `backgroundSyncErrorKind` is nullable (`syncStore.ts:719`)
  against a `ReadonlySet<NonNullable<...>>`. The set is exported from `syncStore` next to
  `BLOCKER_BANNER_KIND` so "which kind" and "which surface owns it" stay in one file:
  `export const BANNERED_BLOCKER_KINDS: ReadonlySet<NonNullable<BackgroundSyncErrorKind>> = new Set(['decrypt']);`
  `lineage` and `local-unreadable` keep their toast exactly as today, because their banners are
  in-layout and removing the toast would take coverage away from them too. When either banner moves
  out of the layout, it is one entry in that set, with the reason written next to it.
- Update the bar's comment at `:42-46`, which asserts the toast is the only place this reaches the
  user; that becomes false for `decrypt` and stays true for the other two.

Add a mounted test asserting the banner renders for a `podTooLarge.inline` block and that its retry
calls `backgroundSyncFromFile` with `{ manual: true }`, matching `localDocUnreadableBanner.test.ts`.

### 10. Already applied during investigation (recorded, not re-done)

- 115 `beanie` values on important surfaces rewritten to real nouns; guard test
  `uiStrings.test.ts` "important-surface beanie values"; rule added to `CLAUDE.md`, the theme
  skill, and the CIG.
- The compaction "Check Again" retry button.

### 11. Explicit non-goals (recorded so they are not silently dropped)

- **`calendarSyncStore.ts:699-707` writes `needs_reconnect` into the shared document**, so one
  member's dead calendar token raises a reconnect surface on every device of every member. A real
  cross-device amplifier of item 5, out of scope: fixing it changes what the document stores, which
  is a schema decision. File separately.
- **Root cause 4 (wrong-member token adoption, `syncStore.ts:2234-2237`, `:5412-5470`)**, the
  "Signed in with shows my sister" symptom. An identity-resolution change touching the
  account-binding heal; its own plan, its own soak. Item 9's self-correction on hard refresh means
  it is not silently destructive.
- **A hard-block version floor.** See §6.
- **Removing the `ownerMemberId` compat fallback from the Lambda guard.** Stays until the fleet is
  past the version shipping Stage 4; a one-line follow-up. The Stage 2 comment names the version.
- **A cap on the §5b carry count.** Deliberately not invented; `count` telemetry makes the
  distribution observable first.

## Implementation Stages

**Pass 3 added this section.** The Pass 2 plan was one change set across auth, registry, sync-gate,
lineage and UI, containing a client/Lambda migration described as "must ship together". That
release cannot exist: the Lambda, the web bundle and two native store builds deploy on three
cadences, and the Lambda's own comment says so (`index.mjs:243-247`). It is also unnecessary.

Each stage is shippable alone, revertible alone, and is either a no-op or a strict improvement in
isolation. Ship in this order. Do not merge stages.

| #   | Stage                             | Contents                                                                                   | Safe alone because                                                                                                                                                        |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Auth** (greg's stated priority) | §1a §1b §1c §1d §1e                                                                        | Touches nothing outside the Google token layer. Each fix independent.                                                                                                     |
| 2   | **Registry server, compatible**   | §2d-i                                                                                      | No client sends `writerMemberId`, so the guard is byte-identical. `ConsistentRead` and the tombstone are invisible to clients. The DELETE ladder warns and still deletes. |
| 3   | **Client, no wire change**        | §2a §2b §2e §3 §4 §7                                                                       | Pure client fixes, no server contract change. §2e's `res.ok` check is what makes stage 7's 403 visible when it arrives.                                                   |
| 4   | **Registry wire, additive**       | §2c-i, plus `writerMemberId` on the DELETE from both `SettingsPage` and `dataBridge.ts:64` | Writer and owner ids are the same value today, so the server's `??` resolves identically.                                                                                 |
| 5   | **Registry semantics**            | §2c-ii (owner fields from the roster)                                                      | The guard has been on `writerMemberId` since stage 2 and every client has sent it since stage 4. No window in which the guard is off.                                     |
| 6   | **Preservation**                  | §5a §5b §5c §5d                                                                            | Scoped to `adopt-remote × clean`; every other lineage path byte-identical. Falls back to today's behaviour on any failure.                                                |
| 7   | **Surfaces + enforcement**        | §8 §9 §6, and §2d-ii (DELETE 403)                                                          | Banner work is UI-only. The 403 lands last, against a fleet sending `writerMemberId` since stage 4 and past a floor raised in the same stage.                             |

Stage 1 may ship the day it is written. Stages 2 and 3 are independent of each other and of stage 1.
Stage 6 is independent of the whole registry ladder. Only 4-before-5 and 4-before-7's 403 are
ordered, and both are the natural deploy direction anyway.

## Files Affected

- `src/services/google/googleAuth.ts` — remove the two reconnect revokes, comment the four
  survivors, fix the false comment at `:2106-2108`, gate the escalation counter on
  `isRefreshRejection`
- `src/services/google/refreshFailure.ts` (+ its existing test) — new `isRefreshRejection`
  predicate, one home for the 4xx-versus-5xx distinction
- `src/services/google/googleRevoke.ts` — comment naming the surviving triggers
- `src/services/google/driveTokenRecovery.ts` — `tryReconnectSilently` step 3, dynamic import only,
  header updated with the one new dependency
- `src/services/sync/syncService.ts` — `readRemoteDriveConnections()` (connections, never a doc;
  `getValidTokenSilent` only); `isFullySynced` becomes `syncLevel`
- `src/services/sync/__mocks__/syncService.ts` — `isFullySynced` mock becomes `syncLevel`
- `src/stores/syncStore.ts` — `buildRegistryPayload` writer/owner split (staged),
  `listGoogleDriveFiles` silent option, delete `disconnect()`, remove all `lastSyncTimestamp`
  writes, export `BANNERED_BLOCKER_KINDS` beside `BLOCKER_BANNER_KIND`
- `src/types/models.ts` — `Settings.lastSyncTimestamp` becomes `?: never` with a `@deprecated`
  tombstone
- `src/services/familyContext.ts` — delete the whole step-8 remote-registry block, renumber
- `src/pages/SettingsPage.vue` — explicit awaited `removeFamily` with a surfaced failure on the
  full-deletion path; drop `!isNative()`; `TokenExpiredError` branch in the existing catch
- `src/services/registry/registryService.ts` — `writerMemberId` on the payload type and on the
  DELETE query string, `removeFamily` checks `res.ok` and returns a boolean, put/delete/refused
  telemetry on the existing `registry` surface
- `src/services/e2e/dataBridge.ts` — pass `writerMemberId` on the cleanup DELETE (stage 4), so the
  stage-7 enforcement does not silently break E2E teardown
- `infrastructure/lambda/registry/index.mjs` + `index.test.mjs` — guard on `writerMemberId` with a
  compat fallback, `ConsistentRead`, tombstone, DELETE ladder (warn in stage 2, 403 in stage 7),
  two stale comments corrected
- `src/services/automerge/worker/applyAndProject.ts` — scoped adopt rescue; scoped local-only carry
- `src/services/automerge/worker/docOps.ts` — `localOnlyEntityIds`
- `src/composables/usePodCompaction.ts` — `cannot-verify` refusal code, `RETRYABLE` set, total
  `REFUSAL_FOR` map over `SyncLevel`
- `src/services/crypto/inviteService.ts` — `shareableOrigin()`
- `src/composables/useReconnectCoordinator.ts` — new `visibleReconnectPrompt` computed;
  `activeReconnectPrompt` unchanged
- `src/components/common/UnifiedReconnectToast.vue` — bind `visibleReconnectPrompt`
- `src/composables/useBlockerLatch.ts` — new; the `blocked` + `dismissed` + re-arm half
- `src/composables/useBlockerBanner.ts` — build on `useBlockerLatch`; public signature unchanged;
  header updated to record what broke the "one composable, not two" premise
- `src/components/common/PodUnreadableBanner.vue` — new, thin
- `src/components/common/BackgroundSyncBar.vue` — suppress the toast for `BANNERED_BLOCKER_KINDS`
  only; comment corrected
- `src/App.vue` — mount `PodUnreadableBanner` beside `OfflineBanner` (`:1915-1916`), outside the
  layout, so it covers `noChrome` routes
- `src/services/translation/uiStrings.ts` — `compaction.refused.cannot-verify` and the §5b carry
  toast
- `web/public/min-app-version.json`
- `scripts/deploy/check-version-floor.sh` — new
- `.claude/skills/deploy-prod-auto/SKILL.md`, `.claude/skills/deploy-prod-skip-ci/SKILL.md` — one
  line each, invoking the script from the existing Phase 1 Step 4 gate
- Tests alongside each of the above

**Not affected, contrary to the Pass 1 draft:** `CompactionProgressModal.vue`,
`src/utils/diagnosticContext.ts`, `infrastructure/lambda/telemetry/index.mjs`,
`docs/runbooks/native-store-submission.md`, `PrivacyInfo.xcprivacy`, `privacy.astro`.

**Not affected, contrary to the Pass 2 draft:** `LineageBanner.vue` and
`LocalDocUnreadableBanner.vue`. The `useBlockerLatch` extraction keeps `useBlockerBanner`'s
signature identical, so both shipped banners have a zero-line diff. If either appears in the diff,
the extraction was done wrong.

## Observability Coverage

Every event uses a context key **already allowlisted in both mirrors**
(`src/utils/diagnosticContext.ts:61-321`, `infrastructure/lambda/telemetry/index.mjs:66+`):
`action`, `count`, `detail`, `error_code`, `http_status`. Deliberate: the Pass 1 draft proposed four
new keys, each requiring an edit to both allowlists, the handler test, the store-submission runbook,
`PrivacyInfo.xcprivacy`, the Data-Safety answers and `privacy.astro`, for information the generic
keys already carry.

- **`surface: 'registry'`** gains `action: 'put' | 'put-failed' | 'delete' | 'delete-failed' |
'refused'`, with `count` = 1 when owner fields came from the roster and 0 when omitted, and
  `http_status` on the failure arms. Closes the blind spot that forced Lambda-log archaeology and
  the two silent failures at `registryService.ts:127-135` and `:178-186`.
- **Lambda `console.warn('[registry] delete would be refused', …)`** (stage 2) is the gate on stage 7. Enforce only once that warn is quiet for real families for a full release cycle. This is the
  one measurement in the plan that decides a ship date, so it is called out rather than left
  implicit.
- **`surface: 'google-token-lifecycle'`** gains `action: 'revoke-skipped'` at each of the two sites
  where a reconnect revoke previously fired, so the rate of avoided whole-grant revokes is
  measurable rather than inferred from the absence of pain.
- **`surface: 'drive-token-silent-reconnect'`** (`driveTokenRecovery.ts:321`) gains
  `action: 'healed-from-remote'` when §1d step 3 adopts a token the local doc could not see, and
  `action: 'remote-read-unavailable'` at `info` when the read could not run because the credential
  was wholly dead. The pair measures root cause 2 AND assumption 6, so an inert step 3 shows up as
  one number instead of being rediscovered later.
- **`surface: 'pod-lineage'`** gains
  `action: 'adopt-carried-local-only'` (`count` = carried entities) and
  `action: 'adopt-carry-failed'` at `warn`. `count` is what a future cap decision would be argued
  from.
- **`surface: 'pod-compaction'`** `action: 'refused'` gains `error_code: 'cannot-verify'`.
- **Failure modes now covered that were blind:** forced-consent storms; registry identity takeover
  (`count: 0` on a put should become rare once stage 5 ships, `refused` should drop to zero for
  owner devices); a registry DELETE failing the new gate (`delete-failed` + `http_status: 403`,
  previously invisible); straggler data rescued or carried against `adopt-carry-failed`; false
  compaction refusals.
- **Critical versus firehose:** none are `severity: 'critical'`. Registry `refused`, `put-failed`,
  `delete-failed` and lineage `adopt-carry-failed` are `warn`; the rest `info`. The only
  `reportError` added is the §2a full-deletion registry failure at `severity: 'warning'`, because
  the user is simultaneously being told their data is gone.

## Acceptance Criteria

- [ ] Every stage in `## Implementation Stages` was shipped on its own commit and could have been
      released on its own; no criterion below requires two stages in one release
- [ ] No `revokeGrant` call remains with `trigger: 'reconnect'`; all four surviving revokes in
      `googleAuth.ts` plus the calendar one carry a justifying comment; the false comment at
      `googleAuth.ts:2106-2108` is corrected
- [ ] Reconnect still forces consent (the refresh-token invariant is preserved), and the §1e audit
      list is recorded in the Outcome section
- [ ] Silent-refresh escalation increments only on a 4xx rejection; 5xx, network, timeout and
      unknown never increment; the counter still resets on success; the rule lives only in
      `refreshFailure.ts`
- [ ] A lineage-blocked device that can still read Drive adopts a newer mirrored token via
      `tryReconnectSilently` without prompting; a device with a dead credential returns false with
      behaviour unchanged and emits `remote-read-unavailable`; `googleAuth` still imports nothing
      from `driveTokenRecovery`, and `driveTokenRecovery` gains no module-scope import of
      `syncService`
- [ ] `deleteLocalFamily` issues no registry DELETE and contains no empty try/catch; the
      full-family deletion path does, awaited, before auth teardown, with a surfaced failure; the
      picker's "The original file is not affected" copy (`uiStrings.ts:6134`) is now true
- [ ] `syncStore.disconnect()` is gone and both comments that cite it are corrected
- [ ] The registry payload carries `writerMemberId` (stage 4) and, from stage 5, sources owner
      fields from the roster owner and omits them when unknown
- [ ] The Lambda guards on `writerMemberId` with an `ownerMemberId` compat fallback, uses
      `ConsistentRead`, and tombstones on DELETE; a deployed pre-fix client is still accepted; the
      DELETE ladder warns in stage 2 and refuses in stage 7; `dataBridge.ts` sends `writerMemberId`
      before stage 7 ships; tests cover every arm
- [ ] `Settings.lastSyncTimestamp` is `?: never` with a tombstone comment, no site writes it, and a
      test asserts a stored value survives a `saveSettings` round-trip untouched
- [ ] Compaction is not refused `not-synced` when the device is genuinely level; `cannot-verify`
      exists with honest copy and reuses the existing retry button with no component change; the
      `SyncLevel` mapping is a total `Record` so a new level fails to compile
- [ ] Drive restore renders on native, with a unit test under `isNative` true, and a
      `TokenExpiredError` routes to `useGoogleReconnect`
- [ ] An `adopt-remote` + `clean` with replayable local ops rebases; with local-only entities it
      CARRIES them into the adopted document and never latches; an ordinary adopt is byte-identical
      to today; **both `user-file` adopt cells are byte-identical to today and no new refusal can be
      raised on them**; the `same` POLICY row is unchanged
- [ ] Regression tests pin that `doSave` refuses and commits no baseline on an
      `UnsupportedBeanpodVersionError`, and that the error satisfies `isRemoteBlocker`
- [ ] `buildInviteLink` uses `shareableOrigin()` with no local fallback, with tests
- [ ] No Google reconnect surface renders on `SharedRecipe` or `ShareTarget`; the suppression is
      display-only and `activeReconnectPrompt` (and `reconnectAll`'s telemetry variant) is unchanged
- [ ] All six `decrypt`-kind blockers render a persistent banner with a working retry, **on every
      route including `noChrome` ones**; a version-kind block re-latches with the same message
      rather than clearing; the `decrypt` toast is removed while `lineage` and `local-unreadable`
      toasts are untouched
- [ ] `LineageBanner.vue` and `LocalDocUnreadableBanner.vue` have a zero-line diff
- [ ] `promptBelowVersion` is `0.17`, the existing `reason` note is preserved, and both deploy
      skills prompt about the floor via one shared script
- [ ] Diagnostic logging implemented using only already-allowlisted context keys; no change to
      either allowlist, the runbook, or the privacy declarations
- [ ] `npm run type-check`, lint, stylelint and the full unit suite pass

## Testing Plan

1. Unit: the escalation counter does not increment on network, timeout, unknown or 5xx; it does on
   a 4xx; it resets on the next success. `isRefreshRejection` has its own table-driven test beside
   `isPermanentRefreshFailure`.
2. Unit: `tryReconnectSilently` adopts a remote token when the pod is latched and the Drive read
   succeeds; returns false without throwing when the read fails; and **never calls a
   consent-capable token getter** (assert `getValidToken`/`requestAccessToken` are not called).
3. Unit: `buildRegistryPayload` sends `writerMemberId` from the session (stage 4); sources owner
   fields from the roster owner and omits them with no roster (stage 5).
4. Lambda: a PUT from a non-owner device carrying the roster owner's `ownerMemberId` but a different
   `writerMemberId` is refused the pointer; a pre-fix client sending only `ownerMemberId` behaves as
   today; a PUT after a tombstoned DELETE restores `createdAt` and owner; a DELETE without
   `writerMemberId` warns and still deletes (stage 2) and is refused 403 (stage 7).
5. Unit: `deleteLocalFamily` issues no registry DELETE; the full-deletion path does and surfaces a 403.
6. Unit: `removeFamily` returns false and emits `delete-failed` on a non-2xx.
7. Unit, the scope guard, and this is the one that must not be dropped: `ours-newer × user-file`
   and `conflict × user-file` adopts are byte-identical with local-only entities present and with
   replayable ops present. Neither rescues, neither carries, neither blocks.
8. Unit: `adopt-remote × clean` with replayable ops takes the rebase branch; with local-only
   entities carries them and counts the carry; with neither adopts unchanged; `same` unchanged.
9. Unit: `localOnlyEntityIds` over two hand-built docs: empty-remote, identical-docs (returns
   empty), and a remotely-deleted-entity case (returns it, the documented false positive).
10. Unit: a throw inside the carry leaves the document untouched and raises the lineage block, and
    the subsequent `user-file` adopt succeeds, proving the exit is not closed.
11. Unit: `doSave` throws and commits no baseline after an `UnsupportedBeanpodVersionError`;
    `isRemoteBlocker` accepts that error.
12. Unit: `canRestoreFromDrive` is true under `isNative` mocked true; a `TokenExpiredError` from
    `listGoogleDriveFiles` reaches `useGoogleReconnect`.
13. Unit: `buildInviteLink` under a `capacitor:` origin and under absent `location`.
14. Unit: `syncLevel` returns `cannot-verify` on an unknown probe and `level` when genuinely level;
    the gate maps each via `REFUSAL_FOR`.
15. Unit: a settings document carrying a stored `lastSyncTimestamp` still carries the same value
    after an unrelated `saveSettings`.
16. Mounted: `PodUnreadableBanner` renders for `podTooLarge.inline` and `podCorrupted.inline`; its
    retry calls `backgroundSyncFromFile(undefined, { manual: true })`; dismissal re-arms on a new
    block; a `podNewerVersion.inline` retry re-latches and the banner is still shown with the same
    message.
17. Mounted: with the route set to a `noChrome` route, a `decrypt` block still renders
    `PodUnreadableBanner`. The regression test for the coverage hole §9 closes.
18. Unit: `BackgroundSyncBar` toasts for `lineage` and `local-unreadable` and not for `decrypt`.
19. Unit: `visibleReconnectPrompt` is null on `SharedRecipe` and non-null on `Dashboard` with the
    same store state; `activeReconnectPrompt` is non-null in both.
20. Manual (greg, on device): an iOS invite link opens `/join`; a shared recipe link shows no
    reconnect toast; the A7 memory banner persists and its retry works; re-consent frequency drops.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the nine root-caused findings, with defence-in-depth on
  the registry because its trigger is not fully identified.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the code rather than the
  investigation. Removed §5b as already shipped (`syncService.ts:1849-1871`); replaced §5a, which
  was provably a no-op because the rescue diff is driven by the same lying baseline
  (`applyAndProject.ts:884` + `:829`); re-targeted §8 from `PodAccessBanner`, which cannot render on
  a `noChrome` route, to `UnifiedReconnectToast`; reversed §1b, which contradicted the documented
  reconnect-every-launch fix at `useGoogleReconnect.ts:48-51`; corrected §1c, whose gate would have
  disabled escalation entirely; relocated §1d into `driveTokenRecovery`. Generalised the memory
  banner from one condition to all six `decrypt`-kind blockers over the existing
  `useBlockerBanner`/`ErrorBanner` pattern, with zero new strings. Removed `CompactionProgressModal`,
  both telemetry allowlists and the whole privacy-declaration chain from the blast radius by reusing
  already-allowlisted keys. Added the `writerMemberId` guard migration without which §2c silently
  removes the canonical-pointer guard, the DELETE wire change without which §2d cannot be
  implemented, the five other `lastSyncTimestamp` write sites, and three genuine silent failures.
- **Pass 3 (Sustainability)**: Broke the plan into seven independently shippable stages and deleted
  the "§2c and §2d must ship together" coupling, which described a release that cannot exist given
  the Lambda's and the native builds' separate cadences (`index.mjs:243-247`); the same outcome is
  reached by an additive-field-then-meaning-change ladder. Found that §5a and §5b, written against
  `act === 'adopt'`, also covered the two `user-file` adopt cells (`podLineage.ts:174-176`), where a
  refusal would have closed the only exit the banner offers (`podLineage.ts:154-158`,
  `LineageBanner.vue:22-27`), and scoped both to `adopt-remote × clean`. Replaced §5b's refusal with
  an additive carry of local-only entities: a refusal preserves nothing (against requirement 5),
  latches the device (`podLineage.ts:110-113`), and treats an expected false positive (deletes are
  hard, `docOps.ts:613-615`) as grounds for stopping sync. Replaced §9's `action` discriminator with
  a `useBlockerLatch` extraction, so shared code gains no switch and the two shipped banners have a
  zero-line diff. Caught that mounting the new banner inside `showLayout` while deleting the
  `BackgroundSyncBar` toast would remove the only `decrypt` surface from every `noChrome` route
  (`App.vue:1931` versus `:2190`), and moved the mount beside `OfflineBanner` with the toast
  suppressed per-kind. Corrected §1c, whose `'http'` gate still escalated a 5xx against
  `refreshFailure.ts:8`'s stated contract. Narrowed §1d's new read to `readRemoteDriveConnections()`
  behind a dynamic import with `getValidTokenSilent` only. Changed §3a from deleting
  `Settings.lastSyncTimestamp` to `?: never` with a `@deprecated` tombstone, the house idiom on this
  type. Added `visibleReconnectPrompt` rather than redefining `activeReconnectPrompt`, which
  `useReconnectCoordinator.ts:141` reads for telemetry. Added three unlisted files the change set
  breaks (`__mocks__/syncService.ts:130`, `dataBridge.ts:64`, `refreshFailure.ts`), noted the
  seventh `lastSyncTimestamp` write site, made the `SyncLevel` mapping a total `Record`, and moved
  the deploy-floor question into one script per the skills' own principle 2.
- **Pass 4 (Fresh-eyes sweep)**: Compiled every sketch against the real code; nine corrections were
  blocking, listed in full as C1-C9 under `## PASS 4 CORRECTIONS`. Deleted §5a's adopt rescue as
  provably unreachable inside its own scope. Rewrote the carry, which named a function that does not
  exist and cloned Automerge values with the wrong tool, onto the file's own `toPlain` + `set` op +
  `applyMutation`. **Excluded the credential and roster collections from the carry**, without which
  this plan would have republished dead refresh tokens that its own §1d then reads to heal. Caught
  that §1c would have silently switched escalation off, because the OAuth proxy throws without the
  status the new predicate matches on. Corrected §1d's API name and its insertion shape, §9's
  suppression predicate (two non-latching `decrypt` paths would have lost their only surface), and
  §8's placement (six tests). Found the tombstone's unlisted consumer, the founder-metrics scan.
  Corrected five counts, added the registry pre-flight and post-ship ops steps that actually
  complete the row repair, and recorded the issue-#62 trade-off §1a was silently accepting.

## Outcome (2026-09-09, second session)

**Six of seven stages shipped to `main`. Nothing deployed.** Stage 2 `f9e3bda6`,
stage 1 §1d `b80adc69`, stage 7 §8/§9 `4a9b524e`, stages 4+5 `623b908d`.

Deviations from this plan, each deliberate:

- **Stage 6 was not built.** greg's decision, twice. The ready-to-execute version
  is `docs/plans/2026-09-09-stage-6-preservation-brief.md`.
- **Stages 4 and 5 share one commit.** Separable on the wire, not in a release:
  both are client-side and reach a device in the same bundle however they are
  committed. The ordering hazard this plan guards against (5 without 4) cannot
  occur for that same reason.
- **§2d-ii (the DELETE 403) is not shipped.** This plan gates it on a measurement
  — the Lambda's warn must be quiet for real families for a full release cycle —
  and that cannot be satisfied on the day the warn ships.
- **§6's `promptBelowVersion` stays `0.16`.** The acceptance criterion says 0.17;
  it is superseded by the standing decision not to prompt before a version is live
  on both stores. 0.17 is TestFlight + Play open testing only.
- **The Lambda's compat fallback is presence-based, not `??`** as §2d-i sketched.
  With `??`, a current client sending `writerMemberId: null` would fall back to
  `ownerMemberId` — which from stage 5 is the ROSTER owner, a value any device
  holding the decrypted pod can compute — handing the guard's own answer to an
  unauthenticated writer. `'writerMemberId' in body` distinguishes "old client"
  from "no signed-in member"; only the first may fall back.
- **Owner fields are sent as `null` rather than omitted** when no roster owner
  resolves. The Lambda's preserve-on-omit is `existing.x ?? body.x ?? null`, which
  treats null and absent identically, so this satisfies §2c-ii's actual
  requirement (never substitute the local session) with no type churn.

⚠️ **DEPLOY ORDER: the stage-2 LAMBDA BEFORE the web bundle.** Against the old
server, stage 5's roster-sourced owner MATCHES the stored owner on every device,
so the pointer guard is neutered rather than tightened until the server catches
up.

**Still owed (ops):** re-verify `ownerMemberId` on greg's row `ae92950b` once both
halves are live; it was hand-NULLed and is re-claimable until a current client
stamps it.

A fourth `/code-review max` round over the third round's fixes found fourteen
findings, all fixed. See `docs/lessons.md` — widening a return type does not
migrate its callers, and this repo has no type-aware linting to catch it.

---

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-09-08, after the compaction run)

greg reported nine observations from compacting his family pod across devices: compaction
succeeded (4MB+ -> ~350KB); repeated false "ongoing changes being saved" refusals with a green
saved dot, asking for a retry button and a check of the validation; a "not enough memory to sync"
toast on the Tab A7 that then synced anyway; the family owner appearing to change to
joymaryministerio@gmail.com with no transfer performed; a todo created on a 0.16 device after
compaction vanishing on upgrade to 0.17; constant Google grant revocations and re-consent every
few hours across devices; beanie euphemisms obscuring meaning on important surfaces (the orange
lineage banner quoted verbatim), with a request to codify the rule; the native app offering only
a local file picker under "load another family data file"; "Signed in with" showing his sister's
gmail alongside a lineage-blocked message; and all of it clearing after a hard refresh. Asked for
a full investigation with context preserved to a file against a usage limit.

### Follow-up 1 — scope decisions

Investigate all; fix only the low-risk clearly-correct items; Google auth first if usage runs out.

### Follow-up 2 — resumed on a new model

Limit concurrent subagents; work token-efficiently.

### Follow-up 3 — decisions and autonomy

(1) approved, plus a comprehensive re-evaluation that we are not unnecessarily revoking grants or
forcing re-consent. (2) yes, and fix the registry row asap to its original state — family owner is
gregsophia@gmail.com — and harden the code so it can never happen again. (3) ok. (4) ok. (5) do
not refuse compaction while stragglers exist: we cannot reliably know when an older device
exists, and it is not reasonable to ask a family to track down every device ever used; do the
absolute best we can to preserve data and accept the residual risk. Also raise the minimum
version floor to 0.17 and update the deploy skills to ask about incrementing it every deploy.
(6) did not explicitly delete local data on mary's phone; understands 0.16 cannot preserve data
across a compaction + upgrade. Take these to /beanies-plan, approve, implement, then run
/code-review max and iterate until reliable. Work autonomously.

### Follow-up 4 — added scope

Also address `buildInviteLink`, the last unfixed instance of the iOS origin bug, deliberately left
because its fallback is the marketing apex rather than the app subdomain and invite -> join needs
its own device test.

### Follow-up 5 — added scope

A reconnect toast is also thrown when opening a shared recipe link; appears cosmetic and does not
recur once the recipe is added, possibly due to how that page is opened. Investigate and fix as
part of the plan.

</details>
