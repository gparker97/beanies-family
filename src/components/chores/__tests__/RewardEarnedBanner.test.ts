/**
 * The weekly reward, reached (#154): the reward's picture, the title and the line are drawn; the
 * picture, confetti and sparkles are decorative; the paint is the brand gradient utilities (a
 * filled mark, the same in both themes), and every motion sits behind a no-preference query.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import RewardEarnedBanner from '../RewardEarnedBanner.vue';
import { repoFile } from '@/test/repoFile';

describe('RewardEarnedBanner', () => {
  it('the picture, the title and the line', () => {
    const w = mount(RewardEarnedBanner, {
      props: { emoji: '🍦', title: 'Ice Cream earned!', line: 'Mia reached it on Thursday.' },
    });
    const root = w.get('[data-testid="reward-earned-banner"]');
    expect(root.classes()).toEqual(
      expect.arrayContaining([
        'bg-gradient-to-br',
        'from-primary-500',
        'to-terracotta-400',
        'text-white',
      ])
    );
    expect(w.get('[data-testid="reward-earned-emoji"]').attributes('aria-hidden')).toBe('true');
    expect(w.get('[data-testid="reward-earned-emoji"]').text()).toContain('🍦');
    expect(w.text()).toContain('Ice Cream earned!');
    expect(w.text()).toContain('Mia reached it on Thursday.');
  });

  it('no line when none is given', () => {
    const w = mount(RewardEarnedBanner, {
      props: { emoji: '🍦', title: 'Ice Cream earned!', line: '' },
    });
    expect(w.findAll('p')).toHaveLength(1);
  });

  it('motion only without reduced motion', () => {
    const css = repoFile('src/components/chores/RewardEarnedBanner.vue');
    const motion = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(motion).toBeGreaterThan(-1);
    expect(css.indexOf('animation:')).toBeGreaterThan(motion);
  });
});
