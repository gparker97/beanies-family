import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import AssigneePickerButton from '../AssigneePickerButton.vue';
import FamilyChipPicker from '../FamilyChipPicker.vue';

// A trigger rect with plenty of room below it (default happy-dom viewport is
// 1024×768) so the popover drops down rather than flipping up.
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
  const wrapper = mount(AssigneePickerButton, {
    props: { modelValue: [], ...props },
    attachTo: document.body,
  });
  // positionPopover() reads the trigger's getBoundingClientRect; happy-dom
  // returns zeros, so stub a realistic rect on the component root (`el`).
  wrapper.element.getBoundingClientRect = () => TRIGGER_RECT;
  mounted.push(wrapper);
  return wrapper;
}

async function open(wrapper: VueWrapper) {
  await wrapper.find('button').trigger('click');
  await nextTick();
}

/** The teleported popover div is FamilyChipPicker's parent element. */
function popoverEl(wrapper: VueWrapper): HTMLElement | null {
  const picker = wrapper.findComponent(FamilyChipPicker);
  return picker.exists() ? (picker.element.parentElement as HTMLElement) : null;
}

describe('AssigneePickerButton — overflow-safe teleported popover', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    // Unmount (don't wipe innerHTML) so Vue can tear down its teleported nodes
    // cleanly — yanking them out from under Vue triggers patch errors.
    while (mounted.length) mounted.pop()!.unmount();
  });

  it('teleports the popover to <body>, escaping the trigger wrapper so clipping ancestors cannot cut it off', async () => {
    const wrapper = factory();
    await open(wrapper);

    const popover = popoverEl(wrapper);
    expect(popover).not.toBeNull();
    // The popover is NOT a descendant of the trigger wrapper anymore.
    expect(wrapper.element.contains(popover)).toBe(false);
    expect(document.body.contains(popover!)).toBe(true);
  });

  it('positions the popover with fixed coordinates (not absolute) anchored below the trigger', async () => {
    const wrapper = factory();
    await open(wrapper);

    const style = popoverEl(wrapper)!.getAttribute('style') ?? '';
    expect(style).toContain('position: fixed');
    // Drops below the trigger: top = rect.bottom + 6.
    expect(style).toContain('top: 136px');
    // Must not carry the old absolute-positioning classes.
    expect(popoverEl(wrapper)!.className).not.toContain('absolute');
  });

  it('honors `align`: right anchors to the trigger right edge, left to the left edge', async () => {
    const right = factory({ align: 'right' });
    await open(right);
    const rightLeft = popoverEl(right)!.style.left;

    const left = factory({ align: 'left' });
    await open(left);
    const leftLeft = popoverEl(left)!.style.left;

    // align=right anchors further right than align=left for the same trigger.
    expect(parseInt(rightLeft, 10)).toBeGreaterThan(parseInt(leftLeft, 10));
  });

  it('stays open when clicking inside the teleported popover, closes on an outside click', async () => {
    const wrapper = factory();
    await open(wrapper);
    expect(popoverEl(wrapper)).not.toBeNull();

    // Click inside the popover (now outside the trigger wrapper) — stays open.
    popoverEl(wrapper)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(popoverEl(wrapper)).not.toBeNull();

    // Click elsewhere — closes.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(popoverEl(wrapper)).toBeNull();
  });
});
