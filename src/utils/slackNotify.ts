/**
 * Slack webhook helpers — fire-and-forget POST utilities.
 *
 * Two surfaces:
 *   - `slackPost(url, payload, scope)` — generic; used by `errorReporter`
 *     and any other caller that already has a specific webhook URL.
 *   - `slackNotify(text)` — convenience for the legacy
 *     `VITE_SLACK_WEBHOOK_URL` channel (used by CreatePodView for
 *     pod-creation telemetry). Backward-compatible.
 *
 * Both follow the same contract:
 *   - `mode: 'no-cors'` because Slack webhooks don't allow CORS preflight
 *   - Caller need not await — fire-and-forget by design. The returned promise
 *     never rejects; awaiting it only buys a delivery-outcome signal.
 *   - Failures land in `console.warn` with the caller's scope tag
 *     (NOT a silent `catch {}`). The reporter's primary value is visibility;
 *     a webhook that fails silently defeats the purpose.
 *   - If the URL is unset/empty, the call is a no-op + warn (so a missing
 *     env-var doesn't masquerade as a working webhook).
 */

/**
 * What happened to a `slackPost` call.
 *
 * ⚠️ `dispatched` means the request left the device without a NETWORK-level
 * error — NOT that Slack accepted it. `mode: 'no-cors'` yields an opaque
 * response, so an HTTP 404/410 from a dead or rotated webhook is
 * indistinguishable from a 200 here. Treat it as "we tried and the network
 * didn't refuse", nothing stronger.
 */
export type SlackPostOutcome = 'dispatched' | 'skipped_no_url' | 'network_error';

export interface SlackPostResult {
  outcome: SlackPostOutcome;
  /** Present only for `network_error`. */
  error?: unknown;
}

/**
 * Returns a promise that NEVER rejects — callers that don't care about the
 * outcome (errorReporter, slackNotify) can keep ignoring it exactly as before;
 * callers that must know (feedback, whose payload is stored nowhere else) can
 * await it to emit a delivery-outcome diagnostic.
 */
export function slackPost(
  url: string | null | undefined,
  payload: { text: string },
  scope = 'slackPost'
): Promise<SlackPostResult> {
  if (!url) {
    console.warn(`[${scope}] webhook URL not configured — skipping POST`);
    return Promise.resolve({ outcome: 'skipped_no_url' });
  }
  return fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    // `keepalive` lets the request outlive the page/WebView teardown that
    // immediately follows pod creation. Without it a fire-and-forget POST is
    // aborted mid-flight on the native Capacitor WebView (the view navigates
    // onward before the socket flushes) — which silently dropped new-joiner
    // pings for app users while browser tabs, which keep the request alive
    // longer, delivered fine. See the 2026-07-31 investigation.
    keepalive: true,
    body: JSON.stringify(payload),
  }).then(
    () => ({ outcome: 'dispatched' }) as SlackPostResult,
    (e: unknown) => {
      console.warn(`[${scope}] webhook POST failed`, e);
      return { outcome: 'network_error', error: e } as SlackPostResult;
    }
  );
}

/**
 * Convenience wrapper for the legacy general-purpose Slack channel
 * (`VITE_SLACK_WEBHOOK_URL`). Used by CreatePodView for pod-creation
 * telemetry.
 */
export function slackNotify(text: string): void {
  slackPost(import.meta.env.VITE_SLACK_WEBHOOK_URL, { text }, 'slackNotify');
}
