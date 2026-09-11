import { describe, it, expect } from 'vitest';
import type { FamilyActivity } from '@/types/models';
import type { RecurrenceRule } from '@/types/recurrence';
import { deterministicEventId } from '../deterministicEventId';
import { buildRecurrenceRule } from '../recurrenceRrule';
import { buildEventDescription, SYNCED_MARKER } from '../eventDescription';
import {
  activityToGoogleEvent,
  computePushHash,
  googleTimesToActivityFields,
} from '../activityToGoogleEvent';

// Minimal FamilyActivity factory — only fields the mapper reads matter.
function makeActivity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7',
    title: 'Soccer practice',
    date: '2026-06-10', // Wednesday
    recurrence: 'none',
    category: 'sports',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as FamilyActivity;
}

const ctx = {
  memberName: (id: string) => ({ m1: 'Mia', m2: 'Dad', m3: 'Mum' })[id],
  appOrigin: 'https://app.beanies.family',
  timeZone: 'Asia/Singapore',
};

describe('deterministicEventId', () => {
  it('is stable and valid base32hex', () => {
    const id = deterministicEventId('a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7');
    expect(id).toBe(deterministicEventId('a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7'));
    expect(id).toMatch(/^[0-9a-v]+$/); // Google base32hex charset
    expect(id.length).toBeGreaterThanOrEqual(5);
    expect(id.length).toBeLessThanOrEqual(1024);
  });

  it('produces distinct ids for distinct activities, same id for same (cross-device dedup)', () => {
    expect(deterministicEventId('aaaa')).not.toBe(deterministicEventId('bbbb'));
    expect(deterministicEventId('AAAA-1111')).toBe(deterministicEventId('aaaa-1111'));
  });

  it('throws on empty input', () => {
    expect(() => deterministicEventId('')).toThrow();
  });
});

describe('buildRecurrenceRule', () => {
  it('returns [] for non-recurring (so a patch can clear a stale RRULE)', () => {
    expect(buildRecurrenceRule({ recurrence: 'none', date: '2026-06-10' })).toEqual([]);
  });

  it('maps each kind to the correct RRULE', () => {
    expect(buildRecurrenceRule({ recurrence: 'daily', date: '2026-06-10' })).toEqual([
      'RRULE:FREQ=DAILY',
    ]);
    // weekly with no daysOfWeek → BYDAY from the start weekday (Wed)
    expect(buildRecurrenceRule({ recurrence: 'weekly', date: '2026-06-10' })).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=WE',
    ]);
    // weekly with daysOfWeek (Mon + Wed)
    expect(
      buildRecurrenceRule({ recurrence: 'weekly', date: '2026-06-10', daysOfWeek: [1, 3] })
    ).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']);
    expect(buildRecurrenceRule({ recurrence: 'biweekly', date: '2026-06-10' })).toEqual([
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;WKST=SU',
    ]);
    expect(buildRecurrenceRule({ recurrence: 'monthly', date: '2026-06-10' })).toEqual([
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=10',
    ]);
    // 2026-06-10 is the 2nd Wednesday of June
    expect(buildRecurrenceRule({ recurrence: 'monthly-by-day', date: '2026-06-10' })).toEqual([
      'RRULE:FREQ=MONTHLY;BYDAY=2WE',
    ]);
    // 2026-05-29 is the 5th Friday → coerced to "last Friday"
    expect(buildRecurrenceRule({ recurrence: 'monthly-by-day', date: '2026-05-29' })).toEqual([
      'RRULE:FREQ=MONTHLY;BYDAY=-1FR',
    ]);
    expect(buildRecurrenceRule({ recurrence: 'yearly', date: '2026-06-10' })).toEqual([
      'RRULE:FREQ=YEARLY',
    ]);
  });

  it('appends UNTIL with the value-type matching all-day vs timed', () => {
    expect(
      buildRecurrenceRule({
        recurrence: 'weekly',
        date: '2026-06-10',
        recurrenceEndDate: '2026-12-31',
        isAllDay: true,
      })
    ).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231']);
    expect(
      buildRecurrenceRule({
        recurrence: 'weekly',
        date: '2026-06-10',
        recurrenceEndDate: '2026-12-31',
        isAllDay: false,
      })
    ).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T235959Z']);
  });
});

