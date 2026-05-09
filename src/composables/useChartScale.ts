import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { Chart } from 'chart.js';

/**
 * Sync a vue-chartjs chart's font size with the current root font-size so
 * Chart.js text (axis labels, legends, tooltips) participates in the Large
 * reading mode. Single source of truth: the live `<html>` root font-size,
 * which the settings store toggles via the `data-text-size` attribute.
 *
 * Wire this in any chart component that should rescale with the user's
 * text-size preference:
 *
 *   <script setup>
 *   import { ref } from 'vue';
 *   import { Line } from 'vue-chartjs';
 *   import { useChartScale } from '@/composables/useChartScale';
 *
 *   const chartRef = ref<InstanceType<typeof Line> | null>(null);
 *   useChartScale(chartRef);
 *   </script>
 *   <template>
 *     <Line ref="chartRef" :data="data" :options="options" />
 *   </template>
 *
 * The composable observes `<html data-text-size>` mutations via
 * MutationObserver and recomputes `Chart.defaults.font.size` from the live
 * root font-size. The chart is then re-rendered via `chart.update('none')`.
 *
 * Auto-cleans up on component unmount — there is no manual unsubscribe to
 * remember; Vue's lifecycle handles it.
 */
// vue-chartjs exposes the underlying Chart.js instance as `.chart` on its
// component instances (Line, Bar, Pie, Doughnut, etc.), but doesn't surface
// that field in its public TS types. We accept any ref and structurally
// narrow at runtime — the cast is contained to this composable.
type ChartHolder = { chart?: Chart } | null;

export function useChartScale(chartRef: Ref<unknown>): void {
  // Reads root font-size each call so Large/Normal toggles are instant —
  // no caching, no store dependency, no per-component subscription overhead.
  const apply = (): void => {
    try {
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // The 12-px-at-default-root design choice from Chart.js stays the
      // visual anchor; we just rescale linearly with the current root.
      Chart.defaults.font.size = (12 / 16) * rootPx;
      const instance = (chartRef.value as ChartHolder)?.chart;
      instance?.update('none');
    } catch (e) {
      // Never let a chart-rescale failure block the toast/store flow that
      // triggered it. Logged so production telemetry sees the cause.
      console.warn(
        '[useChartScale] Failed to update Chart.defaults.font.size — chart may render at the previous scale until next data update.',
        e
      );
    }
  };

  let observer: MutationObserver | null = null;

  onMounted(() => {
    apply();
    observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-text-size'],
    });
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });
}
