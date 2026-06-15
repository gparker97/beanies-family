/**
 * OAuth return paths for the login/load flow.
 *
 * These are the `returnPath`s handed to `startRedirectAuth` (via
 * `syncStore.beginDriveAuthRedirect`) so that, after the user consents and the
 * deep link (native) / callback (web) lands back in the app, `LoginPage`'s
 * resume dispatcher knows what to resume.
 *
 * `RESUME_SETUP_PATH` (the create / resume-setup return) lives in
 * `connectStorage.ts` because that module owns connect-new-storage concerns.
 * The *load-existing-pod* return path is a login-flow concern, so it lives here
 * — next to `LoadPodView`, the view that owns the picker.
 *
 * Shared by `LoadPodView` (passes `LOAD_DRIVE_PATH` into the redirect) and
 * `LoginPage` (matches `RESUME_LOAD_DRIVE` to re-open the picker on return).
 */

/** `route.query.resume` value that re-opens the Google Drive file picker. */
export const RESUME_LOAD_DRIVE = 'load-drive';

/** Full return path for a Drive-load redirect — `LoginPage` re-opens the picker here. */
export const LOAD_DRIVE_PATH = `/welcome?resume=${RESUME_LOAD_DRIVE}`;

/**
 * `route.query.resume` value for the create / resume-setup continuation. The
 * full path (`RESUME_SETUP_PATH`) lives in `connectStorage.ts`; this is the bare
 * query token so the magic string `'setup'` is named once across the app
 * (App.vue boot, the router guard, and LoginPage).
 */
export const RESUME_SETUP = 'setup';

/**
 * Whether a `route.query.resume` value puts LoginPage into a deliberate
 * podless recovery view — the resume-setup continuation OR the Drive-load
 * picker re-open (ADR-029). Used to exempt those surfaces from the
 * onboarding-zombie alert and from redundant resume-setup redirects.
 *
 * `route.query.resume` is typed `LocationQueryValue | LocationQueryValue[]`
 * (string | null | array); the strict equality checks below safely return
 * false for the null/array cases.
 */
export function isPodlessRecoveryQuery(resume: unknown): boolean {
  return resume === RESUME_SETUP || resume === RESUME_LOAD_DRIVE;
}
