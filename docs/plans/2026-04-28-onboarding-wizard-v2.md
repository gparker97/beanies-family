# Plan: onboarding wizard v2 — split into 6 focused steps + inline invites

> Date: 2026-04-28
> Mockup: `docs/mockups/onboarding-wizard-v2.html`
> Saved copy: `docs/plans/2026-04-28-onboarding-wizard-v2.md`
> CIG / `.claude/skills/beanies-theme/SKILL.md` wins on any visual discrepancy.

## Context

The onboarding wizard at `src/components/onboarding/OnboardingWizard.vue` runs immediately after a user finishes the setup wizard (`/welcome → Create a new pod → Step 3 finish`). Today it's a 4-step overlay: Welcome (hero + currency picker + paragraph + 3 pillar cards) → Money (account + recurring + savings stacked on one screen, 1,095-line file) → Family (activity + 5 "discover" teaser tiles + closing strip) → Complete (summary + CTA).

The carefully cultivated visual language — cloud-white-to-tinted gradients, ambient corner blobs, floating decorative emojis at 0.12 opacity with `ob-float` stagger, Caveat-italic sub-heroes, Outfit titles, pulse-glow CTAs, `OnboardingStepHeader` icon+pip pattern, the soft-green savings-card, the `ob-recurring-card` / `ob-activity-card` inline forms, summary tiles, green ✓ confirmation rows — is all keepers and stays as-is.

What's changing (per the greg-approved mockup at `docs/mockups/onboarding-wizard-v2.html`):

1. **Welcome decluttered** — drop the description paragraph + 3 pillar cards. Hero + currency picker + CTA only.
2. **Money split into 3 dedicated screens** (Account, Recurring, Savings) so each step is a single decision.
3. **Family becomes Activity-only** — drop the 5 "discover" teaser tiles + closing strip.
4. **Complete extends with inline per-member invites** — avatar/name/email/`Send →` rows that reuse the existing `useInviteFlow` + `ShareInviteModal` primitives. Visibility-gated to Drive storage AND ≥1 member with a shareable email.
5. **Account field-order tweak** — Bank → Balance → Type chips → auto-name preview + Add (mockup-approved easiest-first ordering; live wizard has chips on top, this flips them just above the preview row so the auto-name responds visually to the chip selection).
6. **Side-effect bug fix** — `savingsPercent` flows from the slider through the wizard to the Complete summary card (today the Complete card hardcodes `20`).

Goal: one-decision-per-screen pacing and a "send links to my partner / kids" job that lands as the natural last step instead of a separate side-quest. The visual primitives are preserved; only the specifically-called-out simplifications and field-order tweaks land.

## Approach

### 1. Architecture: 4 dedicated step components + 3 shared primitives + thin data-driven orchestrator

Split `OnboardingMoney.vue` (1,095 lines, 3 sections on one screen) and `OnboardingFamily.vue` (602 lines, activity + teasers + closing) into focused per-step components. Three new shared primitives prevent duplication AND keep individual files small + single-purpose.

```
src/components/onboarding/
  OnboardingWizard.vue            orchestrator: data-driven STEPS table, slide transitions
  OnboardingWelcome.vue           decluttered (existing file)
  OnboardingStepShell.vue         NEW — gradient bg + ambient blobs + #decorations slot
  OnboardingAddedRow.vue          NEW — icon + title + meta + tag + ✓ confirmation row
  OnboardingInvitePanel.vue       NEW — Step 6's invite section (visibility gate + per-row UI + send flow)
  OnboardingAccount.vue           NEW — was Money §A
  OnboardingRecurring.vue         NEW — was Money §B
  OnboardingSavings.vue           NEW — was Money §C
  OnboardingActivity.vue          NEW — renamed from OnboardingFamily, drop §B + closing
  OnboardingComplete.vue          summary + CTA + <OnboardingInvitePanel/> (thin)
  OnboardingProgressPips.vue      unchanged
  OnboardingStepHeader.vue        unchanged
  errorSurfaces.ts                NEW — single-source const enum for the 6 onboarding surface names
  onboarding-shared.css           NEW — the shared `.ob-*` utility CSS, imported by OnboardingStepShell
                                  via `<style src="./onboarding-shared.css">` (clear file boundary)
  OnboardingRecurringModal.vue    DELETED — recurring step is inline-card, not modal
  OnboardingSectionLabel.vue      DELETED — no callers post-split
```

**Why split, not internal sub-step state.** Each new screen has its own emoji+title+Caveat sub, decorative-emoji trio, and scoped form state. Single-responsibility per file = trivially testable, max ~200-250 lines each.

**Why extract `OnboardingInvitePanel`.** The Step 6 invite logic (visibility gate + 3-condition guard + per-row state machine + ShareInviteModal binding + send flow + error rendering) is non-trivial. Putting it inside `OnboardingComplete.vue` would push that file past 400 lines and mix the celebratory summary surface with the invite state machine. Extraction means `OnboardingComplete` stays a thin "summary + CTA + (optional) invite slot" component, and the invite logic gets its own focused unit-test target.

**Why `errorSurfaces.ts`.** The 6 surface names (`onboarding-add-account`, etc.) get used in toast calls, `data-testid`s, and tests. A single const file makes them greppable + prevents typos drifting between sites. ~10 lines.

**Why a sibling CSS file instead of a non-scoped `<style>` block in the shell component.** A `<style src="./onboarding-shared.css">` declaration in `OnboardingStepShell` makes the file boundary obvious to future maintainers. Standard Vue pattern. The CSS file is grep-friendly. No new tooling — Vite handles it natively.

### 1a. `OnboardingStepShell.vue` (NEW shared primitive)

Wraps every data-entry step. Owns the brand background (gradient + ambient corner blobs) + the float-animation base class via the shared CSS file.

```vue
<template>
  <div class="ob-form">
    <slot name="decorations" />
    <!-- per-step floating emojis -->
    <slot />
    <!-- step content -->
  </div>
</template>

<style src="./onboarding-shared.css"></style>
```

Children apply `.ob-*` class names directly; no `:deep()` plumbing. Brand-bg change is one file. Drift risk on shared visual primitives: zero.

### 1b. `OnboardingAddedRow.vue` (NEW shared primitive)

Three steps render the same green-tinted confirmation row after Add (Account, Recurring, Activity).

