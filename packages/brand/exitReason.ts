/**
 * The "why are you leaving?" survey a family answers before deleting itself, shared by the app
 * and (as a twin) the registry Lambda.
 *
 * The id rides the registry DELETE as `?reason=<id>` and is the only part that reaches the
 * firehose / CloudWatch. The label (the Slack string) and the free text (`reasonText`, allowed
 * only for the ids in `EXIT_REASON_TEXT_IDS`) go to the #beanies-leavers line and nowhere else.
 *
 * ⚠️ EVERY EXPORT HERE HAS A TWIN in `infrastructure/lambda/registry/index.mjs` that cannot
 * import it (a Lambda is its own zip). Change a value here AND there, in this exact order;
 * `src/utils/__tests__/attributionTwinDrift.test.ts` fails if they drift (the data by value,
 * the sanitiser by a shared table).
 *
 * Pure: no DOM, no storage, never throws.
 */

export const EXIT_REASON_IDS = [
  'missing_feature',
  'design_layout',
  'too_slow',
  'no_google_drive',
  'too_complicated',
  'privacy_concerns',
  'switched_app',
  'just_trying',
  'other',
] as const;

export type ExitReasonId = (typeof EXIT_REASON_IDS)[number];

/** The ids whose free text is sent (and required by the survey). */
export const EXIT_REASON_TEXT_IDS = ['missing_feature', 'other'] as const;

/** Stable English Slack labels: these are what the #beanies-leavers line prints, never the UI copy. */
export const EXIT_REASON_LABELS: Readonly<Record<ExitReasonId, string>> = {
  missing_feature: 'Missing a feature',
  design_layout: 'Design or layout',
  too_slow: 'Too slow',
  no_google_drive: 'No Google Drive',
  too_complicated: 'Too complicated',
  privacy_concerns: 'Privacy concerns',
  switched_app: 'Switched to another app',
  just_trying: 'Was just trying it',
  other: 'Something else',
};

/** Free-text cap, in CODE POINTS (so the cap never splits a surrogate pair). */
export const EXIT_REASON_TEXT_MAX = 200;

/**
 * C0/C1 control characters plus the bidi overrides and isolates (U+202A–U+202E, U+2066–U+2069).
 * Deliberately NOT all of `\p{Cf}`: that would strip U+200D and break the ZWJ family emoji a
 * parent may well type into "something else".
 */
const EXIT_REASON_TEXT_STRIP_RE = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu;

export function isExitReasonId(value: unknown): value is ExitReasonId {
  return typeof value === 'string' && (EXIT_REASON_IDS as readonly string[]).includes(value);
}

export function allowsExitReasonText(id: ExitReasonId): boolean {
  return (EXIT_REASON_TEXT_IDS as readonly string[]).includes(id);
}

/**
 * Strip controls and bidi marks, trim, cap by code point. `''` for anything that is not a
 * string or is empty afterwards. Twin: `sanitiseExitReasonText` in the registry Lambda.
 */
export function sanitiseExitReasonText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(EXIT_REASON_TEXT_STRIP_RE, '').trim();
  return Array.from(cleaned).slice(0, EXIT_REASON_TEXT_MAX).join('');
}

/** The survey's resolved answer: `id` to the registry and the firehose, `text` to Slack only. */
export interface ExitReason {
  id: ExitReasonId;
  text?: string;
}
