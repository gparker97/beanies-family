import type { UIStringKey } from '@/services/translation/uiStrings';
import { emojiSuggester, pictureAfterRename, type EmojiKeywordEntry } from '@/utils/emojiSuggest';

/**
 * Stars and rewards for chores (#148): the bounds and options every star surface and rule reads.
 * The rules themselves live in `src/utils/choreStars.ts`; this file holds values only. Award
 * titles share the chore title bound (`CHORE_TITLE_MAX` in `constants/choreBlocks.ts`).
 */

/** What one tick of a chore can be worth: a whole number of stars. Absent on a chore = 1. */
export const CHORE_STARS_MIN = 1;
export const CHORE_STARS_MAX = 5;

/** The weekly reward's bar: a share of a full week's stars, in percent, in steps. */
export const STAR_BAR_MIN = 50;
export const STAR_BAR_MAX = 100;
export const STAR_BAR_STEP = 5;

/** A bonus or take-back note, and how many stars one gift can move. */
export const STAR_NOTE_MAX = 80;
export const STAR_GIFT_MAX = 20;

/** An award's price: full weeks (one decimal) or stars (a whole number), above 0. */
export const AWARD_PRICE_MAX_WEEKS = 52;
export const AWARD_PRICE_MAX_STARS = 999;

/**
 * The emoji a grown-up can pick for the weekly reward or a special reward, each with its spoken
 * name (`EmojiPicker` takes `{ emoji, label }`; the page resolves `labelKey` through `t()`).
 * Most likely first: money (an allowance is the most common weekly reward), then screens and
 * treats, then things to do and places to go, then a general "well done".
 */
export const REWARD_EMOJI_OPTIONS: readonly { emoji: string; labelKey: UIStringKey }[] = [
  { emoji: '💵', labelKey: 'choreStars.emoji.money' },
  { emoji: '🪙', labelKey: 'choreStars.emoji.coins' },
  { emoji: '🐷', labelKey: 'choreStars.emoji.piggyBank' },
  { emoji: '🍦', labelKey: 'choreStars.emoji.iceCream' },
  { emoji: '🎮', labelKey: 'choreStars.emoji.game' },
  { emoji: '📱', labelKey: 'choreStars.emoji.screenTime' },
  { emoji: '🎬', labelKey: 'choreStars.emoji.movie' },
  { emoji: '🍕', labelKey: 'choreStars.emoji.pizza' },
  { emoji: '🍪', labelKey: 'choreStars.emoji.treat' },
  { emoji: '🍬', labelKey: 'choreStars.emoji.candy' },
  { emoji: '🧁', labelKey: 'choreStars.emoji.cake' },
  { emoji: '🍩', labelKey: 'choreStars.emoji.donut' },
  { emoji: '🍿', labelKey: 'choreStars.emoji.popcorn' },
  { emoji: '🍔', labelKey: 'choreStars.emoji.eatingOut' },
  { emoji: '🧸', labelKey: 'choreStars.emoji.toy' },
  { emoji: '🎁', labelKey: 'choreStars.emoji.surprise' },
  { emoji: '📚', labelKey: 'choreStars.emoji.books' },
  { emoji: '🎨', labelKey: 'choreStars.emoji.art' },
  { emoji: '⚽', labelKey: 'choreStars.emoji.sports' },
  { emoji: '🚲', labelKey: 'choreStars.emoji.bike' },
  { emoji: '🛝', labelKey: 'choreStars.emoji.playground' },
  { emoji: '🏊', labelKey: 'choreStars.emoji.swimming' },
  { emoji: '🏖️', labelKey: 'choreStars.emoji.beach' },
  { emoji: '🏕️', labelKey: 'choreStars.emoji.camping' },
  { emoji: '🦁', labelKey: 'choreStars.emoji.zoo' },
  { emoji: '🎳', labelKey: 'choreStars.emoji.bowling' },
  { emoji: '🎟️', labelKey: 'choreStars.emoji.outing' },
  { emoji: '🏰', labelKey: 'choreStars.emoji.trip' },
  { emoji: '🛌', labelKey: 'choreStars.emoji.sleepover' },
  { emoji: '🌙', labelKey: 'choreStars.emoji.lateNight' },
  { emoji: '🏆', labelKey: 'choreStars.emoji.trophy' },
  { emoji: '⭐', labelKey: 'choreStars.emoji.wellDone' },
];

/** The weekly reward's emoji before a grown-up picks one (or its name suggests one). */
export const DEFAULT_REWARD_EMOJI = '🍦';

/** A new special reward's emoji before one is picked (or its name suggests one). */
export const DEFAULT_SPECIAL_REWARD_EMOJI = '🎁';

/**
 * Keyword data for `suggestRewardEmoji`: never shown, only matched against a reward's name by
 * the shared matcher (`emojiSuggester`, `utils/emojiSuggest.ts`, which holds the matching
 * rules). Every option above has an entry and every entry is an option (pinned by
 * `choreStarsConstants.test.ts`). `weak` marks a generic word ("treat", "trip", "save"): any
 * other word beats it, so "a trip to the zoo" is the zoo and "save for a bike" is the bike.
 */
