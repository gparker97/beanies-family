import { describe, it, expect } from 'vitest';
import {
  buildTodoDrafts,
  markDuplicateDrafts,
  resolveTodoAssignee,
  resolveTodoDue,
  todoDescription,
  todoTitleSimilarity,
  TODO_MATCH_THRESHOLD,
  type TodoAssigneeContext,
  type TodoDraft,
} from '@/utils/magicTodoDrafts';
import { TITLE_MATCH_THRESHOLD } from '@/utils/textSimilarity';
import type { FamilyMember, TodoItem } from '@/types/models';
import type { TodoItemExtraction } from '@/services/ai/types';

function member(id: string, name: string, aliases?: string[]): FamilyMember {
  return { id, name, ...(aliases ? { aliases } : {}) } as FamilyMember;
}

const ROSTER = [
  member('m-greg', 'Greg'),
  member('m-sophia', 'Sophia'),
  member('m-leo', 'Leo', ['Leonardo']),
  member('m-sam-a', 'Sam Smith'),
  member('m-sam-b', 'Sam Jones'),
];

function item(over: Partial<TodoItemExtraction> = {}): TodoItemExtraction {
  return {
    title: 'Return the permission slip',
    details: null,
    dueDate: null,
    dueTime: null,
    timing: null,
    assigneeName: null,
    ownerCard: null,
    links: [],
    ...over,
  };
}

const HOLDERS = new Map([['school-forms', 'm-sophia']]);
const ctx = (over: Partial<TodoAssigneeContext> = {}): TodoAssigneeContext => ({
  roster: ROSTER,
  holderFor: (id) => HOLDERS.get(id),
  submitterId: 'm-greg',
  ...over,
});

describe('resolveTodoAssignee', () => {
  it('prefers a named member over the card holder and the submitter', () => {
    expect(
      resolveTodoAssignee(item({ assigneeName: 'leo', ownerCard: 'school-forms' }), ctx())
    ).toEqual({ assigneeIds: ['m-leo'], reason: 'named' });
  });

  it('matches a name by alias', () => {
    expect(resolveTodoAssignee(item({ assigneeName: 'Leonardo' }), ctx()).reason).toBe('named');
  });

  it('drops an ambiguous name and falls through to the card holder', () => {
    // "Sam" is both Sam Smith and Sam Jones: the matcher refuses to guess.
    expect(
      resolveTodoAssignee(item({ assigneeName: 'Sam', ownerCard: 'school-forms' }), ctx())
    ).toEqual({ assigneeIds: ['m-sophia'], reason: 'owner', ownerCardId: 'school-forms' });
  });

  it('falls through an unknown name to the submitter', () => {
    expect(resolveTodoAssignee(item({ assigneeName: 'Mrs Patel' }), ctx())).toEqual({
      assigneeIds: ['m-greg'],
      reason: 'submitter',
    });
  });

  it('falls back to the submitter when the card has no single holder (split or unheld)', () => {
    expect(resolveTodoAssignee(item({ ownerCard: 'lunchboxes' }), ctx())).toEqual({
      assigneeIds: ['m-greg'],
      reason: 'submitter',
    });
  });

  it('leaves the to-do unassigned when there is no submitter either', () => {
    expect(resolveTodoAssignee(item(), ctx({ submitterId: null }))).toEqual({
      assigneeIds: [],
      reason: null,
    });
  });
});

