import { describe, expect, it, vi } from 'vitest';
import type { FamilyMember } from '@/types/models';
import type { FlightVerification } from '@/types/flightStatus';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import {
  arrivalAnnouncement,
  arrivalAnnouncements,
  arrivalFireAt,
  arrivalLink,
  type ArrivalContext,
} from './arrivalAnnouncement';

const member = (id: string, name: string, ageGroup: 'adult' | 'child', isPet = false) =>
  ({ id, name, ageGroup, role: 'member', isPet }) as FamilyMember;
const mum = member('mum', 'Jill', 'adult');
const dad = member('dad', 'Sam', 'adult');
const kid = member('kid', 'Ansel', 'child');
const pet = member('pet', 'Rex', 'adult', true);
const members = [mum, dad, kid, pet];

/** Jill's flight home: leaves LHR on the 12th, lands in Singapore on the 13th at 17:05. */
function home(over: Partial<TravelSegmentOccurrence> = {}): TravelSegmentOccurrence {
  return {
    vacationId: 'vac-1',
    segmentIndex: 1,
    segmentId: 'seg-2',
    transportType: 'flight_return',
    kind: 'departure',
    status: 'booked',
    date: '2026-12-12',
    time: '21:00',
    title: 'LHR → SIN',
    tripAssigneeIds: ['mum', 'dad', 'kid'],
    travellerIds: ['mum'],
    airline: 'Singapore Airlines (SQ)',
    flightNumber: 'SQ317',
    departureAirport: 'LHR',
    arrivalAirport: 'Singapore (SIN)',
    schedule: {
      departureDate: '2026-12-12',
      departureTime: '21:00',
      arrivalDate: '2026-12-13',
      arrivalTime: '17:05',
      arrivalTerminal: '1',
    },
    ...over,
  };
}

function ctx(viewer: FamilyMember, over: Partial<ArrivalContext> = {}): ArrivalContext {
  return {
    viewer,
    members,
    resolveMember: (id) => members.find((m) => m.id === id),
    homecomingFor: (id) => (id === 'seg-2' ? ['mum'] : []),
    verificationFor: () => undefined,
    ...over,
  };
}

const verified = (
  live: FlightVerification['live'] = {},
  extra: Partial<FlightVerification> = {}
): FlightVerification => ({ state: 'verified', checkedAt: 1, live, ...extra });

