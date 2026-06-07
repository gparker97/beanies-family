import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import MagicReaderCard from '@/components/ai/MagicReaderCard.vue';

const openPhotoReader = vi.fn();
const openDocumentReader = vi.fn();
const gate = {
  canReadPhoto: ref(true),
  canReadDocument: ref(true),
  canReadAny: ref(true),
};

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useMagicReader', () => ({
  useMagicReader: () => ({
    canReadPhoto: gate.canReadPhoto,
    canReadDocument: gate.canReadDocument,
    canReadAny: gate.canReadAny,
    openPhotoReader,
    openDocumentReader,
  }),
}));

function setGate(photo: boolean, doc: boolean): void {
  gate.canReadPhoto.value = photo;
  gate.canReadDocument.value = doc;
  gate.canReadAny.value = photo || doc;
}

beforeEach(() => {
  vi.clearAllMocks();
  setGate(true, true);
});

describe('MagicReaderCard', () => {
  it('renders both reader chips when both flags allow', () => {
    const w = mount(MagicReaderCard);
    const buttons = w.findAll('button');
    expect(buttons).toHaveLength(2);
    expect(w.text()).toContain('ai.magic.invite');
    expect(w.text()).toContain('ai.magic.travelBooking');
  });

  it('routes each chip to the correct reader', async () => {
    const w = mount(MagicReaderCard);
    const buttons = w.findAll('button');
    await buttons[0].trigger('click');
    expect(openPhotoReader).toHaveBeenCalledOnce();
    expect(openDocumentReader).not.toHaveBeenCalled();
    await buttons[1].trigger('click');
    expect(openDocumentReader).toHaveBeenCalledOnce();
  });

  it('shows only the Invite chip when only the photo flag is on', () => {
    setGate(true, false);
    const w = mount(MagicReaderCard);
    expect(w.findAll('button')).toHaveLength(1);
    expect(w.text()).toContain('ai.magic.invite');
    expect(w.text()).not.toContain('ai.magic.travelBooking');
  });

  it('shows only the Travel booking chip when only the travel flag is on', () => {
    setGate(false, true);
    const w = mount(MagicReaderCard);
    expect(w.findAll('button')).toHaveLength(1);
    expect(w.text()).toContain('ai.magic.travelBooking');
    expect(w.text()).not.toContain('ai.magic.invite');
  });

  it('renders nothing when neither flag is on', () => {
    setGate(false, false);
    const w = mount(MagicReaderCard);
    expect(w.find('section').exists()).toBe(false);
    expect(w.findAll('button')).toHaveLength(0);
  });
});
