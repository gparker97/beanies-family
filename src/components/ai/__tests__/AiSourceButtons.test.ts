/**
 * The shared "or from…" pair beneath an AI reader's primary field.
 *
 * Extracted from `RecipeLinkModal` when a second caller appeared (#84). It has no test file of
 * its own until now, and neither does `RecipeLinkModal` — so the extraction rested on nothing.
 * That matters more than the component's size: this is the one place two surfaces agree, and
 * a silent change here changes both.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import AiSourceButtons from '@/components/ai/AiSourceButtons.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const stubs = { BeanieIcon: true };

describe('AiSourceButtons', () => {
  it('offers exactly two sources', () => {
    const w = mount(AiSourceButtons, { global: { stubs } });
    expect(w.findAll('button')).toHaveLength(2);
  });

  it('emits camera from the first and file from the second', () => {
    const w = mount(AiSourceButtons, { global: { stubs } });
    const [camera, file] = w.findAll('button');
    camera.trigger('click');
    file.trigger('click');

    expect(w.emitted('camera')).toHaveLength(1);
    expect(w.emitted('file')).toHaveLength(1);
  });

  it('routes every label through the translation layer', () => {
    // CI-enforced elsewhere, but this component is pure markup — if the keys were ever
    // inlined as English the lint rule is the only thing standing between it and shipping.
    const text = mount(AiSourceButtons, { global: { stubs } }).text();
    expect(text).toContain('ai.picker.orFrom');
    expect(text).toContain('ai.picker.takePhoto');
    expect(text).toContain('ai.picker.chooseFile');
  });

  it('takes no props at all', () => {
    // ⚠️ The component's hard constraint. A third caller wanting it *different* must copy it,
    // not parameterise it — a props-driven version of thirty lines of markup is worse than
    // two copies. This asserts the constraint rather than trusting the comment.
    expect(Object.keys(AiSourceButtons.props ?? {})).toHaveLength(0);
  });

  it('uses no font size below the 12px floor', () => {
    // The divider label was `text-[0.6875rem]` (11px) when it was lifted out of
    // RecipeLinkModal — under the minimum, and a custom rem class the standard forbids.
    expect(mount(AiSourceButtons, { global: { stubs } }).html()).not.toMatch(/text-\[[\d.]+rem\]/);
  });
});
