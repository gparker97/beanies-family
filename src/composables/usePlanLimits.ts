// The live Full-plan allowance for the Plan page (#120): the number is a Terraform value served
// by `GET /ai-allowance-limits`, so the page asks instead of hard-coding it. Stateless (the
// fetch itself is memoised per session in `managedProvider`). `null` until it arrives or when the
// read fails, and the caller then shows its wordless fallback line.

import { ref } from 'vue';
import { fetchPlanLimits } from '@/services/ai/providers/managedProvider';
import { ExtractionProviderError } from '@/services/ai/types';
import { logEvent } from '@/services/telemetry/logEvent';

const SURFACE = 'plan-limits';

export function usePlanLimits() {
  const fullPerDay = ref<number | null>(null);

  void (async () => {
    try {
      const limits = await fetchPlanLimits();
      fullPerDay.value = limits.full.limit;
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'plan limits loaded',
        context: { action: 'limits_loaded' },
      });
    } catch (err) {
      const code = err instanceof ExtractionProviderError ? err.code : 'unknown';
      console.warn(
        `[plan-limits] could not read the plan limits (${code}). Check GET /ai-allowance-limits ` +
          'on the ai-extract Lambda, the route throttle in modules/registry/main.tf, and the ' +
          'allowance_config_error alarm',
        err
      );
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'plan limits read failed',
        context: { action: 'limits_read_failed', error_code: code },
      });
    }
  })();

  return { fullPerDay };
}
