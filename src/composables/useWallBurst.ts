/**
 * Short-lived tick celebrations: a few beans popping up out of the tick, and a
 * hand-written cheer beside it.
 *
 * Separate from `useCelebration` on purpose. That system is app-wide, sound-
 * playing and one-at-a-time; this is a purely visual, positional, stackable
 * flourish that must be able to fire five times in five seconds while four
 * children clear their columns. Mixing them would have meant one child's tick
 * cancelling another's.
 */
import { onScopeDispose, ref } from 'vue';
import type { UIStringKey } from '@/services/translation/uiStrings';

/** Rotated so a child ticking six jobs does not read the same word six times. */
export const CHEER_KEYS: readonly UIStringKey[] = [
  'wall.cheer.1',
  'wall.cheer.2',
  'wall.cheer.3',
  'wall.cheer.4',
  'wall.cheer.5',
];

export interface WallBurst {
  id: number;
  x: number;
  y: number;
  cheerKey: UIStringKey;
  beans: { id: number; dx: number; rotate: number; delay: number; glyph: string }[];
}

/** Matches the mockup's 1.4s cheer, with a little slack for the fade. */
const BURST_LIFETIME_MS = 1600;
const BEAN_GLYPHS = ['🫘', '🫘', '⭐', '🎉', '🫘'];

export function useWallBurst() {
  const bursts = ref<WallBurst[]>([]);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let nextId = 0;
  let nextCheer = 0;

  function burst(x: number, y: number): void {
    const id = nextId++;
    const cheerKey = CHEER_KEYS[nextCheer % CHEER_KEYS.length];
    nextCheer += 1;
    bursts.value = [
      ...bursts.value,
      {
        id,
        x,
        y,
        cheerKey,
        beans: BEAN_GLYPHS.map((glyph, i) => ({
          id: i,
          dx: (i - 2) * 22,
          rotate: (i % 2 ? -1 : 1) * 24,
          // Tight enough to read as one burst. At 45ms the five beans left the
          // tick in a visible queue rather than a scatter.
          delay: i * 26,
          glyph,
        })),
      },
    ];
    const timer = setTimeout(() => {
      timers.delete(timer);
      bursts.value = bursts.value.filter((b) => b.id !== id);
    }, BURST_LIFETIME_MS);
    timers.add(timer);
  }

  // Leaving the wall mid-burst must not leave a timer writing to a dead ref.
  onScopeDispose(() => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });

  return { bursts, burst };
}
