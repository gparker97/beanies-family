import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';
import SmoothHeight from '../SmoothHeight.vue';

describe('SmoothHeight', () => {
  it('renders its slotted content', () => {
    const wrapper = mount(SmoothHeight, {
      props: { revision: 0 },
      slots: { default: '<p class="x">hi</p>' },
    });
    expect(wrapper.find('.smooth-height').exists()).toBe(true);
    expect(wrapper.find('p.x').text()).toBe('hi');
  });

  it('reacts to a revision change without crashing (no layout in the test DOM → no-op)', async () => {
    const wrapper = mount(SmoothHeight, {
      props: { revision: 0 },
      slots: { default: '<p>a</p>' },
    });
    await wrapper.setProps({ revision: 1 });
    await nextTick();
    // happy-dom reports offsetHeight 0 for both states, so from === to → early return.
    expect(wrapper.find('.smooth-height').exists()).toBe(true);
  });
});
