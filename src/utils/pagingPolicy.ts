/**
 * Slack paging policy, the client half.
 *
 * `#beanies-errors` pages a human when and only when an event reaches the telemetry Lambda at
 * `severity: 'critical'` AND its `surface` is on the Lambda's `SLACK_ESCALATE_SURFACES`. This
 * module is the typed mirror of that set, so the compiler can refuse a `critical` on a surface
 * the server would never page for. `telemetryAllowlistDrift.test.ts` asserts the two sets are
 * equal, and `pagingPolicy.test.ts` pins the reviewed list with an inline snapshot. Adding a
 * paging surface is therefore a reviewed diff here plus the Lambda set, never a one-line
 * `severity: 'critical'` somewhere in the app.
 *
 * The paging bar: a user's data is at risk, a user journey failed and will not recover by
 * itself, or a security control failed. A recoverable transient, a user-environment condition
 * (popup blocked, offline, a full Drive) or a guard refusing safely is `degraded` and never pages;
 * it stays in CloudWatch by rate.
 *
 * Three ways in, all typed against `PagingSurface`:
 *  - a literal `reportError({ severity: 'critical', surface: '…' })`, checked by the compiler;
 *  - `showToast(…, { critical: true, surface })`, checked the same way;
 *  - a registry entry's `impact` (join flow, pod access, create-flow Drive), paired with its
 *    surface by `severityFor` below, which is checked by the registry table test and by the
 *    runtime fallback.
 *
 * ⚠️ LEAF MODULE. Types and one pure function: no imports from `@/stores` or `@/services`.
 * `structuredError.ts` (reached by `syncStore` through `podAccess.ts`) imports the `Impact` type
 * from here, so one store import would put every registry in a cycle.
 *
 * ⚠️ `severityFor` IS THE ONLY NARROWING TO `PagingSurface`. It narrows by an own-property
 * membership check, never by a cast: a type assertion to `PagingSurface` anywhere in `src/` is a
 * review failure (the plan's acceptance grep checks for one).
 */

/** How bad one instance of a failure is for the person using the app. */
export type Impact = 'data-at-risk' | 'journey-blocked' | 'security' | 'degraded';

/**
 * Every surface that may page, with the impact it pages for and why. The keys are the policy;
 * `impact` and `why` are the review record. Keep this in step with `SLACK_ESCALATE_SURFACES` in
 * `infrastructure/lambda/telemetry/index.mjs` (the drift test fails otherwise).
 */
