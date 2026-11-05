/** The drag ghost (#142): a scrubbed, fixed, pointer-transparent clone; the source placeholder. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repoFile } from '@/test/repoFile';
import {
  PLACEHOLDER_CLASS,
  SOLID_PLACEHOLDER_CLASS,
  useDragGhost,
} from '@/composables/drag/useDragGhost';

function chip(): HTMLElement {
  const el = document.createElement('button');
  el.id = 'chip-1';
  el.setAttribute('data-activity-id', 'piano');
  el.setAttribute('data-drag', 'move');
  el.setAttribute('data-testid', 'month-chip');
  const inner = document.createElement('span');
  inner.id = 'inner';
  inner.setAttribute('data-x', '1');
  inner.textContent = 'Piano';
  el.appendChild(inner);
  el.getBoundingClientRect = () =>
    ({ left: 100, top: 50, width: 80, height: 20, right: 180, bottom: 70 }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

const ghostEl = () =>
  [...document.body.children].find((c) => (c as HTMLElement).style.position === 'fixed') as
    HTMLElement | undefined;

describe('useDragGhost', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('floats a scrubbed clone at the grab point and marks the source as the placeholder', () => {
    const el = chip();
    const ghost = useDragGhost();
    ghost.show(el, { x: 110, y: 55 });

    expect(el.classList.contains(PLACEHOLDER_CLASS)).toBe(true);
    const clone = ghostEl()!;
    expect(clone).toBeDefined();
    expect(clone.textContent).toBe('Piano');
    // No duplicate ids, test ids, reveal hooks or drag attributes anywhere in the clone.
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
      expect(node.id).toBe('');
      expect(node.getAttributeNames().filter((n) => n.startsWith('data-'))).toEqual([]);
    }
    expect(clone.classList.contains(PLACEHOLDER_CLASS)).toBe(false);
    // An opaque frame on the card surface, in both modes, carries the shadow.
    for (const cls of ['shadow-lg', 'bg-white', 'dark:bg-surface-raised']) {
      expect(clone.classList.contains(cls)).toBe(true);
    }
    expect(clone.style.pointerEvents).toBe('none');
    expect(clone.getAttribute('aria-hidden')).toBe('true');
    expect(clone.style.width).toBe('80px');
    // Grabbed 10px in and 5px down: the clone's corner sits at the source's corner.
    expect(clone.style.transform).toContain('translate(100px, 50px)');
    expect(clone.style.transform).toContain('rotate(-2deg)');
  });

  it('a timeline block (absolute, inline top/left) fills its frame instead of sitting off inside it', () => {
    const el = chip();
    Object.assign(el.style, { position: 'absolute', top: '31rem', left: '50%', width: '40%' });
    useDragGhost().show(el, { x: 110, y: 55 });
    const inner = ghostEl()!.firstElementChild as HTMLElement;
    expect(inner.style.position).toBe('relative');
    expect(inner.style.top).toBe('0px');
    expect(inner.style.left).toBe('0px');
    expect(inner.style.width).toBe('100%');
  });

  it('on a timeline slot it takes the slot size and a readout; off it, its own size again', () => {
    const ghost = useDragGhost();
    ghost.show(chip(), { x: 110, y: 55 });
    ghost.place({ x: 0, y: 0 }, { left: 10, top: 600, width: 120, height: 45 }, '4pm – 4:45pm');
    expect(ghostEl()!.style.transform).toBe('translate(10px, 600px)');
    expect([ghostEl()!.style.width, ghostEl()!.style.height]).toEqual(['120px', '45px']);
    const pill = [...document.body.children].find((c) => c.textContent === '4pm – 4:45pm');
    expect(pill).toBeDefined();
    ghost.place({ x: 310, y: 255 });
    expect([ghostEl()!.style.width, ghostEl()!.style.height]).toEqual(['80px', '20px']);
    expect([...document.body.children].some((c) => c.textContent === '4pm – 4:45pm')).toBe(false);
  });

  it('keeps the grab offset as the pointer moves', () => {
    const ghost = useDragGhost();
    ghost.show(chip(), { x: 110, y: 55 });
    ghost.place({ x: 310, y: 255 });
    expect(ghostEl()!.style.transform).toContain('translate(300px, 250px)');
  });

  it('floats above the finger when asked, so a small day target stays visible', () => {
    const ghost = useDragGhost();
    ghost.show(chip(), { x: 110, y: 55 });
    ghost.place({ x: 310, y: 255 }, undefined, undefined, true);
    const height = parseFloat(ghostEl()!.style.height);
    expect(ghostEl()!.style.transform).toContain(`translate(300px, ${255 - height - 12}px)`);
  });

  it('caps a wide row chip at 14rem, centred under a grab beyond the cap', () => {
    const el = chip();
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 50, width: 366, height: 20, right: 366, bottom: 70 }) as DOMRect;
    useDragGhost().show(el, { x: 300, y: 55 });
    const clone = ghostEl()!;
    expect(clone.style.width).toBe('224px');
    expect(clone.style.transform).toContain('translate(188px, 50px)');
  });

  it('drops the tilt under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const ghost = useDragGhost();
    ghost.show(chip(), { x: 110, y: 55 });
    expect(ghostEl()!.style.transform).not.toContain('rotate');
  });

  it('a keyboard lift (no point) marks a SOLID placeholder only (no ghost carries the copy)', () => {
    const el = chip();
    const ghost = useDragGhost();
    ghost.show(el, null);
    expect(el.classList.contains(PLACEHOLDER_CLASS)).toBe(true);
    expect(el.classList.contains(SOLID_PLACEHOLDER_CLASS)).toBe(true);
    expect(ghostEl()).toBeUndefined();
    ghost.hide();
    expect(el.classList.contains(SOLID_PLACEHOLDER_CLASS)).toBe(false);
  });

  it('a pointer lift fades its placeholder (the ghost is the readable copy)', () => {
    const el = chip();
    useDragGhost().show(el, { x: 110, y: 55 });
    expect(el.classList.contains(SOLID_PLACEHOLDER_CLASS)).toBe(false);
  });

  it('the solid placeholder restores full opacity in style.css (both themes share it)', () => {
    const css = repoFile('src/style.css');
    expect(css).toMatch(/\.drag-placeholder > \*\s*\{\s*opacity: 0\.4;/);
    expect(css).toMatch(/\.drag-placeholder-solid > \*\s*\{\s*opacity: 1;/);
  });

  it('snaps to a slot and shows the readout pill above it', () => {
    const ghost = useDragGhost();
    ghost.show(chip(), { x: 110, y: 55 });
    ghost.place({ x: 0, y: 0 }, { left: 20, top: 400, width: 80, height: 60 }, '4:00 – 5:00pm');
    const clone = ghostEl()!;
    expect(clone.style.transform).toBe('translate(20px, 400px)');
    expect(clone.style.height).toBe('60px');
    const pill = [...document.body.children].find((c) => c.textContent === '4:00 – 5:00pm');
    expect(pill?.className).toContain('dark:bg-surface-overlay');
    ghost.place({ x: 0, y: 0 }, { left: 20, top: 400, width: 80, height: 60 });
    expect([...document.body.children].some((c) => c.textContent === '4:00 – 5:00pm')).toBe(false);
  });

  it('hide removes the clone and restores the source', () => {
    const el = chip();
    const ghost = useDragGhost();
    ghost.show(el, { x: 110, y: 55 });
    ghost.hide();
    expect(ghostEl()).toBeUndefined();
    expect(el.classList.contains(PLACEHOLDER_CLASS)).toBe(false);
    ghost.hide(); // idempotent
  });
});
