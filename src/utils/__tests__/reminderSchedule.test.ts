import { describe, it, expect } from 'vitest';
import {
  minusMinutes,
  localDateTime,
  formatLeadLabel,
  activityReminderContext,
  activityLeadMinutes,
  resolveOsActivityLead,
  allDayAnchor,
  DEFAULT_ACTIVITY_LEAD,
  DEFAULT_TRAVEL_LEADS,
} from '../reminderSchedule';
import type { FamilyActivity, FamilyMember, UUID } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

describe('minusMinutes / localDateTime (extracted primitives — parity)', () => {
  it('subtracts minutes without mutating the input', () => {
    const d = new Date('2026-05-22T15:00:00');
    expect(minusMinutes(d, 30)).toEqual(new Date('2026-05-22T14:30:00'));
    expect(d).toEqual(new Date('2026-05-22T15:00:00'));
  });

  it('parses local date + time (no UTC-midnight drift), null on garbage', () => {
    const at = localDateTime('2026-05-22', '09:05');
    expect(at?.getHours()).toBe(9);
    expect(at?.getMinutes()).toBe(5);
    expect(at?.getDate()).toBe(22);
    expect(localDateTime('not-a-date')).toBeNull();
  });
});

describe('formatLeadLabel', () => {
  const t = (k: UIStringKey): string =>
    (
      ({
        'reminders.lead.atTime': 'At the time',
        'reminders.lead.dayBefore': 'The day before',
        'reminders.lead.hours': '{n} hours before',
        'reminders.lead.hourOne': '{n} hour before',
        'reminders.lead.minutes': '{n} minutes before',
        'reminders.lead.minuteOne': '{n} minute before',
      }) as Partial<Record<string, string>>
    )[k] ?? String(k);

  it('renders each bucket correctly', () => {
    expect(formatLeadLabel(0, t)).toBe('At the time');
    expect(formatLeadLabel(1, t)).toBe('1 minute before');
    expect(formatLeadLabel(30, t)).toBe('30 minutes before');
    expect(formatLeadLabel(60, t)).toBe('1 hour before');
    expect(formatLeadLabel(120, t)).toBe('2 hours before');
    expect(formatLeadLabel(1440, t)).toBe('The day before');
  });
});

describe('DEFAULT_TRAVEL_LEADS', () => {
  it('flights + cruise are 2h, rail/ferry 1h', () => {
    expect(DEFAULT_TRAVEL_LEADS.flight_outbound).toBe(120);
    expect(DEFAULT_TRAVEL_LEADS.flight_return).toBe(120);
    expect(DEFAULT_TRAVEL_LEADS.cruise).toBe(120);
    expect(DEFAULT_TRAVEL_LEADS.train).toBe(60);
    expect(DEFAULT_TRAVEL_LEADS.ferry).toBe(60);
  });
});

describe('activityReminderContext (shared audience/who/duty derivation)', () => {
  const me = { id: 'me', name: 'Greg' } as FamilyMember;
  const neil = { id: 'neil', name: 'Neil' } as FamilyMember;
  const resolve = (id: string): FamilyMember | undefined =>
    id === 'me' ? me : id === 'neil' ? neil : undefined;

  const act = (over: Partial<FamilyActivity>): FamilyActivity =>
    ({ id: 'a' as UUID, title: 'Football', assigneeIds: [], ...over }) as FamilyActivity;

  it('a duty-only drop-off for a non-assignee is relevant, with dutyRole', () => {
    const ctx = activityReminderContext(
      act({ assigneeIds: ['neil'], dropoffMemberId: 'me', location: 'NSRCC' }),
      me,
      resolve
    );
    expect(ctx.relevant).toBe(true);
    expect(ctx.dutyRole).toBe('dropoff');
    expect(ctx.who).toEqual(['Neil', 'NSRCC']);
    expect(ctx.title).toBe('Football');
  });

  it('an unrelated activity (not assignee, no duty) is not relevant', () => {
    const ctx = activityReminderContext(act({ assigneeIds: ['neil'] }), me, resolve);
    expect(ctx.relevant).toBe(false);
  });

  it('own assigned activity is relevant with no dutyRole', () => {
    const ctx = activityReminderContext(act({ assigneeIds: ['me'] }), me, resolve);
    expect(ctx.relevant).toBe(true);
    expect(ctx.dutyRole).toBeUndefined();
    expect(ctx.dutyRoles).toEqual([]);
  });

  it('a viewer on both duties reports BOTH roles, dropoff first', () => {
    const ctx = activityReminderContext(
      act({ assigneeIds: ['neil'], dropoffMemberId: 'me', pickupMemberId: 'me' }),
      me,
      resolve
    );
    expect(ctx.dutyRoles).toEqual(['dropoff', 'pickup']);
    // `dutyRole` stays the primary, for the single-role bell chip.
    expect(ctx.dutyRole).toBe('dropoff');
  });

  it('a pickup-only viewer reports pickup alone', () => {
    const ctx = activityReminderContext(
      act({ assigneeIds: ['neil'], pickupMemberId: 'me' }),
      me,
      resolve
    );
    expect(ctx.dutyRoles).toEqual(['pickup']);
    expect(ctx.dutyRole).toBe('pickup');
  });
});

describe('activityLeadMinutes / resolveOsActivityLead', () => {
  it('activityLeadMinutes is trigger math only — it PRESERVES 0', () => {
    // The in-app bell uses this. Applying the OS "None" skip here would empty
    // the bell, because every stored activity carries 0.
    expect(activityLeadMinutes(0)).toBe(0);
    expect(activityLeadMinutes(15)).toBe(15);
    expect(activityLeadMinutes(undefined)).toBe(DEFAULT_ACTIVITY_LEAD);
  });

  it('resolveOsActivityLead treats 0 as "None" — no OS reminder', () => {
    expect(resolveOsActivityLead(0, false)).toBeNull();
    expect(resolveOsActivityLead(15, false)).toBe(15);
    expect(resolveOsActivityLead(undefined, false)).toBe(DEFAULT_ACTIVITY_LEAD);
  });

  it('resolveOsActivityLead exempts duty reminders from the None skip', () => {
    // The chip governs the activity's reminder, not my drop-off run — and
    // without this every stored activity (all at 0) would lose its school run.
    expect(resolveOsActivityLead(0, true)).toBe(DEFAULT_ACTIVITY_LEAD);
    // An explicit non-zero choice is still honoured for a duty.
    expect(resolveOsActivityLead(60, true)).toBe(60);
  });
});

describe('allDayAnchor', () => {
  it('anchors an all-day item at 09:00 local', () => {
    expect(allDayAnchor('2026-05-22')).toEqual(new Date('2026-05-22T09:00:00'));
  });

  it('returns null on a malformed date rather than an Invalid Date', () => {
    expect(allDayAnchor('not-a-date')).toBeNull();
  });
});
