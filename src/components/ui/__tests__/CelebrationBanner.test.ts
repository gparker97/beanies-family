import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CelebrationBanner from '../CelebrationBanner.vue';
import { fillPraise } from '@/utils/choreCelebration';

const base = { title: 'All done!', body: 'Every chore ticked.', imageAlt: 'Beanies cheering' };

describe('CelebrationBanner', () => {
  it('renders the one action when a label is given, and emits it', async () => {
    const w = mount(CelebrationBanner, { props: { ...base, actionLabel: 'See Overview' } });
    const button = w.find('[data-testid="celebration-banner-action"]');
    expect(button.text()).toBe('See Overview');
    await button.trigger('click');
    expect(w.emitted('action')).toHaveLength(1);
  });

  it('has no button without an action label (a banner that only celebrates)', () => {
    const w = mount(CelebrationBanner, { props: base });
    expect(w.find('[data-testid="celebration-banner-action"]').exists()).toBe(false);
    expect(w.text()).toContain('All done!');
  });

  it('renders its default slot after the pills', () => {
    const w = mount(CelebrationBanner, {
      props: { ...base, pills: ['3 chores'] },
      slots: { default: '<span data-testid="stars">stars</span>' },
    });
    const html = w.html();
    expect(w.find('[data-testid="stars"]').exists()).toBe(true);
    expect(html.indexOf('3 chores')).toBeLessThan(html.indexOf('data-testid="stars"'));
  });

  it('draws one star slot per `stars`, lit, with the celebration hooks', () => {
    const w = mount(CelebrationBanner, { props: { ...base, stars: 3 } });
    expect(w.findAll('[data-celebration-star]')).toHaveLength(3);
    expect(w.get('[data-celebration-stars]').text()).toBe('⭐⭐⭐');
    expect(w.attributes('data-celebration-banner')).toBeDefined();
    expect(w.classes()).not.toContain('is-celebrating');
    expect(w.find('[data-celebration-praise]').exists()).toBe(false);
  });

  it('the chore celebration plays on it: the praise line word by word, the name flagged', () => {
    const w = mount(CelebrationBanner, {
      props: {
        ...base,
        stars: 2,
        actionLabel: 'Show Chores',
        celebration: {
          words: fillPraise('Woohoo, {name}! All done.', { name: 'Pip', block: '', blockWord: '' })
            .words,
          calm: false,
        },
      },
    });
    expect(w.classes()).toContain('is-celebrating');
    const words = w.findAll('[data-praise-word]');
    expect(words.map((s) => s.text())).toEqual(['Woohoo,', 'Pip!', 'All', 'done.']);
    expect(words.map((s) => s.attributes('data-praise-name') ?? '')).toEqual(['', 'true', '', '']);
    // The praise line is decoration (the overlay says it aloud); the real words stay in place.
    expect(w.get('[data-celebration-praise]').attributes('aria-hidden')).toBe('true');
    expect(w.text()).toContain('All done!');
  });

  it('reduced motion: the calm form (stars lit, only the words swapped)', () => {
    const w = mount(CelebrationBanner, {
      props: {
        ...base,
        stars: 2,
        celebration: { words: [{ text: 'Nice!', name: false }], calm: true },
      },
    });
    expect(w.classes()).toContain('is-calm');
    expect(w.classes()).not.toContain('is-celebrating');
  });

  it('the short horizontal strip (the app from 768px), marked for the celebration to find', () => {
    const w = mount(CelebrationBanner, {
      props: { ...base, strip: true, stars: 3, actionLabel: 'Show Chores' },
    });
    expect(w.classes()).toContain('is-strip');
    expect(w.attributes('data-celebration-strip')).toBeDefined();
    expect(w.get('[data-celebration-picture]').classes()).toContain('w-24');
    expect(w.get('h3').classes()).toContain('text-lg');
    expect(w.findAll('[data-celebration-star]')).toHaveLength(3);
    // The tall form carries no strip mark.
    expect(mount(CelebrationBanner, { props: base }).attributes('data-celebration-strip')).toBe(
      undefined
    );
  });

  it('has a compact strip form (the wall lanes) with a smaller picture and title', () => {
    const full = mount(CelebrationBanner, { props: base });
    const compact = mount(CelebrationBanner, { props: { ...base, compact: true } });
    expect(full.find('img').classes()).toContain('w-44');
    expect(full.find('h3').classes()).toContain('text-2xl');
    expect(compact.find('img').classes()).toContain('w-24');
    expect(compact.find('h3').classes()).toContain('text-lg');
  });
});
