import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EVENTS_URL, sendMarketingEvent } from '../marketingEvents';

const EV = { kind: 'landing' as const, fields: null, loc: '/' };

describe('sendMarketingEvent origin gate', () => {
  const beacon = vi.fn(() => true);
  const fetchSpy = vi.fn(() => Promise.resolve(new Response()));

  beforeEach(() => {
    beacon.mockClear();
    fetchSpy.mockClear();
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function at(origin: string) {
    vi.stubGlobal('location', { origin, pathname: '/' });
  }

  it.each(['https://beanies.family', 'https://www.beanies.family', 'http://localhost:4321'])(
    'sends from %s',
    (origin) => {
      at(origin);
      sendMarketingEvent(EV);
      expect(beacon).toHaveBeenCalledWith(EVENTS_URL, expect.any(String));
    }
  );

  it.each(['http://localhost:32939', 'https://translate.goog', 'https://app.beanies.family'])(
    'sends nothing from %s (the Lambda would 403 it)',
    (origin) => {
      at(origin);
      sendMarketingEvent(EV);
      expect(beacon).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(console.info).toHaveBeenCalledOnce();
    }
  );

  it('falls back to fetch when sendBeacon refuses', () => {
    at('https://beanies.family');
    beacon.mockReturnValueOnce(false);
    sendMarketingEvent(EV);
    expect(fetchSpy).toHaveBeenCalledWith(EVENTS_URL, expect.objectContaining({ method: 'POST' }));
  });
});
