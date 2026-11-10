import { describe, expect, it, vi } from 'vitest';
import type { FamilyMember } from '@/types/models';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import { DEFAULT_TRAVEL_LEADS } from '@/utils/reminderSchedule';
import { t } from '@/utils/flightStatus/__tests__/fixtures';
import {
  buildTravelReminders,
  type ReminderInput,
  type ReminderPrefs,
} from '../useScheduledReminders';

const member = (id: string, ageGroup: 'adult' | 'child') =>
  ({ id, name: id, ageGroup, role: 'member' }) as FamilyMember;
const mum = member('mum', 'adult');
const kid = member('kid', 'child');
const kid2 = member('kid2', 'child');

const NOW = new Date('2026-12-13T10:00:00');
const APPLIED = new Date('2026-12-13T09:50:00').toISOString();

const PREFS: ReminderPrefs = {
  remindersEnabled: true,
  todoReminderLead: 30,
  activityReminderLead: 30,
  travelReminderLeads: DEFAULT_TRAVEL_LEADS,
  helpfulHintNotifyByType: {},
  flightChangeAlerts: true,
};

function occ(over: Partial<TravelSegmentOccurrence> = {}): TravelSegmentOccurrence {
  return {
    vacationId: 'vac-1',
    segmentIndex: 0,
    segmentId: 'seg-1',
    transportType: 'flight_outbound',
    kind: 'departure',
    status: 'booked',
    date: '2026-12-13',
    time: '18:30',
    title: 'SIN → LHR',
    tripAssigneeIds: ['mum', 'kid', 'kid2'],
    airline: 'Singapore Airlines (SQ)',
    flightNumber: 'SQ318',
    schedule: { departureDate: '2026-12-13', departureTime: '18:30', terminal: '3' },
    live: {
      liveRevision: 'rev-1',
      liveWas: { departureTime: '17:00', terminal: '2', at: APPLIED },
      liveAppliedAt: APPLIED,
    },
    ...over,
  };
}

/** A fake of the store's first-seen stamp: the first call for an id stores `at`. */
function stamps(at: number = NOW.getTime()) {
  const seen = new Map<string, number>();
  return (id: string, _segmentId: string): number => {
    if (!seen.has(id)) seen.set(id, at);
    return seen.get(id)!;
  };
}

function input(
  currentMember: FamilyMember,
  travelOccurrences: TravelSegmentOccurrence[],
  noticeFirstSeen: ReminderInput['noticeFirstSeen'] = stamps()
): ReminderInput {
  return {
    occurrencesByDate: {},
    travelOccurrences,
    todos: [],
    lists: [],
    currentMember,
    resolveMember: () => undefined,
    windowStartISO: '2026-12-13',
    windowEndISO: '2026-12-27',
    noticeFirstSeen,
    t,
  };
}

const notices = (i: ReminderInput, prefs = PREFS, now = NOW) =>
  buildTravelReminders(i, now, prefs).reminders.filter((r) => r.kind === 'travel-change');

describe('travel change notices (OS)', () => {
  it('one notice per revision: sentence, "was" body, vacation deep link, fired in 5 s', () => {
    const [n] = notices(input(mum, [occ()]));
    expect(n).toMatchObject({
      id: 'travel-change:seg-1:rev-1',
      title: 'SQ318 now leaves at 6:30pm from Terminal 3. Your plan has been updated.',
      body: 'Was 5pm from Terminal 2',
      kind: 'travel-change',
      deepLink: { path: '/travel', query: { vacation: 'vac-1' } },
    });
    expect(n!.fireAt.getTime()).toBe(NOW.getTime() + 5000);
  });

  it('fires once: a later reschedule finds fireAt behind now and skips it', () => {
    const i = input(mum, [occ()]); // first seen at NOW, so fireAt = NOW + 5 s
    expect(notices(i)).toHaveLength(1);
    const later = new Date(NOW.getTime() + 20 * 60_000);
    expect(notices(i, PREFS, later)).toEqual([]); // same stamp, no moving fireAt
    expect(notices(i, PREFS, new Date(NOW.getTime() + 4000))).toHaveLength(1); // not yet due
  });

  it('a device that syncs the change later fires once, at its own first-seen', () => {
    const lateNow = new Date(NOW.getTime() + 3 * 3_600_000); // change is 3 h 10 min old
    const i = input(mum, [occ()], stamps(lateNow.getTime()));
    const [n] = notices(i, PREFS, lateNow);
    expect(n!.fireAt.getTime()).toBe(lateNow.getTime() + 5000);
    expect(notices(i, PREFS, new Date(lateNow.getTime() + 60_000))).toEqual([]);
  });

  it('asks the store with the notice id AND the segment id (the push-covered rule reads it)', () => {
    const seen = vi.fn(stamps());
    notices(input(mum, [occ()], seen));
    expect(seen).toHaveBeenCalledWith('travel-change:seg-1:rev-1', 'seg-1');
  });

  it('a stamp pre-dated by the store (a push was the notice) fires nothing', () => {
    const covered = stamps(NOW.getTime() - 10_000);
    expect(notices(input(mum, [occ()], covered))).toEqual([]);
  });

  it('a stale change (over 24 h) first seen now does not fire, and is not stamped', () => {
    const seen = vi.fn(stamps());
    const old = new Date(NOW.getTime() + 25 * 3_600_000);
    expect(notices(input(mum, [occ()], seen), PREFS, old)).toEqual([]);
    expect(seen).not.toHaveBeenCalled();
  });

  it('a cancellation uses the cancel id and the segment title as its body', () => {
    const live = { liveRevision: 'rev|cancelled', liveCancelledAt: APPLIED };
    const [n] = notices(input(mum, [occ({ live })]));
    expect(n).toMatchObject({
      id: `travel-cancel:seg-1:rev|cancelled@${APPLIED}`,
      body: 'SIN → LHR',
    });
    expect(n!.title).toContain('cancelled SQ318');
  });

  it('a reinstated flight (plain revision, liveCancelledAt kept) fires no cancel notice', () => {
    const live = { liveRevision: 'rev-plain', liveCancelledAt: APPLIED };
    expect(notices(input(mum, [occ({ live })]))).toEqual([]);
  });

  it('is off when the alerts are off (switch or plan), but the reminder is untouched', () => {
    const i = input(mum, [occ({ time: '23:00' })]);
    expect(notices(i, { ...PREFS, flightChangeAlerts: false })).toEqual([]);
    const all = buildTravelReminders(i, NOW, { ...PREFS, flightChangeAlerts: false }).reminders;
    expect(all.map((r) => r.kind)).toEqual(['travel']);
  });

  it('every adult, a travelling child, not a child who is not on the flight', () => {
    const solo = occ({ travellerIds: ['kid'] });
    expect(notices(input(mum, [solo]))).toHaveLength(1); // adult at home: told, not reminded
    expect(notices(input(kid, [solo]))).toHaveLength(1);
    expect(notices(input(kid2, [solo]))).toEqual([]);
    const homeReminders = buildTravelReminders(input(mum, [solo]), NOW, PREFS).reminders;
    expect(homeReminders.map((r) => r.kind)).toEqual(['travel-change']);
  });
});
