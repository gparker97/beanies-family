import { describe, it, expect } from 'vitest';
import type { FamilyActivity } from '@/types/models';
import { deterministicEventId } from '../deterministicEventId';
import { buildRecurrenceRule } from '../recurrenceRrule';
import { buildEventDescription, SYNCED_MARKER } from '../eventDescription';
import { activityToGoogleEvent, computePushHash } from '../activityToGoogleEvent';

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
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE',
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
      notes: 'Bring shin guards',
    });
    const desc = buildEventDescription(activity, ctx);
    expect(desc).toContain("Who's going: Mia");
    expect(desc).toContain('Drop-off: Dad');
    expect(desc).toContain('Pick-up: Mum');
    expect(desc).toContain('Instructor: Coach Lee (+65 9123 4567)');
    expect(desc).toContain('Cost: 80 SGD (per_session)');
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
