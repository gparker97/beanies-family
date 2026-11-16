/**
 * Stars and rewards (#148): the grown-up's path strip. It draws `pathSteps` and decides nothing,
 * so these pin what it draws from a given path: the steps (earned, next, ahead, thin), the notch
 * after the bar's step, the reward marker (lit once reached), the avatar, the "This Week" award
 * marker, the captions ("Each step is N stars", "Bar 80%"), the words ("N more stars to X",
 * Achieved with the day, nothing about the bar once it is out of reach), the saved-up line, and
 * the one spoken summary.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/composables/useTranslation', async () => {
  const { UI_STRINGS } = await import('@/services/translation/uiStrings');
  return { useTranslation: () => ({ t: (k: keyof typeof UI_STRINGS) => UI_STRINGS[k] }) };
});
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));

import StarPathStrip from '../StarPathStrip.vue';
import { pathSteps, type WeekStars } from '@/utils/choreStars';
import type { ChoreAward, FamilyMember } from '@/types/models';

/** A live week; only what the strip and `pathSteps` read matters. */
function week(over: Partial<WeekStars>): WeekStars {
  return {
    weekStart: '2026-11-16',
    stars: 0,
    bonus: 0,
    total: 0,
    full: 20,
    bar: 16,
    days: [0, 0, 0, 0, 0, 0, 0],
    done: 0,
    due: 0,
    openToday: 0,
    ahead: 0,
    ...over,
  };
}

const MAX = { id: 'max', name: 'Max' } as FamilyMember;

function mountStrip(w: WeekStars, extra: Record<string, unknown> = {}) {
  return mount(StarPathStrip, {
    props: {
      week: w,
      path: pathSteps(w, (extra.thisWeekAward as ChoreAward | undefined) ?? null),
      rewardTitle: 'Ice cream',
      rewardEmoji: '🍦',
      barPct: 80,
      member: MAX,
      ...extra,
    },
    global: { stubs: { BeanieAvatar: true } },
  });
}

const tones = (w: ReturnType<typeof mountStrip>) =>
  w.findAll('[data-testid="star-path-step"]').map((s) => s.attributes('data-tone'));

