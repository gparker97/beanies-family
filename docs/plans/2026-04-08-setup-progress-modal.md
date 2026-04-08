# Plan: Setup Progress Modal

> Date: 2026-04-08
> Related: mockup at `docs/mockups/setup-progress-modal.html`

## Context

After the 3-step setup wizard, clicking "Finish" triggers async operations with no visual feedback — the app feels frozen. This adds a progress modal that narrates the setup with animated steps, then transitions to a celebration before navigating to the app.

## Approach

- New `SetupProgressModal.vue` component with 3-phase state machine (progress → error → success)
- 5 perceived steps: first 3 are visual recaps (timers), last 2 are real async (syncNow + setupAutoSync)
- DRY extractions: `ConfettiEffect.vue` (from VacationWizard), `delay()` utility
- Error handling: retry, continue anyway (data cached locally), go back
- Success: confetti + celebrating beanies + fanfare sound + CTA button

## Files affected

| File                                          | Action                                        |
| --------------------------------------------- | --------------------------------------------- |
| `src/utils/timing.ts`                         | Created — `delay()` utility                   |
| `src/components/ui/ConfettiEffect.vue`        | Created — extracted from VacationWizard       |
| `src/components/login/SetupProgressModal.vue` | Created — progress modal                      |
| `src/components/vacation/VacationWizard.vue`  | Modified — uses ConfettiEffect                |
| `src/components/login/CreatePodView.vue`      | Modified — replaced handleFinish with modal   |
| `src/services/translation/uiStrings.ts`       | Modified — added ~20 setupProgress.\* strings |
