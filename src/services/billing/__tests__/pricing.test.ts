import { describe, it, expect } from 'vitest';
import { PRICES, familyPrice } from '@beanies/brand/pricing';
import { parsePlanLimits } from '@beanies/brand/planLimits';

describe('familyPrice (#95): the one table answers list, half price and the founding price', () => {
  const usd = PRICES.USD;
  it('list prices for a family with no cohort', () => {
    expect(familyPrice(usd, 'basic', 'year', null)).toEqual({ price: '$30', list: '$30' });
    expect(familyPrice(usd, 'full', 'year', null)).toEqual({ price: '$84.99', list: '$84.99' });
    expect(familyPrice(usd, 'full', 'month', null)).toEqual({ price: '$9.99', list: '$9.99' });
  });
  it('pre_v1 is half of every plan, with the list price beside it', () => {
    expect(familyPrice(usd, 'basic', 'year', 'pre_v1')).toEqual({ price: '$15', list: '$30' });
    expect(familyPrice(usd, 'full', 'year', 'pre_v1')).toEqual({ price: '$42.49', list: '$84.99' });
    expect(familyPrice(usd, 'full', 'month', 'pre_v1')).toEqual({ price: '$4.99', list: '$9.99' });
  });
  it('first_ten is the founding price on both plans, in both currencies', () => {
    expect(familyPrice(usd, 'full', 'month', 'first_ten')).toEqual({ price: '$1', list: '$9.99' });
    expect(familyPrice(usd, 'basic', 'year', 'first_ten')).toEqual({ price: '$12', list: '$30' });
    expect(familyPrice(PRICES.SGD, 'full', 'month', 'first_ten')).toEqual({
      price: 'S$1.35',
      list: 'S$13',
    });
    expect(familyPrice(PRICES.SGD, 'full', 'year', 'first_ten')).toEqual({
      price: 'S$16.20',
      list: 'S$110',
    });
  });
});

describe('parsePlanLimits (#120): the one validation both the site and the app trust', () => {
  const valid = () => ({
    trial: { period: 'day', limit: 1 },
    basic: { period: 'month', limit: 1 },
    full: { period: 'day', limit: 25 },
    source: 'env',
  });

  it('parses a valid body', () => {
    expect(parsePlanLimits(valid())).toEqual(valid());
  });

  it('accepts the fallback source', () => {
    expect(parsePlanLimits({ ...valid(), source: 'fallback' })?.source).toBe('fallback');
  });

  it('rejects a non-integer limit', () => {
    expect(parsePlanLimits({ ...valid(), full: { period: 'day', limit: 2.5 } })).toBeNull();
  });

  it('rejects a limit of 0', () => {
    expect(parsePlanLimits({ ...valid(), full: { period: 'day', limit: 0 } })).toBeNull();
  });

  it('rejects a missing tier', () => {
    const { basic: _basic, ...rest } = valid();
    expect(parsePlanLimits(rest)).toBeNull();
  });

  it('rejects a wrong period', () => {
    expect(parsePlanLimits({ ...valid(), full: { period: 'week', limit: 25 } })).toBeNull();
  });

  it('rejects a missing or invalid source', () => {
    const { source: _source, ...rest } = valid();
    expect(parsePlanLimits(rest)).toBeNull();
    expect(parsePlanLimits({ ...valid(), source: 'guess' })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parsePlanLimits(null)).toBeNull();
    expect(parsePlanLimits('x')).toBeNull();
  });
});
