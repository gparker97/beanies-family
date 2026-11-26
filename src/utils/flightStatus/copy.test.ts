import { describe, expect, it } from 'vitest';
import { ZH_STRINGS } from '@/services/translation/zh';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { FlightVerification, ScheduleTuple } from '@/types/flightStatus';
import type { TranslateFn } from '@/utils/format';
import { FIELD_KIND, TUPLE_FIELDS, type TupleField } from './schedule';
import {
  agoText,
  airlineName,
  cancelSentence,
  changeNoteLine,
  changeSentence,
  changedByLine,
  checkedAgo,
  chipLabel,
  confirmedLive,
  airportCheck,
  bandChecks,
  fieldCheck,
  hasFlightChip,
  isAlertStatus,
  conflictSentence,
  departureRowMessage,
  fillNoteLine,
  clockTime,
  joinSentences,
  placeTerminal,
  placeTerminalShort,
  planTerminal,
  shortDate,
  terminalLabel,
  terminalRoute,
  wasLine,
} from './copy';
import { t } from './__tests__/fixtures';

const zh = (k: UIStringKey): string => ZH_STRINGS[k];
const MIN = 60_000;

describe('terminal and airline names', () => {
  it('one spelling of a terminal', () => {
    for (const raw of ['3', 'T3', 'Terminal 3', 'terminal 3']) {
      expect(terminalLabel(t, raw)).toBe('Terminal 3');
    }
    expect(terminalLabel(t, undefined)).toBe('');
  });

  it('the airline name loses a carried code; none is "the airline"', () => {
    expect(airlineName(t, 'Singapore Airlines (SQ)')).toBe('Singapore Airlines');
    expect(airlineName(t, undefined)).toBe('the airline');
  });
});

describe('changeSentence', () => {
  const now = {
    departureDate: '2026-12-13',
    departureTime: '18:30',
    terminal: '3',
    arrivalDate: '2026-12-14',
    arrivalTime: '00:40',
  };

  it('the plan copy for a time + terminal change', () => {
    expect(
      changeSentence(t, 'SQ318', now, { departureTime: '17:00', terminal: 'Terminal 2' })
    ).toBe('SQ318 now leaves at 6:30pm from Terminal 3. Your plan has been updated.');
  });

  it('names the date only when it moved', () => {
    expect(changeSentence(t, 'SQ318', now, { departureDate: '2026-12-12' }, 'en')).toBe(
      'SQ318 now leaves on 13 Dec at 6:30pm from Terminal 3. Your plan has been updated.'
    );
  });

  it('a terminal-only change, and an arrival-only change', () => {
    expect(changeSentence(t, 'SQ318', now, { terminal: '2' })).toBe(
      'SQ318 now leaves from Terminal 3. Your plan has been updated.'
    );
    expect(changeSentence(t, 'SQ318', now, { arrivalTime: '23:10' })).toBe(
      'SQ318 now lands at 12:40am. Your plan has been updated.'
    );
  });
});

describe('cancelSentence', () => {
  it('the plan copy', () => {
    expect(
      cancelSentence(
        t,
        { airline: 'Singapore Airlines', flight: 'SQ318', date: '2026-12-13' },
        'en'
      )
    ).toBe('Singapore Airlines cancelled SQ318 on 13 Dec. This flight is now pending.');
  });

  it('without an airline name', () => {
    expect(cancelSentence(t, { flight: 'SQ318', date: '2026-12-13' }, 'en')).toBe(
      'SQ318 on 13 Dec was cancelled. This flight is now pending.'
    );
  });
});

