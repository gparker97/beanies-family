// The choreboard's four time-of-day blocks as every page surface draws them (#146): the glyph,
// the label key and the colour class (`.chore-block-*` in `src/style.css`, which carries the
// tint, the ink and their dark partners). The block ORDER and every rule about blocks live in
// `utils/chores.ts`; this file is display data only.
import { choreDaysKind } from '@/utils/chores';
import type { ChoreBlock } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface ChoreBlockMeta {
  emoji: string;
  labelKey: UIStringKey;
  /** The block as a lowercase word inside a sentence ("2 morning chores left"): the daily
   *  briefing's line and the widget row's tag. */
  wordKey: UIStringKey;
  /** The colour class: sets `--chore-tint` / `--chore-ink` for the element and its children. */
  colorClass: string;
}

export const CHORE_BLOCK_META: Readonly<Record<ChoreBlock, ChoreBlockMeta>> = {
  morning: {
    emoji: '🌅',
    labelKey: 'choreboard.block.morning',
    wordKey: 'choreboard.briefing.block.morning',
    colorClass: 'chore-block-morning',
  },
  afternoon: {
    emoji: '☀️',
    labelKey: 'choreboard.block.afternoon',
    wordKey: 'choreboard.briefing.block.afternoon',
    colorClass: 'chore-block-afternoon',
  },
  evening: {
    emoji: '🌙',
    labelKey: 'choreboard.block.evening',
    wordKey: 'choreboard.briefing.block.evening',
    colorClass: 'chore-block-evening',
  },
  anytime: {
    emoji: '✨',
    labelKey: 'choreboard.block.anytime',
    wordKey: 'choreboard.briefing.block.anytime',
    colorClass: 'chore-block-anytime',
  },
};

/**
 * A chore's picture when none was picked or suggested (`suggestChoreEmoji`), and every chore
 * added on the wall.
 */
export const DEFAULT_CHORE_EMOJI = '🧹';

/** The emoji a chore is drawn with: its own, or the default when it has none. */
export function choreEmoji(chore: { emoji?: string }): string {
  return chore.emoji || DEFAULT_CHORE_EMOJI;
}

/** Short weekday names, 0 = Sunday (`choreDayOfWeek`): the weekly row and the week panel. */
export const CHORE_DAY_LABEL_KEYS: readonly UIStringKey[] = [
  'planner.day.sun',
  'planner.day.mon',
  'planner.day.tue',
  'planner.day.wed',
  'planner.day.thu',
  'planner.day.fri',
  'planner.day.sat',
];

/** Monday first, as the weekday toggles (`DayOfWeekSelector`) are. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * The ONE quiet days label for a chore (a row's tag, a set preview's tag): '' for every day,
 * "School Days", "Weekends", or the short day list ("Mon, Wed") in week order.
 */
export function choreDaysLabel(
  days: readonly number[] | undefined,
  resolve: (key: UIStringKey) => string
): string {
  const kind = choreDaysKind(days);
  if (kind === 'every') return '';
  if (kind === 'school') return resolve('choreboard.form.days.school');
  if (kind === 'weekends') return resolve('choreboard.form.days.weekends');
  const set = new Set(days ?? []);
  return WEEK_ORDER.filter((d) => set.has(d))
    .map((d) => resolve(CHORE_DAY_LABEL_KEYS[d]!))
    .join(', ');
}

/** The longest chore title, in the Add Chores sheet and a bean's chore list alike. */
export const CHORE_TITLE_MAX = 60;

/**
 * Card art a grown-up can give a chore (`ChorePicturePicker`, the "Beanie Pictures" row), beside
 * its emoji. Each key is a
 * `public/brand/cards/<key>.webp` (pinned by `choreStarterSets.test`), shared with the Who Owns
 * What hero cards; a chore stores the key, never the path.
 */
export const CHORE_ART_OPTIONS: readonly { key: string; labelKey: UIStringKey }[] = [
  { key: 'school-drop-off', labelKey: 'choreboard.art.school' },
  { key: 'bedtime-routine', labelKey: 'choreboard.art.bedtime' },
  { key: 'laundry', labelKey: 'choreboard.art.laundry' },
  { key: 'cooking-dinner', labelKey: 'choreboard.art.dinner' },
  { key: 'trash-night', labelKey: 'choreboard.art.trash' },
  { key: 'grocery-shopping', labelKey: 'choreboard.art.groceries' },
];

