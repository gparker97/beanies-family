# Plan: Save tells you what is missing — one shared form validation for every drawer

> Date: 2026-09-25
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-25-drawer-save-validation.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent filling in a drawer on my phone, I want Save to look not-ready until the required fields are filled, and a tap on it to take me to whatever is missing, so that I am never left pressing a button that silently does nothing.

## Context

When a required field in a drawer (the activity drawer, a transaction, a goal…) is empty, Save cannot succeed, but on a phone it is often not obvious why. Two conflicting patterns exist today:

- **Disabled Save** (`:save-disabled="!canSave"`): TransactionModal (`:720`), RecipeFormModal (`:583`), FamilyMemberModal (`:355`), GoalModal (`:204`), AccountModal (`:276`, also `!detailsValid`), TravelExtractReviewModal (`:210-213`). `BeanieFormModal.vue` renders a real `disabled` attribute at `disabled:opacity-50`. A disabled button fires no click, so the form never learns the person tried, no field is marked, and nothing says what is missing.
- **Live Save, errors after a tap**: ActivityModal (`showErrors`, `canSave` `:657-668`, `handleSave` `:849-854`), VacationWizard (`showErrors`, `canGoNext` `:118-128`), and the three travel booking modals via `useBookingValidation` (`src/composables/useBookingValidation.ts`, whose own comment says "THE SAVE BUTTON MUST NOT BE DISABLED ON `!canSave`" and explains why). Here the field gets the orange ring, but if it is off-screen the person sees nothing, and Save still looks fully enabled.

Silent cases found in the current code (each is a rule that blocks Save with no visible mark):

- **ActivityModal, custom fee period**: a recurring activity with a cost and a custom fee period of 0 fails `canSave` with no error binding anywhere.
- **ActivityModal, one-off activity**: the fee rules in `canSave` (`:660-666`) apply even when the activity is one-off, but the fee-schedule controls render only `v-if="isRecurring"` (`:1155`). A recurring activity set to `custom` with no period and then switched to one-off cannot be saved, and the field that blocks it is hidden.
- **VacationWizard, trip dates**: `canGoNext` requires `tripDatesValid`, but `TripDatesInput` shows no error while both dates are empty (`errorMessage` returns `null` when nothing is entered). Tapping Next rings the name, type and travellers fields but says nothing about the dates.
- **AccountModal, collapsed details**: `watch(detailsValid)` forces "More Details" open only when validity _changes_. If the person collapses the section while a detail field is invalid, it stays collapsed, and Save stays disabled with the errors hidden.

greg's asks: (1) Save should not look enabled while required fields are missing; (2) tapping Save with missing fields should scroll to them. Agreed resolution (a disabled button cannot scroll anyone): Save stays tappable but looks "not ready" until the form is complete. A tap while incomplete marks every missing field, scrolls to and pulses the first, and toasts what is missing. One shared composable does this for every drawer in scope.

## Requirements

