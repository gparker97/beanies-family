/**
 * The special reward progress cell (#154): bar plus label only. The bar is the spoken element;
 * the label beside it is hidden from a screen reader (it hears it in the bar's name).
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AwardProgressCell from '../AwardProgressCell.vue';

describe('AwardProgressCell', () => {
  it('a progressbar with its value and name, and the label beside it', () => {
    const w = mount(AwardProgressCell, {
      props: {
        label: '64 of 160 stars',
        percent: 40,
        aria: 'Mia: 64 of 160 stars',
        fillTestid: 'fill',
      },
    });
    const bar = w.get('[role="progressbar"]');
    expect(bar.attributes('aria-valuenow')).toBe('40');
    expect(bar.attributes('aria-label')).toBe('Mia: 64 of 160 stars');
    expect(w.get('[data-testid="fill"]').attributes('style')).toContain('width: 40%');
    const label = w.get('span[aria-hidden="true"]');
    expect(label.text()).toBe('64 of 160 stars');
  });

  it('has no achieved state of its own: each caller draws that', () => {
    const w = mount(AwardProgressCell, { props: { label: 'x', percent: 100, aria: 'y' } });
    expect(w.text()).toBe('x');
  });

  it('lg (the wall) is a taller bar and a bigger label; md stays the default', () => {
    const md = mount(AwardProgressCell, { props: { label: 'x', percent: 40, aria: 'y' } });
    expect(md.get('[role="progressbar"]').classes()).toContain('h-2');
    expect(md.get('span[aria-hidden="true"]').classes()).toContain('text-xs');
    const lg = mount(AwardProgressCell, {
      props: { label: 'x', percent: 40, aria: 'y', size: 'lg' },
    });
    expect(lg.get('[role="progressbar"]').classes()).toContain('h-3');
    expect(lg.get('span[aria-hidden="true"]').classes()).toContain('text-base');
  });
});
