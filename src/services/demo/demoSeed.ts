/**
 * REVIEW-DEMO: seed a complete synthetic family, in memory, with no Google
 * sign-in and no network. TEMPORARY — see the retirement checklist in
 * `docs/runbooks/native-store-submission.md`.
 *
 * This drives the REAL create path, with exactly one piece swapped out: the
 * storage connect (an OS file picker or Drive OAuth, neither of which a reviewer
 * should have to complete) becomes the in-memory provider. Everything after that
 * — envelope build, write, verify, cache, session — is the production code path,
 * so demo mode cannot quietly drift away from what real users get.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   - no remote registry lookup or registration, no Slack ping (suppressed via
 *     `createNewFile`'s `suppressRemoteSideEffects`)
 *   - no Plausible conversion events (suppressed via `withAnalyticsSuppressed`)
 *   - no Drive write, no filesystem `.beanpod` (the memory provider holds bytes
 *     only for this session)
 *
 * WHAT IT DOES WRITE, deliberately: the ordinary LOCAL artifacts of any local
 * session — an IndexedDB family cache + envelope, a cached family key, and a
 * local `userFamilyMappings` row. That is what makes the seeded session behave
 * like a real one. All of it is removed by `signOutAndClearData()`, which is both
 * the failure teardown here and the documented way for a reviewer to exit.
 *
 * CONTROL FLOW: a flat sequence of fallible steps with early returns through one
 * `fail()` helper. No nested try/catch — see the Complexity Guardrails in
 * `docs/plans/2026-08-20-app-review-demo-mode.md`.
 */

import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { setProvider } from '@/services/sync/syncService';
import { createMemoryProvider } from '@/services/sync/providers/memoryProvider';
import { seedDocument } from '@/services/automerge/seedDocument';
import { withAnalyticsSuppressed } from '@/services/analytics/plausible';
import { isReviewDemoAvailable, markDemoSession } from '@/utils/reviewDemo';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import * as perfTiming from '@/utils/perfTiming';
import { materializeFixture } from './demoFixture';
import type { CreatePodFailureReason } from '@/types/sync';

const SURFACE = 'review-demo';

const DEMO_POD_FILE = 'beanies-demo.beanpod';
const DEMO_FAMILY_NAME = 'The Demo Beanies';
const DEMO_OWNER_NAME = 'Alex';
const DEMO_OWNER_EMAIL = 'alex@example.invalid';

/**
 * Deliberately NOT a secret, and deliberately not configurable.
 *
 * It unlocks a pod that exists only in memory, for one session, containing only
 * invented data. There is nothing here to protect, and making it a build secret
 * would imply otherwise. Never reuse this value anywhere else.
 */
const DEMO_PASSWORD = 'demo-pod-not-a-secret';

/**
 * Every distinct way seeding can fail. Closed union: the modal's message lookup
 * ends in `assertNever`, so adding a stage without adding its reviewer-facing
 * string is a compile error rather than a blank toast.
 *
 * `CreatePodFailureReason` is spliced in whole rather than re-enumerated, so
 * `createNewFile`'s own reasons pass straight through to telemetry.
 */
export type DemoSeedErrorCode =
  | 'session-exists'
  | 'not-available'
  | 'provider-install'
  | 'signup'
  | 'fixture-write'
  | CreatePodFailureReason;

export type DemoSeedResult = { ok: true } | { ok: false; code: DemoSeedErrorCode };

/**
 * Seed the demo family and sign in as its owner.
 *
 * Returns a result rather than throwing, matching `createNewFile`'s contract, so
 * the caller branches on a closed union with no unreachable catch.
 */
