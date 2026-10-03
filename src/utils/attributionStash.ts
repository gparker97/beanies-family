/**
 * The app's device-side holder for the campaign tag (#118).
 *
 * `main.ts` calls `captureAttributionFromUrl` on EVERY boot, before the router can drop the
 * query: it captures a tag from the landing URL and is also the one place an expired or corrupt
 * envelope is swept off the device (the privacy page says the tag is kept for 30 days). The
 * create flow peeks it (the Plausible `signup` props, the OAuth return path, the registry
 * payload, the Slack line) and clears it once the pod exists. First touch wins for 30 days; the
 * parser, the bounds and the envelope all live in `@beanies/brand/attribution`, shared with the
 * marketing site.
 *
 * Built on `storedJson`, which never throws and already warns with the key, so this module has
 * no try/catch of its own: a refused write or removal comes back as `{ ok: false, error }` and is
 * reported once at `warning`, and the flow proceeds unattributed (a lost tag never blocks a
 * user). A refused READ is folded into `missing` by `storedJson` (with its own warning), which
 * here simply means "no tag".
 *
 * Firehose (`surface: 'attribution'`, existing allowlisted keys only):
 *   - `capture`       action ∈ captured | kept-first-touch | replaced-expired | replaced-corrupt |
 *                     dropped-invalid; `count` = fields kept.
 *   - `field-dropped` `count` = allowlisted keys in the URL whose value failed the rule while
 *                     siblings passed (the `oppref`-shape signal, plan Assumption 10).
 *   - `clear`         action ∈ consumed | sign-out | expired | corrupt | absent; `count` = fields
 *                     removed.
 * `kind` is the tag's source mapped to a closed channel enum, never the raw query value, because
 * `kind` is declared (runbook §1, `diagnosticContext.ts`) as PII-free closed enums.
 */

import {
  ATTRIBUTION_STORAGE_KEY,
  makeEnvelope,
  parseAttributionDetailed,
  readEnvelope,
  type Attribution,
  type AttributionEnvelopeState,
} from '@beanies/brand/attribution';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import { readStoredJson, removeStoredJson, writeStoredJson } from '@/utils/storedJson';

const LABEL = 'attribution';
const SURFACE = 'attribution';

type CaptureAction =
  | 'captured'
  | 'captured-referrer'
  | 'kept-first-touch'
  | 'replaced-expired'
  | 'replaced-corrupt'
  | 'dropped-invalid';

type ClearAction = 'consumed' | 'sign-out' | 'expired' | 'corrupt' | 'absent';

/**
 * The channels we buy or post on. `utm_source` arrives as a bare word (`reddit`), a host
 * (`chatgpt.com`, the value the live OpenAI ads send) or with a `www.` prefix; the normaliser
 * reduces all three to one key. Anything else is `other`.
 */
const SOURCE_CHANNELS = new Set([
  'chatgpt',
  'openai',
  'reddit',
  'pinterest',
  'substack',
  'google',
  'blog',
  'email',
  'producthunt',
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
  'x',
  'twitter',
]);

function channelOf(source: string | undefined): string {
  if (!source) return 'untagged';
  const s = source
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.(com|ai|co|net|org|io)$/, '');
  return SOURCE_CHANNELS.has(s) ? s : 'other';
}

function tagShape(fields: Attribution | null): { kind: string; count: number } {
  return {
    kind: channelOf(fields?.utm_source),
    count: fields ? Object.keys(fields).length : 0,
  };
}

/** Classify the stored envelope. A pure read: never writes, never removes, never logs. */
function readStash(): AttributionEnvelopeState {
  const read = readStoredJson(ATTRIBUTION_STORAGE_KEY, LABEL);
  if (read.kind === 'missing') return { state: 'none' };
  if (read.kind === 'corrupt') return { state: 'corrupt' };
  return readEnvelope(read.value, Date.now());
}

/**
 * One `warning` for a refused attribution write or removal; the flow proceeds unattributed.
 * Exported for the install-referrer marker, the same storage on the same surface.
 */
