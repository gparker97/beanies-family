/**
 * Stars and rewards (#148): the reward picture options and their suggester. The keyword table is
 * private; it is tested through `suggestRewardEmoji` (every option reachable from a name) and the
 * rename rule the weekly reward and the special reward drawer share (`rewardEmojiAfterRename`;
 * the rule itself, `emojiAfterRename`, is tested beside it in `utils/emojiSuggest.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REWARD_EMOJI,
  DEFAULT_SPECIAL_REWARD_EMOJI,
  REWARD_EMOJI_OPTIONS,
  rewardEmojiAfterRename,
  suggestRewardEmoji,
} from '@/constants/choreStars';

describe('REWARD_EMOJI_OPTIONS', () => {
  it('about 30 choices, no repeats, money first', () => {
    const emojis = REWARD_EMOJI_OPTIONS.map((o) => o.emoji);
    expect(emojis.length).toBeGreaterThanOrEqual(28);
    expect(emojis.length).toBeLessThanOrEqual(34);
    expect(new Set(emojis).size).toBe(emojis.length);
    expect(emojis.slice(0, 3)).toEqual(['💵', '🪙', '🐷']);
    expect(new Set(REWARD_EMOJI_OPTIONS.map((o) => o.labelKey)).size).toBe(emojis.length);
  });

  it('keeps the defaults pickable', () => {
    const emojis = REWARD_EMOJI_OPTIONS.map((o) => o.emoji);
    expect(emojis).toContain(DEFAULT_REWARD_EMOJI);
    expect(emojis).toContain(DEFAULT_SPECIAL_REWARD_EMOJI);
  });
});

describe('suggestRewardEmoji', () => {
  it.each([
    ['Allowance', '💵'],
    ['Pocket money', '💵'],
    ['零花钱', '💵'],
    ['$5 cash', '💵'],
    ['Coins for the jar', '🪙'],
    ['Piggy bank', '🐷'],
    ['Savings', '🐷'],
    ['Ice cream', '🍦'],
    ['ICE CREAM SUNDAE', '🍦'],
    ['冰淇淋', '🍦'],
    ['Video game time', '🎮'],
    ['Extra screen time', '📱'],
    ['Movie night', '🎬'],
    ['看电影', '🎬'],
    ['Pizza Friday', '🍕'],
    ['A treat', '🍪'],
    ['Candy', '🍬'],
    ['Birthday cake', '🧁'],
    ['Donuts', '🍩'],
    ['Popcorn', '🍿'],
    ['Eating out', '🍔'],
    ['New Lego set', '🧸'],
    ['A present', '🎁'],
    ['A new book', '📚'],
    ['Art supplies', '🎨'],
    ['Soccer game', '⚽'],
    ['Bike ride', '🚲'],
    ['Day at the park', '🛝'],
    ['Swimming pool', '🏊'],
    ['Beach day', '🏖️'],
    ['Camping trip', '🏕️'],
    ['Trip to the zoo', '🦁'],
    ['Bowling', '🎳'],
    ['Museum tickets', '🎟️'],
    ['Disneyland', '🏰'],
    ['Theme park', '🏰'],
    ['迪士尼乐园', '🏰'],
    ['Big trip', '🏰'],
    ['Sleepover', '🛌'],
    ['Stay up late', '🌙'],
    ['A trophy', '🏆'],
    ['Well done!', '⭐'],
  ])('%s -> %s', (name, emoji) => {
    expect(suggestRewardEmoji(name)).toBe(emoji);
  });

  it('every option is reachable from some name in the table above', () => {
    const reached = new Set(
      [
        'Allowance',
        'Coins',
        'Piggy bank',
        'Ice cream',
        'Video game',
        'Screen time',
        'Movie',
        'Pizza',
        'Treat',
        'Candy',
        'Cake',
        'Donut',
        'Popcorn',
        'Eating out',
        'Toy',
        'Present',
        'Book',
        'Art',
        'Soccer',
        'Bike',
        'Park',
        'Swimming',
        'Beach',
        'Camping',
        'Zoo',
        'Bowling',
        'Museum',
        'Disneyland',
        'Sleepover',
        'Stay up late',
        'Trophy',
        'Well done',
      ].map((n) => suggestRewardEmoji(n))
    );
    for (const o of REWARD_EMOJI_OPTIONS) expect(reached).toContain(o.emoji);
  });

  it('nothing known (or nothing typed): undefined; whole words only', () => {
    expect(suggestRewardEmoji('')).toBeUndefined();
    expect(suggestRewardEmoji('   ')).toBeUndefined();
    expect(suggestRewardEmoji('Something nice')).toBeUndefined();
    // "art" never fires inside "party", "pay" never inside "paying attention"... as a word only.
    expect(suggestRewardEmoji('Party')).toBeUndefined();
  });

  it('a specific word beats a generic one: the zoo over the trip, the bike over saving', () => {
    expect(suggestRewardEmoji('A trip to the zoo')).toBe('🦁');
    expect(suggestRewardEmoji('Save for a bike')).toBe('🚲');
    expect(suggestRewardEmoji('Ice cream treat')).toBe('🍦');
  });
});

describe('rewardEmojiAfterRename: the rule with the reward suggester', () => {
  it.each([
    ['"Ice cream" (piggy by hand) to "Allowance": money', 'Ice cream', 'Allowance', '🐷', '💵'],
    [
      '"Allowance" (piggy by hand) to "Weekly allowance": the piggy stays',
      'Allowance',
      'Weekly allowance',
      '🐷',
      '🐷',
    ],
    ['to a name with no suggestion: the piggy stays', 'Ice cream', 'Something nice', '🐷', '🐷'],
    ['the name unchanged (opening): the picture stays', 'Ice cream', 'Ice cream', '🐷', '🐷'],
    ['no picture, no name: the default', '', '', undefined, DEFAULT_REWARD_EMOJI],
    ['a Chinese keyword', 'Ice cream', '零花钱', '🐷', '💵'],
  ] as const)('%s', (_n, settledName, newName, current, expected) => {
    expect(rewardEmojiAfterRename(settledName, newName, current, DEFAULT_REWARD_EMOJI)).toBe(
      expected
    );
  });
});
