/**
 * The member-filter convention, in one place.
 *
 * An entity with no assignees belongs to the whole family. Filtering to a person narrows
 * the view to people; it does not delete the family's own events. The planner's day and
 * week timelines used `assignees.some(isSelected)` directly, and `.some()` on an EMPTY
 * array is always `false` — so filtering to one person silently removed every ownerless
 * activity from the timeline.
 */
import { describe, it, expect } from 'vitest';
import {
  belongsInMemberColumn,
  effectiveAssignees,
  isSharedEvent,
  matchesAssigneeFilter,
} from '@/utils/assignees';
import { matchesWallFilter } from '@/utils/wallActivities';
import type { FamilyActivity, FamilyMember } from '@/types/models';

const only = (id: string) => (candidate: string) => candidate === id;

describe('matchesAssigneeFilter', () => {
  it('keeps an entity with NO assignees — it belongs to everyone', () => {
    expect(matchesAssigneeFilter({}, only('greg'))).toBe(true);
    expect(matchesAssigneeFilter({ assigneeIds: [] }, only('greg'))).toBe(true);
  });

  it('keeps an entity assigned to the selected person', () => {
    expect(matchesAssigneeFilter({ assigneeIds: ['greg'] }, only('greg'))).toBe(true);
  });

  it('drops an entity assigned only to somebody else', () => {
    expect(matchesAssigneeFilter({ assigneeIds: ['leo'] }, only('greg'))).toBe(false);
  });

  it('keeps a shared entity when ANY assignee is selected', () => {
    expect(matchesAssigneeFilter({ assigneeIds: ['leo', 'greg'] }, only('greg'))).toBe(true);
  });

  it('honours the legacy single-assignee field', () => {
    expect(matchesAssigneeFilter({ assigneeId: 'greg' }, only('greg'))).toBe(true);
    expect(matchesAssigneeFilter({ assigneeId: 'leo' }, only('greg'))).toBe(false);
  });
});

describe('matchesWallFilter delegates to the same rule', () => {
  const activity = (over: Partial<FamilyActivity> = {}) =>
    ({ id: 'a1', ...over }) as FamilyActivity;

  it('shows everything when no filter is applied', () => {
    expect(matchesWallFilter(activity({ assigneeIds: ['leo'] }), null)).toBe(true);
  });

  it('keeps an ownerless activity under a filter', () => {
    expect(matchesWallFilter(activity(), ['greg'])).toBe(true);
  });

  it('drops somebody else’s activity under a filter', () => {
    expect(matchesWallFilter(activity({ assigneeIds: ['leo'] }), ['greg'])).toBe(false);
  });
});

describe('isSharedEvent / belongsInMemberColumn — the shared-event convention', () => {
  // The roster this family actually has. Every id outside it is a dead reference.
  const roster = new Set(['greg', 'leo', 'milo']);
  const known = (id: string) => roster.has(id);

  it('treats exactly one assignee as personal, anything else as shared', () => {
    expect(isSharedEvent({ assigneeIds: ['greg'] }, known)).toBe(false);
    expect(isSharedEvent({ assigneeId: 'greg' }, known)).toBe(false);
    // Two owners: already shown in both their columns, so already shared in practice.
    expect(isSharedEvent({ assigneeIds: ['greg', 'leo'] }, known)).toBe(true);
    // No owner: owned by everybody.
    expect(isSharedEvent({}, known)).toBe(true);
    expect(isSharedEvent({ assigneeIds: [] }, known)).toBe(true);
  });

  it('does NOT call a one-owner event shared because of a dead or duplicated id', () => {
    // The trumpet-lesson bug. `assigneeIds` is a CRDT array nothing prunes, so it collects
    // removed members, pets, and ids written twice by two devices merging — and counting
    // those raw entries dressed a single-owner lesson in the multi-person treatment while
    // the edit form showed its one owner.
    expect(isSharedEvent({ assigneeIds: ['leo', 'deleted-member'] }, known)).toBe(false);
    expect(isSharedEvent({ assigneeIds: ['leo', 'leo'] }, known)).toBe(false);
    expect(isSharedEvent({ assigneeIds: ['leo', 'pet-rex', 'gone'] }, known)).toBe(false);
    // Two REAL owners is still shared, dead ids alongside them or not.
    expect(isSharedEvent({ assigneeIds: ['leo', 'greg', 'gone'] }, known)).toBe(true);
    // Every id dead reads as ownerless, which is the honest answer.
    expect(isSharedEvent({ assigneeIds: ['gone', 'also-gone'] }, known)).toBe(true);
  });

  it('effectiveAssignees de-duplicates and drops unknown ids', () => {
    expect(effectiveAssignees({ assigneeIds: ['leo', 'leo', 'gone', 'greg'] }, known)).toEqual([
      'leo',
      'greg',
    ]);
    expect(effectiveAssignees({}, known)).toEqual([]);
  });

  it('puts an OWNERLESS event in every column — owned by nobody is owned by everybody', () => {
    expect(belongsInMemberColumn({}, 'greg')).toBe(true);
    expect(belongsInMemberColumn({}, 'milo')).toBe(true);
    expect(belongsInMemberColumn({ assigneeIds: [] }, 'milo')).toBe(true);
  });

  it('keeps a multi-owner event in its OWNERS’ columns and nobody else’s', () => {
    // The column rule is NOT `isSharedEvent`. Reusing it here pushed a three-owner trumpet
    // lesson into every lane in the family, so one child's lesson read as everybody's
    // evening. Style and placement answer different questions.
    expect(belongsInMemberColumn({ assigneeIds: ['greg', 'leo'] }, 'greg')).toBe(true);
    expect(belongsInMemberColumn({ assigneeIds: ['greg', 'leo'] }, 'leo')).toBe(true);
    expect(belongsInMemberColumn({ assigneeIds: ['greg', 'leo'] }, 'milo')).toBe(false);
  });

  it('keeps a one-owner event in that person’s column only', () => {
    expect(belongsInMemberColumn({ assigneeIds: ['greg'] }, 'greg')).toBe(true);
    expect(belongsInMemberColumn({ assigneeIds: ['greg'] }, 'leo')).toBe(false);
  });
});

describe('wallActivityColour — a shared event never wears one person’s colour', () => {
  it('uses the shared colour for a family-wide or multi-owner event', async () => {
    const { wallActivityColour } = await import('@/utils/wallActivities');
    const { SHARED_EVENT_COLOR } = await import('@/constants/memberColors');
    const members = new Map<string, FamilyMember>([
      ['greg', { id: 'greg', color: '#3b82f6' } as FamilyMember],
      ['leo', { id: 'leo', color: '#ef4444' } as FamilyMember],
    ]);

    // Previously this returned the FIRST assignee's colour, so a joint event looked like
    // one person's and a family event looked unassigned.
    expect(wallActivityColour({ assigneeIds: ['greg', 'leo'] } as never, members)).toBe(
      SHARED_EVENT_COLOR
    );
    expect(wallActivityColour({} as never, members)).toBe(SHARED_EVENT_COLOR);
    expect(wallActivityColour({ assigneeIds: ['greg'] } as never, members)).toBe('#3b82f6');
  });

  it('is a colour no member can be assigned, so the two can never be confused', async () => {
    const { SHARED_EVENT_COLOR, MEMBER_COLOR_VALUES } = await import('@/constants/memberColors');
    expect(MEMBER_COLOR_VALUES).not.toContain(SHARED_EVENT_COLOR);
  });
});
