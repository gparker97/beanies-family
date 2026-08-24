/**
 * InviteGateOverlay — Discord-first "request an invite" + Plausible funnel.
 *
 * Covers the 2026-06-14 redesign: the no-token path leads primarily to Discord
 * (no email), with the Slack message form as the always-available secondary
 * fallback. Both "request an invite" actions fire a dedicated
 * `invite_request_click` event (method: 'discord' | 'message'). The affordances
 * are ungated (the Discord redirect + marketing home resolve via MARKETING_URL's
 * built-in fallback; the Slack POST guards a missing webhook at submit time), so
 * they always render. The token-unlock flow is unchanged and not re-tested here.
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

import InviteGateOverlay from '../InviteGateOverlay.vue';

const stubs = { BeanieIcon: true };

beforeEach(() => {
  vi.stubGlobal('plausible', vi.fn());
  openDiscordMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const plausibleMock = () => window.plausible as unknown as ReturnType<typeof vi.fn>;

describe('InviteGateOverlay — no-token affordances', () => {
  it('always shows both the Discord CTA and the "send us a message" fallback', () => {
    const wrapper = mount(InviteGateOverlay, { global: { stubs } });
    expect(wrapper.find('[data-testid="invite-gate-discord"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('inviteGate.sendMessage');
  });

  it('Discord CTA opens Discord and fires invite_request_click(discord)', async () => {
    const wrapper = mount(InviteGateOverlay, { global: { stubs } });
    await wrapper.get('[data-testid="invite-gate-discord"]').trigger('click');
    expect(openDiscordMock).toHaveBeenCalledWith('invite-gate');
    expect(plausibleMock()).toHaveBeenCalledWith('invite_request_click', {
      props: { method: 'discord', platform: 'web' },
      interactive: true,
    });
  });

  it('the secondary "send us a message" link opens the Slack request form (webhook configured)', async () => {
    // hasInviteWebhook is captured at setup from VITE_INVITE_WEBHOOK_URL — stub it
    // explicitly so the form-opening path is deterministic in CI (no .env.local there).
    vi.stubEnv('VITE_INVITE_WEBHOOK_URL', 'https://hooks.slack.test/x');
    const wrapper = mount(InviteGateOverlay, { global: { stubs } });
    expect(wrapper.text()).not.toContain('inviteGate.requestTitle');
    await wrapper.get('button.text-primary-500').trigger('click');
    expect(wrapper.text()).toContain('inviteGate.requestTitle');
    expect(wrapper.text()).toContain('inviteGate.privacyNote');
    vi.unstubAllEnvs();
  });

  it('C3: with no webhook configured, "send us a message" routes to Discord (no dead-end form)', async () => {
    // hasInviteWebhook is captured at setup, so stub the env BEFORE mount.
    vi.stubEnv('VITE_INVITE_WEBHOOK_URL', '');
    const wrapper = mount(InviteGateOverlay, { global: { stubs } });

    await wrapper.get('button.text-primary-500').trigger('click');

    // The message form never appears; the user is sent to Discord instead.
    expect(wrapper.text()).not.toContain('inviteGate.requestTitle');
    expect(openDiscordMock).toHaveBeenCalledWith('invite-gate');
    expect(plausibleMock()).toHaveBeenCalledWith('invite_request_click', {
      props: { method: 'discord', platform: 'web' },
      interactive: true,
    });

    vi.unstubAllEnvs();
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
      props: { method: 'message', platform: 'web' },
      interactive: true,
    });
    expect(wrapper.text()).toContain('inviteGate.confirmedTitle');

    vi.unstubAllEnvs();
  });
});
