import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import MintedLinkPanel from '@/components/ui/MintedLinkPanel.vue';

const shareMock = vi.fn();
const isNativeMock = vi.fn(() => false);
const logEventMock = vi.fn();

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useShareText', () => ({
  useShareText: () => ({ share: shareMock }),
}));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => isNativeMock() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (e: unknown) => logEventMock(e) }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const LINK = 'https://app.beanies.family/#/magic?k=abc123';
const props = {
  link: LINK,
  qrUrl: 'data:image/png;base64,x',
  surface: 'test-surface',
  qrAlt: 'qr',
  hint: 'hint',
};

function setNavShare(fn: unknown) {
  Object.defineProperty(navigator, 'share', { value: fn, configurable: true, writable: true });
}

describe('MintedLinkPanel', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    isNativeMock.mockReturnValue(false);
    setNavShare(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setNavShare(undefined);
  });

  it('copies the link and shows the copied state', async () => {
    const wrapper = mount(MintedLinkPanel, { props });
    const btn = wrapper.find('[data-testid="copy-link"]');
    expect(btn.attributes('aria-label')).toBe('login.copyLink');
    await btn.trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(btn.attributes('aria-label')).toBe('login.copied');
    expect(wrapper.find('[aria-live="polite"]').text()).toBe('login.copied');
    expect(wrapper.find('[data-testid="copy-error"]').exists()).toBe(false);
  });

  it('shows the copy-error line when the copy fails', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const wrapper = mount(MintedLinkPanel, { props });
    await wrapper.find('[data-testid="copy-link"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="copy-error"]').text()).toContain('share.copyFailedHelp');
  });

  it('hides the share button when neither native nor navigator.share exists', () => {
    const wrapper = mount(MintedLinkPanel, { props });
    expect(wrapper.find('[data-testid="share-link"]').exists()).toBe(false);
  });

  it.each([
    [true, 'shared'],
    [false, 'dismissed'],
  ])('shares the bare link on the web (result %s) and logs %s', async (result, action) => {
    setNavShare(vi.fn());
    shareMock.mockResolvedValue(result);
    const wrapper = mount(MintedLinkPanel, { props });
    const btn = wrapper.find('[data-testid="share-link"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes('aria-label')).toBe('login.shareLink');
    await btn.trigger('click');
    await flushPromises();
    expect(shareMock).toHaveBeenCalledWith('magicLink.shareTitle', LINK, 'test-surface');
    expect(logEventMock).toHaveBeenCalledWith({
      level: 'info',
      surface: 'test-surface',
      message: 'magic link share',
      context: { action, kind: 'web' },
    });
  });

  it('shows the share button on native even without navigator.share', async () => {
    isNativeMock.mockReturnValue(true);
    shareMock.mockResolvedValue(true);
    const wrapper = mount(MintedLinkPanel, { props });
    const btn = wrapper.find('[data-testid="share-link"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    await flushPromises();
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'shared', kind: 'native' } })
    );
  });
});
