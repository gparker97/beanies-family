/**
 * #150 flag-off contract for the two read-row shapes (activity view, travel timeline rows, the
 * emergency contact card): the rendered text and the href are today's.
 */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/config/flags', () => ({ isFlagEnabled: () => false }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import LocationLine from '../LocationLine.vue';

const legacy = (text: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
const PLACE = { placeId: 'ChIJ127', name: '127 S Bridge Rd, Singapore 058285' };
const TEXTS = [
  'Hall A',
  '127 South Bridge Road, Singapore 058833',
  '东京都港区',
  'https://us02web.zoom.us/j/84512207719?pwd=secret',
  'Room 3 https://meet.google.com/abc-defg-hij',
  `${PLACE.name}, block 48`,
];

describe.each(TEXTS)('flag off: %j', (text) => {
  it("row: one map link with the text and today's href, no detail, no call button", () => {
    const w = mount(LocationLine, { props: { text, place: PLACE } });
    const map = w.get('[data-testid="location-line-map"]');
    expect(map.attributes('href')).toBe(legacy(text));
    expect(map.text()).toBe(text.replace(/\s+/g, ' ').trim());
    expect(w.find('[data-testid="location-line-detail"]').exists()).toBe(false);
    expect(w.find('[data-testid="location-line-join"]').exists()).toBe(false);
    expect(w.findAll('a')).toHaveLength(1);
  });

  it('compact with mapWhenOff=false (emergency contact): text only, no anchor', () => {
    const w = mount(LocationLine, {
      props: { text, place: PLACE, variant: 'compact', mapWhenOff: false },
    });
    expect(w.find('a').exists()).toBe(false);
    expect(w.text().replace(/\s+/g, ' ')).toBe(`📍 ${text.replace(/\s+/g, ' ').trim()}`);
  });
});
