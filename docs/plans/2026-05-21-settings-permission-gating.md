# Plan: Gate family-shared Settings to admins (read-only for everyone else)

> Date: 2026-05-21
> Related: permission-gap review of Settings. No GitHub issue yet.

## Context

The permission flags (`canManagePod`=admin, `canViewFinances`=finance, `canEditActivities`=family; read-only = all off) today gate **views** but almost nothing in **Settings**. A review found that any member — including a read-only member — can change **family-shared** config that affects the whole pod: base currency, preferred currencies, exchange rates, home country, the public-holidays toggle, and week-start day. (Already correctly gated: Data Management, Family Data, delete-family, member management — all `canManagePod`/`isOwner`. Correctly open: theme / text-size / language / Trusted Device / own account — these are device-local personal prefs.)

**Decisions (confirmed with greg):**

1. **All family-shared config → admin-only (`canManagePod`).** "Structural config = admin stewardship"; the finance/family flags govern day-to-day data, not config.
2. **Show, don't hide** — render these settings **read-only** for non-admins (controls disabled + a hint), so everyone can still _see_ the current values. This diverges from the Data Management / Family Data cards, which hide entirely.

**Framing:** these are client-side **guardrails, not a security boundary** — the pod is one shared encrypted file, so a determined member with the password can still edit the raw doc. The goal is preventing accidental/casual overreach among trusted family members. UI-level disabling is therefore the appropriate mechanism (matches the existing `FamilyMemberModal :readOnly` pattern).

## Approach

Reuse `usePermissions()` (already imported in SettingsPage at line 61 — `const { canManagePod, isOwner } = usePermissions()`; `canManagePod` already implies owner/finance/family). For each family-shared control, bind `:disabled="!canManagePod"`; for non-admins show a small reusable notice. Keep the Currency and Country cards visible (no `v-if` change) so the modals open read-only. The Currency & Country modals already use `:save-label="t('action.close')"` + close-on-save, so they're non-destructive shells — only the inner controls need disabling.

## Files affected

