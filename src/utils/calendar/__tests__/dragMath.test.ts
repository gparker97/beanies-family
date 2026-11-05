import { describe, it, expect } from 'vitest';
import { repoFile } from '@/test/repoFile';
import type { FamilyActivity } from '@/types/models';
import {
  DRAG,
  dragItemKindOf,
  dropPatch,
  isDraggableActivity,
  movePatch,
  pointToMinutes,
  reassignPatch,
  resizePatch,
  snap,
  type DragSource,
  type DropTarget,
} from '@/utils/calendar/dragMath';

function makeActivity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a1',
    title: 'Piano',
    date: '2026-11-04',
    startTime: '16:00',
    endTime: '17:00',
    recurrence: 'none',
    category: 'lesson',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as FamilyActivity;
}

function source(activity: FamilyActivity, extra: Partial<DragSource> = {}): DragSource {
  const date = activity.date.slice(0, 10);
  return { activity, seriesDate: date, grabDate: date, ...extra };
}

const day = (date: string): DropTarget => ({ kind: 'day', date });
const time = (date: string, minutes: number, memberId?: string): DropTarget =>
  memberId ? { kind: 'time', date, minutes, memberId } : { kind: 'time', date, minutes };

const MEMBERS = new Set(['m1', 'm2', 'm3']);
const known = (id: string) => MEMBERS.has(id);

describe('snap / pointToMinutes', () => {
  it('snaps to the nearest 15 minutes', () => {
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
    expect(snap(52)).toBe(45);
    expect(snap(53)).toBe(60);
    expect(snap(40, 30)).toBe(30);
  });

  it('turns a column offset into snapped minutes from the first hour', () => {
    // 60 px per hour, grid starting at 07:00: 150 px = 2.5 h = 09:30.
    expect(pointToMinutes(150, 60, 7)).toBe(9 * 60 + 30);
    expect(pointToMinutes(158, 60, 7)).toBe(9 * 60 + 45); // 9:38 snaps up
  });

  it('honours a Large-reading-mode hour height', () => {
    expect(pointToMinutes(71.25 * 2, 71.25, 7)).toBe(9 * 60);
  });

  it('clamps to 00:00 .. 23:45', () => {
    expect(pointToMinutes(-500, 60, 7)).toBe(0);
    expect(pointToMinutes(100_000, 60, 7)).toBe(23 * 60 + 45);
  });

  it('falls back to the first hour for a degenerate hour height or offset', () => {
    expect(pointToMinutes(100, 0, 8)).toBe(480);
    expect(pointToMinutes(Number.NaN, 60, 8)).toBe(480);
  });
});

describe('isDraggableActivity / dragItemKindOf', () => {
  it('refuses vacation-linked and inactive records', () => {
    expect(isDraggableActivity(makeActivity())).toBe(true);
    expect(isDraggableActivity(makeActivity({ vacationId: 'v1' }))).toBe(false);
    expect(isDraggableActivity(makeActivity({ isActive: false }))).toBe(false);
  });

  it('classifies by the calendar-wide all-day rule', () => {
    expect(dragItemKindOf(makeActivity())).toBe('timed');
    expect(dragItemKindOf(makeActivity({ isAllDay: true }))).toBe('allday');
    expect(dragItemKindOf(makeActivity({ startTime: undefined, endTime: undefined }))).toBe(
      'allday'
    );
  });
});

