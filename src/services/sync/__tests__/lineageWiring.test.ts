/**
 * The lineage guard's three termini, as BEHAVIOUR.
 *
 * The list of termini lives in a comment on `guardLineage`, and a comment is not
 * a guarantee. These assert that each one actually consults the guard, because
 * the failure mode of a missed terminus is silent: a cross-lineage merge that
 * destroys a peer's unsynced work about half the time.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
/** Comments explain what the code does NOT do, so strip them before asserting. */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

describe('every path that brings foreign bytes in consults the guard', () => {
  it('terminus 3 — the ordinary poll/pre-save path, which is how a compaction SPREADS', () => {
    // If this one is missing, a published compaction can never reach any other
    // device: a peer's first post-compaction sync arrives exactly here.
    const src = read('src/services/sync/syncService.ts');
    const fn = src.slice(src.indexOf('async function fetchAndMergeRemote'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('guardLineage(');
    // And it must be able to ACT on the answer, not only refuse it.
    expect(body).toContain('adoptRemoteEnvelope(');
  });

  it('terminus 1 — cache recovery, where the adopt actually happens', () => {
    const src = read('src/stores/syncStore.ts');
    const fn = src.slice(src.indexOf('async function replaceDocWithCacheRecovery'));
    const body = fn.slice(0, fn.indexOf('\n  }\n'));
    expect(body).toContain('guardLineage(');
    expect(body).toContain('adoptRemoteEnvelope(');
    // ⚠️ It must NOT delete the cache first: that would open a window in which
    // the device holds no copy of the pod at all, and the adopt's own cursor
    // reset already makes the next persist write a superseding base.
    expect(code(body)).not.toContain('clearCache(');
  });

  it('terminus 2 — background recovery with a live document', () => {
    const src = read('src/stores/syncStore.ts');
    const fn = src.slice(src.indexOf('async function hydrateFromEnvelope'));
    const body = fn.slice(0, fn.indexOf('\n  }\n'));
    expect(body).toContain('guardLineage(');
  });
});

describe('the conditional drop is not collapsed into the adopt helper', () => {
  it('replaceDocWithCacheRecovery keeps its guarded dropDoc', () => {
    // `if (!loadedFromCache) await dropDoc()` is a CONDITIONAL drop guarding
    // cross-family corruption, not one of the unconditional adopt pairs.
    // Collapsing it would turn the cache-recovery merge into an unconditional
    // adopt and silently discard every unsynced cached change on the one path
    // built to preserve them.
    const src = read('src/stores/syncStore.ts');
    expect(src).toContain('if (!loadedFromCache) await docClient.dropDoc()');
  });
});

describe('the guard must be CONSULTED everywhere, and its answer acted on in full', () => {
  it('terminus 4 — loadFromFile({merge:true}), the poll path that had NO guard at all', () => {
    // This branch CRDT-merged foreign bytes into the live document with no
    // lineage check whatsoever, and both Drive poll paths reach it
    // (`backgroundSyncFromFile`, `reloadIfFileChanged`). A compacted pod
    // arriving here was merged across lineages — and that is not a coin flip:
    // `Automerge.from` renumbers opIds, so for every collection added by a
    // later `migrateDoc` the OLD lineage wins DETERMINISTICALLY (measured
    // 60/60), reverting every post-compaction edit and republishing the hybrid.
    const src = read('src/stores/syncStore.ts');
    const fn = src.slice(src.indexOf('async function loadFromFile'));
    const body = fn.slice(0, fn.indexOf('\n  }\n'));
    expect(body).toContain('guardLineage(');
    expect(body).toContain('adoptRemoteEnvelope(');
  });

  it.each([
    ['hydrateFromEnvelope', 'src/stores/syncStore.ts', 'async function hydrateFromEnvelope'],
    ['loadFromFile', 'src/stores/syncStore.ts', 'async function loadFromFile'],
    [
      'fetchAndMergeRemote',
      'src/services/sync/syncService.ts',
      'async function fetchAndMergeRemote',
    ],
  ])('%s acts on publish-local instead of falling through to a merge', (_name, file, marker) => {
    // `act === 'adopt' ? adopt : merge` is the shape that sent `publish-local`
    // — "we hold an unpublished compaction, the remote is on the old lineage" —
    // into a CROSS-LINEAGE merge, which is precisely what the guard exists to
    // prevent. Every consumer must name all three non-blocking actions.
    // Slice to the function's own closing brace at COLUMN ZERO. An earlier
    // helper cut at the first `\n  }\n`, which is the close of the first
    // two-space block inside the body — so it truncated before the branch it
    // was asserting on and failed on code that was actually correct.
    const src = read(file);
    const start = src.indexOf(marker);
    expect(start, `${marker} not found in ${file}`).toBeGreaterThan(-1);
    const rest = src.slice(start);
    const end = rest.indexOf('\n}\n');
    const body = code(end === -1 ? rest : rest.slice(0, end));
    expect(body).toContain("'publish-local'");
  });
});
