import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  cancelRevisionOf,
  legForCodes,
  normaliseTerminal,
  normaliseTime,
  parseRevision,
  planPushes,
  revisionOf,
  splitLocal,
  tupleFromLeg,
} from '../schedule.mjs';
import { mapLeg } from '../providers/aerodatabox.mjs';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/aerodatabox-sq318.json', import.meta.url))
);
const SQ318 = mapLeg(FIXTURE[0]);
// The recorded leg: SIN 2026-12-13 23:05 T3 → LHR 2026-12-14 05:40.
const SQ318_REV = '2026-12-13|23:05|3|2026-12-14|05:40';

/** A minimal beanies FlightLeg. */
function leg({
  dep = 'SIN',
  arr = 'LHR',
  depLocal,
  arrLocal,
  depUtc,
  arrUtc,
  terminal,
  status = 'Expected',
  airline = 'Singapore Airlines',
  isCargo = false,
} = {}) {
  return {
    number: 'SQ 318',
    airline: airline ? { name: airline } : undefined,
    status,
    isCargo,
    departure: { iata: dep, scheduledLocal: depLocal, scheduledUtc: depUtc, terminal },
    arrival: { iata: arr, scheduledLocal: arrLocal, scheduledUtc: arrUtc },
  };
}

const device = (over = {}) => ({
  sk: `d#2026-12-13#${over.id ?? 'a'}`,
  date: '2026-12-13',
  dep: 'SIN',
  arr: 'LHR',
  sent_rev: SQ318_REV,
  ...over,
});

describe('the restated revision contract', () => {
  test('the recorded leg revises to the client format', () => {
    assert.equal(revisionOf(tupleFromLeg(SQ318)), SQ318_REV);
    assert.equal(cancelRevisionOf(tupleFromLeg(SQ318)), `${SQ318_REV}|cancelled`);
  });

  test('edge tuples: missing terminal, T2 vs Terminal 2, seconds, no arrival half', () => {
    assert.equal(
      revisionOf({ departureDate: '2026-12-13', departureTime: '9:05' }),
      '2026-12-13|09:05|||'
    );
    assert.equal(normaliseTerminal('Terminal 2'), normaliseTerminal('T2'));
    assert.equal(normaliseTerminal(' t 2 '), '2');
    assert.equal(normaliseTime('09:05:00'), '09:05');
    assert.equal(revisionOf(tupleFromLeg(SQ318, null)), '2026-12-13|23:05|3||');
    assert.deepEqual(splitLocal('2026-12-13T23:05:30.123+0800'), {
      date: '2026-12-13',
      time: '23:05',
    });
    assert.equal(splitLocal('2026-12-13 25:00'), null);
  });

  test('parseRevision round-trips, with and without the cancel suffix', () => {
    assert.deepEqual(parseRevision(SQ318_REV), {
      tuple: {
        departureDate: '2026-12-13',
        departureTime: '23:05',
        terminal: '3',
        arrivalDate: '2026-12-14',
        arrivalTime: '05:40',
      },
      cancelled: false,
    });
    assert.equal(parseRevision(`${SQ318_REV}|cancelled`).cancelled, true);
    assert.deepEqual(parseRevision('garbage'), { tuple: {}, cancelled: false });
  });
});

