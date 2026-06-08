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
// logged via console.warn (matching the [travel-extract] convention) rather than silently
// dropped, then keyword inference takes over. No throws, no other side effects.

import type { ExtractionResult } from '@/services/ai/types';
import type { ActivityCategory, CreateFamilyActivityInput, ISODateString } from '@/types/models';
import { getActivityCategoryById } from '@/constants/activityCategories';

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
  // School (the motivating gap — esp. "learning journey", the SG term for a field trip).
  [/\b(field trip|excursion|learning journey|school outing|school visit)\b/i, 'field_trip'],
  [/\bafter[- ]school\b/i, 'after_school'],
  // A couple of unambiguous, collision-free extras. Broad Educational/Lessons/Sports keyword
  // coverage is deliberately NOT added — the model's list-pick (result.category) is the primary
  // path now, so this table stays a shallow, low-collision backstop (see plan).
  [/\bspelling bee\b/i, 'spelling_bee'],
  [/\bcubing\b/i, 'cubing'],
];

function matchCategory(text: string): ActivityCategory | undefined {
  for (const [pattern, id] of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return id;
  }
  return undefined;
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
  return undefined;
}

/**
 * Infer an activity category from an extraction result. Precedence: (1) the model's directly
 * picked, validated category id; (2) keyword match on the model's free-text hint; (3) keyword
 * match on title + description. undefined when nothing matches. Works for every tier — when no
 * model id/hint is present (older proxy, BYOK, on-device) it relies on the title/description pass.
 */
export function inferActivityCategory(result: ExtractionResult): ActivityCategory | undefined {
  return (
    validatedModelCategory(result) ??
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
