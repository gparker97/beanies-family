/**
 * #124 R3: the ONE way a test builds a document in the scalar (`str`) form, so the readers are
 * proven against both forms by the same cases, never by bespoke fixtures:
 *
 *   describe.each([['text', identity], ['str', asStrForm]])('… (%s)', (_form, form) => { … })
 *
 * `asStrForm` rewrites, in ONE change, every string the shared `classify` table calls scalar as
 * an `ImmutableString` (driven by `scalarStrings.ts`, so it never drifts from the table). Prose
 * and unclassified strings stay collaborative text, which is exactly the mixed doc the writer
 * produces. `identity` is the text row.
 */
import * as Automerge from '@automerge/automerge';
import { classify, isImmutableString, isMapValue } from '../scalarStrings';
import { COLLECTION_NAMES } from '@/types/automerge';

/** The collection roots: their entities classify under the collection name. */
const COLLECTIONS: ReadonlySet<string> = new Set<string>(COLLECTION_NAMES);

/** Roots that never hold a wrapped write (the lineage stamps and the Counter maps). */
const SKIPPED_ROOTS: ReadonlySet<string> = new Set([
  'podLineage',
  'foldedCounters',
  'counterDeltas',
]);

export type DocForm = <T>(doc: Automerge.Doc<T>) => Automerge.Doc<T>;

/** The text row: the document as every shipped build writes it. */
export const identity: DocForm = (doc) => doc;

/** Rewrite every scalar-classified string (own key, else container) as an `ImmutableString`. */
function wrapIn(node: unknown, container: string | undefined): void {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v: unknown = node[i];
      if (typeof v === 'string') {
        if (classify(i, container) === 'scalar') node[i] = new Automerge.ImmutableString(v);
      } else {
        wrapIn(v, container);
      }
    }
    return;
  }
  if (!isMapValue(node) || node instanceof Automerge.Counter) return;
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (typeof v === 'string') {
      if (classify(key, container) === 'scalar') node[key] = new Automerge.ImmutableString(v);
    } else if (!isImmutableString(v)) {
      wrapIn(v, key);
    }
  }
}

/** The `str` row. A doc with nothing left to wrap comes back unchanged (no new change). */
export const asStrForm: DocForm = (doc) =>
  Automerge.change(doc, (d) => {
    const root = d as unknown as Record<string, unknown>;
    for (const key of Object.keys(root)) {
      if (SKIPPED_ROOTS.has(key)) continue;
      const v = root[key];
      if (typeof v === 'string') {
        if (classify(key, undefined) === 'scalar') root[key] = new Automerge.ImmutableString(v);
      } else if (COLLECTIONS.has(key) && isMapValue(v)) {
        // A collection's entities classify under the COLLECTION name, exactly as
        // `docValue(op.collection, entity)` and the audit's `walkSeed` do; the entity id is a
        // key, never a container (it matters for `notificationReads`, whose entity values are
        // dynamic maps classified by the collection name alone).
        for (const entity of Object.values(v)) wrapIn(entity, key);
      } else {
        wrapIn(v, key);
      }
    }
  });

/** The two rows every touched suite runs under. */
export const FORMS: ReadonlyArray<readonly [string, DocForm]> = [
  ['text', identity],
  ['str', asStrForm],
];
