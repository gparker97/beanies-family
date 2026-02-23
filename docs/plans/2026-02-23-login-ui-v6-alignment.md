# Plan: Login UI v6 Alignment Fixes

> Date: 2026-02-23
> Related issues: #69 (follow-up)

## Context

The login screens were implemented based on the v6 UI framework proposal, but several styling and design details diverge from the proposal specs. This plan addresses the specific differences identified by reviewing the proposal side-by-side with the implementation.

## Approach

Alignment fixes across 6 files:

1. **LoginSecurityFooter.vue** — Increase opacity from 30 to 40, update font to 0.65rem/medium/deep-slate
2. **LoadPodView.vue** — Drop zone: 3px orange dashed border, 24px radius, gradient bg, 72px icon, "Accepts .beanpod files" tag. Security cards: colored icon circles, subtitles, white card styling with shadow. Spinner fix: don't show spinner during manual file picker. Decrypt modal: remove large lock icon, green badge restyled, adjusted font sizes
3. **PickBeanView.vue** — Add info bubble below avatar grid. Switch family restyled as bordered button
4. **CreatePodView.vue** — Beanie image on step 1, step labels below circles, heading changed to "Grow a brand-new pod", role dropdown next to name, password label updated, member removal button, add member error handling
5. **JoinPodView.vue** — Remove "Joining as" role indicator and related code
6. **uiStrings.ts** — ~10 new i18n keys, 2 updated keys

## Files affected

- `src/components/login/LoginSecurityFooter.vue`
- `src/components/login/LoadPodView.vue`
- `src/components/login/PickBeanView.vue`
- `src/components/login/CreatePodView.vue`
- `src/components/login/JoinPodView.vue`
- `src/services/translation/uiStrings.ts`
- `docs/plans/2026-02-23-login-ui-v6-alignment.md`
