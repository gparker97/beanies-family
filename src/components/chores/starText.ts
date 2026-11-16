/**
 * Stars and rewards (#148): the two small wordings several star surfaces share, so the strip,
 * the banner and the wall lane say them the same way. Pure: `t` is passed in.
 */
import { CHORE_DAY_LABEL_KEYS } from '@/constants/choreBlocks';
import type { ActiveRewardBanner } from '@/composables/useCelebration';
import { fillTemplate } from '@/utils/fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { choreDayOfWeek } from '@/utils/chores';

/** The star glyph's path (a 24 x 24 box), shared by `StarCount` and the Rewards button. */
export const STAR_GLYPH_PATH =
  'M12 2.8l2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 16.83l-5.5 2.89 1.05-6.12L3.1 9.27l6.15-.9L12 2.8z';

/** The weekly reward as a phrase: the family's name for it, or "the weekly reward". */
export function rewardName(title: string | undefined, t: (key: UIStringKey) => string): string {
  const name = title?.trim();
  return name || t('choreStars.weekly.fallbackName');
}

/** A chore day's short weekday name ("Sat"), or '' for a day that does not parse. */
export function choreDayShort(ymd: string | undefined, t: (key: UIStringKey) => string): string {
  if (!ymd) return '';
  const key = CHORE_DAY_LABEL_KEYS[choreDayOfWeek(ymd)];
  return key ? t(key) : '';
}

/**
 * The achieved moment's words on the existing celebration banner (the wall lane and the child's
 * day): "Max earned Ice Cream this week" and "33 stars. Nice work, Max."
 */
export function rewardBannerText(
  banner: Pick<ActiveRewardBanner, 'beanName' | 'title'>,
  count: number,
  t: (key: UIStringKey) => string
): { title: string; body: string } {
  const name = banner.beanName;
  return {
    title: fillTemplate(t('choreStars.banner.title'), {
      name,
      reward: rewardName(banner.title, t),
    }),
    body: fillTemplate(
      t(count === 1 ? 'choreStars.banner.body.one' : 'choreStars.banner.body.other'),
      { count, name }
    ),
  };
}
