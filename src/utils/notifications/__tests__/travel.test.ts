import { describe, expect, it, vi } from 'vitest';
import type { FamilyMember } from '@/types/models';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import { t } from '@/utils/flightStatus/__tests__/fixtures';
import type { ArrivalAnnouncement } from '@/utils/flightStatus/arrivalAnnouncement';
import {
  TRAVEL_LOOKAHEAD_DAYS,
  bellTravelRange,
  deriveTravelNotifications,
  travelArrivalId,
  travelCancelId,
  travelChangeId,
  travelReminderId,
  type TravelNotificationContext,
} from '../travel';

const member = (id: string, name: string, ageGroup: 'adult' | 'child') =>
  ({ id, name, ageGroup, role: 'member' }) as FamilyMember;
const mum = member('mum', 'Jill', 'adult');
const kid = member('kid', 'Ansel', 'child');
const kid2 = member('kid2', 'Bea', 'child');
const members = [mum, kid, kid2];

const NOW = new Date('2026-12-13T12:00:00').getTime();

function ctx(viewer: FamilyMember, over: Partial<TravelNotificationContext> = {}) {
  return {
    viewer,
    resolveMember: (id: string) => members.find((m) => m.id === id),
    t,
    leads: { flight_outbound: 120 },
    inWindow: (ms: number) => ms <= NOW && ms >= NOW - 30 * 86_400_000,
    isRead: () => false,
    ...over,
  } satisfies TravelNotificationContext;
}

function occ(over: Partial<TravelSegmentOccurrence> = {}): TravelSegmentOccurrence {
  return {
    vacationId: 'vac-1',
    segmentIndex: 0,
    segmentId: 'seg-1',
    transportType: 'flight_outbound',
    kind: 'departure',
    status: 'booked',
    date: '2026-12-13',
    time: '13:00',
    title: 'SIN → LHR',
    tripAssigneeIds: ['mum', 'kid', 'kid2'],
    airline: 'Singapore Airlines (SQ)',
    flightNumber: 'SQ318',
    schedule: { departureDate: '2026-12-13', departureTime: '13:00', terminal: '3' },
    ...over,
  };
}

// Local wall-clock instants, so the suite is the same in every time zone.
const APPLIED = new Date('2026-12-13T09:00:00').toISOString();
const changedLive = {
  liveRevision: '2026-12-13|13:00|3||',
  liveWas: { departureTime: '11:30', terminal: '2', at: APPLIED },
  liveAppliedAt: APPLIED,
};

describe('departure entries', () => {
  it('fires at departure minus the device lead, under the OS reminder id', () => {
    const [n] = deriveTravelNotifications([occ()], ctx(mum));
    expect(n).toMatchObject({
      id: travelReminderId('seg-1', '2026-12-13'),
      kind: 'travel-departure',
      title: 'SIN → LHR',
      subtitle: 'SQ318',
      eventDate: '2026-12-13',
      eventTime: '13:00',
      route: '/travel',
      query: { vacation: 'vac-1' },
    });
    expect(new Date(n!.occurredAt).getTime()).toBe(new Date('2026-12-13T11:00:00').getTime());
  });

  it('uses the per-type lead, not a literal', () => {
    const [n] = deriveTravelNotifications([occ()], ctx(mum, { leads: { flight_outbound: 60 } }));
    expect(new Date(n!.occurredAt).getTime()).toBe(new Date('2026-12-13T12:00:00').getTime());
  });

  it('waits until the trigger has passed, skips untimed and arrivals', () => {
    expect(deriveTravelNotifications([occ({ time: '15:00' })], ctx(mum))).toEqual([]);
    expect(deriveTravelNotifications([occ({ time: undefined })], ctx(mum))).toEqual([]);
    expect(deriveTravelNotifications([occ({ kind: 'arrival' })], ctx(mum))).toEqual([]);
  });

  it('follows classifyAudience: a child sees only their own flight', () => {
    const solo = occ({ travellerIds: ['mum'] });
    expect(deriveTravelNotifications([solo], ctx(kid))).toEqual([]);
    expect(deriveTravelNotifications([occ({ travellerIds: ['kid'] })], ctx(kid))).toHaveLength(1);
  });
});