describe('was lines and notes', () => {
  it('every shape of prior value', () => {
    expect(wasLine(t, { departureTime: '17:00', terminal: 'Terminal 2' })).toBe(
      'Was 5pm from Terminal 2'
    );
    expect(wasLine(t, { departureTime: '17:00' })).toBe('Was 5pm');
    expect(wasLine(t, { terminal: '2' })).toBe('Was from Terminal 2');
    expect(wasLine(t, { departureDate: '2026-12-12', departureTime: '17:00' }, 'en')).toBe(
      'Was 12 Dec at 5pm'
    );
    expect(wasLine(t, { arrivalTime: '23:10' })).toBe('Was landing at 11:10pm');
    expect(wasLine(t, {})).toBe('');
  });

  it('the notes line "Changed on <date>: Was 5pm from Terminal 2"', () => {
    expect(
      changeNoteLine(t, { departureTime: '17:00', terminal: 'Terminal 2' }, '2026-12-12', 'en')
    ).toBe('Changed on 12 Dec: Was 5pm from Terminal 2');
  });

  it('the notice line', () => {
    expect(
      changedByLine(
        t,
        { departureTime: '17:00', terminal: '2' },
        'Singapore Airlines',
        '12 min ago'
      )
    ).toBe('Was 5pm from Terminal 2. Changed by Singapore Airlines · checked 12 min ago.');
  });

  it('the quiet fill line', () => {
    expect(
      fillNoteLine(t, ['terminal'], { terminal: '3' }, 'Singapore Airlines', '2026-12-12', 'en')
    ).toBe('Departure Terminal 3 added from Singapore Airlines, 12 Dec');
    expect(
      fillNoteLine(
        t,
        ['departureTime', 'terminal'],
        { departureTime: '18:30', terminal: '3' },
        'the airline',
        '2026-12-12',
        'en'
      )
    ).toBe('Departure time 6:30pm, Departure Terminal 3 added from the airline, 12 Dec');
    expect(
      fillNoteLine(
        t,
        ['terminal', 'arrivalTerminal'],
        { terminal: '3', arrivalTerminal: 'TBIT' },
        'the airline',
        '2026-12-12',
        'en'
      )
    ).toBe('Departure Terminal 3, Arrival TBIT added from the airline, 12 Dec');
  });
});

describe('departureRowMessage', () => {
  it('everyone, one person and several, for flights and other transport', () => {
    const row = (names: string | null, count: number, isFlight: boolean) =>
      departureRowMessage(t, { names, count, time: '17:00', isFlight });
    expect(row(null, 4, true)).toBe('Everyone flies at 5pm today');
    expect(row('Jill', 1, true)).toBe('Jill flies at 5pm today');
    expect(row('Jill and Sam', 2, true)).toBe('Jill and Sam fly at 5pm today');
    expect(row(null, 4, false)).toBe('Everyone leaves at 5pm today');
    expect(row('Jill and Sam', 2, false)).toBe('Jill and Sam leave at 5pm today');
  });
});

describe('checkedAgo', () => {
  const now = Date.parse('2026-12-12T09:00:00Z');
  it.each([
    [10_000, 'Checked just now'],
    [12 * MIN, 'Checked 12 min ago'],
    [3 * 60 * MIN, 'Checked 3 h ago'],
    [49 * 60 * MIN, 'Checked 2 d ago'],
  ])('%d ms old → %s', (age, want) => {
    expect(checkedAgo(t, now - age, now)).toBe(want);
  });

  it('a clock that runs behind never reads negative', () => {
    expect(agoText(t, now + MIN, now)).toBe('just now');
  });
});

describe('chipLabel', () => {
  const now = Date.parse('2026-12-12T09:00:00Z');
  it('one label per state and reason', () => {
    expect(chipLabel(t, { state: 'verified', checkedAt: now - 12 * MIN }, now)).toBe(
      'Checked 12 min ago'
    );
    expect(
      chipLabel(t, { state: 'verified', checkedAt: now, live: { status: 'Diverted' } }, now)
    ).toBe('Diverted');
    expect(
      chipLabel(
        t,
        { state: 'verified', checkedAt: now, live: { status: 'CanceledUncertain' } },
        now
      )
    ).toBe('May be cancelled');
    expect(chipLabel(t, { state: 'changed' }, now)).toBe('Changed');
    expect(chipLabel(t, { state: 'conflict' }, now)).toBe('Conflict');
    expect(chipLabel(t, { state: 'cancelled' }, now)).toBe('Cancelled');
    expect(chipLabel(t, { state: 'not-live' }, now)).toBe('Not checked live');
    expect(chipLabel(t, { state: 'unavailable', reason: 'unentitled' }, now)).toBe(
      'Not checked live'
    );
    expect(chipLabel(t, { state: 'unavailable', reason: 'no_match' }, now)).toBe(
      "Couldn't match this flight"
    );
    expect(chipLabel(t, { state: 'unavailable', reason: 'offline' }, now)).toBe("Couldn't check");
    expect(chipLabel(t, { state: 'unavailable' }, now)).toBe('Checking…');
    expect(
      chipLabel(
        t,
        { state: 'unavailable', reason: 'before_window', opensAt: '2026-12-10T12:00:00.000Z' },
        now,
        'en'
      )
    ).toMatch(/^Checks from 1[01] Dec$/);
  });

  it('a flight that is over carries no chip at all', () => {
    const past = { state: 'unavailable' as const, reason: 'past' as const };
    expect(chipLabel(t, past, now)).toBeNull();
    expect(hasFlightChip(past)).toBe(false);
    expect(hasFlightChip({ state: 'unavailable', reason: 'offline' })).toBe(true);
    expect(hasFlightChip({ state: 'verified', checkedAt: now })).toBe(true);
  });
});

