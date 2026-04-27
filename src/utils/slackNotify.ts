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
 *   - Caller does NOT await — fire-and-forget by design
 *   - Failures land in `console.warn` with the caller's scope tag
 *     (NOT a silent `catch {}`). The reporter's primary value is visibility;
 *     a webhook that fails silently defeats the purpose.
 *   - If the URL is unset/empty, the call is a no-op + warn (so a missing
 *     env-var doesn't masquerade as a working webhook).
 */

export function slackPost(
  url: string | null | undefined,
  payload: { text: string },
  scope = 'slackPost'
): void {
  if (!url) {
    console.warn(`[${scope}] webhook URL not configured — skipping POST`);
    return;
  }
  fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify(payload),
  }).catch((e) => {
    console.warn(`[${scope}] webhook POST failed`, e);
  });
}

/**
 * Convenience wrapper for the legacy general-purpose Slack channel
 * (`VITE_SLACK_WEBHOOK_URL`). Used by CreatePodView for pod-creation
 * telemetry.
 */
export function slackNotify(text: string): void {
  slackPost(import.meta.env.VITE_SLACK_WEBHOOK_URL, { text }, 'slackNotify');
}
