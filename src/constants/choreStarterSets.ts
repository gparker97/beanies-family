// The choreboard's starter sets (#146): quick building for a family's first chores. A set only
// seeds new chores (`ChoreAddSheet` -> `useChoreAddDraft.addSet` puts its rows on the sheet's
// list, and the sheet's Add sends them to `choreStore.addChores`); once created a chore is a
// normal, fully editable record with no live link back (`starterKey` is kept for analytics and
// dedupe).
//
// Titles are string KEYS, resolved at creation time into the family's current language (as list
// templates do), so the stored chore title is the family's own text from then on.
// `illustration` is a card-art key that must exist as `public/brand/cards/<key>.webp`
// (pinned by `choreStarterSets.test`).
import { SCHOOL_DAYS } from '@/utils/chores';
import type { ChoreBlock } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface ChoreStarter {
  /** Stable within its set; never shown. */
  key: string;
  titleKey: UIStringKey;
  emoji: string;
  illustration?: string;
  /** Overrides the set's block for this one chore. */
  block?: ChoreBlock;
}

export interface ChoreStarterSet {
  key: ChoreStarterSetKey;
  nameKey: UIStringKey;
  emoji: string;
  /** The block a chore lands in unless it names its own. */
  block: ChoreBlock;
  /** Weekdays (0 = Sunday); absent = every day. */
  days?: readonly number[];
  chores: readonly ChoreStarter[];
}

/**
 * One row of a starter set as the grown-up left it in the sheet (#146): plain text, a built-in
 * title already resolved into the family's language, so an edited title is just text. The
 * sheet edits a COPY; the set definitions below are never changed. `starterChoreKey` names the
 * built-in row it came from; absent for a row the grown-up added.
 */
export interface StarterChoreDraft {
  title: string;
  emoji: string;
  illustration?: string;
  block: ChoreBlock;
  /** Weekdays 0-6; empty or absent = every day. */
  days?: number[];
  starterChoreKey?: string;
  /** The suggestion set the row came from; absent for a row the grown-up added. */
  setKey?: ChoreStarterSetKey;
}

export type ChoreStarterSetKey = 'school-morning' | 'bedtime' | 'pet-care' | 'tidy-up';

export const CHORE_STARTER_SETS: readonly ChoreStarterSet[] = [
  {
    key: 'school-morning',
    nameKey: 'choreboard.starterSet.schoolMorning',
    emoji: '🎒',
    block: 'morning',
    days: SCHOOL_DAYS,
    chores: [
      { key: 'make-bed', titleKey: 'choreboard.starterChore.makeBed', emoji: '🛏️' },
      { key: 'get-dressed', titleKey: 'choreboard.starterChore.getDressed', emoji: '👕' },
      { key: 'brush-teeth', titleKey: 'choreboard.starterChore.brushTeeth', emoji: '🪥' },
      { key: 'eat-breakfast', titleKey: 'choreboard.starterChore.eatBreakfast', emoji: '🥣' },
      {
        key: 'pack-bag',
        titleKey: 'choreboard.starterChore.packBag',
        emoji: '🎒',
        illustration: 'school-drop-off',
      },
      { key: 'shoes-on', titleKey: 'choreboard.starterChore.shoesOn', emoji: '👟' },
    ],
  },
  {
    key: 'bedtime',
    nameKey: 'choreboard.starterSet.bedtime',
    emoji: '🌙',
    block: 'evening',
    chores: [
      { key: 'bath', titleKey: 'choreboard.starterChore.bath', emoji: '🛁' },
      {
        key: 'pajamas',
        titleKey: 'choreboard.starterChore.pajamas',
        emoji: '🌙',
        illustration: 'bedtime-routine',
      },
      { key: 'brush-teeth', titleKey: 'choreboard.starterChore.brushTeeth', emoji: '🪥' },
      {
        key: 'clothes-tomorrow',
        titleKey: 'choreboard.starterChore.clothesTomorrow',
        emoji: '👕',
      },
      { key: 'read-book', titleKey: 'choreboard.starterChore.readBook', emoji: '📚' },
    ],
  },
  {
    key: 'pet-care',
    nameKey: 'choreboard.starterSet.petCare',
    emoji: '🐾',
    block: 'anytime',
    chores: [
      {
        key: 'feed-breakfast',
        titleKey: 'choreboard.starterChore.feedPetBreakfast',
        emoji: '🐾',
        block: 'morning',
      },
      {
        key: 'fresh-water',
        titleKey: 'choreboard.starterChore.freshWater',
        emoji: '💧',
        block: 'morning',
      },
      {
        key: 'walk-dog',
        titleKey: 'choreboard.starterChore.walkDog',
        emoji: '🐕',
        block: 'afternoon',
      },
      {
        key: 'feed-dinner',
        titleKey: 'choreboard.starterChore.feedPetDinner',
        emoji: '🍽️',
        block: 'evening',
      },
      { key: 'brush-pet', titleKey: 'choreboard.starterChore.brushPet', emoji: '🪮' },
    ],
  },
  {
    key: 'tidy-up',
    nameKey: 'choreboard.starterSet.tidyUp',
    emoji: '🧹',
    block: 'anytime',
    chores: [
      { key: 'toys-away', titleKey: 'choreboard.starterChore.toysAway', emoji: '🧸' },
      {
        key: 'clothes-hamper',
        titleKey: 'choreboard.starterChore.clothesHamper',
        emoji: '🧺',
        illustration: 'laundry',
      },
      {
        key: 'clear-plate',
        titleKey: 'choreboard.starterChore.clearPlate',
        emoji: '🍽️',
        illustration: 'cooking-dinner',
      },
      { key: 'tidy-room', titleKey: 'choreboard.starterChore.tidyRoom', emoji: '🧹' },
      {
        key: 'take-out-trash',
        titleKey: 'choreboard.starterChore.takeOutTrash',
        emoji: '🗑️',
        illustration: 'trash-night',
      },
    ],
  },
];

/** The set for `key`, or `undefined` for an unknown key (a bad query, a future build's set). */
export function choreStarterSet(key: string): ChoreStarterSet | undefined {
  return CHORE_STARTER_SETS.find((s) => s.key === key);
}

/**
 * The Beanie Lists chore templates and the starter set each one sends a family to on the
 * choreboard (the lists redirect, flag on). Keys are `LIST_TEMPLATES` keys.
 */
export const CHORE_TEMPLATE_TO_STARTER: Readonly<Record<string, ChoreStarterSetKey>> = {
  'before-school': 'school-morning',
  'kids-chores': 'tidy-up',
};

/**
 * A set's rows as fresh, independent drafts: titles resolved now through `resolve` (the
 * translation store's `t`), each row's block and the set's days copied, so editing a draft can
 * never reach the definition.
 */
export function starterSetDrafts(
  set: ChoreStarterSet,
  resolve: (key: UIStringKey) => string
): StarterChoreDraft[] {
  return set.chores.map((c) => ({
    title: resolve(c.titleKey),
    emoji: c.emoji,
    illustration: c.illustration,
    block: c.block ?? set.block,
    days: set.days ? [...set.days] : undefined,
    starterChoreKey: c.key,
    setKey: set.key,
  }));
}
