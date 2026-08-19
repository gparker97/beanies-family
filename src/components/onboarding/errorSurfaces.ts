/**
 * Single-source const for the onboarding wizard's error-reporter surface
 * names. Used in `showToast({ surface })`, `reportError({ surface })`,
 * `data-testid` attributes, and tests.
 *
 * Keep entries kebab-case to match the project's existing surface
 * convention (see `useStaleTabRefresh`, `useJoinFlow`, `useGiveDose`).
 */
export const ErrorSurfaces = {
  onboardingAddAccount: 'onboarding-add-account',
  onboardingAddRecurring: 'onboarding-add-recurring',
  onboardingAddActivity: 'onboarding-add-activity',
  onboardingFinishSync: 'onboarding-finish-sync',
  onboardingFinishBudget: 'onboarding-finish-budget',
  onboardingSkipSync: 'onboarding-skip-sync',
} as const;

export type OnboardingErrorSurface = (typeof ErrorSurfaces)[keyof typeof ErrorSurfaces];
