/**
 * The quick-add card, rebuilt around ONE button (#84).
 *
 * This suite used to assert three chips and which reader each opened. That whole shape is
 * gone: the user no longer declares what the content is, so there is nothing per-type left to
 * route. What matters now is the ordering — every action must close the sheet BEFORE the
 * ingest starts, or the reading overlay collides with the drawer, the body-scroll lock leaks,
 * and `openQuickAdd()` refuses afterwards, leaving the FAB dead until a reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import MagicReaderCard from '@/components/ai/MagicReaderCard.vue';

const openDocumentReader = vi.fn();
const canReadAny = ref(true);

const ingestInAppSource = vi.fn((_input: unknown) => Promise.resolve());
/** Ordered log of what happened, so "closed before ingest" is assertable rather than assumed. */
let order: string[] = [];

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useMagicReader', () => ({
  useMagicReader: () => ({
    // Kept on the mock even though the card no longer reads them: `vi.mock` factories are
    // EXHAUSTIVE (docs/lessons.md §8), and other consumers of this module do read them.
    canReadPhoto: ref(true),
    canReadDocument: ref(true),
    canReadRecipe: ref(true),
    canReadAny,
    openDocumentReader,
  }),
}));
vi.mock('@/composables/useSharedDocumentIngest', () => ({
  ingestInAppSource: (input: unknown) => {
    order.push('ingest');
    return ingestInAppSource(input);
  },
  logCaptureOpened: () => order.push('opened'),
  isReadingSharedDocument: ref(false),
}));

const pickCamera = vi.fn(() => order.push('pickCamera'));
const pickFile = vi.fn(() => order.push('pickFile'));

/** Stubs that record what the card asked for, and let a test drive the child's emits. */
const AiDocumentPickerStub = defineComponent({
  name: 'AiDocumentPicker',
  emits: ['file'],
  setup(_props, { expose }) {
    // `expose`, not a plain return: the card reaches the picker through a template ref and
    // calls `pickCamera()` / `pickFile()` on it, so the stub has to present the same surface.
    expose({ pick: vi.fn(), pickCamera, pickFile });
    return () => h('div', { 'data-test': 'picker' });
  },
});

const MagicBeansSheetStub = defineComponent({
  name: 'MagicBeansSheet',
  props: { open: { type: Boolean, default: false } },
  emits: ['close', 'submit', 'camera', 'file'],
  setup(props) {
    return () => h('div', { 'data-test': 'sheet', 'data-open': String(props.open) });
  },
});

const stubs = {
  BetaBadge: true,
  AiDocumentPicker: AiDocumentPickerStub,
  MagicBeansSheet: MagicBeansSheetStub,
};

beforeEach(() => {
  vi.clearAllMocks();
  canReadAny.value = true;
  order = [];
});

function mountCard() {
  return mount(MagicReaderCard, { global: { stubs } });
}

describe('MagicReaderCard', () => {
  it('renders ONE magic-beans button, not a chip per reader', () => {
    const w = mountCard();
    const buttons = w.findAll('button');
    expect(buttons).toHaveLength(1);
    expect(w.text()).toContain('ai.magic.action');
  });

  it('names no content type — the whole point is that the AI decides', () => {
    const w = mountCard();
    // The three retired chip labels must not have crept back in under new keys.
    expect(w.text()).not.toContain('ai.magic.invite');
    expect(w.text()).not.toContain('ai.magic.travelBooking');
    expect(w.text()).not.toContain('recipeExtract.chip.title');
  });

  it('opens the sheet when the button is tapped', async () => {
    const w = mountCard();
    expect(w.find('[data-test="sheet"]').attributes('data-open')).toBe('false');
    await w.find('button').trigger('click');
    expect(w.find('[data-test="sheet"]').attributes('data-open')).toBe('true');
  });

  it('records the OPEN as the funnel denominator, at the tap', async () => {
    // Fired at the ingest instead, the rate would equal its own numerator: opening the sheet
    // and abandoning it would be indistinguishable from never tapping the button.
    const w = mountCard();
    await w.find('button').trigger('click');
    expect(order).toEqual(['opened']);
  });

  it('renders nothing at all without permission, exactly as before', () => {
    // Unchanged behaviour, and the reason the collapse is permission-neutral: `canReadAny`
    // reduces to `canEditActivities` unconditionally, because the recipe gate is ungated.
    canReadAny.value = false;
    const w = mountCard();
    expect(w.find('section').exists()).toBe(false);
    expect(w.findAll('button')).toHaveLength(0);
  });

  describe('closes the sheet BEFORE starting any work', () => {
    it('on a paste', async () => {
      const w = mountCard();
      await w.find('button').trigger('click');
      await w.findComponent({ name: 'MagicBeansSheet' }).vm.$emit('submit', 'some text');

      expect(w.find('[data-test="sheet"]').attributes('data-open')).toBe('false');
      expect(ingestInAppSource).toHaveBeenCalledWith({ kind: 'paste', text: 'some text' });
    });

    it('on the camera', async () => {
      const w = mountCard();
      await w.find('button').trigger('click');
      await w.findComponent({ name: 'MagicBeansSheet' }).vm.$emit('camera');

      expect(w.find('[data-test="sheet"]').attributes('data-open')).toBe('false');
      expect(pickCamera).toHaveBeenCalledOnce();
      // ⚠️ pickCamera, never pick: the mixed `image/*,application/pdf` accept routes to the
      // system documents picker in a Capacitor WebView, which has no camera entry at all.
      expect(pickFile).not.toHaveBeenCalled();
    });

    it('on the file picker', async () => {
      const w = mountCard();
      await w.find('button').trigger('click');
      await w.findComponent({ name: 'MagicBeansSheet' }).vm.$emit('file');

      expect(w.find('[data-test="sheet"]').attributes('data-open')).toBe('false');
      expect(pickFile).toHaveBeenCalledOnce();
      expect(pickCamera).not.toHaveBeenCalled();
    });
  });

  it('closes the sheet WITHOUT waiting for the read to finish', async () => {
    // ⚠️ THE hazard, and the one a post-hoc state check alone would miss. A read takes
    // several seconds. If the card awaited it before closing — or closed in a `.then()` — the
    // drawer would sit open on top of the reading overlay for the whole call, hold the
    // body-scroll lock, and leave `openQuickAdd()` refusing afterwards so the FAB is dead.
    // A never-resolving ingest makes that arrangement fail and the correct one pass.
    ingestInAppSource.mockReturnValueOnce(new Promise(() => {}));
    const w = mountCard();
    await w.find('button').trigger('click');
    await w.findComponent({ name: 'MagicBeansSheet' }).vm.$emit('submit', 'some text');

    expect(ingestInAppSource).toHaveBeenCalledOnce();
    expect(w.find('[data-test="sheet"]').attributes('data-open')).toBe('false');
  });

  it('feeds a picked file into the same in-app ingest as a paste', async () => {
    const w = mountCard();
    const file = new File(['x'], 'invite.jpg', { type: 'image/jpeg' });
    await w.findComponent({ name: 'AiDocumentPicker' }).vm.$emit('file', file);

    expect(ingestInAppSource).toHaveBeenCalledWith({ kind: 'file', file });
  });

  it('keeps the picker mounted on the CARD, not inside the sheet', () => {
    // Load-bearing on native: the camera intent backgrounds the app, and if the component
    // holding the hidden input unmounts meanwhile, the `change` callback lands on a dead
    // input and the photo silently vanishes. The card outlives the drawer.
    const w = mountCard();
    expect(w.find('[data-test="picker"]').exists()).toBe(true);
  });
});
