/**
 * Fire-and-forget Slack webhook notification.
 *
 * Enabled only when VITE_SLACK_WEBHOOK_URL is set — leave it blank
 * in dev to disable all Slack notifications silently.
 */
export function slackNotify(text: string): void {
  const url = import.meta.env.VITE_SLACK_WEBHOOK_URL;
  if (!url) return;

  fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify({ text }),
  }).catch(() => {});
}
