import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import AiDocumentPicker from '../AiDocumentPicker.vue';
import ChoiceModal from '@/components/ui/ChoiceModal.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const showToast = vi.fn();
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast }),
}));

// useIsTouchPrimary reads window.matchMedia('(pointer: coarse)') in onMounted —
// stub it per-test so we control the touch-primary branch without UA sniffing.
function stubTouchPrimary(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

function mountPicker() {
  return mount(AiDocumentPicker, { global: { stubs: { teleport: true } } });
}

function inputs(wrapper: ReturnType<typeof mountPicker>) {
  const all = wrapper.findAll('input');
  const camera = all.find((i) => i.attributes('capture') === 'environment');
  const file = all.find((i) => i.attributes('capture') === undefined);
  return { camera, file };
}

describe('AiDocumentPicker', () => {
  beforeEach(() => {
    showToast.mockClear();
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a camera input (image-only + capture) and a file input (image + PDF)', () => {
    stubTouchPrimary(true);
    const w = mountPicker();
    const { camera, file } = inputs(w);
    expect(camera?.attributes('accept')).toBe('image/*');
    expect(camera?.attributes('capture')).toBe('environment');
    expect(file?.attributes('accept')).toBe('image/*,application/pdf,.pdf');
    expect(file?.attributes('capture')).toBeUndefined();
  });

  it('on touch-primary, pick() shows the chooser', async () => {
    stubTouchPrimary(true);
    const w = mountPicker();
    expect(w.findComponent(ChoiceModal).props('open')).toBe(false);
    (w.vm as unknown as { pick: () => void }).pick();
    await nextTick();
    expect(w.findComponent(ChoiceModal).props('open')).toBe(true);
  });

  it('on non-touch, pick() opens the file picker directly (no chooser)', async () => {
    stubTouchPrimary(false);
    const w = mountPicker();
    const { file } = inputs(w);
    const clickSpy = vi
      .spyOn(file!.element as HTMLInputElement, 'click')
      .mockImplementation(() => {});
    (w.vm as unknown as { pick: () => void }).pick();
    await nextTick();
    expect(w.findComponent(ChoiceModal).props('open')).toBe(false);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('emits the selected file once when a file is chosen', async () => {
    stubTouchPrimary(false);
    const w = mountPicker();
    const { file } = inputs(w);
    const picked = new File(['x'], 'invite.png', { type: 'image/png' });
    Object.defineProperty(file!.element, 'files', { value: [picked], configurable: true });
    await file!.trigger('change');
    const emitted = w.emitted('file');
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0][0]).toBeInstanceOf(File);
  });
});
