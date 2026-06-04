// The single wedge-specific mapper (ADR-030, #133, Phase 3): turn an extracted document
// result into a PARTIAL activity prefill. Kept pure + total + standalone so it's unit-tested
// in isolation and future AI features (NL search) reuse the generic service without importing
// anything activity-shaped.
//
// Only fields the model found — plus a category we infer from the model's hint/title — are
// set (the prompt returns '' for absent fields); everything else (incl. recurrence) is left
// to ActivityModal's onNew/applyPrefill defaults. Nothing is auto-created — the prefill opens
// the form for the user to review, edit, and confirm.

import type { ExtractionResult } from '@/services/ai/types';
import type { ActivityCategory, CreateFamilyActivityInput, ISODateString } from '@/types/models';

/**
 * Keyword → activity-category inference. The extraction model returns at most a short
 * free-text `categoryHint` (e.g. "birthday party"); we map that — or, failing that, the
 * title + description — onto one of our ActivityCategory ids. Conservative by design: no
 * confident match → undefined, so the user picks rather than us guessing wrong.
 *
 * First-match-wins, so more specific patterns come first. Each pattern is word-bounded with
 * grouped alternation (every term in a group is anchored, not just the first) + the `i` flag.
 * Typed as ActivityCategory so a misspelt id fails the type-check; a unit test additionally
 * asserts every id is a real ACTIVITY_CATEGORIES entry, so the table can't drift out of sync.
 */
export const CATEGORY_KEYWORDS: ReadonlyArray<readonly [RegExp, ActivityCategory]> = [
  [/\bbirthday\b/i, 'birthday'],
  [/\bwedding\b/i, 'wedding'],
  [/\b(bar|bat) mitzvah\b/i, 'bar_mitzvah'],
  [/\b(recital|graduation|ceremony|presentation)\b/i, 'school_recital'],
  [/\bconcert\b/i, 'concert'],
  [/\b(show|musical|theatre|theater|play)\b/i, 'show'],
  [/\b(movie|cinema|film)\b/i, 'movie'],
  [/\b(festival|fair|carnival)\b/i, 'festival'],
  [/\b(museum|exhibit)\b/i, 'museum'],
  [/\b(theme|amusement) park\b/i, 'theme_park'],
  [/\b(game|match|tournament)\b/i, 'sporting_event'],
  [/\b(soccer|football)\b/i, 'soccer'],
  [/\btennis\b/i, 'tennis'],
  [/\bswim\w*\b/i, 'swimming'],
  [/\bgymnastics\b/i, 'gymnastics'],
  [/\b(dentist|dental)\b/i, 'dentist'],
  [/\b(doctor|clinic|pediatric|appointment)\b/i, 'doctor'],
  [/\b(eye exam|optometr\w*|optician)\b/i, 'eye_exam'],
  [/\b(haircut|salon|barber)\b/i, 'haircut'],
  [/\b(dinner|dining|restaurant|lunch)\b/i, 'dining_out'],
  [/\bbrunch\b/i, 'brunch'],
  [/\b(coffee|café|cafe)\b/i, 'coffee'],
  [/\b(drinks|cocktail|happy hour)\b/i, 'drinks'],
  [/\bpicnic\b/i, 'picnic'],
];

function matchCategory(text: string): ActivityCategory | undefined {
  for (const [pattern, id] of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return id;
  }
  return undefined;
}

/**
 * Infer an activity category from an extraction result. The model's free-text hint is the
 * primary signal; the title + description is the fallback; undefined when nothing matches.
 * Works for every tier — when no hint is present (older proxy, BYOK, on-device) it simply
 * relies on the title/description pass.
 */
export function inferActivityCategory(result: ExtractionResult): ActivityCategory | undefined {
  return (
    matchCategory(result.categoryHint ?? '') ??
    matchCategory(`${result.title} ${result.description}`)
  );
}

export function extractionToActivityPrefill(
  result: ExtractionResult
): Partial<CreateFamilyActivityInput> {
  const prefill: Partial<CreateFamilyActivityInput> = {};

  if (result.title) prefill.title = result.title;
  if (result.date) prefill.date = result.date as ISODateString;
  if (result.location) prefill.location = result.location;
  if (result.description) prefill.description = result.description;

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