describe('resolveTodoDue', () => {
  const today = '2026-10-01';
  const nowTime = '12:00';

  it('keeps a valid stated date, even beside an event', () => {
    expect(
      resolveTodoDue(item({ dueDate: '2026-10-09', timing: 'on_event_day' }), {
        eventDate: '2026-10-13',
        today,
        nowTime,
      })
    ).toEqual({ dueDate: '2026-10-09', matchDate: '2026-10-09' });
  });

  it('does not clamp a stated date', () => {
    expect(resolveTodoDue(item({ dueDate: '2026-09-20' }), { today, nowTime })).toEqual({
      dueDate: '2026-09-20',
      matchDate: '2026-09-20',
    });
  });

  it('ignores an invalid stated date and derives instead', () => {
    expect(
      resolveTodoDue(item({ dueDate: '2026-02-30' }), { eventDate: '2026-10-13', today, nowTime })
    ).toEqual({ dueDate: '2026-10-12', dueDerived: 'day_before', matchDate: '2026-10-12' });
  });

  it('puts an on-event-day to-do on the event date', () => {
    expect(
      resolveTodoDue(item({ timing: 'on_event_day' }), {
        eventDate: '2026-10-13',
        today,
        nowTime,
      })
    ).toEqual({ dueDate: '2026-10-13', dueDerived: 'event_day', matchDate: '2026-10-13' });
  });

  it('puts a before-event to-do on the day before', () => {
    expect(
      resolveTodoDue(item({ timing: 'before_event' }), {
        eventDate: '2026-10-13',
        today,
        nowTime,
      })
    ).toEqual({ dueDate: '2026-10-12', dueDerived: 'day_before', matchDate: '2026-10-12' });
  });

  it('puts an undated companion to-do with no timing on the day before', () => {
    expect(
      resolveTodoDue(item(), { eventDate: '2026-10-01', today: '2026-09-29', nowTime })
    ).toEqual({ dueDate: '2026-09-30', dueDerived: 'day_before', matchDate: '2026-09-30' });
  });

  it('clamps a derived date to today, drops the label, and keeps the real date for matching', () => {
    expect(resolveTodoDue(item(), { eventDate: '2026-10-01', today, nowTime })).toEqual({
      dueDate: today,
      matchDate: '2026-09-30',
    });
  });

  it('derives nothing from an invalid event date', () => {
    expect(
      resolveTodoDue(item({ timing: 'on_event_day' }), {
        eventDate: '2026-13-45',
        today,
        nowTime,
      })
    ).toEqual({});
  });

  it('leaves an undated to-do-only item undated', () => {
    expect(resolveTodoDue(item({ timing: 'before_event' }), { today, nowTime })).toEqual({});
  });

  it('keeps a stated time with a stated date', () => {
    expect(
      resolveTodoDue(item({ dueDate: '2026-10-02', dueTime: '10:00' }), { today, nowTime })
    ).toEqual({ dueDate: '2026-10-02', matchDate: '2026-10-02', dueTime: '10:00' });
  });

  it('keeps a stated time already past on a stated date of today (truthfully overdue)', () => {
    expect(resolveTodoDue(item({ dueDate: today, dueTime: '09:00' }), { today, nowTime })).toEqual({
      dueDate: today,
      matchDate: today,
      dueTime: '09:00',
    });
  });

  it('keeps a stated time on an unclamped derived date', () => {
    expect(
      resolveTodoDue(item({ timing: 'on_event_day', dueTime: '07:30' }), {
        eventDate: '2026-10-13',
        today,
        nowTime,
      })
    ).toEqual({
      dueDate: '2026-10-13',
      dueDerived: 'event_day',
      matchDate: '2026-10-13',
      dueTime: '07:30',
    });
  });

  it('keeps a stated time still ahead on a derived date of today', () => {
    expect(
      resolveTodoDue(item({ timing: 'on_event_day', dueTime: '12:01' }), {
        eventDate: today,
        today,
        nowTime,
      })
    ).toMatchObject({ dueDate: today, dueDerived: 'event_day', dueTime: '12:01' });
  });

  it('drops a stated time already past (or right now) on a derived date of today', () => {
    for (const dueTime of ['07:30', '12:00']) {
      expect(
        resolveTodoDue(item({ timing: 'on_event_day', dueTime }), {
          eventDate: today,
          today,
          nowTime,
        })
      ).toEqual({
        dueDate: today,
        dueDerived: 'event_day',
        matchDate: today,
        timeDropped: 'past_today',
      });
    }
  });

  it('drops a stated time already past on a derived date clamped to today', () => {
    expect(
      resolveTodoDue(item({ dueTime: '08:15' }), { eventDate: '2026-10-01', today, nowTime })
    ).toEqual({ dueDate: today, matchDate: '2026-09-30', timeDropped: 'past_today' });
  });

  it('keeps a stated time still ahead on a derived date clamped to today', () => {
    expect(
      resolveTodoDue(item({ dueTime: '17:30' }), { eventDate: '2026-10-01', today, nowTime })
    ).toEqual({ dueDate: today, matchDate: '2026-09-30', dueTime: '17:30' });
  });

  it('drops a stated time with no date to sit on', () => {
    expect(resolveTodoDue(item({ dueTime: '15:00' }), { today, nowTime })).toEqual({
      timeDropped: 'no_date',
    });
  });
});

