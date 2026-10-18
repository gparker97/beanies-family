import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSubscriptionMessage, familyIdentity, formatMoney, postToSlack } from '../slack.mjs';
import { slackKindFor } from '../index.mjs';

const FAMILY = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-18T00:00:00Z');
const attrs = (over = {}) => ({
  status: 'active',
  plan: 'full',
  interval: 'month',
  currency: 'usd',
  currentPeriodEnd: '2026-11-18T00:00:00.000Z',
  stripeSubscriptionId: 'sub_1',
  cancelAt: null,
  ...over,
});
const sub = (over = {}) => ({
  id: 'sub_1',
  status: 'active',
  items: { data: [{ price: { unit_amount: 999, currency: 'usd' } }] },
  latest_invoice: { id: 'in_1', amount_paid: 799, total: 799, currency: 'usd', status: 'paid' },
  discounts: [
    {
      id: 'di_1',
      source: {
        type: 'coupon',
        coupon: {
          id: 'V1_20',
          name: 'v1 launch',
          percent_off: 20,
          duration: 'repeating',
          duration_in_months: 3,
        },
      },
      promotion_code: { id: 'promo_1', code: 'BEANIEV1' },
    },
  ],
  trial_end: null,
  ...over,
});
const extras = (over = {}) => ({ familyId: FAMILY, familyName: 'The Parkers', now: NOW, ...over });

describe('formatSubscriptionMessage', () => {
  it('created, with a coupon and the promotion code that was entered', () => {
    assert.equal(
      formatSubscriptionMessage('created', attrs(), extras({ sub: sub() })),
      [
        ':tada: *New subscription*',
        '*Family:* The Parkers · id …55555555',
        '*Plan:* magic beans · monthly',
        '*Charged:* USD 7.99',
        '*Discount:* 20% off for 3 months · coupon `V1_20` (v1 launch) · code `BEANIEV1`',
        '*Renews on:* 2026-11-18',
        '*Cohort:* list',
        '*Trial:* no',
      ].join('\n')
    );
  });

  it('cancel_scheduled, no discount, the pre_v1 cohort, SGD yearly basic', () => {
    const text = formatSubscriptionMessage(
      'cancel_scheduled',
      attrs({ plan: 'basic', interval: 'year', cancelAt: '2027-10-18T00:00:00.000Z' }),
      extras({
        cohort: 'pre_v1',
        sub: sub({
          discounts: [],
          latest_invoice: { amount_paid: 2499, total: 2499, currency: 'sgd' },
        }),
      })
    );
    assert.match(text, /^:wave: \*Subscription cancelled, ends 2027-10-18\*\n/);
    assert.match(text, /\*Plan:\* beanies basic · yearly/);
    assert.match(text, /\*Last charged:\* SGD 24\.99/);
    assert.match(text, /\*Discount:\* none/);
    assert.match(text, /\*Paid through:\* 2026-11-18/);
    assert.match(text, /\*Cohort:\* pre_v1/);
  });

  it('ended, when the expanded read failed: unknown charge, today as the end date', () => {
    const text = formatSubscriptionMessage(
      'ended',
      attrs({ status: 'canceled' }),
      extras({ sub: null })
    );
    assert.match(text, /^:no_entry: \*Subscription ended\*\n/);
    assert.match(text, /\*Last charged:\* unknown/);
    assert.match(text, /\*Ended:\* 2026-10-18/);
  });

  it('a trial and an unpaid first invoice: trial line, list price, status line', () => {
    const trialEnd = Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000);
    const text = formatSubscriptionMessage(
      'created',
      attrs({ status: 'trialing' }),
      extras({ sub: sub({ trial_end: trialEnd, latest_invoice: 'in_1', discounts: [] }) })
    );
    assert.match(text, /\*Charged:\* USD 9\.99 \(list\)/);
    assert.match(text, /\*Trial:\* yes, until 2026-11-01/);
    assert.doesNotMatch(text, /\*Status:\*/);

    const incomplete = formatSubscriptionMessage(
      'created',
      attrs({ status: 'incomplete' }),
      extras({
        sub: sub({
          latest_invoice: { amount_paid: 0, total: 799, currency: 'usd', status: 'open' },
        }),
      })
    );
    assert.match(incomplete, /\*Charged:\* USD 0\.00 \(invoice total USD 7\.99, open\)/);
    assert.match(incomplete, /\*Status:\* incomplete$/);
  });

  it('a legacy single `discount` with a fixed amount off and no promotion code', () => {
    const text = formatSubscriptionMessage(
      'created',
      attrs(),
      extras({
        sub: sub({
          discounts: undefined,
          discount: { coupon: { id: 'FIVE', amount_off: 500, currency: 'usd', duration: 'once' } },
        }),
      })
    );
    assert.match(text, /\*Discount:\* USD 5\.00 off once · coupon `FIVE`$/m);
  });

  it('escapes Slack control characters in the family name', () => {
    assert.equal(
      familyIdentity({ familyId: FAMILY, familyName: '<!channel> & co' }),
      '&lt;!channel&gt; &amp; co · id …55555555'
    );
    assert.equal(
      familyIdentity({ familyId: FAMILY, ownerEmail: 'a@b.org' }),
      'owner @b.org · id …55555555'
    );
    assert.equal(familyIdentity({}), 'unnamed family');
  });

  it('formatMoney uppercases and fixes two decimals', () => {
    assert.equal(formatMoney(999, 'usd'), 'USD 9.99');
    assert.equal(formatMoney(0, 'sgd'), 'SGD 0.00');
    assert.equal(formatMoney(undefined, 'usd'), null);
  });
});

