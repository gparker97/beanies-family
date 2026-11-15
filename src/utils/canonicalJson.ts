/**
 * Sorted-key JSON: the one canonical serialisation, so two values that differ
 * only in key ORDER serialise identically.
 *
 * Two users, one definition: the Automerge worker's reconciler (equality and
 * value identity, `worker/reconcile.ts`) and the envelope fingerprint
 * (`envelopeMerge.ts`, requirement 15). A second copy would be a second
 * definition of "equal" that could drift from the first.
 *
 * Semantics are exactly `JSON.stringify`'s: `undefined` stays `undefined`,
 * undefined-valued keys drop out, arrays keep their order.
 */

/** A plain map: a non-null, non-array object. */
function isPlainMap(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * `isMap` decides which objects have their keys sorted. The worker passes its
 * own predicate, which also excludes Automerge's `ImmutableString` (an object
 * that must serialise as itself, never be rebuilt as a map).
 */
export function canonicalJson(
  value: unknown,
  isMap: (v: unknown) => v is Record<string, unknown> = isPlainMap
): string | undefined {
  return JSON.stringify(value, (_key: string, v: unknown): unknown => {
    if (!isMap(v)) return v;
    const sorted: Record<string, unknown> = {};
    // eslint-disable-next-line security/detect-object-injection -- k is an own key of v
    for (const k of Object.keys(v).sort()) sorted[k] = v[k];
    return sorted;
  });
}
