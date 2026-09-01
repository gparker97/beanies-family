import { describe, it, expect } from 'vitest';
import {
  matchesWallFilter,
  sortByTime,
  wallActivityColour,
  wallEvents,
} from '@/utils/wallActivities';
import { SHARED_EVENT_COLOR, MEMBER_COLOR_VALUES } from '@/constants/memberColors';
import type { FamilyActivity, FamilyMember } from '@/types/models';

const stamp = '2026-09-01T00:00:00.000Z';

function activity(over: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a1',
    title: 'swim',
    date: '2026-09-01',
    category: 'sports',
    recurrence: 'none',
    isActive: true,
    createdAt: stamp,
    updatedAt: stamp,
    ...over,
  } as FamilyActivity;
}
function member(id: string, color: string): FamilyMember {
  return { id, name: id, color } as FamilyMember;
}
const occ = (a: FamilyActivity) => ({ activity: a, date: '2026-09-01' });

describe('matchesWallFilter', () => {
  it('shows everything when no filter is set', () => {
    expect(matchesWallFilter(activity({ assigneeIds: ['leo'] }), null)).toBe(true);
  });

  it('keeps an activity assigned to a visible member', () => {
    expect(matchesWallFilter(activity({ assigneeIds: ['leo'] }), ['leo'])).toBe(true);
  });

  it('drops an activity assigned only to someone else', () => {
    expect(matchesWallFilter(activity({ assigneeIds: ['milo'] }), ['leo'])).toBe(false);
  });

  /**
   * The bug this exists for: the family dinner, the school holiday and the trip
   * carry no assignee, and a naive `.some()` removed all of them the moment
   * anybody tapped a bean — hiding exactly what the whole wall is for.
   */
  it('always shows an unassigned, family-wide activity', () => {
    expect(matchesWallFilter(activity({ assigneeIds: [] }), ['leo'])).toBe(true);
    expect(matchesWallFilter(activity({ assigneeIds: undefined }), ['leo'])).toBe(true);
  });
});

describe('sortByTime', () => {
  it('orders by start time, all-day first', () => {
    const sorted = sortByTime([
      occ(activity({ id: 'evening', startTime: '18:30' })),
      occ(activity({ id: 'allday' })),
      occ(activity({ id: 'morning', startTime: '08:05' })),
    ]);
    expect(sorted.map((e) => e.activity.id)).toEqual(['allday', 'morning', 'evening']);
  });

  it('does not mutate its input', () => {
    const input = [occ(activity({ id: 'b', startTime: '18:30' })), occ(activity({ id: 'a' }))];
    sortByTime(input);
    expect(input.map((e) => e.activity.id)).toEqual(['b', 'a']);
  });
});

describe('wallEvents', () => {
  it('filters then sorts, so a capped day keeps its earliest events', () => {
    const result = wallEvents(
      [
        occ(activity({ id: 'late', startTime: '21:00', assigneeIds: ['leo'] })),
        occ(activity({ id: 'other', startTime: '09:00', assigneeIds: ['milo'] })),
        occ(activity({ id: 'schoolrun', startTime: '08:05', assigneeIds: ['leo'] })),
      ],
      ['leo']
    );
    expect(result.map((e) => e.activity.id)).toEqual(['schoolrun', 'late']);
  });
});

describe('wallActivityColour', () => {
  const members = new Map([
    ['leo', member('leo', '#8b5cf6')],
    // A REAL member hue. Heritage Orange (the shared-event colour) is deliberately not one
    // of them, and a fixture that used it here would make this suite pass or fail on a
    // collision that cannot occur in the app.
    ['milo', member('milo', '#3D8FD1')],
  ]);

  it("uses the owner's colour, so two beans' football look different", () => {
    expect(wallActivityColour(activity({ assigneeIds: ['leo'] }), members)).toBe('#8b5cf6');
    expect(wallActivityColour(activity({ assigneeIds: ['milo'] }), members)).toBe('#3D8FD1');
  });

  it('gives an unowned event the shared colour, not a category one', () => {
    // Supersedes the category fallback deliberately: an event nobody owns is the whole
    // family's, shows in every lane, and must read as shared rather than borrowing a hue
    // that could be mistaken for a person's. Asserted against the constant so the two
    // cannot drift apart.
    const colour = wallActivityColour(activity({ assigneeIds: [] }), members);
    expect(colour).toBe(SHARED_EVENT_COLOR);
    // The point of the constant: it can never collide with a real member's colour.
    expect(MEMBER_COLOR_VALUES).not.toContain(colour);
  });
});
