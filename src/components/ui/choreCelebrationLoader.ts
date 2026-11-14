/**
 * The chore celebration (#146) is code-split: the choreboard's first paint never pays for the
 * component, its choreography, its sound engine or its art. `CelebrationOverlay` loads it on the first
 * celebration; the choreboard page and the wall warm it (and the art) when the browser is idle,
 * so the first celebration does not wait for the network.
 */
import { logEvent } from '@/services/telemetry/logEvent';
import { loadCelebrationSoundEngine } from '@/composables/useSounds';
import { choreCelebrationArtUrls } from '@/utils/choreCelebration';
import type { Component } from 'vue';

let pending: Promise<Component> | null = null;

/** The component, loaded once (a failed load is forgotten, so the next attempt retries). */
export function loadChoreCelebration(): Promise<Component> {
  pending ??= import('@/components/ui/ChoreCelebration.vue')
    .then((m) => m.default as Component)
    .catch((e: unknown) => {
      pending = null;
      throw e;
    });
  return pending;
}

let warmed = false;

/** Load the component and decode the art ahead of the first celebration (once per session). */
export function preloadChoreCelebration(): void {
  if (warmed) return;
  warmed = true;
  loadChoreCelebration().catch((error: unknown) => {
    warmed = false;
    logEvent({
      level: 'warn',
      surface: 'chore-celebration',
      message: 'chore celebration preload failed; it will load on the first celebration',
      context: { action: 'preload-failed' },
      error,
    });
  });
  // The sound engine too, so the first celebration's sound starts on the tick. A failed warm-up
  // arms no backoff: the first real celebration simply tries again.
  loadCelebrationSoundEngine({ preload: true }).catch((error: unknown) => {
    logEvent({
      level: 'warn',
      surface: 'chore-celebration',
      message: 'chore celebration sound preload failed; the first celebration will try again',
      context: { action: 'preload-failed', detail: 'sounds' },
      error,
    });
  });
  for (const src of choreCelebrationArtUrls()) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }
}

/** Warm it when the browser is idle (never in the way of the page's own first paint). */
export function preloadChoreCelebrationWhenIdle(): void {
  if (typeof window === 'undefined' || warmed) return;
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
  idle(() => preloadChoreCelebration());
}
