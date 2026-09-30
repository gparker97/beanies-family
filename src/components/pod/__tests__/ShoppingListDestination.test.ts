/**
 * Where a shopping checklist goes (#116): New List (name, who shops, by when) or Add to
 * a List the family already has. Switching modes and back keeps what was typed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ShoppingDestination } from '@/composables/useShoppingListCommit';

const h = vi.hoisted(() => ({
  destinations: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => (k === 'lists.progress' ? '{done}/{total}' : k) }),
}));
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({ getMemberName: (id: string, fallback: string) => id || fallback }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: { id: 'm1' } }),
}));
vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({
    get shoppingDestinations() {
      return h.destinations;
    },
  }),
}));

import ShoppingListDestination from '../ShoppingListDestination.vue';

function list(id: string, title: string) {
  return {
    id,
    title,
    emoji: '🛒',
    category: 'out',
    completed: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    items: [{ completed: true }, { completed: false }],
  };
}

function mounted(
  value: ShoppingDestination = { mode: 'new', title: '', ownerId: 'm1', dueDate: '' }
) {
  const w = mount(ShoppingListDestination, {
    props: {
      modelValue: value,
      defaultTitle: 'Shopping for 28 Sep',
      'onUpdate:modelValue': (v: ShoppingDestination) => w.setProps({ modelValue: v }),
    },
    global: {
      stubs: {
        FamilyChipPicker: {
          name: 'FamilyChipPicker',
          props: ['modelValue', 'mode', 'compact'],
          template: '<div />',
        },
        BeanieDatePicker: {
          name: 'BeanieDatePicker',
          props: ['modelValue', 'label', 'placeholder'],
          template: '<div />',
        },
      },
    },
  });
  return w;
}
const value = (w: ReturnType<typeof mounted>) => w.props('modelValue') as ShoppingDestination;

beforeEach(() => {
  h.destinations = [list('g1', 'Weekly Groceries'), list('g2', 'Costco Run')];
});

describe('ShoppingListDestination', () => {
  it('New List is pressed by default, and its name falls back to the default title', () => {
    const w = mounted();
    expect(w.find('[data-testid="destination-new"]').attributes('aria-pressed')).toBe('true');
    expect(w.find('[data-testid="destination-existing"]').attributes('aria-pressed')).toBe('false');
    expect(w.find('input').attributes('placeholder')).toBe('Shopping for 28 Sep');
  });

  it('edits the name, the owner and the due date', async () => {
    const w = mounted();
    await w.find('input').setValue('Big shop');
    await w.findComponent({ name: 'FamilyChipPicker' }).vm.$emit('update:modelValue', 'm2');
    await w.findComponent({ name: 'BeanieDatePicker' }).vm.$emit('update:modelValue', '2026-10-01');
    expect(value(w)).toEqual({
      mode: 'new',
      title: 'Big shop',
      ownerId: 'm2',
      dueDate: '2026-10-01',
    });
  });

  it('says what the due date does, naming the owner, only once one is set', async () => {
    const w = mounted();
    expect(w.find('[data-testid="inferred-hint"]').exists()).toBe(false);
    await w.findComponent({ name: 'BeanieDatePicker' }).vm.$emit('update:modelValue', '2026-10-01');
    expect(w.find('[data-testid="inferred-hint"]').text()).toBe('lists.fromRecipe.dueHint');
  });

  it('Add to a List picks the first list, and any row can be chosen', async () => {
    const w = mounted();
    await w.find('[data-testid="destination-existing"]').trigger('click');
    expect(value(w)).toEqual({ mode: 'existing', listId: 'g1' });
    const rows = w.findAllComponents({ name: 'ListChoiceRow' });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.attributes('aria-pressed')).toBe('true');
    await rows[1]!.trigger('click');
    expect(value(w)).toEqual({ mode: 'existing', listId: 'g2' });
    // A pick, not an "open": no Open list affordance on these rows.
    expect(w.text()).not.toContain('lists.embed.open');
  });

  it('switching back to New List keeps what was typed, and back again keeps the pick', async () => {
    const w = mounted();
    await w.find('input').setValue('Big shop');
    await w.find('[data-testid="destination-existing"]').trigger('click');
    await w.findAllComponents({ name: 'ListChoiceRow' })[1]!.trigger('click');
    await w.find('[data-testid="destination-new"]').trigger('click');
    expect(value(w)).toMatchObject({ mode: 'new', title: 'Big shop' });
    await w.find('[data-testid="destination-existing"]').trigger('click');
    expect(value(w)).toEqual({ mode: 'existing', listId: 'g2' });
  });

  it('with no lists, Add to a List is disabled and says why', async () => {
    h.destinations = [];
    const w = mounted();
    const btn = w.find('[data-testid="destination-existing"]');
    expect(btn.attributes('disabled')).toBeDefined();
    const hint = w.find('[data-testid="destination-none"]');
    expect(hint.text()).toBe('lists.destination.noLists');
    expect(btn.attributes('aria-describedby')).toBe(hint.attributes('id'));
    await btn.trigger('click');
    expect(value(w).mode).toBe('new');
  });
});
