/**
 * DealPileStage: the swipe it owns for both the deal pile and the Card Details drawer, and
 * the phone chip that carries the pile's count.
 *  - A touch swipe left / right emits `step(±1, 'swipe')`, exactly when the matching arrow
 *    could (`canNext` / `canPrev`); arrows emit `step(±1, 'arrow')`.
 *  - A mouse drag never steps (it selects text on a desktop), and no arrows means no swipe.
 *  - With `count`, the chip carries "{category} · n of total" for phones plus the plain
 *    category for md+; without it, one plain category.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { getResponsibilityCard } from '@/constants/responsibilityCards';
import { getListCategory } from '@/constants/listCategories';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import { swipe } from '@/test/pointerSwipe';

// The chip's key returns its real template, so the test sees it filled; the rest echo.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => (k === 'whoOwnsWhat.pile.positionChip' ? '{category} · {n} of {total}' : k),
  }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [], sortedHumans: [] }),
}));

import DealPileStage from '../DealPileStage.vue';

const LAUNDRY: ResolvedCard = {
  id: 'laundry',
  def: getResponsibilityCard('laundry'),
  isCustom: false,
  category: 'home',
  emoji: '🧺',
  status: 'unsorted',
  splitMode: 'single',
  parts: [{ key: 'main' }],
  state: null,
};

const HOME = getListCategory('home')!.labelKey;

let wrapper: VueWrapper | null = null;
function mountStage(props: Record<string, unknown> = {}) {
  wrapper = mount(DealPileStage, {
    props: { card: LAUNDRY, canPrev: true, canNext: true, ...props },
    attachTo: document.body,
  });
  return wrapper;
}
const LEFT = [
  { x: 200, y: 100 },
  { x: 60, y: 100 },
] as const;
const RIGHT = [
  { x: 60, y: 100 },
  { x: 200, y: 100 },
] as const;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('DealPileStage: swipe', () => {
  it('a touch swipe left steps forward, right steps back, marked as a swipe', () => {
    const w = mountStage();
    swipe(w.element as HTMLElement, ...LEFT);
    swipe(w.element as HTMLElement, ...RIGHT);
    expect(w.emitted('step')).toEqual([
      [1, 'swipe'],
      [-1, 'swipe'],
    ]);
  });

  it('the arrows emit the same step, marked as an arrow', async () => {
    const w = mountStage();
    await w.find('[data-testid="deal-pile-next"]').trigger('click');
    await w.find('[data-testid="deal-pile-prev"]').trigger('click');
    expect(w.emitted('step')).toEqual([
      [1, 'arrow'],
      [-1, 'arrow'],
    ]);
  });

  it('a swipe past an end does nothing (the same guards as the arrows)', () => {
    const w = mountStage({ canPrev: false, canNext: false });
    swipe(w.element as HTMLElement, ...LEFT);
    swipe(w.element as HTMLElement, ...RIGHT);
    expect(w.emitted('step')).toBeUndefined();
  });

  it('a mouse drag never steps', () => {
    const w = mountStage();
    swipe(w.element as HTMLElement, ...LEFT, 'mouse');
    expect(w.emitted('step')).toBeUndefined();
  });

  it('no arrows, no swipe', () => {
    const w = mountStage({ arrows: false });
    swipe(w.element as HTMLElement, ...LEFT);
    expect(w.emitted('step')).toBeUndefined();
  });
});

describe('DealPileStage: the count on the chip', () => {
  it('with a count: the phone chip reads the full key, and md+ keeps the plain category', () => {
    const w = mountStage({ count: { n: 1, total: 20 } });
    const chip = w.find('[data-testid="deal-pile-position-chip"]');
    expect(chip.exists()).toBe(true);
    expect(chip.classes()).toContain('md:hidden');
    expect(chip.text()).toBe(`${HOME} · 1 of 20`);
    expect(w.find('.cat-chip .hidden.md\\:inline').text()).toBe(HOME);
  });

  it('an unknown category reads Other on the chip too (one category source)', () => {
    const w = mountStage({
      card: { ...LAUNDRY, category: 'from-a-newer-client' },
      count: { n: 2, total: 5 },
    });
    expect(w.find('[data-testid="deal-pile-position-chip"]').text()).toBe(
      'lists.category.other · 2 of 5'
    );
  });

  it('without a count (a visited card, the drawer): one plain category, no phone chip', () => {
    const w = mountStage({ count: null });
    expect(w.find('[data-testid="deal-pile-position-chip"]').exists()).toBe(false);
    expect(w.find('.cat-chip').text()).toBe(HOME);
  });
});
