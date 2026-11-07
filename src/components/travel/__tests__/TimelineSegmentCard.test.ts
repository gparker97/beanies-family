/**
 * TimelineSegmentCard — the card the page used to render TWICE.
 *
 * The second copy, used for "still deciding" (undated) bookings, was a 42-line subset that
 * silently lacked the attachments strip, inline date/time editing, copyable booking
 * references, expandable notes and outbound links. A flight with no date yet could not have
 * its confirmation number copied or its documents seen, with nothing indicating why.
 *
 * These tests exist mainly to hold that unification: an undated item must render the same
 * affordances as a dated one, minus only the parts that are genuinely date-specific.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import TimelineSegmentCard from '../TimelineSegmentCard.vue';
import type { TimelineItem } from '@/composables/useVacationTimeline';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({ getMemberName: (id: string) => `name:${id}` }),
}));

function item(over?: Partial<TimelineItem>): TimelineItem {
  return {
    id: 'seg-1',
    kind: 'travel',
    icon: '✈️',
    title: 'BA123 to Tokyo',
    keyValue: 'BA123',
    status: 'booked',
    sortDate: '2026-07-01',
    sortTime: '07:15',
    stepNumber: 2,
    detailRows: [],
    arrayIndex: 0,
    travellers: [],
    showTravellers: false,
    ...over,
  } as TimelineItem;
}

function mountCard(over?: Partial<TimelineItem>, props?: Record<string, unknown>) {
  setActivePinia(createPinia());
  return mount(TimelineSegmentCard, {
    props: { item: item(over), collapsed: false, readOnly: false, ...props },
    global: {
      stubs: {
        VacationSegmentCard: {
          name: 'VacationSegmentCard',
          emits: ['edit', 'delete', 'update:title', 'update:collapsed'],
          template:
            '<div><slot name="header-trailing" /><slot name="header-below" /><slot /></div>',
        },
        SegmentWhenBand: true,
        MemberChip: true,
        PhotoThumbnail: { template: '<div class="thumb" />' },
        ExpandableText: true,
        BeanieDatePicker: true,
        BeanieTimePicker: true,
        FlightCheckChip: {
          name: 'FlightCheckChip',
          props: ['verification', 'nowMs', 'compact', 'reveals'],
          emits: ['click'],
          template: '<span class="chip" :data-reveals="reveals" @click="$emit(\'click\')" />',
        },
        FlightChangeNotice: {
          name: 'FlightChangeNotice',
          props: ['verification', 'segment', 'nowMs'],
          emits: ['revert', 'take-airline', 'dismiss'],
          template: '<div class="notice" />',
        },
      },
    },
  });
}

describe('TimelineSegmentCard', () => {
  it('renders attachments for an UNDATED booking, which the old subset could not', () => {
    // The gap this unification closes: `timing` is absent on undated items, and the old
    // undated copy simply had no attachments markup at all.
    const w = mountCard({ timing: undefined, photoIds: ['p1', 'p2'] });
    expect(w.findAll('.thumb')).toHaveLength(2);
  });

  it('renders attachments for a dated booking too', () => {
    const w = mountCard({ photoIds: ['p1'] });
    expect(w.findAll('.thumb')).toHaveLength(1);
  });

  it('shows no attachment strip when there are no documents', () => {
    expect(mountCard({ photoIds: [] }).findAll('.thumb')).toHaveLength(0);
  });

  it('forwards edit and delete upward instead of acting on them', async () => {
    // The presentational contract: the page keeps permission checks, persistence and toasts.
    const w = mountCard();
    const inner = w.findComponent({ name: 'VacationSegmentCard' });
    inner.vm.$emit('edit');
    inner.vm.$emit('delete');
    await w.vm.$nextTick();
    expect(w.emitted('edit')).toBeTruthy();
    expect(w.emitted('delete')).toBeTruthy();
    expect(w.emitted('edit')![0]![0]).toMatchObject({ id: 'seg-1' });
  });

  // ── Live flight checks (#143) ────────────────────────────────────────────────
  const FLIGHT = { label: 'SQ318', airline: 'Singapore Airlines (SQ)', flightNumber: '318' };

  it('a phone gets the chip on its own header line; the row carries it from sm: up', () => {
    const w = mountCard(
      { flight: FLIGHT },
      { verification: { state: 'verified', checkedAt: 1 }, nowMs: 2 }
    );
    const chips = w.findAllComponents({ name: 'FlightCheckChip' });
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.element.parentElement!.className)).toEqual([
      expect.stringContaining('sm:inline-flex'),
      expect.stringContaining('sm:hidden'),
    ]);
  });

  it('a flight shows its chip in the header always, expanded or collapsed', () => {
    const v = { state: 'verified' as const, checkedAt: 1 };
    expect(
      mountCard({ flight: FLIGHT }, { verification: v, nowMs: 2 }).find('.chip').exists()
    ).toBe(true);
    expect(
      mountCard({ flight: FLIGHT }, { verification: v, nowMs: 2, collapsed: true })
        .find('.chip')
        .exists()
    ).toBe(true);
  });

  it('a flight that is over shows no chip (nothing left to check)', () => {
    const w = mountCard(
      { flight: FLIGHT },
      { verification: { state: 'unavailable', reason: 'past' }, nowMs: 2 }
    );
    expect(w.findAllComponents({ name: 'FlightCheckChip' })).toHaveLength(0);
  });

  it('a non-flight never gets a chip, even with a not-live verification', () => {
    const w = mountCard(
      { kind: 'travel', segmentType: 'train' },
      { verification: { state: 'not-live' }, nowMs: 2 }
    );
    expect(w.find('.chip').exists()).toBe(false);
    expect(w.text()).toContain('travel.live.notLiveFoot.train');
  });

  it('the foot line covers trains, ferries, cruises and buses only', () => {
    expect(mountCard({ kind: 'transportation', segmentType: 'bus' }).text()).toContain(
      'travel.live.notLiveFoot.bus'
    );
    expect(mountCard({ kind: 'travel', segmentType: 'flight_outbound' }).text()).not.toContain(
      'notLiveFoot'
    );
    expect(mountCard({ kind: 'accommodation', segmentType: 'hotel' }).text()).not.toContain(
      'notLiveFoot'
    );
  });

  it('shows the notice for changed / conflict / cancelled only, and re-emits its actions', async () => {
    const changed = mountCard(
      { flight: FLIGHT },
      { verification: { state: 'changed', was: { departureTime: '17:00' } }, nowMs: 2 }
    );
    const notice = changed.findComponent({ name: 'FlightChangeNotice' });
    expect(notice.exists()).toBe(true);
    notice.vm.$emit('revert');
    notice.vm.$emit('take-airline');
    await changed.vm.$nextTick();
    expect(changed.emitted('revert')![0]![0]).toMatchObject({ id: 'seg-1' });
    expect(changed.emitted('take-airline')![0]![0]).toMatchObject({ id: 'seg-1' });

    for (const state of ['verified', 'unavailable'] as const) {
      expect(
        mountCard({ flight: FLIGHT }, { verification: { state }, nowMs: 2 })
          .findComponent({ name: 'FlightChangeNotice' })
          .exists()
      ).toBe(false);
    }
  });

  it('draws the "live" pill on a live row', () => {
    const w = mountCard({
      detailRows: [{ label: 'travel.live.row.gate', value: 'C21', live: true }],
    });
    expect(w.text()).toContain('travel.live.pill');
  });

  it('"Got it" re-emits as dismiss-notice; a dismissed notice is folded and the chip reopens it', async () => {
    const shown = mountCard(
      { flight: FLIGHT },
      { verification: { state: 'changed', was: { departureTime: '17:00' } }, nowMs: 2 }
    );
    shown.findComponent({ name: 'FlightChangeNotice' }).vm.$emit('dismiss');
    await shown.vm.$nextTick();
    expect(shown.emitted('dismiss-notice')![0]![0]).toMatchObject({ id: 'seg-1' });
    expect(shown.find('.chip').attributes('data-reveals')).toBe('false');

    const folded = mountCard(
      { flight: FLIGHT },
      {
        verification: { state: 'changed', dismissed: true, was: { departureTime: '17:00' } },
        nowMs: 2,
      }
    );
    expect(folded.findComponent({ name: 'FlightChangeNotice' }).exists()).toBe(false);
    const chips = folded.findAll('.chip');
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0]!.attributes('data-reveals')).toBe('true');
    await chips[0]!.trigger('click');
    expect(folded.emitted('show-notice')![0]![0]).toMatchObject({ id: 'seg-1' });
  });
});
