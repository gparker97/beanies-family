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

import type {
  ExtractionResult,
  FieldConfidence,
  TravelExtractionResult,
  TravelSegmentDraft,
} from './types';

export const PROMPT_VERSION = '2026-06-08.1';

/**
 * The activity-category taxonomy rendered for the model to pick `category` from.
 *
 * HARDCODED and byte-identical across all three prompt copies (drift guard). It is NOT
 * generated from `src/constants/activityCategories.ts` here because the spike/Lambda copies
 * are plain `.mjs` in other runtimes that cannot import it. Recipe (enforced by the
 * `extractionCategoryList` sync test): one line per group, `GroupName: id (Name), id (Name)`;
 * groups alphabetical with "Other" last; categories alphabetical with "Other *" last — exactly
 * what `getActivityCategoriesGrouped()` produces. When `ACTIVITY_CATEGORIES` changes, the sync
 * test fails — regenerate by that recipe, update all three copies, and bump `PROMPT_VERSION`.
 */
export const CATEGORY_OPTIONS_TEXT = [
  'Appointments: dentist (Dentist), doctor (Doctor), eye_exam (Eye Exam), haircut (Haircut), other_appointment (Other Appointment)',
  'Competitions: cubing (Cubing Competition), math_competition (Math Competition), spelling_bee (Spelling Bee), other_competition (Other Competition)',
  'Educational: language (Language), math (Math), science (Science), tutoring (Tutoring), other_educational (Other Educational)',
  'Entertainment: concert (Concert), festival (Festival / Fair), movie (Movie), museum (Museum), show (Show / Musical), sporting_event (Sporting Event), theme_park (Theme Park), other_entertainment (Other Entertainment)',
  'Food: brunch (Brunch), coffee (Coffee), dining_out (Dining Out), drinks (Drinks), picnic (Picnic), other_food (Other Food)',
  'Lessons: art (Art), dance (Dance / Ballet), drum (Drum), guitar (Guitar), music (Music), piano (Piano), swimming (Swimming), trumpet (Trumpet), other_lesson (Other Lesson)',
  'Party: bar_mitzvah (Bar Mitzvah), birthday (Birthday Party), wedding (Wedding), other_celebration (Other Celebration)',
  'School: after_school (After School Activity), field_trip (Field Trip), school_recital (School Recital / Presentation), other_school (Other School Activity)',
  'Sports: badminton (Badminton), baseball (Baseball), football (Football), golf_activity (Golf), gymnastics (Gymnastics), mma (MMA), multi_sport (Multi Sport), rugby (Rugby), soccer (Soccer), taekwondo (Taekwondo), tennis (Tennis), gym_activity (Training), yoga_activity (Yoga / Pilates), other_sports_activity (Other Sports)',
  'Other: other_activity (Other Activity)',
].join('\n');

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
    'string — capture every practical detail a parent, helper, or child needs to be ready that has no dedicated field above: what to bring, what to wear / dress code, what to prepare, RSVP, fees or money to bring, drop-off / pick-up notes — anything actionable. Write each distinct fact on its own line (one per line), never a single run-on paragraph. "" if there is nothing.',
  categoryHint:
    'string — a short lowercase label classifying the event type, e.g. "birthday", "soccer game", "dentist", "school recital", or "" if unclear',
  category:
    'string — the single best-matching category id chosen from the category list provided below, or "" if none fits well. Use ONLY an id from that list; prefer an "other_*" id within the correct group over a wrong specific id',
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
    'For "description", write each distinct fact on its own line (one per line), never a single run-on paragraph.',
    'For "category", choose the single best-matching id from this list (one line per group, shown as id (Name)); use "" if none fits well, and prefer an "other_*" id in the right group over a wrong specific id:\n' +
      CATEGORY_OPTIONS_TEXT,
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

  // categoryHint (free text) and category (a chosen taxonomy id) are both OPTIONAL (not in
  // REQUIRED_KEYS) so an older deployed proxy that predates either still parses. Include each
  // only when present + non-empty, so the parsed shape stays byte-identical to before for any
  // response that omits it. category is validated against the real taxonomy in the mapper.
  const categoryHint = asString(obj.categoryHint);
  const category = asString(obj.category);

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
    ...(category ? { category } : {}),
  };
}

// ── Travel task (2nd AI wedge, #30) ─────────────────────────────────────────────
// A travel document (flight/hotel/cruise/train/ferry/car booking, image or PDF) can
// yield MULTIPLE segments of different kinds, so the travel shape returns an array.
// Keep TRAVEL_* byte-identical across the spike/client/server copies (drift guard).

