/**
 * Stars and rewards (#148): the small wordings several star surfaces share, so the strip, the
 * banner, the wall lane, the Star Report and the Rewards view say them the same way. Pure: `t`
 * is passed in.
 */
import { CHORE_DAY_LABEL_KEYS } from '@/constants/choreBlocks';
import { REWARD_EMOJI_OPTIONS } from '@/constants/choreStars';
import type { ActiveRewardBanner } from '@/composables/useCelebration';
import { firstName, formatNameList } from '@/utils/assignees';
import { awardKids } from '@/utils/choreStars';
import { fillTemplate } from '@/utils/fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { choreDayOfWeek } from '@/utils/chores';
import type { ChoreAward, ChoreStarGift, FamilyMember } from '@/types/models';

/**
 * One bonus or take-away as every list of them words it (the Star Report's two summaries and the
 * wall's stars sheet): built by `bonusLine`, drawn by `StarGiftRow`.
 */
export interface BonusEntryLine {
  gift: ChoreStarGift;
  /** A take-away (the gift's stars are below zero). */
  take: boolean;
  /** "Mom gave 2 bonus stars", "Dad took away 1 star". */
  title: string;
  /** "+2", "-1". */
  amount: string;
  /** The day and the note: `Tue. "Helped with the dishes"`. */
  sub: string;
}

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

/** A signed star count: "+2", "-1", or a plain "0". */
export function signedStars(n: number, t: (key: UIStringKey) => string): string {
  const count = Math.abs(Math.round(n));
  if (count === 0) return t('choreStars.report.bonusNone');
  return fillTemplate(t(n > 0 ? 'choreStars.report.bonusPlus' : 'choreStars.report.bonusMinus'), {
    count,
  });
}

/**
 * One bonus or take-away as its line: who gave or took away and how many, the signed amount, and
 * the day with the note. `nameOf` is the giver's first name ('' when unknown: "A grown-up").
 */
export function bonusLine(
  gift: ChoreStarGift,
  nameOf: (memberId: string) => string,
  t: (key: UIStringKey) => string
): BonusEntryLine {
  const count = Math.abs(Math.round(gift.stars));
  const take = gift.stars < 0;
  const vars = { count, by: nameOf(gift.by) || t('choreStars.note.someone') };
  const key: UIStringKey = take
    ? count === 1
      ? 'choreStars.takeBack.entry.one'
      : 'choreStars.takeBack.entry.other'
    : count === 1
      ? 'choreStars.report.bonusEntry.one'
      : 'choreStars.report.bonusEntry.other';
  const day = choreDayShort(gift.date, t);
  return {
    gift,
    take,
    title: fillTemplate(t(key), vars),
    amount: signedStars(gift.stars, t),
    // The day and the note in one template, so each language punctuates it its own way.
    sub: gift.note
      ? fillTemplate(t('choreStars.report.bonusEntry.sub'), {
          day,
          note: fillTemplate(t('choreStars.bonus.note.quote'), { note: gift.note }),
        })
      : day,
  };
}

/** The earned banner's title: "Ice Cream earned!", or "Weekly reward earned!" when the reward is unnamed. */
export function rewardEarnedTitle(
  banner: Pick<ActiveRewardBanner, 'beanName' | 'title'>,
  t: (key: UIStringKey) => string
): string {
  if (!banner.title?.trim()) return t('choreStars.banner.titleFallback');
  return fillTemplate(t('choreStars.banner.title'), {
    name: banner.beanName,
    reward: rewardName(banner.title, t),
  });
}

/**
 * The achieved moment's words on the existing celebration banner (the wall lane and the child's
 * day): "Ice Cream earned!" and "33 stars. Nice work, Max."
 */
export function rewardBannerText(
  banner: Pick<ActiveRewardBanner, 'beanName' | 'title'>,
  count: number,
  t: (key: UIStringKey) => string
): { title: string; body: string } {
  const name = banner.beanName;
  return {
    title: rewardEarnedTitle(banner, t),
    body: fillTemplate(
      t(count === 1 ? 'choreStars.banner.body.one' : 'choreStars.banner.body.other'),
      { count, name }
    ),
  };
}

/**
 * Who a special reward is for, when that is not every kid: its kids who earn stars now (in
 * family order) and the line naming them ("For Max & Pip"), or "Not for any child now" when
 * none of them does. `null` when it is for every kid. `kids` are the earners
 * (`starStore.earnerMembers`).
 */
export function awardForKids(
  award: Pick<ChoreAward, 'memberIds'>,
  kids: readonly FamilyMember[],
  t: (key: UIStringKey) => string
): { members: FamilyMember[]; label: string } | null {
  const ids = awardKids(
    award,
    kids.map((k) => k.id)
  );
  if (ids === null) return null;
  const members = ids
    .map((id) => kids.find((k) => k.id === id))
    .filter((m): m is FamilyMember => !!m);
  return {
    members,
    label: members.length
      ? fillTemplate(t('choreStars.awards.forKids'), {
          names: formatNameList(members.map((m) => firstName(m.name))),
        })
      : t('choreStars.awards.forNobody'),
  };
}

/** The reward icon choices as `EmojiPicker` takes them, labels translated. */
export function rewardEmojiOptions(
  t: (key: UIStringKey) => string
): { emoji: string; label: string }[] {
  return REWARD_EMOJI_OPTIONS.map((o) => ({ emoji: o.emoji, label: t(o.labelKey) }));
}
