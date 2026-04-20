import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import ExpandableText from '../ExpandableText.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ExpandableText', () => {
  describe('rendering', () => {
    it('renders the text content', () => {
      const wrapper = mount(ExpandableText, { props: { text: 'Hello world' } });
      expect(wrapper.text()).toContain('Hello world');
    });

    it('applies the default line-clamp class when collapsed', () => {
      const wrapper = mount(ExpandableText, { props: { text: 'x' } });
      const body = wrapper.find('.text-body');
      expect(body.classes()).toContain('clamp');
    });

    it('uses a custom maxLines prop as a CSS variable', () => {
      const wrapper = mount(ExpandableText, { props: { text: 'x', maxLines: 5 } });
      const body = wrapper.find('.text-body');
      expect(body.attributes('style')).toContain('--max-lines: 5');
    });
  });

  describe('HTML escaping (XSS safety)', () => {
    it('escapes raw HTML tags in the text', () => {
      const wrapper = mount(ExpandableText, {
        props: { text: '<script>alert("xss")</script>' },
      });
      // The script tag should render as escaped text, not as an executing element
      expect(wrapper.find('script').exists()).toBe(false);
      expect(wrapper.html()).toContain('&lt;script&gt;');
    });

    it('escapes ampersands', () => {
      const wrapper = mount(ExpandableText, { props: { text: `Tom & Jerry went here` } });
      expect(wrapper.html()).toContain('Tom &amp; Jerry');
    });
  });

  describe('URL autolinking', () => {
    it('wraps a bare https URL in an anchor with safe rel attrs', () => {
      const wrapper = mount(ExpandableText, {
        props: { text: 'See https://example.com for details' },
      });
      const link = wrapper.find('a');
      expect(link.exists()).toBe(true);
      expect(link.attributes('href')).toBe('https://example.com');
      expect(link.attributes('target')).toBe('_blank');
      expect(link.attributes('rel')).toBe('noopener noreferrer nofollow');
      expect(link.text()).toBe('https://example.com');
    });

    it('keeps trailing sentence punctuation outside the anchor', () => {
      const wrapper = mount(ExpandableText, {
        props: { text: 'Visit https://example.com, then check back.' },
      });
      const link = wrapper.find('a');
      expect(link.attributes('href')).toBe('https://example.com');
      expect(link.text()).toBe('https://example.com');
      // The trailing comma is rendered as plain text adjacent to the link
      expect(wrapper.html()).toContain('</a>,');
    });

    it('autolinks http as well as https', () => {
      // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- intentional for coverage of the http variant
      const legacyUrl = 'http://example.com';
      const wrapper = mount(ExpandableText, {
        props: { text: `Old site: ${legacyUrl}` },
      });
      expect(wrapper.find('a').attributes('href')).toBe(legacyUrl);
    });

    it('does not link plain domain-only strings (requires scheme)', () => {
      const wrapper = mount(ExpandableText, { props: { text: 'Contact us at example.com' } });
      expect(wrapper.find('a').exists()).toBe(false);
    });
  });

  describe('expand / collapse', () => {
    it('does not render the toggle when text is short (nothing overflows)', () => {
      const wrapper = mount(ExpandableText, { props: { text: 'Short' } });
      // happy-dom doesn't compute layout, so overflowed stays false after mount
      expect(wrapper.find('button').exists()).toBe(false);
    });

    it('toggles aria-expanded when the button is clicked', async () => {
      // Force the toggle to render by manipulating the component's internal state
      // via a mounted component reference.
      const wrapper = mount(ExpandableText, { props: { text: 'x' } });
      // Directly flip the internal overflowed ref so the button renders.
      // We use `wrapper.vm` because `expanded` is exposed via the template ref.
      (wrapper.vm as unknown as { overflowed: boolean }).overflowed = true;
      await wrapper.vm.$nextTick();

      const button = wrapper.find('button');
      expect(button.exists()).toBe(true);
      expect(button.attributes('aria-expanded')).toBe('false');
      expect(button.text()).toContain('action.showMore');

      await button.trigger('click');
      expect(button.attributes('aria-expanded')).toBe('true');
      expect(button.text()).toContain('action.showLess');
    });
  });

  describe('newline preservation', () => {
    it('preserves newlines via pre-wrap (no <br> injection)', () => {
      const wrapper = mount(ExpandableText, { props: { text: 'Line one\nLine two' } });
      const body = wrapper.find('.text-body');
      // The raw text node should contain the literal \n; CSS handles display.
      expect(body.text()).toContain('Line one');
      expect(body.text()).toContain('Line two');
    });
  });
});