describe('conflictSentence', () => {
  const airline = 'Singapore Airlines';

  it('labels each side; the family side names the day when the day is not in dispute', () => {
    expect(
      conflictSentence(t, {
        mine: { departureDate: '2026-11-09', departureTime: '17:00', terminal: '2' },
        provider: { departureDate: '2026-11-09', departureTime: '18:30', terminal: '3' },
        airline,
      })
    ).toBe(
      'Your plan says 5pm from Terminal 2 on 9 Nov. Singapore Airlines says 6:30pm from Terminal 3.'
    );
  });

  it('a disputed day is named on both sides; an arrival reads as landing', () => {
    expect(
      conflictSentence(t, {
        mine: { departureDate: '2026-11-09' },
        provider: { departureDate: '2026-11-10' },
        airline,
      })
    ).toBe('Your plan says on 9 Nov. Singapore Airlines says on 10 Nov.');
    expect(
      conflictSentence(t, {
        mine: { departureDate: '2026-11-09', arrivalTime: '23:10' },
        provider: { departureDate: '2026-11-09', arrivalTime: '00:40' },
        airline,
      })
    ).toBe('Your plan says landing at 11:10pm. Singapore Airlines says landing at 12:40am.');
  });

  it('a value the family cleared reads "not set"', () => {
    expect(
      conflictSentence(t, {
        mine: { departureTime: '18:30' },
        provider: { departureTime: '18:30', terminal: '3' },
        airline,
      })
    ).toBe('Your plan says not set. Singapore Airlines says from Terminal 3.');
  });
});

describe('Chinese', () => {
  it('fills every placeholder (no English leaks, no stray braces)', () => {
    const s = changeSentence(
      zh,
      'SQ318',
      { departureTime: '18:30', terminal: '3' },
      { departureTime: '17:00' },
      'zh'
    );
    expect(s).toBe('SQ318 现改为 6:30pm 从3 号航站楼起飞。你的行程已随之更新。');
    // The band's formatter is not localised, and the notice follows the band.
    expect(shortDate('2026-12-13', 'zh')).toBe('13 Dec');
    expect(checkedAgo(zh, 0, 12 * MIN)).toBe('12 分钟前已核对');
  });
});