describe('dropPatch: move', () => {
  it('is a no-op on the source position', () => {
    const a = makeActivity();
    expect(
      dropPatch(source(a, { grabMinutes: 16 * 60 }), time(a.date, 16 * 60), 'move', known)
    ).toEqual({
      kind: 'noop',
    });
    expect(dropPatch(source(a), day(a.date), 'move', known)).toEqual({ kind: 'noop' });
  });

  it('moves a one-off timed block to another day keeping its time (date only)', () => {
    const a = makeActivity();
    expect(dropPatch(source(a), day('2026-11-06'), 'move', known)).toEqual({
      kind: 'patch',
      effect: 'moved',
      patch: { date: '2026-11-06' },
    });
  });

  it('keeps the grab offset of a block grabbed half-way down', () => {
    // 16:00-17:00 grabbed at 16:30, dropped at 18:00 → starts 17:30.
    const a = makeActivity();
    const r = dropPatch(
      source(a, { grabMinutes: 16 * 60 + 30 }),
      time(a.date, 18 * 60),
      'move',
      known
    );
    expect(r).toEqual({
      kind: 'patch',
      effect: 'moved',
      patch: { startTime: '17:30', endTime: '18:30' },
    });
  });

  it('writes date only when the day changed, time only when the minutes changed', () => {
    const a = makeActivity();
    const r = dropPatch(
      source(a, { grabMinutes: 16 * 60 }),
      time('2026-11-05', 17 * 60),
      'move',
      known
    );
    expect(r).toEqual({
      kind: 'patch',
      effect: 'moved',
      patch: { date: '2026-11-05', startTime: '17:00', endTime: '18:00' },
    });
  });

  it('treats a missing grab minute as "the target is the new start"', () => {
    const a = makeActivity({ startTime: '09:10', endTime: '09:40' });
    expect(dropPatch(source(a), time(a.date, 10 * 60), 'move', known)).toMatchObject({
      patch: { startTime: '10:00', endTime: '10:30' },
    });
  });

  it('lands an off-grid start on the 15-minute grid when the time moves, keeping its duration', () => {
    // 16:10-17:10, lifted at the snapped 16:15 (pointer press or keyboard origin).
    const a = makeActivity({ startTime: '16:10', endTime: '17:10' });
    const lifted = source(a, { grabMinutes: 16 * 60 + 15 });
    // One step down: 16:25 unsnapped, lands on 16:30.
    expect(dropPatch(lifted, time(a.date, 16 * 60 + 30), 'move', known)).toEqual({
      kind: 'patch',
      effect: 'moved',
      patch: { startTime: '16:30', endTime: '17:30' },
    });
    // One step up: 15:55 unsnapped, lands on 16:00.
    expect(dropPatch(lifted, time(a.date, 16 * 60), 'move', known)).toMatchObject({
      patch: { startTime: '16:00', endTime: '17:00' },
    });
  });

  it('leaves an off-grid start alone when the minutes did not move', () => {
    const a = makeActivity({ startTime: '16:10', endTime: '17:10' });
    const lifted = source(a, { grabMinutes: 16 * 60 + 15 });
    expect(dropPatch(lifted, time(a.date, 16 * 60 + 15), 'move', known)).toEqual({ kind: 'noop' });
    // Same height, next day: the date moves, the stored 16:10 stays.
    expect(dropPatch(lifted, time('2026-11-05', 16 * 60 + 15), 'move', known)).toEqual({
      kind: 'patch',
      effect: 'moved',
      patch: { date: '2026-11-05' },
    });
  });

  it('clamps a start dragged above midnight to 00:00', () => {
    const a = makeActivity({ startTime: '01:00', endTime: '02:00' });
    // Grabbed at 01:45, dropped at 00:15 → 23:30 the previous evening without the clamp.
    const r = dropPatch(source(a, { grabMinutes: 105 }), time(a.date, 15), 'move', known);
    expect(r).toMatchObject({ patch: { startTime: '00:00', endTime: '01:00' } });
  });

  it('moves a one-off all-day item by a day', () => {
    const a = makeActivity({ isAllDay: true, startTime: undefined, endTime: undefined });
    expect(dropPatch(source(a), day('2026-11-07'), 'move', known)).toEqual({
      kind: 'patch',
      effect: 'moved',
      patch: { date: '2026-11-07' },
    });
  });

  it('keeps a multi-day one-off its length (endDate shifted with it)', () => {
    const a = makeActivity({
      isAllDay: true,
      startTime: undefined,
      endTime: undefined,
      date: '2026-11-04',
      endDate: '2026-11-06',
    });
    expect(dropPatch(source(a), day('2026-11-09'), 'move', known)).toMatchObject({
      patch: { date: '2026-11-09', endDate: '2026-11-11' },
    });
  });

  it('moves a multi-day bar grabbed on its 3rd day by the drop delta, not to the drop cell', () => {
    const a = makeActivity({
      isAllDay: true,
      startTime: undefined,
      endTime: undefined,
      date: '2026-11-04',
      endDate: '2026-11-06',
    });
    // Grabbed on the 6th (third day), dropped one cell right on the 7th.
    const r = dropPatch(source(a, { grabDate: '2026-11-06' }), day('2026-11-07'), 'move', known);
    expect(r).toMatchObject({ patch: { date: '2026-11-05', endDate: '2026-11-07' } });
  });

  it('leaves endDate out for a series (the scoped save rebases it)', () => {
    const series = makeActivity({
      isAllDay: true,
      startTime: undefined,
      endTime: undefined,
      recurrence: 'weekly',
      date: '2026-10-07',
      endDate: '2026-10-08',
    });
    // The occurrence of 4-5 Nov, grabbed on the 5th, dropped on the 6th.
    const r = dropPatch(
      { activity: series, seriesDate: '2026-11-04', grabDate: '2026-11-05' },
      day('2026-11-06'),
      'move',
      known
    );
    expect(r).toEqual({ kind: 'patch', effect: 'moved', patch: { date: '2026-11-05' } });
  });

  it('leaves endDate out for an override child (updateActivity rebases it)', () => {
    const child = makeActivity({
      parentActivityId: 'tpl',
      isAllDay: true,
      startTime: undefined,
      endTime: undefined,
      endDate: '2026-11-05',
    });
    const r = dropPatch(source(child), day('2026-11-06'), 'move', known);
    expect(r).toEqual({ kind: 'patch', effect: 'moved', patch: { date: '2026-11-06' } });
  });

  it('a series occurrence moves by the occurrence date, not the template start', () => {
    const series = makeActivity({ recurrence: 'weekly', date: '2026-09-02' });
    const r = dropPatch(
      { activity: series, seriesDate: '2026-11-04', grabDate: '2026-11-04', grabMinutes: 960 },
      time('2026-11-05', 960),
      'move',
      known
    );
    expect(r).toEqual({ kind: 'patch', effect: 'moved', patch: { date: '2026-11-05' } });
  });

  it('keeps an overnight event its shape on a time move (no 23:59 clamp)', () => {
    const a = makeActivity({ startTime: '22:00', endTime: '01:00' });
    const r = dropPatch(source(a, { grabMinutes: 22 * 60 }), time(a.date, 23 * 60), 'move', known);
    expect(r).toMatchObject({ patch: { startTime: '23:00', endTime: '02:00' } });
  });

  it('lets a late move run past midnight as an overnight event', () => {
    const a = makeActivity({ startTime: '22:00', endTime: '23:30' });
    const r = dropPatch(source(a, { grabMinutes: 22 * 60 }), time(a.date, 23 * 60), 'move', known);
    expect(r).toEqual({
      kind: 'patch',
      effect: 'moved',
      patch: { startTime: '23:00', endTime: '00:30' },
    });
  });

  it('carries an explicit next-day end back onto the start day when the end no longer wraps', () => {
    // Calendar sync's shape: 22:00 → 01:00 with an explicit next-day endDate.
    const a = makeActivity({ startTime: '22:00', endTime: '01:00', endDate: '2026-11-05' });
    const r = dropPatch(source(a, { grabMinutes: 22 * 60 }), time(a.date, 20 * 60), 'move', known);
    expect(r).toEqual({
      kind: 'patch',
      effect: 'moved',
      patch: { startTime: '20:00', endTime: '23:00', endDate: undefined },
    });
  });

  it('carries the explicit end day forward when a timed multi-day event now wraps', () => {
    // Fri 09:00 → Sun 17:00 moved to start at 23:00 keeps its 56 hours: ends Mon 07:00.
    const a = makeActivity({
      date: '2026-11-06',
      startTime: '09:00',
      endTime: '17:00',
      endDate: '2026-11-08',
    });
    const r = dropPatch(source(a, { grabMinutes: 9 * 60 }), time(a.date, 23 * 60), 'move', known);
    expect(r).toMatchObject({
      patch: { startTime: '23:00', endTime: '07:00', endDate: '2026-11-09' },
    });
  });

  it('keeps an end-less block end-less', () => {
    const a = makeActivity({ endTime: undefined });
    const r = dropPatch(source(a, { grabMinutes: 960 }), time(a.date, 18 * 60), 'move', known);
    expect(r).toEqual({ kind: 'patch', effect: 'moved', patch: { startTime: '18:00' } });
  });

  it('does day arithmetic on YMD strings across a DST change', () => {
    // US DST starts Sun 8 Mar 2026; EU DST Sun 29 Mar 2026.
    const a = makeActivity({ date: '2026-03-07' });
    expect(dropPatch(source(a), day('2026-03-09'), 'move', known)).toMatchObject({
      patch: { date: '2026-03-09' },
    });
    const b = makeActivity({ date: '2026-03-28' });
    expect(dropPatch(source(b), day('2026-03-30'), 'move', known)).toMatchObject({
      patch: { date: '2026-03-30' },
    });
  });

  it('treats an all-day source over a timeline as a day drop (never timed)', () => {
    const a = makeActivity({ isAllDay: true, startTime: undefined, endTime: undefined });
    const r = dropPatch(source(a), time('2026-11-05', 600), 'move', known);
    expect(r).toEqual({ kind: 'patch', effect: 'moved', patch: { date: '2026-11-05' } });
  });

  it('keeps the times of a timed source dropped on a day target', () => {
    const a = makeActivity({ startTime: '22:00', endTime: '01:00' });
    expect(dropPatch(source(a), day('2026-11-10'), 'move', known)).toEqual({
      kind: 'patch',
      effect: 'moved',
      patch: { date: '2026-11-10' },
    });
  });

  it('reports an unreadable stored time as invalid', () => {
    for (const bad of [makeActivity({ startTime: '4pm' }), makeActivity({ endTime: 'later' })]) {
      expect(
        dropPatch(source(bad, { grabMinutes: 960 }), time(bad.date, 1020), 'move', known)
      ).toEqual({ kind: 'invalid', reason: 'unreadable-time' });
    }
  });
});

