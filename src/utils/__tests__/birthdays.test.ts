import { describe, it, expect } from 'vitest';
import {
  birthdaysInRange,
  birthdaysByDate,
  nextAnnualDate,
  birthdayLabel,
  MAX_AGE_SHOWN_ON_CALENDAR,
} from '../birthdays';
import type { FamilyMember } from '@/types/models';

function member(over: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'm-joey',
    name: 'Joey',
    role: 'member',
    color: '#F15D22',
    ageGroup: 'child',
    dateOfBirth: { month: 9, day: 15, year: 2019 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as FamilyMember;
}

describe('birthdaysInRange', () => {
  it('puts a birthday on its date inside the window, with the age reached', () => {
    const [b] = birthdaysInRange([member()], '2026-09-01', '2026-09-30');
    expect(b).toMatchObject({ date: '2026-09-15', name: 'Joey', age: 7, isPet: false });
  });

  it('omits the age when the birth YEAR is unknown, rather than printing nonsense', () => {
    // `DateOfBirth.year` is optional and plenty of families record only the day
    // and month. The chip falls back to "Joey's birthday".
    const [b] = birthdaysInRange(
      [member({ dateOfBirth: { month: 9, day: 15 } })],
      '2026-09-01',
      '2026-09-30'
    );
    expect(b!.age).toBeUndefined();
  });

  it('crosses a year boundary, because the month grid does', () => {
    // A six-week December grid reaches into January, and a birthday on the far
    // side of the boundary still has to appear.
    const boxingDay = member({ id: 'm-a', name: 'Ana', dateOfBirth: { month: 12, day: 26 } });
    const newYear = member({ id: 'm-b', name: 'Bo', dateOfBirth: { month: 1, day: 3 } });
    const dates = birthdaysInRange([boxingDay, newYear], '2026-11-29', '2027-01-09').map(
      (b) => b.date
    );
    expect(dates).toEqual(['2026-12-26', '2027-01-03']);
  });

  it('includes pets — the Nook already shows them', () => {
    const dog = member({ id: 'm-dog', name: 'Mochi', isPet: true });
    expect(birthdaysInRange([dog], '2026-09-01', '2026-09-30')[0]).toMatchObject({
      name: 'Mochi',
      isPet: true,
    });
  });

  it('skips a member with no date of birth rather than guessing one', () => {
    expect(
      birthdaysInRange([member({ dateOfBirth: undefined })], '2026-01-01', '2026-12-31')
    ).toHaveLength(0);
  });

  it('ignores a malformed date of birth instead of rendering an Invalid Date', () => {
    const bad = [
      member({ id: 'm1', dateOfBirth: { month: 0, day: 15 } }),
      member({ id: 'm2', dateOfBirth: { month: 13, day: 1 } }),
      member({ id: 'm3', dateOfBirth: { month: 6, day: 0 } }),
      member({ id: 'm4', dateOfBirth: { month: 6, day: 32 } }),
    ];
    expect(birthdaysInRange(bad, '2026-01-01', '2026-12-31')).toHaveLength(0);
  });

  it('never prints a negative age from a birth year in the future', () => {
    const b = birthdaysInRange(
      [member({ dateOfBirth: { month: 9, day: 15, year: 2030 } })],
      '2026-09-01',
      '2026-09-30'
    )[0];
    expect(b!.age).toBeUndefined();
  });

  it('orders by date then name, so two people sharing a day do not swap places', () => {
    const zoe = member({ id: 'm-z', name: 'Zoe', dateOfBirth: { month: 9, day: 15 } });
    const amy = member({ id: 'm-a', name: 'Amy', dateOfBirth: { month: 9, day: 15 } });
    const later = member({ id: 'm-l', name: 'Lee', dateOfBirth: { month: 9, day: 20 } });
    expect(
      birthdaysInRange([zoe, later, amy], '2026-09-01', '2026-09-30').map((b) => b.name)
    ).toEqual(['Amy', 'Zoe', 'Lee']);
  });

  it('returns nothing for an inverted or empty window', () => {
    expect(birthdaysInRange([member()], '2026-09-30', '2026-09-01')).toHaveLength(0);
    expect(birthdaysInRange([member()], '', '')).toHaveLength(0);
  });

  it('is inclusive at both ends', () => {
    expect(birthdaysInRange([member()], '2026-09-15', '2026-09-15')).toHaveLength(1);
  });
});

describe('29 February', () => {
  it('lands on 1 March in a non-leap year, matching the rest of the app', () => {
    const leapling = member({ dateOfBirth: { month: 2, day: 29, year: 2020 } });
    expect(birthdaysInRange([leapling], '2026-02-01', '2026-03-31')[0]!.date).toBe('2026-03-01');
  });

  it('lands on 29 February in a leap year', () => {
    const leapling = member({ dateOfBirth: { month: 2, day: 29, year: 2020 } });
    expect(birthdaysInRange([leapling], '2028-02-01', '2028-03-31')[0]!.date).toBe('2028-02-29');
  });
});

describe('nextAnnualDate', () => {
  it('returns this year when the date is still ahead', () => {
    expect(nextAnnualDate('2026-09-11', 9, 15)).toBe('2026-09-15');
  });

  it('returns TODAY when the date is today — a birthday has not passed yet', () => {
    expect(nextAnnualDate('2026-09-15', 9, 15)).toBe('2026-09-15');
  });

  it('rolls to next year once the date has gone', () => {
    expect(nextAnnualDate('2026-09-16', 9, 15)).toBe('2027-09-15');
  });
});

describe('birthdaysByDate', () => {
  it('buckets several people onto one day', () => {
    const twins = [
      member({ id: 'm-1', name: 'Ana', dateOfBirth: { month: 9, day: 15 } }),
      member({ id: 'm-2', name: 'Bo', dateOfBirth: { month: 9, day: 15 } }),
    ];
    const map = birthdaysByDate(birthdaysInRange(twins, '2026-09-01', '2026-09-30'));
    expect(map.get('2026-09-15')).toHaveLength(2);
  });
});

describe("birthdayLabel — the calendar only counts a child's years out loud", () => {
  const t = ((k: string) =>
    k === 'planner.birthday.withAge' ? "{name}'s {age} birthday" : "{name}'s birthday") as never;

  it('names the age for a child', () => {
    expect(birthdayLabel({ name: 'Joey', age: 7 }, t)).toBe("Joey's 7th birthday");
  });

  it('still names it AT the cutoff', () => {
    expect(birthdayLabel({ name: 'Kit', age: MAX_AGE_SHOWN_ON_CALENDAR }, t)).toBe(
      "Kit's 21st birthday"
    );
  });

  it('goes quiet the year AFTER the cutoff', () => {
    // "Sarah's 43rd birthday" announces something across the kitchen that an
    // adult may not have chosen to announce.
    expect(birthdayLabel({ name: 'Kit', age: MAX_AGE_SHOWN_ON_CALENDAR + 1 }, t)).toBe(
      "Kit's birthday"
    );
    expect(birthdayLabel({ name: 'Sarah', age: 43 }, t)).toBe("Sarah's birthday");
  });

  it('uses the same plain form when the birth year is unknown', () => {
    // One appearance for both cases, so an adult birthday is not distinguishable
    // from a bean whose year nobody recorded.
    expect(birthdayLabel({ name: 'Sam', age: undefined }, t)).toBe("Sam's birthday");
  });

  it('names a first birthday correctly, not "1th"', () => {
    expect(birthdayLabel({ name: 'Mochi', age: 1 }, t)).toBe("Mochi's 1st birthday");
  });

  it("names a newborn's zeroth year rather than dropping to the plain form", () => {
    // 0 is a real age and `age === 0` is falsy - the classic bug here.
    expect(birthdayLabel({ name: 'Baby', age: 0 }, t)).toBe("Baby's 0th birthday");
  });
});
