#!/usr/bin/env node
/**
 * Public-Holiday Dataset Generator
 *
 * Regenerates the bundled public-holiday reference data from the `date-holidays`
 * package (a devDependency — it ships zero bytes to the client):
 *
 *   - `public/holidays/<ISO2>.json` — one small file per country, fetched on
 *     demand by the app for the family's country only, then cached in IndexedDB.
 *   - `src/constants/countries.ts` — the country list (code / English name /
 *     flag emoji / primary language) used by the country picker. Generated from
 *     the same source so it can't drift from holiday coverage.
 *
 * Scope (v1): national `type === 'public'` holidays only — those are the
 * "usually no school" days families care about; `bank` / `optional` /
 * `observance` / `school` days are excluded. Regional/state holidays
 * (`new Holidays(cc, 'CA')`) are a future enhancement; v1 uses the bare country
 * set. Year window: [currentYear-1 .. currentYear+3].
 *
 * Usage:
 *   node scripts/generateHolidays.mjs        (or: npm run generate:holidays)
 *
 * Idempotent: a country file is rewritten only when its `holidays` array
 * changes (its `meta.generatedAt` is preserved on no-op runs); `countries.ts`
 * is compared with its timestamp line stripped. CI uses
 * `git diff --exit-code -- public/holidays src/constants/countries.ts` to
 * decide whether to open a PR. On any per-country failure the script keeps
 * going but sets `process.exitCode = 1` so CI fails — a partial dataset is
 * never silently committed.
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Holidays = require('date-holidays');
const DATE_HOLIDAYS_VERSION = require('date-holidays/package.json').version;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const HOLIDAYS_DIR = path.join(ROOT, 'public', 'holidays');
const COUNTRIES_TS_PATH = path.join(ROOT, 'src', 'constants', 'countries.ts');

const TODAY = new Date().toISOString().slice(0, 10);
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [];
for (let y = CURRENT_YEAR - 1; y <= CURRENT_YEAR + 3; y++) YEARS.push(y);
const YEAR_RANGE = [YEARS[0], YEARS[YEARS.length - 1]];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO 3166-1 alpha-2 → flag emoji via regional-indicator code points. */
function flagEmoji(code) {
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/** Single-quoted, prettier-compatible TS string literal. */
function q(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Extract the validated, deduped, sorted list of `public` holidays for one
 * country across the year window. Returns `{ holidays, primaryLanguage }` or
 * throws (caller catches per-country and flags CI).
 */
function buildCountry(code) {
  const langs = (new Holidays(code).getLanguages() || ['en']).map((l) => String(l).toLowerCase());
  const primaryLanguage = langs[0] || 'en';

  // First pass: English names.
  const hdEn = new Holidays(code);
  hdEn.setLanguages('en');

  // Second pass (only if the country's primary language isn't English):
  // localized names, keyed by the holiday's `rule` string, which is stable
  // across languages.
  let localByRule = null;
  if (primaryLanguage !== 'en') {
    const hdLocal = new Holidays(code);
    hdLocal.setLanguages(primaryLanguage);
    localByRule = new Map();
    for (const y of YEARS) {
      for (const h of hdLocal.getHolidays(y) || []) {
        if (h?.rule && h.name && !localByRule.has(h.rule)) localByRule.set(h.rule, h.name);
      }
    }
  }

  const byDate = new Map(); // `${date}|${name}` -> record (dedupe)
  let droppedThisCountry = 0;
  let rawPublicCount = 0;

  for (const y of YEARS) {
    for (const h of hdEn.getHolidays(y) || []) {
      if (h?.type !== 'public') continue;
      rawPublicCount++;
      const date = String(h.date || '').slice(0, 10);
      const name = typeof h.name === 'string' ? h.name.trim() : '';
      if (!DATE_RE.test(date) || !name) {
        droppedThisCountry++;
        console.warn(`  [${code}] dropping malformed record:`, JSON.stringify(h));
        continue;
      }
      const key = `${date}|${name}`;
      if (byDate.has(key)) continue;
      const record = { date, name, type: 'public' };
      const local = localByRule && h.rule ? localByRule.get(h.rule) : undefined;
      if (local && typeof local === 'string' && local.trim() && local.trim() !== name) {
        record.name_local = local.trim();
      }
      byDate.set(key, record);
    }
  }

  if (rawPublicCount > 0 && byDate.size === 0) {
    throw new Error(
      `date-holidays returned ${rawPublicCount} public holiday(s) for "${code}" but all were malformed`
    );
  }
  if (droppedThisCountry > 0) {
    console.warn(`  [${code}] kept ${byDate.size}, dropped ${droppedThisCountry} malformed`);
  }

  const holidays = [...byDate.values()].sort((a, b) =>
    a.date === b.date ? a.name.localeCompare(b.name) : a.date.localeCompare(b.date)
  );
  return { holidays, primaryLanguage };
}

/**
 * Write one country's JSON file, preserving `meta.generatedAt` when the
 * `holidays` array is unchanged so no-op runs leave a clean `git diff`.
 * Returns true if the file was (re)written.
 */
function writeCountryFile(code, name, holidays, primaryLanguage) {
  const filePath = path.join(HOLIDAYS_DIR, `${code}.json`);
  let generatedAt = TODAY;
  try {
    const prev = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (JSON.stringify(prev?.holidays) === JSON.stringify(holidays)) {
      generatedAt = prev?.meta?.generatedAt || TODAY;
    }
  } catch {
    // first run for this country
  }
  const out = {
    meta: {
      country: code,
      name,
      generatedAt,
      yearRange: YEAR_RANGE,
      source: `date-holidays@${DATE_HOLIDAYS_VERSION}`,
      primaryLanguage,
      types: ['public'],
    },
    holidays,
  };
  const json = JSON.stringify(out, null, 2) + '\n';
  let prevRaw = '';
  try {
    prevRaw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    /* first run */
  }
  if (prevRaw === json) return false;
  fs.writeFileSync(filePath, json, 'utf-8');
  return true;
}

function renderCountriesTs(countries) {
  const header = `// AUTO-GENERATED by scripts/generateHolidays.mjs — do not edit by hand.
// Source: ISO 3166-1 (the country list) + date-holidays@${DATE_HOLIDAYS_VERSION} (flags + primary languages
// + which countries have a public/holidays/<CC>.json file). Last regenerated: ${TODAY}.
// Re-run via \`npm run generate:holidays\`. Note: a country can be in this list without
// having a holiday file — the public-holiday loader 404-handles that gracefully.

import type { CountryCode } from '@/types/models';

export interface CountryInfo {
  code: CountryCode; // ISO 3166-1 alpha-2, uppercase (e.g. 'SG', 'US', 'GB')
  name: string; // English name
  flag: string; // Flag emoji
  primaryLanguage: string; // ISO 639-1 (lowercase) primary language — used to surface the localized holiday name
}

export const COUNTRIES: CountryInfo[] = [
`;
  const lines = countries.map(
    (c) =>
      `  { code: ${q(c.code)}, name: ${q(c.name)}, flag: ${q(c.flag)}, primaryLanguage: ${q(c.primaryLanguage)} },`
  );
  const footer = `
];

export const SUPPORTED_COUNTRY_CODES: CountryCode[] = COUNTRIES.map((c) => c.code);

const COUNTRY_BY_CODE = new Map<CountryCode, CountryInfo>(COUNTRIES.map((c) => [c.code, c]));

export function getCountryInfo(code: CountryCode | undefined | null): CountryInfo | undefined {
  if (!code) return undefined;
  return COUNTRY_BY_CODE.get(code.toUpperCase());
}

/** Flag emoji for a country code, derived from regional-indicator code points (fallback when the code isn't in COUNTRIES). */
export function flagEmoji(code: CountryCode): string {
  return code
    .toUpperCase()
    .replace(/[A-Z]/g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

// Backward-compatible helpers (kept for the account/asset institution-country pickers).
export function getCountryByCode(code: string): CountryInfo | undefined {
  return getCountryInfo(code);
}

export function getCountryName(code: string): string {
  return getCountryInfo(code)?.name ?? code;
}
`;
  return header + lines.join('\n') + footer;
}

/**
 * Parse the prior `src/constants/countries.ts` for its country entries so the
 * regenerated list keeps every country it had (the account/asset
 * institution-country pickers depend on the full set). Robust by design: every
 * `code: 'XX'` occurrence in the COUNTRIES array yields an entry; the `name` is
 * best-effort (nearest following `name: '...'`) and falls back to the code if
 * it can't be extracted — so a regex hiccup can never *drop* a country.
 */
function readPriorCountries() {
  let src = '';
  try {
    src = fs.readFileSync(COUNTRIES_TS_PATH, 'utf-8');
  } catch {
    return [];
  }
  const start = src.indexOf('COUNTRIES: CountryInfo[] = [');
  const body = start >= 0 ? src.slice(start) : src;
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(/code:\s*'([A-Za-z]{2})'/g)) {
    const code = m[1].toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);
    const ahead = body.slice(m.index, m.index + 200);
    const nameMatch = /name:\s*'((?:[^'\\]|\\.)*)'/.exec(ahead);
    const name = nameMatch ? nameMatch[1].replace(/\\(['\\])/g, '$1') : code;
    out.push({ code, name });
  }
  return out;
}

/**
 * Write `countries.ts` in its final prettier-formatted form. We run prettier on
 * the rendered source via stdin and compare *that* (with the timestamp line
 * stripped) against what's on disk — so a no-op regen leaves a clean
 * `git diff --exit-code` even though the rendered one-entry-per-line source and
 * prettier's wrapped form differ. Returns true if the file was (re)written.
 */
function writeCountriesTs(ts) {
  let formatted = ts;
  try {
    formatted = execFileSync(
      'npx',
      ['prettier', '--stdin-filepath', 'src/constants/countries.ts'],
      {
        input: ts,
        cwd: ROOT,
        encoding: 'utf-8',
      }
    );
  } catch (e) {
    console.error(
      '[generateHolidays] prettier formatting of countries.ts failed:',
      e?.message || e
    );
    process.exitCode = 1;
  }
  let prev = '';
  try {
    prev = fs.readFileSync(COUNTRIES_TS_PATH, 'utf-8');
  } catch {
    /* first run */
  }
  const stripDate = (s) => s.replace(/^\/\/ Last regenerated: .*\n/m, '');
  if (stripDate(prev) === stripDate(formatted)) return false;
  fs.writeFileSync(COUNTRIES_TS_PATH, formatted, 'utf-8');
  return true;
}

function main() {
  fs.mkdirSync(HOLIDAYS_DIR, { recursive: true });

  // The country LIST is the union of the prior list (so the account/asset
  // institution-country pickers keep every country they had) + every country
  // date-holidays knows about. Only the date-holidays subset gets a published
  // holiday file; the rest 404 gracefully at runtime.
  const dhCountries = new Holidays().getCountries('en'); // { CC: 'Name', ... } — ~203 entries
  const dhCodes = Object.keys(dhCountries).map((c) => c.toUpperCase());
  const prior = readPriorCountries(); // [{ code, name }, ...] — read before we overwrite the file
  console.log(
    `date-holidays@${DATE_HOLIDAYS_VERSION}: ${dhCodes.length} holiday countries; prior list: ${prior.length} countries; years ${YEAR_RANGE[0]}–${YEAR_RANGE[1]}`
  );

  // Union, keyed by code. Prefer the prior `name` (usually more polished) when present.
  const byCode = new Map(); // code -> { code, name, flag, primaryLanguage }
  for (const { code, name } of prior) {
    byCode.set(code, { code, name, flag: flagEmoji(code), primaryLanguage: 'en' });
  }
  for (const code of dhCodes) {
    if (!byCode.has(code)) {
      byCode.set(code, {
        code,
        name: String(dhCountries[code]),
        flag: flagEmoji(code),
        primaryLanguage: 'en',
      });
    }
  }

  // Build + write the holiday file for each date-holidays-covered country, and
  // record its primary language back onto the country entry.
  const expectedCodes = new Set();
  let written = 0;
  let totalHolidays = 0;
  for (const code of dhCodes.slice().sort()) {
    const name = byCode.get(code).name;
    try {
      const { holidays, primaryLanguage } = buildCountry(code);
      byCode.get(code).primaryLanguage = primaryLanguage;
      expectedCodes.add(`${code}.json`);
      if (writeCountryFile(code, name, holidays, primaryLanguage)) written++;
      totalHolidays += holidays.length;
    } catch (e) {
      console.error(`[generateHolidays] skipping ${code}:`, e?.message || e);
      process.exitCode = 1;
    }
  }

  // Prune stale per-country files (a code dropped from date-holidays).
  for (const file of fs.readdirSync(HOLIDAYS_DIR)) {
    if (file.endsWith('.json') && !expectedCodes.has(file)) {
      fs.unlinkSync(path.join(HOLIDAYS_DIR, file));
      console.log(`  removed stale ${file}`);
    }
  }

  const countryInfos = [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
  const tsWritten = writeCountriesTs(renderCountriesTs(countryInfos));

  // Sanity checks — a broken dataset should fail CI, not ship.
  const sample = ['SG', 'US', 'GB', 'DE', 'JP', 'AU', 'IN'];
  for (const cc of sample) {
    const file = path.join(HOLIDAYS_DIR, `${cc}.json`);
    let count = 0;
    try {
      count = JSON.parse(fs.readFileSync(file, 'utf-8')).holidays.length;
    } catch {
      /* missing */
    }
    if (count < 5) {
      console.error(
        `[generateHolidays] sanity check failed: ${cc} has only ${count} public holidays`
      );
      process.exitCode = 1;
    }
  }

  console.log(
    `Done. ${countryInfos.length} countries, ${totalHolidays} holiday records, ${written} JSON file(s) updated, countries.ts ${tsWritten ? 'updated' : 'unchanged'}.`
  );
  // (countries.ts is written already prettier-formatted by writeCountriesTs;
  // public/holidays/*.json need no formatting — JSON.stringify(…, 2) matches
  // prettier's style and `public/` is in .prettierignore anyway.)
}

try {
  main();
} catch (e) {
  console.error('[generateHolidays] fatal:', e);
  process.exitCode = 1;
}
