/**
 * The public plan-limits contract, shared by the marketing site and the app (#120).
 *
 * The ai-extract Lambda serves `GET /ai-allowance-limits` (keyless, cached, no family
 * data): the magic-beans allowance per tier, with the Full value fed from a Terraform
 * variable that lives only in greg's private env file. The pricing page, the help
 * article and the in-app Plan page read the number from here instead of hard-coding
 * it, so changing the allowance is one `tf-apply` and no release.
 *
 * One path, one shape, one parser. `parsePlanLimits` is the only validation on both
 * sides; a body that does not match returns `null` and the caller keeps its wordless
 * fallback copy. The Lambda's `publicLimits()` (`infrastructure/lambda/ai-extract/
 * allowance.mjs`) is the producer twin (a Lambda is its own zip and cannot import this).
 *
 * Erasable TypeScript only (interface + function), like `pricing.ts`. Pure: no DOM, no
 * fetch, never throws.
 */

export const PLAN_LIMITS_PATH = '/ai-allowance-limits';

export type PlanLimitPeriod = 'day' | 'month';

export interface PlanLimit {
  period: PlanLimitPeriod;
  limit: number;
}

export interface PlanLimits {
  trial: PlanLimit;
  basic: PlanLimit;
  full: PlanLimit;
  /** `env` when the Lambda read the Terraform value; `fallback` when it fell back. */
  source: 'env' | 'fallback';
}

const TIERS = ['trial', 'basic', 'full'] as const;

function parseLimit(value: unknown): PlanLimit | null {
  if (!value || typeof value !== 'object') return null;
  const { period, limit } = value as { period?: unknown; limit?: unknown };
  if (period !== 'day' && period !== 'month') return null;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) return null;
  return { period, limit };
}

/** The response body of `GET /ai-allowance-limits`, or `null` when it is not one. */
export function parsePlanLimits(body: unknown): PlanLimits | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const source = raw.source === 'env' || raw.source === 'fallback' ? raw.source : null;
  if (!source) return null;
  const parsed: Partial<Record<(typeof TIERS)[number], PlanLimit>> = {};
  for (const tier of TIERS) {
    const limit = parseLimit(raw[tier]);
    if (!limit) return null;
    parsed[tier] = limit;
  }
  return { trial: parsed.trial!, basic: parsed.basic!, full: parsed.full!, source };
}
