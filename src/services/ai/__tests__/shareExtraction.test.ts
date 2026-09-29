/**
 * The SHARE task (#64): one call that classifies AND extracts.
 *
 * The parser's whole job is to read `kind` and DELEGATE to the parser that already owns that
 * shape — so these tests are about routing and about refusing bad input, not about field
 * coercion (which the three delegated parsers already cover). A wrong `kind` must never
 * produce a confidently-wrong item; it must throw, so the funnel classifies it as
 * `malformed_output` and the shared toast mapper reports it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const logEventMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry', () => ({ logEvent: logEventMock }));

import {
  EXTRACTION_PARSERS,
  EXTRACTION_TASKS,
  SHARE_JSON_SHAPE,
  TODO_ITEMS_MAX,
  buildShareExtractionMessages,
  parseExtractionResult,
  parseShareExtractionResult,
  parseTodoExtractionResult,
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
    expect(Object.keys(SHARE_JSON_SHAPE)).toEqual([
      'kind',
      'event',
      'travel',
      'recipe',
      'transactions',
      'todo',
    ]);
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
    expect(content).toContain('Omit the others entirely.');
    expect(content).toContain('kind="transactions"');
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

describe('the share path carries inferredTimes too (#93)', () => {
  it('survives the delegated parse, so the carve-out is not silently share-only-broken', () => {
    // The share task inherits RECIPE_JSON_SHAPE verbatim and delegates to the recipe parser,
    // so `inferredTimes` parses here for free — but the system RULES are per-builder, and a
    // shared recipe handed a field it is simultaneously forbidden to fill would meet the
    // requirement on one capture route and silently miss it on the other.
    const out = parseShareExtractionResult({
      kind: 'recipe',
      recipe: { ...recipePayload, inferredTimes: ['prepTime', 'servings'] },
    });
    expect(out.kind === 'recipe' && out.recipe.inferredTimes).toEqual(['prepTime', 'servings']);
  });

  it('carries EVERY recipe policy in the kind="recipe" block, not just the exception', () => {
    // The share prompt used to carry ONLY the inferredTimes exception, so a recipe extracted
    // through this path came back with no per-ingredient `inferred` flags at all — and the
    // form's "we guessed this" highlighting silently stopped being accurate. Unifying the
    // magic-beans doors routes every recipe link through `share`, which would have made that
    // the normal case rather than the edge one. All four policies now come from one
    // declaration (RECIPE_POLICY_LINES), so this asserts the whole set, not one line of it.
    const [system] = buildShareExtractionMessages(
      { kind: 'text', text: 'some page text' },
      '2026-09-07'
    );
    const content = String(system.content);

    expect(content).toContain('inferredTimes');
    expect(content).toMatch(/When kind="recipe": ONE EXCEPTION/);
    expect(content).toMatch(/When kind="recipe": Set inferred=true on any ingredient or step/);
    expect(content).toMatch(/When kind="recipe": Write the recipe in your own words/);
    expect(content).toMatch(/When kind="recipe": For "notes", write each distinct fact/);
  });

  it('does NOT carry isRecipe=false, which the share task expresses as kind="none"', () => {
    // The one recipe policy that is deliberately not shared. Asserted so a future edit that
    // "completes the set" has to argue with a test rather than silently teach the model two
    // contradictory ways to say "this is not a recipe".
    const [system] = buildShareExtractionMessages(
      { kind: 'text', text: 'some page text' },
      '2026-09-07'
    );
    expect(String(system.content)).not.toContain('Set isRecipe=false');
  });
});

// ── To-dos and the shared result (#113) ───────────────────────────────────────────────────

/** The `error_code` of the one aggregated rejection event, or null when none was logged. */
function rejectedCodes(): string | null {
  const call = logEventMock.mock.calls.find(
    ([e]) => (e as { context?: { action?: string } }).context?.action === 'model-field-rejected'
  );
  return call
    ? ((call[0] as { context: { error_code: string } }).context.error_code ?? null)
    : null;
}

const slip = {
  title: 'Return the signed permission slip',
  details: 'Hand it to Ms Park',
  dueDate: '2026-10-12',
  dueTime: null,
  timing: null,
  assigneeName: 'Mia',
  ownerCard: 'school-forms',
  links: ['https://school.example/slip'],
};

