/**
 * Is this web build behind the one that is deployed?
 *
 * Fetches the same-origin `/version.json` that every build emits (`vite.config.ts`,
 * `emitVersionJson`) and `deploy.yml` uploads LAST with no-cache headers. It is kept
 * out of the service-worker precache, and `cache: 'no-store'` keeps the HTTP cache
 * out of it too, so the answer comes from the network or not at all.
 *
 * PURE: no Vue, no stores, no telemetry (the import rule in the plan: telemetry ->
 * diagnosticContext -> syncStore is a cycle, see `hardReload.ts`). The caller passes
 * this build's identity in and logs from the returned outcome. Never throws.
 *
 * Deliberately NOT `min-app-version.json`: that is a hand-raised native floor on the
 * marketing origin, fetched with CapacitorHttp. This check is same-origin and
 * sha-based, and runs on web only (the runner, `webUpdate.ts`, refuses native and
 * `dev` builds before calling it).
 */

export type FreshnessUnavailableReason = 'offline' | 'http' | 'timeout' | 'shape' | 'network';

export type FreshnessOutcome =
  | { kind: 'current' }
  | { kind: 'behind'; remoteSha: string }
  | { kind: 'unavailable'; reason: FreshnessUnavailableReason };

export const VERSION_JSON_PATH = '/version.json';
export const FRESHNESS_TIMEOUT_MS = 5000;

interface RemoteVersion {
  sha: string;
  builtAt: number;
}

/**
 * The shape check is load-bearing, not tidiness: CloudFront answers a MISSING file
 * with `index.html` and status 200, so "it parsed and the request succeeded" proves
 * nothing. Only `{ sha: <non-empty string>, builtAt: <parseable date> }` counts.
 */
function parseRemote(body: unknown): RemoteVersion | null {
  if (!body || typeof body !== 'object') return null;
  const { sha, builtAt } = body as { sha?: unknown; builtAt?: unknown };
  if (typeof sha !== 'string' || sha.length === 0) return null;
  if (typeof builtAt !== 'string') return null;
  const t = Date.parse(builtAt);
  if (!Number.isFinite(t)) return null;
  return { sha, builtAt: t };
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export async function checkBuildFreshness(local: {
  sha: string;
  builtAt: string | null;
}): Promise<FreshnessOutcome> {
  if (isOffline()) return { kind: 'unavailable', reason: 'offline' };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller?.abort();
  }, FRESHNESS_TIMEOUT_MS);

  let body: unknown;
  try {
    const res = await fetch(VERSION_JSON_PATH, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller?.signal,
    });
    if (!res.ok) return { kind: 'unavailable', reason: 'http' };
    try {
      body = await res.json();
    } catch (e) {
      // An HTML body (CloudFront's SPA fallback) or truncated JSON. A timeout that
      // lands mid-body aborts the read too, so classify that first.
      if (timedOut) return { kind: 'unavailable', reason: 'timeout' };
      console.warn('[buildFreshness] version.json is not JSON:', e);
      return { kind: 'unavailable', reason: 'shape' };
    }
  } catch (e) {
    if (timedOut) return { kind: 'unavailable', reason: 'timeout' };
    // The connection dropped while the request was in flight.
    if (isOffline()) return { kind: 'unavailable', reason: 'offline' };
    console.warn('[buildFreshness] version.json fetch failed:', e);
    return { kind: 'unavailable', reason: 'network' };
  } finally {
    clearTimeout(timer);
  }

  const remote = parseRemote(body);
  if (!remote) return { kind: 'unavailable', reason: 'shape' };
  if (remote.sha === local.sha) return { kind: 'current' };

  // A different sha alone is not "behind": a rollback deploys an OLDER build, and a
  // tab already on the newer one must not be forced back. Only a strictly later
  // remote build counts. With no local build time to compare, nothing can be proven,
  // so the answer is the safe one (no reload).
  const localBuiltAt = local.builtAt === null ? NaN : Date.parse(local.builtAt);
  if (!Number.isFinite(localBuiltAt)) return { kind: 'current' };
  return remote.builtAt > localBuiltAt
    ? { kind: 'behind', remoteSha: remote.sha }
    : { kind: 'current' };
}
