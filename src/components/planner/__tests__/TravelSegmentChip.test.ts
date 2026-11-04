/**
 * Characterization of `TravelSegmentChip` (#141): written BEFORE its computeds moved into
 * `travelSegmentLabels` and unchanged after, so the week, day and timeline views' chip
 * provably did not move. Emoji, kind label, title, time, pending class, aria-label, click.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import TravelSegmentChip from '../TravelSegmentChip.vue';
import { segment } from '@/test/monthCellFixtures';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mountIt = (over = {}) =>
  mount(TravelSegmentChip, { props: { occurrence: segment('s1', over) } });

describe('TravelSegmentChip', () => {
  it('renders the transport emoji, short kind label, title and 12-hour time', () => {
    const w = mountIt({ transportType: 'flight_outbound', title: 'SQ 322', time: '09:00' });
    expect(w.get('.travel-chip-emoji').text()).toBe('🛫');
    expect(w.get('.travel-chip-kind').text()).toBe('planner.segmentDepartureShort');
    expect(w.get('.travel-chip-title').text()).toBe('SQ 322');
    expect(w.get('.travel-chip-time').text()).toBe('9am');
  });

  it('an arrival uses the arrival labels', () => {
    const w = mountIt({ kind: 'arrival', transportType: 'flight_outbound', title: 'SQ 322' });
    expect(w.get('.travel-chip-kind').text()).toBe('planner.segmentArrivalShort');
    expect(w.get('button').attributes('aria-label')).toBe('planner.segmentArrival: SQ 322');
  });

  it('omits the time element when the segment has no time', () => {
    expect(mountIt({ time: undefined }).find('.travel-chip-time').exists()).toBe(false);
  });

  it('a booked segment takes the booked class, a pending one the pending class', () => {
    expect(mountIt({ status: 'booked' }).get('button').classes()).toEqual(
      expect.arrayContaining(['travel-chip', 'travel-chip-booked'])
    );
    const pending = mountIt({ status: 'pending' }).get('button');
    expect(pending.classes()).toContain('travel-chip-pending');
    expect(pending.classes()).not.toContain('travel-chip-booked');
  });

  it('names itself with the full kind label and title (title attribute and aria-label)', () => {
    const btn = mountIt({ title: 'SQ 322' }).get('button');
    expect(btn.attributes('aria-label')).toBe('planner.segmentDeparture: SQ 322');
    expect(btn.attributes('title')).toBe('planner.segmentDeparture: SQ 322');
    expect(btn.attributes('type')).toBe('button');
  });

  it('click emits [vacationId, segmentIndex] and does not bubble', async () => {
    const parent = vi.fn();
    const w = mount(
      {
        components: { TravelSegmentChip },
        setup: () => ({ occ: segment('s1', { vacationId: 'v7', segmentIndex: 2 }), parent }),
        template: '<div @click="parent"><TravelSegmentChip :occurrence="occ" /></div>',
      },
      {}
    );
    await w.get('button').trigger('click');
    expect(w.findComponent(TravelSegmentChip).emitted('click')).toEqual([['v7', 2]]);
    expect(parent).not.toHaveBeenCalled();
  });
});