/** A chore's stored card-art key → the bundled image path. */
export function choreArtSrc(key: string | undefined): string | undefined {
  return key ? `/brand/cards/${key}.webp` : undefined;
}

/** The emoji a grown-up can pick for a chore (`ChorePicturePicker`), each with its name. */
export const CHORE_EMOJI_OPTIONS: readonly { emoji: string; labelKey: UIStringKey }[] = [
  { emoji: '🛏️', labelKey: 'choreboard.emoji.bed' },
  { emoji: '🪥', labelKey: 'choreboard.emoji.teeth' },
  { emoji: '👕', labelKey: 'choreboard.emoji.clothes' },
  { emoji: '🎒', labelKey: 'choreboard.emoji.schoolBag' },
  { emoji: '👟', labelKey: 'choreboard.emoji.shoes' },
  { emoji: '🥣', labelKey: 'choreboard.emoji.breakfast' },
  { emoji: '🍽️', labelKey: 'choreboard.emoji.table' },
  { emoji: '🧸', labelKey: 'choreboard.emoji.toys' },
  { emoji: '🧺', labelKey: 'choreboard.emoji.laundry' },
  { emoji: '🧹', labelKey: 'choreboard.emoji.tidy' },
  { emoji: '🗑️', labelKey: 'choreboard.emoji.trash' },
  { emoji: '🐾', labelKey: 'choreboard.emoji.pet' },
  { emoji: '🪴', labelKey: 'choreboard.emoji.plants' },
  { emoji: '📚', labelKey: 'choreboard.emoji.reading' },
  { emoji: '✏️', labelKey: 'choreboard.emoji.homework' },
  { emoji: '🛁', labelKey: 'choreboard.emoji.bath' },
];

/**
 * Keyword data for `suggestChoreEmoji`: never shown, only matched against a chore's title.
 * English words match whole words (an optional plural `s` / `es` allowed), so "cat" never fires
 * inside "education"; Chinese words match anywhere in the title. `weak` marks a generic verb
 * ("feed", "brush", "walk"): any object word beats it, so "feed the dog" is the dog and "brush
 * teeth" is the toothbrush. Within a tier the longest keyword wins, then table order.
 */