describe('change and cancellation entries', () => {
  it('one change entry per revision, at liveAppliedAt, alongside the departure entry', () => {
    const out = deriveTravelNotifications([occ({ live: changedLive })], ctx(mum));
    const change = out.find((n) => n.kind === 'travel-change')!;
    expect(change).toMatchObject({
      id: travelChangeId('seg-1', '2026-12-13|13:00|3||'),
      title: 'SQ318 now leaves at 1pm from Terminal 3. Your plan has been updated.',
      subtitle: 'Was 11:30am from Terminal 2',
      occurredAt: APPLIED,
      route: '/travel',
      query: { vacation: 'vac-1' },
    });
    expect(out.filter((n) => n.kind === 'travel-departure')).toHaveLength(1);
  });

  it('keys the id on the revision, so a second device a few seconds later is the same entry', () => {
    const later = {
      ...changedLive,
      liveAppliedAt: new Date(Date.parse(APPLIED) + 7000).toISOString(),
    };
    const a = deriveTravelNotifications([occ({ live: changedLive })], ctx(mum));
    const b = deriveTravelNotifications([occ({ live: later })], ctx(mum));
    expect(a.find((n) => n.kind === 'travel-change')!.id).toBe(
      b.find((n) => n.kind === 'travel-change')!.id
    );
  });

  it('a cancellation uses the travel-cancel id', () => {
    const live = {
      liveRevision: 'rev|cancelled',
      liveCancelledAt: new Date('2026-12-13T10:00:00').toISOString(),
    };
    const change = deriveTravelNotifications([occ({ live })], ctx(mum)).find(
      (n) => n.kind === 'travel-change'
    )!;
    expect(change.id).toBe(travelCancelId('seg-1', `rev|cancelled@${live.liveCancelledAt}`));
    expect(change.title).toBe(
      'Singapore Airlines cancelled SQ318 on 13 Dec. This flight is now pending.'
    );
  });

  it('cancel → reinstate → cancel again is a NEW entry (the stamp is part of the id)', () => {
    const cancelId = (liveCancelledAt: string) =>
      deriveTravelNotifications(
        [occ({ live: { liveRevision: 'rev|cancelled', liveCancelledAt } })],
        ctx(mum)
      ).find((n) => n.kind === 'travel-change')!.id;
    const first = cancelId(new Date('2026-12-13T08:00:00').toISOString());
    const again = cancelId(new Date('2026-12-13T10:00:00').toISOString());
    expect(first).not.toBe(again);
  });

  it('a reinstated flight (plain revision, liveCancelledAt kept) raises no cancel entry', () => {
    const live = {
      liveRevision: 'rev-plain',
      liveCancelledAt: new Date('2026-12-13T10:00:00').toISOString(),
    };
    const ids = deriveTravelNotifications([occ({ live })], ctx(mum)).map((n) => n.id);
    expect(ids.some((id) => id.startsWith('travel-cancel:'))).toBe(false);
  });

  it('goes to adults and a travelling child only', () => {
    const solo = occ({ live: changedLive, travellerIds: ['kid'] });
    const kinds = (v: FamilyMember) => deriveTravelNotifications([solo], ctx(v)).map((n) => n.kind);
    expect(kinds(mum)).toContain('travel-change'); // an adult at home
    expect(kinds(kid)).toContain('travel-change');
    expect(kinds(kid2)).not.toContain('travel-change');
  });

  it('respects the window and carries read state', () => {
    const old = { ...changedLive, liveAppliedAt: '2026-10-01T09:00:00.000Z' };
    expect(
      deriveTravelNotifications([occ({ live: old, time: '23:00' })], ctx(mum)).filter(
        (n) => n.kind === 'travel-change'
      )
    ).toEqual([]);
    const read = deriveTravelNotifications(
      [occ({ live: changedLive })],
      ctx(mum, { isRead: (id) => id.startsWith('travel-change:') })
    );
    expect(read.find((n) => n.kind === 'travel-change')!.read).toBe(true);
  });
});

