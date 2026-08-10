/**
 * #45 — in-app feedback / NPS submission.
 *
 * Feedback is the NON-coding path: it goes to its OWN private Slack channel via
 * `slackPost` (+ `VITE_FEEDBACK_WEBHOOK_URL`), never through `reportError`/telemetry
 * — the raw free-text is exactly the user-typed content the diagnostics allowlist
 * exists to keep OUT. Diagnostic extras (app version, platform, family_id) are read
 * directly and appended to the Slack text body, NOT passed as an allowlisted context.
 *
 * Delivery is optimistic + fire-and-forget: `slackPost` is `no-cors` (opaque
 * response) so confirming Slack ACCEPTED the payload is impossible client-side;
 * the caller shows the thank-you state immediately.
 *
 * Every submission emits exactly one outcome event to CloudWatch (see
 * `recordOutcome`). That is not decoration: between 2026-07-09 and 2026-08-10 the
 * mobile build lanes never set `VITE_FEEDBACK_WEBHOOK_URL`, so every Android and
 * iOS submission called `slackPost(undefined, …)` and was discarded behind a
 * thank-you screen — invisible from both ends, and unquantifiable afterwards
 * precisely because this path emitted nothing on success or failure.
 */

import { slackPost } from '@/utils/slackNotify';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import { getFullVersionLabel } from '@/utils/diagnosticContext';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { npsBand } from '@/utils/feedbackCadence';

export interface FeedbackInput {
  score: number; // 0–10 NPS
  answer?: string; // optional adaptive free-text
  contactName?: string; // optional, reply-only
  contactEmail?: string; // optional, reply-only
  anonymous?: boolean; // when true, omit the family name + id (nothing identifying)
}

/** Best-effort family identity for correlation. Never throws. */
function readFamily(): { id: string | null; name: string | null } {
  try {
    const ctx = useFamilyContextStore();
    return { id: ctx.activeFamilyId ?? null, name: ctx.activeFamilyName ?? null };
  } catch {
    return { id: null, name: null };
  }
}

/**
 * Pure formatter → the Slack `text` body. No financial data. By default the
 * family name + id are attached so the team can follow up; when `anonymous` is
 * set, nothing identifying (name or id) is included. Contact fields only appear
 * if the user provided them.
 */
export function buildFeedbackText(input: FeedbackInput): string {
  const band = npsBand(input.score);
  const answer = input.answer?.trim();
  const name = input.contactName?.trim();
  const email = input.contactEmail?.trim();
  const platform =
    typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : 'unknown';
  const family = input.anonymous ? { id: null, name: null } : readFamily();

  const lines = [
    `📣 *New beanies.family feedback*`,
    `*NPS:* ${input.score}/10 (${band})`,
    `*Comment:* ${answer || '—'}`,
  ];
  lines.push(`*From:* ${input.anonymous ? '(anonymous)' : (family.name ?? '(unknown family)')}`);
  if (name || email) {
    lines.push(`*Reply to:* ${[name, email].filter(Boolean).join(' · ')}`);
  }
  lines.push(
    `_${getFullVersionLabel()} · ${platform}${family.id ? ` · family ${family.id}` : ''}_`
  );
  return lines.join('\n');
}

/**
 * Diagnostic surface for the whole feedback delivery path. One CloudWatch filter
 * (`surface = "feedback-submit"`) isolates every submission; `action` carries the
 * outcome, so a rate is measurable ("what share of submissions dropped?") rather
 * than only failures being visible.
 *
 * `action` is already in `ALLOWED_CONTEXT_KEYS`, so this adds no new field to the
 * firehose — no allowlist widening, no Lambda mirror, no store-declaration change.
 * The NPS score and comment are deliberately NOT logged: they are the user-typed
 * content the allowlist exists to keep out. They ride the Slack path only.
 */
const SURFACE = 'feedback-submit';

/** Outcome vocabulary — fixed enum, greppable, safe for the `action` key. */
type FeedbackOutcome = 'dispatched' | 'dropped_no_webhook' | 'network_error' | 'build_error';

/**
 * Record the outcome of one submission. Every path lands here exactly once.
 *
 * Any outcome other than `dispatched` is UNRECOVERABLE DATA LOSS — feedback is
 * stored nowhere else and the user has already been shown a thank-you — so it
 * pages `#beanies-errors` via `reportError({ severity: 'critical' })`. That path
 * uses a DIFFERENT webhook (`VITE_BEANIES_ERROR_WEBHOOK_URL`), which is what
 * makes it able to report a missing/broken feedback webhook at all. `reportError`
 * does not toast, so the user's thank-you screen is unaffected.
 */
function recordOutcome(outcome: FeedbackOutcome, error?: unknown): void {
  if (outcome === 'dispatched') {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'feedback dispatched to slack',
      context: { action: outcome },
      // The prompt often fires as someone is putting the app down; flush so the
      // event survives a background-then-force-quit.
      flush: true,
    });
    return;
  }

  const message =
    outcome === 'dropped_no_webhook'
      ? 'feedback DISCARDED — VITE_FEEDBACK_WEBHOOK_URL is not configured in this build'
      : outcome === 'network_error'
        ? 'feedback POST failed at the network layer — submission lost'
        : 'feedback text build/post threw — submission lost';

  reportError({
    surface: SURFACE,
    severity: 'critical',
    message,
    error,
    context: { action: outcome },
  });
}

/**
 * Submit feedback to the private `#beanies-feedback` Slack channel. Fire-and-forget
 * from the caller's perspective — returns synchronously so the UI proceeds straight
 * to the thank-you state; the delivery outcome is recorded asynchronously.
 *
 * ⚠️ `dispatched` is the honest ceiling: `slackPost` is `no-cors`, so an opaque
 * response cannot distinguish a 200 from a 404 on a rotated webhook. This logging
 * proves the request left the device — it cannot prove Slack accepted it. To close
 * that last gap you'd need a server-side relay, which is a separate decision.
 */
export function submitFeedback(input: FeedbackInput): void {
  try {
    void slackPost(
      import.meta.env.VITE_FEEDBACK_WEBHOOK_URL,
      { text: buildFeedbackText(input) },
      'feedback'
    ).then(
      (result) =>
        recordOutcome(
          result.outcome === 'skipped_no_url'
            ? 'dropped_no_webhook'
            : result.outcome === 'network_error'
              ? 'network_error'
              : 'dispatched',
          result.error
        ),
      // slackPost's promise never rejects; this is belt-and-braces so a future
      // change there can't turn a lost submission into an unhandled rejection.
      (err: unknown) => recordOutcome('network_error', err)
    );
  } catch (err) {
    recordOutcome('build_error', err);
  }
}
