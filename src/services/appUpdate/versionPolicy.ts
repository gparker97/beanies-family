/**
 * The update floor: the version below which beanies asks a person to update.
 *
 * ⚠️ THIS FILE CAN ONLY EVER PRODUCE A PROMPT. There is no path from here to a
 * block, and there must never be one. The file it reads is deployed by hand, so
 * the worst case of getting it wrong has to be an unnecessary but dismissible
 * nag, never a family locked out of their own data. Blocking belongs to
 * `UnsupportedBeanpodVersionError`, which is a fact about the file in front of
 * this device rather than something we typed and deployed. The JSON field is
 * named `promptBelowVersion` for the same reason: `minSupportedVersion` reads
 * like a kill switch, and sooner or later somebody wires one up.
 *
 * ⚠️ `CapacitorHttp`, NEVER `fetch`. The apex serves no CORS headers, and the
 * native WebView origin is `capacitor://app.beanies.family` on iOS and
 * `https://app.beanies.family` on Android, a different host either way. A
 * browser fetch from the app origin to the apex is refused on every device, the
 * fail-open below swallows the refusal, and the whole floor becomes dead code
 * that reports nothing. `CapacitorHttp` runs on the native layer and is not
 * subject to CORS. An eslint zone bans `fetch` in this directory; it catches a
 * bare `fetch`, not `window.fetch` or `globalThis.fetch`, so do not take the
 * rule as total.
 *
 * ⚠️ DO NOT enable the global `CapacitorHttp` patch in `capacitor.config.ts`.
 * Calling it directly is the whole of what this needs; the flag reroutes every
 * request in the app.
 */
import { CapacitorHttp } from '@capacitor/core';
import { MARKETING_URL } from '@/utils/marketing';
import { isComparableVersion } from '@/utils/compareAppVersions';
import { logEvent } from '@/services/telemetry/logEvent';

/** Why the floor could not be read. Rides in `detail`, never the raw error. */
export type FloorFailure =
  'offline' | 'timeout' | `http-${number}` | 'malformed' | 'unparseable-version' | 'unknown';

interface FloorFile {
  promptBelowVersion?: unknown;
}

/**
 * Memoised for the process. The value changes at most on a manual web deploy,
 * so a per-resume fetch would buy nothing and would inflate the `checked` rate
 * that is meant to be one row per launch.
 */
let cached: { value: string | null } | null = null;

/** Test seam only: forget the memo so each case starts clean. */
export function __resetVersionPolicyForTesting(): void {
  cached = null;
}

/**
 * Everything that can stop the update check from reaching an answer.
 *
 * `app-version-unparseable` is the odd one out and is deliberately in the same
 * union: it is not a fact about the floor FILE but about the build reading it,
 * and it belongs to the composable. It lives here so the two sites cannot drift
 * into different spellings of the same CloudWatch filter.
 */
export type UpdateCheckFailure = FloorFailure | 'app-version-unparseable';

/**
 * The one shape of the `check-failed` event, exported so the composable emits
 * it identically. A constant `message` on purpose: `logEvent` rate-limits on
 * (surface, normalized message), so a per-device message would give every
 * failing device its own bucket and defeat the limiter.
 */
export function reportCheckFailure(detail: UpdateCheckFailure): void {
  logEvent({
    level: 'warn',
    surface: 'app-update',
    message: 'update floor unavailable',
    context: { action: 'check-failed', error_code: 'floor', detail },
  });
}

function report(reason: FloorFailure): null {
  reportCheckFailure(reason);
  return null;
}

/**
 * A thrown request, reduced to ONE of the reason classes.
 *
 * ⚠️ THE RAW MESSAGE NEVER SHIPS. It can carry a URL or a platform string, and
 * would give every device its own dedup bucket in the rate limiter.
 *
 * ⚠️ AND AN UNRECOGNISED THROW IS `unknown`, NOT `malformed`. `malformed` means
 * "the JSON we hand-deployed is wrong", which is a person's mistake and a
 * person's fix; a network error wearing that label sends whoever is triaging
 * straight to the wrong file. The platform strings are not ours to predict:
 * iOS surfaces `localizedDescription`, whose timeout reads "The request timed
 * out." (note: "timed out", not "timeout"), and Android surfaces whatever
 * `java.net` threw. So match generously, and when nothing matches, say so.
 */
function classify(e: unknown): FloorFailure {
  // The one throw inside the `try` that is OURS: `JSON.parse` on a string body.
  // It is genuinely a malformed file, so it keeps that class rather than
  // falling through the message matching below.
  if (e instanceof SyntaxError) return 'malformed';
  const msg = e instanceof Error ? e.message.toLowerCase() : '';
  if (!msg) return 'unknown';
  if (/tim(e|ed)\s?out|timeout/.test(msg)) return 'timeout';
  if (/network|internet|connect|offline|unreachable|host|dns|resolve|ssl|certificate/.test(msg)) {
    return 'offline';
  }
  return 'unknown';
}

/**
 * The version below which to prompt, or `null` when we could not tell.
 *
 * Fails open on every error class. That is belt and braces on top of the
 * structural guarantee above, not the primary safety property.
 */
export async function fetchUpdateFloor(): Promise<string | null> {
  if (cached) return cached.value;

  let value: string | null = null;
  try {
    // The device's own HTTP cache is a separate problem from the CDN's: the web
    // deploy sets no `Cache-Control` and the apex default TTL is a day, so a
    // device can serve a day-old floor after the deploy's invalidation has
    // already cleared the edge. An hour bucket gives it a fresh URL hourly.
    //
    // ⚠️ THIS DOES NOT BUST THE EDGE. The apex behaviour sets
    // `forwarded_values { query_string = false }`, so CloudFront does not vary
    // its cache key on this parameter. The deploy's `/*` invalidation is still
    // the only thing that clears the edge. Do not add more parameters chasing
    // edge staleness; they will do nothing.
    const res = await CapacitorHttp.get({
      url: `${MARKETING_URL}/min-app-version.json`,
      params: { h: String(Math.floor(Date.now() / 3_600_000)) },
      connectTimeout: 3_000,
      readTimeout: 3_000,
    });

    if (res.status < 200 || res.status >= 300) {
      return (cached = { value: report(`http-${res.status}` as FloorFailure) }).value;
    }

    // ⚠️ `data` IS ALREADY PARSED when the response is `application/json`,
    // which is what S3 serves for a `.json` key. A naive `JSON.parse(res.data)`
    // would throw on every real device, the catch below would swallow it, and
    // the floor would be permanently dead while looking perfectly healthy.
    const body: FloorFile =
      typeof res.data === 'string' ? (JSON.parse(res.data) as FloorFile) : (res.data as FloorFile);

    const raw = body?.promptBelowVersion;
    if (typeof raw !== 'string') {
      return (cached = { value: report('malformed') }).value;
    }
    if (!isComparableVersion(raw)) {
      return (cached = { value: report('unparseable-version') }).value;
    }
    value = raw.trim();
  } catch (e) {
    return (cached = { value: report(classify(e)) }).value;
  }

  cached = { value };
  return value;
}
