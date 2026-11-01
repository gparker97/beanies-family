import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIVITY_CATEGORIES } from '@/constants/activityCategories';
import { UI_STRINGS, type UIStringKey } from '@/services/translation/uiStrings';
import { ZH_STRINGS } from '@/services/translation/zh';
import type { FamilyActivity } from '@/types/models';
import {
  activityDisplayTitle,
  CELEBRATORY_OCCASIONS,
  isOccasionCategory,
  matchOccasionCategory,
  occasionCount,
  occasionMilestone,
  OCCASION_TYPES,
  validateOccasionYear,
} from '@/utils/occasions';
import { nextOccasionAnchor } from '@/utils/occasionAnchor';

const en = (key: UIStringKey) => (UI_STRINGS as Record<string, string>)[key] ?? key;
const zh = (key: UIStringKey) => (ZH_STRINGS as Record<string, string>)[key] ?? key;

function occasion(over: Partial<FamilyActivity>): FamilyActivity {
  return {
    id: 'o1',
    title: "Uncle Bob's birthday",
    category: 'occasion_birthday',
    date: '2026-11-07',
    ...over,
  } as FamilyActivity;
}

describe('OCCASION_TYPES', () => {
  it('lists exactly the Occasions-group categories', () => {
    const group = ACTIVITY_CATEGORIES.filter((c) => c.group === 'Occasions')
      .map((c) => c.id)
      .sort();
    expect(Object.keys(OCCASION_TYPES).sort()).toEqual(group);
  });

  it('declares remembrance first, so it outranks birthday when both words appear', () => {
    expect(Object.keys(OCCASION_TYPES)[0]).toBe('remembrance');
  });

  it('every year label and milestone key has en, beanie and zh values', () => {
    for (const type of Object.values(OCCASION_TYPES)) {
      for (const key of [type.yearLabelKey, type.milestoneKeys.one, type.milestoneKeys.other]) {
        expect(en(key)).not.toBe(key);
        expect(zh(key)).not.toBe(key);
      }
    }
  });

  it('only remembrance does not celebrate', () => {
    expect([...CELEBRATORY_OCCASIONS].sort()).toEqual(
      ['anniversary', 'occasion_birthday', 'other_occasion'].sort()
    );
  });
});

describe('isOccasionCategory', () => {
  it('recognises the occasion ids and nothing else', () => {
    expect(isOccasionCategory('occasion_birthday')).toBe(true);
    expect(isOccasionCategory('anniversary')).toBe(true);
    expect(isOccasionCategory('birthday')).toBe(false);
    expect(isOccasionCategory('constructor')).toBe(false);
    expect(isOccasionCategory('__proto__')).toBe(false);
    expect(isOccasionCategory(undefined)).toBe(false);
  });
});

describe('occasionCount + occasionMilestone', () => {
  it('counts years from the occasion year to the occurrence', () => {
    expect(occasionCount(occasion({ occasionYear: 1966 }), '2026-11-07')).toBe(60);
  });

  it('is undefined without a year, for a non-occasion, or below 1', () => {
    expect(occasionCount(occasion({}), '2026-11-07')).toBeUndefined();
    expect(
      occasionCount(occasion({ category: 'birthday', occasionYear: 1966 }), '2026-11-07')
    ).toBeUndefined();
    expect(occasionCount(occasion({ occasionYear: 2026 }), '2026-11-07')).toBeUndefined();
    expect(occasionCount(occasion({ occasionYear: 2030 }), '2026-11-07')).toBeUndefined();
  });

  it('birthday: turns {n}', () => {
    expect(occasionMilestone(occasion({ occasionYear: 1966 }), '2026-11-07', en)).toBe('turns 60');
  });

  it('anniversary: ordinal in English, {n}周年 in zh', () => {
    const a = occasion({ category: 'anniversary', occasionYear: 1986, title: 'Our anniversary' });
    expect(occasionMilestone(a, '2026-06-01', en)).toBe('40th anniversary');
    expect(occasionMilestone(a, '2026-06-01', zh)).toBe('40周年');
    expect(occasionMilestone({ ...a, occasionYear: 2025 }, '2026-06-01', en)).toBe(
      '1st anniversary'
    );
  });

  it('remembrance and other: one / other year forms', () => {
    const r = occasion({ category: 'remembrance', occasionYear: 2025 });
    expect(occasionMilestone(r, '2026-03-01', en)).toBe('1 year');
    expect(occasionMilestone({ ...r, occasionYear: 2016 }, '2026-03-01', en)).toBe('10 years');
    expect(
      occasionMilestone({ ...r, category: 'other_occasion', occasionYear: 2016 }, '2026-03-01', zh)
    ).toBe('10年');
  });

  it('remembrance never says "turns"', () => {
    const r = occasion({ category: 'remembrance', occasionYear: 1966 });
    expect(occasionMilestone(r, '2026-11-07', en)).not.toContain('turns');
  });
});

