import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import SortMenu from '../SortMenu.vue';
import { SORT_OPTIONS } from '@/composables/useTodoSort';

// Decouple from the translation pipeline — `t` is a passthrough so assertions
// are deterministic regardless of language/beanie-mode state.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// A trigger rect with room below (happy-dom viewport 1024×768) so the menu
// drops down rather than flipping up.
const TRIGGER_RECT = {
  top: 100,
  bottom: 130,
  left: 200,
  right: 280,
  width: 80,
  height: 30,
} as DOMRect;

const mounted: VueWrapper[] = [];

function factory(props: Record<string, unknown> = {}) {
  const wrapper = mount(SortMenu, {
    props: {
      modelValue: 'dueDate',
      options: SORT_OPTIONS,
      triggerLabelKey: 'todo.sortLabel',
      ...props,
    },
    attachTo: document.body,
  });
  // positionPopover() reads the trigger's getBoundingClientRect; happy-dom
  // returns zeros, so stub a realistic rect on the component root (`el`).
  wrapper.element.getBoundingClientRect = () => TRIGGER_RECT;
  mounted.push(wrapper);
  return wrapper;
}

async function open(wrapper: VueWrapper) {
  await wrapper.find('button[aria-haspopup="menu"]').trigger('click');
  await nextTick();
}

/** The teleported menu lives on <body>. */
function menuEl(): HTMLElement | null {
  return document.body.querySelector('[role="menu"]');
}

describe('SortMenu', () => {
  afterEach(() => {
    // Unmount (don't wipe innerHTML) so Vue tears down teleported nodes cleanly.
    while (mounted.length) mounted.pop()!.unmount();
  });

  it('shows the active sort in the trigger and starts collapsed', () => {
    const wrapper = factory({ modelValue: 'dueDate' });
    expect(wrapper.text()).toContain('todo.sort.dueDate');
    expect(wrapper.find('[aria-haspopup="menu"]').attributes('aria-expanded')).toBe('false');
  });

  it('opens a teleported menu of all three options on click', async () => {
    const wrapper = factory();
    await open(wrapper);

    const menu = menuEl();
    expect(menu).not.toBeNull();
    expect(document.body.contains(menu!)).toBe(true);
    expect(menu!.querySelectorAll('[role="menuitemradio"]').length).toBe(3);
    expect(wrapper.find('[aria-haspopup="menu"]').attributes('aria-expanded')).toBe('true');
  });

  it('positions the teleported menu with fixed coordinates below the trigger', async () => {
    const wrapper = factory();
    await open(wrapper);

    const style = menuEl()!.getAttribute('style') ?? '';
    expect(style).toContain('position: fixed');
    expect(style).toContain('top: 136px'); // rect.bottom + 6
  });

  it('marks the active option with aria-checked="true"', async () => {
    const wrapper = factory({ modelValue: 'oldest' });
    await open(wrapper);

    const checked = menuEl()!.querySelector('[aria-checked="true"]');
    expect(checked?.textContent).toContain('todo.sort.oldest');
  });

  it('emits update:modelValue with the chosen value and closes', async () => {
    const wrapper = factory({ modelValue: 'dueDate' });
    await open(wrapper);

    // Options render in order: dueDate, newest, oldest → index 1 is "newest".
    const items = menuEl()!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    items[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['newest']);
    expect(menuEl()).toBeNull(); // closed after selection
  });

  it('stays open on a click inside the menu, closes on an outside click', async () => {
    const wrapper = factory();
    await open(wrapper);
    expect(menuEl()).not.toBeNull();

    menuEl()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(menuEl()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(menuEl()).toBeNull();
  });
});
