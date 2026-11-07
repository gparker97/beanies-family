/**
 * Spike 0 for live flight checks (#143). THROWAWAY HARNESS: not shipped, not tested, not linted
 * into the app. Plan: ~/projects/beanies-ops/docs/plans/2026-11-07-travel-live-flight-checks.md
 *
 * THE QUESTION: can AeroDataBox match our 5 real bookings deterministically, and what does
 * `scheduledTime.local` look like?
 *
 * It runs the REAL Lambda provider adapter (`infrastructure/lambda/flight-status/providers/
 * aerodatabox.mjs`) and the REAL client matcher (`src/utils/flightStatus/match.ts`) against the
 * bookings in `scripts/spikes/fixtures/flight-status-bookings.json` (placeholders until greg
 * swaps in real public flights), and prints per booking: query sent, legs returned, chosen leg,
 * normalised tuple, diff vs booking, units spent, the `local` sample and `codeshareStatus`,
 * then the go/no-go lines.
 *
 *   node scripts/spikes/flight-status-spike.mts --help
 *   AERODATABOX_API_KEY=... [AERODATABOX_MODE=direct|rapidapi|apimarket] \
 *     node scripts/spikes/flight-status-spike.mts [--compare-flightbyte] [--extra SQ318:2026-11-05]
 *   node scripts/spikes/flight-status-spike.mts --dry-run   # offline, recorded fixture, no key
 *
 * Plain `node` (v24 strips types natively); no tsx, no dependencies, native fetch only. The
 * app's `.ts` files import each other extensionless (the Vite convention), which Node's ESM
 * resolver does not do, so a 10-line resolve hook below retries a relative extensionless
 * specifier with `.ts`. That hook is the spike's only accommodation; the production modules
 * are imported unchanged.
 *
 * Never prints the API key.
 */

import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const HELP = `flight-status-spike: Spike 0 for live flight checks (#143)

Question: can AeroDataBox match our 5 real bookings deterministically, and what does
scheduledTime.local look like?

Usage:
  AERODATABOX_API_KEY=<key> node scripts/spikes/flight-status-spike.mts [options]

Env:
  AERODATABOX_API_KEY   required for a live run (never printed)
  AERODATABOX_MODE      direct (default) | rapidapi | apimarket
  FLIGHTBYTE_API_KEY    required with --compare-flightbyte

Options:
  --fixture <path>        bookings JSON (default scripts/spikes/fixtures/flight-status-bookings.json)
  --compare-flightbyte    also query FlightByte for each booking and print its raw answer
  --extra <FLIGHT:DATE>   extra raw query to see more status spellings (repeatable), e.g. SQ318:2026-11-05
  --skip-empty-probe      skip the 204 probe (one query for a flight that does not exist)
  --dry-run               no network, no key: serve the recorded SQ318 fixture to every booking
                          (proves the import graph runs under plain node)
  --help                  this text
`;

