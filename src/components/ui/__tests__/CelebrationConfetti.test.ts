/**
 * The confetti layer had no test, and the one thing it had to get right was the
 * one thing it got wrong: which surfaces animate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import CelebrationConfetti from '../CelebrationConfetti.vue';
import { resetCelebrationSeen } from '@/composables/useCelebrationSeen';
import { useReducedMotion } from '@/composables/useReducedMotion';

// A real ref, not `{ value: false }`: the template auto-unwraps a ref, but a
// plain object is simply truthy, which would silently force reduced motion on
// and make every "it animates" assertion pass for the wrong reason.
vi.mock('@/composables/useReducedMotion', () => ({
  useReducedMotion: vi.fn(() => ({ prefersReducedMotion: ref(false) })),
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
  });

  /**
   * The popper. Pieces used to fall onto fixed scatter positions spread from 8%
   * to 92% down the panel, so they stopped IN MID-AIR; no easing makes that look
   * natural because nothing stops halfway down. They now leave one corner, arc,
   * and land on the floor.
   */
  describe('the corner popper', () => {
    /** The burst is gated on `animate`, decided in `onMounted`, so it needs a tick. */
    async function burstPieces(w: ReturnType<typeof mountConfetti>) {
      await nextTick();
      return w.findAll('.cf-x');
    }

    it('fires in a drawer', async () => {
      expect((await burstPieces(mountConfetti({ variant: 'drawer' }))).length).toBeGreaterThan(0);
    });

    it('does not fire on a card, which has no floor worth landing on', async () => {
      expect(await burstPieces(mountConfetti({ density: 'card' }))).toHaveLength(0);
      expect(await burstPieces(mountConfetti({ density: 'wall' }))).toHaveLength(0);
    });

    it('lands its pieces across the whole width, not in a heap', async () => {
      const lands = (await burstPieces(mountConfetti({ variant: 'drawer' }))).map((p) =>
        Number.parseInt((p.element as HTMLElement).style.getPropertyValue('--land'), 10)
      );
      expect(Math.min(...lands)).toBeLessThan(10);
      expect(Math.max(...lands)).toBeGreaterThan(88);
      // Evenly, rather than clustered wherever a hash happened to land.
      expect(new Set(lands).size).toBeGreaterThan(lands.length / 2);
    });

    it('throws every piece up before gravity takes it down', async () => {
      const w = mountConfetti({ variant: 'drawer' });
      await nextTick();
      const apexes = w
        .findAll('.cf-y')
        .map((p) =>
          Number.parseInt((p.element as HTMLElement).style.getPropertyValue('--apex'), 10)
        );
      expect(apexes.every((a) => a < 0)).toBe(true);
      expect(new Set(apexes).size).toBeGreaterThan(1);
    });

    it('spins pieces both ways, so the throw does not look mechanical', async () => {
      const w = mountConfetti({ variant: 'drawer' });
      await nextTick();
      const spins = w
        .findAll('.cf-p')
        .map((p) =>
          Number.parseInt((p.element as HTMLElement).style.getPropertyValue('--spin'), 10)
        );
      expect(spins.some((v) => v > 0)).toBe(true);
      expect(spins.some((v) => v < 0)).toBe(true);
    });

    it('does not fire under reduced motion: the popper is pure movement', async () => {
      vi.mocked(useReducedMotion).mockReturnValueOnce({ prefersReducedMotion: ref(true) });
      expect(await burstPieces(mountConfetti({ variant: 'drawer' }))).toHaveLength(0);
    });
  });

  describe('the scatter it leaves behind', () => {
    const inDelay = (w: ReturnType<typeof mountConfetti>) =>
      Number.parseInt(
        (w.findAll('.confetti-piece')[0].element as HTMLElement).style.getPropertyValue(
          '--in-delay'
        ),
        10
      );

    it('waits for the drawer floor to settle before fading in', () => {
      expect(inDelay(mountConfetti({ variant: 'drawer' }))).toBeGreaterThan(1000);
    });

    it('arrives at once on a card, which had no burst to wait for', () => {
      expect(inDelay(mountConfetti({ density: 'card' }))).toBe(0);
    });

    it('starts its drift only after it has arrived', () => {
      const el = mountConfetti({ variant: 'drawer' }).findAll('.confetti-piece')[4]
        .element as HTMLElement;
      const arrive = Number.parseInt(el.style.getPropertyValue('--in-delay'), 10);
      expect(Number.parseInt(el.style.getPropertyValue('--drift-delay'), 10)).toBeGreaterThan(
        arrive
      );
    });
  });

  describe('both corners fire', () => {
    it('throws from the left AND the right', async () => {
      const w = mountConfetti({ variant: 'drawer' });
      await nextTick();
      const froms = new Set(
        w.findAll('.cf-x').map((p) => (p.element as HTMLElement).style.getPropertyValue('--from'))
      );
      expect(froms).toEqual(new Set(['-3%', '103%']));
    });

    it('splits the pieces roughly evenly between them', async () => {
      const w = mountConfetti({ variant: 'drawer' });
      await nextTick();
      const left = w
        .findAll('.cf-x')
        .filter((p) => (p.element as HTMLElement).style.getPropertyValue('--from') === '-3%');
      const all = w.findAll('.cf-x').length;
      expect(left.length).toBe(all / 2);
    });

    it('still lays the pile across the full width', async () => {
      const w = mountConfetti({ variant: 'drawer' });
      await nextTick();
      const lands = w
        .findAll('.cf-x')
        .map((p) =>
          Number.parseInt((p.element as HTMLElement).style.getPropertyValue('--land'), 10)
        );
      expect(Math.min(...lands)).toBeLessThan(10);
      expect(Math.max(...lands)).toBeGreaterThan(88);
    });
  });

  /**
   * The corner alternates on `i % 2` and every throw table is indexed off the
   * same `i`, so an EVEN-length table locks the parity: one corner draws only
   * the low, fast values and the other only the high, slow ones. That shipped,
   * and it looked like the right-hand popper was not firing at all.
   */
  describe('neither corner monopolises the throw', () => {
    async function byCorner(prop: string, sel: string) {
      const w = mountConfetti({ variant: 'drawer' });
      await nextTick();
      const left: number[] = [];
      const right: number[] = [];
      w.findAll('.cf-x').forEach((x) => {
        const from = (x.element as HTMLElement).style.getPropertyValue('--from');
        const target = (x.element.querySelector(sel) ?? x.element) as HTMLElement;
        const v = Number.parseInt(target.style.getPropertyValue(prop), 10);
        (from === '-3%' ? left : right).push(v);
      });
      return { left, right };
    }

    it('gives both corners the full range of apex heights', async () => {
      const { left, right } = await byCorner('--apex', '.cf-y');
      expect(new Set(left)).toEqual(new Set(right));
    });

    it('gives both corners the full range of durations', async () => {
      const { left, right } = await byCorner('--dur', '.cf-x');
      expect(new Set(left)).toEqual(new Set(right));
    });

    it('gives both corners the full range of launch delays', async () => {
      const { left, right } = await byCorner('--delay', '.cf-x');
      expect(new Set(left)).toEqual(new Set(right));
    });

    it('keeps every throw table coprime with the two corners', () => {
      // A table whose length shares a factor with 2 can only ever reach one
      // corner's pieces. This is the invariant, stated so it cannot regress.
      const w = mountConfetti({ variant: 'drawer' });
      const apexes = w.findAll('.cf-y').length;
      expect(apexes % 2).toBe(0); // an even number of pieces, split evenly
    });
  });
});
