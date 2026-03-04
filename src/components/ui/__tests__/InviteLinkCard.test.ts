import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import InviteLinkCard from '@/components/ui/InviteLinkCard.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/composables/useClipboard', () => {
  const copied = { value: false };
  return {
    useClipboard: () => ({
      copied,
      copy: vi.fn().mockImplementation(async () => {
        copied.value = true;
        return true;
      }),
    }),
  };
});

describe('InviteLinkCard', () => {
  const defaultProps = {
    link: 'https://example.com/join?fam=123&t=abc',
    qrUrl: 'data:image/png;base64,fakeQrData',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders QR code image with correct src', () => {
    const wrapper = mount(InviteLinkCard, { props: defaultProps });
    const img = wrapper.find('[data-testid="invite-qr"]');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe(defaultProps.qrUrl);
  });

  it('renders link in code block', () => {
    const wrapper = mount(InviteLinkCard, { props: defaultProps });
    const code = wrapper.find('[data-testid="invite-link-code"]');
    expect(code.exists()).toBe(true);
    expect(code.text()).toBe(defaultProps.link);
  });

  it('shows loading spinner when loading', () => {
    const wrapper = mount(InviteLinkCard, {
      props: { ...defaultProps, loading: true },
    });
    expect(wrapper.find('.animate-spin').exists()).toBe(true);
    expect(wrapper.find('[data-testid="invite-qr"]').exists()).toBe(false);
  });

  it('emits copy event when copy button is clicked', async () => {
    const wrapper = mount(InviteLinkCard, { props: defaultProps });
    const copyButton = wrapper.find('button');
    await copyButton.trigger('click');
    expect(wrapper.emitted('copy')).toBeTruthy();
  });

  it('displays scan/share hint text', () => {
    const wrapper = mount(InviteLinkCard, { props: defaultProps });
    expect(wrapper.text()).toContain('family.scanOrShare');
  });

  it('displays expiry note', () => {
    const wrapper = mount(InviteLinkCard, { props: defaultProps });
    expect(wrapper.text()).toContain('family.linkExpiry');
  });
});
