import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { useListboxNav } from '../useListboxNav';

function key(k: string) {
  return {
    key: k,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
}

function setup(n = 3) {
  const count = ref(n);
  const text = ref('por');
  const nav = useListboxNav(count, text);
  return { count, text, nav };
}

describe('useListboxNav', () => {
  it('ArrowDown and ArrowUp wrap both ways and consume the key', () => {
    const { nav } = setup(3);
    expect(nav.active.value).toBe(-1);
    const down = key('ArrowDown');
    expect(nav.onNavKey(down)).toBe(true);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(nav.active.value).toBe(0);
    nav.onNavKey(key('ArrowDown'));
    nav.onNavKey(key('ArrowDown'));
    expect(nav.active.value).toBe(2);
    nav.onNavKey(key('ArrowDown'));
    expect(nav.active.value).toBe(0); // wrapped forward

    nav.onNavKey(key('ArrowUp'));
    expect(nav.active.value).toBe(2); // wrapped back
    nav.reset();
    nav.onNavKey(key('ArrowUp'));
    expect(nav.active.value).toBe(2); // nothing highlighted -> the last option
  });

  it('exposes the option ids for aria-activedescendant', () => {
    const { nav } = setup(2);
    expect(nav.activeDescendant.value).toBeUndefined();
    nav.onNavKey(key('ArrowDown'));
    expect(nav.activeDescendant.value).toBe(nav.optionId(0));
    expect(nav.optionId(0).startsWith(nav.listboxId)).toBe(true);
  });

  it('Escape closes the list and stops propagation only while it is open', () => {
    const { nav } = setup(2);
    const esc = key('Escape');
    expect(nav.onNavKey(esc)).toBe(true);
    expect(esc.stopPropagation).toHaveBeenCalled();
    expect(nav.open.value).toBe(false);
    expect(nav.dismissed.value).toBe(true);

    // A second Escape, with the list closed, is not ours: the drawer may close.
    const again = key('Escape');
    expect(nav.onNavKey(again)).toBe(false);
    expect(again.stopPropagation).not.toHaveBeenCalled();
    expect(again.preventDefault).not.toHaveBeenCalled();
  });

  it('does nothing with an empty list', () => {
    const { nav } = setup(0);
    expect(nav.open.value).toBe(false);
    const esc = key('Escape');
    expect(nav.onNavKey(esc)).toBe(false);
    expect(esc.stopPropagation).not.toHaveBeenCalled();
    expect(nav.onNavKey(key('ArrowDown'))).toBe(false);
  });

  it('honours an open state the caller captured before its own key logic', () => {
    const { nav } = setup(2);
    expect(nav.onNavKey(key('ArrowDown'), false)).toBe(false);
    expect(nav.active.value).toBe(-1);
  });

  it('returns false for keys it does not own', () => {
    const { nav } = setup(2);
    for (const k of ['Enter', 'Tab', 'a', 'Backspace', ',']) {
      const e = key(k);
      expect(nav.onNavKey(e)).toBe(false);
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
  });

  it('clears the highlight when the list changes', async () => {
    const { nav, count } = setup(3);
    nav.onNavKey(key('ArrowDown'));
    nav.onNavKey(key('ArrowDown'));
    expect(nav.active.value).toBe(1);
    count.value = 2;
    await nextTick();
    expect(nav.active.value).toBe(-1);
  });

  it('reopens and clears the highlight when the text changes', async () => {
    const { nav, text } = setup(3);
    nav.onNavKey(key('ArrowDown'));
    nav.onNavKey(key('Escape'));
    expect(nav.open.value).toBe(false);
    text.value = 'port';
    await nextTick();
    expect(nav.dismissed.value).toBe(false);
    expect(nav.open.value).toBe(true);
    expect(nav.active.value).toBe(-1);
  });
});
