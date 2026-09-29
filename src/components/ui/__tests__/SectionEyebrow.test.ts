import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import SectionEyebrow from '../SectionEyebrow.vue';
import EverySessionTag from '../EverySessionTag.vue';

describe('SectionEyebrow', () => {
  it('renders the label, a decorative icon, the inline slot and the end slot', () => {
    const wrapper = mount(SectionEyebrow, {
      props: { icon: '✅', label: 'To-dos' },
      slots: { default: '2 open', end: '<button>Add</button>' },
    });
    expect(wrapper.text()).toContain('To-dos');
    expect(wrapper.text()).toContain('2 open');
    expect(wrapper.find('button').text()).toBe('Add');
    expect(wrapper.find('[aria-hidden="true"]').text()).toBe('✅');
  });

  it('never fades readable text with an opacity modifier', () => {
    const html = mount(SectionEyebrow, { props: { label: 'Lists' } }).html();
    expect(html).toContain('dark:text-ink-faint');
    expect(html).not.toMatch(/text-[^\s"]+\/\d+/);
    expect(html).not.toContain('opacity-');
  });
});

describe('EverySessionTag', () => {
  it('shows the translated label with a decorative glyph and a dark lift', () => {
    const wrapper = mount(EverySessionTag);
    expect(wrapper.text()).toContain('activityLinks.everySession');
    expect(wrapper.find('[aria-hidden="true"]').text()).toBe('↻');
    expect(wrapper.classes()).toContain('dark:text-silk-lift');
  });
});
