/** The shared progress ring (#148, extracted from Who Owns What's `DeckRing`). */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ProgressRing from '../ProgressRing.vue';

vi.mock('@/utils/prefersReducedMotion', () => ({ prefersReducedMotion: () => true }));

const C = 2 * Math.PI * 42; // stroke 11: radius 47.5 - 5.5

describe('ProgressRing', () => {
  it('draws each segment after the one before it, from a shared circumference', () => {
    const w = mount(ProgressRing, {
      props: {
        segments: [
          { value: 0.5, tone: 'fill' },
          { value: 0.25, tone: 'soft' },
          { value: 2, tone: 'faint' }, // clamped to the whole ring
        ],
      },
    });
    const [track, fill, soft, faint] = w.findAll('circle');
    expect(track!.classes()).toContain('track');
    expect(track!.attributes('r')).toBe('42');
    expect(fill!.attributes('stroke-dasharray')).toBe(`${0.5 * C} ${C}`);
    expect(fill!.attributes('stroke-linecap')).toBe('round');
    expect(fill!.attributes('stroke')).toMatch(/^url\(#progress-ring-/);
    expect(fill!.attributes('stroke-dashoffset')).toBeUndefined();
    expect(soft!.classes()).toContain('soft');
    expect(soft!.attributes('stroke-dashoffset')).toBe(String(-0.5 * C));
    expect(faint!.classes()).toContain('faint');
    expect(faint!.attributes('stroke-dasharray')).toBe(`${C} ${C}`);
    expect(faint!.attributes('stroke-dashoffset')).toBe(String(-0.75 * C));
  });

  it('a segment of zero share draws nothing (no round-capped dot at 12 o’clock)', () => {
    const zero = mount(ProgressRing, { props: { segments: [{ value: 0, tone: 'fill' }] } });
    expect(zero.findAll('circle')).toHaveLength(1); // the track alone
    expect(zero.find('[stroke-linecap="round"]').exists()).toBe(false);
    // DeckRing's three segments with nothing waiting: the other two are drawn exactly as before.
    const deck = mount(ProgressRing, {
      props: {
        segments: [
          { value: 0.5, tone: 'fill' },
          { value: 0, tone: 'soft' },
          { value: 0.5, tone: 'faint' },
        ],
      },
    });
    const [, fill, faint] = deck.findAll('circle');
    expect(deck.findAll('circle')).toHaveLength(3);
    expect(fill!.attributes('stroke-dasharray')).toBe(`${0.5 * C} ${C}`);
    expect(faint!.classes()).toContain('faint');
    expect(faint!.attributes('stroke-dashoffset')).toBe(String(-0.5 * C));
    // NaN and negatives are zero too.
    const odd = mount(ProgressRing, {
      props: {
        segments: [
          { value: Number.NaN, tone: 'fill' },
          { value: -1, tone: 'soft' },
        ],
      },
    });
    expect(odd.findAll('circle')).toHaveLength(1);
  });

  it('a thinner stroke keeps the ring inside the box', () => {
    const w = mount(ProgressRing, { props: { segments: [], strokeWidth: 6 } });
    expect(w.get('circle').attributes('r')).toBe('44.5');
    expect(w.get('circle').attributes('stroke-width')).toBe('6');
  });

  it('renders the centre and the badge slots; the root takes class and aria', () => {
    const w = mount(ProgressRing, {
      props: { segments: [{ value: 1, tone: 'fill' }] },
      attrs: { class: 'h-10 w-10', role: 'img', 'aria-label': 'ring' },
      slots: { default: '<span class="centre">7</span>', badge: '<b class="badge">🍦</b>' },
    });
    expect(w.classes()).toEqual(expect.arrayContaining(['relative', 'h-10', 'w-10']));
    expect(w.attributes('aria-label')).toBe('ring');
    expect(w.get('.centre').text()).toBe('7');
    expect(w.get('.badge').text()).toBe('🍦');
  });

  it('no badge slot, no badge wrapper', () => {
    const w = mount(ProgressRing, { props: { segments: [] } });
    expect(w.findAll('div')).toHaveLength(2); // the root and the centre
  });
});
