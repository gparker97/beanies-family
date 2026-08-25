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
          template: '<div><slot /><slot name="header-trailing" /></div>',
        },
        SegmentWhenBand: true,
        MemberChip: true,
        PhotoThumbnail: { template: '<div class="thumb" />' },
        ExpandableText: true,
        BeanieDatePicker: true,
        BeanieTimeInput: true,
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
});
