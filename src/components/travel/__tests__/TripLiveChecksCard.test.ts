/**
 * TripLiveChecksCard "Check now" (#143): the link emits the tap, and reads "Checking..." and
 * is disabled while a request for one of the trip's flights is in flight.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import TripLiveChecksCard from '../TripLiveChecksCard.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const ROWS = [
  {
    id: 'seg-1',
    label: 'SQ318',
    departureDate: '2026-12-13',
    verification: { state: 'verified' as const, checkedAt: 1 },
  },
];

describe('TripLiveChecksCard', () => {
  it('"Check now" emits check-now', async () => {
    const w = mount(TripLiveChecksCard, { props: { rows: ROWS, nowMs: 2 } });
    const link = w.get('[data-testid="live-check-now"]');
    expect(link.text()).toBe('travel.live.checkNow');
    await link.trigger('click');
    expect(w.emitted('check-now')).toHaveLength(1);
  });

  it('reads "Checking..." and takes no tap while a check is in flight', async () => {
    const w = mount(TripLiveChecksCard, { props: { rows: ROWS, nowMs: 2, checking: true } });
    const link = w.get('[data-testid="live-check-now"]');
    expect(link.text()).toBe('travel.live.checking');
    expect(link.attributes('disabled')).toBeDefined();
    await link.trigger('click');
    expect(w.emitted('check-now')).toBeUndefined();
  });

  it("links a row's flight label to its trackUrl, and keeps it plain without one", () => {
    const href = 'https://www.flightaware.com/live/flight/SQ319';
    const w = mount(TripLiveChecksCard, {
      props: {
        rows: [ROWS[0]!, { ...ROWS[0]!, id: 'seg-2', label: 'SQ319', trackUrl: href }],
        nowMs: 2,
      },
    });
    const rows = w.findAll('[data-testid="live-check-row"]');
    expect(rows[0]!.find('[data-testid="flight-track-link"]').exists()).toBe(false);
    expect(rows[0]!.text()).toContain('SQ318');
    expect(rows[1]!.get('[data-testid="flight-track-link"]').attributes('href')).toBe(href);
  });
});
