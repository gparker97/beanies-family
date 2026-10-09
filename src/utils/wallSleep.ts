/**
 * When the beanie wall puts itself to sleep: pure rules, so the timer in
 * `useWallAutoSleep` and the Settings card read one definition.
 *
 * Per device (`GlobalSettings.wall.sleep`), on by default: a wall left on overnight
 * should dim itself without anyone finding a setting first.
 */
import type { WallSleepSettings } from '@/types/models';

export const DEFAULT_WALL_SLEEP: Readonly<WallSleepSettings> = {
  enabled: true,
  screen: 'night',
  startTime: '21:00',
  endTime: '07:00',
  idleMinutes: 10,
};

/** The choices the Settings card offers for "after nobody touches it for". */
export const WALL_SLEEP_IDLE_OPTIONS = [5, 10, 15, 30, 60] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The stored settings with every field checked, falling back field by field to the
 * defaults. A corrupt or partial record (an older build, a hand-edited export) degrades
 * to sensible behaviour rather than a wall that never sleeps or sleeps at noon.
 */
export function resolveWallSleep(raw: Partial<WallSleepSettings> | undefined): WallSleepSettings {
  const d = DEFAULT_WALL_SLEEP;
  const idle = Number(raw?.idleMinutes);
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : d.enabled,
    screen: raw?.screen === 'night' ? raw.screen : d.screen,
    startTime: raw?.startTime && HHMM.test(raw.startTime) ? raw.startTime : d.startTime,
    endTime: raw?.endTime && HHMM.test(raw.endTime) ? raw.endTime : d.endTime,
    idleMinutes:
      Number.isFinite(idle) && idle >= 1 && idle <= 240 ? Math.round(idle) : d.idleMinutes,
  };
}

/** "HH:mm" of a Date, in local time. */
export function localHHmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Is `now` inside the night window? The window includes its start and excludes its end,
 * and wraps past midnight when it starts later than it ends (21:00 to 07:00). Equal start
 * and end means all day.
 */
export function isWithinNightHours(now: string, startTime: string, endTime: string): boolean {
  if (startTime === endTime) return true;
  if (startTime < endTime) return now >= startTime && now < endTime;
  return now >= startTime || now < endTime;
}
