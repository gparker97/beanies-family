// The single wedge-specific mapper (ADR-030, #133, Phase 3): turn an extracted document
// result into a PARTIAL activity prefill. Kept pure + total + standalone so it's unit-tested
// in isolation and future AI features (NL search) reuse the generic service without importing
// anything activity-shaped.
//
// Only fields the model found — plus a category (the model's picked id when valid, else inferred
// from its hint/title) — are set (the prompt returns '' for absent fields); everything else
// (incl. recurrence) is left to ActivityModal's onNew/applyPrefill defaults. Nothing is
// auto-created — the prefill opens the form for the user to review, edit, and confirm.
//
// Pure + total apart from ONE deliberate diagnostic: a present-but-unknown model category id is
// logged via console.warn (matching the [travel-extract] convention) and a `logEvent` warning
// to the diagnostics firehose rather than silently dropped, then keyword inference takes over.
// No throws, no other side effects.

import type { ExtractionResult } from '@/services/ai/types';
import type { ActivityCategory, CreateFamilyActivityInput, ISODateString } from '@/types/models';
import { getActivityCategoryById } from '@/constants/activityCategories';
import { logEvent } from '@/services/telemetry/logEvent';
import { suggestActivityCategory } from '@/utils/categorySuggest';

/**
 * Keyword fallback: the category the text names, through the same guess the activity form uses
 * (`suggestActivityCategory`: the occasion matcher first, then every category's own keywords).
 * Conservative by design: no confident match gives undefined, so the user picks rather than us
 * guessing wrong.
 */
function keywordCategory(text: string | undefined): ActivityCategory | undefined {
  return text ? suggestActivityCategory(text)?.value : undefined;
}

/**
 * The model may return a `category` id it picked directly from the taxonomy embedded in the
 * prompt. Trust it ONLY when it is a real ACTIVITY_CATEGORIES id; a present-but-unknown id is
 * logged (never silently accepted) and treated as no signal so keyword inference takes over.
 */
function validatedModelCategory(result: ExtractionResult): ActivityCategory | undefined {
  const id = result.category;
  if (!id) return undefined;
  if (getActivityCategoryById(id)) return id as ActivityCategory;
  console.warn(
    '[activity-extract] model category id not recognized; falling back to keyword inference',
    { got: id, hint: result.categoryHint }
  );
  logEvent({
    level: 'warn',
    surface: 'ai-extract',
    message: 'unknown model category',
    context: { action: 'category-fallback' },
  });
  return undefined;
}

/**
 * Infer an activity category from an extraction result. Precedence: (1) the model's directly
 * picked, validated category id; (2) keyword match on the model's free-text hint; (3) on the
 * title; (4) on the description. Each text is matched on its own, so a long description's
 * peripheral words can never outvote the title. undefined when nothing matches. Works for every
 * tier: when no model id/hint is present (older proxy, BYOK, on-device) it relies on the
 * title/description passes.
 */
export function inferActivityCategory(result: ExtractionResult): ActivityCategory | undefined {
  const category =
    validatedModelCategory(result) ??
    keywordCategory(result.categoryHint) ??
    keywordCategory(result.title) ??
    keywordCategory(result.description);
  // An imported invitation is almost always a party, never a yearly "remember this" entry.
  return category === 'occasion_birthday' ? 'birthday' : category;
}

export function extractionToActivityPrefill(
  result: ExtractionResult
): Partial<CreateFamilyActivityInput> {
  const prefill: Partial<CreateFamilyActivityInput> = {};

  if (result.title) prefill.title = result.title;
  if (result.date) prefill.date = result.date as ISODateString;
  if (result.location) prefill.location = result.location;
  // The event's own web address (#113), already screened with `safeHttpsUrl` by the parser.
  if (result.link) prefill.link = result.link;
  // The model's free-text overflow (prep details, what-to-bring, dress code, RSVP — one fact
  // per line) routes to the activity's VISIBLE `notes` field. The `description` field is not
  // rendered/editable in ActivityModal, so routing here would hide it from the user.
  if (result.description) prefill.notes = result.description;

  // All-day events carry no clock times; otherwise pass through whatever was found.
  if (result.isAllDay) {
    prefill.isAllDay = true;
  } else {
    if (result.startTime) prefill.startTime = result.startTime;
    if (result.endTime) prefill.endTime = result.endTime;
  }

  // Category is INFERRED (not a found field), so it's only set on a confident match —
  // ActivityModal's category watch then derives the icon + colour. recurrence is left to
  // ActivityModal.applyPrefill (one-time default for prefilled forms).
  const category = inferActivityCategory(result);
  if (category) prefill.category = category;

  return prefill;
}
