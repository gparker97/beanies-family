/**
 * TripLists: a trip's Lists section is a thin wrapper over `LinkedListsSection` (whose
 * behaviour is tested there). What it must pass: the lists linked to this trip, a trip target,
 * Vacation Packing suggested, blank lists starting in Trips, no stacking (the trip is a page,
 * not a drawer); and `openNewList()` must reach the section (the "+ Add a Plan" → List chip).
 */
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyList } from '@/types/models';

const h = vi.hoisted(() => ({ listsForTrip: vi.fn(), openNewList: vi.fn() }));

vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({ listsForTrip: h.listsForTrip }),
}));

import TripLists from '../TripLists.vue';

// A stand-in that records its props and exposes `openNewList`, as the real section does.
const SectionStub = defineComponent({
  name: 'LinkedListsSection',
  props: ['lists', 'target', 'suggestedTemplateKey', 'blankCategory', 'stacked', 'logContext'],
  setup(_, { expose }) {
    expose({ openNewList: h.openNewList });
    return () => null;
  },
});

function mountTrip() {
  return mount(TripLists, {
    props: { vacationId: 'trip-1' },
    global: { stubs: { LinkedListsSection: SectionStub } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.listsForTrip.mockReturnValue([{ id: 'a' } as FamilyList]);
});

describe('TripLists', () => {
  it('passes the trip lists and a trip target, Vacation Packing first, blank lists in Trips', () => {
    const s = mountTrip().findComponent(SectionStub);
    expect(h.listsForTrip).toHaveBeenCalledWith('trip-1');
    expect(s.props()).toMatchObject({
      lists: [{ item: { id: 'a' } }],
      target: { kind: 'trip', vacationId: 'trip-1' },
      suggestedTemplateKey: 'vacation-packing',
      blankCategory: 'trips',
    });
    expect(s.props('stacked')).toBeFalsy();
    expect(s.props('logContext')).toBeUndefined();
  });

  it('forwards openNewList() to the section', () => {
    const w = mountTrip();
    (w.vm as unknown as { openNewList: () => void }).openNewList();
    expect(h.openNewList).toHaveBeenCalledTimes(1);
  });
});
