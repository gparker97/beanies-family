/**
 * Unsubscribe and re-subscribe for owner emails.
 *
 * The only code that posts to the unsubscribe endpoint. Requests carry no body and no custom
 * headers, so they are CORS simple requests (no preflight). The token lives only in the query
 * string; it is never logged or displayed. Every function here never throws, and logs exactly
 * one console.warn per failure.
 */
const UNSUBSCRIBE_URL = 'https://api.beanies.family/unsubscribe';

export type UnsubscribeResult = 'unsubscribed' | 'already' | 'failed';
export type ResubscribeResult = 'resubscribed' | 'failed';

/** POSTs and returns the 2xx body's `status` ('' when absent), or null after one warning. */
async function post(token: string, action: 'resubscribe' | null, what: string) {
  const query = `t=${encodeURIComponent(token)}${action ? `&action=${action}` : ''}`;
  // AbortController + setTimeout, not AbortSignal.timeout: Safari 15 (iOS 15, the native app's
  // deployment target) has no AbortSignal.timeout, and calling it would fail before any POST.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${UNSUBSCRIBE_URL}?${query}`, {
      method: 'POST',
      signal: controller.signal,
    });
    const body: { status?: unknown; error?: unknown } = await res.json().catch(() => ({}));
    if (res.ok) return typeof body.status === 'string' ? body.status : '';
    const hint =
      res.status === 400
        ? body.error === 'bad_action'
          ? 'unknown action (page and Lambda out of step)'
          : 'bad or truncated token (the link was altered or cut off)'
        : res.status === 429
          ? 'route throttle (modules/registry/main.tf)'
          : res.status >= 500
            ? 'server error, check CloudWatch log group /aws/lambda/beanies-family-email-unsubscribe-prod'
            : 'unexpected status';
    console.warn(`[unsubscribe] ${what} not confirmed: HTTP ${res.status}, ${hint}`);
  } catch (err) {
    console.warn(`[unsubscribe] ${what} not confirmed: network error or 6s timeout`, err);
  } finally {
    clearTimeout(timer);
  }
  return null;
}

/** 'already' when the address was unsubscribed before this request; 'failed' on any non-2xx. */
export async function confirmUnsubscribe(token: string): Promise<UnsubscribeResult> {
  const status = await post(token, null, 'unsubscribe');
  if (status === null) return 'failed';
  // A 2xx with no status (a Lambda older than re-subscribe) still recorded the opt-out.
  return status === 'already' ? 'already' : 'unsubscribed';
}

/**
 * Only on an explicit click, never on load. 'not_unsubscribed' (nothing to undo) is still
 * subscribed, so it reads as 'resubscribed'. Any other 2xx body is 'failed': a Lambda that
 * predates re-subscribe ignores `action` and UNSUBSCRIBES, so success must be named explicitly.
 */
export async function resubscribe(token: string): Promise<ResubscribeResult> {
  const status = await post(token, 'resubscribe', 're-subscribe');
  if (status === 'resubscribed' || status === 'not_unsubscribed') return 'resubscribed';
  if (status !== null) {
    console.warn(
      `[unsubscribe] re-subscribe not confirmed: unexpected response status "${status || '(none, a Lambda older than re-subscribe?)'}"`
    );
  }
  return 'failed';
}