describe('todoDescription', () => {
  it('puts details first, then each new link on its own line, deduped', () => {
    expect(
      todoDescription('Pay through the portal', [
        'https://portal.example.org/trips',
        'https://portal.example.org/trips',
        'https://example.org/info',
      ])
    ).toBe('Pay through the portal\nhttps://portal.example.org/trips\nhttps://example.org/info');
  });

  it('skips a link the details already contain', () => {
    expect(todoDescription('See https://a.example.org', ['https://a.example.org'])).toBe(
      'See https://a.example.org'
    );
  });

  it('is empty with no details and no links', () => {
    expect(todoDescription(null, [])).toBe('');
  });
});

describe('buildTodoDrafts', () => {
  it('builds one draft per item with unique ids, resolved assignee and due date', () => {
    const drafts = buildTodoDrafts(
      {
        items: [
          item({ title: '  Return the slip ', dueDate: '2026-10-09', ownerCard: 'school-forms' }),
          item({
            title: 'Pay the trip fee',
            timing: 'before_event',
            links: ['https://portal.example.org/trips', 'https://portal.example.org/trips'],
          }),
          item({ title: 'Pack sunscreen', timing: 'on_event_day' }),
        ],
      },
      { ...ctx(), eventDate: '2026-10-13', today: '2026-09-29', nowTime: '12:00' }
    );

    expect(drafts).toHaveLength(3);
    expect(new Set(drafts.map((d) => d.id)).size).toBe(3);
    expect(drafts[0]).toMatchObject({
      title: 'Return the slip',
      dueDate: '2026-10-09',
      assigneeIds: ['m-sophia'],
      reason: 'owner',
      ownerCardId: 'school-forms',
      skipped: false,
    });
    expect(drafts[0]!.dueDerived).toBeUndefined();
    expect(drafts[1]).toMatchObject({
      dueDate: '2026-10-12',
      dueDerived: 'day_before',
      reason: 'submitter',
      links: ['https://portal.example.org/trips'],
      description: 'https://portal.example.org/trips',
    });
    expect(drafts[2]).toMatchObject({ dueDate: '2026-10-13', dueDerived: 'event_day' });
  });

  it('carries a stated time onto the draft', () => {
    const [d] = buildTodoDrafts(
      { items: [item({ title: 'Walk the dog', dueDate: '2026-09-30', dueTime: '10:00' })] },
      { ...ctx(), today: '2026-09-29', nowTime: '12:00' }
    );
    expect(d).toMatchObject({ dueDate: '2026-09-30', dueTime: '10:00' });
  });
});

// ── Duplicates ──────────────────────────────────────────────────────────────

