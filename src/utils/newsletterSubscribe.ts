/**
 * Sign-up newsletter opt-in: a hidden cross-origin form post to Substack's free-subscribe
 * endpoint (`VITE_NEWSLETTER_SUBSCRIBE_URL`).
 *
 * Self-gated on `features.newsletter`: a dev build, every test and a self-host leave the URL
 * unset, so nothing is created and Substack is never contacted. The post targets a hidden
 * iframe, so the response is opaque: a Substack 4xx/5xx cannot be seen from here. Only a throw
 * while building or submitting the form is observable, and that is logged (never swallowed).
 */
import { features } from '@/config/features';
import { logEvent } from '@/services/telemetry';

export function submitNewsletterSignup(email: string): void {
  if (!features.newsletter) return;
  try {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = String(import.meta.env.VITE_NEWSLETTER_SUBSCRIBE_URL);
    form.target = 'substack-subscribe-frame';
    form.style.display = 'none';

    const emailInput = document.createElement('input');
    emailInput.name = 'email';
    emailInput.value = email;
    form.appendChild(emailInput);

    const sourceInput = document.createElement('input');
    sourceInput.name = 'first_url';
    sourceInput.value = 'https://beanies.family/signup';
    form.appendChild(sourceInput);

    const iframe = document.createElement('iframe');
    iframe.name = 'substack-subscribe-frame';
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    form.submit();

    setTimeout(() => {
      form.remove();
      iframe.remove();
    }, 5000);
  } catch (error) {
    logEvent({
      level: 'warn',
      surface: 'newsletter-subscribe',
      message:
        'newsletter form post threw; the opt-in is on the registry row but Substack was not contacted. Check VITE_NEWSLETTER_SUBSCRIBE_URL',
      context: { action: 'form_post_failed' },
      error,
    });
  }
}
