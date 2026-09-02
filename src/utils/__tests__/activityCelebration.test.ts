import { describe, it, expect } from 'vitest';
import { isCelebrationActivity } from '../activityCelebration';
import type { ActivityCategory } from '@/types/models';

// `'other_activity'` stands in for "a category that is not a celebration". The loop
// below passes real Party-group ids, and the ad-hoc strings are cast because an id can
// reach this from an older `.beanpod` written before a category was renamed.
const a = (title: string, category = 'other_activity' as ActivityCategory) => ({
  title,
  category,
});

describe('isCelebrationActivity', () => {
  it('celebrates every Party-group category regardless of title', () => {
    // Group, not a hand-maintained id list — a future Party category is covered free.
    const partyIds = [
      'birthday',
      'anniversary',
      'wedding',
      'graduation',
      'baby_shower',
    ] as ActivityCategory[];
    for (const id of partyIds) {
      expect(isCelebrationActivity(a('Tuesday', id)).celebrating).toBe(true);
      expect(isCelebrationActivity(a('Tuesday', id)).rule).toBe('category-group');
    }
  });

  it('does NOT celebrate work_party, which sits in the Work group', () => {
    expect(
      isCelebrationActivity(a('Team drinks', 'work_party' as ActivityCategory)).celebrating
    ).toBe(false);
  });

  it('celebrates a birthday named in the title with no category', () => {
    const v = isCelebrationActivity(a("Leo's birthday"));
    expect(v.celebrating).toBe(true);
    expect(v.rule).toBe('keyword');
  });

  it('does NOT celebrate an errand about a celebration', () => {
    // The errands outnumber the parties; without this, every shopping trip in the
    // run-up to a birthday gets confetti.
    const v = isCelebrationActivity(a('Buy birthday present for Leo'));
    expect(v.celebrating).toBe(false);
    expect(v.suppressed).toBe('errand-verb');
  });

  it('does NOT match a keyword inside another word', () => {
    expect(isCelebrationActivity(a('Partygoer meetup')).celebrating).toBe(false);
    expect(isCelebrationActivity(a('Birthdays spreadsheet')).celebrating).toBe(false);
  });

  it('KNOWN LIMITATION: a proper noun that is also a keyword still matches', () => {
    // The design mockup listed "Anniversary Road" as a must-not-match. Whole-word
    // matching cannot exclude it — "Anniversary" IS a whole word there — and no
    // errand verb opens the title. Distinguishing a street name from an occasion
    // needs proper-noun detection, which is far more machinery than this earns.
    //
    // Accepted deliberately: the cost is confetti on a rare card, the user can turn
    // it off in one tap, and the `activity-celebration` telemetry reports
    // `rule: 'keyword'` so the real-world false-positive rate is measurable rather
    // than guessed. Revisit if that rate says so.
    expect(isCelebrationActivity(a('Anniversary Road survey')).celebrating).toBe(true);
  });

  it('matches on emoji, before the errand suppressor', () => {
    const v = isCelebrationActivity(a("Max's bday 🎂"));
    expect(v.celebrating).toBe(true);
    expect(v.rule).toBe('emoji');
    // "Buy 🎂" is still a cake — emoji is near-certain intent.
    expect(isCelebrationActivity(a('Buy 🎂')).celebrating).toBe(true);
  });

  it('does not suppress a name that merely BEGINS with an errand verb', () => {
    // A bare startsWith suppressed each of these, and reported it as a deliberate
    // errand — so the false negatives were invisible in telemetry.
    for (const title of [
      "Payton's birthday",
      'Booker family wedding',
      'Post-graduation party',
      'Planetarium trip for Mia birthday',
      'Preparatory school graduation',
    ]) {
      expect(isCelebrationActivity(a(title)).celebrating).toBe(true);
    }
  });

  it('still suppresses real errands, including inflected forms', () => {
    for (const title of [
      'Buy birthday present',
      'Booking the anniversary dinner',
      'Ordered birthday cake',
      'Picking up birthday cake',
    ]) {
      const v = isCelebrationActivity(a(title));
      expect(v.celebrating).toBe(false);
      expect(v.suppressed).toBe('errand-verb');
    }
  });

  it('does NOT treat a gift or work-party emoji as a celebration', () => {
    // 🎁 is the canonical errand OBJECT — including it reopened the exact hole the
    // errand rule closes. 🎊 is work_party's registry emoji, the one category the
    // group rule deliberately excludes.
    expect(isCelebrationActivity(a('Buy 🎁 for Leo party')).celebrating).toBe(false);
    expect(isCelebrationActivity(a('Team drinks 🎊')).celebrating).toBe(false);
  });

  it('honours an explicit override in both directions', () => {
    expect(isCelebrationActivity(a("Leo's birthday"), 'en', false).celebrating).toBe(false);
    expect(isCelebrationActivity(a('Tuesday'), 'en', true).celebrating).toBe(true);
    expect(isCelebrationActivity(a('Tuesday'), 'en', true).rule).toBe('override');
  });

  it('matches Chinese titles from the zh list', () => {
    // An English-only list means a Chinese family never sees a birthday card.
    expect(isCelebrationActivity(a('小明的生日'), 'zh').celebrating).toBe(true);
    expect(isCelebrationActivity(a('買生日禮物'), 'zh').suppressed).toBe('errand-verb');
  });

  it('falls back to the English list for an unknown locale rather than matching nothing', () => {
    expect(isCelebrationActivity(a("Leo's birthday"), 'fr').celebrating).toBe(true);
  });

  it('returns none for an empty or blank title', () => {
    expect(isCelebrationActivity(a('   ')).rule).toBe('none');
  });
});
