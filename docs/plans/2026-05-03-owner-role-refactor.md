# Plan: Owner role refactor — self-heal, card cleanup, transfer ownership

## Context

Three connected problems in the family-member role system:

1. **Missing Owner pill in greg's prod pod.** Confirmed: every member has role `member` or `admin`, none `owner`. Root cause: `applyDefaults()` in `familyMemberRepository.ts:9-19` backfills six fields but **not** `role`. Legacy/migrated data with a stripped owner has no defensive heal.

2. **No way to transfer ownership.** No UI, no store action; `updateMemberRole()` early-returns null for owners.

3. **Admin/Member dropdown on each card is redundant.** `usePermissions.ts` reads granular flags (`canManagePod/canViewFinances/canEditActivities`), not the role string. The granular permission UI **already exists** in `FamilyMemberModal.vue:101-191` (the edit pencil modal). The dropdown is fully redundant and clutters the name row.

Outcome: only role surfaces become (a) an Owner crown overlaid on the owner's avatar, and (b) granular permission toggles in the existing edit modal. Plus a Settings-level Transfer Ownership flow.

Registry note: `UserFamilyMapping.familyRole` is written at signup but **never read** anywhere (verified via grep). Skip registry update on transfer; document as cleanup tech debt for a future PR.

---

## What's reusable (no new code where existing primitives fit)

| Need                    | Reuses                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomic two-entity write | `changeDoc()` from `src/services/automerge/docService.ts` — single Automerge change wraps both demote + promote                                                                                 |
| Passkey re-auth         | `authenticateWithPasskey()` from `src/services/auth/passkeyService.ts`                                                                                                                          |
| Password verify         | `verifyPassword(plain, hash)` from `src/services/auth/passwordService.ts`                                                                                                                       |
| Password prompt UI      | `PasswordModal.vue` — props `open`, `title`, `description`; emits `confirm: string`                                                                                                             |
| Member picker           | `FamilyChipPicker` (`mode="single"`, `includePets={false}`) — needs one additive prop (`members?: FamilyMember[]`) so caller can pass adults-minus-current-owner                                |
| Multi-step modal shell  | `BeanieFormModal` (variant='modal') — internal step ref for pick → reauth → confirm                                                                                                             |
| Avatar badge mechanics  | `BeanieAvatar.vue` already has bottom-right filter-badge overlay; add one additive prop `ownerBadge?: boolean` rendering a top-right crown using the same Tailwind absolute-positioning pattern |
| In-place store update   | `members.value.map(...)` pattern from existing `updateMember()` (`familyStore.ts:237`)                                                                                                          |
| Error reporting         | `reportError({ surface, message, error?, context? })` from `src/utils/errorReporter.ts`                                                                                                         |
| Toasts                  | `showToast(level, key, ...)` from `src/composables/useToast.ts`                                                                                                                                 |
| Translations            | New keys in `src/services/translation/uiStrings.ts`; `npm run translate` auto-generates Chinese                                                                                                 |

**Net new code:** `normalizeRoles` helper, `transferOwnership` store action, `ReauthChallenge` component (genuinely reusable — not just for transfer), `TransferOwnershipModal` component, two additive props on existing components, translation strings.

---

## Stage 1 — Owner self-heal + role backfill

### `src/services/automerge/repositories/familyMemberRepository.ts`

- `applyDefaults()`: add `role: member.role ?? 'member'` so undefined never slips through.
- Change canManagePod default from `(role === 'owner' || role === 'admin')` to `(role === 'owner')`. Safe because Stage 1's normalization explicitly persists `canManagePod = true` on every legacy admin **before** the rule change has effect.

### `src/stores/familyStore.ts` — new `normalizeRoles(): Promise<void>`

Idempotent. Called from `loadMembers()` after `getAllFamilyMembers()`. **Single `changeDoc()` call** for atomicity.