export const TRAVEL_JSON_SHAPE = {
  isTravel:
    'boolean — true only if the document is a real travel booking, ticket, itinerary, or confirmation (flight, hotel, cruise, train, ferry, car rental, transfer). false for anything else.',
  tripName:
    'string — a concise destination-based trip name inferred from the document (e.g. "Tokyo Trip", "Phuket Holiday"), or "" if not derivable',
  tripTypeHint:
    'string — one of: fly_and_stay, cruise, road_trip, combo, camping, adventure; or "" if unclear',
  segments:
    'array — ONE object per distinct booking in the document. A round-trip flight is TWO segments (outbound + return). Each object has: kind, type, title, status, travellers, bookingReference, notes, confidence, plus the relevant fields below.',
  kind: 'string — one of: "travel" | "accommodation" | "transportation"',
  type: 'string — for kind=travel: flight_outbound|flight_return|flight_other|cruise|train|ferry|car. for kind=accommodation: hotel|airbnb|campground|family_friends. for kind=transportation: airport_shuttle|rental_car|taxi_rideshare|bus.',
  travellers:
    'array of strings — the names of the people on THIS segment. Return each name in a clean "Given Surname" form: Title Case, drop honorifics/titles (Mr, Mrs, Ms, Mstr, Master, Miss, Dr), remove slashes and booking-code artefacts, reorder surname-first names to given-name-first, and omit middle names/initials (e.g. "SMITH/JONATHAN MR" → "Jonathan Smith"). [] if no names are shown. A booking shared by several people is ONE segment with multiple names here — NEVER output a separate segment per person.',
  travelFields:
    'kind=travel flights: airline, flightNumber, departureAirport, arrivalAirport, departureDate (YYYY-MM-DD), departureTime (24h HH:mm), arrivalDate, arrivalTime, terminal (departure terminal, e.g. "Terminal 1"), arrivesNextDay (boolean). cruise: cruiseLine, shipName, departurePort, terminal (cruise terminal, e.g. "Cruise Terminal A"), cabinNumber, embarkationDate, embarkationTime, disembarkationDate. train/ferry: operator, route, departureStation, arrivalStation, departureDate, departureTime, arrivalDate, arrivalTime.',
  accommodationFields:
    'kind=accommodation: name, address, checkInDate (YYYY-MM-DD), checkOutDate, confirmationNumber, roomType, contactPhone, breakfastIncluded (boolean), link.',
  transportationFields:
    'kind=transportation: agencyName, agencyAddress, pickupDate (YYYY-MM-DD), pickupTime (24h HH:mm), returnDate, returnTime, operator, route, departureStation, arrivalStation, departureDate, departureTime, link.',
  status:
    'string — "booked" if the document is a confirmation/ticket; "pending" if it is a quote/hold/unconfirmed',
  bookingReference: 'string — booking/confirmation/PNR reference, or ""',
  title: 'string — a short human label for the segment, or "" to let the app derive one',
  notes:
    'string — anything useful in the document not captured by a dedicated field (baggage allowance, seat, loyalty number, cancellation policy, terminal). Write each distinct fact on its own line (one per line), never a single run-on paragraph. Or "".',
  confidence: 'object — a 0..1 number under key "overall" for the segment as a whole',
} as const;

/**
 * Build the system+user message array for the TRAVEL extraction task.
 * @param imageDataUrl `data:` URL of the (already compressed/rasterized) image.
 * @param todayIso current date YYYY-MM-DD, for resolving relative dates.
 */
export function buildTravelExtractionMessages(
  imageDataUrl: string,
  todayIso: string
): ChatMessage[] {
  const system = [
    'You extract structured travel-booking details from a single image of a flight, hotel, cruise, train, ferry, or car-rental booking, ticket, or itinerary.',
    'Return ONLY a single JSON object — no prose, no markdown, no code fences.',
    `Today's date is ${todayIso}. Resolve any relative or partial dates against it. Output dates as YYYY-MM-DD and times as 24-hour HH:mm.`,
    'A single document may contain SEVERAL bookings (e.g. an outbound and a return flight, or a flight plus a hotel). Return one object in "segments" for each distinct booking. A round-trip flight is two segments.',
    'Classify each segment with the correct "kind" and "type" and fill the relevant fields. Put any useful detail that has no dedicated field into that segment\'s "notes", writing ONE fact per line (each on its own line, separated by a line break) rather than a single run-on paragraph.',
    'If one booking covers multiple passengers, return a single segment and list every passenger in that segment\'s "travellers". Never duplicate a segment to represent different passengers.',
    'Output every name in "travellers" as "Given Surname" in Title Case: drop honorifics/titles (Mr/Mrs/Mstr/Miss/Dr/etc.), remove slashes and booking-code artefacts, reorder surname-first names, and omit middle names/initials. Example: "SMITH/JONATHAN MR" → "Jonathan Smith".',
    'If a field is not present in the document, return an empty string for it (do not invent values). Set isTravel=false and segments=[] if the document is not a travel booking.',
    'Never output any value that is not actually supported by the document. It is better to leave a field empty than to hallucinate.',
    'The top-level JSON object must have exactly these keys: ' +
      ['isTravel', 'tripName', 'tripTypeHint', 'segments'].join(', ') +
      '.',
    'Field meanings: ' + JSON.stringify(TRAVEL_JSON_SHAPE) + '.',
  ].join('\n');

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract the travel booking(s) from this document as the specified JSON object.',
        },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

