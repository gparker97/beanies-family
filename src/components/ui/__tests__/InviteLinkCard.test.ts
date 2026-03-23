import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import InviteLinkCard from '@/components/ui/InviteLinkCard.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

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

  it('shows loading spinner when loading', () => {
    const wrapper = mount(InviteLinkCard, {
      props: { ...defaultProps, loading: true },
    });
    expect(wrapper.find('.animate-spin').exists()).toBe(true);
    expect(wrapper.find('[data-testid="invite-qr"]').exists()).toBe(false);
  });

  it('displays scan/share hint text', () => {
    const wrapper = mount(InviteLinkCard, { props: defaultProps });
    expect(wrapper.text()).toContain('family.scanOrShare');
  });

  it('displays expiry note', () => {
    const wrapper = mount(InviteLinkCard, { props: defaultProps });
    expect(wrapper.text()).toContain('family.linkExpiry');
  });

  it('renders actions slot content', () => {
    const wrapper = mount(InviteLinkCard, {
      props: defaultProps,
      slots: {
        actions: '<button data-testid="share-btn">Share</button>',
      },
    });
    expect(wrapper.find('[data-testid="share-btn"]').exists()).toBe(true);
  });
});
