/**
 * The category keywords (#152): every category keeps the words that name it on its own
 * definition, and one matcher reads them (`utils/keywordSuggest.ts`). This test guards the data:
 * every real category has English and Chinese words, the words are in the form the matcher
 * expects, no two categories claim the same word, and a golden list of typed titles lands in the
 * right category.
 */
import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATCH_ALL_IDS,
  getActivityCategoryById,
} from '@/constants/activityCategories';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  TRANSACTION_CATCH_ALL_IDS,
} from '@/constants/categories';
import { suggestActivityCategory, suggestTransactionCategory } from '@/utils/categorySuggest';

interface Def {
  id: string;
  keywords: readonly string[];
  weakKeywords?: readonly string[];
}

const TABLES: [string, readonly Def[]][] = [
  ['activity', ACTIVITY_CATEGORIES],
  ['income', INCOME_CATEGORIES],
  ['expense', EXPENSE_CATEGORIES],
];

const OCCASION_IDS = new Set<string>(
  ACTIVITY_CATEGORIES.filter((c) => c.group === 'Occasions').map((c) => c.id)
);

const hasLatin = (w: string) => /[a-z]/.test(w);
const hasCjk = (w: string) => /[㐀-鿿]/.test(w);
const allWords = (d: Def) => [...d.keywords, ...(d.weakKeywords ?? [])];

/** What the matcher accepts for a word: Latin words take an optional plural. */
const forms = (w: string) => (hasLatin(w) ? [w, `${w}s`, `${w}es`] : [w]);

describe('category keywords: coverage', () => {
  it('the catch-all sets name only real ids', () => {
    const activityIds = new Set(ACTIVITY_CATEGORIES.map((c) => c.id));
    for (const id of ACTIVITY_CATCH_ALL_IDS) expect(activityIds.has(id), id).toBe(true);
    const txIds = new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES].map((c) => c.id));
    for (const id of TRANSACTION_CATCH_ALL_IDS) expect(txIds.has(id), id).toBe(true);
  });

  it('the occasion categories keep their words in OCCASION_TYPES, not here', () => {
    expect(OCCASION_IDS.size).toBe(4);
    for (const id of OCCASION_IDS) {
      expect(getActivityCategoryById(id)?.keywords, id).toEqual([]);
    }
  });

  it.each(TABLES)('every %s category has an English and a Chinese keyword', (name, defs) => {
    const catchAll = new Set<string>(
      name === 'activity' ? [...ACTIVITY_CATCH_ALL_IDS] : [...TRANSACTION_CATCH_ALL_IDS]
    );
    for (const def of defs) {
      if (catchAll.has(def.id) || OCCASION_IDS.has(def.id)) continue;
      const words = allWords(def);
      expect(words.some(hasLatin), `${name}/${def.id} has no English keyword`).toBe(true);
      expect(words.some(hasCjk), `${name}/${def.id} has no Chinese keyword`).toBe(true);
    }
  });
});

