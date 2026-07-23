import { describe, it, expect } from 'vitest';
import {
  buildReminderSchedule,
  MAX_SCHEDULED,
  type ReminderInput,
  type ReminderPrefs,
} from '../useScheduledReminders';
import type { FamilyActivity, FamilyMember, TodoItem, UUID } from '@/types/models';
import type { NotificationOccurrence } from '@/utils/notifications';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { DEFAULT_TRAVEL_LEADS } from '@/utils/reminderSchedule';

const NOW = new Date('2026-05-22T10:00:00'); // local 10am

const me = { id: 'me', name: 'Greg' } as FamilyMember;
const neil = { id: 'neil', name: 'Neil' } as FamilyMember;
const resolveMember = (id: string): FamilyMember | undefined =>
  id === 'me' ? me : id === 'neil' ? neil : undefined;

// A recognisable t so we can assert which template was chosen. NOTE: there are
// no `*Title` keys — a notification's title is the item's own name, passed
// straight through. Keys whose whole value was `{title}` were deleted after the
// zh auto-translation replaced the placeholder with the word "标题".
const T: Partial<Record<string, string>> = {
  'reminders.activityBodyDropoff': 'Time to drop off — {who}',
  'reminders.activityBodyPickup': 'Time to pick up — {who}',
  'reminders.activityBodyWho': 'Coming up · {who}',
  'reminders.activityBody': 'Coming up soon',
  'reminders.todoBody': 'Due at {time}',
  'reminders.todoBodyAllDay': 'Due today',
  'reminders.travelBody': 'Departs at {time}',
};
const t = (k: UIStringKey): string => T[k] ?? String(k);

function activity(over: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'act-1' as UUID,
    title: 'Football',
    startTime: '15:00',
    assigneeIds: [],
    ...over,
  } as FamilyActivity;
}

function occ(date: string, a: FamilyActivity): NotificationOccurrence {
  return { activity: a, date };
}

function travel(over: Partial<TravelSegmentOccurrence> = {}): TravelSegmentOccurrence {
  return {
    vacationId: 'vac-1',
    segmentIndex: 0,
    segmentId: 'seg-1',
    transportType: 'flight_outbound',
    kind: 'departure',
    status: 'planned' as TravelSegmentOccurrence['status'],
    date: '2026-05-25',
    time: '09:00',
    title: 'Flight to Tokyo',
    // Default: no explicit trip assignees → reminds everyone (today's behaviour).
    tripAssigneeIds: [],
    ...over,
  };
}

function todo(over: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 't-1' as UUID,
    title: 'Pack bags',
    completed: false,
    dueDate: '2026-05-23',
    dueTime: '18:00',
    ...over,
  } as TodoItem;
}

function input(over: Partial<ReminderInput> = {}): ReminderInput {
  return {
    occurrencesByDate: {},
    travelOccurrences: [],
    todos: [],
    currentMember: me,
    resolveMember,
    windowStartISO: '2026-05-22',
    windowEndISO: '2026-06-05',
    t,
    ...over,
  };
}

const PREFS: ReminderPrefs = {
  remindersEnabled: true,
  todoReminderLead: 30,
  activityReminderLead: 30,
  travelReminderLeads: DEFAULT_TRAVEL_LEADS,
};

