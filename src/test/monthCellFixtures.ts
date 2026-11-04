// Shared builders for month-cell-shaped data (#141). Pure data, no Vue or stores,
// so the pure-module tests (`monthDayItems`, `monthGridLayout`, `monthCells`) and
// the component tests build days the same way.

import type { FamilyActivity, FamilyMember, HolidayOccurrence } from '@/types/models';
import type { DayExtra } from '@/utils/calendarDay';
import type {
  CellAllDayItem,
  CellTimedOccurrence,
  CellVacation,
  MonthDayCellData,
} from '@/utils/monthCells';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import type { DayItem } from '@/utils/monthDayItems';

export const FIXTURE_DATE = '2026-05-19';

export function makeActivity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a-1',
    title: 'Soccer',
    date: FIXTURE_DATE,
    startTime: '16:00',
    category: 'soccer',
    isAllDay: false,
    recurrence: { type: 'none' },
    feeSchedule: 'none',
    reminderMinutes: { default: 15 },
    isActive: true,
    createdBy: 'm-aria',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    assigneeIds: ['m-aria'],
    ...overrides,
  } as FamilyActivity;
}

/** A cell with sensible defaults (an empty current-month day in week row 0). */
export function cell(overrides: Partial<MonthDayCellData> = {}): MonthDayCellData {
  const date = overrides.date ?? FIXTURE_DATE;
  return {
    date,
    day: Number(date.slice(8)),
    isCurrentMonth: true,
    isToday: false,
    weekRow: 0,
    timedOccurrences: [],
    vacations: [],
    segments: [],
    allDayItems: [],
    extras: [],
    ...overrides,
  };
}

/** A timed occurrence; `startTime` defaults to 16:00, pass `null` for an untimed one. */
export function timed(
  id: string,
  startTime: string | null = '16:00',
  date = FIXTURE_DATE
): CellTimedOccurrence {
  return {
    activity: makeActivity({ id, title: id, date, startTime: startTime ?? undefined }),
    date,
  };
}

/** An all-day item; by default a single day (first and last). */
export function allDay(
  id: string,
  over: Partial<Pick<CellAllDayItem, 'spanKey' | 'isFirstDay' | 'isLastDay'>> & {
    date?: string;
  } = {}
): CellAllDayItem {
  const date = over.date ?? FIXTURE_DATE;
  return {
    activity: makeActivity({ id, title: id, date, isAllDay: true, startTime: undefined }),
    spanKey: over.spanKey ?? `${id}:${date}`,
    isFirstDay: over.isFirstDay ?? true,
    isLastDay: over.isLastDay ?? true,
  };
}

/** One day's slice of a trip. */
export function trip(id: string, over: Partial<CellVacation> = {}): CellVacation {
  return {
    id,
    name: id,
    emoji: '✈️',
    isStart: true,
    isEnd: true,
    travellerIds: [],
    ...over,
  };
}

/** A travel-segment occurrence (departure by default). */
export function segment(
  segmentId: string,
  over: Partial<TravelSegmentOccurrence> = {}
): TravelSegmentOccurrence {
  return {
    vacationId: 'v1',
    segmentIndex: 0,
    segmentId,
    transportType: 'flight_outbound',
    kind: 'departure',
    status: 'booked',
    date: FIXTURE_DATE,
    time: '09:00',
    title: `Flight ${segmentId}`,
    tripAssigneeIds: [],
    ...over,
  } as TravelSegmentOccurrence;
}

export function holiday(name = 'Vesak Day', ymd = FIXTURE_DATE): DayExtra {
  const h: HolidayOccurrence = { name, date: ymd, countryCode: 'SG' };
  return { kind: 'holiday', id: `h:${name}`, ymd, label: `${name} (SG)`, holiday: h };
}

export function birthday(memberId = 'm1', name = 'Joey', age = 7, ymd = FIXTURE_DATE): DayExtra {
  return {
    kind: 'birthday',
    id: `b:${memberId}`,
    ymd,
    label: `${name}'s birthday`,
    emoji: '🎂',
    birthday: { date: ymd, memberId, name, age, isPet: false },
  };
}

export function member(id: string, name = id): FamilyMember {
  return { id, name, color: '#6AA84F', isPet: false } as unknown as FamilyMember;
}

/** The kind/id pairs of a day-item list, for compact order assertions. */
export function itemIds(items: readonly DayItem[]): string[] {
  return items.map((i) => {
    switch (i.kind) {
      case 'trip':
        return `trip:${i.vacation.id}`;
      case 'allday':
        return `allday:${i.item.activity.id}`;
      case 'timed':
        return `timed:${i.occurrence.activity.id}`;
      case 'segment':
        return `segment:${i.segment.segmentId}-${i.segment.kind}`;
    }
  });
}
