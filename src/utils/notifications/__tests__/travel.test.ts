import { describe, expect, it } from 'vitest';
import type { FamilyMember } from '@/types/models';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import { t } from '@/utils/flightStatus/__tests__/fixtures';
import {
  deriveTravelNotifications,
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
