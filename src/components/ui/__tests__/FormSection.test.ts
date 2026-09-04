/**
 * The type-scale rule is the reason this component exists, so it is the thing pinned hardest:
 * `FormFieldGroup`'s label is already text-xs uppercase with 0.1em tracking, so a section
 * heading styled the same way reads as a PEER of the field labels and the hierarchy inverts —
 * twelve equal-weight small-caps labels instead of four groups of three.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import FormSection from '@/components/ui/FormSection.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => `t:${key}` }),
}));

function factory(props: Record<string, unknown> = {}) {
  return mount(FormSection, {
    props: { labelKey: 'recipes.section.dish', ...props },
    slots: { default: '<p class="child">a field</p>' },
  });
}

describe('FormSection', () => {
  it('translates the heading rather than rendering a raw key', () => {
    expect(factory().find('h3').text()).toBe('t:recipes.section.dish');
  });

  it('renders its fields', () => {
    expect(factory().find('.child').exists()).toBe(true);
  });

  it('sits one tier ABOVE the field labels, not level with them', () => {
    const cls = factory().find('h3').classes();
    expect(cls).toContain('text-sm');
    // The inversion guard: these are FormFieldGroup's label treatment, never a section's.
    expect(cls).not.toContain('text-xs');
    expect(cls).not.toContain('uppercase');
  });

  it('is a real section labelled by its heading, so the grouping reaches a screen reader', () => {
    const wrapper = factory();
    const section = wrapper.find('section');
    const id = wrapper.find('h3').attributes('id');
    expect(id).toBeTruthy();
    expect(section.attributes('aria-labelledby')).toBe(id);
  });

  // Mounted in ONE tree, because `useId` is scoped per app instance — two separate `mount()`
  // calls each create their own app and legitimately restart the counter. The condition that
  // matters is two sections in the same form, which is what a real modal does.
  it('gives sections in the same form distinct heading ids', () => {
    const wrapper = mount(
      {
        components: { FormSection },
        template: `<form>
          <FormSection label-key="recipes.section.dish" />
          <FormSection label-key="recipes.section.method" />
        </form>`,
      },
      { global: { stubs: {} } }
    );
    const ids = wrapper.findAll('h3').map((h) => h.attributes('id'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();
    expect(new Set(ids).size).toBe(2);
    // And each section still points at its OWN heading, not merely at a unique string.
    wrapper.findAll('section').forEach((sec, i) => {
      expect(sec.attributes('aria-labelledby')).toBe(ids[i]);
    });
  });

  it('hides the decorative emoji from assistive tech', () => {
    const wrapper = factory({ emoji: '🍽️' });
    const glyph = wrapper.findAll('[aria-hidden="true"]').map((e) => e.text());
    expect(glyph).toContain('🍽️');
  });

  it('renders no emoji element when none is given', () => {
    expect(factory().text()).not.toContain('🍽️');
  });

  it('drops the top margin on the first section, where a rule would float', () => {
    expect(factory({ first: true }).find('section').classes()).not.toContain('mt-7');
    expect(factory().find('section').classes()).toContain('mt-7');
  });
});
