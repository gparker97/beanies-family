import { describe, it, expect } from 'vitest';
import {
  buildReminderSchedule,
  MAX_SCHEDULED,
  type ReminderInput,
  type ReminderPrefs,
} from '../useScheduledReminders';
import type { FamilyActivity, FamilyList, FamilyMember, TodoItem, UUID } from '@/types/models';
import type { NotificationOccurrence } from '@/utils/notifications';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { allDayFireTime, DEFAULT_TRAVEL_LEADS } from '@/utils/reminderSchedule';

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
  'reminders.listBody': 'Due today — {n} left',
  'reminders.listBodyForChild': '{who}’s list — {n} left',
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
    lists: [],
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
  helpfulHintNotifyByType: {},
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

  it('carries an activity deep link so a tap opens the activity', () => {
    const a = activity({ id: 'a-deep' as UUID, startTime: '15:00', reminderMinutes: 30 });
    const { reminders } = buildReminderSchedule(
      input({ occurrencesByDate: { '2026-05-22': [occ('2026-05-22', a)] } }),
      NOW,
      PREFS
    );
    expect(reminders[0].deepLink).toEqual({ path: '/activities', query: { activity: 'a-deep' } });
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

  it('carries the PARENT TRIP deep link (the occurrence already knows its vacationId)', () => {
    const { reminders } = buildReminderSchedule(
      input({ travelOccurrences: [travel({ vacationId: 'vac-deep' })] }),
      NOW,
      PREFS
    );
    expect(reminders[0].deepLink).toEqual({ path: '/travel', query: { vacation: 'vac-deep' } });
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

  it('carries a to-do deep link so a tap opens the item (incl. hint to-dos)', () => {
    const { reminders } = buildReminderSchedule(
      input({ todos: [todo({ id: 't-deep' as UUID, hintType: 'trip-packing' })] }),
      NOW,
      PREFS
    );
    expect(reminders[0].deepLink).toEqual({ path: '/todo', query: { view: 't-deep' } });
  });

  it('#40: schedules a hint to-do normally when its type is not muted on this device', () => {
    const { reminders, gated } = buildReminderSchedule(
      input({ todos: [todo({ hintType: 'trip-packing' })] }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(1);
    expect(gated).toBe(0);
  });

  it('#40: suppresses (gates) a hint to-do whose type is muted on this device', () => {
    const { reminders, gated } = buildReminderSchedule(
      input({ todos: [todo({ hintType: 'trip-packing' })] }),
      NOW,
      { ...PREFS, helpfulHintNotifyByType: { 'trip-packing': false } }
    );
    expect(reminders).toHaveLength(0);
    expect(gated).toBe(1);
  });

  it('#40: a DIFFERENT muted type does not affect this hint', () => {
    const { reminders } = buildReminderSchedule(
      input({ todos: [todo({ hintType: 'trip-packing' })] }),
      NOW,
      { ...PREFS, helpfulHintNotifyByType: { 'trip-documents': false } }
    );
    expect(reminders).toHaveLength(1);
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

// ── Beanie List due-date reminders ────────────────────────────────────────────
// The rule in one line: an explicit due date earns a morning reminder for the
// list's OWNER; being merely assigned does not. NOW is 2026-05-22T10:00 local,
// which is deliberately AFTER the 09:00 anchor — the same-day cases below turn
// on that.

function list(over: Partial<FamilyList> = {}): FamilyList {
  return {
    id: 'l-1' as UUID,
    title: 'Shopping',
    emoji: '🛒',
    category: 'out',
    ownerId: 'me',
    items: [{ id: 'i1', title: 'Milk', completed: false }],
    lifecycle: 'oneoff',
    dueDate: '2026-05-24',
    completed: false,
    createdBy: 'me' as UUID,
    createdAt: '2026-05-20T08:00:00.000Z',
    updatedAt: '2026-05-20T08:00:00.000Z',
    ...over,
  } as FamilyList;
}

const listsOf = (...ls: FamilyList[]) =>
  buildReminderSchedule(input({ lists: ls }), NOW, PREFS).reminders.filter(
    (r) => r.kind === 'list'
  );

describe('list due-date reminders', () => {
  it('fires at the 09:00 morning anchor on the due date', () => {
    const [r] = listsOf(list());
    expect(r).toBeDefined();
    expect(r.fireAt).toEqual(new Date('2026-05-24T09:00:00'));
    expect(r.kind).toBe('list');
    expect(r.title).toBe('Shopping');
  });

  it('carries a stable id and a deep link into the list drawer', () => {
    const [r] = listsOf(list());
    expect(r.id).toBe('list-due:l-1:2026-05-24');
    expect(r.deepLink).toEqual({ path: '/lists', query: { view: 'l-1' } });
  });

  it('says how many items are left, with no plural split', () => {
    const two = list({
      items: [
        { id: 'i1', title: 'Milk', completed: false },
        { id: 'i2', title: 'Eggs', completed: false },
        { id: 'i3', title: 'Jam', completed: true },
      ],
    });
    // Only OPEN items count — a ticked one is not "left".
    expect(listsOf(two)[0].body).toBe('Due today — 2 left');
    expect(listsOf(list())[0].body).toBe('Due today — 1 left');
  });

  it('🔴 schedules NOTHING for a list with no due date', () => {
    // The whole point of the rule: an assigned-but-undated list stays in the
    // daily briefing and never wakes a phone. Regressing this turns every list
    // a family owns into a notification.
    expect(listsOf(list({ dueDate: undefined }))).toEqual([]);
  });

  it('🔴 schedules NOTHING for another adult’s list', () => {
    // `input.lists` is the whole family's corpus. Without the owner gate, a list
    // Neil owns is pushed to Greg's lock screen.
    expect(listsOf(list({ ownerId: 'neil' }))).toEqual([]);
    expect(
      buildReminderSchedule(input({ lists: [list({ ownerId: 'neil' })] }), NOW, PREFS).gated
    ).toBe(1);
  });

  it('schedules nothing for a recurring list', () => {
    expect(listsOf(list({ lifecycle: 'recurring', frequency: 'weekly' }))).toEqual([]);
  });

  it('schedules nothing for a list already ticked off', () => {
    expect(listsOf(list({ completed: true, completedAt: '2026-05-23T10:00:00.000Z' }))).toEqual([]);
  });

  it('schedules nothing when every item is done, or there are none', () => {
    expect(listsOf(list({ items: [{ id: 'i1', title: 'Milk', completed: true }] }))).toEqual([]);
    expect(listsOf(list({ items: [] }))).toEqual([]);
  });

  it('schedules nothing for an overdue list — the briefing carries those', () => {
    expect(listsOf(list({ dueDate: '2026-05-21' }))).toEqual([]);
  });

  it('schedules nothing beyond the 14-day window', () => {
    expect(listsOf(list({ dueDate: '2026-06-30' }))).toEqual([]);
  });

  it('skips a malformed list without aborting the rest', () => {
    // Owned by the viewer, so it passes the audience gate and actually reaches
    // the `.items` deref that throws — otherwise this asserts nothing.
    const bad = {
      id: 'bad',
      dueDate: '2026-05-24',
      lifecycle: 'oneoff',
      ownerId: 'me',
    } as unknown as FamilyList;
    const res = buildReminderSchedule(
      input({ lists: [bad, list({ id: 'good' as UUID })] }),
      NOW,
      PREFS
    );
    expect(res.reminders.filter((r) => r.kind === 'list')).toHaveLength(1);
    expect(res.skipped).toBe(1);
  });
});

describe('list created after 09:00 on the day it is due', () => {
  // The case that would otherwise fire nothing at all: you make a shopping list
  // at 3pm for tonight's dinner. The morning anchor is long gone.
  it('🔴 still fires, shortly after the list was created', () => {
    const [r] = listsOf(
      list({ dueDate: '2026-05-22', createdAt: new Date('2026-05-22T15:00:00').toISOString() })
    );
    expect(r).toBeDefined();
    expect(r.fireAt).toEqual(new Date('2026-05-22T15:15:00'));
  });

  it('🔴 does NOT move when the record is edited — `updatedAt` must not reach it', () => {
    // The bug this replaces was real and user-felt. Keying the catch-up on
    // `max(createdAt, updatedAt)` meant every checkbox tick moved the fire time:
    // a list due today fired at 09:00, the shopper ticked an item at 09:30, the
    // schedule recomputed to 09:45 and re-armed the SAME stable id, so it buzzed
    // again — after every tick, for the whole shop. A tick after 23:44 pushed it
    // past midnight and cancelled the alarm outright.
    const created = new Date('2026-05-22T15:00:00').toISOString();
    const before = list({ dueDate: '2026-05-22', createdAt: created, updatedAt: created });
    const afterEdit = list({
      dueDate: '2026-05-22',
      createdAt: created,
      // ticked an hour later, and again near midnight
      updatedAt: new Date('2026-05-22T16:00:00').toISOString(),
    });
    const fireOf = (l: FamilyList) =>
      buildReminderSchedule(input({ lists: [l] }), NOW, PREFS).reminders.find(
        (r) => r.kind === 'list'
      )?.fireAt;
    expect(fireOf(before)).toEqual(new Date('2026-05-22T15:15:00'));
    expect(fireOf(afterEdit)).toEqual(new Date('2026-05-22T15:15:00'));

    const nearMidnight = list({
      dueDate: '2026-05-22',
      createdAt: created,
      updatedAt: new Date('2026-05-22T23:55:00').toISOString(),
    });
    // 🔴 Must NOT vanish: the old keying returned null here and cancelled the alarm.
    expect(fireOf(nearMidnight)).toEqual(new Date('2026-05-22T15:15:00'));
  });

  it('keeps the morning anchor when the list predates it', () => {
    // A list made days earlier must NOT be dragged to createdAt + grace.
    expect(allDayFireTime('2026-05-24', '2026-05-20T08:00:00.000Z')).toEqual(
      new Date('2026-05-24T09:00:00')
    );
  });

  it('🔴 refuses to spill past midnight into the wrong day', () => {
    // A list made at 23:55 must not fire "due today" at 00:10 tomorrow.
    expect(allDayFireTime('2026-05-22', new Date('2026-05-22T23:55:00').toISOString())).toBeNull();
  });

  it('degrades to the plain morning anchor when createdAt is unusable', () => {
    // Never schedule an alarm at an Invalid Date.
    expect(allDayFireTime('2026-05-24', 'not-a-date')).toEqual(new Date('2026-05-24T09:00:00'));
    expect(allDayFireTime('2026-05-24', undefined)).toEqual(new Date('2026-05-24T09:00:00'));
  });
});

describe('who a list reminder is armed for — the review’s findings', () => {
  // `classifyOwnerAudience` answers 'hidden' ONLY for an adult owner. Gating on
  // `!== 'hidden'` — the shape the to-do builder uses — therefore lets an empty,
  // stale or child owner through onto every device in the house. These are the
  // regression tests for that; each returned a reminder before the fix.
  const listsFor = (l: FamilyList, viewer = me) =>
    buildReminderSchedule(
      input({ lists: [l], currentMember: viewer }),
      NOW,
      PREFS
    ).reminders.filter((r) => r.kind === 'list');

  it('🔴 arms NOTHING for a list whose owner no longer exists', () => {
    // `familyStore.deleteMember` does not cascade to lists, so this is permanent
    // stored state, not a race. Pre-fix this armed on every remaining phone.
    expect(listsFor(list({ ownerId: 'ghost' }))).toEqual([]);
  });

  it('🔴 arms NOTHING for a list with an empty ownerId', () => {
    // `NewListSheet` writes `currentMember?.id ?? ''`, so this is reachable.
    expect(listsFor(list({ ownerId: '' }))).toEqual([]);
  });

  it('🔴 arms a CHILD’s list on a parent’s device, NAMING the child', () => {
    // Consistent with to-dos, at greg's request. The child's name is what makes it
    // safe to show: "Due today — 2 left" alone would read as the parent's own list,
    // which is why the body switches key for the `forChild` audience.
    const kid = { id: 'kid', name: 'Joey', isPet: false } as FamilyMember;
    // ⚠️ The viewer must be an ADULT (`isAdultMember` needs role/ageGroup), or
    // `classifyAudience` answers 'hidden' for the sibling case and this test
    // passes for the wrong reason — it did, until a mutation check caught it.
    const parent = { id: 'me', name: 'Greg', role: 'owner' } as FamilyMember;
    const resolve = (id: string) => (id === 'kid' ? kid : id === 'me' ? parent : undefined);
    const [r] = buildReminderSchedule(
      input({
        lists: [list({ ownerId: 'kid' })],
        currentMember: parent,
        resolveMember: resolve,
      }),
      NOW,
      PREFS
    ).reminders.filter((x) => x.kind === 'list');
    expect(r).toBeDefined();
    expect(r.body).toContain('Joey');
    expect(r.body).not.toBe('1 left');
  });

  it('still arms it on the OWNER’s own device', () => {
    // Anti-vacuity for all three above.
    expect(listsFor(list())).toHaveLength(1);
  });
});

describe('a due date added to a list made days ago', () => {
  it('a list made days ago does NOT get a same-day catch-up', () => {
    // The accepted cost of keying on an immutable timestamp. Dating an older list
    // "today" after 09:00 arms no OS reminder — but it DOES file a `list-due` bell
    // entry immediately (derived, not scheduled), which is the surface that covers
    // this case on every platform. See `allDayFireTime`'s warning for why the
    // alternative — keying on `updatedAt` — was strictly worse.
    const out = buildReminderSchedule(
      input({
        lists: [
          list({
            dueDate: '2026-05-22',
            createdAt: '2026-05-18T08:00:00.000Z',
            updatedAt: new Date('2026-05-22T11:00:00').toISOString(),
          }),
        ],
      }),
      NOW,
      PREFS
    ).reminders.filter((x) => x.kind === 'list');
    expect(out).toEqual([]);
  });

  it('keeps the plain morning anchor when the list predates the due day', () => {
    expect(allDayFireTime('2026-05-24', '2026-05-20T08:00:00.000Z')).toEqual(
      new Date('2026-05-24T09:00:00')
    );
  });
});

describe('a dropped list reminder is visible in telemetry', () => {
  // CLAUDE.md makes "could I diagnose this from the logs alone?" an acceptance
  // criterion. These two branches are the likeliest answers to "it never fired".
  it('counts a list whose moment has already passed today as gated', () => {
    // Due today, untouched since Monday: the 09:00 anchor is behind NOW (10:00).
    const res = buildReminderSchedule(
      input({
        lists: [
          list({
            dueDate: '2026-05-22',
            createdAt: '2026-05-20T08:00:00.000Z',
            updatedAt: '2026-05-20T08:00:00.000Z',
          }),
        ],
      }),
      NOW,
      PREFS
    );
    expect(res.reminders.filter((r) => r.kind === 'list')).toEqual([]);
    expect(res.gated).toBe(1);
  });

  it('counts a catch-up that would spill past midnight as gated', () => {
    const res = buildReminderSchedule(
      input({
        lists: [
          list({
            dueDate: '2026-05-22',
            updatedAt: new Date('2026-05-22T23:55:00').toISOString(),
          }),
        ],
      }),
      NOW,
      PREFS
    );
    expect(res.reminders.filter((r) => r.kind === 'list')).toEqual([]);
    expect(res.gated).toBe(1);
  });
});

describe('an untimed to-do dated after the morning anchor', () => {
  // The same hole the list builder had, on a far more used feature: an untimed
  // to-do due today whose 09:00 has already passed armed nothing at all.
  // `buildTodoReminders` now shares `allDayFireTime` with the list builder.
  it('🔴 still fires when it was created this afternoon for today', () => {
    const t3pm = new Date('2026-05-22T15:00:00').toISOString();
    const { reminders } = buildReminderSchedule(
      input({
        todos: [
          todo({
            dueDate: '2026-05-22',
            dueTime: undefined,
            createdAt: t3pm,
            updatedAt: t3pm,
          } as Partial<TodoItem>),
        ],
      }),
      NOW,
      PREFS
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0].fireAt).toEqual(new Date('2026-05-22T15:15:00'));
  });

  it('an OLD to-do dated "today" this afternoon gets no catch-up', () => {
    // Deliberate. The catch-up keys on `createdAt`, which never moves — keying it
    // on `updatedAt` so this case worked re-armed already-delivered reminders on
    // every edit, which was far worse. See `allDayFireTime`.
    const { reminders } = buildReminderSchedule(
      input({
        todos: [
          todo({
            dueDate: '2026-05-22',
            dueTime: undefined,
            createdAt: '2026-05-18T08:00:00.000Z',
            updatedAt: new Date('2026-05-22T11:00:00').toISOString(),
          } as Partial<TodoItem>),
        ],
      }),
      NOW,
      PREFS
    );
    expect(reminders).toEqual([]);
  });

  it('keeps the plain 09:00 anchor for a to-do dated in the future', () => {
    // Anti-vacuity: the catch-up must not drag a future reminder forward.
    const { reminders } = buildReminderSchedule(
      input({
        todos: [
          todo({
            dueDate: '2026-05-24',
            dueTime: undefined,
            createdAt: '2026-05-18T08:00:00.000Z',
            updatedAt: '2026-05-18T08:00:00.000Z',
          } as Partial<TodoItem>),
        ],
      }),
      NOW,
      PREFS
    );
    expect(reminders[0].fireAt).toEqual(new Date('2026-05-24T09:00:00'));
  });
});
