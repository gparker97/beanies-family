/**
 * PhotoViewer: Escape goes through the app's Escape stack (#154), so one press closes only the
 * topmost layer; the arrow keys still step through the photos; and the optional `#actions`
 * slot is drawn on the photo, read-only included.
 *
 * The Escape cases mount the REAL `BaseModal`: it is what puts the viewer on the stack (via
 * `useFullscreenOverlay`), so a stub would test nothing. They also pin that the viewer is ONE
 * layer, not two (it once registered a token of its own on top of BaseModal's).
 */
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PhotoViewer from '../PhotoViewer.vue';
import {
  __resetEscapeCloseForTests,
  escapeLayerCount,
  useEscapeClose,
} from '@/composables/useEscapeClose';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/stores/photoStore', () => ({
  usePhotoStore: () => ({
    photos: {},
    isUnresolved: () => false,
    getPublicUrl: (id: string) => `https://example.test/${id}`,
    markUnresolved: vi.fn(),
    getFileBlob: vi.fn(),
    replacePhotoFile: vi.fn(),
  }),
}));
vi.mock('@/utils/deliverFile', () => ({ deliverFile: vi.fn() }));
vi.mock('@/utils/pdfRender', () => ({ pdfToPageImages: vi.fn() }));

/** BaseModal's teleport and transitions are not under test: draw the body while open. */
const BaseModalStub = {
  name: 'BaseModal',
  props: ['open'],
  emits: ['close'],
  template: '<div v-if="open" class="modal"><slot /><slot name="footer" /></div>',
};

function mountViewer(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(PhotoViewer, {
    props: { open: true, photoIds: ['a', 'b', 'c'], readOnly: true, ...props },
    slots,
    global: { stubs: { BaseModal: BaseModalStub, BeanieIcon: true, BeanieSpinner: true } },
  });
}

/** The real BaseModal (teleported to <body>), so Escape runs through its stack registration. */
function mountWithRealModal(props: Record<string, unknown> = {}) {
  return mount(PhotoViewer, {
    props: { open: true, photoIds: ['a', 'b', 'c'], readOnly: true, ...props },
    global: { stubs: { BeanieIcon: true, BeanieSpinner: true } },
  });
}

const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
const shownSrc = (w: ReturnType<typeof mountViewer>) => w.find('img').attributes('src');

beforeEach(() => {
  __resetEscapeCloseForTests();
});

describe('PhotoViewer', () => {
  it('closes on one Escape, through BaseModal, as exactly one layer on the stack', async () => {
    const before = escapeLayerCount();
    const w = mountWithRealModal({ open: false });
    await w.setProps({ open: true });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(escapeLayerCount()).toBe(before + 1);

    key('Escape');
    expect(w.emitted('close')).toHaveLength(1);

    // The parent closes it in answer: the stack is back where it started.
    await w.setProps({ open: false });
    expect(escapeLayerCount()).toBe(before);
    w.unmount();
  });

  it('one Escape closes only the viewer, not the layer it was opened over', async () => {
    // The layer underneath registered first (as the wall's scrapbook does), then the photo.
    const underneath = vi.fn();
    const wrapper = mount({
      setup() {
        useEscapeClose(ref(true), underneath);
        return {};
      },
      template: '<div />',
    });
    const w = mountWithRealModal({ open: false });
    await w.setProps({ open: true });

    key('Escape');
    expect(w.emitted('close')).toHaveLength(1);
    expect(underneath).not.toHaveBeenCalled();
    w.unmount();
    wrapper.unmount();
  });

  it('is not on the stack while closed', () => {
    const w = mountWithRealModal({ open: false });
    expect(escapeLayerCount()).toBe(0);
    key('Escape');
    expect(w.emitted('close')).toBeUndefined();
    w.unmount();
  });

  it('the arrow keys still step through the photos', async () => {
    // Opened after mount, as every caller does: the open watch resolves the first photo.
    const w = mountViewer({ open: false });
    await w.setProps({ open: true });
    expect(shownSrc(w)).toContain('/a');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await w.vm.$nextTick();
    expect(shownSrc(w)).toContain('/b');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await w.vm.$nextTick();
    expect(shownSrc(w)).toContain('/a');
    w.unmount();
  });

  it('draws the #actions slot on the photo, even read-only', () => {
    const w = mountViewer({ photoIds: ['a'] }, { actions: '<button class="act">go</button>' });
    expect(w.find('.act').exists()).toBe(true);
    w.unmount();
  });

  it('draws nothing extra without the slot and with a single photo', () => {
    const w = mountViewer({ photoIds: ['a'] });
    expect(w.find('.act').exists()).toBe(false);
    // No pips for one photo and no slot: the bottom stack is not drawn at all.
    expect(w.find('[style*="safe-area-inset-bottom"]').exists()).toBe(false);
    w.unmount();
  });
});
