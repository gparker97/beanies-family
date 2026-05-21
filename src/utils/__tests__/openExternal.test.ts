import { describe, it, expect, vi, afterEach } from 'vitest';
import { openExternal } from '../openExternal';

describe('openExternal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('navigates via a transient out-of-scope target=_blank anchor and cleans up', () => {
    let attrsAtClick: { href: string; target: string; rel: string; connected: boolean } | null =
      null;

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      // Capture the anchor's state at click time (before it's removed).
      attrsAtClick = {
        href: this.href,
        target: this.target,
        rel: this.rel,
        connected: this.isConnected,
      };
    });

    openExternal('https://beanies.family/help');

    expect(clickSpy).toHaveBeenCalledOnce();
    // The anchor must be opened in a real browser tab, out of the PWA scope,
    // with the security posture preserved — and be attached when clicked.
    expect(attrsAtClick).toEqual({
      href: 'https://beanies.family/help',
      target: '_blank',
      rel: 'noopener noreferrer',
      connected: true,
    });
    // No anchor is left behind in the DOM.
    expect(document.querySelector('a')).toBeNull();
  });

  it('does not leak anchors across repeated calls', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    openExternal('https://beanies.family/help');
    openExternal('https://beanies.family/help/whats-new');

    expect(document.querySelectorAll('a')).toHaveLength(0);
  });
});
