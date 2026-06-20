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
 * `route.query.resume` value for the create / resume-setup continuation — the
 * bare query token so the magic string `'setup'` is named once across the app
 * (App.vue boot, the router guard, and LoginPage).
 */
export const RESUME_SETUP = 'setup';

/**
 * Full OAuth-redirect return path for the create / resume-setup continuation —
 * `LoginPage` shows the resume-setup screen here. Lives in this lightweight
 * module (not `connectStorage.ts`, which drags in the Drive provider + sync
 * service) so App.vue / LoginPage / tests can import the constant without the
 * heavy graph. `connectStorage.ts` re-exports it for back-compat.
 */
export const RESUME_SETUP_PATH = `/welcome?resume=${RESUME_SETUP}`;

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

/**
 * Why the resume-setup screen was reached, surfaced as an actionable hint
 * (2026-06-19, finding 3). Set just before App.vue routes a podless session to
 * resume-setup; read+cleared once by the screen on mount.
 *
 * - `drive-consent` — the granular consent screen came back WITHOUT `drive.file`
 *   (the user unchecked file access). Without this, the user was silently routed
 *   with no explanation and retried blindly.
 *
 * sessionStorage-backed (survives the full-page OAuth redirect) rather than a
 * URL param, so it doesn't have to thread through the shared `RESUME_SETUP_PATH`
 * redirect. Best-effort: a storage failure just means no hint is shown.
 */
export type ResumeSetupReason = 'drive-consent';
const RESUME_REASON_KEY = 'beanies:resume-reason';

export function setResumeReason(reason: ResumeSetupReason): void {
  try {
    sessionStorage.setItem(RESUME_REASON_KEY, reason);
  } catch {
    // sessionStorage unavailable (private mode / disabled) — the hint is
    // best-effort; the recovery screen still works without it.
  }
}

export function consumeResumeReason(): ResumeSetupReason | null {
  try {
    const v = sessionStorage.getItem(RESUME_REASON_KEY);
    if (v) sessionStorage.removeItem(RESUME_REASON_KEY);
    return v === 'drive-consent' ? 'drive-consent' : null;
  } catch {
    return null;
  }
}

// NOTE: the `PendingCreate` password-stash (2026-06-19, round 2) was REMOVED on
// 2026-06-20. It persisted the create password in sessionStorage across the iOS
// Drive redirect — but WebKit bounce-tracking clears pre-redirect storage, so it
// never worked on the affected devices AND it stored a secret unnecessarily. The
// create flow now resumes purely via the OAuth `state` param (redirectState.ts)
// and the user re-enters the password ONCE on the resume screen (ADR-026's
// original, honest design). See docs/plans/2026-06-20-ios-oauth-bounce-state-param.md.
