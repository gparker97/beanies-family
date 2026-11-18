import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ on: true }));
vi.mock('@/config/flags', () => ({
  isFlagEnabled: (id: string) => (id === 'placeSuggestions' ? flags.on : false),
}));

import { CALL_SERVICES, MAPS_HOSTS } from '@/constants/callServices';
import { safeExternalHref } from '@/utils/url';
import {
  describeLocation,
  linkKindOf,
  locationLinksEnabled,
  parseLocation,
  withMeetingUrl,
} from '../locationLinks';
import { mapsHref } from '../placeText';

const legacy = (text: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;

beforeEach(() => {
  flags.on = true;
});

describe('CALL_SERVICES table', () => {
  it.each(CALL_SERVICES.map((s) => [s.name, s] as const))('%s', (_name, service) => {
    expect(Object.isFrozen(CALL_SERVICES)).toBe(true);
    const { links } = parseLocation(service.sample);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: 'call', service: service.name });
    for (const host of service.hosts) {
      expect(linkKindOf(`https://${host}/x`)).toMatchObject({
        kind: 'call',
        service: service.name,
      });
      expect(linkKindOf(`https://sub.${host}/x`).kind).toBe('call');
      // A lookalike host is never the service.
      expect(linkKindOf(`https://${host}.evil.example/`).kind).toBe('web');
      expect(linkKindOf(`https://evil${host}/`).kind).toBe('web');
      // A trailing-dot host is not an entry either: it shows as Open Link.
      expect(linkKindOf(`https://${host}./x`).kind).toBe('web');
    }
  });

  it('an IDN homograph of a call host is not a call (it parses to punycode)', () => {
    const kind = linkKindOf('https://zооm.us/j/1'); // Cyrillic о
    expect(kind.kind).toBe('web');
    expect(kind.host.startsWith('xn--')).toBe(true);
  });

  it('every Maps host is a map link, and google.com only with a /maps path', () => {
    for (const host of MAPS_HOSTS) expect(linkKindOf(`https://${host}/abc`).kind).toBe('map');
    expect(linkKindOf('https://www.google.com/maps/place/x').kind).toBe('map');
    expect(linkKindOf('https://google.com/maps').kind).toBe('map');
    expect(linkKindOf('https://www.google.com/mapsearch').kind).toBe('web');
    expect(linkKindOf('https://www.google.com/search?q=x').kind).toBe('web');
  });
});