```
Compute the set of writes in memory first; bail if empty (no-op fast path):

owners = list.filter(m => m.role === 'owner')

writes:
  if owners.length > 1: keep earliest createdAt; rest → 'member' (preserve flags)
  if owners.length === 0:
      candidate = humans, earliest createdAt + requiresPassword === false
      fallback: humans, earliest createdAt
      promote → role:'owner', canManagePod/canViewFinances/canEditActivities = true
      reportError({ surface: 'familyStore.normalize-roles', message: 'No owner — promoted candidate', context: { candidateId, memberCount } })
  for each member with role === 'admin':
      writes += { canManagePod ?? true, role: 'member' }

if writes.length === 0: return early

changeDoc((doc) => writes.forEach(w => apply to doc.familyMembers[w.id]))

Refresh local members.value via in-place map of just the affected ids.
```

### Error handling

`changeDoc` throw → caught at `wrapAsync` boundary → `reportError` + `showToast('error', 'family.normalizeRolesFailed')` with developer guidance in console (`'See familyStore.normalizeRoles — Automerge change rejected'`). Never silent.

### Delete dead code

Remove `updateMemberRole()` from `familyStore.ts` — no callers after Stage 2 (verified earlier; only consumer was `MeetTheBeansPage.handleRoleChange()`, which is also being removed). Per CLAUDE.md: "If you are certain that something is unused, you can delete it completely."

---

## Stage 2 — Remove role dropdown from card

### Delete

- `src/components/family/MemberRoleManager.vue` (only consumer is BeanCard.vue:250).

### Modify

- `src/components/family/BeanCard.vue` — remove `<MemberRoleManager>` block (lines 249-256). Pass `:owner-badge="member.role === 'owner'"` to `<BeanieAvatar>`.
- `src/components/ui/BeanieAvatar.vue` — add `ownerBadge?: boolean` prop. Renders Heritage Orange (`#F15D22`) circle with `👑` glyph at `absolute top-0 right-0`, sized ~30% of avatar, shadow + border for affordance. Mirrors existing bottom-right filter-badge mechanics. Comment in code: `// If a second per-avatar badge is ever needed, evolve to a slot or { icon, color, position } prop pattern; one boolean is sufficient today.`
- `src/pages/MeetTheBeansPage.vue` — remove `handleRoleChange()` (lines 345-347) and `@role-change` handler on `<BeanCard>`.

Granular permission editing is unchanged — already lives in `FamilyMemberModal.vue` (pencil icon).

---

## Stage 3 — Transfer Ownership flow

### `src/components/auth/ReauthChallenge.vue` — NEW (reusable)

Single-purpose component: verify the currently-authenticated user's identity. Reusable for any future high-stakes operation (delete pod, leave pod, change family name, etc.) — extracted now so we don't dup the logic the next time it's needed.

```ts
defineProps<{
  /** Member whose identity must be verified. */
  member: FamilyMember;
  /** Show or hide the challenge UI. */
  open: boolean;
}>();
defineEmits<{
  verified: [];
  cancelled: [];
}>();
```

Internal state: `mode: 'choose' | 'passkey' | 'password' | 'error'`, `errorMessage`. Algorithm:

1. On `open=true`: detect whether `member` has a passkey credential (via existing passkey-availability check in `passkeyService`).
2. If passkey available → show two buttons: "Verify with passkey" (primary) and "Use password instead" (secondary).
3. Passkey path → `authenticateWithPasskey()`. Cancellation drops back to choose screen (silent — passkey-cancellation is established noise per ADR). Real failure → set errorMessage + report.
4. Password path → render `<PasswordModal>` inline. On confirm, `verifyPassword(entered, member.passwordHash)`. False → inline error in modal (PasswordModal handles this). Modal cancel → emit `cancelled`.
5. Edge case: `!member.passwordHash && !hasPasskey` → show inline alert "Cannot verify identity. Set a password in Settings → Security first." Emit `cancelled` on dismiss. Report this case so we know if it happens in the wild.
6. Success at any step → emit `verified`.

All catch blocks `reportError` + show user-visible feedback. No `catch {}`.

### `src/stores/familyStore.ts` — new `transferOwnership(toMemberId: string): Promise<boolean>`

