# Plan: Invite Wizard — picker step + FAQ refresh (rev 2)

> Mockup: `docs/mockups/invite-wizard-picker.html`
> Refines: `docs/plans/2026-04-26-invite-wizard.md` (already shipped)

## Context

The wizard shipped yesterday opens at a blank email field when entered from the generic "Invite Beanie" CTA — the user has to remember + type the email of someone already in the pod. This iteration replaces that with a **picker step** that lists every beanie waiting to join as a tappable row. Already-joined beanies are dimmed with "✓ joined"; the owner is dimmed with "★ pod owner". An end-of-list **"+ add a new beanie"** tile funnels into the existing `FamilyMemberModal`; on save, the wizard reopens at the confirm-email step with the new bean pre-selected.

Three smaller fixes ride along:

- **Smarter pre-fill** — when a picked bean's `email` is a system placeholder (`*@temp.beanies.family`, `*@setup.local`), leave the field blank and surface a Sky-Silk warning chip + an inline `▸ what if my child doesn't have an email?` `<details>` disclosure. Real emails always pre-fill (existing pulse).
- **FAQ font + copy** — drop Caveat for Outfit-bold; rename to "You've got questions? We've got answers". Caveat reserved for Step 2's QR accent.
- **FAQ Q2 + Q3 copy** — Q3 was wrong (non-Google joiners can't open the Drive-backed pod). Restore accurate answer pointing to `accounts.google.com` with a kids note linking to `families.google/familylink/`. Q2 (kids) gets the same Family Link reference.

Per-bean share button (BeanCard share icon) is unchanged — skips picker, opens at confirm-email with prefill.

## Reuse audit — verified candidates

| Concern                               | Existing                                                                                                                                                                                                          | Decision                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Member sort + filter                  | `familyStore.sortedHumans` (sorted, pets removed)                                                                                                                                                                 | **Reuse** — picker consumes directly.                                                                                                                                                                                                                                                                                                                                                   |
| Avatar                                | `BeanieAvatar.vue` + `getAvatarVariant()` (`useMemberAvatar`) + `getMemberAvatarUrl()` (`useMemberInfo`) — same trio QuickAddMemberPicker uses                                                                    | **Reuse all three**. `size="md"` for picker rows.                                                                                                                                                                                                                                                                                                                                       |
| Already-joined detection              | `member.requiresPassword === false`                                                                                                                                                                               | **Reuse**. Owner special-cased.                                                                                                                                                                                                                                                                                                                                                         |
| Unshareable email                     | `isUnshareableEmail()` in `src/utils/email.ts`                                                                                                                                                                    | **Reuse**. Wizard computes `realEmail = email && !isUnshareableEmail(email) ? email : ''`.                                                                                                                                                                                                                                                                                              |
| `<details>` disclosure                | FAQ section in current `InviteWizardModal.vue` (lines 356–397) — `+` chevron rotates 45° on `:group-open`                                                                                                         | **Match exact pattern** for child-hint (cream tint instead of orange — softer hierarchy than FAQ).                                                                                                                                                                                                                                                                                      |
| **Existing member-picker components** | `QuickAddMemberPicker.vue` (3-col grid, avatar+name only, tied to `useQuickAdd`); `PickBeanView.vue` (login picker, avatar grid w/ password-state badge); `FamilyChipPicker.vue` (compact assignee chip selector) | **Don't extract a shared component**. The invite picker is a stacked list with role/age/email visible per row — totally different information density and shape. Forcing one parent component would mean two visual modes, more props, more conditionals. Better: share the helpers (which already are shared), keep the SFCs focused. Three similar lines beats premature abstraction. |
| **"+ Add" tile**                      | `AddTile.vue` — dashed border, `label` prop, optional `minHeight`, emits `click`                                                                                                                                  | **Reuse as-is**. No need to build inline.                                                                                                                                                                                                                                                                                                                                               |
| Hero-band wash                        | `var(--tint-orange-8)`                                                                                                                                                                                            | **Reuse** for picker hero.                                                                                                                                                                                                                                                                                                                                                              |
| Bean-wiggle animation                 | Scoped style in `InviteWizardModal.vue`                                                                                                                                                                           | **Reuse** keyframes for picker mascot.                                                                                                                                                                                                                                                                                                                                                  |
| `FamilyMemberModal` save flow         | Emits `CreateFamilyMemberInput`; parent's `handleMemberSave` calls `familyStore.createMember(data)` and currently **discards** the returned `FamilyMember                                                         | null`                                                                                                                                                                                                                                                                                                                                                                                   | **Capture the return value**. Single-line change. No need for save-event payload changes. |
| `familyStore.createMember`            | `Promise<FamilyMember \| null>` — already wraps creation in try/catch and returns null on store/repo error (logged with `[familyStore]` prefix)                                                                   | **Use as-is**. Null branch handled explicitly (warn + don't reopen).                                                                                                                                                                                                                                                                                                                    |
| **i18n strings with anchor links**    | `PwaReinstallModal.vue` lines 34–56: i18n strings contain raw `<a>` tags; rendered with `v-html="step"`. Established pattern.                                                                                     | **Reuse the pattern** for FAQ a2/a3 only (static strings, no user data). Do NOT use v-html for any string that interpolates user input.                                                                                                                                                                                                                                                 |
| `useToast`                            | Non-blocking, doesn't interfere with modal opens                                                                                                                                                                  | **Reuse** for the existing add-success toast + a new error toast on createMember-null.                                                                                                                                                                                                                                                                                                  |
| Status chips (✓ joined / ★ pod owner) | `MemberChip` is for member _identity_ (initial pill in member's color); inline Tailwind chips used elsewhere for _state_ (e.g., BeanCard footer's "{N} faves")                                                    | **Inline Tailwind** for status chips — semantically about state, not identity.                                                                                                                                                                                                                                                                                                          |
| `hasInvitableMembers` button gate     | Hides Invite button when no invitable members                                                                                                                                                                     | **Drop the gate** — picker handles empty pod with caption + add-tile.                                                                                                                                                                                                                                                                                                                   |

**Genuinely new code**:

- `src/components/family/InvitePickerStep.vue` — ~140 lines, presentational only, consumes `<BeanieAvatar>` + `<AddTile>` + `useTranslation`.
- ~12 new i18n keys + 3 updated values.
- ~80 lines net change in `InviteWizardModal.vue`.
- ~25 lines net change in `MeetTheBeansPage.vue`.

No new dependencies. No new utilities. No composable changes. No new shared components extracted (audit found existing candidates aren't close enough to refactor without bloat).

## Architecture

`useInviteFlow` is unchanged. Picker is pure UI selection — no link generation, no Drive API. "Currently picked bean" lives in wizard local state alongside `currentStep`.

```
┌─ MeetTheBeansPage.vue ─────────────────────────────────┐
│ • inviteFlow = useInviteFlow()                          │
│ • pendingShareMember (carried over)                     │
│ • opens wizard from generic CTA OR per-bean share       │
│ • NEW: handleAddBeanFromWizard():                       │
│     wizardOpen=false → showAddModal=true                │
│ • UPDATED handleMemberSave():                           │
│     captures `created = await createMember(data)`       │
│     if (!created) showToast('error', ...) — no reopen   │
│     else if (!isPet) pendingShareMember = created       │
│       wizardOpen = true (wizard sees prefill, step=1)   │
│ • drops `hasInvitableMembers` button gate               │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─ InviteWizardModal.vue ───────────────────────────────┐
│ Steps: 0 (picker) | 1 (confirm-email) | 2 (send-link)  │
│ Initial step on open: 0 if !prefill, 1 otherwise       │
│ Local state: currentStep, pickedMember, emailValue,    │
│              confirmed, faqOpen, childHintOpen          │
│ Step 0: <InvitePickerStep>                             │
│   on `select` → pickedMember=m, currentStep=1          │
│   on `add-bean` → emit('add-bean')                     │
│ Step 1: invitee chip (with change link if !prefill)    │
│   if !realEmail: warning chip + child-hint             │
│   email + confirm + cta + faq (rest unchanged)         │
│ Step 2: unchanged                                      │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─ InvitePickerStep.vue (new) ──────────────────────────┐
│ Props: members: FamilyMember[], ownerId: string|null   │
│ Reuses BeanieAvatar, getAvatarVariant,                 │
│        getMemberAvatarUrl, AddTile                     │
│ Emits: select(memberId), add-bean                      │
│ Pure presentational                                     │
└─────────────────────────────────────────────────────────┘
```

## Maintainability check

| Rule                           | Status                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Wizard prop count ≤ 6          | **Still 5** — no new props.                                                                                                         |
| State has one home             | Picked-member state UI-local to wizard. Composable still owns invite-link state. Page owns add-bean orchestration.                  |
| No deep template ladders       | Step 0 = `<InvitePickerStep>`. Step 1's new conditionals (invitee chip, warning chip, child-hint) are sibling branches, not nested. |
| One responsibility per surface | Picker = selection. Wizard = step orchestration. Composable = invite-link logic. Page = wiring + add-bean.                          |
| Testable                       | E2E covers picker → email → send. Picker has no business logic to unit-test.                                                        |

## Error handling — every failure point

No silent failures. Every async path logs `[<module>]` prefix and surfaces user-facing recovery.

| Failure point                                                                | User-visible                                                                                                                                                                               | Console                        | Recovery                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------ |
| Picker rendered with empty `sortedHumans` (solo owner)                       | Empty-state caption: "no beanies waiting yet — add one to send your first invite" + the add-tile                                                                                           | none                           | Tap add-tile                   |
| Picker `select` with stale member ID (race vs. delete during open modal)     | Wizard advances; chip shows known info; downstream `useInviteFlow.error` catches real failures (already wired)                                                                             | none                           | Edit email or change recipient |
| Add-tile clicked but user closes FamilyMemberModal without saving            | Wizard stays closed (we explicitly closed on add-bean tap). User reopens via "Invite Beanie" again.                                                                                        | none                           | Reopen wizard manually         |
| `createMember` returns `null` (store/repo failure — already logged by store) | `showToast('error', t('family.addMemberFailed'))` — sticky toast w/ retry guidance. Wizard does NOT reopen.                                                                                | already `[familyStore]` logged | Retry from family page         |
| `createMember` throws (unhandled)                                            | Caught by existing `try/catch` in `handleMemberSave` — `showToast('error', ...)` + `console.error('[meetTheBeans] handleMemberSave failed', e)`                                            | new explicit catch             | Retry                          |
| `isUnshareableEmail` false-positive on a real email                          | User sees blank field + warning when expecting prefill. Types email; nothing permanently broken.                                                                                           | none                           | Type email                     |
| `v-html` rendering — XSS surface                                             | FAQ a2/a3 strings are static literals in `uiStrings.ts`, never interpolated with user data. childHint body uses generic "them" (no `{name}` substitution) to keep `v-html` user-data-free. | none                           | n/a                            |

## Critical files

**Create**

- `src/components/family/InvitePickerStep.vue` — picker UI. Imports `BeanieAvatar`, `AddTile`, `getAvatarVariant`, `getMemberAvatarUrl`, `useTranslation`.

**Modify**

- `src/components/family/InviteWizardModal.vue` — Step 0 mount; invitee chip on Step 1 (with conditional change-link); blank-email path (warning chip + child-hint disclosure); FAQ font/copy refresh; Q2/Q3 answers via `v-html`. Re-emit `add-bean` upward.
- `src/pages/MeetTheBeansPage.vue` — `handleAddBeanFromWizard()` (close wizard, open add-modal); update `handleMemberSave()` to capture `createMember` return and pre-select non-pet new member; drop `hasInvitableMembers` gate; add error toast on null-return.
- `src/services/translation/uiStrings.ts` — new picker keys + updated FAQ values (`en` + `beanie`).
- `e2e/specs/invite-join.spec.ts` — walk through picker (tile click → confirm-email → send-link). Adds 1 step, removes 0.

**Preserve, no change**

- `src/composables/useInviteFlow.ts` — composable is the single owner of link state; picker doesn't touch it.
- `src/utils/email.ts` — `isUnshareableEmail` reused as-is.
- `src/components/family/{ShareChannelGrid,ShareInviteModal,BeanCard,FamilyMemberModal}.vue` — untouched.
- `src/components/common/QuickAddMemberPicker.vue`, `src/components/login/PickBeanView.vue` — untouched (different shapes; refactor would create bloat).
- `src/components/pod/shared/AddTile.vue` — reused as-is.
- `src/stores/familyStore.ts` — `createMember` reused; return value capture is in the consumer.

## State machine

```
[user taps Invite Beanie or per-bean share]
  ↓
  prefill ?
   ├─ yes (per-bean): currentStep = 1, emailValue = realEmailFor(prefill.email)
   └─ no  (generic):  currentStep = 0
          │
          ▼
   Step 0 — Picker
   ┌──────────────────────────────────────────────────────┐
   │ tile click → emit('select', memberId)                 │
   │   wizard sets pickedMember = member,                  │
   │   emailValue = realEmailFor(member.email),            │
   │   confirmed = false,                                  │
   │   currentStep = 1                                     │
   │ add-tile click → wizard emits('add-bean')             │
   │   parent closes wizard, opens FamilyMemberModal       │
   │   on save: parent captures created member             │
   │            sets pendingShareMember = created          │
   │            reopens wizard → sees prefill → step = 1   │
   │   on null/error: parent shows error toast,            │
   │                  does NOT reopen wizard               │
   └──────────────────────────────────────────────────────┘
          │
          ▼
   Step 1 — Confirm email
   ┌──────────────────────────────────────────────────────┐
   │ invitee chip with picked/prefill name                 │
   │   change-link visible only if !prefill                │
   │   change click → currentStep = 0, pickedMember = null │
   │                  emailValue = '', confirmed = false   │
   │ if !realEmail: warning chip + child-hint disclosure   │
   │ rest of Step 1 unchanged                              │
   └──────────────────────────────────────────────────────┘
          │
          ▼
   Step 2 — unchanged