describe('dropPatch: resize', () => {
  it('sets the end to the snapped pointer minute', () => {
    const a = makeActivity();
    expect(
      dropPatch(source(a, { grabMinutes: 17 * 60 }), time(a.date, 18 * 60), 'resize-end', known)
    ).toEqual({
      kind: 'patch',
      effect: 'resized',
      patch: { endTime: '18:00' },
    });
  });

  it('is a no-op when the handle did not move a step', () => {
    const a = makeActivity();
    expect(resizePatch(source(a, { grabMinutes: 1020 }), time(a.date, 1020))).toEqual({
      kind: 'noop',
    });
  });

  it('refuses an activity shorter than 15 minutes', () => {
    const a = makeActivity();
    expect(resizePatch(source(a, { grabMinutes: 1020 }), time(a.date, 16 * 60))).toEqual({
      kind: 'refused',
      reason: 'too-short',
    });
    expect(resizePatch(source(a, { grabMinutes: 1020 }), time(a.date, 15 * 60))).toEqual({
      kind: 'refused',
      reason: 'too-short',
    });
    expect(resizePatch(source(a, { grabMinutes: 1020 }), time(a.date, 16 * 60 + 15))).toMatchObject(
      {
        kind: 'patch',
        patch: { endTime: '16:15' },
      }
    );
  });

  it('refuses a resize dragged into the next day (past midnight)', () => {
    const a = makeActivity();
    expect(resizePatch(source(a, { grabMinutes: 1020 }), time('2026-11-05', 60))).toEqual({
      kind: 'refused',
      reason: 'crosses-midnight',
    });
  });

  it('refuses a resize dragged into the previous day as too short', () => {
    const a = makeActivity();
    expect(resizePatch(source(a, { grabMinutes: 1020 }), time('2026-11-03', 1200))).toEqual({
      kind: 'refused',
      reason: 'too-short',
    });
  });

  it('refuses the end of a timed multi-day event, which is not on this column', () => {
    const a = makeActivity({ startTime: '09:00', endTime: '17:00', endDate: '2026-11-06' });
    expect(resizePatch(source(a, { grabMinutes: 600 }), time(a.date, 720))).toEqual({
      kind: 'refused',
      reason: 'crosses-midnight',
    });
  });

  it('pulls an overnight end back onto the start day (clears an explicit next-day end)', () => {
    const implicit = makeActivity({ startTime: '22:00', endTime: '01:00' });
    expect(resizePatch(source(implicit, { grabMinutes: 1425 }), time(implicit.date, 1410))).toEqual(
      {
        kind: 'patch',
        effect: 'resized',
        patch: { endTime: '23:30' },
      }
    );
    const explicit = makeActivity({ startTime: '22:00', endTime: '01:00', endDate: '2026-11-05' });
    expect(resizePatch(source(explicit, { grabMinutes: 1425 }), time(explicit.date, 1410))).toEqual(
      {
        kind: 'patch',
        effect: 'resized',
        patch: { endTime: '23:30', endDate: undefined },
      }
    );
  });

  it('gives an end-less block an end', () => {
    const a = makeActivity({ endTime: undefined });
    expect(resizePatch(source(a, { grabMinutes: 1020 }), time(a.date, 1050))).toMatchObject({
      patch: { endTime: '17:30' },
    });
  });

  it('is a no-op for an all-day item or a day target', () => {
    const allDay = makeActivity({ isAllDay: true });
    expect(resizePatch(source(allDay), time(allDay.date, 600))).toEqual({ kind: 'noop' });
    expect(resizePatch(source(makeActivity()), day('2026-11-04'))).toEqual({ kind: 'noop' });
  });

  it('reports an unreadable stored time as invalid', () => {
    const a = makeActivity({ startTime: 'noon' });
    expect(resizePatch(source(a, { grabMinutes: 1020 }), time(a.date, 1080))).toEqual({
      kind: 'invalid',
      reason: 'unreadable-time',
    });
  });

  it('uses the minimum duration constant', () => {
    expect(DRAG.minDurationMinutes).toBe(15);
  });
});

