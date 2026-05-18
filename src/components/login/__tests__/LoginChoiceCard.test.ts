import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import LoginChoiceCard from '../LoginChoiceCard.vue';

describe('LoginChoiceCard', () => {
  describe('slot rendering', () => {
    it('renders the default slot content', () => {
      const wrapper = mount(LoginChoiceCard, {
        slots: { default: '<span class="my-content">Hello bean</span>' },
      });
      expect(wrapper.find('.my-content').exists()).toBe(true);
      expect(wrapper.text()).toContain('Hello bean');
    });
  });

  describe('click handling', () => {
    it('emits click when pressed', async () => {
      const wrapper = mount(LoginChoiceCard);
      await wrapper.find('button').trigger('click');
      expect(wrapper.emitted('click')).toHaveLength(1);
    });

    it('does not emit click when disabled', async () => {
      const wrapper = mount(LoginChoiceCard, { props: { disabled: true } });
      await wrapper.find('button').trigger('click');
      // Native <button disabled> blocks the event; assert defensively
      expect(wrapper.emitted('click')).toBeUndefined();
    });
  });

  describe('disabled state', () => {
    it('applies opacity + cursor classes when disabled', () => {
      const wrapper = mount(LoginChoiceCard, { props: { disabled: true } });
      const btn = wrapper.find('button');
      expect(btn.classes()).toContain('opacity-50');
      expect(btn.classes()).toContain('cursor-not-allowed');
      expect(btn.attributes('disabled')).toBeDefined();
    });

    it('does not apply disabled classes by default', () => {
      const wrapper = mount(LoginChoiceCard);
      const btn = wrapper.find('button');
      expect(btn.classes()).not.toContain('opacity-50');
      expect(btn.classes()).not.toContain('cursor-not-allowed');
    });
  });

  describe('dimmed state', () => {
    it('applies opacity-60 when dimmed but not disabled', () => {
      const wrapper = mount(LoginChoiceCard, { props: { dimmed: true } });
      expect(wrapper.find('button').classes()).toContain('opacity-60');
    });

    it('disabled takes precedence over dimmed for opacity', () => {
      const wrapper = mount(LoginChoiceCard, {
        props: { dimmed: true, disabled: true },
      });
      // disabled applies opacity-50, dimmed's opacity-60 should NOT also apply
      const classes = wrapper.find('button').classes();
      expect(classes).toContain('opacity-50');
      expect(classes).not.toContain('opacity-60');
    });
  });

  describe('accessibility', () => {
    it('applies aria-label when provided', () => {
      const wrapper = mount(LoginChoiceCard, { props: { ariaLabel: 'Sign in to your pod' } });
      expect(wrapper.find('button').attributes('aria-label')).toBe('Sign in to your pod');
    });

    it('applies data-testid when provided', () => {
      const wrapper = mount(LoginChoiceCard, { props: { testid: 'sign-in-card' } });
      expect(wrapper.find('button').attributes('data-testid')).toBe('sign-in-card');
    });
  });
});
