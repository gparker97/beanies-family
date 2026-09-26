import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import OverflowMenu, { type OverflowMenuItem } from '../OverflowMenu.vue';

// `t` is a passthrough so assertions are deterministic regardless of language.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ITEMS: OverflowMenuItem[] = [
  { id: 'export', labelKey: 'action.copy', icon: '⬇' },
  {
    id: 'restore',
    labelKey: 'action.delete',
    icon: '↺',
    tone: 'danger',
    disabled: true,
    disabledReasonKey: 'action.close',
  },
];

const mounted: VueWrapper[] = [];

function factory() {
  const wrapper = mount(OverflowMenu, { props: { items: ITEMS }, attachTo: document.body });
  mounted.push(wrapper);
  return wrapper;
}

async function open(wrapper: VueWrapper) {
  await wrapper.find('[data-testid="overflow-menu-trigger"]').trigger('click');
  await nextTick();
}

/** The teleported menu lives on <body>. */
function menuEl(): HTMLElement | null {
  return document.body.querySelector('[role="menu"]');
}

function item(id: string): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(
    `[data-testid="overflow-menu-item-${id}"]`
  )!;
}

describe('OverflowMenu', () => {
  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
  });

  it('opens a teleported menu with one menuitem per item', async () => {
    const wrapper = factory();
    expect(menuEl()).toBeNull();
    await open(wrapper);

    expect(menuEl()!.querySelectorAll('[role="menuitem"]').length).toBe(2);
    expect(wrapper.find('[aria-haspopup="menu"]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('[aria-haspopup="menu"]').attributes('aria-label')).toBe(
      'action.moreOptions'
    );
  });

  it('emits select with the item id and closes', async () => {
    const wrapper = factory();
    await open(wrapper);

    item('export').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('select')?.[0]).toEqual(['export']);
    expect(menuEl()).toBeNull();
  });

  it('a disabled item shows its reason, emits nothing and keeps the menu open', async () => {
    const wrapper = factory();
    await open(wrapper);

    const disabled = item('restore');
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    expect(disabled.textContent).toContain('action.close');

    disabled.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('select')).toBeUndefined();
    expect(menuEl()).not.toBeNull();
  });

  it('closes on Escape', async () => {
    const wrapper = factory();
    await open(wrapper);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();

    expect(menuEl()).toBeNull();
    expect(wrapper.find('[aria-haspopup="menu"]').attributes('aria-expanded')).toBe('false');
  });

  it('stays open on a click inside the menu, closes on an outside click', async () => {
    const wrapper = factory();
    await open(wrapper);

    menuEl()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(menuEl()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(menuEl()).toBeNull();
    expect(wrapper.emitted('select')).toBeUndefined();
  });
});
