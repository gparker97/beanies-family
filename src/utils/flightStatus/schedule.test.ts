import { describe, expect, it } from 'vitest';
import type { FlightLeg } from '@/types/flightStatus';
import {
  diffTuple,
  normaliseTerminal,
  parseUtcMs,
  pickLiveState,
  revisionOf,
  splitLocal,
  tupleFromLeg,
  tupleFromSegment,
  tupleFromWas,
  tuplesEqual,
} from './schedule';

function leg(
  dep: { local: string; terminal?: string; iata?: string },
  arr: { local: string; iata?: string }
): FlightLeg {
  return {
    number: 'SQ 318',
    status: 'Expected',
    codeshareStatus: 'IsOperator',
    isCargo: false,
    departure: {
      iata: dep.iata ?? 'SIN',
      scheduledLocal: dep.local,
      terminal: dep.terminal,
      quality: [],
    },
    arrival: { iata: arr.iata ?? 'LHR', scheduledLocal: arr.local, quality: [] },
  };
}

describe('parseUtcMs', () => {
  it('reads a value that names its zone', () => {
    expect(parseUtcMs('2026-12-13 15:05Z')).toBe(Date.parse('2026-12-13T15:05:00Z'));
    expect(parseUtcMs('2026-12-13T23:05+08:00')).toBe(Date.parse('2026-12-13T15:05:00Z'));
  });

  it('is null without a zone designator (never device-local), or for junk', () => {
    expect(parseUtcMs('2026-12-13 15:05')).toBeNull();
    expect(parseUtcMs('2026-12-13')).toBeNull();
    expect(parseUtcMs('soon Z')).toBeNull();
    expect(parseUtcMs('')).toBeNull();
    expect(parseUtcMs(undefined)).toBeNull();
  });
});

describe('splitLocal', () => {
  it.each([
    ['2026-12-13 23:05+08:00', '2026-12-13', '23:05'],
    ['2026-12-13T23:05+08:00', '2026-12-13', '23:05'],
    ['2026-12-13T23:05:00+08:00', '2026-12-13', '23:05'],
    ['2026-12-13 23:05:00.000+0800', '2026-12-13', '23:05'],
    ['2026-12-14 05:40-05:00', '2026-12-14', '05:40'],
    ['2026-12-13 15:05Z', '2026-12-13', '15:05'],
    ['2026-12-13T15:05', '2026-12-13', '15:05'],
  ])('%s → %s %s (wall clock as written, offset ignored)', (input, date, time) => {
    expect(splitLocal(input)).toEqual({ date, time });
  });

  it.each(['', '2026-12-13', '23:05', '2026-12-13 25:00+08:00', 'tomorrow', undefined])(
    'null for %s',
    (input) => {
      expect(splitLocal(input)).toBeNull();
    }
  );
});

describe('normaliseTerminal', () => {
  it('treats T2, 2, Terminal 2 and terminal 2 as one terminal', () => {
    const forms = ['T2', '2', 'Terminal 2', 'terminal 2', ' t 2 ', 'Terminal T2'];
    expect(new Set(forms.map(normaliseTerminal))).toEqual(new Set(['2']));
  });

  it('keeps letters and suffixes', () => {
    expect(normaliseTerminal('Terminal 3E')).toBe('3E');
    expect(normaliseTerminal('B')).toBe('B');
  });

  it('undefined for empty', () => {
    expect(normaliseTerminal('')).toBeUndefined();
    expect(normaliseTerminal('Terminal')).toBeUndefined();
    expect(normaliseTerminal(undefined)).toBeUndefined();
  });
});

describe('tupleFromSegment', () => {
  it('copies and canonicalises the schedule fields', () => {
    expect(
      tupleFromSegment({
        departureDate: '2026-12-13',
        departureTime: '9:05',
        terminal: ' Terminal 2 ',
        arrivalDate: '2026-12-14',
        arrivalTime: '05:40:00',
      })
    ).toEqual({
      departureDate: '2026-12-13',
      departureTime: '09:05',
      terminal: 'Terminal 2',
      arrivalDate: '2026-12-14',
      arrivalTime: '05:40',
    });
  });

  it('derives a missing arrival date from arrivesNextDay (legacy segments)', () => {
    const base = { departureDate: '2026-12-31', departureTime: '23:05', arrivalTime: '05:40' };
    expect(tupleFromSegment({ ...base, arrivesNextDay: true }).arrivalDate).toBe('2027-01-01');
    expect(tupleFromSegment(base).arrivalDate).toBe('2026-12-31');
  });

  it('omits fields the segment does not have', () => {
    expect(tupleFromSegment({ departureDate: '2026-12-13' })).toEqual({
      departureDate: '2026-12-13',
    });
  });
});

