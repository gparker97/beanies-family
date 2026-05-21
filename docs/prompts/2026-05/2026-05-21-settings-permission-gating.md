---
date: 2026-05-21
category: enhancement
issue: null
plan: docs/plans/2026-05-21-settings-permission-gating.md
tags: [permissions, settings, currency, country, holidays, admin, canManagePod, guardrails]
---

# Gate family-shared Settings to admins (read-only for everyone else)

## Prompts

**[discussion]** We have permission levels — admin / finance / family / read-only (all off) — that mostly gate which views a user can access. But there's no restriction on what settings anyone can change: a member with no finance/family access can still change currencies, the home country, delete the family or data file, etc. Review the capabilities (including everything possible from Settings) across all permission levels, and propose what's appropriate to restrict.

**[clarifications]** (1) Treat all finance config, including base currency, as **admin-only** (not finance-flag). (2) Show read-only with a hint rather than hide. (3) Apply admin-only to the non-finance family config too (country / holidays / week-start) for consistency.

**[/beanies-plan]** Wrote up the plan (4-pass discipline); approved.

## Outcome

Implemented on `main`. Plan: `docs/plans/2026-05-21-settings-permission-gating.md`.

**Review findings (the actual gap):** delete-family, data file / storage, and member management were _already_ gated (`canManagePod` / `isOwner`). The genuinely open settings were the **family-shared config**: base currency, preferred currencies, exchange rates, home country, public-holidays toggle, and week-start day — all changeable by any member including read-only. Personal/device-local prefs (theme, text size, language, Trusted Device, own account) were correctly open. Framing established with greg: these are **client-side guardrails, not a security boundary** (one shared encrypted file; a determined member with the password can still edit the raw doc) — so UI-level disabling is the right mechanism.

**Implementation (admin-only `canManagePod`, read-only-with-hint):**

- New `src/components/settings/SettingsAdminOnlyNotice.vue` — reusable lock + "only a family admin can change this" line (DRY across 3 placements). New i18n `settings.adminOnly` (en + beanie; zh via `npm run translate`).
- `src/components/settings/ExchangeRateSettings.vue` — new `readOnly` prop (default `false`, so its sole caller is the only thing affected); disables both `BaseButton`s + the raw auto-update toggle + an early-return guard in `toggleAutoUpdate`.
- `src/pages/SettingsPage.vue` — reuses the already-imported `usePermissions()` (`canManagePod`). Currency modal: notice + base-currency `BaseSelect` disabled + chip-remove disabled + add-search hidden for non-admins + `ExchangeRateSettings :read-only`. Country & Holidays modal: notice + country `BaseCombobox` disabled + holidays `ToggleSwitch` disabled (preserving the existing `!settingsStore.country` guard via `||`). Appearance modal: week-start `BaseSelect` disabled + a notice scoped to that one control (theme/text-size stay open). Cards stay visible (no `v-if`), diverging from the hide-pattern of Data Management / Family Data, so values remain viewable; the `?open=` deep-links are safe (modal opens read-only).

**Verification:** new `SettingsAdminOnlyNotice.test.ts` (1) + `ExchangeRateSettings.test.ts` (2, readOnly disables/enables the buttons + toggle) green; `npm run type-check` + eslint clean (4 pre-existing SettingsPage warnings unrelated); full suite **2538 passed**. Skipped a full SettingsPage mount test (heavy dependency graph, low value vs. the focused unit tests). **Manual check still recommended:** open the app as a read-only member → Currency / Country / Appearance show dimmed controls + the notice + no add-search; as owner/admin → fully editable, no notice.
