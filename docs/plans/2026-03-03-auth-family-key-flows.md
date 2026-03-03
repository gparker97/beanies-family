# Plan: #114 — Auth & Onboarding Flows for Family Key Model

> Date: 2026-03-03
> Related issues: #114 (depends on #113, part of Epic #119)
> Branch: `feature/114-auth-family-key-flows` (off `feature/automerge-migration`)

## Context

The app currently has **two password layers**: a member password (per-person) and a pod encryption password (file-level). The family key model eliminates the pod encryption password — a random AES-256-GCM family key is generated automatically and wrapped per-member using their personal password. This removes steps without adding new ones.

The crypto services (`familyKeyService.ts`, `inviteService.ts`, `passkeyCrypto.ts`) and V4 beanpod format types are already built. The Automerge data layer switchover (#113) is complete. This issue wires the family key model into all auth flows and UI components.

## Approach

Eight phases, ordered by dependency. Tests updated within each phase to stay green throughout.

## Files Affected (Summary)

| Category | Files                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types    | `models.ts`, `syncFileV4.ts` (already done)                                                                                                                |
| Stores   | `syncStore.ts`, `settingsStore.ts`, `authStore.ts`                                                                                                         |
| Services | `passkeyService.ts`, `passkeyCrypto.ts`, `familyContext.ts`, `globalSettingsRepository.ts`                                                                 |
| UI       | `CreatePodView.vue`, `LoadPodView.vue`, `JoinPodView.vue`, `LoginPage.vue`, `BiometricLoginView.vue`, `App.vue`, `PasskeySettings.vue`, `SettingsPage.vue` |
| i18n     | `uiStrings.ts`                                                                                                                                             |
| Tests    | `passkeyService.test.ts`, `passwordCache.test.ts`, `dataClearingSecurity.test.ts`, `createNewFile.test.ts`, `syncAutoSave.test.ts`, 3 E2E specs            |

~25 files total