describe('fieldCheck / bandChecks / airportCheck', () => {
  const plan = {
    departureDate: '2026-12-13',
    departureTime: '18:30',
    terminal: 'Terminal 2',
    arrivalDate: '2026-12-14',
    arrivalTime: '00:40',
  };
  const v = (over: Partial<FlightVerification> = {}): FlightVerification => ({
    state: 'verified',
    checkedAt: 1,
    mine: plan,
    provider: { ...plan, terminal: 'T2' },
    route: { from: 'SIN', to: 'LHR' },
    ...over,
  });

  it('confirmed for each value the airline states and the plan matches, however old or spelled', () => {
    expect(fieldCheck(v(), ['terminal'])).toBe('confirmed');
    expect(fieldCheck(v({ fresh: false }), ['terminal'])).toBe('confirmed');
    expect(bandChecks(v())).toEqual({
      start: 'confirmed',
      end: 'confirmed',
      startPlace: 'confirmed',
      endPlace: undefined,
    });
    expect(
      bandChecks(
        v({ mine: { ...plan, arrivalTerminal: '2' }, provider: { ...plan, arrivalTerminal: 'T2' } })
      ).endPlace
    ).toBe('confirmed');
    expect(bandChecks(v({ provider: { ...plan, departureTime: '18:30:00' } })).start).toBe(
      'confirmed'
    );
    expect(bandChecks(v({ state: 'changed', applied: true })).end).toBe('confirmed');
  });

  it('a value the airline does not state is never marked', () => {
    const provider = { departureDate: plan.departureDate, departureTime: plan.departureTime };
    expect(bandChecks(v({ provider }))).toEqual({
      start: 'confirmed',
      end: undefined,
      startPlace: undefined,
      endPlace: undefined,
    });
    expect(fieldCheck(v({ provider }), ['terminal'])).toBeUndefined();
  });

  it('in a Conflict, the disputed values say conflict and the agreed ones stay confirmed', () => {
    const c = v({
      state: 'conflict',
      applied: false,
      mine: { ...plan, departureTime: '19:00', terminal: '3' },
    });
    expect(bandChecks(c)).toEqual({ start: 'conflict', end: 'confirmed', startPlace: 'conflict' });
    expect(fieldCheck(c, ['terminal'])).toBe('conflict');
  });

  it('an airline change not yet in the plan says changed on the moved value only', () => {
    const c = v({ state: 'changed', applied: false, provider: { ...plan, arrivalTime: '01:10' } });
    expect(bandChecks(c)).toEqual({ start: 'confirmed', end: 'changed', startPlace: 'confirmed' });
    const arrival = v({
      state: 'changed',
      applied: false,
      mine: { ...plan, arrivalTerminal: '2' },
      provider: { ...plan, arrivalTerminal: '3' },
    });
    expect(bandChecks(arrival)).toMatchObject({ end: 'confirmed', endPlace: 'changed' });
  });

  it('a quiet fill (the plan lacks a value under verified) carries no mark', () => {
    const { terminal: _t, ...noTerminal } = plan;
    expect(fieldCheck(v({ mine: noTerminal }), ['terminal'])).toBeUndefined();
  });

  it('nothing is marked without a usable answer: unchecked, cancelled, alert, no provider', () => {
    for (const bad of [
      v({ checkedAt: undefined }),
      v({ provider: undefined }),
      v({ state: 'cancelled', applied: true }),
      v({ state: 'conflict', live: { status: 'Canceled' } }),
      v({ live: { status: 'Diverted' } }),
      v({ state: 'unavailable' }),
      undefined,
    ]) {
      expect(bandChecks(bad)).toEqual({
        start: undefined,
        end: undefined,
        startPlace: undefined,
        endPlace: undefined,
      });
      expect(fieldCheck(bad, ['terminal'])).toBeUndefined();
      expect(airportCheck(bad, 'SIN', 'from')).toBeUndefined();
    }
  });

  it("an airport is confirmed only when the booking carries the matched leg's code", () => {
    expect(airportCheck(v(), 'SIN', 'from')).toBe('confirmed');
    expect(airportCheck(v(), 'London Heathrow (LHR)', 'to')).toBe('confirmed');
    expect(airportCheck(v({ state: 'conflict', applied: false }), 'SIN', 'from')).toBe('confirmed');
    expect(airportCheck(v(), 'London', 'to')).toBeUndefined();
    expect(airportCheck(v(), 'LGW', 'to')).toBeUndefined();
    expect(airportCheck(v({ route: {} }), 'SIN', 'from')).toBeUndefined();
    expect(airportCheck(v(), undefined, 'from')).toBeUndefined();
  });
});

describe('confirmedLive', () => {
  it('true for a verified answer, and an airline change the plan carries, however old the check', () => {
    expect(confirmedLive({ state: 'verified', checkedAt: 1 })).toBe(true);
    // Stale is not unconfirmed: the tick does not wait for the poll (greg, 2026-11-10).
    expect(confirmedLive({ state: 'verified', checkedAt: 1, fresh: false })).toBe(true);
    expect(confirmedLive({ state: 'changed', checkedAt: 1, fresh: false, applied: true })).toBe(
      true
    );
    expect(confirmedLive({ state: 'changed', checkedAt: 1, applied: true })).toBe(true);
  });

  it('false without an airline answer, or for unapplied, conflict, cancelled', () => {
    expect(confirmedLive({ state: 'verified' })).toBe(false);
    expect(confirmedLive({ state: 'verified', fresh: false })).toBe(false);
    expect(confirmedLive({ state: 'changed', checkedAt: 1, applied: false })).toBe(false);
    expect(confirmedLive({ state: 'changed', checkedAt: 1 })).toBe(false);
    expect(confirmedLive({ state: 'conflict', checkedAt: 1, applied: false })).toBe(false);
    expect(confirmedLive({ state: 'cancelled', checkedAt: 1, applied: true })).toBe(false);
  });

  it('never ticks an alert status, on either arm (verified, or a change the plan carries)', () => {
    for (const status of ['CanceledUncertain', 'Diverted']) {
      expect(confirmedLive({ state: 'verified', checkedAt: 1, live: { status } })).toBe(false);
      expect(
        confirmedLive({ state: 'changed', checkedAt: 1, applied: true, live: { status } })
      ).toBe(false);
    }
  });

  it('false for a verified answer in the alert look (Diverted, May be cancelled), as the chip paints it', () => {
    for (const status of ['Diverted', 'CanceledUncertain'] as const) {
      expect(isAlertStatus(status)).toBe(true);
      expect(confirmedLive({ state: 'verified', checkedAt: 1, live: { status } })).toBe(false);
    }
    expect(isAlertStatus('Expected')).toBe(false);
    expect(isAlertStatus(undefined)).toBe(false);
    expect(confirmedLive({ state: 'verified', checkedAt: 1, live: { status: 'Expected' } })).toBe(
      true
    );
  });
});

