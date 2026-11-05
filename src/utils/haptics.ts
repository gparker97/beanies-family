import { DRAG_SURFACE } from '@/composables/drag/dragTelemetry';
import { isNative } from '@/services/sync/capabilities';
import { logEvent } from '@/services/telemetry/logEvent';

/** Haptics are decorative: a failure is a `debug` breadcrumb, never an error. */
function logUnavailable(error: unknown): void {
  logEvent({
    level: 'debug',
    surface: DRAG_SURFACE,
    message: 'haptic unavailable',
    context: { action: 'haptic', detail: 'unavailable' },
    error,
  });
}

/**
 * A light haptic tick (calendar drag lift, #142). Decorative: it never throws and never
 * blocks, and a device without haptics simply feels nothing.
 *
 * - Native iOS / Android: `@capacitor/haptics` (dynamically imported, so the web bundle
 *   never loads it). A failure (the plugin missing from an older native build, a device
 *   with no engine) is logged at `debug` and swallowed.
 * - Web: `navigator.vibrate(10)` where it exists (Android Chrome). iOS Safari has none, so
 *   nothing happens there; a browser that throws on it (a permissions policy, a sandboxed
 *   frame) is logged at `debug` like the native failure.
 */
export function hapticTick(): void {
  if (isNative()) {
    void import('@capacitor/haptics')
      .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
      .catch(logUnavailable);
    return;
  }
  try {
    navigator.vibrate?.(10);
  } catch (error) {
    logUnavailable(error);
  }
}
