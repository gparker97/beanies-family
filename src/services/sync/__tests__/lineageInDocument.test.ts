/**
 * The invariant ADR-036 exists to protect: the lineage is a fact about a
 * HISTORY, so it lives on the DOCUMENT and is compared in exactly one place.
 *
 * These are structural assertions on purpose. The test they replace
 * (`lineageWiring.test.ts`) sliced `syncStore.ts` source on a delimiter that
 * occurs ZERO times in that file, silently fell back to "the rest of the file",
 * and asserted nothing while reporting green — which is how a broken guard
 * shipped. Every slice here fails loudly if its anchor is missing.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
/** Comments describe what the code must NOT do, so strip them before asserting. */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

function bodyOf(src: string, marker: string, endMarker: string): string {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`bodyOf: marker not found: ${marker}`);
  const rest = src.slice(start);
  const end = rest.indexOf(endMarker, marker.length);
  if (end === -1) throw new Error(`bodyOf: end marker not found after ${marker}`);
  return rest.slice(0, end);
}

describe('the lineage is on the DOCUMENT, not the envelope', () => {
  it('BeanpodFileV4 carries no lineage field', () => {
    // It lived here and that is exactly why the guard failed: the envelope is
    // maintained on three tracks independent of the document, and
    // `preserveLocalKeyDicts` spreads `...incoming`, so every replacement
    // overwrote the local stamp with the remote's — including on the branch
    // that exists because ours is newer.
    const src = code(read('src/types/syncFileV4.ts'));
    expect(src).not.toContain('podLineage');
  });

  it('FamilyDocument carries it, as a null union like `settings`', () => {
    // `| null` rather than optional because Automerge THROWS on an assigned
    // `undefined` — the same reason `settings` is typed that way.
    expect(code(read('src/types/automerge.ts'))).toContain('podLineage: PodLineage | null');
  });

  it('it is NOT seeded by migrateDoc — that would churn every legacy pod', () => {
    // Seeding would emit a real `Automerge.change` into every existing family's
    // document on open, growing the history this whole tier exists to shrink.
    expect(code(read('src/types/automerge.ts'))).toContain('NON_COLLECTION_KEYS');
    // `code()` first: the doc comment above the seed NAMES it, so an
    // uncommented slice would start inside the prose rather than the literal.
    const seed = bodyOf(code(read('src/types/automerge.ts')), 'COLLECTION_NAME_SEED', '};');
    expect(seed).not.toContain('podLineage');
  });
});

describe('the comparison happens in ONE place, inside the worker', () => {
  const worker = read('src/services/automerge/worker/applyAndProject.ts');

  it('mergeRemoteEnvelope guards after the decrypt and before any merge', () => {
    const body = code(bodyOf(worker, 'export async function mergeRemoteEnvelope', '\n}\n'));
    expect(body.length, 'body looks unsliced').toBeLessThan(20_000);
    expect(body.indexOf('guardLineage(')).toBeGreaterThan(body.indexOf('decryptToDoc'));
  });

  it('no production code outside the worker calls the guard', () => {
    // Enforced by `no-restricted-imports` too; asserted here so the intent is
    // readable at the place the invariant is described.
    for (const f of ['src/stores/syncStore.ts', 'src/services/sync/syncService.ts']) {
      const src = code(read(f));
      expect(src, `${f} must not call the guard`).not.toContain('guardLineage(');
      expect(src, `${f} must not compare lineages`).not.toContain('compareLineage(');
    }
  });

  it('the basis is REQUIRED, and `adoptRemoteEnvelope` is gone', () => {
    // A boolean with a default was a second entry point and a decision nobody
    // made: a caller could reach a merge without stating what it could prove.
    const client = code(read('src/services/automerge/worker/docClient.ts'));
    expect(client).not.toContain('function adoptRemoteEnvelope');
    expect(client).toContain('basis: LineageBasis');
  });
});

describe('compaction stamps the document, in the rebuild itself', () => {
  it('one change, not two, and the verify covers the stamp', () => {
    // A separate `Automerge.change` afterwards would leave the compacted
    // document at TWO changes in the tier whose point is that it is one, and
    // would force the integrity check to run against an unstamped copy.
    const body = code(
      bodyOf(
        read('src/services/automerge/worker/applyAndProject.ts'),
        'export function compactDoc',
        '\n}\n'
      )
    );
    expect(body).toContain('podLineage:');
    expect(body).toContain('Automerge.from(source');
    expect(body).toContain('firstJsonDifference(source');
    expect(body).not.toContain("Automerge.change(compacted, 'compact: stamp lineage'");
  });

  it('usePodCompaction no longer stamps the envelope', () => {
    const src = code(read('src/composables/usePodCompaction.ts'));
    expect(src).not.toContain('podLineage');
  });
});
