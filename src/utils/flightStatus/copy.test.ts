import { describe, expect, it } from 'vitest';
import { ZH_STRINGS } from '@/services/translation/zh';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { FlightVerification } from '@/types/flightStatus';
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
  confirmsTerminal,
  hasFlightChip,
  isAlertStatus,
  conflictSentence,
  departureRowMessage,
  fillNoteLine,
  shortDate,
  terminalLabel,
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
    ).toBe('Terminal 3 added from Singapore Airlines, 12 Dec');
    expect(
      fillNoteLine(
        t,
        ['departureTime', 'terminal'],
        { departureTime: '18:30', terminal: '3' },
        'the airline',
        '2026-12-12',
        'en'
      )
    ).toBe('Departure time 6:30pm, Terminal 3 added from the airline, 12 Dec');
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

describe('confirmsTerminal', () => {
  const fresh = (terminal?: string): FlightVerification => ({
    state: 'verified',
    checkedAt: 1,
    provider: { terminal },
  });

  it('true when the latest answer agrees, however old and however the terminal is spelled', () => {
    expect(confirmsTerminal(fresh('3'), '3')).toBe(true);
    expect(confirmsTerminal({ ...fresh('2'), fresh: false }, '2')).toBe(true);
    expect(confirmsTerminal(fresh('T2'), 'Terminal 2')).toBe(true);
  });

  it('false when mismatched, without a provider terminal, or without a verification', () => {
    expect(confirmsTerminal(fresh('2'), '3')).toBe(false);
    expect(confirmsTerminal(fresh(undefined), '2')).toBe(false);
    expect(confirmsTerminal({ state: 'verified', checkedAt: 1 }, '2')).toBe(false);
    expect(confirmsTerminal({ state: 'verified', provider: { terminal: '2' } }, '2')).toBe(false);
    expect(confirmsTerminal(undefined, '2')).toBe(false);
    expect(confirmsTerminal(fresh('2'), undefined)).toBe(false);
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
