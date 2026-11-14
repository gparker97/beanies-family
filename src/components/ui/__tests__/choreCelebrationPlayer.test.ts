/**
 * The choreography leaves nothing behind (#146): after a full burst and arrival on a banner,
 * `cancel()` stops every animation (on its own elements AND on the banner's), clears every
 * timer, and removes everything it drew, so a new celebration or an unmount starts clean.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChoreCelebrationPlayer } from '../choreCelebrationPlayer';
import { CHORE_MOVES } from '@/utils/choreCelebration';

interface FakeAnimation {
  cancel: ReturnType<typeof vi.fn>;
  onfinish: (() => void) | null;
  target: Element;
}

let animations: FakeAnimation[] = [];

function banner(): HTMLElement {
  const b = document.createElement('div');
  b.setAttribute('data-celebration-banner', '');
  b.append(
    document.createRange().createContextualFragment(`
    <img data-celebration-picture>
    <div data-celebration-std></div>
    <p data-celebration-praise><span data-praise-word>High</span><span data-praise-word data-praise-name="true">Pip!</span></p>
    <p><span data-celebration-star><span data-celebration-star-lit>⭐</span></span><span data-celebration-star><span data-celebration-star-lit>⭐</span></span></p>
    <button data-testid="celebration-banner-action"></button>`)
  );
  document.body.append(b);
  return b;
}

beforeEach(() => {
  vi.useFakeTimers();
  animations = [];
  Element.prototype.animate = function (this: Element) {
    const a: FakeAnimation = { cancel: vi.fn(), onfinish: null, target: this };
    animations.push(a);
    return a as unknown as Animation;
  } as never;
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  delete (Element.prototype as { animate?: unknown }).animate;
});

describe('choreCelebrationPlayer', () => {
  for (const move of CHORE_MOVES) {
    it(`${move}: cancel() stops every animation and timer and removes what it drew`, () => {
      const stage = document.createElement('div');
      document.body.append(stage);
      const block = document.createElement('section');
      const tick = document.createElement('button');
      block.append(tick);
      document.body.append(block);
      const b = banner();
      const p = createChoreCelebrationPlayer({
        stage,
        origin: { x: 0, y: 0 },
        move,
        count: 2,
        startedAt: performance.now(),
        compact: false,
      });
      p.burst({
        tick: { x: 300, y: 400, w: 52, h: 52 },
        area: { x: 16, y: 200, w: 368, h: 300 },
        tickEl: tick,
        blockEl: block,
      });
      // The block steps aside (a timer), then the banner arrives.
      vi.advanceTimersByTime(560);
      p.arrive(b);
      p.follow(0, 12);
      expect(stage.style.transform).toBe('translate(0px,12px)');
      expect(stage.querySelector('.cc-layer')).not.toBeNull();
      // Animations ran on the banner itself too (its words, stars, picture, button).
      expect(animations.some((a) => b.contains(a.target))).toBe(true);

      p.cancel();
      expect(animations.every((a) => a.cancel.mock.calls.length >= 1)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(stage.querySelector('.cc-layer')).toBeNull();
      expect(stage.style.transform).toBe('');
      // Nothing more is drawn after a cancel.
      const before = animations.length;
      p.arrive(b);
      expect(animations.length).toBe(before);
    });
  }

  it('started late (the banner already here): the block never steps aside over its banner', () => {
    const stage = document.createElement('div');
    const block = document.createElement('section');
    const b = banner();
    block.append(b);
    document.body.append(stage, block);
    const opts = {
      stage,
      origin: { x: 0, y: 0 },
      move: 'parade' as const,
      count: 2,
      startedAt: performance.now(),
      compact: false,
    };
    const burstInput = {
      tick: { x: 300, y: 400, w: 52, h: 52 },
      area: { x: 16, y: 200, w: 368, h: 300 },
      tickEl: null,
      blockEl: block,
    };
    // Late: the phase had flipped before drawing began.
    const late = createChoreCelebrationPlayer(opts);
    late.burst({ ...burstInput, late: true });
    // The tick is gone by now: no ring or sparks where it used to be, only the stars.
    expect(stage.querySelector('.cc-ring')).toBeNull();
    expect(stage.querySelectorAll('.cc-fstar').length).toBe(2);
    late.arrive(b);
    vi.advanceTimersByTime(1000);
    expect(animations.some((a) => a.target === block)).toBe(false);
    late.cancel();
    // On time, but the banner arrived before the queued step-aside fired: still never.
    animations = [];
    const early = createChoreCelebrationPlayer(opts);
    early.burst(burstInput);
    early.arrive(b);
    vi.advanceTimersByTime(1000);
    expect(animations.some((a) => a.target === block)).toBe(false);
    early.cancel();
  });

  it('a strip banner handed as its WRAPPER still gets strip geometry: beanies on its top edge', () => {
    const stage = document.createElement('div');
    document.body.append(stage);
    const rect = (el: Element, left: number, top: number, width: number, height: number) =>
      ((el as HTMLElement).getBoundingClientRect = () =>
        ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect);
    const wrapper = document.createElement('div');
    const b = banner();
    b.setAttribute('data-celebration-strip', '');
    wrapper.append(b);
    document.body.append(wrapper);
    rect(wrapper, 0, 280, 640, 140); // the wrapper is NOT the banner
    rect(b, 0, 300, 640, 94);
    rect(b.querySelector('[data-celebration-picture]')!, 16, 330, 96, 37);
    b.querySelectorAll('[data-celebration-star]').forEach((el, i) =>
      rect(el, 140 + i * 24, 360, 20, 20)
    );
    Object.defineProperty(stage, 'clientWidth', { value: 900 });
    const p = createChoreCelebrationPlayer({
      stage,
      origin: { x: 0, y: 0 },
      move: 'bounce-party',
      count: 2,
      startedAt: performance.now(),
      compact: false,
    });
    p.arrive(wrapper);
    const feet = [...stage.querySelectorAll<HTMLElement>('.cc-actor')].map(
      (a) => parseFloat(a.style.top) + parseFloat(a.style.height)
    );
    expect(feet).toHaveLength(5);
    // On the banner's top edge (300 + 8, give or take each dancer's lift), never down on the
    // picture inside the strip (its foot is at 367), so the words beside it stay clear.
    for (const f of feet) {
      expect(f).toBeGreaterThan(285);
      expect(f).toBeLessThan(330);
    }
    // And the move ran against the banner's own hooks (its words), not the wrapper.
    expect(animations.some((an) => an.target.hasAttribute('data-praise-word'))).toBe(true);
    p.cancel();
  });

  it('a star that lands lights its slot and twinkles; a cancelled one does nothing', () => {
    const stage = document.createElement('div');
    document.body.append(stage);
    const b = banner();
    const p = createChoreCelebrationPlayer({
      stage,
      origin: { x: 0, y: 0 },
      move: 'stadium-wave',
      count: 1,
      startedAt: performance.now(),
      compact: true,
    });
    p.burst({
      tick: { x: 0, y: 0, w: 44, h: 44 },
      area: { x: 0, y: 0, w: 300, h: 200 },
      tickEl: null,
      blockEl: null,
    });
    p.arrive(b);
    const lit = b.querySelector('[data-celebration-star-lit]')!;
    // The star's flight home is the one .cc-fstar animation with an onfinish.
    const landing = [...animations]
      .reverse()
      .find((a) => a.target.classList.contains('cc-fstar') && a.onfinish);
    landing!.onfinish!();
    expect(animations.some((a) => a.target === lit)).toBe(true);
    p.cancel();
  });
});
