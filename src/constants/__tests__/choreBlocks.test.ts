/**
 * `suggestChoreEmoji` (#146): a chore's picture from the words in its title, English or
 * Simplified Chinese. The most specific word wins (an object over a generic verb, then the
 * longest keyword); English matches whole words only; nothing known is `undefined`.
 * `chorePictureAfterRename`: the rename rule rewards share, with card art.
 */
import { describe, it, expect } from 'vitest';
import {
  CHORE_EMOJI_OPTIONS,
  DEFAULT_CHORE_EMOJI,
  chorePictureAfterRename,
  suggestChoreEmoji,
  type ChorePicture,
} from '@/constants/choreBlocks';

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

describe('chorePictureAfterRename: only a change of suggestion re-picks', () => {
  const art = (emoji: string, illustration: string): ChorePicture => ({ emoji, illustration });
  const emoji = (e: string): ChorePicture => ({ emoji: e, illustration: undefined });
  it.each([
    [
      '"Feed the dog" with card art picked by hand to "Feed the dog before school": the art stays',
      'Feed the dog',
      'Feed the dog before school',
      art('🐕', 'school-drop-off'),
      art('🐕', 'school-drop-off'),
    ],
    [
      '"Make bed" with a hand pick to "Brush teeth": the toothbrush',
      'Make bed',
      'Brush teeth',
      emoji('🧸'),
      emoji('🪥'),
    ],
    [
      'a rename whose suggestion changes replaces card art with the emoji',
      'Do the laundry',
      'Feed the cat',
      art('🧺', 'laundry'),
      emoji('🐈'),
    ],
    [
      'an unmatched rename keeps a hand pick',
      'Make bed',
      'Say thank you',
      emoji('⭐'),
      emoji('⭐'),
    ],
    [
      'an unmatched rename keeps card art',
      'Do the laundry',
      'Help Grandma',
      art('🧺', 'laundry'),
      art('🧺', 'laundry'),
    ],
    [
      'an unmatched rename keeps a suggested picture (no jump to the default)',
      'Feed the dog',
      'Say thank you',
      emoji('🐕'),
      emoji('🐕'),
    ],
    [
      'the title unchanged (opening): the picture stays',
      'Make bed',
      'Make bed',
      emoji('🧸'),
      emoji('🧸'),
    ],
    ['a Chinese title: 铺床 to 刷牙', '铺床', '刷牙', emoji('⭐'), emoji('🪥')],
    [
      'a Chinese small edit keeps a hand pick: 刷牙 to 早上刷牙',
      '刷牙',
      '早上刷牙',
      emoji('⭐'),
      emoji('⭐'),
    ],
    [
      'a blank row named: its suggestion',
      '',
      'Feed the dog',
      emoji(DEFAULT_CHORE_EMOJI),
      emoji('🐕'),
    ],
    [
      'a blank row named with nothing known: the default',
      '',
      'Say thank you',
      emoji(DEFAULT_CHORE_EMOJI),
      emoji(DEFAULT_CHORE_EMOJI),
    ],
    [
      'a hand pick on a blank row gives way to a first title that suggests something',
      '',
      'Feed the dog',
      art('⭐', 'trash-night'),
      emoji('🐕'),
    ],
    [
      'no picture at all, nothing known: the default',
      'Help',
      'Help out',
      emoji(''),
      emoji(DEFAULT_CHORE_EMOJI),
    ],
  ] as const)('%s', (_n, settled, renamed, current, expected) => {
    expect(chorePictureAfterRename(settled, renamed, current)).toEqual(expected);
  });
});
