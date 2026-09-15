#!/usr/bin/env node
/**
 * Airport Update Script
 *
 * Regenerates `src/constants/airports.ts` from OurAirports' public-domain
 * dataset (https://ourairports.com/data/airports.csv).
 *
 * Inclusion rule:
 *   - has a non-empty `iata_code` (3 letters)
 *   - `scheduled_service === "yes"` (i.e. has regular commercial flights)
 *
 * This excludes general-aviation fields (e.g. TOA Torrance) but covers every
 * commercial airport globally — HGH, CKG, KGL, AEP, the works.
 *
 * RETIRED CODES ARE KEPT, NOT DELETED. A code that was in the previous file and
 * is absent from a fresh fetch is carried forward with `retired: true` rather
 * than dropped. The reason is that a family's saved trip stores the IATA code:
 * delete the entry and that trip stops resolving and falls back to rendering as
 * a free-text custom entry. Upstream removes codes for two very different
 * reasons and the dataset does not distinguish them — a genuine closure (the
 * war-closed Ukrainian and Russian fields) and a REASSIGNMENT, where the airport
 * is still there under a new code (PBI -> DJT, West Palm Beach, 2026-09). Either
 * way the family's existing trip should keep reading the way they saved it.
 *
 * Retired entries stay OUT of the picker — `buildAirportOptions` in
 * `src/utils/vacation.ts` filters on the flag — so they resolve a stored code
 * without ever being offered as a new choice.
 *
 * A code that reappears upstream (a reassignment handed back, a field reopened)
 * is taken fresh and loses the flag, because the live dataset outranks our
 * memory of it.
 *
 * Usage:
 *   node scripts/updateAirports.mjs
 *
 * The script is idempotent: if the regenerated file is byte-identical to the
 * one on disk, it exits 0 without writing. CI uses this to decide whether to
 * open a PR.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'constants', 'airports.ts');

/**
 * Strip noisy suffixes from official airport names so the dropdown stays
 * readable. "Hangzhou Xiaoshan International Airport" → "Hangzhou Xiaoshan".
 * Keeps the airport name distinct from the city when an airport's official
 * name is just "<City> Airport" (we leave those alone for clarity).
 */
function cleanName(rawName, city) {
  let n = rawName.trim();

  // Drop trailing " Airport" / " International Airport" / " Regional Airport"
  // unless the result would be empty or identical to the city name.
  const suffixes = [
    / International Airport$/i,
    / Regional Airport$/i,
    / Municipal Airport$/i,
    / Domestic Airport$/i,
    / Airport$/i,
  ];
  for (const re of suffixes) {
    if (!re.test(n)) continue;
    const stripped = n.replace(re, '').trim();
    if (stripped && stripped.toLowerCase() !== (city || '').toLowerCase()) {
      n = stripped;
      break;
    }
  }

  return n;
}

/**
 * Parse a CSV line respecting double-quoted fields with embedded commas and
 * escaped quotes ("" inside a quoted field). OurAirports uses the standard
 * RFC 4180-ish dialect.
 */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur);
        cur = '';
      } else if (ch === '"' && cur === '') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