export const PAGING_SURFACES = {
  // ── Boot and render ──────────────────────────────────────────────────────
  'boot-integrity': {
    impact: 'security',
    why: 'a dev build is serving on a cloud host: wrong config shipped to real users',
  },
  'vue-render': {
    impact: 'journey-blocked',
    why: 'a component failed in setup, render, update or a lifecycle hook: a blank surface',
  },
  'app.loadFamilyData.replaceLoopDetected': {
    impact: 'data-at-risk',
    why: 'the family doc is being replaced in a loop: local edits can be overwritten',
  },
  'app.postInitNoData': {
    impact: 'journey-blocked',
    why: 'init finished with no family data: the app is empty for a signed-in family',
  },
  'app.chunkRecoveryFailed': {
    impact: 'journey-blocked',
    why: 'a code chunk failed to load and the reload recovery failed too',
  },
  'app.onboardingStallTimeout': {
    impact: 'journey-blocked',
    why: 'init still stalled 60 s after the watchdog while the page was visible',
  },
  'app.redirectAuthCompletion': {
    impact: 'journey-blocked',
    why: 'the redirect-transport Drive code exchange failed: the same blocked create as connectDrive',
  },
  'wrapAsync:engine-panic': {
    impact: 'data-at-risk',
    why: 'the document engine panicked: writes after this point may not persist',
  },
  // ── Pod load, sync and storage ───────────────────────────────────────────
  'pod-access': {
    impact: 'data-at-risk',
    why: 'per-code via POD_ACCESS_ERRORS; pages only for a non-degraded code such as a non-canonical pod',
  },
  'pod-load-failure': {
    impact: 'journey-blocked',
    why: 'the family file could not be loaded: the family cannot open their pod',
  },
  'pod-lineage': {
    impact: 'data-at-risk',
    why: 'the file on Drive is from an unrelated lineage: merging it would lose data',
  },
  'pod-merge': { impact: 'data-at-risk', why: 'an actor collision corrupted the merge' },
  'pod-compaction': {
    impact: 'data-at-risk',
    why: 'compaction failed part-way: the pod history may be inconsistent',
  },
  'sync-envelope': {
    impact: 'security',
    why: 'the key envelope could not be written: members can lose access to the family key',
  },
  'storage-migration-failed': {
    impact: 'data-at-risk',
    why: 'moving the family file to new storage failed mid-way',
  },
  'cache-replay': {
    impact: 'data-at-risk',
    why: 'cached edits were dropped on replay and exist nowhere else',
  },
  'offline-queue-flush': {
    impact: 'data-at-risk',
    why: 'queued offline changes failed to flush past the sustained threshold: edits are stuck',
  },
  'syncStore.deferredHashLeak': {
    impact: 'security',
    why: 'a deferred password hash leaked into the saved doc',
  },
  registry: {
    impact: 'data-at-risk',
    why: 'the registry row survived a family deletion: the family is half-deleted',
  },
  // ── Create a pod ─────────────────────────────────────────────────────────
  'createPod.connectDrive': {
    impact: 'journey-blocked',
    why: 'per-code via CREATE_DRIVE_ERRORS: Drive API disabled or an unknown connect failure',
  },
  'createPod.adoptExisting': {
    impact: 'journey-blocked',
    why: 'adopting an existing pod during create failed',
  },
  'createPod.handOff': {
    impact: 'journey-blocked',
    why: 'the create flow handed off with no authenticated owner',
  },
  'resumeSetup.connectDrive': {
    impact: 'journey-blocked',
    why: 'per-code via CREATE_DRIVE_ERRORS on the resume screen',
  },
  'resumeSetup.probeDriveAuth': {
    impact: 'journey-blocked',
    why: 'per-code via CREATE_DRIVE_ERRORS on the resume auth probe',
  },
  'resumeSetup.write': {
    impact: 'journey-blocked',
    why: 'the pod write failed after a successful connect (per-code, and createNewFile `write`)',
  },
  'resumeSetup.verify': { impact: 'journey-blocked', why: 'createNewFile failed at verify' },
  'resumeSetup.persist': { impact: 'journey-blocked', why: 'createNewFile failed at persist' },
  'resumeSetup.register': { impact: 'journey-blocked', why: 'createNewFile failed at register' },
  'resumeSetup.precondition': {
    impact: 'journey-blocked',
    why: 'createNewFile failed its precondition',
  },
  'resumeSetup.concurrent-write': {
    impact: 'journey-blocked',
    why: 'createNewFile lost a concurrent write',
  },
  'resumeSetup.finalize': {
    impact: 'journey-blocked',
    why: 'the resumed create could not finalize',
  },
  'resumeSetup.adoptExisting': {
    impact: 'journey-blocked',
    why: 'adopting an existing pod on the resume screen failed',
  },
  'setupProgress.firstSync': {
    impact: 'journey-blocked',
    why: 'the first sync of a new pod failed',
  },
  'setupProgress.unexpected': {
    impact: 'journey-blocked',
    why: 'an unexpected failure in the setup progress flow',
  },
  // ── Join a pod ───────────────────────────────────────────────────────────
  'join-flow:FILE_DECRYPT_FAILED': {
    impact: 'data-at-risk',
    why: 'the joiner could not decrypt the family file',
  },
  'join-flow:FILE_CORRUPT': { impact: 'data-at-risk', why: 'the family file is corrupt' },
  'join-flow:FILE_TOO_LARGE': {
    impact: 'data-at-risk',
    why: 'the family file is too large to open',
  },
  'join-flow:FILE_READ_FAILED': {
    impact: 'data-at-risk',
    why: 'the family file could not be read',
  },
  // ── Auth and credentials ─────────────────────────────────────────────────
  'login-flow': {
    impact: 'journey-blocked',
    why: 'pod creation left no owner, or sign-out could not clear local data',
  },
  'change-password': {
    impact: 'security',
    why: 'a credential rotation could not roll back: the password may be half-rotated',
  },
  'reset-member-password': {
    impact: 'security',
    why: 'a member password reset could not roll back',
  },
  'signin-heal': { impact: 'security', why: 'a sign-in key re-wrap could not roll back' },
  'kdf-upgrade': { impact: 'security', why: 'a KDF upgrade re-wrap could not roll back' },
  'ai-enclave': {
    impact: 'security',
    why: 'the AI enclave failed attestation: data could go to an unverified service',
  },
  // ── Store saves the person just made ─────────────────────────────────────
  'list-copy': { impact: 'data-at-risk', why: 'a list copy failed and the user loses the copy' },
  responsibilities: {
    impact: 'data-at-risk',
    why: 'a responsibilities save or restore failed',
  },
  'statement-import': { impact: 'data-at-risk', why: 'a statement import failed to save' },
  'calendar-import': {
    impact: 'data-at-risk',
    why: 'an unverified calendar import write: events may be missing',
  },
  'photo-upload': { impact: 'data-at-risk', why: 'a photo upload could not be finalized' },
  'recipe-extract': { impact: 'data-at-risk', why: 'a captured recipe could not be saved' },
  'beanie-wall': { impact: 'data-at-risk', why: 'a beanie wall job could not be saved' },
  'recurring-processor': {
    impact: 'data-at-risk',
    why: 'recurring items could not be generated: transactions go missing',
  },
  'quick-add-composer': {
    impact: 'journey-blocked',
    why: 'the composer door is not mounted: every quick-add action fails',
  },
  // ── Integrations and feedback ────────────────────────────────────────────
  'calendar-sync': {
    impact: 'journey-blocked',
    why: 'calendar reconcile failed past the sustained threshold for a non-auth reason',
  },
  'feedback-submit': {
    impact: 'data-at-risk',
    why: 'this build has no feedback webhook: every submission is discarded',
  },
  // ── Billing, demo, delete, export ────────────────────────────────────────
  'billing-ui': {
    impact: 'journey-blocked',
    why: 'a paid plan could not be claimed or managed',
  },
  'review-demo': {
    impact: 'journey-blocked',
    why: 'the App Review demo pod could not be seeded: review is blocked',
  },
  'delete-family': {
    impact: 'data-at-risk',
    why: 'a family deletion stopped part-way',
  },
  'file-delivery': {
    impact: 'data-at-risk',
    why: 'a requested data export could not be delivered (only when the caller marks it critical)',
  },
} as const satisfies Record<string, { impact: Exclude<Impact, 'degraded'>; why: string }>;

