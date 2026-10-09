/**
 * OAuth return paths for the login/load flow.
 *
 * These are the `returnPath`s handed to `startRedirectAuth` (via
 * `syncStore.beginDriveAuthRedirect`) so that, after the user consents and the
 * deep link (native) / callback (web) lands back in the app, `LoginPage`'s
 * resume dispatcher knows what to resume.
 *
 * ALL of them live here, in this dependency-light module, so App.vue / LoginPage /
 * syncStore / tests can import a return path without dragging in the Drive
 * provider + sync graph. (`RESUME_SETUP_PATH` was described here as living in
 * `connectStorage.ts`; it has lived in this file since it moved, and that
 * sentence was stale.)
 *
 * Shared by `LoadPodView` (passes `LOAD_DRIVE_PATH` into the redirect) and
 * `LoginPage` (matches `RESUME_LOAD_DRIVE` to re-open the picker on return).
 */

// `createDriveErrors` is leaf-only by contract (it imports no auth, Drive service, capability or
// reporter module), so this module stays dependency-light, the property its docblock above
// promises.
import {
  classifyCreateDriveFailure,
  isCreateDriveErrorCode,
  type CreateDriveErrorCode,
} from '@/services/sync/createDriveErrors';

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
 * heavy graph.
 *
 * It is also the create flow's WEB Drive-consent return path: on web the page really unloads, so
 * the reload must land on the resume screen. On NATIVE nothing unloads and the seam awaits the
 * round trip in place, so there is no return marker at all (see `connectStorage.createReturnPath`).
 */
export const RESUME_SETUP_PATH = `/welcome?resume=${RESUME_SETUP}`;

/**
 * Whether a raw `location.search` string is the create flow's resume-setup return
 * (`?resume=setup`). For code that runs before the router has resolved the route — App.vue's
 * boot catch uses it to attribute a failed redirect-auth exchange to the create funnel (#128),
 * the create flow being the only owner of that return path.
 */
export function isResumeSetupSearch(search: string): boolean {
  return new URLSearchParams(search).get('resume') === RESUME_SETUP;
}

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
 * Why a create-flow web Drive redirect came back without a grant, carried across the reload to
 * the resume-setup screen (#128). The value is the create registry's own code
 * (`CreateDriveErrorCode`), ONE vocabulary with the rest of the create flow: `ResumePodSetup` shows
 * its registry message in the orange notice with its recoveries, under "Google needs a yes from
 * you" only for the two decision codes (`cancelled`, `consent-denied`). (The old
 * `drive-declined` / `drive-consent` reasons were those two codes under other names.)
 *
 * Two producers write it, with no branches of their own: `OAuthCallbackPage` for every error on
 * the create Drive grant, and App.vue's boot catch through `stashResumeReasonFor`. Read and
 * cleared once by the screen on mount.
 *
 * sessionStorage-backed (survives the full-page OAuth redirect) rather than a URL param, so it
 * doesn't have to thread through the shared `RESUME_SETUP_PATH` redirect. Best-effort: a storage
 * failure just means no hint is shown, and so does a value that is not a registry code (a legacy
 * `drive-declined` / `drive-consent` left in a tab mid-redirect across a deploy is dropped).
 */
const RESUME_REASON_KEY = 'beanies:resume-reason';

export function setResumeReason(code: CreateDriveErrorCode): void {
  try {
    sessionStorage.setItem(RESUME_REASON_KEY, code);
  } catch (e) {
    // sessionStorage unavailable (private mode / disabled) — the hint is
    // best-effort; the recovery screen still works without it.
    console.warn('[resumePaths] sessionStorage write failed; resume reason not stashed', e);
  }
}

/**
 * Classify a failed redirect-auth completion and, ONLY on the create flow's return path
 * (`?resume=setup`), stash the code for the resume screen. Always returns the code, so the caller
 * takes its severity from `CREATE_DRIVE_ERRORS[code]` with no create-specific branch.
 *
 * ⚠️ WEB ONLY. The reload that follows is what needs a stash: the error itself does not survive
 * a page unload, so the hint has to. On NATIVE the awaiting seam receives the error in place and
 * classifies it there — `googleAuth`'s native completion no longer writes here at all, which is
 * what stopped a declined Drive LOAD leaving "allow file access" for the next create screen.
 *
 * ⚠️ THE PATH CHECK IS THE POINT. App.vue's boot catch runs for EVERY Drive grant (reconnect,
 * load, create); stashing for all of them left a reconnect's failure waiting on the next create
 * screen.
 */
export function stashResumeReasonFor(e: unknown): CreateDriveErrorCode {
  const code = classifyCreateDriveFailure(e);
  if (isResumeSetupSearch(window.location.search)) setResumeReason(code);
  return code;
}

export function consumeResumeReason(): CreateDriveErrorCode | null {
  try {
    const v = sessionStorage.getItem(RESUME_REASON_KEY);
    if (v) sessionStorage.removeItem(RESUME_REASON_KEY);
    return isCreateDriveErrorCode(v) ? v : null;
  } catch (e) {
    console.warn('[resumePaths] sessionStorage read failed; no resume reason', e);
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
