// Server/managed extraction prompt + JSON schema for the event/invitation → activity wedge.
//
// DRIFT GUARD: this is the SERVER copy (the managed/proxy path). Three physical copies exist
// by design (different runtimes — they cannot be one file):
//   • scripts/spikes/extractionPrompt.mjs        — the Phase-1 validation harness
//   • src/services/ai/extractionPrompt.ts         — the client / BYOK path
//   • infrastructure/lambda/ai-extract/extractionPrompt.mjs — THIS file (server / managed)
// They are kept identical by a unit test that fails CI if PROMPT_VERSION, the JSON shape, the
// required keys, or the built messages diverge (src/services/ai/__tests__/extractionPromptDrift.test.ts).
// Bump PROMPT_VERSION on ANY change so drift is detectable, and update every copy together.

export const PROMPT_VERSION = '2026-06-02.1';

// The structured shape we ask the model to return. Confidence is 0..1 per field so the UI can flag
// low-confidence values. `isEvent` lets us gracefully handle a non-event image instead of inventing one.
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
  confidence: 'object — a 0..1 number for each of: title, date, startTime, endTime, location',
};

/**
 * Build the system+user message array for an OpenAI-compatible vision chat call.
 * @param {string} imageDataUrl  data: URL of the (already compressed) image.
 * @param {string} todayIso      current date YYYY-MM-DD, for resolving relative dates.
 */
export function buildExtractionMessages(imageDataUrl, todayIso) {
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

// Keys the model must return; used by the handler to validate the parsed object shape.
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
];
