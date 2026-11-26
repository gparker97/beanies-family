import { describe, expect, it } from 'vitest';
import type { FlightLeg, ScheduleTuple } from '@/types/flightStatus';
import type { SegmentLiveState, VacationTravelSegment } from '@/types/models';
import { liveNoticeId } from '@/utils/notifications/travel';
import {
  FIELD_KIND,
  LIVE_FIELD_ROLE,
  LIVE_STATE_FIELDS,
  REVISION_FIELDS,
  TUPLE_FIELDS,
  arrivalTerminalRecord,
  changeNoticeRevision,
  classifyDiff,
  diffTuple,
  liveRecordOf,
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
  arr: { local: string; iata?: string; terminal?: string }
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
    arrival: {
      iata: arr.iata ?? 'LHR',
      scheduledLocal: arr.local,
      terminal: arr.terminal,
      quality: [],
    },
  };
}

describe('the field lists', () => {
  it('REVISION_FIELDS is the frozen five, in revision order (a persisted format)', () => {
    expect([...REVISION_FIELDS]).toEqual([
      'departureDate',
      'departureTime',
      'terminal',
      'arrivalDate',
      'arrivalTime',
    ]);
  });

  it('TUPLE_FIELDS is the five plus the arrival terminal, and every field has a kind', () => {
    expect([...TUPLE_FIELDS]).toEqual([...REVISION_FIELDS, 'arrivalTerminal']);
    expect(Object.keys(FIELD_KIND).sort()).toEqual([...TUPLE_FIELDS].sort());
    expect(FIELD_KIND.arrivalTerminal).toBe('terminal');
  });
});

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
        arrivalTerminal: ' 5 ',
      })
    ).toEqual({
      departureDate: '2026-12-13',
      departureTime: '09:05',
      terminal: 'Terminal 2',
      arrivalDate: '2026-12-14',
      arrivalTime: '05:40',
      arrivalTerminal: '5',
    });
    expect('arrivalTerminal' in tupleFromSegment({ arrivalTerminal: '  ' })).toBe(false);
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

  it('splits departure and arrival local times and keeps the raw terminals', () => {
    expect(tupleFromLeg(l1)).toEqual({
      departureDate: '2026-12-13',
      departureTime: '23:05',
      terminal: '3',
      arrivalDate: '2026-12-14',
      arrivalTime: '05:40',
    });
    const withArrival = leg(
      { local: '2026-12-13 23:05+08:00', terminal: '3' },
      { local: '2026-12-14 05:40+00:00', terminal: ' T2 ' }
    );
    expect(tupleFromLeg(withArrival).arrivalTerminal).toBe('T2');
  });

  it('takes the arrival half, terminal included, from a later sector of a multi-stop number', () => {
    const l2 = leg(
      { local: '2026-12-14 08:00+01:00', iata: 'FRA', terminal: '1' },
      { local: '2026-12-14 11:10-05:00', iata: 'JFK', terminal: '4' }
    );
    expect(tupleFromLeg(l1, l2)).toMatchObject({
      terminal: '3',
      arrivalDate: '2026-12-14',
      arrivalTime: '11:10',
      arrivalTerminal: '4',
    });
  });

  it('leaves the arrival half (and its terminal) undefined when arrivalLeg is null', () => {
    const withArrival = leg(
      { local: '2026-12-13 23:05+08:00', terminal: '3' },
      { local: '2026-12-14 05:40+00:00', terminal: '2' }
    );
    const t = tupleFromLeg(withArrival, null);
    expect(t.arrivalDate).toBeUndefined();
    expect(t.arrivalTime).toBeUndefined();
    expect(t.arrivalTerminal).toBeUndefined();
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
    expect(tupleFromWas({ arrivalTerminal: '2', at: '2026-12-10T00:00:00Z' })).toEqual({
      arrivalTerminal: '2',
    });
    expect(tupleFromWas({ at: '2026-12-10T00:00:00Z' })).toEqual({});
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

  it.each(TUPLE_FIELDS)('a different %s is a difference', (field) => {
    const other = { date: '2026-12-15', time: '18:30', terminal: '9' }[FIELD_KIND[field]];
    expect(tuplesEqual({ ...mine, arrivalTerminal: '2' }, { ...mine, [field]: other })).toBe(false);
  });

  it('both terminals compare across spellings (never a date comparison)', () => {
    for (const f of ['terminal', 'arrivalTerminal'] as const) {
      expect(tuplesEqual({ [f]: 'T2' }, { [f]: 'Terminal 2' })).toBe(true);
      expect(diffTuple({ [f]: '2' }, { [f]: 't 2' })).toEqual({ changed: [], filled: [] });
      expect(diffTuple({ [f]: '2' }, { [f]: '3' }).changed).toEqual([f]);
    }
  });

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

  it('ignores the arrival terminal: byte-identical with or without it', () => {
    const tuples: ScheduleTuple[] = [
      {},
      { departureDate: '2026-12-13', departureTime: '18:30' },
      {
        departureDate: '2026-12-13',
        departureTime: '18:30',
        terminal: 'Terminal 3',
        arrivalDate: '2026-12-14',
        arrivalTime: '00:40',
      },
      { arrivalDate: '2026-12-14', arrivalTime: '6:40' },
    ];
    for (const tuple of tuples) {
      for (const arrivalTerminal of ['2', 'T5', 'Tom Bradley', '']) {
        expect(revisionOf({ ...tuple, arrivalTerminal })).toBe(revisionOf(tuple));
      }
    }
    expect(
      revisionOf({
        departureDate: '2026-12-13',
        departureTime: '18:30',
        terminal: '3',
        arrivalDate: '2026-12-14',
        arrivalTime: '00:40',
        arrivalTerminal: '2',
      })
    ).toBe('2026-12-13|18:30|3|2026-12-14|00:40');
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

  it('copies exactly the five live fields, liveWas by value', () => {
    const liveWas = { departureTime: '17:00', arrivalTerminal: '2', at: '2026-12-10T00:00:00Z' };
    const seg = {
      liveRevision: 'r',
      liveArrivalTerminal: '3',
      liveWas,
      liveAppliedAt: '2026-12-10T00:00:00Z',
      liveCancelledAt: '2026-12-11T00:00:00Z',
      title: 'not copied',
    };
    const out = pickLiveState(seg);
    expect(out).toEqual({
      liveRevision: 'r',
      liveArrivalTerminal: '3',
      liveWas,
      liveAppliedAt: '2026-12-10T00:00:00Z',
      liveCancelledAt: '2026-12-11T00:00:00Z',
    });
    expect(out!.liveWas).not.toBe(liveWas);
    expect(Object.keys(out!).sort()).toEqual([...LIVE_STATE_FIELDS].sort());
  });

  it('a segment holding only the arrival terminal record is not empty', () => {
    expect(pickLiveState({ liveArrivalTerminal: '2' })).toEqual({ liveArrivalTerminal: '2' });
  });

  it("the occurrence's live state gives the segment's own notice id (bell, OS, dismiss key)", () => {
    const seg: SegmentLiveState = {
      liveRevision: '2026-12-13|17:00|2|2026-12-13|23:10',
      liveArrivalTerminal: '3',
      liveWas: { arrivalTerminal: '2', at: '2026-12-12T08:48:00.000Z' },
      liveAppliedAt: '2026-12-12T08:48:00.000Z',
    };
    const id = liveNoticeId('seg-1', seg);
    expect(id).toBe('travel-change:seg-1:2026-12-13|17:00|2|2026-12-13|23:10~3');
    expect(liveNoticeId('seg-1', pickLiveState(seg))).toBe(id);
  });
});

describe('liveRecordOf: the plan record a cached answer must have been seen beside', () => {
  const full: SegmentLiveState = {
    liveRevision: '2026-12-13|17:00|2|2026-12-13|23:10',
    liveArrivalTerminal: 'SQ318|2026-12-13|3',
    liveWas: { departureTime: '16:00', at: '2026-12-10T00:00:00.000Z' },
    liveAppliedAt: '2026-12-10T00:00:00.000Z',
    liveCancelledAt: '2026-12-11T00:00:00.000Z',
  };

  it('classifies every live field, and liveWas is the only detail', () => {
    expect(Object.keys(LIVE_FIELD_ROLE).sort()).toEqual([...LIVE_STATE_FIELDS].sort());
    expect(LIVE_STATE_FIELDS.filter((f) => LIVE_FIELD_ROLE[f] === 'detail')).toEqual(['liveWas']);
  });

  it('joins the record fields in LIVE_STATE_FIELDS order with §, empty for an absent one', () => {
    expect(liveRecordOf(full)).toBe(
      [full.liveRevision, full.liveArrivalTerminal, full.liveAppliedAt, full.liveCancelledAt].join(
        '§'
      )
    );
    expect(liveRecordOf({})).toBe('§§§');
    expect(liveRecordOf({ liveArrivalTerminal: 'SQ318|2026-12-13|3' })).toBe(
      '§SQ318|2026-12-13|3§§'
    );
    // Not a segment field: ignored.
    expect(liveRecordOf({ ...full, title: 'x' } as SegmentLiveState)).toBe(liveRecordOf(full));
  });

  it('a change to any record field alone changes it; a change to liveWas alone never does', () => {
    for (const f of LIVE_STATE_FIELDS) {
      if (f === 'liveWas') continue;
      expect(liveRecordOf({ ...full, [f]: `${full[f] as string}x` })).not.toBe(liveRecordOf(full));
      expect(liveRecordOf({ ...full, [f]: undefined })).not.toBe(liveRecordOf(full));
    }
    for (const liveWas of [
      undefined,
      { at: '2027-01-01T00:00:00.000Z' },
      { terminal: '9', at: 'x' },
    ]) {
      expect(liveRecordOf({ ...full, liveWas })).toBe(liveRecordOf(full));
    }
  });

  it('a record that goes away and comes back (cancel, reinstate, cancel again) is a new record', () => {
    const cancelRev = `${full.liveRevision}|cancelled`;
    const first = { liveRevision: cancelRev, liveCancelledAt: '2026-12-11T00:00:00.000Z' };
    const reinstated = { ...first, liveRevision: full.liveRevision };
    const again = { liveRevision: cancelRev, liveCancelledAt: '2026-12-12T00:00:00.000Z' };
    expect(new Set([first, reinstated, again].map(liveRecordOf)).size).toBe(3);
  });
});

describe('classifyDiff: which differences the plan still owes the airline', () => {
  /** The booked flight, as `makeFlight()` holds it. */
  const plan = {
    departureDate: '2026-12-13',
    departureTime: '17:00',
    terminal: 'Terminal 2',
    arrivalDate: '2026-12-13',
    arrivalTime: '23:10',
  };
  const REV = revisionOf(plan);
  const seg = (over: Partial<VacationTravelSegment> = {}) => ({
    airline: 'Singapore Airlines (SQ)',
    flightNumber: 'SQ318',
    ...plan,
    ...over,
  });
  /** The record of SQ318's arrival terminal on the booked day. */
  const rec = (terminal: string) => `SQ318|2026-12-13|${terminal}`;

  it('a first answer owes every difference: a move is changed, a value the plan lacks is filled', () => {
    expect(classifyDiff(seg(), { ...plan, departureTime: '18:30', arrivalTerminal: '2' })).toEqual({
      changed: ['departureTime'],
      filled: ['arrivalTerminal'],
      contested: [],
    });
  });

  it('an existing flight with a 5-part revision and no arrival terminal owes only the fill', () => {
    expect(classifyDiff(seg({ liveRevision: REV }), { ...plan, arrivalTerminal: '2' })).toEqual({
      changed: [],
      filled: ['arrivalTerminal'],
      contested: [],
    });
  });

  it('(a) a Conflict over a hand-edited time still takes its first arrival terminal', () => {
    expect(
      classifyDiff(seg({ liveRevision: REV, departureTime: '19:00' }), {
        ...plan,
        arrivalTerminal: '2',
      })
    ).toEqual({ changed: [], filled: ['arrivalTerminal'], contested: ['departureTime'] });
  });

  it('(b) the airline dropping its arrival terminal owes nothing', () => {
    expect(
      classifyDiff(
        seg({ liveRevision: REV, arrivalTerminal: '2', liveArrivalTerminal: rec('2') }),
        plan
      )
    ).toEqual({ changed: [], filled: [], contested: [] });
  });

  it('(c) a reverted arrival terminal stays contested when the departure time later moves', () => {
    expect(
      classifyDiff(
        seg({ liveRevision: REV, arrivalTerminal: '2', liveArrivalTerminal: rec('3') }),
        {
          ...plan,
          departureTime: '18:30',
          arrivalTerminal: 'T3',
        }
      )
    ).toEqual({ changed: ['departureTime'], filled: [], contested: ['arrivalTerminal'] });
  });

  it('a moved arrival terminal is owed until it is recorded, whatever the revision says', () => {
    const recorded = seg({
      liveRevision: REV,
      arrivalTerminal: '2',
      liveArrivalTerminal: rec('2'),
    });
    expect(classifyDiff(recorded, { ...plan, arrivalTerminal: '3' })).toEqual({
      changed: ['arrivalTerminal'],
      filled: [],
      contested: [],
    });
    expect(
      classifyDiff(
        { ...recorded, arrivalTerminal: '3', liveArrivalTerminal: rec('3') },
        {
          ...plan,
          arrivalTerminal: 'Terminal 3',
        }
      )
    ).toEqual({ changed: [], filled: [], contested: [] });
  });

  it('a hand edit of a recorded arrival terminal is the Conflict', () => {
    expect(
      classifyDiff(
        seg({ liveRevision: REV, arrivalTerminal: '5', liveArrivalTerminal: rec('2') }),
        {
          ...plan,
          arrivalTerminal: '2',
        }
      )
    ).toEqual({ changed: [], filled: [], contested: ['arrivalTerminal'] });
  });

  it('for the five revision fields it is the old rule: owed exactly when the revision differs', () => {
    const provider = { ...plan, departureTime: '18:30', terminal: '3' };
    const owed = classifyDiff(seg(), provider);
    expect(owed).toEqual({ changed: ['departureTime', 'terminal'], filled: [], contested: [] });
    const acted = classifyDiff(seg({ liveRevision: revisionOf(provider) }), provider);
    expect(acted).toEqual({ changed: [], filled: [], contested: ['departureTime', 'terminal'] });
  });
});

describe('changeNoticeRevision', () => {
  const REV = '2026-12-13|17:00|2|2026-12-13|23:10';

  it('is the revision, plus the arrival terminal only when it moved', () => {
    expect(changeNoticeRevision(REV, '3', undefined)).toBe(REV);
    const departureOnly: ScheduleTuple = { departureTime: '17:00' };
    expect(changeNoticeRevision(REV, '3', departureOnly)).toBe(REV);
    expect(changeNoticeRevision(REV, '3', { arrivalTerminal: '2' })).toBe(`${REV}~3`);
    expect(changeNoticeRevision(REV, undefined, { arrivalTerminal: '2' })).toBe(`${REV}~`);
  });
});

describe('arrivalTerminalRecord: the arrival terminal, scoped to the flight', () => {
  const flight = { airline: 'Singapore Airlines (SQ)', flightNumber: 'SQ 0318' };

  it("the segment's number, the airline's day and the terminal key", () => {
    expect(
      arrivalTerminalRecord(flight, { departureDate: '2026-12-13', arrivalTerminal: 'Terminal 2' })
    ).toBe('SQ318|2026-12-13|2');
    expect(
      arrivalTerminalRecord(flight, { departureDate: '2026-12-13', arrivalTerminal: 'T2' })
    ).toBe(arrivalTerminalRecord(flight, { departureDate: '2026-12-13', arrivalTerminal: '2' }));
    expect(arrivalTerminalRecord({}, { departureDate: '2026-12-13', arrivalTerminal: '2' })).toBe(
      '|2026-12-13|2'
    );
  });

  it('a new number or day is a new record', () => {
    const base = arrivalTerminalRecord(flight, {
      departureDate: '2026-12-13',
      arrivalTerminal: '2',
    });
    expect(
      arrivalTerminalRecord(
        { ...flight, flightNumber: 'SQ322' },
        { departureDate: '2026-12-13', arrivalTerminal: '2' }
      )
    ).not.toBe(base);
    expect(
      arrivalTerminalRecord(flight, { departureDate: '2026-12-14', arrivalTerminal: '2' })
    ).not.toBe(base);
  });

  it('undefined with no terminal key, or no departure day', () => {
    for (const arrivalTerminal of [undefined, '', 'Terminal']) {
      expect(
        arrivalTerminalRecord(flight, { departureDate: '2026-12-13', arrivalTerminal })
      ).toBeUndefined();
    }
    expect(arrivalTerminalRecord(flight, { arrivalTerminal: '2' })).toBeUndefined();
  });
});

describe('tupleFromLeg: an arrival terminal with no key is not stated', () => {
  const terminals = (dep: string, arr: string) =>
    tupleFromLeg(
      leg(
        { local: '2026-12-13 17:00+08:00', terminal: dep },
        { local: '2026-12-13 23:10+00:00', terminal: arr }
      )
    );

  it('the bare word "Terminal" on arrival is read as no arrival terminal', () => {
    expect(terminals('2', 'Terminal').arrivalTerminal).toBeUndefined();
    expect(terminals('2', ' terminal ').arrivalTerminal).toBeUndefined();
    expect(terminals('2', 'T2').arrivalTerminal).toBe('T2');
  });

  it('so an untouched plan with none owes and contests nothing', () => {
    const plan = {
      airline: 'Singapore Airlines (SQ)',
      flightNumber: 'SQ318',
      departureDate: '2026-12-13',
      departureTime: '17:00',
      terminal: '2',
      arrivalDate: '2026-12-13',
      arrivalTime: '23:10',
    };
    const provider = terminals('2', 'Terminal');
    expect(classifyDiff({ ...plan, liveRevision: revisionOf(provider) }, provider)).toEqual({
      changed: [],
      filled: [],
      contested: [],
    });
  });

  it('the departure terminal is read as written (it is part of the revision)', () => {
    expect(terminals('Terminal', '2').terminal).toBe('Terminal');
  });
});
