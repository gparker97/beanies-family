/**
 * CardArt: a card's hero illustration when it has one, else its emoji, on the `card-art`
 * telemetry surface; size and grey-out come from the caller.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CardArt from '@/components/responsibilities/CardArt.vue';

const telemetry = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => telemetry);

beforeEach(() => telemetry.logEvent.mockClear());
afterEach(() => vi.restoreAllMocks());

describe('CardArt', () => {
  it('a hero card shows its illustration at the size asked for', () => {
    const w = mount(CardArt, {
      props: {
        card: { emoji: '🍳', illustration: '/brand/cards/cooking-dinner.webp' },
        imgClass: 'h-20 w-20',
      },
      attrs: { class: 'grayscale opacity-55' },
    });
    const img = w.find('img');
    expect(img.attributes('src')).toBe('/brand/cards/cooking-dinner.webp');
    expect(img.classes()).toEqual(
      expect.arrayContaining(['h-20', 'w-20', 'grayscale', 'opacity-55'])
    );
  });

  it('a card without art (a custom card) shows its emoji', () => {
    const w = mount(CardArt, { props: { card: { emoji: '🏊' } } });
    expect(w.find('img').exists()).toBe(false);
    expect(w.text()).toBe('🏊');
  });

  it('logs a failed image on the card-art surface', async () => {
    const w = mount(CardArt, {
      props: { card: { emoji: '🧺', illustration: '/brand/cards/missing-test.webp' } },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await w.find('img').trigger('error');
    expect(telemetry.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'card-art' })
    );
    expect(w.text()).toBe('🧺');
  });
});
