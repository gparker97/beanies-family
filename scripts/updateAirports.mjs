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
 * Render the TypeScript source. Keep the shape compatible with the existing
 * `AirportInfo` consumers (code/name/city). Country is added to the type so
 * future UI can use it for disambiguation, but is optional so consumers don't
 * have to be updated yet.
 */
function renderTs(airports) {
  const header = `// AUTO-GENERATED by scripts/updateAirports.mjs — do not edit by hand.
// Source: OurAirports (public domain) — ${SOURCE_URL}
// Filter: scheduled_service=yes AND non-empty IATA code.
// Last regenerated: ${new Date().toISOString().slice(0, 10)}.
// Re-run via \`npm run update-airports\`.

export interface AirportInfo {
  code: string; // IATA 3-letter code (e.g. 'SIN', 'NRT', 'JFK')
  name: string; // Airport name (e.g. 'Singapore Changi')
  city: string; // City / municipality
  country?: string; // ISO 3166-1 alpha-2 country code (e.g. 'SG', 'US')
}

export const AIRPORTS: AirportInfo[] = [
`;

  // Render values as Prettier-compliant single-quoted TS literals: backslash-
  // escape any single quote or backslash, then wrap in single quotes. Avoids
  // running prettier as a post-step.
  const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const lines = airports.map((a) => {
    const country = a.country ? `, country: ${q(a.country)}` : '';
    return `  { code: ${q(a.code)}, name: ${q(a.name)}, city: ${q(a.city)}${country} },`;
  });

  return header + lines.join('\n') + '\n];\n';
}

async function main() {
  console.log(`Fetching ${SOURCE_URL}…`);
  const csv = await fetchCsv(SOURCE_URL);
  console.log(`  downloaded ${(csv.length / 1024).toFixed(0)} KB`);

  const airports = parseAirports(csv);
  console.log(`  filtered to ${airports.length} scheduled-service IATA airports`);

  // Sanity checks: a few well-known codes that must appear.
  const required = ['JFK', 'LAX', 'LHR', 'SIN', 'HGH', 'NRT', 'CDG', 'DXB'];
  const missing = required.filter((c) => !airports.some((a) => a.code === c));
  if (missing.length) {
    throw new Error(`Sanity check failed — missing required codes: ${missing.join(', ')}`);
  }

  const ts = renderTs(airports);

  let prev = '';
  try {
    prev = fs.readFileSync(OUTPUT_PATH, 'utf-8');
  } catch {
    // first run, file doesn't exist
  }

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
