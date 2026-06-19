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

/**
 * In-progress create-wizard state persisted across the iOS/native Google
 * redirect so the create flow can RESUME after returning (2026-06-19) instead
 * of falling into the generic recovery screen and re-asking for the password.
 *
 * On iOS/PWA/native, connecting Drive needs a full-page redirect (no popups),
 * which reloads the page and destroys CreatePodView's in-memory state. The
 * owner name is recoverable on return (authStore.displayName / activeFamilyName),
 * so the only genuinely-lost piece is the PASSWORD — kept in a SEPARATE sub-key
 * that is consumed (read-and-deleted) atomically the instant it's used, so the
 * secret's at-rest lifetime is the redirect round-trip only. Same idiom as
 * `RESUME_REASON_KEY` above; sessionStorage is tab-session scoped and cleared
 * on tab close regardless.
 *
 * SECURITY: the password is at rest in sessionStorage only between the redirect
 * and the resume's `consumePendingCreatePassword()`. It is never logged, never
 * sent anywhere, and the create flow already holds the password in page memory
 * during normal (non-redirect) create — so the marginal exposure is the
 * transient sessionStorage copy. greg accepted this tradeoff (2026-06-19) for
 * the smoother no-re-enter UX.
 */
export interface PendingCreate {
  /** Owner display name captured in step 1 (fallback; also recoverable from authStore). */
  ownerName: string;
}
const PENDING_CREATE_KEY = 'beanies:pending-create';
const PENDING_CREATE_PW_KEY = 'beanies:pending-create-pw';

/** Persist the create-wizard marker + password just before the Drive redirect. */
export function savePendingCreate(state: PendingCreate, password: string): void {
  try {
    sessionStorage.setItem(PENDING_CREATE_KEY, JSON.stringify(state));
    sessionStorage.setItem(PENDING_CREATE_PW_KEY, password);
  } catch {
    // sessionStorage unavailable — the resume simply won't fire and the user
    // re-enters their password on the recovery screen (lossless fallback).
  }
}

/** True when a create-wizard resume is pending (marker present). */
export function hasPendingCreate(): boolean {
  try {
    return sessionStorage.getItem(PENDING_CREATE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Read the non-secret create-wizard marker (null if absent/malformed). */
export function loadPendingCreate(): PendingCreate | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CREATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCreate;
    return typeof parsed?.ownerName === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read-AND-DELETE the pending password in one call — the single consume site.
 * Atomic by construction so the at-rest copy is gone before the caller proceeds
 * (no two-step the caller can get wrong). Returns null if absent.
 */
export function consumePendingCreatePassword(): string | null {
  try {
    const pw = sessionStorage.getItem(PENDING_CREATE_PW_KEY);
    if (pw !== null) sessionStorage.removeItem(PENDING_CREATE_PW_KEY);
    return pw;
  } catch {
    return null;
  }
}

/** Wipe ALL pending create state (marker + password). Idempotent. */
export function clearPendingCreate(): void {
  try {
    sessionStorage.removeItem(PENDING_CREATE_KEY);
    sessionStorage.removeItem(PENDING_CREATE_PW_KEY);
  } catch {
    // best-effort
  }
}
