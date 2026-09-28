/**
 * ImageGlyph: the image when a src is given, the emoji otherwise and on failure. A failed
 * src is remembered for the session (module scope), so it is logged once and every glyph
 * showing it falls back together. Each case uses its own src because that record persists
 * across tests by design.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ImageGlyph from '@/components/ui/ImageGlyph.vue';

const telemetry = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => telemetry);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  telemetry.logEvent.mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

function glyph(src?: string, attrs: Record<string, unknown> = {}) {
  return mount(ImageGlyph, { props: { emoji: '🍳', src, surface: 'card-art' }, attrs });
}

describe('ImageGlyph', () => {
  it('renders the image when a src is given, decorative and not draggable', () => {
    const img = glyph('/brand/cards/a.webp').find('img');
    expect(img.attributes('src')).toBe('/brand/cards/a.webp');
    expect(img.attributes('alt')).toBe('');
    expect(img.attributes('aria-hidden')).toBe('true');
    expect(img.attributes('draggable')).toBe('false');
    expect(img.classes()).toContain('h-6');
  });

  it('renders the emoji when there is no src', () => {
    const w = glyph(undefined);
    expect(w.find('img').exists()).toBe(false);
    expect(w.text()).toBe('🍳');
  });

  it('falls back to the emoji on error, logging once with the file name', async () => {
    const w = glyph('/brand/cards/b.webp');
    await w.find('img').trigger('error');
    expect(w.find('img').exists()).toBe(false);
    expect(w.text()).toBe('🍳');
    expect(telemetry.logEvent).toHaveBeenCalledTimes(1);
    expect(telemetry.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'card-art',
        context: { kind: 'b.webp' },
      })
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('packages/brand/assets/shared/cards/b.webp');
  });

  it('logs only a /brand/ file name; any other src ships a fixed label', async () => {
    await glyph('blob:https://app.example/1234-uuid').find('img').trigger('error');
    expect(telemetry.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { kind: 'non-brand-src' } })
    );
  });

  it('a src that failed renders the emoji straight away later, with no second log', async () => {
    await glyph('/brand/cards/c.webp').find('img').trigger('error');
    const later = glyph('/brand/cards/c.webp');
    expect(later.find('img').exists()).toBe(false);
    expect(later.text()).toBe('🍳');
    expect(telemetry.logEvent).toHaveBeenCalledTimes(1);
  });

  it('two glyphs with the same src both failing log exactly once', async () => {
    const a = glyph('/brand/cards/d.webp');
    const b = glyph('/brand/cards/d.webp');
    const imgA = a.find('img');
    const imgB = b.find('img');
    await Promise.all([imgA.trigger('error'), imgB.trigger('error')]);
    expect(telemetry.logEvent).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(a.find('img').exists()).toBe(false);
    expect(b.find('img').exists()).toBe(false);
  });

  it('a new, unfailed src shows the image again', async () => {
    const w = glyph('/brand/cards/e.webp');
    await w.find('img').trigger('error');
    await w.setProps({ src: '/brand/cards/f.webp' });
    expect(w.find('img').attributes('src')).toBe('/brand/cards/f.webp');
  });

  it('a caller class reaches the image, and the emoji after a failure', async () => {
    const w = glyph('/brand/cards/g.webp', { class: 'grayscale opacity-55' });
    expect(w.find('img').classes()).toEqual(expect.arrayContaining(['grayscale', 'opacity-55']));
    await w.find('img').trigger('error');
    await nextTick();
    expect(w.find('span').classes()).toEqual(expect.arrayContaining(['grayscale', 'opacity-55']));
  });
});
