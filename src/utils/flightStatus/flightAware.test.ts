import { describe, expect, it } from 'vitest';
import {
  FLIGHTAWARE_FLIGHT_BASE,
  TRACK_ASSUMED_FLIGHT_MS,
  TRACK_CLOSES_AFTER_MS,
  TRACK_OPENS_BEFORE_MS,
  flightAwareIdent,
  flightAwareUrl,
  flightTrackUrl,
  trackWindowOpen,
} from './flightAware';
import { makeCheck, makeFlight, makeLeg } from './__tests__/fixtures';

const HOUR = 3_600_000;
const SG = 'Asia/Singapore';
const LA = 'America/Los_Angeles';

describe('flightAwareIdent', () => {
  it.each([
    [undefined, 'SQ 321', 'SQ321'],
    [undefined, 'sq321', 'SQ321'],
    [undefined, 'BA0007', 'BA7'],
    ['British Airways (BA)', '0007', 'BA7'],
    ['SQ', 'SQ-25', 'SQ25'],
    ['6E', '6E 123', '6E123'],
  ])('%s + %s → %s', (airline, number, ident) => {
    expect(flightAwareIdent(airline, number)).toBe(ident);
  });

  it.each([
    [undefined, ''],
    [undefined, '   '],
    [undefined, 'TBD'],
    ['SQ', 'TBA'],
    [undefined, 'United 837'],
    ['United Airlines', '837'],
    [undefined, 'SQ12345'],
    [undefined, 'hello'],
  ])('null for %s + %j (not plainly a flight number)', (airline, number) => {
    expect(flightAwareIdent(airline, number)).toBeNull();
  });

  it('prefers the ICAO code a cached check names for THIS flight', () => {
    const check = makeCheck(makeLeg({}));
    expect(flightAwareIdent('Singapore Airlines (SQ)', 'SQ318', check)).toBe('SIA318');
  });

  it('keeps the IATA form when the cached leg is another flight (codeshare operator)', () => {
    const check = makeCheck(
      makeLeg({ number: 'TR 12', airline: { name: 'Scoot', iata: 'TR', icao: 'TGW' } })
    );
    expect(flightAwareIdent('Singapore Airlines (SQ)', 'SQ318', check)).toBe('SQ318');
  });

  it('keeps the IATA form when the cached leg has no usable ICAO code', () => {
    const check = makeCheck(makeLeg({ airline: { name: 'Singapore Airlines', iata: 'SQ' } }));
    expect(flightAwareIdent(undefined, 'SQ318', check)).toBe('SQ318');
  });
});

describe('flightAwareUrl', () => {
  it('builds the live flight page with the ident only', () => {
    expect(flightAwareUrl({ type: 'flight_outbound', flightNumber: 'SQ 321' })).toBe(
      'https://www.flightaware.com/live/flight/SQ321'
    );
    expect(FLIGHTAWARE_FLIGHT_BASE).toBe('https://www.flightaware.com/live/flight/');
  });

  it('null for a non-flight segment or no usable number', () => {
    expect(flightAwareUrl({ type: 'train', flightNumber: 'SQ321' })).toBeNull();
    expect(flightAwareUrl({ type: 'flight_return', flightNumber: 'TBD' })).toBeNull();
    expect(flightAwareUrl({ type: 'flight_other' })).toBeNull();
  });
});

describe('trackWindowOpen', () => {
  const dep = Date.parse('2026-12-13T09:00:00Z');
  const arr = dep + 13 * HOUR;

  it('closed before departure - 24 h, open from that instant', () => {
    expect(trackWindowOpen(dep, arr, dep - TRACK_OPENS_BEFORE_MS - 1)).toBe(false);
    expect(trackWindowOpen(dep, arr, dep - TRACK_OPENS_BEFORE_MS)).toBe(true);
  });

  it('open through the flight, closed after arrival + 6 h', () => {
    expect(trackWindowOpen(dep, arr, dep + 2 * HOUR)).toBe(true);
    expect(trackWindowOpen(dep, arr, arr + TRACK_CLOSES_AFTER_MS)).toBe(true);
    expect(trackWindowOpen(dep, arr, arr + TRACK_CLOSES_AFTER_MS + 1)).toBe(false);
  });

  it('a missing arrival is taken as departure + 24 h', () => {
    const closes = dep + TRACK_ASSUMED_FLIGHT_MS + TRACK_CLOSES_AFTER_MS;
    expect(trackWindowOpen(dep, null, closes)).toBe(true);
    expect(trackWindowOpen(dep, null, closes + 1)).toBe(false);
  });

  it('an arrival before departure (a data error) closes on the departure', () => {
    expect(trackWindowOpen(dep, dep - 5 * HOUR, dep + TRACK_CLOSES_AFTER_MS)).toBe(true);
    expect(trackWindowOpen(dep, dep - 5 * HOUR, dep + TRACK_CLOSES_AFTER_MS + 1)).toBe(false);
  });

  it('no departure instant, no window', () => {
    expect(trackWindowOpen(null, arr, dep)).toBe(false);
  });
});