describe('dropPatch: day-view reassignment', () => {
  const owned = (ids: Partial<FamilyActivity>) => makeActivity(ids);

  it('reassigns a single-owner block dropped in another member column (and moves its time)', () => {
    const a = owned({ assigneeIds: ['m1'], assigneeId: 'm1' });
    const r = dropPatch(
      source(a, { grabMinutes: 960, columnMemberId: 'm1' }),
      time(a.date, 1020, 'm2'),
      'move',
      known
    );
    expect(r).toEqual({
      kind: 'patch',
      effect: 'reassigned',
      patch: { startTime: '17:00', endTime: '18:00', assigneeIds: ['m2'], assigneeId: 'm2' },
    });
  });

  it('reassigns with no time change too', () => {
    const a = owned({ assigneeIds: ['m1'] });
    const r = dropPatch(
      source(a, { grabMinutes: 960, columnMemberId: 'm1' }),
      time(a.date, 960, 'm2'),
      'move',
      known
    );
    expect(r).toEqual({
      kind: 'patch',
      effect: 'reassigned',
      patch: { assigneeIds: ['m2'], assigneeId: 'm2' },
    });
  });

  it('reads a legacy single assigneeId as the owner', () => {
    const a = owned({ assigneeId: 'm1', assigneeIds: undefined });
    expect(
      reassignPatch(source(a, { columnMemberId: 'm1' }), time(a.date, 960, 'm3'), known)
    ).toEqual({
      assigneeIds: ['m3'],
      assigneeId: 'm3',
    });
  });

  it('counts only real members: a stale id beside one owner is still single-owner', () => {
    const a = owned({ assigneeIds: ['m1', 'gone'] });
    expect(
      reassignPatch(source(a, { columnMemberId: 'm1' }), time(a.date, 960, 'm2'), known)
    ).toEqual({
      assigneeIds: ['m2'],
      assigneeId: 'm2',
    });
  });

  it('moves a shared block in time only, whatever column it lands in', () => {
    const a = owned({ assigneeIds: ['m1', 'm2'] });
    const r = dropPatch(
      source(a, { grabMinutes: 960, columnMemberId: 'm1' }),
      time(a.date, 1020, 'm3'),
      'move',
      known
    );
    expect(r).toEqual({
      kind: 'patch',
      effect: 'moved',
      patch: { startTime: '17:00', endTime: '18:00' },
    });
  });

  it('moves a family-wide (unassigned) block in time only', () => {
    const a = owned({ assigneeIds: [] });
    expect(
      reassignPatch(source(a, { columnMemberId: 'm1' }), time(a.date, 960, 'm2'), known)
    ).toBeNull();
  });

  it('does not reassign within the same column, without a target member, or to a stranger', () => {
    const a = owned({ assigneeIds: ['m1'] });
    const src = source(a, { grabMinutes: 960, columnMemberId: 'm1' });
    expect(reassignPatch(src, time(a.date, 960, 'm1'), known)).toBeNull();
    expect(reassignPatch(src, time(a.date, 960), known)).toBeNull();
    expect(reassignPatch(src, time(a.date, 960, 'stranger'), known)).toBeNull();
    expect(dropPatch(src, time(a.date, 960, 'm1'), 'move', known)).toEqual({ kind: 'noop' });
  });

  it('does not reassign when the block was grabbed outside its owner column', () => {
    const a = owned({ assigneeIds: ['m1'] });
    expect(
      reassignPatch(source(a, { columnMemberId: 'm2' }), time(a.date, 960, 'm3'), known)
    ).toBeNull();
  });

  it('never reassigns on a resize', () => {
    const a = owned({ assigneeIds: ['m1'] });
    const r = dropPatch(
      source(a, { grabMinutes: 1020, columnMemberId: 'm1' }),
      time(a.date, 1080, 'm2'),
      'resize-end',
      known
    );
    expect(r).toEqual({ kind: 'patch', effect: 'resized', patch: { endTime: '18:00' } });
  });

  it('a refused or invalid move is never turned into a reassignment', () => {
    const bad = owned({ assigneeIds: ['m1'], startTime: 'x' });
    expect(
      dropPatch(source(bad, { columnMemberId: 'm1' }), time(bad.date, 960, 'm2'), 'move', known)
    ).toEqual({ kind: 'invalid', reason: 'unreadable-time' });
  });
});

describe('movePatch (direct)', () => {
  it('is exported for tests and agrees with dropPatch on a plain move', () => {
    const a = makeActivity();
    expect(movePatch(source(a), day('2026-11-05'))).toEqual(
      dropPatch(source(a), day('2026-11-05'), 'move', known)
    );
  });
});

describe('purity', () => {
  it('dragMath imports nothing from vue or the DOM', () => {
    const src = repoFile('src/utils/calendar/dragMath.ts');
    const imports = [...src.matchAll(/^import[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec).not.toMatch(/^(vue|@vue\/|pinia)/);
      expect(spec).not.toMatch(/^@\/(composables|components|stores|pages)\//);
    }
    expect(src).not.toMatch(/\b(document|window|navigator)\./);
    expect(src).not.toMatch(/\bHTMLElement\b/);
  });
});