```ts
async function transferOwnership(toMemberId: string): Promise<boolean> {
  const result = await wrapAsync(isLoading, error, async () => {
    const target = members.value.find((m) => m.id === toMemberId);
    const currentOwner = owner.value;
    if (!target || target.isPet || target.id === currentOwner?.id) {
      reportError({
        surface: 'familyStore.transferOwnership',
        message: 'Invalid target',
        context: { toMemberId, currentOwnerId: currentOwner?.id },
      });
      return false;
    }

    // Single atomic Automerge change.
    changeDoc((doc) => {
      if (currentOwner) doc.familyMembers[currentOwner.id].role = 'member';
      const t = doc.familyMembers[toMemberId];
      t.role = 'owner';
      t.canManagePod = true;
      t.canViewFinances = true;
      t.canEditActivities = true;
    }, 'transfer ownership');

    // In-place local state update — same pattern as updateMember (familyStore.ts:237)
    members.value = members.value.map((m) => {
      if (m.id === currentOwner?.id) return { ...m, role: 'member' };
      if (m.id === toMemberId)
        return {
          ...m,
          role: 'owner',
          canManagePod: true,
          canViewFinances: true,
          canEditActivities: true,
        };
      return m;
    });

    // Reflect role change in authStore session if applicable
    const authStore = useAuthStore();
    if (authStore.currentUser?.memberId === currentOwner?.id)
      authStore.updateCurrentUserRole('member');
    else if (authStore.currentUser?.memberId === toMemberId)
      authStore.updateCurrentUserRole('owner');

    return true;
  });
  return result ?? false;
}
```

`wrapAsync` already handles top-level error reporting. `changeDoc` throw → caller surfaces toast + retry.

### `src/stores/authStore.ts` — new `updateCurrentUserRole(role: 'owner' | 'member')`

Mutates `currentUser.value.role`, re-persists session via existing `persistSession()`. Single function, used only by transferOwnership.

### `src/components/family/TransferOwnershipModal.vue` — NEW

Built on `BeanieFormModal` (variant='modal', size='lg'). Three internal panels via local `step` ref — single modal, no stacking:

1. **`pick`** — Title: `t('transferOwnership.pickTitle')`. Body: warning copy + `<FamilyChipPicker mode="single" :members="eligibleRecipients" v-model="selectedId" />`. Eligible = humans, adults, not current owner. "Continue" button disabled until selection.

2. **`reauth`** — `<ReauthChallenge :member="currentOwner" :open="step === 'reauth'" @verified="step = 'confirm'" @cancelled="step = 'pick'" />`.

3. **`confirm`** — Final panel inside the same BeanieFormModal: header "Transfer ownership to [Name]?", warning copy, footer [Cancel] [Transfer ownership] (danger styling). Confirm → calls `familyStore.transferOwnership(selectedId)`. Success → `showToast('success', 'transferOwnership.success', { name })` + close. Failure → toast error + stay on confirm step (allow retry).

State is local refs in this component; nothing leaks to the store. Modal close at any step resets state.

### `src/components/ui/FamilyChipPicker.vue` — additive prop

Add optional `members?: FamilyMember[]`. If provided, render that list; else use existing store-pull. Backward-compatible.

### `src/pages/SettingsPage.vue` — entry point

New row under existing Family section, gated to `isOwner`:

- Title: `t('settings.transferOwnership')`
- Description: `t('settings.transferOwnershipDesc')`
- Click → opens `<TransferOwnershipModal>`

### `src/services/translation/uiStrings.ts` — new keys

- `family.role.ownerBadge` — accessible label on the crown ("Pod Owner")
- `transferOwnership.pickTitle`, `pickDescription`, `warning`
- `transferOwnership.reauthTitle`, `reauthPasskeyButton`, `reauthPasswordButton`, `reauthNoCredential`
- `transferOwnership.confirmTitle`, `confirmMessage`, `confirmAction`, `cancel`
- `transferOwnership.success`, `failed`, `invalidTarget`
- `settings.transferOwnership`, `settings.transferOwnershipDesc`
- `family.normalizeRolesFailed`

---

## Files affected

### Created

- `src/components/auth/ReauthChallenge.vue` (reusable; not transfer-specific)
- `src/components/family/TransferOwnershipModal.vue`
- `docs/plans/2026-05-03-owner-role-refactor.md`

