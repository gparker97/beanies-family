import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import ShareChannelGrid from '@/components/family/ShareChannelGrid.vue';
import { showToast } from '@/composables/useToast';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
}));

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copied: ref(false), copy: vi.fn().mockResolvedValue(true) }),
}));

const defaultProps = {
  link: 'https://app.beanies.family/join?fam=abc&t=xyz',
  familyName: 'Ritterbusch',
  memberName: 'Tim',
};

function mountGrid() {
  return mount(ShareChannelGrid, {
    props: defaultProps,
    global: { stubs: { BeanieIcon: true } },
  });
}

describe('ShareChannelGrid — handleChannel', () => {
  let openSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('opens a web share channel (WhatsApp) in a new tab and emits shared', async () => {
    const wrapper = mountGrid();
    await wrapper.find('[data-testid="invite-channel-whatsapp"]').trigger('click');

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0];
    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(target).toBe('_blank');
    expect(features).toBe('noopener');
    expect(wrapper.emitted('shared')).toEqual([['whatsapp']]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('hands a mailto: channel (Email) to the OS handler via location.href, not window.open', async () => {
    const wrapper = mountGrid();
    await wrapper.find('[data-testid="invite-channel-email"]').trigger('click');

    expect(openSpy).not.toHaveBeenCalled();
    expect(window.location.href).toMatch(/^mailto:\?subject=/);
    expect(wrapper.emitted('shared')).toEqual([['email']]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('hands an sms: channel to the OS handler via location.href', async () => {
    const wrapper = mountGrid();
    await wrapper.find('[data-testid="invite-channel-sms"]').trigger('click');

    expect(openSpy).not.toHaveBeenCalled();
    expect(window.location.href).toMatch(/^sms:\?body=/);
    expect(wrapper.emitted('shared')).toEqual([['sms']]);
  });

  it('shows a silent error toast (no Slack report) when window.open throws', async () => {
    openSpy.mockImplementation(() => {
      throw new Error('blocked');
    });
    const wrapper = mountGrid();
    await wrapper.find('[data-testid="invite-channel-whatsapp"]').trigger('click');

    expect(showToast).toHaveBeenCalledWith(
      'error',
      'inviteWizard.error.channelOpenFailed',
      undefined,
      { silent: true }
    );
    expect(wrapper.emitted('shared')).toBeUndefined();
  });
});
