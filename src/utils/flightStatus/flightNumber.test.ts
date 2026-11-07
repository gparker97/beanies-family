import { describe, expect, it } from 'vitest';
import { normaliseFlightNumber } from './flightNumber';
import { carriedCode, isFlightType, parseFlightDesignator } from '../travelCodes';
import { carriedCode as reExported } from '../vacation';

describe('normaliseFlightNumber', () => {
  it.each([
    ['SQ', 'SQ25', 'SQ25'],
    [undefined, 'SQ25', 'SQ25'],
    ['Singapore Airlines (SQ)', '25', 'SQ25'],
    ['SQ', '25', 'SQ25'],
    ['SQ', 'SQ-25', 'SQ25'],
    [undefined, 'sq 25', 'SQ25'],
    ['', 'SQ 318', 'SQ318'],
    ['Singapore Airlines', 'SQ318', 'SQ318'],
    ['6E', '6E 123', '6E123'],
    [undefined, '6E123', '6E123'],
    ['DL', '00123', 'DL123'],
    ['Delta Air Lines (DL)', 'DL 0012', 'DL12'],
    // A designator in the number wins over a different airline code (codeshare booking).
    ['Singapore Airlines (SQ)', 'TR 123', 'TR123'],
    // The A3 ambiguity flightCodeLabel documents: the field is a flight number, read as one.
    ['Aegean Airlines (A3)', 'A320', 'A320'],
  ])('%s + %s → %s', (airline, flightNumber, query) => {
    expect(normaliseFlightNumber(airline, flightNumber)?.query).toBe(query);
  });

  it('returns carrier and digits separately', () => {
    expect(normaliseFlightNumber('Singapore Airlines (SQ)', '0025')).toEqual({
      carrier: 'SQ',
      digits: '25',
      query: 'SQ25',
    });
  });

  it.each([
    ['name-only airline with a bare number', 'Singapore Airlines', '25'],
    ['no airline, bare number', undefined, '25'],
    ['no flight number', 'SQ', undefined],
    ['blank flight number', 'SQ', '   '],
    ['equipment code', undefined, 'ATR72'],
    ['too many digits', 'SQ', '12345'],
    ['placeholder airline code', 'TBA (XX)', '25'],
    ['free text', 'SQ', 'tbc'],
  ])('null for %s', (_label, airline, flightNumber) => {
    expect(normaliseFlightNumber(airline, flightNumber)).toBeNull();
  });
});

describe('travelCodes', () => {
  it('parseFlightDesignator splits carrier and digits, tolerating separators and case', () => {
    expect(parseFlightDesignator('SQ25')).toEqual({ carrier: 'SQ', digits: '25' });
    expect(parseFlightDesignator('sq 318')).toEqual({ carrier: 'SQ', digits: '318' });
    expect(parseFlightDesignator('SQ-25')).toEqual({ carrier: 'SQ', digits: '25' });
    expect(parseFlightDesignator('6E123')).toEqual({ carrier: '6E', digits: '123' });
    expect(parseFlightDesignator('DL00123')).toEqual({ carrier: 'DL', digits: '00123' });
  });

  it('parseFlightDesignator rejects non-designators', () => {
    expect(parseFlightDesignator('25')).toBeNull();
    expect(parseFlightDesignator('123456')).toBeNull();
    expect(parseFlightDesignator('ATR72')).toBeNull();
    expect(parseFlightDesignator('')).toBeNull();
    expect(parseFlightDesignator(undefined)).toBeNull();
  });

  it('isFlightType covers exactly the three flight types', () => {
    expect(isFlightType('flight_outbound')).toBe(true);
    expect(isFlightType('flight_return')).toBe(true);
    expect(isFlightType('flight_other')).toBe(true);
    expect(isFlightType('train')).toBe(false);
    expect(isFlightType('cruise')).toBe(false);
    expect(isFlightType(undefined)).toBe(false);
  });

  it('vacation.ts re-exports the same carriedCode', () => {
    expect(reExported).toBe(carriedCode);
    expect(carriedCode('Singapore (SIN)', 3)).toBe('SIN');
    expect(carriedCode('TBA', 3)).toBeUndefined();
  });
});
