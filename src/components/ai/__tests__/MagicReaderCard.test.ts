/**
 * The FAB quick-add card is now ONLY a gradient card and its button.
 *
 * It used to own the capture protocol — the sheet, the picker, consent, the busy guard, the
 * funnel denominator — and this file tested all of it. That protocol moved to
 * `MagicBeansDoor`, which every door mounts, and `MagicBeansDoor.test.ts` covers it: the
 * close-before-ingest ordering, the grant threading, the picked-file path, the stranded-grant
 * TTL. Keeping copies of those assertions here would test the door twice and the card not at
 * all — and would quietly re-assert that the card still owns behaviour it deliberately gave up.
 *
 * What is left is the card's own job, and one guarantee that is easy to lose in a refactor:
 * the trigger lives INSIDE the door's slot, so the permission gate removes the button and its
 * tap together rather than leaving a control whose handler does nothing.
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import MagicReaderCard from '@/components/ai/MagicReaderCard.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const open = vi.fn();

/** Stands in for the door: renders the trigger slot and hands it an `open`. */
const MagicBeansDoorStub = {
  name: 'MagicBeansDoor',
  props: ['claim'],
  template: '<div data-test="door"><slot name="trigger" :open="open" /></div>',
  setup: () => ({ open }),
};

const mountCard = () =>
  mount(MagicReaderCard, { global: { stubs: { MagicBeansDoor: MagicBeansDoorStub } } });

describe('MagicReaderCard', () => {
  it('renders its button inside the door, not beside it', () => {
    // Inside the slot, the gate removes the affordance and its tap together. Outside it, a
    // gated-off door leaves a visible button whose `open()` optional-chains into nothing —
    // a dead tap with no toast and no log.
    const w = mountCard();
    const door = w.find('[data-test="door"]');
    expect(door.exists()).toBe(true);
    expect(door.find('button').exists()).toBe(true);
  });

  it('opens the door when tapped, and owns nothing else', async () => {
    const w = mountCard();
    await w.find('button').trigger('click');

    // No ingest, no picker, no consent here: the card asks the door to open and stops.
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('passes no `claim`, so a capture routes by kind like every other door', () => {
    // Only the recipe form claims its payload. A card that quietly claimed one would keep a
    // travel booking on the dashboard instead of routing it to the trip that owns it.
    const w = mountCard();
    expect(w.findComponent({ name: 'MagicBeansDoor' }).props('claim')).toBeUndefined();
  });

  it('still carries the feature name and its beta badge', () => {
    const w = mountCard();
    expect(w.text()).toContain('ai.magic.title');
    expect(w.findComponent({ name: 'BetaBadge' }).exists()).toBe(true);
  });
});
