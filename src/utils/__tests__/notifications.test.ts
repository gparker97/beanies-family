import { describe, it, expect, vi } from 'vitest';
import {
  deriveNotifications,
  markReadIn,
  markUnreadIn,
  markAllReadIn,
  pruneReadState,
  todoDueId,
  todoAssignedId,
  activityReminderId,
  whatsNewId,
  announcementId,
  tipId,
  type DeriveInput,
} from '@/utils/notifications';
import type { FamilyMember, TodoItem, FamilyActivity } from '@/types/models';
import type { ReleaseNote } from '@/content/release-notes';
import type { Announcement } from '@/content/announcements';
import type { BeanTip } from '@/content/tips';

// ── Fixtures ──────────────────────────────────────────────────────────────────
function member(
  id: string,
  ageGroup: 'adult' | 'child',
  extra: Partial<FamilyMember> = {}
): FamilyMember {
  return {
    id,
    name: id.toUpperCase(),
    email: `${id}@example.com`,
    gender: 'other',
    ageGroup,
    role: 'member',
    color: '#000000',
    requiresPassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as FamilyMember;
}

const viewer = member('v', 'adult');
const other = member('o', 'adult');
const child = member('c', 'child');
const pet = member('p', 'adult', { isPet: true });
const MEMBERS = [viewer, other, child, pet];

// Tuesday 27 May 2026, 09:00 local — the injected derive clock.
const NOW = new Date(2026, 4, 27, 9, 0, 0, 0);

function todo(o: Partial<TodoItem>): TodoItem {
  return {
    id: 't1',
    title: 'Task',
    completed: false,
    createdBy: 'v',
    createdAt: '2026-05-20T08:00:00.000Z',
    updatedAt: '2026-05-20T08:00:00.000Z',
    ...o,
  } as TodoItem;
}

function activity(o: Partial<FamilyActivity>): FamilyActivity {
  return {
    id: 'a1',
    title: 'Swim',
    date: '2026-05-27',
    recurrence: 'none',
    category: 'sports',
    feeSchedule: 'none',
    reminderMinutes: 30,
    ...o,
  } as FamilyActivity;
}

function derive(overrides: Partial<DeriveInput>, now: Date = NOW) {
  const base: DeriveInput = {
    todos: [],
    members: MEMBERS,
    currentMember: viewer,
    releaseNotes: [],
    announcements: [],
    issuedTips: [],
    tipsById: new Map<string, BeanTip>(),
    activeNudge: null,
    readState: {},
    windowDays: 30,
    occurrencesByDate: {},
  };
  return deriveNotifications({ ...base, ...overrides }, now);
}

const byId = (list: ReturnType<typeof derive>, id: string) => list.find((n) => n.id === id);

describe('deriveNotifications — community nudge', () => {
  it('emits one nudge when activeNudge is set; id + sourceId encode the messageIndex', () => {
    const out = derive({ activeNudge: { messageIndex: 2, issuedAt: NOW.getTime() } });
    const nudges = out.filter((n) => n.kind === 'communityNudge');
    expect(nudges).toHaveLength(1);
    expect(nudges[0]?.id).toBe('community-nudge:2');
    expect(nudges[0]?.sourceId).toBe('2');
  });

  it('emits no nudge when activeNudge is null', () => {
    const out = derive({ activeNudge: null });
    expect(out.some((n) => n.kind === 'communityNudge')).toBe(false);
  });
});

describe('deriveNotifications — todo-due', () => {
  it('dated, no time → fires morning-of (start of due day), not overdue when due today', () => {
    const out = derive({ todos: [todo({ assigneeIds: ['v'], dueDate: '2026-05-27' })] });
    const n = byId(out, todoDueId('t1', '2026-05-27'));
    expect(n).toBeDefined();
    expect(n?.kind).toBe('todo-due');
    expect(new Date(n!.occurredAt)).toEqual(new Date(2026, 4, 27, 0, 0, 0, 0)); // local midnight
    expect(n?.overdue).toBe(false);
    expect(n?.route).toBe('/todo');
    expect(n?.query).toEqual({ view: 't1' });
  });

  it('dated + timed → fires ~30 min before the due time', () => {
    const out = derive({
      todos: [todo({ assigneeIds: ['v'], dueDate: '2026-05-27', dueTime: '09:20' })],
    });
    const n = byId(out, todoDueId('t1', '2026-05-27'));
    expect(n).toBeDefined();
    expect(new Date(n!.occurredAt)).toEqual(new Date(2026, 4, 27, 8, 50, 0, 0)); // 09:20 − 30m
    expect(n?.overdue).toBe(false);
  });

  it('a timed todo whose trigger is still in the future is NOT yet active', () => {
    const out = derive({
      todos: [todo({ assigneeIds: ['v'], dueDate: '2026-05-27', dueTime: '10:00' })],
    });
    expect(byId(out, todoDueId('t1', '2026-05-27'))).toBeUndefined(); // trigger 09:30 > now 09:00
  });

  it('escalates to overdue once the due day has passed', () => {
    const out = derive({ todos: [todo({ assigneeIds: ['v'], dueDate: '2026-05-26' })] });
    expect(byId(out, todoDueId('t1', '2026-05-26'))?.overdue).toBe(true);
  });

  it('excludes completed and someday todos', () => {
    expect(
      derive({ todos: [todo({ assigneeIds: ['v'], dueDate: '2026-05-27', completed: true })] })
    ).toHaveLength(0);
    expect(
      derive({ todos: [todo({ assigneeIds: ['v'], dueDate: '2026-05-27', someday: true })] })
    ).toHaveLength(0);
  });

  it('excludes a todo whose audience is hidden for the viewer (owned by another adult)', () => {
    const out = derive({ todos: [todo({ assigneeIds: ['o'], dueDate: '2026-05-27' })] });
    expect(byId(out, todoDueId('t1', '2026-05-27'))).toBeUndefined();
  });

  it('drops a due trigger older than the 30-day window', () => {
    const out = derive({ todos: [todo({ assigneeIds: ['v'], dueDate: '2026-04-01' })] });
    expect(byId(out, todoDueId('t1', '2026-04-01'))).toBeUndefined();
  });
});

describe('deriveNotifications — todo-assigned', () => {
  it('fires when someone else assigned it to me (no date)', () => {
    const out = derive({ todos: [todo({ assigneeIds: ['v'], createdBy: 'o' })] });
    expect(byId(out, todoAssignedId('t1'))).toBeDefined();
  });

  it('fires for a self-assigned no-date/no-time todo (otherwise it would never surface)', () => {
    const out = derive({ todos: [todo({ assigneeIds: ['v'], createdBy: 'v' })] });
    expect(byId(out, todoAssignedId('t1'))).toBeDefined();
  });

  it('does NOT fire for a self-assigned DATED todo (the due trigger covers it)', () => {
    const out = derive({
      todos: [todo({ assigneeIds: ['v'], createdBy: 'v', dueDate: '2026-05-27' })],
    });
    expect(byId(out, todoAssignedId('t1'))).toBeUndefined();
    expect(byId(out, todoDueId('t1', '2026-05-27'))).toBeDefined();
  });

  it('other-created + dated yields BOTH assigned and due (distinct ids)', () => {
    const out = derive({
      todos: [todo({ assigneeIds: ['v'], createdBy: 'o', dueDate: '2026-05-27' })],
    });
    expect(byId(out, todoAssignedId('t1'))).toBeDefined();
    expect(byId(out, todoDueId('t1', '2026-05-27'))).toBeDefined();
  });
});

describe('deriveNotifications — activity-reminder', () => {
  it('timed → fires at start − reminderMinutes', () => {
    const out = derive({
      occurrencesByDate: {
        '2026-05-27': [
          {
            activity: activity({ assigneeIds: ['v'], startTime: '09:20', reminderMinutes: 30 }),
            date: '2026-05-27',
          },
        ],
      },
    });
    const n = byId(out, activityReminderId('a1', '2026-05-27'));
    expect(n).toBeDefined();
    expect(new Date(n!.occurredAt)).toEqual(new Date(2026, 4, 27, 8, 50, 0, 0));
    expect(n?.route).toBe('/activities');
    expect(n?.query).toEqual({ activity: 'a1' });
  });

  it('no startTime → fires morning-of (start of occurrence day)', () => {
    const out = derive({
      occurrencesByDate: {
        '2026-05-27': [
          { activity: activity({ assigneeIds: ['v'], startTime: undefined }), date: '2026-05-27' },
        ],
      },
    });
    expect(new Date(byId(out, activityReminderId('a1', '2026-05-27'))!.occurredAt)).toEqual(
      new Date(2026, 4, 27, 0, 0, 0, 0)
    );
  });

  it('a DUTY-ONLY occurrence (viewer is only the drop-off, not an assignee) still fires (source-trap guard)', () => {
    const out = derive({
      occurrencesByDate: {
        '2026-05-27': [
          {
            // assigned to another adult → audience hidden — but viewer is the drop-off.
            activity: activity({ assigneeIds: ['o'], dropoffMemberId: 'v', startTime: '09:20' }),
            date: '2026-05-27',
          },
        ],
      },
    });
    expect(byId(out, activityReminderId('a1', '2026-05-27'))).toBeDefined();
  });
});

describe('deriveNotifications — at-a-glance enrichment', () => {
  it('activity carries who·where subtitle + event date/time', () => {
    const out = derive({
      occurrencesByDate: {
        '2026-05-27': [
          {
            activity: activity({ assigneeIds: ['c'], location: 'Bukit Timah', startTime: '09:20' }),
            date: '2026-05-27',
          },
        ],
      },
    });
    const n = byId(out, activityReminderId('a1', '2026-05-27'))!;
    expect(n.subtitle).toBe('C · Bukit Timah'); // child 'c' name 'C' + location
    expect(n.eventDate).toBe('2026-05-27');
    expect(n.eventTime).toBe('09:20');
  });

  it('a drop-off duty sets dutyRole', () => {
    const out = derive({
      occurrencesByDate: {
        '2026-05-27': [
          {
            activity: activity({ assigneeIds: ['o'], dropoffMemberId: 'v', startTime: '09:20' }),
            date: '2026-05-27',
          },
        ],
      },
    });
    expect(byId(out, activityReminderId('a1', '2026-05-27'))?.dutyRole).toBe('dropoff');
  });

  it('todo-assigned carries the assigner name when someone else assigned it', () => {
    const out = derive({ todos: [todo({ assigneeIds: ['v'], createdBy: 'o' })] });
    expect(byId(out, todoAssignedId('t1'))?.assignedByName).toBe('O');
  });

  it('todo-due carries the due date/time', () => {
    const out = derive({
      todos: [todo({ assigneeIds: ['v'], dueDate: '2026-05-27', dueTime: '09:15' })],
    });
    const n = byId(out, todoDueId('t1', '2026-05-27'))!;
    expect(n.eventDate).toBe('2026-05-27');
    expect(n.eventTime).toBe('09:15');
  });
});

describe('deriveNotifications — whats-new', () => {
  const releases: ReleaseNote[] = [
    { version: '2026.05', date: '2026-05-01', month: 'may 2026', features: [] },
    { version: '2026.03', date: '2026-03-01', month: 'march 2026', features: [] }, // older than the window
  ];

  it('produces one per release, window-exempt (old release still present), read resolved', () => {
    const out = derive({
      releaseNotes: releases,
      readState: { [whatsNewId('2026.05')]: '2026-05-02T00:00:00.000Z' },
    });
    expect(byId(out, whatsNewId('2026.05'))?.read).toBe(true);
    expect(byId(out, whatsNewId('2026.03'))).toBeDefined(); // not pruned by the 30-day window
    expect(byId(out, whatsNewId('2026.03'))?.read).toBe(false);
  });
});

describe('deriveNotifications — announcements', () => {
  const ann = (over: Partial<Announcement> = {}): Announcement => ({
    id: 'a1',
    date: '2026-05-28',
    month: '28 may 2026',
    title: { en: 'T', beanie: 't' },
    message: { en: 'M', beanie: 'm' },
    ...over,
  });

  it('emits one announcement notification, window-exempt, read resolved', () => {
    const out = derive({
      announcements: [ann()],
      readState: { [announcementId('a1')]: '2026-05-28T00:00:00.000Z' },
    });
    const n = byId(out, announcementId('a1'));
    expect(n?.kind).toBe('announcement');
    expect(n?.sourceId).toBe('a1');
    expect(n?.read).toBe(true);
  });

  it('honours startsAt (future) and expiresAt (past) — not derived outside the window', () => {
    const future = derive({ announcements: [ann({ startsAt: '2030-01-01' })] });
    expect(byId(future, announcementId('a1'))).toBeUndefined();
    const expired = derive({ announcements: [ann({ expiresAt: '2020-01-01' })] });
    expect(byId(expired, announcementId('a1'))).toBeUndefined();
  });
});

describe('deriveNotifications — tip', () => {
  const tipA: BeanTip = {
    id: 'tip-a',
    category: 'finance',
    tryItRoute: '/transactions',
    message: { en: 'A message', beanie: 'a message' },
  };
  const tipB: BeanTip = {
    id: 'tip-b',
    category: 'family',
    message: { en: 'B message', beanie: 'b message' },
  };
  const tipsById = new Map<string, BeanTip>([
    [tipA.id, tipA],
    [tipB.id, tipB],
  ]);

  it('emits one tip per issuedTips entry, with route from tryItRoute', () => {
    const out = derive({
      issuedTips: [
        { tipId: 'tip-a', issuedAt: '2026-05-27T09:00:00.000Z' },
        { tipId: 'tip-b', issuedAt: '2026-05-28T09:00:00.000Z' },
      ],
      tipsById,
    });
    const a = byId(out, tipId('tip-a'));
    const b = byId(out, tipId('tip-b'));
    expect(a?.kind).toBe('tip');
    expect(a?.sourceId).toBe('tip-a');
    expect(a?.route).toBe('/transactions');
    expect(b?.route).toBeUndefined(); // tipB has no tryItRoute
  });

  it('is window-exempt — a 60-day-old issuance still produces a notification', () => {
    const old = '2026-03-28T09:00:00.000Z'; // ~60 days before NOW
    const out = derive({
      issuedTips: [{ tipId: 'tip-a', issuedAt: old }],
      tipsById,
    });
    expect(byId(out, tipId('tip-a'))).toBeDefined();
  });

  it('skips a tip whose id is no longer in the catalogue (no throw, console.warn)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = derive({
      issuedTips: [{ tipId: 'tip-gone', issuedAt: '2026-05-27T09:00:00.000Z' }],
      tipsById,
    });
    expect(byId(out, tipId('tip-gone'))).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('malformed issuedAt falls back to the raw string in occurredAt', () => {
    const out = derive({
      issuedTips: [{ tipId: 'tip-a', issuedAt: 'not-a-date' }],
      tipsById,
    });
    expect(byId(out, tipId('tip-a'))?.occurredAt).toBe('not-a-date');
  });

  it('read-state resolves against the tip: prefixed id', () => {
    const out = derive({
      issuedTips: [{ tipId: 'tip-a', issuedAt: '2026-05-27T09:00:00.000Z' }],
      tipsById,
      readState: { [tipId('tip-a')]: '2026-05-27T10:00:00.000Z' },
    });
    expect(byId(out, tipId('tip-a'))?.read).toBe(true);
  });

  it('an entry missing tipId is skipped (no throw, console.warn)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      derive({
        issuedTips: [{ tipId: '', issuedAt: '2026-05-27T09:00:00.000Z' }],
        tipsById,
      })
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('deriveNotifications — totality', () => {
  it('never throws on malformed records; skips them', () => {
    expect(() =>
      derive({
        todos: [
          todo({
            id: 'bad',
            assigneeIds: ['v'],
            dueDate: 'garbage',
            createdAt: 'not-a-date',
            createdBy: 'o',
          }),
        ],
        occurrencesByDate: {
          '2026-05-27': [{ activity: undefined as unknown as FamilyActivity, date: '2026-05-27' }],
        },
      })
    ).not.toThrow();
    const out = derive({
      todos: [
        todo({
          id: 'bad',
          assigneeIds: ['v'],
          dueDate: 'garbage',
          createdBy: 'o',
          createdAt: 'not-a-date',
        }),
      ],
    });
    expect(out).toHaveLength(0);
  });
});

describe('read-state reducers', () => {
  it('markReadIn / markUnreadIn', () => {
    const m = markReadIn({}, 'x', '2026-05-27T00:00:00.000Z');
    expect(m.x).toBe('2026-05-27T00:00:00.000Z');
    expect(markUnreadIn(m, 'x')).toEqual({});
    expect(markUnreadIn({}, 'missing')).toEqual({}); // no-op, returns the same shape
  });

  it('markAllReadIn adds missing ids but keeps existing readAt', () => {
    const m = markAllReadIn({ a: 'old' }, ['a', 'b'], 'new');
    expect(m).toEqual({ a: 'old', b: 'new' });
  });

  it('pruneReadState drops stale ids but ALWAYS keeps whats-new:* / announcement:* / tip:*', () => {
    const m = {
      'todo-due:t1:2026-05-27': 'r',
      'todo-due:gone:2026-01-01': 'r',
      'whats-new:2026.01': 'r',
      'announcement:discord-community-2026-05': 'r',
      'tip:tip-link-txn': 'r',
    };
    const pruned = pruneReadState(m, ['todo-due:t1:2026-05-27']);
    expect(pruned).toEqual({
      'todo-due:t1:2026-05-27': 'r',
      'whats-new:2026.01': 'r',
      'announcement:discord-community-2026-05': 'r',
      'tip:tip-link-txn': 'r',
    });
  });
});

describe('audience matrix (via the deriver)', () => {
  it('a child-assigned todo is forChild for the adult viewer (visible) and hidden for the pet', () => {
    const todos = [todo({ assigneeIds: ['c'], dueDate: '2026-05-27' })];
    expect(byId(derive({ todos }), todoDueId('t1', '2026-05-27'))).toBeDefined(); // adult sees forChild
    expect(
      byId(derive({ todos, currentMember: pet }), todoDueId('t1', '2026-05-27'))
    ).toBeUndefined();
  });

  it('an unassigned todo is visible to a non-pet viewer', () => {
    expect(
      byId(
        derive({ todos: [todo({ assigneeIds: [], dueDate: '2026-05-27' })] }),
        todoDueId('t1', '2026-05-27')
      )
    ).toBeDefined();
  });
});
