/**
 * The web update runner: "is this build behind, and if so, may it reload now?"
 *
 * `runUpdateCheck` is the ONE entry point, used by `usePwaUpdater` (the while-visible
 * poll, route navigations once behind, a newer-version file) and by the "Update
 * beanies" button (`appUpdateAction.ts`). So the native and `dev` refusals, the
 * single-flight and the input gathering exist exactly once. Stores, the router and
 * logging for the updater live here and nowhere else; the decision is the pure
 * `updatePolicy.decideForce`, the reload is `forcedUpdate.forceUpdate`.
 *
 * Telemetry surface `pwa-updater`: see the Observability Coverage table in
 * `docs/plans/2026-11-11-web-stale-build-and-phone-browser-header.md` (ops repo).
 */
import { logEvent } from '@/services/telemetry';
import { getBuildSha, getBuildTime } from '@/utils/diagnosticContext';
import { useAuthStore } from '@/stores/authStore';
import router from '@/router';
import { shouldShowAppLayout } from '@/utils/appChrome';
import { isInteractiveOAuthPending, isRedirectAuthUnsettled } from '@/services/google/googleAuth';
import { isNative } from '@/services/sync/capabilities';
import { appQuietBlocker } from '@/utils/appQuiet';
import { isPreAuthIdle } from '@/utils/appUpdateSignals';
import { isTextEntryFocused } from '@/utils/isTextEntryFocused';
import { checkBuildFreshness } from '@/utils/buildFreshness';
import {
  decideForce,
  type ForceBlocker,
  type ForceDecision,
  type UpdateScreen,
  type UpdateTrigger,
} from '@/utils/updatePolicy';
import { behindSince, forceUpdate } from '@/utils/forcedUpdate';

export type { UpdateTrigger, UpdateScreen } from '@/utils/updatePolicy';

export type UpdateCheckResult = 'current' | 'unavailable' | 'deferred' | 'reloading' | 'failed';

export const UPDATER_SURFACE = 'pwa-updater';

// ─── Logging ────────────────────────────────────────────────────────────────

/**
 * Distinct `action|detail|error_code` triples already logged this page load. Every
 * poll and navigation re-asks, so an undeduplicated event would be a flood from
 * exactly the devices that are stuck (the pattern in `useAppUpdate.ts`).
 */
const reported = new Set<string>();

export interface UpdaterEvent {
  level: 'info' | 'warn';
  action: string;
  message: string;
  detail?: string;
  errorCode?: string;
  durationMs?: number;
  error?: unknown;
  flush?: boolean;
  /** Default true. `forced`, `applied` and `force-failed` pass false. */
  once?: boolean;
}

export function logUpdaterEvent(ev: UpdaterEvent): void {
  if (ev.once !== false) {
    const key = `${ev.action}|${ev.detail ?? ''}|${ev.errorCode ?? ''}`;
    if (reported.has(key)) return;
    reported.add(key);
  }
  const context: Record<string, unknown> = { action: ev.action };
  if (ev.detail !== undefined) context.detail = ev.detail;
  if (ev.errorCode !== undefined) context.error_code = ev.errorCode;
  if (ev.durationMs !== undefined) context.perf_duration_ms = ev.durationMs;
  logEvent({
    level: ev.level,
    surface: UPDATER_SURFACE,
    message: ev.message,
    context,
    ...(ev.error !== undefined ? { error: ev.error } : {}),
    ...(ev.flush ? { flush: true } : {}),
  });
}

export function logDeferred(blocker: ForceBlocker, screen: UpdateScreen): void {
  logUpdaterEvent({
    level: 'info',
    action: 'deferred',
    message: 'update deferred',
    detail: `blocker=${blocker},screen=${screen}`,
  });
}

/** First 7 characters, the same short sha the welcome gate shows. */
export function sha7(sha: string): string {
  return sha.slice(0, 7);
}

export function errorName(e: unknown): string {
  return e instanceof Error ? e.name : 'unknown';
}

// ─── The service-worker path, without an import cycle ───────────────────────

/**
 * Hooks `usePwaUpdater` installs so the runner can see the SW apply path without
 * importing the composable (which pulls in `virtual:pwa-register/vue`).
 */
export interface SwPathHooks {
  /** The SW path is already reloading the page. */
  isApplying(): boolean;
  /** Apply a WAITING worker now if the app is quiet; true when it started. */
  applyWaitingIfQuiet(): boolean;
}

let swHooks: SwPathHooks | null = null;

