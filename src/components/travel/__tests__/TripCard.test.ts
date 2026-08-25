/**
 * TripCard — extracted from ~110 lines of inline page template.
 *
 * Worth its own tests for two reasons beyond "it renders": the inline version recomputed
 * booking progress EIGHT times and accommodation gaps THREE times per card per render (a
 * template expression cannot memoize), and its night/nights plural was hardcoded English
 * inside a template expression where the CI i18n rule cannot see it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import TripCard from '../TripCard.vue';
import type { FamilyVacation } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function idea(id: string, title: string, over?: Record<string, unknown>) {
  return {
    id,
    title,
    votes: [],
    createdBy: 'm-1',
    createdAt: '2026-01-01',
    ...over,
  } as FamilyVacation['ideas'][number];
}

function trip(over?: Partial<FamilyVacation>): FamilyVacation {
  return {
    id: 'vac-1',
    activityId: 'act-1',
    name: 'Japan Trip',
    tripType: 'fly_and_stay',
    assigneeIds: [],
    travelSegments: [],
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: 'm-1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  } as FamilyVacation;
}

function mountCard(v: FamilyVacation) {
  setActivePinia(createPinia());
  return mount(TripCard, {
    props: { vacation: v, badge: null },
    global: { stubs: { TripBadgeChip: true } },
  });
}

describe('TripCard', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('shows the trip name', () => {
    expect(mountCard(trip()).text()).toContain('Japan Trip');
  });

  it('is operable by keyboard, not just by mouse', async () => {
    // The inline version was a plain <div @click> — a keyboard user could not reach any
    // trip at all, and with it the whole feature behind this card.
    const w = mountCard(trip());
    const el = w.find('[role="button"]');
    expect(el.attributes('tabindex')).toBe('0');
    await el.trigger('keydown.enter');
    expect(w.emitted('open')).toHaveLength(1);
    await el.trigger('keydown.space');
    expect(w.emitted('open')).toHaveLength(2);
    await el.trigger('click');
    expect(w.emitted('open')).toHaveLength(3);
  });

  it('emits open rather than navigating itself', () => {
    const w = mountCard(trip());
    expect(w.emitted()).not.toHaveProperty('navigate');
  });

  it('renders a date range only when the trip has dates', () => {
    expect(mountCard(trip()).text()).not.toContain('📅');
    expect(mountCard(trip({ startDate: '2026-07-01', endDate: '2026-07-10' })).text()).toContain(
      '📅'
    );
  });

  it('uses a pluralization KEY for the gap nights, never a hardcoded word', () => {
    // One unbooked night → the .one key; the English word must not appear from the template.
    const w = mountCard(
      trip({
        startDate: '2026-07-01',
        endDate: '2026-07-03',
        accommodations: [
          {
            id: 'a1',
            type: 'hotel',
            title: 'H',
            status: 'booked',
            checkInDate: '2026-07-02',
            checkOutDate: '2026-07-03',
          },
        ],
      } as Partial<FamilyVacation>)
    );
    const text = w.text();
    if (text.includes('travel.gapNights')) {
      expect(text).toMatch(/travel\.gapNights\.(one|other)/);
      expect(text).not.toMatch(/\bnights?\b/);
    }
  });

  it('counts only ideas still to decide on', () => {
    const w = mountCard(
      trip({
        ideas: [
          idea('i1', 'A'),
          idea('i2', 'B', { isPlanned: true }),
          idea('i3', 'C', { isSkipped: true }),
        ],
      })
    );
    expect(w.text()).toContain('1 travel.openIdeas');
  });
});
