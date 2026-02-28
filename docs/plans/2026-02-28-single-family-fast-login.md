# Plan: Single-Family Fast Login

> Date: 2026-02-28

## Context

Most users have exactly one family on their device. Currently they must navigate WelcomeGate → FamilyPicker → BiometricLogin every time. This change skips the first two steps when only one family exists, going directly to the sign-in screen with a "Not you?" escape hatch.

## Approach

### Detection logic in LoginPage.vue `onMounted`

After `familyContextStore.initialize()` + `syncStore.initialize()`, check `allFamilies.length === 1`. If so:

1. Fetch `hasPasskeys` + `providerConfig` for that family (same pattern as FamilyPickerView)
2. Set `isSingleFamilyAutoSelect = true`
3. Call existing `handleFamilySelected()` which routes to biometric/load-pod/pick-bean as appropriate
4. The existing spinner (`isInitializing`) covers the fetch time

For 0 or 2+ families, the flow is unchanged.

### "Not you?" link

Add a `showNotYouLink` boolean prop to `BiometricLoginView`. When true:

- Back button text changes from "Back" to "Not you? Switch account"
- In LoginPage, the `@back` handler routes to `'welcome'` instead of `'family-picker'`

Same pattern for `LoadPodView` and `PickBeanView` back handlers — if `isSingleFamilyAutoSelect` is true, back goes to `'welcome'`.

### "Welcome back, {family name}" greeting

When `showNotYouLink` is true, BiometricLoginView shows a warm "Welcome back" subtitle above the family name heading.

### Provider-specific error messages

When auto-loading fails, show contextual errors:

- Local file: "We looked everywhere but can't find your file — please select it again"
- Google Drive: "Your Google Drive credentials may have expired — please sign in again"
- Fallback: existing generic error

## Files affected

- `src/pages/LoginPage.vue` — Core orchestration (auto-detect, back handlers, error messages)
- `src/components/login/BiometricLoginView.vue` — showNotYouLink prop, welcome back subtitle
- `src/services/translation/uiStrings.ts` — 4 new fastLogin strings
