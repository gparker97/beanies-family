/**
 * `meetingUrlOf` (#150 P4): the one join link derived from a Google Calendar event.
 * A conference entry point can be written by a third-party add-on on someone else's
 * event, so the result is machine-supplied input and gets `safeHttpsUrl`'s screen.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/automerge/repositories/calendarViewRepository', () => ({
  getAllViewedCalendars: vi.fn(async () => []),
  getCalendarViewAccountById: vi.fn(async () => undefined),
  updateCalendarViewAccount: vi.fn(async () => {}),
}));

import { meetingUrlOf } from '../googleCalendarClient';

const MEET = 'https://meet.google.com/abc-defg-hij';
const ZOOM = 'https://zoom.us/j/1234567890?pwd=x';

describe('meetingUrlOf', () => {
  it('prefers the video entry point over hangoutLink', () => {
    expect(
      meetingUrlOf({
        hangoutLink: MEET,
        conferenceData: {
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:+1-555-0100' },
            { entryPointType: 'video', uri: ZOOM },
          ],
        },
      })
    ).toBe(ZOOM);
  });

  it('falls back to hangoutLink when there is no video entry point', () => {
    expect(meetingUrlOf({ hangoutLink: MEET })).toBe(MEET);
    expect(
      meetingUrlOf({
        hangoutLink: MEET,
        conferenceData: { entryPoints: [{ entryPointType: 'more', uri: 'https://x.test/more' }] },
      })
    ).toBe(MEET);
  });

  it('falls back to hangoutLink when the video entry point fails the screen', () => {
    expect(
      meetingUrlOf({
        hangoutLink: MEET,
        // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- the insecure scheme IS the case under test
        conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'http://zoom.us/j/1' }] },
      })
    ).toBe(MEET);
  });

  it.each([
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- the insecure scheme IS the case under test
    ['http://', 'http://meet.google.com/abc-defg-hij'],
    ['javascript:', 'javascript:alert(1)'],
    ['javascript://', 'javascript://%0aalert(1)'],
    ['a non-default port', 'https://meet.google.com:8443/abc'],
    ['over-long', `https://meet.google.com/${'a'.repeat(2100)}`],
  ])('rejects a %s URL', (_label, url) => {
    expect(meetingUrlOf({ hangoutLink: url })).toBeNull();
    expect(
      meetingUrlOf({ conferenceData: { entryPoints: [{ entryPointType: 'video', uri: url }] } })
    ).toBeNull();
  });

  it('returns null when there is no meeting data at all', () => {
    expect(meetingUrlOf({})).toBeNull();
    expect(meetingUrlOf({ conferenceData: {} })).toBeNull();
    expect(meetingUrlOf({ conferenceData: { entryPoints: [] } })).toBeNull();
    expect(meetingUrlOf({ conferenceData: { entryPoints: [{ entryPointType: 'video' }] } })).toBe(
      null
    );
    expect(meetingUrlOf({ hangoutLink: '' })).toBeNull();
  });
});
