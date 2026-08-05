# Plan: Optional account-details fields under the Accounts "More Details" section

> Date: 2026-08-05
> Related issues: None — direct implementation (no GitHub issue, greg's call)
> Plan file: `docs/plans/2026-08-05-account-details-more-section.md`
> Mockup: `docs/mockups/account-details-more-section-2026-08-05.html`

## User Story

As a family member organizing our finances, I want to store reference details for each account (account number, online-banking URL + user ID, card network/last-4/expiry, crypto wallet addresses) so that everything I need to identify or manage an account lives in one place instead of being scattered across notes, emails, and memory.

## Context

The accounts page today is a balance list: an `Account` carries `name`, `type`, `currency`, `balance`, `institution`, and (for loans) rate/payment/term/start. Families that want to keep the reference details they always dig for have nowhere to put them.

This adds an **optional reference-detail tier** captured under the account form's _existing_ "More Details" collapsible. It is deliberately the **non-secret** tier: identifying/reference info only. True access credentials (passwords, PIN, CVV, full card PAN, crypto seed/private keys) are **out of scope** and wait for a future "secrets" module that can add per-member private encryption — because everything on an `Account` today lives in the single shared family Automerge document and is readable by every pod member with the family key (ADR-019, ADR-022). greg has accepted family-pod visibility for this reference tier.

An approved CIG-clamped mockup drives the UI: `docs/mockups/account-details-more-section-2026-08-05.html`.

## Requirements

1. Add optional fields to `Account`; they flow through `CreateAccountInput`/`UpdateAccountInput` (Omit/Partial).
2. **Common** (all types): account number (**hidden for cash + crypto**), online-banking URL, online-banking user ID, customer-service phone, notes.
3. **checking / savings**: routing/sort code, IBAN, SWIFT/BIC (3 separate), (savings) interest rate.
4. **credit_card**: network (Visa/MC/Amex/Discover/UnionPay/JCB/Other), last-4 only, expiry MM/YY, credit limit, statement day, payment-due day. **Never CVV.**
5. **crypto**: repeatable labelled public wallets `{ id, label, address, chain? }`. **Never seed/private key.**
6. **loan**: no new fields (existing loan block covers it).
7. Entry: extend the existing `showMoreDetails` collapsible; type-conditional sections; persist via `handleSave`; extend auto-expand (`:95`).
8. Display: read-only "Account details" section in `AccountViewModal` — populated rows only; URL as link; card chip; Wallets sub-section with copy.
9. Validation (no silent failure): last-4 = 4 digits; day 1–31; expiry MM/YY; wallet row persists only with both label+address (partial → inline error). Via existing `error` prop on `BaseInput`/`BaseSelect` + `FormFieldGroup`. Save blocked on any error.
10. i18n: `en`+`beanie` keys via `t()`; `npm run translate`. Proper-noun options (networks, chains) not translated.
11. Backward compat: all optional; no migration.

## Important Notes & Caveats

- **CVV / passwords / PIN / full PAN / seed phrases HARD-EXCLUDED.** Card block caption: CVV never stored. Crypto block caption: public addresses only.
- **Account number displayed plainly** — no mask/reveal (greg's call).
- **No `RevealableInput` this round** — no consumer; deferred to the secrets module. `PasswordModal.vue:97-141` remains the reference pattern.
- **`interestRate` reused for savings** — type is savings XOR loan, no double-write.
- **Loan note from the mockup NOT ported** (the real form already renders the loan block above More Details).
- **Card networks + chains are proper nouns.** Label maps MUST be `Record<Code,string>` keyed by code (`{ visa: 'Visa', … }`) so `beanies-i18n/no-bare-render-strings` doesn't flag them; options built as `CARD_NETWORKS.map(n => ({ value: n, label: CARD_NETWORK_LABELS[n] }))`. **Never inline `{ label: 'Visa' }`.** No `eslint.config.js` allowlist edit needed.
- **Family-pod visibility is by design** (ADR-019/022).
- **Onboarding stays minimal** — `OnboardingAccount.vue` unchanged.
- **User-ID caption dropped (greg's call):** plain field, no future-secrets caption.
- **Detail fields stay FLAT on `Account`, NOT nested.** The repo `update` deletes top-level keys set to `undefined` (clear round-trips) — top-level only. `ACCOUNT_DETAIL_KEYS` list is the secrets-migration seam instead of nesting.
- **Patch write-semantics — omit off-type keys; `undefined` only for in-type cleared fields.** `buildAccountDetailsPatch` uses conditional spread: a field appears only when its type group applies; applicable-but-cleared → `field: undefined` (deleted, round-trips); non-applicable group → omitted entirely, NEVER `undefined`. Load-bearing for `interestRate`: `update` deletes `undefined` keys (`automergeRepository.ts:99`), so a patch emitting `interestRate: undefined` while editing a loan would wipe it. Maps `savingsInterestRate → interestRate` only when `type === 'savings'`.
- **Type-switch does not purge off-type keys — accepted, view-gated trade-off.** Omitted (not deleted) keys linger but are never displayed (view gated by predicates). Purging would reintroduce the wipe risk; out of scope.
- **Single reactive `details` object, not ~15 refs** (scoped to the extracted child; core fields keep refs).
- **Edit UI → `AccountDetailsFields.vue`; display → `AccountDetailsView.vue`** (keep both modals thin).
- **Parent↔child: plain prop + direct nested mutation, NOT `v-model:details`, NOT `defineModel`.** Parent owns `reactive<AccountDetails>`; passes `:details="details"`; child `defineProps<{ details: AccountDetails }>()` and mutates `props.details.<field>` directly (valid Vue 3.5 — nested mutation of the parent proxy, no warning). No `update:details` emit.
- **Reuse (verified Pass 2):** `getUrlDomain` (`utils/url.ts`), `getOrdinalSuffix` (`utils/format.ts`), `useClipboard` (`composables/useClipboard.ts`), `showToast`/`useToast`, `generateUUID` (`utils/id.ts`).

## Assumptions

1. Onboarding stays app-only.
2. `interestRate` reused for savings; `AccountDetails.savingsInterestRate → Account.interestRate`.
3. Card-network/chain values are proper nouns (code-keyed label maps, not `t()`).
4. **VERIFIED (Pass 2):** store→generic repo pass-through; `create` spreads via `stripUndefined`; `update` deletes keys explicitly `undefined` (`automergeRepository.ts:99`). No store/repo change. `handleSave` passes `value.trim() || undefined`. Delete-on-undefined is top-level only.
5. Family-pod visibility accepted.
6. One reactive `details`; flat fields; `ACCOUNT_DETAIL_KEYS` + mappers bridge shapes.

## Approach

Implements the approved mockup, sourcing every style token from `.claude/skills/beanies-theme/SKILL.md` + CIG (CIG wins). Map each region to existing components first. **Spine:** "which fields apply to which type" defined once as pure predicates in `utils/accountDetails.ts` (`bankFieldsApply`, `cardFieldsApply`, `cryptoFieldsApply`, `showsAccountNumber`), consumed by edit + save + view.

**1. `src/types/models.ts`** — new optional flat `Account` fields; `CardNetwork`, `CryptoWallet`, `CryptoChain`, and form-state `AccountDetails`.

**2. `src/constants/accountDetails.ts`** (new) — `CARD_NETWORKS`, `CARD_NETWORK_LABELS` (code-keyed), `CRYPTO_CHAINS`, `CRYPTO_CHAIN_LABELS`, `ACCOUNT_DETAIL_KEYS`. **`src/utils/accountDetails.ts`** (new, pure/tested) — predicates; `emptyAccountDetails`; `extractAccountDetails` (**deep-clones wallets**: `(account.wallets ?? []).map(w => ({ ...w }))`); `buildAccountDetailsPatch` (omit off-type, undefined-on-clear, numeric 0→unset, `sanitizeWallets`, savings→interestRate); `validateAccountDetails` (type-gated, 0-as-unset); `formatCardChip`; `isValidLast4`/`isValidExpiry`/`isValidDayOfMonth`; `sanitizeWallets` (new array); `hasAccountDetails`; `accountDetailTelemetry`. Reuse `getUrlDomain`/`getOrdinalSuffix`.

**3. `AccountModal.vue` + `AccountDetailsFields.vue`** (new) — reactive `details`, `detailErrors`/`detailsValid`, hydrate/reset via mappers, `<AccountDetailsFields :details=… :type=… :currency=… />` (plain prop) in More-Details, `...buildAccountDetailsPatch(...)` payload, auto-expand. Child: props only; `errors` computed; `FormFieldGroup` + label-less `BaseInput`/`BaseSelect` with `v-model="details.xxx"` + `:error`; type-conditional `v-if` via predicates; network `BaseSelect` from code-keyed map; live `formatCardChip` chip; hosts `CryptoWalletList`. User-ID is a plain field, no caption.

**4. `CryptoWalletList.vue`** (new) — plain-prop `:wallets`, in-place `push`/`splice`, rows `v-model` the row object; `FormFieldGroup` label + `.mono` address + chain `BaseSelect` + remove; "Add wallet" (Heritage Orange). Save-time sanitize + partial-row error via `validateAccountDetails`.

**5. `AccountViewModal.vue` + `AccountDetailsView.vue`** (new) — `<AccountDetailsView :account v-if="hasAccountDetails(account)" />`; populated rows via predicates; URL link; card chip; ordinal days; notes; Wallets sub-section (`.mono` truncated + copy via `useClipboard` → `showToast` success / `{ silent: true }` error). View gating hides stale off-type keys.

**6. Store** — no data change; success-path `logEvent` in create/update via `accountDetailTelemetry`.

**7. i18n** — keys in `uiStrings.ts`; `npm run translate`; spot-check zh.

## Files Affected

- `src/types/models.ts`; `src/constants/accountDetails.ts` (new); `src/utils/accountDetails.ts` (new) + `__tests__/accountDetails.test.ts` (new).
- `src/components/accounts/`: `AccountModal.vue`, `AccountDetailsFields.vue` (new), `CryptoWalletList.vue` (new), `AccountDetailsView.vue` (new), `AccountViewModal.vue`; tests `CryptoWalletList.test.ts`, `AccountDetailsFields.test.ts`, `AccountDetailsView.test.ts` (new).
- `src/services/translation/uiStrings.ts` (+ `public/translations/zh.json`).
- `src/utils/diagnosticContext.ts` (allowlist) + Lambda ingest allowlist mirror + pinned parity test.
- `src/stores/accountsStore.ts` (success-path `logEvent` only).
- `docs/runbooks/native-store-submission.md` + store data-safety declarations — only if a new context key ships.
- `src/content/help/**` — Help Center article.
- `docs/mockups/account-details-more-section-2026-08-05.html` (already committed).

## Help Center Coverage

- **Action** `new article` · **Category** `features` · **Type** `how-to` · **Slug** `account-details` · **Title** "Keep account details in one place".
- **Scope**: how to add optional details via More Details, why, which fields per type.
- **Must call out**: (1) stored encrypted but visible to the whole family pod; (2) never stores CVV/PINs/full card number/online-banking password/crypto seed — secure area coming later; (3) last-4 + network are only to help recognize a card.

## Observability Coverage

- **Success event**: `logEvent({ level:'info', surface:'account-details', message:'account saved', context })` on create/update; `context = accountDetailTelemetry(account)` — counts/booleans only: `account_type`, `has_account_number`, `has_online_banking`, `has_card_details`, `wallet_count`, `detail_field_count`. Emitted even at zero details (adoption rate).
- **Privacy/store gate**: raw values NEVER in context. All six keys absent from `ALLOWED_CONTEXT_KEYS` → add to `src/utils/diagnosticContext.ts` (snake_case) AND Lambda ingest allowlist + pinned parity test; declare in `native-store-submission.md` + store Data-Safety/App-Privacy + `PrivacyInfo.xcprivacy` + `privacy.astro`.
- **Failure modes**: (a) save failure via existing `accountsStore` `reportError`, not swallowed; (b) validation → inline `:error`, blocks save; (c) clipboard fail → `copy()` returns false → `showToast(..., 'error', { silent:true })`. No new `critical`.

## Acceptance Criteria

- [ ] Each type shows only its relevant fields; account number hidden for cash+crypto; visibility from shared predicates used by edit+save+view.
- [ ] Persist with no store/repo change; empty in-type fields + blank wallets → undefined (create dropped, update deleted → clear round-trips); off-type groups omitted.
- [ ] Loan edit never wipes `interestRate`; savings round-trips via `savingsInterestRate ↔ interestRate`.
- [ ] Editing round-trips every field without mutating the live store entity (wallets deep-cloned); cleared fields persist cleared; auto-expand when details exist.
- [ ] `AccountDetailsView` renders read-only rows (URL link, card chip, ordinal days) + Wallets copy (success + silent error) — populated only.
- [ ] Crypto multiple add/remove wallets; partial row blocks save with inline error.
- [ ] Validation (last-4 4 digits, expiry MM/YY, day 1–31) inline; parent+child from one `validateAccountDetails`.
- [ ] No CVV/full PAN/password/PIN/seed stored or inputtable.
- [ ] Existing accounts unaffected.
- [ ] Labels i18n'd (`en`+`beanie`), zh synced+spot-checked; beanie lowercase; large-text+dark. Label maps code-keyed, pass `no-bare-render-strings`.
- [ ] Help Center article added, matches behavior.
- [ ] Telemetry fires with counts/booleans only; six keys allowlisted + Lambda-mirrored + pinned-test + store-declared.
- [ ] Both modals stay thin; no duplicated type-conditional field list.
- [ ] `type-check`, `lint`, `build`, unit tests green.

## Testing Plan

1. **Unit** `accountDetails.test.ts`: predicates; extract/empty round-trip (savings↔interestRate; wallets cloned); `buildAccountDetailsPatch` (trim→undefined, 0→undefined, **off-type omitted — assert `'interestRate' not in patch` for loan, `'cardLast4' not in patch` for checking**, in-type clear→undefined, wallets sanitized/`[]`→undefined); `validateAccountDetails`; `formatCardChip`; `sanitizeWallets` (new array, input unmutated); `hasAccountDetails`; `accountDetailTelemetry`.
2. **Unit** `CryptoWalletList.test.ts`: add (id via `generateUUID`), remove, edit in-place, partial-row error.
3. **Unit** `AccountDetailsFields.test.ts`: sections per type; mutation updates the passed object; `:error` bound; account number hidden cash/crypto; card chip.
4. **Unit** `AccountModal`: payload via `buildAccountDetailsPatch`, empties→undefined; invalid blocks save; edit hydrates; auto-expand; **loan edit leaves `interestRate` intact**.
5. **Unit** `AccountDetailsView.test.ts`: populated-only; URL link; chip; ordinal; wallets; copy branches.
6. **Manual**: each type — fill/save/reopen (round-trip), clear a field (persists cleared), view display, copy wallet (success+failure toast), dark, beanie (lowercase), large-text, zh; confirm no CVV/password/seed inputs.
7. **E2E**: none (ADR-007 three-gate).

## Review Passes

- **Pass 1 (Initial draft)**: Full plan from the mockup — model, constants + pure helpers, type-conditional entry UI, `CryptoWalletList`, read-only display, validation, i18n, observability, Help Center; no `RevealableInput`; reused `interestRate` for savings.
- **Pass 2 (DRY + error handling)**: Verified store/repo pass-through (undefined-on-update deletes) → no store change + `value || undefined`; reuse `useClipboard`/`showToast`/`getUrlDomain`/`getOrdinalSuffix`; named `:error`/`FormFieldGroup` mechanism; `type="number"` empty→0; allowlist = `diagnosticContext.ts` + Lambda mirror + pinned test; verified `logEvent` shape.
- **Pass 3 (Sustainability)**: Extracted `AccountDetailsFields.vue` + `AccountDetailsView.vue`; one reactive `AccountDetails` + pure mappers; single-source predicates; unified `validateAccountDetails`; flat fields + `ACCOUNT_DETAIL_KEYS` seam.
- **Pass 4 (Fresh-eyes)**: plain-prop + nested mutation (not `v-model`); `buildAccountDetailsPatch` omit off-type / undefined-on-clear (prevents wiping loan `interestRate`; stops leaked hidden/type-switched data), type-switch-leaves-stale-keys documented as accepted view-gated trade-off; `extractAccountDetails` deep-clones wallets; code-keyed label maps pass lint; targeted test assertions.
- **Post-approval edit (light)**: dropped the user-ID future-secrets caption (plain field). No re-run (wording-only).
- **Implementation deviation**: the Pass-4 "plain prop + direct nested mutation" parent↔child pattern trips the `vue/no-mutating-props` CI rule (it flags nested prop mutation, not just reassignment). Switched both `AccountDetailsFields` and `CryptoWalletList` to `defineModel` (Vue-recognised as intentionally mutable, lint-clean) — the parent still binds one-way (`:details` / `:model-value`) and the child never reassigns the model, so no `update:*` emits and the shared reactive object still propagates. Same data-flow, lint-compliant mechanism.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt

"On the accounts page, I'd like to add some additional information … account number, online banking ID, password, credit (or debit) card number … perhaps even online banking url … keep passwords out this round … what are your thoughts … could you propose any other data points … under the 'more details' section."

### Follow-up 1

"Let's go with option A but we can go with full account number (i.e. a bank account), and keep to last 4 only for card numbers. Within a family, i don't see any issue sharing bank account numbers … regarding crypto … capture multiple public wallet addresses (each with a custom label)? for loans, i think we already capture interest rate."

### Follow-up 2

"Please include online banking user ID in the list for now … integrate with a secrets module later. yes, kick off /beanies-pre-plan."

### Pre-plan decisions

Bank identifiers: 3 separate fields. GitHub issue: Skip. Mockup approved as-is. Handoff approved.

### Approval

"approve and implement. no need for the subtle caption on the online banking user ID."

</details>
