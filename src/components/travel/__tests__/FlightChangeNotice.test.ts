/**
 * FlightChangeNotice (#143): the three variants and their actions. Uses the REAL English
 * strings so the sentences read as the family will see them.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import FlightChangeNotice from '../FlightChangeNotice.vue';
import type { FlightVerification } from '@/types/flightStatus';
import type { FlightRef } from '@/composables/useVacationTimeline';
import { UI_STRINGS } from '@/services/translation/uiStrings';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => (UI_STRINGS as Record<string, string>)[k] ?? k,
    currentLanguage: { value: 'en' },
  }),
}));

const NOW = Date.parse('2026-12-13T08:00:00Z');

const SEG: FlightRef = {
  label: 'SQ318',
  airline: 'Singapore Airlines (SQ)',
  flightNumber: '318',
  bookingReference: '7KQ2PZ',
  departureDate: '2026-12-13',
  liveAppliedAt: '2026-12-13T07:50:00.000Z',
};

function mountNotice(verification: FlightVerification, segment: FlightRef = SEG) {
  return mount(FlightChangeNotice, { props: { verification, segment, nowMs: NOW } });
}

describe('FlightChangeNotice', () => {
  it('changed: says what moved, what it was, and offers one quiet "Put it back"', async () => {
    const w = mountNotice({
      state: 'changed',
      checkedAt: NOW - 4 * 60_000,
      mine: { departureDate: '2026-12-13', departureTime: '18:30', terminal: '3' },
      was: { departureTime: '17:00', terminal: '2' },
    });
    const text = w.text();
    expect(text).toContain(
      'SQ318 now leaves at 6:30pm from Terminal 3. Your plan has been updated.'
    );
    expect(text).toContain(
      'Was 5pm from Terminal 2. Changed by Singapore Airlines · checked 4 min ago.'
    );
    expect(w.get('[data-state="changed"]').classes()).toEqual(
      expect.arrayContaining([
        'border-primary-500',
        'dark:border-accent-lift',
        'bg-[var(--tint-orange-8)]',
      ])
    );
    expect(w.find('[data-testid="flight-use-airline"]').exists()).toBe(false);
    await w.get('[data-testid="flight-put-back"]').trigger('click');
    expect(w.emitted('revert')).toHaveLength(1);
    expect(w.emitted('take-airline')).toBeUndefined();
  });

  it('changed but not yet in the plan on this device: says so, and offers no buttons', () => {
    const w = mountNotice({
      state: 'changed',
      applied: false,
      checkedAt: NOW - 4 * 60_000,
      mine: { departureDate: '2026-12-13', departureTime: '17:00', terminal: '2' },
      was: { departureTime: '17:00', terminal: '2' },
      provider: { departureDate: '2026-12-13', departureTime: '18:30', terminal: '3' },
    });
    const text = w.text();
    expect(text).toContain('SQ318 now leaves at 6:30pm from Terminal 3.');
    expect(text).not.toContain('Your plan has been updated.');
    expect(w.get('[data-testid="flight-not-written"]').text()).toBe(
      "Your plan hasn't been updated on this device yet."
    );
    expect(text).not.toContain('Changed by');
    expect(w.find('[data-testid="flight-put-back"]').exists()).toBe(false);
    expect(w.find('[data-testid="flight-use-airline"]').exists()).toBe(false);
  });

  it('an applied change carries no not-updated line', () => {
    const w = mountNotice({
      state: 'changed',
      applied: true,
      mine: { departureTime: '18:30' },
      was: { departureTime: '17:00' },
    });
    expect(w.find('[data-testid="flight-not-written"]').exists()).toBe(false);
  });

  it('changed on a device with no check of its own still says when, from the applied time', () => {
    const w = mountNotice({
      state: 'changed',
      mine: { departureTime: '18:30' },
      was: { departureTime: '17:00' },
    });
    expect(w.text()).toContain('checked 10 min ago');
  });

  it('conflict: both values side by side, and "Use the airline\'s"', async () => {
    const w = mountNotice({
      state: 'conflict',
      checkedAt: NOW,
      mine: { departureDate: '2026-11-09', departureTime: '17:00', terminal: '2' },
      provider: { departureDate: '2026-11-09', departureTime: '18:30', terminal: '3' },
    });
    expect(w.text()).toContain(
      'Your plan says 5pm from Terminal 2 on 9 Nov. Singapore Airlines says 6:30pm from Terminal 3.'
    );
    expect(w.find('[data-testid="flight-put-back"]').exists()).toBe(false);
    await w.get('[data-testid="flight-use-airline"]').trigger('click');
    expect(w.emitted('take-airline')).toHaveLength(1);
    expect(w.emitted('revert')).toBeUndefined();
  });

  it('conflict after a re-booking the airline still lists as cancelled', () => {
    const w = mountNotice({
      state: 'conflict',
      checkedAt: NOW,
      live: { status: 'Canceled' },
      mine: { departureTime: '17:00' },
      provider: { departureTime: '17:00' },
    });
    expect(w.text()).toContain(
      'Singapore Airlines lists SQ318 as cancelled. Your plan still has it booked.'
    );
    expect(w.find('[data-testid="flight-use-airline"]').exists()).toBe(true);
  });

  it('cancelled: the red variant, the booking still here, and no decision to make', () => {
    const w = mountNotice({ state: 'cancelled', checkedAt: NOW - 4 * 60_000 });
    const text = w.text();
    expect(text).toContain('Singapore Airlines cancelled SQ318 on');
    expect(text).toContain('This flight is now pending.');
    expect(text).toContain('Your booking 7KQ2PZ is still here for when you call.');
    expect(w.get('[data-state="cancelled"]').classes()).toEqual(
      expect.arrayContaining([
        'border-red-500',
        'dark:border-danger-lift',
        'bg-[var(--tint-danger-10)]',
      ])
    );
    // Only "Got it" (the dismissal); nothing to put back or take.
    expect(w.findAll('button').map((b) => b.attributes('data-testid'))).toEqual(['flight-got-it']);
  });

  it('cancelled with no booking reference drops that sentence', () => {
    const w = mountNotice({ state: 'cancelled' }, { ...SEG, bookingReference: undefined });
    expect(w.text()).not.toContain('Your booking');
  });

  it('renders nothing for verified, unavailable or not-live', () => {
    for (const state of ['verified', 'unavailable', 'not-live'] as const) {
      expect(mountNotice({ state }).html()).not.toContain('<p');
    }
  });

  it('"Got it" folds every notice away on this device: an applied change, an unwritten change and a Conflict (beside its action)', async () => {
    const applied = mountNotice({
      state: 'changed',
      mine: { departureTime: '18:30' },
      was: { departureTime: '17:00' },
    });
    await applied.get('[data-testid="flight-got-it"]').trigger('click');
    expect(applied.emitted('dismiss')).toHaveLength(1);
    expect(applied.emitted('revert')).toBeUndefined();

    const unwritten = mountNotice({
      state: 'changed',
      applied: false,
      mine: { departureTime: '17:00' },
      was: { departureTime: '17:00' },
      provider: { departureTime: '18:30' },
    });
    expect(unwritten.find('[data-testid="flight-got-it"]').exists()).toBe(true);

    const conflict = mountNotice({
      state: 'conflict',
      mine: { departureTime: '17:00' },
      provider: { departureTime: '18:30' },
    });
    expect(conflict.find('[data-testid="flight-got-it"]').exists()).toBe(true);
    expect(conflict.find('[data-testid="flight-use-airline"]').exists()).toBe(true);
    await conflict.get('[data-testid="flight-got-it"]').trigger('click');
    expect(conflict.emitted('dismiss')).toHaveLength(1);
    expect(conflict.emitted('take-airline')).toBeUndefined();
  });

  it('a recorded cancellation offers "Got it" (and nothing else); one not yet recorded offers it too', async () => {
    const recorded = mountNotice({ state: 'cancelled', applied: true });
    expect(recorded.find('[data-testid="flight-put-back"]').exists()).toBe(false);
    await recorded.get('[data-testid="flight-got-it"]').trigger('click');
    expect(recorded.emitted('dismiss')).toHaveLength(1);
    expect(
      mountNotice({ state: 'cancelled', applied: false })
        .find('[data-testid="flight-got-it"]')
        .exists()
    ).toBe(true);
  });
});
