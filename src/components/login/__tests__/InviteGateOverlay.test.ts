/**
 * InviteGateOverlay — Discord-first "request an invite" + Plausible funnel.
 *
 * Covers the 2026-06-14 redesign: the no-token path leads primarily to Discord
 * (no email), with the Slack message form as the secondary fallback, and both
 * "request an invite" actions fire a dedicated `invite_request_click` event
 * (method: 'discord' | 'message'). The token-unlock flow is unchanged and not
 * re-tested here.
 */
import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { openDiscordMock, validateTokenMock } = vi.hoisted(() => ({
  openDiscordMock: vi.fn(),
  validateTokenMock: vi.fn(async () => false),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/utils/discord', () => ({ openDiscord: openDiscordMock }));
vi.mock('@/utils/inviteToken', () => ({ validateInviteToken: validateTokenMock }));
vi.mock('@/utils/email', () => ({ isValidEmail: () => true }));
vi.mock('@/utils/marketing', () => ({ MARKETING_URL: 'https://beanies.family' }));

// Mutable feature flags — the same object reference is returned each import, so
// tests flip props before mounting to exercise the capability matrix.
vi.mock('@/config/features', () => ({
  features: { marketingUrl: true, slackInvite: true, inviteGate: true },
}));
import { features } from '@/config/features';
import InviteGateOverlay from '../InviteGateOverlay.vue';

// The real `features` type is readonly; the mock returns a plain mutable object,
// so cast to flip flags per test (exercising the capability matrix).
const flags = features as unknown as { marketingUrl: boolean; slackInvite: boolean };

const stubs = { BeanieIcon: true };

beforeEach(() => {
  flags.marketingUrl = true;
  flags.slackInvite = true;
  vi.stubGlobal('plausible', vi.fn());
  openDiscordMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const plausibleMock = () => window.plausible as unknown as ReturnType<typeof vi.fn>;

describe('InviteGateOverlay — Discord-first request', () => {
  it('Discord CTA opens Discord and fires invite_request_click(discord)', async () => {
    const wrapper = mount(InviteGateOverlay, { global: { stubs } });
    await wrapper.get('[data-testid="invite-gate-discord"]').trigger('click');
    expect(openDiscordMock).toHaveBeenCalledWith('invite-gate');
    expect(plausibleMock()).toHaveBeenCalledWith('invite_request_click', {
      props: { method: 'discord' },
    });
  });

  it('the secondary "send a message" link switches to the Slack request form', async () => {
    const wrapper = mount(InviteGateOverlay, { global: { stubs } });
    expect(wrapper.text()).toContain('inviteGate.sendMessage');
    // The request form is not shown until the user opts into it.
    expect(wrapper.text()).not.toContain('inviteGate.requestTitle');
    await wrapper.get('button.text-primary-500').trigger('click');
    expect(wrapper.text()).toContain('inviteGate.requestTitle');
    expect(wrapper.text()).toContain('inviteGate.privacyNote');
  });

  it('a successful Slack send fires invite_request_click(message) and confirms', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VITE_INVITE_WEBHOOK_URL', 'https://hooks.slack.test/x');

    const wrapper = mount(InviteGateOverlay, { global: { stubs } });
    await wrapper.get('button.text-primary-500').trigger('click'); // → request mode
    const inputs = wrapper.findAll('input');
    await inputs[0].setValue('Ada'); // name
    await inputs[1].setValue('ada@example.com'); // email
    const sendBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('inviteGate.sendRequest'));
    await sendBtn!.trigger('click');
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(plausibleMock()).toHaveBeenCalledWith('invite_request_click', {
      props: { method: 'message' },
    });
    expect(wrapper.text()).toContain('inviteGate.confirmedTitle');

    vi.unstubAllEnvs();
  });
});

describe('InviteGateOverlay — capability matrix', () => {
  it('Discord CTA is always shown (ungated — the redirect resolves via MARKETING_URL fallback)', () => {
    flags.marketingUrl = false; // even with the env var absent
    const wrapper = mount(InviteGateOverlay, { global: { stubs } });
    expect(wrapper.find('[data-testid="invite-gate-discord"]').exists()).toBe(true);
  });

  it('slackInvite off → Discord CTA only, no "send a message" link', () => {
    flags.slackInvite = false;
    const wrapper = mount(InviteGateOverlay, { global: { stubs } });
    expect(wrapper.find('[data-testid="invite-gate-discord"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('inviteGate.sendMessage');
  });

  it('slackInvite on → Discord CTA primary plus the secondary message link', () => {
    const wrapper = mount(InviteGateOverlay, { global: { stubs } });
    expect(wrapper.find('[data-testid="invite-gate-discord"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('inviteGate.sendMessage');
  });
});