describe('slackKindFor', () => {
  const prev = { stripeSubscriptionId: 'sub_1' };
  it('created and deleted always; updated only on the cancel flip of the same, live subscription', () => {
    assert.equal(slackKindFor('customer.subscription.created', attrs(), prev), 'created');
    assert.equal(slackKindFor('customer.subscription.deleted', attrs(), prev), 'ended');
    assert.equal(slackKindFor('customer.subscription.updated', attrs(), prev), null);
    const cancelling = attrs({ cancelAt: '2026-11-18T00:00:00.000Z' });
    assert.equal(
      slackKindFor('customer.subscription.updated', cancelling, prev),
      'cancel_scheduled'
    );
    assert.equal(
      slackKindFor('customer.subscription.updated', cancelling, null),
      'cancel_scheduled'
    );
    assert.equal(
      slackKindFor('customer.subscription.updated', cancelling, { ...prev, cancelAt: 'x' }),
      null
    );
    assert.equal(
      slackKindFor('customer.subscription.updated', cancelling, {
        stripeSubscriptionId: 'sub_0',
        cancelAt: 'x',
      }),
      'cancel_scheduled',
      'a previous subscription’s cancelAt does not count'
    );
    assert.equal(
      slackKindFor('customer.subscription.updated', { ...cancelling, status: 'canceled' }, prev),
      null
    );
  });
});

describe('postToSlack', () => {
  it('never throws: no url, http error, timeout, network', async () => {
    assert.deepEqual(await postToSlack('', 'x'), { ok: false, reason: 'no_url' });
    assert.deepEqual(
      await postToSlack('https://h', 'x', { fetchImpl: async () => ({ ok: false, status: 404 }) }),
      { ok: false, reason: 'http_error', httpStatus: 404 }
    );
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    assert.deepEqual(
      await postToSlack('https://h', 'x', {
        fetchImpl: async () => {
          throw timeout;
        },
      }),
      { ok: false, reason: 'timeout' }
    );
    assert.deepEqual(
      await postToSlack('https://h', 'x', {
        fetchImpl: async () => {
          throw new Error('ECONNRESET');
        },
      }),
      { ok: false, reason: 'network' }
    );
    let body;
    assert.deepEqual(
      await postToSlack('https://h', 'hello', {
        fetchImpl: async (_u, init) => {
          body = JSON.parse(init.body);
          return { ok: true, status: 200 };
        },
      }),
      { ok: true }
    );
    assert.deepEqual(body, { text: 'hello' });
  });
});
