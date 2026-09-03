/**
 * The one magic-beans surface (#84).
 *
 * The thing this file most needs to protect is what the sheet does NOT do: it validates
 * nothing beyond "is there anything here". Every real rule about acceptable text — the length
 * bands, link-vs-text, the budget — lives in the orchestrator's `sourceFromText`, shared with
 * the share path. A second opinion here is exactly the divergence the feature exists to
 * remove, and it would be invisible until two surfaces disagreed in production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import MagicBeansSheet from '@/components/ai/MagicBeansSheet.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

/** Renders its slots so the field and the source buttons are actually in the DOM. */
const BeanieFormModalStub = defineComponent({
  name: 'BeanieFormModal',
  props: {
    open: { type: Boolean, default: false },
    saveDisabled: { type: Boolean, default: false },
    title: { type: String, default: '' },
    saveLabel: { type: String, default: '' },
    variant: { type: String, default: '' },
    layer: { type: String, default: '' },
    icon: { type: String, default: '' },
    iconBg: { type: String, default: '' },
    size: { type: String, default: '' },
  },
  emits: ['close', 'save'],
  setup(props, { slots, emit }) {
    return () =>
      h('div', { 'data-test': 'modal', 'data-open': String(props.open) }, [
        h('div', { 'data-test': 'body' }, slots.default?.()),
        h('button', {
          'data-test': 'save',
          disabled: props.saveDisabled,
          onClick: () => emit('save'),
        }),
      ]);
  },
});

const AiSourceButtonsStub = defineComponent({
  name: 'AiSourceButtons',
  emits: ['camera', 'file'],
  setup: () => () => h('div', { 'data-test': 'sources' }),
});

const stubs = {
  BeanieFormModal: BeanieFormModalStub,
  FormFieldGroup: { template: '<div><slot /></div>' },
  AiSourceButtons: AiSourceButtonsStub,
};

beforeEach(() => vi.clearAllMocks());

function mountSheet(open = true) {
  return mount(MagicBeansSheet, { props: { open }, global: { stubs }, attachTo: document.body });
}

describe('MagicBeansSheet', () => {
  it('leads with the paste field — a textarea, not a single-line input', () => {
    // A pasted class-group message is several lines. A single-line field that scrolls
    // sideways makes it impossible to check what you actually pasted.
    const w = mountSheet();
    expect(w.find('textarea').exists()).toBe(true);
    expect(w.find('input[type="url"]').exists()).toBe(false);
  });

  it('offers the camera and file buttons through the SHARED component', () => {
    // Shared with RecipeLinkModal (#84). If this stops rendering, the two surfaces have
    // drifted back into two copies of the same markup.
    expect(mountSheet().find('[data-test="sources"]').exists()).toBe(true);
  });

  it('focuses the field on open, so you can paste immediately', async () => {
    const w = mountSheet(false);
    await w.setProps({ open: true });
    await nextTick();
    await nextTick();
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
  });

  it('clears any previous text when it reopens', async () => {
    const w = mountSheet();
    await w.find('textarea').setValue('an old draft');
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    await nextTick();
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('');
  });

  describe('what it refuses, and what it deliberately does not', () => {
    it('disables save while the field is empty', () => {
      const w = mountSheet();
      expect(w.find('[data-test="save"]').attributes('disabled')).toBeDefined();
    });

    it('treats whitespace as empty', async () => {
      const w = mountSheet();
      await w.find('textarea').setValue('    ');
      expect(w.find('[data-test="save"]').attributes('disabled')).toBeDefined();
      await w.find('[data-test="save"]').trigger('click');
      expect(w.emitted('submit')).toBeUndefined();
    });

    it('accepts SHORT text and lets the orchestrator refuse it', async () => {
      // ⚠️ Deliberate. `MIN_SHARE_TEXT_CHARS` is enforced in `sourceFromText`, once, for both
      // doors. Re-checking it here would be a second threshold to keep in sync — and the two
      // would disagree the first time either moved.
      const w = mountSheet();
      await w.find('textarea').setValue('Soccer 4pm');
      expect(w.find('[data-test="save"]').attributes('disabled')).toBeUndefined();
      await w.find('[data-test="save"]').trigger('click');
      expect(w.emitted('submit')?.[0]).toEqual(['Soccer 4pm']);
    });

    it('accepts a LINK without validating it — the orchestrator routes it', async () => {
      // The field does not ask text-or-link, and must not: `sourceFromText` extracts a URL if
      // there is one, and treats the rest as text. Validating here would reject prose.
      const w = mountSheet();
      await w.find('textarea').setValue('https://example.com/cake');
      await w.find('[data-test="save"]').trigger('click');
      expect(w.emitted('submit')?.[0]).toEqual(['https://example.com/cake']);
    });

    it('trims what it submits, so trailing whitespace never reaches a band check', async () => {
      const w = mountSheet();
      await w.find('textarea').setValue('  Sports day on Tuesday at 9am  ');
      await w.find('[data-test="save"]').trigger('click');
      expect(w.emitted('submit')?.[0]).toEqual(['Sports day on Tuesday at 9am']);
    });
  });

  it('forwards the camera and file intents to its parent', () => {
    const w = mountSheet();
    const sources = w.findComponent({ name: 'AiSourceButtons' });
    sources.vm.$emit('camera');
    sources.vm.$emit('file');
    expect(w.emitted('camera')).toHaveLength(1);
    expect(w.emitted('file')).toHaveLength(1);
  });

  it('opens ABOVE the quick-add sheet, as an overlay-layer drawer', () => {
    // z-index is not decorative here: the quick-add BaseModal is z-50, so a same-layer panel
    // would render underneath it and be invisible.
    const modal = mountSheet().findComponent({ name: 'BeanieFormModal' });
    expect(modal.props('variant')).toBe('drawer');
    expect(modal.props('layer')).toBe('overlay');
  });
});
