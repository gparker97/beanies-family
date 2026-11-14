/**
 * The positioning half extracted from useAnchoredPopover: fixed, under the anchor, flipped up
 * when there is no room below, clamped to the viewport, always at the popover z tier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { ANCHORED_POPOVER_Z_INDEX, useAnchoredPosition } from '../useAnchoredPosition';
import { ANCHORED_POPOVER_Z_INDEX as REEXPORTED } from '../useAnchoredPopover';

function anchorAt(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('button');
  const full = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, ...rect };
  el.getBoundingClientRect = () => ({ ...full, toJSON: () => full }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function setup(
  anchor: HTMLElement | null,
  opts: { align?: 'start' | 'end'; side?: 'below' | 'start'; active?: boolean } = {}
) {
  const anchorRef = ref<HTMLElement | null>(anchor);
  const popoverRef = ref<HTMLElement | null>(null);
  const active = ref(opts.active ?? true);
  const scope = effectScope();
  const api = scope.run(() =>
    useAnchoredPosition({
      anchorRef,
      popoverRef,
      active,
      align: opts.align,
      side: opts.side,
      widthEstimate: 200,
      heightEstimate: 300,
    })
  )!;
  return { ...api, anchorRef, active, scope };
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('useAnchoredPosition', () => {
  it("side 'start' opens beside the anchor on its left, level with it, clamped to the viewport", () => {
    const { popoverStyle, reposition, scope } = setup(
      anchorAt({ top: 400, bottom: 440, left: 700, right: 760, height: 40 }),
      { side: 'start' }
    );
    reposition();
    // Centred on the anchor: 420 - 300 / 2 = 270; left = 700 - 200 - 12.
    expect(popoverStyle.value).toMatchObject({ top: '270px', left: '488px' });
    scope.stop();
    // Near the bottom: clamped so it stays on screen (800 - 300 - 8).
    const low = setup(anchorAt({ top: 740, bottom: 780, left: 700, right: 760, height: 40 }), {
      side: 'start',
    });
    low.reposition();
    expect(low.popoverStyle.value).toMatchObject({ top: '492px', left: '488px' });
    low.scope.stop();
  });

  it("side 'start' with no room on the left falls back to below", () => {
    const { popoverStyle, reposition, scope } = setup(
      anchorAt({ top: 100, bottom: 130, left: 40, right: 140, height: 30 }),
      { side: 'start', align: 'start' }
    );
    reposition();
    expect(popoverStyle.value).toMatchObject({ top: '136px', left: '40px' });
    scope.stop();
  });

  it('drops below the anchor, start-aligned, at the popover z tier', () => {
    const { popoverStyle, reposition, scope } = setup(
      anchorAt({ top: 100, bottom: 130, left: 40, right: 140 }),
      { align: 'start' }
    );
    reposition();
    expect(popoverStyle.value).toEqual({
      position: 'fixed',
      top: '136px',
      left: '40px',
      zIndex: String(ANCHORED_POPOVER_Z_INDEX),
    });
    expect(REEXPORTED).toBe(ANCHORED_POPOVER_Z_INDEX);
    scope.stop();
  });

  it('flips up when there is no room below but there is above', () => {
    const { popoverStyle, reposition, scope } = setup(
      anchorAt({ top: 600, bottom: 630, left: 40, right: 140 })
    );
    reposition();
    // 600 - 300 (height estimate) - 6
    expect(popoverStyle.value.top).toBe('294px');
    scope.stop();
  });

  it('end-aligns by default and clamps to the left margin', () => {
    const { popoverStyle, reposition, scope } = setup(
      anchorAt({ top: 100, bottom: 130, left: 0, right: 60 })
    );
    reposition();
    // right (60) - width (200) is off-screen → the 8px margin.
    expect(popoverStyle.value.left).toBe('8px');
    scope.stop();
  });

  it('clamps to the right edge of the viewport', () => {
    const { popoverStyle, reposition, scope } = setup(
      anchorAt({ top: 100, bottom: 130, left: 950, right: 1010 }),
      { align: 'start' }
    );
    reposition();
    expect(popoverStyle.value.left).toBe(`${1024 - 200 - 8}px`);
    scope.stop();
  });

  it('returns silently with no anchor', () => {
    const { popoverStyle, reposition, scope } = setup(null);
    expect(() => reposition()).not.toThrow();
    expect(popoverStyle.value).toEqual({});
    scope.stop();
  });

  it('follows scroll and resize only while active', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const anchor = anchorAt({ top: 100, bottom: 130, left: 40, right: 140 });
    const { popoverStyle, active, scope } = setup(anchor, { align: 'start', active: false });
    window.dispatchEvent(new Event('resize'));
    expect(popoverStyle.value).toEqual({});

    active.value = true;
    await nextTick();
    expect(add).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    window.dispatchEvent(new Event('resize'));
    expect(popoverStyle.value.top).toBe('136px');

    active.value = false;
    await nextTick();
    popoverStyle.value = {};
    window.dispatchEvent(new Event('resize'));
    expect(popoverStyle.value).toEqual({});
    scope.stop();
    add.mockRestore();
  });
});