describe('buildReminderSchedule — activities', () => {
  it('fires at (startTime − reminderMinutes), not at the event', () => {
    const a = activity({ id: 'a' as UUID, startTime: '15:00', reminderMinutes: 30 });
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-22': [occ('2026-05-22', a)] } }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0].fireAt).toEqual(new Date('2026-05-22T14:30:00'));
    expect(reminders[0].kind).toBe('activity');
  });

  it('reminderMinutes = 0 means "None" — schedules NOTHING', () => {
    // The chip renders 0 as `planner.reminder.none` and ActivityListCard hides
    // the chip entirely at 0. Firing at the event time would be the very defect
    // #55 exists to fix (an alert that arrives when it is already too late).
    const a = activity({ startTime: '15:00', reminderMinutes: 0 });
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-22': [occ('2026-05-22', a)] } }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(0);
  });

  it('REGRESSION: reminderMinutes = 0 STILL schedules when the viewer is on duty', () => {
    // Guards the landmine in the None change: `reminderMinutes` is required and
    // ActivityModal defaulted it to 0 for the app's whole life, so every stored
    // activity reads "None". Without the duty exemption this change would have
    // silently switched off every school-run reminder in existence.
    const a = activity({
      startTime: '09:00',
      reminderMinutes: 0,
      assigneeIds: [neil.id as UUID],
      dropoffMemberId: me.id,
    });
    const earlier = new Date('2026-05-24T06:00:00'); // so 09:00−30 = 08:30 is still ahead
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-24': [occ('2026-05-24', a)] } }),
      earlier,
      PREFS
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0].fireAt).toEqual(new Date('2026-05-24T08:30:00')); // falls back to the 30m default
  });

  it('a viewer on BOTH duties gets two reminders — dropoff@start, pickup@end', () => {
    // The pickup half used to be lost entirely: every reminder was derived from
    // startTime and `dutyRole` resolved to 'dropoff' first, so a parent doing
    // both runs was told "time to pick up" at drop-off time and got nothing at
    // the end of the activity.
    const a = activity({
      startTime: '15:00',
      endTime: '17:00',
      reminderMinutes: 30,
      assigneeIds: [neil.id as UUID],
      dropoffMemberId: me.id,
      pickupMemberId: me.id,
    });
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-22': [occ('2026-05-22', a)] } }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(2);
    const dropoff = reminders.find((r) => r.id.endsWith(':dropoff'));
    const pickup = reminders.find((r) => r.id.endsWith(':pickup'));
    expect(dropoff?.fireAt).toEqual(new Date('2026-05-22T14:30:00')); // 15:00 − 30
    expect(pickup?.fireAt).toEqual(new Date('2026-05-22T16:30:00')); // 17:00 − 30
  });

  it('does not fire a duty that is already marked done for that date', () => {
    const base: Partial<FamilyActivity> = {
      startTime: '09:00',
      reminderMinutes: 30,
      assigneeIds: [neil.id as UUID],
      dropoffMemberId: me.id,
    };
    const earlier = new Date('2026-05-24T06:00:00'); // 08:30 is ahead — so a skip is the gate, not the clock
    const day = { '2026-05-24': [occ('2026-05-24', activity(base))] };
    // Control: it schedules while the duty is outstanding…
    expect(
      buildReminderSchedule(input({ occurrencesByDate: day }), earlier, PREFS).reminders
    ).toHaveLength(1);

    // …and stops once it's ticked off.
    const done = activity({
      ...base,
      dropoffCompletions: [{ date: '2026-05-24', completedBy: me.id, completedAt: '' }],
    });
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-24': [occ('2026-05-24', done)] } }),
      earlier,
      PREFS
    );
    expect(reminders).toHaveLength(0);
  });

  it('a pickup duty with NO endTime emits no duty reminder — and the generic covers it', () => {
    // It used to fall through to the 09:00 all-day anchor, so a parent was told
    // to collect their child at breakfast. A role now fires only on its own
    // anchor; with none, the generic reminder covers the occurrence instead.
    const a = activity({
      startTime: '15:30',
      endTime: undefined,
      reminderMinutes: 30,
      assigneeIds: [neil.id as UUID],
      pickupMemberId: me.id,
    });
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-22': [occ('2026-05-22', a)] } }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0].id.endsWith(':pickup')).toBe(false);
    expect(reminders[0].fireAt).toEqual(new Date('2026-05-22T15:00:00')); // 15:30 − 30
  });

  it('an anchorless duty on a "None" activity gets NOTHING — not a generic reminder', () => {
    // The duty exemption applies only to DUTY reminders. Without the ownLead /
    // dutyLead split, the fall-through would emit a generic reminder on an
    // activity the user explicitly switched off.
    const a = activity({
      startTime: '15:30',
      endTime: undefined,
      reminderMinutes: 0,
      assigneeIds: [neil.id as UUID],
      pickupMemberId: me.id,
    });
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-22': [occ('2026-05-22', a)] } }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(0);
  });

  it('a duty already ticked off still SUPPRESSES the generic reminder (no new nag)', () => {
    // Counting emitted reminders instead of anchored roles would resurrect a
    // generic "coming up" the moment a parent ticks their drop-off complete.
    const a = activity({
      startTime: '09:00',
      reminderMinutes: 30,
      assigneeIds: [neil.id as UUID],
      dropoffMemberId: me.id,
      dropoffCompletions: [{ date: '2026-05-24', completedBy: me.id, completedAt: '' }],
    });
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-24': [occ('2026-05-24', a)] } }),
      new Date('2026-05-24T06:00:00'),
      PREFS
    );
    expect(reminders).toHaveLength(0);
  });

  it('REGRESSION: a duty-only drop-off for a NON-assignee IS scheduled', () => {
    // The original bug: member-filtering dropped duty-only occurrences.
    const a = activity({
      id: 'duty' as UUID,
      title: 'School run',
      startTime: '09:00',
      assigneeIds: ['neil'], // Greg is NOT an assignee…
      dropoffMemberId: 'me', // …but IS on drop-off duty.
      reminderMinutes: 30,
    });
    const later = new Date('2026-05-24T06:00:00'); // so 09:00−30 = 08:30 is in the future
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-24': [occ('2026-05-24', a)] } }),
      later,
      PREFS
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0].body).toContain('drop off');
    expect(reminders[0].body).toContain('Neil');
  });

  it('skips untimed activities and ones whose lead has already passed', () => {
    const untimed = activity({ id: 'u' as UUID, startTime: undefined });
    const past = activity({ id: 'p' as UUID, startTime: '10:15', reminderMinutes: 30 }); // 09:45 < now
    const { reminders } = buildReminderSchedule(
      input({
        occurrencesByDate: {
          '2026-05-22': [occ('2026-05-22', untimed), occ('2026-05-22', past)],
        },
      }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(0);
  });

  it('ignores occurrences outside the date window', () => {
    const a = activity({ startTime: '15:00', reminderMinutes: 30 });
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-07-01': [occ('2026-07-01', a)] } }), // beyond windowEnd
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(0);
  });
});

