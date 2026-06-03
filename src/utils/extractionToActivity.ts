// The single wedge-specific mapper (ADR-030, #133, Phase 3): turn an extracted document
// result into a PARTIAL activity prefill. Kept pure + total + standalone so it's unit-tested
// in isolation and future AI features (categorization, NL search) reuse the generic service
// without importing anything activity-shaped.
//
// Only fields the model actually found are set (the prompt returns '' for absent fields);
// everything else is left to ActivityModal's onNew defaults. Nothing is auto-created — the
// prefill opens the form for the user to review, edit, and confirm.

import type { ExtractionResult } from '@/services/ai/types';
import type { CreateFamilyActivityInput, ISODateString } from '@/types/models';

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

  return prefill;
}