describe('arrival entries (family flights home)', () => {
  /** Jill lands at 12:40 local; with the default one-hour lead the entry is due at 11:40. */
  const arrival = (over: Partial<ArrivalAnnouncement> = {}): ArrivalAnnouncement => ({
    segmentId: 'seg-2',
    vacationId: 'vac-1',
    names: 'Jill',
    count: 1,
    date: '2026-12-13',
    time: '12:40',
    estimated: false,
    over: false,
    flight: 'SQ317',
    airport: 'SIN',
    terminal: '1',
    ...over,
  });
  const arrivals = (a: ArrivalAnnouncement, over: Partial<TravelNotificationContext> = {}) =>
    deriveTravelNotifications([], ctx(kid, { arrivals: [a], ...over }));

  it('appears at landing minus the lead, with the reminder text, opening the flight', () => {
    const [n] = arrivals(arrival());
    expect(n).toEqual({
      id: travelArrivalId('seg-2', '2026-12-13'),
      kind: 'travel-arrival',
      title: 'Jill is scheduled to land at 12:40pm',
      subtitle: 'SQ317 · SIN Terminal 1',
      occurredAt: new Date('2026-12-13T11:40:00').toISOString(),
      eventDate: '2026-12-13',
      eventTime: '12:40',
      route: '/travel',
      query: { vacation: 'vac-1', segment: 'seg-2' },
      sourceId: 'seg-2',
      read: false,
    });
    expect(n!.id).toBe('travel-arrival:seg-2:2026-12-13');
  });

  it('says "lands at" with a live estimate', () => {
    const [n] = arrivals(arrival({ estimated: true, time: '12:50' }));
    expect(n!.title).toBe('Jill lands at 12:50pm');
  });

  it('only once its trigger has passed: the device lead moves it', () => {
    // Due at 12:10 with a 30-minute lead; NOW is 12:00.
    expect(arrivals(arrival(), { arrivalLead: 30 })).toEqual([]);
    expect(arrivals(arrival({ time: '12:30' }), { arrivalLead: 30 })).toHaveLength(1);
    // A landing outside the rolling window has no entry.
    expect(arrivals(arrival({ date: '2026-10-01' }))).toEqual([]);
  });

  it('none when the switch is off (the list is empty) or the flight is over', () => {
    expect(deriveTravelNotifications([], ctx(kid, { arrivals: [] }))).toEqual([]);
    expect(deriveTravelNotifications([], ctx(kid))).toEqual([]);
    // A flight that landed early with the app open: over, so it does not stay in the bell.
    expect(arrivals(arrival({ over: true }))).toEqual([]);
  });

  it('marked read, it stays read when the time moves within the day; a new day is a new entry', () => {
    const [before] = arrivals(arrival());
    const read = new Set([before!.id]);
    const isRead = (id: string) => read.has(id);
    const [sameDay] = arrivals(arrival({ estimated: true, time: '12:20' }), { isRead });
    expect(sameDay!.id).toBe(before!.id);
    expect(sameDay!.read).toBe(true);
    const [nextDay] = arrivals(arrival({ estimated: true, date: '2026-12-14' }), {
      isRead,
      inWindow: () => true,
    });
    expect(nextDay!.id).not.toBe(before!.id);
    expect(nextDay!.read).toBe(false);
  });

  it('an announcement that throws is skipped, never aborting the others', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = arrival({ segmentId: 'seg-bad' });
    Object.defineProperty(bad, 'over', {
      get() {
        throw new Error('boom');
      },
    });
    const out = deriveTravelNotifications([], ctx(kid, { arrivals: [bad, arrival()] }));
    expect(out.map((n) => n.id)).toEqual([travelArrivalId('seg-2', '2026-12-13')]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('seg-bad'), expect.any(Error));
    warn.mockRestore();
  });
});

describe('bellTravelRange', () => {
  it('back the rolling window, ahead the travel look-ahead', () => {
    const now = new Date('2026-12-13T12:00:00').getTime();
    expect(bellTravelRange(now, 30)).toEqual({ from: '2026-11-13', to: '2027-01-12' });
    expect(TRAVEL_LOOKAHEAD_DAYS).toBe(30);
  });
});
