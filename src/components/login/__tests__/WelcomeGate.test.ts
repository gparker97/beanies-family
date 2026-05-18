import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import WelcomeGate from '../WelcomeGate.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('WelcomeGate', () => {
  describe('layout hierarchy', () => {
    it('renders the prompt header with eyebrow + title', () => {
      const wrapper = mount(WelcomeGate);
      expect(wrapper.find('header').exists()).toBe(true);
      expect(wrapper.find('h1').exists()).toBe(true);
      expect(wrapper.text()).toContain('loginV6.welcomeEyebrow');
      expect(wrapper.text()).toContain('loginV6.welcomePrompt');
    });

    it('renders Create as a full-width hero card above the or-divider', () => {
      const wrapper = mount(WelcomeGate);
      const buttons = wrapper.findAll('button');
      // First button = Create; carries the testid set by WelcomeGate.
      expect(buttons[0].attributes('data-testid')).toBe('create-pod-button');
      // Pill is unique to Create.
      expect(buttons[0].text()).toContain('loginV6.createPill');
      expect(buttons[0].text()).toContain('loginV6.createTitle');
      expect(buttons[0].text()).toContain('loginV6.createTagline');
    });

    it('renders Sign In and Join in a 2-column row below the or-divider', () => {
      const wrapper = mount(WelcomeGate);
      const buttons = wrapper.findAll('button');
      expect(buttons[1].text()).toContain('loginV6.signInTitle');
      expect(buttons[2].text()).toContain('loginV6.joinTitle');
    });

    it('renders the or-divider between the hero and the secondary row', () => {
      const wrapper = mount(WelcomeGate);
      expect(wrapper.text()).toContain('loginV6.orDivider');
    });
  });

  describe('Sign In subtitle clarity', () => {
    it('uses the disambiguated subtitle key', () => {
      const wrapper = mount(WelcomeGate);
      // Subtitle key resolves through the mocked t() to the raw key string;
      // the actual user-facing copy lives in uiStrings.ts. Asserting on the
      // key proves WelcomeGate is pointing at the right entry.
      expect(wrapper.html()).toContain('loginV6.signInSubtitle');
    });
  });

  describe('navigate emits', () => {
    it("emits navigate('create') when the Create hero is clicked", async () => {
      const wrapper = mount(WelcomeGate);
      await wrapper.findAll('button')[0].trigger('click');
      const events = wrapper.emitted('navigate');
      expect(events).toBeTruthy();
      expect(events?.[0]).toEqual(['create']);
    });

    it("emits navigate('load-pod') when Sign In is clicked", async () => {
      const wrapper = mount(WelcomeGate);
      await wrapper.findAll('button')[1].trigger('click');
      const events = wrapper.emitted('navigate');
      expect(events?.[0]).toEqual(['load-pod']);
    });

    it("emits navigate('join') when Join is clicked", async () => {
      const wrapper = mount(WelcomeGate);
      await wrapper.findAll('button')[2].trigger('click');
      const events = wrapper.emitted('navigate');
      expect(events?.[0]).toEqual(['join']);
    });
  });

  describe('prompt accent split', () => {
    it('renders the accent word with gradient styling', () => {
      // When the accent word is found in the prompt, it gets rendered in a
      // <span> with the brand gradient bg-clip. The mocked t() returns the
      // key, so we just check the span exists with the expected class.
      const wrapper = mount(WelcomeGate);
      const accentSpan = wrapper.find('h1 span');
      expect(accentSpan.exists()).toBe(true);
      expect(accentSpan.classes().some((c) => c.includes('bg-clip-text'))).toBe(true);
    });
  });
});
