/**
 * CreatePodWelcome — the Create-pod welcome / "what to expect" intro that
 * replaces the invite gate. Purely presentational: previews the three setup
 * steps, offers a security-help link, and hands off (dismiss) or backs out
 * (cancel). Never gates. See
 * docs/plans/2026-07-21-remove-invite-gate-create-welcome-modal.md.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logEventMock, openExternalMock, reportErrorMock } = vi.hoisted(() => ({
  logEventMock: vi.fn(),
  openExternalMock: vi.fn(),
  reportErrorMock: vi.fn(),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/telemetry', () => ({ logEvent: logEventMock }));
vi.mock('@/utils/openExternal', () => ({ openExternal: openExternalMock }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));
vi.mock('@/utils/marketing', () => ({ MARKETING_URL: 'https://beanies.family' }));

import CreatePodWelcome from '../CreatePodWelcome.vue';

const stubs = {
  BaseModal: { template: '<div><slot /></div>' },
  BeanieIcon: true,
  PageWelcomeSubtitle: { props: ['text'], template: '<p>{{ text }}</p>' },
};

function render() {
  return mount(CreatePodWelcome, { global: { stubs } });
}

const actionsLogged = () =>
  logEventMock.mock.calls.map((c) => (c[0] as { context?: { action?: string } }).context?.action);

beforeEach(() => {
  logEventMock.mockReset();
  openExternalMock.mockReset();
  reportErrorMock.mockReset();
  sessionStorage.clear();
});

describe('CreatePodWelcome', () => {
  it('renders the hero, the three steps, the security strip, and the CTA', () => {
    const text = render().text();
    expect(text).toContain('createWelcome.title');
    expect(text).toContain('createWelcome.step1Title');
    expect(text).toContain('createWelcome.step2Title');
    expect(text).toContain('createWelcome.step3Title');
    expect(text).toContain('createWelcome.safeText');
    expect(text).toContain('createWelcome.cta');
    // step 3 carries the reused "optional" badge
    expect(text).toContain('onboarding.invite.optional');
  });

  it('logs a "shown" event on mount (no e2e seam)', () => {
    render();
    expect(actionsLogged()).toContain('shown');
  });

  it('CTA emits dismiss and logs a proceed event', async () => {
    const wrapper = render();
    await wrapper.get('[data-testid="create-welcome-cta"]').trigger('click');
    expect(wrapper.emitted('dismiss')).toBeTruthy();
    expect(actionsLogged()).toContain('proceed');
  });

  it('✕ emits cancel and logs a cancel event', async () => {
    const wrapper = render();
    await wrapper.get('[data-testid="create-welcome-cancel"]').trigger('click');
    expect(wrapper.emitted('cancel')).toBeTruthy();
    expect(actionsLogged()).toContain('cancel');
  });

  it('safety link opens the encryption help article and logs help_click', async () => {
    const wrapper = render();
    await wrapper.get('[data-testid="create-welcome-safe-link"]').trigger('click');
    expect(openExternalMock).toHaveBeenCalledWith(
      'https://beanies.family/help/security/zero-knowledge-architecture'
    );
    expect(actionsLogged()).toContain('help_click');
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('a thrown external-link error is reported as a warning and never propagates', async () => {
    openExternalMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const wrapper = render();
    await expect(
      wrapper.get('[data-testid="create-welcome-safe-link"]').trigger('click')
    ).resolves.not.toThrow();
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'create-welcome', severity: 'warning' })
    );
  });

  it.runIf(import.meta.env.DEV)(
    'auto-dismisses under the e2e_auto_auth seam without logging shown',
    () => {
      sessionStorage.setItem('e2e_auto_auth', 'true');
      const wrapper = render();
      expect(wrapper.emitted('dismiss')).toBeTruthy();
      expect(actionsLogged()).not.toContain('shown');
    }
  );
});
