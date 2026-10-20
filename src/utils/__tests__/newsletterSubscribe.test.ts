import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ features: { newsletter: false }, logEvent: vi.fn() }));
vi.mock('@/config/features', () => ({ features: h.features }));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));

import { submitNewsletterSignup } from '../newsletterSubscribe';

const URL_ = 'https://news.example.test/api/v1/free';

describe('submitNewsletterSignup', () => {
  let submit: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    h.features.newsletter = false;
    vi.stubEnv('VITE_NEWSLETTER_SUBSCRIBE_URL', URL_);
    submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    submit.mockRestore();
    document.body.innerHTML = '';
  });

  it('feature off: no DOM, no post', () => {
    submitNewsletterSignup('a@b.test');
    expect(submit).not.toHaveBeenCalled();
    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('feature on: posts a form to the configured URL carrying the email', () => {
    h.features.newsletter = true;
    submitNewsletterSignup('a@b.test');
    const form = document.querySelector('form') as HTMLFormElement;
    expect(form.action).toBe(URL_);
    expect(form.method.toLowerCase()).toBe('post');
    expect((form.querySelector('input[name="email"]') as HTMLInputElement).value).toBe('a@b.test');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it('a throw is logged at warn, never swallowed', () => {
    h.features.newsletter = true;
    const boom = new Error('boom');
    submit.mockImplementation(() => {
      throw boom;
    });
    expect(() => submitNewsletterSignup('a@b.test')).not.toThrow();
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'newsletter-subscribe',
        context: { action: 'form_post_failed' },
        error: boom,
      })
    );
  });
});