describe('terminal display: planTerminal and the place helpers', () => {
  it.each([
    ['3', 'Terminal 3', 'T3'],
    ['T3', 'Terminal 3', 'T3'],
    ['terminal 3', 'Terminal 3', 'T3'],
    ['Terminal 2E', 'Terminal 2E', 'T2E'],
    ['B', 'Terminal B', 'TB'],
    ['TBIT', 'TBIT', 'TBIT'],
    ['Tom Bradley', 'Tom Bradley', 'Tom Bradley'],
    ['International', 'International', 'International'],
    [' Tom Bradley ', 'Tom Bradley', 'Tom Bradley'],
  ])('%s → %s / %s (a named terminal is written as the plan holds it)', (raw, long, short) => {
    expect(planTerminal(t, raw)).toBe(long);
    expect(placeTerminalShort('SIN', raw)).toBe(`SIN ${short}`);
  });

  it("'' for no terminal", () => {
    for (const raw of [undefined, '', '  ', 'Terminal']) {
      expect(planTerminal(t, raw)).toBe('');
      expect(placeTerminalShort('SIN', raw)).toBe('');
    }
  });

  it('a terminal is tied to its airport, and never shown without one', () => {
    expect(placeTerminal(t, 'LHR', 'T2')).toBe('LHR Terminal 2');
    expect(placeTerminal(t, 'LAX', 'Tom Bradley')).toBe('LAX Tom Bradley');
    expect(placeTerminal(t, '', '2')).toBe('');
    expect(placeTerminal(t, undefined, '2')).toBe('');
    expect(placeTerminal(t, 'LHR', undefined)).toBe('');
    expect(placeTerminalShort('SIN', 'Terminal 3')).toBe('SIN T3');
    expect(placeTerminalShort('LAX', 'TBIT')).toBe('LAX TBIT');
    expect(placeTerminalShort(' ', '3')).toBe('');
    expect(placeTerminalShort('SIN', '')).toBe('');
    expect(placeTerminal(zh, 'LHR', '2')).toBe('LHR 2 号航站楼');
  });

  it('terminalRoute joins the known parts only', () => {
    expect(terminalRoute(['SIN T3', 'LHR T2'])).toBe('SIN T3 → LHR T2');
    expect(terminalRoute(['', 'LHR T2'])).toBe('LHR T2');
    expect(terminalRoute([placeTerminalShort('SIN', '3'), undefined])).toBe('SIN T3');
    expect(terminalRoute(['', ''])).toBe('');
  });

  it('joinSentences: a space in English, none after a Chinese stop, an empty side dropped', () => {
    expect(joinSentences('One.', 'Two.')).toBe('One. Two.');
    expect(joinSentences('一。', '二。')).toBe('一。二。');
    expect(joinSentences('', 'Two.')).toBe('Two.');
    expect(joinSentences('One.', '')).toBe('One.');
  });
});

