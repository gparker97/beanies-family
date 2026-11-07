import { describe, expect, it } from 'vitest';
import type { FamilyMember } from '@/types/models';
import type { FlightVerification } from '@/types/flightStatus';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import { t } from '@/utils/flightStatus/__tests__/fixtures';
import { buildTravelBriefingRows, type TravelRowsContext } from '../travelRows';

const member = (id: string, name: string, ageGroup: 'adult' | 'child', isPet = false) =>
  ({ id, name, ageGroup, role: 'member', isPet }) as FamilyMember;
const mum = member('mum', 'Jill', 'adult');
const dad = member('dad', 'Sam', 'adult');
const kid = member('kid', 'Ansel', 'child');
const kid2 = member('kid2', 'Bea', 'child');
const members = [mum, dad, kid, kid2];

const NOW = Date.parse('2026-12-13T08:00:00Z');

function occ(over: Partial<TravelSegmentOccurrence> = {}): TravelSegmentOccurrence {
  return {
    vacationId: 'vac-1',
    segmentIndex: 0,
    segmentId: 'seg-1',
    transportType: 'flight_outbound',
    kind: 'departure',
    status: 'booked',
    date: '2026-12-13',
    time: '17:00',
    title: 'SIN → LHR',
    tripAssigneeIds: ['mum', 'dad', 'kid', 'kid2'],
    airline: 'Singapore Airlines (SQ)',
    flightNumber: 'SQ318',
    schedule: { departureDate: '2026-12-13', departureTime: '17:00', terminal: '2' },
    ...over,
  };
}

function ctx(viewer: FamilyMember, over: Partial<TravelRowsContext> = {}): TravelRowsContext {
  return {
    today: '2026-12-13',
    nowMs: NOW,
    viewer,
    members,
    resolveMember: (id) => members.find((m) => m.id === id),
    t,
    verificationFor: () => undefined,
    ...over,
  };
}

const verified = (live: FlightVerification['live'] = {}): FlightVerification => ({
  state: 'verified',
  checkedAt: NOW - 12 * 60_000,
  live,
});

describe('plain departure row', () => {
  it('names everyone when the whole family flies, with flight, terminal and "checked" caption', () => {
    const rows = buildTravelBriefingRows([occ()], ctx(mum, { verificationFor: () => verified() }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'travel-departure:seg-1',
      type: 'travel',
      message: 'Everyone flies at 5pm today',
      caption: 'SQ318 · Terminal 2 · Checked 12 min ago',
      time: '17:00',
      route: { path: '/travel', query: { vacation: 'vac-1' } },
    });
  });

  it('adds the live gate when the airline published one', () => {
    const [row] = buildTravelBriefingRows(
      [occ()],
      ctx(mum, { verificationFor: () => verified({ gate: 'B12' }) })
    );
    expect(row!.caption).toBe('SQ318 · Terminal 2 · Checked 12 min ago · Gate B12');
  });

  it('says "Not checked live" for a train, and uses the leaves verb', () => {
    const [row] = buildTravelBriefingRows(
      [occ({ transportType: 'train', airline: undefined, flightNumber: undefined, schedule: {} })],
      ctx(mum)
    );
    expect(row!.message).toBe('Everyone leaves at 5pm today');
    expect(row!.caption).toBe('Not checked live');
  });

  it('names the travellers when only some fly, and hides it from the others', () => {
    const o = occ({ travellerIds: ['mum', 'kid'] });
    const [row] = buildTravelBriefingRows([o], ctx(mum));
    expect(row!.message).toBe('Jill & Ansel fly at 5pm today');
    expect(buildTravelBriefingRows([o], ctx(dad))).toEqual([]); // a parent owns it: assignees only
    expect(buildTravelBriefingRows([o], ctx(kid2))).toEqual([]);
  });

  it("shows an adult a child's solo flight by the child's name", () => {
    const [row] = buildTravelBriefingRows([occ({ travellerIds: ['kid'] })], ctx(dad));
    expect(row!.message).toBe('Ansel flies at 5pm today');
  });

  it('skips an untimed departure, an arrival, and another day', () => {
    expect(buildTravelBriefingRows([occ({ time: undefined })], ctx(mum))).toEqual([]);
    expect(buildTravelBriefingRows([occ({ kind: 'arrival' })], ctx(mum))).toEqual([]);
    expect(buildTravelBriefingRows([occ({ date: '2026-12-14' })], ctx(mum))).toEqual([]);
  });
});

describe('change and cancellation rows replace the plain row', () => {
  const changed = occ({
    time: '18:30',
    schedule: { departureDate: '2026-12-13', departureTime: '18:30', terminal: '3' },
    live: {
      liveRevision: '2026-12-13|18:30|3||',
      liveWas: { departureTime: '17:00', terminal: '2', at: '2026-12-12T10:00:00.000Z' },
      liveAppliedAt: '2026-12-12T10:00:00.000Z',
    },
  });

  it('one row, the change sentence, "was" caption, keyed on the revision', () => {
    const rows = buildTravelBriefingRows([changed], ctx(mum));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'travel-changed:seg-1:2026-12-13|18:30|3||',
      message: 'SQ318 now leaves at 6:30pm from Terminal 3. Your plan has been updated.',
      caption: 'SQ318 · Was 5pm from Terminal 2',
      icon: '🔄',
    });
  });

  it('goes to every adult, plus a travelling child, not to a child who is not on it', () => {
    const solo = { ...changed, travellerIds: ['kid'] };
    expect(buildTravelBriefingRows([solo], ctx(dad))).toHaveLength(1); // adult at home
    expect(buildTravelBriefingRows([solo], ctx(kid))).toHaveLength(1);
    expect(buildTravelBriefingRows([solo], ctx(kid2))).toEqual([]);
  });

  it('stops being news after 24 hours and the plain row returns', () => {
    const rows = buildTravelBriefingRows([changed], ctx(mum, { nowMs: NOW + 40 * 3_600_000 }));
    expect(rows[0]!.id).toBe('travel-departure:seg-1');
  });

  it('a cancellation wins and stays', () => {
    const cancelled = occ({
      status: 'pending',
      live: {
        liveRevision: 'rev|cancelled',
        liveCancelledAt: '2026-12-01T10:00:00.000Z',
        liveAppliedAt: '2026-12-12T10:00:00.000Z',
        liveWas: { departureTime: '17:00', at: '2026-12-12T10:00:00.000Z' },
      },
    });
    const [row] = buildTravelBriefingRows([cancelled], ctx(mum));
    expect(row).toMatchObject({
      id: 'travel-cancelled:seg-1:rev|cancelled@2026-12-01T10:00:00.000Z',
      message: 'Singapore Airlines cancelled SQ318 on 13 Dec. This flight is now pending.',
      caption: 'SQ318 · Cancelled',
      icon: '🚫',
    });
  });

  it('a reinstated flight (plain revision, liveCancelledAt kept) has no cancelled row', () => {
    const reinstated = occ({
      status: 'pending',
      live: { liveRevision: 'rev-plain', liveCancelledAt: '2026-12-01T10:00:00.000Z' },
    });
    const rows = buildTravelBriefingRows([reinstated], ctx(mum));
    expect(rows.some((r) => r.id.startsWith('travel-cancelled:'))).toBe(false);
  });
});
