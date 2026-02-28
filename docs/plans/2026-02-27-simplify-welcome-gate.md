# Plan: Simplify Welcome Gate & Sign-In Flow

> Date: 2026-02-27

## Context

The current welcome gate sometimes jumps directly to the family picker or biometric login (skipping the welcome screen entirely), which confuses users. With the family picker modal now available, the flow can be simplified: always show the welcome gate first, then route through a proper family picker when the user chooses "Sign In." The inline family picker in `LoginPage.vue` needs to be extracted into a branded component, and the redundant "Switch to a different family" buttons need removal.

## New Flow

```
Welcome Gate (always first)
  ├─ "Sign In" → FamilyPickerView
  │   ├─ Select family (1 or many) → biometric (if passkeys) or load-pod (auto-load configured file)
  │   ├─ "Load a different file" → LoadPodView (with forceNewGoogleAccount option)
  │   ├─ Delete family (even the last one → empty state)
  │   └─ Back → Welcome Gate
  ├─ "Create" → CreatePodView (unchanged)
  └─ "Join" → JoinPodView (unchanged)
```

## Approach

1. **Never skip welcome gate** — remove passkey-based auto-jump logic from `onMounted`
2. **"Sign In" → family picker first** — even for a single family, show the picker with that family's name
3. **New Google account** — when loading a different file via Google Drive, force the account chooser
4. **Remove "Switch to a different family"** from LoadPodView, PickBeanView, BiometricLoginView
5. **Show family context** (name, file, provider) on PickBeanView and BiometricLoginView
6. **Brand the family picker** with beanie mascot and beanies.family styling

## Files affected

| File                                          | Change                                                        |
| --------------------------------------------- | ------------------------------------------------------------- |
| `src/components/login/FamilyPickerView.vue`   | **NEW** — Branded family picker component                     |
| `src/pages/LoginPage.vue`                     | Remove passkey-skip, inline picker; add family-picker routing |
| `src/components/login/LoadPodView.vue`        | Remove switch-family button, add `forceNewGoogleAccount` prop |
| `src/components/login/PickBeanView.vue`       | Remove switch-family button, add provider/file context        |
| `src/components/login/BiometricLoginView.vue` | Remove switch-family button, add back button + file context   |
| `src/services/google/googleAuth.ts`           | Add `forceConsent` option to `requestAccessToken()`           |
| `src/stores/syncStore.ts`                     | Forward `forceNewAccount` in `listGoogleDriveFiles()`         |
| `src/services/translation/uiStrings.ts`       | Add `familyPicker.*` keys, remove `loginV6.switchFamily`      |
