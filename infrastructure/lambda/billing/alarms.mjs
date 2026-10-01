/**
 * Log prefixes that have a CloudWatch metric filter + alarm in `modules/billing/main.tf`.
 *
 * Declared in one place and IMPORTED by the handler, so a test (`__tests__/alarms.test.mjs`)
 * can read the Terraform and assert every prefix appears there verbatim. A drifted prefix then
 * fails CI instead of silently disarming an alarm (the ai-extract `meter.mjs` pattern).
 */
export const WEBHOOK_APPLY_FAILED_PREFIX = '[billing] webhook_apply_failed';
export const UPSTREAM_ERROR_PREFIX = '[billing] billing_upstream_error';

export const ALARMING_PREFIXES = Object.freeze({
  webhookApplyFailed: WEBHOOK_APPLY_FAILED_PREFIX,
  upstreamError: UPSTREAM_ERROR_PREFIX,
});
