/**
 * FlightTrackLink: the flight number reads as plain text outside the tracking window, and as a
 * real anchor to FlightAware inside it, opened through `openExternal` and logged without the
 * flight number. A throwing opener falls back to the anchor's own navigation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import FlightTrackLink from '../FlightTrackLink.vue';

const openExternal = vi.fn();
const logEvent = vi.fn();
const reportError = vi.fn();

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      k === 'travel.flightTrack.ariaLabel'
        ? 'Track {flight} live on FlightAware (opens in a new tab)'
        : k,
  }),
}));
vi.mock('@/utils/openExternal', () => ({ openExternal: (url: string) => openExternal(url) }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (e: unknown) => logEvent(e) }));
vi.mock('@/utils/errorReporter', () => ({ reportError: (e: unknown) => reportError(e) }));

const HREF = 'https://www.flightaware.com/live/flight/SQ321';

beforeEach(() => {
  openExternal.mockReset();
  logEvent.mockReset();
  reportError.mockReset();
});

describe('FlightTrackLink', () => {
  it('renders the plain number with no href (outside the window)', () => {
    const w = mount(FlightTrackLink, { props: { label: 'SQ 321', href: null } });
    expect(w.find('a').exists()).toBe(false);
    expect(w.get('[data-testid="flight-track-plain"]').text()).toBe('SQ 321');
  });

  it('renders an anchor with the href, new-tab rel, aria-label and title inside the window', () => {
    const w = mount(FlightTrackLink, { props: { label: 'SQ 321', href: HREF } });
    const a = w.get('[data-testid="flight-track-link"]');
    expect(a.element.tagName).toBe('A');
    expect(a.attributes('href')).toBe(HREF);
    expect(a.attributes('target')).toBe('_blank');
    expect(a.attributes('rel')).toBe('noopener noreferrer');
    expect(a.attributes('aria-label')).toBe(
      'Track SQ 321 live on FlightAware (opens in a new tab)'
    );
    expect(a.attributes('title')).toBe(a.attributes('aria-label'));
    expect(a.text()).toContain('SQ 321');
  });

  it('a tap opens through openExternal, prevents the default and logs no flight data', async () => {
    const w = mount(FlightTrackLink, { props: { label: 'SQ 321', href: HREF } });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    w.get('a').element.dispatchEvent(event);
    expect(openExternal).toHaveBeenCalledWith(HREF);
    expect(event.defaultPrevented).toBe(true);
    expect(logEvent).toHaveBeenCalledTimes(1);
    const record = logEvent.mock.calls[0]![0] as { surface: string; context: unknown };
    expect(record.surface).toBe('flight-track-link');
    expect(record.context).toEqual({ action: 'open', kind: 'flightaware' });
    expect(JSON.stringify(record)).not.toContain('SQ');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('a throwing opener reports a warning and leaves the anchor to navigate', () => {
    openExternal.mockImplementation(() => {
      throw new Error('blocked');
    });
    const w = mount(FlightTrackLink, { props: { label: 'SQ 321', href: HREF } });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    w.get('a').element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'flight-track-link', severity: 'warning' })
    );
  });
});