describe('StarPathStrip', () => {
  it("one step per star up to 20: earned, today's open chores next, then ahead", () => {
    const w = mountStrip(week({ total: 11, openToday: 2, ahead: 6 }));
    expect(tones(w)).toEqual([
      ...Array(11).fill('earned'),
      ...Array(2).fill('next'),
      ...Array(7).fill('ahead'),
    ]);
    expect(w.find('[data-testid="star-path-caption"]').text()).toBe('Bar 80%');
  });

  it("the notch sits right after the bar's step, under the reward marker", () => {
    const w = mountStrip(week({ total: 11, openToday: 1, ahead: 8 }));
    const track = w.findAll('[data-testid="star-path-step"], [data-testid="star-path-notch"]');
    const notchAt = track.findIndex((el) => el.attributes('data-testid') === 'star-path-notch');
    expect(notchAt).toBe(16);
    expect(w.findAll('[data-testid="star-path-notch"]')).toHaveLength(1);
    const reward = w.get('[data-testid="star-path-reward"]');
    expect(reward.text()).toBe('🍦');
    expect(reward.attributes('data-reached')).toBe('false');
  });

  it('"N more stars to X" in words, the count emphasised', () => {
    const w = mountStrip(week({ total: 11, openToday: 1, ahead: 8 }));
    const more = w.get('[data-testid="star-path-more"]');
    expect(more.text()).toBe('5 more stars to Ice cream');
    expect(more.get('b').text()).toBe('5 more stars');
    expect(more.get('b').classes()).toEqual(
      expect.arrayContaining(['text-primary-700', 'dark:text-accent-lift'])
    );
  });

  it('above 20 stars the steps are scaled and captioned "Each step is N stars"', () => {
    const w = mountStrip(week({ total: 22, full: 40, bar: 32, openToday: 4, ahead: 10 }));
    expect(w.findAll('[data-testid="star-path-step"]')).toHaveLength(20);
    expect(w.attributes('data-steps')).toBe('20');
    expect(w.find('[data-testid="star-path-caption"]').text()).toBe('Each step is 2 stars');
    // 22 stars at 2 a step light 11 steps; a half step never lights.
    expect(tones(w).filter((t) => t === 'earned')).toHaveLength(11);
    const odd = mountStrip(week({ total: 23, full: 40, bar: 32, ahead: 10 }));
    expect(tones(odd).filter((t) => t === 'earned')).toHaveLength(11);
  });

  it('never more than 20 steps, however big the week', () => {
    const w = mountStrip(week({ total: 50, full: 140, bar: 112, ahead: 70 }));
    expect(w.findAll('[data-testid="star-path-step"]').length).toBeLessThanOrEqual(20);
  });

  it('bonus stars past a full week are thin steps', () => {
    const w = mountStrip(week({ total: 20, stars: 16, bonus: 4, full: 16, bar: 13 }));
    const thin = w.findAll('[data-testid="star-path-step"][data-thin="true"]');
    expect(thin).toHaveLength(4);
  });

  it('achieved: the marker lights and the words say Achieved with the day', () => {
    const w = mountStrip(week({ total: 17, hitOn: '2026-11-21' }));
    expect(w.get('[data-testid="star-path-reward"]').attributes('data-reached')).toBe('true');
    expect(w.get('[data-testid="star-path-achieved"]').text()).toContain('Achieved');
    expect(w.text()).toContain('Ice cream, Sat');
    expect(w.find('[data-testid="star-path-more"]').exists()).toBe(false);
    expect(w.attributes('aria-label')).toBe('Ice cream achieved this week, with 17 stars');
  });

  it('out of reach: says nothing about the bar (never "out of reach"), only the week\'s stars', () => {
    // Friday night: 9 of a 16-star bar, nothing left to tick.
    const w = mountStrip(week({ total: 9, openToday: 0, ahead: 0 }));
    expect(w.find('[data-testid="star-path-more"]').exists()).toBe(false);
    expect(w.get('[data-testid="star-path-plain"]').text()).toBe('9 stars this week');
    expect(w.text().toLowerCase()).not.toContain('reach');
    expect(w.attributes('aria-label')).toBe('9 stars this week');
  });

  it("no weekly reward: no notch, no marker, the week's stars", () => {
    const w = mountStrip(week({ total: 6, bar: 0 }));
    expect(w.find('[data-testid="star-path-notch"]').exists()).toBe(false);
    expect(w.find('[data-testid="star-path-reward"]').exists()).toBe(false);
    expect(w.get('[data-testid="star-path-plain"]').text()).toBe('6 stars this week');
  });

  it('the child rides on the step reached; a This Week award has its own marker', () => {
    const award = { emoji: '🎬', unit: 'stars', price: 18 } as ChoreAward;
    const w = mountStrip(week({ total: 6, ahead: 10 }), { thisWeekAward: award, thisWeek: award });
    expect(w.find('[data-testid="star-path-avatar"]').exists()).toBe(true);
    expect(w.get('[data-testid="star-path-award"]').text()).toBe('🎬');
  });

  it('one quiet line for the nearest saved-up award, worded in stars', () => {
    const nearest = {
      award: { id: 'a', title: 'Disneyland', emoji: '🏰', unit: 'stars', price: 160 } as ChoreAward,
      progress: { fraction: 0.4, have: 64, need: 160, cycles: 0, stars: 64 },
    };
    const w = mountStrip(week({ total: 11, openToday: 1, ahead: 8 }), { nearest });
    expect(w.get('[data-testid="star-path-saved"]').text()).toBe(
      '🏰 64 of 160 stars to Disneyland'
    );
    expect(w.attributes('aria-label')).toBe(
      '11 of 16 stars to Ice cream this week. 64 of 160 stars to Disneyland'
    );
  });

  it('is one image with a spoken summary; the parts are hidden from a screen reader', () => {
    const w = mountStrip(week({ total: 11, openToday: 1, ahead: 8 }));
    expect(w.attributes('role')).toBe('img');
    expect(w.attributes('aria-label')).toBe('11 of 16 stars to Ice cream this week');
  });

  it('a reward with no name reads as "the weekly reward"', () => {
    const w = mountStrip(week({ total: 11, openToday: 1, ahead: 8 }), { rewardTitle: '' });
    expect(w.get('[data-testid="star-path-more"]').text()).toBe(
      '5 more stars to the weekly reward'
    );
  });
});
