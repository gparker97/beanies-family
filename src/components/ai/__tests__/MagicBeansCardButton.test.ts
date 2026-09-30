import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MagicBeansCardButton from '../MagicBeansCardButton.vue';

function mounted(busy?: boolean) {
  return mount(MagicBeansCardButton, {
    props: { busy },
    attrs: { class: 'p-3' },
    slots: { default: '<span data-testid="content">Find Duplicates</span>' },
  });
}

describe('MagicBeansCardButton', () => {
  it('is the house gradient + sheen, with the caller’s content above the sheen', () => {
    const w = mounted();
    const btn = w.find('button');
    expect(btn.attributes('type')).toBe('button');
    expect(btn.classes()).toEqual(
      expect.arrayContaining(['magic-shimmer', 'from-primary-500', 'to-terracotta-400', 'p-3'])
    );
    expect(btn.classes()).not.toContain('magic-shimmer-busy');
    expect(w.find('[data-testid="content"]').element.parentElement!.className).toContain('z-[1]');
    expect(btn.attributes('aria-busy')).toBeUndefined();
  });

  it('emits click when ready', async () => {
    const w = mounted();
    await w.find('button').trigger('click');
    expect(w.emitted('click')).toHaveLength(1);
  });

  it('busy: faster sheen, aria-busy + aria-disabled, clicks swallowed, but NOT disabled', async () => {
    const w = mounted(true);
    const btn = w.find('button');
    expect(btn.classes()).toContain('magic-shimmer-busy');
    expect(btn.attributes('aria-busy')).toBe('true');
    expect(btn.attributes('aria-disabled')).toBe('true');
    expect(btn.attributes('disabled')).toBeUndefined();
    await btn.trigger('click');
    expect(w.emitted('click')).toBeUndefined();
  });
});
