/**
 * `timelineSlot` (#142): the window a timed block would fill if dropped now, read from the
 * same `dropPatch` the drop runs, so the preview cannot disagree with the write.
 */
import { describe, expect, it } from 'vitest';
import { timelineSlot } from '@/composables/drag/timelineSlot';
import type { DragSource, DropTarget } from '@/utils/calendar/dragMath';
import type { FamilyActivity } from '@/types/models';

const WED = '2026-11-11';

function source(over: Partial<FamilyActivity> = {}, grabMinutes?: number): DragSource {
  const activity = {
    id: 'piano',
    title: 'Piano',
    date: WED,
    startTime: '16:00',
    endTime: '17:00',
    recurrence: 'none',
    isActive: true,
    ...over,
  } as FamilyActivity;
  return { activity, seriesDate: WED, grabDate: WED, grabMinutes };
}

const at = (minutes: number, date = WED, memberId?: string): DropTarget =>
  memberId ? { kind: 'time', date, minutes, memberId } : { kind: 'time', date, minutes };

describe('timelineSlot', () => {
  it('a move keeps the grab offset and the length, and reads out the new window', () => {
    // Grabbed at 16:30 (half-way down), dropped at 18:00: the block now starts at 17:30.
    expect(
      timelineSlot(at(18 * 60, '2026-11-12', 'mia'), source({}, 16 * 60 + 30), 'move')
    ).toEqual({
      date: '2026-11-12',
      memberId: 'mia',
      startTime: '17:30',
      endTime: '18:30',
      readout: '5:30pm – 6:30pm',
    });
  });

  it('a day-only move (same minute) keeps the stored window', () => {
    expect(timelineSlot(at(16 * 60, '2026-11-12'), source({}, 16 * 60), 'move')).toMatchObject({
      date: '2026-11-12',
      startTime: '16:00',
      endTime: '17:00',
    });
  });

  it('an end-less record stays end-less and reads out its start only', () => {
    const slot = timelineSlot(at(9 * 60), source({ endTime: undefined }, 16 * 60), 'move');
    expect(slot).toEqual({ date: WED, startTime: '09:00', readout: '9am' });
  });

  it('a resize reads out the end it points at, drawn at least the minimum length', () => {
    expect(timelineSlot(at(17 * 60 + 45), source({}, 17 * 60), 'resize-end')).toMatchObject({
      startTime: '16:00',
      endTime: '17:45',
      readout: '5:45pm',
    });
    // Too short is refused on drop with its own toast; the slot still shows where it points.
    expect(timelineSlot(at(16 * 60), source({}, 17 * 60), 'resize-end')).toMatchObject({
      endTime: '16:15',
      readout: '4pm',
    });
  });

  it('a resize near midnight never draws past the last slot (no 24:00 end)', () => {
    // 23:45 start: the minimum length would end at 1440, drawn as '24:00'.
    const late = source({ startTime: '23:45', endTime: '23:59' }, 23 * 60 + 59);
    expect(timelineSlot(at(23 * 60 + 45), late, 'resize-end')).toMatchObject({
      startTime: '23:45',
      endTime: '23:45',
      readout: '11:45pm',
    });
    // An off-grid start past the last slot: the end is not drawn before the start.
    const later = source({ startTime: '23:50', endTime: '23:59' }, 23 * 60 + 59);
    expect(timelineSlot(at(23 * 60 + 45), later, 'resize-end')).toMatchObject({
      startTime: '23:50',
      endTime: '23:50',
    });
  });

  it('no slot for a resize into another day, an all-day item, a day target or an unreadable time', () => {
    expect(timelineSlot(at(600, '2026-11-12'), source({}, 1020), 'resize-end')).toBeNull();
    expect(
      timelineSlot(at(600), source({ startTime: undefined, endTime: undefined }), 'move')
    ).toBeNull();
    expect(timelineSlot({ kind: 'day', date: WED }, source(), 'move')).toBeNull();
    expect(timelineSlot(at(600), source({ startTime: 'junk' }), 'move')).toBeNull();
  });
});