async function fetchCsv(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'beanies-family-airport-sync/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

function parseAirports(csv) {
  const lines = csv.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const idx = (col) => {
    const i = header.indexOf(col);
    if (i < 0) throw new Error(`Missing CSV column: ${col}`);
    return i;
  };

  const iataIdx = idx('iata_code');
  const nameIdx = idx('name');
  const cityIdx = idx('municipality');
  const schedIdx = idx('scheduled_service');
  const typeIdx = idx('type');
  const countryIdx = idx('iso_country');

  const seenCodes = new Set();
  const airports = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = parseCsvLine(line);

    const iata = (cols[iataIdx] || '').trim().toUpperCase();
    const sched = (cols[schedIdx] || '').trim().toLowerCase();
    const type = (cols[typeIdx] || '').trim();

    if (!/^[A-Z]{3}$/.test(iata)) continue;
    if (sched !== 'yes') continue;
    if (type === 'closed') continue;
    if (seenCodes.has(iata)) continue; // first hit wins; OurAirports is mostly de-duped

    const rawName = (cols[nameIdx] || '').trim();
    // Strip OurAirports' parenthetical suburb annotation from the city — e.g.
    // "Paris (Roissy-en-France, Val-d'Oise)" → "Paris", "Sydney (Mascot)" → "Sydney".
    // The dropdown shows city as the primary line, so we want it short.
    const city = (cols[cityIdx] || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const country = (cols[countryIdx] || '').trim().toUpperCase();
    if (!rawName) continue;

    seenCodes.add(iata);
    airports.push({
      code: iata,
      name: cleanName(rawName, city),
      city: city || rawName, // some tiny airports have no municipality
      country,
    });
  }

  // Stable sort by IATA code — matches the existing file's ordering and keeps
  // diffs minimal between runs.
  airports.sort((a, b) => a.code.localeCompare(b.code));
  return airports;
}

/**
 * Read the codes already in `airports.ts` so a fresh fetch can carry forward the
 * ones it no longer contains.
 *
 * Parsed with a regex rather than imported, because the file is TypeScript and
 * this is a plain Node script — but that is safe here in a way it would not
 * normally be: we generate every line of this file ourselves, one entry per
 * line, from `renderTs` below. If the two ever drift the guard in
 * `mergeRetired` catches it rather than letting it pass silently.
 */
function parsePrevious(src) {
  // Match each `{ ... }` OBJECT, not each line. Prettier wraps any entry whose
  // line would exceed the print width across six lines — 138 of them in the
  // current file, including PBI — and a line-anchored regex skips exactly those.
  // Skipping them is worse than failing: a wrapped RETIRED entry would simply be
  // absent from `previous`, so the next run would not carry it forward and the
  // code would vanish, which is the failure this whole mechanism exists to stop.
  const body = src.slice(src.indexOf('['), src.lastIndexOf(']'));
  const unescape = (v) => v.replace(/\\(['"\\])/g, '$1');
  // BOTH quote styles, because Prettier rewrites ours. `renderTs` emits
  // single-quoted literals and escapes any apostrophe, but Prettier prefers the
  // quote that needs no escaping and flips `'Arthur\\'s Town'` to
  // `"Arthur's Town"` — 52 entries in the current file. A single-quote-only
  // pattern reads those as unparseable and drops them.
  const field = (block, key) => {
    const m = new RegExp(`\\b${key}:\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")`).exec(
      block
    );
    if (!m) return undefined;
    return unescape(m[1] !== undefined ? m[1] : m[2]);
  };

  const out = [];
  for (const [block] of body.matchAll(/\{[^{}]*\}/g)) {
    const code = field(block, 'code');
    if (!code) continue;
    const name = field(block, 'name');
    const city = field(block, 'city');
    if (name === undefined || city === undefined) continue;
    const country = field(block, 'country');
    out.push({
      code,
      name,
      city,
      ...(country ? { country } : {}),
      ...(/\bretired:\s*true\b/.test(block) ? { retired: true } : {}),
    });
  }

  // Every `code:` in the array body must have produced an entry. A mismatch means
  // renderTs and this parser have drifted, and a PARTIAL parse is the dangerous
  // case — it looks like success while quietly forgetting the entries it missed.
  const expected = (body.match(/\bcode:\s*'/g) || []).length;
  if (out.length !== expected) {
    throw new Error(
      `Parsed ${out.length} entries from the existing airports.ts but found ${expected} ` +
        `\`code:\` fields. renderTs and parsePrevious have drifted; a partial parse would ` +
        `silently drop the entries it missed. Fix the parser before re-running.`
    );
  }

  return out;
}

/**
 * Merge a freshly-fetched list with the previous file, keeping codes that have
 * gone missing upstream as `retired: true`.
 *
 * TWO GUARDS, because aliasing introduces a failure mode that deleting did not.
 * If an upstream format change made `parseAirports` return almost nothing, a
 * naive carry-forward would quietly re-emit the whole previous file as retired
 * and the diff would look like a successful, tidy sync. So:
 *
 *   1. a previous file that exists but parses to zero entries is a parser/format
 *      break, not an empty history — throw rather than silently forget every
 *      retired code accumulated so far;
 *   2. a fresh fetch that has lost more than RETIRE_RATIO_LIMIT of the previous
 *      LIVE codes is treated as a bad fetch, not a very bad month.
 */
const RETIRE_RATIO_LIMIT = 0.1;

function mergeRetired(fresh, previous) {
  if (!previous.length) return { merged: fresh, retiredNow: [] };

  const freshByCode = new Map(fresh.map((a) => [a.code, a]));
  const previousLive = previous.filter((a) => !a.retired);
  const retiredNow = previousLive.filter((a) => !freshByCode.has(a.code)).map((a) => a.code);

  if (previousLive.length) {
    const ratio = retiredNow.length / previousLive.length;
    if (ratio > RETIRE_RATIO_LIMIT) {
      throw new Error(
        `Refusing to retire ${retiredNow.length} of ${previousLive.length} live codes ` +
          `(${(ratio * 100).toFixed(1)}%, limit ${(RETIRE_RATIO_LIMIT * 100).toFixed(0)}%). ` +
          `That is a bad fetch or an upstream format change, not a month's churn. ` +
          `Inspect the source before re-running.`
      );
    }
  }

  // Previous entries the fresh fetch no longer carries, live or already retired,
  // all become retired. A code the fetch DOES carry is taken fresh and loses the
  // flag — the live dataset outranks our memory of it.
  const carried = previous
    .filter((a) => !freshByCode.has(a.code))
    .map(({ retired: _ignored, ...a }) => ({ ...a, retired: true }));

  const merged = [...fresh, ...carried].sort((a, b) => a.code.localeCompare(b.code));
  return { merged, retiredNow };
}

/**
 * Render the TypeScript source. Keep the shape compatible with the existing
 * `AirportInfo` consumers (code/name/city). Country is added to the type so
 * future UI can use it for disambiguation, but is optional so consumers don't
 * have to be updated yet.
 */
function renderTs(airports) {
  const header = `// AUTO-GENERATED by scripts/updateAirports.mjs — do not edit by hand.
// Source: OurAirports (public domain) — ${SOURCE_URL}
// Filter: scheduled_service=yes AND non-empty IATA code.
// Entries marked \`retired: true\` have left the upstream dataset (closed, or the
// code reassigned) and are kept ONLY so an already-saved trip still resolves —
// they are excluded from the picker. See scripts/updateAirports.mjs.
// Last regenerated: ${new Date().toISOString().slice(0, 10)}.
// Re-run via \`npm run update-airports\`.

export interface AirportInfo {
  code: string; // IATA 3-letter code (e.g. 'SIN', 'NRT', 'JFK')
  name: string; // Airport name (e.g. 'Singapore Changi')
  city: string; // City / municipality
  country?: string; // ISO 3166-1 alpha-2 country code (e.g. 'SG', 'US')
  /**
   * Present and true when the code has left the upstream dataset — closed,
   * or reassigned to a different airport (PBI -> DJT, West Palm Beach).
   *
   * Kept so a trip a family already saved against the code still resolves to a
   * readable label. NOT offered in the picker: \`buildAirportOptions\` filters
   * these out, so a retired code can be read but never newly chosen.
   */
  retired?: boolean;
}

export const AIRPORTS: AirportInfo[] = [
`;

  // Render values as Prettier-compliant single-quoted TS literals: backslash-
  // escape any single quote or backslash, then wrap in single quotes. Avoids
  // running prettier as a post-step.
  const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const lines = airports.map((a) => {
    const country = a.country ? `, country: ${q(a.country)}` : '';
    // Rendered last, and only when true, so a live entry's line is byte-identical
    // to what previous versions of this script produced — the diff on a normal
    // month stays about airports rather than about formatting.
    const retired = a.retired ? ', retired: true' : '';
    return `  { code: ${q(a.code)}, name: ${q(a.name)}, city: ${q(a.city)}${country}${retired} },`;
  });

  return header + lines.join('\n') + '\n];\n';
}

async function main() {
  console.log(`Fetching ${SOURCE_URL}…`);
  const csv = await fetchCsv(SOURCE_URL);
  console.log(`  downloaded ${(csv.length / 1024).toFixed(0)} KB`);

  const fresh = parseAirports(csv);
  console.log(`  filtered to ${fresh.length} scheduled-service IATA airports`);

  // Sanity checks: a few well-known codes that must appear. Checked against the
  // FRESH fetch, deliberately — checking the merged list would let the carried-
  // forward retired entries satisfy it and hide a broken fetch.
  const required = ['JFK', 'LAX', 'LHR', 'SIN', 'HGH', 'NRT', 'CDG', 'DXB'];
  const missing = required.filter((c) => !fresh.some((a) => a.code === c));
  if (missing.length) {
    throw new Error(`Sanity check failed — missing required codes: ${missing.join(', ')}`);
  }

  let prev = '';
  try {
    prev = fs.readFileSync(OUTPUT_PATH, 'utf-8');
  } catch {
    // first run, file doesn't exist
  }

  const previous = parsePrevious(prev);
  if (prev.trim() && !previous.length) {
    throw new Error(
      `Parsed 0 entries out of the existing ${OUTPUT_PATH}, which is ${prev.length} bytes long. ` +
        `That means renderTs and parsePrevious have drifted apart, not that there is no history. ` +
        `Carrying on would silently drop every retired code. Fix the parser first.`
    );
  }

  const { merged, retiredNow } = mergeRetired(fresh, previous);
  const retiredTotal = merged.filter((a) => a.retired).length;
  if (retiredNow.length) {
    console.log(
      `  retiring ${retiredNow.length} code(s) gone from upstream: ${retiredNow.join(', ')}`
    );
  }
  const revived = fresh.filter((f) => previous.some((p) => p.code === f.code && p.retired));
  if (revived.length) {
    console.log(`  back upstream, un-retired: ${revived.map((a) => a.code).join(', ')}`);
  }
  console.log(`  ${merged.length} entries total (${retiredTotal} retired, kept for stored trips)`);

  const ts = renderTs(merged);

  // Strip the timestamp line before comparison so the no-op detection works
  // even when the script is re-run on a different day with no upstream change.
  const stripDate = (s) => s.replace(/^\/\/ Last regenerated: .*\n/m, '');
  if (stripDate(prev) === stripDate(ts)) {
    console.log('No changes — airports.ts already up to date.');
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, ts, 'utf-8');
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`  size: ${(ts.length / 1024).toFixed(0)} KB`);

  // Run Prettier on the output so the diff stays clean for the eventual PR.
  // Two passes — Prettier sometimes reports "needs formatting" on a brand-new
  // file even after the first --write completes (cache state); a second write
  // settles it.
  console.log('Running Prettier…');
  execFileSync('npx', ['prettier', '--write', '--log-level=warn', OUTPUT_PATH], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
}

main().catch((err) => {
  console.error('Airport update failed:', err);
  process.exit(1);
});
