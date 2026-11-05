/** The drag guards (#142): the long-press context menu and the click after a drop. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLICK_SWALLOW_MS, useDragGuards } from '@/composables/drag/useDragGuards';

function fire(
  type: 'click' | 'contextmenu',
  el: HTMLElement
): { prevented: boolean; reached: boolean } {
  let reached = false;
  const listener = () => (reached = true);
  el.addEventListener(type, listener);
  const e = new Event(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  el.removeEventListener(type, listener);
  return { prevented: e.defaultPrevented, reached };
}

describe('useDragGuards', () => {
  let el: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    el = document.createElement('button');
    document.body.appendChild(el);
  });
  afterEach(() => {
    vi.useRealTimers();
    el.remove();
  });

  it('prevents the context menu only while armed', () => {
    const guards = useDragGuards();
    expect(fire('contextmenu', el).prevented).toBe(false);
    guards.arm();
    expect(fire('contextmenu', el).prevented).toBe(true);
    guards.disarm();
    expect(fire('contextmenu', el).prevented).toBe(false);
  });

  it('swallows exactly one click after a drop, then lets clicks through', () => {
    const guards = useDragGuards();
    guards.arm();
    guards.disarm(true);
    expect(fire('click', el)).toEqual({ prevented: true, reached: false });
    expect(fire('click', el)).toEqual({ prevented: false, reached: true });
  });

  it('the swallow expires', () => {
    const guards = useDragGuards();
    guards.disarm(true);
    vi.advanceTimersByTime(CLICK_SWALLOW_MS + 1);
    expect(fire('click', el).reached).toBe(true);
  });

  it('a plain tap (disarm without swallow) keeps its click', () => {
    const guards = useDragGuards();
    guards.arm();
    guards.disarm(false);
    expect(fire('click', el).reached).toBe(true);
  });

  it('dispose removes everything', () => {
    const guards = useDragGuards();
    guards.arm();
    guards.disarm(true);
    guards.dispose();
    expect(fire('click', el).reached).toBe(true);
    expect(fire('contextmenu', el).prevented).toBe(false);
  });
});