```

## Implementation order

1. **Strings** — add picker keys + updated FAQ values (`en` + `beanie`). Run `npm run translate`.
2. **`InvitePickerStep.vue`** — build presentational component. Reuses `BeanieAvatar`, `AddTile`, helpers.
3. **`InviteWizardModal.vue` refactor** — Step 0 mount; invitee chip; blank-email path (warning chip + child-hint); FAQ font/copy + v-html for a2/a3.
4. **`MeetTheBeansPage.vue` refactor** — add-bean handler; capture `createMember` return; drop gate; error toast on null.
5. **E2E** — update `invite-join.spec.ts` to walk picker (tile click → email step → send).
6. **Verify** — `npm run type-check`, `npm run lint`, `npm run test:unit`, `npx playwright test invite-join`. Manual walkthrough of all 4 mockup variants.
7. **Save plan to `docs/plans/2026-04-27-invite-wizard-picker.md`** (project convention).
8. **Commit + push** — CHANGELOG.md + STATUS.md updated. **No deploy** — wait for explicit user instruction.

## Strings (final)

New (en + beanie both required):

```
inviteWizard.picker.title           "Who's joining the pod?"
inviteWizard.picker.subhead         "Pick a beanie to invite, or add someone new."
inviteWizard.picker.statusOwner     "★ pod owner"
inviteWizard.picker.statusJoined    "✓ joined"
inviteWizard.picker.tileNoEmail     "no email yet"
inviteWizard.picker.addBean         "add a new beanie"
inviteWizard.picker.empty           "no beanies waiting yet — add one to send your first invite"

