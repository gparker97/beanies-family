import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ErrorBanner from '@/components/common/ErrorBanner.vue';

describe('ErrorBanner', () => {
  it('does not render when show=false', () => {
    const wrapper = mount(ErrorBanner, {
      props: { show: false, severity: 'critical' },
      slots: { title: 'Title', message: 'Body' },
    });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('renders all slots when shown', () => {
    const wrapper = mount(ErrorBanner, {
      props: { show: true },
      slots: {
        title: 'Something broke',
        message: 'Details about the break',
        actions: '<button type="button">Fix it</button>',
      },
    });
    const banner = wrapper.find('[role="alert"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('Something broke');
    expect(banner.text()).toContain('Details about the break');
    expect(banner.find('button').text()).toBe('Fix it');
  });

  it('uses red styling + assertive live region for critical severity', () => {
    const wrapper = mount(ErrorBanner, {
      props: { show: true, severity: 'critical' },
      slots: { title: 't', message: 'm' },
    });
    const banner = wrapper.find('[role="alert"]');
    expect(banner.attributes('aria-live')).toBe('assertive');
    expect(banner.classes().some((c) => c.startsWith('bg-red'))).toBe(true);
  });

  it('uses amber styling + polite live region for warning severity', () => {
    const wrapper = mount(ErrorBanner, {
      props: { show: true, severity: 'warning' },
      slots: { title: 't', message: 'm' },
    });
    const banner = wrapper.find('[role="alert"]');
    expect(banner.attributes('aria-live')).toBe('polite');
    expect(banner.classes().some((c) => c.startsWith('bg-amber'))).toBe(true);
  });

  it('defaults severity to critical when omitted', () => {
    const wrapper = mount(ErrorBanner, {
      props: { show: true },
      slots: { title: 't', message: 'm' },
    });
    expect(wrapper.find('[role="alert"]').attributes('aria-live')).toBe('assertive');
  });
});
