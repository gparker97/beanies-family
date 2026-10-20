/**
 * The Stripe key the billing capture scripts may use: the SANDBOX secret key, and nothing else.
 *
 * Since the 2026-10-17 live flip, `TF_VAR_stripe_secret_key` in `~/.beanies-tf.env` is the LIVE
 * key, and both capture scripts create and DELETE Stripe objects. So the key is read by its
 * sandbox name and checked by prefix: a live key throws before any request leaves the machine.
 * Unset returns '' so a script can `test.skip` with a hint instead of failing.
 */

import { STRIPE_API_VERSION } from '../../infrastructure/lambda/billing/stripeApi.mjs';

export function sandboxStripeKey(): string {
  const key = process.env.BEANIES_STRIPE_SANDBOX_SECRET_KEY ?? '';
  if (key && !/^(sk|rk)_test_/.test(key)) {
    throw new Error(
      'billing capture scripts are sandbox-only: BEANIES_STRIPE_SANDBOX_SECRET_KEY must be an sk_test_/rk_test_ key (check ~/.beanies-tf.env)'
    );
  }
  return key;
}

/** Headers for a direct Stripe REST call with the sandbox key (the Lambda's pinned API version). */
export function stripeHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
    'Stripe-Version': STRIPE_API_VERSION,
  };
}