describe('parseShareExtractionResult: to-dos (#113)', () => {
  beforeEach(() => logEventMock.mockClear());

  it('routes a to-do-only read to the to-do parser', () => {
    const out = parseShareExtractionResult({ kind: 'todo', todo: { items: [slip] } });
    expect(out).toEqual({ kind: 'todo', todo: { items: [slip] } });
    expect(rejectedCodes()).toBeNull();
  });

  it('reads a to-do read with no usable item as "none", never an empty review', () => {
    expect(
      parseShareExtractionResult({ kind: 'todo', todo: { items: [{ title: '  ' }] } })
    ).toEqual({ kind: 'none' });
    expect(parseShareExtractionResult({ kind: 'todo', todo: {} })).toEqual({ kind: 'none' });
  });

  it('throws when kind="todo" has no todo object, like every other kind', () => {
    expect(() => parseShareExtractionResult({ kind: 'todo' })).toThrow(/no "todo" object/);
  });

  it('carries a to-do companion on an event', () => {
    const out = parseShareExtractionResult({
      kind: 'event',
      event: eventPayload,
      todo: { items: [slip, { title: 'Pack sunscreen', timing: 'on_event_day' }] },
    });
    expect(out.kind).toBe('event');
    if (out.kind !== 'event') return;
    expect(out.event.title).toBe('Sports Day');
    expect(out.todo?.items.map((i) => i.title)).toEqual([
      'Return the signed permission slip',
      'Pack sunscreen',
    ]);
    expect(out.todo?.items[1]).toMatchObject({ timing: 'on_event_day', dueDate: null });
  });

  it('drops a companion with zero usable items, keeping the event', () => {
    const out = parseShareExtractionResult({
      kind: 'event',
      event: eventPayload,
      todo: { items: [{ title: '' }, 'junk'] },
    });
    expect(Object.keys(out)).toEqual(['kind', 'event']);
  });

  it('ignores a malformed companion rather than costing the family the event', () => {
    const out = parseShareExtractionResult({ kind: 'event', event: eventPayload, todo: 'soon' });
    expect(Object.keys(out)).toEqual(['kind', 'event']);
  });

  it('refuses a companion SHARE_COMPANIONS does not allow for the primary kind', () => {
    const out = parseShareExtractionResult({
      kind: 'travel',
      travel: travelPayload,
      todo: { items: [slip] },
    });
    expect(Object.keys(out)).toEqual(['kind', 'travel']);
  });
});