1. `BeanieFormModal` gains a `saveReady` prop (default `true`), named to match its `saveLabel` / `saveGradient` / `saveDisabled` siblings. (A bare `ready` would also clash with TravelExtractReviewModal's own `ready` prop, the extraction payload its template tests with `v-if="ready"`.) When `saveReady` is `false` the Save button is drawn "not ready": neutral tint background, no gradient (whatever `saveGradient` is: orange, purple or teal), no shadow, no hover shadow, muted ink, in both themes. It stays clickable and still emits `save`. `saveDisabled` keeps its current meaning (a real `disabled`) for callers outside this scope and for `isSubmitting`.
2. A new shared composable `useFormValidation` (in `src/composables/useFormValidation.ts`) owns: the required-field rules, `missing`, `canSave`, attempted-save gating, `isRequired`, `showError`, the binding helpers (`bind` for `FormFieldGroup`, `hook` for any other target element), `attemptSave(onValid)`, and `reset()` (automatic on open when an `open` getter is given). On an invalid attempt it: marks every missing field, scrolls the FIRST missing field (in DOM order) into view, pulses it once, and shows ONE info toast naming the missing fields by their on-screen labels.
3. `FormFieldGroup` renders `data-form-label` (its `label` prop) on its root, and gains an optional `errorMessage` prop shown under the control when `error` is true. The scroll hook `data-form-field` reaches its root through Vue's attribute fallthrough, so no `field` prop is needed. Existing callers are unaffected.
4. `useBookingValidation` becomes a thin adapter over `useFormValidation`: it merges `alwaysRequired` with `requiredWhenBooked` (the latter only while `status === 'booked'`) into one rule set. It keeps its public return shape. The three travel modals change only to bind `:save-ready`, gain scroll, pulse and toast, and hand over their `open` getter instead of calling `reset()` themselves.
5. Migrated drawers: ActivityModal, TransactionModal, RecipeFormModal, FamilyMemberModal, GoalModal, AccountModal, TravelExtractReviewModal, VacationWizard (step 1), TravelSegmentEditModal, AccommodationEditModal, TransportationEditModal. Each binds `:save-ready="v.canSave.value"` (`readOnly || v.canSave.value` where a read-only mode exists), drops validation from `saveDisabled`, routes every Save path through `v.attemptSave`, and passes its `open` getter so reset happens one way everywhere.
6. ActivityModal's fee rules get a field hook and an inline error (fee schedule; custom period), and apply only when the controls are on screen (`isRecurring && hasCost`), so no rule can block Save without a visible mark.
7. AccountModal's detail-field errors (validated by `validateAccountDetails`, shown by `AccountDetailsFields` as BaseInput messages) count as one missing/invalid group. "More Details" renders open whenever details are invalid (`detailsOpen = showMoreDetails || !detailsValid`), so the person cannot collapse a section that holds an error. An invalid attempt scrolls to that section. This replaces today's disabled Save.
8. VacationWizard step 1 (name, trip type, travellers, trip dates, i.e. exactly `canGoNext`) uses the composable. The shared Next/Save button is "not ready" while step 1 is incomplete. It and the edit-mode "Save & Close" button are both validated through `attemptSave`. Later steps keep their existing behaviour.
9. Heritage Orange for the missing state (routine signal), `-lift` partners on dark, rem-based text, i18n `en` + `beanie` for every new string. The toast uses the field labels verbatim, so every hooked label must read as a noun that names the field.
10. The ~20 small one-field modals keep `saveDisabled` unchanged. `MagicBeansSheet` is not touched.
11. The theme skill's modal section is updated: `saveDisabled` is for genuinely unavailable actions only; required-field forms use `saveReady` + `useFormValidation`. The wizard line "Back/Next buttons, disabled until validation passes" (`SKILL.md:948`, in the create-pod onboarding wizard section) is corrected to the same rule. Next shows not-ready while input is missing and is disabled only when the step's action is genuinely unavailable (e.g. storage not yet connected).

## Important Notes & Caveats

- **Never gate validation with `disabled` again in these drawers.** A disabled button swallows the tap, so nothing can react to it. That is the whole bug.
- **Rules mirror today's `canSave` exactly, no more and no less.** Every migrated rule comes from an existing `canSave`/`canGoNext` condition. TransactionModal's `category` shows an asterisk but is not in its `canSave`, so it does NOT become a rule (that would add a requirement). A condition with no rule would reintroduce a silent block, which is why trip dates and the transfer rate are listed explicitly.
- **A rule must only apply while its field is rendered.** Conditional requirement is expressed by building the rule record conditionally (the pattern `useBookingValidation` already uses for per-segment-type rules), e.g. `...(isRecurring.value && hasCost.value ? { feeSchedule: ... } : {})`. Where one field renders in more than one template branch (ActivityModal's three `date` groups, TransactionModal's editable and locked "How often" groups), every branch carries the same binding. A rule that applies to a field removed by `v-if` is caught at runtime by `target_missing`.
- **`ConditionalSection` hides by CSS, not `v-if`.** It collapses to `max-h-0 opacity-0` and keeps its content in the DOM, so a hook inside a collapsed section still exists and `target_missing` cannot catch a rule that points into it. The scroll would land on an invisible element. A rule for a field inside a `ConditionalSection` must therefore use the section's own `show` expression as its condition. TransactionModal's `schedule` rule uses `recurrenceMode === 'recurring' || isEditingRecurring`, the same as its section. This is documented in `useFormValidation`'s JSDoc.
- **One DOM contract, one place.** The composable and `FormFieldGroup` meet only through two attributes: `data-form-field` (the hook) and `data-form-label` (the toast label). The label is always read from the hooked element **itself**, never searched for in its descendants: a `FormFieldGroup` supplies its own, and any other target gets it from `hook(field, label)`. The attribute names are exported as constants from `useFormValidation.ts`, documented in both files' JSDoc, and pinned by one test that mounts a real `FormFieldGroup` under the composable, so renaming either side breaks a test rather than silently breaking scroll.
- **Every hooked label is a noun naming the field**, because the toast prints it verbatim. Three targets have no such label today, and each gets one:
  - The custom fee period's existing key `planner.fee.customPeriod` is the inline word "Every". It gets a new `planner.fee.customPeriodLabel`.
  - The trip dates would read "Start Date" even when only the end date is missing. They get a new `travel.dates.label`.
  - The transfer rate has no title key: `transfer.noRate` is a full sentence with `{from}`/`{to}` placeholders. It reuses the existing `settings.exchangeRates` ("Exchange Rates"), which also names where the fix lives.
- **Rules stay plain predicates.** They are the same shape `useBookingValidation` callers already write, so there are no label or metadata fields to keep in step with the template.
- **DOM order, not declaration order**, decides which missing field scrolls into view: the composable queries `[data-form-field^="<formId>:"]` and takes the first missing one in document order (`querySelectorAll` returns document order). `BaseSidePanel` and `BaseModal` both teleport to `body`, so a `document` query reaches them.
- **Scoped per form instance.** Drawers stack (a list drawer over the activity drawer), so hooks carry a per-instance prefix. The prefix comes from a module-level counter (`fv1`, `fv2`, …), not `useId()`: `useId()` returns `''` and warns outside a component instance (verified in `@vue/runtime-core`), which would break the composable's own unit tests and the adapter's existing suite. The trailing `:` stops `fv1:` from matching `fv10:`.
- **One reset mechanism.** Every migrated drawer passes `open: () => props.open`, and the composable resets itself on each open. The travel modals' hand-written `validation.reset()` calls in `onNew`/`onEdit` are removed rather than kept alongside the getter, so there is one way to do it. `reset()` stays public for the wizard's step change (below).
- **Translation is resolved lazily.** Following CLAUDE.md's rule for `.ts` composables, the composable calls `useTranslationStore().t(...)` at the moment it builds a message (in `bind` and on an invalid attempt), not at setup. So creating the composable needs no Pinia, and only the paths that actually show text do.
- **Scroll container.** `BaseSidePanel`'s body (`flex-1 overflow-y-auto`) scrolls, and `el.scrollIntoView({ block: 'center' })` reaches it without a ref. `getAppScroller` is not needed because it resolves the page `<main>`, not the drawer.
- **Scroll-then-pulse already exists inline** in `TransactionModal.selectQuickLink` (`:690-699`: `scrollIntoView` smooth, then `setTimeout(pulse, 400)`). It is the only such copy in the codebase (the other `pulse` callers do not scroll). It becomes `useAttentionPulse().reveal(el)` and both places use it. Under reduced motion `reveal` scrolls with `behavior: 'auto'` (via the existing `prefersReducedMotion()` in `src/utils/prefersReducedMotion.ts`) and skips the delay. The pulse class is already suppressed by `style.css:449`.
- **No collapsed-section "reveal" hook is needed.** The only rule behind a collapsible is AccountModal's details. Its section renders from `detailsOpen` (open whenever details are invalid), and its hook sits on the always-rendered section wrapper. ActivityModal's "more details" holds no required field.
- **Read-only mode**: FamilyMemberModal and ActivityModal use Save as Close in read-only mode. There `:save-ready="readOnly || v.canSave.value"` keeps the button ready. The `@save` handler is a named `onSaveClick()` that emits `close` in read-only mode and otherwise calls `v.attemptSave(handleSave)`, as today.
- **Declaration order.** `v` is declared where each drawer's `canSave` is declared today. In ActivityModal this matters: the `{ immediate: true }` watch at `:841` reads `firstMissingFieldKey` during setup, so `v` must exist above it.
- **`isSubmitting`** still disables the button (double-submit guard). That is not validation.
- **`saveDisabled` survivors** (genuinely unavailable, not missing input): RecipeFormModal's `isReadingLocally`; TravelExtractReviewModal's `rows.length === 0`. RecipeFormModal's eager "add photo" button keeps its own `disabled` (a precondition gate, per `useEagerEntityCreate`'s contract), now reading `v.canSave.value`.
- **The attention pulse** paints an inset box-shadow and a tint. On a ring-wrapped control both show, so pulse the hook element (the `FormFieldGroup` root), not the control. The `FormFieldGroup` root gains `rounded-2xl`, the same radius as its error ring, so the glow follows the ring's shape. The root has no background or overflow, so nothing else changes.
- **Toast repeats**: `showToast` already dedupes an identical live toast (`useToast.ts`), so repeated taps don't stack toasts. No extra guard is needed.
- **Rule predicates that throw** are treated as missing and logged once per field (kept from `useBookingValidation`), never silent.
- **Keep the #108 changeset separate**: none of the #108 files are touched except as listed; `MagicBeansSheet`'s save rule stays.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. `BeanieFormModal` is the only Save button for every in-scope drawer, apart from VacationWizard's edit-mode "Save & Close" in `#footer-start`, which is routed through `attemptSave` too (verified). It keeps its own orange styling rather than copying the not-ready classes. It appears only in edit mode, where step 1 opens complete, and the primary Next button beside it already shows the not-ready state.
2. `FormFieldGroup` has a single root `div`, no `inheritAttrs: false`, and no `field`/`errorMessage` prop, so `data-form-field` falls through to the root (verified).
3. `useAttentionPulse().pulse(el)` works on any element and `.attention-pulse` is honoured under reduced motion by `style.css:449` (verified). `useAttentionPulse` has no test file today (verified).
4. `useBookingValidation` is used only by the three travel modals and its own test, and no caller or test passes its `onInvalid` argument (verified by grep). Each travel modal calls `validation.reset()` only from `useFormModal`'s `onNew`/`onEdit`, i.e. on open (verified), and `useFormModal` seeds only on `open` changes and on mount, not on entity changes (verified), so the `open` getter is an exact replacement.
5. ActivityModal's fee schedule chips never offer `none` to a recurring activity with a cost, so the reachable recurring case is the custom period. Both rules get a hook anyway.
6. `showToast('info', title, message)` from `useToast` is the toast API and dedupes identical live toasts (verified).
7. `diagnosticContext.ts` allowlists `action`, `kind` and `error_code`, so no new context key is needed (verified, `ALLOWED_CONTEXT_KEYS`). Events go through `logEvent` (`src/services/telemetry/logEvent.ts`), which never throws, including when Pinia is absent.
8. `validation.required` ("This field is required" / "this field is required") exists in `uiStrings.ts:2881` and is currently unused, so it is reused as the inline message (verified). `settings.exchangeRates` ("Exchange Rates") exists at `uiStrings.ts:2708` (verified).
9. `TripDatesInput` (`src/components/ui/TripDatesInput.vue`) has a single root `div` (verified), so a hook falls through to it.
10. `useBookingValidation.test.ts` sets up no Pinia and asserts the exact `'[useBookingValidation] rule "departureAirport" threw:'` console prefix (verified, `:220-226`). Both change with the adapter (see Testing Plan).
11. A one-off activity that keeps a stale `feeSchedule` of `custom` with no period (the case the hidden rule used to block) saves safely through the unchanged `buildPayload` (verified):
    - `activityStore` pays a one-off fee as a one-time full amount whatever the schedule (`isOneTimePayment = !resolved || isAllSchedule`, `activityStore.ts:~708`).
    - `calculateMonthlyFee` falls back to the full amount for `custom` with no period (`finance.ts:60-67`).
    - `ActivityViewEditModal.feeLabel` shows "/ custom", as it already does for a one-off saved with a custom period today.
