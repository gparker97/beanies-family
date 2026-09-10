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

    it('still renders the pieces when the animation is spent', async () => {
      mountConfetti();
      expect(mountConfetti().findAll('.confetti-piece').length).toBeGreaterThan(0);
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

    /**
     * Tight on both, so the shower lands as ONE burst. At the old 45ms the
     * twentieth piece began after the first had already finished, which is a
     * queue rather than a celebration.
     */
    it('staggers tightly, so the pieces arrive together as a burst', async () => {
      const delayOf = (w: ReturnType<typeof mountConfetti>, i: number) =>
        (w.findAll('.confetti-piece')[i].element as HTMLElement).style.getPropertyValue(
          '--fall-delay'
        );
      expect(delayOf(mountConfetti({ variant: 'drawer' }), 2)).toBe('28ms');
      resetCelebrationSeen();
      expect(delayOf(mountConfetti(), 2)).toBe('20ms');
    });

    /**
     * The regression this exists for: the fall used to be `translateY(-140%)`,
     * and a percentage there resolves against the bean's OWN height. At 7px tall
     * that made "rain in from above" a 9.8px drift over 900ms, which is slower
     * than the card's 10px drop and read as floating rather than falling.
     */
    it('falls a real distance, in px, not a percentage of a 7px bean', () => {
      const beans = mountConfetti({ variant: 'drawer', density: 'wall' }).findAll(
        '.confetti-piece'
      );
      const falls = beans.map((b) =>
        Number.parseInt((b.element as HTMLElement).style.getPropertyValue('--bean-fall'), 10)
      );
      expect(falls.every((f) => f >= 150)).toBe(true);
      // More than one distance, or the shower is a rigid sheet on rails.
      expect(new Set(falls).size).toBeGreaterThan(1);
    });

    it('varies duration and drift out of step with each other', () => {
      const beans = mountConfetti({ variant: 'drawer', density: 'wall' }).findAll(
        '.confetti-piece'
      );
      const durations = new Set(
        beans.map((b) => (b.element as HTMLElement).style.getPropertyValue('--fall-ms'))
      );
      const sways = new Set(
        beans.map((b) => (b.element as HTMLElement).style.getPropertyValue('--bean-sway'))
      );
      expect(durations.size).toBeGreaterThan(1);
      expect(sways.size).toBeGreaterThan(1);
    });

    it('falls a shorter way on a card than in a drawer', () => {
      const fall = (w: ReturnType<typeof mountConfetti>) =>
        Number.parseInt(
          (w.findAll('.confetti-piece')[0].element as HTMLElement).style.getPropertyValue(
            '--bean-fall'
          ),
          10
        );
      const drawer = fall(mountConfetti({ variant: 'drawer' }));
      resetCelebrationSeen();
      expect(fall(mountConfetti({ density: 'card' }))).toBeLessThan(drawer);
    });
  });

  describe('the piece is confetti, not a bean', () => {
    it('mixes four forms, because the variety is what makes it legible at 9px', () => {
      const forms = mountConfetti({ density: 'card' })
        .findAll('.confetti-piece')
        .map((p) => [...p.classes()].find((c) => c.startsWith('cf-')));
      expect(new Set(forms)).toEqual(new Set(['cf-rect', 'cf-strip', 'cf-curl', 'cf-disc']));
    });

    it('still cycles the Pod colours in their mandated order', () => {
      const pieces = mountConfetti({ density: 'card' }).findAll('.confetti-piece');
      const light = pieces
        .slice(0, 4)
        .map((p) => (p.element as HTMLElement).style.getPropertyValue('--bean-light'));
      expect(light).toEqual(['#2C3E50', '#E67E22', '#F15D22', '#AED6F1']);
    });
  });

  describe('opacity is a surface decision', () => {
    it('is quieter on a card, where it competes with text', () => {
      expect(mountConfetti({ density: 'card' }).get('.celebration-confetti').classes()).toContain(
        'is-card'
      );
    });

    it('is fuller in a drawer, which is mostly space', () => {
      expect(mountConfetti({ variant: 'drawer' }).get('.celebration-confetti').classes()).toContain(
        'is-drawer'
      );
    });
  });

  describe('the drift after landing', () => {
    it('keeps app cards alive', async () => {
      const w = mountConfetti({ density: 'card' });
      await nextTick();
      expect(w.findAll('.confetti-drifts').length).toBeGreaterThan(0);
    });

    it('is held OFF wall cards: a kitchen tablet never sleeps', async () => {
      const w = mountConfetti({ density: 'wall' });
      await nextTick();
      expect(w.findAll('.confetti-drifts')).toHaveLength(0);
    });

    it('runs in a wall DRAWER, which someone opened and will close', async () => {
      const w = mountConfetti({ density: 'wall', variant: 'drawer' });
      await nextTick();
      expect(w.findAll('.confetti-drifts').length).toBeGreaterThan(0);
    });

    it('starts only once that piece has landed', () => {
      const p = mountConfetti({ variant: 'drawer' }).findAll('.confetti-piece')[3]
        .element as HTMLElement;
      const delay = Number.parseInt(p.style.getPropertyValue('--fall-delay'), 10);
      const dur = Number.parseInt(p.style.getPropertyValue('--fall-ms'), 10);
      expect(Number.parseInt(p.style.getPropertyValue('--drift-delay'), 10)).toBe(delay + dur);
    });
  });
});