describe('parseTodoExtractionResult (#113)', () => {
  beforeEach(() => logEventMock.mockClear());

  it('drops a bad date, timing, owner card and link, and reports them once with todo. names', () => {
    const out = parseTodoExtractionResult({
      items: [
        {
          title: 'Pay the trip fee',
          dueDate: 'next Friday',
          timing: 'whenever',
          ownerCard: 'not-a-card',
          links: [
            'javascript:alert(1)',
            // A plain-http link is exactly what the parser must drop, so the fixture needs one.
            // eslint-disable-next-line @microsoft/sdl/no-insecure-url
            'http://insecure.example',
            'https://pay.example/trip',
          ],
        },
      ],
    });
    expect(out.items).toEqual([
      {
        title: 'Pay the trip fee',
        details: null,
        dueDate: null,
        dueTime: null,
        timing: null,
        assigneeName: null,
        ownerCard: null,
        links: ['https://pay.example/trip'],
      },
    ]);
    expect(logEventMock).toHaveBeenCalledOnce();
    expect(rejectedCodes()).toBe('todo.timing,todo.ownerCard,todo.links,todo.dueDate');
  });

  it('dedupes links and bounds strings', () => {
    const out = parseTodoExtractionResult({
      items: [
        {
          title: 'x'.repeat(500),
          links: ['https://a.example/f', 'https://a.example/f'],
          assigneeName: '  Leo  ',
        },
      ],
    });
    expect(out.items[0]!.title).toHaveLength(200);
    expect(out.items[0]!.links).toEqual(['https://a.example/f']);
    expect(out.items[0]!.assigneeName).toBe('Leo');
  });

  it('caps a read at 10 to-dos, and skips junk entries on the way', () => {
    const items = [
      null,
      { title: '' },
      ...Array.from({ length: 15 }, (_, i) => ({ title: `Task ${i}` })),
    ];
    const out = parseTodoExtractionResult({ items });
    expect(TODO_ITEMS_MAX).toBe(10);
    expect(out.items).toHaveLength(10);
    expect(out.items[0]!.title).toBe('Task 0');
    expect(out.items[9]!.title).toBe('Task 9');
  });

  it('never walks a hostile array past the model list cap', () => {
    const items = [...Array.from({ length: 5000 }, () => 'junk'), { title: 'Late' }];
    expect(parseTodoExtractionResult({ items }).items).toEqual([]);
  });

  it('returns no items for a non-object or a missing list', () => {
    expect(parseTodoExtractionResult(null)).toEqual({ items: [] });
    expect(parseTodoExtractionResult({ items: 'nope' })).toEqual({ items: [] });
  });

  it('keeps a to-do link longer than the short-field cap intact, and reports nothing', () => {
    // 260 characters: past MODEL_FIELD_MAX (200), where a cut link would still parse as a URL.
    const prefix = 'https://forms.example/slip?token=';
    const long = prefix + 'a'.repeat(260 - prefix.length);
    expect(long).toHaveLength(260);
    const out = parseTodoExtractionResult({ items: [{ title: 'Sign the form', links: [long] }] });
    expect(out.items[0]!.links).toEqual([long]);
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it('keeps a 24-hour due time', () => {
    const out = parseTodoExtractionResult({
      items: [{ title: 'Walk the dog', dueDate: '2026-09-30', dueTime: '10:00' }],
    });
    expect(out.items[0]).toMatchObject({ dueDate: '2026-09-30', dueTime: '10:00' });
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it('drops a due time that is not HH:mm and reports todo.dueTime', () => {
    const out = parseTodoExtractionResult({
      items: [
        { title: 'Walk the dog', dueDate: '2026-09-30', dueTime: '10am' },
        { title: 'Feed the cat', dueTime: '25:00' },
      ],
    });
    expect(out.items.map((i) => i.dueTime)).toEqual([null, null]);
    expect(rejectedCodes()).toBe('todo.dueTime');
  });

  it('drops a non-https to-do link and reports todo.links', () => {
    const out = parseTodoExtractionResult({
      items: [
        {
          title: 'Pay the fee',
          // A plain-http link is exactly what the parser must drop, so the fixture needs one.
          // eslint-disable-next-line @microsoft/sdl/no-insecure-url
          links: ['http://pay.example/fee'],
        },
      ],
    });
    expect(out.items[0]!.links).toEqual([]);
    expect(rejectedCodes()).toBe('todo.links');
  });

  it('reports each rejected field name once when several items reject the same field', () => {
    const out = parseTodoExtractionResult({
      items: [
        { title: 'One', dueDate: 'soon', links: ['mailto:office@example.org'] },
        { title: 'Two', dueDate: 'later', links: ['javascript:alert(1)'] },
        { title: 'Three', dueDate: 'someday' },
      ],
    });
    expect(out.items).toHaveLength(3);
    expect(logEventMock).toHaveBeenCalledOnce();
    const codes = rejectedCodes()!.split(',');
    expect(codes).toHaveLength(new Set(codes).size);
    expect([...codes].sort()).toEqual(['todo.dueDate', 'todo.links']);
  });
});

describe('the event link (#113)', () => {
  beforeEach(() => logEventMock.mockClear());

  it('keeps a safe https link', () => {
    const out = parseExtractionResult({ ...eventPayload, link: 'https://trip.example/info' });
    expect(out.link).toBe('https://trip.example/info');
  });

  it('is absent when the model gave none, so the parsed shape is unchanged', () => {
    expect('link' in parseExtractionResult(eventPayload)).toBe(false);
    expect('link' in parseExtractionResult({ ...eventPayload, link: '' })).toBe(false);
  });

  it('drops and reports an unsafe link', () => {
    const out = parseExtractionResult({ ...eventPayload, link: 'javascript:alert(1)' });
    expect('link' in out).toBe(false);
    expect(rejectedCodes()).toBe('link');
  });

  it('is not a required key, so an older proxy without it still parses', () => {
    expect(EXTRACTION_TASKS.event.requiredKeys).not.toContain('link');
  });
});
