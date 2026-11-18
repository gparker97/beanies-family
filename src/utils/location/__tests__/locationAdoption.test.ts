/**
 * #150 adoption: the flag-off contract per surface kind (the rendered text and every href are
 * today's), and the flag-on behaviour of the surfaces that change shape (one-line, reminder
 * context, wall).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ on: false }));
vi.mock('@/config/flags', () => ({
  isFlagEnabled: (id: string) => (id === 'placeSuggestions' ? flags.on : false),
}));

import { formatLocationOneLine } from '@/composables/useLocationOneLine';
import type { FamilyActivity, FamilyMember, PlaceRef } from '@/types/models';
import { activityReminderContext } from '@/utils/reminderSchedule';
import { describeLocation } from '../locationLinks';
import { placePatch } from '../placeText';
import { wallLocation } from '../wallLocation';

const legacy = (text: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;

/** Spellings that exercise the flag-off path: padding, links, abbreviations, CJK, newlines. */
const FLAG_OFF_TEXTS = [
  'Hall A',
  '  padded  ',
  'Library',
  'St.Regis Hotel, Singapore',
  '127 South Bridge Road, Singapore 058833',
  '东京都港区',
  'https://us02web.zoom.us/j/84512207719?pwd=secret',
  'Room 3 https://meet.google.com/abc-defg-hij',
  'Line one\nLine two',
  'zoommtg://zoom.us/join?confno=1',
];

const T: Record<string, string> = {
  'location.callOf': '{service} call',
  'location.mapLink': 'Map Link',
  'location.joinFromPhone': 'Join from your phone',
};
const t = (key: string) => T[key] ?? key;

const PLACE: PlaceRef = { placeId: 'ChIJ127', name: '127 S Bridge Rd, Singapore 058285' };

beforeEach(() => {
  flags.on = false;
});

describe('flag off: every surface kind renders today', () => {
  it.each(FLAG_OFF_TEXTS)('%j', (text) => {
    const view = describeLocation(text, PLACE);
    // Read row + travel map rows: the text itself, today's search href.
    expect(view.plain).toBe(text);
    expect(view.mapHref).toBe(legacy(text));
    expect(view.links).toEqual([]);
    expect(view.placeName).toBeUndefined();
    expect(view.detail).toBeUndefined();
    // A surface with no map link today (emergency contact): same text, no href.
    expect(describeLocation(text, PLACE, { mapWhenOff: false }).mapHref).toBeUndefined();
    // One-line surfaces: "📍 text" (timed block, timeline) or the bare text (confirm, import).
    expect(formatLocationOneLine(view.oneLine, t, true)).toBe(`📍 ${text}`);
    expect(formatLocationOneLine(view.oneLine, t, false)).toBe(text);
    // Wall: the stored text, nothing under it.
    expect(wallLocation(text, PLACE, t)).toEqual({ main: text, subs: [] });
  });

  it('the reminder context carries the stored location string, as today', () => {
    for (const text of FLAG_OFF_TEXTS) {
      expect(reminder({ location: text, locationPlace: PLACE }).who).toEqual(['Mia', text]);
    }
  });
});

describe('flag on: single-line, reminder and wall shapes', () => {
  beforeEach(() => {
    flags.on = true;
  });

  it('one line: place, call, link and map parts are prefixed and joined with a middle dot', () => {
    const text = `${PLACE.name}, block 48 https://meet.google.com/abc-defg-hij https://example.com/a`;
    const { oneLine } = describeLocation(text, PLACE);
    expect(formatLocationOneLine(oneLine, t, true)).toBe(
      `📍 ${PLACE.name}, block 48 · 🎥 Google Meet call · 🔗 example.com`
    );
    expect(
      formatLocationOneLine(describeLocation('https://maps.app.goo.gl/x').oneLine, t, false)
    ).toBe('Map Link');
  });

  it('a call shows as its service name in the reminder context and never as a URL', () => {
    const url = 'https://us02web.zoom.us/j/84512207719?pwd=secret';
    const who = reminder({ location: `Room 3 ${url}` }).who;
    expect(who).toEqual(['Mia', 'Room 3', 'Zoom']);
    expect(JSON.stringify(who)).not.toMatch(/https?:|secret/);
    expect(reminder({ location: url }).who).toEqual(['Mia', 'Zoom']);
  });

  it('the wall shows the place with its detail under it, and a call by service name, no link', () => {
    expect(wallLocation(`${PLACE.name}, block 48 unit 04-19`, PLACE, t)).toEqual({
      main: PLACE.name,
      subs: ['block 48 unit 04-19'],
    });
    expect(wallLocation('https://us02web.zoom.us/j/84512207719?pwd=secret', undefined, t)).toEqual({
      main: 'Zoom call',
      subs: ['Join from your phone'],
    });
    const mixed = wallLocation('Room 3 https://meet.google.com/abc-defg-hij', undefined, t)!;
    expect(mixed.main).toBe('Room 3');
    expect(mixed.subs).toEqual(['Google Meet call', 'Join from your phone']);
    expect(JSON.stringify(mixed)).not.toMatch(/https?:/);
  });
});

describe('placePatch spelling used by the forms', () => {
  it('writes the string as given and a place only while it is valid for it', () => {
    expect(placePatch('location', 'Hall A', undefined)).toEqual({
      location: 'Hall A',
      locationPlace: undefined,
    });
    expect(placePatch('address', `${PLACE.name}, level 2`, PLACE)).toEqual({
      address: `${PLACE.name}, level 2`,
      addressPlace: PLACE,
    });
    expect(placePatch('agencyAddress', 'Somewhere else', PLACE)).toEqual({
      agencyAddress: 'Somewhere else',
      agencyAddressPlace: undefined,
    });
  });
});

function reminder(over: Partial<FamilyActivity>): { who: string[] } {
  const mia = { id: 'm1', name: 'Mia' } as unknown as FamilyMember;
  const activity = {
    id: 'a1',
    title: 'Piano',
    date: '2026-06-03',
    recurrence: 'none',
    category: 'music',
    assigneeIds: ['m1'],
    isActive: true,
    ...over,
  } as unknown as FamilyActivity;
  return activityReminderContext(activity, mia, (id) => (id === 'm1' ? mia : undefined));
}
