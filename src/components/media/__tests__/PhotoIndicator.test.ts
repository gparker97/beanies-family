import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import PhotoIndicator from '../PhotoIndicator.vue';

describe('PhotoIndicator', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders nothing when photoIds is undefined', () => {
    const wrapper = mount(PhotoIndicator, { props: {} });
    expect(wrapper.find('span[role="img"]').exists()).toBe(false);
  });

  it('renders nothing when photoIds is null', () => {
    const wrapper = mount(PhotoIndicator, { props: { photoIds: null } });
    expect(wrapper.find('span[role="img"]').exists()).toBe(false);
  });

  it('renders nothing when photoIds is empty array', () => {
    const wrapper = mount(PhotoIndicator, { props: { photoIds: [] } });
    expect(wrapper.find('span[role="img"]').exists()).toBe(false);
  });

  it('renders the camera icon and singular aria-label when one photo', () => {
    const wrapper = mount(PhotoIndicator, { props: { photoIds: ['p-1'] } });
    const span = wrapper.find('span[role="img"]');
    expect(span.exists()).toBe(true);
    expect(span.text()).toBe('📷');
    expect(span.attributes('aria-label')).toContain('1 photo attached');
  });

  it('renders the camera icon and plural aria-label with count when many photos', () => {
    const wrapper = mount(PhotoIndicator, { props: { photoIds: ['p-1', 'p-2', 'p-3'] } });
    const span = wrapper.find('span[role="img"]');
    expect(span.exists()).toBe(true);
    expect(span.text()).toBe('📷');
    expect(span.attributes('aria-label')).toContain('3 photos attached');
  });

  it('shows the count when showCount is true and there are multiple photos', () => {
    const wrapper = mount(PhotoIndicator, {
      props: { photoIds: ['p-1', 'p-2', 'p-3'], showCount: true },
    });
    expect(wrapper.text()).toBe('📷3');
  });

  it('hides the count when showCount is true but there is only one photo', () => {
    const wrapper = mount(PhotoIndicator, {
      props: { photoIds: ['p-1'], showCount: true },
    });
    expect(wrapper.text()).toBe('📷');
  });
});
