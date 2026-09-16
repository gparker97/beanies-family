#!/usr/bin/env node
/**
 * The enclave crypto must not be in the entry chunk (#49).
 *
 * ⚠️ WHY THIS SCRIPT EXISTS. `seal.ts` and `attestation.ts` both carry comments saying this is
 * "caught by the build check", and there was no build check. The claim came from a real episode:
 * the hpke implementation genuinely was in the 3.2MB main chunk until a `import type` fix, and a
 * later attempt to fix it with a named `manualChunks` entry made things WORSE — the manual chunk
 * became the host of Vite's own shared runtime helpers, so every page chunk depended on it and it
 * was modulepreloaded on every cold load. That was reverted in 96bab28f.
 *
 * Two bundler regressions in one feature, and nothing that would fail on a third. A comment
 * asserting a guarantee nobody verifies is worse than no comment, because it stops the next
 * person checking.
 *
 * Runs after `vite build`, because a vitest test cannot see the built output — `npm run validate`
 * runs the build LAST.
 *
 * Usage: node scripts/checkCryptoChunk.mjs [distDir]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] || 'dist';

/**
 * Strings that appear ONLY in the library implementations, never in our own source.
 *
 * Chosen deliberately: `hpke`, `tinfoilsh` and `AttestationError` are NOT usable as markers,
 * because our own code legitimately contains `hpkePublicKey`, the
 * `tinfoilsh/confidential-model-router` config repo, and an `AttestationError` name check in
 * the error-discrimination branch. A marker that matches our own references would fail the
 * moment the feature works — verified by grepping the real entry chunk for each candidate.
 *
 * Both packages must be represented. They land in SEPARATE chunks, so markers from one say
 * nothing about the other.
 */
const LIBRARY_MARKERS = [
  // ── ehbp (the HPKE seal) ────────────────────────────────────────────────────────────────
  'Ehbp-Encapsulated-Key', // PROTOCOL constant
  'ehbp response', // EXPORT_LABEL
  'X25519', // the cipher suite

  // ── @tinfoilsh/verifier (the attestation) ───────────────────────────────────────────────
  //
  // ⚠️ ADDED AFTER THE FIRST VERSION COULD NOT SEE THIS PACKAGE AT ALL. All three ehbp markers
  // live in one chunk and the verifier lands in a DIFFERENT one carrying none of them, so
  // turning `await import('@tinfoilsh/verifier')` into a static import left this script
  // printing `ok` while every family parsed 164KB of attestation crypto on first paint — half
  // the guarantee the script exists to enforce, unenforced.
  'sev-snp',
  'tinfoil-attestation',
  'sigstore',
];

function entryChunk() {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const match = /src="\/assets\/(index-[^"]+\.js)"/.exec(html);
  if (!match) {
    console.error(`[crypto-chunk] could not find the entry script in ${dist}/index.html`);
    process.exit(1);
  }
  return match[1];
}

const entry = entryChunk();
const allChunks = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));

/**
 * Everything the browser parses on a COLD LOAD, not just the entry file.
 *
 * ⚠️ Checking only the entry chunk was this script's original shape, and it could not see the
 * second of the two regressions its own header cites. A `manualChunks: { crypto: ['ehbp'] }`
 * entry does not put the crypto text in the entry file — it emits a SEPARATE chunk and gives the
 * entry a STATIC import of it. The old check then found nothing in the entry, found the markers
 * present elsewhere, and printed `ok` while every family parsed HPKE on first paint. That is
 * exactly the regression 96bab28f had to revert.
 *
 * So: follow static imports transitively from the entry, and include anything index.html asks
 * the browser to `modulepreload`. A DYNAMIC `await import()` is not in this set, which is the
 * whole point — that is the lazy path we want.
 */
function eagerClosure(entryFile) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const seen = new Set();
  const queue = [entryFile];

  for (const m of html.matchAll(/rel="modulepreload"[^>]*href="\/assets\/([^"]+)"/g)) {
    queue.push(m[1]);
  }

  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    let source;
    try {
      source = readFileSync(join(dist, 'assets', file), 'utf8');
    } catch {
      continue; // a preload for a css/font asset, or a name we cannot resolve
    }
    // STATIC specifiers only. `import(...)` with parentheses is dynamic and deliberately skipped.
    for (const m of source.matchAll(/(?:^|[;}\s])(?:import|export)[^;()]*?["']([^"']+\.js)["']/g)) {
      queue.push(m[1].replace(/^\.\//, '').replace(/^\/?assets\//, ''));
    }
  }
  return [...seen];
}

const eager = eagerClosure(entry);
const inEntry = [];
const missingEverywhere = [];

for (const marker of LIBRARY_MARKERS) {
  // Any EAGERLY reachable file, not just the entry.
  const carrier = eager.find((f) => {
    try {
      return readFileSync(join(dist, 'assets', f), 'utf8').includes(marker);
    } catch {
      return false;
    }
  });
  if (carrier) inEntry.push(`${marker} (in ${carrier})`);

  // ⚠️ "Measured nothing" must be an explicit failure, not a silent pass. If a marker has
  // vanished from EVERY chunk the library was renamed, tree-shaken away, or these strings
  // changed — and this script would otherwise report success while checking for nothing.
  const found = allChunks.some((f) =>
    readFileSync(join(dist, 'assets', f), 'utf8').includes(marker)
  );
  if (!found) missingEverywhere.push(marker);
}

if (missingEverywhere.length) {
  console.error(
    `[crypto-chunk] FAILED — these markers are in NO chunk at all: ${missingEverywhere.join(', ')}\n` +
      'That means this check is no longer checking anything. Either the enclave crypto is gone\n' +
      'from the build, or the library changed these strings. Update LIBRARY_MARKERS in\n' +
      'scripts/checkCryptoChunk.mjs against the current `ehbp` build before trusting a pass.'
  );
  process.exit(1);
}

if (inEntry.length) {
  console.error(
    `[crypto-chunk] FAILED — enclave crypto is EAGERLY loaded (entry ${entry}): ${inEntry.join(', ')}\n` +
      'Every family now downloads and parses the HPKE implementation on a cold load, whether or\n' +
      'not they ever use a managed extraction. Usual causes, both of which have happened here:\n' +
      '  · a VALUE import from `ehbp` or `@tinfoilsh/verifier` somewhere that should be\n' +
      '    `import type` — one constant is enough to pull the whole package in;\n' +
      '  · a `manualChunks` entry, which makes this worse rather than better (see 96bab28f).\n' +
      'Fix the import, not the bundler config.'
  );
  process.exit(1);
}

console.log(
  `[crypto-chunk] ok — ${eager.length} eagerly-loaded chunk(s) from ${entry} carry none of: ` +
    LIBRARY_MARKERS.join(', ')
);
