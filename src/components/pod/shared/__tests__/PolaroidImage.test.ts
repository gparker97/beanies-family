/**
 * The loading frame must SAY something.
 *
 * The `loading` branch replaced the placeholder, but the caption only existed inside that
 * placeholder and in the with-image figcaption — so a loading frame rendered a bare gradient
 * and `recipeExtract.attaching` was unreachable on every surface that passed it. The string
 * was dead and nobody noticed, because nothing rendered it in a test.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import PolaroidImage from '../PolaroidImage.vue';

describe('PolaroidImage', () => {
  it('shows the caption while loading, not just a spinner', () => {
    const w = mount(PolaroidImage, {
      props: { src: null, loading: true, caption: 'Adding the photo…' },
      global: { stubs: { BeanieSpinner: true } },
    });
    expect(w.text()).toContain('Adding the photo…');
  });

  it('announces itself to a screen reader while loading', () => {
    const w = mount(PolaroidImage, {
      props: { src: null, loading: true, caption: 'Adding the photo…' },
      global: { stubs: { BeanieSpinner: true } },
    });
    const live = w.find('[role="status"]');
    expect(live.exists()).toBe(true);
    expect(live.attributes('aria-busy')).toBe('true');
  });

  it('still shows the empty-state caption when not loading', () => {
    const w = mount(PolaroidImage, { props: { src: null, caption: 'No photo yet' } });
    expect(w.text()).toContain('No photo yet');
    expect(w.find('[role="status"]').exists()).toBe(false);
  });

  it('shows the image, not the spinner, once loading is done', () => {
    const w = mount(PolaroidImage, {
      props: { src: 'https://x.test/a.jpg', loading: false, caption: 'Pie' },
    });
    expect(w.find('img').exists()).toBe(true);
    expect(w.text()).toContain('Pie');
  });

  describe('a photo that is still propagating (#64 on-device finding)', () => {
    // A freshly-uploaded Drive photo 404s for a few seconds while Drive publishes it and the
    // CDN catches up. Before this, the <img> rendered blank with the caption floating over
    // it, which reads as "the photo saved wrong" rather than "it is still arriving".
    it('retries after a load error instead of showing a broken frame', async () => {
      vi.useFakeTimers();
      try {
        const wrapper = mount(PolaroidImage, {
          props: { src: 'https://lh3.googleusercontent.com/d/abc=w1600', caption: 'Cake' },
          global: { stubs: { BeanieSpinner: true } },
        });

        await wrapper.find('img').trigger('error');
        await wrapper.vm.$nextTick();

        // The arriving-photo treatment, not a broken image.
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('[role="status"]').exists()).toBe(true);

        await vi.advanceTimersByTimeAsync(800);
        await wrapper.vm.$nextTick();

        // And it tries again.
        expect(wrapper.find('img').exists()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not float the caption over a failed image', async () => {
      vi.useFakeTimers();
      try {
        const wrapper = mount(PolaroidImage, {
          props: {
            src: 'https://lh3.googleusercontent.com/d/abc=w1600',
            caption: 'Chocolate Cake',
          },
          global: { stubs: { BeanieSpinner: true } },
        });

        // Exhaust every attempt.
        for (const delay of [700, 1500, 3000, 0]) {
          if (wrapper.find('img').exists()) await wrapper.find('img').trigger('error');
          await vi.advanceTimersByTimeAsync(delay);
          await wrapper.vm.$nextTick();
        }

        // Settles into the empty frame rather than spinning forever...
        expect(wrapper.find('[role="status"]').exists()).toBe(false);
        // ...and the caption is not sitting on top of a broken image.
        expect(wrapper.find('figcaption').exists()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('gives a NEW photo its own attempt budget', async () => {
      vi.useFakeTimers();
      try {
        const wrapper = mount(PolaroidImage, {
          props: { src: 'https://example.com/a.jpg' },
          global: { stubs: { BeanieSpinner: true } },
        });
        await wrapper.find('img').trigger('error');
        await wrapper.vm.$nextTick();

        await wrapper.setProps({ src: 'https://example.com/b.jpg' });
        await wrapper.vm.$nextTick();

        // Not stuck in the previous photo's retry state.
        expect(wrapper.find('img').exists()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('the no-photo placeholder varies by seed (#86)', () => {
    const paths = (seed?: string) =>
      mount(PolaroidImage, {
        props: { src: null, ...(seed ? { variantSeed: seed } : {}) },
        global: { stubs: { BeanieSpinner: true } },
      })
        .findAll('svg path')
        .map((p) => p.attributes('d'))
        .join('|');

    const tint = (seed?: string) =>
      mount(PolaroidImage, {
        props: { src: null, ...(seed ? { variantSeed: seed } : {}) },
        global: { stubs: { BeanieSpinner: true } },
      })
        .find('svg')
        .attributes('style');

    it('WITHOUT a seed, renders exactly what shipped before — the cloche in Terracotta', () => {
      // Every other caller (cook logs, scrapbook) passes no seed, so this is the guarantee
      // that they are untouched by the recipe-card change.
      expect(paths()).toContain(
        'M14 30h36a2 2 0 0 1 2 2v2a18 18 0 0 1-18 18h-4a18 18 0 0 1-18-18v-2a2 2 0 0 1 2-2z'
      );
      expect(tint()).toContain('#E67E22');
    });

    it('is STABLE for a given seed', () => {
      // Random variation would flicker on every re-render; the whole point is that one
      // recipe keeps one look across renders, reloads and devices.
      expect(paths('recipe-abc')).toBe(paths('recipe-abc'));
      expect(tint('recipe-abc')).toBe(tint('recipe-abc'));
    });

    it('DIFFERS across seeds, or a grid would repeat one drawing', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 40; i += 1) seen.add(paths(`recipe-${i}`));
      expect(seen.size).toBeGreaterThan(1);
    });

    it('applies the tint inline, because a computed Tailwind class generates no CSS', () => {
      // The trap this pins: `text-[${tint}]` assembled at runtime is invisible to Tailwind's
      // build-time scanner, so no class exists, `currentColor` inherits from the parent, and
      // the glyph is a subtly wrong colour that nothing catches.
      expect(tint('recipe-abc')).toMatch(/color:/);
    });

    it('keeps the dashed baseline stroke distinct from the outline strokes', () => {
      const w = mount(PolaroidImage, {
        props: { src: null, variantSeed: 'recipe-abc' },
        global: { stubs: { BeanieSpinner: true } },
      });
      const dashed = w.findAll('svg path').filter((p) => p.attributes('stroke-dasharray'));
      expect(dashed).toHaveLength(1);
      expect(dashed[0].attributes('stroke-width')).toBe('1.5');
    });
  });
});