12. `ConditionalSection` collapses with CSS and keeps its slot in the DOM (verified, `ConditionalSection.vue`).
13. `TransactionModal.test.ts`'s three `Validation` tests (`:599-631`) call `wrapper.vm.handleSave()` directly on an invalid form and expect no emit (verified). They depend on the guard this plan removes, so they are rewritten (see Testing Plan). No other in-scope drawer test calls `handleSave` on an invalid form (verified by grep). No e2e spec asserts a disabled Save in an in-scope drawer (verified: the only `toBeDisabled` save assertions are the onboarding add-member and invite-join buttons).
14. `export type` inside `<script setup>` is an established pattern here (`FrequencyChips.vue` exports `ChipOption`), so `VacationStep1.vue` can export its field union (verified).
15. The test environment is happy-dom (`vitest.config.ts`), which implements `scrollIntoView` as a no-op, so component tests that trigger an invalid Save need no polyfill.

## Approach

### 1. `useFormValidation` (new, `src/composables/useFormValidation.ts`)

```ts
/** Field → predicate returning true when the field holds a valid value. Include a
 *  field only while it is rendered and required (build the record conditionally).
 *  Inside a ConditionalSection, use the section's `show` expression as the condition. */
export type FormRules<Field extends string> = Partial<Record<Field, () => boolean>>;

export interface FormValidationOptions {
  /** Drawer's open state. Every drawer passes it; reset() then runs on each open. */
  open?: () => boolean;
}

export function useFormValidation<Field extends string>(
  formName: string, // telemetry `kind`, e.g. 'activity'
  rules: () => FormRules<Field>,
  opts?: FormValidationOptions
);

export type FormValidation<Field extends string> = ReturnType<typeof useFormValidation<Field>>;
export const FORM_FIELD_ATTR = 'data-form-field';
export const FORM_LABEL_ATTR = 'data-form-label';
```