export async function seedDemoFamily(): Promise<DemoSeedResult> {
  const authStore = useAuthStore();
  const syncStore = useSyncStore();
  const settingsStore = useSettingsStore();

  /** Report, optionally tear down, and shape the failure. The one exit for every failure. */
  async function fail(
    code: DemoSeedErrorCode,
    error?: unknown,
    needsTeardown = true
  ): Promise<DemoSeedResult> {
    reportError({
      surface: SURFACE,
      message:
        `review-demo seed failed at ${code} — check VITE_REVIEW_DEMO / ` +
        'VITE_REVIEW_DEMO_CODE_HASH / VITE_REVIEW_DEMO_EXPIRES on the release lane, ' +
        'and the createMemoryProvider guard in memoryProvider.ts',
      severity: 'critical',
      error: error instanceof Error ? error : error != null ? new Error(String(error)) : undefined,
      context: { action: 'seed-failed', error_code: code },
    });

    if (needsTeardown) {
      // Never leave a half-seeded family behind: a reviewer exploring a broken
      // pod is worse than a clean error with a retry. Its own try/catch so a
      // teardown failure is reported but never masks the original one.
      try {
        await authStore.signOutAndClearData();
      } catch (teardownError) {
        reportError({
          surface: SURFACE,
          message: 'review-demo teardown after a failed seed did not complete',
          severity: 'error',
          error: teardownError instanceof Error ? teardownError : new Error(String(teardownError)),
          context: { action: 'seed-failed', error_code: 'teardown' },
        });
      }
    }

    return { ok: false, code };
  }

  // 0. A session already exists → refuse, and DO NOT tear it down.
  //
  //    `signUp` short-circuits when `currentUser` is set and returns success
  //    having created nothing. Continuing past that would take the EXISTING
  //    family's ids and write the demo fixture into a real family's document.
  //    Refusing is the only safe answer; clearing their data to make room would
  //    turn a confusing state into a destructive one.
  if (authStore.currentUser) {
    return fail('session-exists', undefined, false);
  }

  // 1. Defence in depth behind the UI gate.
  if (!isReviewDemoAvailable()) {
    return fail('not-available', undefined, false);
  }

  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'demo seed started',
    context: { action: 'seed-start' },
  });
  const startedAt = performance.now();

  // 2. Suppress Plausible for the whole seed: `signUp` fires `signup` + `login`,
  //    and a reviewer tap must not land in the conversion funnel.
  return withAnalyticsSuppressed(async () => {
    // 3. Storage: the one step of the real create flow we substitute.
    try {
      setProvider(createMemoryProvider(DEMO_POD_FILE));
    } catch (error) {
      return fail('provider-install', error, false);
    }

    // 4. Identity + owner doc. Non-deferred password: `createNewFile` refuses a
    //    pod whose owner still carries the deferred-password sentinel.
    const signUpResult = await authStore.signUp({
      email: DEMO_OWNER_EMAIL,
      familyName: DEMO_FAMILY_NAME,
      memberName: DEMO_OWNER_NAME,
      password: DEMO_PASSWORD,
      subscribeNewsletter: false,
    });
    if (!signUpResult.success) {
      return fail('signup', new Error(signUpResult.error ?? 'signUp returned success: false'));
    }

    const memberId = authStore.currentUser?.memberId;
    const familyId = authStore.currentUser?.familyId;
    if (!memberId || !familyId) {
      return fail(
        'signup',
        new Error('signUp succeeded but left no memberId/familyId on the session')
      );
    }

    // 5. Build + write the pod, with every remote interaction suppressed.
    const createResult = await syncStore.createNewFile(
      DEMO_POD_FILE,
      DEMO_PASSWORD,
      memberId,
      familyId,
      DEMO_FAMILY_NAME,
      null,
      { suppressRemoteSideEffects: true }
    );
    if (!createResult.ok) {
      return fail(createResult.reason, createResult.error);
    }

    // 6. Fill the pod. One batched worker mutation, then re-derive the stores —
    //    going through the entity stores would fire confetti, ~60 Plausible
    //    events and a balance cascade per record.
    let seeded = 0;
    try {
      seeded = await seedDocument(
        materializeFixture({ today: new Date(), ownerMemberId: memberId })
      );

      // Skip the first-run wizard. `buildOwnerDoc` sets `onboardingCompleted:
      // false` and the real create flow clears it by walking the user through
      // `OnboardingWizard` on /nook — which a reviewer following our instructions
      // would hit instead of the populated family we just built.
      //
      // Done through the settings STORE, not the fixture: the `setSettings`
      // mutation REPLACES the settings singleton wholesale, so seeding a partial
      // settings object would silently drop every other default. `saveSettings`
      // merges.
      //
      // The base currency is deliberately left ALONE. Changing it makes the app
      // fetch live exchange rates from a CDN, which broke the "no network calls"
      // guarantee (caught in the browser walkthrough). The fixture is authored in
      // USD to match the default instead.
      await settingsStore.setOnboardingCompleted(true);

      await syncStore.reloadAllStores();
    } catch (error) {
      return fail('fixture-write', error);
    }

    // `settingsStore` swallows its own write errors into `error.value` rather
    // than throwing, so the try/catch above cannot see a failed settings write.
    // Verify the outcome explicitly — a reviewer stuck on the setup wizard with
    // no error is exactly the kind of silent failure this codebase forbids.
    if (!settingsStore.onboardingCompleted) {
      return fail(
        'fixture-write',
        new Error(
          `demo seed could not clear the first-run wizard (settingsStore.error: ${settingsStore.error ?? 'none'})`
        )
      );
    }

    // 7. Done. Mark the session so the banner shows, and record the outcome on
    //    the SUCCESS path too — an event that only fires on failure can't tell
    //    you the failure rate.
    markDemoSession();
    perfTiming.record('review-demo-seed', performance.now() - startedAt, {
      perf_entity_count: seeded,
    });
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'demo seed completed',
      context: { action: 'seed-complete', provider_type: 'local' },
    });

    return { ok: true };
  });
}
