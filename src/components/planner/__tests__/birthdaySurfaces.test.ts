import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A source scan, because the bug it exists for was a COUNTING error, not a logic
 * error.
 *
 * Family birthdays shipped on the month grid and the desktop week lane but not
 * on the mobile week view, the day view, or the agenda sidebar — greg found it
 * on his phone within the hour. The cause: the surfaces were enumerated by
 * grepping for `HolidayChip`, and the three that were missed render their
 * reference day through `HolidayBanner` instead. The grep answered a narrower
 * question than the one being asked, and the answer looked complete.
 *
 * So the rule is stated here instead of remembered: a birthday is a reference
 * day about somebody in this family, and every planner surface that shows a
 * PUBLIC holiday must also show a family birthday. Add a fourth holiday surface
 * and this test names it on the next run.
 */
const PLANNER_DIR = join(process.cwd(), 'src/components/planner');

/** Renders a public holiday in any of its forms. */
function showsHoliday(src: string): boolean {
  return /<HolidayChip|<HolidayBanner/.test(src);
}

function showsBirthday(src: string): boolean {
  return /<BirthdayChip/.test(src);
}

/**
 * Surfaces that legitimately show a holiday and NOT a birthday, each with the
 * reason. Keep this list short and argued — it is the escape hatch, and an
 * unexplained entry in it is how the rule above quietly stops meaning anything.
 */
const EXEMPT: Record<string, string> = {
  // The generic chip/banner primitives themselves: they render whatever a domain
  // adapter hands them and know nothing about either subject.
  'HolidayChip.vue': 'the holiday adapter itself',
  'HolidayBanner.vue': 'the holiday banner primitive',
};

describe('every planner surface that shows a holiday also shows a birthday', () => {
  const files = readdirSync(PLANNER_DIR).filter((f) => f.endsWith('.vue'));

  it('finds the planner components at all (guards against a silent empty scan)', () => {
    // Without this, moving the directory would make every assertion below pass
    // vacuously — the failure mode a source scan is most prone to.
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no surface showing a public holiday but not a family birthday', () => {
    const missing: string[] = [];
    for (const file of files) {
      if (file in EXEMPT) continue;
      const src = readFileSync(join(PLANNER_DIR, file), 'utf8');
      if (showsHoliday(src) && !showsBirthday(src)) missing.push(file);
    }
    expect(
      missing,
      `these render a public holiday but no family birthday: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('still finds holiday surfaces to check, so the rule has teeth', () => {
    const checked = files.filter(
      (f) => !(f in EXEMPT) && showsHoliday(readFileSync(join(PLANNER_DIR, f), 'utf8'))
    );
    expect(checked.length).toBeGreaterThanOrEqual(4);
  });
});
