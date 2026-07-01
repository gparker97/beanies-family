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

export const PROMPT_VERSION = '2026-07-01.1';

// The activity-category taxonomy rendered for the model to pick `category` from.
// HARDCODED and byte-identical across all three prompt copies (drift guard) — the .mjs copies
// cannot import src/constants/activityCategories.ts. Recipe (enforced by the extractionCategoryList
// sync test in the client): one line per group, `GroupName: id (Name), id (Name)`; groups
// alphabetical with "Other" last; categories alphabetical with "Other *" last — exactly what
// getActivityCategoriesGrouped() produces. On taxonomy change, regenerate, update all three
// copies, and bump PROMPT_VERSION.
export const CATEGORY_OPTIONS_TEXT = [
  'Appointments: dentist (Dentist), doctor (Doctor), eye_exam (Eye Exam), haircut (Haircut), therapy (Therapy), other_appointment (Other Appointment)',
  'Competitions: cubing (Cubing Competition), gymnastics_competition (Gymnastics Competition), math_competition (Math Competition), spelling_bee (Spelling Bee), swimming_competition (Swimming Competition), track_field (Track & Field), other_competition (Other Competition)',
  'Educational: language (Language), math (Math), science (Science), tutoring (Tutoring), other_educational (Other Educational)',
  'Food: brunch (Brunch), coffee (Coffee), dining_out (Dining Out), drinks (Drinks), picnic (Picnic), other_food (Other Food)',
  'Fun: arcade (Arcade), beach (Beach), bowling (Bowling), concert (Concert), festival (Festival / Fair), movie (Movie), museum (Museum), playground (Playground / Park), pool (Pool / Swim), show (Show / Musical), sporting_event (Sporting Event), theme_park (Theme Park), zoo (Zoo / Aquarium), other_entertainment (Other Fun Thing)',
  'Lessons: art (Art), chess (Chess), coding (Coding / Robotics), dance (Dance / Ballet), drama (Drama / Acting), drum (Drum), guitar (Guitar), music (Music), piano (Piano), voice (Singing / Voice), swimming (Swimming), trumpet (Trumpet), other_lesson (Other Lesson)',
  'Party: anniversary (Anniversary), baby_shower (Baby Shower), bar_mitzvah (Bar Mitzvah), birthday (Birthday Party), graduation (Graduation), wedding (Wedding), other_celebration (Other Celebration)',
  'Pets: pet_grooming (Grooming), vet (Vet), other_pet (Other Pet)',
  'Religious: religious_class (Religious Class), worship (Worship / Service), other_religious (Other Religious)',
  'School: after_school (After School Activity), field_trip (Field Trip), school_recital (School Recital / Presentation), other_school (Other School Activity)',
  'Social: date_night (Date Night), family_visit (Family Visit), playdate (Playdate), other_social (Other Social)',
  'Sports: badminton (Badminton), baseball (Baseball), basketball (Basketball), football (Football), golf_activity (Golf), gymnastics (Gymnastics), mma (MMA), multi_sport (Multi Sport), rugby (Rugby), soccer (Soccer), taekwondo (Taekwondo), tennis (Tennis), gym_activity (Training), yoga_activity (Yoga / Pilates), other_sports_activity (Other Sports)',
  'Work: conference (Conference), networking (Networking), work_party (Office Party), team_building (Team Building / Outing), work_dinner (Work Dinner), work_drinks (Work Drinks), other_work (Other Work)',
  'Other: other_activity (Other Activity)',
].join('\n');

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
    'string — capture every practical detail a parent, helper, or child needs to be ready that has no dedicated field above: what to bring, what to wear / dress code, what to prepare, RSVP, fees or money to bring, drop-off / pick-up notes — anything actionable. Write each distinct fact on its own line (one per line), never a single run-on paragraph. "" if there is nothing.',
  categoryHint:
    'string — a short lowercase label classifying the event type, e.g. "birthday", "soccer game", "dentist", "school recital", or "" if unclear',
  category:
    'string — the single best-matching category id chosen from the category list provided below, or "" if none fits well. Use ONLY an id from that list; prefer an "other_*" id within the correct group over a wrong specific id',
  confidence: 'object — a 0..1 number for each of: title, date, startTime, endTime, location',
};

/**
 * Build the system+user message array for an OpenAI-compatible vision chat call.
 * @param {string[]} imageDataUrls  data: URL(s) of the (already compressed) page image(s),
 *   in page order — one for a photo, up to MAX_EXTRACT_PAGES for a PDF (all of one document).
 * @param {string} todayIso      current date YYYY-MM-DD, for resolving relative dates.
 */
export function buildExtractionMessages(imageDataUrls, todayIso) {
  const system = [
    'You extract structured calendar-event details from one or more images — the pages of a single invitation, school notice, or activity flyer, in page order.',
    'Return ONLY a single JSON object — no prose, no markdown, no code fences.',
    `Today's date is ${todayIso}. Resolve any relative or partial dates against it. Output dates as YYYY-MM-DD and times as 24-hour HH:mm.`,
    'If a field is not present in the images, return an empty string for it (do not invent values). Set isEvent=false if the images are not an event/invitation.',
    'Never output any value that is not actually supported by the images. It is better to leave a field empty than to hallucinate.',
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
          text: 'Extract the event details from these page image(s) as the specified JSON object.',
        },
        ...imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
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
};

/**
 * Build the system+user message array for the TRAVEL extraction task.
 * @param {string[]} imageDataUrls  data: URL(s) of the (already compressed/rasterized) page
 *   image(s), in page order — one for a photo, up to MAX_EXTRACT_PAGES for a PDF (one document).
 * @param {string} todayIso      current date YYYY-MM-DD, for resolving relative dates.
 */
export function buildTravelExtractionMessages(imageDataUrls, todayIso) {
  const system = [
    'You extract structured travel-booking details from one or more images — the pages of a single flight, hotel, cruise, train, ferry, or car-rental booking, ticket, or itinerary, in page order.',
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
          text: 'Extract the travel booking(s) from these page image(s) as the specified JSON object.',
        },
        ...imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
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