- **`src/pages/SettingsPage.vue`** — disable the family-shared controls in 3 modals (Currency, Country & Holidays, and the week-start select inside Appearance); add the notice.
- **`src/components/settings/ExchangeRateSettings.vue`** — add a `readOnly` prop (default `false`) and apply to its two `BaseButton`s + the raw auto-update toggle. (Verified: this component's only live caller is the Currency modal, so the default keeps any future/standalone use unaffected.)
- **`src/components/settings/SettingsAdminOnlyNotice.vue`** _(new)_ — tiny presentational hint (lock icon + one line), used in 3 places (DRY). Styling mirrors the existing muted hints (`text-xs text-gray-500 dark:text-gray-400`).
- **`src/services/translation/uiStrings.ts`** — one new key, e.g. `settings.adminOnly` (en + beanie; beanie all-lowercase). Proposed en: _"Only a family admin can change this. Ask a family admin to update it."_ (wording finalizable at implementation; mirror `noAccess.description` style). Then `npm run translate` for zh.
- **Reuse, no edit:** `usePermissions.ts`; `disabled` props already on `BaseSelect`, `BaseCombobox`, `ToggleSwitch`, `BaseButton`; the `:readOnly` pattern in `FamilyMemberModal.vue`.

## Steps

1. **i18n** — add `settings.adminOnly` (en+beanie) near the `noAccess.*` block in `uiStrings.ts`.
2. **New component** `SettingsAdminOnlyNotice.vue` — renders 🔒 + `t('settings.adminOnly')`; uses `useTranslation`; self-contained (trivially testable).
3. **ExchangeRateSettings.vue** — `withDefaults(defineProps<{ standalone?: boolean; readOnly?: boolean }>(), { standalone: true, readOnly: false })`; set `:disabled="isUpdating || props.readOnly"` on the Refresh button (line ~73) **and** the empty-state Fetch button (line ~174); add `:disabled="props.readOnly"` + disabled styling on the raw auto-update `<button>` (line ~110) and an early-return in `toggleAutoUpdate` when `readOnly`.
4. **Currency modal** (SettingsPage 872–984):
   - `<SettingsAdminOnlyNotice v-if="!canManagePod" />` at the top of the modal body.
   - Base-currency `BaseSelect` (883): `:disabled="!canManagePod"`.
   - Chip-remove `<button>` (909–915): `:disabled="!canManagePod"` + `disabled:cursor-not-allowed disabled:opacity-40`.
   - Hide the "search to add" affordance for non-admins: change wrapper `v-if="preferredCount < 4"` (920) → `v-if="canManagePod && preferredCount < 4"` (chips stay visible read-only; avoids styling many disabled raw result buttons).
   - `<ExchangeRateSettings :standalone="false" :read-only="!canManagePod" />` (982).
5. **Country & Holidays modal** (987–1029):
   - `<SettingsAdminOnlyNotice v-if="!canManagePod" />` at the top.
   - Country `BaseCombobox` (997): `:disabled="!canManagePod"`.
   - Holidays `ToggleSwitch` (1023): `:disabled="!settingsStore.country || !canManagePod"` (preserve the existing country guard — regression check).
6. **Week-start** `BaseSelect` (Appearance modal, 859–868): `:disabled="!canManagePod"` + `<SettingsAdminOnlyNotice v-if="!canManagePod" />` placed directly under this one control only (theme/text-size above stay open — no modal-level banner here).
7. **`npm run translate`** to backfill zh.

## Edge cases

- **Base-currency confirm modal** (`showRatesWarning` → `handleFetchAndSwitch`/`handleSwitchWithoutRates`): only reachable via `updateCurrency`, which fires from the now-disabled select — so non-admins can't open it. Select-level disable is sufficient; no orphan path.
- **Deep-links** `?open=currency` / `?open=country-holidays` (cardOpenMap 89–111): safe — the modal opens but renders read-only with the notice. Cards intentionally stay visible.
- **Holidays toggle**: must `||` with the existing `!settingsStore.country`, not replace it.
- **Raw elements** (chip-remove button, ExchangeRateSettings auto-update button) lack shared-component disabled styling — add explicit `cursor-not-allowed opacity-*` classes (also the only mobile-visual gotcha; modals are drawers, controls identical otherwise).
- **What a read-only member sees:** cards open; admin-only notice at top; base-currency/country/week-start dimmed; preferred chips visible but add-search hidden; exchange-rate refresh + auto-update disabled; holidays toggle disabled. Every current value remains readable — the intent.

## Verification

- **Unit tests** (cheap, high value):
  - `src/components/settings/__tests__/SettingsAdminOnlyNotice.test.ts` — mock `useTranslation` (`t: k => k`); assert it renders the `settings.adminOnly` key + lock affordance.
  - `src/components/settings/__tests__/ExchangeRateSettings.test.ts` — mount with `readOnly: true`, assert both `BaseButton`s + the auto-update button are disabled; flip to `false`, assert enabled. (This is where the new disable logic lives in its own file — right granularity.)
- **Skip a full SettingsPage mount test** — SettingsPage pulls a large store/router/PWA graph; mocking it for a clean mount is brittle and low-value vs. the unit tests above. Use the repo's reactive-`canManagePod`-ref mock pattern (`MobileBottomNav.test.ts`) only if a focused mount proves tractable.
- **Manual (primary for the SettingsPage wiring):** run `npm run dev`; as a **read-only member** (or with `canManagePod` mocked false) open Currency / Country / Appearance → confirm controls dimmed, notice shown, add-search hidden, holidays toggle disabled; as **owner/admin** → confirm everything editable and the notice is absent. Then `npm run validate` (type-check + lint + format + unit + build) green.

## Review passes (per /beanies-plan discipline)

- **DRY:** single `SettingsAdminOnlyNotice` component + single `settings.adminOnly` key across 3 placements; reuse `usePermissions` and existing `disabled` props; no new permission logic.
- **Error-handling / no-silent-failures:** no new failure paths — purely additive UI gating; existing handlers unchanged (a disabled control simply never fires). `toggleAutoUpdate` gets a defensive early-return.
- **Sustainability:** matches the established `FamilyMemberModal :readOnly` + `usePermissions` patterns; `ExchangeRateSettings.readOnly` defaults false so the prop is backward-compatible.
- **Fresh-eyes correctness:** preserved the `!settingsStore.country` holidays guard; confirmed `ExchangeRateSettings` has no other caller; deep-link + confirm-modal paths verified safe; week-start notice scoped to its single control so personal prefs in Appearance stay open.

## Note for implementation

Per project convention, copy this plan to `docs/plans/2026-05-21-settings-permission-gating.md` before writing code.
