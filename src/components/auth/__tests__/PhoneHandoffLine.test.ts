/**
 * The creation flow's one-tap phone hand-off (#128). Pins the three things that matter:
 * one tap mints (no picker, no PIN gate stacked over the unclosable kit modal), the result
 * renders in place, and a failure says so instead of vanishing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const mintDeviceLink = vi.fn();
const emitLinkMinted = vi.fn();

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/auth/linkMint', () => ({
  mintDeviceLink: (...a: unknown[]) => mintDeviceLink(...a),
}));
vi.mock('@/utils/qrCode', () => ({
  renderQr: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,qr' })),
}));
vi.mock('@/services/telemetry/loginFlowEvents', () => ({
  emitLinkMinted: (...a: unknown[]) => emitLinkMinted(...a),
  emitLinkMintStarted: vi.fn(),
  emitLinkMintReentered: vi.fn(),
  mintDetail: (f: { origin: string; target: string }) => `origin=${f.origin};target=${f.target}`,
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/utils/perfTiming', () => ({
  measureAsync: (_l: string, fn: () => Promise<unknown>) => fn(),
}));

import PhoneHandoffLine from '../PhoneHandoffLine.vue';

const LINK = 'https://app.beanies.family/join?fam=f1&t=tok&lk=1';

function mountLine() {
  return mount(PhoneHandoffLine, {
    props: { ownerMemberId: 'owner-1' },
    global: {
      stubs: {
        MintedLinkPanel: {
          props: ['link', 'qrUrl', 'qrUnavailable', 'loading', 'qrAlt', 'hint', 'surface'],
          template: '<div data-testid="panel" :data-link="link" :data-qr="qrUrl" />',
        },
        BeanieSpinner: { template: '<span data-testid="spinner" />' },
      },
    },
  });
}

describe('PhoneHandoffLine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders only the line until tapped, and mints nothing on mount', () => {
    const wrapper = mountLine();
    expect(wrapper.text()).toContain('setup.usePhoneToo');
    expect(wrapper.find('[data-testid="panel"]').exists()).toBe(false);
    expect(mintDeviceLink).not.toHaveBeenCalled();
  });

  it('one tap mints a self-targeted device link with no PIN gate and shows the QR in place', async () => {
    mintDeviceLink.mockResolvedValueOnce({ link: LINK });
    const wrapper = mountLine();
    await wrapper.find('[data-testid="phone-handoff-toggle"]').trigger('click');
    expect(mintDeviceLink).toHaveBeenCalledWith({
      hintMemberId: 'owner-1',
      gate: 'not-applicable',
    });
    await flushPromises();
    const panel = wrapper.find('[data-testid="panel"]');
    expect(panel.exists()).toBe(true);
    expect(panel.attributes('data-link')).toBe(LINK);
    expect(panel.attributes('data-qr')).toBe('data:image/png;base64,qr');
    // The funnel is the composable's, labelled as the creation origin for the owner.
    expect(emitLinkMinted).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'device', ok: true, detail: 'origin=creation;target=self' })
    );
  });

  it('shows the spinner while the mint is in flight', async () => {
    let resolve!: (v: unknown) => void;
    mintDeviceLink.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const wrapper = mountLine();
    await wrapper.find('[data-testid="phone-handoff-toggle"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="spinner"]').exists()).toBe(true);
    resolve({ link: LINK });
    await flushPromises();
    expect(wrapper.find('[data-testid="spinner"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="panel"]').exists()).toBe(true);
  });

  it('renders the translated error on a refused mint, and a second tap retries', async () => {
    mintDeviceLink.mockResolvedValueOnce({
      errorKey: 'recovery.podNotOpen',
      errorCode: 'no_envelope',
    });
    const wrapper = mountLine();
    await wrapper.find('[data-testid="phone-handoff-toggle"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="phone-handoff-error"]').text()).toBe('recovery.podNotOpen');
    expect(wrapper.find('[data-testid="panel"]').exists()).toBe(false);

    mintDeviceLink.mockResolvedValueOnce({ link: LINK });
    await wrapper.find('[data-testid="phone-handoff-toggle"]').trigger('click');
    await flushPromises();
    expect(mintDeviceLink).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="panel"]').exists()).toBe(true);
  });

  it('collapsing and re-opening reuses the minted link instead of minting again', async () => {
    mintDeviceLink.mockResolvedValueOnce({ link: LINK });
    const wrapper = mountLine();
    const toggle = wrapper.find('[data-testid="phone-handoff-toggle"]');
    await toggle.trigger('click');
    await flushPromises();
    await toggle.trigger('click');
    expect(wrapper.find('[data-testid="panel"]').exists()).toBe(false);
    expect(toggle.attributes('aria-expanded')).toBe('false');
    await toggle.trigger('click');
    expect(wrapper.find('[data-testid="panel"]').exists()).toBe(true);
    expect(mintDeviceLink).toHaveBeenCalledTimes(1);
  });
});
