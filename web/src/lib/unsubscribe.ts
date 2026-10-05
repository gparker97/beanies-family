/**
 * One-click unsubscribe confirmation for owner emails.
 *
 * The only code that posts to the unsubscribe endpoint. The request carries no body and no
 * custom headers, so it is a CORS simple request (no preflight). The token lives only in the
 * query string; it is never logged or displayed.
 */
const UNSUBSCRIBE_URL = 'https://api.beanies.family/unsubscribe';

/** Never throws. Returns 'done' only when the endpoint answered 2xx; on failure logs one warning. */
export async function confirmUnsubscribe(token: string): Promise<'done' | 'failed'> {
  // AbortController + setTimeout, not AbortSignal.timeout: Safari 15 (iOS 15, the native app's
  // deployment target) has no AbortSignal.timeout, and calling it would fail before any POST.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${UNSUBSCRIBE_URL}?t=${encodeURIComponent(token)}`, {
      method: 'POST',
      signal: controller.signal,
    });
    if (res.ok) return 'done';
    const hint =
      res.status === 400
        ? 'bad or truncated token (the link was altered or cut off)'
        : res.status === 429
          ? 'route throttle (modules/registry/main.tf)'
          : res.status >= 500
            ? 'server error, check CloudWatch log group /aws/lambda/beanies-family-email-unsubscribe-prod'
            : 'unexpected status';
    console.warn(`[unsubscribe] not confirmed: HTTP ${res.status}, ${hint}`);
  } catch (err) {
    console.warn('[unsubscribe] not confirmed: network error or 6s timeout', err);
  } finally {
    clearTimeout(timer);
  }
  return 'failed';
}