describe('tupleFromLeg', () => {
  const l1 = leg(
    { local: '2026-12-13 23:05+08:00', terminal: '3' },
    { local: '2026-12-14 05:40+00:00' }
  );

  it('splits departure and arrival local times and keeps the raw terminal', () => {
    expect(tupleFromLeg(l1)).toEqual({
      departureDate: '2026-12-13',
      departureTime: '23:05',
      terminal: '3',
      arrivalDate: '2026-12-14',
      arrivalTime: '05:40',
    });
  });

  it('takes the arrival half from a later sector of a multi-stop number', () => {
    const l2 = leg(
      { local: '2026-12-14 08:00+01:00', iata: 'FRA' },
      { local: '2026-12-14 11:10-05:00', iata: 'JFK' }
    );
    expect(tupleFromLeg(l1, l2)).toMatchObject({ arrivalDate: '2026-12-14', arrivalTime: '11:10' });
  });

  it('leaves the arrival half undefined when arrivalLeg is null', () => {
    const t = tupleFromLeg(l1, null);
    expect(t.arrivalDate).toBeUndefined();
    expect(t.arrivalTime).toBeUndefined();
    expect(t.departureTime).toBe('23:05');
  });

  it('leaves terminal undefined when the provider publishes none', () => {
    const noTerm = leg({ local: '2026-12-13 23:05+08:00' }, { local: '2026-12-14 05:40+00:00' });
    expect('terminal' in tupleFromLeg(noTerm)).toBe(false);
  });
});

describe('tupleFromWas', () => {
  it('drops `at` and undefined fields', () => {
    expect(
      tupleFromWas({ departureTime: '17:00', terminal: '2', at: '2026-12-10T00:00:00Z' })
    ).toEqual({ departureTime: '17:00', terminal: '2' });
    expect(tupleFromWas(undefined)).toBeUndefined();
  });
});

describe('tuplesEqual', () => {
  const mine = {
    departureDate: '2026-12-13',
    departureTime: '23:05',
    terminal: 'Terminal 3',
    arrivalDate: '2026-12-14',
    arrivalTime: '05:40',
  };

  it('equal across terminal spellings and time padding', () => {
    expect(tuplesEqual(mine, { ...mine, terminal: 'T3', departureTime: '23:05' })).toBe(true);
    expect(
      tuplesEqual({ ...mine, departureTime: '9:05' }, { ...mine, departureTime: '09:05' })
    ).toBe(true);
  });

  it.each(['departureDate', 'departureTime', 'terminal', 'arrivalDate', 'arrivalTime'] as const)(
    'a different %s is a difference',
    (field) => {
      const changed = {
        ...mine,
        [field]: field.endsWith('Date') ? '2026-12-15' : field === 'terminal' ? '2' : '18:30',
      };
      expect(tuplesEqual(mine, changed)).toBe(false);
    }
  );

  it('skips a field the provider leaves undefined (never erases the family terminal)', () => {
    const { terminal: _t, arrivalDate: _d, arrivalTime: _a, ...provider } = mine;
    expect(tuplesEqual(mine, provider)).toBe(true);
  });

  it('a field the provider states and the segment lacks is a difference', () => {
    const { terminal: _t, ...noTerminal } = mine;
    expect(tuplesEqual(noTerminal, mine)).toBe(false);
  });
});

