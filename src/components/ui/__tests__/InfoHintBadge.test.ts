import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import InfoHintBadge from '../InfoHintBadge.vue';
import { openExternal } from '@/utils/openExternal';

vi.mock('@/utils/openExternal', () => ({ openExternal: vi.fn() }));

/** Teleport stubbed inline so wrapper.find() reaches the popover content. */
function factory(props: Record<string, unknown> = {}) {
  return mount(InfoHintBadge, {
    props,
    global: { stubs: { teleport: true } },
  });
}

describe('InfoHintBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('backward compatibility (existing call sites)', () => {
    it('renders the bare "?" badge when no triggerLabel is passed', () => {
      const wrapper = factory({ text: 'A plain hint' });
      const btn = wrapper.get('button');
      expect(btn.text()).toBe('?');
      // The bare badge is the small fixed-size variant.
      expect(btn.classes()).toContain('h-4');
      expect(btn.classes()).toContain('w-4');
    });

    it('shows no foot link when no link prop is supplied', async () => {
      const wrapper = factory({ items: ['one', 'two'] });
      await wrapper.get('button').trigger('click');
      await nextTick();
      // Only the trigger button exists — no foot-link button.
      expect(wrapper.findAll('button')).toHaveLength(1);
      expect(wrapper.text()).toContain('one');
      expect(wrapper.text()).toContain('two');
    });
  });

  describe('pill trigger (triggerLabel)', () => {
    it('renders the label + "?" badge and toggles the popover open', async () => {
      const wrapper = factory({ triggerLabel: 'How?', items: ['proof one'] });
      const trigger = wrapper.get('button');
      expect(trigger.text()).toContain('How?');
      expect(trigger.text()).toContain('?');
      // Popover closed initially.
      expect(wrapper.text()).not.toContain('proof one');
      await trigger.trigger('click');
      await nextTick();
      expect(wrapper.text()).toContain('proof one');
    });
  });

  describe('foot link', () => {
    it('renders the link and opens it externally + closes the popover on click', async () => {
      const wrapper = factory({
        triggerLabel: 'How?',
        items: ['proof one'],
        link: { text: 'Learn how it works →', href: 'https://beanies.family/help/security/x' },
      });
      // Open the popover.
      await wrapper.get('button').trigger('click');
      await nextTick();

      const footLink = wrapper
        .findAll('button')
        .find((b) => b.text().includes('Learn how it works'));
      expect(footLink).toBeTruthy();

      await footLink!.trigger('click');
      expect(openExternal).toHaveBeenCalledWith('https://beanies.family/help/security/x');

      await nextTick();
      // Popover closes after following the link.
      expect(wrapper.text()).not.toContain('proof one');
    });
  });
});