describe('the arrival terminal in the change copy', () => {
  const now = {
    departureDate: '2026-12-13',
    departureTime: '18:30',
    terminal: '3',
    arrivalDate: '2026-12-14',
    arrivalTime: '00:40',
    arrivalTerminal: '2',
  };

  it('alone, it is the lead: never read as the departure terminal', () => {
    expect(changeSentence(t, 'SQ318', now, { arrivalTerminal: '5' })).toBe(
      'SQ318 now arrives at Terminal 2. Your plan has been updated.'
    );
    expect(changeSentence(t, 'SQ318', now, { arrivalTerminal: '5' }, 'en', false)).toBe(
      'SQ318 now arrives at Terminal 2.'
    );
    expect(changeSentence(zh, 'SQ318', now, { arrivalTerminal: '5' }, 'zh')).toBe(
      'SQ318 现改为在2 号航站楼到达。你的行程已随之更新。'
    );
  });

  it('with other moves, it follows the unchanged lead', () => {
    expect(changeSentence(t, 'SQ318', now, { departureTime: '17:00', arrivalTerminal: '5' })).toBe(
      'SQ318 now leaves at 6:30pm from Terminal 3. SQ318 now arrives at Terminal 2. Your plan has been updated.'
    );
    expect(changeSentence(t, 'SQ318', now, { arrivalTime: '23:10', arrivalTerminal: '5' })).toBe(
      'SQ318 now lands at 12:40am. SQ318 now arrives at Terminal 2. Your plan has been updated.'
    );
    expect(
      changeSentence(zh, 'SQ318', now, { departureTime: '17:00', arrivalTerminal: '5' }, 'zh')
    ).toBe(
      'SQ318 现改为 6:30pm 从3 号航站楼起飞。SQ318 现改为在2 号航站楼到达。你的行程已随之更新。'
    );
  });

  it('the was line names the arrival end', () => {
    expect(wasLine(t, { arrivalTerminal: '5' })).toBe('Was arriving at Terminal 5');
    expect(wasLine(t, { departureTime: '17:00', arrivalTerminal: '5' })).toBe(
      'Was 5pm, arriving at Terminal 5'
    );
    expect(wasLine(zh, { arrivalTerminal: '5' })).toBe('原为在5 号航站楼到达');
    expect(changeNoteLine(t, { arrivalTerminal: '5' }, '2026-12-12', 'en')).toBe(
      'Changed on 12 Dec: Was arriving at Terminal 5'
    );
  });

  it('a named arrival terminal is written as the plan holds it, never as its comparison key', () => {
    const lax = { ...now, arrivalTerminal: 'TBIT' };
    expect(changeSentence(t, 'SQ318', lax, { arrivalTerminal: '5' }, 'en', false)).toBe(
      'SQ318 now arrives at TBIT.'
    );
    expect(changeSentence(zh, 'SQ318', lax, { arrivalTerminal: '5' }, 'zh', false)).toBe(
      'SQ318 现改为在TBIT到达。'
    );
    expect(wasLine(t, { arrivalTerminal: 'TBIT' })).toBe('Was arriving at TBIT');
    expect(wasLine(t, { departureTime: '17:00', arrivalTerminal: 'Tom Bradley' })).toBe(
      'Was 5pm, arriving at Tom Bradley'
    );
    expect(wasLine(zh, { arrivalTerminal: 'TBIT' })).toBe('原为在TBIT到达');
    expect(
      conflictSentence(t, {
        mine: { arrivalTerminal: 'TBIT' },
        provider: { arrivalTerminal: '4' },
        airline: 'Singapore Airlines',
      })
    ).toBe('Your plan says arriving at TBIT. Singapore Airlines says arriving at Terminal 4.');
    expect(
      conflictSentence(
        zh,
        { mine: { arrivalTerminal: 'TBIT' }, provider: { arrivalTerminal: '4' }, airline: 'SQ' },
        'zh'
      )
    ).toContain('TBIT');
    // The departure sentences keep printing the key (the Lambda's push copy restates them).
    expect(changeSentence(t, 'SQ318', { ...now, terminal: 'TBIT' }, { terminal: '2' })).toBe(
      'SQ318 now leaves from Terminal BIT. Your plan has been updated.'
    );
  });

  it('an arrival terminal the plan no longer holds is left out, never printed empty', () => {
    const cleared = { ...now, arrivalTerminal: undefined };
    // Alone, the lead still names the flight (the sentence is also the bell and OS title).
    expect(changeSentence(t, 'SQ318', cleared, { arrivalTerminal: '5' })).toBe(
      "SQ318's arrival terminal changed. Your plan has been updated."
    );
    expect(changeSentence(t, 'SQ318', cleared, { arrivalTerminal: '5' }, 'en', false)).toBe(
      "SQ318's arrival terminal changed."
    );
    expect(changeSentence(zh, 'SQ318', cleared, { arrivalTerminal: '5' }, 'zh')).toBe(
      'SQ318 的到达航站楼已变更。你的行程已随之更新。'
    );
    expect(changeSentence(zh, 'SQ318', cleared, { arrivalTerminal: '5' }, 'zh', false)).toBe(
      'SQ318 的到达航站楼已变更。'
    );
    // A blank (not just absent) arrival terminal reads the same.
    expect(
      changeSentence(t, 'SQ318', { ...now, arrivalTerminal: '  ' }, { arrivalTerminal: '5' })
    ).toBe("SQ318's arrival terminal changed. Your plan has been updated.");
    expect(
      changeSentence(t, 'SQ318', cleared, { departureTime: '17:00', arrivalTerminal: '5' })
    ).toBe('SQ318 now leaves at 6:30pm from Terminal 3. Your plan has been updated.');
    expect(
      changeSentence(zh, 'SQ318', cleared, { departureTime: '17:00', arrivalTerminal: '5' }, 'zh')
    ).toBe('SQ318 现改为 6:30pm 从3 号航站楼起飞。你的行程已随之更新。');
    expect(wasLine(t, { departureTime: '17:00', arrivalTerminal: 'Terminal' })).toBe('Was 5pm');
    for (const tr of [t, zh]) {
      for (const s of [
        changeSentence(tr, 'SQ318', cleared, { arrivalTerminal: '5' }),
        changeSentence(tr, 'SQ318', cleared, { departureTime: '17:00', arrivalTerminal: '5' }),
      ]) {
        expect(s).not.toMatch(/arrives at \.|在到达|[{}]/);
      }
    }
  });

  it('a Conflict over the arrival terminal names both sides', () => {
    expect(
      conflictSentence(t, {
        mine: { departureDate: '2026-11-09', arrivalTerminal: '5' },
        provider: { departureDate: '2026-11-09', arrivalTerminal: '2' },
        airline: 'Singapore Airlines',
      })
    ).toBe(
      'Your plan says arriving at Terminal 5. Singapore Airlines says arriving at Terminal 2.'
    );
  });
});