describe('isRound', () => {
  it('birthdays: 30, 40, 50 ... only', () => {
    const { isRound } = OCCASION_TYPES.occasion_birthday;
    expect([20, 29, 30, 35, 40, 60, 100].filter(isRound)).toEqual([30, 40, 60, 100]);
  });

  it('anniversaries: 10, 25, 40, 50, 60, 70, 75', () => {
    const { isRound } = OCCASION_TYPES.anniversary;
    expect([1, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80].filter(isRound)).toEqual([
      10, 25, 40, 50, 60, 70, 75,
    ]);
  });

  it('never for remembrance or other', () => {
    expect(OCCASION_TYPES.remembrance.isRound(10)).toBe(false);
    expect(OCCASION_TYPES.other_occasion.isRound(50)).toBe(false);
  });
});

describe('activityDisplayTitle', () => {
  it('appends the milestone to the family title, never rewording it', () => {
    expect(activityDisplayTitle(occasion({ occasionYear: 1966 }), '2026-11-07', en)).toBe(
      "Uncle Bob's birthday (turns 60)"
    );
    expect(activityDisplayTitle(occasion({ occasionYear: 1966 }), '2026-11-07', zh)).toBe(
      "Uncle Bob's birthday（满 60 岁）"
    );
  });

  it('returns the plain title with no year or for a non-occasion', () => {
    expect(activityDisplayTitle(occasion({}), '2026-11-07', en)).toBe("Uncle Bob's birthday");
    expect(
      activityDisplayTitle(occasion({ category: 'birthday', occasionYear: 1966 }), '2026-11-07', en)
    ).toBe("Uncle Bob's birthday");
  });

  it('is total: a malformed year, bad date or bad record returns the plain title', () => {
    const bad = occasion({ occasionYear: '1966' as unknown as number });
    expect(activityDisplayTitle(bad, '2026-11-07', en)).toBe("Uncle Bob's birthday");
    expect(activityDisplayTitle(occasion({ occasionYear: 1966.5 }), '2026-11-07', en)).toBe(
      "Uncle Bob's birthday"
    );
    expect(activityDisplayTitle(occasion({ occasionYear: 1966 }), 'not-a-date', en)).toBe(
      "Uncle Bob's birthday"
    );
    expect(activityDisplayTitle(occasion({ occasionYear: 1966 }), '', en)).toBe(
      "Uncle Bob's birthday"
    );
    expect(activityDisplayTitle(null, '2026-11-07', en)).toBe('');
    expect(
      activityDisplayTitle(
        { title: 'X', category: 'nope' as FamilyActivity['category'], occasionYear: 1966 },
        '2026-11-07',
        en
      )
    ).toBe('X');
  });
});

describe('validateOccasionYear', () => {
  const today = '2026-11-01';
  it('accepts 1900 through this year', () => {
    expect(validateOccasionYear(1900, today)).toBe('ok');
    expect(validateOccasionYear(1966, today)).toBe('ok');
    expect(validateOccasionYear(2026, today)).toBe('ok');
  });

  it('rejects the future, before 1900, and anything not four digits', () => {
    expect(validateOccasionYear(2027, today)).toBe('future');
    expect(validateOccasionYear(1899, today)).toBe('too-early');
    expect(validateOccasionYear(1850, today)).toBe('too-early');
    expect(validateOccasionYear(66, today)).toBe('format');
    expect(validateOccasionYear(19660, today)).toBe('format');
    expect(validateOccasionYear(1966.5, today)).toBe('format');
    expect(validateOccasionYear('1966', today)).toBe('format');
    expect(validateOccasionYear(undefined, today)).toBe('format');
    expect(validateOccasionYear(Number.NaN, today)).toBe('format');
  });
});

