/**
 * Live magic-beans allowance for the marketing site and help center (#120).
 *
 * Any element carrying `data-bean-limit="full"` ships server-rendered wordless fallback copy
 * plus a `data-live` template containing `{count}`. This swaps the text for the live number
 * from `GET /ai-allowance-limits`, all or nothing: `textContent` only (never HTML).
 * The route's `Cache-Control: public, max-age=300` is the cache, so there is no client memo.
 */
import { PLAN_LIMITS_PATH, parsePlanLimits } from '@beanies/brand/planLimits';

const PLAN_LIMITS_URL = `https://api.beanies.family${PLAN_LIMITS_PATH}`;

/** Never throws. On any failure the fallback copy stays and one warning is logged. */
export async function hydrateBeanLimits(): Promise<void> {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-bean-limit="full"]'));
  if (els.length === 0) return;
  try {
    const res = await fetch(PLAN_LIMITS_URL, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const limits = parsePlanLimits(await res.json());
    if (!limits) throw new Error('unexpected response shape');
    // Every template is collected BEFORE any text is written, so one malformed span leaves the
    // whole page on its fallback copy rather than half-swapped.
    const swaps: Array<[HTMLElement, string]> = [];
    for (const el of els) {
      const template = el.dataset.live;
      if (!template?.includes('{count}')) throw new Error('data-live template must carry {count}');
      swaps.push([el, template]);
    }
    const count = String(limits.full.limit);
    for (const [el, template] of swaps) el.textContent = template.replaceAll('{count}', count);
  } catch (err) {
    console.warn(
      '[plan-limits] live allowance not shown, fallback copy kept — check GET api.beanies.family/ai-allowance-limits (a 429 is the route throttle in modules/registry/main.tf) and the allowance_config_error alarm',
      err
    );
  }
}
