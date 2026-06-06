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

export const PROMPT_VERSION = '2026-06-06.1';

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
  categoryHint:
    'string — a short lowercase label classifying the event type, e.g. "birthday", "soccer game", "dentist", "school recital", or "" if unclear',
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
    'array — ONE object per distinct booking in the document. A round-trip flight is TWO segments (outbound + return). Each object has: kind, type, title, status, bookingReference, notes, confidence, plus the relevant fields below.',
  kind: 'string — one of: "travel" | "accommodation" | "transportation"',
  type: 'string — for kind=travel: flight_outbound|flight_return|flight_other|cruise|train|ferry|car. for kind=accommodation: hotel|airbnb|campground|family_friends. for kind=transportation: airport_shuttle|rental_car|taxi_rideshare|bus.',
  travelFields:
    'kind=travel flights: airline, flightNumber, departureAirport, arrivalAirport, departureDate (YYYY-MM-DD), departureTime (24h HH:mm), arrivalDate, arrivalTime, arrivesNextDay (boolean). cruise: cruiseLine, shipName, departurePort, cabinNumber, embarkationDate, embarkationTime, disembarkationDate. train/ferry: operator, route, departureStation, arrivalStation, departureDate, departureTime, arrivalDate, arrivalTime.',
  accommodationFields:
    'kind=accommodation: name, address, checkInDate (YYYY-MM-DD), checkOutDate, confirmationNumber, roomType, contactPhone, breakfastIncluded (boolean), link.',
  transportationFields:
    'kind=transportation: agencyName, agencyAddress, pickupDate (YYYY-MM-DD), pickupTime (24h HH:mm), returnDate, returnTime, operator, route, departureStation, arrivalStation, departureDate, departureTime, link.',
  status:
    'string — "booked" if the document is a confirmation/ticket; "pending" if it is a quote/hold/unconfirmed',
  bookingReference: 'string — booking/confirmation/PNR reference, or ""',
  title: 'string — a short human label for the segment, or "" to let the app derive one',
  notes:
    'string — anything useful in the document not captured by a dedicated field (baggage allowance, seat, loyalty number, cancellation policy, terminal), or ""',
  confidence: 'object — a 0..1 number under key "overall" for the segment as a whole',
};

/**
 * Build the system+user message array for the TRAVEL extraction task.
 * @param {string} imageDataUrl  data: URL of the (already compressed/rasterized) image.
 * @param {string} todayIso      current date YYYY-MM-DD, for resolving relative dates.
 */
export function buildTravelExtractionMessages(imageDataUrl, todayIso) {
  const system = [
    'You extract structured travel-booking details from a single image of a flight, hotel, cruise, train, ferry, or car-rental booking, ticket, or itinerary.',
    'Return ONLY a single JSON object — no prose, no markdown, no code fences.',
    `Today's date is ${todayIso}. Resolve any relative or partial dates against it. Output dates as YYYY-MM-DD and times as 24-hour HH:mm.`,
    'A single document may contain SEVERAL bookings (e.g. an outbound and a return flight, or a flight plus a hotel). Return one object in "segments" for each distinct booking. A round-trip flight is two segments.',
    'Classify each segment with the correct "kind" and "type" and fill the relevant fields. Put any useful detail that has no dedicated field into that segment\'s "notes".',
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

// Top-level keys the travel model output must include.
export const TRAVEL_REQUIRED_KEYS = ['isTravel', 'tripName', 'tripTypeHint', 'segments'];

/**
 * Per-task registry so callers (Lambda, drift guard) select prompt + required keys by
 * task without scattered `if (task === …)` branches. Adding a task = one entry here.
 */
export const EXTRACTION_TASKS = {
  event: { buildMessages: buildExtractionMessages, requiredKeys: REQUIRED_KEYS },
  travel: { buildMessages: buildTravelExtractionMessages, requiredKeys: TRAVEL_REQUIRED_KEYS },
};
