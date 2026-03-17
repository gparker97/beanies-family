import { computed, type Ref } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { addDays, toDateInputValue, formatTime12 } from '@/utils/date';

// ── Week Navigation ────────────────────────────────────────────────────────

export interface WeekDay {
  date: Date;
  dateStr: string;
  isToday: boolean;
}

export function useWeekNavigation(referenceDate: Ref<Date>) {
  const settingsStore = useSettingsStore();

  function getWeekStart(date: Date): Date {
    const dayOfWeek = date.getDay();
    const offset = (dayOfWeek - settingsStore.weekStartDay + 7) % 7;
    return addDays(date, -offset);
  }

  const weekDays = computed<WeekDay[]>(() => {
    const start = getWeekStart(referenceDate.value);
    const todayStr = toDateInputValue(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      const dateStr = toDateInputValue(d);
      return { date: d, dateStr, isToday: dateStr === todayStr };
    });
  });

  const weekLabel = computed(() => {
    const days = weekDays.value;
    const first = days[0]!.date;
    const last = days[6]!.date;
    const sameMonth = first.getMonth() === last.getMonth();
    const sameYear = first.getFullYear() === last.getFullYear();

    const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    if (sameMonth) {
      return `${first.toLocaleDateString('en-US', { month: 'short' })} ${first.getDate()} – ${last.getDate()}, ${first.getFullYear()}`;
    }
    if (sameYear) {
      return `${fmtDay(first)} – ${fmtDay(last)}, ${first.getFullYear()}`;
    }
    return `${fmtDay(first)}, ${first.getFullYear()} – ${fmtDay(last)}, ${last.getFullYear()}`;
  });

  function prevWeek() {
    referenceDate.value = addDays(referenceDate.value, -7);
  }
  function nextWeek() {
    referenceDate.value = addDays(referenceDate.value, 7);
  }
  function goToToday() {
    referenceDate.value = new Date();
  }

  return { weekDays, weekLabel, prevWeek, nextWeek, goToToday, getWeekStart };
}

// ── Time Grid Utilities ────────────────────────────────────────────────────

const ROW_HEIGHT = 60; // px per hour
const MIN_CARD_HEIGHT = 24; // px minimum for short activities

export interface TimeGridConfig {
  timeRange: { start: number; end: number };
  hours: number[];
  totalHeight: number;
}

export function useTimeGrid(timedItems: Ref<Array<{ startTime?: string; endTime?: string }>>) {
  const timeRange = computed(() => {
    const allHours: number[] = [];
    for (const item of timedItems.value) {
      if (item.startTime) allHours.push(parseInt(item.startTime.split(':')[0]!));
      if (item.endTime) allHours.push(parseInt(item.endTime.split(':')[0]!));
    }
    const min = allHours.length ? Math.max(0, Math.min(7, ...allHours) - 1) : 7;
    const max = allHours.length ? Math.min(23, Math.max(19, ...allHours) + 1) : 19;
    return { start: min, end: max };
  });

  const hours = computed(() => {
    const arr: number[] = [];
    for (let h = timeRange.value.start; h <= timeRange.value.end; h++) arr.push(h);
    return arr;
  });

  const totalHeight = computed(() => hours.value.length * ROW_HEIGHT);

  function getPosition(startTime: string, endTime?: string) {
    const startMinutes = parseMinutes(startTime) - timeRange.value.start * 60;
    const endMinutes = endTime
      ? parseMinutes(endTime) - timeRange.value.start * 60
      : startMinutes + 60;
    const top = (startMinutes / 60) * ROW_HEIGHT;
    const height = Math.max(((endMinutes - startMinutes) / 60) * ROW_HEIGHT, MIN_CARD_HEIGHT);
    return { top: `${top}px`, height: `${height}px` };
  }

  function formatHourLabel(hour: number): string {
    return formatTime12(`${String(hour).padStart(2, '0')}:00`);
  }

  return { timeRange, hours, totalHeight, getPosition, formatHourLabel, ROW_HEIGHT };
}

/** Group items by overlapping time ranges. Returns array of groups. */
export function groupOverlapping<T extends { startTime?: string; endTime?: string }>(
  items: T[]
): T[][] {
  if (items.length === 0) return [];
  const sorted = [...items]
    .filter((i) => i.startTime)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  const groups: T[][] = [];
  let currentGroup: T[] = [sorted[0]!];
  let groupEnd =
    parseMinutes(sorted[0]!.endTime ?? sorted[0]!.startTime!) + (sorted[0]!.endTime ? 0 : 60);

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]!;
    const itemStart = parseMinutes(item.startTime!);
    if (itemStart < groupEnd) {
      // Overlaps with current group
      currentGroup.push(item);
      const itemEnd = parseMinutes(item.endTime ?? item.startTime!) + (item.endTime ? 0 : 60);
      groupEnd = Math.max(groupEnd, itemEnd);
    } else {
      groups.push(currentGroup);
      currentGroup = [item];
      groupEnd = parseMinutes(item.endTime ?? item.startTime!) + (item.endTime ? 0 : 60);
    }
  }
  groups.push(currentGroup);
  return groups;
}

function parseMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
