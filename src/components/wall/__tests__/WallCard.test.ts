/**
 * The card shell (#134 added `displayOnly`): a weather card must not look or act tappable,
 * and every other card must keep its drill-in exactly as before.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import WallCard from '../WallCard.vue';

describe('WallCard', () => {
  it('is a button with a chevron that emits open', async () => {
    const wrapper = mount(WallCard, { props: { title: 'Tonight' } });
    const root = wrapper.get('.wall-card');
    expect(root.element.tagName).toBe('BUTTON');
    expect(root.attributes('type')).toBe('button');
    expect(root.text()).toContain('›');
    expect(root.classes()).toContain('active:scale-[0.99]');
    await root.trigger('click');
    expect(wrapper.emitted('open')).toHaveLength(1);
  });

  it('displayOnly renders a div with no chevron, no press and no open', async () => {
    const wrapper = mount(WallCard, { props: { title: 'Weather', displayOnly: true } });
    const root = wrapper.get('.wall-card');
    expect(root.element.tagName).toBe('DIV');
    expect(root.attributes('type')).toBeUndefined();
    expect(root.text()).not.toContain('›');
    expect(root.classes()).not.toContain('active:scale-[0.99]');
    await root.trigger('click');
    expect(wrapper.emitted('open')).toBeUndefined();
  });

  it('keeps the shell classes in both forms, so the card family stays one design', () => {
    const button = mount(WallCard, { props: { title: 'A' } })
      .get('.wall-card')
      .classes();
    const div = mount(WallCard, { props: { title: 'A', displayOnly: true } })
      .get('.wall-card')
      .classes();
    for (const cls of ['rounded-[26px]', 'bg-white', 'dark:bg-surface-raised', 'px-4', 'py-3.5']) {
      expect(button).toContain(cls);
      expect(div).toContain(cls);
    }
  });

  it('lifts the orange title on dark', () => {
    const title = mount(WallCard, { props: { title: 'Tonight' } }).get('.wall-card-title');
    expect(title.classes()).toEqual(
      expect.arrayContaining(['text-primary-500', 'dark:text-accent-lift'])
    );
  });

  it('renders the aside slot in the title row', () => {
    const wrapper = mount(WallCard, {
      props: { title: 'Weather', displayOnly: true },
      slots: { aside: '<span class="where">Portland</span>' },
    });
    expect(wrapper.get('.wall-card-title .where').text()).toBe('Portland');
  });

  it('drops the heading and slims the padding with no title', () => {
    const wrapper = mount(WallCard, { props: { displayOnly: true }, slots: { default: 'x' } });
    expect(wrapper.find('.wall-card-title').exists()).toBe(false);
    expect(wrapper.get('.wall-card').classes()).toContain('py-2');
  });
});
