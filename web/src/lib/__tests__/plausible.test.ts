import { describe, it, expect, vi, afterEach } from 'vitest';
import { track } from '../plausible';

type Win = { plausible?: unknown };

describe('track', () => {
  afterEach(() => {
    delete (window as Win).plausible;
    vi.restoreAllMocks();
  });

  it('calls window.plausible with the name and props', () => {
    const plausible = vi.fn();
    (window as Win).plausible = plausible;
    track('Musical: Progress', { location: 'homepage-hero', percent: '25' });
    expect(plausible).toHaveBeenCalledWith('Musical: Progress', {
      props: { location: 'homepage-hero', percent: '25' },
    });
  });

  it('catches a throwing plausible and warns with a hint', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('boom');
    (window as Win).plausible = () => {
      throw err;
    };
    expect(() => track('Musical: Seen', { location: 'homepage-hero' })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(
      /^\[plausible\] could not send Musical: Seen; check the Plausible loader/
    );
    expect(warn.mock.calls[0][1]).toBe(err);
  });

  it('is a quiet no-op when Plausible is absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => track('Musical: Seen', { location: 'homepage-hero' })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