describe('every field has every sentence (exhaustiveness guard)', () => {
  /** An old and a new value per kind of field. */
  const VALUES: Record<TupleField, [old: string, now: string]> = {
    departureDate: ['2026-12-12', '2026-12-13'],
    departureTime: ['17:00', '18:30'],
    terminal: ['2', '3'],
    arrivalDate: ['2026-12-13', '2026-12-14'],
    arrivalTime: ['23:10', '00:40'],
    arrivalTerminal: ['1', '4'],
  };
  const shown = (tr: TranslateFn, f: TupleField, raw: string, lang: 'en' | 'zh') => {
    switch (FIELD_KIND[f]) {
      case 'date':
        return shortDate(raw, lang);
      case 'time':
        return clockTime(raw);
      case 'terminal':
        return terminalLabel(tr, raw);
    }
  };
  const NOW: ScheduleTuple = Object.fromEntries(TUPLE_FIELDS.map((f) => [f, VALUES[f][1]]));

  it.each(
    TUPLE_FIELDS.flatMap((f) =>
      (['en', 'zh'] as const).map((lang) => [f, lang] as [TupleField, 'en' | 'zh'])
    )
  )('%s (%s)', (f, lang) => {
    const tr = lang === 'en' ? t : zh;
    const [oldValue, newValue] = VALUES[f];
    const was: ScheduleTuple = { [f]: oldValue };
    const before = shown(tr, f, oldValue, lang);
    const after = shown(tr, f, newValue, lang);

    const line = wasLine(tr, was, lang);
    expect(line).not.toBe('');
    expect(line).toContain(before);

    const fill = fillNoteLine(tr, [f], { [f]: newValue }, 'Singapore Airlines', '2026-12-12', lang);
    expect(fill).toContain(after);

    const conflict = conflictSentence(
      tr,
      { mine: { [f]: oldValue }, provider: { [f]: newValue }, airline: 'Singapore Airlines' },
      lang
    );
    expect(conflict).toContain(before);
    expect(conflict).toContain(after);

    const change = changeSentence(tr, 'SQ318', NOW, was, lang);
    expect(change).toContain(after);

    for (const s of [line, fill, conflict, change]) expect(s).not.toMatch(/[{}]/);
  });
});