/** A surface that may page. */
export type PagingSurface = keyof typeof PAGING_SURFACES;

/**
 * The allowlist membership check, as a type predicate (not a cast). An own-property check rather
 * than a bare `in`, because `in` also walks the prototype: `'constructor' in PAGING_SURFACES` is
 * true, and a surface of that name must not page.
 */
function isPagingSurface(surface: string): surface is PagingSurface {
  return Object.prototype.hasOwnProperty.call(PAGING_SURFACES, surface);
}

/**
 * Pair a surface with the severity its impact earns.
 *
 * `'degraded'` is a `'warning'`. Any other impact is `'critical'` on an allowlisted surface and
 * `'error'` (plus one console warning) on any other: the same gate the Lambda applies, so client
 * and server never disagree about whether an event may page. The registry table test is what
 * keeps the fallback unreachable in practice.
 *
 * The fallback carries `demoted: true`, which `reportError` stamps as `detail: 'paging-demoted'`.
 * A console warning never reaches CloudWatch, so without the stamp a demotion is invisible there.
 */
export function severityFor(
  surface: string,
  impact: Impact
):
  | { severity: 'critical'; surface: PagingSurface }
  | { severity: 'warning'; surface: string }
  | { severity: 'error'; surface: string; demoted: true } {
  if (impact === 'degraded') return { severity: 'warning', surface };
  if (isPagingSurface(surface)) {
    return { severity: 'critical', surface };
  }
  console.warn('[pagingPolicy] non-paging surface asked to page', surface);
  return { severity: 'error', surface, demoted: true as const };
}
