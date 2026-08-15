/**
 * The clash indicator's job on a calendar grid is to SIGNAL, not to explain.
 *
 * It previously rendered the clashing calendar's name in a tinted pill, which on a
 * narrow mobile week column took most of the title row and truncated the event
 * title to "Softball ba…". These tests pin the rule that replaced it: the mark
 * appears on the grid, the name lives in the drawer.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import ClashIndicator from '../ClashIndicator.vue';
import type { ResolvedClash } from '@/composables/useClash';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    isBeanieMode: { value: false },
    isEnglish: { value: true },
  }),
}));

const CALENDAR = 'gregsophia@gmail.com';

function makeClash(overrides?: Partial<ResolvedClash>): ResolvedClash {
  return {
    calendarLabel: CALENDAR,
    acknowledged: false,
    ...overrides,
  } as ResolvedClash;
}

describe('ClashIndicator', () => {
  it('renders nothing when there is no clash (self-gating)', () => {
    const wrapper = mount(ClashIndicator, { props: { clash: undefined } });
    expect(wrapper.find('[role="img"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });

  // These two pass `variant: 'chip'` ON PURPOSE. That is exactly what the four
  // grid call sites used to send, and it is the ONLY input that produced the
  // labelled pill — asserting against the default variant would pass on the
  // pre-fix component too, proving nothing (docs/lessons.md rule 4). `variant`
  // is no longer a declared prop, so it now falls through as an inert attribute.
  it('REGRESSION: never renders the calendar name, even when asked for a chip', () => {
    // The name is what crowded the title out. It belongs in the drawer, which
    // shows it in full with the "This is OK" / "Reschedule…" actions attached.
    const wrapper = mount(ClashIndicator, {
      props: { clash: makeClash(), variant: 'chip' },
    });
    expect(wrapper.text()).not.toContain(CALENDAR);
    expect(wrapper.text()).not.toContain('gregsophia');
    // ...and not a truncated version either — a name compressed to "greg…" costs
    // nearly the same title space and communicates nothing.
    expect(wrapper.text().trim()).toBe('');
  });

  it('REGRESSION: renders no tinted pill background, even when asked for a chip', () => {
    // The pill stacked a third emphasis device on top of the mark and the
    // semibold label, which is why an accent-coloured badge out-shouted the
    // dark-slate title it sat beside.
    const wrapper = mount(ClashIndicator, {
      props: { clash: makeClash(), variant: 'chip' },
    });
    expect(wrapper.html()).not.toContain('rounded-full');
    expect(wrapper.html()).not.toContain('bg-primary-500/15');
  });

  it('renders the overlap mark for an active clash', () => {
    const wrapper = mount(ClashIndicator, { props: { clash: makeClash() } });
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.find('[role="img"]').exists()).toBe(true);
  });

  it('keeps the full sentence available to screen readers and hover', () => {
    // Losing the visible label must not lose the information — this is the leg
    // that keeps the mark discoverable on desktop and accessible everywhere.
    const wrapper = mount(ClashIndicator, { props: { clash: makeClash() } });
    const marker = wrapper.find('[role="img"]');
    expect(marker.attributes('aria-label')).toContain(CALENDAR);
    expect(marker.attributes('title')).toContain(CALENDAR);
  });

  it('fades an acknowledged clash so the two states stay distinguishable', () => {
    // Once both states are the same SHAPE, opacity carries the whole distinction.
    const active = mount(ClashIndicator, { props: { clash: makeClash() } });
    const quiet = mount(ClashIndicator, {
      props: { clash: makeClash({ acknowledged: true }) },
    });
    expect(active.html()).not.toContain('opacity-40');
    expect(quiet.html()).toContain('opacity-40');
  });

  it('does not shrink — a 12px glyph must not be squashed by a long title', () => {
    const wrapper = mount(ClashIndicator, { props: { clash: makeClash() } });
    expect(wrapper.find('[role="img"]').classes()).toContain('flex-shrink-0');
  });
});