const REWARD_EMOJI_KEYWORDS: readonly EmojiKeywordEntry[] = [
  {
    emoji: '💵',
    words: [
      'allowance',
      'pocket money',
      'money',
      'cash',
      'dollar',
      'pay',
      'payday',
      'buck',
      '零花钱',
      '零用钱',
      '钱',
      '现金',
    ],
  },
  { emoji: '🪙', words: ['coin', '硬币'] },
  { emoji: '🐷', words: ['piggy bank', 'piggy', '存钱罐', '小猪'] },
  { emoji: '🐷', words: ['save', 'saving', 'savings', '存钱', '储蓄'], weak: true },
  {
    emoji: '🍦',
    words: ['ice cream', 'ice-cream', 'icecream', 'gelato', 'froyo', 'sundae', '冰淇淋', '雪糕'],
  },
  {
    emoji: '🎮',
    words: [
      'game',
      'gaming',
      'video game',
      'xbox',
      'playstation',
      'nintendo',
      'minecraft',
      'roblox',
      '游戏',
      '打游戏',
    ],
  },
  {
    emoji: '📱',
    words: ['screen time', 'screen', 'tablet', 'ipad', 'phone', 'youtube', '屏幕', '平板', '手机'],
  },
  {
    emoji: '🎬',
    words: ['movie', 'movie night', 'film', 'cinema', 'theater', 'theatre', '电影'],
  },
  { emoji: '🍕', words: ['pizza', '披萨', '比萨'] },
  { emoji: '🍪', words: ['cookie', 'biscuit', 'dessert', '饼干', '甜点'] },
  { emoji: '🍪', words: ['treat', 'snack', '零食', '奖励'], weak: true },
  { emoji: '🍬', words: ['candy', 'sweets', 'lollipop', 'chocolate', '糖', '巧克力'] },
  { emoji: '🧁', words: ['cake', 'cupcake', 'baking', 'bake', '蛋糕'] },
  { emoji: '🍩', words: ['donut', 'doughnut', '甜甜圈'] },
  { emoji: '🍿', words: ['popcorn', '爆米花'] },
  {
    emoji: '🍔',
    words: [
      'restaurant',
      'eating out',
      'eat out',
      'dinner out',
      'takeout',
      'burger',
      'fries',
      '餐厅',
      '饭店',
      '下馆子',
      '汉堡',
    ],
  },
  { emoji: '🧸', words: ['toy', 'lego', 'teddy', 'doll', '玩具', '积木', '娃娃'] },
  { emoji: '🎁', words: ['present', 'gift', 'surprise', '礼物', '惊喜'], weak: true },
  { emoji: '📚', words: ['book', 'bookstore', 'comic', 'library', '书', '漫画'] },
  { emoji: '🎨', words: ['art', 'craft', 'paint', 'painting', 'drawing', '画画', '手工'] },
  {
    emoji: '⚽',
    words: ['sport', 'soccer', 'football', 'basketball', 'baseball', '运动', '足球', '篮球'],
  },
  { emoji: '🚲', words: ['bike', 'bicycle', 'bike ride', 'scooter', '自行车', '骑车', '滑板车'] },
  { emoji: '🛝', words: ['playground', 'park', 'slide', 'swing', '公园', '游乐场'] },
  { emoji: '🏊', words: ['swim', 'swimming', 'pool', '游泳', '泳池'] },
  { emoji: '🏖️', words: ['beach', 'seaside', 'sea', '海滩', '沙滩', '海边'] },
  { emoji: '🏕️', words: ['camping', 'camp', 'tent', '露营'] },
  { emoji: '🦁', words: ['zoo', 'safari', '动物园'] },
  { emoji: '🎳', words: ['bowling', '保龄球'] },
  {
    emoji: '🎟️',
    words: ['ticket', 'museum', 'aquarium', 'concert', '门票', '博物馆', '水族馆'],
  },
  { emoji: '🎟️', words: ['outing', 'day out', '外出'], weak: true },
  {
    emoji: '🏰',
    words: [
      'disneyland',
      'disney',
      'disney world',
      'theme park',
      'amusement park',
      'legoland',
      'universal',
      'castle',
      '迪士尼',
      '乐园',
      '主题公园',
      '游乐园',
      '城堡',
    ],
  },
  { emoji: '🏰', words: ['trip', 'vacation', 'holiday', '旅行', '度假'], weak: true },
  { emoji: '🛌', words: ['sleepover', 'sleep over', 'slumber party', '过夜', '睡衣派对'] },
  {
    emoji: '🌙',
    words: ['stay up late', 'stay up', 'late night', 'late bedtime', 'bedtime', '晚睡', '晚点睡'],
  },
  { emoji: '🏆', words: ['trophy', 'medal', 'prize', 'champion', '奖杯', '奖牌', '奖品'] },
  {
    emoji: '⭐',
    words: ['well done', 'good job', 'great job', 'star', 'superstar', '真棒', '好棒', '星星'],
  },
];

/**
 * A picture for a reward from the words in its name (English or Simplified Chinese), or
 * `undefined` when nothing in the name is known: "Allowance" is money, "Ice cream" 🍦,
 * "Disneyland" 🏰, "Movie night" 🎬. Pure.
 */
const REWARD_SUGGESTER = emojiSuggester(REWARD_EMOJI_KEYWORDS);
export const suggestRewardEmoji: (name: string) => string | undefined = REWARD_SUGGESTER.suggest;

/**
 * `pictureAfterRename` (`utils/emojiSuggest.ts`, the rule chores share) with the reward
 * suggester: the ONE rule for the weekly reward and the special reward drawer. `settledName`
 * is the name `current` was last settled against; `fallback` is the plain default (shown when
 * there is no picture, and the one picture an unknown name gives way from).
 */
export function rewardEmojiAfterRename(
  settledName: string | undefined,
  newName: string | undefined,
  current: string | undefined,
  fallback: string
): string {
  const next = pictureAfterRename(REWARD_SUGGESTER, {
    settledName: settledName ?? '',
    newName: newName ?? '',
    current,
    hasArt: false,
    plainDefault: fallback,
  });
  return next ?? (current || fallback);
}
