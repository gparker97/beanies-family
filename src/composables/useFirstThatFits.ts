/**
 * Picks the first of several renderings of one line that fits its container on ONE line.
 *
 * Written for the Nook's phone caption (#134): a whole translated sentence comes in a few
 * lengths (a long date, a short date, no weather), and which one fits depends on the language,
 * the condition word, the temperature unit, the date and the reading mode. None of that can be
 * predicted from character counts, so every candidate is laid out for real in a hidden measurer
 * and the first whose natural width fits wins.
 *
 * The caller renders each candidate as one `whitespace-nowrap` block, in order, inside an
 * `aria-hidden`, `invisible` measurer that sits INSIDE the container (same classes as the
 * visible line, so the font, Large reading mode and the language are measured exactly), and
 * passes that measurer as `measurerRef`. The candidates are its element children in DOM order,
 * which a `v-for` template-ref array does not guarantee.
 *
 * It re-measures when the container width changes (`useElementSize`, the app's one size
 * observer; no fourth `ResizeObserver`), when `deps` change (the candidates' text), when the
 * text size setting flips (the root font size moves, the container width does not), and once
 * web fonts have loaded (a fallback face measures narrower or wider than Outfit/Inter).
 *
 * Fails soft: a throw while reading layout keeps the last answer (`console.warn`), and the
 * visible line should keep `truncate` as a backstop. When none fits, the LAST candidate wins.
 * Until the container has been laid out (width 0: not mounted, `display: none`), nothing is
 * decided and `settled` stays false, so a caller never reports a measurement it did not make.
 */
import { nextTick, onMounted, readonly, ref, watch, type Ref, type WatchSource } from 'vue';
import { useElementSize } from '@/composables/useElementSize';
import { useSettingsStore } from '@/stores/settingsStore';

export interface FirstThatFitsOptions {
  /** Telemetry surface for `useElementSize`'s own diagnostics. */
  surface?: string;
  /** Re-measure when this changes (typically the candidates' text). */
  deps?: WatchSource;
  /**
   * Whether one candidate fits in `availableWidth`. Defaults to its laid-out `scrollWidth`
   * against the container's width; tests inject this (jsdom has no layout).
   */
  measure?: (candidate: HTMLElement, availableWidth: number) => boolean;
}

export interface FirstThatFits {
  /** Index of the first candidate that fits (the last when none does). */
  index: Readonly<Ref<number>>;
  /** True once at least one real measurement has been made. */
  settled: Readonly<Ref<boolean>>;
  /** Measure now (after the next DOM update). */
  remeasure: () => void;
}

function fitsByLayout(candidate: HTMLElement, availableWidth: number): boolean {
  return candidate.scrollWidth <= availableWidth;
}

export function useFirstThatFits(
  containerRef: Ref<HTMLElement | null>,
  measurerRef: Ref<HTMLElement | null>,
  options: FirstThatFitsOptions = {}
): FirstThatFits {
  const surface = options.surface ?? 'first-that-fits';
  const injected = options.measure;
  const fits = injected ?? fitsByLayout;
  const settingsStore = useSettingsStore();
  const { width } = useElementSize(containerRef, { surface });

  const index = ref(0);
  const settled = ref(false);

  function measureNow(): void {
    const candidates = Array.from(measurerRef.value?.children ?? []) as HTMLElement[];
    if (candidates.length === 0) return;
    if (candidates.length === 1) {
      index.value = 0;
      settled.value = true;
      return;
    }
    const available = width.value;
    // Not laid out yet: deciding now would pick the last candidate for no reason.
    if (!injected && available <= 0) return;
    try {
      const found = candidates.findIndex((el) => fits(el, available));
      index.value = found === -1 ? candidates.length - 1 : found;
      settled.value = true;
    } catch (err) {
      console.warn(`[${surface}] measuring the candidates threw; keeping the last choice`, err);
    }
  }

  function remeasure(): void {
    void nextTick(measureNow);
  }

  watch(width, remeasure);
  watch(() => settingsStore.textSize, remeasure);
  if (options.deps) watch(options.deps, remeasure);

  onMounted(() => {
    remeasure();
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.ready.then(remeasure).catch((err: unknown) => {
      console.warn(`[${surface}] document.fonts.ready rejected; measured with fallback fonts`, err);
    });
  });

  return { index: readonly(index), settled: readonly(settled), remeasure };
}
