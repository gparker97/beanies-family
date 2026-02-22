# Plan: Trusted Device — Persistent Data Cache

> Date: 2026-02-22
> Related issues: #74

## Context

On beanies.family (production), every time a user signs in they are redirected to the Setup wizard and asked to load their data file + enter their encryption password. This happens because `authStore.signOut()` deletes the per-family IndexedDB database (`gp-family-finance-{familyId}`), so on next sign-in the app finds no family members and treats the user as new.

The file handle itself survives sign-out (stored in separate `gp-finance-file-handles` DB), but the browser requires a fresh user gesture to re-grant file permission on each page load. Combined with the deleted cache, this means the user must go through the full Setup flow every time.

**Goal:** On trusted devices, keep the IndexedDB cache across sign-outs so returning users see their data immediately without re-loading the file or re-entering the encryption password.

## Approach

Add an `isTrustedDevice` flag to `GlobalSettings` (device-level, stored in registry DB). When set:

1. **Sign-out preserves data cache** — `signOut()` skips `deleteFamilyDatabase()` (only clears auth tokens)
2. **Sign-in loads from cache** — On next sign-in, per-family DB still has all data, so `isSetupComplete` is true and the user goes straight to the dashboard
3. **File sync happens lazily** — When the user grants file permission (via banner or settings), the app syncs with the file. If encrypted, the password is prompted once per session
4. **Explicit "Sign out & clear data"** — Trusted device users get a second sign-out option that also clears the cache (for shared/public computers)

### Trust prompt flow

After the user's **first successful sign-in + data load** (Setup complete → dashboard), show a one-time modal:

> **Trust this device?**
>
> Keep your data cached locally for instant access next time you sign in.
>
> [Trust this device] [Not now]
>
> _You can change this in Settings. Use "Sign out & clear data" to remove cached data._

## Files affected

- `src/types/models.ts` — Added `isTrustedDevice` and `trustedDevicePromptShown` to `GlobalSettings`
- `src/services/translation/uiStrings.ts` — Added i18n keys for trust prompt, settings toggle, sign-out options
- `src/stores/settingsStore.ts` — Added `isTrustedDevice`, `trustedDevicePromptShown` getters and `setTrustedDevice()`, `setTrustedDevicePromptShown()` actions
- `src/stores/authStore.ts` — Conditional `deleteFamilyDatabase()` in `signOut()`, added `signOutAndClearData()` action
- `src/components/common/TrustDeviceModal.vue` — Created: one-time trust prompt modal
- `src/App.vue` — Trust prompt logic after first successful data load
- `src/components/common/AppHeader.vue` — Added "Sign out & clear data" button for trusted devices
- `src/components/common/MobileHamburgerMenu.vue` — Added sign-out buttons for cloud users with trusted device option
- `src/pages/SettingsPage.vue` — Added trusted device toggle in Security section