// ── Args ─────────────────────────────────────────────────────────────────────

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    options: {
      help: { type: 'boolean' },
      fixture: { type: 'string' },
      'compare-flightbyte': { type: 'boolean' },
      extra: { type: 'string', multiple: true },
      'skip-empty-probe': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
    },
    allowPositionals: false,
  });
}
try {
  args = parse();
} catch (err) {
  console.error(`flight-status-spike: ${(err as Error).message}\n\n${HELP}`);
  process.exit(1);
}
if (args.values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const DRY_RUN = args.values['dry-run'] === true;
const API_KEY = process.env.AERODATABOX_API_KEY?.trim() ?? '';
const MODE = process.env.AERODATABOX_MODE?.trim() || 'direct';
const COMPARE_FB = args.values['compare-flightbyte'] === true;
const FB_KEY = process.env.FLIGHTBYTE_API_KEY?.trim() ?? '';

if (!DRY_RUN && !API_KEY) {
  console.error(
    'flight-status-spike: AERODATABOX_API_KEY is not set.\n' +
      '  Export the AeroDataBox key (direct Starter plan, or set AERODATABOX_MODE for RapidAPI /\n' +
      '  api.market), or pass --dry-run to exercise the pipeline offline. See --help.'
  );
  process.exit(1);
}
if (COMPARE_FB && !DRY_RUN && !FB_KEY) {
  console.error('flight-status-spike: --compare-flightbyte needs FLIGHTBYTE_API_KEY. See --help.');
  process.exit(1);
}

// ── Resolve hook: extensionless relative imports → .ts (the app's Vite convention) ─────────

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      if (relative && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

// Dynamic imports AFTER the hook (static imports would resolve before it is registered).
const provider =
  await import('../../infrastructure/lambda/flight-status/providers/aerodatabox.mjs');
const { pickLeg, operatedAs } = await import('../../src/utils/flightStatus/match.ts');
const { normaliseFlightNumber } = await import('../../src/utils/flightStatus/flightNumber.ts');
const { tupleFromLeg, tupleFromSegment, tuplesEqual, revisionOf } =
  await import('../../src/utils/flightStatus/schedule.ts');
type FlightLeg = import('../../src/types/flightStatus.ts').FlightLeg;
type ScheduleTuple = import('../../src/types/flightStatus.ts').ScheduleTuple;

if (!(provider.PROVIDER_MODES as readonly string[]).includes(MODE)) {
  console.error(
    `flight-status-spike: AERODATABOX_MODE="${MODE}" is not one of ${provider.PROVIDER_MODES.join('|')}.`
  );
  process.exit(1);
}

// ── Fixture ──────────────────────────────────────────────────────────────────

interface Booking {
  ref: string;
  shape: string;
  airline?: string;
  flightNumber?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  departureDate?: string;
  departureTime?: string;
  terminal?: string;
  arrivalDate?: string;
  arrivalTime?: string;
  expect?: { multiStop?: boolean; pickedFrom?: string; arrivalFrom?: string; codeshare?: boolean };
}

const fixturePath =
  args.values.fixture ?? new URL('./fixtures/flight-status-bookings.json', import.meta.url);
let bookings: Booking[];
try {
  bookings = (JSON.parse(readFileSync(fixturePath, 'utf8')) as { bookings: Booking[] }).bookings;
  if (!Array.isArray(bookings)) throw new Error('no "bookings" array');
} catch (err) {
  console.error(
    `flight-status-spike: cannot read fixture ${String(fixturePath)}: ${(err as Error).message}`
  );
  process.exit(1);
}

// ── Fetch plumbing ───────────────────────────────────────────────────────────

const UNITS_PER_CALL = 2; // AeroDataBox Tier 2 (flight status by number + date), per pricing page.
let providerCalls = 0;

/** Headers that might reveal quota/units; printed so "2 units per check" can be checked. */
let lastQuotaHeaders: Record<string, string> = {};

const RECORDED = readFileSync(
  new URL(
    '../../infrastructure/lambda/flight-status/__tests__/fixtures/aerodatabox-sq318.json',
    import.meta.url
  ),
  'utf8'
);

const recordingFetch: typeof fetch = async (input, init) => {
  providerCalls += 1;
  if (DRY_RUN) {
    const url = String(input);
    // The empty probe gets a 204, everything else the recorded SQ318 answer.
    if (url.includes('/ZZ9999/')) return new Response(null, { status: 204 });
    return new Response(RECORDED, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const res = await fetch(input, init);
  lastQuotaHeaders = {};
  res.headers.forEach((value, name) => {
    if (/ratelimit|quota|unit|credit|remaining|usage/i.test(name)) lastQuotaHeaders[name] = value;
  });
  return res;
};

async function queryAdb(flight: string, date: string) {
  try {
    const out = await provider.fetchLegs({
      flight,
      date,
      apiKey: API_KEY || 'dry-run',
      mode: MODE,
      fetchImpl: recordingFetch,
    });
    return { ok: true as const, legs: out.legs as FlightLeg[], status: out.status as number };
  } catch (err) {
    const e = err as { code?: string; httpStatus?: number; message?: string };
    return {
      ok: false as const,
      code: e.code ?? 'unexpected',
      httpStatus: e.httpStatus,
      message: e.message,
    };
  }
}

async function queryFlightByte(carrier: string, digits: string, date: string): Promise<string> {
  if (DRY_RUN) return '(dry run: FlightByte not called)';
  // https://flightbyte.dev/docs: GET /v1/flights/{carrier}/{flightNumber}/{date}, header x-api-key.
  // The response field names are not documented on the overview page, so the raw JSON is
  // printed for side-by-side reading rather than mapped.
  const url = `https://api.flightbyte.dev/v1/flights/${encodeURIComponent(carrier)}/${encodeURIComponent(digits)}/${encodeURIComponent(date)}`;
  try {
    const res = await fetch(url, {
      headers: { 'x-api-key': FB_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    return `HTTP ${res.status} ${text.length > 900 ? `${text.slice(0, 900)}… (${text.length} chars)` : text}`;
  } catch (err) {
    return `request failed: ${(err as Error).name}: ${(err as Error).message}`;
  }
}

// ── Printing helpers ─────────────────────────────────────────────────────────

const FIELDS = [
  'departureDate',
  'departureTime',
  'terminal',
  'arrivalDate',
  'arrivalTime',
] as const;

function legLine(l: FlightLeg): string {
  return `${l.number.padEnd(8)} ${l.departure.iata ?? '???'}→${l.arrival.iata ?? '???'}  dep ${l.departure.scheduledLocal ?? '-'}  arr ${l.arrival.scheduledLocal ?? '-'}  status=${l.status} codeshare=${l.codeshareStatus}`;
}

function diff(mine: ScheduleTuple, provider: ScheduleTuple): string[] {
  const out: string[] = [];
  for (const f of FIELDS) {
    if (provider[f] === undefined) continue;
    if (!tuplesEqual(mine, { [f]: provider[f] }))
      out.push(`${f}: ${mine[f] ?? '(none)'} → ${provider[f]}`);
  }
  return out;
}

const OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/;

// ── Run ──────────────────────────────────────────────────────────────────────

console.log(
  `flight-status-spike  mode=${MODE}${DRY_RUN ? '  DRY RUN (recorded fixture, no network)' : ''}  bookings=${bookings.length}`
);
console.log(
  `Question: can AeroDataBox match our ${bookings.length} bookings deterministically, and what does scheduledTime.local look like?\n`
);

const results: { ref: string; how: string; multiStopOk?: boolean; codeshare?: string }[] = [];
const localSamples: string[] = [];
const statuses = new Set<string>();

for (const b of bookings) {
  console.log(`── ${b.ref}  ${b.shape}`);
  const n = normaliseFlightNumber(b.airline, b.flightNumber);
  if (!n) {
    console.log(
      `   query:   none (no carrier resolvable from airline="${b.airline}" number="${b.flightNumber}")\n`
    );
    results.push({ ref: b.ref, how: 'no_flight_number' });
    continue;
  }
  const date = b.departureDate ?? '';
  console.log(`   query:   ${n.query} on ${date}  (${provider.buildUrl(MODE, n.query, date)})`);
  const r = await queryAdb(n.query, date);
  if (!r.ok) {
    console.log(`   ERROR:   ${r.code}${r.httpStatus ? ` HTTP ${r.httpStatus}` : ''}\n`);
    results.push({ ref: b.ref, how: `error:${r.code}` });
    continue;
  }
  console.log(`   answer:  HTTP ${r.status}, ${r.legs.length} leg(s); units ${UNITS_PER_CALL}`);
  if (Object.keys(lastQuotaHeaders).length)
    console.log(`   quota:   ${JSON.stringify(lastQuotaHeaders)}`);
  for (const l of r.legs) {
    console.log(`            ${legLine(l)}`);
    if (l.departure.scheduledLocal) localSamples.push(l.departure.scheduledLocal);
    if (l.arrival.scheduledLocal) localSamples.push(l.arrival.scheduledLocal);
    statuses.add(String(l.status));
  }

  const m = pickLeg(r.legs, b);
  if (!m) {
    console.log('   match:   null (no_match)\n');
    results.push({ ref: b.ref, how: 'no_match' });
    continue;
  }
  if (m.how === 'ambiguous') {
    console.log(
      `   match:   AMBIGUOUS among ${m.legs.length} legs (would go to the AI residue arm)\n`
    );
    results.push({ ref: b.ref, how: 'ambiguous' });
    continue;
  }
  const provTuple = tupleFromLeg(m.leg, m.arrivalLeg);
  const mine = tupleFromSegment(b);
  const changes = diff(mine, provTuple);
  const op = operatedAs(m.leg, n.query);
  console.log(`   chosen:  ${m.how}  ${legLine(m.leg)}`);
  if (m.arrivalLeg !== undefined) {
    console.log(
      `   arrival: ${m.arrivalLeg ? `from later sector ${legLine(m.arrivalLeg)}` : 'no sector reaches the booked arrival (arrival half undefined)'}`
    );
  }
  console.log(`   tuple:   ${JSON.stringify(provTuple)}  revision="${revisionOf(provTuple)}"`);
  console.log(`   booking: ${JSON.stringify(mine)}  revision="${revisionOf(mine)}"`);
  console.log(`   diff:    ${changes.length ? changes.join('; ') : 'none'}`);
  if (op) console.log(`   operated as: ${op}`);

  let multiStopOk: boolean | undefined;
  if (b.expect?.multiStop) {
    const pickedOk = !b.expect.pickedFrom || m.leg.departure.iata === b.expect.pickedFrom;
    const arrOk = !b.expect.arrivalFrom || m.arrivalLeg?.departure.iata === b.expect.arrivalFrom;
    multiStopOk = r.legs.length >= 2 && pickedOk && arrOk;
    console.log(
      `   multi-stop: legs=${r.legs.length} picked=${m.leg.departure.iata} ${multiStopOk ? 'OK' : 'NOT AS EXPECTED'}`
    );
  }
  results.push({ ref: b.ref, how: m.how, multiStopOk, codeshare: String(m.leg.codeshareStatus) });

  if (COMPARE_FB) console.log(`   flightbyte: ${await queryFlightByte(n.carrier, n.digits, date)}`);
  console.log('');
}

// Extra raw queries, for status spellings (a past or cancelled flight).
for (const extra of args.values.extra ?? []) {
  const [flight, date] = extra.split(':');
  if (!flight || !date) {
    console.log(`── extra ${extra}: expected FLIGHT:DATE, skipped\n`);
    continue;
  }
  const r = await queryAdb(flight.toUpperCase(), date);
  console.log(
    `── extra ${flight} ${date}: ${r.ok ? `HTTP ${r.status}, ${r.legs.length} leg(s)` : `ERROR ${r.code}`}`
  );
  if (r.ok)
    for (const l of r.legs) {
      console.log(`            ${legLine(l)}`);
      statuses.add(String(l.status));
    }
  console.log('');
}

// 204 probe: a designator that does not fly.
let emptyStatus: string = 'skipped';
if (!args.values['skip-empty-probe']) {
  const probeDate = bookings[0]?.departureDate ?? new Date().toISOString().slice(0, 10);
  const r = await queryAdb('ZZ9999', probeDate);
  emptyStatus = r.ok
    ? `HTTP ${r.status}, ${r.legs.length} legs`
    : `ERROR ${r.code}${r.httpStatus ? ` HTTP ${r.httpStatus}` : ''}`;
  console.log(`── empty probe ZZ9999 on ${probeDate}: ${emptyStatus}\n`);
}

// ── Go / no-go ───────────────────────────────────────────────────────────────

const deterministic = results.filter((r) => ['airport', 'name', 'single'].includes(r.how)).length;
const ambiguous = results.filter((r) => r.how === 'ambiguous').map((r) => r.ref);
const multi = results.filter((r) => r.multiStopOk !== undefined);
const offsetOk = localSamples.length > 0 && localSamples.every((s) => OFFSET_RE.test(s));
const KNOWN = ['Canceled', 'CanceledUncertain', 'Diverted', 'Arrived'];

const line = (ok: boolean | null, text: string) =>
  console.log(`${ok === null ? '[ ?? ]' : ok ? '[ GO ]' : '[NOGO]'} ${text}`);

console.log('══ go / no-go');
line(
  deterministic === bookings.length,
  `${deterministic}/${bookings.length} matched deterministically (${results.map((r) => `${r.ref}=${r.how}`).join(', ')})`
);
line(
  offsetOk,
  `scheduledTime.local carries the airport offset (samples: ${[...new Set(localSamples)].slice(0, 3).join(' | ') || 'none'})`
);
line(
  emptyStatus === 'skipped' ? null : emptyStatus.startsWith('HTTP 204'),
  `empty answer: ${emptyStatus} (expected HTTP 204, 0 legs)`
);
line(
  null,
  `units: ${providerCalls} provider calls × ${UNITS_PER_CALL} = ${providerCalls * UNITS_PER_CALL} expected; confirm against the AeroDataBox dashboard usage before/after this run`
);
line(
  multi.length > 0 ? multi.every((r) => r.multiStopOk) : null,
  `multi-stop: ${multi.length ? multi.map((r) => `${r.ref}=${r.multiStopOk ? 'ok' : 'WRONG'}`).join(', ') : 'no multi-stop booking in fixture'}`
);
const seenKnown = KNOWN.filter((s) => statuses.has(s));
line(
  seenKnown.length === KNOWN.length ? true : null,
  `status spellings seen: [${[...statuses].join(', ')}]; of ${KNOWN.join('/')} confirmed: [${seenKnown.join(', ') || 'none'}] (use --extra on a past/cancelled flight for the rest)`
);
line(
  null,
  `codeshareStatus seen: [${[...new Set(results.map((r) => r.codeshare).filter(Boolean))].join(', ') || 'none'}]`
);
line(
  ambiguous.length === 0,
  `ambiguous: ${ambiguous.length ? ambiguous.join(', ') + ' → build the AI residue arm (Requirement 10)' : 'none → defer the AI residue arm'}`
);
line(
  null,
  'date-move: needs a booking the airline moved to the next day; check it still returns under the booking date'
);
if (DRY_RUN)
  console.log(
    '\n(dry run: every booking was served the recorded SQ318 answer, so match results above are NOT evidence)'
  );
