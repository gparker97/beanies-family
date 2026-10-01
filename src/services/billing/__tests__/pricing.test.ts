import { describe, it, expect } from 'vitest';
import { PRICES, familyPrice } from '@beanies/brand/pricing';

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
