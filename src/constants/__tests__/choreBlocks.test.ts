/**
 * `suggestChoreEmoji` (#146): a chore's picture from the words in its title, English or
 * Simplified Chinese. The most specific word wins (an object over a generic verb, then the
 * longest keyword); English matches whole words only; nothing known is `undefined`.
 */
import { describe, it, expect } from 'vitest';
import { CHORE_EMOJI_OPTIONS, suggestChoreEmoji } from '@/constants/choreBlocks';

describe('suggestChoreEmoji', () => {
  it.each([
    ['Make your bed', '🛏️'],
    ['Get dressed', '👕'],
    ['Brush teeth', '🪥'],
    ['Eat breakfast', '🥣'],
    ['Pack school bag', '🎒'],
    ['Put on shoes', '👟'],
    ['Take a bath', '🛁'],
    ['Shower', '🛁'],
    ['Pajamas on', '🛌'],
    ['Homework', '✏️'],
    ['Read a book', '📚'],
    ['Feed the dog', '🐕'],
    ['Walk the dog', '🐕'],
    ['Feed the cat', '🐈'],
    ['Feed the fish', '🐟'],
    ['Water the plants', '🪴'],
    ['Unload the dishwasher', '🧽'],
    ['Set the table', '🍽️'],
    ['Take out the trash', '🗑️'],
    ['Put laundry away', '🧺'],
    ['Tidy up toys', '🧸'],
    ['Clean your room', '🧹'],
    ['Vacuum the stairs', '🧹'],
    ['Piano practice', '🎹'],
    ['Wash hands', '🧼'],
    ['Clean the bathroom', '🚽'],
  ])('%s -> %s', (title, emoji) => {
    expect(suggestChoreEmoji(title)).toBe(emoji);
  });

  it.each([
    ['铺床', '🛏️'],
    ['刷牙', '🪥'],
    ['喂狗', '🐕'],
    ['喂猫', '🐈'],
    ['浇花', '🪴'],
    ['洗碗', '🧽'],
    ['倒垃圾', '🗑️'],
    ['叠衣服', '🧺'],
    ['洗衣服', '🧺'],
    ['穿衣服', '👕'],
    ['整理玩具', '🧸'],
    ['整理房间', '🧹'],
    ['写作业', '✏️'],
    ['练钢琴', '🎹'],
  ])('zh %s -> %s', (title, emoji) => {
    expect(suggestChoreEmoji(title)).toBe(emoji);
  });

  it('a generic verb alone still suggests, but any object word beats it', () => {
    expect(suggestChoreEmoji('Feed')).toBe('🐾');
    expect(suggestChoreEmoji('Brush')).toBe('🪥');
    expect(suggestChoreEmoji('Brush hair')).toBe('💇');
  });

  it('matches whole English words only, any case, with a plural', () => {
    expect(suggestChoreEmoji('Education')).toBeUndefined(); // never "cat"
    expect(suggestChoreEmoji('Bedtime story')).toBe('🛌'); // never "bed"
    expect(suggestChoreEmoji('FEED THE DOGS')).toBe('🐕');
  });

  it('nothing known, or a blank title, is undefined', () => {
    expect(suggestChoreEmoji('Say thank you')).toBeUndefined();
    expect(suggestChoreEmoji('说谢谢')).toBeUndefined();
    expect(suggestChoreEmoji('   ')).toBeUndefined();
    expect(suggestChoreEmoji('')).toBeUndefined();
  });

  it('every suggestion is a single emoji string', () => {
    // A guard against a typo in the keyword table turning into a word on the board.
    const known = new Set(CHORE_EMOJI_OPTIONS.map((o) => o.emoji));
    for (const t of ['Make bed', 'Brush teeth', 'Get dressed', 'Feed the dog']) {
      const e = suggestChoreEmoji(t)!;
      expect(/\p{Extended_Pictographic}/u.test(e)).toBe(true);
      expect(e.length).toBeLessThanOrEqual(4);
    }
    expect(known.has(suggestChoreEmoji('Make bed')!)).toBe(true);
  });
});
