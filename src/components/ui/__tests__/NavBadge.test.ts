import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import NavBadge from '../NavBadge.vue';

describe('NavBadge', () => {
  it('renders a count pill only when the count is above 0', () => {
    expect(mount(NavBadge, { props: { badge: { kind: 'count', count: 3 } } }).text()).toBe('3');
    expect(mount(NavBadge, { props: { badge: { kind: 'count', count: 0 } } }).html()).not.toContain(
      '<span'
    );
  });

  it('renders the dot as a BLOCK box so its h-2 w-2 size applies (an inline span is 0x0)', () => {
    const dot = mount(NavBadge, {
      props: { badge: { kind: 'dot', severity: 'attention', active: true } },
    }).find('span');
    expect(dot.classes()).toEqual(
      expect.arrayContaining(['block', 'h-2', 'w-2', 'bg-primary-500'])
    );
  });

  it('renders nothing for an inactive dot or a null badge', () => {
    const off = { kind: 'dot', severity: 'info', active: false } as const;
    expect(
      mount(NavBadge, { props: { badge: off } })
        .find('span')
        .exists()
    ).toBe(false);
    expect(
      mount(NavBadge, { props: { badge: null } })
        .find('span')
        .exists()
    ).toBe(false);
  });
});
