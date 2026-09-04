import { describe, it, expect } from 'vitest';

// #72 security pass — the model reads UNTRUSTED documents (and, once the recipe task lands,
// untrusted web pages and video captions). Nothing bounded its output before this suite:
// a hostile source could make it emit megabyte strings or ten-thousand-entry arrays, which
// would be written into the Automerge doc, persisted to the `.beanpod`, and replicated to
// every family device permanently.
//
// The contract these tests pin: caps TRUNCATE, they never throw. An over-long response is a
// quality problem, not an outage — throwing would turn a bloated field into a failed
// extraction the user has no way to work around.
import {
  parseExtractionResult,
  parseTravelExtractionResult,
  MODEL_FIELD_MAX,
  MODEL_TEXT_MAX,
  MODEL_LIST_MAX,
} from '../extractionPrompt';

const HUGE = 'A'.repeat(1_000_000);

function hostileEvent() {
  return {
    isEvent: true,
    title: HUGE,
    date: HUGE,
    startTime: HUGE,
    endTime: HUGE,
    isAllDay: false,
    location: HUGE,
    description: HUGE,
    categoryHint: HUGE,
    category: HUGE,
    confidence: { title: 1, date: 1, startTime: 1, endTime: 1, location: 1 },
  };
}

describe('event extraction output caps', () => {
  it('truncates every short field to MODEL_FIELD_MAX without throwing', () => {
    const r = parseExtractionResult(hostileEvent());
    for (const key of ['title', 'date', 'startTime', 'endTime', 'location'] as const) {
      expect(r[key]).toHaveLength(MODEL_FIELD_MAX);
    }
    expect(r.categoryHint).toHaveLength(MODEL_FIELD_MAX);
    expect(r.category).toHaveLength(MODEL_FIELD_MAX);
  });

  it('truncates free text to MODEL_TEXT_MAX', () => {
    expect(parseExtractionResult(hostileEvent()).description).toHaveLength(MODEL_TEXT_MAX);
  });

  it('leaves an ordinary response byte-identical', () => {
    const ordinary = {
      ...hostileEvent(),
      title: "Mia's 6th Birthday Party",
      date: '2026-09-01',
      startTime: '14:00',
      endTime: '16:00',
      location: '12 Oak Street',
      description: 'Bring swimmers.\nNo nuts please.',
      categoryHint: 'birthday',
      category: 'birthday',
    };
    const r = parseExtractionResult(ordinary);
    expect(r.title).toBe("Mia's 6th Birthday Party");
    expect(r.description).toBe('Bring swimmers.\nNo nuts please.');
    expect(r.category).toBe('birthday');
  });
});

describe('travel extraction output caps', () => {
  // Comfortably past the cap, DERIVED from it — a literal like 5000 proves nothing extra and
  // is not safe against the cap being raised. It also matters for runtime: the travel
  // fixtures are a segment count times a traveller count, so a literal 5000 in both built 25
  // million array slots per test and pushed this file's 5s timeout over the edge under a
  // loaded full run.
  const OVER_CAP = MODEL_LIST_MAX * 2 + 1;

  const segment = (over: Record<string, unknown> = {}) => ({
    kind: 'accommodation',
    type: 'hotel',
    title: HUGE,
    status: 'booked',
    bookingReference: HUGE,
    notes: HUGE,
    travellers: Array.from({ length: OVER_CAP }, () => HUGE),
    confidence: { overall: 1 },
    ...over,
  });

  it('caps the segment array, its scalars, its notes and its traveller list', () => {
    const r = parseTravelExtractionResult({
      isTravel: true,
      tripName: HUGE,
      tripTypeHint: HUGE,
      segments: Array.from({ length: OVER_CAP }, () => segment()),
    });

    expect(r.segments).toHaveLength(MODEL_LIST_MAX);
    expect(r.tripName).toHaveLength(MODEL_FIELD_MAX);
    expect(r.tripTypeHint).toHaveLength(MODEL_FIELD_MAX);

    const first = r.segments[0];
    expect(first.title).toHaveLength(MODEL_FIELD_MAX);
    expect(first.bookingReference).toHaveLength(MODEL_FIELD_MAX);
    expect(first.notes).toHaveLength(MODEL_TEXT_MAX);
    expect(first.travellers).toHaveLength(MODEL_LIST_MAX);
    expect(first.travellers[0]).toHaveLength(MODEL_FIELD_MAX);
  });

  it('caps the free-form `fields` record — key COUNT, not just value length', () => {
    // `fields` is keyed by whatever the model returned, so an unbounded loop would let a
    // hostile document choose how many keys we persist.
    const flood: Record<string, unknown> = {};
    for (let i = 0; i < OVER_CAP; i++) flood[`f${i}`] = HUGE;
    const r = parseTravelExtractionResult({
      isTravel: true,
      tripName: 'x',
      tripTypeHint: 'x',
      segments: [segment({ accommodationFields: flood })],
    });
    const fields = r.segments[0].fields;
    expect(Object.keys(fields).length).toBeLessThanOrEqual(MODEL_LIST_MAX);
    for (const v of Object.values(fields)) expect(v.length).toBeLessThanOrEqual(MODEL_TEXT_MAX);
  });

  it('never throws on a hostile response — truncation is not an outage', () => {
    expect(() =>
      parseTravelExtractionResult({
        isTravel: true,
        tripName: HUGE,
        tripTypeHint: HUGE,
        segments: Array.from({ length: OVER_CAP }, () => segment()),
      })
    ).not.toThrow();
  });
});

describe('cap ORDERING regressions (found by /code-review max)', () => {
  it('toStringList filters BEFORE slicing — a leading run of junk must not empty the list', () => {
    // The parser tolerates non-strings elsewhere, so a model returning
    // [null ×100, "Alice", "Bob"] is a real shape. Slicing first yielded [] and the segment
    // saved with no travellers and no warning.
    const travellers = [...Array(100).fill(null), 'Alice', 'Bob'];
    const r = parseTravelExtractionResult({
      isTravel: true,
      tripName: 'x',
      tripTypeHint: 'x',
      segments: [
        {
          kind: 'travel',
          type: 'flight',
          title: 't',
          status: 'booked',
          travellers,
          confidence: {},
        },
      ],
    });
    expect(r.segments[0].travellers).toEqual(['Alice', 'Bob']);
  });

  it('the flat field sweep cannot starve the nested one', () => {
    // `fields` is filled in two passes. With a shared budget, 100+ stray top-level scalars
    // consumed it and every mapped detail field (checkIn, flightNumber…) was dropped, then
    // rendered as junk in segment.notes.
    const flood: Record<string, unknown> = {};
    for (let i = 0; i < 150; i++) flood[`junk${i}`] = 'x';
    const r = parseTravelExtractionResult({
      isTravel: true,
      tripName: 'x',
      tripTypeHint: 'x',
      segments: [
        {
          kind: 'accommodation',
          type: 'hotel',
          title: 't',
          status: 'booked',
          confidence: {},
          ...flood,
          accommodationFields: { checkInDate: '2026-09-01', confirmationNumber: 'ABC123' },
        },
      ],
    });
    const fields = r.segments[0].fields;
    expect(fields.checkInDate, 'nested detail fields must survive a flat-field flood').toBe(
      '2026-09-01'
    );
    expect(fields.confirmationNumber).toBe('ABC123');
  });
});
