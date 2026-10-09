/**
 * The card a card-made to-do links back to (#123). What it must guarantee:
 *   - it resolves only through `responsibilityStore.cardById` and renders nothing on a miss,
 *   - the chip reads "{emoji} {card}" and adds ", {part}" for a split card's part,
 *   - the row adds "Held by {name}" for the part's holder,
 *   - a tap opens the card in Who Owns What and emits `open` so a host drawer can close.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import LinkedCardChip from '../LinkedCardChip.vue';

const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const cards = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/stores/responsibilityStore', () => ({
  useResponsibilityStore: () => ({ cardById: (id: string) => cards.get(id) }),
}));
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberName: (id: string, fallback = 'Unknown') =>
      new Map([
        ['m-sofia', 'Sofia'],
        ['m-dan', 'Dan'],
      ]).get(id) ?? fallback,
  }),
}));

function seedCards(): void {
  cards.set('trash', {
    id: 'trash',
    custom: { name: 'Trash Night', emoji: '🗑️' },
    splitMode: 'single',
    parts: [{ key: 'main', holderId: 'm-sofia' }],
    state: null,
  });
  cards.set('drop', {
    id: 'drop',
    custom: { name: 'School Drop-off', emoji: '🎒' },
    splitMode: 'label',
    parts: [
      { key: 'label-a', label: 'Mornings', holderId: 'm-dan' },
      { key: 'label-b', label: 'Afternoons' },
    ],
    state: null,
  });
}

describe('LinkedCardChip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    cards.clear();
    push.mockClear();
  });

  it('renders nothing when the card no longer resolves (soft reference)', () => {
    const w = mount(LinkedCardChip, { props: { cardId: 'gone' } });
    expect(w.find('button').exists()).toBe(false);
  });

  it('chip: the card emoji and name, and a tap opens the card and emits open', async () => {
    seedCards();
    const w = mount(LinkedCardChip, { props: { cardId: 'trash', partKey: 'main' } });
    expect(w.text()).toContain('🗑️');
    expect(w.text()).toContain('Trash Night');

    await w.find('button').trigger('click');
    expect(push).toHaveBeenCalledWith({ path: '/who-owns-what', query: { card: 'trash' } });
    expect(w.emitted('open')).toEqual([['trash']]);
  });

  it('chip: a split part is named after a comma', () => {
    seedCards();
    const w = mount(LinkedCardChip, { props: { cardId: 'drop', partKey: 'label-a' } });
    expect(w.text()).toContain('School Drop-off, Mornings');
  });

  it('row: names the part in the title and says who holds it', () => {
    seedCards();
    const w = mount(LinkedCardChip, {
      props: { cardId: 'drop', partKey: 'label-a', variant: 'row' },
    });
    expect(w.find('[data-testid="linked-item-row"]').exists()).toBe(true);
    expect(w.text()).toContain('School Drop-off, Mornings');
    expect(w.text()).toMatch(/held by Dan/i);
  });

  it('row: a part nobody holds shows no holder line', () => {
    seedCards();
    const w = mount(LinkedCardChip, {
      props: { cardId: 'drop', partKey: 'label-b', variant: 'row' },
    });
    expect(w.text()).not.toMatch(/held by/i);
  });
});
