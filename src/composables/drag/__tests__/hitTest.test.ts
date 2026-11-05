/**
 * The binding's hit tests (#142). `targetAt` reads the TOPMOST element only, so whatever
 * covers a target (the sticky day / member headers over a scrolled timeline) hides it;
 * `grabAt` looks beneath the pressed chip, except in a portal (the month popover).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { grabAt, targetAt } from '@/composables/drag/hitTest';
import { dayDropAttrs, dragSourceAttrs } from '@/utils/calendar/dragDom';

function node(attrs: Record<string, string> = {}, parent: Element = document.body): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.appendChild(el);
  return el;
}

describe('hitTest', () => {
  let cell: HTMLElement;
  let chip: HTMLElement;
  let header: HTMLElement;

  beforeEach(() => {
    cell = node(dayDropAttrs('2026-11-11'));
    chip = node(dragSourceAttrs('move')); // a row chip that sits over the cell, not inside it
    header = node(); // an opaque sticky header over the cell
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('targetAt: a covering element hides the target beneath it', () => {
    document.elementFromPoint = () => header;
    document.elementsFromPoint = () => [header, cell];
    expect(targetAt(0, 0)).toBeNull();
    document.elementFromPoint = () => cell;
    expect(targetAt(0, 0)).toEqual({ kind: 'day', date: '2026-11-11' });
  });

  it('grabAt: the target beneath the pressed chip', () => {
    document.elementsFromPoint = () => [chip, cell];
    expect(grabAt(0, 0, chip, null)).toEqual({ kind: 'day', date: '2026-11-11' });
  });

  it('grabAt: nothing for a chip in the portal (it floats over other days)', () => {
    const portal = node();
    portal.appendChild(chip);
    document.elementsFromPoint = () => [chip, cell];
    expect(grabAt(0, 0, chip, portal)).toBeNull();
  });
});
