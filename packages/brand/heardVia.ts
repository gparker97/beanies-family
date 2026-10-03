/**
 * The "how did you hear about us?" survey answer ids, shared by the app and (as a twin) the
 * registry Lambda.
 *
 * The id is persisted write-once on the family registry row at signup. The label (the Slack
 * string) and the free text of `other` are Slack-only and never stored.
 *
 * ⚠️ `HEARD_VIA_IDS` has a TWIN that cannot import it: `infrastructure/lambda/registry/index.mjs`
 * (a Lambda is its own zip). Change the list here AND there, in this exact order;
 * `src/utils/__tests__/attributionTwinDrift.test.ts` fails if they drift.
 *
 * Pure: no DOM, no storage, never throws.
 */

export const HEARD_VIA_IDS = [
  'reddit',
  'product_hunt',
  'substack',
  'google',
  'app_store',
  'chatgpt_ad',
  'ai',
  'friend',
  'other',
] as const;

export type HeardViaId = (typeof HEARD_VIA_IDS)[number];

export function isHeardViaId(value: unknown): value is HeardViaId {
  return typeof value === 'string' && (HEARD_VIA_IDS as readonly string[]).includes(value);
}

/** The survey's resolved answer: `id` goes to the registry, `label` to Slack only. */
export interface HeardVia {
  id: HeardViaId;
  label: string;
}