```ts
defineProps<{
  icon: string; // "🏦" / preset.icon / etc.
  title: string; // account name / recurring description / activity title
  meta?: string; // "USD 2,450.00" / "$180/mo" / "Sophia · Tue · 3:00 PM · $80/mo"
  tag?: string; // "savings" / "expense" / "Lessons" — the right-aligned chip
}>();
```

~25 lines, fixed shape, no slot complexity. Removes ~60 lines of inline duplication across 3 sites.

### 1c. `OnboardingInvitePanel.vue` (NEW component, Step 6 surface)

Owns the entire invite section behavior. `OnboardingComplete` just renders `<OnboardingInvitePanel />` — no props, no events. The panel reads `syncStore` + `familyStore` directly and manages its own state.

Internal:

```ts
// Single Map (not two parallel maps) — atomic per-row state.
type RowEntry = { state: 'idle' | 'sending' | 'sent' | 'error'; error?: string };
const rows = ref<Map<string, RowEntry>>(new Map());
const currentSendingId = ref<string | null>(null);
const activeShareMember = ref<FamilyMember | null>(null);
const inviteFlow = useInviteFlow();
```

Visibility gate (3 conditions, **all required**):

1. `syncStore.storageProviderType === 'google_drive'` — local-storage pods have no shareable file
2. `syncStore.familyKey !== null` — invite flow needs the family key loaded; otherwise `shareDriveAccess` would throw async (added vs the previous plan's 2-condition gate)
3. `familyStore.humans.some(m => m.id !== familyStore.owner?.id && !isUnshareableEmail(m.email))` — ≥1 invitable non-owner with a real email

When the gate fails, the panel renders `null` — `OnboardingComplete` falls back to today's "summary + CTA + sign-off" layout cleanly.

### 2. Per-step changes

#### Step 1 — Welcome (cuts only)

In `OnboardingWelcome.vue`:

- Delete `<p class="ob-description">` paragraph (`onboarding.welcomeDescription`)
- Delete `<div class="ob-pillars">` block (3 pillar cards)
- Delete associated CSS (`.ob-description`, `.ob-pillars`, `.ob-pillar-card`, `.ob-pillar-label`)
- Keep: hero image, title, currency picker, progress pips (`:total="6"`, was 3), pulse-glow CTA, Caveat-italic subtitle.

#### Step 2 — Account (`OnboardingAccount.vue`, NEW)

Pure refactor of `OnboardingMoney` Section A + the field-reorder.

**New field order (mockup-approved, diverges from live):** Bank → Balance → Type chips → auto-name preview + Add. The auto-name "Greg's OCBC Checking" updates visually under whichever chip the user just tapped.

Components reused verbatim (no re-implementation):

- `BaseCombobox` for bank picker (`useInstitutionOptions` + `OTHER_INSTITUTION_VALUE`)
- `CurrencyAmountInput` for balance
- `FrequencyChips` for type with `accountTypeOptions`
- `OnboardingStepHeader` (icon `🐷`, title prefix `Your`, highlight `account`)
- `OnboardingAddedRow` for the green confirmation row (NEW shared primitive)
- `OnboardingStepShell` for gradient bg + decorations slot (NEW shared primitive)

Mutation wrapped via the canonical pattern (see § 5):

```ts
import { showToast } from '@/composables/useToast';
async function handleAddAccount() {
  if (!canAddAccount.value) return;
  try {
    const account = await accountsStore.createAccount({ ... });
    if (!account) throw new Error('createAccount returned null');
    addedAccounts.value.push({ ... });
    accountAdded.value = true;
  } catch (e) {
    showToast('error', t('onboarding.errors.addAccountFailed'), {
      surface: 'onboarding-add-account',
      error: e,
    });
  }
}
```

#### Step 3 — Recurring (`OnboardingRecurring.vue`, NEW)

Pure refactor of `OnboardingMoney` Section B. The `ob-recurring-card` inline expanded-card pattern is preserved exactly.

**Defensive default for the account selector:** read from `accountsStore.accounts` and pick the most-recently-created entry that still exists. If the user goes back to Step 2, deletes their account, and returns, the candidate ID could otherwise be stale.

```ts
const recurringAccountId = ref<string>('');
onMounted(() => {
  const candidate = accountsStore.accounts.at(-1);
  if (candidate && accountsStore.accounts.some((a) => a.id === candidate.id)) {
    recurringAccountId.value = candidate.id;
  }
  // else: user must pick — UI's <BaseSelect> shows placeholder.
});
```

Why explicit-existence check: simpler than re-watching the store. The "back-to-Step-2-and-delete" edge case is rare but real; the check costs nothing.

Components reused:

- Two preset chip groups (`RECURRING_INCOME_PRESETS` + `RECURRING_EXPENSE_PRESETS`)
- Inline card: editable description (pre-filled from `preset.defaultName`) + `BaseSelect` account picker + `CurrencyAmountInput` + `FrequencyChips`
- `OnboardingAddedRow` for green confirmation row
- `OnboardingStepShell` for shell

Mutation wrapped in try/catch with `showToast` `surface: ErrorSurfaces.onboardingAddRecurring`. Same shape as Account.

#### Step 4 — Savings (`OnboardingSavings.vue`, NEW)

Pure refactor of `OnboardingMoney` Section C. Soft-green wash + slider + Caveat encouragement preserved verbatim.

Two intentional changes vs current:

1. **`v-model:savingsPercent`** binding to the wizard. Use Vue 3.5 `defineModel<number>('savingsPercent')` — single line, no manual `defineEmits` + `watch` ceremony. Wizard threads the model value into `OnboardingComplete` as a prop. **Side-effect bug fix:** today the Complete card hardcodes `20`; now it reflects the slider.
2. **Drop the live summary bar at the bottom** (`<div v-if="totalIncome > 0" class="ob-summary-bar">`). It referenced `addedRecurrings` from the same component, which no longer exists post-split. The summary still appears on the Complete screen — no information loss.

Components reused: `TogglePillGroup` (percent/fixed mode), native `ob-slider`, `CurrencyAmountInput` for fixed-mode amount.

No async mutations on this step — slider drag is reactive only.

#### Step 5 — Activity (`OnboardingActivity.vue`, renamed from `OnboardingFamily.vue`)

Rename + delete-only:

- Drop Section B teaser grid (5 unclickable "Assets / Goals / To-Dos / Vault / Budgets" tiles + the `teasers` array + `.ob-teaser-*` CSS)
- Drop the closing strip (`.ob-closing-strip` + `closingTitle`/`closingSubtitle` keys)
- Skip-button copy: nav-bar reads `Skip — add later` on this step (handled by wizard's `skipLabel` computed)

The activity card itself is preserved verbatim — preset chips → activity card with non-editable `preset.defaultTitle` header → Days+Member+Time row (`DayOfWeekSelector`, member select, two `TimePresetPicker`s for Start+End) → cost row → full-width Add. **No field-order or component changes — just deletions.**

Mutation wrapped in try/catch with `showToast` `surface: 'onboarding-add-activity'`. `OnboardingAddedRow` replaces the inline row markup.

#### Step 6 — Complete (thin) + Invite panel (own component)

`OnboardingComplete.vue` stays thin: existing summary cards + CTA + Caveat sign-off + **a single `<OnboardingInvitePanel />` mount-point** between summary and CTA. `OnboardingComplete` derives its own counts from the stores (no more count-prop threading from the wizard).

All invite logic lives in `OnboardingInvitePanel.vue` — visibility gate, per-row state machine, send flow, error rendering, share-modal binding. **The Complete file gains ~10 lines and stays readable.**

**`OnboardingInvitePanel` per-row UX:**

| Row state                                           | What renders                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Has real email, idle                                | `BeanieAvatar` + name + email + `Send →` button                                                                                                           |
| No email / unshareable (per `isUnshareableEmail()`) | Avatar + name + faded `no email — skip` hint, no button                                                                                                   |
| Send in flight                                      | Avatar + name + email + spinner, button disabled                                                                                                          |
| Sent                                                | Avatar + name + email + `✓ Sent` badge, row tinted green                                                                                                  |
| Error                                               | Avatar + name + email + inline error tag + action button labeled per `inviteFlow.error.recovery` (`'retry'` → "Retry →", `'edit-email'` → "Edit email →") |

**Send flow (single try/catch — no nested error handling):**

```ts
async function sendForMember(member: FamilyMember) {
  if (currentSendingId.value) return; // single-flight gate (UI also disables siblings)
  currentSendingId.value = member.id;
  rows.value.set(member.id, { state: 'sending' });
  inviteFlow.clearError();
  try {
    // Defensive: visibility gate already excluded these, but if a temp email leaked through
    // we want the failure to surface, not corrupt the invite flow with an empty hint.
    if (!isValidEmail(member.email) || isUnshareableEmail(member.email)) {
      throw new Error('invalid-email-passed-gate');
    }
    const granted = await inviteFlow.shareDriveAccess(member.email);
    if (!granted) throw new Error(inviteFlow.error.value?.code ?? 'drive-share-failed');

    const linked = await inviteFlow.regenerateLinkForEmail(member.email);
    if (!linked) throw new Error(inviteFlow.error.value?.code ?? 'link-generation-failed');

    activeShareMember.value = member; // opens <ShareInviteModal>
    rows.value.set(member.id, { state: 'sent' });
  } catch (e) {
    rows.value.set(member.id, {
      state: 'error',
      error: inviteFlow.error.value?.message ?? (e instanceof Error ? e.message : 'unknown'),
    });
    showToast('error', t('onboarding.errors.inviteFailed'), {
      surface: ErrorSurfaces.onboardingInviteRow,
      error: e,
      context: { memberRole: member.role, hasEmail: !!member.email }, // both allowlisted
    });
  } finally {
    currentSendingId.value = null;
  }
}
```

**Why one Map, not two:** the previous draft had `Map<id, RowState>` + `Map<id, errorMessage>` in parallel — risk of state/error desync if one updates without the other. One Map of `{ state, error? }` per memberId fixes this atomically. Easier to reason about, single source of truth.

**Why a single try/catch, not nested:** every operation that can fail throws or rejects → one catch block routes to error-state + toast. No deep nesting.

**Privacy contract** for `reportError` (auto-routed via `showToast('error', ..., { surface })`): the `errorReporter`'s allowlist drops member name / email / family-id-without-context automatically. The `context` payload uses only allowlisted fields (`memberRole`, `hasEmail`).

**ShareInviteModal binding:** `OnboardingInvitePanel` owns one `<ShareInviteModal :open="!!activeShareMember" :link="inviteFlow.inviteLink" :member-name="activeShareMember?.name" />` — reused as-is. On close, `activeShareMember.value = null`; row state is already `'sent'` from the success path.

**Documented UX trade-off — "Sent" badge semantics:** the row is marked `'sent'` once `inviteFlow` prepare succeeded (Drive permission granted + per-recipient link generated), not gated on the user actually picking a share channel in `ShareInviteModal`. If the user dismisses the modal with the X, the row still shows ✓ Sent. The alternative (distinguishing "prepared" from "actually-shared") would need `ShareInviteModal` to emit which channel was picked, which it doesn't today. Trade-off accepted: the prepared invite is real (token issued, Drive ACL granted, link valid) — the user can hand-deliver the link off-modal if they want. If they didn't share, they can re-invite from My Pod. Acceptable mild white-lie for a much simpler component contract.

**Skip-the-rest** is the existing primary CTA (`Enter the Nook 🏡`) — pressed without sending any rows. The mockup's separate "Skip the rest" link is folded into that CTA per § Out of scope.

**Reminder line:** `✨ you can always invite anytime later from My Pod` — Caveat-italic, low-opacity, sits below the rows inside the panel.

### 3. `OnboardingWizard.vue` orchestrator changes — **data-driven, not switch-case**

The current orchestrator has a 4-branch `<Transition><Component v-if/v-else-if/v-else>` chain. Going to 6 makes that chain longer and harder to scan. Replace with a single `STEPS` config table + `<component :is>` render.

```ts
import OnboardingWelcome from './OnboardingWelcome.vue';
import OnboardingAccount from './OnboardingAccount.vue';
import OnboardingRecurring from './OnboardingRecurring.vue';
import OnboardingSavings from './OnboardingSavings.vue';
import OnboardingActivity from './OnboardingActivity.vue';
import OnboardingComplete from './OnboardingComplete.vue';

interface StepDef {
  component: Component;
  hasNavBar: boolean; // false for step 1 (own CTA) and step 6 (own CTA)
  skipKey: 'onboarding.skip' | 'onboarding.skipAddLater' | null;
}

const STEPS: readonly StepDef[] = [
  { component: OnboardingWelcome, hasNavBar: false, skipKey: null },
  { component: OnboardingAccount, hasNavBar: true, skipKey: 'onboarding.skip' },
  { component: OnboardingRecurring, hasNavBar: true, skipKey: 'onboarding.skip' },
  { component: OnboardingSavings, hasNavBar: true, skipKey: 'onboarding.skip' },
  { component: OnboardingActivity, hasNavBar: true, skipKey: 'onboarding.skipAddLater' },
  { component: OnboardingComplete, hasNavBar: false, skipKey: null },
] as const;

const currentStep = ref(1);
const currentDef = computed(() => STEPS[currentStep.value - 1]);
const totalSteps = STEPS.length;
```

Template:

```vue
<Transition :name="transitionName" mode="out-in">
  <component
    :is="currentDef.component"
    :key="currentStep"
    v-model:savingsPercent="savingsPercent"
    @next="goNext"
    @back="goBack"
    @finish="handleFinish"
  />
</Transition>
<div v-if="currentDef.hasNavBar" class="ob-nav">
  ...skip/back/next using currentDef.skipKey...
</div>
```

Adding a 7th step in the future = one entry in the table. No template-side branching to maintain. The orchestrator file shrinks by ~30 lines.

**Other orchestrator changes:**

- `<OnboardingSavings v-model:savingsPercent="savingsPercent" />` — Vue 3.5 `defineModel<number>('savingsPercent')` on the savings component gives 2-way binding in one line. Other components ignore the prop (Vue silently passes it through).
- **Drop the count props threading.** Today the wizard derives `accountCount` / `recurringCount` / `activityCount` and passes to `OnboardingComplete`. After the refactor, `OnboardingComplete` derives its own counts from the stores it imports. The wizard threads only `savingsPercent`. **Coupling reduced, three props eliminated.**
- `skipLabel` computed reads `currentDef.skipKey ?? 'onboarding.skip'`. Single source of truth.
- Drop the `currentStep === 3 ? allDone : nextFamily` branch. The next-button label becomes a single `t('onboarding.next')`.
- **Background sync on dismiss is fire-and-forget.** Don't `await` `syncStore.syncNow(true)` in `handleSkip`/`handleFinish` — the user already moved on; awaiting risks racing the unmount. Pattern:
  ```ts
  function handleFinish() {
    settingsStore.setOnboardingCompleted(true);
    if (syncStore.isConfigured) {
      syncStore.syncNow(true).catch((e) =>
        reportError({
          surface: ErrorSurfaces.onboardingFinishSync,
          message: 'Background sync failed on onboarding finish — user already proceeded.',
          error: e,
        })
      );
    }
    dismiss();
    celebrate('setup-complete');
  }
  ```
  Non-blocking + non-silent. Same shape for `handleSkip`.

### 4. No-silent-failures contract (the canonical pattern, applied uniformly)

**Every async operation in the wizard goes through one of two paths:**

| Path                                                                       | When                                                                    | What it does                                                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `showToast('error', t('onboarding.errors.<surface>'), { surface, error })` | User-recoverable failures (add account/recurring/activity, send invite) | User sees a toast with a friendly message; reporter pushes a structured Slack notification with stack + redacted context |
| `reportError({ surface, message, error })`                                 | Non-blocking background ops (`syncStore.syncNow` on finish/skip)        | No user toast (user already moved on); support gets the Slack ping                                                       |

**The `surface` namespace** (used for both error grouping and `data-testid`):

- `onboarding-add-account`
- `onboarding-add-recurring`
- `onboarding-add-activity`
- `onboarding-invite-row`
- `onboarding-finish-sync`
- `onboarding-skip-sync`

The reporter's privacy allowlist in `errorReporter.ts` already covers what's safe — no member names, no transaction descriptions, no activity titles. The plan's `context` payloads use only allowlisted fields (`memberRole`, `accountType`, `hasEmail`, `currency`, etc.).

**Already-typed error paths reused:**

- `inviteFlow.error: Ref<InviteFlowError | null>` — structured `{ code, message, recovery }` with `recovery: 'retry' | 'edit-email'`. The plan threads `recovery` into the row's button label, not "retry" hardcoded.
- `syncStore.syncNow(force?)` — already returns a boolean, but in practice can throw on token expiry; wrap.

### 5. i18n changes — `src/services/translation/uiStrings.ts`

All copy goes through the translation system per `CLAUDE.md`. Voice copy on new strings was pre-greenlit via the mockup; final voice review per `feedback_voice_review.md` runs before commit.

**Add (15 keys — 11 UI + 4 error toasts):**

| Key                                    | en                                                                                                                      | beanie              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `onboarding.accountType`               | `Type`                                                                                                                  | `type`              |
| `onboarding.skipAddLater`              | `Skip — add later`                                                                                                      | `skip — add later`  |
| `onboarding.invite.title`              | `Invite the rest?`                                                                                                      | `invite the rest?`  |
| `onboarding.invite.optional`           | `Optional`                                                                                                              | `optional`          |
| `onboarding.invite.lede`               | `Each beanie gets their own link. Drop in their email and we'll generate a share link you can text or send right away.` | (lowercase variant) |
| `onboarding.invite.send`               | `Send →`                                                                                                                | `send →`            |
| `onboarding.invite.sent`               | `✓ Sent`                                                                                                                | `✓ sent`            |
| `onboarding.invite.noEmail`            | `no email — skip`                                                                                                       | `no email — skip`   |
| `onboarding.invite.reminder`           | `✨ you can always invite anytime later from My Pod`                                                                    | (lowercase variant) |
| `onboarding.invite.retry`              | `Retry →`                                                                                                               | `retry →`           |
| `onboarding.invite.editEmail`          | `Edit email →`                                                                                                          | `edit email →`      |
| `onboarding.errors.addAccountFailed`   | `Couldn't add that account. Please try again — support's been notified.`                                                | (lowercase variant) |
| `onboarding.errors.addRecurringFailed` | `Couldn't add that recurring transaction. Please try again — support's been notified.`                                  | (lowercase variant) |
| `onboarding.errors.addActivityFailed`  | `Couldn't add that activity. Please try again — support's been notified.`                                               | (lowercase variant) |
| `onboarding.errors.inviteFailed`       | `Couldn't send that invite. Try again or edit the email and retry.`                                                     | (lowercase variant) |

The action-button label on a row in `'error'` state reads `t(inviteFlow.error.recovery === 'edit-email' ? 'onboarding.invite.editEmail' : 'onboarding.invite.retry')` — driven by the existing `InviteFlowError.recovery` field; no new error registry.

**Delete (15 keys, all verified zero remaining consumers via grep):**

- Welcome declutter: `welcomeDescription`, `pillarMoney`, `pillarMoneyShort`, `pillarPlan`, `pillarPlanShort`, `pillarFamily`, `pillarFamilyShort`
- Account simplification: `sectionAccount`, `sectionAccountSub`, `accountName`, `accountNamePlaceholder`
- Recurring split: `sectionRecurring`, `sectionRecurringSub`
- Activity split + cuts: `sectionActivity`, `sectionActivitySub`, `sectionDiscover`, `sectionDiscoverSub`, `closingTitle`, `closingSubtitle`

After edits, `npm run translate` regenerates `public/translations/zh.json`. Verify zero parse errors before commit.

## DRY audit (rigorous pass — what was checked, what was reused, what was extracted)

| Candidate                                                                                                                                                                     | Decision                                                                           | Reasoning                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ob-form` gradient bg + ambient blobs (~30 lines × 4 files)                                                                                                                   | **EXTRACT → `OnboardingStepShell.vue` + `onboarding-shared.css`.**                 | Largest source of duplication. Now single-sourced; brand-bg change is one file.                                                                                         |
| Shared utility classes (`ob-add-pill`, `ob-detail-label`, `ob-chip*`, `ob-card`, `ob-account-grid`, `ob-day-pill`, `ob-time-input`, `ob-currency-amount`, `ob-combo-trigger`) | **EXTRACT → `onboarding-shared.css`** (imported by shell via `<style src="...">`). | Single source. Children apply class names directly. ~80 lines saved across 4 step files.                                                                                |
| Green-tinted "added" confirmation row (3 sites: Account / Recurring / Activity)                                                                                               | **EXTRACT → `OnboardingAddedRow.vue`.**                                            | Trivial 4-prop API. ~60 lines of inline duplication removed.                                                                                                            |
| Step 6 invite section behavior                                                                                                                                                | **EXTRACT → `OnboardingInvitePanel.vue`.**                                         | Non-trivial state machine + visibility gate + send flow + share-modal binding. Keeping it in `OnboardingComplete` would push that file past 400 lines and mix concerns. |
| Error surface name strings (used in toast calls + `data-testid` + tests)                                                                                                      | **EXTRACT → `errorSurfaces.ts` const enum.**                                       | Greppable, typo-proof, ~10 lines. Adding a new surface is one entry.                                                                                                    |
| Step orchestration (which component → which step → has-nav-bar → skip-key)                                                                                                    | **EXTRACT → `STEPS` config table inside `OnboardingWizard`.**                      | Replaces v-if chain. Adding a 7th step = one entry. Data-driven.                                                                                                        |
| Per-row state + error tracking                                                                                                                                                | **Single `Map<memberId, { state, error? }>`.**                                     | Was two parallel maps in earlier draft — desync risk. Atomic single-map updates.                                                                                        |
| Decorative-emoji trio (3 floating emojis per step, different content + positions)                                                                                             | **Inline per step via `#decorations` slot.**                                       | Content varies per step. Slot keeps animation shared (in CSS) while letting each step pick its own emojis. Right level.                                                 |
| Member avatar in invite rows                                                                                                                                                  | **REUSE existing `BeanieAvatar`.**                                                 | Don't invent new avatar markup. Drop-in.                                                                                                                                |
| Async error handling + dev-side reporting                                                                                                                                     | **REUSE `showToast` + `errorReporter`.**                                           | Canonical project pattern. Auto-routes to Slack + user-facing toast. No new error infrastructure.                                                                       |
| Async store-action wrapping with isLoading/error refs                                                                                                                         | **Considered `wrapAsync` from `useStoreActions.ts`.**                              | Doesn't fit here — wizard wants per-mutation custom toasts + surface names. Direct try/catch + `showToast` is the right grain.                                          |
| Step-headers (emoji + label + title + pips)                                                                                                                                   | **Already extracted via `OnboardingStepHeader`** — reused by all 4 new steps.      |
| Invite flow integration                                                                                                                                                       | **REUSE `useInviteFlow` + `ShareInviteModal`.**                                    | Zero new invite-flow logic.                                                                                                                                             |
| Email validation                                                                                                                                                              | **REUSE `isValidEmail` + `isUnshareableEmail`.**                                   | Canonical.                                                                                                                                                              |
| Onboarding count props (`accountCount`, `recurringCount`, `activityCount`) threading wizard → Complete                                                                        | **DROP — `OnboardingComplete` derives counts from stores it already imports.**     | 3 props eliminated, coupling reduced.                                                                                                                                   |
| Auto-name preview pattern in Account                                                                                                                                          | **Inline computed.**                                                               | One site, 3 lines. Premature to extract.                                                                                                                                |
| Storage-provider type check                                                                                                                                                   | **Inline `=== 'google_drive'`.**                                                   | Single use. Canonical literal.                                                                                                                                          |
| Savings-percent ↑ to wizard                                                                                                                                                   | **Vue 3.5 `defineModel<number>('savingsPercent')`.**                               | One line.                                                                                                                                                               |
| `OnboardingRecurringModal.vue` / `OnboardingSectionLabel.vue`                                                                                                                 | **DELETE.**                                                                        | No callers.                                                                                                                                                             |
| `pillar*` / `section*` / `closing*` / `accountName*` i18n keys                                                                                                                | **DELETE.**                                                                        | Translation pipeline handles cleanup.                                                                                                                                   |

**Net file count change:** +9 created (4 step files + 3 shared primitives + 1 const file + 1 CSS file) − 4 deleted = **+5 files**, but ~260 lines of duplication eliminated, one new visual contract single-sourced, orchestrator switch chain replaced by data table, parallel-map desync risk eliminated.

## No-silent-failures pass (every async surface accounted for)

| #   | Code path                                                         | Failure modes                                                                  | Handling                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `accountsStore.createAccount`                                     | CRDT write throws / IndexedDB quota / null return                              | try/catch → `showToast('error', t('onboarding.errors.addAccountFailed'), { surface: 'onboarding-add-account', error })`. Toast routes through `errorReporter` to Slack. Row UI stays in entry state for retry.                                            |
| 2   | `recurringStore.createRecurringItem`                              | Same as #1                                                                     | Same pattern, surface `onboarding-add-recurring`.                                                                                                                                                                                                         |
| 3   | `activityStore.createActivity`                                    | Same as #1                                                                     | Same pattern, surface `onboarding-add-activity`.                                                                                                                                                                                                          |
| 4   | `inviteFlow.shareDriveAccess(email)`                              | Returns `false` + populates `inviteFlow.error`; can also throw on token expiry | try/catch + check return; on `false`/throw, set row state to `'error'`, render inline message from `inviteFlow.error.message`, surface toast `onboarding-invite-row`. Action button label uses `inviteFlow.error.recovery` (`'retry'` vs `'edit-email'`). |
| 5   | `inviteFlow.regenerateLinkForEmail(email)`                        | Same as #4                                                                     | Same handling.                                                                                                                                                                                                                                            |
| 6   | `ShareInviteModal` close                                          | User dismisses without sharing                                                 | Logical "done" once link + Drive permission succeeded. Mark `'sent'` on close — same semantics as today's per-bean share. (Documented contract, not a silent failure.)                                                                                    |
| 7   | Two rows clicked simultaneously                                   | Token cache race                                                               | `currentSendingId` ref blocks parallel sends. Other Send buttons render `disabled` while one is in flight. Single-flight serialization.                                                                                                                   |
| 8   | `syncStore.syncNow(true)` in `handleSkip`/`handleFinish`          | Token expiry / Drive failure / network                                         | **Fire-and-forget** with `.catch(reportError)` — no `await`, no race against unmount. User dismissal is NOT blocked; failure routes to `ErrorSurfaces.onboardingFinishSync` for support. Non-blocking + non-silent.                                       |
| 9   | Family key not loaded when invite section renders                 | `inviteFlow.shareDriveAccess` would throw                                      | `OnboardingInvitePanel`'s 3-condition visibility gate includes `syncStore.familyKey !== null` — the section just doesn't render if the key isn't ready. User invites later from My Pod.                                                                   |
| 10  | Stale account-default in Recurring step                           | User goes back to Step 2, deletes account, returns                             | `onMounted` defensive existence check: `accountsStore.accounts.some(a => a.id === candidate.id)` before binding. Falls back to placeholder if stale.                                                                                                      |
| 11  | Per-row `isValidEmail`/`isUnshareableEmail` mismatch              | Placeholder email slipping through visibility gate                             | Defensive throw inside `sendForMember` — toast + reportError fire so we know the gate's wrong (signal, not silent).                                                                                                                                       |
| 12  | `defineModel('savingsPercent')` propagation                       | Vue reactivity edge case                                                       | Synchronous within the tick. Slider → wizard ref → Complete render, one frame. No async.                                                                                                                                                                  |
| 13  | `npm run translate` parse failure on new nested keys              | Could render raw key strings                                                   | `inviteWizard.step1.faq.q1` and similar nested dot-keys already exist in zh.json. Verify zero parse errors during translate run.                                                                                                                          |
| 14  | Existing `OnboardingWizard.test.ts` references deleted components | Compile fail                                                                   | Update in lockstep (§ Verification).                                                                                                                                                                                                                      |
| 15  | Vue's app-level `errorHandler` (set up in `main.ts`)              | Render exception in any new component                                          | Already routes to `reportError` automatically — every render error in the new components is captured at the app boundary, no extra wiring.                                                                                                                |

**Net: zero silent failures.** Every async surface has an explicit try/catch; every catch routes through `showToast` (user) + `errorReporter` (Slack with redacted context); every failure ref-state is rendered in the UI with a recovery action. Render exceptions are caught by the existing app-level handler.

## Critical files

**Created (9):**

- `src/components/onboarding/OnboardingStepShell.vue` — gradient bg + ambient blobs + decorations slot
- `src/components/onboarding/OnboardingAddedRow.vue` — green confirmation row primitive
- `src/components/onboarding/OnboardingInvitePanel.vue` — Step 6's invite section (visibility gate + state machine)
- `src/components/onboarding/onboarding-shared.css` — shared `.ob-*` utility CSS, imported by the shell
- `src/components/onboarding/errorSurfaces.ts` — single-source const enum for surface names
- `src/components/onboarding/OnboardingAccount.vue`
- `src/components/onboarding/OnboardingRecurring.vue`
- `src/components/onboarding/OnboardingSavings.vue`
- `src/components/onboarding/OnboardingActivity.vue`

**Modified:**

- `src/components/onboarding/OnboardingWizard.vue` — data-driven `STEPS` table replaces v-if chain, `v-model:savingsPercent`, fire-and-forget `syncNow` with `.catch(reportError)`, drop count-prop threading
- `src/components/onboarding/OnboardingWelcome.vue` — drop description + 3 pillar cards (template + CSS)
- `src/components/onboarding/OnboardingComplete.vue` — derive own counts from stores; thin `<OnboardingInvitePanel />` mount-point between summary and CTA
- `src/components/onboarding/__tests__/OnboardingWizard.test.ts` — 4→6 steps, new component refs, invite-gate tests, error-path tests
- `src/services/translation/uiStrings.ts` — 15 new keys, 15 deletions
- `public/translations/zh.json` — auto-regenerated via `npm run translate`

**Deleted:**

- `src/components/onboarding/OnboardingMoney.vue` — split into 3
- `src/components/onboarding/OnboardingFamily.vue` — renamed/trimmed
- `src/components/onboarding/OnboardingRecurringModal.vue` — dead code
- `src/components/onboarding/OnboardingSectionLabel.vue` — dead code post-split

**Read-only references (reused as-is, no re-implementation):**

- `src/composables/useInviteFlow.ts` — invite flow + structured `InviteFlowError`
- `src/components/family/ShareInviteModal.vue` — share-channel grid modal
- `src/components/ui/BeanieAvatar.vue` — member avatar
- `src/composables/useToast.ts` (`showToast`) — user-facing toast
- `src/utils/errorReporter.ts` (`reportError`) — Slack-routing reporter (auto-invoked by `showToast('error', ...)`)
- `src/utils/email.ts` — `isValidEmail`, `isUnshareableEmail`
- `.claude/skills/beanies-theme/SKILL.md` — typography + color CIG

## Verification

### Test plan — focused unit tests, integration through the wizard test, no new e2e

The split-out `OnboardingInvitePanel` is the most logic-heavy new file (state machine + 3-condition gate + send flow + error rendering). It earns its own focused test file. Pure refactors (the 4 step components) and pure-presentational primitives (`OnboardingStepShell`, `OnboardingAddedRow`) don't get standalone tests — they're exercised by the integration test on the wizard.

**NEW unit tests — `src/components/onboarding/__tests__/OnboardingInvitePanel.test.ts`:**

Visibility gate (3 conditions):

1. Storage = `local` → panel renders nothing
2. Storage = `google_drive` + only owner exists → panel renders nothing
3. Storage = `google_drive` + all non-owner members have unshareable emails → panel renders nothing
4. Storage = `google_drive` + `syncStore.familyKey === null` → panel renders nothing
5. All conditions met → panel renders one row per shareable non-owner

Per-row rendering: 6. Member with no email → "no email — skip" hint, no Send button 7. Member with valid email, idle → `Send →` button enabled 8. Member with valid email, sending → spinner + button disabled 9. Member with valid email, sent → `✓ Sent` badge + row tinted green 10. Member with valid email, error → inline error message + action button labeled per `inviteFlow.error.recovery`

Send-flow state transitions (mock `useInviteFlow`): 11. Successful send: `idle → sending → sent`. `ShareInviteModal` opens with correct link + memberName. 12. `shareDriveAccess` returns `false` with `error: { code, recovery: 'edit-email' }` → state `error`, button label "Edit email →", `showToast` called with `surface: ErrorSurfaces.onboardingInviteRow`. 13. `regenerateLinkForEmail` rejects → state `error`, message from thrown error, `reportError` invoked via toast. 14. Two rows clicked simultaneously → second click no-ops while first is in flight (single-flight via `currentSendingId`). 15. After error, retry click resets state to `sending` and clears `inviteFlow.error` first.

**UPDATED unit tests — `src/components/onboarding/__tests__/OnboardingWizard.test.ts`:**

Step structure:

1. Replace `OnboardingMoney`/`OnboardingFamily` mock refs with the 4 new step components.
2. Bump expected step count `4 → 6` and walk through each step's `<component :is>` resolution.
3. Verify `STEPS` table indices (1-6 → correct component class).

Nav-bar gating: 4. Step 1 (Welcome): no nav bar rendered (`hasNavBar: false`). 5. Steps 2-5 (data-entry): nav bar rendered with skip + back + next. 6. Step 6 (Complete): no nav bar rendered. 7. Step 5's skip-button label reads `t('onboarding.skipAddLater')`; steps 2-4 read `t('onboarding.skip')`.

Cross-step state: 8. `<OnboardingSavings v-model:savingsPercent>` propagation: change inside Savings → wizard's ref updates → Complete renders the new value (NOT hardcoded 20).

Background-sync error path: 9. `syncStore.syncNow` rejects on `handleFinish` → wizard still calls `dismiss()`, `reportError` called with `surface: ErrorSurfaces.onboardingFinishSync`. 10. Same for `handleSkip`.

**NO unit tests added for** the 4 step components or the 2 visual primitives — they're pure refactors / presentational only. The wizard integration test exercises them. Adding shallow-mount snapshots would just lock in implementation detail.

**E2E:** No changes to `e2e/specs/setup-flow.spec.ts`. It runs `navigateToSetupStep3` then exits before onboarding. The wizard auto-skips in E2E mode via the `e2e_force_onboarding` flag (set in `OnboardingWizard.vue` `onMounted`). Per `docs/adr/007-testing-strategy.md` and the project's Three-Gate Filter, adding e2e for the onboarding wizard would burn 1 of 25 test slots for a flow already covered by manual smoke + unit tests for the state machine. **Not warranted.**

### CI gates

```
npm run type-check
npm run lint
npm test -- --run
npx playwright test --project=chromium e2e/specs/setup-flow.spec.ts
```

All four must pass. Full chromium e2e before commit.

### Manual smoke (after CI green)

1. `npm run dev` → fresh sign-up walkthrough:
   - **Step 1**: hero + currency picker only. No paragraph. No 3 pillar cards. CTA pulses.
   - **Step 2**: title "Your account 🐷". Bank + Balance grid first. Type chips below. Faded auto-name preview ("Greg's OCBC Checking") appears once Bank is picked. Add → green confirmation row.
   - **Step 3**: title "Recurring transactions". Income + Expense chip groups. Tap chip → inline expanded card. Add → green confirmation row, form clears.
   - **Step 4**: title "Savings goal". Soft-green slider card. Drag → percent updates + "$X / mo" preview. Caveat encouragement.
   - **Step 5**: title "Activity 🌳". Preset chips. Tap chip → activity card with non-editable preset title in header, Days + Who + Start/End time row, Cost. No teaser tiles. No closing strip. Skip button reads "Skip — add later".
   - **Step 6**: summary cards reflect what was added. Invite card renders (Drive + ≥1 shareable member). Tap "Send →" → ShareInviteModal opens prefilled. Pick a channel → row shows "✓ Sent". Reminder line below the rows. CTA "Enter the Nook 🏡" works at any state.
2. Repeat with **storage = Local** → Step 6 has no invite card.
3. Repeat with **only owner / no other family members** → Step 6 has no invite card.
4. Toggle **beanie mode** → verify lowercase variants render across all updated strings.
5. Toggle **Chinese** → verify the new keys render translated content (post-`npm run translate`).
6. **Reduced-motion**: pulse-glow + float animations all gate on `prefers-reduced-motion: no-preference`; verify no movement when the OS pref is set.
7. **Error path smoke**: in DevTools, throttle network to "Offline" mid-onboarding and try Add — toast renders friendly message, console shows `[errorReporter]` line, row stays in entry state for retry. Restore network and retry — succeeds. Repeat for invite Send → `Retry →` button appears with the error message inline.

## Risks

| Risk                                                                       | Mitigation                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OnboardingWizard.test.ts` rework is non-trivial                           | Read it first; if rework is large, bring it back in the same commit and don't ship piecemeal.                                                                                                         |
| `OnboardingStepShell`'s non-scoped style block leaks to other components   | All classes are namespaced `.ob-*`; no overlap with other surfaces. Verified via grep.                                                                                                                |
| Shared-instance `useInviteFlow` racing                                     | Single shared instance + `currentSendingId` single-flight gate disables other Send buttons during in-flight. If races surface, escalate to per-row instances (1-line change).                         |
| Recurring's account-default depending on the just-added account post-split | `accountsStore.accounts.at(-1)?.id` on Recurring mount. Manual smoke step covers it.                                                                                                                  |
| Skip-label localization sprawl                                             | Single `skipLabel` computed in the wizard. One site of truth.                                                                                                                                         |
| Step 6 invite UX divergence from `InviteWizardModal`                       | Reuses same primitives — rows are presentational shell only. Drift risk: low.                                                                                                                         |
| Error toasts spamming Slack on retries                                     | `errorReporter`'s 60s count-summary dedup handles this — first occurrence sends, subsequent within 60s increments a counter, single follow-up at 60s if N>0. **Existing infrastructure, no changes.** |
| `OnboardingAddedRow` adopted later with different requirements             | 4-prop API. If a 4th caller wants a slot for custom tag content, add a `<slot name="tag">` then. Out of scope now.                                                                                    |

## Out of scope

- Wiring `savingsPercent` into a real `Goal` entity (today it's decorative). Keeps existing behavior; follow-up plan if greg wants a savings-goal `Goal` row created during onboarding.
- Per-step transition variants — slide-left/right shared transition stays.
- Explicit "Skip the rest" link below the invite rows — folded into primary CTA per § Step 6.
- Per-step PWA route URL — wizard remains a single overlay.
- Joiner-side onboarding flow — separate surface, separate plan.
- Mockup-only divergences from CIG (e.g. rounded-pill chip variant in mockup) — production `FrequencyChips`/`ob-chip` styling stays per the brief ("CIG always wins").

## Sustainability / maintainability / reliability audit

| Concern                             | Outcome                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File size discipline**            | Largest new file is ~250 lines (`OnboardingInvitePanel`); the 4 step files land 150-200 each. Compare to today's 1,095-line `OnboardingMoney`. Each file fits on a screen-and-a-half — readable end-to-end.                                                                                                                                                                                   |
| **Discoverability**                 | One file per step, named after its job. Shared primitives sit beside the steps with self-explanatory names. Surface-name strings live in one const file (`errorSurfaces.ts`) so adding a new toast surface = one greppable spot.                                                                                                                                                              |
| **Coupling — orchestrator → steps** | Wizard threads only `savingsPercent` via `defineModel`. Store-derived counts moved into `OnboardingComplete` directly. **3 props eliminated.** Other steps receive zero props from the wizard — they read from stores.                                                                                                                                                                        |
| **Coupling — between steps**        | Recurring step's account-default reads `accountsStore.accounts.at(-1)?.id` with an explicit existence check before binding. No ref-passing dance. Stale-account-after-delete defended explicitly.                                                                                                                                                                                             |
| **Coupling — Complete file**        | Splitting out `OnboardingInvitePanel` keeps `OnboardingComplete` as a thin "summary + CTA + (optional) invite slot" file. Two concerns, two files.                                                                                                                                                                                                                                            |
| **Template nesting depth**          | Max template nesting after the refactor: 4 levels (shell → header → form group → control). No deep `v-if/v-else-if/v-else-if` chains. The wizard's `<component :is>` replaces what would be a 6-branch chain.                                                                                                                                                                                 |
| **Test surface**                    | Existing `OnboardingWizard.test.ts` extends to 6 steps + invite-gate + 3 error-path scenarios. New focused unit-test surface: `OnboardingInvitePanel` (visibility gate + state machine in isolation).                                                                                                                                                                                         |
| **Reliability — async coverage**    | Every async surface has explicit try/catch + structured `showToast`/`reportError`. Render exceptions caught by app-level `errorHandler`. Background sync is fire-and-forget with `.catch(reportError)` to avoid race-against-unmount. **Net new failure paths: zero. Net silent failures: zero.** Existing async error-handling for store mutations is _strengthened_ (today they have none). |
| **Reliability — race conditions**   | Per-row send: single-flight via `currentSendingId` ref + UI disables siblings. Wizard dismiss: fire-and-forget sync with `.catch`. Recurring mount: defensive existence check on stale account-default.                                                                                                                                                                                       |
| **Public API / data contract**      | Form fields, store mutations, captured data unchanged. A user mid-onboarding before/after deploy captures identical data shapes. No migrations.                                                                                                                                                                                                                                               |
| **Reversibility**                   | Every change is text + markup + small additions. Deleted files are recoverable from git. The `STEPS` data table makes future re-ordering trivial.                                                                                                                                                                                                                                             |
| **Drift risk**                      | Brand-bg + utility CSS centralized in one file. `OnboardingAddedRow` single-sources the confirmation-row visual contract. `errorSurfaces.ts` single-sources the surface-name strings. **Drift risk on shared visual primitives + error-namespace strings: zero.**                                                                                                                             |
| **Future extension cost**           | Adding a 7th step = one entry in `STEPS`. Adding a 4th confirmation-row site = use `OnboardingAddedRow` (no new code). Renaming/regrouping i18n keys = `npm run translate` regenerates locales. Onboarding wiring stays declarative.                                                                                                                                                          |
| **Build-time guarantees**           | TypeScript `t()` keys typed as `UIStringKey`. `npm run translate` regenerates zh.json. CI gates on every PR.                                                                                                                                                                                                                                                                                  |
| **Component-API stability**         | `OnboardingStepShell` is two slots (default + #decorations), no props. `OnboardingAddedRow` is 4 typed props. `OnboardingInvitePanel` is zero props zero events. None of the new components have an API that ages badly.                                                                                                                                                                      |

## Commit + ship

- Single commit: `feat(onboarding): split into 6 focused steps + inline per-member invites (v2)`
- Body should call out: the 6-step split, Welcome declutter, Account field-order tweak, Step-5 cuts (teasers + closing), Step-6 inline invite section with Drive+member gating, deleted dead-code files, savings-percent fix.
- Per project convention: do not deploy until greg explicitly says so.