describe('arrivalAnnouncement: who hears about which flight home', () => {
  it('the plain data every surface reads, from the plan', () => {
    expect(arrivalAnnouncement(home(), ctx(dad))).toEqual({
      segmentId: 'seg-2',
      vacationId: 'vac-1',
      names: 'Jill',
      count: 1,
      date: '2026-12-13',
      time: '17:05',
      estimated: false,
      over: false,
      flight: 'SQ317',
      airport: 'SIN',
      terminal: '1',
    });
  });

  it('a child at home gets it; the traveller and a pet do not', () => {
    expect(arrivalAnnouncement(home(), ctx(kid))).not.toBeNull();
    expect(arrivalAnnouncement(home(), ctx(mum))).toBeNull();
    expect(arrivalAnnouncement(home(), ctx(pet))).toBeNull();
  });

  it('none for a non-flight, a flight nobody is coming home on, or the whole family flying', () => {
    expect(arrivalAnnouncement(home({ transportType: 'train' }), ctx(dad))).toBeNull();
    expect(arrivalAnnouncement(home(), ctx(dad, { homecomingFor: () => [] }))).toBeNull();
    const everyone = () => ['mum', 'dad', 'kid'];
    const all = home({ travellerIds: undefined });
    expect(arrivalAnnouncement(all, ctx(kid, { homecomingFor: everyone }))).toBeNull();
  });

  it('none for a cancelled flight, on the plan or known on this device only', () => {
    const onPlan = home({
      live: { liveRevision: 'rev|cancelled', liveCancelledAt: '2026-12-12T10:00:00.000Z' },
    });
    expect(arrivalAnnouncement(onPlan, ctx(dad))).toBeNull();
    const v: FlightVerification = { state: 'cancelled', checkedAt: 1 };
    expect(arrivalAnnouncement(home(), ctx(dad, { verificationFor: () => v }))).toBeNull();
  });

  it('none without a resolvable arrival', () => {
    expect(arrivalAnnouncement(home({ schedule: undefined }), ctx(dad))).toBeNull();
    const bad = home({ schedule: { arrivalDate: '2026-12-13', arrivalTime: '25:00' } });
    expect(arrivalAnnouncement(bad, ctx(dad))).toBeNull();
  });

  it('the estimate over the plan, and marked as an estimate', () => {
    const v = verified({ estimatedArrival: '2026-12-13 17:45+08:00' });
    expect(arrivalAnnouncement(home(), ctx(dad, { verificationFor: () => v }))).toMatchObject({
      time: '17:45',
      scheduledTime: '17:05',
      estimated: true,
    });
    const onTime = verified({ estimatedArrival: '2026-12-13 17:05+08:00' });
    const a = arrivalAnnouncement(home(), ctx(dad, { verificationFor: () => onTime }));
    expect(a).toMatchObject({ time: '17:05', estimated: true });
    expect(a).not.toHaveProperty('scheduledTime');
  });

  it("the airline's arrival terminal wins only while a live check carries one", () => {
    const live = verified({}, { provider: { arrivalTerminal: '3' } });
    expect(arrivalAnnouncement(home(), ctx(dad, { verificationFor: () => live }))!.terminal).toBe(
      '3'
    );
    const noLive: FlightVerification = { state: 'changed', provider: { arrivalTerminal: '3' } };
    expect(arrivalAnnouncement(home(), ctx(dad, { verificationFor: () => noLive }))!.terminal).toBe(
      '1'
    );
    const none = home({ schedule: { ...home().schedule, arrivalTerminal: undefined } });
    expect(arrivalAnnouncement(none, ctx(dad))).not.toHaveProperty('terminal');
  });

  it('over once the check window has closed (Arrived, or 2 h past scheduled arrival)', () => {
    const closed: FlightVerification = { state: 'unavailable', reason: 'past' };
    expect(arrivalAnnouncement(home(), ctx(dad, { verificationFor: () => closed }))).toMatchObject({
      over: true,
      time: '17:05',
      estimated: false,
    });
  });

  it('carries nothing that moves on every check', () => {
    const a = (checkedAt: number) =>
      arrivalAnnouncement(
        home(),
        ctx(dad, { verificationFor: () => verified({ belt: '7', gate: 'A1' }, { checkedAt }) })
      );
    expect(JSON.stringify(a(1))).toBe(JSON.stringify(a(999_999)));
  });
});

describe('arrivalFireAt and arrivalLink', () => {
  it('lead minutes before the landing wall clock, read in the device zone', () => {
    const a = { date: '2026-12-13', time: '17:05' };
    expect(arrivalFireAt(a, 60)).toEqual(new Date(2026, 11, 13, 16, 5));
    expect(arrivalFireAt(a, 1440)).toEqual(new Date(2026, 11, 12, 17, 5));
    expect(arrivalFireAt({ date: 'soon', time: '17:05' }, 60)).toBeNull();
  });

  it('opens Travel Plans on the flight', () => {
    expect(arrivalLink({ vacationId: 'vac-1', segmentId: 'seg-2' })).toEqual({
      path: '/travel',
      query: { vacation: 'vac-1', segment: 'seg-2' },
    });
  });
});

describe('arrivalAnnouncements: the total mapper', () => {
  it('departure occurrences only', () => {
    const out = arrivalAnnouncements([home(), home({ kind: 'arrival' })], ctx(dad));
    expect(out.map((a) => a.segmentId)).toEqual(['seg-2']);
  });

  it('a throwing occurrence is skipped and told to onSkipped; the others survive', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSkipped = vi.fn();
    const bad = home({ segmentId: 'seg-bad' });
    Object.defineProperty(bad, 'transportType', {
      get() {
        throw new Error('boom');
      },
    });
    const out = arrivalAnnouncements([bad, home()], ctx(dad), onSkipped);
    expect(out.map((a) => a.segmentId)).toEqual(['seg-2']);
    expect(onSkipped).toHaveBeenCalledOnce();
    expect(onSkipped).toHaveBeenCalledWith(bad, expect.any(Error));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('seg-bad'), expect.any(Error));
    warn.mockRestore();
  });
});