describe('legForCodes', () => {
  const a = leg({ depLocal: '2026-12-13 23:05+08:00', arrLocal: '2026-12-14 05:40+00:00' });
  test('single sector: departure by code, arrival half is the leg itself', () => {
    assert.deepEqual(legForCodes([a], { dep: 'SIN', arr: 'LHR', date: '2026-12-13' }), {
      leg: a,
      arrivalLeg: a,
    });
  });

  test('no arr → null arrival half; wrong dep → none; outside ±1 day → none; cargo ignored', () => {
    assert.deepEqual(legForCodes([a], { dep: 'SIN', date: '2026-12-13' }), {
      leg: a,
      arrivalLeg: null,
    });
    assert.equal(legForCodes([a], { dep: 'LHR', arr: 'SIN', date: '2026-12-13' }), null);
    assert.equal(legForCodes([a], { dep: 'SIN', arr: 'LHR', date: '2026-12-16' }), null);
    assert.equal(legForCodes([{ ...a, isCargo: true }], { dep: 'SIN', date: '2026-12-13' }), null);
  });

  test('a daily flight on two adjacent dates: the registered date wins', () => {
    const b = leg({ depLocal: '2026-12-14 23:05+08:00', arrLocal: '2026-12-15 05:40+00:00' });
    assert.equal(legForCodes([b, a], { dep: 'SIN', arr: 'LHR', date: '2026-12-13' }).leg, a);
  });

  test("a lone off-date leg: the adjacent daily instance (24 h from the known departure) is never the device's; a retime past midnight is", () => {
    const codes = { dep: 'SIN', arr: 'LHR', date: '2026-12-13', rev: SQ318_REV };
    const nextInstance = leg({
      depLocal: '2026-12-14 23:05+08:00',
      arrLocal: '2026-12-15 05:40+00:00',
    });
    const previousInstance = leg({
      depLocal: '2026-12-12 23:05+08:00',
      arrLocal: '2026-12-13 05:40+00:00',
    });
    assert.equal(legForCodes([nextInstance], codes), null);
    assert.equal(legForCodes([previousInstance], codes), null);
    const retimed = leg({ depLocal: '2026-12-14 01:30+08:00', arrLocal: '2026-12-14 08:05+00:00' });
    assert.equal(legForCodes([retimed], codes).leg, retimed);
    // No known departure (no rev): an off-date leg is never taken.
    assert.equal(legForCodes([retimed], { dep: 'SIN', arr: 'LHR', date: '2026-12-13' }), null);
  });

  test('a known departure picks the NEAREST leg within 12 h, whatever its date: an on-date former instance never wins', () => {
    // A non-writer device was pushed a retime past midnight: its sent_rev now departs 12-14 01:30
    // while it stays registered for 12-13. The payload then carries the former (12-12) instance,
    // delayed onto 12-13, beside the device's own leg.
    const pushedRev = '2026-12-14|01:30|3|2026-12-14|08:05';
    const codes = { dep: 'SIN', arr: 'LHR', date: '2026-12-13', rev: pushedRev };
    const formerOnDate = leg({
      depLocal: '2026-12-13 03:00+08:00',
      arrLocal: '2026-12-13 09:35+00:00',
    });
    const own = leg({ depLocal: '2026-12-14 01:30+08:00', arrLocal: '2026-12-14 08:05+00:00' });
    assert.equal(legForCodes([formerOnDate, own], codes).leg, own);
    const ownRetimed = leg({
      depLocal: '2026-12-14 02:10+08:00',
      arrLocal: '2026-12-14 08:45+00:00',
    });
    assert.equal(legForCodes([formerOnDate, ownRetimed], codes).leg, ownRetimed);
    // Alone, the on-date former instance (22.5 h from the known departure) is nobody's leg here.
    assert.equal(legForCodes([formerOnDate], codes), null);
  });

  test('a retime of 12 h or more is not taken (the on-open check applies it); an unparseable rev falls back to the date', () => {
    const codes = { dep: 'SIN', arr: 'LHR', date: '2026-12-13', rev: SQ318_REV };
    const farOnDate = leg({
      depLocal: '2026-12-13 11:05+08:00',
      arrLocal: '2026-12-13 17:40+00:00',
    });
    assert.equal(legForCodes([farOnDate], codes), null, 'exactly 12 h: excluded');
    const justInside = leg({
      depLocal: '2026-12-13 11:06+08:00',
      arrLocal: '2026-12-13 17:41+00:00',
    });
    assert.equal(legForCodes([justInside], codes).leg, justInside);
    assert.equal(legForCodes([farOnDate], { ...codes, rev: 'garbage' }).leg, farOnDate);
    assert.equal(legForCodes([farOnDate], { ...codes, rev: '||||' }).leg, farOnDate);
  });

  test('two legs equally near the known departure: the one reaching arr, else none', () => {
    const codes = { dep: 'SIN', arr: 'LHR', date: '2026-12-13', rev: SQ318_REV };
    const before = leg({
      arr: 'BKK',
      depLocal: '2026-12-13 22:05+08:00',
      arrLocal: '2026-12-13 23:30+07:00',
    });
    const after = leg({ depLocal: '2026-12-14 00:05+08:00', arrLocal: '2026-12-14 06:40+00:00' });
    assert.equal(legForCodes([before, after], codes).leg, after);
    const afterBkk = { ...after, arrival: { ...after.arrival, iata: 'BKK' } };
    assert.equal(legForCodes([before, afterBkk], codes), null);
  });

  test('multi-stop: the continuation reaching arr (within 36 h, after landing), never the previous rotation', () => {
    const first = leg({
      dep: 'SIN',
      arr: 'FRA',
      depLocal: '2026-12-14 01:00+08:00',
      arrLocal: '2026-12-14 08:00+01:00',
      depUtc: '2026-12-13 17:00Z',
      arrUtc: '2026-12-14 07:00Z',
    });
    const second = leg({
      dep: 'FRA',
      arr: 'JFK',
      depLocal: '2026-12-14 10:00+01:00',
      arrLocal: '2026-12-14 13:00-05:00',
      depUtc: '2026-12-14 09:00Z',
      arrUtc: '2026-12-14 18:00Z',
    });
    const previous = leg({
      dep: 'FRA',
      arr: 'JFK',
      depLocal: '2026-12-14 06:00+01:00',
      arrLocal: '2026-12-14 09:00-05:00',
      depUtc: '2026-12-14 05:00Z',
      arrUtc: '2026-12-14 14:00Z',
    });
    assert.deepEqual(
      legForCodes([previous, first, second], { dep: 'SIN', arr: 'JFK', date: '2026-12-14' }),
      {
        leg: first,
        arrivalLeg: second,
      }
    );
    assert.deepEqual(
      legForCodes([previous, first], { dep: 'SIN', arr: 'JFK', date: '2026-12-14' }),
      {
        leg: first,
        arrivalLeg: null,
      }
    );
  });
});