describe('diffTuple', () => {
  const mine = {
    departureDate: '2026-12-13',
    departureTime: '17:00',
    terminal: 'Terminal 2',
    arrivalDate: '2026-12-13',
    arrivalTime: '23:10',
  };

  it('empty for an equal schedule, across spellings', () => {
    expect(diffTuple(mine, { ...mine, terminal: 'T2' })).toEqual({ changed: [], filled: [] });
  });

  it('changed = the segment had a value and the provider differs, in field order', () => {
    expect(
      diffTuple(mine, { ...mine, terminal: '3', departureTime: '18:30', arrivalTime: '00:40' })
    ).toEqual({ changed: ['departureTime', 'terminal', 'arrivalTime'], filled: [] });
  });

  it('filled = the segment had no value and the provider states one', () => {
    const { terminal: _t, ...noTerminal } = mine;
    expect(diffTuple(noTerminal, { ...mine, terminal: '3' })).toEqual({
      changed: [],
      filled: ['terminal'],
    });
  });

  it('a provider-undefined field is in neither list', () => {
    const { terminal: _t, arrivalDate: _d, arrivalTime: _a, ...provider } = mine;
    expect(diffTuple({ departureDate: '2026-12-13' }, provider)).toEqual({
      changed: [],
      filled: ['departureTime'],
    });
  });

  it('agrees with tuplesEqual', () => {
    const cases = [
      [mine, mine],
      [mine, { ...mine, departureTime: '18:30' }],
      [{ departureDate: '2026-12-13' }, mine],
      [mine, { departureDate: '2026-12-13' }],
    ] as const;
    for (const [a, b] of cases) {
      const d = diffTuple(a, b);
      expect(d.changed.length + d.filled.length === 0).toBe(tuplesEqual(a, b));
    }
  });
});

describe('revisionOf', () => {
  it('is the canonical joined tuple', () => {
    expect(
      revisionOf({
        departureDate: '2026-12-13',
        departureTime: '18:30',
        terminal: 'Terminal 3',
        arrivalDate: '2026-12-14',
        arrivalTime: '00:40',
      })
    ).toBe('2026-12-13|18:30|3|2026-12-14|00:40');
  });

  it("writes '' for undefined fields", () => {
    expect(revisionOf({ departureDate: '2026-12-13', departureTime: '18:30' })).toBe(
      '2026-12-13|18:30|||'
    );
  });

  it('is stable across spellings of the same schedule', () => {
    const a = revisionOf({ departureDate: '2026-12-13', departureTime: '9:05', terminal: 'T2' });
    const b = revisionOf({
      departureDate: '2026-12-13',
      departureTime: '09:05',
      terminal: 'Terminal 2',
    });
    expect(a).toBe(b);
  });

  it('a terminal that appears later is a new revision', () => {
    const before = revisionOf({ departureDate: '2026-12-13', departureTime: '18:30' });
    const after = revisionOf({
      departureDate: '2026-12-13',
      departureTime: '18:30',
      terminal: '3',
    });
    expect(after).not.toBe(before);
  });

  it('the leg and the segment holding the same schedule share one revision', () => {
    const l = leg(
      { local: '2026-12-13 23:05+08:00', terminal: '3' },
      { local: '2026-12-14 05:40+00:00' }
    );
    const seg = tupleFromSegment({
      departureDate: '2026-12-13',
      departureTime: '23:05',
      terminal: 'Terminal 3',
      arrivalDate: '2026-12-14',
      arrivalTime: '05:40',
    });
    expect(revisionOf(tupleFromLeg(l))).toBe(revisionOf(seg));
  });
});

describe('pickLiveState', () => {
  it('undefined when the segment carries no live fields', () => {
    expect(pickLiveState({})).toBeUndefined();
  });

  it('copies exactly the four live fields, liveWas by value', () => {
    const liveWas = { departureTime: '17:00', at: '2026-12-10T00:00:00Z' };
    const seg = {
      liveRevision: 'r',
      liveWas,
      liveAppliedAt: '2026-12-10T00:00:00Z',
      liveCancelledAt: '2026-12-11T00:00:00Z',
      title: 'not copied',
    };
    const out = pickLiveState(seg);
    expect(out).toEqual({
      liveRevision: 'r',
      liveWas,
      liveAppliedAt: '2026-12-10T00:00:00Z',
      liveCancelledAt: '2026-12-11T00:00:00Z',
    });
    expect(out!.liveWas).not.toBe(liveWas);
  });
});
