/* global process */
/**
 * CloudWatch alarm → Slack (#beanies-errors).
 *
 * WHY A LAMBDA AND NOT A DIRECT SNS SUBSCRIPTION: SNS cannot post to a Slack webhook. An
 * HTTPS subscription sends SNS's own envelope, which Slack rejects (it wants `{"text": …}`),
 * and SNS requires a confirmation handshake that a Slack webhook will never perform. AWS
 * Chatbot is the other option but needs a Slack OAuth workspace install — more setup, and a
 * second integration to maintain, for a job this file does in forty lines.
 *
 * Reuses the SAME `SLACK_ERROR_WEBHOOK_URL` the telemetry Lambda already posts client
 * errors with, so alarms land in the channel greg already watches and there is no new
 * secret to rotate.
 *
 * Deliberately never throws. A failed Slack post must not fail the invocation — SNS would
 * retry, and a flapping alarm would then hammer both SNS and the webhook. The CloudWatch
 * log line is the fallback record.
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_ERROR_WEBHOOK_URL;

/**
 * The webhook is a BEARER CREDENTIAL — anyone holding it can post into #beanies-errors — so
 * it must never reach a log line. It nearly did: `fetch('hooks.slack.com/…')` (a hand-typed
 * value missing its scheme, which is the ordinary way to get this wrong) rejects with
 * `TypeError: Failed to parse URL from hooks.slack.com/services/T000/B000/SECRET`. The
 * message IS the URL, and the catch below logged `err.message`, so the first alarm would
 * have written the whole credential into CloudWatch for the full retention period.
 *
 * Validating up front means a malformed value fails once, loudly, and says nothing secret.
 */
function webhookIsUsable(url) {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Strip anything that looks like the webhook out of text headed for a log. */
function redact(text) {
  const s = String(text ?? '');
  return SLACK_WEBHOOK_URL ? s.split(SLACK_WEBHOOK_URL).join('[redacted-webhook]') : s;
}

/** ALARM is bad news; OK is the recovery. Both are worth seeing — a silent recovery is
 *  how you end up not trusting the alarm next time. */
const EMOJI = { ALARM: '🚨', OK: '✅', INSUFFICIENT_DATA: '❓' };

function formatAlarm(msg) {
  const state = msg.NewStateValue || 'ALARM';
  // Object.hasOwn, not `EMOJI[state] ?? …`: a payload with NewStateValue "toString" would
  // otherwise resolve up the prototype chain and render a function body into the alert.
  const emoji = Object.hasOwn(EMOJI, state) ? EMOJI[state] : '⚠️';
  const name = msg.AlarmName || '(unnamed alarm)';
  const reason = msg.NewStateReason || '';
  const desc = msg.AlarmDescription || '';

  return (
    `${emoji} *beanies infrastructure* — \`${name}\` is *${state}*\n` +
    (desc ? `${desc}\n` : '') +
    (reason ? `_${reason}_` : '')
  );
}

export async function handler(event) {
  if (!webhookIsUsable(SLACK_WEBHOOK_URL)) {
    // Deliberately says WHICH problem it is without echoing the value.
    console.error(
      SLACK_WEBHOOK_URL
        ? '[alarm-slack] SLACK_ERROR_WEBHOOK_URL is not a valid https URL — cannot forward alarm'
        : '[alarm-slack] SLACK_ERROR_WEBHOOK_URL unset — cannot forward alarm'
    );
    return { ok: false };
  }

  const records = Array.isArray(event?.Records) ? event.Records : [];
  if (records.length === 0) {
    console.warn('[alarm-slack] invoked with no SNS records');
    return { ok: true };
  }

  for (const record of records) {
    let text;
    try {
      text = formatAlarm(JSON.parse(record?.Sns?.Message ?? '{}'));
    } catch {
      // Not a CloudWatch alarm payload — forward the raw subject rather than dropping it
      // silently. Something published to this topic and a human should see that.
      const subject = record?.Sns?.Subject || '(no subject)';
      text = `⚠️ *beanies infrastructure* — non-alarm message on the alerts topic: ${subject}`;
    }

    try {
      const res = await fetch(SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        console.error(`[alarm-slack] slack returned HTTP ${res.status}`);
      }
    } catch (err) {
      // Swallowed on purpose — see the header. The log line is the record.
      // Redacted: a URL-parse failure puts the whole webhook in `err.message`.
      console.error('[alarm-slack] failed to post to slack:', redact(err?.message ?? err));
    }
  }

  return { ok: true };
}
