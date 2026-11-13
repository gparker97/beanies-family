import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CelebrationBanner from '../CelebrationBanner.vue';

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

  it('has a compact strip form (the wall lanes) with a smaller picture and title', () => {
    const full = mount(CelebrationBanner, { props: base });
    const compact = mount(CelebrationBanner, { props: { ...base, compact: true } });
    expect(full.find('img').classes()).toContain('w-44');
    expect(full.find('h3').classes()).toContain('text-2xl');
    expect(compact.find('img').classes()).toContain('w-24');
    expect(compact.find('h3').classes()).toContain('text-lg');
  });
});