describe('parseLocation', () => {
  it('a bare call host with a path is a call', () => {
    const { place, links } = parseLocation('zoom.us/j/1');
    expect(place).toBe('');
    expect(links).toEqual([
      { href: 'https://zoom.us/j/1', kind: 'call', service: 'Zoom', host: 'zoom.us' },
    ]);
  });

  it('a bare www. host is a web link; another bare host is place text', () => {
    expect(parseLocation('www.swimschool.example/term-4').links[0]?.kind).toBe('web');
    expect(parseLocation('swimschool.example/term-4').links).toEqual([]);
  });

  it.each([
    'St.Regis Hotel',
    'Mt.Pleasant Rd',
    '12 Rd.Singapore',
    'Jln.Besar/Kitchener',
    'Library',
    'Corner of Main St.and 5th',
  ])('"%s" is a place, not a link', (text) => {
    const parsed = parseLocation(text);
    expect(parsed.links).toEqual([]);
    expect(parsed.place).toBe(text);
  });

  it('a pasted Google Maps URL keeps its commas and is a map link', () => {
    const url = 'https://www.google.com/maps/place/Lido/@1.29,103.85,17z';
    const { place, links } = parseLocation(`${url}.`);
    expect(place).toBe('');
    expect(links).toEqual([{ href: url, kind: 'map', host: 'www.google.com' }]);
  });

  it('an address and a call show both, with the separators tidied', () => {
    const parsed = parseLocation('Room 3, 12 Main St https://meet.google.com/abc-defg-hij');
    expect(parsed.place).toBe('Room 3, 12 Main St');
    expect(parsed.links.map((l) => [l.kind, l.service])).toEqual([['call', 'Google Meet']]);
    expect(parseLocation('Zoom: https://zoom.us/j/1, Room 2').place).toBe('Zoom, Room 2');
  });

  it.each([
    ['Online: https://meet.google.com/abc-defg-hij.', 'https://meet.google.com/abc-defg-hij'],
    ['Call https://zoom.us/j/123.', 'https://zoom.us/j/123'],
    ['(https://zoom.us/j/123)', 'https://zoom.us/j/123'],
    ['https://zoom.us/j/123;', 'https://zoom.us/j/123'],
    ['https://zoom.us/j/123,', 'https://zoom.us/j/123'],
    [
      'see https://en.wikipedia.org/wiki/Bean_(plant).',
      'https://en.wikipedia.org/wiki/Bean_(plant)',
    ],
    [
      'https://www.google.com/maps/place/X/@1.28,103.85,17z.',
      'https://www.google.com/maps/place/X/@1.28,103.85,17z',
    ],
  ])('sentence punctuation after a link is not part of it: %s', (text, href) => {
    expect(parseLocation(text).links.map((l) => l.href)).toEqual([href]);
  });

  it.each([
    ['Join <https://zoom.us/j/123?pwd=abc>', 'https://zoom.us/j/123?pwd=abc', 'Join'],
    ['"https://meet.google.com/abc-defg-hij"', 'https://meet.google.com/abc-defg-hij', ''],
    ["'https://zoom.us/j/1'", 'https://zoom.us/j/1', ''],
    ['[https://zoom.us/j/1]', 'https://zoom.us/j/1', ''],
    ['{https://zoom.us/j/1}', 'https://zoom.us/j/1', ''],
    ['`https://zoom.us/j/1`', 'https://zoom.us/j/1', ''],
    ['Zoom (https://zoom.us/j/1)', 'https://zoom.us/j/1', 'Zoom'],
    ['Zoom ( https://zoom.us/j/1 )', 'https://zoom.us/j/1', 'Zoom'],
    [
      'Online: https://meet.google.com/abc-defg-hij.',
      'https://meet.google.com/abc-defg-hij',
      'Online',
    ],
    ['Call https://zoom.us/j/1!', 'https://zoom.us/j/1', 'Call'],
    ['Call https://zoom.us/j/1?', 'https://zoom.us/j/1', 'Call'],
    ['Call https://zoom.us/j/1:', 'https://zoom.us/j/1', 'Call'],
    ['Call https://zoom.us/j/1...', 'https://zoom.us/j/1', 'Call'],
    ['Call https://zoom.us/j/1\u2026', 'https://zoom.us/j/1', 'Call'],
    ['Call https://zoom.us/j/1?pwd=x', 'https://zoom.us/j/1?pwd=x', 'Call'],
    ['Zoom: https://zoom.us/j/1, Room 2', 'https://zoom.us/j/1', 'Zoom, Room 2'],
  ])('a link wrapped in brackets, quotes or punctuation: %s', (text, href, place) => {
    const parsed = parseLocation(text);
    expect(parsed.links.map((l) => l.href)).toEqual([href]);
    expect(parsed.place).toBe(place);
    expect(parsed.mapQuery).toBe(place);
  });

  it('a pasted Google Maps URL with a data path stays whole', () => {
    const url =
      'https://www.google.com/maps/place/Lau+Pa+Sat/@1.2812,103.8448,17z/data=!3m1!4b1!4m6!3m5';
    expect(parseLocation(`Lunch ${url}`).links).toEqual([
      { href: url, kind: 'map', host: 'www.google.com' },
    ]);
  });

  it.each([
    ['Hall (B) https://zoom.us/j/1', 'Hall (B)'],
    ['Room [3] - https://zoom.us/j/1', 'Room [3]'],
    ['"Main Hall" https://zoom.us/j/1', '"Main Hall"'],
    ['Room 3 & 4 https://zoom.us/j/1', 'Room 3 & 4'],
    ['Zoom https://zoom.us/j/1 - Room 2', 'Zoom - Room 2'],
    ['(Room 2) https://zoom.us/j/1', '(Room 2)'],
    ['(Room 2 https://zoom.us/j/1)', '(Room 2)'],
    ['Zoom (https://zoom.us/j/1).', 'Zoom'],
  ])('the tidy never removes typed text with letters or digits: %s', (text, place) => {
    expect(parseLocation(text).place).toBe(place);
  });

  it('a scheme URL never runs into the next one', () => {
    const { links } = parseLocation('https://zoom.us/j/1,https://meet.google.com/abc');
    expect(links.map((l) => l.service)).toEqual(['Zoom', 'Google Meet']);
  });

  it('keeps line breaks in text with no link', () => {
    expect(parseLocation('18 Mosque St\nloft room 12').place).toBe('18 Mosque St\nloft room 12');
  });

  it('never returns an unscreened link', () => {
    const texts = [
      'https://user:pw@zoom.us/j/1',
      'javascript://%0aalert(1)',
      'zoommtg://zoom.us/join?confno=1',
      'https://zoom.us/j/1 http://example.com/x www.a.com',
      `https://${'a'.repeat(9000)}.com`,
    ];
    for (const text of texts) {
      for (const link of parseLocation(text).links) {
        expect(safeExternalHref(link.href)).toBe(link.href);
      }
    }
    expect(parseLocation('https://user:pw@zoom.us/j/1').links).toEqual([]);
  });

  it('non-http schemes stay visible but never reach the map query', () => {
    const zoomApp = parseLocation('zoommtg://zoom.us/join?confno=1');
    expect(zoomApp.links).toEqual([]);
    expect(zoomApp.place).toBe('zoommtg://zoom.us/join?confno=1');
    expect(zoomApp.mapQuery).toBe('');

    const js = parseLocation('Hall B javascript://%0aalert(1)');
    expect(js.links).toEqual([]);
    expect(js.place).toBe('Hall B javascript://%0aalert(1)');
    expect(js.mapQuery).toBe('Hall B');
  });
});

