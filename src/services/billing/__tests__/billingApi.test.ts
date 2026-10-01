/**
 * billingApi (#95 Phase 5): the one `post()` helper's contract: base URL and key, the token in
 * the BODY, and every failure shape mapped to a typed `BillingApiError`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module reads its env at load time and imports are hoisted above the body, so the stubs
// must be hoisted too (a real .env would otherwise win).
vi.hoisted(() => {
  vi.stubEnv('VITE_REGISTRY_API_URL', 'https://api.test');
  vi.stubEnv('VITE_REGISTRY_API_KEY', 'reg-key');
  vi.stubEnv('VITE_BILLING_BASE_URL', '');
});

import { createCheckoutSession, claim, createPortalSession, BillingApiError } from '../billingApi';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const fail = (status: number, body: unknown) =>
  ({ ok: false, status, json: async () => body }) as Response;

describe('billingApi', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts JSON to the registry API with the registry key, the token in the body', async () => {
    fetchMock.mockResolvedValue(ok({ url: 'https://billing.stripe.com/p/x' }));
    const r = await createPortalSession({ familyId: 'f', planToken: 't' });
    expect(r.url).toBe('https://billing.stripe.com/p/x');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/billing/portal-session');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('reg-key');
    expect(JSON.parse(init.body as string)).toEqual({ familyId: 'f', planToken: 't' });
    expect(Object.keys(init.headers as object)).not.toContain('x-plan-token');
  });

  it('createCheckoutSession and claim return the Lambda bodies', async () => {
    fetchMock.mockResolvedValueOnce(ok({ sessionId: 'cs_1', clientSecret: 's' }));
    await expect(
      createCheckoutSession({
        familyId: 'f',
        plan: 'full',
        interval: 'year',
        currency: 'usd',
        theme: 'dark',
      })
    ).resolves.toEqual({ sessionId: 'cs_1', clientSecret: 's' });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).theme).toBe(
      'dark'
    );
    fetchMock.mockResolvedValueOnce(ok({}));
    await expect(claim({ familyId: 'f', sessionId: 'cs_1', clientSecret: 's' })).resolves.toEqual(
      {}
    );
  });

  it('maps a known Lambda code, an unknown one, a 401 and a network failure', async () => {
    fetchMock.mockResolvedValueOnce(fail(409, { error: 'x', code: 'already_subscribed' }));
    await expect(
      claim({ familyId: 'f', sessionId: 'cs', clientSecret: 's' })
    ).rejects.toMatchObject({
      name: 'BillingApiError',
      code: 'already_subscribed',
      httpStatus: 409,
    });
    fetchMock.mockResolvedValueOnce(fail(500, { code: 'something_new' }));
    await expect(
      claim({ familyId: 'f', sessionId: 'cs', clientSecret: 's' })
    ).rejects.toMatchObject({ code: 'unknown', httpStatus: 500 });
    fetchMock.mockResolvedValueOnce(fail(401, {}));
    await expect(
      claim({ familyId: 'f', sessionId: 'cs', clientSecret: 's' })
    ).rejects.toMatchObject({ code: 'unauthorized' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await claim({ familyId: 'f', sessionId: 'cs', clientSecret: 's' }).catch((e) => e);
    expect(err).toBeInstanceOf(BillingApiError);
    expect(err.code).toBe('network');
    expect(err.httpStatus).toBe(0);
  });

  it('tolerates a non-JSON error body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('html');
      },
    } as unknown as Response);
    await expect(
      claim({ familyId: 'f', sessionId: 'cs', clientSecret: 's' })
    ).rejects.toMatchObject({ code: 'unknown', httpStatus: 502 });
  });
});
