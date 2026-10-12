import { ref, type Ref } from 'vue';
import { App } from '@capacitor/app';
import { isNative } from '@/services/sync/capabilities';
import { logEvent } from '@/services/telemetry/logEvent';
import { getProductVersionLabel } from '@/utils/diagnosticContext';

/**
 * The sidebar / hamburger-menu version line. On web it is the friendly product
 * version (`v0.95`). On native the store build number is appended once the
 * Capacitor App plugin answers (`v0.95 (92)`): two test builds of the same
 * `APP_VERSION` carry different version codes (Play) / build numbers (TestFlight),
 * and nothing else in the app told them apart. Starts as the web label so the
 * first paint never waits on the bridge; a failed lookup keeps that label.
 */
export function useProductVersionLabel(): Ref<string> {
  const label = ref(getProductVersionLabel());
  if (isNative()) {
    App.getInfo()
      .then((info) => {
        if (info.build) label.value = `${label.value} (${info.build})`;
      })
      .catch((error: unknown) => {
        logEvent({
          level: 'warn',
          surface: 'product-version-label',
          message: 'native build number unavailable; showing the product version only',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
  }
  return label;
}