describe('planPushes', () => {
  test('same revision → skipped_same_rev; no leg → skipped_no_leg', () => {
    const out = planPushes([SQ318], [device(), device({ id: 'b', dep: 'BKK' })], 'SQ318');
    assert.deepEqual([out.pushes.length, out.skipped_same_rev, out.skipped_no_leg], [0, 1, 1]);
  });

  test('a moved departure pushes the new revision with what changed', () => {
    const moved = leg({
      depLocal: '2026-12-14 08:30+08:00',
      arrLocal: '2026-12-14 14:55+00:00',
      terminal: 'T3',
    });
    const out = planPushes([moved], [device()], 'SQ318');
    assert.equal(out.pushes.length, 1);
    const [p] = out.pushes;
    assert.equal(p.rev, '2026-12-14|08:30|3|2026-12-14|14:55');
    assert.equal(p.change.flight, 'SQ318');
    assert.equal(p.change.cancelled, false);
    assert.deepEqual(Object.keys(p.change.was).sort(), [
      'arrivalTime',
      'departureDate',
      'departureTime',
    ]);
  });

  test("a payload carrying only the next day's instance of a daily flight pushes nothing (no false date move, no flip-flop)", () => {
    const nextInstance = leg({
      depLocal: '2026-12-14 23:05+08:00',
      arrLocal: '2026-12-15 05:40+00:00',
      terminal: 'T3',
    });
    const out = planPushes([nextInstance], [device()], 'SQ318');
    assert.deepEqual([out.pushes.length, out.skipped_same_rev, out.skipped_no_leg], [0, 0, 1]);
  });

  test('a device pushed off its date is not pushed the on-date former instance (no false change)', () => {
    const pushedRev = '2026-12-14|01:30|3|2026-12-14|08:05';
    const formerOnDate = leg({
      depLocal: '2026-12-13 03:00+08:00',
      arrLocal: '2026-12-13 09:35+00:00',
      terminal: 'T3',
    });
    const own = leg({
      depLocal: '2026-12-14 01:30+08:00',
      arrLocal: '2026-12-14 08:05+00:00',
      terminal: 'T3',
    });
    const out = planPushes([formerOnDate, own], [device({ sent_rev: pushedRev })], 'SQ318');
    assert.deepEqual([out.pushes.length, out.skipped_same_rev, out.skipped_no_leg], [0, 1, 0]);
  });

  test('a cancellation pushes the cancel revision; an already-known cancel does not', () => {
    const cancelled = { ...SQ318, status: 'Canceled' };
    const out = planPushes(
      [cancelled],
      [device(), device({ id: 'b', sent_rev: `${SQ318_REV}|cancelled` })],
      'SQ318'
    );
    assert.equal(out.pushes.length, 1);
    assert.equal(out.pushes[0].rev, `${SQ318_REV}|cancelled`);
    assert.equal(out.pushes[0].change.cancelled, true);
    assert.equal(out.pushes[0].change.airline, 'Singapore Airlines');
    assert.equal(out.skipped_same_rev, 1);
  });

  test('a field the payload leaves undefined is never a change (the client tuplesEqual rule)', () => {
    const noTerminal = { ...SQ318, departure: { ...SQ318.departure, terminal: undefined } };
    const out = planPushes([noTerminal], [device()], 'SQ318');
    assert.deepEqual([out.pushes.length, out.skipped_same_rev], [0, 1]);
  });

  test('a gate-only payload carrying a schedule revision the device never received pushes it', () => {
    const out = planPushes(
      [SQ318],
      [device({ sent_rev: '2026-12-13|22:00|3|2026-12-14|05:40' })],
      'SQ318'
    );
    assert.equal(out.pushes.length, 1);
    assert.deepEqual(Object.keys(out.pushes[0].change.was), ['departureTime']);
  });

  test('a partial payload without the arrival sector keeps the arrival half the device knows', () => {
    const first = leg({
      dep: 'SIN',
      arr: 'FRA',
      depLocal: '2026-12-13 02:00+08:00',
      arrLocal: '2026-12-13 08:00+01:00',
      terminal: '3',
    });
    const out = planPushes(
      [first],
      [device({ arr: 'JFK', sent_rev: '2026-12-13|01:00|3|2026-12-13|13:00' })],
      'SQ318'
    );
    assert.equal(out.pushes.length, 1);
    assert.equal(out.pushes[0].rev, '2026-12-13|02:00|3|2026-12-13|13:00');
  });

  test('a newly published terminal is a change ("filled")', () => {
    const out = planPushes(
      [SQ318],
      [device({ sent_rev: '2026-12-13|23:05||2026-12-14|05:40' })],
      'SQ318'
    );
    assert.equal(out.pushes.length, 1);
    assert.deepEqual(out.pushes[0].change.was, { terminal: '' });
  });
});