### Modified

- `src/services/automerge/repositories/familyMemberRepository.ts`
- `src/stores/familyStore.ts` (add normalizeRoles + transferOwnership; **remove** dead `updateMemberRole`)
- `src/stores/authStore.ts` (add `updateCurrentUserRole`)
- `src/components/family/BeanCard.vue`
- `src/components/ui/BeanieAvatar.vue` (add `ownerBadge` prop)
- `src/components/ui/FamilyChipPicker.vue` (add optional `members` prop)
- `src/pages/MeetTheBeansPage.vue` (drop role-change wiring)
- `src/pages/SettingsPage.vue` (add Transfer Ownership row)
- `src/services/translation/uiStrings.ts`
- Tests (see below)

### Deleted

- `src/components/family/MemberRoleManager.vue`

---

## Sustainability principles applied

- **No dead code:** delete `updateMemberRole` once its only caller is gone. Don't carry unused mutation surfaces.
- **No nested modal stacks:** the transfer flow lives in one BeanieFormModal with internal step state; no `useConfirm()` overlay, no PasswordModal-on-top-of-BeanieFormModal-on-top-of-anything.
- **Reusable extraction with clear scope:** `<ReauthChallenge>` is pulled out because three foreseeable callers exist (transfer, leave pod, delete pod) — but it has one well-defined contract (`open` + `member` props, `verified`/`cancelled` events) and lives in `src/components/auth/`. No god-component creep.
- **In-place state updates:** `members.value.map(...)` instead of full re-fetch; matches existing patterns in the same store.
- **Single-source-of-truth atomicity:** one `changeDoc()` per logical operation. No partial-failure reconciliation code.
- **No tech debt added:** registry `familyRole` field stays as-is (never read, harmless). Tracked as a separate cleanup, not bolted onto this PR.
- **Future-proof prop names without future-proofing the implementation:** `BeanieAvatar.ownerBadge` is a single boolean, with a code comment explaining the evolution path when (and only when) a second badge appears.
- **No silent failures:** every try/catch reports + surfaces. No `catch {}`. PasswordModal already handles inline wrong-password feedback. Edge case (no passkey + no password) gets a clear recovery prompt with a deep link.

---

## Tests

- **familyStore** (`familyStore.test.ts`):
  - `normalizeRoles`: empty list, one owner (no-op), two owners (demote later), no owner with creator (promote earliest requiresPassword=false), no owner without creator (fallback to earliest), admin → member migration with canManagePod preserved.
  - `transferOwnership`: happy path (owner ↔ member), reject pet target, reject same-owner target, reject child target via picker filter (UI-level test).
- **applyDefaults** regression: undefined `role` → `'member'`.
- **BeanieAvatar**: smoke test — renders crown when `ownerBadge=true`, doesn't when false.
- **ReauthChallenge**: passkey success, passkey cancel → password fallback success, password fail → retry, no-credential edge case.
- **TransferOwnershipModal**: integration — mount, pick member, advance steps, assert `transferOwnership` called with right args.

---

## Verification

1. **Stage 1** — load greg's pod in dev: `normalizeRoles` promotes greg → 'owner' on first load (logged via `reportError`). Reload: writes-set is empty → fast-path early return. Crown appears.
2. **Stage 2** — family page renders cleanly. Crown on owner only. No dropdown anywhere. Edit modal still opens with working permission toggles.
3. **Stage 3** — as owner: Settings → Transfer Pod Ownership → pick adult → passkey or password re-auth → confirm. Verify (a) target shows Owner crown after transfer, (b) outgoing owner no longer shows it, (c) `authStore.currentUser.role` reflects new state without reload, (d) the new owner can transfer back. Negatives: cancel re-auth (returns to pick), wrong password (inline error, retry), passwordless+passkeyless owner (clear guidance to set a password).
4. `npm run type-check`, `npx vitest run`, `npm run translate`.
5. CHANGELOG.md entry on commit.

## Sequencing

All three stages land in one PR for cohesion (shared data model, shared translations). Stage 1 is independently revertable; Stage 2 depends on Stage 1's data being correct; Stage 3 is independent of 1/2 once normalized.
