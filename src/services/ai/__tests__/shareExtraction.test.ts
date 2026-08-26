/**
 * The SHARE task (#64): one call that classifies AND extracts.
 *
 * The parser's whole job is to read `kind` and DELEGATE to the parser that already owns that
 * shape — so these tests are about routing and about refusing bad input, not about field
 * coercion (which the three delegated parsers already cover). A wrong `kind` must never
 * produce a confidently-wrong item; it must throw, so the funnel classifies it as
 * `malformed_output` and the shared toast mapper reports it.
 */
import { describe, it, expect } from 'vitest';
import {
  EXTRACTION_PARSERS,
  EXTRACTION_TASKS,
  SHARE_JSON_SHAPE,
  buildShareExtractionMessages,
  parseShareExtractionResult,
} from '../extractionPrompt';

const eventPayload = {
  isEvent: true,
  title: 'Sports Day',
  date: '2026-07-12',
  startTime: '09:00',
  endTime: '12:00',
  isAllDay: false,
  location: 'School Field',
  description: 'Bring a hat',
  confidence: { title: 0.9, date: 0.9, startTime: 0.8, endTime: 0.8, location: 0.9 },
};

const travelPayload = {
  isTravel: true,
  tripName: 'Tokyo',
  tripTypeHint: 'holiday',
  segments: [{ segmentType: 'travel', title: 'NH820', startDate: '2026-07-01' }],
};

const recipePayload = {
  isRecipe: true,
  name: 'Pancakes',
  ingredients: ['250g flour'],
  steps: ['Mix'],
  confidence: { title: 0.9, ingredients: 0.9, steps: 0.9 },
};

describe('share task registry (#64)', () => {
  it('accepts images AND text', () => {
    // Text was added for shared LINKS (#64 links): the model is given the page content
    // content-fetch already retrieved, never the bare URL. The `sources` fence still does
    // its job — `event` and `travel` remain images-only, so the soft-keyed proxy is not a
    // general text endpoint. The recipe task already sat behind exactly this fence.
    expect(EXTRACTION_TASKS.share.sources).toEqual(['images', 'text']);
    expect(EXTRACTION_TASKS.event.sources).toEqual(['images']);
    expect(EXTRACTION_TASKS.travel.sources).toEqual(['images']);
  });

  it('does not name its source as "images" now that it can be given text', () => {
    // Fed text, a prompt that says "supported by the images" is a contradiction the model
    // has to resolve. The recipe prompt is deliberately NOT shared with this one — it is
    // tuned for a different job, and editing it to serve DRY would change a live feature
    // with no test able to catch the regression.
    const [system] = buildShareExtractionMessages(
      { kind: 'text', text: 'some page text' },
      '2026-06-03'
    );
    const content = system.content as string;
    expect(content).not.toContain('supported by the images');
    expect(content).toContain('supported by the source');
  });

  it('requires only `kind`, leaving payload validation to the delegated parser', () => {
    expect([...EXTRACTION_TASKS.share.requiredKeys]).toEqual(['kind']);
  });

  it('composes the three task shapes rather than restating their fields', () => {
    // If a field list were copied in here it would drift from the task that owns it.
    expect(Object.keys(SHARE_JSON_SHAPE)).toEqual(['kind', 'event', 'travel', 'recipe']);
  });

  it('describes all three nested shapes in one prompt, and asks for exactly one', () => {
    const [system] = buildShareExtractionMessages(
      { kind: 'images', imageDataUrls: ['data:image/jpeg;base64,AAAA'] },
      '2026-06-03'
    );
    const content = system.content as string;
    expect(content).toContain('kind="event"');
    expect(content).toContain('kind="travel"');
    expect(content).toContain('kind="recipe"');
    expect(content).toContain('Omit the other two entirely.');
    // "none" must be offered explicitly, or the model will force a wrong classification.
    expect(content).toContain('kind="none"');
  });

  it('is wired into the parser registry', () => {
    expect(EXTRACTION_PARSERS.share).toBe(parseShareExtractionResult);
  });
});

describe('parseShareExtractionResult delegates by kind (#64)', () => {
  it('routes an event to the event parser', () => {
    const out = parseShareExtractionResult({ kind: 'event', event: eventPayload });
    expect(out.kind).toBe('event');
    expect(out.kind === 'event' && out.event.title).toBe('Sports Day');
  });

  it('routes travel to the travel parser', () => {
    const out = parseShareExtractionResult({ kind: 'travel', travel: travelPayload });
    expect(out.kind).toBe('travel');
    expect(out.kind === 'travel' && out.travel.tripName).toBe('Tokyo');
  });

  it('routes a recipe to the recipe parser', () => {
    const out = parseShareExtractionResult({ kind: 'recipe', recipe: recipePayload });
    expect(out.kind).toBe('recipe');
    expect(out.kind === 'recipe' && out.recipe.name).toBe('Pancakes');
  });

  it('accepts "none" as a real answer, carrying no payload', () => {
    expect(parseShareExtractionResult({ kind: 'none' })).toEqual({ kind: 'none' });
  });

  it('ignores payloads that do not match the chosen kind', () => {
    // The model was told to omit the others; if it does not, only the chosen one is read.
    const out = parseShareExtractionResult({
      kind: 'event',
      event: eventPayload,
      recipe: recipePayload,
    });
    expect(out.kind).toBe('event');
    expect(Object.keys(out)).toEqual(['kind', 'event']);
  });

  it('throws on an unknown kind rather than guessing', () => {
    expect(() => parseShareExtractionResult({ kind: 'invoice' })).toThrow(/unknown kind/i);
    expect(() => parseShareExtractionResult({ kind: null })).toThrow(/unknown kind/i);
    expect(() => parseShareExtractionResult({})).toThrow(/unknown kind/i);
  });

  it('throws when the chosen kind has no payload', () => {
    expect(() => parseShareExtractionResult({ kind: 'event' })).toThrow(/no "event" object/);
    expect(() => parseShareExtractionResult({ kind: 'travel', travel: null })).toThrow(
      /no "travel" object/
    );
    expect(() => parseShareExtractionResult({ kind: 'recipe', recipe: 'nope' })).toThrow(
      /no "recipe" object/
    );
  });

  it('throws on a non-object reply', () => {
    expect(() => parseShareExtractionResult(null)).toThrow(/expected an object/);
    expect(() => parseShareExtractionResult('event')).toThrow(/expected an object/);
  });

  it('lets the delegated parser reject a malformed payload', () => {
    // Missing required event keys — the event parser's problem, not a second set of rules.
    expect(() => parseShareExtractionResult({ kind: 'event', event: { title: 'x' } })).toThrow();
  });
});
