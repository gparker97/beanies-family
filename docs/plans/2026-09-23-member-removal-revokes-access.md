# Plan: Removing a family member actually revokes their access (tracker #77)

> Date: 2026-09-23
> Related issues: Notion tracker #77 (split from #76). No GitHub issue (tracker directive: do not create).
> Plan file: `docs/plans/2026-09-23-member-removal-revokes-access.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a family owner or manager, I want removing a family member to actually cut off their access to our pod (their saved credentials, their devices, their Drive access and any links they hold), and I want to be told honestly what removal did and did not achieve, so that "remove" means what it says for a product whose central promise is private, encrypted family data.

## Context

Tracker #77 was split out of #76 on 2026-08-27 after an adversarial audit found that an envelope-only tombstone closed one of six routes by which a removed member keeps access. The row's citations predate the login/auth rethink (PIN + recovery kit, 0.13), magic links (`memberLinkKeys`), `trustedAutoOpen` and the #82 keychain reconcile, so every route was **re-verified against HEAD `1879d53f` on 2026-09-23** by three research passes. Current state:

| #   | Route                                                                                                                                                                               | State today                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Envelope wraps.** `wrappedKeys[memberId]`, member-attributed `passkeyWrappedKeys` (keyed by credentialId; `value.memberId` optional), `deviceApprovalKeys[memberId]`              | **Open.** `familyStore.deleteMember` (familyStore.ts:535-609) touches none. `mergeKeyDict` is a `local-wins` union, so a local delete never propagates (envelopeMerge.ts:18-20). `retireMemberKeyMaterial` (used by unclaim) is local-only and is resurrected by the next merge.                                                                                                                 |
| 1b  | **Magic link** `memberLinkKeys[memberId]`                                                                                                                                           | **Closed.** `deleteMember` calls `syncStore.revokeMemberLink` (newest-wins overwrite tombstone) before deleting the row.                                                                                                                                                                                                                                                                         |
| 2   | **The removed member's own device.** Native keystore blob (`familyId:memberId`), PIN wrap (`deviceUnlock` `familyId:memberId`), `trustedAutoOpen` (per FAMILY), pod IndexedDB cache | **Open.** Nothing runs on their device. `invalidateSession` clears only `trustedAutoOpen`. #82's reconcile purges only ADOPTED blobs and needs the signed-in member in the roster. A removed member's **cold PIN unlock opens the pod** and `loadMembers` falls back to `owner.id` (familyStore.ts:396-401); the wrap is retained and the error reads "PIN changed elsewhere".                   |
| 3   | **Session gate.**                                                                                                                                                                   | **Partly open.** Password/PIN/tap-through/join check the roster. `signInWithPasskey` (authStore.ts:2162-2227) sets `isAuthenticated` with no roster check; `updateSessionWithMemberData` (authStore.ts:2279-2301) no-ops when the member is missing. A remote removal that does reach a session is classified `unknown-member`, an **integrity** rejection, i.e. reported as possible tampering. |
| 4   | **Drive.** Writer permission on the `.beanpod` and its parent folder (`useInviteFlow.ts:269,:283`; MeetTheBeansPage folder-share migration)                                         | **Open.** No permission-delete helper exists; permission ids are never stored; the share targets whatever email was typed in the invite wizard (not necessarily stored on the row). Scope is `drive.file`.                                                                                                                                                                                       |
| 5   | **Invites.** `inviteKeys` keyed by token hash, no memberId, not single-use, expiry client-side only (`inviteService.ts:31-35`)                                                      | **Open.** Never pruned. Device links (`linkMint.ts`, 15 min) live in the same dict.                                                                                                                                                                                                                                                                                                              |
| 6   | **Sync write-back.** `syncService` keeps its own `currentEnvelope` (syncService.ts:339)                                                                                             | **Mostly closed** by `syncStore.authoritativeEnvelope()` / `commitEnvelope`, but `setMemberWrappedKey` and `replaceEnvelope` still build from the possibly-stale `envelope.value`. Every new writer here goes through `authoritativeEnvelope()`.                                                                                                                                                 |
| +   | **DriveConnection.** The removed member's Drive refresh token, stored in the pod (`driveConnections`, keyed by account email)                                                       | **Open.** Never removed.                                                                                                                                                                                                                                                                                                                                                                         |

**The honest threat model.** Every member shares ONE family key and it has never been rotated (#117 not implemented; `keyId` only set at creation). A member who ever opened the pod has had that key in memory. Nothing in this plan can claw back a key, or data, a removed member already holds (including the app's own offline copy on their device). What this plan achieves:

- **Drive revocation is the hard control for FUTURE data**: without read access to the file they cannot fetch new versions, whatever key they hold.
- **Envelope tombstones** stop their password/passkey/approval/invite wraps from opening any future version of the file for anyone who can still fetch it, and stop legitimate clients from re-publishing them.
- **Device eviction** removes their key material from any device running a current client that can still see the removal (local-file families, devices shared with remaining members).
- **Session gates** stop an app session being created or kept for a removed member.
- **Honest copy** tells the remover exactly this, including that copies already taken are out of reach without key rotation (#117).

Originating instruction from greg (via #76): "yes, removing a member should remove the ability to unwrap the family pod with their password." Run instruction (2026-09-23): pre-plan → plan → build-auto, autonomously, stopping only for a showstopper.

## Requirements

1. **Durability pre-gate.** When the storage provider is Google Drive and `canDurablySaveNow()` is false (offline), removal is refused BEFORE any change with an actionable message ("reconnect to remove"). Local-file families are never blocked. **Exception — onboarding draft:** `CreateMembersStep` calls a separate action, `familyStore.discardDraftMember(id)`, not `deleteMember`. It deletes the row and retires device credentials. It does not run the pre-gate, write tombstones, touch Drive or do a durable save. It refuses and reports (`removal_refused { kind:'not-draft' }`) if the member has any attributed envelope entry, `pinHash`, `passwordHash` or `lastLoginAt`. `deleteMember` has no short path: a member who was invited but never joined still has a Drive share and a live invite, because the share is made at invite time (useInviteFlow.ts:266-283), so they must go through the full removal. The two actions share a private `removeMemberRow(id)`. `discardDraftMember(id): Promise<boolean>` keeps CreateMembersStep's boolean contract (CreateMembersStep.vue:108-118); a refusal returns `false`. (`CreateMembersStep` runs AFTER the pod is written, so a provider IS configured — CreateMembersStep.vue:6-15.)
2. **Authenticated removal record.** Removal writes a `removedMembers` entry (`{ id: memberId, removedAt, removedByMemberId }`) into the encrypted Automerge doc as a new per-key collection, so it is authenticated by the family key and CRDT-merges per member. It is the single authoritative fact "this member was removed", used by requirements 5-7. Never deleted.
3. **Propagating envelope tombstones.** A new optional envelope field `revokedKeys?: Record<string, EnvelopeTombstone>` where `EnvelopeTombstone = { revokedAt: ISODateString; wrapped?: string }`. Two key shapes:
   - `member:<memberId>` drops every entry attributed to that member in every registry dict (by dict key for member-keyed dicts, by `value.memberId` for `passkeyWrappedKeys`), including entries the remover never saw.
   - `<dictField>:<entryKey>` drops one slot (slot-wide). A value-pinned tombstone is keyed `<dictField>:<entryKey>:<wrapped>` (and carries `wrapped`) and drops only the entry whose `wrapped` equals it, so tombstones pinning different values never collide and a later re-wrap in the same slot survives.
   - An entry whose `wrapped === ''` holds no key material and is NEVER filtered. This keeps the `memberLinkKeys` newest-wins overwrite (deleteMember step 5) in the file, where it is what defeats an old client's live wrap (envelopeMerge.ts:125).

   Grow-only union; on a key collision the earliest `revokedAt` wins. Filtering runs in the merge (both return paths of `preserveLocalKeyDicts`), which every envelope replacement passes through. On removal the tombstones are `member:<id>` plus slot-wide `inviteKeys:<hash>` for EVERY `inviteKeys` entry (unattributable; expiry is checked only on the client, so an expired wrap still unwraps with its token — tombstoning all of them removes the clock dependency; invites and device links are re-issuable).

4. **Unclaim uses the same mechanism, value-pinned.** `unclaimMember` tombstones `wrappedKeys:<id>` and each attributed `passkeyWrappedKeys:<credId>` WITH `wrapped` = the current value, so the re-claim's new wrap (same member id, `wrapFamilyKeyForMember` → `setMemberWrappedKey`, syncStore.ts:3500-3548) is not filtered. A slot-wide or `member:` tombstone here would permanently lock out the re-claimed member. Tests: unclaim → re-claim → the new wrap survives merge; unclaim → re-claim → unclaim → the second wrap is also filtered.
5. **Device eviction reuses what exists.**
   - **Per-member:** move `familyStore.invalidateDeviceCredentials` (unchanged in behaviour) to `src/services/auth/deviceCredentials.ts` as `retireMemberDeviceCredentials(familyId, memberId)` — never-throwing, existing `reportError`s kept. Callers: `deleteMember`, `authStore.unclaimMember` (authStore.ts:1413), the roster watcher, eviction.
   - `retireMemberDeviceCredentials` adds a third guarded step after the PIN wrap: on native, `nativeDisable(familyId, memberId)` (idempotent without a record, `clearNativeRecord`, nativeBiometric.ts:1162-1188), covering a keychain blob that was never adopted. `removeAllPasskeysForMember` stays unchanged. No optional parameter.
   - **Family-level:** a new step list `SIGN_OUT_EVICTED_STEPS` in `signOutSteps.ts`, run by `runSignOutSteps`: `beginQuietTeardown` (new: `docClient.beginQuietTeardown()` without the force-save), `cancelReminders`, `resetSyncState`, `resetDocClient`, `resolveFamilyId`, `clearKeyCacheFamily`, `forgetLocalFamily`, `sweepHandoffFiles`, `clearKeptRecipe`; then `finalizeSession()`. `forgetLocalFamily` calls `familyContextStore.deleteLocalFamily(ctx.familyId)` and THROWS when it returns `false`, so the runner reports it (the store swallows errors, familyContextStore.ts:158-169). There is no `removeRosterFamily`: `deleteLocalFamily` already deletes the roster cache (familyContext.ts:238-241). `clearKeyCacheFamily` runs first so settingsStore's in-memory `cachedFamilyKeys` is not left stale (settingsStore.ts:929-935). The ctx passes `userAskedToClear: true` (no step in this list reads it; `deleteLocalFamily` already deletes the family database, familyContext.ts:151). The signOutSteps unit test asserts the list as data.
   - **Escalate** only when: the member is in `removedMembers`; no device credential remains for a live member of that family (`listPinUnlocks` + `resolveDeviceKeys`); and no live-member session exists. No "unsynced changes" condition: a removed member's edits have nowhere legitimate to go, and in a Drive family that condition could never clear. The decision is a pure `shouldEvictFamily({ memberIsRemoved, liveMemberIdsWithDeviceCredential, sessionMemberIsLive }): 'evict' | 'live-credential' | 'live-session'` in `deviceCredentials.ts`; authStore only gathers the inputs, and the escalation matrix is unit-tested on the pure function.
   - `evictRemovedMember` is single-flight per `familyId:memberId` (module-level `Map<string, Promise<void>>`, cleared in `finally`) and idempotent: it is reached by the gate, the pending-eviction pickup and the removed-members watcher; only the first two may escalate, and both run after any pod load has completed. Test: concurrent calls produce one escalation.
6. **Eviction triggers** — all keyed on the authenticated `removedMembers` record, never on mere roster absence, so a partial roster paint can never destroy credentials:
   a. A live session whose member appears in `removedMembers` after a load/merge → `rejectSession('member-removed')` (new NON-integrity kind) + `retireMemberDeviceCredentials` (per-member only). `applyResolution` NEVER escalates to family eviction: it runs inside `reloadAllStores`, which `decryptPendingFileWithKey` follows with `runPostLoadDriveHousekeeping` (syncStore.ts:3458-3472), so a mid-load teardown would be re-armed. Instead `rejectSession('member-removed')` sets `authStore.pendingRemovedEviction = { familyId, memberId }`, and the sign-in surface (LoginPage mount, where `auth.memberRemoved` is shown) consumes it by calling `evictRemovedMember({ trigger:'session' })`.
   b. Cold PIN and native-biometric unlock whose proven member is in `removedMembers` → eviction, no session, `auth.memberRemoved`, and `currentMemberId` cleared (the no-session owner fallback in `loadMembers` has already run by then).
   c. A dedicated watcher on `removedMemberIds` (NOT an addition to the roster watcher at familyStore.ts:132-151, which has its own partial-paint rules) retires per-member device credentials for newly seen ids that hold a credential on this device (shared devices; the remover's other devices). Per-member only.
   d. The remover's device: `deleteMember` calls `retireMemberDeviceCredentials` (per-member; never escalates).
7. **Session gates.** One synchronous classifier, `familyStore.memberStatus(id): 'live' | 'removed' | 'absent'` (reads `removedMemberIds` / `members`). `resolveSessionMember` maps it, and `authStore.gateProvenMember(familyId, memberId)` calls it, adding only the `rosterFamilyId === familyId` check and the eviction/error side effects. The gate is used by the PIN path (after the `if (syncStore.hasPendingEncryptedFile) {…}` block closes, useLoginFlow.ts:950, before `const live = …` at :955, so the pod-already-open path is gated too) and by `useBiometricSignIn` (before `updateSessionWithMemberData`, useBiometricSignIn.ts:117). `'removed'` → `evictRemovedMember` + `auth.memberRemoved`; `'absent'` → sign-in error + report. `resolveSessionMember` returns a distinct `removed` resolution. The roster projection filters out any row whose id is in `removedMembers` (heals the concurrent delete/patch resurrection race, automergeRepository.ts:109-131) and logs it. `updateSessionWithMemberData` returns `boolean`: when the member is missing it `reportError`s (`session_member_missing`, warning) and returns `false`, and `useBiometricSignIn` fails the sign-in. It does NOT call `invalidateSession('unknown-member')` — after the gate this only happens on an empty/partial roster and must not raise a tamper alarm.
8. **Drive permission revocation.** New `driveService.deletePermission(token, fileId, permissionId)` and `revokeEmailsFromFile(token, fileId, emails)` → `{ deleted, failed, lastStatus? }` (list → `sameAccount` match → skip `role==='owner'` → delete; per-permission errors collected, never thrown). Targets: the `.beanpod` and its canonical parent folder. Candidate emails: the snapshot's `email` / `googleAccountEmail`, minus `isUnshareableEmail`, minus any `sameAccount` match with a remaining live member (children often share a parent's contact email) or the actor (`getGoogleAccountEmail()`). Self-removal (actor === removed member, reachable for non-owner managers, familyStore.ts:571-585): the actor exclusion does not apply to the removed member's own emails; the session ends (`invalidateSession('self-removed')`, kept inside `removeMemberRow`); the outcome UI shows only the success/pending toast, plus the manual-check alert if Drive revocation did not succeed, before navigation. `resolveCanonicalFolderId` swallows errors and returns null (driveService.ts:303-317), so null → folder outcome `failed`, never "nothing to revoke". Token failure → `drive:'failed'`. Runs after the durable save; never un-removes the member.
9. **DriveConnection.** `removeDriveConnectionByAccount` (driveRepository.ts) for the member's `googleAccountEmail` unless `sameAccount` matches a remaining live member's `googleAccountEmail`.
10. **Durable publish, once.** One `syncNowDurable(CREDENTIAL_PUBLISH_TIMEOUT_MS)` (not the 12s rotation budget — syncStore.ts:524-532 documents why credential writes get 20s). Exactly one observe (`observeRemote()`, step 4) and one publish per removal. `'saved'` → done; anything else → the removal stands locally and the outcome says `save:'pending'`.
11. **Typed outcome.** `deleteMember` returns a discriminated union:
    ```ts
    type MemberRemovalOutcome =
      | { removed: false; refusal: 'offline' | 'not-found' | 'error' }
      | {
          removed: true;
          save: 'saved' | 'pending';
          drive: 'revoked' | 'not-applicable' | 'manual-check';
          manualCheckEmail: string | null;
        };
    ```
    `'error'` = `wrapAsync` caught a throw (it has already toasted). The store maps Drive `failed`, and `nothing-to-revoke` in a Drive family, to `'manual-check'` (every `deleteMember` target is a real member, so an unmatched share is not proof of revocation); telemetry keeps the finer `kind`. `useMemberRemoval` switches on `drive === 'manual-check'` and never re-derives "had joined".
12. **Honest UI.** Update the value of the existing `family.deleteConfirm` key (they lose access on every device from now on; anything already on their device stays with them). Outcome UI in `useMemberRemoval`: success toast; `save:'pending'` info toast; `drive:'manual-check'` → `alert({ title, message: 'family.removeDriveManual', detail })` — the message carries the manual steps with no placeholder (open the family folder in Google Drive → Share → remove them); `detail` = the email when `manualCheckEmail` is non-null, otherwise omitted (placeholders `pending-…@setup.local` and typed-but-never-stored invite emails, CreateMembersStep.vue:73, useInviteFlow.ts:265-283). Where the removed member's device does see the removal (local-file families, devices shared with remaining members) it shows `auth.memberRemoved`; in Drive families it usually loses file access first and lands on the existing file-not-found / reconnect surface — copy must not promise more. All strings in `uiStrings.ts` with `en` + `beanie`; important-surface beanie values keep real nouns ("family data", "device", "member").
13. **Help Center.** New security explainer "What happens when you remove a family member" (added to the existing `src/content/help/security.ts`); fix the inaccurate "one-time token" claim in `getting-started.ts` (invite tokens are reusable until they expire).

## Important Notes & Caveats

- **Ordering in `deleteMember`:**
  1. row exists, else `refusal:'not-found'`
  2. pre-gate (`canDurablySaveNow`)
  3. snapshot `email` / `googleAccountEmail` and the remaining live members
  4. `observeRemote()` — the removal's one pre-merge (a 20s credential save), BEFORE `wrapAsync`
  5. inside `wrapAsync`: `stageMemberLinkTombstone(id)` — the newest-wins overwrite, commit only. Kept (rather than folded into `member:`) because it is what protects against OLD clients, which ignore `revokedKeys`.
  6. `removeMemberRow(id)` (delete row) + `recordRemoval`
  7. `revokeEnvelopeEntries` (commit only)
  8. `removeDriveConnectionByAccount` unless shared; `retireMemberDeviceCredentials(activeFamilyId, id)`
  9. after `wrapAsync`: one `syncNowDurable(CREDENTIAL_PUBLISH_TIMEOUT_MS)`
  10. `revokeMemberDriveAccess` (Drive families only)

  Steps 5-8 run inside `wrapAsync`; the observe (4) and steps 9-10 run outside it, so `familyStore.isLoading` does not spin for 20s+. The row is deleted before tombstoning (healStaleWrappedKey re-wraps a missing entry while the row exists), and the `member:` tombstone makes the order robust anyway.

- **Publish signal.** `keyDictSize` counts and its caller compares with a strict `>` (syncStore.ts:2045), so it can never signal a revocation; and the 10s poll's merge (`syncService.adoptRemoteEnvelopeKeys`, :1777-1779, called at :1846) has no publish trigger at all. Both merge callers move to `mergeEnvelopes(incoming, local) → { envelope, needsPublish, filtered }` (true when the key-dict count grew, OR merged `revokedKeys` has a key incoming lacks, OR `filtered > 0`). The last case re-cleans a file an old client re-polluted — which is why `parseBeanpodV4` must NOT filter (it would hide that count). But devices that have not yet merged the file never pass through the merge: redemption and first-open unwraps read `pendingEncryptedFile.envelope` (useJoinFlow.ts:1131, :1154). The three `pendingEncryptedFile` assignments (syncStore.ts:2127, 2164, 2210) store `applyRevokedKeys(env).envelope` and log `revoked_entries_filtered { stage:'pending', count }`. Merge inputs stay raw, so `needsPublish` still sees re-pollution.
- **Every envelope writer in this plan builds from `authoritativeEnvelope()`** and commits via `commitEnvelope` — never from `envelope.value` (route 6).
- **Envelope integrity:** the envelope is outside the AES-GCM payload and unauthenticated. `revokedKeys` gives an attacker with Drive write nothing new (they can already delete wraps). That is why destructive device eviction keys on the doc-side `removedMembers` (authenticated) and never on envelope data.
- **Drive families: the removed device rarely self-evicts.** Revocation follows the save immediately, so that device's next read is a 403/404 → `DriveFileNotFoundError` (driveService.ts:708-735) → the existing file-not-found flow. Its cached pod, and any PIN wrap over it, is a "copy already taken". Eviction triggers mainly serve local-file families and shared devices.
- **Drive shares may target an email we never stored.** `useInviteFlow.shareDriveAccess` shares with the email typed in the wizard (useInviteFlow.ts:265-283). Hence req 11 maps every Drive-family `nothing-to-revoke` to `manual-check`.
- **Old clients** (< this release) ignore `revokedKeys` and the `removedMembers` collection. They may re-publish revoked entries from memory; current clients filter them on the next merge, re-save (`mergeEnvelopes(...).needsPublish`), and log `revoked_entries_filtered` so the rate is visible. Old clients never self-evict. Whether to bump `promptBelowVersion` at deploy is greg's call (flagged, not done here).
- **Legacy `passkeyWrappedKeys` entries without `memberId`** cannot be attributed; they are counted in the log, never guessed at.
- **Non-owner managers** under `drive.file` may get 403 deleting a permission, and after an ownership transfer the Drive file owner may differ from the pod owner — both surface as `drive: 'failed'` with manual steps.
- **Photos** are anyone-with-link readable by design (ADR-021); a removed member who kept photo URLs keeps them. Stated in the Help Center article.
- **Nothing here reaches** a copy already taken, the family `recoveryKeys` kit, `recoveryPassphrase`, or the family `CalendarConnection` token. All are #117 (key rotation) territory.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. `preserveLocalKeyDicts` has exactly two production callers (syncStore.ts:396 via `replaceEnvelope`, syncService.ts:1778 `adoptRemoteEnvelopeKeys`), so moving both to `mergeEnvelopes` reaches every merge. The poll terminus (syncService.ts:1846) has no envelope-publish trigger today; `mergeEnvelopes` adds one.
2. `parseBeanpodV4` and `reEncryptEnvelope` preserve unknown top-level fields (`parsed` returned as-is; `{...envelope}` spread), so `revokedKeys` survives old-client reads/writes.
3. A new doc collection needs only the `FamilyDocument` type + `COLLECTION_NAME_SEED` entry in `src/types/automerge.ts` and a repo via `createAutomergeRepository` (the `listCycles` / `driveConnections` pattern); a doc lacking it reads as empty.
4. Drive `permissions.delete` works with the file creator's `drive.file` token on files/folders the app created; other actors may get 403.
5. `canDurablySaveNow()` returns false only for no provider or Drive-offline (syncStore.ts:1246-1253).
6. No Lambda is involved: invites, links and the registry have no server-side member state (registry holds only `memberCount`).
7. `runSignOutSteps` catches and reports each step (signOutSteps.ts:117-139), and `buildSignOutStepImpls` (authStore.ts:2585+) can be reused with `userAskedToClear: true`.

## Approach

### A. Envelope tombstones — `src/types/syncFileV4.ts`, `src/services/sync/envelopeMerge.ts`

- Add `EnvelopeTombstone` and `revokedKeys?: Record<string, EnvelopeTombstone>` to `BeanpodFileV4` with a docblock (grow-only; key formats; never deleted; old clients ignore it).
- Registry: add `attributedBy: 'key' | 'value.memberId' | null` to each `ENVELOPE_KEY_DICTS` entry (`wrappedKeys`, `memberLinkKeys`, `deviceApprovalKeys` → `'key'`; `passkeyWrappedKeys` → `'value.memberId'`; `inviteKeys`, `recoveryKeys` → `null`). The `satisfies`-style exhaustiveness keeps a new dict from escaping.
- `applyRevokedKeys(env): { envelope; filtered: number }` iterates `ENVELOPE_KEY_DICTS` (no second list); never drops an entry with `wrapped === ''`. `revokedKeys` is NOT an `EnvelopeKeyDictField` (no `wrapped`; envelopeMerge.ts:104-106 warns about exactly this), so it is merged explicitly beside `recoveryPassphrase` and is NOT counted by `keyDictSize`.
- `preserveLocalKeyDicts` keeps its return type and unions `revokedKeys`. A new sibling `mergeEnvelopes(incoming, local): { envelope; needsPublish: boolean; filtered: number }` wraps it (union, then `applyRevokedKeys` — on BOTH paths, including the `!local` early return, envelopeMerge.ts:159), computes `needsPublish`, and logs `revoked_entries_filtered { stage:'merge', count }` exactly once. BOTH callers use it: syncStore `replaceEnvelope` (feeding :2045 in place of the `keyDictSize` comparison) and syncService `adoptRemoteEnvelopeKeys` (:1777), where the poll path does `if (needsPublish && !saveInProgress) triggerDebouncedSave()` — the same guard as the kept-local branch at :1809. `keyDictSize` becomes private to envelopeMerge. Update the header's "Known limitation" paragraph.
- `revocationTombstonesForMember(env, memberId, { mode: 'remove' | 'unclaim', now })` (pure) → `{ tombstones, unattributedPasskeys }`.

### B. Revocation writer — `src/stores/syncStore.ts`

- `revokeEnvelopeEntries(tombstones): { committed: boolean; filtered: number }` is SYNCHRONOUS and commit-only, like `setEnvelopeEntry`: `authoritativeEnvelope()` → merge tombstones → `applyRevokedKeys` → `commitEnvelope`. No publish option; callers do their one existing publish (deleteMember's durable save; unclaim's existing `syncNowBounded`, authStore.ts:1466). `committed:false` (no envelope) is reported by the caller.
- `retireMemberKeyMaterial` keeps its `passkeySecrets` clear and calls `revokeEnvelopeEntries` with the unclaim set. Its local-delete code and the `unclaim_wraps_not_revoked` "merge will restore them" warning (authStore.ts:1426-1451) are deleted and replaced by `entries_revoked`.
- Split `revokeMemberLink` into `observeRemote(): Promise<boolean>` (the existing `syncNowDurable(CREDENTIAL_PUBLISH_TIMEOUT_MS) === 'saved'`) and `stageMemberLinkTombstone(id): { committed: boolean }` (synchronous, built from `authoritativeEnvelope()`, commit only). `revokeMemberLink` = observe → stage → publish, behaviour unchanged for unclaim. No boolean flag.

### C. Authenticated removal record — new `removedMembers` collection

- `src/types/models.ts`: `RemovedMember { id: UUID /* the member id */; removedAt: ISODateString; removedByMemberId: UUID | null; createdAt; updatedAt }`.
- `src/types/automerge.ts`: `removedMembers: Record<string, RemovedMember>` + `COLLECTION_NAME_SEED` entry.
- `src/services/automerge/repositories/removedMemberRepository.ts` via `createAutomergeRepository` (mirrors `driveRepository.ts`): `recordRemoval(memberId, removedBy)`, `getAllRemovedMembers()`.
- `familyStore`: reactive `removedMemberIds` loaded in `loadMembers` with the roster; removed ids filtered out of `loaded` BEFORE `normalizeRoles` (familyStore.ts:373) so a removed row can never be promoted or patched (`family-roster / removed_member_row_filtered`); `memberStatus(id)`; `resolveSessionMember` gains `{ kind: 'removed' }`; the duplicated resolution handling (familyStore.ts:386-393 and :403-410) is extracted into one `applyResolution(resolved): Promise<boolean>` and the `removed` case is added there once; `rejectSession` takes `SessionRejectionKind` (type import) instead of its hand-typed union (familyStore.ts:332-334); `discardDraftMember` + private `removeMemberRow`.

### D. Device eviction

- `src/services/auth/deviceCredentials.ts`: `retireMemberDeviceCredentials(familyId, memberId)` = the moved `invalidateDeviceCredentials` body, taking `familyId` instead of reading `getActiveFamilyId`, calling `removeAllPasskeysForMember(memberId, familyId)`. Both existing callers updated.
- `authStore.evictRemovedMember({ familyId, memberId, trigger })`: `retireMemberDeviceCredentials`; escalation check (req 5); on escalate `runSignOutSteps(SIGN_OUT_EVICTED_STEPS, buildSignOutStepImpls({ …, userAskedToClear: true }))` + `finalizeSession()`; logs `evicted{kind:'family'|'member'}` or `family_evict_deferred{kind}`. No bespoke teardown.
- `authStore.gateProvenMember(familyId, memberId)` (req 7), single-flight `evictRemovedMember` (req 5).
- `SessionRejectionKind` gains `'member-removed'` (not in `INTEGRITY_REJECTIONS`); `applyResolution`'s `removed` case → `rejectSession('member-removed')` + per-member retire; escalation only via `gateProvenMember` / `pendingRemovedEviction` (LoginPage pickup).
- Dedicated `removedMemberIds` watcher (req 6c, trigger `'removed-watch'`).

### E. Drive — `src/services/google/driveService.ts`

- `deletePermission` + `revokeEmailsFromFile` per req 8, using `listFilePermissions`, `sameAccount`, `isUnshareableEmail` (utils/email.ts).
- New `src/services/google/driveAccessRevocation.ts`: pure `driveRevocationCandidates(snapshot, liveMembers, actorEmail): string[]`, and `revokeMemberDriveAccess({ fileId, emails }): Promise<{ drive: 'revoked' | 'nothing-to-revoke' | 'failed'; email: string | null }>` which gets the token, resolves the folder (null → folder `failed`), calls `revokeEmailsFromFile` for file and folder, and logs `drive_revoke*`. `familyStore.deleteMember` makes one call after the durable save, only when `getProviderType() === 'google_drive'` and `syncStore.driveFileId`. The store gains no Drive logic.

### F. `deleteMember` + `useMemberRemoval` + UI

- `deleteMember(id)` implements the ordering above and returns `MemberRemovalOutcome`; `removedByMemberId` = current member.
- `useMemberRemoval.removeMember` keeps its boolean contract: `refusal:'offline'` → `alert` reconnect message; `'not-found'` → existing `family.deleteFailed` toast + `reportError`; `'error'` → nothing extra (`wrapAsync` toasted); success → toast; `save:'pending'` → info toast; `drive:'manual-check'` → `alert({ title, message: 'family.removeDriveManual', detail: manualCheckEmail ?? undefined })` (`useConfirm` `detail`, no new modal).
- `CreateMembersStep.vue` calls `familyStore.discardDraftMember(id)`.
- Removed-member notice: `showToast('info', t('auth.memberRemoved'))` on the sign-in surface.

### G. Help Center

- Add the article to `src/content/help/security.ts`; update `getting-started.ts` invite copy.

## Files Affected

- `src/types/syncFileV4.ts` — `EnvelopeTombstone`, `revokedKeys`
- `src/services/sync/envelopeMerge.ts` — registry `attributedBy`, `applyRevokedKeys`, `mergeEnvelopes`, `revocationTombstonesForMember`, merge integration, header
- `src/stores/syncStore.ts` — `revokeEnvelopeEntries`; `retireMemberKeyMaterial` rewritten; `revokeMemberLink` split into `observeRemote` + `stageMemberLinkTombstone`; `mergeEnvelopes` at :2045; filter at the three `pendingEncryptedFile` assignments
- `src/types/models.ts` — `RemovedMember`
- `src/types/automerge.ts` — `removedMembers` collection
- `src/services/automerge/repositories/removedMemberRepository.ts` (new) + `index.ts` export
- `src/stores/familyStore.ts` — `removedMemberIds`, roster filter, `removed` resolution, `rejectSession` type, watcher, `deleteMember` rewrite, `invalidateDeviceCredentials` moved out
- `src/stores/authStore.ts` — `'member-removed'`, `evictRemovedMember`, `gateProvenMember`, `updateSessionWithMemberData` missing branch, `unclaimMember` wiring
- `src/services/auth/deviceCredentials.ts` (new)
- `src/services/google/driveAccessRevocation.ts` (new)
- `src/services/sync/syncService.ts` — `adoptRemoteEnvelopeKeys` via `mergeEnvelopes` + publish trigger
- `src/services/auth/signOutSteps.ts` — `SIGN_OUT_EVICTED_STEPS`, steps `beginQuietTeardown`, `forgetLocalFamily`
- `src/composables/useBiometricSignIn.ts`, `src/composables/useLoginFlow.ts` — gate calls
- `src/services/google/driveService.ts` — `deletePermission`, `revokeEmailsFromFile`
- `src/composables/useMemberRemoval.ts` — outcome UI
- `src/components/login/CreateMembersStep.vue` — calls `discardDraftMember`
- `src/pages/LoginPage.vue` (or the sign-in surface's mount) — `pendingRemovedEviction` pickup + `auth.memberRemoved` notice
- `src/services/translation/uiStrings.ts` (+ `public/translations/zh.json` via `npm run translate`)
- `src/content/help/security.ts`, `src/content/help/getting-started.ts`
- Tests: `envelopeMerge.test.ts`, syncStore revocation tests, `familyStore` deleteMember/loadMembers tests, `deviceCredentials.test.ts`, authStore eviction/gate tests, `useBiometricSignIn` test, login-flow PIN gate test, `driveService` test, `useMemberRemoval` test, `signOutSteps` test, `uiStrings.test.ts` important-surface list

## Help Center Coverage

- **Action**: new article (in existing `src/content/help/security.ts`) + update `getting-started.ts`
- **Category**: `security`
- **Article type**: explainer
- **Slug**: `removing-a-family-member`
- **Title**: What happens when you remove a family member
- **Scope**: What removal does (their sign-ins, saved links and pending invites stop working; their access to the family file in Google Drive is removed, so their app can no longer load new data; on devices that can still read the file it signs them out and clears the family from that device) and what it cannot do (anything already on their device, including the app's offline copy, stays readable to them; photos shared by link stay reachable; a family recovery passphrase they knew still opens copies they already hold).
- **Notes**: Must not say "their keys are destroyed" or "their password no longer opens the family's data on any device". Mention that if Drive access could not be removed automatically, the app says so and how to do it by hand. Mention it needs a connection for Google Drive families.

## Observability Coverage

All keys below are already in `ALLOWED_CONTEXT_KEYS` (`action`, `kind`, `stage`, `count`, `detail`, `save_status`, `http_status`, `member_id_tail`, `provider_type`). **No new context key; no store-declaration change.**

- `member-removal` (info) `removal_outcome` `{ action:'remove', save_status, kind: <drive outcome>, count: <tombstones written>, provider_type }` — success-path signal, one per removal.
- `member-removal` (info) `draft_discarded` (success signal for `discardDraftMember`).
- `member-removal` (warn) `removal_refused` `{ kind:'offline'|'not-found'|'not-draft' }`.
- `session-integrity` `reportError` warning `session_member_missing` (biometric path, member absent after the gate).
- `member-removal` `reportError` warning `drive_revoke_failed` `{ http_status, stage:'file'|'folder'|'token', count }`; info `drive_revoke` `{ count, stage }` on success.
- `member-removal` `logEvent` warn `removal_not_published` `{ save_status }` for any non-`'saved'` result (the staged changes are not rolled back and ride the next save; syncStore.ts:6387-6392 documents why a timeout must not page), plus `reportError` warning only when `save_status === 'failed'`.
- `envelope-revocation` (info) `entries_revoked` `{ count, kind:'removal'|'unclaim', detail: <unattributed passkey count> }`; (warn) `revoked_entries_filtered` `{ stage:'merge'|'pending', count }` — the old-client resurrection metric; `reportError` warning `revoke_no_envelope` when `revokeEnvelopeEntries` returns `committed:false`.
- `device-eviction` (info) `evicted` `{ kind:'member'|'family', stage: trigger, count }`; (warn) `family_locked` `{ kind:'live-credential'|'unsynced' }` when the family is locked rather than forgotten; (warn) `family_evict_deferred` `{ kind:'live-session' }`; step failures reported by `runSignOutSteps` / `retireMemberDeviceCredentials`.
- `session-integrity` — existing `session_ended_expectedly` now carries `kind:'member-removed'` (non-integrity; no longer counted as tamper).
- `family-roster` (warn) `removed_member_row_filtered` `{ count }`.
- `unclaim_wraps_not_revoked` is deleted (superseded by `entries_revoked`).
- Failure modes → event: offline refusal → `removal_refused`; save not confirmed → warn `removal_not_published` (+ reportError on `'failed'`); Drive 403/token/folder → `drive_revoke_failed`; old client resurrects wraps → `revoked_entries_filtered`; shared device keeps family → `family_evict_deferred`; biometric/PIN for removed member → `evicted{stage:'biometric'|'pin'}`. No bare catches.

## Acceptance Criteria

- [ ] Offline Drive family: removal refused with a reconnect message; nothing changed.
- [ ] After removal, `revokedKeys` holds `member:<id>` and all invites, and a two-envelope merge test proves a peer holding the old entries cannot resurrect them (both merge directions, and via the `!local` early return).
- [ ] A remote envelope carrying revoked entries (old-client re-publish) triggers a re-save that removes them from the file (`mergeEnvelopes(...).needsPublish`).
- [ ] A magic link / password wrap tombstoned in `revokedKeys` but still present in the file cannot be redeemed on a fresh device (pending-file filter).
- [ ] After removal the file still holds `memberLinkKeys[id]` with `wrapped: ''` and epoch `expiresAt`.
- [ ] Biometric sign-in of a removed member with a pending file runs no family-eviction step before `decryptPendingFileWithKey` resolves.
- [ ] Unclaim's password/passkey wraps are revoked with value-pinned tombstones; unclaim then re-claim: the new wrap survives merge.
- [ ] `removedMembers` record written; a resurrected row with a removed id is filtered from the roster.
- [ ] A session for a removed member is rejected as `member-removed` (not integrity) and evicts that member's device credentials; family-level eviction happens only under the three conditions and is deferred (logged) otherwise.
- [ ] Cold PIN and biometric unlock for a removed member never create a session, never leave the owner as current member, evict, and show `auth.memberRemoved`.
- [ ] Drive permissions for the member's emails are deleted on file + folder, skipping owner, the actor, and emails shared with remaining members; failures and the joined-but-nothing-matched case surface the manual-steps alert.
- [ ] Removed member's `driveConnections` entry removed (unless shared).
- [ ] `CreateMembersStep` uses `discardDraftMember`: no durable save, no Drive calls, no tombstones; `discardDraftMember` refuses a member with credentials.
- [ ] Removing an invited but not yet joined member tombstones all invites and revokes Drive for the snapshot email.
- [ ] A poll-path merge that filtered revoked entries triggers a debounced save.
- [ ] Concurrent eviction triggers for one member produce one escalation.
- [ ] One observe + one durable save per removal.
- [ ] Help Center article added/updated and verified to match the shipped behaviour.
- [ ] Diagnostic logging in Observability Coverage implemented and verified (events fire with the stated `surface`/`context`; no new context key).
- [ ] `npm run validate` green.

## Testing Plan

1. Unit: `envelopeMerge` — tombstone union (earliest wins), `member:` filtering per `attributedBy`, value-pinned slot tombstones, both merge directions, `!local` path, `mergeEnvelopes` needsPublish truth table, `wrapped === ''` never filtered, value-pinned keys never collide, unattributed passkey count.
2. Unit: syncStore `revokeEnvelopeEntries` builds from `authoritativeEnvelope()`; `retireMemberKeyMaterial` via tombstones; `stageMemberLinkTombstone` commits without publishing; `revokeMemberLink` behaviour unchanged; pending-file assignments filtered.
3. Unit: `familyStore.deleteMember` — ordering, pre-gate refusal, `discardDraftMember` refusal/no-save, self-removal, outcome shape for saved/pending/drive variants, `removedMembers` written, one durable save.
4. Unit: `authStore.evictRemovedMember` escalation matrix (live credential / live session / all clear) + `SIGN_OUT_EVICTED_STEPS` contents; `gateProvenMember`.
5. Unit: `loadMembers` — `removed` resolution → `member-removed`; resurrected row filtered; absent-but-not-removed unchanged.
6. Unit: `useBiometricSignIn` + cold PIN path — removed member evicted, no session, `currentMemberId` not the owner.
7. Unit: `driveService.revokeEmailsFromFile` — `sameAccount` match, skip owner, partial failure; null folder → failed.
8. Browser (build-auto Phase 4): remove a member in a local-file family (dev), check confirm/outcome copy in light/dark at ~400px.
9. Manual (greg): real Drive — remove a member who joined on a second Google account; confirm "Shared with me" loses the file and folder; on that member's device (Drive family) the app reports the file is no longer accessible. Local-file family on a second device: open → `auth.memberRemoved`, family gone from the picker, PIN and biometric no longer offered.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from pre-plan + three code-verification sweeps; doc-side authenticated `removedMembers` + envelope `revokedKeys` grow-only tombstones + Drive permission delete + device eviction primitive + session gates + honest outcome UI.
- **Pass 2 (DRY + error handling)**: Value-pinned tombstones so unclaim cannot lock out a re-claimed member; `member:` tombstones via a registry `attributedBy` column; reuse `invalidateDeviceCredentials` (moved), `removeAllPasskeysForMember`, the sign-out step runner, `removeDriveConnectionByAccount`, `sameAccount`, `useConfirm.detail`; commit-only revocation writer + one durable save at the 20s credential budget; `envelopeNeedsPublish` replaces the count trigger (parse-time filter dropped); never-had-access short path for onboarding; Drive-family eviction reality stated; silent `resolveCanonicalFolderId` null handled.
- **Pass 3 (Sustainability)**: Explicit `discardDraftMember` replaces the never-had-access heuristic (invited-not-joined members kept Drive and invite access); `mergeEnvelopes` returns `needsPublish` to both merge callers (the poll path had no re-publish); `revokeMemberLink` split into observe + stage, no flag, observe outside `wrapAsync`; evicted step list with a throwing `forgetLocalFamily`, redundant roster step dropped, `clearKeyCacheFamily` added; single-flight eviction; pure `shouldEvictFamily` and one `memberStatus` classifier; `applyResolution` dedupe with filtering before `normalizeRoles`; Drive revocation moved to its own service; discriminated `MemberRemovalOutcome`; no optional-flag parameter on `removeAllPasskeysForMember`; no tamper classification for a missing session member.
- **Pass 4 (Fresh-eyes sweep)**: Family eviction never runs inside `reloadAllStores` (mid-load teardown would be re-armed by post-load housekeeping) — `pendingRemovedEviction` picked up on the sign-in surface; value-pinned tombstones keyed by the pinned value so repeat unclaims never collide; `wrapped === ''` entries never filtered so the old-client magic-link overwrite survives; pending-file filter for devices that have not merged; `removal_not_published` no longer pages on timeout; self-removal specified; placeholder-free manual-check alert; `discardDraftMember` boolean contract; tombstone ALL invites; stale leftovers from earlier passes cleaned.

## Implementation Notes (deviations found while building)

Recorded during `/beanies-build-auto`, 2026-09-23. Each is a change of ROUTE, not of deliverable.

1. **Both sides are filtered BEFORE the union in `mergeEnvelopes`, not after.** A new unit test caught it: under `local-wins`, a stale peer's pre-unclaim wrap shadowed the re-claimed member's new wrap in the same slot, the value-pinned tombstone then dropped the survivor, and the slot came out empty — a real loss the peer would have published. Filtering each side first means a revoked entry can never shadow a live one.
2. **`logRevokedEntriesFiltered` lives in its own module (`src/services/sync/revocationLog.ts`)**, not in `envelopeMerge` (the Automerge worker imports that module, so it must stay free of telemetry) and not on `syncService` (both merge callers need it, and one is `syncService`).
3. **Four `pendingEncryptedFile` writers, not three** (syncStore.ts adds :5466). All now go through one `stagePendingFile` setter that applies the revocation filter, so there is one writer rather than four patched sites.
4. **The native keystore step goes through a `passkeyService.removeNativeKeystoreForMember` facade** rather than importing `nativeBiometric` into `deviceCredentials.ts`: `passkeyService` is the declared single route for other modules to touch keystore storage.
5. **`SIGN_OUT_EVICTED_STEPS` has no `resolveFamilyId` step.** The caller pre-sets the REMOVED member's family on the step context; by the time eviction runs the session is gone, and resolving from "the active family" is the one way it could clear the wrong one.
6. **The PIN gate runs on BOTH PIN paths** — the pod-already-open branch (useLoginFlow.ts ~812) returns before the cold-unwrap branch, so a single gate "after the pending block" would have missed it. One local helper, two call sites.
7. **The biometric gate ends the thin passkey session itself** (`invalidateSession('member-removed')`) and clears the pending eviction the load left, because it runs the eviction immediately; otherwise the eviction would run twice.
8. **Mid-session removal waits for the next navigation to reach the sign-in surface**, exactly as every other rejected session does today (`invalidateSession` does not navigate). The pending eviction is consumed on `LoginPage` mount. Not changed here; noted for greg.
9. **Help Center copy** says the removed member's device clears the family "if nobody else in the family uses that device" — the shared-device rule — rather than unconditionally.

### Review rounds (build-auto Phases 5-7)

- **Round 1 (`/code-review high`, whole diff): 10 findings, all verified against the code and fixed.** Eviction swallowed by a watcher run sharing its single-flight (watcher now only retires credentials); watcher reading `rosterFamilyId` before `loadMembers` set it, and rescanning every historical removal on each boot (removal set now published with its family; handled ids tracked per family); a failed biometric sign-in leaving its thin session to be read as tampering next boot (`abandonThinSession`); shared password-only devices losing unpushed work to a family eviction (unpushed-work guard); the resurrection metric firing on every ordinary removal (now counts only the file's own tombstones); `discardDraftMember` hand-coding attributed dicts and missing `deviceApprovalKeys` (registry-driven `memberHasKeyMaterial`); the pod-open PIN branch gating before any PIN was proven (gate kept only after the cold unwrap); Help copy overclaiming for Drive families; Drive revocation file-first producing false manual-check alerts on inherited permissions (folder first).
- **Round 2 (`/code-review high`, scoped to round-1 fixes): 10 findings.** The substantive one was in round 1's own fix: the unpushed-work guard made a deferred eviction permanent (credentials already retired, nothing retries) and left the pod open. **Structural fix rather than a third patch:** a deferral now LOCKS the family (`SIGN_OUT_EVICTION_LOCK_STEPS`: close the pod, drop the trusted-open key, keep the encrypted cache); eviction is exactly the lock plus `forgetLocalFamily`. Also fixed: gate clearing an unrelated pending eviction; watcher marking ids handled before success; a bare `catch` in the probe; a redundant dynamic import. **Not fixed, recorded:** Drive inherited-permission propagation lag (`permissionDetails` is shared-drive-only, and the worst case is a harmless false "check Drive" alert); pre-existing biometric failure returns without `abandonThinSession` (an empty roster there resolves to `none`, not a tamper report); `resolveDeviceKeys` swallowing registry errors, which can under-count live passkey holders (bounded by the unpushed-work guard; worst case a live member re-opens the family).
- **No third round**, per the two-round ceiling; recommended to greg.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (2026-09-23)

> Ok now let's address one of the final high priority issues - please run /beanies-pre-plan on issue #77 then move directly to /beanies-plan and /beanies-build-auto - work directly and only stop if there is a major showstopper or blocker issue requiring my decision

### Follow-up 1

> yes, tracker #77 - go ahead

### Pre-plan prompt

The assembled `=== BEANIES PRE-PLAN ===` block is stored on Notion tracker #77 (`beanies-plan prompt` property). Open questions resolved autonomously in pre-plan: Drive read AND write revoked; offline removed device self-evicts when it next sees the removal; Drive family that cannot durably save is refused; all live invites tombstoned; no remove-and-rotate option (depends on #117).
</details>
