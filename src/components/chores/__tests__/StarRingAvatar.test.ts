/**
 * The one drawing of a child's avatar in their stars ring (#154): ONE root with or without an
 * arc; the ring, badge and test ids as props; the star and two sparkles only once the weekly goal
 * is reached (`arc.badgeEmoji`), inside the ring's box; the sizes per caller.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import StarRingAvatar from '../StarRingAvatar.vue';
import ProgressRing from '@/components/ui/ProgressRing.vue';
import type { FamilyMember } from '@/types/models';

vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));

const member = { id: 'kid', name: 'Mia' } as FamilyMember;
const mountRing = (props: Record<string, unknown>) =>
  mount(StarRingAvatar, {
    props: { member, size: 'lane', ...props },
    global: { stubs: { BeanieAvatar: true } },
  });

describe('StarRingAvatar', () => {
  it('one root with or without an arc, and a caller’s class lands on it', () => {
    for (const arc of [null, { percent: 40 }]) {
      const w = mount(StarRingAvatar, {
        props: { member, size: 'day', arc },
        attrs: { class: 'mine' },
        global: { stubs: { BeanieAvatar: true } },
      });
      expect(w.element.tagName).toBe('SPAN');
      expect(w.classes()).toContain('mine');
      expect(w.attributes('data-testid')).toBe('star-ring-avatar');
    }
  });

  it('without an arc: the avatar alone, no ring', () => {
    const w = mountRing({ arc: null, fallback: 'initials' });
    expect(w.findComponent(ProgressRing).exists()).toBe(false);
    expect(w.html()).toMatch(/beanie-avatar-stub[^>]*fallback="initials"[^>]*size="lg"/);
  });

  it('with an arc short of the goal: the ring and its test ids, no badge, no star', () => {
    const w = mountRing({ arc: { percent: 62 }, ringTestid: 'ring', badgeTestid: 'badge' });
    const ring = w.findComponent(ProgressRing);
    expect(ring.props('segments')).toEqual([{ value: 0.62, tone: 'fill' }]);
    expect(w.get('[data-testid="ring"]').attributes('data-percent')).toBe('62');
    expect(w.find('[data-testid="badge"]').exists()).toBe(false);
    expect(w.find('[data-testid="star-ring-star"]').exists()).toBe(false);
  });

  it('goal reached: the badge, and the star with two sparkles inside the ring’s box', () => {
    const w = mountRing({ arc: { percent: 100, badgeEmoji: '🍦' }, badgeTestid: 'badge' });
    expect(w.get('[data-testid="badge"]').text()).toBe('🍦');
    const ring = w.findComponent(ProgressRing);
    const star = ring.get('[data-testid="star-ring-star"]');
    expect(star.attributes('aria-hidden')).toBe('true');
    expect(ring.findAll('.star-ring-spark')).toHaveLength(2);
  });

  it('the sizes per caller: the lane’s ring class and lg avatar, the day’s 5rem ring and xl', () => {
    const lane = mountRing({ arc: { percent: 10, badgeEmoji: '⭐' }, badgeTestid: 'b' });
    expect(lane.findComponent(ProgressRing).classes()).toContain('wall-star-ring');
    expect(lane.get('[data-testid="b"]').classes()).toContain('h-6');
    const day = mountRing({
      size: 'day',
      arc: { percent: 10, badgeEmoji: '⭐' },
      badgeTestid: 'b',
    });
    expect(day.findComponent(ProgressRing).classes()).toEqual(
      expect.arrayContaining(['h-20', 'w-20'])
    );
    expect(day.get('[data-testid="b"]').classes()).toContain('h-7');
    expect(day.html()).toMatch(/beanie-avatar-stub[^>]*size="xl"/);
  });
});
