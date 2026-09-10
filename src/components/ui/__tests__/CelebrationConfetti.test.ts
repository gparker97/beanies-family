/**
 * The confetti layer had no test, and the one thing it had to get right was the
 * one thing it got wrong: which surfaces animate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import CelebrationConfetti from '../CelebrationConfetti.vue';
import { resetCelebrationSeen } from '@/composables/useCelebrationSeen';

// A real ref, not `{ value: false }`: the template auto-unwraps a ref, but a
// plain object is simply truthy, which would silently force reduced motion on
// and make every "it animates" assertion pass for the wrong reason.
vi.mock('@/composables/useReducedMotion', () => ({
  useReducedMotion: () => ({ prefersReducedMotion: ref(false) }),
}));

const mountConfetti = (props: Record<string, unknown> = {}) =>
  mount(CelebrationConfetti, { props: { activityId: 'a1', ...props } });

/**
 * `animate` is decided in `onMounted`, so the class binding only reflects it on
 * the next tick. Asserting straight after `mount()` reads the pre-decision
 * state and every case looks un-animated.
 */
async function stillCount(w: ReturnType<typeof mountConfetti>): Promise<number> {
  await nextTick();
  return w.findAll('.confetti-still').length;
}

describe('CelebrationConfetti', () => {
  beforeEach(() => resetCelebrationSeen());

  describe('cards are rationed, because they re-mount constantly', () => {
    it('animates the first time an activity is seen', async () => {
      expect(await stillCount(mountConfetti())).toBe(0);
    });

    it('does not animate again when the same card scrolls back into view', async () => {
      mountConfetti();
      const second = mountConfetti();
      expect(await stillCount(second)).toBeGreaterThan(0);
    });

    it('still renders the beans when the animation is spent', async () => {
      mountConfetti();
      expect(mountConfetti().findAll('.confetti-bean').length).toBeGreaterThan(0);
    });
  });

  describe('drawers always rain, because opening one IS the moment', () => {
    it('animates even though the chip behind it already claimed the activity', async () => {
      // This is the reported bug: you reach a drawer by tapping the chip, so the
      // chip has always spent the claim by the time the drawer mounts.
      mountConfetti({ density: 'month' });
      const drawer = mountConfetti({ variant: 'drawer', density: 'wall' });
      expect(await stillCount(drawer)).toBe(0);
    });

    it('animates again on a second open of the same activity', async () => {
      mountConfetti({ variant: 'drawer' });
      expect(await stillCount(mountConfetti({ variant: 'drawer' }))).toBe(0);
    });

    it('does not spend the claim, so a card still gets its own entrance after', async () => {
      mountConfetti({ variant: 'drawer' });
      expect(await stillCount(mountConfetti({ density: 'month' }))).toBe(0);
    });

    it('uses the falling animation, not the card drop', async () => {
      const drawer = mountConfetti({ variant: 'drawer' });
      expect(drawer.findAll('.confetti-rain').length).toBeGreaterThan(0);
      expect(drawer.findAll('.confetti-drop')).toHaveLength(0);
    });

    it('staggers wider than a card, so it reads as falling rather than one blink', async () => {
      const delayOf = (w: ReturnType<typeof mountConfetti>, i: number) =>
        (w.findAll('.confetti-bean')[i].element as HTMLElement).style.animationDelay;
      expect(delayOf(mountConfetti({ variant: 'drawer' }), 2)).toBe('90ms');
      resetCelebrationSeen();
      expect(delayOf(mountConfetti(), 2)).toBe('36ms');
    });

    /**
     * The regression this exists for: the fall used to be `translateY(-140%)`,
     * and a percentage there resolves against the bean's OWN height. At 7px tall
     * that made "rain in from above" a 9.8px drift over 900ms, which is slower
     * than the card's 10px drop and read as floating rather than falling.
     */
    it('falls a real distance, in px, not a percentage of a 7px bean', () => {
      const beans = mountConfetti({ variant: 'drawer', density: 'wall' }).findAll('.confetti-bean');
      const falls = beans.map((b) =>
        Number.parseInt((b.element as HTMLElement).style.getPropertyValue('--bean-fall'), 10)
      );
      expect(falls.every((f) => f >= 150)).toBe(true);
      // More than one distance, or the shower is a rigid sheet on rails.
      expect(new Set(falls).size).toBeGreaterThan(1);
    });

    it('varies duration and drift out of step with each other', () => {
      const beans = mountConfetti({ variant: 'drawer', density: 'wall' }).findAll('.confetti-bean');
      const durations = new Set(
        beans.map((b) => (b.element as HTMLElement).style.animationDuration)
      );
      const sways = new Set(
        beans.map((b) => (b.element as HTMLElement).style.getPropertyValue('--bean-sway'))
      );
      expect(durations.size).toBeGreaterThan(1);
      expect(sways.size).toBeGreaterThan(1);
    });

    it('leaves cards alone: no per-bean duration override on a card', () => {
      const card = mountConfetti({ density: 'card' });
      const first = card.findAll('.confetti-bean')[0].element as HTMLElement;
      expect(first.style.animationDuration).toBe('');
    });
  });
});