export function reportStorageFailure(stage: 'write' | 'remove', error: unknown): void {
  reportError({
    surface: SURFACE,
    severity: 'warning',
    message: `attribution ${stage} refused; proceeding unattributed`,
    error,
    context: { action: 'storage-failed', stage },
  });
}

function logCapture(action: CaptureAction, fields: Attribution | null): void {
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'capture',
    context: { action, ...tagShape(fields) },
  });
}

/**
 * Remove the envelope and log the decision. A refused removal reports one warning and logs
 * no `clear`, so the firehose never claims a removal that did not happen.
 */
function removeAndLog(action: ClearAction, fields: Attribution | null): void {
  const removed = removeStoredJson(ATTRIBUTION_STORAGE_KEY, LABEL);
  if (!removed.ok) {
    reportStorageFailure('remove', removed.error);
    return;
  }
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'clear',
    context: { action, ...tagShape(fields) },
  });
}

/**
 * Per-boot entry point. Captures the tag from a landing URL and sweeps a dead envelope.
 *
 *   - Tagged URL: an unexpired stored tag is kept (first touch); an expired or corrupt one is
 *     replaced. One `capture` event, plus `field-dropped` when some keys failed the rule.
 *   - Untagged URL (the healthy case on every boot): no event, unless an expired or corrupt
 *     envelope is found, which is removed with a `clear expired|corrupt` event.
 *
 * `via: 'referrer'` is the Android Play install referrer, which is a query string too; it
 * differs only in the `captured-referrer` action, so the firehose tells the two apart.
 * On a native build the landing URL has no query, so `via: 'url'` there only sweeps.
 */
export function captureAttributionFromUrl(
  search: string = window.location.search,
  via: 'url' | 'referrer' = 'url'
): void {
  const { fields, present } = parseAttributionDetailed(search);
  const existing = readStash();

  if (present === 0) {
    if (existing.state === 'expired' || existing.state === 'corrupt') {
      removeAndLog(existing.state, null);
    }
    return;
  }
  if (!fields) {
    logCapture('dropped-invalid', null);
    return;
  }
  const dropped = present - Object.keys(fields).length;
  if (dropped > 0) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'field-dropped',
      context: { action: 'field-dropped', kind: channelOf(fields.utm_source), count: dropped },
    });
  }
  if (existing.state === 'ok') {
    logCapture('kept-first-touch', fields);
    return;
  }

  const write = writeStoredJson(ATTRIBUTION_STORAGE_KEY, makeEnvelope(fields, Date.now()), LABEL);
  if (!write.ok) {
    reportStorageFailure('write', write.error);
    return;
  }
  const action: CaptureAction =
    existing.state === 'expired'
      ? 'replaced-expired'
      : existing.state === 'corrupt'
        ? 'replaced-corrupt'
        : via === 'referrer'
          ? 'captured-referrer'
          : 'captured';
  logCapture(action, fields);
}

/**
 * The stored tag, or `null` when there is none, it expired or it is unreadable. A pure read
 * with no event and no side effect: it runs several times per create, and expiry is reported
 * by the per-boot sweep in `captureAttributionFromUrl`.
 */
export function peekAttribution(): Attribution | null {
  const stash = readStash();
  return stash.state === 'ok' ? stash.fields : null;
}

/**
 * Remove whatever envelope is stored. `consumed` after a pod is created (Slack and registry
 * done); `sign-out` from the tier-3 "Clear data" sign-out only. The event's action is the
 * reason when a live tag was removed, the envelope's state when a dead one was, and `absent`
 * when there was nothing to remove.
 */
export function clearAttribution(reason: 'consumed' | 'sign-out'): void {
  const stash = readStash();
  if (stash.state === 'none') {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'clear',
      context: { action: 'absent', ...tagShape(null) },
    });
    return;
  }
  removeAndLog(
    stash.state === 'ok' ? reason : stash.state,
    stash.state === 'ok' ? stash.fields : null
  );
}
