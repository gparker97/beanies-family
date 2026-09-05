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