function todo(over: Partial<TodoItem> & Pick<TodoItem, 'id' | 'title'>): TodoItem {
  return {
    completed: false,
    createdBy: 'm-greg',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

function draft(over: Partial<TodoDraft> & Pick<TodoDraft, 'id' | 'title'>): TodoDraft {
  return { description: '', assigneeIds: [], reason: null, links: [], skipped: false, ...over };
}

describe('title similarity at the to-do threshold', () => {
  it('sits above the shared activity threshold', () => {
    expect(TODO_MATCH_THRESHOLD).toBeGreaterThan(TITLE_MATCH_THRESHOLD);
  });

  it('two distinct to-dos from the same note stay below it', () => {
    expect(todoTitleSimilarity('Pack sunscreen', 'Pack a packed lunch')).toBeLessThan(
      TODO_MATCH_THRESHOLD
    );
  });

  it('ignores filler words, so a reworded re-read of the same to-do matches', () => {
    const pairs: [string, string][] = [
      ['Return form', 'Return the form'],
      ['Pay fee', 'Pay the fee'],
      ['Return the signed permission slip', 'Return permission slip'],
      ['Pack sunscreen, a hat and a packed lunch', 'Pack sunscreen, hat, and packed lunch'],
      ['Pay the $12 trip fee', 'Pay the trip fee'],
    ];
    for (const [a, b] of pairs) {
      expect(todoTitleSimilarity(a, b), `${a} vs ${b}`).toBeGreaterThanOrEqual(
        TODO_MATCH_THRESHOLD
      );
    }
  });

  it('keeps two different to-dos one content word apart below it', () => {
    const pairs: [string, string][] = [
      ['Pay the soccer fee', 'Pay the swim fee'],
      ['Return the library book', 'Return the library card'],
    ];
    for (const [a, b] of pairs) {
      expect(todoTitleSimilarity(a, b), `${a} vs ${b}`).toBeLessThan(TODO_MATCH_THRESHOLD);
    }
  });

  it('strips fillers only as whole words, in any case', () => {
    // "Another" and "Pay" contain "a"/"an"; "THE" and "Please" are fillers.
    expect(todoTitleSimilarity('Please pay THE fee', 'pay fee')).toBe(1);
    expect(todoTitleSimilarity('Order another one', 'Order one')).toBeLessThan(1);
  });

  it('compares titles as written when one is nothing but fillers', () => {
    expect(todoTitleSimilarity('For the', 'for THE')).toBe(1);
    expect(todoTitleSimilarity('The end', 'The')).toBe(0.5);
  });
});

describe('markDuplicateDrafts: which existing to-dos are candidates', () => {
  // Every existing to-do has the draft's title, so a flag means "was a candidate".
  const TITLE = 'Pay the trip fee';
  const flaggedBy = (
    over: Partial<TodoDraft>,
    existing: Partial<TodoItem>,
    probableActivityId?: string
  ): boolean => {
    const [d] = markDuplicateDrafts(
      [draft({ id: 'd1', title: TITLE, ...over })],
      [todo({ id: 't1', title: TITLE, ...existing })],
      { probableActivityId }
    );
    return d!.duplicateOf?.id === 't1';
  };

  it('takes an open to-do on the same day, ignoring the time part', () => {
    expect(flaggedBy({ dueDate: '2026-10-13' }, { dueDate: '2026-10-13T00:00:00Z' })).toBe(true);
  });

  it('skips a to-do on another day, and a done one on the same day', () => {
    expect(flaggedBy({ dueDate: '2026-10-13' }, { dueDate: '2026-10-14' })).toBe(false);
    expect(flaggedBy({ dueDate: '2026-10-13' }, { dueDate: '2026-10-13', completed: true })).toBe(
      false
    );
  });

  it('treats two undated to-dos as the same day, but not undated against dated', () => {
    expect(flaggedBy({}, {})).toBe(true);
    expect(flaggedBy({}, { dueDate: '2026-10-13' })).toBe(false);
    expect(flaggedBy({ dueDate: '2026-10-13' }, {})).toBe(false);
  });

  it('never takes a helpful hint, even linked to the probable activity', () => {
    expect(
      flaggedBy(
        { dueDate: '2026-10-13' },
        { dueDate: '2026-10-13', activityId: 'act-1', hintType: 'birthday-present' },
        'act-1'
      )
    ).toBe(false);
  });

  it('takes a to-do linked to the probable activity on any day, open or done', () => {
    expect(
      flaggedBy({ dueDate: '2026-10-13' }, { activityId: 'act-1', dueDate: '2026-10-01' }, 'act-1')
    ).toBe(true);
    expect(
      flaggedBy({ dueDate: '2026-10-13' }, { activityId: 'act-1', completed: true }, 'act-1')
    ).toBe(true);
  });

  it('matches a clamped draft on its due date OR its unclamped match date', () => {
    const clamped = { dueDate: '2026-10-14', matchDate: '2026-10-12' };
    expect(flaggedBy(clamped, { dueDate: '2026-10-12' })).toBe(true);
    expect(flaggedBy(clamped, { dueDate: '2026-10-14' })).toBe(true);
    expect(flaggedBy(clamped, { dueDate: '2026-10-13' })).toBe(false);
  });
});

describe('markDuplicateDrafts', () => {
  it('flags a reworded re-read linked to the probable activity and skips it', () => {
    const existing = [
      todo({
        id: 't1',
        title: 'Pack sunscreen, a hat and a packed lunch',
        activityId: 'act-1',
        dueDate: '2026-10-13',
      }),
    ];
    const drafts = [
      draft({ id: 'd1', title: 'Pack sunscreen, hat, and packed lunch', dueDate: '2026-10-13' }),
      draft({ id: 'd2', title: 'Return the permission slip', dueDate: '2026-10-09' }),
    ];
    const out = markDuplicateDrafts(drafts, existing, { probableActivityId: 'act-1' });
    expect(out[0]).toMatchObject({ skipped: true, duplicateOf: { id: 't1', done: false } });
    expect(out[1]).toBe(drafts[1]);
    // The input is not mutated.
    expect(drafts[0]!.skipped).toBe(false);
  });

  it('reports a completed linked match as done', () => {
    const existing = [
      todo({ id: 't1', title: 'Return the permission slip', activityId: 'act-1', completed: true }),
    ];
    const [d] = markDuplicateDrafts(
      [draft({ id: 'd1', title: 'Return the permission slip', dueDate: '2026-10-09' })],
      existing,
      { probableActivityId: 'act-1' }
    );
    expect(d!.duplicateOf).toEqual({ id: 't1', done: true });
  });

  it('catches an unlinked same-day copy even with a probable activity', () => {
    const existing = [todo({ id: 't1', title: 'Pay the trip fee', dueDate: '2026-10-12' })];
    const [d] = markDuplicateDrafts(
      [draft({ id: 'd1', title: 'Pay the trip fee', dueDate: '2026-10-12' })],
      existing,
      { probableActivityId: 'act-1' }
    );
    expect(d!.duplicateOf?.id).toBe('t1');
  });

  it('never flags a hint, a to-do on another day, or a distinct to-do', () => {
    const existing = [
      todo({
        id: 'hint',
        title: 'Walk the dog',
        dueDate: '2026-09-30',
        hintType: 'birthday-present',
      }),
      todo({ id: 'other-day', title: 'Walk the dog', dueDate: '2026-10-01' }),
      todo({ id: 'distinct', title: 'Feed the cat', dueDate: '2026-09-30' }),
    ];
    const [d] = markDuplicateDrafts(
      [draft({ id: 'd1', title: 'Walk the dog', dueDate: '2026-09-30' })],
      existing
    );
    expect(d!.duplicateOf).toBeUndefined();
    expect(d!.skipped).toBe(false);
  });

  it('claims each existing to-do once, and the best pair wins', () => {
    const existing = [todo({ id: 't1', title: 'Pack sunscreen and a hat', dueDate: '2026-10-13' })];
    const out = markDuplicateDrafts(
      [
        draft({ id: 'd1', title: 'Pack sunscreen and a hat for the trip', dueDate: '2026-10-13' }),
        draft({ id: 'd2', title: 'Pack sunscreen and a hat', dueDate: '2026-10-13' }),
      ],
      existing
    );
    expect(out[0]!.duplicateOf).toBeUndefined();
    expect(out[1]!.duplicateOf?.id).toBe('t1');
  });

  it('gives each draft its own match when two existing to-dos repeat two drafts', () => {
    const existing = [
      todo({ id: 't1', title: 'Pay the trip fee', dueDate: '2026-10-12' }),
      todo({ id: 't2', title: 'Pay the trip fee online', dueDate: '2026-10-12' }),
    ];
    const out = markDuplicateDrafts(
      [
        draft({ id: 'd1', title: 'Pay the trip fee online', dueDate: '2026-10-12' }),
        draft({ id: 'd2', title: 'Pay the trip fee', dueDate: '2026-10-12' }),
      ],
      existing
    );
    expect(out.map((d) => d.duplicateOf?.id)).toEqual(['t2', 't1']);
  });
  it('does not flag a different to-do one word apart (short titles score 0.6)', () => {
    const pairs: [string, string][] = [
      ['Pay the soccer fee', 'Pay the swim fee'],
      ['Return the library book', 'Return the library card'],
    ];
    for (const [existingTitle, draftTitle] of pairs) {
      const [d] = markDuplicateDrafts(
        [draft({ id: 'd1', title: draftTitle, dueDate: '2026-10-12' })],
        [todo({ id: 't1', title: existingTitle, dueDate: '2026-10-12', activityId: 'act-1' })],
        { probableActivityId: 'act-1' }
      );
      expect(d!.duplicateOf, `${draftTitle} vs ${existingTitle}`).toBeUndefined();
    }
  });

  it('still flags a reworded re-read of the same to-do', () => {
    const pairs: [string, string][] = [
      ['Return the signed permission slip', 'Return signed permission slip'],
      ['Pay the $12 trip fee', 'Pay the trip fee'],
      ['Pack sunscreen, a hat and a packed lunch', 'Pack sunscreen, hat, and packed lunch'],
    ];
    for (const [existingTitle, draftTitle] of pairs) {
      const [d] = markDuplicateDrafts(
        [draft({ id: 'd1', title: draftTitle, dueDate: '2026-10-12' })],
        [todo({ id: 't1', title: existingTitle, dueDate: '2026-10-12' })]
      );
      expect(d!.duplicateOf?.id, `${draftTitle} vs ${existingTitle}`).toBe('t1');
    }
  });

  it('finds a copy saved on the real day when a later re-read clamps to today', () => {
    // First read saved the prep item on the day before the activity (2026-10-12). Re-read on
    // the activity day: the derived date clamps to today, but matching uses 2026-10-12.
    const [built] = buildTodoDrafts(
      { items: [item({ title: 'Pay the trip fee' })] },
      { ...ctx(), eventDate: '2026-10-13', today: '2026-10-13', nowTime: '12:00' }
    );
    expect(built).toMatchObject({ dueDate: '2026-10-13', matchDate: '2026-10-12' });
    const [d] = markDuplicateDrafts(
      [built!],
      [todo({ id: 't1', title: 'Pay the trip fee', dueDate: '2026-10-12' })]
    );
    expect(d!.duplicateOf?.id).toBe('t1');
  });

  it('finds a copy saved on the clamped date on a same-day re-read and a later re-read', () => {
    // The first read ran on the activity day (2026-10-13): its "day before" date clamped to
    // that day, and the copy was saved there, linked to the activity.
    const saved = todo({
      id: 't1',
      title: 'Pay the trip fee',
      dueDate: '2026-10-13',
      activityId: 'act-1',
    });
    const reread = (today: string) =>
      buildTodoDrafts(
        { items: [item({ title: 'Pay the trip fee' })] },
        { ...ctx(), eventDate: '2026-10-13', today, nowTime: '12:00' }
      );

    // Same day: the re-read clamps to the same date, so the day alone finds it (no link needed).
    const sameDay = reread('2026-10-13');
    expect(sameDay[0]).toMatchObject({ dueDate: '2026-10-13', matchDate: '2026-10-12' });
    expect(markDuplicateDrafts(sameDay, [saved])[0]!.duplicateOf?.id).toBe('t1');

    // A later day: the re-read clamps to 2026-10-15, and neither that nor the unclamped
    // 2026-10-12 is the saved day, so the copy is found through its activity link.
    const later = reread('2026-10-15');
    expect(later[0]).toMatchObject({ dueDate: '2026-10-15', matchDate: '2026-10-12' });
    expect(
      markDuplicateDrafts(later, [saved], { probableActivityId: 'act-1' })[0]!.duplicateOf?.id
    ).toBe('t1');
  });
});
