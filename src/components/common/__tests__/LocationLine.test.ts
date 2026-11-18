import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const flags = vi.hoisted(() => ({ on: true }));
const opened = vi.hoisted(() => vi.fn());
vi.mock('@/config/flags', () => ({
  isFlagEnabled: (id: string) => (id === 'placeSuggestions' ? flags.on : false),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/utils/openExternal', () => ({ openExternal: opened }));

import LocationLine from '../LocationLine.vue';
import { joinCaption, locationLabelKey, describeLocation } from '@/utils/location/locationLinks';

const PLACE = { placeId: 'ChIJ127', name: '127 S Bridge Rd, Singapore 058285' };
const legacy = (text: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;

const render = (props: Record<string, unknown>) => mount(LocationLine, { props: props as never });

beforeEach(() => {
  flags.on = true;
  opened.mockClear();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('LocationLine (row)', () => {
  it('a picked place is the map link with the detail on its own line', () => {
    const w = render({ text: `${PLACE.name}, block 48 unit 04-19`, place: PLACE });
    const map = w.get('[data-testid="location-line-map"]');
    expect(map.element.tagName).toBe('A');
    expect(map.attributes('href')).toContain('query_place_id=ChIJ127');
    expect(map.attributes('href')).toContain(`query=${encodeURIComponent(PLACE.name)}&`);
    expect(w.get('[data-testid="location-line-detail"]').text()).toBe('block 48 unit 04-19');
  });

  it('a call is a Join Call button through openExternal, captioned host + path only', async () => {
    const href = 'https://us02web.zoom.us/j/84512207719?pwd=secret#frag';
    const w = render({ text: href });
    expect(w.find('[data-testid="location-line-map"]').exists()).toBe(false);
    const join = w.get('[data-testid="location-line-join"]');
    expect(join.text()).toContain('location.joinCall');
    expect(w.get('[data-testid="location-line-caption"]').text()).toBe(
      'us02web.zoom.us/j/84512207719'
    );
    expect(w.text()).not.toContain('secret');
    await join.trigger('click');
    expect(opened).toHaveBeenCalledWith(href);
  });

  it('a place and a call show both', () => {
    const w = render({ text: 'Room 3, 12 Main St https://meet.google.com/abc-defg-hij' });
    expect(w.get('[data-testid="location-line-map"]').text()).toContain('Room 3, 12 Main St');
    expect(w.findAll('[data-testid="location-line-join"]')).toHaveLength(1);
  });

  it('another web link is an Open Link row from LinkList with no favicon request', () => {
    const w = render({ text: 'https://swimschool.example/term-4' });
    const link = w.get('a[href="https://swimschool.example/term-4"]');
    expect(link.attributes('target')).toBe('_blank');
    expect(w.find('img').exists()).toBe(false);
  });

  it('a pasted Google Maps URL is a map link, never a search for its text', () => {
    const url = 'https://www.google.com/maps/place/Lido/@1.29,103.85,17z';
    const w = render({ text: url });
    expect(w.get('[data-testid="location-line-maplink"]').attributes('href')).toBe(url);
    expect(w.html()).not.toContain('maps/search');
  });

  it('on the wall nothing is a link: a call is its name and "join from your phone"', () => {
    const w = render({
      text: `${PLACE.name}, room 2 https://zoom.us/j/1`,
      place: PLACE,
      interactive: false,
    });
    expect(w.find('a').exists()).toBe(false);
    expect(w.find('button').exists()).toBe(false);
    expect(w.text()).toContain('location.callOf');
    expect(w.text()).toContain('location.joinFromPhone');
    expect(w.get('[data-testid="location-line-detail"]').text()).toBe('room 2');
  });
});

describe('LocationLine (compact)', () => {
  it('keeps the 📍 prefix and joins the detail', () => {
    const w = render({ text: `${PLACE.name}, room 2`, place: PLACE, variant: 'compact' });
    const place = w.get('[data-testid="location-line-place"]');
    expect(place.text()).toBe(`📍 ${PLACE.name}, room 2`);
    expect(place.get('a').attributes('href')).toContain('query_place_id=ChIJ127');
  });
});

describe('flag off: text and hrefs exactly as today', () => {
  beforeEach(() => {
    flags.on = false;
  });

  const texts = [
    'Lido Pool, side gate',
    'https://zoom.us/j/1',
    '127 S Bridge Rd, Singapore 058285, room',
  ];

  it.each(texts)('row (a map link today): %s', (text) => {
    const w = render({ text, place: PLACE });
    const map = w.get('[data-testid="location-line-map"]');
    expect(map.attributes('href')).toBe(legacy(text));
    expect(map.text()).toBe(text);
    expect(w.find('[data-testid="location-line-join"]').exists()).toBe(false);
    expect(w.find('[data-testid="location-line-detail"]').exists()).toBe(false);
  });

  it.each(texts)('compact with mapWhenOff false (no link today): %s', (text) => {
    const w = render({ text, place: PLACE, variant: 'compact', mapWhenOff: false });
    expect(w.find('a').exists()).toBe(false);
    expect(w.get('[data-testid="location-line-place"]').text()).toBe(`📍 ${text}`);
  });
});

describe('helpers', () => {
  it('locationLabelKey: Location or Link only when there is a link', () => {
    expect(locationLabelKey(describeLocation('12 Main St', null, { enabled: true }))).toBe(
      'planner.field.location'
    );
    expect(locationLabelKey(describeLocation('https://zoom.us/j/1', null, { enabled: true }))).toBe(
      'planner.field.locationOrLink'
    );
  });

  it('joinCaption drops the query and fragment and shows an IDN host as punycode', () => {
    expect(joinCaption('https://meet.google.com/abc?authuser=1#x')).toBe('meet.google.com/abc');
    expect(joinCaption('https://whereby.com/')).toBe('whereby.com');
    expect(joinCaption('https://zооm.us/j/1').startsWith('xn--')).toBe(true);
    expect(joinCaption('not a url')).toBe('');
  });
});
