/**
 * SegmentWhenBand `was` (#143): an airline-changed value renders as the live value (orange,
 * `.is-live`) with the replaced one struck beside it, on the line where it lives.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import SegmentWhenBand from '../SegmentWhenBand.vue';
import type { WhenBand } from '@/utils/vacation';

// Keys echo back, except the templates the place line fills (so the test reads its output).
const EN = new Map([
  ['travel.band.from', 'from {code}'],
  ['travel.band.at', 'at {code}'],
  ['flightChecks.terminal', 'Terminal {terminal}'],
]);
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => EN.get(k) ?? k }),
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

  describe("the place line (a flight's airports and terminals)", () => {
    const PLACED: WhenBand = {
      start: { ...BAND.start, place: { code: 'SIN', terminal: '3' } },
      end: { ...BAND.end!, place: { code: 'LHR', terminal: 'T2' } },
    };

    it('shows each airport with its own terminal under its cell', () => {
      const w = mount(SegmentWhenBand, { props: { band: PLACED } });
      const [start, end] = w.findAll('.when-cell');
      expect(start!.get('.when-place-cap').text()).toBe('from SIN');
      expect(start!.get('.when-place-term').text()).toBe('Terminal 3');
      expect(end!.get('.when-place-cap').text()).toBe('at LHR');
      expect(end!.get('.when-place-term').text()).toBe('Terminal 2');
      expect(w.findAll('.when-place-unknown')).toHaveLength(0);
    });

    it('a named terminal is shown as written', () => {
      const w = mount(SegmentWhenBand, {
        props: {
          band: { ...PLACED, end: { ...PLACED.end!, place: { code: 'LAX', terminal: 'TBIT' } } },
        },
      });
      expect(w.findAll('.when-place-term')[1]!.text()).toBe('TBIT');
    });

    it('the side with no terminal says it is not known yet', () => {
      const w = mount(SegmentWhenBand, {
        props: { band: { ...PLACED, end: { ...PLACED.end!, place: { code: 'LHR' } } } },
      });
      const end = w.findAll('.when-cell')[1]!;
      expect(end.get('.when-place-cap').text()).toBe('at LHR');
      expect(end.find('.when-place-term').exists()).toBe(false);
      expect(end.get('.when-place-unknown').text()).toBe('travel.band.terminalUnknown');
    });

    it('with no airport code, the terminal stands alone under its cell', () => {
      const w = mount(SegmentWhenBand, {
        props: { band: { ...PLACED, start: { ...PLACED.start, place: { terminal: '3' } } } },
      });
      const start = w.findAll('.when-cell')[0]!;
      expect(start.find('.when-place-cap').exists()).toBe(false);
      expect(start.get('.when-place-term').text()).toBe('Terminal 3');
    });

    it('no place on the band (neither terminal known, or not a flight): no place line', () => {
      expect(
        mount(SegmentWhenBand, { props: { band: BAND } })
          .find('.when-place')
          .exists()
      ).toBe(false);
    });

    it("each terminal carries its own side's check", () => {
      const w = mount(SegmentWhenBand, {
        props: { band: PLACED, checks: { startPlace: 'confirmed', endPlace: 'changed' } },
      });
      const [start, end] = w.findAll('.when-cell');
      expect(start!.get('.when-place-term .live-pill').attributes('data-status')).toBe('confirmed');
      expect(end!.get('.when-place-term .live-pill').attributes('data-status')).toBe('changed');
      // the date lines carry nothing: their own checks were not given
      expect(w.findAll('.when-sub .live-pill')).toHaveLength(0);
    });

    it('strikes a moved terminal on its own line under the live one', () => {
      const w = mount(SegmentWhenBand, {
        props: { band: PLACED, was: { arrivalTerminal: '5' } },
      });
      const [start, end] = w.findAll('.when-cell');
      expect(end!.get('.when-place-term').classes()).toContain('is-live');
      expect(end!.get('.when-place .when-was-line s.when-was').text()).toBe('Terminal 5');
      expect(start!.find('.when-place .when-was').exists()).toBe(false);
      expect(end!.get('.when-big').classes()).not.toContain('is-live');
    });

    it('a was-terminal equal to the live one in another spelling is not struck', () => {
      const w = mount(SegmentWhenBand, {
        props: { band: PLACED, was: { terminal: 'Terminal 3', arrivalTerminal: '2' } },
      });
      expect(w.findAll('s')).toHaveLength(0);
      expect(w.findAll('.is-live')).toHaveLength(0);
    });
  });

  it('a single-cell band renders one cell and no arrow, as before', () => {
    const w = mount(SegmentWhenBand, { props: { band: { start: BAND.start } } });
    expect(w.findAll('.when-cell')).toHaveLength(1);
    expect(w.find('.when-arrow').exists()).toBe(false);
    expect(w.get('.when-band').classes()).toContain('when-band--single');
  });

  it('two cells keep the arrow between them and the "+1 day" mark on the arrival', () => {
    const w = mount(SegmentWhenBand, { props: { band: BAND } });
    expect(w.get('.when-band').element.children).toHaveLength(3);
    expect(w.get('.when-band').element.children[1]!.classList).toContain('when-arrow');
    const [start, end] = w.findAll('.when-cell');
    expect(start!.find('.when-nextday').exists()).toBe(false);
    expect(end!.get('.when-nextday').text()).toBe('travel.timeline.nextDay');
  });
});
