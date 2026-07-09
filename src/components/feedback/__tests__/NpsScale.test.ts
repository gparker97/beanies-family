import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import NpsScale from '@/components/feedback/NpsScale.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('NpsScale', () => {
  it('renders 11 score segments (0–10)', () => {
    const w = mount(NpsScale, { props: { modelValue: null } });
    const segs = w.findAll('.nps-seg');
    expect(segs).toHaveLength(11);
    expect(segs[0].text()).toBe('0');
    expect(segs[10].text()).toBe('10');
  });

  it('emits the picked score on click', async () => {
    const w = mount(NpsScale, { props: { modelValue: null } });
    await w.findAll('.nps-seg')[7].trigger('click');
    expect(w.emitted('update:modelValue')?.[0]).toEqual([7]);
  });

  it('marks the selected segment via aria-checked + is-selected', () => {
    const w = mount(NpsScale, { props: { modelValue: 9 } });
    const seg = w.findAll('.nps-seg')[9];
    expect(seg.attributes('aria-checked')).toBe('true');
    expect(seg.classes()).toContain('is-selected');
  });

  it('exposes a per-score aria-label', () => {
    const w = mount(NpsScale, { props: { modelValue: null } });
    // t() is mocked to echo the key; fillTemplate leaves the token untouched.
    expect(w.findAll('.nps-seg')[0].attributes('aria-label')).toContain('feedback.nps.scoreAria');
  });

  it('arrow-right from empty selects 0; arrow-right from a score increments', async () => {
    const w = mount(NpsScale, { props: { modelValue: null } });
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowRight' });
    expect(w.emitted('update:modelValue')?.[0]).toEqual([0]);

    await w.setProps({ modelValue: 5 });
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowRight' });
    const emits = w.emitted('update:modelValue');
    expect(emits?.[emits.length - 1]).toEqual([6]);
  });

  it('End selects 10 and Home selects 0', async () => {
    const w = mount(NpsScale, { props: { modelValue: 4 } });
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'End' });
    expect(w.emitted('update:modelValue')?.[0]).toEqual([10]);
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'Home' });
    const emits = w.emitted('update:modelValue');
    expect(emits?.[emits.length - 1]).toEqual([0]);
  });
});