Returns `{ missing, canSave, hasAttemptedSave, isRequired, showError, bind, hook, attemptSave, reset }`.

**Structure (keeps the file flat and small).** The file has two parts, and no function nests more than one callback deep:

- **State (pure and reactive, no DOM, no i18n):** `missing`, `canSave`, `isRequired`, `showError`, `hasAttemptedSave`, `reset`.
- **One private side-effect function, `revealMissing()`:** it runs only on an invalid attempt, in a fixed order: query hooks, reveal the first, toast, log. It is the only code that touches `document`, `useAttentionPulse`, `showToast` or `logEvent`.
- **Budget:** about 150 lines including JSDoc. If it grows past that, split `revealMissing` into its own module rather than adding options.

The pieces:

- `current`: one internal `computed(rules)`. `missing`, `isRequired` and `bind` all read it, so the rule record is built once per reactive change, not once per template call.
- `missing`: computed `Set<Field>` of fields whose predicate is false. A throwing predicate counts as missing. It is logged once per field per instance (`console.error('[useFormValidation:<formName>] rule "<field>" threw — fix the rule predicate:', err)`, plus `logEvent` `rule_threw`), so a recomputing computed can't spam.
- `canSave`: `missing.size === 0`. `isRequired(field)`: field is a key of `current`. `showError(field)`: `hasAttemptedSave && missing.has(field)`.
- `hook(field, label?)`: `{ [FORM_FIELD_ATTR]: '<formId>:<field>', [FORM_LABEL_ATTR]?: label }`, for a non-`FormFieldGroup` target (a notice, a section wrapper, a component root). A label is required whenever the target is not a `FormFieldGroup`, because the toast reads the label only from the hooked element itself.
- `bind(field)`: `{ ...hook(field), required: isRequired(field), error: showError(field), errorMessage: showError(field) ? t('validation.required') : undefined }`, spread onto `FormFieldGroup` with `v-bind`. The label comes from `FormFieldGroup`'s own `data-form-label` on the same root element.
- `attemptSave(onValid)`: sets `hasAttemptedSave`.
  - If valid: if this open saw a block, logs `recovered` and clears the flag, so it is logged once. Then it returns `await onValid()`. Errors from `onValid` propagate to the drawer's existing handling.
  - If invalid: `await revealMissing()`, then returns `undefined`.
- `revealMissing()`:
  1. `await nextTick()`, then query this form's hooks in DOM order and keep the missing ones.
  2. `reveal(first)` scrolls and pulses.
  3. Show one toast from those elements' own `data-form-label` values (deduped), and log `blocked`.
  4. Any missing field with no hook logs `target_missing` (`console.warn` with "add v-bind=\"v.bind('<field>')\" (or v.hook) to its element in <formName>", plus `logEvent`).
- Toast: `showToast('info', t('form.missing.title'), labels.length ? fillTemplate(t('form.missing.message'), { fields: labels.join(', ') }) : undefined)`. With no hooks found the title alone still tells the person, and `target_missing` tells the developer.
- `t` is `useTranslationStore().t`, resolved at call time inside `bind` and `revealMissing`, never at setup.
- `reset()`: clears `hasAttemptedSave` and the blocked-this-open flag. A `watch(opts.open, (o) => o && reset())` runs it on each open when `opts.open` is given, which every migrated drawer does, so drawers never call it from `onNew`/`onEdit`.
- The "THE SAVE BUTTON MUST NOT BE DISABLED" JSDoc (moved from `useBookingValidation`) sits on `attemptSave`. The `ConditionalSection` rule sits on `FormRules`.

### 2. `useAttentionPulse.ts` — add `reveal(el)`

`reveal(el)` does `el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })`, then `pulse(el)` after 400 ms (immediately under reduced motion). It is a no-op for a null element, like `pulse`. It is returned alongside `pulse`, so existing callers and their `{ pulse }` mocks are unaffected. `TransactionModal.selectQuickLink` replaces its inline scroll + `setTimeout(pulse, 400)` with `reveal(target)`.

### 3. `FormFieldGroup.vue`

