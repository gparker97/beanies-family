/**
 * The wall's chores summary line (#146), shared by the chores card and the chores view's
 * header so the two can never word the same count differently: "7 of 12 morning chores done",
 * or "3 of 9 chores done today" when nobody has a chore in the block happening now. Each
 * phrase is its own `.one` / `.other` key, chosen by the total, so no translated block name is
 * ever lowercased into a sentence.
 */
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ChoreBlock } from '@/types/models';
import type { WallChoreProgress } from '@/utils/wallJobs';
import { fillTemplate } from '@/utils/fillTemplate';

const PROGRESS_KEYS: Record<ChoreBlock | 'today', { one: UIStringKey; other: UIStringKey }> = {
  morning: {
    one: 'wall.chores.progress.morning.one',
    other: 'wall.chores.progress.morning.other',
  },
  afternoon: {
    one: 'wall.chores.progress.afternoon.one',
    other: 'wall.chores.progress.afternoon.other',
  },
  evening: {
    one: 'wall.chores.progress.evening.one',
    other: 'wall.chores.progress.evening.other',
  },
  // `choreProgress` never reports Anytime as the block (it is never "now"); the day's line
  // stands in, so the map stays total over `ChoreBlock`.
  anytime: { one: 'wall.chores.progress.today.one', other: 'wall.chores.progress.today.other' },
  today: { one: 'wall.chores.progress.today.one', other: 'wall.chores.progress.today.other' },
};

export function wallChoreProgressText(
  progress: WallChoreProgress,
  t: (key: UIStringKey) => string
): string {
  const keys = PROGRESS_KEYS[progress.block ?? 'today'];
  return fillTemplate(t(progress.total === 1 ? keys.one : keys.other), {
    done: progress.done,
    total: progress.total,
  });
}