describe('describeLocation (flag on)', () => {
  const PLACE = { placeId: 'ChIJabc', name: '127 S Bridge Rd, Singapore 058285' };

  it('a picked place with detail: the map opens the place, the detail is its own line', () => {
    const view = describeLocation(`${PLACE.name}, block 48 unit 04-19`, PLACE);
    expect(view.placeName).toBe(PLACE.name);
    expect(view.detail).toBe('block 48 unit 04-19');
    expect(view.mapHref).toBe(mapsHref(PLACE.name, PLACE));
    expect(view.oneLine).toEqual([{ kind: 'place', text: `${PLACE.name}, block 48 unit 04-19` }]);
  });

  it('a picked named place: the title, the address and the detail, the map searching the lead', () => {
    const TITLED = { ...PLACE, title: 'The Hungarian Touch' };
    const lead = `The Hungarian Touch, ${PLACE.name}`;
    const view = describeLocation(`${lead}, back room`, TITLED);
    expect(view.placeTitle).toBe('The Hungarian Touch');
    expect(view.placeName).toBe(PLACE.name);
    expect(view.detail).toBe('back room');
    expect(view.mapHref).toBe(mapsHref(lead, TITLED));
    expect(view.oneLine).toEqual([{ kind: 'place', text: `${lead}, back room` }]);
    // No title: no placeTitle key at all.
    expect('placeTitle' in describeLocation(PLACE.name, PLACE)).toBe(false);
    // A titled place whose string lost its title is inert.
    expect(describeLocation(`${PLACE.name}, back room`, TITLED).placeTitle).toBeUndefined();
  });

  it('a title that reads as a link is still the place; only what follows the lead is read for links', () => {
    const CAFE = { ...PLACE, title: 'Zoom.us Cafe' };
    const lead = `Zoom.us Cafe, ${PLACE.name}`;
    const view = describeLocation(`${lead}, back room https://meet.google.com/abc-defg-hij`, CAFE);
    expect(view.placeTitle).toBe('Zoom.us Cafe');
    expect(view.placeName).toBe(PLACE.name);
    expect(view.detail).toBe('back room');
    expect(view.mapHref).toBe(mapsHref(lead, CAFE));
    expect(view.links.map((l) => l.service)).toEqual(['Google Meet']);
  });

  it('a link after the place is never part of the detail', () => {
    const view = describeLocation(`${PLACE.name}, hall https://zoom.us/j/1`, PLACE);
    expect(view.detail).toBe('hall');
    expect(view.links[0]?.kind).toBe('call');
  });

  it('an inert place is ignored: plain text and a text search', () => {
    const view = describeLocation('Somewhere else', PLACE);
    expect(view.placeName).toBeUndefined();
    expect(view.plain).toBe('Somewhere else');
    expect(view.mapHref).toBe(legacy('Somewhere else'));
  });

  it('a call alone has no map link and shows its service name on one line', () => {
    const view = describeLocation('https://zoom.us/j/84512207719?pwd=x7Kq');
    expect(view.mapHref).toBeUndefined();
    expect(view.plain).toBe('');
    expect(view.oneLine).toEqual([{ kind: 'call', text: 'Zoom' }]);
  });

  it('orders one-line parts place, calls, map, links, with no raw URL anywhere', () => {
    const view = describeLocation(
      'https://swim.example/a Room 3 https://maps.app.goo.gl/x https://meet.google.com/abc'
    );
    expect(view.oneLine).toEqual([
      { kind: 'place', text: 'Room 3' },
      { kind: 'call', text: 'Google Meet' },
      { kind: 'map', text: '' },
      { kind: 'link', text: 'swim.example' },
    ]);
  });

  it('empty text describes nothing', () => {
    expect(describeLocation('')).toEqual({ plain: '', mapHref: undefined, links: [], oneLine: [] });
  });
});