describe('matchOccasionCategory', () => {
  it('a place named Memorial is not a remembrance', () => {
    expect(matchOccasionCategory('Checkup at Memorial Hospital')).toBeNull();
    expect(matchOccasionCategory('Soccer at Memorial Park')).toBeNull();
  });
  it('an anniversary party is a party, not the yearly anniversary', () => {
    expect(matchOccasionCategory("Mum and Dad's 40th anniversary party")).toBeNull();
  });

  it.each([
    ["Uncle Bob's birthday", 'occasion_birthday'],
    ["Auntie Mae's BDAY", 'occasion_birthday'],
    ['妈妈生日', 'occasion_birthday'],
    ['Our anniversary', 'anniversary'],
    ['结婚十周年', 'anniversary'],
    ['In memory of Grandma', 'remembrance'],
    ['Remembrance day for Joe', 'remembrance'],
    ['外公忌日', 'remembrance'],
    ["Dad's death anniversary", 'remembrance'],
    ["Grandpa's death anniversary at Memorial Park", 'remembrance'],
    ['In memory of Nana, Memorial Hall', 'remembrance'],
  ])('%s → %s', (title, expected) => {
    expect(matchOccasionCategory(title)).toBe(expected);
  });

  it.each([
    'Birthday party',
    "Sam's birthday party",
    '生日派对',
    'Memorial Day BBQ',
    "Grandpa's memorial", // ambiguous on its own (a place, a service): the person picks
    "Grandma's birthday memorial", // a sad word vetoes the celebratory birthday
    "Grandma's memorial service", // a one-off event to attend
    'Funeral for Grandpa',
    'Piano lesson',
    'Birthdays are fun', // whole words only: "birthdays" is not "birthday"
    '',
  ])('%s → null', (title) => {
    expect(matchOccasionCategory(title)).toBeNull();
  });

  it('is null for non-strings', () => {
    expect(matchOccasionCategory(undefined)).toBeNull();
    expect(matchOccasionCategory(null)).toBeNull();
  });
});

describe('nextOccasionAnchor', () => {
  it('moves a past-year pick to the next occurrence and returns the picked year', () => {
    expect(nextOccasionAnchor('1966-11-07', '2026-11-01')).toEqual({
      anchor: '2026-11-07',
      year: 1966,
    });
    expect(nextOccasionAnchor('1966-03-01', '2026-11-01')).toEqual({
      anchor: '2027-03-01',
      year: 1966,
    });
  });

  it('a 29 February pick anchors on the most recent leap-year 29 February', () => {
    expect(nextOccasionAnchor('1964-02-29', '2026-11-01')).toEqual({
      anchor: '2024-02-29',
      year: 1964,
    });
    expect(nextOccasionAnchor('1964-02-29', '2028-01-10')).toEqual({
      anchor: '2028-02-29',
      year: 1964,
    });
  });

  it('is a no-op on its own output (the leap-anchor re-entry)', () => {
    expect(nextOccasionAnchor('2024-02-29', '2026-11-01')?.anchor).toBe('2024-02-29');
  });

  it('is null for a malformed date', () => {
    expect(nextOccasionAnchor('', '2026-11-01')).toBeNull();
    expect(nextOccasionAnchor('nope', '2026-11-01')).toBeNull();
  });
});

describe('occasions.ts stays a leaf', () => {
  it('imports only types, pure utils and the textSimilarity matcher (no services, no stores)', () => {
    // `listTemplates.ts` (via `listStore`) and `activityCelebration.ts` import this module;
    // a runtime import that reaches telemetry or a store closes a module cycle.
    const src = readFileSync(join(process.cwd(), 'src', 'utils', 'occasions.ts'), 'utf-8');
    const runtimeImports = [...src.matchAll(/^import (?!type )[^;]*from '([^']+)';/gm)].map(
      (m) => m[1]
    );
    expect(runtimeImports.sort()).toEqual([
      '@/utils/fillTemplate',
      '@/utils/format',
      '@/utils/textSimilarity',
    ]);
  });
});
