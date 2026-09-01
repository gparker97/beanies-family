import { describe, it, expect } from 'vitest';
import { activityDetailRows } from '@/utils/activityDetails';
import type { FamilyActivity } from '@/types/models';

const stamp = '2026-09-01T00:00:00.000Z';
const NAMES: Record<string, string> = { greg: 'Greg', sofia: 'Sofia' };
const nameFor = (id: string) => NAMES[id];

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

describe('activityDetailRows', () => {
  it('returns nothing for an activity with no logistics', () => {
    expect(activityDetailRows({ activity: activity(), nameFor })).toEqual([]);
  });

  /** Time and place are the header, not rows — see the helper's docstring. */
  it('does not include location, which every surface leads with instead', () => {
    const rows = activityDetailRows({
      activity: activity({ location: 'the leisure centre' }),
      nameFor,
    });
    expect(rows).toEqual([]);
  });

  it('leads with who moves the child, then who to ring', () => {
    const rows = activityDetailRows({
      activity: activity({
        location: 'the leisure centre',
        dropoffMemberId: 'greg',
        pickupMemberId: 'sofia',
        instructorName: 'Coach Dana',
        instructorContact: '07700 900123',
      }),
      nameFor,
    });
    expect(rows.map((r) => r.labelKey)).toEqual([
      'planner.field.dropoff',
      'planner.field.pickup',
      'planner.field.instructor',
      'planner.field.instructorContact',
    ]);
  });

  it('resolves duty member ids to names and keeps the id for an avatar', () => {
    const [row] = activityDetailRows({
      activity: activity({ pickupMemberId: 'sofia' }),
      nameFor,
    });
    expect(row).toMatchObject({ value: 'Sofia', memberId: 'sofia' });
  });

  it('skips a duty whose member no longer exists rather than rendering a raw id', () => {
    const rows = activityDetailRows({
      activity: activity({ pickupMemberId: 'deleted-member' }),
      nameFor,
    });
    expect(rows).toEqual([]);
  });

  /**
   * The wall hangs in a kitchen where guests, babysitters and children read it.
   * `cost` and the linked transaction are real activity fields; they must never
   * be among the rows, whatever the caller asks for.
   */
  it('never exposes finance, even when the activity carries it', () => {
    const rows = activityDetailRows({
      activity: activity({
        cost: 42,
        location: 'the leisure centre',
      } as Partial<FamilyActivity>),
      nameFor,
    });
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain('42');
    expect(serialised).not.toContain('cost');
    expect(rows).toEqual([]);
  });
});
