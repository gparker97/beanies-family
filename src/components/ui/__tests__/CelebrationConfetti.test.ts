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
      expect(delayOf(mountConfetti({ variant: 'drawer' }), 2)).toBe('120ms');
      resetCelebrationSeen();
      expect(delayOf(mountConfetti(), 2)).toBe('36ms');
    });
  });
});