inviteWizard.invitee.label          "for"
inviteWizard.invitee.change         "change"

inviteWizard.step1.noEmailChip      "No default email on file — enter the Google account email {name} will sign in with."
inviteWizard.step1.childHint.toggle "What if my child doesn't have an email?"
inviteWizard.step1.childHint.body   plain text, no {name}, generic "them" — see below

family.addMemberFailed              "Couldn't add that beanie — please try again"
```

`childHint.body` (plain text, no v-html, no name substitution):

> "That's fine — share with one of your own emails. You can sign them in on their device with that account, and they'll see the family pod. When they're ready for their own, you can set up a free, parent-supervised Gmail through Google Family Link — then switch them over from settings."

The Family Link link in the child-hint is rendered as a separate `<a>` element in the template, not embedded in the i18n string. (Two `t()` calls + an inline anchor — clearer than v-html for a string the user sees prominently.)

Updated:

```
inviteWizard.step1.faq.toggle  "You've got questions? We've got answers"   (was: "Questions or worries?")
inviteWizard.step1.faq.a2      raw HTML w/ Family Link anchor (v-html, static, XSS-safe)
inviteWizard.step1.faq.a3      raw HTML w/ accounts.google.com + Family Link anchors (v-html, static)
```

## Verification

- `npm run type-check` — clean.
- `npm run lint` — ESLint + stylelint clean.
- `npm run test:unit` — composable tests pass (no composable change).
- `npm run translate` — parser handles new keys; Chinese regenerates.
- `npx playwright test invite-join` — E2E passes; flow walks picker → email → send-link.
- `npm run dev` — manual walkthrough:
  1. Generic Invite Beanie → picker opens with mixed states (owner dimmed, joined dimmed, waiting selectable, + add tile, empty state caption when only owner).
  2. Pick a bean with real email → Step 1 with prefilled email + pulse + change link.
  3. Pick a bean with `@temp.beanies.family` email → Step 1 blank + warning chip + child-hint expands cleanly.
  4. From picker, tap + add a new beanie → wizard closes, FamilyMemberModal opens; fill name + email; save → wizard reopens at Step 1 with new bean prefilled.
  5. Same flow but user dismisses FamilyMemberModal without saving → wizard stays closed (no orphan reopen).
  6. Same flow but force `createMember` failure (offline / corrupt) → error toast shown, wizard does NOT reopen.
  7. From per-bean share button on a BeanCard → wizard opens directly at Step 1 (no picker, no change link).
  8. FAQ disclosure on Step 1 — Outfit-bold toggle, "You've got questions? We've got answers", Q2/Q3 anchor links work in both English and beanie modes, target=\_blank, rel=noopener.

## Risk

Low. No protocol changes, no service changes, no composable changes. Per-bean entry path unchanged (skips picker via `prefill`). Picker is purely additive UI. Each step independently revertible:

- After step 2 (picker SFC): orphan component, harmless.
- After step 3 (wizard refactor): revert wizard only — picker unused.
- After step 4 (page refactor): revert page only — wizard still works for per-bean entry.
