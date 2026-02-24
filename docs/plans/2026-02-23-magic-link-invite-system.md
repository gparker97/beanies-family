# Plan: Magic Link Invite System (#77)

> Date: 2026-02-23 (updated 2026-02-24)
> Related issues: #77 (depends on #76 DynamoDB registry)

## Context

Issue #76 added a DynamoDB registry mapping `familyId -> file location metadata`. Issue #77 builds on that to let family owners generate shareable invite links so new members can join the family.

**Current state**: FamilyPage has an invite modal generating links in old format (`?code={familyId}&role={role}`). JoinPodView is a stub showing "not available yet". The registry service (`lookupFamily`) and auth store (`setPassword`) are ready.

## Approach

### Step 1: Update FamilyPage Invite Modal

**File**: `src/pages/FamilyPage.vue`

Changes:

- Import `useSyncStore` to get `fileName` (display path)
- Update `inviteLink` computed to new format: `{origin}/join?fam={familyId}&p=local&ref={base64(fileName)}`
- Remove the role toggle (Parent/Child) — joiner picks their pre-created member
- Remove `inviteRole` ref
- Add info card telling owner to also share the `.beanpod` file separately (for local provider)
- Keep family code display and copy button (manual fallback)

### Step 2: Rewrite JoinPodView as 3-Step Wizard

**File**: `src/components/login/JoinPodView.vue` (major rewrite)

Replace the 138-line stub with a 3-step wizard. File loading is handled automatically as part of verification — not a separate step.

**Step 1 — Verify & Load**:

- Parse `fam`, `p`, `ref` from `route.query` (backward-compat: also read `code`)
- Call `lookupFamily(familyId)` to verify family exists and get file metadata
- **Auto-attempt file load based on provider**:
  - **Cloud provider (future)**: Use `fileRef` (e.g., Google Drive file ID) to fetch the file directly. On success, decrypt if needed and advance straight to Step 2.
  - **Local provider**: The file lives on the owner's device — we can't access it remotely. Show a friendly guidance modal explaining the situation with:
    - The expected file name (from registry `displayPath` or decoded `ref` param)
    - Provider-specific step-by-step instructions for the joiner (e.g., "Ask the owner to share the .beanpod file with you via email, a shared cloud folder, or USB")
    - A file picker button so the joiner can load the file once they have it
    - A drag-and-drop zone (reuse LoadPodView pattern)
- After file loads, validate `familyId` matches the URL `fam` param
- Handle encrypted files with decrypt modal (same BaseModal pattern as LoadPodView, sessionStorage password caching)
- On success → advance to Step 2

**Step 2 — Pick Your Bean**:

- Show only members with `requiresPassword === true` (unclaimed)
- Reuse PickBeanView's avatar grid pattern (88px BeanieAvatars, status indicators)
- Error if no unclaimed members found — prompt to ask owner to create their profile
- Selecting a member advances to Step 3

**Step 3 — Create Password**:

