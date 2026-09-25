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

/** The sheet draws what it is GIVEN — the door filters by permission and flag, not the sheet. */
const ALL_KINDS = ['event', 'travel', 'recipe'] as const;

function mountSheet(open = true, kinds: readonly string[] = ALL_KINDS) {
  return mount(MagicBeansSheet, {
    props: { open, kinds: [...kinds] as never },
    global: { stubs },
    attachTo: document.body,
  });
}

/** The pick tiles, in order. */
const tiles = (w: ReturnType<typeof mountSheet>) => w.findAll('[role="group"] button');

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
      expect(w.emitted('submit')?.[0]).toEqual(['Soccer 4pm', undefined]);
    });

    it('accepts a LINK without validating it — the orchestrator routes it', async () => {
      // The field does not ask text-or-link, and must not: `sourceFromText` extracts a URL if
      // there is one, and treats the rest as text. Validating here would reject prose.
      const w = mountSheet();
      await w.find('textarea').setValue('https://example.com/cake');
      await w.find('[data-test="save"]').trigger('click');
      expect(w.emitted('submit')?.[0]).toEqual(['https://example.com/cake', undefined]);
    });

    it('trims what it submits, so trailing whitespace never reaches a band check', async () => {
      const w = mountSheet();
      await w.find('textarea').setValue('  Sports day on Tuesday at 9am  ');
      await w.find('[data-test="save"]').trigger('click');
      expect(w.emitted('submit')?.[0]).toEqual(['Sports day on Tuesday at 9am', undefined]);
    });
  });

  it('forwards the camera and file intents to its parent', () => {
    const w = mountSheet();
    const sources = w.findComponent({ name: 'AiSourceButtons' });
    sources.vm.$emit('camera');
    sources.vm.$emit('file');
    expect(w.emitted('camera')).toEqual([[undefined]]);
    expect(w.emitted('file')).toEqual([[undefined]]);
  });

  describe('the optional pick (#108)', () => {
    it('draws exactly the kinds it is given, in order — it does no gating of its own', () => {
      // The door decides availability (permission × flag) through `availableShareKinds`. A
      // sheet that re-decided it would be a second copy of that rule.
      expect(tiles(mountSheet(true, ['travel', 'recipe'])).map((b) => b.text())).toEqual([
        expect.stringContaining('ai.capture.dest.travel'),
        expect.stringContaining('ai.capture.dest.recipe'),
      ]);
    });

    it('starts with nothing picked, and says so', () => {
      const w = mountSheet();
      expect(tiles(w).map((b) => b.attributes('aria-pressed'))).toEqual([
        'false',
        'false',
        'false',
      ]);
      expect(w.text()).toContain('ai.capture.pick.idle');
      expect(w.text()).not.toContain('ai.capture.pick.as.');
    });

    it('is single-select: a tap picks, a second tap on the same tile clears', async () => {
      const w = mountSheet();
      await tiles(w)[1]!.trigger('click');
      expect(tiles(w).map((b) => b.attributes('aria-pressed'))).toEqual(['false', 'true', 'false']);
      expect(w.text()).toContain('ai.capture.pick.as.travel');
      expect(w.text()).toContain('ai.capture.pick.undo');

      await tiles(w)[2]!.trigger('click');
      expect(tiles(w).map((b) => b.attributes('aria-pressed'))).toEqual(['false', 'false', 'true']);

      await tiles(w)[2]!.trigger('click');
      expect(tiles(w).map((b) => b.attributes('aria-pressed'))).toEqual([
        'false',
        'false',
        'false',
      ]);
      expect(w.text()).toContain('ai.capture.pick.idle');
    });

    it('never gates Save on a pick — the pick is an offer, not a question', async () => {
      const w = mountSheet();
      await w.find('textarea').setValue('Sports day Tuesday 9am');
      expect(w.find('[data-test="save"]').attributes('disabled')).toBeUndefined();
    });

    it('carries the pick as `hint` on every intent: paste, camera and file', async () => {
      const w = mountSheet();
      await tiles(w)[0]!.trigger('click');
      await w.find('textarea').setValue('Sports day Tuesday 9am');
      await w.find('[data-test="save"]').trigger('click');
      expect(w.emitted('submit')?.[0]).toEqual(['Sports day Tuesday 9am', 'event']);

      const sources = w.findComponent({ name: 'AiSourceButtons' });
      sources.vm.$emit('camera');
      sources.vm.$emit('file');
      expect(w.emitted('camera')).toEqual([['event']]);
      expect(w.emitted('file')).toEqual([['event']]);
    });

    it('drops a pick whose tile disappears, so it can never be emitted for an unoffered kind', async () => {
      // `kinds` shrinks while the sheet is open (a permission change). A stale pick would buy a
      // read the reader gate refuses — the waste the door's filtering exists to prevent.
      const w = mountSheet();
      await tiles(w)[1]!.trigger('click');
      await w.setProps({ kinds: ['event', 'recipe'] as never });
      await nextTick();
      expect(tiles(w)).toHaveLength(2);
      expect(w.text()).toContain('ai.capture.pick.idle');
      await w.find('textarea').setValue('BA123 LHR-SIN 4 Oct');
      await w.find('[data-test="save"]').trigger('click');
      expect(w.emitted('submit')?.[0]).toEqual(['BA123 LHR-SIN 4 Oct', undefined]);
    });

    it('forgets the pick when it reopens — a pick is for ONE capture', async () => {
      const w = mountSheet();
      await tiles(w)[1]!.trigger('click');
      await w.setProps({ open: false });
      await w.setProps({ open: true });
      await nextTick();
      expect(tiles(w).map((b) => b.attributes('aria-pressed'))).toEqual([
        'false',
        'false',
        'false',
      ]);
    });
  });

  it('opens ABOVE every host it can be opened from, at the TOP layer', () => {
    // z-index is not decorative here. It was `overlay` while the only host was the quick-add
    // BaseModal at z-50. Since the doors were unified this sheet also opens from INSIDE other
    // modals — the activity modal's quick-start tile, the recipe form's source strip — and at
    // `overlay` its backdrop (z-[55]) sits UNDER a host panel at z-[60], leaving that host
    // bright and clickable behind it.
    //
    // `top` is safe at every host by construction rather than by inspection: the sheet's own
    // invariant is that it closes before any ingest starts, so it is never co-resident with
    // AiProcessingOverlay or the consent prompt. Fixing it here rather than per-door is what
    // stops every future door making a stacking decision it can get wrong.
    const modal = mountSheet().findComponent({ name: 'BeanieFormModal' });
    expect(modal.props('variant')).toBe('drawer');
    expect(modal.props('layer')).toBe('top');
  });
});
