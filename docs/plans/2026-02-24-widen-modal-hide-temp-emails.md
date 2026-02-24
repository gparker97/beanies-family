# Plan: Widen member edit modal & hide temporary emails

> Date: 2026-02-24
> Related issues: none (user-reported UX improvements)

## Context

Two UX issues with family member management:

1. The edit member modal is too narrow (`md` = 448px) to comfortably show the invite/sharing section with its 3-step instructions and invite link.
2. Temporary placeholder emails (`pending-*@setup.local`) generated during family setup are visible to users in member cards, edit modals, and sign-in flows. These should be hidden.

## Approach

### 1. Widen the edit member modal

**File:** `src/pages/FamilyPage.vue` (line 543)

Add `size="lg"` to the edit member `<BaseModal>`:

```
<BaseModal :open="showEditModal" :title="t('family.editMember')" size="lg" @close="closeEditModal">
```

This changes the max-width from 448px → 512px.

### 2. Add a helper to detect temporary emails

**File:** `src/utils/email.ts` (new file)

```ts
export function isTemporaryEmail(email: string): boolean {
  return email.endsWith('@setup.local');
}
```

### 3. Add a UI string for the placeholder

**File:** `src/services/translation/uiStrings.ts`

Add: `'family.emailNotSet': { en: 'No email yet' }`

### 4. Hide temporary emails in all display locations

Five locations to update:

1. **`src/pages/FamilyPage.vue` (line 374)** — Member card email display
   - Replace `{{ member.email }}` with a conditional showing `t('family.emailNotSet')` when `isTemporaryEmail(member.email)`

2. **`src/pages/FamilyPage.vue` (line 543-558)** — Edit modal email input
   - When the email is temporary, show the placeholder text instead of the raw email, and clear it for editing

3. **`src/components/login/JoinPodView.vue` (line 757)** — Member selection during join
   - Same conditional pattern

4. **`src/components/login/PickBeanView.vue` (line 248)** — Member selection during sign-in
   - Same conditional pattern

5. **`src/components/common/AppHeader.vue` (line 439)** — Profile dropdown
   - Same conditional pattern (unlikely to show temp email for authenticated user, but defensive)

## Files affected

- `src/utils/email.ts` — new utility (1 function)
- `src/services/translation/uiStrings.ts` — add `family.emailNotSet` string
- `src/pages/FamilyPage.vue` — widen modal, hide temp emails in card + edit form
- `src/components/login/JoinPodView.vue` — hide temp email
- `src/components/login/PickBeanView.vue` — hide temp email
- `src/components/common/AppHeader.vue` — hide temp email

## Verification

1. `npm run type-check` passes
2. `npx vitest run` — all unit tests pass
3. Manual: create family with additional members → member cards show "No email yet" instead of `pending-*@setup.local`
4. Manual: edit member modal is visibly wider and invite section has more room
5. Manual: sign-in member picker doesn't show temp emails