describe('buildReminderSchedule — travel', () => {
  it('PRIVACY: does NOT arm a member who is not on the segment', () => {
    // Without the traveller filter the whole family is woken 2h before a flight
    // only one of them is on.
    const { reminders } = buildReminderSchedule(
      input({
        travelOccurrences: [
          travel({
            travellerIds: [neil.id] as UUID[],
            tripAssigneeIds: [me.id, neil.id] as UUID[],
          }),
        ],
      }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(0);
  });

  it('arms a member who IS on the segment', () => {
    const { reminders } = buildReminderSchedule(
      input({
        travelOccurrences: [
          travel({ travellerIds: [me.id] as UUID[], tripAssigneeIds: [me.id, neil.id] as UUID[] }),
        ],
      }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(1);
  });

  it('a trip with no assignees still reminds everyone (undefined = whole trip)', () => {
    const { reminders } = buildReminderSchedule(
      input({ travelOccurrences: [travel({ travellerIds: undefined, tripAssigneeIds: [] })] }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(1);
  });

  it('schedules a departure at (time − per-type lead), incl. flight_return', () => {
    const { reminders } = buildReminderSchedule(
      input({
        travelOccurrences: [
          travel({ transportType: 'flight_outbound', date: '2026-05-25', time: '09:00' }),
          travel({
            segmentId: 'seg-2',
            transportType: 'flight_return',
            date: '2026-05-30',
            time: '20:00',
          }),
        ],
      }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(2);
    // flight lead 120 → 09:00 − 2h = 07:00
    const outbound = reminders.find((r) => r.id.includes('seg-1'));
    expect(outbound?.fireAt).toEqual(new Date('2026-05-25T07:00:00'));
    expect(reminders.every((r) => r.kind === 'travel')).toBe(true);
  });

  it('honours a device per-type override', () => {
    const { reminders } = buildReminderSchedule(
      input({
        travelOccurrences: [travel({ transportType: 'train', date: '2026-05-25', time: '09:00' })],
      }),
      NOW,
      { ...PREFS, travelReminderLeads: { ...DEFAULT_TRAVEL_LEADS, train: 15 } }
    );
    expect(reminders[0].fireAt).toEqual(new Date('2026-05-25T08:45:00'));
  });

  it('ignores arrival occurrences and untimed departures', () => {
    const { reminders } = buildReminderSchedule(
      input({
        travelOccurrences: [
          travel({ kind: 'arrival', date: '2026-05-25', time: '12:00' }),
          travel({ segmentId: 'x', time: undefined }),
        ],
      }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(0);
  });
});

describe('buildReminderSchedule — todos', () => {
  it('schedules a timed to-do at (dueTime − device lead)', () => {
    const { reminders } = buildReminderSchedule(input({ todos: [todo()] }), NOW, PREFS);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].fireAt).toEqual(new Date('2026-05-23T17:30:00'));
    expect(reminders[0].kind).toBe('todo');
  });

  it('skips completed and undated to-dos', () => {
    const { reminders } = buildReminderSchedule(
      input({
        todos: [
          todo({ id: 'done' as UUID, completed: true }),
          todo({ id: 'undated' as UUID, dueDate: undefined }),
        ],
      }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(0);
  });

  it('a dated but UNTIMED to-do fires at the 09:00 morning-of anchor, no lead', () => {
    // Previously skipped in silence while the in-app bell still showed it, so
    // the two surfaces disagreed about which items remind at all.
    const { reminders } = buildReminderSchedule(
      input({ todos: [todo({ id: 'untimed' as UUID, dueTime: undefined })] }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0].fireAt).toEqual(new Date('2026-05-23T09:00:00'));
  });

  it('PRIVACY: does NOT schedule a to-do assigned privately to another adult', () => {
    // `todos` is the whole family's unfiltered active list, so without the
    // audience gate another adult's private to-do TITLE was pushed to every
    // family member's lock screen — content the app deliberately hides in-app.
    // Explicit adults here: the shared fixtures carry no role/ageGroup, so they
    // classify as children and would pass this for the wrong reason.
    const adultMe = { id: 'me', name: 'Greg', role: 'owner' } as FamilyMember;
    const adultPartner = { id: 'sofia', name: 'Sofia', role: 'owner' } as FamilyMember;
    const { reminders } = buildReminderSchedule(
      input({
        currentMember: adultMe,
        resolveMember: (id) => (id === 'me' ? adultMe : id === 'sofia' ? adultPartner : undefined),
        todos: [todo({ assigneeIds: [adultPartner.id] as UUID[] })],
      }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(0);
  });
});

describe('buildReminderSchedule — resilience, cap, gating', () => {
  it('returns [] when the master toggle is off', () => {
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-22': [occ('2026-05-22', activity())] } }),
      NOW,
      { ...PREFS, remindersEnabled: false }
    );
    expect(reminders).toEqual([]);
  });

  it('returns [] for null input', () => {
    expect(buildReminderSchedule(null, NOW, PREFS).reminders).toEqual([]);
  });

  it('sorts soonest-first and caps to MAX_SCHEDULED, flagging truncation', () => {
    // 61 timed to-dos spread across the window → soonest 60 kept.
    const todos: TodoItem[] = Array.from({ length: MAX_SCHEDULED + 1 }, (_, i) =>
      todo({
        id: `t-${i}` as UUID,
        dueDate: '2026-05-23',
        // stagger minutes so fireAt values are distinct and orderable
        dueTime: `${String(2 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
      })
    );
    const { reminders, truncated } = buildReminderSchedule(input({ todos }), NOW, PREFS);
    expect(reminders).toHaveLength(MAX_SCHEDULED);
    expect(truncated).toBe(true);
    for (let i = 1; i < reminders.length; i++) {
      expect(reminders[i].fireAt.getTime()).toBeGreaterThanOrEqual(
        reminders[i - 1].fireAt.getTime()
      );
    }
  });

  it('skips a malformed record without aborting the rest', () => {
    const good = activity({ id: 'good' as UUID, startTime: '15:00', reminderMinutes: 30 });
    const bad = { activity: null } as unknown as NotificationOccurrence;
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-22': [bad, occ('2026-05-22', good)] } }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0].id).toContain('good');
  });
});
