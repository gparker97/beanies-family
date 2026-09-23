import { mount, config, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import RecoveryKitDisplay from '../RecoveryKitDisplay.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The QR is an extra on every surface that draws one; these assertions are about the gate.
vi.mock('@/utils/qrCode', () => ({
  renderQr: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,stub' })),
}));
vi.mock('@/composables/useSheetExport', () => ({
  useSheetExport: () => ({
    exportElementToPng: vi.fn(async () => new Blob(['png'])),
    pngBlobToPdf: vi.fn(async () => new Blob(['pdf'])),
  }),
  prewarmSheetExport: vi.fn(),
  ExportError: class extends Error {},
}));
const deliverFile = vi.hoisted(() => vi.fn());
vi.mock('@/utils/deliverFile', () => ({ deliverFile }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

config.global.stubs = { ...config.global.stubs, BaseModal: false, Teleport: true };

const props = { open: true, kitId: 'abc12345', code: 'R7K2-9QW4-MN3X-8BTD' };

describe('RecoveryKitDisplay — the Continue gate', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  /**
   * ⚠️ THIS IS THE TEST THAT KEEPS THE GATE SAFE.
   *
   * greg's reasoning for keeping the checkbox was that nobody can get stuck, because a
   * checkbox has no network and no platform dependency and is therefore always available.
   * That holds ONLY while the tick is unconditional. If it is ever "tidied" into something
   * like `:disabled="!hasTriedSaving"`, this screen — an unclosable modal at the tail of a
   * flow that already loses 47% of its starters — becomes one that CAN strand a new family.
   */
  it('the tick alone releases Continue, with no save attempted', async () => {
    const wrapper = mount(RecoveryKitDisplay, { props });

    const confirm = wrapper.find('[data-testid="kit-confirm"]');
    expect(confirm.attributes('disabled')).toBeDefined();

    await wrapper.find('[data-testid="kit-acknowledged"]').setValue(true);

    expect(wrapper.find('[data-testid="kit-confirm"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('[data-testid="kit-gate-hint"]').exists()).toBe(false);
  });

  it('the checkbox is never disabled — it is the arm that cannot fail', async () => {
    const wrapper = mount(RecoveryKitDisplay, { props });
    const box = wrapper.find('[data-testid="kit-acknowledged"]');
    expect(box.exists()).toBe(true);
    expect(box.attributes('disabled')).toBeUndefined();
  });

  it('emits stored once the gate is open', async () => {
    const wrapper = mount(RecoveryKitDisplay, { props });
    await wrapper.find('[data-testid="kit-acknowledged"]').setValue(true);
    await wrapper.find('[data-testid="kit-confirm"]').trigger('click');
    expect(wrapper.emitted('stored')).toHaveLength(1);
  });

  // ── HOW the kit was confirmed (2026-09-23): the sign-out kit guard keys on it ──

  it('the tick alone confirms as `acknowledged`', async () => {
    const wrapper = mount(RecoveryKitDisplay, { props });
    await wrapper.find('[data-testid="kit-acknowledged"]').setValue(true);
    await wrapper.find('[data-testid="kit-confirm"]').trigger('click');
    expect(wrapper.emitted('stored')).toEqual([['acknowledged']]);
  });

  it('a real PDF delivery confirms as `saved`', async () => {
    deliverFile.mockResolvedValueOnce({ delivered: true, outcome: 'delivered' });
    const wrapper = mount(RecoveryKitDisplay, { props });
    const save = wrapper.findAll('button').find((b) => b.text() === 'recovery.kitDownloadPdf');
    await save!.trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="kit-confirm"]').trigger('click');
    expect(wrapper.emitted('stored')).toEqual([['saved']]);
  });

  it('a successful code copy confirms as `saved`, even after the 2s "copied" icon resets', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    const wrapper = mount(RecoveryKitDisplay, { props });
    await wrapper.find('button[aria-label="recovery.kitCopyCode"]').trigger('click');
    await flushPromises();
    vi.advanceTimersByTime(3000);
    await wrapper.find('[data-testid="kit-acknowledged"]').setValue(true);
    await wrapper.find('[data-testid="kit-confirm"]').trigger('click');
    expect(wrapper.emitted('stored')).toEqual([['saved']]);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a failed code copy is shown, and does not count as saved', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    });
    const wrapper = mount(RecoveryKitDisplay, { props });
    await wrapper.find('button[aria-label="recovery.kitCopyCode"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('share.copyFailedHelp');
    await wrapper.find('[data-testid="kit-acknowledged"]').setValue(true);
    await wrapper.find('[data-testid="kit-confirm"]').trigger('click');
    expect(wrapper.emitted('stored')).toEqual([['acknowledged']]);
    vi.unstubAllGlobals();
  });

  /**
   * Three of this component's four hosts never pass `magicLink` — Settings regenerate, the
   * kit prompt modal and the dev harness. The W1 reorder lives entirely inside the
   * `v-if="magicLink || magicLinkErrorKey"` bracket so those three are untouched; this is
   * the inverse assertion that proves it.
   */
  it('renders no sign-in-code section when no magicLink is passed', () => {
    const wrapper = mount(RecoveryKitDisplay, { props });
    expect(wrapper.find('[data-testid="copy-magic-link"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('magicLink.title');
    expect(wrapper.text()).not.toContain('recovery.beforeYouGo');
  });

  it('leads with the sign-in code when one was minted', async () => {
    const wrapper = mount(RecoveryKitDisplay, {
      props: { ...props, magicLink: 'https://beanies.family/join?fam=1&t=x' },
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="copy-magic-link"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('recovery.beforeYouGo');
  });

  /**
   * ⚠️ THE SIGN-IN CODE'S QR IS ALWAYS ON SCREEN. greg's explicit requirement: scanning is
   * the first-class way in now, so the thing the other device scans must be PRINTED on the
   * screen, never hidden behind an interaction or deferred to the exported sheet.
   *
   * Only the KIT's QR is export-only (it belongs on the saved page, and two squares side by
   * side read as alternatives). If a future tidy-up ever gives the sign-in code the same
   * treatment, this fails.
   */
  it('renders the sign-in code QR on screen, not only in the export', async () => {
    const wrapper = mount(RecoveryKitDisplay, {
      props: { ...props, magicLink: 'https://beanies.family/join?fam=1&t=x' },
    });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const qrs = wrapper.findAll('img[src^="data:image/png"]');

    // The sign-in code's QR is the VISIBLE one.
    const visible = qrs.filter((img) => !img.classes().includes('opacity-0'));
    expect(visible).toHaveLength(1);
    expect(visible[0]!.attributes('alt')).toBe('signInCode.qrAlt');

    // The kit's QR is in the DOM so the rasteriser can capture it, but taken out of flow
    // and made invisible — it must never be a second scannable square on screen, and it
    // must never shift the layout when an export starts.
    const hidden = qrs.filter((img) => img.classes().includes('opacity-0'));
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.classes()).toContain('absolute');
  });
});