const CHORE_EMOJI_KEYWORDS: readonly {
  emoji: string;
  words: readonly string[];
  weak?: boolean;
}[] = [
  { emoji: '🛏️', words: ['bed', 'make bed', 'make your bed', '床', '铺床', '叠被'] },
  { emoji: '🪥', words: ['teeth', 'tooth', 'toothbrush', 'floss', '刷牙', '牙'] },
  { emoji: '🪥', words: ['brush', '刷'], weak: true },
  { emoji: '💇', words: ['hair', 'comb', '梳头', '头发'] },
  {
    emoji: '👕',
    words: ['dress', 'dressed', 'clothes', 'uniform', 'outfit', '穿衣', '衣服', '校服'],
  },
  { emoji: '🧥', words: ['coat', 'jacket', '外套'] },
  { emoji: '🛌', words: ['pajamas', 'pyjamas', 'pjs', 'bedtime', '睡衣', '睡觉'] },
  { emoji: '👟', words: ['shoe', 'shoes', 'sneakers', 'boots', '鞋'] },
  { emoji: '🎒', words: ['bag', 'backpack', 'schoolbag', 'school bag', '书包', '背包'] },
  { emoji: '🥣', words: ['breakfast', 'cereal', '早餐', '早饭'] },
  { emoji: '🥪', words: ['lunch', 'lunchbox', 'lunch box', '午餐', '午饭', '饭盒'] },
  { emoji: '🍎', words: ['snack', 'fruit', '零食', '水果'] },
  { emoji: '🍽️', words: ['eat', '吃'], weak: true },
  { emoji: '🍽️', words: ['table', 'set the table', 'dinner', 'supper', '摆桌', '餐桌', '晚饭'] },
  { emoji: '🧽', words: ['dish', 'dishes', 'dishwasher', '洗碗', '碗'] },
  { emoji: '🧼', words: ['hands', 'face', '洗手', '洗脸'] },
  { emoji: '🧼', words: ['wash', '洗'], weak: true },
  { emoji: '🛁', words: ['bath', 'shower', '洗澡', '沐浴'] },
  { emoji: '🚽', words: ['bathroom', 'toilet', '厕所', '卫生间'] },
  { emoji: '💊', words: ['vitamins', 'vitamin', 'medicine', '药', '维生素'] },
  {
    emoji: '✏️',
    words: ['homework', 'worksheet', 'spelling', 'math', 'maths', '作业', '功课'],
  },
  { emoji: '📚', words: ['read', 'reading', 'book', 'library', '读书', '阅读', '看书'] },
  { emoji: '🎹', words: ['piano', 'keyboard', '钢琴', '练琴'] },
  { emoji: '🎻', words: ['violin', 'cello', '小提琴'] },
  { emoji: '🎸', words: ['guitar', '吉他'] },
  { emoji: '🎵', words: ['music', 'instrument', 'sing', '音乐'] },
  { emoji: '🎵', words: ['practice', 'practise', '练习'], weak: true },
  { emoji: '🐕', words: ['dog', 'puppy', '狗', '遛狗'] },
  { emoji: '🐈', words: ['cat', 'kitten', 'litter', '猫'] },
  { emoji: '🐟', words: ['fish', 'aquarium', '鱼'] },
  { emoji: '🐾', words: ['pet', 'hamster', 'rabbit', 'bunny', '宠物', '兔子'] },
  { emoji: '🐾', words: ['feed', '喂'], weak: true },
  { emoji: '🚶', words: ['walk', '散步'], weak: true },
  {
    emoji: '🪴',
    words: ['plant', 'plants', 'garden', 'flowers', '浇花', '植物', '花园', '花'],
  },
  { emoji: '🪴', words: ['water', '浇水'], weak: true },
  {
    emoji: '🗑️',
    words: ['trash', 'garbage', 'rubbish', 'recycling', 'bin', 'compost', '垃圾', '倒垃圾'],
  },
  {
    emoji: '🧺',
    words: ['laundry', 'washing', 'hamper', 'fold', 'socks', '洗衣', '洗衣服', '叠衣服'],
  },
  { emoji: '🧸', words: ['toy', 'toys', 'lego', '玩具', '积木'] },
  { emoji: '🧹', words: ['room', 'bedroom', 'vacuum', 'hoover', 'sweep', 'mop', '房间', '扫地'] },
  { emoji: '🧹', words: ['吸尘', '拖地'] },
  {
    emoji: '🧹',
    words: ['tidy', 'clean', 'clean up', 'put away', '收拾', '整理', '打扫'],
    weak: true,
  },
];

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Each keyword compiled once: whole-word for Latin words, anywhere for Chinese. */
const KEYWORD_MATCHERS = CHORE_EMOJI_KEYWORDS.flatMap((entry, order) =>
  entry.words.map((word) => ({
    emoji: entry.emoji,
    weak: !!entry.weak,
    order,
    size: word.length,
    test: matcherFor(word),
  }))
);

function matcherFor(word: string): (title: string) => boolean {
  if (!/[a-z]/.test(word)) return (title) => title.includes(word);
  const re = new RegExp(`(^|[^a-z])${escapeRe(word)}(s|es)?($|[^a-z])`);
  return (title) => re.test(title);
}

/**
 * A picture for a chore from the words in its title (English or Simplified Chinese), or
 * `undefined` when nothing in the title is known. Pure; the caller falls back to `choreEmoji()`.
 * The most specific word wins: an object word over a generic verb, then the longest keyword,
 * then the earlier table entry.
 */
export function suggestChoreEmoji(title: string): string | undefined {
  const text = title.trim().toLocaleLowerCase();
  if (!text) return undefined;
  let best: (typeof KEYWORD_MATCHERS)[number] | undefined;
  for (const m of KEYWORD_MATCHERS) {
    if (!m.test(text)) continue;
    if (
      !best ||
      (best.weak && !m.weak) ||
      (best.weak === m.weak &&
        (m.size > best.size || (m.size === best.size && m.order < best.order)))
    ) {
      best = m;
    }
  }
  return best?.emoji;
}

/**
 * The automatic picture for a chore a grown-up typed (both chore lists' new rows): from its
 * title (`suggestChoreEmoji`), else the default. Used until a picture is picked by hand.
 */
export function pictureForTitle(title: string): string {
  return suggestChoreEmoji(title) ?? DEFAULT_CHORE_EMOJI;
}