describe('describeLocation (flag off): exactly today', () => {
  const PLACE = { placeId: 'ChIJabc', name: 'Lido Pool' };
  const surfaces: Array<[string, boolean]> = [
    ['ActivityViewEditModal / TimelineSegmentCard / PlannerTimedBlock (map today)', true],
    ['EmergencyContactsPage / ExternalEventDetailsModal (no map today)', false],
  ];
  const texts = [
    'Lido Pool, side gate',
    'https://zoom.us/j/1',
    'Room 3, 12 Main St https://meet.google.com/abc',
    '  spaced  ',
    '18 Mosque St\nloft',
  ];
  for (const [surface, mapWhenOff] of surfaces) {
    it(surface, () => {
      flags.on = false;
      for (const text of texts) {
        expect(describeLocation(text, PLACE, { mapWhenOff })).toEqual({
          plain: text,
          mapHref: mapWhenOff ? legacy(text) : undefined,
          links: [],
          oneLine: [{ kind: 'place', text }],
        });
      }
    });
  }

  it('opts.enabled overrides the flag either way', () => {
    flags.on = false;
    expect(describeLocation('https://zoom.us/j/1', null, { enabled: true }).links).toHaveLength(1);
    flags.on = true;
    expect(describeLocation('https://zoom.us/j/1', null, { enabled: false }).links).toEqual([]);
  });

  it('locationLinksEnabled reads the flag', () => {
    flags.on = false;
    expect(locationLinksEnabled()).toBe(false);
    flags.on = true;
    expect(locationLinksEnabled()).toBe(true);
  });
});

describe('withMeetingUrl', () => {
  it('appends the URL, unless the text already holds it', () => {
    expect(withMeetingUrl('Room 3', 'https://meet.google.com/abc')).toBe(
      'Room 3 https://meet.google.com/abc'
    );
    expect(withMeetingUrl('', 'https://meet.google.com/abc')).toBe('https://meet.google.com/abc');
    expect(withMeetingUrl(undefined, 'https://x.example')).toBe('https://x.example');
    expect(withMeetingUrl('Join https://meet.google.com/abc', 'https://meet.google.com/abc')).toBe(
      'Join https://meet.google.com/abc'
    );
    expect(withMeetingUrl('Room 3', undefined)).toBe('Room 3');
  });
});

describe('source guards', () => {
  const SRC = join(__dirname, '..', '..', '..');
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path);
      return /\.(ts|vue)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
    });
  }

  it("the 'placeSuggestions' flag is read only in locationLinks.ts and the flag registry", () => {
    const allowed = new Set([
      'utils/location/locationLinks.ts',
      'config/flagRegistry.ts',
      'config/featureFlags.committed.ts',
      // Reads the COMMITTED state on purpose (never isFlagEnabled), so a dev override cannot
      // publish the help article before the flag ships.
      'content/help/liveFlags.ts',
    ]);
    const offenders = files(SRC)
      .filter((path) => readFileSync(path, 'utf8').includes('placeSuggestions'))
      .map((path) => relative(SRC, path).replace(/\\/g, '/'))
      .filter((path) => !allowed.has(path));
    expect(offenders).toEqual([]);
  });

  /**
   * No surface reads a `*Place` field directly: every reader goes through `validPlace`
   * (`placeText.ts`). Allowed: the location utils, the model, the demo data, and the per-item
   * list editors that write each row's pair through `placePatch`. Every single-field form
   * seeds and writes through `useLocationPair`, which names no sibling, so no form is listed.
   */
  it('no file outside the allowed set touches locationPlace / addressPlace / agencyAddressPlace', () => {
    const allowed = [
      /^utils\/location\//,
      /^types\/models\.ts$/,
      /^services\/demo\/demoFixture\.ts$/,
      /^components\/ui\/LocationField\.vue$/,
      /^components\/common\/LocationLine\.vue$/,
      // Per-item list editors that bind each row's pair inline (write it through `placePatch`).
      /^components\/vacation\/VacationStep[34]\.vue$/,
      // Display surfaces that only HAND the sibling to `describeLocation` / `LocationLine`.
      /^components\/planner\/(ActivityViewEditModal|DayTimeline|PlannerTimedBlock)\.vue$/,
      /^components\/wall\/WallSheet\.vue$/,
      /^composables\/useVacationTimeline\.ts$/,
      /^pages\/(EmergencyContactsPage|FamilyPlannerPage)\.vue$/,
      /^utils\/reminderSchedule\.ts$/,
    ];
    const offenders = files(SRC)
      .filter((path) =>
        /\b(locationPlace|addressPlace|agencyAddressPlace)\b/.test(readFileSync(path, 'utf8'))
      )
      .map((path) => relative(SRC, path).replace(/\\/g, '/'))
      .filter((path) => !allowed.some((re) => re.test(path)));
    expect(offenders).toEqual([]);
  });
});