describe('buildEventDescription', () => {
  it('includes user fields, the marker, and the deep link — never secrets', () => {
    const activity = makeActivity({
      assigneeIds: ['m1'],
      dropoffMemberId: 'm2',
      pickupMemberId: 'm3',
      instructorName: 'Coach Lee',
      instructorContact: '+65 9123 4567',
      feeAmount: 80,
      feeCurrency: 'SGD',
      feeSchedule: 'per_session',
      link: 'https://club.example.com/soccer',
      notes: 'Bring shin guards',
    });
    const desc = buildEventDescription(activity, ctx);
    expect(desc).toContain("Who's going: Mia");
    expect(desc).toContain('Drop-off: Dad');
    expect(desc).toContain('Pick-up: Mum');
    expect(desc).toContain('Instructor: Coach Lee (+65 9123 4567)');
    expect(desc).toContain('Cost: 80 SGD (per_session)');
    expect(desc).toContain('Link: https://club.example.com/soccer');
    expect(desc).toContain('Bring shin guards');
    expect(desc).toContain(SYNCED_MARKER);
    expect(desc).toContain('https://app.beanies.family/activities?activity=' + activity.id);
    // No system/secret material.
    expect(desc).not.toMatch(/token|refresh|secret/i);
  });

  it('is sparse for a bare activity (just marker + link)', () => {
    const desc = buildEventDescription(makeActivity(), ctx);
    expect(desc).toBe(
      `${SYNCED_MARKER}\nhttps://app.beanies.family/activities?activity=a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7`
    );
  });
});

