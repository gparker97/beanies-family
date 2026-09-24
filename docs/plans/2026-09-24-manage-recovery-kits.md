# Plan: Manage recovery kits — see every kit on file, invalidate the ones you no longer trust

> **No GitHub issue created.** This plan was approved for direct implementation (Notion #99).
> Date: 2026-09-24
> Related issues: Notion #99 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-09-24-manage-recovery-kits.md`
> Mockup: `docs/mockups/recovery-kits-manage-2026-09-24.html` (direction B approved)

## User Story

As the owner (or a pod manager) of a family, I want to see every recovery kit on file by the ID printed on it and invalidate any I no longer trust, so that a lost or photographed kit stops being a permanent key to our family's data.

## Context

Recovery kits are purely additive today. `addRecoveryKey` (`src/stores/syncStore.ts:6273`) writes `envelope.recoveryKeys[kitId] = { salt, wrapped, createdAt }` and nothing ever removes one, so every kit a family has ever generated still unwraps the family key. The only UI is a count ("N kit(s) on file") and a "Create a New Kit" button in `RecoverySettings.vue`, visible to every signed-in member. The kit ID (8 lowercase hex chars, `recoveryKit.ts:92`) is printed on the kit (`RecoveryKitDisplay.vue`, "Kit ID") and in the PDF filename, and is shown nowhere else. A leaked, lost or photographed kit is therefore a permanent key to the whole pod.

Notion #77 shipped the machinery this needs: grow-only `revokedKeys` tombstones on the envelope, merged as a union on every merge and applied by `applyRevokedKeys`, with `recoveryKeys` already registered in `ENVELOPE_KEY_DICTS` (slot tombstone key `recoveryKeys:<kitId>`, `envelopeMerge.ts:138`) and a write helper `syncStore.revokeEnvelopeEntries` (`:6546`). What is missing is (1) a way to mint a kit tombstone from the UI, (2) creator/revoker attribution, (3) sign-in copy that explains an invalidated kit, (4) the list UI, and (5) help content. Family-key rotation was explicitly ruled out (2026-09-23), so the honest limit stays: a `.beanpod` copy saved before the invalidation can still be opened with the old kit.

## Requirements

1. Settings → Security & Recovery shows a one-line kit summary (live count, invalidated count, newest date) with two actions: **Manage Kits** and **Create a New Kit**. The "N kit(s) on file" caption is replaced by the summary.
2. **Manage Kits** opens a Tier 1 `BaseModal` listing every kit: live kits first (newest first, "Newest" pill on the latest), then invalidated kits. Each live row shows `Kit <id>`, created date, and creator name where recorded. Each invalidated row is greyed with the ID struck through, and shows the invalidated date and who invalidated it where recorded.
3. Every kit created from now on records its creator (`createdBy` = memberId). Kits created before this ships show ID + date only.
4. A live kit has an **Invalidate** action (danger outline) that opens a `ConfirmModal` (variant `danger`) naming the kit ID and stating the old-copy limit. Confirming writes a slot tombstone `recoveryKeys:<kitId>` (with `revokedBy` = memberId), drops the entry locally, and pushes on the credential budget. The outcome is reported honestly: `'failed'` is the one true failure; a timeout means the tombstone is staged and rides the next save, and the toast says so.
5. Invalidation propagates via the #77 tombstone union and can never be undone by a stale peer.
6. **Last-kit rule**: when exactly one live kit remains, its action reads **Replace**, never Invalidate. Replace runs the existing generate → show → confirm-stored flow for a NEW kit and, only once the confirmation is durable (reached the family file), invalidates the old kit. A confirmation that did not sync leaves the old kit valid and tells the person so; two live kits then exist and the old one can be invalidated from Manage Kits. The store enforces the rule atomically on a freshly merged envelope, so two devices cannot race the family down to zero kits.
7. **Permission**: only the owner and members with `canManagePod` see the Invalidate / Replace actions, and the action composable refuses before any store call. Every signed-in member can open Manage Kits and see the list. Non-managers see `SettingsAdminOnlyNotice` inside the modal.
8. Invalidate and Replace go through `requireReauth()` (the #80 PIN step-up), because they are irreversible security actions of the same class as removing a member.
9. The kit-redeem (unlock) path never accepts a revoked kit, because revoked wraps are filtered from every envelope before redemption (`stagePendingFile`, `mergeEnvelopes`). When the family has any invalidated kit, a non-matching code shows copy that names invalidation as a possible cause rather than plain "wrong code".
10. The help article `password-recovery` (`src/content/help/security.ts`) is updated to describe kit IDs, Manage Kits, invalidation, the last-kit rule and the old-copy limit.
11. All new copy goes through `uiStrings.ts` with `en` + `beanie`; `recovery.*` is already an important-surface prefix (`uiStrings.test.ts:121`), so `beanie` values keep the real nouns.

## Important Notes & Caveats

- **Do not delete envelope entries directly.** A bare `delete envelope.recoveryKeys[kitId]` is restored by the next merge (`local-wins` union). Only a tombstone via `revokeEnvelopeEntries` propagates. `applyRevokedKeys` then drops the entry on every device that has seen the tombstone.
- **Tombstones are grow-only.** Once written, `recoveryKeys:<kitId>` is permanent. There is no undo; the confirm copy must say so. A tombstone is never rolled back on a failed push: it stays staged and rides the next save.
- **Observe → guard → tombstone → push is one store action.** `syncNowBounded` defaults to the 5 s `POST_AUTH_SAVE_TIMEOUT_MS` (`syncStore.ts:1203, 1280`), which `publishEnvelopeEntry`'s docstring (`:551-575`) records as producing a false failure on every envelope write. The push lives in `revokeRecoveryKit` on the 20 s `CREDENTIAL_PUBLISH_TIMEOUT_MS` (`:1226`, exported at `:6807`) so there is one push site, as in `revokeMemberLink` (`:6411-6431`). `observeRemote()` runs first, not for `createdAt` ordering (a slot tombstone kills the slot regardless) but so the last-kit count is taken on a freshly merged envelope.
- **The last-kit guard lives in the store, on `authoritativeEnvelope()`, not on a UI computed.** `envelope.value` is a pre-merge snapshot after a background sync: `adoptRemoteEnvelopeKeys` calls `setEnvelope(adopted)` with no path back to the store ref (`syncService.ts:1801-1809`; `authoritativeEnvelope`'s own warning at `syncStore.ts:452-464`). A guard on the store ref would let device A invalidate Y while B had already invalidated X in the background, leaving zero live kits. UI computeds (`recoveryKits`, `liveRecoveryKitCount`) may lag a background sync by one store commit, the same staleness class as today's `kitCount` and `hasPassphrase` (`RecoverySettings.vue:31, 51`); the store guard is what protects the invariant.
- **One authorization check, via `usePermissions().canManagePod`.** That composable is the app's single source of truth (`isOwner || !!currentMember.canManagePod`, `usePermissions.ts:57`); `currentMember.canManagePod` is optional and only defaulted at the repository layer (`src/services/automerge/repositories/familyMemberRepository.ts:43`), so reading it raw can deny the owner (`useMintTarget.ts:34-39` records this). The check lives in `useRecoveryKitActions` (the `removeMember` precedent, `useMemberRemoval.ts:39-56`) and is not repeated in the store. The store owns the invariants of the data (no envelope, the last-kit rule), not of the actor. The PIN step-up remains the documented boundary on the irreversible action. This gate is policy, not cryptography: anyone holding the family key can edit the envelope out of band, exactly as for `removeMember`; `revokedBy` is attribution, not proof.
- **Replace's durability gate is the existing 5 s `confirmStored` push** (`useRecoveryKitFlow.ts:77`). `createRecoveryKit`'s own 5 s push at mint (`authStore.ts:1943`) is not the gate. A slow connection can report a not-synced confirmation for a kit that does land seconds later; the fallback (old kit stays valid; the person invalidates it from Manage Kits, where its row now shows Invalidate because two kits are live) is the designed degraded path and needs no new mechanism. Do not widen the flow's budget for this feature.
- **An invalidated kit is not identifiable at sign-in.** `stagePendingFile` (`syncStore.ts:437-441`) and every `envelope.value` writer apply `applyRevokedKeys` first, so a revoked wrap never reaches `redeemRecoveryKit`, and the kit ID is not derivable from the typed code. An invalidated kit therefore fails as `wrong-code` (or `no-kits`). Retaining the wrap or a verifier on the tombstone purely to produce better copy would be a second crypto artefact; instead the sign-in view says invalidation is a possible cause whenever the envelope carries any kit tombstone.
- **The old-copy limit is real and must be stated**: a `.beanpod` saved before the invalidation still opens with the old kit. Key rotation is out of scope by decision.
- **Kit IDs are not secret** (4 random bytes as hex); listing them is safe. The kit code is never persisted and never shown after the one-time modal.
- **A revoked kit's `createdAt` is lost** once `applyRevokedKeys` drops the entry, so invalidated rows show the invalidated date and revoker only. This is a deliberate deviation from the light-desktop specimen of the mockup; the dark-phone specimen already shows the reduced form.
- **The kit modal is unclosable by contract** (`src/components/auth/RecoveryKitDisplay.vue:229`, `:closable="false"`): the only exits are `confirmStored` or the host unmounting. A "closed without confirming" abandon path therefore does not exist; navigating away destroys the per-mount flow instance with the old kit untouched.
- **Modal layering**: `RecoveryKitDisplay` is `layer: 'base'` (BaseModal default, `BaseModal.vue:49`), the same `z-50` as the list modal (`BaseModal.vue:53-58`). Two base-layer modals stack by DOM order with no guaranteed winner, so the list must be closed (`showKits = false`) before `kitFlow.generate()` opens the kit modal. `ConfirmModal` (`layer="top"`) and the reauth gate (`layer="gate"`) may sit over the open list.
- **Red is correct** for the Invalidate button and confirm (destructive), per the CIG's destructive-action exception. Every other accent here is Heritage Orange / the semantic tokens.
- **Legacy clients** older than #77 ignore `revokedKeys` and may re-publish a revoked wrap; current clients filter it again on every merge and log `revoked_entries_filtered`. Same caveat as #77; no new mitigation.
- **The kit-born first kit** (created inline during pod creation, `syncStore.ts:~3132`, before a member exists) has no `createdBy`. Show ID + date only; do not fake a creator.
- **`ConfirmModal` cannot render the two-step list** shown in the mockup's "Replace Your Only Kit" specimen. Use `confirm()` with a two-sentence message that names both steps; do not build a bespoke modal for one screen.
- **Never put an opacity modifier on readable text** in the invalidated rows; use `ink-faint` + `line-through`.

## Assumptions

> **Review these before implementation.** These were verified against the code on 2026-09-24 (Passes 2 to 4) but may have changed.

1. `ENVELOPE_KEY_DICTS.recoveryKeys` is `{ rule: 'local-wins', required: false, attributedBy: null }` and `applyRevokedKeys` honours a slot tombstone `recoveryKeys:<kitId>` (`envelopeMerge.ts:138, 344`). Verified.
2. `syncStore.revokeEnvelopeEntries(tombstones)` builds from `authoritativeEnvelope()`, commits, filters (`:6553`), and returns `{ committed, filtered }` (`syncStore.ts:6546-6558`). Verified.
3. `mergeRevokedKeys` keeps the whole earliest tombstone object on collision (`envelopeMerge.ts:298`), so an added optional `revokedBy` survives merges untouched. Both sides are filtered before the union (`:381-386`), so a stale peer cannot resurrect a slot. Verified.
4. `reEncryptEnvelope` and the dict merges spread entries whole, so an added optional `createdBy` on `RecoveryKeyPackage` survives every writer, including clients that predate the field. Verified.
5. `useRecoveryKitFlow.confirmStored(via)` returns `syncNowBounded()`'s durability (`useRecoveryKitFlow.ts:77-79`). Verified.
6. `requireReauth({ reasonKey })` returns a boolean, fails closed against the member's stored PIN/password hash (`useReauth.ts:62-80`), and is the documented gate for irreversible actions. Verified.
7. `usePermissions().canManagePod` is the settings gate already used at `SettingsPage.vue:2156` and by `SettingsAdminOnlyNotice`; `isOwner` rejects a forged session role once the roster is loaded (`usePermissions.ts:50-54`). Verified.
8. `useMemberInfo().getMemberName(memberId, fallback)` resolves a member name from the roster (`useMemberInfo.ts:70-76`); `family.unknownMemberInline` (`uiStrings.ts:1671`) is the existing fallback string. Verified.
9. `count`, `action`, `kind`, `error_code`, `save_status` are allowlisted in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61-69, 86, 104, 118, 335`); no allowlist or store-declaration change. Verified.
10. `LoadPodView.handleKitRedeem` (`LoadPodView.vue:885-902`) reads `pendingEncryptedFile?.envelope ?? envelope` and already emits `emitKitRedeemed({ outcome: 'failed', errorCode: result.reason })`. Verified.
11. `DurableSaveOutcome = 'saved' | 'failed' | 'timeout' | 'unknown'` is exported from `syncStore.ts:183`; `syncNowDurable(timeoutMs)` at `:1256`; `observeRemote()` as used by `revokeMemberLink` (`:6412`) and `removeMember` (`familyStore.ts:697`). Verified.
12. `authStore.currentUser.value?.memberId` is the signed-in member's id (already read at `authStore.ts:1342`) and authStore reaches syncStore via `await import('./syncStore')` (`:1015`). Verified.
13. Base64 `wrapped` values and hex kit IDs never contain `:`, so slot tombstone keys parse unambiguously. Verified.

## Approach

Implements the approved mockup `docs/mockups/recovery-kits-manage-2026-09-24.html`, direction B. Every style token comes from the theme skill + CIG; the mockup gives layout, hierarchy and copy intent only.

### A. Data shape — `src/types/syncFileV4.ts`

- `RecoveryKeyPackage` (`:39`) gains `createdBy?: string` (memberId). Doc comment: optional, additive, absent on kits created before 2026-09-24 and on the kit-born first kit.
- `EnvelopeTombstone` (`:157`) gains `revokedBy?: string` (memberId). Doc comment: attribution only, never used by the merge; earliest `revokedAt` still wins whole.
- Fix the stale `recoveryKeys` doc comment (`:182-188`): entries are retired by a `recoveryKeys:<kitId>` slot tombstone (#99), not by #117 rotation.

### B. Pure services + store — `envelopeMerge.ts`, `recoveryKit.ts`, `syncStore.ts`

- `envelopeMerge.ts` gains the inverse of `revocationKey` (`:277`), beside it: `slotTombstoneEntryKey(field, tombstoneKey): string | null` (the entry key for a slot-wide `<field>:<entryKey>` tombstone of that field; `null` for value-pinned or other fields). Unit-tested in `envelopeMerge.test.ts` alongside `revocationKey`, so the two cannot drift.
- `src/services/auth/recoveryKit.ts` gains a pure `summarizeRecoveryKits(envelope: Pick<BeanpodFileV4, 'recoveryKeys' | 'revokedKeys'>): RecoveryKitSummary[]` (live from `recoveryKeys`, invalidated from tombstones via `slotTombstoneEntryKey('recoveryKeys', k)`, sorted live newest-first then invalidated newest-first). The type lives here too:
  ```ts
  export type RecoveryKitSummary =
    | { kitId: string; status: 'live'; createdAt: ISODateString; createdBy?: string }
    | { kitId: string; status: 'invalidated'; revokedAt: ISODateString; revokedBy?: string };
  ```
  Tested in `recoveryKit.test.ts` with no Pinia. Used by the store computeds, the store guard, and the sign-in view.
- `syncStore.recoveryKits` is a one-line computed over `envelope.value` calling `summarizeRecoveryKits` (reactive on both `commitEnvelope` `:469-472` and `replaceEnvelopeTracked` `:425`); `liveRecoveryKitCount` is `recoveryKits.value.filter(k => k.status === 'live').length`. `RecoverySettings.vue:31`'s local `kitCount` is deleted in favour of these. UI computeds may lag a background sync by one store commit; the store guard below is what protects the invariant.
- `async revokeRecoveryKit(kitId, revokedBy?): Promise<{ committed: false; refusal: 'no_envelope' | 'last_kit' } | { committed: true; outcome: DurableSaveOutcome }>` (named for the mechanism, like `revokeMemberLink`; "invalidate" is the user-level verb and lives in `authStore` and the UI). Steps: (1) `await observeRemote()` (the `revokeMemberLink` shape, `:6412`) so a peer's tombstone or new kit is merged before the count is taken; its result is carried on the outcome event, never a refusal. (2) `const base = authoritativeEnvelope()`; none → `no_envelope`. (3) **The one last-kit guard**: if `summarizeRecoveryKits(base).filter(k => k.status === 'live' && k.kitId !== kitId).length === 0` → `last_kit`. Unconditional: the Replace flow needs no exception because it only calls this after the new kit is already committed locally, so another live kit exists. (4) `revokeEnvelopeEntries({ [revocationKey('recoveryKeys', kitId)]: { revokedAt: now, revokedBy } })`, then `outcome = await syncNowDurable(CREDENTIAL_PUBLISH_TIMEOUT_MS)`. Never rolls back. The guard is evaluated on the same envelope the tombstone is built from, so it is atomic with the write and never reads the pre-merge `envelope.value` snapshot.
- `addRecoveryKey` unchanged in shape; callers stamp `createdBy` on the package.

### C. Auth orchestration — `src/stores/authStore.ts`

- `createRecoveryKit()`: stamp `createdBy: currentUser.value?.memberId` on `kit.pkg` before `addRecoveryKey` (unchanged otherwise; its 5 s push at `:1943` stays and is not the Replace gate).
- New `invalidateRecoveryKit(kitId, { kind: 'invalidate' | 'replace' }): Promise<KitInvalidateOutcome>`, never throws, obtains the store with the file's existing `await import('./syncStore')` pattern (`:1015`):
  ```ts
  export type KitInvalidateOutcome =
    | { invalidated: true; save: DurableSaveOutcome; liveRemaining: number }
    | { invalidated: false; refusal: 'last_kit' | 'no_envelope' | 'error' };
  ```
  Steps: (1) no actor authorization here (see the caveat; `useRecoveryKitActions` refuses first). (2) no policy here: `const r = await syncStore.revokeRecoveryKit(kitId, currentUser.value?.memberId)`; `!r.committed` maps `r.refusal` straight through. (3) `{ invalidated: true, save: r.outcome, liveRemaining: syncStore.liveRecoveryKitCount }`. (4) Catch-all → `reportError({ surface: 'login-flow', severity: 'error', message: 'kit invalidate failed', error: e, context: { action: 'kit_invalidate_failed', kind } })` → `refusal: 'error'`. Every branch emits `emitKitInvalidateOutcome` (`kind` is a telemetry-only field): `invalidated` with `liveRemaining` when `save === 'saved'`; `not_synced` with `saveStatus` otherwise; `refused` with `errorCode` = the refusal. Copy is resolved in the composable, not here.

### D. Actions composable — new `src/composables/useRecoveryKitActions.ts` (`useRecoveryKitFlow` unchanged)

`useRecoveryKitFlow` is shared by three hosts (`RecoverySettings`, `RecoveryKitPromptModal`, `SignOutKitGuard`) and its contract is "generate → show → confirm-stored for a NEW kit". It does not change. Replacement is a Settings-only concern owned by `RecoverySettings` (Section E).

Plain exported functions in the `removeMember` shape (`useMemberRemoval.ts:39-108`), no refs, no composable state:

- `invalidateKit(kit): Promise<boolean>`: `usePermissions().canManagePod` gate (`showAlert({ title: 'confirm.notAllowedTitle', message: 'settings.adminOnly' })` + `emitKitInvalidateOutcome({ outcome: 'refused', kind: 'invalidate', errorCode: 'not_authorized' })`) → `confirm({ title: 'recovery.kitInvalidateTitle', message: 'recovery.kitInvalidateBody', detail: fillTemplate(t('recovery.kitInvalidateLimit'), { kitId }), detailTone: 'caution', variant: 'danger', confirmLabel: 'recovery.kitInvalidateConfirm' })` → `requireReauth({ reasonKey: 'recovery.kitReauthReason' })` → `authStore.invalidateRecoveryKit(kit.kitId, { kind: 'invalidate' })` → `toastKitInvalidateOutcome(outcome)`. The kit ID is carried in `detail` (a plain string) because `confirm()` takes keys for title/message; the title stays generic ("Invalidate This Kit?").
- `approveReplace(kit): Promise<boolean>`: the same gate (`kind: 'replace'`) → `confirm({ title: 'recovery.kitReplaceTitle', message: 'recovery.kitReplaceBody', variant: 'info', confirmLabel: 'recovery.kitReplaceConfirm' })` → `requireReauth(...)`. Returns whether the person may proceed; the mint itself is the host's. Takes no flow instance.
- `toastKitInvalidateOutcome(outcome: KitInvalidateOutcome)`: the ONE outcome → copy mapping, used by both paths: `save === 'saved'` → `showToast('success', t('recovery.kitInvalidated'))`; any other `save` → `showToast('info', t('recovery.kitInvalidateNotSynced'))`; `refusal: 'last_kit'` → `showToast('error', t('recovery.kitLastKit'))`; `'no_envelope'` → `t('recovery.podNotOpen')`; `'error'` → `showToast('error', t('recovery.kitInvalidateFailed'), { surface: 'recovery-kits', silent: true })` (`silent` because the store already reported it; `useToast.ts:24-30`).

### E. UI — `src/components/settings/RecoverySettings.vue` + new `src/components/settings/RecoveryKitsModal.vue`

- `RecoverySettings.vue`: replace the count caption with the summary line (`recovery.kitSummary` = "{live} live · {invalidated} invalidated · newest {newest}" via `fillTemplate`, no plural nouns; `recovery.kitNone` when `syncStore.liveRecoveryKitCount === 0`, and the `kitGenerate` vs `kitRegenerate` label at `:127` keys on the same condition). Keep the existing generate button, add a secondary **Manage Kits** button that opens the list modal. Both buttons in one `flex flex-wrap gap-2` row as in the mockup. `RecoverySettings` owns the single `useRecoveryKitFlow` instance and the single `RecoveryKitDisplay` already hosted here, plus `replacingKitId = ref<string | null>(null)`. It handles the list modal's events:
  - `create`: `showKits = false; await kitFlow.generate()`.
  - `replace(kit)`: `if (!(await approveReplace(kit))) return; replacingKitId = kit.kitId; showKits = false; await kitFlow.generate(); if (kitFlow.error.value) replacingKitId = null` (a failed mint leaves no pending replacement).
  - `invalidate(kit)`: `await invalidateKit(kit)` with the list left open (confirm and reauth layer above it).
  - In `handleKitStored`: `const oldKit = replacingKitId.value; replacingKitId.value = null;` first (no window for a second `stored` event during a 20 s invalidate), then `const durable = await kitFlow.confirmStored(via)`; if `oldKit` and `durable` → `toastKitInvalidateOutcome(await authStore.invalidateRecoveryKit(oldKit, { kind: 'replace' }))`; if `oldKit` and not durable → `statusMessage = t('recovery.kitReplaceNotSynced')` (instead of the flow's generic `kitNotSynced`) and `emitKitInvalidateOutcome({ outcome: 'refused', kind: 'replace', errorCode: 'confirm_not_synced' })`.
- `RecoveryKitsModal.vue` (Tier 1 `BaseModal`, `size="md"`, `fullscreenMobile`, title `recovery.kitsModalTitle`): props `open`, `kits: RecoveryKitSummary[]`, `canManage: boolean`; emits `close`, `create`, `invalidate(kit)`, `replace(kit)` and nothing else. `liveCount` is derived in the component from `kits`. The modal imports no `syncStore`, `authStore` or `usePermissions`; `RecoverySettings` binds `syncStore.recoveryKits` and `usePermissions().canManagePod`. Row markup mirrors `PasskeySettings.vue:179-267` (rounded-2xl bordered rows, `text-sm font-medium` title, `text-xs ink-soft` meta). Live row: `Kit <id>` + optional "Newest" pill (`bg-[var(--tint-orange-8)] text-[#F15D22] dark:text-accent-lift rounded-full`, the `MealEditModal.vue:277` pairing) + meta "Created {date} by {name}" / "Created {date}"; action = the passkeys Remove button style (`PasskeySettings.vue:262`, red outline, `dark:text-danger-lift`) labelled Invalidate, or a ghost button labelled Replace with a `text-xs ink-faint` hint below when `liveCount === 1`. Invalidated row: `bg-gray-50 dark:bg-surface-overlay`, ID `line-through` in `ink-faint`, meta "Invalidated {date} by {name}" / "Invalidated {date}", an "Invalidated" pill, no action. Footer: **Create a New Kit** (secondary) and **Close**. `canManage` false: `SettingsAdminOnlyNotice` above the list, no action buttons.
- Dates: `import { formatDate } from '@/utils/date'` (`:52`) used directly in the template (do not copy `PasskeySettings`' one-line wrapper). Names: the modal calls `useMemberInfo().getMemberName(id, t('family.unknownMemberInline'))` directly (a roster-only read; `getMemberName`'s bare `'Unknown'` default is never used).
- Dark mode: every painted background has a partner (`dark:bg-surface-overlay` on dead rows, `dark:border-line` on rows); accents use `-lift` partners; no opacity modifiers on text.

### F. Sign-in — `src/services/auth/recoveryKit.ts` + `src/components/login/LoadPodView.vue`

- `redeemRecoveryKit` is **unchanged in behaviour**. A revoked kit's wrap never reaches it (see the caveat), so an invalidated kit fails as `wrong-code` (or `no-kits` when no live kit remains). Fix only the stale docstring at `:141-143` ("until #117 rotation retires them" → "until a `recoveryKeys:<kitId>` slot tombstone retires them (#99); revoked wraps are filtered before this function is reached").
- `LoadPodView.handleKitRedeem`: the envelope in reach already carries `revokedKeys`, so the view can say _why_ a code might not match. `const hasInvalidatedKits = summarizeRecoveryKits(envelope).some(k => k.status === 'invalidated')`; on `wrong-code` **or** `no-kits`, show `t('recovery.kitWrongCodeOrInvalidated')` when it is true, else the existing copy. Telemetry unchanged: `emitKitRedeemed({ outcome: 'failed', errorCode: result.reason })`; the redeem cannot attribute a failure to a specific dead kit, and the plan does not claim it can.

### G. Copy — `src/services/translation/uiStrings.ts`

New keys (each with `en` + `beanie`; nouns kept in `beanie`): `recovery.kitSummary`, `recovery.kitsManage`, `recovery.kitsModalTitle`, `recovery.kitsModalIntro`, `recovery.kitRowLabel` ("Kit {kitId}"), `recovery.kitCreatedBy`, `recovery.kitCreatedOn`, `recovery.kitInvalidatedBy`, `recovery.kitInvalidatedOn`, `recovery.kitNewest`, `recovery.kitInvalidatedPill`, `recovery.kitInvalidate`, `recovery.kitReplace`, `recovery.kitReplaceHint`, `recovery.kitInvalidateTitle`, `recovery.kitInvalidateBody`, `recovery.kitInvalidateLimit` (carries `{kitId}`), `recovery.kitInvalidateConfirm`, `recovery.kitReplaceTitle`, `recovery.kitReplaceBody`, `recovery.kitReplaceConfirm`, `recovery.kitReauthReason`, `recovery.kitInvalidated` (toast), `recovery.kitInvalidateNotSynced` (info toast: staged, rides the next save), `recovery.kitInvalidateFailed`, `recovery.kitReplaceNotSynced` ("Your new kit hasn't reached your family file yet, so your old kit is still valid. Once it has synced, invalidate the old one from Manage Kits."), `recovery.kitLastKit`, `recovery.kitWrongCodeOrInvalidated` ("That code doesn't match any live recovery kit for this family. A kit that was invalidated from Manage Kits no longer opens your family's data."). Reuse `settings.adminOnly` + `confirm.notAllowedTitle` for the not-authorised alert, `SettingsAdminOnlyNotice` for the notice, and `family.unknownMemberInline` for an unknown creator. Retire `recovery.kitCount` (its only reader is `RecoverySettings.vue:118`).

### H. Telemetry facade — `src/services/telemetry/loginFlowEvents.ts`

The `login-flow` surface forbids hand-typed `logEvent` calls (`loginFlowEvents.ts:4-6`); every kit lifecycle event already lives there. Add one emitter: `emitKitInvalidateOutcome({ outcome: 'invalidated' | 'refused' | 'not_synced', kind: 'invalidate' | 'replace', errorCode?, saveStatus?, liveRemaining? })` → message `kit_invalidate_outcome`, level `info` for `invalidated`, `warn` otherwise, context `{ action: outcome, kind, error_code?: <refusal>, save_status?: DurableSaveOutcome, count?: liveRemaining }` (`save_status` is what `removal_not_published` already uses for a `DurableSaveOutcome`, `familyStore.ts:711-720`). No second emitter: a replacement whose confirmation did not sync is `refused` / `confirm_not_synced`, and the existing `kit_confirm_not_synced` fires alongside from the flow.

### I. Help — `src/content/help/security.ts`

Update the `password-recovery` article (see Help Center Coverage; sentence at `:584`, `updatedDate` at `:568`).

## Files Affected

- `src/types/syncFileV4.ts` — `createdBy` on `RecoveryKeyPackage`, `revokedBy` on `EnvelopeTombstone`, doc-comment fix
- `src/services/sync/envelopeMerge.ts` — `slotTombstoneEntryKey` (inverse of `revocationKey`)
- `src/services/auth/recoveryKit.ts` — `RecoveryKitSummary`, `summarizeRecoveryKits`, redeem docstring fix
- `src/stores/syncStore.ts` — `recoveryKits`, `liveRecoveryKitCount`, `revokeRecoveryKit` (observe → guard → tombstone → push)
- `src/stores/authStore.ts` — `createdBy` stamp, `invalidateRecoveryKit` + `KitInvalidateOutcome`
- `src/composables/useRecoveryKitActions.ts` — NEW: `invalidateKit`, `approveReplace`, `toastKitInvalidateOutcome`
- `src/components/settings/RecoverySettings.vue` — summary line, Manage Kits button, hosts the list modal, owns Replace state
- `src/components/settings/RecoveryKitsModal.vue` — NEW: Tier 1 list modal, prop-driven, emits only
- `src/components/login/LoadPodView.vue` — invalidation-aware wrong-code copy
- `src/services/telemetry/loginFlowEvents.ts` — `emitKitInvalidateOutcome`
- `src/services/translation/uiStrings.ts` — new keys, `recovery.kitCount` retired
- `src/content/help/security.ts` — article update
- `docs/mockups/recovery-kits-manage-2026-09-24.html` — approved mockup (already committed)
- Tests: `src/services/auth/__tests__/recoveryKit.test.ts`, `src/services/sync/__tests__/envelopeMerge.test.ts`, new `src/composables/__tests__/useRecoveryKitActions.test.ts`, new `src/components/settings/__tests__/RecoveryKitsModal.test.ts`, new `src/components/settings/__tests__/RecoverySettings.test.ts` (Replace state), syncStore/authStore tests for the new actions. `useRecoveryKitFlow.test.ts` unchanged.

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `security`
- **Slug**: `password-recovery` (existing: "Your Recovery Kit (and Other Ways Back In)")
- **Title**: unchanged
- **Scope**: In the "The recovery kit is what gets you back in" section, replace the "Creating a new kit does not switch off an old one" sentence with: every kit has an ID printed on it; Settings → Security & Recovery → Manage Kits lists every kit by that ID; the owner or a pod manager can invalidate a kit they no longer trust, and it stops opening the family's data on every device once they sync; the only remaining kit can only be replaced, not removed; and the limit: a copy of the family file saved before the invalidation can still be opened with the old kit, so destroy printouts you no longer trust.
- **Notes**: Invalidation is irreversible. Say plainly that the old-copy limit exists and why (no key rotation). Do not promise that invalidating a kit protects a file someone already copied.

## Observability Coverage

All kit lifecycle events stay on the existing `login-flow` surface, via the facade in `loginFlowEvents.ts`, so one CloudWatch filter covers the whole lifecycle (`kit_generated`, `kit_confirm_not_synced`, `kit_guard`, `kit_redeemed`, and now the one below).

- **Events**
  - `kit_invalidate_outcome` — `login-flow`, info on `invalidated`, warn otherwise; context `{ action: 'invalidated' | 'refused' | 'not_synced', kind: 'invalidate' | 'replace', error_code?: 'not_authorized' | 'last_kit' | 'no_envelope' | 'error' | 'confirm_not_synced', save_status?: DurableSaveOutcome, count?: <live kits remaining> }`. Emitted on every branch of `authStore.invalidateRecoveryKit`, on the composable's authorization refusal, and on a replacement whose confirmation did not sync.
  - `kit_invalidate_failed` — `reportError` severity `error`, `login-flow`, the catch-all around the store call (never critical: the user sees the error and the kit stays valid, nothing is at risk).
  - `kit_redeemed` (existing) `error_code: 'wrong-code' | 'no-kits'` — an invalidated kit tried at sign-in lands here; it is not distinguishable from a mistyped code by design (no kit identity in the code).
  - `kit_confirm_not_synced` (existing) fires from the flow alongside the `confirm_not_synced` refusal.
  - `revoked_entries_filtered` (existing, `envelope-revocation`) continues to count stale-client resurrections, now including kits.
- **Failure modes covered**: not authorised, last-kit refused (including the two-device race, since the guard runs after `observeRemote()`), no envelope, store throw (`reportError`), push failed / timed out (distinguished by `save_status`), replacement not synced. No bare `catch {}`; the redeem loop's per-entry catch stays (it is the "try next kit" mechanism) and the outer catch already returns a typed `'error'`.
- **Success-path signal**: `kit_invalidate_outcome{action:'invalidated'}` on every success with the remaining live count, so invalidation rate and last-kit replacements are measurable.
- **Critical vs telemetry**: nothing pages Slack. A failed invalidation leaves the kit valid and tells the user; no data is at risk.
- **Privacy/store gate**: only existing allowlisted keys (`action`, `kind`, `error_code`, `save_status`, `count`). No member ids or kit ids in context; `createdBy`/`revokedBy` live inside the encrypted envelope and are never logged. No allowlist or store-declaration change.

## Acceptance Criteria

- [ ] Settings → Security & Recovery shows the kit summary line and Manage Kits + Create a New Kit buttons (light and dark)
- [ ] Manage Kits lists every kit with an ID matching the printed kit, created date, creator where recorded; invalidated kits stay listed, greyed, with invalidated date and revoker
- [ ] Invalidating a kit on device A makes that kit fail on device B after sync; the sign-in error names invalidation as a possible cause
- [ ] A device that never saw the invalidation cannot restore the kit by merging (tombstone survives a merge with a stale envelope)
- [ ] The last live kit shows Replace, not Invalidate; the store refuses `last_kit` on a freshly merged envelope; Replace produces a new saved kit before the old one is invalidated; a not-synced confirmation leaves the old kit valid and says so
- [ ] Invalidate and Replace require the PIN step-up
- [ ] A member without `canManagePod` sees the list, the admin-only notice, and no actions; `useRecoveryKitActions` refuses before any store call
- [ ] New kits record `createdBy`; older kits show ID + date only
- [ ] The help article matches shipped behaviour
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified
- [ ] `npm run validate` green; every new string has `en` + `beanie`

## Testing Plan

1. Unit `recoveryKit.test.ts`: existing round-trips unchanged; `summarizeRecoveryKits` sorts live-then-invalidated newest-first, ignores value-pinned tombstones, and carries `createdBy`/`revokedBy`.
2. Unit `envelopeMerge.test.ts`: `slotTombstoneEntryKey` round-trips `revocationKey` and returns `null` for pinned/other-field keys; a `recoveryKeys:<kitId>` tombstone drops the entry on both sides of a merge, survives a merge with a stale envelope that still carries the wrap, and keeps `revokedBy`.
3. Unit syncStore/authStore: `revokeRecoveryKit` observes remote, refuses `last_kit` when no _other_ live kit remains (including after a remote tombstone arrives during `observeRemote`), refuses `no_envelope`, writes the tombstone with `revokedBy`, pushes on the credential budget; `invalidateRecoveryKit` passes refusals and `save` through and returns `refusal: 'error'` on a throw; `createRecoveryKit` stamps `createdBy`.
4. `useRecoveryKitFlow.test.ts`: unchanged (no flow change).
5. Unit `useRecoveryKitActions.test.ts`: no `canManagePod` → alert, `refused/not_authorized`, no confirm; cancel at confirm → no reauth, no store call; reauth false → no store call; `toastKitInvalidateOutcome` maps every outcome to the right toast.
6. Component `RecoveryKitsModal.test.ts` (`createTestingPinia` with a seeded roster; no syncStore): rows render for live and invalidated kits with resolved names; Replace appears only when one live kit; no actions and the admin-only notice when `canManage` is false; emits only.
7. Component `RecoverySettings.test.ts`: Replace + durable confirm invalidates the old kit; Replace + not-durable leaves it, shows the replace-specific copy and emits `refused/confirm_not_synced`; a failed mint clears `replacingKitId`; `replacingKitId` is cleared before `confirmStored` is awaited.
8. Browser (light + dark, desktop + phone): create two kits, open Manage Kits, invalidate one, confirm the summary and rows; sign out with clear data, sign in with the invalidated code → the "or invalidated" message; with the live code → works. Then Replace the last kit: complete it → new live kit, old invalidated. Repeat Replace with the network throttled so `confirmStored` times out: two live kits, the replace-specific message, and Invalidate now offered on the old row.
9. Two-device: invalidate on A, sync B, redeem the old code on B → refused with the "or invalidated" message. Then, with two live kits, invalidate X on B in the background and Y on A: A's attempt is refused `last_kit`.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the pre-plan + mockup: tombstone-based invalidation on the #77 machinery, attribution fields, revoked-aware redeem, Tier 1 list modal, replace-the-last-kit flow inside `useRecoveryKitFlow`, help + observability.
- **Pass 2 (DRY + error handling)**: removed an impossible abandon path (kit modal is unclosable) and a duplicate redeem event; reshaped the actions into the `removeMember` function pattern with toast outcomes instead of dead ref state; moved the tombstone push into `syncStore` on the 20 s credential budget with `DurableSaveOutcome` semantics (`revokeMemberLink` precedent, `'failed'` is the only failure); reused `SettingsAdminOnlyNotice`/`settings.adminOnly` instead of two new keys; collapsed four management events into one `kit_invalidate_outcome` on `login-flow` via the facade; verified every assumption against the code.
- **Pass 3 (Sustainability)**: single authorization source via `usePermissions()` in the composable (the `familyStore.ts:912` citation was the no-owner fallback; `useMintTarget.ts:34-39` warns against raw `canManagePod`); `useRecoveryKitFlow` left untouched with the Replace state moved to its only host; store action renamed `revokeRecoveryKit` with a pure `summarizeRecoveryKits` + `slotTombstoneEntryKey` in the services that own the formats; one `KitInvalidateOutcome` union on the `deleteMember` shape and one outcome→toast mapper; `kit_replace_abandoned` folded into `kit_invalidate_outcome`; prop-driven list modal; reused `family.unknownMemberInline`; recorded the 5 s `confirmStored` budget as the Replace flow's known degraded path.
- **Pass 4 (Fresh-eyes sweep)**: dropped the `'revoked'` redeem reason (revoked wraps are filtered from every envelope before `redeemRecoveryKit` runs, so it could never fire) in favour of invalidation-aware sign-in copy; moved the last-kit guard into `syncStore.revokeRecoveryKit` on `authoritativeEnvelope()` after `observeRemote()` (the store ref is a pre-merge snapshot after background sync, and the plan had placed the rule in two layers); corrected the "store-private budget" and "two scroll locks" rationales, the repository/display paths, the modal's name-resolution contract, the generate-label condition, cleared `replacingKitId` before the await, and put `DurableSaveOutcome` on `save_status` like member removal.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> /beanies-pre-plan let's prepare and plan notion #99 so that recovery kits can be viewed and invalidated as required from the UI, once done move to /beanies-plan

### Pre-plan decisions (AskUserQuestion, 2026-09-24)

> Last kit: "Block, unless replaced in the same flow". Permission: "Owner and pod managers" (canManagePod; every member can see the list). History: "Show as invalidated". Mockup: "Two directions to compare" → approved "B: modal from the drawer".

### Hand-off prompt to /beanies-plan

> The assembled `=== BEANIES PRE-PLAN ===` block for Notion #99 (stored on the Notion row under "beanies-plan prompt").

</details>

## Outcome (2026-09-24, built via /beanies-build-auto, NOT committed, NOT deployed)

Built to the plan; `validate` green (8698 tests); browser-verified in real Chromium (light, dark, phone) through the harness `scripts/design-screenshots/recovery-kits-capture.ts`: two live kits → Invalidate (red confirm + PIN) → the remaining kit reads Replace → Replace (info confirm + PIN + kit modal) → `1 live · 2 invalidated`, with `kit_invalidate_outcome` emitted for both kinds.

**Deviations from the plan, and why:**

- **The concurrent two-device race is detected, not prevented.** Requirement 6 and the Pass 4 note overclaimed: the store guard closes the sequential case (a peer's tombstone merged before this device counts) but two devices retiring "the other" kit inside the same observe→push window both pass. Because each device's own commit still holds the peer's kit, the exhausted state is only visible at a merge, so `logRecoveryKitsExhausted` (`recovery_kits_exhausted`, `envelope-revocation`) now fires from the merge termini, once per family per session. The kit nag keys on the doc-side confirmation stamp and would not notice; this is the only signal. Review round 1 finding.
- **`kit_invalidate_outcome` carries `detail: 'unobserved'`** when `observeRemote()` failed before the guard ran, and `count` is taken on the authoritative envelope after the push (the store ref can be one commit stale).
- **A `busy` prop on the list** disables every action while a revoke is in flight (up to 40 s), including the post-confirm revoke of the Replace flow.
- **Kit creation stays open to every member**, in the drawer and in the list footer. Round 1 asked for the footer Create to be gated on `canManagePod`; round 2 pointed out the drawer's button one row above is not, and the kit nag and sign-out guard mint kits for whoever is signed in, so a modal-only gate contradicted three surfaces. greg then decided (2026-09-24): a kit can reset every PIN, so minting is manager-only. `authStore.createRecoveryKit` refuses a signed-in member who is neither the owner nor `canManagePod` (the kit-born create flow, which runs before a roster exists, stays allowed), and both Settings surfaces hide Create for non-managers; the kit nag and sign-out guard were already manager-only (`authPrompts.ts`).
- **Not fixed, recorded:** `LoadPodView` builds the full kit summary to answer "does any kit tombstone exist" on a failed redeem (a handful of entries; negligible).

Two review rounds at `high`; the second was scoped to the first round's fixes and is the ceiling without greg.
