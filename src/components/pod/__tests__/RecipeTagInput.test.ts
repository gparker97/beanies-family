/**
 * The autocomplete exists because the "used before" row alone did not solve the problem it was
 * meant to: it is easy to miss and easy to out-type, and `family favourite` vs
 * `family favourites` is then two tags forever. These tests pin the behaviour that prevents it.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import RecipeTagInput from '@/components/pod/RecipeTagInput.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const SUGGESTIONS = ['weeknight', 'sweet', 'vegan', 'quick', 'family favourite'];

function factory(modelValue: string[] = [], suggestions = SUGGESTIONS) {
  return mount(RecipeTagInput, { props: { modelValue, suggestions } });
}

const options = (w: ReturnType<typeof factory>) => w.findAll('[role="option"]');

describe('RecipeTagInput autocomplete', () => {
  it('shows nothing until the user types', async () => {
    const wrapper = factory();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    // The quiet "used before" row is what fills the empty state instead.
    expect(wrapper.text()).toContain('weeknight');
  });

  it('offers matches as you type, prefix first', async () => {
    const wrapper = factory();
    await wrapper.find('input').setValue('we');
    expect(options(wrapper).map((o) => o.text())).toEqual(['weeknight', 'sweet']);
  });

  it('hides the idle row once typing starts, so the two never compete', async () => {
    const wrapper = factory();
    await wrapper.find('input').setValue('we');
    expect(wrapper.findAll('[role="option"]').length).toBeGreaterThan(0);
    expect(wrapper.text()).not.toContain('recipes.tags.suggestions');
  });

  it('completes the highlighted match on Enter rather than the typed text', async () => {
    const wrapper = factory();
    const input = wrapper.find('input');
    await input.setValue('fam');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });
    // The whole point: "fam" becomes the existing tag, not a new near-duplicate.
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['family favourite']]);
  });

  it('still commits the typed text when nothing is highlighted', async () => {
    const wrapper = factory();
    const input = wrapper.find('input');
    await input.setValue('brand new tag');
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['brand new tag']]);
  });

  it('wraps the highlight at both ends', async () => {
    const wrapper = factory();
    const input = wrapper.find('input');
    await input.setValue('we');
    await input.trigger('keydown', { key: 'ArrowUp' });
    expect(options(wrapper)[1]!.attributes('aria-selected')).toBe('true');
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(options(wrapper)[0]!.attributes('aria-selected')).toBe('true');
  });

  it('drops a stale highlight when the matches change', async () => {
    const wrapper = factory();
    const input = wrapper.find('input');
    await input.setValue('we');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.setValue('veg');
    // A highlight that outlived its list would send Enter to the wrong tag.
    expect(options(wrapper)[0]!.attributes('aria-selected')).toBe('false');
  });

  it('Escape clears the highlight without closing anything else', async () => {
    const wrapper = factory();
    const input = wrapper.find('input');
    await input.setValue('we');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Escape' });
    expect(options(wrapper)[0]!.attributes('aria-selected')).toBe('false');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
  });

  it('selects a match on click without the blur handler racing it', async () => {
    const wrapper = factory();
    await wrapper.find('input').setValue('we');
    await options(wrapper)[0]!.trigger('mousedown');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['weeknight']]);
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  });

  it('never offers a tag already on the recipe', async () => {
    // The caller filters these out; this pins that the component does not re-add them.
    const wrapper = factory(['weeknight'], ['sweet']);
    await wrapper.find('input').setValue('we');
    expect(options(wrapper).map((o) => o.text())).toEqual(['sweet']);
  });

  it('exposes combobox state for assistive tech', async () => {
    const wrapper = factory();
    const input = wrapper.find('input');
    expect(input.attributes('role')).toBe('combobox');
    expect(input.attributes('aria-expanded')).toBe('false');
    await input.setValue('we');
    expect(input.attributes('aria-expanded')).toBe('true');
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(input.attributes('aria-activedescendant')).toBeTruthy();
  });

  it('offers no autocomplete once the tag cap is reached', async () => {
    const full = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const wrapper = factory(full, ['weeknight']);
    expect(wrapper.find('input').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });
});
