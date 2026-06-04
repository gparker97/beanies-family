// Client/BYOK extraction prompt + JSON schema for the event/invitation → activity wedge.
//
// DRIFT GUARD: this is the CLIENT copy of the prompt. There are three physical copies
// by design (different runtimes — they cannot be one file):
//   • scripts/spikes/extractionPrompt.mjs        — the Phase-1 validation harness
//   • src/services/ai/extractionPrompt.ts         — THIS file (client / BYOK path)
//   • infrastructure/lambda/ai-extract/…          — the server / managed path (Phase 2 backend)
// They are kept identical by a unit test that fails CI if PROMPT_VERSION, the JSON shape,
// the required keys, or the built messages diverge (see __tests__/extractionPromptDrift.test.ts).
// Bump PROMPT_VERSION on ANY change so drift is detectable, and update every copy together.

import type { ExtractionResult, FieldConfidence } from './types';

export const PROMPT_VERSION = '2026-06-04.1';

/**
 * The structured shape we ask the model to return. Confidence is 0..1 per field so the
 * UI can flag low-confidence values. `isEvent` lets us gracefully handle a non-event image
 * instead of inventing one. Keep this byte-identical to the spike/server copies.
 */
export const EXTRACTION_JSON_SHAPE = {
  isEvent:
    'boolean — true only if the image is a real event/invitation/activity with at least a title or a date',
  title:
    'string — the event/activity name, concise (e.g. "Mia\'s 6th Birthday Party"), or "" if absent',
  date: 'string — ISO date YYYY-MM-DD of the event, or "" if absent. Resolve relative/partial dates against the current date provided below; never guess a year that is not derivable',
  startTime: 'string — 24h HH:mm, or "" if absent',
  endTime: 'string — 24h HH:mm, or "" if absent',
  isAllDay: 'boolean — true if it is an all-day event with no specific time',
  location: 'string — venue/address as written, or "" if absent',
  description:
    'string — a short note capturing anything useful not in the other fields (dress code, RSVP, what to bring), or ""',
  categoryHint:
    'string — a short lowercase label classifying the event type, e.g. "birthday", "soccer game", "dentist", "school recital", or "" if unclear',
  confidence: 'object — a 0..1 number for each of: title, date, startTime, endTime, location',
} as const;

/** An OpenAI-compatible chat message (text + image parts). Domain-neutral wire shape. */
export interface ChatMessage {
  role: 'system' | 'user';
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

/**
 * Build the system+user message array for an OpenAI-compatible vision chat call.
 * @param imageDataUrl `data:` URL of the (already compressed) image.
 * @param todayIso current date YYYY-MM-DD, for resolving relative dates.
 */
export function buildExtractionMessages(imageDataUrl: string, todayIso: string): ChatMessage[] {
  const system = [
    'You extract structured calendar-event details from a single image of an invitation, school notice, or activity flyer.',
    'Return ONLY a single JSON object — no prose, no markdown, no code fences.',
    `Today's date is ${todayIso}. Resolve any relative or partial dates against it. Output dates as YYYY-MM-DD and times as 24-hour HH:mm.`,
    'If a field is not present in the image, return an empty string for it (do not invent values). Set isEvent=false if the image is not an event/invitation.',
    'Never output any value that is not actually supported by the image. It is better to leave a field empty than to hallucinate.',
    'The JSON object must have exactly these keys: ' +
      Object.keys(EXTRACTION_JSON_SHAPE).join(', ') +
      '.',
    'Field meanings: ' + JSON.stringify(EXTRACTION_JSON_SHAPE) + '.',
  ].join('\n');

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract the event details from this image as the specified JSON object.',
        },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

/** Keys the model must return; used to validate the parsed object shape. */
export const REQUIRED_KEYS = [
  'isEvent',
  'title',
  'date',
  'startTime',
  'endTime',
  'isAllDay',
  'location',
  'description',
  'confidence',
] as const;

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asBool(v: unknown): boolean {
  return v === true;
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : 0;
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Validate + coerce a parsed model object into a typed {@link ExtractionResult}.
 * Throws `Error` (callers wrap as `malformed_output`) when required keys are missing,
 * so a garbled model response never silently produces a half-formed activity.
 * Strings default to `''`, booleans to `false`, confidences clamp to 0..1 — defensive
 * against a model that omits or mistypes a field while still returning valid JSON.
 */
export function parseExtractionResult(raw: unknown): ExtractionResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Extraction output is not a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const missing = REQUIRED_KEYS.filter((k) => !(k in obj));
  if (missing.length) {
    throw new Error(`Extraction output missing keys: ${missing.join(', ')}`);
  }

  const rawConfidence =
    typeof obj.confidence === 'object' && obj.confidence !== null
      ? (obj.confidence as Record<string, unknown>)
      : {};
  const confidence: FieldConfidence = {
    title: clamp01(rawConfidence.title),
    date: clamp01(rawConfidence.date),
    startTime: clamp01(rawConfidence.startTime),
    endTime: clamp01(rawConfidence.endTime),
    location: clamp01(rawConfidence.location),
  };

  // categoryHint is OPTIONAL (not in REQUIRED_KEYS) so an older deployed proxy that
  // predates this field still parses. Include it only when present + non-empty, so the
  // parsed shape stays byte-identical to before for any response that omits it.
  const categoryHint = asString(obj.categoryHint);

  return {
    isEvent: asBool(obj.isEvent),
    title: asString(obj.title),
    date: asString(obj.date),
    startTime: asString(obj.startTime),
    endTime: asString(obj.endTime),
    isAllDay: asBool(obj.isAllDay),
    location: asString(obj.location),
    description: asString(obj.description),
    confidence,
    ...(categoryHint ? { categoryHint } : {}),
  };
}
