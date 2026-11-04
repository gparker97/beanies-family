/**
 * ActivityLists (#114): the activity drawer's Lists section is a thin wrapper over
 * `LinkedListsSection` (whose behaviour is tested there). What it must pass:
 *   - the viewed session's lists, with the whole-activity ones tagged,
 *   - a target linking new or attached lists to that session (series id + session date for a
 *     repeating activity, the id alone for a one-off),
 *   - the template suggested for the activity's category, no blank category (Home stays),
 *   - the viewed record's id for telemetry, and stacking above the drawer.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyActivity, FamilyList } from '@/types/models';

const h = vi.hoisted(() => ({
  sessionItems: [] as { item: { id: string }; scope: 'session' | 'every-session' }[],
  listsForActivitySession: vi.fn(),
}));

vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({ listsForActivitySession: h.listsForActivitySession }),
}));

import ActivityLists from '../ActivityLists.vue';

function activity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'series',
    title: 'Soccer Practice',
    date: '2026-09-05',
    category: 'soccer',
    recurrence: 'weekly',
    ...overrides,
  } as FamilyActivity;
}

function section(act: FamilyActivity = activity()) {
  const w = mount(ActivityLists, {
    props: { activity: act, sessionYmd: '2026-10-10' },
    global: { stubs: { LinkedListsSection: true } },
  });
  return w.findComponent({ name: 'LinkedListsSection' });
}

const list = (id: string) => ({ id }) as FamilyList;

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionItems = [];
  h.listsForActivitySession.mockImplementation(() => h.sessionItems);
});

describe('ActivityLists', () => {
  it('passes the session lists, tagging the whole-activity ones', () => {
    h.sessionItems = [
      { item: list('a'), scope: 'session' },
      { item: list('b'), scope: 'every-session' },
    ];
    const s = section();
    expect(h.listsForActivitySession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'series' }),
      '2026-10-10'
    );
    expect(s.props('lists')).toEqual([
      { item: list('a'), everySession: false },
      { item: list('b'), everySession: true },
    ]);
  });

  it('targets the viewed session of a repeating activity, stacked, with its id for telemetry', () => {
    const s = section();
    expect(s.props()).toMatchObject({
      target: { kind: 'activity', link: { activityId: 'series', activityDate: '2026-10-10' } },
      stacked: true,
      logContext: { activity_id: 'series' },
    });
    expect(s.props('blankCategory')).toBeUndefined();
  });

  it('links a one-off activity by id alone (no session date)', () => {
    const s = section(activity({ id: 'one-off', recurrence: 'none' }));
    expect(s.props('target')).toEqual({ kind: 'activity', link: { activityId: 'one-off' } });
  });

  it('suggests the template for the activity category, and nothing for a sports activity', () => {
    expect(section(activity({ category: 'birthday' })).props('suggestedTemplateKey')).toBe(
      'party-prep'
    );
    expect(section().props('suggestedTemplateKey')).toBeUndefined();
  });
});