- Password + confirm password form (same pattern as PickBeanView's `isCreatingPassword`)
- Min 8 chars, match validation
- On submit: call `authStore.joinFamily()`
- On success: emit `signed-in` with `/dashboard`

State shape:

```typescript
type JoinStep = 'verify' | 'pick-member' | 'set-password';
const currentStep = ref<JoinStep>('verify');
const targetFamilyId = ref('');
const targetProvider = ref('local');
const targetFileRef = ref('');
const registryEntry = ref<RegistryEntry | null>(null);
const selectedMember = ref<FamilyMember | null>(null);

// File loading state (inline within verify step)
const fileLoaded = ref(false);
const needsManualFileLoad = ref(false); // true for local provider
const isLoadingFile = ref(false);
const showDecryptModal = ref(false);
```

### Step 3: Add `joinFamily()` to AuthStore

**File**: `src/stores/authStore.ts`

New action following `signUp()` pattern:

1. Call `setPassword(memberId, password)` — hashes password, updates member, auto-signs in
2. Create `UserFamilyMapping` in registry DB (same pattern as `signUp()`)
3. Mark onboarding completed via `settingsStore.setOnboardingCompleted(true)`
4. Return `{ success, error }`

Export it alongside existing actions.

### Step 4: Add i18n Keys

**File**: `src/services/translation/uiStrings.ts`

~20 new keys under `join.*` namespace:

- `join.verifyTitle`, `join.verifySubtitle`, `join.lookingUp`
- `join.familyFound`, `join.familyNotFound`, `join.registryOffline`
- `join.needsFile`, `join.needsFileDesc`, `join.expectedFile`, `join.fileMismatch`
- `join.localInstructions` — provider-specific guidance for obtaining the file
- `join.pickMemberTitle`, `join.pickMemberSubtitle`, `join.noUnclaimedMembers`
- `join.setPasswordTitle`, `join.setPasswordSubtitle`
- `join.completing`, `join.success`
- `join.shareFileNote` (for invite modal)
- Update existing `loginV6.joinStep1/2/3` to match new flow

### Step 5: Minor LoginPage Wiring

**File**: `src/pages/LoginPage.vue`

Minimal changes — JoinPodView is self-contained. May need to ensure store initialization happens before JoinPodView mounts (already does on `onMounted`).

## Files Affected

| File                                    | Change                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `src/components/login/JoinPodView.vue`  | Major rewrite — 3-step wizard with inline file loading                   |
| `src/pages/FamilyPage.vue`              | Update invite modal link format, remove role toggle, add share file note |
| `src/stores/authStore.ts`               | Add `joinFamily()` action                                                |
| `src/services/translation/uiStrings.ts` | ~20 new i18n keys                                                        |
| `src/pages/LoginPage.vue`               | Minor — ensure JoinPodView events are handled                            |

## Reused Patterns

- **File picker + drop zone**: from `LoadPodView.vue` (lines 315-367) — drag events, file validation, `.beanpod` extension check
- **Decrypt modal**: from `LoadPodView.vue` (lines 507-571) — BaseModal, password input, sessionStorage caching
- **Avatar grid**: from `PickBeanView.vue` (lines 179-211) — 88px buttons, BeanieAvatar xl, status indicators
- **Password creation form**: from `PickBeanView.vue` (lines 261-281) — BaseInput password/confirm, min 8 chars
- **UserFamilyMapping creation**: from `authStore.signUp()` (lines 157-167)
- **Registry lookup**: from `registryService.lookupFamily()`

## Edge Cases

- **Registry unavailable**: Graceful degradation — show message, allow manual file load without verification
- **Family not found**: Error with retry and manual code input
- **File not accessible (local provider)**: Friendly guidance modal with provider-specific instructions on how to get the file from the owner, plus file picker for manual load
- **File not accessible (cloud provider, future)**: Provider-specific error (e.g., "File not found on Google Drive — ask the owner to check sharing permissions") with step-by-step fix instructions that can be sent to the owner
- **File familyId mismatch**: Error "This file belongs to a different family"
- **No unclaimed members**: Error prompting user to ask owner to create their profile
- **Old link format** (`?code=`): Backward-compatible — treat `code` as `familyId`
- **Registry API not configured**: `lookupFamily` returns null — skip verification, go straight to manual file load

## Verification

1. `npm run type-check` — passes
2. `npm run build` — passes
3. Manual test: Owner generates invite link on FamilyPage → link has correct `fam/p/ref` format
4. Manual test: Open invite link → JoinPodView shows family info from registry
5. Manual test: Local provider shows guidance + file picker → load file → pick member → set password → dashboard
6. Manual test: Graceful degradation when registry unavailable
7. Manual test: File mismatch error when loading wrong family's file
8. Manual test: No unclaimed members shows helpful error
9. Existing E2E tests still pass (join flow is new, no regression risk)