describe('activityToGoogleEvent', () => {
  it('maps an all-day activity with EXCLUSIVE end date', () => {
    const ev = activityToGoogleEvent(makeActivity({ isAllDay: true }), ctx);
    expect(ev.start).toEqual({ date: '2026-06-10' });
    expect(ev.end).toEqual({ date: '2026-06-11' }); // exclusive
    expect(ev.summary).toBe('Soccer practice');
  });

  it('maps a multi-day all-day activity (end exclusive past endDate)', () => {
    const ev = activityToGoogleEvent(makeActivity({ isAllDay: true, endDate: '2026-06-12' }), ctx);
    expect(ev.end).toEqual({ date: '2026-06-13' });
  });

  it('maps a timed activity with timezone', () => {
    const ev = activityToGoogleEvent(makeActivity({ startTime: '14:30', endTime: '15:30' }), ctx);
    expect(ev.start).toEqual({ dateTime: '2026-06-10T14:30:00', timeZone: 'Asia/Singapore' });
    expect(ev.end).toEqual({ dateTime: '2026-06-10T15:30:00', timeZone: 'Asia/Singapore' });
  });

  it('wires recurrence, reminders and location', () => {
    const ev = activityToGoogleEvent(
      makeActivity({
        startTime: '16:00',
        recurrence: 'weekly',
        reminderMinutes: 30,
        location: 'East Field',
      }),
      ctx
    );
    expect(ev.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=WE']);
    // NO reminder override, even at reminderMinutes: 30. Reminders live in
    // beanies only — one on each surface means duplicate alerts from two apps.
    // `useDefault: false` + empty also suppresses the calendar's own default.
    expect(ev.reminders).toEqual({ useDefault: false, overrides: [] });
    expect(ev.location).toBe('East Field');
  });

  it('never exports a reminder override, at any reminderMinutes', () => {
    for (const reminderMinutes of [0, 30, 1440] as const) {
      const ev = activityToGoogleEvent(makeActivity({ startTime: '16:00', reminderMinutes }), ctx);
      expect(ev.reminders).toEqual({ useDefault: false, overrides: [] });
    }
  });

  it('always sets recurrence to [] for a non-recurring activity (clears a stale RRULE on patch)', () => {
    const ev = activityToGoogleEvent(makeActivity({ recurrence: 'none' }), ctx);
    expect(ev.recurrence).toEqual([]);
  });

  it('rolls an overnight timed event end to the next day', () => {
    const ev = activityToGoogleEvent(makeActivity({ startTime: '22:00', endTime: '02:00' }), ctx);
    expect(ev.start).toEqual({ dateTime: '2026-06-10T22:00:00', timeZone: 'Asia/Singapore' });
    expect(ev.end).toEqual({ dateTime: '2026-06-11T02:00:00', timeZone: 'Asia/Singapore' });
  });

  it('uses endDate for a multi-day timed event', () => {
    const ev = activityToGoogleEvent(
      makeActivity({ startTime: '09:00', endTime: '17:00', endDate: '2026-06-12' }),
      ctx
    );
    expect(ev.end).toEqual({ dateTime: '2026-06-12T17:00:00', timeZone: 'Asia/Singapore' });
  });
});

describe('computePushHash', () => {
  it('is stable and changes when a pushed field changes', () => {
    const a = makeActivity();
    expect(computePushHash(a)).toBe(computePushHash(makeActivity()));
    expect(computePushHash(a)).not.toBe(computePushHash(makeActivity({ title: 'Changed' })));
    expect(computePushHash(a)).not.toBe(computePushHash(makeActivity({ startTime: '09:00' })));
    // `link` is rendered into the description, so a link edit must re-push (F4).
    expect(computePushHash(a)).not.toBe(
      computePushHash(makeActivity({ link: 'https://new.example.com' }))
    );
  });

  it('includes resolved member names — a rename changes the hash for a referencing activity only (F3)', () => {
    const a = makeActivity({ assigneeIds: ['m1'] });
    const before = (id: string) => ({ m1: 'Mia' })[id];
    const after = (id: string) => ({ m1: 'Amelia' })[id];
    // Renaming m1 changes the hash of an activity that references m1...
    expect(computePushHash(a, before)).not.toBe(computePushHash(a, after));
    // ...but not an activity that references no members.
    const noPeople = makeActivity({ assigneeIds: [] });
    expect(computePushHash(noPeople, before)).toBe(computePushHash(noPeople, after));
  });

  it('ignores fields that do not affect the pushed event', () => {
    const a = makeActivity();
    // updatedAt is not a pushed-relevant field
    expect(computePushHash(a)).toBe(
      computePushHash(makeActivity({ updatedAt: '2030-01-01T00:00:00.000Z' }))
    );
  });

  it('is INVARIANT across reminderMinutes — it is not exported, so it must not dirty', () => {
    // Guards the #55 decision: reminders are never pushed to Google, so a
    // reminder-time edit must not re-push a byte-identical event. Including this
    // field in the hash meant every such edit cost a Google patch call, forever.
    const base = computePushHash(makeActivity({ reminderMinutes: 0 }));
    expect(computePushHash(makeActivity({ reminderMinutes: 30 }))).toBe(base);
    expect(computePushHash(makeActivity({ reminderMinutes: 1440 }))).toBe(base);
  });
});

describe('computePushHash covers the canonical rule (#70)', () => {
  // REGRESSION GUARD: `rule` was added to the hash, but no fixture populated it,
  // so deleting the line kept the suite green while every cadence-only edit left
  // Google on a stale RRULE forever. These fixtures make that revert fail.
  const withRule = (rule: RecurrenceRule) =>
    ({ ...makeActivity(), recurrence: 'monthly' as const, rule }) as FamilyActivity;

  const base: RecurrenceRule = {
    unit: 'month',
    interval: 1,
    monthlyAnchor: 'date',
    monthlyDay: 15,
    end: { kind: 'never' },
  };

  it('changing only monthlyDay changes the hash', () => {
    expect(computePushHash(withRule(base))).not.toBe(
      computePushHash(withRule({ ...base, monthlyDay: 20 }))
    );
  });

  it('changing only the interval changes the hash', () => {
    expect(computePushHash(withRule(base))).not.toBe(
      computePushHash(withRule({ ...base, interval: 3 }))
    );
  });

  it('changing only the end kind changes the hash', () => {
    // The legacy shadow is byte-identical across these two (no recurrenceEndDate
    // either way), so the hash can only differ if `rule` is part of it.
    expect(computePushHash(withRule(base))).not.toBe(
      computePushHash(withRule({ ...base, end: { kind: 'afterCount', count: 10 } }))
    );
  });

  it('an identical rule still hashes identically (no spurious re-push)', () => {
    expect(computePushHash(withRule(base))).toBe(computePushHash(withRule({ ...base })));
  });
});

describe('computePushHash is key-order independent (#94)', () => {
  // Automerge materializes map keys SORTED. So the same activity hashes one way
  // when it is a freshly built literal (what the one-time import records on the
  // link) and another way when it is read back through the projection (what every
  // later reconcile sees). If those disagree, the reconcile patches the user's
  // real adopted Google event on the next app load, rewriting its description and
  // clearing its reminders. Do not "simplify" the canonical replacer away.
  it('hashes identically regardless of the rule object’s key order', () => {
    const base = {
      id: 'a1',
      title: 'Swim',
      date: '2026-09-15',
      recurrence: 'weekly',
      category: 'sports',
      feeSchedule: 'none',
      reminderMinutes: 0,
      isActive: true,
      createdBy: 'm1',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    } as unknown as FamilyActivity;

    const authored = {
      ...base,
      rule: { unit: 'week', interval: 1, weekdays: [2], end: { kind: 'never' } },
    } as FamilyActivity;

    // Exactly what @automerge/automerge returns for the same rule: keys sorted.
    const roundTripped = {
      ...base,
      rule: { end: { kind: 'never' }, interval: 1, unit: 'week', weekdays: [2] },
    } as FamilyActivity;

    expect(computePushHash(roundTripped)).toBe(computePushHash(authored));
  });

  it('still changes when a rule VALUE changes', () => {
    // The canonicalization must not flatten real differences into one hash.
    const mk = (interval: number) =>
      ({
        id: 'a1',
        title: 'Swim',
        date: '2026-09-15',
        recurrence: 'weekly',
        category: 'sports',
        feeSchedule: 'none',
        reminderMinutes: 0,
        isActive: true,
        createdBy: 'm1',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        rule: { unit: 'week', interval, weekdays: [2], end: { kind: 'never' } },
      }) as unknown as FamilyActivity;

    expect(computePushHash(mk(1))).not.toBe(computePushHash(mk(2)));
  });
});

describe('googleTimesToActivityFields — the inverse, for the one-time import (#94)', () => {
  // The device zone is whatever the test runner has; every assertion below is
  // written against an offset that matches it, so the wall clock is unambiguous.
  const tz = new Date('2026-09-15T00:00:00Z').getTimezoneOffset();
  const off = (min: number) => {
    const sign = min <= 0 ? '+' : '-';
    const a = Math.abs(min);
    return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  };
  const local = (ymd: string, hm: string) => `${ymd}T${hm}:00${off(tz)}`;

  it('keeps a same-day timed event on one day', () => {
    expect(
      googleTimesToActivityFields(
        { dateTime: local('2026-09-15', '16:00') },
        { dateTime: local('2026-09-15', '16:45') }
      )
    ).toEqual({ date: '2026-09-15', isAllDay: false, startTime: '16:00', endTime: '16:45' });
  });

  it('carries an explicit endDate for a MULTI-DAY timed event', () => {
    // A three-day conference. Without endDate this collapsed to the first night.
    expect(
      googleTimesToActivityFields(
        { dateTime: local('2026-09-15', '09:00') },
        { dateTime: local('2026-09-17', '17:00') }
      )
    ).toEqual({
      date: '2026-09-15',
      endDate: '2026-09-17',
      isAllDay: false,
      startTime: '09:00',
      endTime: '17:00',
    });
  });

  it('does not produce a ZERO-LENGTH activity for an exactly-24-hour event', () => {
    // 10:00 is not < 10:00, so the model's implicit overnight roll never fired and
    // the span read back as start == end.
    const out = googleTimesToActivityFields(
      { dateTime: local('2026-09-15', '10:00') },
      { dateTime: local('2026-09-16', '10:00') }
    );
    expect(out).toMatchObject({ date: '2026-09-15', endDate: '2026-09-16' });
  });

  it('maps an all-day span off Google exclusive end onto an inclusive endDate', () => {
    expect(googleTimesToActivityFields({ date: '2026-09-15' }, { date: '2026-09-18' })).toEqual({
      date: '2026-09-15',
      endDate: '2026-09-17',
      isAllDay: true,
    });
  });

  it('leaves a single all-day event without an endDate', () => {
    expect(googleTimesToActivityFields({ date: '2026-09-15' }, { date: '2026-09-16' })).toEqual({
      date: '2026-09-15',
      isAllDay: true,
    });
  });
});
