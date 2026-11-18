/**
 * `ExternalEventDetailsModal` (plan 2026-11-17, C1): the read-only details of a view-only
 * event. No edit, no delete; "Open in Google Calendar" only where the host allows it and
 * Google gave the event a link.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExternalEventDetailsModal from '../ExternalEventDetailsModal.vue';
import { externalEvent } from '@/test/monthCellFixtures';
import { UI_STRINGS } from '@/services/translation/uiStrings';
import type { ExternalEvent } from '@/types/externalEvents';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => (UI_STRINGS as Record<string, string>)[k] ?? k }),
}));

const openExternal = vi.hoisted(() => vi.fn());
vi.mock('@/utils/openExternal', () => ({ openExternal }));

/** The #150 location-links flag, off by default (today's behaviour). */
const flags = vi.hoisted(() => ({ on: false }));
vi.mock('@/config/flags', () => ({
  isFlagEnabled: (id: string) => (id === 'placeSuggestions' ? flags.on : false),
}));

const BaseModal = {
  props: ['open', 'title', 'size'],
  emits: ['close'],
  template:
    '<div v-if="open"><h2 data-testid="modal-title">{{ title }}</h2><slot /><slot name="footer" /></div>',
};

const LINK = 'https://www.google.com/calendar/event?eid=abc';

function open(event: ExternalEvent | null, showGoogleLink?: boolean, interactive?: boolean) {
  return mount(ExternalEventDetailsModal, {
    props: {
      event,
      open: true,
      ...(showGoogleLink === undefined ? {} : { showGoogleLink }),
      ...(interactive === undefined ? {} : { interactive }),
    },
    global: { stubs: { BaseModal } },
  });
}

const find = (w: ReturnType<typeof open>, id: string) => w.find(`[data-testid="${id}"]`);

beforeEach(() => {
  openExternal.mockReset();
  flags.on = false;
});

describe('ExternalEventDetailsModal', () => {
  it('shows the title, the source, when, where and the view-only note', () => {
    const w = open(
      externalEvent('Babysitting', {
        ymd: '2026-11-18',
        start: '15:00',
        end: '17:00',
        location: 'Our house',
        htmlLink: LINK,
      })
    );
    expect(find(w, 'modal-title').text()).toBe('Babysitting');
    expect(find(w, 'external-event-source').text()).toContain("Grandma's calendar");
    expect(find(w, 'external-event-when').text()).toBe('Wed, 18 Nov 2026, 3pm to 5pm');
    expect(find(w, 'external-event-where').text()).toBe('Our house');
    expect(find(w, 'external-event-note').text()).toContain('lives in Google Calendar');
  });

  it('busy-only: reads "Busy", shows no place, and says the calendar shares busy times only', () => {
    const w = open(
      externalEvent('x', {
        busyOnly: true,
        title: undefined,
        location: undefined,
        calendarName: "Dad's work",
        htmlLink: LINK,
      })
    );
    expect(find(w, 'modal-title').text()).toBe('Busy');
    expect(find(w, 'external-event-where').exists()).toBe(false);
    expect(find(w, 'external-event-note').text()).toContain('shares busy times only');
    // The link is the event's own, so it is still offered for a busy-only event.
    expect(find(w, 'external-event-open-google').exists()).toBe(true);
  });

  it('opens the event in Google Calendar through openExternal', async () => {
    const w = open(externalEvent('Babysitting', { htmlLink: LINK }));
    await find(w, 'external-event-open-google').trigger('click');
    expect(openExternal).toHaveBeenCalledWith(LINK);
  });

  it('offers no Google link when the host turns it off (the wall)', () => {
    const w = open(externalEvent('Babysitting', { htmlLink: LINK }), false);
    expect(find(w, 'external-event-open-google').exists()).toBe(false);
  });

  it('offers no Google link when the event has none', () => {
    const w = open(externalEvent('Babysitting'));
    expect(find(w, 'external-event-open-google').exists()).toBe(false);
  });

  it('a multi-day all-day event reads as a date range', () => {
    const w = open(
      externalEvent('Grandma away', {
        allDay: true,
        ymd: '2026-11-25',
        endYmd: '2026-11-27',
      })
    );
    expect(find(w, 'external-event-when').text()).toBe('Wed, 25 Nov 2026 to Fri, 27 Nov 2026');
  });

  it('a single all-day event reads "{date}, all day"', () => {
    const w = open(externalEvent('Grandma away', { allDay: true, ymd: '2026-11-25' }));
    expect(find(w, 'external-event-when').text()).toBe('Wed, 25 Nov 2026, all day');
  });

  it('offers no edit or delete control', () => {
    const w = open(externalEvent('Babysitting', { htmlLink: LINK }));
    const buttons = w.findAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.text()).toBe('Open in Google Calendar');
  });

  it('renders nothing for a null event', () => {
    const w = open(null);
    expect(find(w, 'external-event-details').exists()).toBe(false);
  });

  describe('the meeting link (#150 P4)', () => {
    const MEET = 'https://meet.google.com/abc-defg-hij';
    const meeting = () =>
      externalEvent('Standup', { location: 'Room 3', meetingUrl: MEET, htmlLink: LINK });

    it('flag off: the where row is today’s plain text, with no link or button', () => {
      // With the flag off the store never sets `meetingUrl`, so the event is as today.
      const w = open(externalEvent('Babysitting', { location: 'Our house https://x.test/a' }));
      const where = find(w, 'external-event-where');
      expect(where.text()).toBe('Our house https://x.test/a');
      expect(where.find('a').exists()).toBe(false);
      expect(where.find('button').exists()).toBe(false);
      expect(where.find('[data-testid="location-line"]').exists()).toBe(false);
    });

    it('flag on: renders Join Call that opens the screened link', async () => {
      flags.on = true;
      const w = open(meeting());
      const join = find(w, 'location-line-join');
      expect(join.exists()).toBe(true);
      expect(join.text()).toBe('Join Google Meet Call');
      await join.trigger('click');
      expect(openExternal).toHaveBeenCalledWith(MEET);
      expect(find(w, 'external-event-where').text()).toContain('Room 3');
    });

    it('flag on, not interactive (the wall): the call shows by name with nothing to tap', () => {
      flags.on = true;
      const w = open(meeting(), false, false);
      const where = find(w, 'external-event-where');
      expect(where.text()).toContain('Google Meet call');
      expect(where.text()).toContain('Join from your phone');
      expect(where.find('a').exists()).toBe(false);
      expect(where.find('button').exists()).toBe(false);
    });

    it('a busy-only event shows no where row even if a link slipped through', () => {
      flags.on = true;
      const w = open(externalEvent('x', { busyOnly: true, title: undefined, meetingUrl: MEET }));
      expect(find(w, 'external-event-where').exists()).toBe(false);
      expect(find(w, 'location-line-join').exists()).toBe(false);
    });
  });
});
