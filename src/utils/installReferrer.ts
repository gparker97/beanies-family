/**
 * One-shot read of the Google Play install referrer (Android native only).
 *
 * The Play store link carries the campaign tag as `referrer=utm_source=...`; the referrer is
 * the only place a native install can learn which ad or post sent it, because the WebView has
 * no landing query. It is parsed by the same `captureAttributionFromUrl` as a web landing
 * (first touch, bounds, storage-failure reporting), with `via: 'referrer'` so the firehose
 * logs `captured-referrer`.
 *
 * Marker `beanies:attribution:referrer-read` makes it one-shot. It is set after a definitive
 * answer (absent, organic, stale, no usable tag, a tag now stored) and NOT when the plugin threw:
 * the plugin rejects only on a transient failure (`SERVICE_UNAVAILABLE`, a disconnect), which is
 * retried next launch. A permanent one (`FEATURE_NOT_SUPPORTED` and friends) resolves as "no
 * referrer". Nor is it set when a usable tag was read but no tag is stored afterwards (the stash
 * write was refused): that launch retries too. A launch that finds the marker returns silently,
 * so the firehose carries one definitive event per install, not one per launch.
 *
 * STALE ON UPGRADE. Play keeps the referrer for the life of the install, and a device that
 * took this build as an upgrade has no marker yet, so its first read can return a tag from
 * months ago. Stashing that would make an old ad look like it converted a family today. The
 * referrer is ignored (`referrer-stale`, marker set) when the install began longer ago than
 * the tag's own lifetime (`ATTRIBUTION_TTL_MS`), or when this device already has a signed-in
 * session: an upgrade, or a retry (after a transient failure) that runs once the pod exists.
 * Either way the tag can no longer describe the pod's creation.
 *
 * Google answers `utm_source=google-play&utm_medium=organic` for an untagged install. That is
 * treated as no referrer: capturing it would stamp a non-null attribution on every untagged
 * Android install and make those families permanently uninferable.
 *
 * Firehose (`surface: 'attribution'`, `capture`, existing allowlisted keys only): action ∈
 * referrer-absent | referrer-organic | referrer-stale | referrer-failed (via `reportError`), and
 * the stash's own `captured-referrer` / `kept-first-touch` / `dropped-invalid` /
 * `storage-failed`.
 */

import { ATTRIBUTION_TTL_MS, parseAttribution } from '@beanies/brand/attribution';
import { logEvent } from '@/services/telemetry/logEvent';
import {
  InstallReferrer,
  type InstallReferrerResult,
} from '@/services/native/installReferrerPlugin';
import { hasPersistedSession } from '@/stores/authStore';
import {
  captureAttributionFromUrl,
  peekAttribution,
  reportStorageFailure,
} from '@/utils/attributionStash';
import { reportError } from '@/utils/errorReporter';
import { readStoredJson, writeStoredJson } from '@/utils/storedJson';

const MARKER_KEY = 'beanies:attribution:referrer-read';
const LABEL = 'attribution-referrer';
const SURFACE = 'attribution';

type ReferrerAction = 'referrer-absent' | 'referrer-organic' | 'referrer-stale';

function logAction(action: ReferrerAction): void {
  logEvent({ level: 'info', surface: SURFACE, message: 'capture', context: { action } });
}

function markRead(): void {
  const write = writeStoredJson(MARKER_KEY, { at: Date.now() }, LABEL);
  if (!write.ok) reportStorageFailure('write', write.error);
}

function isGoogleOrganic(referrer: string): boolean {
  const params = new URLSearchParams(referrer);
  return params.get('utm_medium') === 'organic' && params.get('utm_source') === 'google-play';
}

/**
 * Is this referrer too old to stand for a fresh install? See "STALE ON UPGRADE" above. The
 * session check runs whether or not Play gave an install time: one synchronous localStorage
 * read, and a fresh install has no session until someone signs in or creates a pod on it, so a
 * session means an upgrade or a retry that came after the pod (either way, too late).
 */
function isStale(installBeginSeconds: number | undefined): boolean {
  const olderThanTtl =
    !!installBeginSeconds && Date.now() - installBeginSeconds * 1000 > ATTRIBUTION_TTL_MS;
  return olderThanTtl || hasPersistedSession();
}

export async function readInstallReferrerOnce(): Promise<void> {
  // Already answered on an earlier launch: silent, or every Android boot would log forever.
  if (readStoredJson(MARKER_KEY, LABEL).kind === 'ok') return;

  let result: InstallReferrerResult;
  try {
    result = await InstallReferrer.get();
  } catch (error) {
    reportError({
      surface: SURFACE,
      severity: 'warning',
      message: 'install referrer read failed; will retry next launch',
      error,
      context: { action: 'referrer-failed' },
    });
    return;
  }

  const { referrer, installBeginSeconds } = result;
  if (!referrer) {
    logAction('referrer-absent');
  } else if (isGoogleOrganic(referrer)) {
    logAction('referrer-organic');
  } else if (isStale(installBeginSeconds)) {
    logAction('referrer-stale');
  } else {
    // A referrer with no usable tag (no allowlisted key, or every value failed the rule) is
    // definitive. With a usable one, a stored tag afterwards means the write landed or a first
    // touch was already there; none means the write was refused (the stash reported it), so the
    // marker stays unset and the next launch retries.
    const usable = parseAttribution(referrer) !== null;
    captureAttributionFromUrl(referrer, 'referrer');
    if (usable && !peekAttribution()) return;
  }
  markRead();
}