/** Top-level keys the travel model output must include. */
export const TRAVEL_REQUIRED_KEYS = ['isTravel', 'tripName', 'tripTypeHint', 'segments'] as const;

/**
 * Per-task registry so callers select prompt + required keys by task without scattered
 * `if (task === …)` branches. Adding a task = one entry here (and in the spike/server copies).
 */
export const EXTRACTION_TASKS = {
  event: { buildMessages: buildExtractionMessages, requiredKeys: REQUIRED_KEYS },
  travel: { buildMessages: buildTravelExtractionMessages, requiredKeys: TRAVEL_REQUIRED_KEYS },
} as const;

/** The per-kind objects the model nests its detail fields under (per TRAVEL_JSON_SHAPE). */
const NESTED_FIELD_KEYS = ['travelFields', 'accommodationFields', 'transportationFields'] as const;

/**
 * Structural keys that are NOT segment detail fields — handled explicitly below. Excluded
 * from the flat-field sweep so they never leak into `fields` (and from there into `notes`).
 */
const SEGMENT_STRUCTURAL_KEYS = new Set<string>([
  'kind',
  'type',
  'title',
  'status',
  'bookingReference',
  'notes',
  'confidence',
  'arrivesNextDay',
  'breakfastIncluded',
  'travellers',
  ...NESTED_FIELD_KEYS,
]);

/** Coerce an unknown into a clean list of trimmed, non-empty strings (else []). */
function toStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Copy a source object's scalar (string/number) entries into `target`, skipping `skip` keys. */
function collectScalarFields(
  source: Record<string, unknown>,
  target: Record<string, string>,
  skip?: Set<string>
): void {
  for (const [k, v] of Object.entries(source)) {
    if (skip?.has(k)) continue;
    if (typeof v === 'string') target[k] = v;
    else if (typeof v === 'number') target[k] = String(v);
  }
}

/** Coerce one raw model segment into a defensively-typed {@link TravelSegmentDraft}. */
function parseTravelSegment(raw: unknown): TravelSegmentDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const kind = asString(obj.kind);
  if (kind !== 'travel' && kind !== 'accommodation' && kind !== 'transportation') return null;

  // The model nests detail fields under travelFields / accommodationFields /
  // transportationFields (per TRAVEL_JSON_SHAPE). Flatten whichever are present into a single
  // flat `fields` record the mapper (Phase C) reads by name. Also tolerate a flat shape
  // (stray top-level scalars) for BYOK/older responses — structural keys are excluded so
  // they never leak into fields (and from there into the notes overflow).
  const fields: Record<string, string> = {};
  collectScalarFields(obj, fields, SEGMENT_STRUCTURAL_KEYS);
  const nested: Record<string, unknown> = {};
  for (const nk of NESTED_FIELD_KEYS) {
    const sub = obj[nk];
    if (typeof sub === 'object' && sub !== null) {
      collectScalarFields(sub as Record<string, unknown>, fields);
      Object.assign(nested, sub);
    }
  }

  const rawConfidence =
    typeof obj.confidence === 'object' && obj.confidence !== null
      ? (obj.confidence as Record<string, unknown>)
      : {};

  return {
    kind,
    type: asString(obj.type),
    title: asString(obj.title),
    status: asString(obj.status) === 'pending' ? 'pending' : 'booked',
    bookingReference: asString(obj.bookingReference),
    notes: asString(obj.notes),
    // These booleans live inside the nested *Fields object; fall back to top-level for a flat shape.
    arrivesNextDay: asBool(obj.arrivesNextDay) || asBool(nested.arrivesNextDay),
    breakfastIncluded: asBool(obj.breakfastIncluded) || asBool(nested.breakfastIncluded),
    fields,
    // Names may arrive top-level or nested under *Fields; never leak into `fields`/`notes`.
    travellers: toStringList(obj.travellers ?? nested.travellers),
    confidence: clamp01(rawConfidence.overall),
  };
}

/**
 * Validate + coerce a parsed travel model object into a typed {@link TravelExtractionResult}.
 * Throws (callers wrap as `malformed_output`) when required top-level keys are missing.
 * Malformed individual segments are dropped (logged by the mapper), never silently kept.
 */
export function parseTravelExtractionResult(raw: unknown): TravelExtractionResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Travel extraction output is not a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const missing = TRAVEL_REQUIRED_KEYS.filter((k) => !(k in obj));
  if (missing.length) {
    throw new Error(`Travel extraction output missing keys: ${missing.join(', ')}`);
  }
  const rawSegments = Array.isArray(obj.segments) ? obj.segments : [];
  const segments = rawSegments
    .map(parseTravelSegment)
    .filter((s): s is TravelSegmentDraft => s !== null);

  return {
    isTravel: asBool(obj.isTravel),
    tripName: asString(obj.tripName),
    tripTypeHint: asString(obj.tripTypeHint),
    segments,
  };
}
