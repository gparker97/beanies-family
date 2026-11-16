/** `ProgressBar`: an explicit `size` sets the height (never read from the caller's class). */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ProgressBar from '../ProgressBar.vue';

describe('ProgressBar', () => {
  it('defaults to the small height; md is the taller one; a class adds spacing only', () => {
    const sm = mount(ProgressBar, { props: { percent: 40 }, attrs: { class: 'mt-1' } });
    expect(sm.classes()).toEqual(expect.arrayContaining(['h-1.5', 'mt-1']));
    const md = mount(ProgressBar, {
      props: { percent: 40, size: 'md' },
      attrs: { class: 'flex-1' },
    });
    expect(md.classes()).toContain('h-2');
    expect(md.classes()).not.toContain('h-1.5');
  });

  it('clamps the fill and is decorative unless the caller gives it a role', () => {
    const w = mount(ProgressBar, { props: { percent: 140, fillTestid: 'fill' } });
    expect(w.get('[data-testid="fill"]').attributes('style')).toContain('width: 100%');
    expect(w.attributes('aria-hidden')).toBe('true');
    const spoken = mount(ProgressBar, {
      props: { percent: Number.NaN },
      attrs: { role: 'progressbar', 'aria-valuenow': '3' },
    });
    expect(spoken.attributes('aria-hidden')).toBeUndefined();
    expect(spoken.attributes('role')).toBe('progressbar');
    expect((spoken.element.firstElementChild as HTMLElement).style.width).toBe('0%');
  });
});
