import { type Page } from '@playwright/test';

/**
 * Delete the test pod's family from the registry DDB table. Call from
 * `test.afterEach` so failed/aborted tests don't leave orphan rows in the
 * registry — they pollute the dev table and (pre-cutover) prod metrics.
 *
 * Backed by `__e2eDataBridge.cleanupActiveFamily()` in src/services/e2e/dataBridge.ts,
 * which calls the same `removeFamily()` API client the real app uses.
 *
 * Defensive: silently no-ops if the bridge isn't installed (page never
 * loaded the app) or no family was active. Never throws — cleanup must
 * not turn a passing test into a failure.
 */
export async function cleanupRegistry(page: Page): Promise<void> {
  try {
    if (page.isClosed()) return;
    await page.evaluate(async () => {
      const bridge = (
        window as unknown as {
          __e2eDataBridge?: { cleanupActiveFamily?: () => Promise<string | null> };
        }
      ).__e2eDataBridge;
      if (bridge?.cleanupActiveFamily) {
        await bridge.cleanupActiveFamily();
      }
    });
  } catch {
    // Page may have crashed/navigated. Cleanup is best-effort.
  }
}