export function setSwPathHooks(hooks: SwPathHooks | null): void {
  swHooks = hooks;
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

/** Which screen the person is on, as the policy sees it. */
export function currentUpdateScreen(): UpdateScreen {
  try {
    const auth = useAuthStore();
    if (
      shouldShowAppLayout(router.currentRoute.value, {
        isAuthenticated: auth.isAuthenticated,
        needsPodSetup: auth.needsPodSetup,
      })
    ) {
      return 'shell';
    }
  } catch (e) {
    // Store not ready: 'other' is the screen that never reloads on its own.
    console.warn('[webUpdate] screen unknown (store not ready):', e);
    return 'other';
  }
  return isPreAuthIdle() ? 'landing' : 'other';
}

function authInitialized(): boolean {
  try {
    return useAuthStore().isInitialized;
  } catch (e) {
    console.warn('[webUpdate] auth store not ready:', e);
    return false;
  }
}

interface CheckRequest {
  trigger: UpdateTrigger;
  userRequested: boolean;
}

function decide(
  req: CheckRequest,
  remoteSha: string
): { decision: ForceDecision; screen: UpdateScreen } {
  const screen = currentUpdateScreen();
  const now = Date.now();
  const decision = decideForce({
    authInitialized: authInitialized(),
    screen,
    editing: isTextEntryFocused(),
    hasHash: window.location.hash !== '',
    oauthPending: isInteractiveOAuthPending() || isRedirectAuthUnsettled(),
    swApplying: swHooks?.isApplying() ?? false,
    quietBlocker: appQuietBlocker(),
    trigger: req.trigger,
    behindForMs: now - behindSince(remoteSha, now),
    userRequested: req.userRequested,
  });
  return { decision, screen };
}

// ─── The runner ─────────────────────────────────────────────────────────────

let inFlight: { promise: Promise<UpdateCheckResult>; rank: number } | null = null;

/** How much a request may waive: a tap > a newer-version file > a routine check. */
function rankOf(req: CheckRequest): number {
  if (req.userRequested) return 2;
  return req.trigger === 'newer-file' ? 1 : 0;
}

/**
 * Check freshness and, when behind, force the update if the policy allows.
 *
 * Single-flight: a request that arrives during a check joins it. A MORE permissive
 * request (a tap, or a newer-version file, during a routine poll) that joins a check
 * which deferred runs once more afterwards, because the routine check's blocker may
 * be one the tap or the file waives. Never rejects.
 */
export function runUpdateCheck(opts: {
  trigger: UpdateTrigger;
  userRequested?: boolean;
}): Promise<UpdateCheckResult> {
  const req: CheckRequest = { trigger: opts.trigger, userRequested: opts.userRequested === true };
  const current = inFlight;
  if (current) {
    if (rankOf(req) <= current.rank) return current.promise;
    return current.promise.then((r) => (r === 'deferred' ? runUpdateCheck(req) : r));
  }
  const promise: Promise<UpdateCheckResult> = runOnce(req)
    .catch((e: unknown) => {
      console.warn('[webUpdate] update check threw:', e);
      logUpdaterEvent({
        level: 'warn',
        action: 'check-failed',
        message: 'update check threw',
        errorCode: 'internal',
        detail: `trigger=${req.trigger}`,
        error: e,
      });
      return 'failed' as const;
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
  inFlight = { promise, rank: rankOf(req) };
  return promise;
}

async function runOnce(req: CheckRequest): Promise<UpdateCheckResult> {
  // Native ships its build in the binary (the store is its update path), and a `dev`
  // build has nothing deployed to compare against.
  if (isNative()) return 'unavailable';
  const localSha = getBuildSha();
  if (localSha === 'dev') return 'unavailable';

  const freshness = await checkBuildFreshness({ sha: localSha, builtAt: getBuildTime() });
  if (freshness.kind === 'unavailable') {
    // Offline is not a failure: the app carries on with the cached build.
    if (freshness.reason !== 'offline') {
      logUpdaterEvent({
        level: 'warn',
        action: 'check-failed',
        message: 'freshness check failed',
        errorCode: freshness.reason,
        detail: `trigger=${req.trigger}`,
      });
    }
    return 'unavailable';
  }

  logUpdaterEvent({
    level: 'info',
    action: 'checked',
    message: 'freshness checked',
    detail: `outcome=${freshness.kind},trigger=${req.trigger},screen=${currentUpdateScreen()}`,
  });
  if (freshness.kind === 'current') return 'current';

  const to = freshness.remoteSha;
  // NOTE: never `await whenRedirectAuthSettled()` here. That call STARTS the memoised
  // one-time code exchange if nobody has yet, and a boot-time poll on a behind build
  // could beat App.vue's boot owner to it (before the family id and the account
  // assertion exist). The updater only LOOKS (`isRedirectAuthUnsettled`), and the
  // policy defers on `oauth`; the idle edge, the next poll or a navigation asks again.
  const first = decide(req, to);
  if (!first.decision.force) {
    logDeferred(first.decision.blocker, first.screen);
    return 'deferred';
  }

  // A worker already waiting and the app quiet: today's route (the SW path) applies
  // it instead of forcing. It then reports `applying` itself.
  if (swHooks?.applyWaitingIfQuiet()) return 'reloading';

  const result = await forceUpdate({ from: localSha, to, userRequested: req.userRequested }, () => {
    // Re-check at the last moment, then log. `forced` is logged only for a force
    // that is about to start, and flushed so it survives the reload.
    const again = decide(req, to);
    if (!again.decision.force) {
      logDeferred(again.decision.blocker, again.screen);
      return false;
    }
    logUpdaterEvent({
      level: 'warn',
      action: 'forced',
      message: 'forcing update',
      detail: `trigger=${req.trigger},screen=${again.screen},to=${sha7(to)},user=${req.userRequested}`,
      flush: true,
      once: false,
    });
    return true;
  });

  switch (result.outcome) {
    case 'reloading':
      return 'reloading';
    case 'aborted':
      return 'deferred';
    case 'suppressed':
    case 'storage':
    case 'busy':
      logUpdaterEvent({
        level: 'warn',
        action: 'force-suppressed',
        message: 'forced update refused by its guard',
        detail: `to=${sha7(to)}`,
        errorCode: result.outcome === 'suppressed' ? 'once-per-sha' : result.outcome,
      });
      return 'deferred';
    case 'failed':
      console.warn('[webUpdate] forced reload could not start:', result.error);
      logUpdaterEvent({
        level: 'warn',
        action: 'force-failed',
        message: 'forced reload could not start',
        detail: `to=${sha7(to)},from=${sha7(localSha)}`,
        errorCode: errorName(result.error),
        error: result.error,
        once: false,
      });
      return 'failed';
  }
}

/** Test-only: module state otherwise resets only on a full document load. */
export function __resetWebUpdateForTesting(): void {
  reported.clear();
  inFlight = null;
  swHooks = null;
}
