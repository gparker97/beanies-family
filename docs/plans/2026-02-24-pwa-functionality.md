# Plan: Complete PWA functionality (Issue #6)

> Date: 2026-02-24
> Related issues: #6

## Context

Issue #6 requested full PWA + mobile-first design. The mobile UI was already complete (bottom nav, hamburger menu, responsive layouts, breakpoint system). What remained was PWA infrastructure: manifest completeness, meta tags, install prompt, offline detection, service worker improvements, and tests.

## Approach

1. Complete PWA meta tags in `index.html` (theme-color with dark mode, apple-mobile-web-app, description)
2. Complete manifest in `vite.config.ts` (start_url, scope, orientation, categories)
3. Create `useOnline` composable for offline detection (singleton pattern)
4. Create `OfflineBanner` component (slide-down banner when offline)
5. Create `usePWA` composable for install prompt (beforeinstallprompt, standalone detection, dismissal tracking)
6. Create `InstallPrompt` component (dismissible banner after 30s, 7-day dismissal persistence)
7. Change vite-plugin-pwa registerType from `autoUpdate` to `prompt`, create `UpdatePrompt` component using `virtual:pwa-register/vue`
8. Add install button to Settings page
9. Add all i18n strings to uiStrings.ts
10. Write tests for useOnline, usePWA, OfflineBanner, MobileBottomNav

## Files affected

**New files:**

- `src/composables/useOnline.ts`
- `src/composables/usePWA.ts`
- `src/components/common/OfflineBanner.vue`
- `src/components/common/InstallPrompt.vue`
- `src/components/common/UpdatePrompt.vue`
- `src/composables/__tests__/useOnline.test.ts`
- `src/composables/__tests__/usePWA.test.ts`
- `src/components/common/__tests__/OfflineBanner.test.ts`
- `src/components/common/__tests__/MobileBottomNav.test.ts`

**Modified files:**

- `index.html` — PWA meta tags
- `vite.config.ts` — manifest fields, registerType change
- `tsconfig.app.json` — added vite-plugin-pwa/vue type reference
- `src/App.vue` — added OfflineBanner, InstallPrompt, UpdatePrompt
- `src/pages/SettingsPage.vue` — added install app section
- `src/services/translation/uiStrings.ts` — PWA i18n strings