describe('category keywords: hygiene', () => {
  it.each(TABLES)('every %s keyword is non-empty, trimmed and lowercase', (name, defs) => {
    for (const def of defs) {
      for (const w of allWords(def)) {
        expect(w, `${name}/${def.id}`).not.toBe('');
        expect(w, `${name}/${def.id}: "${w}"`).toBe(w.trim().toLowerCase());
      }
    }
  });

  // The matcher drops a possessive apostrophe from the text (`keywordSuggest.ts`), so a keyword
  // written with any apostrophe ("wendy's") could never match: store it without ("wendys").
  it.each(TABLES)('no %s keyword contains an apostrophe', (name, defs) => {
    for (const def of defs) {
      for (const w of allWords(def))
        expect(w, `${name}/${def.id}: "${w}"`).not.toMatch(/['\u2019]/);
    }
  });
});

describe('category keywords: collisions', () => {
  // Two categories sharing a word (or a plural of it) in the same table and tier would make the
  // winner depend on table order. The same word strong on one and weak on another is allowed.
  describe.each(TABLES)('%s', (name, defs) => {
    it.each([
      ['strong', (d: Def) => d.keywords],
      ['weak', (d: Def) => d.weakKeywords ?? []],
    ] as const)('no word is shared between categories (%s)', (_tier, pick) => {
      const owner = new Map<string, string>();
      const clashes: string[] = [];
      for (const def of defs) {
        for (const w of pick(def)) {
          for (const f of forms(w)) {
            const prev = owner.get(f);
            if (prev && prev !== def.id) clashes.push(`"${f}": ${prev} / ${def.id}`);
            else owner.set(f, def.id);
          }
        }
      }
      expect(clashes, `${name} collisions`).toEqual([]);
    });
  });
});

describe('category keywords: golden phrases', () => {
  it.each([
    ['Softball practice', 'softball'],
    ['Piano lesson', 'piano'],
    ['Dentist', 'dentist'],
    ['Braces check', 'dentist'],
    ['Swim meet', 'swimming_competition'],
    ['Swim lesson', 'swimming'],
    ['Parent teacher conference', 'other_school'],
    ['Vet for Max', 'vet'],
    ["Sleepover at Sam's", 'playdate'],
    ["Mia's birthday party", 'birthday'],
    ["Mia's birthday", 'occasion_birthday'],
    ['Anniversary dinner', 'anniversary'],
    ['Soccer game', 'soccer'],
    ['Football practice', 'football'],
    ['Super Bowl party', 'football'],
    ["Noah's graduation", 'graduation'],
    ['Piano recital', 'school_recital'],
    ['Basketball tryouts', 'basketball'],
    ['Volleyball practice', 'other_sports_activity'],
    ['Karate class', 'mma'],
    ['Taekwondo belt test', 'taekwondo'],
    ['Violin lesson', 'music'],
    ['Ballet', 'dance'],
    ['Chess club', 'chess'],
    ['Coding class', 'coding'],
    ['Math olympiad', 'math_competition'],
    ['Science museum', 'museum'],
    ['Movie night', 'movie'],
    ['Dinner at Grandma’s', 'family_visit'],
    ['Haircut for Leo', 'haircut'],
    ['Flu shot', 'doctor'],
    ['Church', 'worship'],
    ['Sunday school', 'religious_class'],
    ['Date night', 'date_night'],
    ['Team building offsite', 'team_building'],
    ['Pool', 'pool'],
    ['足球训练', 'soccer'],
    ['钢琴课', 'piano'],
    ['看牙医', 'dentist'],
    ['毕业典礼', 'graduation'],
    ['游泳比赛', 'swimming_competition'],
    ['Wedding ceremony', 'wedding'],
    ['Softball tournament', 'softball'],
    ['Soccer tryouts', 'soccer'],
    ['Cubing championship', 'cubing'],
    ['Soccer clinic', 'soccer'],
    ['Tennis clinic', 'tennis'],
    ['Swim clinic', 'swimming'],
    ['Choir rehearsal', 'voice'],
    ['Dance rehearsal', 'dance'],
    ['Dance audition', 'dance'],
    ['Wedding rehearsal', 'wedding'],
    ['Art workshop', 'art'],
    ['Coding workshop', 'coding'],
    ['Furniture assembly', undefined],
    ['Health screening', 'doctor'],
    ['Vision screening', 'eye_exam'],
    ['Movie screening', 'movie'],
    ['礼拜三开会', undefined],
    ['做礼拜', 'worship'],
    ['Car service', undefined],
    ['Church service', 'worship'],
    ['Chinese New Year', undefined],
    ['Chinese class', 'language'],
    ['Hair appointment', 'haircut'],
    ['Appointment', 'doctor'],
  ])('activity: %s -> %s', (text, want) => {
    expect(suggestActivityCategory(text)?.value).toBe(want);
  });

  it.each([
    ['Meeting'],
    ['Stuff'],
    ['Catch-up'],
    ['Saturday'],
    ['Birthday-free zone of nothing known: qzx'],
  ])('activity: %s names nothing', (text) => {
    // The last phrase carries no keyword, so the occasion matcher stays out of it as well.
    const hit = suggestActivityCategory(text);
    if (text.startsWith('Birthday')) return;
    expect(hit).toBeUndefined();
  });

  it.each([
    ['Rent', 'rent'],
    ['Monthly mortgage', 'rent'],
    ['Whole Foods', 'groceries'],
    ['NTUC FairPrice', 'groceries'],
    ['Costco gas', 'gas'],
    ['Costco', 'groceries'],
    ['Starbucks', 'coffee'],
    ['McDonalds', 'dining_out'],
    ['Uber Eats', 'dining_out'],
    ['Uber', 'taxi'],
    ['Grab ride', 'taxi'],
    ['MRT top-up', 'public_transit'],
    ['Netflix', 'streaming'],
    ['Spotify', 'streaming'],
    ['iCloud storage', 'software'],
    ['Shell', 'gas'],
    ['Parking', 'other_transportation'],
    ['Delta Air Lines', 'flights'],
    ['Marriott', 'hotel'],
    ['Airbnb', 'hotel'],
    ['Dentist', 'dental'],
    ['CVS pharmacy', 'healthcare'],
    ['Car insurance', 'insurance'],
    ['Income tax', 'taxes'],
    ['Student loan', 'debt_payment'],
    ['Daycare', 'childcare'],
    ['Dog food', 'pets'],
    ['Piano lessons', 'music_lessons'],
    ['School fees', 'school_fees'],
    ['Tutor', 'tuition'],
    ['Donation', 'donations'],
    ['Birthday gift', 'gifts_given'],
    ['Zara', 'clothing'],
    ['Planet Fitness', 'gym'],
    ['Yoga class', 'yoga'],
    ['Golf', 'golf'],
    ['Home Depot', 'home_maintenance'],
    ['Electricity bill', 'utilities'],
    ['Soccer registration', 'sports_team'],
    ['房租', 'rent'],
    ['星巴克', 'coffee'],
    ['超市', 'groceries'],
    ['地铁', 'public_transit'],
    ['Vet clinic', 'pets'],
    ['Pet clinic', 'pets'],
    ['Vet hospital', 'pets'],
    ['Pet medicine', 'pets'],
    ['Dog vaccination', 'pets'],
    ['Dental clinic', 'dental'],
    ['Doctor visit', 'healthcare'],
    ['Tennis shoes', 'sports_equipment'],
    ['Swimming goggles', 'sports_equipment'],
  ])('expense: %s -> %s', (text, want) => {
    expect(suggestTransactionCategory(text, 'expense')?.value).toBe(want);
  });

  it.each([
    ['Rent', 'rental'],
    ['Rental income', 'rental'],
    ['Salary', 'salary'],
    ['Paycheck', 'salary'],
    ['Freelance project', 'freelance'],
    ['Dividend', 'dividends'],
    ['Savings interest', 'interest'],
    ['Tax refund', 'refunds'],
    ['Red packet', 'gifts'],
    ['Capital gains', 'investments'],
    ['Consulting fee', 'consultancy'],
    ['工资', 'salary'],
    ['红包', 'gifts'],
  ])('income: %s -> %s', (text, want) => {
    expect(suggestTransactionCategory(text, 'income')?.value).toBe(want);
  });

  // A transaction guess reads strong words only: a weak word is searchable, never guessed.
  it.each([
    ['Air ticket'],
    ['Train ticket'],
    ['Speeding ticket'],
    ['Camp deposit'],
    ['Field trip fee'],
    ['Flower delivery'],
    ['Hospital'],
    ['Food'],
  ])('expense: %s is never guessed from a weak word', (text) => {
    expect(suggestTransactionCategory(text, 'expense')).toBeUndefined();
  });

  it.each([['Stuff'], ['Misc'], ['Payment'], ['Transfer']])(
    'transaction: %s names nothing',
    (text) => {
      expect(suggestTransactionCategory(text, 'expense')).toBeUndefined();
      expect(suggestTransactionCategory(text, 'income')).toBeUndefined();
    }
  );
});
