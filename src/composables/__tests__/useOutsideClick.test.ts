/**
 * The outside-click half extracted from useAnchoredPopover. What it must guarantee:
 *   - a click outside every inside ref calls `onOutside`; a click inside any of them does not,
 *   - it runs in the CAPTURE phase, so a target that re-renders away mid-click still counts
 *     as inside (the 2026-11-01 custom-time bug),
 *   - the document listener exists only while active, and is gone after dispose.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { OUTSIDE_CLICK_CAPTURE, useOutsideClick } from '../useOutsideClick';
import { OUTSIDE_CLICK_CAPTURE as REEXPORTED } from '../useAnchoredPopover';

function setup(initiallyActive = true) {
  const inside = document.createElement('div');
  const teleported = document.createElement('div');
  const outside = document.createElement('button');
  document.body.append(inside, teleported, outside);
  const active = ref(initiallyActive);
  const insideRef = ref<HTMLElement | null>(inside);
  const teleportedRef = ref<HTMLElement | undefined>(teleported);
  const onOutside = vi.fn();
  const scope = effectScope();
  scope.run(() => useOutsideClick(active, [insideRef, teleportedRef], onOutside));
  return { inside, teleported, outside, active, insideRef, onOutside, scope };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useOutsideClick', () => {
  it('is re-exported from useAnchoredPopover for its existing importers', () => {
    expect(OUTSIDE_CLICK_CAPTURE).toBe(true);
    expect(REEXPORTED).toBe(OUTSIDE_CLICK_CAPTURE);
  });

  it('calls onOutside for a click outside, and ignores clicks inside any inside ref', () => {
    const { inside, teleported, outside, onOutside, scope } = setup();
    const child = document.createElement('span');
    inside.appendChild(child);
    child.click();
    teleported.click();
    expect(onOutside).not.toHaveBeenCalled();
    outside.click();
    expect(onOutside).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('skips an empty inside ref instead of throwing', () => {
    const { insideRef, outside, onOutside, scope } = setup();
    insideRef.value = null;
    outside.click();
    expect(onOutside).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('listens in the capture phase, before a target that re-renders away is detached', () => {
    const { inside, onOutside, scope } = setup();
    const row = document.createElement('button');
    inside.appendChild(row);
    // Stands in for Vue's re-render between listeners: the row leaves the DOM in its own
    // click handler. A bubble-phase document listener would then see a detached target.
    row.addEventListener('click', () => row.remove());
    row.click();
    expect(onOutside).not.toHaveBeenCalled();
    scope.stop();
  });

  it('attaches only while active', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { active, outside, onOutside, scope } = setup(false);
    expect(add).not.toHaveBeenCalledWith('click', expect.any(Function), true);
    outside.click();
    expect(onOutside).not.toHaveBeenCalled();

    active.value = true;
    await nextTick();
    expect(add).toHaveBeenCalledWith('click', expect.any(Function), true);
    outside.click();
    expect(onOutside).toHaveBeenCalledTimes(1);

    active.value = false;
    await nextTick();
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function), true);
    outside.click();
    expect(onOutside).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('detaches when its scope is disposed while still active', () => {
    const { outside, onOutside, scope } = setup(true);
    scope.stop();
    outside.click();
    expect(onOutside).not.toHaveBeenCalled();
  });

  it('warns with its prefix, and keeps going, when the listener cannot attach', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(document, 'addEventListener').mockImplementation(() => {
      throw new Error('sandboxed');
    });
    const { scope } = setup(true);
    expect(warn).toHaveBeenCalledWith(
      '[useOutsideClick] could not attach the click listener:',
      expect.any(Error)
    );
    expect(() => scope.stop()).not.toThrow();
  });
});