describe('flightTrackUrl', () => {
  // SQ318 17:00 SIN → 23:10 LHR on 13 Dec, read in the home zone with no cached check.
  const seg = makeFlight({ arrivalDate: '2026-12-14', arrivalTime: '06:00' });
  const depSg = Date.parse('2026-12-13T09:00:00Z'); // 17:00 Singapore

  it('the link inside the window, null outside', () => {
    const url = 'https://www.flightaware.com/live/flight/SQ318';
    expect(flightTrackUrl(seg, undefined, SG, depSg - 3 * HOUR)).toBe(url);
    expect(flightTrackUrl(seg, undefined, SG, depSg - 25 * HOUR)).toBeNull();
    expect(flightTrackUrl(seg, undefined, SG, depSg + 30 * 24 * HOUR)).toBeNull();
    // Next month's flight is plain text today.
    expect(
      flightTrackUrl(makeFlight({ departureDate: '2027-01-13' }), undefined, SG, depSg)
    ).toBeNull();
  });

  it('missing arrival: open until departure + 30 h', () => {
    const noArrival = makeFlight({ arrivalDate: undefined, arrivalTime: undefined });
    expect(flightTrackUrl(noArrival, undefined, SG, depSg + 29 * HOUR)).not.toBeNull();
    expect(flightTrackUrl(noArrival, undefined, SG, depSg + 31 * HOUR)).toBeNull();
  });

  it('a stored arrival no check confirms is not trusted (its zone is unknown)', () => {
    // 05:00 London local, read in Singapore, would be 8 h early and close the link mid-flight
    // (21:00Z + 6 h = 03:00Z, two hours before the real 05:00Z landing).
    const london = makeFlight({
      departureTime: '23:00',
      arrivalDate: '2026-12-14',
      arrivalTime: '05:00',
    });
    const dep = Date.parse('2026-12-13T15:00:00Z'); // 23:00 Singapore
    const realLanding = Date.parse('2026-12-14T05:00:00Z');
    expect(flightTrackUrl(london, undefined, SG, realLanding - HOUR)).not.toBeNull();
    expect(flightTrackUrl(london, undefined, SG, dep + 30 * HOUR)).not.toBeNull();
    expect(flightTrackUrl(london, undefined, SG, dep + 30 * HOUR + 1)).toBeNull();
  });

  it('the stored wall clock is read in the home zone (time-zone edge)', () => {
    // 17:00 in Los Angeles is 16 h after 17:00 in Singapore, so the instant the Singapore
    // window opens is still 16 h before the window opens for a Los Angeles home zone.
    const now = depSg - TRACK_OPENS_BEFORE_MS;
    expect(flightTrackUrl(seg, undefined, SG, now)).not.toBeNull();
    expect(flightTrackUrl(seg, undefined, LA, now)).toBeNull();
    expect(flightTrackUrl(seg, undefined, LA, now + 16 * HOUR)).not.toBeNull();
  });

  it('a fitting cached check: its UTC times decide, and its ICAO code is used', () => {
    const check = makeCheck(makeLeg({}));
    const url = flightTrackUrl(seg, check, LA, depSg - 3 * HOUR);
    expect(url).toBe('https://www.flightaware.com/live/flight/SIA318');
    // Arrival 23:10Z (the leg), so open at +6 h after that, closed just past it, whatever the
    // segment's own (later) arrival field says.
    const lands = Date.parse('2026-12-13T23:10:00Z');
    expect(flightTrackUrl(seg, check, LA, lands + TRACK_CLOSES_AFTER_MS)).not.toBeNull();
    expect(flightTrackUrl(seg, check, LA, lands + TRACK_CLOSES_AFTER_MS + 1)).toBeNull();
  });

  it('null for a flight with no date or no usable number', () => {
    expect(
      flightTrackUrl(makeFlight({ departureDate: undefined }), undefined, SG, depSg)
    ).toBeNull();
    expect(flightTrackUrl(makeFlight({ flightNumber: 'TBD' }), undefined, SG, depSg)).toBeNull();
  });
});
