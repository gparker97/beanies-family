/**
 * SegmentWhenBand `was` (#143): an airline-changed value renders as the live value (orange,
 * `.is-live`) with the replaced one struck beside it, on the line where it lives.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import SegmentWhenBand from '../SegmentWhenBand.vue';
import type { WhenBand } from '@/utils/vacation';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const BAND: WhenBand = {
  start: { captionKey: 'segmentRow.departs', date: '2026-12-13', time: '18:30' },
  end: { captionKey: 'segmentRow.arrives', date: '2026-12-14', time: '00:40', nextDay: true },
};

describe('SegmentWhenBand', () => {
  it('each cell carries its own check on its date line; an unchecked cell carries none', () => {
    const w = mount(SegmentWhenBand, {
      props: { band: BAND, checks: { start: 'confirmed' } },
    });
    const [start, end] = w.findAll('.when-cell');
    const pill = start!.get('.when-sub [title="travel.live.pillConfirmed"]');
    expect(pill.find('svg').exists()).toBe(true);
    expect(pill.find('.sr-only').text()).toBe('travel.live.pillConfirmed');
    expect(end!.find('.live-pill').exists()).toBe(false);
    const disputed = mount(SegmentWhenBand, {
      props: { band: BAND, checks: { start: 'confirmed', end: 'conflict' } },
    });
    expect(
      disputed.findAll('.when-cell')[1]!.get('.when-sub .live-pill').attributes()
    ).toMatchObject({ 'data-status': 'conflict', title: 'travel.live.pillConflict' });
    expect(
      mount(SegmentWhenBand, { props: { band: BAND } })
        .find('.live-pill')
        .exists()
    ).toBe(false);
  });

  it('without `was`, nothing is struck or highlighted', () => {
    const w = mount(SegmentWhenBand, { props: { band: BAND } });
    expect(w.findAll('s')).toHaveLength(0);
    expect(w.findAll('.is-live')).toHaveLength(0);
  });

  it('strikes the replaced times on their own line under the live ones, never inline', () => {
    const w = mount(SegmentWhenBand, {
      props: { band: BAND, was: { departureTime: '17:00', arrivalTime: '23:10' } },
    });
    const [start, end] = w.findAll('.when-cell');
    expect(start!.get('.when-big').classes()).toContain('is-live');
    expect(start!.get('.when-big').text()).toBe('6:30pm');
    expect(start!.get('.when-big').find('s').exists()).toBe(false);
    expect(start!.get('.when-was-line s.when-was').text()).toBe('5pm');
    expect(end!.get('.when-big').text()).toBe('12:40am');
    expect(end!.get('.when-was-line s.when-was').text()).toBe('11:10pm');
  });

  it('a moved DATE is struck on the date line, leaving an unchanged time alone', () => {
    const w = mount(SegmentWhenBand, {
      props: { band: BAND, was: { arrivalDate: '2026-12-13' } },
    });
    const [, end] = w.findAll('.when-cell');
    expect(end!.get('.when-big').classes()).not.toContain('is-live');
    expect(end!.get('.when-sub').classes()).toContain('is-live');
    expect(end!.get('.when-was-line s.when-was').text()).toBe('13 Dec');
  });

  it('a was-value equal to the live one (another spelling) is not struck', () => {
    const w = mount(SegmentWhenBand, {
      props: { band: BAND, was: { departureTime: '18:30:00' } },
    });
    expect(w.findAll('s')).toHaveLength(0);
  });
});