- Add `:data-form-label="label"` and `rounded-2xl` on the root (the pulse's shape, see Caveats).
- Add `errorMessage?: string` → `<p v-if="error && errorMessage" class="font-outfit text-primary-500 dark:text-accent-lift mt-1.5 text-xs">`.
- `data-form-field` arrives by attribute fallthrough.
- Add a JSDoc paragraph naming the two attributes as the contract with `useFormValidation`.

Nothing else changes.

### 4. `BeanieFormModal.vue`

Add `saveReady?: boolean` (default `true`). The Save button's static `class` keeps only layout, typography and the `disabled:` variants. Everything that differs between the two states moves into one computed, `saveClasses`:

- When `!saveReady`: `bg-[var(--tint-slate-10)] text-secondary-500 dark:bg-surface-overlay dark:text-ink-soft shadow-none`.
- When ready: `text-white shadow-sm hover:shadow-md` plus today's gradient classes for the `saveGradient` in use, unchanged. The existing three-way template ternary moves into the same computed, so the template holds no class logic.
- `text-white shadow-sm hover:shadow-md` **must** leave the static list. If they stayed, the not-ready state would still carry them. Tailwind resolves conflicting utilities by stylesheet order, not class order, so `text-white` could beat `text-secondary-500`, and `hover:shadow-md` would always win on hover.

`disabled` stays `saveDisabled || isSubmitting`. No `aria-disabled`, because the button is actionable. JSDoc: `saveReady` is the validation state; `saveDisabled` is "this action is unavailable".

Sketch (phone, activity drawer):

```
 not ready                           ready
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ 🗑  │     Add Activity       │   │ 🗑  │▓▓▓▓ Add Activity ▓▓▓▓▓▓│
│     │  (slate tint, muted)   │   │     │ (orange→terracotta)    │
└──────────────────────────────┘   └──────────────────────────────┘
 tap → scroll to "Who's going?", ring + "This field is required", pulse,
       toast: "Still needed: Who's going?, Date"
```

### 5. `useBookingValidation.ts` → adapter

- **Body:** a merge plus a delegate: `useFormValidation(opts.formName ?? 'booking', () => ({ ...rules.value.alwaysRequired, ...(status.value === 'booked' ? rules.value.requiredWhenBooked : {}) }), { open: opts.open })`.
- **Signature:** `useBookingValidation(status, rules, opts?: { formName?: string; open?: () => boolean })`. It takes one options object rather than more positional arguments. Callers pass `formName` `'segment'`, `'accommodation'` or `'transportation'`, plus their `open` getter.
- **Return shape:** unchanged: `hasAttemptedSave, missing, canSave, isRequired, showError, attemptSave, reset`, plus `bind`/`hook`.
- **Removed:** `attemptSave`'s unused `onInvalid` parameter, because the shared composable now does what it was for.
- **Moved:** the try/catch and logging go into `useFormValidation`. The "THE SAVE BUTTON MUST NOT BE DISABLED" JSDoc moves with `attemptSave` into `useFormValidation`, since it now applies to every drawer. The adapter's JSDoc example is updated to `v-bind="v.bind('airline')"`.
- **The three travel modals:**
  - Bind `:save-ready="validation.canSave.value"`.
  - Replace each `:required="validation.isRequired('x')" :error="validation.showError('x')"` pair with `v-bind="validation.bind('x')"`.
  - Pass `{ formName, open: () => props.open }`.
  - Delete their `validation.reset()` calls from `onNew`/`onEdit`.
  - Their `handleSave` bodies are unchanged: they already wrap persistence in `validation.attemptSave`.

### 6. Drawer migrations (pattern, then specifics)

Pattern:

1. Turn the existing `canSave` conditions into one predicate per field, building the record conditionally for conditional fields.
2. Declare `const v = useFormValidation('<name>', () => rules, { open: () => props.open })` where `canSave` is declared today.
3. Bind `:save-ready="v.canSave.value"` and remove validation from `:save-disabled` (drop the prop entirely where nothing else remains, e.g. ActivityModal's and VacationWizard's `:save-disabled="false"`).
4. Handle Save with `@save="v.attemptSave(handleSave)"`, and drop the `if (!canSave) return` guard in `handleSave`. Any choice between handlers lives in a named script function, not an inline template expression.
5. Put `v-bind="v.bind('<field>')"` on each required `FormFieldGroup`, replacing the static `required` and `:error`. A field rendered in several branches gets the binding in every branch.
6. Delete the old `canSave`/`showErrors`/`errorX` computeds and their `showErrors = false` resets.
7. Any other code that repeats a rule predicate (an eager-create gate, a photo button) reads `v.missing` / `v.canSave` instead.

- **ActivityModal**:
  - Rules: title, date, assignees. `feeSchedule` (≠ `none`) and `customPeriod` (> 0 when `custom`) apply only when `isRecurring && hasCost`, which fixes the hidden one-off block. `buildPayload` is unchanged (Assumption 11).
  - `v` replaces `canSave` at `:657`, above the immediate watch at `:841`.
  - `date` binds all three date `FormFieldGroup`s (`:1076`, `:1091`, `:1099`); only one renders at a time.
  - Bind the existing fee-schedule `FormFieldGroup` (`:1156`) with `v.bind('feeSchedule')`.
  - Wrap the custom-period row (`:1174`) in a `FormFieldGroup` labelled with the new `planner.fee.customPeriodLabel` and bound with `v.bind('customPeriod')`. The inline "Every" span (`planner.fee.customPeriod`) stays inside the row as its sentence lead-in.
  - `firstMissingFieldKey` (the eager-create/photo gate at `:760`, which duplicates the same predicates) becomes `EAGER_CREATE_FIELDS.find((f) => v.missing.value.has(f)) ?? null`, with `const EAGER_CREATE_FIELDS = ['title', 'date', 'assignees'] as const` next to the rules. The fee rules are deliberately left out, matching today's gate.
  - `:save-ready="readOnly || v.canSave.value"`; `@save="onSaveClick"` (read-only → `emit('close')`, else `v.attemptSave(handleSave)`).
- **TransactionModal**:
  - Rules: `account`, `amount` (> 0).
  - When `isTransfer`: `toAccount` (set and not the same account), plus `transferRate` (`transferHasRate`), hooked with `v.hook('transferRate', t('settings.exchangeRates'))` on the existing Heritage Orange no-rate notice, which is already its visible mark. `transferHasRate` is `true` for same-currency pairs, so the rule can only fail while that notice renders.
  - Otherwise: `description`, plus `schedule` (`isRuleComplete(...)`) when `recurrenceMode === 'recurring' || isEditingRecurring` (the `ConditionalSection`'s own `show`). It is bound on both "How often" groups: the #70 locked summary (`:980`) and the editable picker (`:1006`). The rule applies in both today, so both need a mark.
  - `category` is not a rule (see Caveats).
  - `selectQuickLink` uses `reveal`.
- **RecipeFormModal**: name. `isReadingLocally` stays in `saveDisabled` and in `handleSave`'s own guard. The eager "add photo" button (`:757`, `:763`) reads `v.canSave.value`, and the eager `firstMissingField` (`:442`, which repeats the name predicate) becomes `() => (v.missing.value.has('name') ? 'name' : null)`.
- **FamilyMemberModal**: name. `:save-ready="readOnly || v.canSave.value"`; `@save="onSaveClick"` as in ActivityModal.
- **GoalModal**: name, target amount (> 0).
- **AccountModal**:
  - Rules: owner, name, category, plus `details` (`detailsValid`) hooked with `v.hook('details', t('modal.moreDetails'))` on the always-rendered section wrapper (`:396`).
  - Add `const detailsOpen = computed(() => showMoreDetails.value || !detailsValid.value)`. It drives the section's `v-if` and the chevron's `rotate-180`, so an invalid section cannot be collapsed.
  - Keep `watch(detailsValid)`, so the section stays open while the person fixes it, and update its comment ("Save is disabled while invalid" is no longer true).
  - `handleSave` drops its `!detailsValid` guard.
- **TravelExtractReviewModal**:
  - Rules: `tripName` (new trip) or `trip` (attach).
  - The two bare `<label>` + control blocks (`:339-356`) become `FormFieldGroup`s with `v-bind="v.bind(...)"`, so ring, message and hook come from the shared component. The labels adopt the shared uppercase field-label style, like every other form.
  - `rows.length === 0` stays in `saveDisabled`.
  - Bind with `:save-ready="v.canSave.value"`. Its own `ready` prop, the extraction payload, is unrelated, which is why the new prop is named `saveReady`.
- **VacationWizard** step 1:
  - Rules: name, trip type, travellers, `tripDates` (`tripDatesValid`), active only while `currentStep === 1`, so steps 2-5 have no rules and `canSave` is true.
  - `:save-ready="v.canSave.value"`. `@save="onPrimaryAction"`, where `function onPrimaryAction() { return v.attemptSave(currentStep.value < 5 ? goNext : handleSave); }`, and the edit-mode "Save & Close" uses `v.attemptSave(handleSave)` (its styling is unchanged, see Assumption 1). The composable owns the gating, so `goNext`/`handleSave` lose their `canGoNext`/`showErrors` guards.
  - `watch(currentStep, () => v.reset())` replaces `goBack`'s `showErrors = false`. It covers every way of changing step: the Back button, a stepper tap back to step 1, and a successful Next. So returning to step 1 always starts quiet, as Back does today.
  - `VacationStep1` exports `type VacationStep1Field = 'name' | 'tripType' | 'assignees' | 'tripDates'` (the child owns its prop contract; the wizard already imports the child, so the reverse direction would be circular). It replaces `showErrors` with one narrowly typed prop, `validation: Pick<FormValidation<VacationStep1Field>, 'bind' | 'hook' | 'showError'>`. It does not receive the whole composable. It binds the three `FormFieldGroup`s (which now show asterisks, matching the rules) and passes `v-bind="validation.hook('tripDates', t('travel.dates.label'))" :error="validation.showError('tripDates')"` to `TripDatesInput`. The label is given explicitly because `TripDatesInput`'s root is not a `FormFieldGroup`.
  - `TripDatesInput` gains an optional `error` prop (default `false`, so the trip summary page is unaffected). The change stays small:
    - The empty-state branch of `errorMessage` becomes `if (!someEntry) return props.error ? t('travel.dates.errorMissing') : null`.
    - Both date groups' `:error` becomes `error || <today's condition>`. The start group's today's condition is `false`.
    - Its root takes the hook by fallthrough.

### 7. Strings (`uiStrings.ts`, `en` + `beanie`)

- Reuse `validation.required` ("This field is required" / "this field is required") for the inline message, and `settings.exchangeRates` ("Exchange Rates" / "exchange rates") for the transfer-rate hook. No new keys for those.
- `form.missing.title`: "A Few Things Are Missing" / "a few things are missing"
- `form.missing.message`: "Still needed: {fields}" / "still needed: {fields}"
- `planner.fee.customPeriodLabel`: "Custom Period" / "custom period"
- `travel.dates.label`: "Trip Dates" / "trip dates"

### 8. Theme skill

Update the modal section (`SKILL.md` ~`:570-600`):

- Add a `saveReady` row to the prop table.
- Change `saveDisabled`'s purpose to "genuinely unavailable action only".
- Correct `saveGradient` to include `'teal'`, in both the prop table and the "Save button" paragraph. That paragraph also describes the not-ready look.
- Add a short "Required fields" note:
  - `useFormValidation(name, rules, { open })` + `v-bind="v.bind('x')"` (or `v.hook('x', label)` for a non-`FormFieldGroup` target, with a noun label).
  - Never disable Save to express missing input, and never call `reset()` from `onNew`/`onEdit`.
  - A rule inside a `ConditionalSection` uses the section's `show` as its condition.

Reword the wizard line (`:948`) as described in Requirement 11.

## Files Affected

- `src/composables/useFormValidation.ts` (new) + `src/composables/__tests__/useFormValidation.test.ts` (new)
- `src/composables/useAttentionPulse.ts` (`reveal`) + `src/composables/__tests__/useAttentionPulse.test.ts` (new; none exists today)
- `src/composables/useBookingValidation.ts` (adapter) + `src/composables/__tests__/useBookingValidation.test.ts`
- `src/components/ui/FormFieldGroup.vue`, `src/components/ui/BeanieFormModal.vue`, `src/components/ui/TripDatesInput.vue` (+ their existing tests in `src/components/ui/__tests__/`)
- `src/components/planner/ActivityModal.vue`
- `src/components/transactions/TransactionModal.vue` + `src/components/transactions/TransactionModal.test.ts` (the three `Validation` tests)
- `src/components/pod/RecipeFormModal.vue`
- `src/components/family/FamilyMemberModal.vue`
- `src/components/goals/GoalModal.vue`
- `src/components/accounts/AccountModal.vue`
- `src/components/travel/TravelExtractReviewModal.vue`, `TravelSegmentEditModal.vue`, `AccommodationEditModal.vue`, `TransportationEditModal.vue`
- `src/components/vacation/VacationWizard.vue`, `VacationStep1.vue`
- `src/services/translation/uiStrings.ts`
- `.claude/skills/beanies-theme/SKILL.md`
- Tests of any in-scope drawer that stub or assert `saveDisabled` (`RecipeFormModal.clearing.test.ts`, `RecipeFormModal.taxonomy.test.ts`: add `saveReady` to the stub's props where the assertion needs it)
- `docs/plans/2026-09-25-drawer-save-validation.md` (this plan)

## Observability Coverage

- **Events** go through `logEvent({ level, surface: 'form-validation', message, context })`. They are all `info` unless noted, and every key is already allowlisted:
  - `action: 'blocked'`, `kind: <formName>`, `error_code: <first missing field id>`: a Save tapped with fields missing.
  - `action: 'recovered'`, `kind: <formName>`: the first Save that passes validation after at least one block in the same open (logged once per open). This is the success-path signal: the blocked → recovered rate per form shows whether the scroll-and-toast gets people through.
  - `action: 'target_missing'`, `kind`, `error_code: <field>`, `warn`: a missing field has no `data-form-field` hook in the DOM, so nothing could scroll (a wiring defect, found blind). It is also logged with `console.warn` naming the exact binding to add.
  - `action: 'rule_threw'`, `kind`, `error_code: <field>`, `warn`, `error` attached: a rule predicate threw, and the field is treated as missing. It is also logged with `console.error`, once per field per instance.
- **Failure modes covered**:
  - A person is blocked and never recovers (`blocked` without `recovered`).
  - A field is wired without a hook, or a rule applies to a field removed by `v-if` (`target_missing`). A rule pointing into a CSS-collapsed `ConditionalSection` is not detectable at runtime. It is prevented by the rule convention in Caveats and checked in the browser pass.
  - A rule is broken (`rule_threw`).
  - A persistence failure inside `onValid` stays with each drawer's existing try/catch and error toast, because `attemptSave` never swallows it.
  - No new catch blocks beyond the predicate guard, and nothing is silent.
- **Critical vs telemetry**: nothing critical; no Slack page. `logEvent`'s client rate limiter (50 events per surface + message per minute) bounds a tap-happy user.
- **Privacy/store gate**: no new context key. Field ids are code identifiers, and labels never leave the device.

## Acceptance Criteria

- [ ] In every migrated drawer, Save looks "not ready" (neutral, no gradient, no shadow on hover, including teal travel drawers) while a required field is empty, and switches to the gradient the moment the last one is filled, in light and dark.
- [ ] Tapping a not-ready Save marks every missing field (ring, label colour, "This field is required"), scrolls the first missing field (DOM order) into view, pulses it once, and shows one toast listing the missing labels. Every label in the toast names its field (no "Every", no raw `{from}` placeholders).
- [ ] The activity drawer's custom fee period of 0 is marked and scrolled to. A one-off activity is never blocked by a hidden fee rule. The vacation wizard marks empty trip dates. No rule blocks Save without a visible mark in any migrated drawer (no `target_missing` in the browser pass).
- [ ] AccountModal opens "More Details" and scrolls to it on a detail-field error instead of disabling Save, and the section cannot be collapsed while a detail field is invalid.
- [ ] Two stacked drawers never scroll or mark each other's fields.
- [ ] Read-only drawers still close on Save with no validation, and their Save looks ready.
- [ ] Reopening a drawer shows no leftover rings from the previous open, including the three travel drawers now that they reset via `open`. Returning to wizard step 1 by Back or by the stepper shows no leftover rings.
- [ ] No migrated drawer calls `reset()` from `onNew`/`onEdit`, and none keeps a local `showErrors`/`canSave`/`canGoNext` or a second copy of a rule predicate.
- [ ] The ~20 one-field modals and `MagicBeansSheet` behave exactly as before.
- [ ] Under reduced motion the scroll is instant and the pulse is suppressed.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified.

## Testing Plan

1. Unit tests:
   - `useFormValidation`:
     - Conditional rules, a throwing predicate logged once, and attempted-save gating.
     - DOM-order first field, per-instance scoping with two forms mounted, and `open` auto-reset.
     - `blocked`/`recovered` (once per open)/`target_missing`/`rule_threw` events, and that an error thrown by `onValid` propagates.
     - One contract test mounts a real `FormFieldGroup` with `v-bind="v.bind('x')"` next to a `v.hook('y', 'Label')` target. It asserts the scroll target and the toast text `data-form-label` supplies, so a rename on either side of the attribute contract fails here.
     - The test sets `setActivePinia(createPinia())` and mocks `showToast`, `logEvent` and `reveal`.
     - A state-only test runs with no Pinia at all, proving setup does not touch i18n.
   - `useAttentionPulse.reveal` (new test file): smooth scroll then a delayed pulse normally, and an instant scroll with no delay under reduced motion (stub `prefersReducedMotion`). A null element is a no-op.
   - `useBookingValidation`: the existing suite runs through the adapter with three known updates.
     - Add `setActivePinia(createPinia())` and `vi.mock`s for `useToast`/`logEvent` in `beforeEach`, because the invalid `attemptSave` paths now show a translated toast.
     - Update the throw test's expected console prefix to `useFormValidation`'s.
     - Add one case that `open` flipping true resets `hasAttemptedSave`.
     - No test uses `onInvalid`, so its removal needs no test change.
   - `FormFieldGroup`: renders `data-form-label`, falls through `data-form-field`, shows `errorMessage` only with `error`.
   - `BeanieFormModal`: `saveReady` styling for all three gradients, including that the not-ready button carries neither `text-white` nor `hover:shadow-md`, and that a not-ready Save still emits `save`.
   - `TripDatesInput`: the `error` prop marks empty dates, and it is unchanged when `error` is absent.
   - `TransactionModal.test.ts`: the three `Validation` tests (empty description, zero amount, undefined amount) stop calling `handleSave()` directly. They emit `save` from the `BeanieFormModal` child instead and assert:
     - no `save`/`save-recurring` emit;
     - `saveReady` is `false`;
     - the offending field's `FormFieldGroup` has `error` set.

     Mock `logEvent` and `useToast` there. Tests that call `handleSave()` on a valid form are unchanged.
2. `npm run validate`.
3. Browser (Playwright harness in `scripts/design-screenshots/`):
   - Open the activity drawer at 360px, light and dark. Scroll to the bottom and tap Save. Confirm it scrolls to "What's the activity?" with ring, message and toast. Fill the fields and confirm the button turns ready.
   - Repeat once each for:
     - The activity drawer with a recurring cost, custom schedule and no period (toast reads "Custom Period").
     - TransactionModal (transfer with no rate; toast reads "Exchange Rates").
     - AccountModal (details reveal; collapsing "More Details" while invalid does nothing).
     - A travel drawer (reopen after a blocked save shows no rings).
     - Vacation wizard step 1 with empty dates (toast reads "Trip Dates"), then Next, then stepper back to step 1 shows no rings.
   - Watch the console for `target_missing`.
4. Manual (greg): the activity drawer on an iPhone with the keyboard open. Tap Save with the date empty and confirm the date field scrolls into view above the keyboard.

## Review Passes

- **Pass 1 (Initial draft)**: one shared `useFormValidation` (rules with labels and `when`, DOM-order scroll, pulse, toast, telemetry), `FormFieldGroup` hook + message, `BeanieFormModal` `ready` state, `useBookingValidation` as an adapter, eleven drawers migrated, theme skill corrected.
- **Pass 2 (DRY + error handling)**: labels read from `FormFieldGroup`'s `data-form-label` and rules are plain predicates; `when`, `reveal` and the `field` prop dropped; scroll-and-pulse shared as `useAttentionPulse().reveal` (TransactionModal's inline copy reuses it); existing `validation.required` string reused; `logEvent` plus console guidance named; a counter replaces `useId` and an `open` getter auto-resets; three hidden save-blockers fixed (one-off activity fee rules, wizard trip dates, transfer rate); Transaction `category` kept out of the rules; duplicated eager-gate checks and TravelExtractReview's hand-built labels removed; SKILL.md:948 fix re-aimed at the onboarding wizard.
- **Pass 3 (Sustainability)**: composable split into pure state plus one private `revealMissing` side-effect function with a size budget and lazy `useTranslationStore().t`; the label is read only from the hooked element (explicit `hook(field, label)` for `TripDatesInput`, no descendant search), with the attribute names exported and pinned by a real-`FormFieldGroup` contract test; one reset mechanism (`open` getter everywhere, adapter takes a `{ formName, open }` options object, travel modals drop their manual `reset()` calls, wizard Back calls `v.reset()`); `VacationStep1` takes a narrow typed `Pick<FormValidation<...>>` prop instead of the whole composable; template ternaries moved into named functions (`onPrimaryAction`, `saveClasses`, `EAGER_CREATE_FIELDS`); `TripDatesInput` change reduced to the empty branch plus `error ||`; multi-branch fields (Activity `date`, Transaction locked/editable "How often") bound in every branch; adapter test plan corrected (Pinia + toast/logEvent mocks, changed throw prefix, no `onInvalid` test exists).
- **Pass 4 (Fresh-eyes sweep)**: renamed the prop to `saveReady` (matches its `save*` siblings and avoids TravelExtractReviewModal's own `ready` prop); moved `text-white shadow-sm hover:shadow-md` into the ready branch (as static classes they would override the not-ready look); gave three hooks labels that read correctly in the toast (new `planner.fee.customPeriodLabel` and `travel.dates.label`, reused `settings.exchangeRates` instead of the placeholder sentence `transfer.noRate`); AccountModal "More Details" can no longer be collapsed while invalid (`detailsOpen`); added a caveat that `ConditionalSection` hides by CSS, so rules must use its `show` condition; settled the one-off fee question with verified store and finance behaviour; added the three `TransactionModal.test.ts` validation tests that call `handleSave()` directly, plus a new `useAttentionPulse` test file; the wizard resets on any step change (covers the stepper too); `VacationStep1Field` is exported from the child to avoid a circular import; one internal rules computed; `recovered` logged once per open; ActivityModal's declaration order pinned; Recipe's eager gate reads `v.missing`; read-only drawers use `readOnly || v.canSave` with a named `onSaveClick`; `FormFieldGroup` root gets `rounded-2xl` so the pulse matches the ring; rate-limiter wording corrected.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (greg, 2026-09-25)

"Let's make a quick fix to the activity drawer, and extending to other drawers as well as i believe it is a shared component. to improve UI for validation errors.

At the moment when one of the required fields on a drawer (i.e. the activity drawer) is not selected, the user is unable to submit. However on some screens, especially on mobile, it is not obvious to the user why the user was unable to submit. I believe an orange border (or something to that effect) gets drawn around the required item(s) but if the required section is not on the screen, it is not clear why the submit is not working, so this is a UX gap in my view.

I would like to address the below:

1. the submit button has an enabled style (as opposed to a muted/disabled style) even when all required fields are not filled out, which is not a standard UX convention. i believe the submit button should only get an enabled style when all required fields are filled out

2. if required fields are missing and the user tries to submit, the UI should auto-scroll on tap to the missing required fields

let me know if this makes sense, or if you would propose any other approach to improve the UX and avoid a situation where it is not clear to the user why the submit button for a given item/activity/plan/etc is not working due to field validation."

### Follow-up 1 (greg, after the proposal)

"sounds good i'm ok with teh direction and your proposed scope and proposal to bring this into one shared composable for every drawer, please build directly with /beanies-build-auto"

</details>
