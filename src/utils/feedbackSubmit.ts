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
 * response) so client-side delivery confirmation is impossible; the caller shows
 * the thank-you state immediately. A missing webhook is handled BY `slackPost`
 * (no-op + `console.warn`) — not re-checked here. The try/catch below only guards
 * the genuinely-unexpected build/post throw so the user's action is never lost.
 */

import { slackPost } from '@/utils/slackNotify';
import { reportError } from '@/utils/errorReporter';
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
 * Submit feedback to the private `#beanies-feedback` Slack channel. Fire-and-forget;
 * always returns so the caller proceeds to the thank-you state. The missing-URL case
 * is owned by `slackPost` (no-op + warn); this try/catch only covers an unexpected
 * build/post throw (e.g. a store read fault), reported as a warning WITHOUT the raw text.
 */
export function submitFeedback(input: FeedbackInput): void {
  try {
    slackPost(
      import.meta.env.VITE_FEEDBACK_WEBHOOK_URL,
      { text: buildFeedbackText(input) },
      'feedback'
    );
  } catch (err) {
    reportError({
      surface: 'feedback-submit',
      severity: 'warning',
      message: 'feedback text build/post failed',
      error: err,
    });
  }
}
